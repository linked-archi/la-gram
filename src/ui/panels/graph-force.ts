/**
 * The Graph tab's force layout, without a canvas (key decision 17): d3-force's
 * simulation, stepped by la-gram's own frame loop, which seeds, anchors, slices
 * and stops it; Cytoscape.js draws the positions it writes (`graph-view.ts`).
 *
 * - `LiveForce`, the live layout: one simulation and at most one pending frame.
 *   A run is animated (a small graph, no reduced-motion preference) or laid out
 *   at once (before the first paint when the whole of it fits, otherwise a
 *   slice a frame), and then shown at rest in one change. A dragged element
 *   pulls the elements linked to it (live), is held at the pointer while a
 *   computation runs (held), or moves alone. Nothing is scheduled at rest,
 *   paused, ended or destroyed.
 * - `seedPositions`: where elements start. Drawn ones where they are drawn; new
 *   ones one collision diameter from the element they were reached from,
 *   fanned outward and turned clear of what is drawn.
 * - `topologyChange`: how hard a change reheats; nothing when nothing drawn
 *   changed.
 * - `forcePositions`: the same forces and seeding, headless and deterministic,
 *   for views made from query results.
 * - `ForceParams`: the three forces the Graph tab's sliders set (Req 17.13) —
 *   link distance, charge strength, a factor on the collision radius — which
 *   `toForceParams` brings into range; `DEFAULT_FORCE_PARAMS` are `FORCE`'s.
 *
 * d3 rewrites the objects it is given (a link's ends become node objects, and
 * nodes and links get an `index`), so it only ever gets this module's own,
 * made anew at each rebuild; the callers' nodes, lines and positions are read,
 * never kept or changed. Imports only d3-force: no DOM, no store.
 */

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type {
  ForceCollide,
  ForceLink,
  ForceManyBody,
  ForceX,
  ForceY,
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from 'd3-force';

export interface Point {
  x: number;
  y: number;
}

export interface ForceGraphNode {
  id: string;
}

export interface ForceGraphEdge {
  id: string;
  source: string;
  target: string;
}

/** A frame scheduler: the browser's, or a test's. Its handles are opaque. */
export interface FrameScheduler {
  request(step: () => void): unknown;
  cancel(handle: unknown): void;
  now(): number;
}

type BrowserFrame = { raf: number } | { timeout: ReturnType<typeof setTimeout> };

/** requestAnimationFrame (setTimeout 16 ms where there is none) and performance.now. */
export const browserFrames: FrameScheduler = {
  request(step) {
    if (typeof requestAnimationFrame === 'function') return { raf: requestAnimationFrame(() => step()) };
    return { timeout: setTimeout(step, 16) };
  },
  cancel(handle) {
    const frame = handle as BrowserFrame;
    if ('raf' in frame) cancelAnimationFrame(frame.raf);
    else clearTimeout(frame.timeout);
  },
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

/**
 * The layout's settings (key decision 17). The three node limits are measured
 * by `npm run bench -- --graph` under 4× CPU throttling (key design decision 17,
 * *How to measure them again*); each stays within the sweep's 3 000 elements.
 */
export const FORCE: Readonly<{
  /**
   * Centre to centre along a line: 60 px of line between two boxes side by side, room for a type name. The
   * default; the user's value is `ForceParams.linkDistance`.
   */
  linkDistance: number;
  /** The push between elements (the default; the user's value is `ForceParams.chargeStrength`)… */
  chargeStrength: number;
  /** …up to this distance (`distanceMax`), which bounds its cost and its far reach. */
  chargeRange: number;
  /** The pull towards the anchor along the drawing's long side; × min(4, long ÷ short) along the short side. */
  gravity: number;
  /** Added to half a box's diagonal for the collision radius, which the user's `ForceParams.collideScale` multiplies. */
  collidePadding: number;
  collideIterations: number;
  /** New children of one element are this far apart, over a half circle at most; a fan is turned in these steps. */
  seedSpreadDeg: number;
  /** d3's: a run comes to rest below it. */
  alphaMin: number;
  /** Alpha decays from 1 to `alphaMin` over this many steps… */
  animateSteps: number;
  /** …or this many, above `animateMaxNodes`. */
  settleSteps: number;
  /** d3's. */
  velocityDecay: number;
  /** The least a change reheats by. */
  reheatMin: number;
  /** Keeps the simulation warm while an element is dragged live. */
  dragAlphaTarget: number;
  /** An animated frame runs another step only while its steps stay within this… */
  frameTickBudgetMs: number;
  /** …and at most this many. */
  maxTicksPerFrame: number;
  /** A layout laid out at once runs inside the call that starts it when all of it fits in this. */
  syncSettleMs: number;
  /** Otherwise a slice a frame: one step, and more while they stay within this. */
  sliceMs: number;
  /** A layout laid out at once gets at most this much computing; then it is shown as reached. */
  settleBudgetMs: number;
  /** Animated up to this many elements; above, laid out at once. */
  animateMaxNodes: number;
  /** A drag at rest is live up to this many elements; above, the element moves alone. */
  liveDragMaxNodes: number;
  /** The force layout runs up to this many elements; above, Force draws rings. */
  forceMaxNodes: number;
}> = Object.freeze({
  // Tuned on the example model (key decision 17): at 150 a relationship's type name was hidden between boxes
  // side by side; at 180 it reads at 100 %, and a small change still moves no drawn element more than 15 px.
  linkDistance: 180,
  chargeStrength: -350,
  chargeRange: 600,
  gravity: 0.02,
  collidePadding: 2,
  collideIterations: 2,
  seedSpreadDeg: 30,
  alphaMin: 0.001,
  animateSteps: 300,
  settleSteps: 200,
  velocityDecay: 0.4,
  reheatMin: 0.3,
  dragAlphaTarget: 0.3,
  frameTickBudgetMs: 4,
  maxTicksPerFrame: 3,
  syncSettleMs: 100,
  sliceMs: 12,
  settleBudgetMs: 1500,
  // Measured (2026-11-10, Apple M4 Pro, Chrome, 4× CPU throttling): `npm run bench -- --graph`, by the rules of
  // key decision 17. Animated up to 100 (at 200 the median frame is two frames); dragged live up to 100 (at 200 a
  // drag's p95 frame was 50 ms in one run, 67 ms in another); laid out up to 800 (a step 12.5 ms on average; at
  // 1 000, 18 ms).
  animateMaxNodes: 100,
  liveDragMaxNodes: 100,
  forceMaxNodes: 800,
});

export type ForceLimits = Pick<
  typeof FORCE,
  'animateMaxNodes' | 'liveDragMaxNodes' | 'forceMaxNodes' | 'syncSettleMs' | 'sliceMs' | 'settleBudgetMs'
>;

/**
 * FORCE's limits, overridden by the given ones, then kept in order:
 * liveDragMaxNodes is raised to at least animateMaxNodes (a drag during an
 * animated run is always live), and both are lowered to at most forceMaxNodes
 * (nothing is simulated above it).
 */
export function resolveLimits(limits?: Partial<ForceLimits>): ForceLimits {
  const value = (key: keyof ForceLimits): number => limits?.[key] ?? FORCE[key];
  const forceMaxNodes = value('forceMaxNodes');
  return {
    animateMaxNodes: Math.min(value('animateMaxNodes'), forceMaxNodes),
    liveDragMaxNodes: Math.min(Math.max(value('liveDragMaxNodes'), value('animateMaxNodes')), forceMaxNodes),
    forceMaxNodes,
    syncSettleMs: value('syncSettleMs'),
    sliceMs: value('sliceMs'),
    settleBudgetMs: value('settleBudgetMs'),
  };
}

/** The forces the Graph tab's *Forces* sliders set (Req 17.13), in d3-force's terms. */
export interface ForceParams {
  /** Centre to centre along a line, in px: `forceLink.distance`. */
  linkDistance: number;
  /** d3's sign, negative pushes apart: `forceManyBody.strength`. */
  chargeStrength: number;
  /** Times the collision radius the caller gives (half the box's diagonal plus `collidePadding`). */
  collideScale: number;
}

/**
 * Each force's range and step. The charge is in d3's sign here and in storage;
 * its slider shows the push, `-chargeStrength`, so that further right is
 * stronger (key design decision 17). Each default is on its step.
 */
export const FORCE_CONTROLS: Readonly<Record<keyof ForceParams, Readonly<{ min: number; max: number; step: number }>>> = Object.freeze({
  linkDistance: Object.freeze({ min: 40, max: 400, step: 10 }),
  chargeStrength: Object.freeze({ min: -1500, max: 0, step: 50 }),
  // A factor rather than pixels: the radius comes from the box's size, and `forcePositions` gets other sizes
  // than the drawn 120 × 46, so 1.0× means the same for any box.
  collideScale: Object.freeze({ min: 0.5, max: 2, step: 0.1 }),
});

/** `FORCE`'s link distance and charge, and the collision radius as given: the layout with no force changed. */
export const DEFAULT_FORCE_PARAMS: Readonly<ForceParams> = Object.freeze({
  linkDistance: FORCE.linkDistance,
  chargeStrength: FORCE.chargeStrength,
  collideScale: 1,
});

/**
 * Forces from anything — storage, a slider, a caller — field by field: a
 * finite number is clamped to its range, snapped to `min + k·step` and rounded
 * to two decimals (so 0.1 steps give 1.3, not 1.3000000000000003), and never
 * −0; anything else (missing, a string, NaN, ±Infinity) is that field's
 * default. Not an object: every default. Always a new object.
 */
export function toForceParams(value: unknown): ForceParams {
  const given = value !== null && typeof value === 'object' ? (value as Partial<Record<keyof ForceParams, unknown>>) : {};
  const field = (key: keyof ForceParams): number => {
    const v = given[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_FORCE_PARAMS[key];
    const { min, max, step } = FORCE_CONTROLS[key];
    const snapped = min + Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step;
    return Number(Math.min(max, snapped).toFixed(2)) + 0;
  };
  return { linkDistance: field('linkDistance'), chargeStrength: field('chargeStrength'), collideScale: field('collideScale') };
}

/** What a graph is, for telling a change from a refresh: node IRIs, `id source target` lines, the middle. */
export interface Topology {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  root: string;
}

export function topologyOf(nodes: readonly ForceGraphNode[], edges: readonly ForceGraphEdge[], rootId: string): Topology {
  return {
    nodes: new Set(nodes.map((n) => n.id)),
    edges: new Set(edges.map((e) => `${e.id} ${e.source} ${e.target}`)),
    root: rootId,
  };
}

/**
 * How hard a change reheats the layout, its rules in this order: a new graph
 * with no nodes, 0; a first graph (or one after an empty graph), 1; the same
 * nodes and lines, 0, or `reheatMin` with another middle element; otherwise the
 * nodes and lines added or removed over the smaller graph's nodes and lines,
 * from `reheatMin` to 1. `kept`: the nodes in both.
 */
export function topologyChange(before: Topology | undefined, after: Topology): { reheat: number; kept: ReadonlySet<string> } {
  const kept = new Set<string>();
  if (before) for (const id of after.nodes) if (before.nodes.has(id)) kept.add(id);
  if (after.nodes.size === 0) return { reheat: 0, kept };
  if (!before || before.nodes.size === 0) return { reheat: 1, kept };
  const differ = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
    let n = 0;
    for (const x of a) if (!b.has(x)) n++;
    return n;
  };
  const changed =
    differ(after.nodes, before.nodes) + differ(before.nodes, after.nodes) + differ(after.edges, before.edges) + differ(before.edges, after.edges);
  if (changed === 0) return { reheat: before.root === after.root ? 0 : FORCE.reheatMin, kept };
  const smaller = Math.min(before.nodes.size + before.edges.size, after.nodes.size + after.edges.size);
  return { reheat: Math.max(FORCE.reheatMin, Math.min(1, changed / smaller)), kept };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Unreached nodes (headless use only) start on a sunflower this wide round the centre. */
const UNREACHED_SPACING = 180;
/** The pull along the short side is at most this many times the long side's. */
const MAX_PULL_RATIO = 4;
const EPSILON = 1e-9;

const finite = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const sunflower = (centre: Point, spacing: number, k: number): Point => ({
  x: centre.x + spacing * Math.sqrt(k) * Math.cos(k * GOLDEN_ANGLE),
  y: centre.y + spacing * Math.sqrt(k) * Math.sin(k * GOLDEN_ANGLE),
});

/** The drawn nodes, in cells one seed distance wide: a point's neighbours within that distance are in the nine cells round it. */
class Grid {
  private readonly cells = new Map<string, Array<{ id: string; at: Point }>>();
  constructor(private readonly size: number) {}

  add(id: string, at: Point): void {
    const key = `${Math.floor(at.x / this.size)} ${Math.floor(at.y / this.size)}`;
    const cell = this.cells.get(key);
    if (cell) cell.push({ id, at });
    else this.cells.set(key, [{ id, at }]);
  }

  /** The distance to the nearest node but `except` within the nine cells round `p`; Infinity when there is none. */
  nearest(p: Point, except?: string): number {
    const cx = Math.floor(p.x / this.size);
    const cy = Math.floor(p.y / this.size);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const { id, at } of this.cells.get(`${cx + dx} ${cy + dy}`) ?? []) {
          if (id !== except) best = Math.min(best, Math.hypot(at.x - p.x, at.y - p.y));
        }
    return best;
  }
}

/**
 * Where each node starts (key design decision 17), deterministic. Drawn nodes
 * (a finite position in `at`) start where they are. The rest are placed breadth first from
 * the middle element (the first node when there is none), over the lines in both
 * directions in their order: a new node one `distance` (twice the collision
 * radius) from the node it was reached from, its siblings fanned outward over at
 * most a half circle (the middle element's own all round), the fan turned in
 * `seedSpreadDeg` steps until it clears every drawn node but the parent. A new
 * middle element starts one `distance` from its first drawn neighbour, towards
 * `centre`, turned clear; with no drawn neighbour at `centre`, or the first point
 * clear of what is drawn on a sunflower round it. Nodes the walk does not reach
 * start on a sunflower round `centre`, and fan out the same way.
 */
export function seedPositions(
  nodes: readonly ForceGraphNode[],
  edges: readonly ForceGraphEdge[],
  rootId: string,
  at: ReadonlyMap<string, Point>,
  centre: Point,
  distance: number,
): Map<string, Point> {
  const start = new Map<string, Point>();
  const ids = new Set(nodes.map((n) => n.id));
  const reach = Number.isFinite(distance) && distance > 0 ? distance : 1;
  const drawn = new Grid(reach);
  for (const node of nodes) {
    const p = at.get(node.id);
    if (!finite(p) || start.has(node.id)) continue;
    start.set(node.id, { x: p.x, y: p.y });
    drawn.add(node.id, p);
  }
  const adjacent = new Map<string, string[]>([...ids].map((id) => [id, []]));
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
    adjacent.get(e.source)!.push(e.target);
    adjacent.get(e.target)!.push(e.source);
  }
  const middle = ids.has(rootId) ? rootId : nodes[0]?.id;
  if (middle === undefined) return start;

  const spread = (FORCE.seedSpreadDeg * Math.PI) / 180;
  const turns = [0];
  for (let t = spread; t < Math.PI - EPSILON; t += spread) turns.push(t, -t);
  turns.push(Math.PI);
  /** The fan's points round `parent`, at the first turn that clears the drawn nodes, or the one with the most room. */
  const clear = (parent: Point, angles: number[], except: string): Point[] => {
    let best: Point[] = [];
    let room = -Infinity;
    for (const turn of turns) {
      const points = angles.map((a) => ({ x: parent.x + reach * Math.cos(a + turn), y: parent.y + reach * Math.sin(a + turn) }));
      const nearest = Math.min(...points.map((p) => drawn.nearest(p, except)));
      if (nearest >= reach - EPSILON) return points;
      if (nearest > room) {
        room = nearest;
        best = points;
      }
    }
    return best;
  };

  // The middle element.
  if (!start.has(middle)) {
    const neighbour = adjacent.get(middle)!.find((id) => start.has(id));
    if (neighbour !== undefined) {
      const n = start.get(neighbour)!;
      const towards = Math.hypot(centre.x - n.x, centre.y - n.y) > EPSILON ? Math.atan2(centre.y - n.y, centre.x - n.x) : 0;
      start.set(middle, clear(n, [towards], neighbour)[0]!);
    } else if (drawn.nearest(centre) >= reach - EPSILON) {
      start.set(middle, { x: centre.x, y: centre.y });
    } else {
      let p = sunflower(centre, reach, 1);
      for (let k = 2; drawn.nearest(p) < reach - EPSILON && k <= 8 * nodes.length + 64; k++) p = sunflower(centre, reach, k);
      start.set(middle, p);
    }
  }
  const origin = start.get(middle)!;

  const visited = new Set<string>();
  const walk = (from: string) => {
    visited.add(from);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const parent = queue[i]!;
      const children: string[] = [];
      for (const id of adjacent.get(parent)!) {
        if (visited.has(id)) continue;
        visited.add(id);
        children.push(id);
      }
      queue.push(...children);
      const fresh = children.filter((id) => !start.has(id));
      if (fresh.length === 0) continue;
      const p = start.get(parent)!;
      const k = fresh.length;
      let angles: number[];
      if (parent === middle) angles = fresh.map((_, j) => (2 * Math.PI * j) / k);
      else {
        const outward = Math.hypot(p.x - origin.x, p.y - origin.y) > EPSILON ? Math.atan2(p.y - origin.y, p.x - origin.x) : 0;
        const arc = Math.min(Math.PI, spread * (k - 1));
        angles = fresh.map((_, j) => (k === 1 ? outward : outward - arc / 2 + (arc * j) / (k - 1)));
      }
      clear(p, angles, parent).forEach((q, j) => start.set(fresh[j]!, q));
    }
  };
  walk(middle);
  let unreached = 0;
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    if (!start.has(node.id)) start.set(node.id, sunflower(centre, UNREACHED_SPACING, ++unreached));
    walk(node.id);
  }
  return start;
}

