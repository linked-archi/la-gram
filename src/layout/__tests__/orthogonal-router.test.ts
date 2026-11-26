import { describe, it, expect } from 'vitest';
import { placeInOrder, routeOrthogonal, type Point, type RouterEdge, type RouterNode } from '../orthogonal-router.js';

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

/** Where a horizontal segment of one line crosses a vertical segment of another. */
function crossingsOf(routes: Map<string, Point[]>): Array<[string, string]> {
  const segments = [...routes.entries()].flatMap(([id, w]) => w.slice(1).map((q, i) => ({ id, p: w[i], q })));
  return segments
    .filter((h) => h.p.y === h.q.y)
    .flatMap((h) =>
      segments
        .filter(
          (v) => v.id !== h.id && v.p.x === v.q.x && v.p.x > Math.min(h.p.x, h.q.x) && v.p.x < Math.max(h.p.x, h.q.x) && h.p.y > Math.min(v.p.y, v.q.y) && h.p.y < Math.max(v.p.y, v.q.y),
        )
        .map((v): [string, string] => [h.id, v.id]),
    );
}

/** A tall box at the left, and a line from it to each of the boxes named with their top left corners. */
function fromTallBox(boxes: Array<[string, number, number]>): [RouterNode[], RouterEdge[]] {
  return [[node('a', 0, 0, 120, 600), ...boxes.map(([id, x, y]) => node(id, x, y))], boxes.map(([id]) => ({ id: `a-${id}`, source: 'a', target: id }))];
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

  it('goes over a box in the way with the fewest bends, and no further out than the gap it runs in', () => {
    const blocker = node('c', 250, 110, 60, 40);
    const route = routeOrthogonal([node('a', 0, 100), node('b', 500, 100), blocker], [{ id: 'l', source: 'a', target: 'b' }]).get('l')!;
    expect(passesThrough(route, blocker)).toBe(false);
    // From the top of one to the top of the other — two bends, where stepping round from the sides takes four.
    expect(route.length).toBe(4);
    expect(Math.min(...route.map((p) => p.y))).toBeGreaterThanOrEqual(100 - 72);
  });

  it('a line turning up docks above the straight lines on its side, so it crosses none of them', () => {
    // A tall box: a line running straight to B, one turning up to C, one straight to D lower down.
    const nodes = [node('a', 0, 0, 120, 300), node('b', 400, 120, 100, 50), node('c', 400, -200, 100, 50), node('d', 400, 250, 100, 50)];
    const routes = routeOrthogonal(nodes, [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'ac', source: 'a', target: 'c' },
      { id: 'ad', source: 'a', target: 'd' },
    ]);
    const segments = [...routes.values()].flatMap((w) => w.slice(1).map((q, i) => [w[i], q] as const));
    const crossings = segments.filter(([p, q]) => p.y === q.y).flatMap(([p, q]) =>
      segments.filter(([r, s]) => r.x === s.x && r.x > Math.min(p.x, q.x) && r.x < Math.max(p.x, q.x) && p.y > Math.min(r.y, s.y) && p.y < Math.max(r.y, s.y)),
    );
    expect(crossings).toHaveLength(0);
    expect(routes.get('ab')).toHaveLength(2);
    expect(routes.get('ac')![0].y).toBeLessThan(routes.get('ab')![0].y);
  });

  it('lines leaving one side cross none of the others leaving it, however far each runs before it turns', () => {
    // A tall box, and boxes up and to the right of it at several distances: each line runs out, then turns up.
    const nodes = [node('a', 0, 0, 120, 600), node('far', 520, 300, 100, 50), node('near', 260, 60, 100, 50), node('mid', 380, 180, 100, 50), node('low', 520, 560, 100, 50)];
    const edges = ['far', 'near', 'mid', 'low'].map((t) => ({ id: `a-${t}`, source: 'a', target: t }));
    expect(crossingsOf(routeOrthogonal(nodes, edges))).toHaveLength(0);
  });

  it('a line turning across a straight line that runs past its turn docks where it crosses none', () => {
    // To t0, up and to the right: it runs out, then turns down to t0's level — across the straight line to t3,
    // which runs further. It docks below t3's line and above t2's.
    const [nodes, edges] = fromTallBox([['t0', 652, 97], ['t1', 455, 455], ['t2', 288, 282], ['t3', 399, 132]]);
    expect(crossingsOf(routeOrthogonal(nodes, edges))).toHaveLength(0);
  });

  it('a straight line ending before a line turns does not hold it back: it docks beside it', () => {
    // To t0, far up: the straight line to t3 is nearer t0's level but ends before the line to t0 turns, so the line
    // to t0 docks between t3's and t1's — the long one it would cross — not beyond t3's.
    const [nodes, edges] = fromTallBox([['t0', 666, 35], ['t1', 622, 133], ['t2', 203, 552], ['t3', 239, 55]]);
    expect(crossingsOf(routeOrthogonal(nodes, edges))).toHaveLength(0);
  });

  it('no two lines dock at one point of a side and leave along each other', () => {
    // Diagrams of 12 to 20 boxes on a loose grid, a fifth of them large, and 15 to 30 lines between random pairs.
    let seed = 11;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let together = 0;
    for (let c = 0; c < 150; c++) {
      const count = 12 + Math.floor(random() * 9);
      const cells = new Set<number>();
      while (cells.size < count) cells.add(Math.floor(random() * 36));
      const nodes = [...cells].map((cell, k) => {
        const large = random() < 0.2;
        return node(`n${k}`, (cell % 6) * 200 + Math.round(random() * 30), Math.floor(cell / 6) * 150 + Math.round(random() * 30), large ? 140 : 100, large ? 90 : 50);
      });
      const edges: RouterEdge[] = [];
      const seen = new Set<string>();
      const lines = 15 + Math.floor(random() * 16);
      for (let j = 0; j < lines; j++) {
        const [s, t] = [Math.floor(random() * count), Math.floor(random() * count)];
        if (s === t || seen.has(`${s} ${t}`)) continue;
        seen.add(`${s} ${t}`);
        edges.push({ id: `l${j}`, source: `n${s}`, target: `n${t}` });
      }
      const firsts = [...routeOrthogonal(nodes, edges)].flatMap(([id, w]) => [
        { id, p: w[0], q: w[1] },
        { id, p: w[w.length - 1], q: w[w.length - 2] },
      ]);
      for (const [i, f] of firsts.entries()) {
        together += firsts.slice(i + 1).filter((g) => g.id !== f.id && g.p.x === f.p.x && g.p.y === f.p.y && (g.q.x === f.q.x) === (f.p.x === f.q.x) && (g.q.y === f.q.y) === (f.p.y === f.q.y)).length;
      }
    }
    expect(together).toBe(0);
  });

  it('none for boxes that overlap', () => {
    expect(routeOrthogonal([node('a', 0, 0), node('b', 50, 20)], [{ id: 'l', source: 'a', target: 'b' }]).size).toBe(0);
  });
});

