import { describe, it, expect } from 'vitest';
import { planView, placeNodes, type ConceptKinds } from '../view-from-results.js';

/** a, b, c are elements; r1: a → b, r2: b → c, r3: a → r1 (to a relationship). */
const kinds: ConceptKinds = {
  isElement: (iri) => ['a', 'b', 'c'].includes(iri),
  endsOf: (iri) =>
    ({ r1: { source: 'a', target: 'b' }, r2: { source: 'b', target: 'c' }, r3: { source: 'a', target: 'r1' } })[iri],
};

describe('planView', () => {
  it('keeps the elements and the relationships between elements, in the order mentioned', () => {
    expect(planView(['c', 'type', 'r1', 'a', 'r3', 'literal'], kinds)).toEqual({ elements: ['c', 'a', 'b'], relationships: ['r1'] });
  });

  it('brings a relationship’s ends along', () => {
    expect(planView(['r2'], kinds)).toEqual({ elements: ['b', 'c'], relationships: ['r2'] });
  });

  it('finds nothing in what is not the model’s', () => {
    expect(planView(['x', 'r3'], kinds)).toEqual({ elements: [], relationships: [] });
  });
});

describe('placeNodes', () => {
  const size = (iri: string) => (iri === 'j' ? { width: 15, height: 15 } : { width: 120, height: 55 });

  it('turns centres into bounds at each node’s size, spread, from the origin', () => {
    const centres = new Map([
      ['a', { x: -100, y: -50 }],
      ['b', { x: 100, y: -50 }],
      ['j', { x: 0, y: 50 }],
    ]);
    const bounds = placeNodes(['a', 'b', 'j'], centres, size, { spread: 2 });
    expect(bounds.get('a')).toEqual({ x: 40, y: 40, width: 120, height: 55 });
    expect(bounds.get('b')).toEqual({ x: 440, y: 40, width: 120, height: 55 });
    // The small node keeps its size, centred where it was laid out.
    // (0, 100) spread, less half of 15, from the left edge at -260 and the top at -127.5.
    expect(bounds.get('j')).toEqual({ x: 293, y: 260, width: 15, height: 15 });
  });

  it('puts a node the layout missed in a row below the rest', () => {
    const bounds = placeNodes(['a', 'b'], new Map([['a', { x: 0, y: 0 }]]), size);
    expect(bounds.get('a')).toEqual({ x: 40, y: 40, width: 120, height: 55 });
    expect(bounds.get('b')).toEqual({ x: 200, y: 40 + 55 + 60, width: 120, height: 55 });
  });
});
