/**
 * The Graph tab's force layout without a canvas (key decision 17): seeding, how
 * hard a change reheats, the limits, and `LiveForce`'s frame loop, driven by a
 * fake frame scheduler whose clock the test controls.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FORCE_PARAMS,
  FORCE,
  FORCE_CONTROLS,
  LiveForce,
  forcePositions,
  resolveLimits,
  seedPositions,
  toForceParams,
  topologyChange,
  topologyOf,
  type ForceGraphEdge,
  type ForceGraphNode,
  type ForceLimits,
  type ForceParams,
  type FrameScheduler,
  type LayoutState,
  type LiveGraph,
  type Point,
} from '../graph-force.js';

/** The drawn boxes' collision radius, as the view gives it, and the seed distance, twice that. */
const RADIUS = Math.hypot(120, 46) / 2 + 2;
const D = 2 * RADIUS;

/** Frames queued and run by the test; a clock that advances `advance` ms on every read, or when told. */
function fakeFrames(advance = 0) {
  let clock = 0;
  let next = 1;
  const queue: Array<{ id: number; step: () => void }> = [];
  const frames: FrameScheduler = {
    request(step) {
      const id = next++;
      queue.push({ id, step });
      return id;
    },
    cancel(handle) {
      const i = queue.findIndex((q) => q.id === handle);
      if (i >= 0) queue.splice(i, 1);
    },
    now() {
      clock += advance;
      return clock;
    },
  };
  return {
    frames,
    get queued() {
      return queue.length;
    },
    /** Run up to `n` frames; each runs what was queued when it began. Returns how many ran. */
    flush(n = 1) {
      let ran = 0;
      for (; ran < n && queue.length > 0; ran++) for (const q of queue.splice(0, queue.length)) q.step();
      return ran;
    },
    /** Frames until nothing is queued (at most `max`). */
    rest(max = 5000) {
      return this.flush(max);
    },
    tick(ms: number) {
      clock += ms;
    },
    set advance(ms: number) {
      advance = ms;
    },
  };
}

function live(options: { advance?: number; limits?: Partial<ForceLimits>; reduced?: boolean } = {}) {
  const f = fakeFrames(options.advance ?? 0);
  const writes: Array<Map<string, Point>> = [];
  const states: LayoutState[] = [];
  let reduced = options.reduced ?? false;
  const force = new LiveForce({
    frames: f.frames,
    radius: RADIUS,
    reducedMotion: () => reduced,
    write: (nodes) => writes.push(new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]))),
    state: (s) => states.push(s),
    ...(options.limits ? { limits: options.limits } : {}),
  });
  return {
    force,
    f,
    writes,
    states,
    set reduced(value: boolean) {
      reduced = value;
    },
  };
}

const nodesOf = (...ids: string[]): ForceGraphNode[] => ids.map((id) => ({ id }));
const line = (source: string, target: string): ForceGraphEdge => ({ id: `${source}-${target}`, source, target });
/** A path through the ids, in order. */
const path = (...ids: string[]) => ({ nodes: nodesOf(...ids), edges: ids.slice(1).map((id, i) => line(ids[i]!, id)) });
/** A tree: each node's children are the next ones, `fan` each, breadth first. */
function tree(count: number, fan = 3) {
  const ids = Array.from({ length: count }, (_, i) => `n${i}`);
  return { nodes: nodesOf(...ids), edges: ids.slice(1).map((id, i) => line(ids[Math.floor(i / fan)]!, id)) };
}

function graph(g: { nodes: ForceGraphNode[]; edges: ForceGraphEdge[] }, rootId: string, extra: Partial<LiveGraph> = {}): LiveGraph {
  return { nodes: g.nodes, edges: g.edges, rootId, at: new Map(), centre: { x: 0, y: 0 }, aspect: 1, reheat: 1, kept: new Set(), ...extra };
}

