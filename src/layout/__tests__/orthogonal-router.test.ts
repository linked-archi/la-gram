import { describe, it, expect } from 'vitest';
import { routeOrthogonal, type Point, type RouterNode } from '../orthogonal-router.js';

const node = (id: string, x: number, y: number, width = 100, height = 50, parentId?: string): RouterNode => ({
  id,
  x,
  y,
  width,
  height,
  ...(parentId ? { parentId } : {}),
});

/** Every segment along an axis. */
const rightAngled = (points: Point[]) => points.every((p, i) => i === 0 || p.x === points[i - 1].x || p.y === points[i - 1].y);

/** Whether a route passes through a box's inside. */
function passesThrough(points: Point[], box: RouterNode): boolean {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
    const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
    if (lo.x < box.x + box.width && box.x < hi.x && lo.y < box.y + box.height && box.y < hi.y) return true;
    if (a.x === b.x && box.x < a.x && a.x < box.x + box.width && lo.y < box.y + box.height && box.y < hi.y) return true;
    if (a.y === b.y && box.y < a.y && a.y < box.y + box.height && lo.x < box.x + box.width && box.x < hi.x) return true;
  }
  return false;
}

describe('routes at right angles around the boxes', () => {
  it('a straight line between two boxes side by side, side to side', () => {
    const routes = routeOrthogonal([node('a', 0, 0), node('b', 300, 0)], [{ id: 'l', source: 'a', target: 'b' }]);
    expect(routes.get('l')).toEqual([{ x: 100, y: 25 }, { x: 300, y: 25 }]);
  });

  it('around a box in the way', () => {
    const blocker = node('c', 150, -40, 100, 130);
    const routes = routeOrthogonal([node('a', 0, 0), node('b', 400, 0), blocker], [{ id: 'l', source: 'a', target: 'b' }]);
    const route = routes.get('l')!;
    expect(rightAngled(route)).toBe(true);
    expect(passesThrough(route, blocker)).toBe(false);
    expect(route[0]).not.toEqual(route[route.length - 1]);
  });

  it('the fewest bends: an L between boxes offset both ways', () => {
    const route = routeOrthogonal([node('a', 0, 0), node('b', 300, 200)], [{ id: 'l', source: 'a', target: 'b' }]).get('l')!;
    expect(rightAngled(route)).toBe(true);
    expect(route.length).toBeLessThanOrEqual(4);
  });

  it('the same diagram routes the same', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 160), node('c', 180, 40), node('d', 60, 260)];
    const edges = [
      { id: 'l1', source: 'a', target: 'b' },
      { id: 'l2', source: 'd', target: 'b' },
      { id: 'l3', source: 'a', target: 'd' },
    ];
    expect(routeOrthogonal(nodes, edges)).toEqual(routeOrthogonal(nodes, [...edges].reverse()));
  });

  it('lines leaving one side of a box spread along it', () => {
    const routes = routeOrthogonal(
      [node('a', 0, 0, 100, 60), node('b', 300, -100), node('c', 300, 100)],
      [
        { id: 'l1', source: 'a', target: 'b' },
        { id: 'l2', source: 'a', target: 'c' },
      ],
    );
    const starts = ['l1', 'l2'].map((id) => routes.get(id)![0]);
    expect(starts[0]).not.toEqual(starts[1]);
    for (const id of ['l1', 'l2']) expect(rightAngled(routes.get(id)!)).toBe(true);
  });

  it('within a group, around what else is in it; none for a line from a group to what it holds', () => {
    const nodes = [node('g', 0, 0, 600, 300), node('a', 20, 100, 100, 50, 'g'), node('b', 460, 100, 100, 50, 'g'), node('x', 250, 80, 80, 90, 'g')];
    const routes = routeOrthogonal(nodes, [
      { id: 'l', source: 'a', target: 'b' },
      { id: 'in', source: 'g', target: 'a' },
    ]);
    expect(passesThrough(routes.get('l')!, nodes[3])).toBe(false);
    expect(routes.has('in')).toBe(false);
  });

  it('straight between boxes slightly out of line, at the point their facing sides share — no step', () => {
    const route = routeOrthogonal([node('a', 0, 0), node('b', 300, 14)], [{ id: 'l', source: 'a', target: 'b' }]).get('l')!;
    expect(route).toHaveLength(2);
    expect(route[0].y).toBe(route[1].y);
    // Between the two middles, 25 and 39.
    expect(route[0].y).toBe(32);
  });

  it('a small box beside a large one keeps its line at its middle; the large one takes it where it comes', () => {
    // The large box's middle is far below: halfway between the two would push the line to the small box's edge.
    const route = routeOrthogonal([node('small', 0, 0, 100, 50), node('large', 300, -20, 160, 400)], [{ id: 'l', source: 'small', target: 'large' }]).get('l')!;
    expect(route).toEqual([{ x: 100, y: 25 }, { x: 300, y: 25 }]);
  });

  it('no line pushed to a box\'s edge to run straight: where the overlap is at the edge, it docks at the middle and bends', () => {
    const route = routeOrthogonal([node('a', 0, 0, 100, 50), node('b', 300, 42, 100, 50)], [{ id: 'l', source: 'a', target: 'b' }]).get('l')!;
    expect(route[0]).toEqual({ x: 100, y: 25 });
    expect(route[route.length - 1]).toEqual({ x: 300, y: 67 });
  });

  it('a step bends in the middle of the gap, well clear of both boxes', () => {
    const route = routeOrthogonal([node('a', 0, 0), node('b', 300, 200)], [{ id: 'l', source: 'a', target: 'b' }]).get('l')!;
    const bends = route.slice(1, -1);
    const clear = (p: Point, b: RouterNode) => Math.max(b.x - p.x, p.x - b.x - b.width, b.y - p.y, p.y - b.y - b.height, 0);
    for (const p of bends) expect(Math.min(clear(p, node('a', 0, 0)), clear(p, node('b', 300, 200)))).toBeGreaterThanOrEqual(24);
    expect(bends.length).toBeLessThanOrEqual(2);
  });

  it('a line between boxes in one column runs straight down, from the middle of one to the middle of the other', () => {
    const route = routeOrthogonal([node('a', 0, 0), node('b', 0, 200)], [{ id: 'l', source: 'a', target: 'b' }]).get('l')!;
    expect(route).toEqual([{ x: 50, y: 50 }, { x: 50, y: 200 }]);
  });

  it('none for boxes that overlap', () => {
    expect(routeOrthogonal([node('a', 0, 0), node('b', 50, 20)], [{ id: 'l', source: 'a', target: 'b' }]).size).toBe(0);
  });
});
