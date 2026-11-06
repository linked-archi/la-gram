/**
 * Running a SELECT over the default graph *and* every named graph.
 *
 * ## The problem
 *
 * An unscoped SPARQL pattern matches the default graph only. That is the whole
 * of SPARQL's dataset semantics, not an Oxigraph quirk. But
 * `N3MetamodelLoader` deliberately loads each metamodel document into its own
 * named graph keyed by its ontology IRI, so provenance survives ("what did the
 * notation file say?"). Against the bundled ArchiMate 4.0 metamodel that puts
 * 3 640 triples in nine named graphs and **nothing** in the default graph. Any
 * metamodel query written unscoped therefore matches nothing at all.
 *
 * Model *data*, by contrast, does land in the default graph — `ElementManager`,
 * `ViewManager` and `RelationshipManager` all write graph-less quads. So the
 * dataset a metamodel query needs is "the default graph union every named
 * graph", and neither half can be dropped.
 *
 * ## Why this is done in the query text
 *
 * Oxigraph's own `Store.query` takes a `use_default_graph_as_union: boolean`
 * option that expresses exactly this, and it is the cleanest available
 * mechanism. `OxigraphRdfStore.query(sparql)` does not forward options, though,
 * and `rdf-store.ts` is outside the scope of this change — so the dataset has
 * to be described inside the query.
 *
 * Two candidate encodings were measured against the real bundle:
 *
 * - `{ pattern } UNION { GRAPH ?g { pattern } }` evaluates the pattern once per
 *   graph. Property paths then cannot leave the graph they started in. The
 *   `rdfs:subClassOf*` closure of `am4:BusinessActor` came back with six
 *   entries, stopping at `arch:Element`, because
 *   `arch:Element rdfs:subClassOf arch:ModelConcept` is declared in the
 *   `core#` document and the walk began in `onto#`.
 * - `FROM <g1> … FROM <gN>` merges the listed graphs into the query's default
 *   graph, so a path crosses document boundaries freely. The same closure came
 *   back with seven entries, `arch:ModelConcept` included.
 *
 * `FROM` is the better answer, with one catch: naming any graph in `FROM`
 * *replaces* the default graph, and the store's own default graph has no name
 * to list (`FROM DEFAULT` is not SPARQL and Oxigraph rejects it). Measured
 * directly: a triple added graph-less is invisible to a query carrying `FROM`
 * clauses.
 *
 * So {@link GraphScope.select} runs the query twice — once bare for the default
 * graph, once with every named graph merged in — and concatenates the rows.
 * Callers already de-duplicate by IRI, which is what makes the overlap
 * harmless: a triple present in both the default graph and a named graph
 * yields two identical rows, not two candidates.
 */

import type { RdfStore, SparqlResult } from './interfaces.js';

/** One SELECT result row, as `RdfStore.query` reports it. */
export type SparqlBindings = Extract<SparqlResult, { type: 'bindings' }>['results'][number];

/** The slice of `RdfStore` this module needs. Structural, so a stub works. */
export interface SparqlQueryable {
  query(sparql: string): SparqlResult;
}

/**
 * Characters that cannot appear in a SPARQL IRIREF. A graph name containing any
 * of them is skipped rather than interpolated — it could otherwise break the
 * query or inject syntax.
 */
const UNSAFE_IRI_CHARS = /[<>"{}|^`\\\s]/;

/** Whether an IRI can be safely interpolated into a SPARQL `<...>` term. */
export function isSafeIri(iri: string): boolean {
  return iri.length > 0 && !UNSAFE_IRI_CHARS.test(iri);
}

/**
 * A dataset spanning the default graph and every named graph the store holds.
 *
 * Build one per logical operation with {@link graphScope} and reuse it across
 * the queries that operation needs: the named-graph list costs a scan, and
 * answering "which relationship types may connect these two element types?"
 * takes three queries.
 */
export class GraphScope {
  /**
   * @param store        Store every query runs against.
   * @param namedGraphs  Named graphs to merge into the query's default graph.
   */
  constructor(
    private readonly store: SparqlQueryable,
    readonly namedGraphs: readonly string[],
  ) {}

  /**
   * Run a SELECT across the whole dataset.
   *
   * `build` receives the `FROM` block to splice in between the projection and
   * the `WHERE` clause — the only place SPARQL allows it:
   *
   * ```ts
   * scope.select((from) => `SELECT DISTINCT ?super ${from} WHERE { … }`);
   * ```
   *
   * It is called once with an empty string (the store's default graph) and, if
   * there are any named graphs, once with the `FROM` block. Rows from both runs
   * are concatenated in that order; overlapping triples produce duplicate rows,
   * so callers must de-duplicate.
   */
  select(build: (fromClauses: string) => string): SparqlBindings[] {
    const rows: SparqlBindings[] = [];

    const fromDefault = this.store.query(build(''));
    if (fromDefault.type === 'bindings') rows.push(...fromDefault.results);

    if (this.namedGraphs.length === 0) return rows;

    const fromClauses = this.namedGraphs.map((iri) => `FROM <${iri}>`).join('\n      ');
    const fromNamed = this.store.query(build(fromClauses));
    if (fromNamed.type === 'bindings') rows.push(...fromNamed.results);

    return rows;
  }
}

/**
 * Enumerate the store's named graphs and return a scope over all of them plus
 * the default graph.
 */
export function graphScope(store: SparqlQueryable | RdfStore): GraphScope {
  // About the metamodels: through `queryMetamodels` where the store has it, which
  // does not wait for a model just opened to reach Oxigraph (Task 22).
  const metamodels = (store as { queryMetamodels?(sparql: string): SparqlResult }).queryMetamodels;
  // The named graphs as the store keeps them listed, where it does: a SPARQL
  // listing scans every quad of them, and a scope is made for every relationship
  // lookup — forty for one context pad (Task 22).
  const listed = (store as { namedGraphs?(): Array<{ termType: string; value: string }> }).namedGraphs;
  if (typeof metamodels === 'function') {
    const original = store;
    store = { query: (sparql: string) => metamodels.call(original, sparql) };
    if (typeof listed === 'function') {
      const graphs: string[] = [];
      for (const term of listed.call(original)) {
        if (term.termType === 'NamedNode' && isSafeIri(term.value) && !graphs.includes(term.value)) graphs.push(term.value);
      }
      return new GraphScope(store, graphs);
    }
  }
  const result = store.query('SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }');
  if (result.type !== 'bindings') return new GraphScope(store, []);

  const graphs: string[] = [];
  for (const row of result.results) {
    const term = row['g'];
    if (term === undefined) continue;
    // Blank-node graph names cannot be written as an IRIREF, so they are
    // reported here but unusable in FROM; skipping them is the honest choice.
    // `RdfStore.query` reports an IRI as a `NamedNode` and everything else as a
    // bare `{ value }`, and the label of a blank node is a perfectly safe
    // string — so the term type, not the characters, is what distinguishes them.
    if (!('termType' in term) || term.termType !== 'NamedNode') continue;
    const iri = term.value;
    if (iri && isSafeIri(iri) && !graphs.includes(iri)) graphs.push(iri);
  }
  return new GraphScope(store, graphs);
}