/** The next graph as the view gives it: drawn where the layout left them, reheat and kept from topologyChange. */
function next(before: LiveGraph, g: { nodes: ForceGraphNode[]; edges: ForceGraphEdge[] }, rootId: string, at: ReadonlyMap<string, Point>, extra: Partial<LiveGraph> = {}): LiveGraph {
  const change = topologyChange(topologyOf(before.nodes, before.edges, before.rootId), topologyOf(g.nodes, g.edges, rootId));
  return { ...before, nodes: g.nodes, edges: g.edges, rootId, at, reheat: change.reheat, kept: change.kept, restart: false, ...extra };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
/** The angle of b seen from a, in degrees. */
const angle = (a: Point, b: Point) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
const finitePositions = (at: ReadonlyMap<string, Point>) => [...at.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
const largestMove = (before: ReadonlyMap<string, Point>, after: ReadonlyMap<string, Point>, ids: string[]) =>
  Math.max(...ids.map((id) => distance(before.get(id)!, after.get(id)!)));
/** The mean length of the lines, between their ends' positions. */
const meanLine = (at: ReadonlyMap<string, Point>, edges: readonly ForceGraphEdge[]) =>
  edges.reduce((sum, e) => sum + distance(at.get(e.source)!, at.get(e.target)!), 0) / edges.length;

describe('seedPositions', () => {
  it('keeps drawn nodes where they are', () => {
    const g = path('r', 'a', 'b');
    const at = new Map([
      ['r', { x: 5, y: 7 }],
      ['a', { x: 300, y: -40 }],
      ['b', { x: -20, y: 90 }],
    ]);
    const start = seedPositions(g.nodes, g.edges, 'r', at, { x: 0, y: 0 }, D);
    expect(Object.fromEntries(start)).toEqual(Object.fromEntries(at));
  });

  it('starts a new node one distance from the node it was reached from, outward', () => {
    const g = path('r', 'b', 'c');
    const at = new Map([
      ['r', { x: 0, y: 0 }],
      ['b', { x: 150, y: 40 }],
    ]);
    const start = seedPositions(g.nodes, g.edges, 'r', at, { x: 0, y: 0 }, D);
    const [r, b, c] = ['r', 'b', 'c'].map((id) => start.get(id)!);
    expect(distance(b!, c!)).toBeCloseTo(D, 9);
    expect((c!.x - b!.x) * (b!.x - r!.x) + (c!.y - b!.y) * (b!.y - r!.y)).toBeGreaterThan(0);
  });

  it('fans three new children at −30°, 0° and +30° of outward, and nine over the half circle, 22.5° apart', () => {
    const at = new Map([
      ['r', { x: 0, y: 0 }],
      ['b', { x: 150, y: 0 }],
    ]);
    for (const [k, expected] of [
      [3, [-30, 0, 30]],
      [9, [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90]],
    ] as const) {
      const children = Array.from({ length: k }, (_, i) => `c${i}`);
      const start = seedPositions(nodesOf('r', 'b', ...children), [line('r', 'b'), ...children.map((c) => line('b', c))], 'r', at, { x: 0, y: 0 }, D);
      const b = start.get('b')!;
      children.forEach((c, i) => {
        expect(distance(b, start.get(c)!)).toBeCloseTo(D, 9);
        expect(angle(b, start.get(c)!)).toBeCloseTo(expected[i]!, 9);
      });
    }
  });

  it('spreads the middle element’s new neighbours all round: four at 0°, 90°, 180° and 270°', () => {
    const at = new Map([['r', { x: 10, y: 20 }]]);
    const start = seedPositions(nodesOf('r', 'a', 'b', 'c', 'd'), ['a', 'b', 'c', 'd'].map((id) => line('r', id)), 'r', at, { x: 0, y: 0 }, D);
    const r = start.get('r')!;
    expect(['a', 'b', 'c', 'd'].map((id) => Math.round(angle(r, start.get(id)!)))).toEqual([0, 90, 180, -90]);
    for (const id of ['a', 'b', 'c', 'd']) expect(distance(r, start.get(id)!)).toBeCloseTo(D, 9);
  });

  it('turns a fan clear of what is drawn: the first of +30°, −30°, +60°, … that clears every drawn node but the parent', () => {
    // A chain middle → b → c in a line; the new child x of b, straight out, would land on c.
    const at = new Map([
      ['r', { x: 0, y: 0 }],
      ['b', { x: 150, y: 0 }],
      ['c', { x: 150 + 1.1 * D, y: 0 }],
    ]);
    const g = { nodes: nodesOf('r', 'b', 'c', 'x'), edges: [line('r', 'b'), line('b', 'c'), line('b', 'x')] };
    const start = seedPositions(g.nodes, g.edges, 'r', at, { x: 0, y: 0 }, D);
    const b = at.get('b')!;
    const x = start.get('x')!;
    expect(distance(b, x)).toBeCloseTo(D, 9);
    const clears = (deg: number) => {
      const p = { x: b.x + D * Math.cos((deg * Math.PI) / 180), y: b.y + D * Math.sin((deg * Math.PI) / 180) };
      return distance(p, at.get('r')!) >= D && distance(p, at.get('c')!) >= D;
    };
    const first = [30, -30, 60, -60, 90, -90].find(clears)!;
    expect(clears(0)).toBe(false);
    expect(first).toBe(60);
    expect(angle(b, x)).toBeCloseTo(first, 9);
  });

  it('takes the turn with the most room when none clears, the first such in order', () => {
    // b far from the middle, so outward is 0°; a drawn node just beyond each of the twelve turns' points,
    // farther beyond the −60° one.
    const b = { x: 1000, y: 0 };
    const turns = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
    const at = new Map<string, Point>([
      ['r', { x: 0, y: 0 }],
      ['b', b],
    ]);
    turns.forEach((deg, i) => {
      const reach = D * (deg === -60 ? 1.5 : 1.2);
      at.set(`w${i}`, { x: b.x + reach * Math.cos((deg * Math.PI) / 180), y: b.y + reach * Math.sin((deg * Math.PI) / 180) });
    });
    const walls = turns.map((_, i) => `w${i}`);
    const start = seedPositions(nodesOf('r', 'b', 'x', ...walls), [line('r', 'b'), line('b', 'x')], 'r', at, { x: 0, y: 0 }, D);
    expect(angle(b, start.get('x')!)).toBeCloseTo(-60, 9);
    for (const w of walls) expect(start.get(w)).toEqual(at.get(w));
  });

  it('starts a new middle element one distance from its drawn neighbour, and clear of every other drawn node', () => {
    const at = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: -155, y: 0 }],
      ['c', { x: 155, y: 0 }],
    ]);
    const g = { nodes: nodesOf('x', 'a', 'b', 'c'), edges: [line('x', 'a'), line('a', 'b'), line('a', 'c')] };
    const start = seedPositions(g.nodes, g.edges, 'x', at, { x: 0, y: 0 }, D);
    const x = start.get('x')!;
    expect(distance(x, at.get('a')!)).toBeCloseTo(D, 9);
    expect(distance(x, at.get('b')!)).toBeGreaterThanOrEqual(D);
    expect(distance(x, at.get('c')!)).toBeGreaterThanOrEqual(D);
  });

  it('starts a new middle element linked to nothing drawn clear of every drawn node when one is at the centre', () => {
    const at = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 50 }],
    ]);
    const g = { nodes: nodesOf('x', 'y', 'a', 'b'), edges: [line('x', 'y'), line('a', 'b')] };
    const start = seedPositions(g.nodes, g.edges, 'x', at, { x: 0, y: 0 }, D);
    for (const id of ['a', 'b']) expect(distance(start.get('x')!, at.get(id)!)).toBeGreaterThanOrEqual(D);
  });

  it('starts a new middle element at the centre when nothing is drawn', () => {
    const g = path('x', 'y');
    expect(seedPositions(g.nodes, g.edges, 'x', new Map(), { x: 40, y: -12 }, D).get('x')).toEqual({ x: 40, y: -12 });
  });

  it('gives unreached nodes positions of their own', () => {
    const start = seedPositions(nodesOf('r', 'a', 'u1', 'u2', 'u3'), [line('r', 'a'), line('u2', 'u3')], 'r', new Map(), { x: 0, y: 0 }, D);
    const keys = [...start.values()].map((p) => `${p.x.toFixed(6)} ${p.y.toFixed(6)}`);
    expect(start.size).toBe(5);
    expect(new Set(keys).size).toBe(5);
  });

  it('ignores self-loops and lines to unknown nodes', () => {
    const g = { nodes: nodesOf('r', 'a'), edges: [line('r', 'r'), line('r', 'ghost'), line('ghost', 'a'), line('r', 'a')] };
    const start = seedPositions(g.nodes, g.edges, 'r', new Map(), { x: 0, y: 0 }, D);
    expect([...start.keys()].sort()).toEqual(['a', 'r']);
    expect(finitePositions(start)).toBe(true);
    expect(distance(start.get('r')!, start.get('a')!)).toBeCloseTo(D, 9);
  });

  it('gives the same output for the same input, and changes none of it', () => {
    const g = tree(30, 4);
    const at = new Map([
      ['n0', { x: 1, y: 2 }],
      ['n3', { x: 200, y: 10 }],
    ]);
    const copy = structuredClone({ g, at });
    const one = seedPositions(g.nodes, g.edges, 'n0', at, { x: 0, y: 0 }, D);
    const two = seedPositions(g.nodes, g.edges, 'n0', at, { x: 0, y: 0 }, D);
    expect(Object.fromEntries(two)).toEqual(Object.fromEntries(one));
    expect({ g, at }).toEqual(copy);
  });
});

