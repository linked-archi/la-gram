/**
 * Querying across the default graph and every named graph.
 *
 * The behaviour under test is dataset semantics, so these run against the real
 * Oxigraph store rather than a stub — a stub would prove nothing about which
 * graphs SPARQL actually reaches. The one exception is
 * {@link GraphScope.select}'s two-pass contract, which is observed through a
 * recording stub because the point is *how many* queries it issues and with
 * what text.
 */

import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../rdf-store.js';
import { GraphScope, graphScope, isSafeIri, type SparqlQueryable } from '../graph-scope.js';
import type { SparqlResult } from '../interfaces.js';
import { NAMESPACES } from '../namespaces.js';

const { namedNode } = DataFactory;

const SUB = NAMESPACES.rdfs + 'subClassOf';
const EX = 'https://example.org/mm#';

function t(s: string, p: string, o: string, g?: string): Quad {
  return DataFactory.quad(
    namedNode(s),
    namedNode(p),
    namedNode(o),
    g === undefined ? undefined : namedNode(g),
  ) as unknown as Quad;
}

/** `?super` values of an `rdfs:subClassOf*` walk from `start`, under `scope`. */
function closure(scope: GraphScope, start: string): string[] {
  const rows = scope.select(
    (from) => `
    SELECT DISTINCT ?super
    ${from}
    WHERE { <${start}> <${SUB}>* ?super . FILTER(isIRI(?super)) }
  `,
  );
  return [...new Set(rows.map((r) => r['super']?.value).filter((v): v is string => !!v))].sort();
}

describe('isSafeIri', () => {
  it('accepts an ordinary http IRI', () => {
    expect(isSafeIri('https://meta.linked.archi/core#')).toBe(true);
  });

  it('rejects the empty string', () => {
    expect(isSafeIri('')).toBe(false);
  });

  it.each([
    ['angle bracket', 'https://example.org/a>b'],
    ['whitespace', 'https://example.org/a b'],
    ['quote', 'https://example.org/a"b'],
    ['brace', 'https://example.org/a{b'],
    ['backslash', 'https://example.org/a\\b'],
  ])('rejects an IRI containing a %s', (_label, iri) => {
    expect(isSafeIri(iri)).toBe(false);
  });
});

