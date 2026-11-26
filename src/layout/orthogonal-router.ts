/**
 * Lines routed at right angles around the boxes in their way, the boxes staying where they are — *Arrange
 * relationships…* (Req 22.2; `.agents/tasks/arrange-options/design.md`). ELK cannot route without placing, so
 * this is la-gram's own, after the orthogonal connector routing of Wybrow, Marriott and Stuckey (2009): a search
 * on the orthogonal visibility graph, then the segments nudged apart.
 *
 * What a modeller follows best, in order: as few bends as there can be; ends at the middle of a side; no line
 * crossing another where it need not; and where a line bends, well clear of the boxes, in the middle of the gap it
 * runs through.
 *
 * 1. **Ports.** A line leaves a box at the middle of a side — or, where the two boxes face each other with their
 *    sides overlapping, at a point the two share, so that it runs straight: the middle of the smaller box, within
 *    the middle half of its side; a port off the middle costs a little per pixel.
 * 2. **Graph.** The grid of the obstacles' grown edges, the ports' stubs and the middle lines between the two
 *    boxes, within their bounding box grown by a border (widened if no route is found); each obstacle marks the
 *    vertices and steps it covers.
 * 3. **Search.** First the simple shapes — straight, an L, a Z through the middle of the gap — costed as below; one
 *    clear of the boxes that crosses no line is taken. Else A* over (vertex, direction), its grid capped: the length, plus a penalty per bend — more where the bend comes
 *    closer than the clearance to either end's box — plus a smaller one per other line the step crosses: a bend
 *    costs more than any two crossings, so a line takes no bend to avoid a crossing or two.
 * 4. **Ends.** The lines on one side of a box dock so that none crosses another as it leaves — a line that turns
 *    where its turn crosses no line running straight on further than it, and of the lines turning one way the one
 *    turning soonest outermost — as near where they are as that allows; crossings come before the middle, lines on
 *    top of one another before crossings. Spreading never adds a bend.
 * 5. **Channels.** Each inner segment is moved to the middle of the gap between the boxes on either side of it;
 *    segments sharing a gap run side by side about its middle, in the order of where they come from and go. Then the
 *    ends again (4): lines that left a side on one level now turn on two.
 * 6. **Loops.** A line stepping out and back is brought as near its ends as the boxes allow — flat, where it
 *    returns to the level it left.
 *
 * Deterministic: lines in order of id, ties broken by position. A line whose ends overlap, or one of which holds
 * the other, has no route here — the caller keeps its own.
 *
 * **Kept lines** (`.agents/tasks/line-shape/`, LS-DD-2): lines already on the diagram that are not routed again — when
 * a few lines are routed, the rest of the view's. They count as lines routed before: the search weighs crossing them,
 * their ends hold their places on a side while the routed lines dock around them, and their segments hold their
 * places in a gap while the routed ones run beside them. They are never moved, and have no route in the answer.
 */

export interface RouterNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The box it is drawn in. */
  parentId?: string;
}

export interface RouterEdge {
  id: string;
  source: string;
  target: string;
}

export interface Point {
  x: number;
  y: number;
}

/** A line already on the diagram, left where it is: what the routed lines avoid. */
export interface KeptLine {
  id: string;
  points: readonly Point[];
  /** Its ends, where they are boxes of the diagram — not a line, for a line ending on one. */
  source?: string;
  target?: string;
}

export interface RouterOptions {
  /** How far a line keeps from a box. */
  margin: number;
  /** A bend's cost, in pixels of length. */
  bendPenalty: number;
  /** How close to either end's box a bend may come before it costs more. */
  bendClearance: number;
  /** What a bend closer than the clearance costs on top. */
  nearBendPenalty: number;
  /** A crossing of a line already routed, in pixels of length. */
  crossPenalty: number;
  /** A port off the middle of its side, per pixel. */
  offsetWeight: number;
  /** How far beyond the two ends the search looks first. */
  border: number;
  /** The least distance between lines leaving one side. */
  spacing: number;
  /** The distance between lines side by side in a gap, where it has room. */
  channelSpacing: number;
  /** The largest grid searched, in vertices: a line whose grid is larger takes its best simple shape. */
  maxGrid: number;
  /**
   * The most states one search expands weighing crossings; past it the line is searched again with crossings
   * free, which is quick — in a dense diagram, where every way crosses something, weighing them would look
   * everywhere for one crossing fewer.
   */
  maxExpansions: number;
}

export const ROUTER_DEFAULTS: RouterOptions = {
  margin: 16,
  bendPenalty: 150,
  bendClearance: 24,
  nearBendPenalty: 150,
  crossPenalty: 40,
  offsetWeight: 0.4,
  border: 120,
  spacing: 12,
  channelSpacing: 16,
  maxGrid: 60_000,
  maxExpansions: 30_000,
};

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
/** Directions: 0 +x, 1 −x, 2 +y, 3 −y. */
const OUTWARD: Record<Side, number> = { right: 0, left: 1, bottom: 2, top: 3 };
const STEP: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const rectOf = (n: RouterNode): Rect => ({ left: n.x, top: n.y, right: n.x + n.width, bottom: n.y + n.height });
const grow = (r: Rect, by: number): Rect => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** The least distance between two lines leaving one side, where the room is too short for the spacing. */
const MIN_STEP = 4;

/**
 * Places for points in a given order along a line, each at least `gap` after the one before: as near each one's
 * `place` as the order allows — the least sum of squared moves, by pooling neighbours that would be out of order —
 * then each within its bounds, pushing its neighbours on where that breaks the order. Where the bounds leave no room
 * for the order, the bounds win.
 */
