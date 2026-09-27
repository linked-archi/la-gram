import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { buildGraphQuery, runGraphQuery } from '../relationship-graph.js';

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
  runGraphQuery(store, {
    rootIri: M + (extra.root ?? 'a'),
    depth,
    ...(extra.elementTypes ? { elementTypes: extra.elementTypes.map((t) => L + t) } : {}),
    ...(extra.relationshipTypes ? { relationshipTypes: extra.relationshipTypes.map((t) => L + t) } : {}),
  });
const ids = (iris: string[]) => iris.map((i) => i.replace(M, '')).sort();

describe('the relationship graph query', () => {
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

  it('is a readable, standalone query whose result is exactly the graph', () => {
    const query = buildGraphQuery(
      { rootIri: M + 'a', depth: 2, rootLabel: 'Clerk', relationshipTypes: [L + 'Serving', L + 'Flow'] },
      { lang: L },
    );
    expect(query).toMatch(/^# Relationships within 2 hops of "Clerk" — la-gram/);
    expect(query).toContain('PREFIX lang: <https://example.org/lang#>');
    expect(query).toContain('FILTER(?rt IN (lang:Serving, lang:Flow))');
    expect(query).toMatch(/CONSTRUCT \{[\s\S]*\}\s*WHERE \{/);
    // Running the exported text gives the same triples the graph was read from.
    const result = store.query(query);
    expect(result.type).toBe('quads');
    const g = graph(2, { relationshipTypes: ['Serving', 'Flow'] });
    expect(result.type === 'quads' && result.quads.length).toBe(g.quads.length);
    expect(ids(g.edges.map((e) => e.iri))).toEqual(['r1', 'r2']);
  });

  it('refuses a root that cannot be written as an IRI', () => {
    expect(() => buildGraphQuery({ rootIri: 'https://x/a b', depth: 1 })).toThrow(/Not an IRI/);
  });
});