/** A node as d3 holds it: this module's own object. */
interface ForceNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
type ForceLinkDatum = SimulationLinkDatum<ForceNode>;

interface ForceSimulation {
  simulation: Simulation<ForceNode, ForceLinkDatum>;
  link: ForceLink<ForceNode, ForceLinkDatum>;
  charge: ForceManyBody<ForceNode>;
  collide: ForceCollide<ForceNode>;
  x: ForceX<ForceNode>;
  y: ForceY<ForceNode>;
}

/**
 * A simulation with la-gram's forces, stopped at once: la-gram's loop steps it, d3's timer never does.
 * `radius` is the collision radius to apply, the scale already in it; `params` give the link and the charge.
 */
function createSimulation(radius: number, params: Readonly<ForceParams>): ForceSimulation {
  const simulation = forceSimulation<ForceNode, ForceLinkDatum>().stop();
  // Links find their ends by IRI, not by d3's default, the node's index.
  const link = forceLink<ForceNode, ForceLinkDatum>([])
    .id((n) => n.id)
    .distance(params.linkDistance);
  const charge = forceManyBody<ForceNode>().strength(params.chargeStrength).distanceMax(FORCE.chargeRange);
  const collide = forceCollide<ForceNode>(radius).iterations(FORCE.collideIterations);
  const x = forceX<ForceNode>(0).strength(FORCE.gravity);
  const y = forceY<ForceNode>(0).strength(FORCE.gravity);
  // No forceCenter: it shifts every node to keep their mean in place, so a drag would slide the whole graph.
  simulation
    .alpha(0)
    .alphaMin(FORCE.alphaMin)
    .velocityDecay(FORCE.velocityDecay)
    .force('link', link)
    .force('charge', charge)
    .force('collide', collide)
    .force('x', x)
    .force('y', y);
  return { simulation, link, charge, collide, x, y };
}

