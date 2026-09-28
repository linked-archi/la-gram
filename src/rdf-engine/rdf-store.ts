/**
 * RDF Store implementation using Oxigraph WASM.
 *
 * Wraps the Oxigraph WASM `Store` to implement the `RdfStore` interface,
 * providing SPARQL 1.1 support (SELECT, CONSTRUCT, ASK, DESCRIBE) and
 * quad CRUD operations. Handles conversion between @rdfjs/types Quad
 * (used by N3.js throughout the app) and Oxigraph's internal term types.
 *
 * ## Two Oxigraph builds, two initialization contracts
 *
 * `oxigraph`'s package.json declares `"main": "node.js"` and
 * `"browser": "web.js"`, so bundlers targeting the browser get a *different*
 * module than Node/Vitest:
 *
 * - `node.js` (CommonJS) reads `node_bg.wasm` off disk and instantiates it
 *   synchronously at import time. Every API is usable immediately.
 * - `web.js` (ESM) ends with `export { initSync }; export default __wbg_init;`.
 *   Its internal `wasm` binding stays `undefined` until the default export is
 *   awaited, so calling `namedNode()` / `new Store()` beforehand throws.
 *
 * A namespace import (`import * as oxigraph`) is required rather than a
 * default import: for `web.js` the default export is the *initializer*, not
 * the API surface, so `oxigraph.namedNode` would be `undefined` in the browser.
 */

import * as oxigraph from 'oxigraph';
import { DataFactory } from 'n3';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import type { RdfStore, SparqlResult } from './interfaces.js';

const { namedNode, blankNode, literal, defaultGraph, quad: n3Quad } = DataFactory;

// ── Term conversion helpers ────────────────────────────────────────────

/** Convert an @rdfjs/types Term to an Oxigraph term. */
function toOxTerm(term: Term): oxigraph.Term {
  switch (term.termType) {
    case 'NamedNode':
      return oxigraph.namedNode(term.value);
    case 'BlankNode':
      return oxigraph.blankNode(term.value);
    case 'Literal': {
      const lit = term as import('@rdfjs/types').Literal;
      if (lit.language) {
        return oxigraph.literal(lit.value, lit.language);
      }
      return oxigraph.literal(lit.value, oxigraph.namedNode(lit.datatype.value));
    }
    case 'DefaultGraph':
      return oxigraph.defaultGraph();
    default:
      throw new Error(`Unsupported term type: ${term.termType}`);
  }
}

/** Convert an @rdfjs/types Quad to an Oxigraph Quad. */
function toOxQuad(q: Quad): oxigraph.Quad {
  return oxigraph.quad(
    toOxTerm(q.subject) as oxigraph.Quad_Subject,
    toOxTerm(q.predicate) as oxigraph.Quad_Predicate,
    toOxTerm(q.object) as oxigraph.Quad_Object,
    toOxTerm(q.graph) as oxigraph.Quad_Graph,
  );
}

/** Convert an Oxigraph term back to an @rdfjs/types Term (N3.js DataFactory). */
function fromOxTerm(term: oxigraph.Term): Term {
  switch (term.termType) {
    case 'NamedNode':
      return namedNode(term.value) as unknown as Term;
    case 'BlankNode':
      return blankNode(term.value) as unknown as Term;
    case 'Literal': {
      const lit = term as oxigraph.Literal;
      if (lit.language) {
        return literal(lit.value, lit.language) as unknown as Term;
      }
      return literal(lit.value, namedNode(lit.datatype.value)) as unknown as Term;
    }
    case 'DefaultGraph':
      return defaultGraph() as unknown as Term;
    default:
      throw new Error(`Unsupported Oxigraph term type: ${(term as { termType: string }).termType}`);
  }
}