export function placeInOrder(points: ReadonlyArray<{ place: number; lower: number; upper: number }>, gap: number): number[] {
  // Pool adjacent violators over `place - k·gap`, which must not decrease.
  const blocks: Array<{ sum: number; count: number }> = [];
  points.forEach((p, k) => {
    blocks.push({ sum: p.place - k * gap, count: 1 });
    while (blocks.length > 1) {
      const [a, b] = blocks.slice(-2);
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  });
  const places: number[] = [];
  for (const b of blocks) for (let i = 0; i < b.count; i++) places.push(b.sum / b.count + places.length * gap);
  const within = (k: number) => clamp(places[k], points[k].lower, points[k].upper);
  for (let k = 0; k < places.length; k++) places[k] = within(k);
  for (let k = 1; k < places.length; k++) {
    places[k] = Math.max(places[k], places[k - 1] + gap);
    places[k] = within(k);
  }
  for (let k = places.length - 2; k >= 0; k--) {
    places[k] = Math.min(places[k], places[k + 1] - gap);
    places[k] = within(k);
  }
  return places;
}

/** How far a point lies outside a box: 0 on or inside it. */
function distanceOutside(r: Rect, x: number, y: number): number {
  return Math.max(r.left - x, x - r.right, r.top - y, y - r.bottom, 0);
}

interface Port {
  side: Side;
  /** On the outline. */
  at: Point;
  /** A margin out from it: where the search starts or ends. */
  stub: Point;
  cost: number;
}

function portAt(r: Rect, side: Side, along: number, margin: number, cost: number): Port {
  switch (side) {
    case 'top':
      return { side, at: { x: along, y: r.top }, stub: { x: along, y: r.top - margin }, cost };
    case 'bottom':
      return { side, at: { x: along, y: r.bottom }, stub: { x: along, y: r.bottom + margin }, cost };
    case 'left':
      return { side, at: { x: r.left, y: along }, stub: { x: r.left - margin, y: along }, cost };
    default:
      return { side, at: { x: r.right, y: along }, stub: { x: r.right + margin, y: along }, cost };
  }
}

/**
 * Where a straight line between two facing sides docks, the same for both boxes, or none: the middle of the box with
 * the shorter side — a small box beside a large one keeps its line at its middle, the large one takes it where it
 * comes — moved into the overlap of the two sides; between sides of one length, halfway between the middles. Only
 * within the middle half of the shorter side: a line is not pushed to a box's edge to save a bend.
 */
function sharedDock(aLo: number, aHi: number, bLo: number, bHi: number, inset: number): number | undefined {
  const lo = Math.max(aLo, bLo) + inset;
  const hi = Math.min(aHi, bHi) - inset;
  if (lo > hi) return undefined;
  const aMid = (aLo + aHi) / 2;
  const bMid = (bLo + bHi) / 2;
  const aLength = aHi - aLo;
  const bLength = bHi - bLo;
  const shorter = aLength === bLength ? undefined : aLength < bLength ? { mid: aMid, length: aLength } : { mid: bMid, length: bLength };
  const at = Math.round(clamp(shorter ? shorter.mid : (aMid + bMid) / 2, lo, hi));
  const within = (mid: number, length: number) => Math.abs(at - mid) <= length / 4;
  if (shorter ? !within(shorter.mid, shorter.length) : !within(aMid, aLength) || !within(bMid, bLength)) return undefined;
  return at;
}

/**
 * A box's ports towards another: the middle of each side; and, where the two face each other with their sides
 * overlapping, their shared dock (`sharedDock`), so a line between them runs straight.
 */
function portsOf(r: Rect, other: Rect, options: RouterOptions): Port[] {
  const cx = Math.round((r.left + r.right) / 2);
  const cy = Math.round((r.top + r.bottom) / 2);
  const ports = SIDES.map((side) => portAt(r, side, side === 'top' || side === 'bottom' ? cx : cy, options.margin, 0));
  const inset = Math.min(options.margin, 8);
  const sideways: Side | undefined = other.left >= r.right ? 'right' : other.right <= r.left ? 'left' : undefined;
  const y = sideways ? sharedDock(r.top, r.bottom, other.top, other.bottom, inset) : undefined;
  if (sideways && y !== undefined && y !== cy) ports.push(portAt(r, sideways, y, options.margin, options.offsetWeight * Math.abs(y - cy)));
  const upDown: Side | undefined = other.top >= r.bottom ? 'bottom' : other.bottom <= r.top ? 'top' : undefined;
  const x = upDown ? sharedDock(r.left, r.right, other.left, other.right, inset) : undefined;
  if (upDown && x !== undefined && x !== cx) ports.push(portAt(r, upDown, x, options.margin, options.offsetWeight * Math.abs(x - cx)));
  return ports;
}

/** A min-heap of states by estimated cost, in typed arrays, ties by insertion: no object per entry. */
class Heap {
  private keys = new Int32Array(1024);
  private f = new Float64Array(1024);
  private tie = new Uint32Array(1024);
  private n = 0;
  private count = 0;
  get size(): number {
    return this.n;
  }
  push(key: number, f: number): void {
    if (this.n === this.keys.length) {
      const grow = <T extends Int32Array | Float64Array | Uint32Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.keys = grow(this.keys);
      this.f = grow(this.f);
      this.tie = grow(this.tie);
    }
    let i = this.n++;
    const tie = this.count++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] < f || (this.f[p] === f && this.tie[p] < tie)) break;
      this.keys[i] = this.keys[p];
      this.f[i] = this.f[p];
      this.tie[i] = this.tie[p];
      i = p;
    }
    this.keys[i] = key;
    this.f[i] = f;
    this.tie[i] = tie;
  }
  /** The least entry's key; its estimate is `lastF`. */
  pop(): number {
    const key = this.keys[0];
    this.lastF = this.f[0];
    const n = --this.n;
    if (n > 0) {
      const k = this.keys[n];
      const f = this.f[n];
      const tie = this.tie[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && (this.f[r] < this.f[l] || (this.f[r] === this.f[l] && this.tie[r] < this.tie[l])) ? r : l;
        if (f < this.f[m] || (f === this.f[m] && tie < this.tie[m])) break;
        this.keys[i] = this.keys[m];
        this.f[i] = this.f[m];
        this.tie[i] = this.tie[m];
        i = m;
      }
      this.keys[i] = k;
      this.f[i] = f;
      this.tie[i] = tie;
    }
    return key;
  }
  lastF = 0;
}

/** Arrays for the search, grown as needed and reused: a state's entries count only under the current generation. */
const scratchArrays = { cost: new Float64Array(0), previous: new Int32Array(0), stamp: new Uint32Array(0), generation: 0 };
function searchScratch(size: number) {
  if (scratchArrays.cost.length < size) {
    scratchArrays.cost = new Float64Array(size);
    scratchArrays.previous = new Int32Array(size);
    scratchArrays.stamp = new Uint32Array(size);
    scratchArrays.generation = 0;
  }
  scratchArrays.generation = (scratchArrays.generation + 1) >>> 0;
  if (scratchArrays.generation === 0) {
    scratchArrays.stamp.fill(0);
    scratchArrays.generation = 1;
  }
  return scratchArrays;
}