describe('resolveLimits', () => {
  it('gives FORCE’s limits when given nothing, and keeps them in order', () => {
    expect(resolveLimits()).toEqual({
      animateMaxNodes: FORCE.animateMaxNodes,
      liveDragMaxNodes: FORCE.liveDragMaxNodes,
      forceMaxNodes: FORCE.forceMaxNodes,
      syncSettleMs: FORCE.syncSettleMs,
      sliceMs: FORCE.sliceMs,
      settleBudgetMs: FORCE.settleBudgetMs,
    });
    expect(resolveLimits({ animateMaxNodes: 10, liveDragMaxNodes: 5 }).liveDragMaxNodes).toBe(10);
    expect(resolveLimits({ forceMaxNodes: 4 })).toMatchObject({ animateMaxNodes: 4, liveDragMaxNodes: 4, forceMaxNodes: 4 });
  });
});

describe('toForceParams', () => {
  const defaults: ForceParams = { linkDistance: FORCE.linkDistance, chargeStrength: FORCE.chargeStrength, collideScale: 1 };

  it('gives every default for anything but an object', () => {
    for (const value of [undefined, null, 'x', 42, true, []]) expect(toForceParams(value), JSON.stringify(value)).toEqual(defaults);
    expect(toForceParams({})).toEqual(defaults);
  });

  it('clamps each field to its range: link distance 40–400, charge −1 500–0, collision 0.5–2', () => {
    expect(toForceParams({ linkDistance: 9999, chargeStrength: 50, collideScale: 0.01 })).toEqual({ linkDistance: 400, chargeStrength: 0, collideScale: 0.5 });
    expect(toForceParams({ linkDistance: -5, chargeStrength: -99999, collideScale: 7 })).toEqual({ linkDistance: 40, chargeStrength: -1500, collideScale: 2 });
  });

  it('snaps each field to its step from the minimum, rounded to two decimals', () => {
    expect(toForceParams({ linkDistance: 183, chargeStrength: -372, collideScale: 1.26 })).toEqual({ linkDistance: 180, chargeStrength: -350, collideScale: 1.3 });
    // 0.5 + 8 × 0.1 is 1.3000000000000003 in floating point; every step of the collision radius has one decimal.
    for (let k = 0; k <= 15; k++) expect(String(toForceParams({ collideScale: 0.5 + k * 0.1 }).collideScale)).toMatch(/^\d(\.\d)?$/);
  });

  it('takes a field that is not a finite number as its default, and keeps the others', () => {
    for (const bad of [NaN, Infinity, -Infinity, '200', null, undefined, {}]) {
      const label = String(bad);
      expect(toForceParams({ linkDistance: bad, chargeStrength: -500, collideScale: 1.5 }), label).toEqual({ ...defaults, chargeStrength: -500, collideScale: 1.5 });
      expect(toForceParams({ linkDistance: 220, chargeStrength: bad, collideScale: 1.5 }), label).toEqual({ ...defaults, linkDistance: 220, collideScale: 1.5 });
      expect(toForceParams({ linkDistance: 220, chargeStrength: -500, collideScale: bad }), label).toEqual({ ...defaults, linkDistance: 220, chargeStrength: -500 });
    }
  });

  it('never gives −0: a charge of −0 or −10 is 0', () => {
    expect(Object.is(toForceParams({ chargeStrength: -0 }).chargeStrength, 0)).toBe(true);
    expect(Object.is(toForceParams({ chargeStrength: -10 }).chargeStrength, 0)).toBe(true);
  });

  it('gives a new object, and changes none of its input', () => {
    const input = { linkDistance: 183, chargeStrength: -372, collideScale: 1.26 };
    const copy = { ...input };
    expect(toForceParams(input)).not.toBe(input);
    expect(toForceParams(DEFAULT_FORCE_PARAMS)).not.toBe(DEFAULT_FORCE_PARAMS);
    expect(input).toEqual(copy);
    expect(Object.isFrozen(DEFAULT_FORCE_PARAMS)).toBe(true);
  });
});

describe('FORCE', () => {
  it('keeps every node limit within the bench sweep’s largest size, 3 000 (no measuring run’s 5 000 ships)', () => {
    for (const limit of [FORCE.animateMaxNodes, FORCE.liveDragMaxNodes, FORCE.forceMaxNodes]) expect(limit).toBeLessThanOrEqual(3000);
    expect(FORCE.animateMaxNodes).toBeLessThanOrEqual(FORCE.liveDragMaxNodes);
    expect(FORCE.liveDragMaxNodes).toBeLessThanOrEqual(FORCE.forceMaxNodes);
  });

  it('gives forces whose defaults are FORCE’s, each within its slider’s range and on its step', () => {
    expect(DEFAULT_FORCE_PARAMS).toEqual({ linkDistance: FORCE.linkDistance, chargeStrength: FORCE.chargeStrength, collideScale: 1 });
    for (const key of ['linkDistance', 'chargeStrength', 'collideScale'] as const) {
      const { min, max, step } = FORCE_CONTROLS[key];
      const value = DEFAULT_FORCE_PARAMS[key];
      expect(value, key).toBeGreaterThanOrEqual(min);
      expect(value, key).toBeLessThanOrEqual(max);
      const k = (value - min) / step;
      expect(Math.abs(k - Math.round(k)), key).toBeLessThan(1e-9);
      expect(toForceParams({ [key]: value })[key], key).toBe(value);
    }
  });
});

describe('topologyChange', () => {
  const top = (nodes: string[], edges: Array<[string, string, string]>, root = nodes[0] ?? '') =>
    topologyOf(nodesOf(...nodes), edges.map(([id, source, target]) => ({ id, source, target })), root);
  const ten = Array.from({ length: 10 }, (_, i) => `n${i}`);
  const nine = ten.slice(1).map((id, i): [string, string, string] => [`e${i}`, ten[i]!, id]);

  it('takes its rules in order', () => {
    expect(topologyChange(top(ten, nine), top([], [])).reheat).toBe(0);
    expect(topologyChange(top([], []), top([], [])).reheat).toBe(0);
    expect(topologyChange(undefined, top(ten, nine)).reheat).toBe(1);
    expect(topologyChange(top([], []), top(ten, nine)).reheat).toBe(1);
    expect(topologyChange(top(ten, nine), top(ten, nine)).reheat).toBe(0);
    expect(topologyChange(top(ten, nine), top(ten, nine, 'n4')).reheat).toBe(0.3);
  });

  it('reheats by the share changed, from 0.3 to 1', () => {
    // One node and its line added to ten and nine: 2 ÷ 19, so the least.
    expect(topologyChange(top(ten, nine), top([...ten, 'x'], [...nine, ['ex', 'n3', 'x']])).reheat).toBe(0.3);
    const twenty = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const nineteen = twenty.slice(1).map((id, i): [string, string, string] => [`e${i}`, twenty[i]!, id]);
    expect(topologyChange(top(ten, nine), top(twenty, nineteen)).reheat).toBe(1);
    expect(topologyChange(top(twenty, nineteen), top(ten, nine)).reheat).toBe(1);
  });

  it('counts a line reconnected, and keeps the nodes in both', () => {
    const moved = nine.map((e, i): [string, string, string] => (i === 4 ? [e[0], 'n0', e[2]] : e));
    expect(topologyChange(top(ten, nine), top(ten, moved)).reheat).toBeGreaterThanOrEqual(0.3);
    const change = topologyChange(top(['a', 'b', 'c'], []), top(['b', 'c', 'd'], []));
    expect([...change.kept].sort()).toEqual(['b', 'c']);
  });
});

