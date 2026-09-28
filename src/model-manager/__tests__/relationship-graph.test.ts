import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { buildGraphQuery, relationshipGraph, runGraphQuery, traverseGraph } from '../relationship-graph.js';
import type { GraphQueryOptions } from '../relationship-graph.js';

const { namedNode, literal, quad } = DataFactory;
const M = 'https://example.org/m/';
const L = 'https://example.org/lang#';
const RDF_TYPE = NAMESPACES.rdf + 'type';
const LABEL = NAMESPACES.skos + 'prefLabel';
const SRC = NAMESPACES.arch + 'source';
const TGT = NAMESPACES.arch + 'target';

/**
 *   D ──Assignment──▶ A ──Serving──▶ B ──Flow──▶ C ──Access──▶ E        F (alone)
 *   A is an Actor, B and C Components, D a Role, E an Object.
 */
let store: OxigraphRdfStore;
beforeAll(() => {
  store = new OxigraphRdfStore();
  const q: Quad[] = [];
  const element = (id: string, type: string, name: string) =>
    q.push(
      quad(namedNode(M + id), namedNode(RDF_TYPE), namedNode(L + type)) as unknown as Quad,
      quad(namedNode(M + id), namedNode(LABEL), literal(name, 'en')) as unknown as Quad,
    );
  const rel = (id: string, type: string, from: string, to: string) =>
    q.push(
      quad(namedNode(M + id), namedNode(RDF_TYPE), namedNode(L + type)) as unknown as Quad,
      quad(namedNode(M + id), namedNode(SRC), namedNode(M + from)) as unknown as Quad,
      quad(namedNode(M + id), namedNode(TGT), namedNode(M + to)) as unknown as Quad,
    );
  element('a', 'Actor', 'Clerk');
  element('b', 'Component', 'Shop');
  element('c', 'Component', 'Payments');
  element('d', 'Role', 'Cashier');
  element('e', 'Object', 'Invoice');
  element('f', 'Actor', 'Alone');
  rel('r1', 'Serving', 'a', 'b');
  rel('r2', 'Flow', 'b', 'c');
  rel('r3', 'Assignment', 'd', 'a');
  rel('r4', 'Access', 'c', 'e');
  // An association to a relationship: its end is not an element, and is not followed.
  rel('r5', 'Association', 'a', 'r2');
  store.addQuads(q);
});
afterAll(() => store.dispose());

const graph = (depth: number, extra: { elementTypes?: string[]; relationshipTypes?: string[]; root?: string } = {}) =>
  relationshipGraph(store, {
    rootIri: M + (extra.root ?? 'a'),
    depth,
    ...(extra.elementTypes ? { elementTypes: extra.elementTypes.map((t) => L + t) } : {}),
    ...(extra.relationshipTypes ? { relationshipTypes: extra.relationshipTypes.map((t) => L + t) } : {}),
  });
const ids = (iris: string[]) => iris.map((i) => i.replace(M, '')).sort();

