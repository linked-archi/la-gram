/**
 * A straight connection's docking points, computed against an outline of lines
 * and arcs (Task 22), are diagram-js's — which intersects the two paths as
 * curves — for every outline la-gram draws natively.
 */
import { describe, it, expect } from 'vitest';
import { getElementLineIntersection } from 'diagram-js/lib/layout/LayoutUtil.js';
import { SHAPE_TYPES, shapePath } from '../notation-shapes.js';
import { chooseDocking, lineOutlineIntersections, type Point } from '../straight-docking.js';

/** A small seeded random number generator: the same cases each run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const line = (a: Point, b: Point) => `M${a.x},${a.y}L${b.x},${b.y}`;
const theirs = (outline: string, a: Point, b: Point, cropStart: boolean) =>
  getElementLineIntersection(outline, line(a, b), cropStart) as Point | null;
const ours = (outline: string, a: Point, b: Point, cropStart: boolean) => {
  const hits = lineOutlineIntersections(outline, a, b);
  expect(hits).toBeDefined();
  return chooseDocking(hits!, cropStart);
};

describe('docking a straight connection', () => {
  it.each(SHAPE_TYPES)('%s: where diagram-js docks it, from the centre and to it, at any angle', (type) => {
    const next = random(type.length * 7919);
    let compared = 0;
    for (const [w, h] of [[120, 55], [60, 60], [200, 80], [40, 100]]) {
      const x = 300;
      const y = 200;
      const outline = shapePath(type, x, y, w, h);
      const centre = { x: x + w / 2, y: y + h / 2 };
      for (let k = 0; k < 40; k++) {
        const angle = next() * 2 * Math.PI;
        const far = { x: Math.round(centre.x + Math.cos(angle) * 400), y: Math.round(centre.y + Math.sin(angle) * 400) };
        for (const [a, b, cropStart] of [[centre, far, true], [far, centre, false]] as const) {
          const expected = theirs(outline, a, b, cropStart);
          const actual = ours(outline, a, b, cropStart);
          // diagram-js intersects curves numerically; a rounded pixel may differ.
          expect(actual).not.toBeNull();
          expect(Math.abs(actual!.x - expected!.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(actual!.y - expected!.y)).toBeLessThanOrEqual(1);
          compared++;
        }
      }
    }
    expect(compared).toBe(320);
  });

  it('reads relative commands, H and V, more than one subpath; finds nothing where the line does not cross', () => {
    const square = 'm10,10 h100 v100 h-100 z';
    expect(ours(square, { x: 60, y: 60 }, { x: 260, y: 60 }, true)).toEqual({ x: 110, y: 60 });
    expect(ours(square, { x: 260, y: 60 }, { x: 60, y: 60 }, false)).toEqual({ x: 110, y: 60 });
    expect(ours('M0,0L10,0L10,10Z M100,0L110,0L110,10Z', { x: 5, y: -5 }, { x: 5, y: 20 }, true)).not.toBeNull();
    expect(ours(square, { x: 300, y: 300 }, { x: 400, y: 400 }, true)).toBeNull();
  });

  it('leaves an outline with a curve, or a rotated arc, to diagram-js', () => {
    expect(lineOutlineIntersections('M0,0C10,10 20,10 30,0Z', { x: 0, y: 0 }, { x: 10, y: 10 })).toBeUndefined();
    expect(lineOutlineIntersections('M0,0A10,5 30 0 1 20,0Z', { x: 0, y: 0 }, { x: 10, y: 10 })).toBeUndefined();
  });
});
