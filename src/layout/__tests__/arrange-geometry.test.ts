import { describe, it, expect } from 'vitest';
import {
  alignDeltas,
  defaultBounds,
  distributeDeltas,
  gridDeltas,
  matchedBounds,
  median,
  outermost,
  type ArrangeBox,
} from '../arrange-geometry.js';

const box = (id: string, x: number, y: number, width = 100, height = 50, parentId?: string): ArrangeBox => ({
  id,
  x,
  y,
  width,
  height,
  ...(parentId ? { parentId } : {}),
});

describe('align', () => {
  const boxes = [box('a', 10, 0, 100, 50), box('b', 200, 80, 60, 30), box('c', 400, 30, 120, 70)];

  it('left, centre and right to the bounding box', () => {
    expect(alignDeltas(boxes, 'left')).toEqual(new Map([['b', { dx: -190, dy: 0 }], ['c', { dx: -390, dy: 0 }]]));
    // The bounding box runs from 10 to 520: its centre is 265.
    expect(alignDeltas(boxes, 'center').get('a')).toEqual({ dx: 205, dy: 0 });
    expect(alignDeltas(boxes, 'right').get('b')).toEqual({ dx: 260, dy: 0 });
    expect(alignDeltas(boxes, 'right').has('c')).toBe(false);
  });

  it('top, middle and bottom likewise', () => {
    expect(alignDeltas(boxes, 'top')).toEqual(new Map([['b', { dx: 0, dy: -80 }], ['c', { dx: 0, dy: -30 }]]));
    expect(alignDeltas(boxes, 'bottom').get('a')).toEqual({ dx: 0, dy: 60 });
    expect(alignDeltas(boxes, 'middle').get('b')).toEqual({ dx: 0, dy: -40 });
  });

  it('needs two', () => {
    expect(alignDeltas([boxes[0]], 'left').size).toBe(0);
  });
});

describe('distribute', () => {
  it('equal gaps, the first and the last staying', () => {
    const deltas = distributeDeltas([box('a', 0, 0), box('b', 130, 0), box('c', 400, 0)], 'horizontal');
    // Span 0–500, boxes 300 together: gaps of 100, so b goes to 200.
    expect(deltas).toEqual(new Map([['b', { dx: 70, dy: 0 }]]));
  });

  it('vertically, in the order of the centres whatever the order given', () => {
    const deltas = distributeDeltas([box('c', 0, 300), box('a', 0, 0), box('b', 0, 50)], 'vertical');
    expect(deltas).toEqual(new Map([['b', { dx: 0, dy: 100 }]]));
  });

  it('equal centre distances where the boxes are longer together than the span', () => {
    const deltas = distributeDeltas([box('a', 0, 0), box('b', 20, 0), box('c', 120, 0)], 'horizontal');
    expect(deltas).toEqual(new Map([['b', { dx: 40, dy: 0 }]]));
  });

  it('needs three', () => {
    expect(distributeDeltas([box('a', 0, 0), box('b', 300, 0)], 'horizontal').size).toBe(0);
  });
});

describe('the grid', () => {
  it('the top-left corner to the nearest line, on x, y or both', () => {
    const boxes = [box('a', 13, 27), box('b', 40, 31)];
    expect(gridDeltas(boxes, 'both', 20)).toEqual(new Map([['a', { dx: 7, dy: -7 }], ['b', { dx: 0, dy: 9 }]]));
    expect(gridDeltas(boxes, 'x', 20)).toEqual(new Map([['a', { dx: 7, dy: 0 }]]));
    expect(gridDeltas(boxes, 'y', 10)).toEqual(new Map([['a', { dx: 0, dy: 3 }], ['b', { dx: 0, dy: -1 }]]));
  });

  it('what is drawn in a container from where moving the container put it', () => {
    const deltas = gridDeltas([box('inner', 33, 33, 50, 30, 'outer'), box('outer', 13, 13, 300, 200)], 'both', 20);
    // The container moves by (7, 7), taking the inner box to (40, 40): on the grid already.
    expect(deltas).toEqual(new Map([['outer', { dx: 7, dy: 7 }]]));
    expect([...gridDeltas([box('inner', 35, 35, 50, 30, 'outer'), box('outer', 13, 13, 300, 200)], 'both', 20).keys()]).toEqual(['outer', 'inner']);
  });
});

describe('sizes', () => {
  const boxes = [box('a', 0, 0, 100, 40), box('b', 200, 0, 140, 60), box('c', 400, 0, 120, 80)];

  it('the median: of an even number, the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([100, 140])).toBe(120);
  });

  it('largest, smallest and median, about each box\'s centre', () => {
    const largest = matchedBounds(boxes, 'largest', 'both');
    expect(largest.get('a')).toEqual({ x: -20, y: -20, width: 140, height: 80 });
    expect(matchedBounds(boxes, 'smallest', 'width').get('b')).toEqual({ x: 220, y: 0, width: 100, height: 60 });
    expect(matchedBounds(boxes, 'median', 'height').get('a')).toEqual({ x: 0, y: -10, width: 100, height: 60 });
    expect(matchedBounds(boxes, 'median', 'height').has('b')).toBe(false);
  });

  it('a container never smaller than what it holds', () => {
    const contents = new Map([['c', { x: 390, y: -10, width: 140, height: 100 }]]);
    expect(matchedBounds(boxes, 'smallest', 'both', contents).get('c')).toEqual({ x: 390, y: -10, width: 140, height: 100 });
  });

  it('each to its own default', () => {
    const next = defaultBounds(boxes, (b) => (b.id === 'a' ? { width: 100, height: 40 } : { width: 120, height: 55 }));
    expect(next.has('a')).toBe(false);
    expect(next.get('b')).toEqual({ x: 210, y: 3, width: 120, height: 55 });
  });
});

it('the outermost: a box in a selected container moves with it', () => {
  expect(outermost([box('outer', 0, 0), box('inner', 10, 10, 20, 20, 'outer'), box('other', 200, 0)]).map((b) => b.id)).toEqual(['outer', 'other']);
});
