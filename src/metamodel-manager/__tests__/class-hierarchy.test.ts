import { describe, it, expect } from 'vitest';
import { Parser, Store } from 'n3';
import {
  NOTATION_ROOTS,
  buildSuperClassMap,
  closureOf,
  compareIris,
  superClassesNearestFirst,
} from '../class-hierarchy.js';

function storeFromTurtle(...parts: string[]): Store {
  const parser = new Parser();
  const store = new Store();
  for (const ttl of parts) store.addQuads(parser.parse(ttl));
  return store;
}

const ARCH = 'https://meta.linked.archi/core#';
const EX = 'https://example.org/h#';
const ELEMENT = `${ARCH}Element`;
const RELATIONSHIP = `${ARCH}QualifiedRelationship`;
const MODEL_CONCEPT = `${ARCH}ModelConcept`;

const PREFIXES = `
  @prefix owl:  <http://www.w3.org/2002/07/owl#> .
  @prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix arch: <${ARCH}> .
  @prefix ex:   <${EX}> .
`;

/**
 * A diamond under arch:Element, with the parents declared in reverse IRI order
 * (B before A) so store order and IRI order disagree, a deeper chain, a cycle,
 * and arch:Element ⊑ arch:ModelConcept as the core ontology has it.
 */
const HIERARCHY = `${PREFIXES}
  arch:Element rdfs:subClassOf arch:ModelConcept .
  arch:QualifiedRelationship rdfs:subClassOf arch:ModelConcept .

  ex:P rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:B rdf:type owl:Class ; rdfs:subClassOf ex:P .
  ex:A rdf:type owl:Class ; rdfs:subClassOf ex:P .
  ex:C rdf:type owl:Class ; rdfs:subClassOf ex:B , ex:A .

  # ex:Near ⊑ ex:Z (distance 1) and ex:Near ⊑ ex:M ⊑ ex:A2 (distance 2): A2 < Z by IRI,
  # but distance wins.
  ex:Z rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:A2 rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:M rdf:type owl:Class ; rdfs:subClassOf ex:A2 .
  ex:Near rdf:type owl:Class ; rdfs:subClassOf ex:M , ex:Z .

  ex:X rdf:type owl:Class ; rdfs:subClassOf ex:Y .
  ex:Y rdf:type owl:Class ; rdfs:subClassOf ex:X .

  ex:Link rdf:type owl:Class ; rdfs:subClassOf arch:QualifiedRelationship .
  ex:SubLink rdf:type owl:Class ; rdfs:subClassOf ex:Link .
`;

const map = buildSuperClassMap(storeFromTurtle(HIERARCHY));

describe('superClassesNearestFirst', () => {
  it('walks a diamond level by level, ties in IRI order, whatever the declaration order', () => {
    expect(superClassesNearestFirst(`${EX}C`, map)).toEqual([`${EX}A`, `${EX}B`, `${EX}P`, ELEMENT]);
  });

  it('never lists a deeper superclass before a nearer one, even with a lower IRI', () => {
    expect(superClassesNearestFirst(`${EX}Near`, map)).toEqual([`${EX}M`, `${EX}Z`, `${EX}A2`, ELEMENT]);
  });

  it('includes the root it reaches but does not walk past it', () => {
    const element = superClassesNearestFirst(`${EX}P`, map);
    expect(element).toEqual([ELEMENT]);
    expect(element).not.toContain(MODEL_CONCEPT);

    expect(superClassesNearestFirst(`${EX}SubLink`, map)).toEqual([`${EX}Link`, RELATIONSHIP]);
  });

  it('returns nothing for a root itself', () => {
    expect(superClassesNearestFirst(ELEMENT, map)).toEqual([]);
    expect(superClassesNearestFirst(RELATIONSHIP, map)).toEqual([]);
  });

  it('terminates on a subClassOf cycle and lists each class once', () => {
    expect(superClassesNearestFirst(`${EX}X`, map)).toEqual([`${EX}Y`]);
  });

  it('returns nothing for a class with no parents or no entry', () => {
    expect(superClassesNearestFirst(`${EX}Unknown`, map)).toEqual([]);
  });

  it('honours a custom stop set', () => {
    expect(superClassesNearestFirst(`${EX}C`, map, new Set([`${EX}P`]))).toEqual([`${EX}A`, `${EX}B`, `${EX}P`]);
    // An empty stop set walks to the top of the hierarchy.
    expect(superClassesNearestFirst(`${EX}P`, map, new Set())).toEqual([ELEMENT, MODEL_CONCEPT]);
  });

  it('ends at the two core classes by default', () => {
    expect([...NOTATION_ROOTS].sort(compareIris)).toEqual([ELEMENT, RELATIONSHIP]);
  });
});

describe('closureOf (moved from the palette generator, unchanged)', () => {
  it('collects every ancestor, past the roots', () => {
    expect(closureOf(`${EX}C`, map).sort(compareIris)).toEqual(
      [`${EX}A`, `${EX}B`, `${EX}P`, ELEMENT, MODEL_CONCEPT].sort(compareIris),
    );
  });

  it('terminates on a cycle (reaching the class itself back through it, as it always did)', () => {
    expect(closureOf(`${EX}X`, map).sort(compareIris)).toEqual([`${EX}X`, `${EX}Y`]);
  });
});

describe('buildSuperClassMap', () => {
  it('records owl:Class subjects and rdfs:subClassOf subjects with their direct parents', () => {
    expect(map.get(`${EX}C`)?.slice().sort(compareIris)).toEqual([`${EX}A`, `${EX}B`]);
    expect(map.get(ELEMENT)).toEqual([MODEL_CONCEPT]);
    expect(map.has(MODEL_CONCEPT)).toBe(false);
  });
});

describe('compareIris', () => {
  it('orders by code unit, not by locale', () => {
    // localeCompare would put lower-case "a" before upper-case "B".
    expect(['https://x#a', 'https://x#B'].sort(compareIris)).toEqual(['https://x#B', 'https://x#a']);
  });
});