/** The first index whose value is greater than `v`, in an ascending array. */
function firstAbove(values: readonly number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The first index whose value is at least `v`, in an ascending array. */
function firstAtLeast(values: readonly number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] >= v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** A segment of a line already routed, for the crossings a new one would make. */
interface Routed {
  horizontal: boolean;
  at: number;
  lo: number;
  hi: number;
}

/** One line's route within a region, or `undefined` where none is found there. */
function search(
  source: Rect,
  target: Rect,
  obstacles: readonly Rect[],
  routed: readonly Routed[],
  region: Rect,
  options: RouterOptions,
): Point[] | undefined {
  const local = obstacles.filter((o) => overlaps(o, region));
  const sourcePorts = portsOf(source, target, options);
  const targetPorts = portsOf(target, source, options);
  // The ends block the search but for their stubs: grown by just under the margin, so a stub lies outside.
  const blocking = [...local, grow(source, options.margin - 1), grow(target, options.margin - 1)];

  const xs = new Set<number>([region.left, region.right]);
  const ys = new Set<number>([region.top, region.bottom]);
  for (const o of local) {
    if (o.left >= region.left && o.left <= region.right) xs.add(o.left);
    if (o.right >= region.left && o.right <= region.right) xs.add(o.right);
    if (o.top >= region.top && o.top <= region.bottom) ys.add(o.top);
    if (o.bottom >= region.top && o.bottom <= region.bottom) ys.add(o.bottom);
  }
  for (const p of [...sourcePorts, ...targetPorts]) {
    xs.add(p.stub.x);
    ys.add(p.stub.y);
  }
  // The middle of the gap between the two boxes, where a bend between them is easiest to see.
  if (target.left > source.right) xs.add(Math.round((source.right + target.left) / 2));
  if (source.left > target.right) xs.add(Math.round((target.right + source.left) / 2));
  if (target.top > source.bottom) ys.add(Math.round((source.bottom + target.top) / 2));
  if (source.top > target.bottom) ys.add(Math.round((target.bottom + source.top) / 2));
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const nx = X.length;
  const ny = Y.length;
  if (nx * ny > options.maxGrid) return undefined;
  const index = (i: number, j: number) => j * nx + i;

  // Each obstacle marks the vertices it covers and the steps it blocks, found by binary search: the work is the
  // obstacles' areas on the grid, not the grid times the obstacles.
  const free = new Uint8Array(nx * ny).fill(1);
  const hClear = new Uint8Array(nx * ny).fill(1); // the step from (i, j) to (i + 1, j)
  const vClear = new Uint8Array(nx * ny).fill(1); // the step from (i, j) to (i, j + 1)
  for (const o of blocking) {
    const i0 = firstAbove(X, o.left);
    const i1 = firstAtLeast(X, o.right) - 1;
    const j0 = firstAbove(Y, o.top);
    const j1 = firstAtLeast(Y, o.bottom) - 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) free[index(i, j)] = 0;
    const h0 = Math.max(0, i0 - 1);
    const h1 = Math.min(nx - 2, i1);
    for (let j = j0; j <= j1; j++) for (let i = h0; i <= h1; i++) hClear[index(i, j)] = 0;
    const v0 = Math.max(0, j0 - 1);
    const v1 = Math.min(ny - 2, j1);
    for (let i = i0; i <= i1; i++) for (let j = v0; j <= v1; j++) vClear[index(i, j)] = 0;
  }
  // The lines already routed: how many each step would cross.
  const hCross = new Uint16Array(nx * ny);
  const vCross = new Uint16Array(nx * ny);
  for (const s of routed) {
    if (s.horizontal) {
      // A vertical step between rows j and j + 1 crosses it where the rows straddle it, at a column inside it.
      if (s.at <= Y[0] || s.at >= Y[ny - 1]) continue;
      const j = firstAtLeast(Y, s.at) - 1;
      if (Y[j + 1] === s.at) continue;
      for (let i = firstAbove(X, s.lo); i < nx && X[i] < s.hi; i++) vCross[index(i, j)]++;
    } else {
      if (s.at <= X[0] || s.at >= X[nx - 1]) continue;
      const i = firstAtLeast(X, s.at) - 1;
      if (X[i + 1] === s.at) continue;
      for (let j = firstAbove(Y, s.lo); j < ny && Y[j] < s.hi; j++) hCross[index(i, j)]++;
    }
  }

  const vertexOf = (p: Point) => {
    const i = X.indexOf(p.x);
    const j = Y.indexOf(p.y);
    return i < 0 || j < 0 ? -1 : index(i, j);
  };
  const goals = new Map<number, Port[]>();
  for (const p of targetPorts) {
    const v = vertexOf(p.stub);
    if (v < 0 || !free[v]) continue;
    if (!goals.has(v)) goals.set(v, []);
    goals.get(v)!.push(p);
  }
  if (goals.size === 0) return undefined;
  const goalX = targetPorts.map((p) => p.stub.x);
  const goalY = targetPorts.map((p) => p.stub.y);
  const goalIn = targetPorts.map((p) => OUTWARD[p.side] ^ 1);
  const goalCost = targetPorts.map((p) => p.cost);
  /**
   * A lower bound of what is left from a vertex, heading `dir`: the distance to a target stub, and the bends still
   * needed to arrive heading in — none heading in with it straight ahead, one heading across, two otherwise —
   * so the search, a bend costing far more than a step, looks along few lines.
   */
  const h = (v: number, dir: number) => {
    const x = X[v % nx];
    const y = Y[(v / nx) | 0];
    let best = Infinity;
    for (let g = 0; g < goalX.length; g++) {
      const dx = goalX[g] - x;
      const dy = goalY[g] - y;
      const inward = goalIn[g];
      let bends: number;
      if (dir === inward) {
        const ahead = inward === 0 ? dx >= 0 && dy === 0 : inward === 1 ? dx <= 0 && dy === 0 : inward === 2 ? dy >= 0 && dx === 0 : dy <= 0 && dx === 0;
        bends = ahead ? 0 : 2;
      } else bends = (dir ^ 1) === inward ? 2 : 1;
      best = Math.min(best, Math.abs(dx) + Math.abs(dy) + bends * options.bendPenalty + goalCost[g]);
    }
    return best;
  };
  /** A bend at (x, y): dearer close to either end's box, where a modeller cannot see it. */
  const bendCost = (x: number, y: number) =>
    options.bendPenalty +
    (Math.min(distanceOutside(source, x, y), distanceOutside(target, x, y)) < options.bendClearance ? options.nearBendPenalty : 0);

  const scratch = searchScratch(nx * ny * 4);
  const generation = scratch.generation;
  const { cost, previous, stamp } = scratch;
  const costOf = (s: number) => (stamp[s] === generation ? cost[s] : Infinity);
  const setCost = (s: number, c: number, from: number) => {
    stamp[s] = generation;
    cost[s] = c;
    previous[s] = from;
  };
  const heap = new Heap();
  const startPort = new Map<number, Port>();
  for (const p of sourcePorts) {
    const v = vertexOf(p.stub);
    if (v < 0 || !free[v]) continue;
    const s = v * 4 + OUTWARD[p.side];
    if (p.cost < costOf(s)) {
      setCost(s, p.cost, -1);
      startPort.set(s, p);
      heap.push(s, p.cost + h(v, OUTWARD[p.side]));
    }
  }
  let best = -1;
  let bestPort: Port | undefined;
  let bestCost = Infinity;
  let expanded = 0;
  while (heap.size > 0) {
    if (++expanded > options.maxExpansions && options.crossPenalty > 0) {
      return search(source, target, obstacles, routed, region, { ...options, crossPenalty: 0 });
    }
    const s = heap.pop();
    const f = heap.lastF;
    if (f >= bestCost) break;
    const v = s >> 2;
    const dir = s & 3;
    const c = costOf(s);
    if (f > c + h(v, dir) + 1e-9) continue;
    const i = v % nx;
    const j = (v / nx) | 0;
    for (const goal of goals.get(v) ?? []) {
      // The last step runs into the target: arriving any other way is one more bend, at the stub.
      const inward = OUTWARD[goal.side] ^ 1;
      const total = c + goal.cost + (dir === inward ? 0 : bendCost(X[i], Y[j]));
      if (total < bestCost) {
        bestCost = total;
        best = s;
        bestPort = goal;
      }
    }
    for (let d = 0; d < 4; d++) {
      if (d === (dir ^ 1)) continue; // no turning back
      const [di, dj] = STEP[d];
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const k = di !== 0 ? index(Math.min(i, ni), j) : index(i, Math.min(j, nj));
      const clear = di !== 0 ? hClear[k] : vClear[k];
      const w = index(ni, nj);
      if (!clear || !free[w]) continue;
      const crossings = di !== 0 ? hCross[k] : vCross[k];
      const step =
        Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (d === dir ? 0 : bendCost(X[i], Y[j])) + crossings * options.crossPenalty;
      const t = w * 4 + d;
      if (c + step < costOf(t)) {
        setCost(t, c + step, s);
        heap.push(t, c + step + h(w, d));
      }
    }
  }
  if (best < 0 || !bestPort) return undefined;

  const states: number[] = [];
  for (let s = best; s >= 0; s = previous[s]) states.push(s);
  states.reverse();
  const path = states.map((s) => ({ x: X[(s >> 2) % nx], y: Y[((s >> 2) / nx) | 0] }));
  const first = startPort.get(states[0])!;
  return simplify([first.at, ...path, bestPort.at]);
}

