/**
 * Where a straight line meets a shape's outline, computed (Task 22).
 *
 * diagram-js crops a connection against a shape by intersecting two SVG paths
 * in general — each turned into Bézier curves, intersected by subdivision —
 * which for a view of 10 000 shapes and 20 000 links drawn centre to centre was
 * 0.7 s. The outlines la-gram draws are mostly straight edges and circular or
 * elliptical arcs (rectangles, rounded rectangles, octagons, ellipses), and a
 * link is first drawn as one straight segment: their intersections are a line
 * against a line, or a line against an ellipse. {@link FastCroppingConnectionDocking}
 * computes them so, and chooses among them as diagram-js does
 * (`getElementLineIntersection`); an outline with any other command (a curve, a
 * rotated arc) or a connection of more than two points is left to diagram-js.
 */
import CroppingConnectionDocking from 'diagram-js/lib/layout/CroppingConnectionDocking.js';

export interface Point {
  x: number;
  y: number;
}

/** An intersection: where, and how far along the line (0 at its start, 1 at its end). */
export interface LineIntersection extends Point {
  t: number;
}

/**
 * Every point where the segment `a`–`b` crosses the outline, in the outline's
 * order — or `undefined` when the outline has a command other than `M`, `L`,
 * `H`, `V`, `Z` or an unrotated `A` (absolute or relative).
 */
export function lineOutlineIntersections(outline: string, a: Point, b: Point): LineIntersection[] | undefined {
  const tokens = outline.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];
  const hits: LineIntersection[] = [];
  let i = 0;
  let command = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const number = () => Number(tokens[i++]);
  const more = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const c = command.toUpperCase();
    if (c === 'Z') {
      lineHits(a, b, { x, y }, { x: startX, y: startY }, hits);
      x = startX;
      y = startY;
      if (!more()) continue;
      return undefined;
    }
    if (!more()) return undefined;
    if (c === 'M') {
      x = number() + (relative ? x : 0);
      y = number() + (relative ? y : 0);
      startX = x;
      startY = y;
      command = relative ? 'l' : 'L'; // further pairs are lines
    } else if (c === 'L' || c === 'H' || c === 'V') {
      const nx = c === 'V' ? x : number() + (relative ? x : 0);
      const ny = c === 'H' ? y : number() + (relative ? y : 0);
      lineHits(a, b, { x, y }, { x: nx, y: ny }, hits);
      x = nx;
      y = ny;
    } else if (c === 'A') {
      const rx = Math.abs(number());
      const ry = Math.abs(number());
      const rotation = number();
      const large = number() !== 0;
      const sweep = number() !== 0;
      const nx = number() + (relative ? x : 0);
      const ny = number() + (relative ? y : 0);
      if (rotation % 360 !== 0) return undefined;
      arcHits(a, b, { x, y }, { x: nx, y: ny }, rx, ry, large, sweep, hits);
      x = nx;
      y = ny;
    } else {
      return undefined;
    }
  }
  return hits;
}

/** Where `a`–`b` crosses the segment `p`–`q`. */
function lineHits(a: Point, b: Point, p: Point, q: Point, hits: LineIntersection[]): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const denominator = dx * ey - dy * ex;
  if (denominator === 0) return; // parallel, or a point
  const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / denominator;
  const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return;
  hits.push({ x: a.x + t * dx, y: a.y + t * dy, t });
}