/**
 * Hand d3 a graph: its own node objects and new link objects from the IRIs,
 * leaving out self-loops and lines to unknown nodes. The link force is emptied
 * first, then the nodes are set, then the links, which d3 resolves against the
 * nodes it holds when they are set.
 */
function load(force: ForceSimulation, nodes: ForceNode[], edges: readonly ForceGraphEdge[]): void {
  const known = new Set(nodes.map((n) => n.id));
  const links = edges
    .filter((e) => e.source !== e.target && known.has(e.source) && known.has(e.target))
    .map((e): ForceLinkDatum => ({ source: e.source, target: e.target }));
  force.link.links([]);
  force.simulation.nodes(nodes);
  force.link.links(links);
}

/** The pull towards the anchor: `gravity` along the drawing's long side, up to 4× that along the short side. */
function pull(force: ForceSimulation, anchor: Point, aspect: number): void {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const factor = Math.min(MAX_PULL_RATIO, Math.max(1, ratio >= 1 ? ratio : 1 / ratio));
  force.x.x(anchor.x).strength(ratio >= 1 ? FORCE.gravity : FORCE.gravity * factor);
  force.y.y(anchor.y).strength(ratio >= 1 ? FORCE.gravity * factor : FORCE.gravity);
}

/** The alpha decay that takes alpha from 1 to `alphaMin` in `steps` steps. */
const decayOver = (steps: number) => 1 - Math.pow(FORCE.alphaMin, 1 / steps);