/** Whether two routes run along each other somewhere: a segment of one on a segment of the other, overlapping. */
function alongEachOther(a: Point[], b: Point[]): boolean {
  const segments = (w: Point[]) => w.slice(1).map((q, i) => ({ p: w[i], q }));
  return segments(a).some(({ p, q }) =>
    segments(b).some(({ p: r, q: s }) => {
      if (p.y === q.y && r.y === s.y && p.y === r.y) return Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)) < Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x));
      if (p.x === q.x && r.x === s.x && p.x === r.x) return Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)) < Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y));
      return false;
    }),
  );
}

describe('kept lines: routed around, never moved (LS-DD-2)', () => {
  it('a line docks off the point a kept line docks at, and runs beside it', () => {
    const nodes = [node('a', 0, 0), node('b', 300, 0)];
    const kept = [{ id: 'k', source: 'a', target: 'b', points: [{ x: 100, y: 25 }, { x: 300, y: 25 }] }];
    const routes = routeOrthogonal(nodes, [{ id: 'l', source: 'a', target: 'b' }], undefined, kept);
    const route = routes.get('l')!;
    expect(route).toHaveLength(2);
    expect(Math.abs(route[0].y - 25)).toBeGreaterThanOrEqual(12);
    expect(route[0].y).toBe(route[1].y);
  });

  it('docks beside a kept line that turns the same way sooner, on the side where neither crosses the other', () => {
    const nodes = [node('g', 0, 0), node('d', 300, 200), node('o', 0, 100)];
    // Out of d's top, turning left to o: as the router itself routes it.
    const points = [{ x: 350, y: 200 }, { x: 350, y: 125 }, { x: 100, y: 125 }];
    expect(routeOrthogonal(nodes, [{ id: 'k', source: 'd', target: 'o' }]).get('k')).toEqual(points);
    const route = routeOrthogonal(nodes, [{ id: 'l', source: 'd', target: 'g' }], undefined, [{ id: 'k', source: 'd', target: 'o', points }]).get('l')!;
    // Alone, it would leave d's top at its middle too; beside the kept line, further along, it turns later.
    expect(route[0]).toEqual({ x: 362, y: 200 });
    expect(crossingsOf(new Map([['l', route], ['k', points]]))).toEqual([]);
  });

  it('crosses no kept line where another shape crosses none', () => {
    const nodes = [node('a', 0, 0), node('b', 300, 200)];
    const edge = { id: 'l', source: 'a', target: 'b' };
    // One across the L that runs right then down, one across the L that runs down then right: either way, the other.
    for (const points of [
      [{ x: 200, y: 120 }, { x: 500, y: 120 }],
      [{ x: 200, y: 150 }, { x: 200, y: 300 }],
    ]) {
      const route = routeOrthogonal(nodes, [edge], undefined, [{ id: 'k', points }]).get('l')!;
      expect(rightAngled(route)).toBe(true);
      expect(crossingsOf(new Map([['l', route], ['k', points]]))).toEqual([]);
    }
  });

  it('a step through a gap a kept line takes runs beside it, and docks apart from it at both ends', () => {
    const nodes = [node('a', 0, 0), node('b', 300, 42)];
    const edge = { id: 'l', source: 'a', target: 'b' };
    const first = routeOrthogonal(nodes, [edge]).get('l')!;
    // A step, its middle segment in the middle of the gap.
    expect(first.length).toBe(4);
    const route = routeOrthogonal(nodes, [edge], undefined, [{ id: 'k', source: 'a', target: 'b', points: first }]).get('l')!;
    expect(rightAngled(route)).toBe(true);
    expect(alongEachOther(route, first)).toBe(false);
    expect(route[0]).not.toEqual(first[0]);
    expect(route[route.length - 1]).not.toEqual(first[first.length - 1]);
  });

  it('a kept line is neither routed nor moved, and is not in the answer', () => {
    const nodes = [node('a', 0, 0), node('b', 300, 0), node('c', 0, 200)];
    const points = [{ x: 100, y: 25 }, { x: 300, y: 25 }];
    const kept = [{ id: 'k', source: 'a', target: 'b', points }];
    const routes = routeOrthogonal(nodes, [{ id: 'l', source: 'a', target: 'c' }], undefined, kept);
    expect([...routes.keys()]).toEqual(['l']);
    expect(points).toEqual([{ x: 100, y: 25 }, { x: 300, y: 25 }]);
  });
});

describe('places in order along a side', () => {
  const free = (place: number) => ({ place, lower: -Infinity, upper: Infinity });

  it('apart about where they all want to be, in their order', () => {
    expect(placeInOrder([free(100), free(100), free(100)], 12)).toEqual([88, 100, 112]);
  });

  it('where they are, when that is far enough apart', () => {
    expect(placeInOrder([free(10), free(40), free(41)], 12)).toEqual([10, 34.5, 46.5]);
  });

  it('within its bounds, the others pushed on', () => {
    expect(placeInOrder([{ place: 100, lower: 100, upper: 110 }, free(100)], 12)).toEqual([100, 112]);
  });

  it('where the bounds leave no room for the order, the bounds win', () => {
    expect(placeInOrder([{ place: 0, lower: 0, upper: 5 }, { place: 0, lower: 0, upper: 5 }], 12)).toEqual([0, 5]);
  });
});
