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
    case 'Quad': {
      // An RDF 1.2 triple term (`<<( s p o )>>` — the object of rdf:reifies).
      const triple = term as Quad;
      return oxigraph.triple(toOxTerm(triple.subject), toOxTerm(triple.predicate), toOxTerm(triple.object));
    }
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
    case 'Quad': {
      // An RDF 1.2 triple term: n3 represents it as a quad in the default graph.
      const triple = term as oxigraph.Quad;
      return n3Quad(
        fromOxTerm(triple.subject) as Quad['subject'],
        fromOxTerm(triple.predicate) as Quad['predicate'],
        fromOxTerm(triple.object) as Quad['object'],
      ) as unknown as Term;
    }
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

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';
const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';
const RDF_DIR_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString';
const CANONICAL_INTEGER = /^(?:0|-?[1-9][0-9]*)$/;
const XSD_DOUBLE = 'http://www.w3.org/2001/XMLSchema#double';
const XSD_DECIMAL = 'http://www.w3.org/2001/XMLSchema#decimal';
/** A number written plainly — no exponent, no leading or trailing zeros — as Oxigraph keeps a double or decimal. */
const CANONICAL_PLAIN_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;

/** The XML Schema integer types: Oxigraph keeps a value of any of them as an `xsd:integer`. */
const INTEGER_TYPES = new Set(
  ['integer', 'int', 'long', 'short', 'byte', 'nonNegativeInteger', 'positiveInteger', 'nonPositiveInteger', 'negativeInteger', 'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte'].map(
    (t) => 'http://www.w3.org/2001/XMLSchema#' + t,
  ),
);

/**
 * A number literal in the form Oxigraph keeps it, where that form is known —
 * else `undefined`, and Oxigraph is asked. An integer of any integer type: an
 * `xsd:integer`, without sign `+`, leading zeros or `-0` (within 18 digits). A
 * double or decimal written plainly: without sign `+`, leading zeros, trailing
 * fractional zeros or a bare point; zero `0` — `-0` for a double (within 15
 * significant digits). Checked against Oxigraph in rdf-store.test.
 */
function canonicalNumber(term: Term & { termType: 'Literal' }): Term | undefined {
  const dt = term.datatype.value;
  if (INTEGER_TYPES.has(dt)) {
    const m = /^([+-]?)([0-9]+)$/.exec(term.value);
    if (!m) return undefined;
    const digits = m[2].replace(/^0+(?=[0-9])/, '');
    if (digits.length > 18) return undefined;
    return literal(`${m[1] === '-' && digits !== '0' ? '-' : ''}${digits}`, namedNode(XSD_INTEGER));
  }
  if (dt === XSD_DOUBLE || dt === XSD_DECIMAL) {
    const m = /^([+-]?)([0-9]*)(?:\.([0-9]*))?$/.exec(term.value);
    if (!m || m[2].length + (m[3] ?? '').length === 0) return undefined;
    const whole = m[2].replace(/^0+/, '');
    const fraction = (m[3] ?? '').replace(/0+$/, '');
    const significant = (whole + fraction).replace(/^0+/, '');
    if (significant.length > 15) return undefined;
    const negative = m[1] === '-' && (significant !== '' || dt === XSD_DOUBLE);
    return literal(`${negative ? '-' : ''}${whole || '0'}${fraction ? `.${fraction}` : ''}`, namedNode(dt));
  }
  return undefined;
}

/** Whether a double or decimal is written as Oxigraph keeps it: plainly, in at most 15 significant digits. */
function plainNumber(value: string): boolean {
  return CANONICAL_PLAIN_NUMBER.test(value) && value !== '-0' && value.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15;
}
/** Subjects in the scratch store {@link OxigraphRdfStore.canonical} uses. */
const SCRATCH = 'urn:la-gram:canonical:';

/**
 * Whether Oxigraph may keep this object in another form: a typed literal not a
 * string — but for an integer, a boolean or a plainly written double or decimal
 * already canonical, most of a diagram's — a language tag not in lower case
 * (`en-GB` is kept as `en-gb`), or a triple term with one.
 */