/**
 * The force layout of an undrawn graph (key design decision 17): headless,
 * synchronous and deterministic, round (0, 0) with the middle element pinned
 * there, an even pull (aspect 1), a collision radius from the given size times
 * `collideScale`, and the given forces, through `toForceParams` (the defaults
 * where none are given). It steps until alpha falls below `alphaMin` (300
 * steps, or 200 above `animateMaxNodes`), with no time budget, so the result
 * does not depend on the machine.
 */
export function forcePositions(
  nodes: readonly ForceGraphNode[],
  edges: readonly ForceGraphEdge[],
  options: { rootId?: string; width: number; height: number; params?: Partial<ForceParams> },
): Map<string, Point> {
  const params = toForceParams({ ...DEFAULT_FORCE_PARAMS, ...options.params });
  const radius = (Math.hypot(options.width, options.height) / 2 + FORCE.collidePadding) * params.collideScale;
  const rootId = options.rootId ?? '';
  const centre = { x: 0, y: 0 };
  const starts = seedPositions(nodes, edges, rootId, new Map(), centre, 2 * radius);
  const objects = nodes.map((n): ForceNode => {
    const p = starts.get(n.id)!;
    return { id: n.id, x: p.x, y: p.y, vx: 0, vy: 0, ...(n.id === rootId ? { fx: p.x, fy: p.y } : {}) };
  });
  const force = createSimulation(radius, params);
  load(force, objects, edges);
  const root = objects.find((n) => n.id === rootId);
  pull(force, root ? { x: root.x, y: root.y } : centre, 1);
  force.simulation.alpha(1).alphaDecay(decayOver(nodes.length > FORCE.animateMaxNodes ? FORCE.settleSteps : FORCE.animateSteps));
  while (objects.length > 0 && force.simulation.alpha() >= FORCE.alphaMin) force.simulation.tick();
  return new Map(objects.map((n) => [n.id, { x: n.x, y: n.y }]));
}