/** Where `a`–`b` crosses the unrotated elliptical arc from `p` to `q` (SVG's endpoint form). */
function arcHits(a: Point, b: Point, p: Point, q: Point, rx0: number, ry0: number, large: boolean, sweep: boolean, hits: LineIntersection[]): void {
  if (rx0 === 0 || ry0 === 0) return lineHits(a, b, p, q, hits);
  // The centre (SVG 1.1, F.6.5), radii scaled up when too small (F.6.6).
  const x1 = (p.x - q.x) / 2;
  const y1 = (p.y - q.y) / 2;
  const scale = Math.max(1, Math.sqrt((x1 * x1) / (rx0 * rx0) + (y1 * y1) / (ry0 * ry0)));
  const rx = rx0 * scale;
  const ry = ry0 * scale;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const root = Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const sign = large === sweep ? -1 : 1;
  const cx = sign * root * ((rx * y1) / ry) + (p.x + q.x) / 2;
  const cy = sign * root * (-(ry * x1) / rx) + (p.y + q.y) / 2;
  const angle = (px: number, py: number) => Math.atan2((py - cy) / ry, (px - cx) / rx);
  const start = angle(p.x, p.y);
  let delta = angle(q.x, q.y) - start;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;

  // The line against the whole ellipse: ((x−cx)/rx)² + ((y−cy)/ry)² = 1.
  const dx = (b.x - a.x) / rx;
  const dy = (b.y - a.y) / ry;
  const ox = (a.x - cx) / rx;
  const oy = (a.y - cy) / ry;
  const A = dx * dx + dy * dy;
  const B = 2 * (ox * dx + oy * dy);
  const C = ox * ox + oy * oy - 1;
  const discriminant = B * B - 4 * A * C;
  if (A === 0 || discriminant < 0) return;
  const roots = discriminant === 0 ? [-B / (2 * A)] : [(-B - Math.sqrt(discriminant)) / (2 * A), (-B + Math.sqrt(discriminant)) / (2 * A)];
  for (const t of roots) {
    if (t < 0 || t > 1) continue;
    const hx = a.x + t * (b.x - a.x);
    const hy = a.y + t * (b.y - a.y);
    // On the arc: its angle within the sweep from the start.
    let along = angle(hx, hy) - start;
    if (delta >= 0) {
      while (along < 0) along += 2 * Math.PI;
      if (along > delta + 1e-9) continue;
    } else {
      while (along > 0) along -= 2 * Math.PI;
      if (along < delta - 1e-9) continue;
    }
    hits.push({ x: hx, y: hy, t });
  }
}

/**
 * The docking point diagram-js would choose of these intersections of a
 * one-segment connection (`getElementLineIntersection`): the only one; the
 * first of two less than a pixel apart; else by position along the line in
 * hundredths — the farthest for the start (`cropStart`), the nearest for the
 * end — rounded; `null` when there is none.
 */
export function chooseDocking(hits: readonly LineIntersection[], cropStart: boolean): Point | null {
  const round = (p: Point) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  if (hits.length === 0) return null;
  if (hits.length === 1) return round(hits[0]);
  if (hits.length === 2 && Math.hypot(hits[0].x - hits[1].x, hits[0].y - hits[1].y) < 1) return round(hits[0]);
  const key = (h: LineIntersection) => 100 - (Math.floor(h.t * 100) || 1);
  const sorted = hits.map((h, index) => ({ h, index })).sort((p, q) => key(p.h) - key(q.h) || p.index - q.index);
  return round((cropStart ? sorted[0] : sorted[sorted.length - 1]).h);
}

/** `CroppingConnectionDocking`, as far as the subclass uses it. */
const CroppingBase = CroppingConnectionDocking as unknown as {
  new (elementRegistry: unknown, graphicsFactory: unknown): {
    _getShapePath(shape: unknown): string;
    _getIntersection(shape: unknown, connection: { waypoints?: Point[] }, cropStart: boolean): Point | null;
  };
  $inject: string[];
};

/**
 * diagram-js's cropping, with a straight connection's docking points computed
 * against an outline of lines and arcs rather than intersected as curves.
 */
export class FastCroppingConnectionDocking extends CroppingBase {
  static $inject = ['elementRegistry', 'graphicsFactory'];

  override _getIntersection(shape: unknown, connection: { waypoints?: Point[] }, cropStart: boolean): Point | null {
    const waypoints = connection.waypoints;
    if (waypoints && waypoints.length === 2) {
      const hits = lineOutlineIntersections(this._getShapePath(shape), waypoints[0], waypoints[1]);
      if (hits) return chooseDocking(hits, cropStart);
    }
    return super._getIntersection(shape, connection, cropStart);
  }
}
