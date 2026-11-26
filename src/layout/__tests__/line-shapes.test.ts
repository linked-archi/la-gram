/**
 * The elbows of *Line shape* (Req 22.9; LS-4): one bend at the corner of the two centres, out of the source along the
 * axis chosen; straight between placements side by side or one above the other; none for placements that overlap.
 */

import { describe, it, expect } from 'vitest';
import { elbowRoute, LINE_SHAPES } from '../line-shapes.js';

const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

describe('elbowRoute', () => {
  // The source below and to the right of the target, as a line from a detail up to what it specialises.
  const source = box(300, 200);
  const target = box(0, 0);

  it('horizontal first: out of the source sideways, into the target from below, at the middles of the sides', () => {
    expect(elbowRoute(source, target, 'horizontal')).toEqual([
      { x: 300, y: 225 },
      { x: 50, y: 225 },
      { x: 50, y: 50 },
    ]);
  });

  it('vertical first: out of the source upwards, into the target from the side', () => {
    expect(elbowRoute(source, target, 'vertical')).toEqual([
      { x: 350, y: 200 },
      { x: 350, y: 25 },
      { x: 100, y: 25 },
    ]);
  });

  it('the other way round, the target below and to the right', () => {
    expect(elbowRoute(target, source, 'horizontal')).toEqual([
      { x: 100, y: 25 },
      { x: 350, y: 25 },
      { x: 350, y: 200 },
    ]);
  });

  it('an L wherever its corner is outside both, though their widths overlap a little', () => {
    // The target's centre is beyond the source's right side; the source's centre above the target.
    expect(elbowRoute(box(0, 0), box(80, 200), 'horizontal')).toEqual([
      { x: 100, y: 25 },
      { x: 130, y: 25 },
      { x: 130, y: 200 },
    ]);
  });

  it('side by side, where the corner would be inside one: straight across, at the middle of the smaller one', () => {
    const small = box(0, 20, 100, 40);
    const tall = box(300, 0, 100, 200);
    // The small one's middle is level with the tall one: no corner outside both.
    expect(elbowRoute(small, tall, 'horizontal')).toEqual([{ x: 100, y: 40 }, { x: 300, y: 40 }]);
    expect(elbowRoute(tall, small, 'vertical')).toEqual([{ x: 300, y: 40 }, { x: 100, y: 40 }]);
    // Where a corner fits, an L all the same: down out of the small one, into the tall one's side.
    expect(elbowRoute(small, tall, 'vertical')).toEqual([{ x: 50, y: 60 }, { x: 50, y: 100 }, { x: 300, y: 100 }]);
  });

  it('one above the other, where the corner would be inside one: straight down', () => {
    expect(elbowRoute(box(0, 0), box(40, 200), 'vertical')).toEqual([{ x: 50, y: 50 }, { x: 50, y: 200 }]);
    // Of two the same size, at the source's middle.
    expect(elbowRoute(box(40, 200), box(0, 0), 'horizontal')).toEqual([{ x: 90, y: 200 }, { x: 90, y: 50 }]);
  });

  it('none for placements that overlap, or one inside the other', () => {
    expect(elbowRoute(box(0, 0), box(50, 20), 'horizontal')).toBeUndefined();
    expect(elbowRoute(box(0, 0, 400, 300), box(50, 50), 'vertical')).toBeUndefined();
  });

  it('the four shapes in the menus’ order', () => {
    expect(LINE_SHAPES.map((s) => s.label)).toEqual(['Straight', 'Right angles', 'Horizontal first', 'Vertical first']);
  });
});