export type LayoutState = 'running' | 'settled';

/** The latest run's figures, for the bench and tests. Times in ms, from `frames.now()`. */
export interface ForceRunStats {
  mode: 'animate' | 'settle';
  nodes: number;
  steps: number;
  /** Steps run inside the call that started the run. */
  syncMs: number;
  /** All steps' time. */
  computeMs: number;
  longestStepMs: number;
  /** Alpha now, or when the run ended. */
  alpha: number;
  /** The run's first clock reading (NaN until there is one). */
  startedAt: number;
  /** When the run came to rest or was ended; absent while it runs. */
  endedAt?: number;
}

export interface LiveForceOptions {
  frames: FrameScheduler;
  /** Collision radius: half the drawn box's diagonal, plus 2; applied times `ForceParams.collideScale`. */
  radius: number;
  reducedMotion(): boolean;
  /** Positions to draw: a frame of the animation, or the layout at rest. */
  write(nodes: ReadonlyArray<Readonly<{ id: string; x: number; y: number }>>): void;
  /** A run started ('running', once until it ends) or ended ('settled', at the end of every run). */
  state(state: LayoutState): void;
  /** Smaller limits, for tests; through resolveLimits(). */
  limits?: Partial<ForceLimits>;
}

export interface LiveGraph {
  nodes: readonly ForceGraphNode[];
  edges: readonly ForceGraphEdge[];
  rootId: string;
  /** Where the drawn nodes are now: Cytoscape.js's model positions. */
  at: ReadonlyMap<string, Point>;
  /** The view's centre. A new middle element linked to no drawn node starts there, or round it. */
  centre: Point;
  /** The drawing's width ÷ height. */
  aspect: number;
  /** From topologyChange, or 1. */
  reheat: number;
  kept: ReadonlySet<string>;
  /** A restart (a switch to Force, or Force after a static layout): nothing held, every drag ended. */
  restart?: boolean;
}

type DragMode = 'live' | 'held' | 'alone';

/**
 * The live force layout (key decision 17): the loop described under
 * *Relationship graph* in `.agents/specs/la-gram/design.md`. One simulation,
 * created on the first `setGraph()`; one pending frame at most, requested only
 * while a run is in progress, not paused and not destroyed.
 *
 * The clock is read at the start of each frame, slice or synchronous part and
 * after each step, nowhere else, and every budget is checked before a step with
 * the last step's time standing for the next one's: a step cannot be split, so
 * where one is longer than the bound, the frame or slice is that one step.
 *
 * The forces (`setParams`, Req 17.13) reach d3 at the next start, frame or
 * rebuild, so any number of changes between two frames are one update.
 */