/** Convert an Oxigraph Quad back to an @rdfjs/types Quad (N3.js DataFactory). */
function fromOxQuad(q: oxigraph.Quad): Quad {
  return n3Quad(
    fromOxTerm(q.subject) as Quad['subject'],
    fromOxTerm(q.predicate) as Quad['predicate'],
    fromOxTerm(q.object) as Quad['object'],
    fromOxTerm(q.graph) as Quad['graph'],
  ) as unknown as Quad;
}

// ── SPARQL query type detection ────────────────────────────────────────

type SparqlQueryType = 'SELECT' | 'CONSTRUCT' | 'ASK' | 'DESCRIBE';

/** Detect the SPARQL query form from the query string. */
export function detectQueryType(sparql: string): SparqlQueryType {
  // The query form is the first form keyword after the prologue; subqueries
  // come later. IRIs and strings are masked before comments are stripped: a
  // '#' inside <…/core#> is not a comment, and stripping from it used to take
  // the closing '>' along, so a CONSTRUCT with a SELECT subquery read as SELECT.
  const code = sparql
    .replace(/<[^<>"{}|^`\\\s]*>/g, '<>')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .replace(/#[^\n]*/g, '');
  const form = /\b(SELECT|CONSTRUCT|ASK|DESCRIBE)\b/i.exec(code);
  return (form ? form[1].toUpperCase() : 'SELECT') as SparqlQueryType;
}

// ── WASM initialization ────────────────────────────────────────────────

/** Signature of the wasm-bindgen async initializer exported by `web.js`. */
type WasmInitializer = (moduleOrPath?: unknown) => Promise<unknown>;

/**
 * Returns the WASM initializer if the resolved Oxigraph build needs one.
 *
 * Environment is detected from the module shape rather than by sniffing
 * `window` or `process`:
 * - `web.js` is an ES module whose default export is the async
 *   `__wbg_init` function → returns that function.
 * - `node.js` is CommonJS; under ESM interop its `default` is the
 *   `module.exports` namespace object (not callable) and WASM is already
 *   instantiated → returns `null`.
 */
function getWasmInitializer(): WasmInitializer | null {
  const maybeInit = (oxigraph as unknown as { default?: unknown }).default;
  return typeof maybeInit === 'function' ? (maybeInit as WasmInitializer) : null;
}

/** Memoized init promise so concurrent callers share a single instantiation. */
let wasmInitPromise: Promise<void> | null = null;

/** Set once WASM instantiation has actually completed. */
let wasmReady = false;

/**
 * Ensure the Oxigraph WASM module is instantiated.
 *
 * No-op on the Node build. On the browser build the default export is awaited;
 * `__wbg_init` itself short-circuits with `if (wasm !== undefined) return wasm`,
 * and the promise is memoized here, so calling this repeatedly is safe.
 */
export async function initOxigraph(): Promise<void> {
  const init = getWasmInitializer();
  if (init === null) return;

  if (wasmInitPromise === null) {
    wasmInitPromise = Promise.resolve(init()).then(() => {
      wasmReady = true;
    });
  }
  await wasmInitPromise;
}

/**
 * Whether Oxigraph can be used synchronously right now — always true on the
 * Node build, true on the browser build only after `initOxigraph()` resolved.
 */
export function isOxigraphReady(): boolean {
  return getWasmInitializer() === null || wasmReady;
}

// ── OxigraphRdfStore ───────────────────────────────────────────────────

/**
 * RdfStore implementation backed by Oxigraph WASM.
 *
 * Oxigraph provides full SPARQL 1.1 support in-browser via WebAssembly.
 * All store operations are synchronous, but the browser build needs a
 * one-time async WASM instantiation first — use {@link OxigraphRdfStore.create}
 * for environment-agnostic construction. The bare constructor stays usable in
 * Node (and after `initOxigraph()` has resolved) where WASM is already live.
 */
export class OxigraphRdfStore implements RdfStore {
  private store: oxigraph.Store;

  constructor() {
    this.store = new oxigraph.Store();
  }

  /**
   * Environment-agnostic factory: awaits the Oxigraph WASM initialization when
   * the browser build is in use, then constructs the store.
   *
   * Always prefer this over `new OxigraphRdfStore()` in application code.
   */
  static async create(): Promise<OxigraphRdfStore> {
    await initOxigraph();
    return new OxigraphRdfStore();
  }

  addQuads(quads: Quad[]): void {
    for (const q of quads) {
      this.store.add(toOxQuad(q));
    }
  }

  removeQuads(quads: Quad[]): void {
    for (const q of quads) {
      this.store.delete(toOxQuad(q));
    }
  }

  getQuads(
    subject?: NamedNode | null,
    predicate?: NamedNode | null,
    object?: NamedNode | null,
    graph?: NamedNode | null,
  ): Quad[] {
    const s = subject ? toOxTerm(subject as unknown as Term) : null;
    const p = predicate ? toOxTerm(predicate as unknown as Term) : null;
    const o = object ? toOxTerm(object as unknown as Term) : null;
    const g = graph ? toOxTerm(graph as unknown as Term) : null;

    const oxQuads = this.store.match(s, p, o, g);
    return oxQuads.map(fromOxQuad);
  }

  query(sparql: string): SparqlResult {
    const result = this.store.query(sparql);

    // ASK → boolean
    if (typeof result === 'boolean') {
      return { type: 'boolean', value: result };
    }

    // CONSTRUCT / DESCRIBE → Quad[]
    if (Array.isArray(result) && result.length > 0 && 'subject' in result[0]) {
      return {
        type: 'quads',
        quads: (result as oxigraph.Quad[]).map(fromOxQuad),
      };
    }

    // Empty array — need to check query type to determine result shape
    if (Array.isArray(result) && result.length === 0) {
      const qtype = detectQueryType(sparql);
      if (qtype === 'CONSTRUCT' || qtype === 'DESCRIBE') {
        return { type: 'quads', quads: [] };
      }
      return { type: 'bindings', results: [] };
    }

    // SELECT → Map<string, Term>[]
    if (Array.isArray(result)) {
      const bindings = (result as Map<string, oxigraph.Term>[]).map((row) => {
        const record: Record<string, NamedNode | { value: string }> = {};
        for (const [key, val] of row.entries()) {
          const converted = fromOxTerm(val);
          if ((converted as { termType: string }).termType === 'NamedNode') {
            record[key] = converted as unknown as NamedNode;
          } else {
            record[key] = { value: converted.value };
          }
        }
        return record;
      });
      return { type: 'bindings', results: bindings };
    }

    // String result (e.g. results_format specified) — shouldn't happen in normal use
    throw new Error('Unexpected SPARQL result type');
  }

  update(sparqlUpdate: string): void {
    this.store.update(sparqlUpdate);
  }

  /**
   * Parse and insert a whole document natively.
   *
   * Measured on the ArchiMate 3.2 relationship shapes (72 740 quads): 110 ms
   * here against 1.4 s through {@link addQuads}, whose cost is the per-quad term
   * conversion across the WASM boundary rather than the parse.
   */
  load(data: string, options: { format: string; graph?: string; baseIri?: string }): number {
    const before = this.store.size;
    this.store.load(data, {
      format: options.format,
      ...(options.graph ? { to_graph_name: oxigraph.namedNode(options.graph) } : {}),
      ...(options.baseIri ? { base_iri: options.baseIri } : {}),
      no_transaction: true,
    });
    return this.store.size - before;
  }

  size(): number {
    return this.store.size;
  }

  /** Whether the store holds exactly this quad (graph included). */
  has(q: Quad): boolean {
    return this.store.has(toOxQuad(q));
  }

  /**
   * Release the WASM memory behind the store. Stores are otherwise freed only
   * when the garbage collector finalises the wrapper, which in a test run that
   * builds dozens of metamodel-sized stores is late enough to matter.
   */
  dispose(): void {
    (this.store as unknown as { free?: () => void }).free?.();
  }
}