function mayBeRewritten(term: Term): boolean {
  if (term.termType === 'Literal') {
    const dt = term.datatype.value;
    if (dt === XSD_INTEGER) return !CANONICAL_INTEGER.test(term.value);
    if (dt === XSD_BOOLEAN) return term.value !== 'true' && term.value !== 'false';
    // A diagram's bounds and points: kept as written when written plainly.
    if (dt === XSD_DOUBLE || dt === XSD_DECIMAL) return !plainNumber(term.value);
    if (dt === RDF_LANG_STRING || dt === RDF_DIR_LANG_STRING) return term.language !== term.language.toLowerCase();
    return dt !== XSD_STRING;
  }
  if (term.termType === 'Quad') return mayBeRewritten((term as unknown as Quad).object);
  return false;
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

  /**
   * Throw as adding these quads would — an IRI that is not one, a language tag
   * or blank node label Oxigraph refuses, a term out of place — without adding
   * them: each distinct term is made once with Oxigraph's own constructors.
   */
  check(quads: Quad[]): void {
    const made = new Set<string>();
    const make = (term: Term): void => {
      switch (term.termType) {
        case 'NamedNode':
          if (!made.has(term.value)) {
            oxigraph.namedNode(term.value);
            made.add(term.value);
          }
          return;
        case 'BlankNode': {
          const key = `_:${term.value}`;
          if (!made.has(key)) {
            oxigraph.blankNode(term.value);
            made.add(key);
          }
          return;
        }
        case 'Literal': {
          const language = term.language;
          if (!language) return make(term.datatype);
          const key = `@${language}`;
          if (!made.has(key)) {
            oxigraph.literal('', language);
            made.add(key);
          }
          return;
        }
        case 'Quad': {
          const triple = term as unknown as Quad;
          place(triple.subject, triple.predicate);
          make(triple.subject);
          make(triple.predicate);
          make(triple.object);
          return;
        }
        case 'DefaultGraph':
          return;
        default:
          throw new Error(`Not a term the store can hold: ${term.termType}`);
      }
    };
    const place = (subject: Term, predicate: Term) => {
      if (subject.termType !== 'NamedNode' && subject.termType !== 'BlankNode') throw new Error(`Not a subject: ${subject.termType}`);
      if (predicate.termType !== 'NamedNode') throw new Error(`Not a predicate: ${predicate.termType}`);
    };
    for (const q of quads) {
      place(q.subject, q.predicate);
      make(q.subject);
      make(q.predicate);
      make(q.object);
      make(q.graph);
    }
  }

  /** The named graphs this store holds. */
  namedGraphs(): NamedNode[] {
    const rows = this.store.query('SELECT DISTINCT ?g WHERE { GRAPH ?g {} }') as Map<string, oxigraph.Term>[];
    return rows.map((row) => fromOxTerm(row.get('g') as oxigraph.Term) as NamedNode);
  }

  /** Whether the store holds exactly this quad (graph included). */
  has(q: Quad): boolean {
    return this.store.has(toOxQuad(q));
  }

  /**
   * The quads as this store holds them. Oxigraph keeps a literal of a type it
   * computes with — a number, a boolean, a date or time — in canonical form:
   * `"010"^^xsd:int` is kept, and read back, as `"10"^^xsd:integer`, `"1"^^xsd:boolean`
   * as `"true"`; and a language tag in lower case. Only an object is rewritten: the objects that may be are put
   * through a scratch store at once, each on a numbered subject, and read back;
   * the array itself is returned when none changes. (One at a time, adding and
   * deleting, is quadratic: the store keeps what was deleted.)
   */
  canonical(quads: Quad[]): Quad[] {
    const candidates: number[] = [];
    let held: Quad[] | undefined;
    quads.forEach((q, i) => {
      if (!mayBeRewritten(q.object)) return;
      // A number whose form Oxigraph's is known for is rewritten here (Task 22):
      // a converter's `"132.0"^^xsd:double`, `"9"^^xsd:int`, on every node.
      const number = q.object.termType === 'Literal' ? canonicalNumber(q.object) : undefined;
      if (!number) {
        candidates.push(i);
      } else if (!number.equals(q.object)) {
        held ??= quads.slice();
        held[i] = n3Quad(q.subject as never, q.predicate as never, number as never, q.graph as never) as unknown as Quad;
      }
    });
    if (candidates.length === 0) return held ?? quads;
    const scratch = new oxigraph.Store();
    const p = oxigraph.namedNode(SCRATCH + 'p');
    for (const i of candidates) {
      scratch.add(oxigraph.quad(oxigraph.namedNode(SCRATCH + i), p, toOxTerm(quads[i].object) as oxigraph.Quad_Object, oxigraph.defaultGraph()));
    }
    const kept = new Map<number, oxigraph.Term>();
    for (const q of scratch.match(null, null, null, null)) kept.set(Number(q.subject.value.slice(SCRATCH.length)), q.object);
    (scratch as unknown as { free?: () => void }).free?.();
    for (const i of candidates) {
      const object = fromOxTerm(kept.get(i) as oxigraph.Term);
      if (object.equals(quads[i].object)) continue;
      const q = quads[i];
      held ??= quads.slice();
      held[i] = n3Quad(q.subject as never, q.predicate as never, object as never, q.graph as never) as unknown as Quad;
    }
    return held ?? quads;
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
