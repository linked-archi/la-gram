/**
 * What is drawn above what (`rdf-ordering.ts`): lines above shapes; shapes in their drawing order (core-vis 0.10),
 * where they are added, moved and re-sorted; a new placement in front of what it overlaps (DO-4).
 */

import { describe, it, expect } from 'vitest';
import { inFront, shapeIndex, sortShapes } from '../rdf-ordering.js';

const shape = (nodeIri: string, zOrder?: number) => ({ id: nodeIri, businessObject: { iri: nodeIri, nodeIri, kind: 'element', ...(zOrder ? { zOrder } : {}) } });
const line = (id: string) => ({ id, waypoints: [] });

describe('shapeIndex', () => {
  it('a shape goes among the shapes by drawing order — zOrder, then IRI — before the first line', () => {
    const parent = { children: [shape('a'), shape('c'), shape('z', 2), line('l1')] };
    expect(shapeIndex(parent, shape('b'))).toBe(1);
    expect(shapeIndex(parent, shape('y', 1))).toBe(2);
    // Above every shape: still under the lines.
    expect(shapeIndex(parent, shape('top', 5))).toBe(3);
    // No line: last.
    expect(shapeIndex({ children: [shape('a')] }, shape('b'))).toBeUndefined();
  });

  it('a shape already there is not counted; a line goes after the shapes, a label stays as it was', () => {
    const b = shape('b');
    expect(shapeIndex({ children: [shape('a'), b, shape('c'), line('l1')] }, b)).toBe(1);
    expect(shapeIndex({ children: [shape('a'), line('l1')] })).toBe(1);
  });
});

describe('sortShapes', () => {
  it('puts the shapes back in order in the places shapes held, the lines where they were; says which moved', () => {
    const [a, b, c] = [shape('a', 3), shape('b'), shape('c', 1)];
    const l = line('l1');
    const parent = { children: [a, b, c, l] };
    // Each of the three is in another place now.
    expect(sortShapes(parent).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(parent.children.map((s) => s.id)).toEqual(['b', 'c', 'a', 'l1']);
    expect(sortShapes(parent)).toEqual([]);
  });
});

describe('inFront (DO-4)', () => {
  const node = (nodeIri: string, x: number, zOrder?: number, parentNodeIri?: string) => ({
    nodeIri,
    ...(zOrder ? { zOrder } : {}),
    ...(parentNodeIri ? { parentNodeIri } : {}),
    bounds: { x, y: 0, width: 100, height: 50 },
  });

  it('a new placement under one it overlaps goes to the front of its place; over nothing, nothing is written', () => {
    const nodes = [node('a', 0, 4), node('b', 50, 2), node('new', 60), node('far', 500)];
    expect([...inFront(nodes, new Set(['new']))]).toEqual([['new', 5]]);
    expect(inFront(nodes, new Set(['far'])).size).toBe(0);
  });

  it('only among the placements in its place: a container’s contents are another place', () => {
    const nodes = [node('top', 0, 9), node('inside', 10, undefined, 'box'), node('box-sibling', 20, 1, 'box')];
    expect([...inFront(nodes, new Set(['inside']))]).toEqual([['inside', 2]]);
  });
});