export class LiveForce {
  private readonly limits: ForceLimits;
  private force: ForceSimulation | undefined;
  private nodes: ForceNode[] = [];
  private byId = new Map<string, ForceNode>();
  private rootId = '';
  private anchor: Point = { x: 0, y: 0 };
  private aspect = 1;
  private kept: ReadonlySet<string> = new Set();
  private restarted = false;
  private phase: 'idle' | 'animate' | 'settle' = 'idle';
  private paused = false;
  private destroyed = false;
  /** The pending frame: a ticket, so a callback that outlived its cancellation does nothing. */
  private frame: { handle?: unknown } | undefined;
  /** Ms of steps in this settle. */
  private spent = 0;
  /** The latest step's ms (0 after a rebuild). */
  private last = 0;
  /** The clock's latest reading. */
  private mark = 0;
  private reported: LayoutState = 'settled';
  private current: ForceRunStats | undefined;
  private readonly drags = new Map<string, DragMode>();
  /** Nodes fixed for this run only: kept nodes and held drags. The middle element is pinned for good, never here. */
  private readonly held = new Set<string>();
  /** The forces in use: the defaults until setParams(). */
  private settings: ForceParams = { ...DEFAULT_FORCE_PARAMS };
  /** Whether d3 has yet to get `settings`: at the next start, frame or rebuild (apply()). */
  private stale = false;

  constructor(private readonly options: LiveForceOptions) {
    this.limits = resolveLimits(options.limits);
  }

  /** The graph to lay out. Returns each node's start position. Schedules nothing; run() follows it. */
  setGraph(graph: LiveGraph): Map<string, Point> {
    const force = (this.force ??= createSimulation(this.radius(), this.settings));
    this.apply();
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (graph.reheat === 0 && ids.size === this.byId.size && [...ids].every((id) => this.byId.has(id))) return this.positions();

    // A rebuild ends a run in progress without a report; the run() that follows reports, and decides again.
    this.cancelFrame();
    this.phase = 'idle';
    // One collision diameter from the parent, at the collision radius in use.
    const starts = seedPositions(graph.nodes, graph.edges, graph.rootId, graph.at, graph.centre, 2 * this.radius());
    const rootId = ids.has(graph.rootId) ? graph.rootId : '';
    if (graph.restart) this.drags.clear();
    else for (const id of [...this.drags.keys()]) if (!ids.has(id)) this.drags.delete(id);
    this.held.clear();
    const nodes = graph.nodes.map((n): ForceNode => {
      const p = starts.get(n.id)!;
      const node: ForceNode = { id: n.id, x: p.x, y: p.y, vx: 0, vy: 0 };
      const mode = this.drags.get(n.id);
      // The middle element is pinned where it starts; an element dragged live or held stays where it is drawn.
      if (n.id === rootId || mode === 'live' || mode === 'held') {
        node.fx = p.x;
        node.fy = p.y;
      }
      if (mode === 'held' && n.id !== rootId) this.held.add(n.id);
      return node;
    });
    load(force, nodes, graph.edges);
    this.nodes = nodes;
    this.byId = new Map(nodes.map((n) => [n.id, n]));
    this.rootId = rootId;
    const root = this.byId.get(rootId);
    this.anchor = root ? { x: root.x, y: root.y } : { x: graph.centre.x, y: graph.centre.y };
    this.aspect = graph.aspect;
    pull(force, this.anchor, this.aspect);
    force.simulation.alphaTarget(this.liveDrags() > 0 ? FORCE.dragAlphaTarget : 0);
    force.simulation.alpha(Math.max(force.simulation.alpha(), graph.reheat));
    this.kept = new Set(graph.kept);
    this.restarted = !!graph.restart;
    this.spent = 0;
    this.last = 0;
    return new Map([...starts].map(([id, p]) => [id, { x: p.x, y: p.y }]));
  }

  /** Start the new graph's layout run as key design decision 17 decides, or resume one in progress; nothing at rest. */
  run(): void {
    if (this.destroyed) return;
    this.paused = false;
    if (this.phase !== 'idle') {
      this.schedule();
      return;
    }
    if (this.nodes.length === 0 || this.cool()) {
      // A run that a rebuild ended.
      if (this.reported === 'running') this.done(this.alpha());
      return;
    }
    if (this.animates()) this.start('animate');
    else this.start('settle');
  }

  /** Whether a run started now is animated: a drag is live, or the graph is small and motion is not reduced. */
  animates(): boolean {
    return this.liveDrags() > 0 || (!this.options.reducedMotion() && this.nodes.length <= this.limits.animateMaxNodes);
  }

