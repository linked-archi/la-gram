import { describe, it, expect } from 'vitest';
import { layoutPositions } from '../graph-view.js';

describe('layoutPositions', () => {
  it('lays out an undrawn graph without overlapping nodes', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
    const edges = [
      { id: 'r1', source: 'a', target: 'b' },
      { id: 'r2', source: 'a', target: 'c' },
      { id: 'r3', source: 'c', target: 'd' },
      { id: 'r4', source: 'e', target: 'a' },
    ];
    for (const layout of ['tree', 'rings', 'force'] as const) {
      const at = layoutPositions(nodes, edges, { layout, rootId: 'a', width: 120, height: 55 });
      expect([...at.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      // Force is randomised and may touch; the layered layouts must not.
      if (layout === 'force') continue;
      const boxes = [...at.values()];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const apart = Math.abs(boxes[i].x - boxes[j].x) >= 120 || Math.abs(boxes[i].y - boxes[j].y) >= 55;
          expect(apart, `${layout}: ${i} and ${j} overlap`).toBe(true);
        }
    }
  });

  it('needs no root, and copes with nothing', () => {
    expect(layoutPositions([{ id: 'a' }, { id: 'b' }], [{ id: 'r', source: 'a', target: 'b' }], { layout: 'tree', width: 120, height: 55 }).size).toBe(2);
    expect(layoutPositions([], [], { layout: 'tree', width: 120, height: 55 }).size).toBe(0);
  });
});