/** Whether a segment runs through the inside of any of the boxes. */
function crossesAny(p: Point, q: Point, boxes: readonly Rect[]): boolean {
  const lo = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) };
  const hi = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) };
  for (const r of boxes) {
    if (p.x === q.x ? r.left < p.x && p.x < r.right && lo.y < r.bottom && r.top < hi.y : r.top < p.y && p.y < r.bottom && lo.x < r.right && r.left < hi.x) {
      return true;
    }
  }
  return false;
}

/** How many of the lines already routed a segment crosses. */
function crossingsOf(p: Point, q: Point, routed: readonly Routed[]): number {
  const horizontal = p.y === q.y;
  const at = horizontal ? p.y : p.x;
  const lo = Math.min(horizontal ? p.x : p.y, horizontal ? q.x : q.y);
  const hi = Math.max(horizontal ? p.x : p.y, horizontal ? q.x : q.y);
  let n = 0;
  for (const s of routed) if (s.horizontal !== horizontal && s.at > lo && s.at < hi && at > s.lo && at < s.hi) n++;
  return n;
}

/**
 * The best of the simple shapes — straight between two ports that face each other, an L, a Z through the middle of
 * the gap — that runs clear of the boxes, costed as the search costs a route; with how many lines it crosses. Most
 * lines are one of these, found without the search.
 */
function simpleRoute(
  source: Rect,
  target: Rect,
  obstacles: readonly Rect[],
  routed: readonly Routed[],
  options: RouterOptions,
): { route: Point[]; cost: number; crossings: number } | undefined {
  const sourcePorts = portsOf(source, target, options);
  const targetPorts = portsOf(target, source, options);
  const ends = [grow(source, options.margin - 1), grow(target, options.margin - 1)];
  const span = grow(
    { left: Math.min(source.left, target.left), top: Math.min(source.top, target.top), right: Math.max(source.right, target.right), bottom: Math.max(source.bottom, target.bottom) },
    options.margin,
  );
  const local = obstacles.filter((o) => overlaps(o, span));
  const near = (p: Point) => Math.min(distanceOutside(source, p.x, p.y), distanceOutside(target, p.x, p.y)) < options.bendClearance;
  const horizontalSide = (s: Side) => s === 'left' || s === 'right';
  const outward = (port: Port, p: Point) =>
    port.side === 'right' ? p.x >= port.stub.x : port.side === 'left' ? p.x <= port.stub.x : port.side === 'bottom' ? p.y >= port.stub.y : p.y <= port.stub.y;
  let best: { route: Point[]; cost: number; crossings: number } | undefined;
  const consider = (route: Point[], sp: Port, tp: Port) => {
    for (let i = 1; i < route.length; i++) {
      if (crossesAny(route[i - 1], route[i], local)) return;
      // Inner segments keep out of the two ends; the first and last run into them.
      if (i > 1 && i < route.length - 1 && crossesAny(route[i - 1], route[i], ends)) return;
    }
    let cost = sp.cost + tp.cost;
    let crossings = 0;
    for (let i = 1; i < route.length; i++) {
      cost += Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y);
      crossings += crossingsOf(route[i - 1], route[i], routed);
    }
    for (const bend of route.slice(1, -1)) cost += options.bendPenalty + (near(bend) ? options.nearBendPenalty : 0);
    cost += crossings * options.crossPenalty;
    if (!best || cost < best.cost) best = { route, cost, crossings };
  };
  for (const sp of sourcePorts) {
    for (const tp of targetPorts) {
      const spH = horizontalSide(sp.side);
      const tpH = horizontalSide(tp.side);
      if (spH && tpH && OUTWARD[sp.side] === (OUTWARD[tp.side] ^ 1)) {
        // Facing: straight where they share the line, else a Z through the middle of the gap.
        if (!outward(sp, tp.stub) || !outward(tp, sp.stub)) continue;
        if (sp.at.y === tp.at.y) consider([sp.at, tp.at], sp, tp);
        else {
          const x = Math.round((sp.at.x + tp.at.x) / 2);
          consider([sp.at, { x, y: sp.at.y }, { x, y: tp.at.y }, tp.at], sp, tp);
        }
      } else if (!spH && !tpH && OUTWARD[sp.side] === (OUTWARD[tp.side] ^ 1)) {
        if (!outward(sp, tp.stub) || !outward(tp, sp.stub)) continue;
        if (sp.at.x === tp.at.x) consider([sp.at, tp.at], sp, tp);
        else {
          const y = Math.round((sp.at.y + tp.at.y) / 2);
          consider([sp.at, { x: sp.at.x, y }, { x: tp.at.x, y }, tp.at], sp, tp);
        }
      } else if (spH !== tpH) {
        // An L: along the source's side's normal, then the target's.
        const corner = spH ? { x: tp.at.x, y: sp.at.y } : { x: sp.at.x, y: tp.at.y };
        if (outward(sp, corner) && outward(tp, corner)) consider([sp.at, corner, tp.at], sp, tp);
      }
    }
  }
  return best;
}

/** Without repeated points or points on a straight run. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length > 0 && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Whether the segment from `p` to `q` runs through the inside of a box other than those `except` names. */
function hitsBox(p: Point, q: Point, rects: ReadonlyMap<string, Rect>, except: ReadonlySet<string>): boolean {
  const lo = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) };
  const hi = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) };
  for (const [id, r] of rects) {
    if (except.has(id)) continue;
    if (p.x === q.x ? r.left < p.x && p.x < r.right && lo.y < r.bottom && r.top < hi.y : r.top < p.y && p.y < r.bottom && lo.x < r.right && r.left < hi.x) {
      return true;
    }
  }
  return false;
}