  /**
   * The forces to lay out with (Req 17.13), merged into those in use and
   * brought into range by `toForceParams`. Returns false, and does nothing,
   * when nothing changes, or after destroy(). Otherwise d3 gets them at the
   * next start, frame or rebuild, at most once a frame. With a graph: nothing
   * is held still — a change of forces should move every element — alpha is
   * raised to at least `reheatMin`, and a run laid out at once is cut off as a
   * rebuild cuts it off, so that the run() that follows starts a fresh one,
   * with a fresh budget. Drags and the middle element's pin are untouched.
   * Schedules nothing; run() follows it.
   */
  setParams(next: Partial<ForceParams>): boolean {
    if (this.destroyed) return false;
    const params = toForceParams({ ...this.settings, ...next });
    const now = this.settings;
    if (params.linkDistance === now.linkDistance && params.chargeStrength === now.chargeStrength && params.collideScale === now.collideScale) {
      return false;
    }
    this.settings = params;
    this.stale = true;
    if (this.nodes.length === 0) return true;
    this.kept = new Set();
    const simulation = this.force!.simulation;
    simulation.alpha(Math.max(simulation.alpha(), FORCE.reheatMin));
    if (this.phase === 'settle') {
      this.cancelFrame();
      this.release();
      this.phase = 'idle';
      // An element dragged meanwhile stays held where it is, as across a rebuild.
      for (const [id, mode] of this.drags) {
        const node = this.byId.get(id);
        if (mode !== 'held' || id === this.rootId || !node) continue;
        node.fx = node.x;
        node.fy = node.y;
        this.held.add(id);
      }
    }
    return true;
  }

  /** The forces in use, a copy. */
  params(): ForceParams {
    return { ...this.settings };
  }

  dragStart(id: string): void {
    if (this.destroyed || !this.byId.has(id) || this.drags.has(id)) return;
    const mode: DragMode =
      this.phase === 'settle'
        ? 'held'
        : this.phase === 'animate'
          ? 'live'
          : this.options.reducedMotion() || this.nodes.length > this.limits.liveDragMaxNodes
            ? 'alone'
            : 'live';
    this.drags.set(id, mode);
    if (mode === 'held') {
      // dragMove fixes it at the pointer.
      if (id !== this.rootId) this.held.add(id);
    } else if (mode === 'live') {
      this.force!.simulation.alphaTarget(FORCE.dragAlphaTarget);
      if (this.phase === 'idle') this.start('animate');
      else this.schedule();
    }
  }

  dragMove(id: string, at: Point): void {
    const mode = this.drags.get(id);
    const node = this.byId.get(id);
    if (!mode || !node) return;
    node.x = at.x;
    node.y = at.y;
    if (mode === 'live' || this.held.has(id) || id === this.rootId) {
      node.fx = at.x;
      node.fy = at.y;
    }
  }

  dragEnd(id: string, at: Point): void {
    const mode = this.drags.get(id);
    if (!mode) return;
    this.drags.delete(id);
    const node = this.byId.get(id);
    if (node) {
      node.x = at.x;
      node.y = at.y;
      if (id === this.rootId) {
        // The middle element stays pinned where it is dropped, and the pull moves with it.
        node.fx = at.x;
        node.fy = at.y;
        this.anchor = { x: at.x, y: at.y };
        pull(this.force!, this.anchor, this.aspect);
      } else if (this.held.has(id) && this.phase === 'settle') {
        // Held at the drop until the computation ends; finish() releases it in place.
        node.fx = at.x;
        node.fy = at.y;
      } else {
        // Released: it settles back among its neighbours.
        node.fx = null;
        node.fy = null;
        this.held.delete(id);
      }
    }
    if (mode === 'live' && this.liveDrags() === 0) {
      this.force!.simulation.alphaTarget(0);
      this.schedule();
    }
  }