/** A chain of three round its middle element, at rest: aspect 3.6, three steps a frame. */
function chainAtRest() {
  const l = live({ advance: 1 });
  const first = graph(path('r', 'b', 'c'), 'r', { aspect: 3.6 });
  l.force.setGraph(first);
  l.force.run();
  l.f.rest();
  return { ...l, first };
}

describe('LiveForce, animated', () => {
  it('reports running once and writes every frame; comes to rest within 400 frames, reports settled once and queues nothing', () => {
    const l = live({ advance: 1 });
    const start = l.force.setGraph(graph(tree(12), 'n0'));
    l.force.run();
    expect(l.states).toEqual(['running']);
    let frames = 0;
    const root: Point[] = [];
    while (l.f.queued > 0 && frames < 1000) {
      l.f.flush(1);
      frames++;
      expect(l.writes).toHaveLength(frames);
      root.push(l.writes.at(-1)!.get('n0')!);
      expect(finitePositions(l.writes.at(-1)!)).toBe(true);
    }
    expect(frames).toBeLessThanOrEqual(400);
    expect(l.states).toEqual(['running', 'settled']);
    expect(l.f.queued).toBe(0);
    expect(l.force.state).toBe('settled');
    // The middle element exactly where it started throughout.
    for (const p of root) expect(p).toEqual(start.get('n0'));
  });

  it('runs a second step only while the frame budget holds: two steps a frame at 2 ms a step', () => {
    const l = live({ advance: 2 });
    l.force.setGraph(graph(tree(8), 'n0'));
    l.force.run();
    l.f.flush(1);
    expect(l.force.stats()!.steps).toBe(2);
    l.f.flush(1);
    expect(l.force.stats()!.steps).toBe(4);
  });

  it('gives the run’s figures at rest', () => {
    const l = live({ advance: 1 });
    l.force.setGraph(graph(tree(8), 'n0'));
    l.force.run();
    l.f.rest();
    const stats = l.force.stats()!;
    expect(stats).toMatchObject({ mode: 'animate', nodes: 8, syncMs: 0 });
    expect(stats.steps).toBeGreaterThanOrEqual(300);
    expect(stats.alpha).toBeLessThan(FORCE.alphaMin);
    expect(stats.endedAt).toBeGreaterThan(stats.startedAt);
    expect(stats.computeMs).toBe(stats.steps);
  });
});

