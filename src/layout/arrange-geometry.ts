/**
 * The geometry of the arrange options (Req 22; `.agents/tasks/arrange-options/`): align, distribute, align to a
 * grid, match sizes, default sizes. Pure — boxes in, moves or bounds out — so the canvas only applies them, as one
 * command (`la.arrange.apply`), and they are tested without one.
 *
 * Coordinates are the diagram's; results are whole pixels. Only what changes is returned.
 */

/** A placement: an element or a figure, and the placement it is drawn in, if any. */
export interface ArrangeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The box it is drawn in, when that is among the boxes too. */
  parentId?: string;
}

export interface Delta {
  dx: number;
  dy: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';
export type GridAxis = 'both' | 'x' | 'y';
export type SizeReference = 'largest' | 'smallest' | 'median';
export type SizeDimension = 'both' | 'width' | 'height';

const round = Math.round;

/** The boxes' bounding box. */
export function boundingBox(boxes: readonly Bounds[]): Bounds {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The boxes with none drawn inside another of them: moving a container moves what it holds. */
export function outermost<T extends ArrangeBox>(boxes: readonly T[]): T[] {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const inside = (box: T): boolean => {
    for (let parent = box.parentId; parent; parent = byId.get(parent)?.parentId) if (byId.has(parent)) return true;
    return false;
  };
  return boxes.filter((b) => !inside(b));
}

function changed(deltas: Map<string, Delta>): Map<string, Delta> {
  for (const [id, d] of deltas) if (d.dx === 0 && d.dy === 0) deltas.delete(id);
  return deltas;
}

/** Each box's edge or centre to the bounding box's: left to the leftmost, centre to its centre, and so on. */
export function alignDeltas(boxes: readonly ArrangeBox[], alignment: Alignment): Map<string, Delta> {
  const deltas = new Map<string, Delta>();
  if (boxes.length < 2) return deltas;
  const all = boundingBox(boxes);
  for (const b of boxes) {
    let dx = 0;
    let dy = 0;
    if (alignment === 'left') dx = all.x - b.x;
    else if (alignment === 'center') dx = round(all.x + all.width / 2 - b.width / 2) - b.x;
    else if (alignment === 'right') dx = all.x + all.width - b.width - b.x;
    else if (alignment === 'top') dy = all.y - b.y;
    else if (alignment === 'middle') dy = round(all.y + all.height / 2 - b.height / 2) - b.y;
    else dy = all.y + all.height - b.height - b.y;
    deltas.set(b.id, { dx, dy });
  }
  return changed(deltas);
}

/**
 * Equal gaps between neighbours along the axis, the first and the last staying: sorted by centre, then by id. Where
 * the boxes are together longer than the span between the outer edges, their centres are spaced equally instead.
 */
export function distributeDeltas(boxes: readonly ArrangeBox[], axis: DistributeAxis): Map<string, Delta> {
  const deltas = new Map<string, Delta>();
  if (boxes.length < 3) return deltas;
  const start = (b: ArrangeBox) => (axis === 'horizontal' ? b.x : b.y);
  const size = (b: ArrangeBox) => (axis === 'horizontal' ? b.width : b.height);
  const centre = (b: ArrangeBox) => start(b) + size(b) / 2;
  const sorted = [...boxes].sort((a, b) => centre(a) - centre(b) || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = start(last) + size(last) - start(first);
  const total = sorted.reduce((sum, b) => sum + size(b), 0);
  const n = sorted.length;
  const places: number[] = [];
  if (span >= total) {
    const gap = (span - total) / (n - 1);
    let at = start(first);
    for (const b of sorted) {
      places.push(at);
      at += size(b) + gap;
    }
  } else {
    const c0 = centre(first);
    const step = (centre(last) - c0) / (n - 1);
    sorted.forEach((b, i) => places.push(c0 + i * step - size(b) / 2));
  }
  sorted.forEach((b, i) => {
    const d = i === 0 || i === n - 1 ? 0 : round(places[i]) - start(b);
    deltas.set(b.id, axis === 'horizontal' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
  });
  return changed(deltas);
}

/**
 * Each box's top-left corner to the nearest grid line, on x, y or both. A box drawn in another is moved with it, so
 * its own move is from where its container's put it; containers come first in the result's order.
 */
export function gridDeltas(boxes: readonly ArrangeBox[], axis: GridAxis, grid: number): Map<string, Delta> {
  const deltas = new Map<string, Delta>();
  if (grid <= 0) return deltas;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const depth = (b: ArrangeBox): number => {
    let d = 0;
    for (let p = b.parentId; p && byId.has(p); p = byId.get(p)!.parentId) d++;
    return d;
  };
  const snap = (v: number) => round(v / grid) * grid;
  const ordered = [...boxes].sort((a, b) => depth(a) - depth(b) || a.id.localeCompare(b.id));
  const moved = new Map<string, Delta>();
  for (const b of ordered) {
    const inherited = b.parentId && byId.has(b.parentId) ? moved.get(b.parentId)! : { dx: 0, dy: 0 };
    const x = b.x + inherited.dx;
    const y = b.y + inherited.dy;
    const own = { dx: axis === 'y' ? 0 : snap(x) - x, dy: axis === 'x' ? 0 : snap(y) - y };
    moved.set(b.id, { dx: inherited.dx + own.dx, dy: inherited.dy + own.dy });
    deltas.set(b.id, own);
  }
  return changed(deltas);
}

/** The median: of an even number, the mean of the middle two, rounded. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** A box resized about its centre, then grown to hold `contents` (what is drawn in it, with its padding). */
function resized(b: Bounds, width: number, height: number, contents?: Bounds): Bounds {
  let next: Bounds = {
    x: round(b.x + b.width / 2 - width / 2),
    y: round(b.y + b.height / 2 - height / 2),
    width: round(width),
    height: round(height),
  };
  if (contents) next = boundingBox([next, contents]);
  return next;
}

function changedBounds(boxes: readonly ArrangeBox[], next: Map<string, Bounds>): Map<string, Bounds> {
  for (const b of boxes) {
    const n = next.get(b.id);
    if (n && n.x === b.x && n.y === b.y && n.width === b.width && n.height === b.height) next.delete(b.id);
  }
  return next;
}

/**
 * The boxes' widths, heights or both made the largest's, the smallest's or the median, each about its centre; a
 * container never smaller than what it holds (`contents`, by id).
 */
export function matchedBounds(
  boxes: readonly ArrangeBox[],
  reference: SizeReference,
  dimension: SizeDimension,
  contents: ReadonlyMap<string, Bounds> = new Map(),
): Map<string, Bounds> {
  const next = new Map<string, Bounds>();
  if (boxes.length < 2) return next;
  const pick = (values: number[]) =>
    reference === 'largest' ? Math.max(...values) : reference === 'smallest' ? Math.min(...values) : median(values);
  const width = pick(boxes.map((b) => b.width));
  const height = pick(boxes.map((b) => b.height));
  for (const b of boxes) {
    next.set(
      b.id,
      resized(b, dimension === 'height' ? b.width : width, dimension === 'width' ? b.height : height, contents.get(b.id)),
    );
  }
  return changedBounds(boxes, next);
}

/** Each box at its own default size (`defaultOf`), about its centre; a container never smaller than what it holds. */
export function defaultBounds(
  boxes: readonly ArrangeBox[],
  defaultOf: (box: ArrangeBox) => { width: number; height: number },
  contents: ReadonlyMap<string, Bounds> = new Map(),
): Map<string, Bounds> {
  const next = new Map<string, Bounds>();
  for (const b of boxes) {
    const size = defaultOf(b);
    next.set(b.id, resized(b, size.width, size.height, contents.get(b.id)));
  }
  return changedBounds(boxes, next);
}