describe('the relationship graph', () => {
  it('finds the relationships one hop away, in both directions', () => {
    const g = graph(1);
    expect(ids(g.edges.map((e) => e.iri))).toEqual(['r1', 'r3']);
    expect(g.nodes.map((n) => [n.label, n.depth])).toEqual([
      ['Clerk', 0],
      ['Cashier', 1],
      ['Shop', 1],
    ]);
    // Labels and types come with the result.
    expect(g.nodes.find((n) => n.label === 'Shop')?.typeIri).toBe(L + 'Component');
  });

  it('goes as deep as asked', () => {
    expect(ids(graph(2).edges.map((e) => e.iri))).toEqual(['r1', 'r2', 'r3']);
    const deep = graph(3);
    expect(ids(deep.edges.map((e) => e.iri))).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(deep.nodes.find((n) => n.label === 'Invoice')?.depth).toBe(3);
  });

  it('does not follow a relationship type that is filtered out', () => {
    const g = graph(3, { relationshipTypes: ['Serving', 'Assignment', 'Access'] });
    // Flow is not followed, so Access (beyond it) is not reached either.
    expect(ids(g.edges.map((e) => e.iri))).toEqual(['r1', 'r3']);
  });

  it('does not step onto an element type that is filtered out', () => {
    const g = graph(3, { elementTypes: ['Role', 'Object', 'Actor'] });
    // Components are not stepped onto: nothing beyond them either.
    expect(ids(g.edges.map((e) => e.iri))).toEqual(['r3']);
  });

  it('draws the root alone when it has no relationships', () => {
    const g = graph(2, { root: 'f' });
    expect(g.edges).toEqual([]);
    expect(g.nodes).toEqual([{ iri: M + 'f', label: 'Alone', depth: 0, typeIri: L + 'Actor' }]);
  });

  it('is exported as a readable, standalone query whose result is exactly the graph', () => {
    const query = buildGraphQuery(
      { rootIri: M + 'a', depth: 2, rootLabel: 'Clerk', relationshipTypes: [L + 'Serving', L + 'Flow'] },
      { lang: L },
    );
    expect(query).toMatch(/^# Relationships within 2 hops of "Clerk" — la-gram/);
    expect(query).toContain('PREFIX lang: <https://example.org/lang#>');
    expect(query).toContain('FILTER(?rt IN (lang:Serving, lang:Flow))');
    expect(query).toMatch(/CONSTRUCT \{[\s\S]*\}\s*WHERE \{/);
    // Running the exported text gives the triples the graph was drawn from.
    const result = store.query(query);
    expect(result.type).toBe('quads');
    const g = graph(2, { relationshipTypes: ['Serving', 'Flow'] });
    expect(result.type === 'quads' && triples(result.quads)).toEqual(triples(g.quads));
    expect(g.query).toBe(buildGraphQuery({ rootIri: M + 'a', depth: 2, relationshipTypes: [L + 'Serving', L + 'Flow'] }));
    expect(ids(g.edges.map((e) => e.iri))).toEqual(['r1', 'r2']);
  });

  it('is also exported as a SELECT: the same WHERE, a table of relationships', () => {
    const select = buildGraphQuery({ rootIri: M + 'a', depth: 1 }, {}, 'select');
    expect(select).toMatch(/SELECT DISTINCT \(\?s AS \?source\) \(\?sLabel AS \?sourceName\)/);
    expect(select.slice(select.indexOf('WHERE {'), select.lastIndexOf('}'))).toBe(
      buildGraphQuery({ rootIri: M + 'a', depth: 1 }).slice(buildGraphQuery({ rootIri: M + 'a', depth: 1 }).indexOf('WHERE {')).replace(/\}\s*$/, ''),
    );
    const rows = store.query(select);
    expect(rows.type === 'bindings' && rows.results.map((b) => [b.sourceName?.value, b.relationshipType?.value.replace(L, ''), b.targetName?.value])).toEqual([
      ['Cashier', 'Assignment', 'Clerk'],
      ['Clerk', 'Serving', 'Shop'],
    ]);
    const g = graph(1);
    expect(g.selectQuery).toBe(buildGraphQuery({ rootIri: M + 'a', depth: 1 }, {}, 'select'));
  });

  it('refuses a root that cannot be written as an IRI', () => {
    expect(() => buildGraphQuery({ rootIri: 'https://x/a b', depth: 1 })).toThrow(/Not an IRI/);
  });
});

/** Quads as sorted N-Triples-like lines, for comparing sets. */
function triples(quads: readonly Quad[]): string[] {
  const term = (t: Quad['object']) =>
    t.termType === 'Literal' ? `"${t.value}"@${t.language}^^${t.datatype.value}` : `<${t.value}>`;
  return [...new Set(quads.map((q) => `${term(q.subject)} ${term(q.predicate)} ${term(q.object)} ${q.graph.termType}`))].sort();
}

/** The walk and the exported queries — CONSTRUCT and SELECT — agree on this store for these options. */
function expectAgreement(on: OxigraphRdfStore, options: GraphQueryOptions) {
  const where = JSON.stringify({ ...options, rootIri: options.rootIri.replace(M, '') });
  const walked = traverseGraph(on, options);
  const queried = runGraphQuery(on, options).quads;
  expect(triples(walked), where).toEqual(triples(queried));
  // The SELECT: one row per relationship (per name, when several), with its ends.
  const rows = on.query(buildGraphQuery(options, {}, 'select'));
  expect(rows.type, where).toBe('bindings');
  const tabled = new Set(rows.type === 'bindings' ? rows.results.map((b) => `${b.relationship!.value} ${b.source!.value} ${b.target!.value}`) : []);
  const value = (subject: string, predicate: string) => walked.find((q) => q.subject.value === subject && q.predicate.value === predicate)?.object.value;
  const drawn = new Set(walked.filter((q) => q.predicate.value === SRC).map((q) => `${q.subject.value} ${q.object.value} ${value(q.subject.value, TGT)}`));
  expect([...tabled].sort(), where).toEqual([...drawn].sort());
  return walked;
}

/** A small deterministic pseudo-random generator (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A model of `size` elements and about twice as many relationships, some of them to relationships. */
function randomModel(seed: number, size: number): OxigraphRdfStore {
  const next = random(seed);
  const pick = (n: number) => Math.floor(next() * n);
  const on = new OxigraphRdfStore();
  const q: Quad[] = [];
  const add = (s: string, p: string, o: string | ReturnType<typeof literal>) =>
    q.push(quad(namedNode(s), namedNode(p), typeof o === 'string' ? namedNode(o) : o) as unknown as Quad);
  for (let i = 0; i < size; i++) {
    add(M + 'e' + i, RDF_TYPE, L + 'T' + pick(6));
    if (next() < 0.15) add(M + 'e' + i, RDF_TYPE, L + 'T' + pick(6));
    if (next() < 0.8) add(M + 'e' + i, LABEL, literal('Element ' + i, 'en'));
    if (next() < 0.2) add(M + 'e' + i, LABEL, literal('Elément ' + i, 'fr'));
  }
  for (let i = 0; i < size * 2; i++) {
    const r = M + 'r' + i;
    add(r, RDF_TYPE, L + 'R' + pick(4));
    add(r, SRC, M + 'e' + pick(size));
    // Now and then an association to an earlier relationship, or a relationship to itself.
    add(r, TGT, i > 0 && next() < 0.1 ? M + 'r' + pick(i) : M + 'e' + pick(size));
    if (next() < 0.3) add(r, LABEL, literal('rel ' + i));
  }
  on.addQuads(q);
  return on;
}

describe('the walk and the exported query', () => {
  it('agree on a hand-made model, at every depth and filter', () => {
    for (const root of ['a', 'b', 'd', 'f', 'r2'])
      for (const depth of [1, 2, 3, 4])
        for (const extra of [
          {},
          { relationshipTypes: [L + 'Serving', L + 'Flow', L + 'Association'] },
          { elementTypes: [L + 'Actor', L + 'Component'] },
          { relationshipTypes: [] },
        ])
          expectAgreement(store, { rootIri: M + root, depth, ...extra });
  });

  it('agree on the corner cases: several types, labels in several languages, loops, untyped things', () => {
    const on = new OxigraphRdfStore();
    const q: Quad[] = [];
    const add = (s: string, p: string, o: string | ReturnType<typeof literal>) =>
      q.push(quad(namedNode(M + s), namedNode(p), typeof o === 'string' ? namedNode(o.includes(':') ? o : M + o) : o) as unknown as Quad);
    add('a', RDF_TYPE, L + 'Actor');
    add('a', RDF_TYPE, L + 'Role');
    add('a', LABEL, literal('Clerk', 'en'));
    add('a', LABEL, literal('Kassierer', 'de'));
    add('b', RDF_TYPE, L + 'Component');
    add('untyped', LABEL, literal('No type'));
    // a → b, labelled; b → b; a → untyped; an untyped relationship a → b; one with two types.
    for (const [r, from, to] of [['r1', 'a', 'b'], ['loop', 'b', 'b'], ['r2', 'a', 'untyped'], ['bare', 'a', 'b'], ['twice', 'b', 'a']]) {
      if (r !== 'bare') add(r, RDF_TYPE, L + 'Serving');
      add(r, SRC, from);
      add(r, TGT, to);
    }
    add('twice', RDF_TYPE, L + 'Flow');
    add('r1', LABEL, literal('serves'));
    // In another graph than the model's: not read.
    q.push(quad(namedNode(M + 'other'), namedNode(SRC), namedNode(M + 'a'), namedNode(M + 'graph')) as unknown as Quad);
    q.push(quad(namedNode(M + 'other'), namedNode(TGT), namedNode(M + 'b'), namedNode(M + 'graph')) as unknown as Quad);
    q.push(quad(namedNode(M + 'other'), namedNode(RDF_TYPE), namedNode(L + 'Serving'), namedNode(M + 'graph')) as unknown as Quad);
    on.addQuads(q);
    for (const root of ['a', 'b', 'untyped'])
      for (const depth of [1, 2, 3])
        for (const extra of [{}, { relationshipTypes: [L + 'Flow'] }, { elementTypes: [L + 'Role'] }])
          expectAgreement(on, { rootIri: M + root, depth, ...extra });
    const walked = traverseGraph(on, { rootIri: M + 'a', depth: 1 });
    expect(new Set(walked.map((x) => x.subject.value.replace(M, '')))).toEqual(new Set(['a', 'b', 'r1', 'twice']));
    on.dispose();
  });

  it('agree on generated models', () => {
    for (const seed of [1, 2, 3]) {
      const on = randomModel(seed, 24);
      for (const depth of [1, 2, 3])
        for (const extra of [{}, { relationshipTypes: [L + 'R0', L + 'R1', L + 'R2'] }, { elementTypes: [L + 'T0', L + 'T1', L + 'T2', L + 'T3'] }])
          for (const root of ['e0', 'e5', 'e11'])
            expectAgreement(on, { rootIri: M + root, depth, ...extra });
      on.dispose();
    }
  });

  it('walks a large model quickly', () => {
    const on = randomModel(7, 3000);
    const started = performance.now();
    const walked = traverseGraph(on, { rootIri: M + 'e1', depth: 5 });
    const took = performance.now() - started;
    on.dispose();
    // The query took seconds at 100 elements; the walk touches only what it reaches.
    expect(new Set(walked.filter((x) => x.predicate.value === SRC).map((x) => x.subject.value)).size).toBeGreaterThan(200);
    expect(took).toBeLessThan(3000);
  });
});