describe('LiveForce, the objects d3 gets', () => {
  it('gives d3 objects of its own at every rebuild: the second layout is a fresh one’s, and the given lines are unchanged', () => {
    const g = tree(9, 2);
    const copy = structuredClone(g);
    const one = live({ advance: 1 });
    const first = graph(g, 'n0', { aspect: 2 });
    one.force.setGraph(first);
    one.force.run();
    one.f.flush(50);
    const at = one.force.positions();
    one.force.setGraph({ ...first, at, reheat: 1, restart: true });
    one.force.run();
    one.f.flush(30);
    expect(g).toEqual(copy);
    for (const e of g.edges) expect(Object.keys(e).sort()).toEqual(['id', 'source', 'target']);
    for (const n of g.nodes) expect(Object.keys(n)).toEqual(['id']);

    const two = live({ advance: 1 });
    two.force.setGraph({ ...first, at, reheat: 1, restart: true });
    two.force.run();
    two.f.flush(30);
    const mine = one.force.positions();
    for (const [id, p] of two.force.positions()) {
      expect(mine.get(id)!.x).toBeCloseTo(p.x, 9);
      expect(mine.get(id)!.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe('LiveForce, seeding without a jump', () => {
  for (const [where, parent] of [
    ['beside the middle element', 'r'],
    ['beside the middle of the chain', 'b'],
    ['at the end of the chain', 'c'],
  ] as const) {
    it(`moves no drawn element more than 15 px in the first frame when one is added ${where}`, () => {
      const l = chainAtRest();
      const before = l.force.positions();
      const g = { nodes: nodesOf('r', 'b', 'c', 'd'), edges: [...l.first.edges, line(parent, 'd')] };
      const change = next(l.first, g, 'r', before);
      expect(change.reheat).toBeGreaterThan(0);
      l.force.setGraph(change);
      l.force.run();
      l.f.flush(1);
      expect(largestMove(before, l.force.positions(), ['r', 'b', 'c'])).toBeLessThanOrEqual(15);
    });
  }
});

describe('LiveForce, a new middle element', () => {
  /** B–A–C at rest round A, the view's centre on A; then X, linked to A, in the middle. */
  function recentred(reduced: boolean) {
    const l = live({ advance: 1 });
    const first = graph({ nodes: nodesOf('A', 'B', 'C'), edges: [line('A', 'B'), line('A', 'C')] }, 'A', { aspect: 3.6 });
    l.force.setGraph(first);
    l.force.run();
    l.f.rest();
    const before = l.force.positions();
    l.reduced = reduced;
    const g = { nodes: nodesOf('X', 'A', 'B', 'C'), edges: [line('X', 'A'), ...first.edges] };
    const start = l.force.setGraph(next(first, g, 'X', before, { centre: before.get('A')! }));
    l.force.run();
    return { ...l, before, start };
  }

  it('moves no drawn element more than 15 px in the first frame', () => {
    const l = recentred(false);
    l.f.flush(1);
    expect(largestMove(l.before, l.force.positions(), ['A', 'B', 'C'])).toBeLessThanOrEqual(15);
  });

  it('laid out at once, with the drawn elements held, overlaps no drawn box at rest', () => {
    const l = recentred(true);
    l.f.rest();
    const at = l.force.positions();
    for (const id of ['A', 'B', 'C']) {
      expect(at.get(id)).toEqual(l.before.get(id));
      const apart = Math.abs(at.get('X')!.x - at.get(id)!.x) >= 120 || Math.abs(at.get('X')!.y - at.get(id)!.y) >= 46;
      expect(apart, `X overlaps ${id}`).toBe(true);
    }
  });
});

describe('LiveForce, run()', () => {
  it('queues no second frame and reports nothing for a second run() while running; nothing at rest', () => {
    const l = live();
    l.force.setGraph(graph(tree(6), 'n0'));
    l.force.run();
    l.force.run();
    expect(l.f.queued).toBe(1);
    expect(l.states).toEqual(['running']);
    l.f.rest();
    l.force.run();
    expect(l.f.queued).toBe(0);
    expect(l.states).toEqual(['running', 'settled']);
  });
});

describe('LiveForce, paused, ended and destroyed', () => {
  it('pause() empties the queue, and a drop while paused queues nothing; run() resumes and comes to rest', () => {
    const l = live();
    l.force.setGraph(graph(tree(6), 'n0'));
    l.force.run();
    l.f.flush(5);
    l.force.dragStart('n3');
    l.force.dragMove('n3', { x: 400, y: 0 });
    l.force.pause();
    expect(l.f.queued).toBe(0);
    l.force.dragEnd('n3', { x: 400, y: 0 });
    expect(l.f.queued).toBe(0);
    expect(l.force.state).toBe('running');
    l.force.run();
    expect(l.f.queued).toBe(1);
    l.f.rest();
    expect(l.states).toEqual(['running', 'settled']);
    expect(l.f.queued).toBe(0);
  });

  it('end() during an animated run reports settled once, leaves the queue empty and the positions as they were; a restart runs again', () => {
    const l = live();
    const first = graph(tree(6), 'n0');
    l.force.setGraph(first);
    l.force.run();
    l.f.flush(10);
    const before = l.force.positions();
    l.force.end();
    expect(l.states).toEqual(['running', 'settled']);
    expect(l.f.queued).toBe(0);
    expect(Object.fromEntries(l.force.positions())).toEqual(Object.fromEntries(before));
    l.force.end();
    expect(l.states).toEqual(['running', 'settled']);
    l.force.setGraph({ ...first, at: before, reheat: 1, restart: true });
    l.force.run();
    expect(l.states).toEqual(['running', 'settled', 'running']);
    l.f.rest();
    expect(l.states).toEqual(['running', 'settled', 'running', 'settled']);
  });

  it('end() at rest, or before any graph, reports and queues nothing', () => {
    const fresh = live();
    fresh.force.end();
    expect(fresh.states).toEqual([]);
    const l = live();
    l.force.setGraph(graph(tree(6), 'n0'));
    l.force.run();
    l.f.rest();
    l.force.end();
    expect(l.states).toEqual(['running', 'settled']);
    expect(l.f.queued).toBe(0);
  });

  it('a rebuild during a run reports nothing, and the next run’s end reports settled once', () => {
    const l = live();
    const first = graph(tree(6), 'n0');
    l.force.setGraph(first);
    l.force.run();
    l.f.flush(5);
    const g = tree(8);
    l.force.setGraph(next(first, g, 'n0', l.force.positions()));
    expect(l.states).toEqual(['running']);
    expect(l.f.queued).toBe(0);
    l.force.run();
    l.f.rest();
    expect(l.states).toEqual(['running', 'settled']);
  });

  it('after destroy() the queue is empty and nothing is written or reported', () => {
    const l = live();
    const first = graph(tree(6), 'n0');
    l.force.setGraph(first);
    l.force.run();
    l.f.flush(3);
    const writes = l.writes.length;
    l.force.destroy();
    expect(l.f.queued).toBe(0);
    l.force.run();
    l.force.dragStart('n2');
    l.force.end();
    l.force.setGraph(next(first, tree(9), 'n0', l.force.positions()));
    l.force.run();
    l.f.rest();
    expect(l.f.queued).toBe(0);
    expect(l.writes).toHaveLength(writes);
    expect(l.states).toEqual(['running']);
  });
});

describe('LiveForce, laid out at once', () => {
  it('under reduced motion lays a small graph out inside run(): one write before it returns, settled, nothing queued', () => {
    const l = live({ advance: 0.1, reduced: true });
    l.force.setGraph(graph(tree(10), 'n0'));
    l.force.run();
    expect(l.writes).toHaveLength(1);
    expect(l.states).toEqual(['settled']);
    expect(l.f.queued).toBe(0);
    const stats = l.force.stats()!;
    expect(stats.mode).toBe('settle');
    expect(stats.syncMs).toBe(stats.computeMs);
    expect(stats.alpha).toBeLessThan(FORCE.alphaMin);
  });

  it('runs one step inside run() at 5 ms a step, since the whole does not fit 100 ms, then two steps a slice', () => {
    const l = live({ advance: 5, reduced: true });
    l.force.setGraph(graph(tree(10), 'n0'));
    l.force.run();
    expect(l.force.stats()).toMatchObject({ steps: 1, syncMs: 5 });
    expect(l.states).toEqual(['running']);
    expect(l.writes).toHaveLength(0);
    l.f.flush(1);
    expect(l.force.stats()!.steps).toBe(3);
    l.f.flush(1);
    expect(l.force.stats()!.steps).toBe(5);
    expect(l.writes).toHaveLength(0);
  });

  it('runs one whole step a slice at 20 ms a step, and stops at the budget, cut short, with no step past it', () => {
    const l = live({ advance: 20, reduced: true });
    l.force.setGraph(graph(tree(10), 'n0'));
    l.force.run();
    let frames = 0;
    while (l.f.queued > 0) {
      const steps = l.force.stats()!.steps;
      l.f.flush(1);
      frames++;
      if (l.f.queued > 0) expect(l.force.stats()!.steps).toBe(steps + 1);
    }
    const stats = l.force.stats()!;
    expect(stats.computeMs).toBeLessThanOrEqual(FORCE.settleBudgetMs);
    expect(stats.computeMs + 20).toBeGreaterThan(FORCE.settleBudgetMs);
    expect(stats.steps).toBe(frames + 1);
    expect(stats.alpha).toBeGreaterThan(FORCE.alphaMin);
    expect(l.writes).toHaveLength(1);
    expect(l.states).toEqual(['running', 'settled']);
  });

  it('above the limits runs nothing inside run() and writes once, at the end, within the budget', () => {
    const l = live({ advance: 3, limits: { animateMaxNodes: 5, syncSettleMs: 0 } });
    l.force.setGraph(graph(tree(8), 'n0'));
    l.force.run();
    expect(l.force.stats()).toMatchObject({ mode: 'settle', steps: 0 });
    expect(l.states).toEqual(['running']);
    l.f.flush(2);
    // A refresh that changes nothing, during the slices: they go on.
    const steps = l.force.stats()!.steps;
    l.force.setGraph(graph(tree(8), 'n0', { reheat: 0, at: l.force.positions() }));
    l.force.run();
    expect(l.f.queued).toBe(1);
    expect(l.force.stats()!.steps).toBe(steps);
    expect(l.writes).toHaveLength(0);
    l.f.rest();
    expect(l.writes).toHaveLength(1);
    expect(l.states).toEqual(['running', 'settled']);
    const stats = l.force.stats()!;
    expect(stats.endedAt! - stats.startedAt).toBeLessThanOrEqual(FORCE.settleBudgetMs);
  });

  it('holds the kept nodes where they were when half or more are kept, and releases them after', () => {
    const l = live({ advance: 0.1, reduced: true });
    const first = graph(path('r', 'a', 'b', 'c'), 'r', { aspect: 2 });
    l.force.setGraph(first);
    l.force.run();
    const before = l.force.positions();
    l.force.setGraph(next(first, path('r', 'a', 'b', 'c', 'd'), 'r', before));
    l.force.run();
    const after = l.force.positions();
    for (const id of ['r', 'a', 'b', 'c']) expect(after.get(id)).toEqual(before.get(id));
    expect(distance(after.get('c')!, after.get('d')!)).toBeGreaterThan(0);
    // Released: a live drag of d pulls c, and c pulls b.
    l.reduced = false;
    l.force.dragStart('d');
    l.force.dragMove('d', { x: after.get('d')!.x + 400, y: after.get('d')!.y + 300 });
    l.f.flush(40);
    expect(distance(l.force.positions().get('b')!, after.get('b')!)).toBeGreaterThan(5);
  });
});

describe('LiveForce, other cases', () => {
  it('does nothing for the same graph again: no rebuild, no frame, no write', () => {
    const l = live();
    const first = graph(tree(6), 'n0');
    l.force.setGraph(first);
    l.force.run();
    l.f.rest();
    const writes = l.writes.length;
    const at = l.force.positions();
    expect(Object.fromEntries(l.force.setGraph(next(first, tree(6), 'n0', at)))).toEqual(Object.fromEntries(at));
    l.force.run();
    expect(l.f.queued).toBe(0);
    expect(l.writes).toHaveLength(writes);
    expect(l.states).toEqual(['running', 'settled']);
  });

  it('gives the drawn positions of kept nodes before any step', () => {
    const l = live();
    const at = new Map([
      ['n0', { x: 3, y: 4 }],
      ['n1', { x: 160, y: -20 }],
      ['n2', { x: -150, y: 35 }],
    ]);
    l.force.setGraph(graph(tree(5), 'n0', { at }));
    for (const [id, p] of at) expect(l.force.positions().get(id)).toEqual(p);
  });

  it('drags live at rest within its limits: liveDragMaxNodes is raised to animateMaxNodes', () => {
    const l = live({ limits: { animateMaxNodes: 10, liveDragMaxNodes: 5 } });
    l.force.setGraph(graph(tree(8), 'n0'));
    l.force.run();
    l.f.rest();
    l.force.dragStart('n5');
    expect(l.states).toEqual(['running', 'settled', 'running']);
    expect(l.f.queued).toBe(1);
  });
});

describe('LiveForce, dragging', () => {
  function atRest(options: Parameters<typeof live>[0] = {}, g = path('r', 'a', 'b', 'c')) {
    const l = live({ advance: 1, ...options });
    const first = graph(g, 'r', { aspect: 2 });
    const start = l.force.setGraph(first);
    l.force.run();
    l.f.rest();
    return { ...l, first, start };
  }

  it('live at rest: running, the dragged node at the pointer and its neighbour pulled towards it', () => {
    const l = atRest();
    const before = l.force.positions();
    const pointer = { x: before.get('c')!.x + 300, y: before.get('c')!.y + 100 };
    l.force.dragStart('c');
    l.force.dragMove('c', pointer);
    expect(l.states.at(-1)).toBe('running');
    l.f.flush(10);
    const now = l.force.positions();
    expect(now.get('c')).toEqual(pointer);
    expect(distance(now.get('b')!, pointer)).toBeLessThan(distance(before.get('b')!, pointer));
  });

  it('released on drop: a node other than the middle moves off the drop point, and the loop comes to rest and stops', () => {
    const l = atRest();
    const before = l.force.positions();
    const drop = { x: before.get('c')!.x + 300, y: before.get('c')!.y + 200 };
    l.force.dragStart('c');
    l.force.dragMove('c', drop);
    l.f.flush(5);
    l.force.dragEnd('c', drop);
    l.f.rest();
    expect(l.f.queued).toBe(0);
    expect(l.force.state).toBe('settled');
    expect(distance(l.force.positions().get('c')!, drop)).toBeGreaterThan(10);
  });

  it('keeps the middle element exactly where it is dropped', () => {
    const l = atRest();
    const drop = { x: -230, y: 85 };
    l.force.dragStart('r');
    l.force.dragMove('r', { x: -100, y: 40 });
    l.f.flush(3);
    l.force.dragMove('r', drop);
    l.force.dragEnd('r', drop);
    l.f.rest();
    expect(l.force.positions().get('r')).toEqual(drop);
  });

  it('moves the node alone under reduced motion at rest, and above liveDragMaxNodes', () => {
    for (const l of [atRest({ reduced: true }), atRest({ limits: { animateMaxNodes: 2, liveDragMaxNodes: 2 } })]) {
      const states = l.states.length;
      l.force.dragStart('b');
      l.force.dragMove('b', { x: 999, y: 111 });
      l.force.dragEnd('b', { x: 999, y: 111 });
      expect(l.f.queued).toBe(0);
      expect(l.states).toHaveLength(states);
      expect(l.force.positions().get('b')).toEqual({ x: 999, y: 111 });
    }
  });

  it('held while the slices run: dropped between two slices, it is where it was dropped at the one write, and released after', () => {
    const l = live({ advance: 3, limits: { animateMaxNodes: 1, liveDragMaxNodes: 1, syncSettleMs: 0 } });
    const first = graph(path('r', 'a', 'b', 'c'), 'r', { aspect: 2 });
    l.force.setGraph(first);
    l.force.run();
    l.f.flush(1);
    const drop = { x: 600, y: -250 };
    l.force.dragStart('b');
    l.force.dragMove('b', { x: 300, y: -100 });
    l.force.dragMove('b', drop);
    l.force.dragEnd('b', drop);
    l.f.flush(1);
    expect(l.writes).toHaveLength(0);
    l.f.rest();
    expect(l.writes).toHaveLength(1);
    expect(l.writes[0]!.get('b')).toEqual(drop);
    expect(l.force.positions().get('b')).toEqual(drop);
    // A reheat moves it: it was released.
    l.force.setGraph({ ...first, at: l.force.positions(), reheat: 1, restart: true });
    l.force.run();
    l.f.rest();
    expect(distance(l.force.positions().get('b')!, drop)).toBeGreaterThan(1);
  });

  it('held, the middle element: at the drop point at the one write, and still there after a reheat', () => {
    const l = live({ advance: 3, limits: { animateMaxNodes: 1, liveDragMaxNodes: 1, syncSettleMs: 0 } });
    const first = graph(path('r', 'a', 'b', 'c'), 'r', { aspect: 2 });
    l.force.setGraph(first);
    l.force.run();
    l.f.flush(1);
    const drop = { x: -320, y: 140 };
    l.force.dragStart('r');
    l.force.dragMove('r', drop);
    l.f.flush(1);
    l.force.dragEnd('r', drop);
    l.f.rest();
    expect(l.writes).toHaveLength(1);
    expect(l.writes[0]!.get('r')).toEqual(drop);
    l.force.setGraph({ ...first, at: l.force.positions(), reheat: 1, restart: true });
    l.force.run();
    l.f.rest();
    expect(l.force.positions().get('r')).toEqual(drop);
  });

  it('comes to rest when the dragged node is removed mid-drag', () => {
    const l = atRest();
    l.force.dragStart('c');
    l.force.dragMove('c', { x: 500, y: 500 });
    l.f.flush(3);
    l.force.setGraph(next(l.first, path('r', 'a', 'b'), 'r', l.force.positions()));
    l.force.run();
    expect(l.f.rest()).toBeLessThan(1000);
    expect(l.f.queued).toBe(0);
    expect(l.force.state).toBe('settled');
  });

  it('keeps a node dragged live at the pointer across a rebuild, and the simulation warm until the drop', () => {
    const l = atRest();
    const pointer = { x: 420, y: -180 };
    l.force.dragStart('c');
    l.force.dragMove('c', pointer);
    l.f.flush(3);
    const g = { nodes: nodesOf('r', 'a', 'b', 'c', 'e'), edges: [...l.first.edges, line('r', 'e')] };
    l.force.setGraph(next(l.first, g, 'r', l.force.positions()));
    l.force.run();
    l.f.flush(600);
    expect(l.f.queued).toBe(1);
    expect(l.force.state).toBe('running');
    expect(l.force.positions().get('c')).toEqual(pointer);
    l.force.dragEnd('c', pointer);
    l.f.rest();
    expect(l.f.queued).toBe(0);
    expect(l.force.state).toBe('settled');
  });

  it('ends a live drag on a restart: the run cools to rest with no drop, and a later drop does nothing', () => {
    const l = atRest();
    l.force.dragStart('c');
    l.force.dragMove('c', { x: 400, y: 0 });
    l.f.flush(3);
    l.force.setGraph({ ...l.first, at: l.force.positions(), reheat: 1, restart: true });
    l.force.run();
    expect(l.f.rest()).toBeLessThan(1000);
    expect(l.force.state).toBe('settled');
    const states = l.states.length;
    l.force.dragEnd('c', { x: 0, y: 0 });
    expect(l.f.queued).toBe(0);
    expect(l.states).toHaveLength(states);
  });
});

describe('LiveForce, forces (Req 17.13)', () => {
  it('changes nothing at the defaults: setParams(DEFAULT_FORCE_PARAMS) returns false, and the run writes what a run without it writes', () => {
    const plain = live({ advance: 1 });
    const given = live({ advance: 1 });
    expect(given.force.setParams(DEFAULT_FORCE_PARAMS)).toBe(false);
    for (const l of [plain, given]) {
      l.force.setGraph(graph(tree(12), 'n0'));
      l.force.run();
      l.f.flush(20);
    }
    expect(given.force.setParams({ ...DEFAULT_FORCE_PARAMS })).toBe(false);
    for (const l of [plain, given]) l.f.rest();
    expect(given.writes.length).toBeGreaterThan(20);
    expect(given.writes).toEqual(plain.writes);
    expect(given.force.params()).toEqual(DEFAULT_FORCE_PARAMS);
  });

  it('at rest, a longer link distance runs again: longer lines at rest, the middle element where it was; the same again does nothing', () => {
    const l = live({ advance: 1 });
    const g = tree(12);
    const start = l.force.setGraph(graph(g, 'n0'));
    l.force.run();
    l.f.rest();
    const before = l.force.positions();
    const reported = l.states.length;
    expect(l.force.setParams({ linkDistance: 360 })).toBe(true);
    expect(l.force.params()).toEqual({ ...DEFAULT_FORCE_PARAMS, linkDistance: 360 });
    expect(l.f.queued).toBe(0);
    l.force.run();
    expect(l.states.slice(reported)).toEqual(['running']);
    expect(l.f.rest()).toBeLessThan(1000);
    expect(l.states.slice(reported)).toEqual(['running', 'settled']);
    const after = l.force.positions();
    expect(meanLine(after, g.edges)).toBeGreaterThan(meanLine(before, g.edges) + 60);
    expect(after.get('n0')).toEqual(start.get('n0'));
    expect(l.force.setParams({ linkDistance: 360 })).toBe(false);
    l.force.run();
    expect(l.f.queued).toBe(0);
    expect(l.states.slice(reported)).toEqual(['running', 'settled']);
  });

  it('applies the forces at the next frame, once however many changes came before it: three changes are the last one', () => {
    const [many, once, none] = [live({ advance: 1 }), live({ advance: 1 }), live({ advance: 1 })];
    const g = tree(12);
    for (const l of [many!, once!, none!]) {
      l.force.setGraph(graph(g, 'n0'));
      l.force.run();
      l.f.flush(20);
    }
    for (const linkDistance of [300, 120, 360]) {
      expect(many!.force.setParams({ linkDistance })).toBe(true);
      many!.force.run();
      expect(many!.f.queued).toBe(1);
    }
    once!.force.setParams({ linkDistance: 360 });
    once!.force.run();
    for (const l of [many!, once!, none!]) l.f.flush(1);
    expect(many!.writes.at(-1)).toEqual(once!.writes.at(-1));
    for (const l of [many!, once!, none!]) l.f.rest();
    expect(many!.writes.at(-1)).toEqual(once!.writes.at(-1));
    // Applied in the run, not only at the next start: its lines at rest are longer than with no change.
    expect(meanLine(many!.force.positions(), g.edges)).toBeGreaterThan(meanLine(none!.force.positions(), g.edges) + 60);
    expect(many!.states).toEqual(['running', 'settled']);
  });

  it('laid out at once, a change is laid out inside run() with nothing held: one write, settled, nothing queued, the drawn elements moved', () => {
    const l = live({ advance: 0.1, reduced: true });
    const first = graph(tree(11), 'n0');
    l.force.setGraph(first);
    l.force.run();
    // One element more: the eleven drawn are held while it is laid out.
    l.force.setGraph(next(first, tree(12), 'n0', l.force.positions()));
    l.force.run();
    const before = l.force.positions();
    const writes = l.writes.length;
    expect(l.force.animates()).toBe(false);
    expect(l.force.setParams({ collideScale: 2 })).toBe(true);
    l.force.run();
    expect(l.writes).toHaveLength(writes + 1);
    expect(l.states).toEqual(['settled', 'settled', 'settled']);
    expect(l.f.queued).toBe(0);
    const after = l.writes.at(-1)!;
    const moved = [...before.keys()].filter((id) => distance(before.get(id)!, after.get(id)!) > 1);
    expect(moved.length).toBeGreaterThanOrEqual(before.size - 2);
    expect(after.get('n0')).toEqual(before.get('n0'));
  });

  it('while a layout laid out at once runs in slices, a change starts it afresh with a fresh budget: one frame queued at most, settled once, at the end', () => {
    const l = live({ advance: 20, reduced: true, limits: { syncSettleMs: 0 } });
    l.force.setGraph(graph(tree(10), 'n0'));
    l.force.run();
    l.f.flush(1);
    expect(l.force.stats()!.steps).toBe(1);
    expect(l.force.setParams({ linkDistance: 300 })).toBe(true);
    expect(l.f.queued).toBe(0);
    l.force.run();
    expect(l.f.queued).toBe(1);
    expect(l.force.stats()!.steps).toBe(0);
    for (let frames = 0; l.f.queued > 0 && frames < 1000; frames++) {
      l.f.flush(1);
      expect(l.f.queued).toBeLessThanOrEqual(1);
    }
    expect(l.states).toEqual(['running', 'settled']);
    expect(l.writes).toHaveLength(1);
    // The whole budget, 75 steps of 20 ms, for the new run.
    expect(l.force.stats()).toMatchObject({ steps: 75, computeMs: FORCE.settleBudgetMs });
  });

  it('keeps an element dragged while the slices run held across a change: it is where it was dropped at the one write', () => {
    const l = live({ advance: 3, limits: { animateMaxNodes: 1, liveDragMaxNodes: 1, syncSettleMs: 0 } });
    l.force.setGraph(graph(path('r', 'a', 'b', 'c'), 'r', { aspect: 2 }));
    l.force.run();
    l.f.flush(1);
    l.force.dragStart('b');
    l.force.dragMove('b', { x: 300, y: -100 });
    expect(l.force.setParams({ chargeStrength: -800 })).toBe(true);
    l.force.run();
    l.f.flush(1);
    expect(l.force.positions().get('b')).toEqual({ x: 300, y: -100 });
    const drop = { x: 600, y: -250 };
    l.force.dragMove('b', drop);
    l.force.dragEnd('b', drop);
    l.f.rest();
    expect(l.writes).toHaveLength(1);
    expect(l.writes[0]!.get('b')).toEqual(drop);
  });

  it('keeps forces set before any graph for the first one: a new element starts one collision diameter, at the scale, from its parent', () => {
    const l = live();
    expect(l.force.setParams({ collideScale: 2 })).toBe(true);
    expect(l.f.queued).toBe(0);
    const start = l.force.setGraph(graph(path('r', 'a'), 'r'));
    expect(distance(start.get('r')!, start.get('a')!)).toBeCloseTo(2 * D, 9);
    const plain = live().force.setGraph(graph(path('r', 'a'), 'r'));
    expect(distance(plain.get('r')!, plain.get('a')!)).toBeCloseTo(D, 9);
  });

  it('animates() says how a run started now would run: animated for 5 elements, not under reduced motion, not above animateMaxNodes', () => {
    const l = live();
    l.force.setGraph(graph(tree(5), 'n0'));
    expect(l.force.animates()).toBe(true);
    l.reduced = true;
    expect(l.force.animates()).toBe(false);
    const big = live({ limits: { animateMaxNodes: 3 } });
    big.force.setGraph(graph(tree(5), 'n0'));
    expect(big.force.animates()).toBe(false);
  });

  it('brings the forces into range, and after destroy() takes none', () => {
    const l = live();
    expect(l.force.setParams({ linkDistance: 9999, collideScale: 1.26 })).toBe(true);
    expect(l.force.params()).toEqual({ ...DEFAULT_FORCE_PARAMS, linkDistance: 400, collideScale: 1.3 });
    l.force.setGraph(graph(tree(5), 'n0'));
    l.force.destroy();
    expect(l.force.setParams({ linkDistance: 300 })).toBe(false);
    expect(l.force.params().linkDistance).toBe(400);
  });
});

describe('forcePositions', () => {
  it('lays out headless round the middle element at (0, 0), the same each time, changing none of its input', () => {
    const g = tree(20, 3);
    const copy = structuredClone(g);
    const one = forcePositions(g.nodes, g.edges, { rootId: 'n0', width: 120, height: 55 });
    const two = forcePositions(g.nodes, g.edges, { rootId: 'n0', width: 120, height: 55 });
    expect(one.get('n0')).toEqual({ x: 0, y: 0 });
    expect(Object.fromEntries(two)).toEqual(Object.fromEntries(one));
    expect(g).toEqual(copy);
  });

  it('lays out with the given forces: the defaults as with none, a longer link distance longer lines and farther out, the same each time', () => {
    const g = tree(20, 3);
    const options = { rootId: 'n0', width: 120, height: 55 };
    const none = forcePositions(g.nodes, g.edges, options);
    expect(Object.fromEntries(forcePositions(g.nodes, g.edges, { ...options, params: DEFAULT_FORCE_PARAMS }))).toEqual(Object.fromEntries(none));
    const far = forcePositions(g.nodes, g.edges, { ...options, params: { linkDistance: 360 } });
    expect(Object.fromEntries(forcePositions(g.nodes, g.edges, { ...options, params: { linkDistance: 360 } }))).toEqual(Object.fromEntries(far));
    expect(meanLine(far, g.edges)).toBeGreaterThan(meanLine(none, g.edges) + 100);
    const fromMiddle = (at: ReadonlyMap<string, Point>) => [...at.values()].reduce((sum, p) => sum + Math.hypot(p.x, p.y), 0) / (at.size - 1);
    expect(fromMiddle(far)).toBeGreaterThan(fromMiddle(none));
    expect(far.get('n0')).toEqual({ x: 0, y: 0 });
  });

  it('brings the given forces into range, and scales the collision radius: at 2× the closest elements are farther apart', () => {
    const g = tree(20, 3);
    const options = { rootId: 'n0', width: 120, height: 55 };
    const at = (params: Partial<ForceParams>) => Object.fromEntries(forcePositions(g.nodes, g.edges, { ...options, params }));
    expect(at({ linkDistance: 9999, chargeStrength: 40 })).toEqual(at({ linkDistance: 400, chargeStrength: 0 }));
    const closest = (params: Partial<ForceParams>) => {
      const points = Object.values(at(params));
      let best = Infinity;
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) best = Math.min(best, distance(points[i]!, points[j]!));
      return best;
    };
    expect(closest({ collideScale: 2 })).toBeGreaterThan(closest({}) + 20);
  });
});
