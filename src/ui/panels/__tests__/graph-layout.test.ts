import { describe, it, expect } from 'vitest';
import { layoutPositions } from '../graph-view.js';

describe('layoutPositions', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
  const edges = [
    { id: 'r1', source: 'a', target: 'b' },
    { id: 'r2', source: 'a', target: 'c' },
    { id: 'r3', source: 'c', target: 'd' },
    { id: 'r4', source: 'e', target: 'a' },
  ];

  it('lays out an undrawn graph without overlapping nodes', () => {
    for (const layout of ['tree', 'rings', 'force'] as const) {
      const at = layoutPositions(nodes, edges, { layout, rootId: 'a', width: 120, height: 55 });
      expect([...at.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      const boxes = [...at.values()];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const apart = Math.abs(boxes[i].x - boxes[j].x) >= 120 || Math.abs(boxes[i].y - boxes[j].y) >= 55;
          expect(apart, `${layout}: ${i} and ${j} overlap`).toBe(true);
        }
    }
  });

  it('lays out force the same each time, round the root at (0, 0), and changes none of what it is given', () => {
    const copy = structuredClone({ nodes, edges });
    const one = layoutPositions(nodes, edges, { layout: 'force', rootId: 'a', width: 120, height: 55 });
    const two = layoutPositions(nodes, edges, { layout: 'force', rootId: 'a', width: 120, height: 55 });
    expect(Object.fromEntries(two)).toEqual(Object.fromEntries(one));
    expect(one.get('a')).toEqual({ x: 0, y: 0 });
    expect({ nodes, edges }).toEqual(copy);
    for (const e of edges) {
      expect([typeof e.source, typeof e.target]).toEqual(['string', 'string']);
      expect('index' in e).toBe(false);
    }
    for (const n of nodes) expect('index' in n).toBe(false);
  });

  it('needs no root, and copes with nothing', () => {
    for (const layout of ['tree', 'force'] as const) {
      expect(layoutPositions([{ id: 'a' }, { id: 'b' }], [{ id: 'r', source: 'a', target: 'b' }], { layout, width: 120, height: 55 }).size).toBe(2);
      expect(layoutPositions([], [], { layout, width: 120, height: 55 }).size).toBe(0);
    }
  });
});