/** The side of `r` a point on its outline is on. */
function sideOf(r: Rect, p: Point): Side | undefined {
  if (p.y === r.top) return 'top';
  if (p.y === r.bottom) return 'bottom';
  if (p.x === r.left) return 'left';
  if (p.x === r.right) return 'right';
  return undefined;
}

/**
 * The lines on one side of a box, docked so that none crosses another as it leaves — before docking at the middle. A
 * straight line stays where it is, at the point it shares with its other end; lines on one point move apart, a
 * straight one only where both its ends can, so no bend is added. A line that turns docks where its first turn crosses
 * no straight line: between the level it turns to and the first straight line beyond that level that runs further
 * than it before turning — one ending sooner it passes by. Along the side, those turning towards one end before those
 * turning towards the other, and of those turning one way the one turning soonest outermost; each as near where it
 * is as that order allows, the spacing apart — or less where the room is short. Where even the least leaves no room,
 * a crossing comes before lines on top of one another. A bent line moves with its first bend; one that would run
 * through a box stays where it is, and the others are placed about it. A kept line (`keptIds`) is never moved:
 * its end stands as a straight line's does, and a routed line on its point moves off it.
 */
function spreadEnds(
  routes: Map<string, Point[]>,
  edges: readonly RouterEdge[],
  rects: ReadonlyMap<string, Rect>,
  spacing: number,
  keptIds: ReadonlySet<string> = new Set(),
): void {
  const edgeOf = new Map(edges.map((e) => [e.id, e]));
  interface End {
    id: string;
    atStart: boolean;
    nodeId: string;
    side: Side;
  }
  const bySide = new Map<string, End[]>();
  for (const e of edges) {
    const points = routes.get(e.id);
    if (!points) continue;
    for (const [atStart, nodeId] of [[true, e.source], [false, e.target]] as const) {
      // A kept line's end on another line is on no box's side.
      if (!rects.has(nodeId)) continue;
      const side = sideOf(rects.get(nodeId)!, atStart ? points[0] : points[points.length - 1]);
      if (!side) continue;
      const key = `${nodeId} ${side}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key)!.push({ id: e.id, atStart, nodeId, side });
    }
  }
  /** Straight lines moved at both ends already: left where they are. */
  const settled = new Set<string>();
  for (const [, ends] of [...bySide].sort(([a], [b]) => a.localeCompare(b))) {
    if (ends.length < 2 || ends.every((end) => keptIds.has(end.id))) continue;
    const { side, nodeId } = ends[0];
    const r = rects.get(nodeId)!;
    const alongX = side === 'top' || side === 'bottom';
    const [lo, hi] = alongX ? [r.left, r.right] : [r.top, r.bottom];
    const inset = Math.min(8, (hi - lo) / 4);
    const coordinate = (p: Point) => (alongX ? p.x : p.y);
    const endPoints = (end: End) => {
      const points = routes.get(end.id)!;
      return { points, a: end.atStart ? 0 : points.length - 1, b: end.atStart ? 1 : points.length - 2 };
    };
    /** Moves an end along the side to `to` — or, `trying`, only says whether it could. */
    const shiftOf = (end: End, to: number, trying = false): boolean => {
      const { points, a, b } = endPoints(end);
      const shift = Math.round(to) - coordinate(points[a]);
      if (shift === 0) return true;
      const edge = edgeOf.get(end.id)!;
      const except = new Set([edge.source, edge.target]);
      const move = (p: Point): Point => (alongX ? { x: p.x + shift, y: p.y } : { x: p.x, y: p.y + shift });
      if (points.length === 2) {
        const other = rects.get(end.atStart ? edge.target : edge.source)!;
        const p = move(points[b]);
        const fits = alongX ? other.left < p.x && p.x < other.right : other.top < p.y && p.y < other.bottom;
        if (!fits || hitsBox(move(points[a]), p, rects, except)) return false;
        if (trying) return true;
        points[a] = move(points[a]);
        points[b] = p;
        settled.add(end.id);
        return true;
      }
      const movedA = move(points[a]);
      const movedB = move(points[b]);
      const beyond = points[end.atStart ? b + 1 : b - 1];
      if (hitsBox(movedA, movedB, rects, except) || (beyond && hitsBox(movedB, beyond, rects, except))) return false;
      if (trying) return true;
      points[a] = movedA;
      points[b] = movedB;
      return true;
    };

    // Each end: straight on — how far — or turning towards `lo` or `hi` — how soon, and to where along the side.
    interface Straight {
      end: End;
      at: number;
      length: number;
      /** A kept line's end: stays where it is. */
      held?: boolean;
    }
    interface Bent {
      end: End;
      towards: -1 | 1;
      reach: number;
      level: number;
      at: number;
      /** The first straight line beyond `level` on the bent line's own side that runs past its turn. */
      beyond: number;
      /** A kept line's end: in the order, where it is. */
      held?: boolean;
    }
    const outward = (points: Point[], a: number, b: number) =>
      alongX ? Math.abs(points[b].y - points[a].y) : Math.abs(points[b].x - points[a].x);
    const straight: Straight[] = [];
    const bent: Bent[] = [];
    for (const end of ends) {
      const { points, a, b } = endPoints(end);
      const at = coordinate(points[a]);
      // A kept line holds its place: a straight one as a straight line does, a bent one in the order of the bent
      // lines — the routed ones placed about it as about one that cannot move.
      if (points.length < 3 || settled.has(end.id)) {
        straight.push({ end, at, length: outward(points, a, b), ...(keptIds.has(end.id) ? { held: true } : {}) });
        continue;
      }
      const level = coordinate(points[end.atStart ? b + 1 : b - 1]);
      bent.push({ end, towards: level < at ? -1 : 1, reach: outward(points, a, b), level, at, beyond: NaN, ...(keptIds.has(end.id) ? { held: true } : {}) });
    }
    const byId = (x: { end: End }, y: { end: End }) => x.end.id.localeCompare(y.end.id);
    // Straight lines on one point: apart about it, both ends moving.
    const atPoint = new Map<number, Straight[]>();
    for (const s of straight) {
      if (!atPoint.has(s.at)) atPoint.set(s.at, []);
      atPoint.get(s.at)!.push(s);
    }
    for (const [at, together] of atPoint) {
      if (together.length < 2) continue;
      if (!together.some((s) => s.held)) {
        together.sort(byId).forEach((s, k) => {
          const to = at + (k - (together.length - 1) / 2) * spacing;
          if (shiftOf(s.end, to)) s.at = Math.round(to);
        });
        continue;
      }
      // A kept line stays on its point: each routed one moves off it, to the nearest place along the side no other
      // straight end is within the spacing of, both its ends moving.
      for (const s of together.filter((t) => !t.held).sort(byId)) {
        for (let k = 1; k <= 8; k++) {
          const to = [at + k * spacing, at - k * spacing].find(
            (p) =>
              p >= lo + inset &&
              p <= hi - inset &&
              straight.every((t) => t === s || Math.abs(t.at - p) >= spacing) &&
              shiftOf(s.end, p, true),
          );
          if (to === undefined) continue;
          shiftOf(s.end, to);
          s.at = Math.round(to);
          break;
        }
      }
    }
    if (!bent.some((x) => !x.held)) continue;
    // Where each bent line may dock and cross no straight one: between the level it turns to and the first straight
    // line beyond that level on its own side that runs past its turn — one ending sooner it passes by — `gap` from
    // each. Where no place is, the crossing is unavoidable and it may dock anywhere along the side.
    for (const x of bent) {
      const past = straight.filter((s) => s.length > x.reach).map((s) => s.at);
      x.beyond = x.towards < 0 ? Math.min(...past.filter((s) => s > x.level)) : Math.max(...past.filter((s) => s < x.level));
    }
    const along = { lower: lo + inset, upper: hi - inset };
    const crossingFree = (x: Bent, gap: number) => {
      const lower = Math.max(x.towards < 0 ? x.level + gap : x.beyond + gap, along.lower);
      const upper = Math.min(x.towards < 0 ? x.beyond - gap : x.level - gap, along.upper);
      return lower <= upper ? { lower, upper } : undefined;
    };
    const avoidable = new Set(bent.filter((x) => crossingFree(x, MIN_STEP)));
    // In one order along the side, so that none crosses another as it leaves: those turning towards `lo` before
    // those turning towards `hi`, and of those turning one way, the one turning soonest outermost; the straight lines
    // fixed among them, where the bent lines would go without them.
    const ups = bent.filter((x) => x.towards < 0).sort((x, y) => x.reach - y.reach || byId(x, y));
    const downs = bent.filter((x) => x.towards > 0).sort((x, y) => y.reach - x.reach || byId(x, y));
    const order = [...ups, ...downs];
    const fixed = straight.map((s) => s.at).sort((x, y) => x - y);
    const attempt = (gap: number, boundsOf: (x: Bent) => { lower: number; upper: number } | undefined, strict: boolean) => {
      const bounds = order.map(boundsOf);
      if (bounds.some((b) => !b)) return undefined;
      const wished = order.map((x, k) => ({ x, place: clamp(x.at, bounds[k]!.lower, bounds[k]!.upper), ...bounds[k]! }));
      placeInOrder(wished, gap).forEach((place, k) => (wished[k].place = place));
      const items: Array<{ x?: Bent; place: number; lower: number; upper: number }> = [];
      let f = 0;
      for (const w of wished) {
        while (f < fixed.length && (fixed[f] < w.place || (fixed[f] === w.place && w.x.towards > 0))) items.push({ place: fixed[f], lower: fixed[f], upper: fixed[f++] });
        items.push(w);
      }
      for (; f < fixed.length; f++) items.push({ place: fixed[f], lower: fixed[f], upper: fixed[f] });
      const places = placeInOrder(items, gap);
      const fits = places.every(
        (p, k) =>
          p >= items[k].lower - 0.5 &&
          p <= items[k].upper + 0.5 &&
          (k === 0 || (!items[k].x && !items[k - 1].x) || p - places[k - 1] >= gap - 0.5),
      );
      return fits || !strict ? new Map(items.flatMap((it, k) => (it.x ? [[it.x, places[k]] as const] : []))) : undefined;
    };
    // The spacing, or less where the room is short; where even the least leaves no room, a crossing before lines on
    // top of one another — each the least apart, anywhere along the side. A line that cannot move where it is placed
    // — the move would run through a box — stays where it is, and the others are placed again about it.
    const stuck = new Set<Bent>(bent.filter((x) => x.held));
    const held = (x: Bent) => ({ lower: x.at, upper: x.at });
    for (;;) {
      const placed =
        [spacing, spacing / 2, MIN_STEP]
          .map((gap) => attempt(gap, (x) => (stuck.has(x) ? held(x) : avoidable.has(x) ? crossingFree(x, gap) : along), true))
          .find((p) => p) ?? attempt(MIN_STEP, (x) => (stuck.has(x) ? held(x) : along), false)!;
      const moves = [...placed].filter(([x, place]) => !x.held && Math.round(place) !== x.at);
      const blocked = moves.filter(([x, place]) => !shiftOf(x.end, place, true));
      if (blocked.length === 0) {
        for (const [x, place] of moves) shiftOf(x.end, place);
        break;
      }
      for (const [x] of blocked) stuck.add(x);
    }
  }
}

/**
 * Each inner segment moved to the middle of the gap it runs through — between the nearest boxes on either side,
 * along its length — and segments sharing a gap side by side about its middle, in the order of where they come
 * from and go to. A segment stays between its neighbours' far ends, so no line doubles back; the first and last segments
 * stay with their ends. A kept line's segment (`keptIds`) stays where it is, and a routed one sharing its gap
 * goes as near its own place as it can, the spacing from each held one.
 */
function centreChannels(
  routes: Map<string, Point[]>,
  rectsById: ReadonlyMap<string, Rect>,
  endsOf: ReadonlyMap<string, ReadonlySet<string>>,
  margin: number,
  spacing: number,
  clearance: number,
  keptIds: ReadonlySet<string> = new Set(),
): void {
  const rects = [...rectsById.values()];
  interface Segment {
    id: string;
    k: number;
    horizontal: boolean;
    at: number;
    lo: number;
    hi: number;
    /** The gap, across the segment: the nearest boxes' edges on either side. */
    below: number;
    above: number;
    /** Where it may go without doubling back. */
    min: number;
    max: number;
    order: number;
    loTurn: number;
    hiTurn: number;
  }
  /**
   * Which of two segments sharing a gap goes nearer `below`, so that they do not cross: where one leaves the gap
   * before the other — at the low end, the one starting later; at the high end, the one ending sooner — it goes on
   * the side it leaves towards. Where the two ends disagree, a crossing is unavoidable and the low end decides.
   */
  const compare = (a: Segment, b: Segment): number => {
    if (a.lo !== b.lo) {
      const later = a.lo > b.lo ? a : b;
      const sign = later.loTurn < 0 ? -1 : 1;
      return later === a ? sign : -sign;
    }
    if (a.loTurn !== b.loTurn) return a.loTurn - b.loTurn;
    if (a.hi !== b.hi) {
      const sooner = a.hi < b.hi ? a : b;
      const sign = sooner.hiTurn < 0 ? -1 : 1;
      return sooner === a ? sign : -sign;
    }
    if (a.hiTurn !== b.hiTurn) return a.hiTurn - b.hiTurn;
    return a.order - b.order || a.id.localeCompare(b.id);
  };
  const segments: Segment[] = [];
  for (const [id, points] of [...routes].sort(([a], [b]) => a.localeCompare(b))) {
    for (let k = 1; k + 2 < points.length; k++) {
      const p = points[k];
      const q = points[k + 1];
      const horizontal = p.y === q.y;
      if (!horizontal && p.x !== q.x) continue;
      const at = horizontal ? p.y : p.x;
      const lo = Math.min(horizontal ? p.x : p.y, horizontal ? q.x : q.y);
      const hi = Math.max(horizontal ? p.x : p.y, horizontal ? q.x : q.y);
      let below = -Infinity;
      let above = Infinity;
      for (const r of rects) {
        const [from, to, start, end] = horizontal ? [r.left, r.right, r.top, r.bottom] : [r.top, r.bottom, r.left, r.right];
        if (!(from < hi && lo < to)) continue;
        if (start < at && at < end) continue; // a box the segment runs inside: what holds its ends
        if (end <= at) below = Math.max(below, end);
        else if (start >= at) above = Math.min(above, start);
      }
      // Open on one side — beyond every box — the gap is as wide as keeps the line well clear of the boxes.
      if (!Number.isFinite(below) && !Number.isFinite(above)) continue;
      if (!Number.isFinite(below)) below = above - 3 * clearance;
      if (!Number.isFinite(above)) above = below + 3 * clearance;
      const prev = horizontal ? points[k - 1].y : points[k - 1].x;
      const next = horizontal ? points[k + 2].y : points[k + 2].x;
      // Its neighbours run from `prev` to it and from it to `next`: between the two (a step), or short of both (a U),
      // which only comes nearer its ends, never further out — a step round a box grown into a loop.
      let min: number;
      let max: number;
      if (prev < at === next < at) {
        min = prev < at ? Math.max(prev, next) + margin : at;
        max = prev < at ? at : Math.min(prev, next) - margin;
      } else {
        min = Math.min(prev, next) + margin;
        max = Math.max(prev, next) - margin;
      }
      // Which way it leaves the gap at its low end and at its high end: −1 towards `below`, +1 towards `above`.
      const atLo = (horizontal ? p.x : p.y) <= (horizontal ? q.x : q.y) ? prev : next;
      const atHi = atLo === prev ? next : prev;
      segments.push({ id, k, horizontal, at, lo, hi, below, above, min, max, order: prev + next, loTurn: Math.sign(atLo - at), hiTurn: Math.sign(atHi - at) });
    }
  }
  // Segments of one gap whose lengths overlap share it.
  const gaps = new Map<string, Segment[]>();
  for (const s of segments) {
    const key = `${s.horizontal ? 'h' : 'v'} ${s.below} ${s.above}`;
    if (!gaps.has(key)) gaps.set(key, []);
    gaps.get(key)!.push(s);
  }
  for (const group of [...gaps.values()]) {
    group.sort((a, b) => a.lo - b.lo || a.id.localeCompare(b.id));
    const runs: Segment[][] = [];
    let run: Segment[] = [];
    let reach = -Infinity;
    for (const s of group) {
      if (run.length > 0 && s.lo >= reach) {
        runs.push(run);
        run = [];
        reach = -Infinity;
      }
      run.push(s);
      reach = Math.max(reach, s.hi);
    }
    if (run.length > 0) runs.push(run);
    for (const together of runs) {
      together.sort(compare);
      const { below, above } = together[0];
      const n = together.length;
      // Side by side about the middle of the gap, the outer ones a clearance from the boxes where the gap has the
      // room — the lines then closer together, down to 4 px — else across the gap.
      const room = above - below - 2 * clearance;
      const step = n < 2 ? 0 : room >= 4 * (n - 1) ? Math.min(spacing, room / (n - 1)) : Math.min(spacing, (above - below) / (n + 1));
      const middle = (below + above) / 2;
      // Where the kept lines' segments are: each routed one keeps the spacing from them, and from the routed ones
      // placed before it.
      const taken = together.filter((s) => keptIds.has(s.id)).map((s) => s.at);
      if (taken.length === n) continue;
      const apart = Math.max(MIN_STEP, step);
      together.forEach((s, m) => {
        if (keptIds.has(s.id)) return;
        let placed = Math.round(s.min <= s.max ? clamp(middle + (m - (n - 1) / 2) * step, s.min, s.max) : s.at);
        if (taken.length > 0) {
          placed = clearOf(placed, taken, apart, s.min <= s.max ? s.min : s.at, s.min <= s.max ? s.max : s.at, below, above);
          taken.push(placed);
        }
        if (placed === s.at) return;
        const points = routes.get(s.id)!;
        const moved = points.slice();
        for (const k of [s.k, s.k + 1]) {
          moved[k] = s.horizontal ? { x: moved[k].x, y: placed } : { x: placed, y: moved[k].y };
        }
        // Its neighbours, as they are now — another of the line's segments may have moved — keep their direction.
        const along = (a: Point, b: Point) => Math.sign(s.horizontal ? b.y - a.y : b.x - a.x);
        if (along(points[s.k - 1], points[s.k]) !== along(moved[s.k - 1], moved[s.k])) return;
        if (along(points[s.k + 1], points[s.k + 2]) !== along(moved[s.k + 1], moved[s.k + 2])) return;
        // Moved, the segment and its two neighbours must stay clear of every box but the line's own: two segments
        // of one line centred to one line would otherwise close the step between them that went round a box.
        const except = endsOf.get(s.id) ?? new Set<string>();
        for (let k = Math.max(1, s.k); k <= Math.min(moved.length - 1, s.k + 2); k++) {
          if (hitsBox(moved[k - 1], moved[k], rectsById, except)) return;
        }
        routes.set(s.id, moved);
      });
    }
  }
}

/**
 * The place nearest `wanted` at least `apart` from each of `taken`, within `min`–`max` and inside the gap
 * (`below`–`above`): beside the nearest kept segment where `wanted` is too close to one. Where none is, `wanted`.
 */
function clearOf(wanted: number, taken: readonly number[], apart: number, min: number, max: number, below: number, above: number): number {
  const free = (p: number) => taken.every((t) => Math.abs(t - p) >= apart - 0.5);
  if (free(wanted)) return wanted;
  const candidates = taken
    .flatMap((t) => [t - apart, t + apart])
    .map(Math.round)
    .filter((p) => p >= min && p <= max && p > below && p < above && free(p))
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b);
  return candidates[0] ?? wanted;
}

/**
 * Each U between two inner segments — a line stepping out and back — brought as near its ends as the boxes allow: to
 * the nearer of its two far ends, which takes two bends away, and where both are level, flat. A U whose sides are the
 * line's first or last segments, between two boxes one above the other, stays: brought in, it would run along their
 * edges.
 */
function flattenUs(routes: Map<string, Point[]>, rectsById: ReadonlyMap<string, Rect>, endsOf: ReadonlyMap<string, ReadonlySet<string>>): void {
  for (const [id, original] of [...routes].sort(([a], [b]) => a.localeCompare(b))) {
    let points = original;
    const except = endsOf.get(id) ?? new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (let k = 2; k + 3 < points.length; k++) {
        const p = points[k];
        const q = points[k + 1];
        const horizontal = p.y === q.y;
        const at = horizontal ? p.y : p.x;
        const prev = horizontal ? points[k - 1].y : points[k - 1].x;
        const next = horizontal ? points[k + 2].y : points[k + 2].x;
        if (prev < at !== next < at) continue;
        const to = prev < at ? Math.max(prev, next) : Math.min(prev, next);
        const moved = points.slice();
        for (const i of [k, k + 1]) moved[i] = horizontal ? { x: moved[i].x, y: to } : { x: to, y: moved[i].y };
        let clear = true;
        for (let i = k; i <= k + 2 && clear; i++) if (hitsBox(moved[i - 1], moved[i], rectsById, except)) clear = false;
        if (!clear) continue;
        points = simplify(moved);
        changed = true;
        break;
      }
    }
    if (points !== original) routes.set(id, points);
  }
}

/**
 * Every line's route, by id; none for a line whose ends overlap, hold one another, or are unknown. `kept`: the lines
 * left where they are, which the routed ones avoid — none of them in the answer.
 */
export function routeOrthogonal(
  nodes: readonly RouterNode[],
  edges: readonly RouterEdge[],
  options: RouterOptions = ROUTER_DEFAULTS,
  kept: readonly KeptLine[] = [],
): Map<string, Point[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rects = new Map(nodes.map((n) => [n.id, rectOf(n)]));
  const grown = new Map(nodes.map((n) => [n.id, grow(rects.get(n.id)!, options.margin)]));
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let p = byId.get(id)?.parentId; p && byId.has(p) && !out.has(p); p = byId.get(p)!.parentId) out.add(p);
    return out;
  };
  const all = [...rects.values()];
  const extent =
    all.length > 0
      ? {
          left: Math.min(...all.map((r) => r.left)),
          top: Math.min(...all.map((r) => r.top)),
          right: Math.max(...all.map((r) => r.right)),
          bottom: Math.max(...all.map((r) => r.bottom)),
        }
      : { left: 0, top: 0, right: 0, bottom: 0 };
  const routes = new Map<string, Point[]>();
  /** Each line's segments, for the crossings another would make with it. */
  const segmentsOf = new Map<string, Routed[]>();
  const near = (r: Rect, except: string) => {
    const out: Routed[] = [];
    for (const [id, segments] of segmentsOf) {
      if (id === except) continue;
      for (const s of segments) {
        if (s.horizontal ? s.at >= r.top && s.at <= r.bottom && s.lo < r.right && r.left < s.hi : s.at >= r.left && s.at <= r.right && s.lo < r.bottom && r.top < s.hi) out.push(s);
      }
    }
    return out;
  };
  const sorted = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  const routable = sorted.filter((edge) => {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target || edge.source === edge.target || overlaps(source, target)) return false;
    return !ancestors(edge.target).has(edge.source) && !ancestors(edge.source).has(edge.target);
  });
  const routeOne = (edge: RouterEdge): Point[] | undefined => {
    const source = rects.get(edge.source)!;
    const target = rects.get(edge.target)!;
    const skip = new Set([edge.source, edge.target, ...ancestors(edge.source), ...ancestors(edge.target)]);
    const obstacles = nodes.filter((n) => !skip.has(n.id)).map((n) => grown.get(n.id)!);
    const span = {
      left: Math.min(source.left, target.left),
      top: Math.min(source.top, target.top),
      right: Math.max(source.right, target.right),
      bottom: Math.max(source.bottom, target.bottom),
    };
    // A simple shape that crosses nothing is taken as it is; else the search, its grid capped — and failing it,
    // the simple shape after all.
    const simple = simpleRoute(source, target, obstacles, near(grow(span, options.margin), edge.id), options);
    if (simple && simple.crossings === 0) return simple.route;
    for (const border of [options.border, options.border * 4]) {
      const region = grow(span, border);
      const route = search(source, target, obstacles, near(region, edge.id), region, options);
      if (route) return route;
    }
    const region = grow(extent, options.border);
    return search(source, target, obstacles, near(region, edge.id), region, options) ?? simple?.route;
  };
  /** A route's segments for the crossings; a diagonal one — a kept line's — is not weighed. */
  const routedOf = (route: readonly Point[]): Routed[] => {
    const segments: Routed[] = [];
    for (let i = 1; i < route.length; i++) {
      const [p, q] = [route[i - 1], route[i]];
      const horizontal = p.y === q.y;
      if (!horizontal && p.x !== q.x) continue;
      segments.push({
        horizontal,
        at: horizontal ? p.y : p.x,
        lo: Math.min(horizontal ? p.x : p.y, horizontal ? q.x : q.y),
        hi: Math.max(horizontal ? p.x : p.y, horizontal ? q.x : q.y),
      });
    }
    return segments;
  };
  const keep = (id: string, route: Point[]) => {
    routes.set(id, route);
    segmentsOf.set(id, routedOf(route));
  };
  // The kept lines, as lines routed before any of these; rounded, as the routes are, so their ends meet the sides.
  const routing = new Set(edges.map((e) => e.id));
  const held = kept
    .filter((k) => !routing.has(k.id) && k.points.length >= 2)
    .map((k) => ({ ...k, points: k.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }));
  for (const k of held) segmentsOf.set(k.id, routedOf(k.points));
  // Each line around those routed before it. (Routing each again around all the others was tried: 2% fewer crossings
  // for 8% more bends and twice the time.)
  for (const edge of routable) {
    const route = routeOne(edge);
    if (route) keep(edge.id, route);
  }
  // The ends and the channels placed with the kept lines among them, held: the routed lines' points are the same
  // arrays in both maps, moved in place or replaced, and read back after.
  const heldIds = new Set(held.map((k) => k.id));
  const withKept = held.length > 0 ? new Map([...held.map((k) => [k.id, k.points] as const), ...routes]) : routes;
  const allEdges = held.length > 0 ? [...sorted, ...held.map((k) => ({ id: k.id, source: k.source ?? '', target: k.target ?? '' }))] : sorted;
  spreadEnds(withKept, allEdges, rects, options.spacing, heldIds);
  const endsOf = new Map(sorted.map((e) => [e.id, new Set([e.source, e.target, ...ancestors(e.source), ...ancestors(e.target)])]));
  centreChannels(withKept, rects, endsOf, options.margin, options.channelSpacing, options.bendClearance, heldIds);
  // Again with the channels placed: lines that left a side together, turning on one level, now turn on two, and the
  // one turning sooner goes outermost.
  spreadEnds(withKept, allEdges, rects, options.spacing, heldIds);
  if (withKept !== routes) for (const id of routes.keys()) routes.set(id, withKept.get(id)!);
  flattenUs(routes, rects, endsOf);
  for (const [id, points] of routes) routes.set(id, simplify(points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))));
  return routes;
}
