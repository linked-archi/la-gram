/**
 * How far from its focus node a shapes graph reads (Task 22).
 */
import { describe, it, expect } from 'vitest';
import { Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import { shapesReach } from '../shape-reach.js';

const PREFIXES = `
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix ex: <https://ex.org/> .
`;
const reach = (ttl: string) => shapesReach(new Parser().parse(PREFIXES + ttl) as unknown as Quad[]);

describe('the reach of shapes', () => {
  it('a node shape on its focus node alone: 0; a property: 1; a class on the values: still 1', () => {
    expect(reach(`ex:S a sh:NodeShape ; sh:targetClass ex:A ; sh:class ex:A .`).hops).toBe(0);
    expect(reach(`ex:S a sh:NodeShape ; sh:property [ sh:path ex:p ; sh:minCount 1 ] .`).hops).toBe(1);
    expect(reach(`ex:S a sh:NodeShape ; sh:property [ sh:path ex:p ; sh:class ex:B ] .`)).toEqual({ hops: 1, inverse: false, recursive: false, valuesAsFocus: false });
  });

  it('a sequence path adds up; alternatives take the longest; a shape on the values adds its own', () => {
    expect(reach(`ex:S sh:property [ sh:path ( ex:p ex:q ex:r ) ] .`).hops).toBe(3);
    expect(reach(`ex:S sh:property [ sh:path [ sh:alternativePath ( ex:p ( ex:q ex:r ) ) ] ] .`).hops).toBe(2);
    expect(reach(`ex:S sh:property [ sh:path ex:p ; sh:node ex:T ] . ex:T sh:property [ sh:path ex:q ; sh:class ex:C ] .`).hops).toBe(2);
    expect(reach(`ex:S sh:property [ sh:path ex:p ; sh:or ( [ sh:class ex:A ] [ sh:node ex:T ] ) ] . ex:T sh:property [ sh:path ( ex:q ex:r ) ] .`).hops).toBe(3);
  });

  it('a backward path is noted; a path of any length, or a shape nested in itself, has no bound', () => {
    expect(reach(`ex:S sh:property [ sh:path [ sh:inversePath ex:p ] ] .`)).toMatchObject({ hops: 1, inverse: true });
    expect(reach(`ex:S sh:property [ sh:path [ sh:zeroOrMorePath ex:p ] ] .`).hops).toBe(Infinity);
    expect(reach(`ex:S a sh:NodeShape ; sh:property [ sh:path ex:p ; sh:node ex:S ] .`)).toMatchObject({ hops: Infinity, recursive: true });
  });

  it('a property shape with a property of its own reports with the value as the focus node', () => {
    expect(reach(`ex:S sh:property [ sh:path ex:p ; sh:property [ sh:path ex:q ; sh:minCount 1 ] ] .`)).toMatchObject({ hops: 2, valuesAsFocus: true });
  });
});