  /** The simulation's positions, as copies. */
  positions(): Map<string, Point> {
    return new Map(this.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  }

  /** The latest run's figures, a copy; undefined before the first run. */
  stats(): ForceRunStats | undefined {
    return this.current ? { ...this.current } : undefined;
  }

  /** 'running' from a run's start to its end, paused or not; 'settled' otherwise. */
  get state(): LayoutState {
    return this.reported;
  }

  /** Cancel the pending frame; schedule nothing until run(). The run stays in progress. */
  pause(): void {
    this.cancelFrame();
    this.paused = true;
  }

  /**
   * End the run now (a switch to Rings or Tree, a graph above the force limit):
   * cancel the frame, end the drags, release the held nodes, and report
   * 'settled' if a run was in progress. Positions stay as they are.
   */
  end(): void {
    if (this.destroyed) return;
    this.cancelFrame();
    const a = this.alpha();
    this.endDrags();
    this.force?.simulation.alphaTarget(0).alpha(0);
    if (this.phase !== 'idle' || this.reported === 'running') this.done(a);
  }

  /** Pause for good: nothing is written, reported or scheduled after this. */
  destroy(): void {
    this.pause();
    this.destroyed = true;
    this.drags.clear();
    this.force?.simulation.stop();
  }

  private alpha(): number {
    return this.force?.simulation.alpha() ?? 0;
  }

  /** The collision radius in use: the given one times `collideScale`. */
  private radius(): number {
    return this.options.radius * this.settings.collideScale;
  }

  /** Give d3 the forces set since it last got them, if any: once, however many setParams() came between. */
  private apply(): void {
    if (!this.stale || !this.force) return;
    this.force.link.distance(this.settings.linkDistance);
    this.force.charge.strength(this.settings.chargeStrength);
    this.force.collide.radius(this.radius());
    this.stale = false;
  }

  private liveDrags(): number {
    let n = 0;
    for (const mode of this.drags.values()) if (mode === 'live') n++;
    return n;
  }

  /** Every drag over, as if dropped where it is: released, but for the middle element, which stays pinned. */
  private endDrags(): void {
    for (const id of this.drags.keys()) {
      const node = this.byId.get(id);
      if (node && id !== this.rootId && !this.held.has(id)) {
        node.fx = null;
        node.fy = null;
      }
    }
    this.drags.clear();
  }

  private cool(): boolean {
    return this.alpha() < FORCE.alphaMin && this.liveDrags() === 0;
  }

  /** The steps alpha still needs to fall below alphaMin at the current decay. */
  private left(): number {
    const simulation = this.force!.simulation;
    return Math.ceil(Math.log(FORCE.alphaMin / simulation.alpha()) / Math.log(1 - simulation.alphaDecay()));
  }

  /** A step that would overrun does not run. */
  private fits(used: number, bound: number): boolean {
    return used + this.last <= bound;
  }

  /** Read the clock at the start of a frame, slice or synchronous part. */
  private read(): number {
    this.mark = this.options.frames.now();
    if (this.current && Number.isNaN(this.current.startedAt)) this.current.startedAt = this.mark;
    return this.mark;
  }

  /** One simulation step, timed by the clock read after it. */
  private tick(): void {
    this.force!.simulation.tick();
    const now = this.options.frames.now();
    const ms = Math.max(0, now - this.mark);
    this.mark = now;
    this.last = ms;
    if (this.phase === 'settle') this.spent += ms;
    const run = this.current!;
    run.steps++;
    run.computeMs += ms;
    run.longestStepMs = Math.max(run.longestStepMs, ms);
  }

  private report(state: LayoutState): void {
    if (state === 'running' && this.reported === 'running') return;
    this.reported = state;
    this.options.state(state);
  }

  private release(): void {
    for (const id of this.held) {
      const node = this.byId.get(id);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
    }
    this.held.clear();
  }

  /** The end of every run. */
  private done(alpha: number): void {
    this.phase = 'idle';
    this.release();
    if (this.current) {
      this.current.alpha = alpha;
      this.current.endedAt = this.mark;
    }
    this.report('settled');
  }

  /** A run laid out at once comes to rest or reaches its budget: shown in one change. */
  private finish(): void {
    const a = this.alpha();
    this.force!.simulation.alpha(0);
    this.release();
    this.options.write(this.nodes);
    this.done(a);
  }

  private start(mode: 'animate' | 'settle'): void {
    this.apply();
    const simulation = this.force!.simulation;
    this.current = { mode, nodes: this.nodes.length, steps: 0, syncMs: 0, computeMs: 0, longestStepMs: 0, alpha: simulation.alpha(), startedAt: NaN };
    if (mode === 'animate') {
      this.phase = 'animate';
      simulation.alphaDecay(decayOver(FORCE.animateSteps));
      this.report('running');
      this.schedule();
      return;
    }
    this.phase = 'settle';
    this.spent = 0;
    // When at least half of the new graph was drawn before, what was drawn stays where it is.
    let kept = 0;
    for (const node of this.nodes) if (this.kept.has(node.id)) kept++;
    if (!this.restarted && kept * 2 >= this.nodes.length) {
      for (const node of this.nodes) {
        if (node.id === this.rootId || !this.kept.has(node.id)) continue;
        node.fx = node.x;
        node.fy = node.y;
        this.held.add(node.id);
      }
    }
    simulation.alphaDecay(decayOver(this.nodes.length > this.limits.animateMaxNodes ? FORCE.settleSteps : FORCE.animateSteps));
    if (this.limits.syncSettleMs > 0) {
      this.read();
      // The first step, whatever it costs; the rest only if all of it fits.
      this.tick();
      while (!this.cool() && this.left() * this.last <= this.limits.syncSettleMs - this.spent) this.tick();
    }
    this.current.syncMs = this.spent;
    if (this.cool() || !this.fits(this.spent, this.limits.settleBudgetMs)) this.finish();
    else {
      this.report('running');
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.frame || this.phase === 'idle' || this.paused || this.destroyed) return;
    const ticket: { handle?: unknown } = {};
    this.frame = ticket;
    ticket.handle = this.options.frames.request(() => {
      if (this.frame === ticket) this.step();
    });
  }

  private cancelFrame(): void {
    if (!this.frame) return;
    this.options.frames.cancel(this.frame.handle);
    this.frame = undefined;
  }

  private step(): void {
    this.frame = undefined;
    if (this.paused || this.destroyed || this.phase === 'idle') return;
    // Forces changed since the last frame reach d3 here: one update a frame, however many changes.
    this.apply();
    const begun = this.read();
    if (this.phase === 'animate') {
      this.tick();
      for (let ticks = 1; !this.cool() && ticks < FORCE.maxTicksPerFrame && this.fits(this.mark - begun, FORCE.frameTickBudgetMs); ticks++) this.tick();
      this.options.write(this.nodes);
      if (this.cool()) this.done(this.alpha());
      else this.schedule();
      return;
    }
    // A slice is at least one whole step.
    this.tick();
    while (!this.cool() && this.fits(this.mark - begun, this.limits.sliceMs) && this.fits(this.spent, this.limits.settleBudgetMs)) this.tick();
    if (this.cool() || !this.fits(this.spent, this.limits.settleBudgetMs)) this.finish();
    else this.schedule();
  }
}