describe('graphScope', () => {
  it('enumerates every named graph and nothing for a store that has none', () => {
    const empty = new OxigraphRdfStore();
    expect(graphScope(empty).namedGraphs).toEqual([]);

    const store = new OxigraphRdfStore();
    store.addQuads([
      t(`${EX}A`, SUB, `${EX}B`, 'urn:test:one'),
      t(`${EX}B`, SUB, `${EX}C`, 'urn:test:two'),
      // A graph-less triple must not invent a graph name.
      t(`${EX}D`, SUB, `${EX}E`),
    ]);

    expect([...graphScope(store).namedGraphs].sort()).toEqual(['urn:test:one', 'urn:test:two']);
  });

  it('reaches a triple in a named graph, which an unscoped query cannot', () => {
    const store = new OxigraphRdfStore();
    store.addQuads([t(`${EX}A`, SUB, `${EX}B`, 'urn:test:mm')]);

    // The premise: unscoped means the default graph, and the default graph is empty.
    const unscoped = store.query(`SELECT ?o WHERE { <${EX}A> <${SUB}> ?o }`);
    expect(unscoped.type === 'bindings' && unscoped.results).toHaveLength(0);

    expect(closure(graphScope(store), `${EX}A`)).toEqual([`${EX}A`, `${EX}B`]);
  });

  it('walks a property path across two named graphs', () => {
    // The case a `GRAPH ?g` union cannot answer: each graph holds one hop, so
    // per-graph evaluation stops at the document boundary. This is why the scope
    // merges the graphs with FROM instead.
    const store = new OxigraphRdfStore();
    store.addQuads([
      t(`${EX}Actor`, SUB, `${EX}ActiveStructure`, 'urn:test:onto'),
      t(`${EX}ActiveStructure`, SUB, `${EX}ModelConcept`, 'urn:test:core'),
    ]);

    expect(closure(graphScope(store), `${EX}Actor`)).toEqual([
      `${EX}ActiveStructure`,
      `${EX}Actor`,
      `${EX}ModelConcept`,
    ]);
  });

  it('still sees the default graph, which naming graphs in FROM would replace', () => {
    // Model data is written graph-less, so dropping the bare pass would lose it.
    const store = new OxigraphRdfStore();
    store.addQuads([
      t(`${EX}Actor`, SUB, `${EX}ActiveStructure`, 'urn:test:onto'),
      t(`${EX}Local`, SUB, `${EX}Handwritten`),
    ]);

    const scope = graphScope(store);
    expect(closure(scope, `${EX}Local`)).toEqual([`${EX}Handwritten`, `${EX}Local`]);
    expect(closure(scope, `${EX}Actor`)).toContain(`${EX}ActiveStructure`);
  });

  it('skips a blank-node graph name, which cannot be written as an IRIREF', () => {
    const store = new OxigraphRdfStore();
    store.addQuads([
      DataFactory.quad(
        namedNode(`${EX}A`),
        namedNode(SUB),
        namedNode(`${EX}B`),
        DataFactory.blankNode('b0'),
      ) as unknown as Quad,
    ]);

    // The enumeration query reports it, but `FROM` takes an IRIREF only — and a
    // blank node's *label* is a perfectly safe string, so a character check
    // alone would happily emit `FROM <b0>`, a relative IRI naming no graph.
    expect(graphScope(store).namedGraphs).toEqual([]);
    // The content is consequently invisible. That is a real limitation, not a
    // crash: passing a blank node as a graph name needs Oxigraph's `named_graphs`
    // query option, which `RdfStore.query` does not forward. Nothing in the app
    // loads into one — `N3MetamodelLoader` always names its graphs.
    expect(closure(graphScope(store), `${EX}A`)).toEqual([]);
  });
});

describe('GraphScope.select', () => {
  function recorder(result: SparqlResult = { type: 'bindings', results: [] }): {
    store: SparqlQueryable;
    queries: string[];
  } {
    const queries: string[] = [];
    return {
      queries,
      store: {
        query(sparql: string): SparqlResult {
          queries.push(sparql);
          return result;
        },
      },
    };
  }

  it('runs one bare pass when there are no named graphs', () => {
    const { store, queries } = recorder();

    new GraphScope(store, []).select((from) => `SELECT ?s ${from} WHERE { ?s ?p ?o }`);

    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain('FROM');
  });

  it('runs a bare pass and a FROM-merged pass naming every graph', () => {
    const { store, queries } = recorder();

    new GraphScope(store, ['urn:a', 'urn:b']).select(
      (from) => `SELECT ?s ${from} WHERE { ?s ?p ?o }`,
    );

    expect(queries).toHaveLength(2);
    expect(queries[0]).not.toContain('FROM');
    expect(queries[1]).toContain('FROM <urn:a>');
    expect(queries[1]).toContain('FROM <urn:b>');
  });

  it('concatenates the rows of both passes', () => {
    const row = { s: namedNode('urn:x') as unknown as NamedNode };
    const { store } = recorder({ type: 'bindings', results: [row] });

    const rows = new GraphScope(store, ['urn:a']).select(
      (from) => `SELECT ?s ${from} WHERE { ?s ?p ?o }`,
    );

    // Duplicates are the caller's problem to collapse — documented, not hidden.
    expect(rows).toHaveLength(2);
  });

  it('ignores a pass that does not return bindings', () => {
    const { store } = recorder({ type: 'boolean', value: true });

    expect(new GraphScope(store, ['urn:a']).select(() => 'ASK { ?s ?p ?o }')).toEqual([]);
  });
});
