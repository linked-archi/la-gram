/**
 * An {@link RdfStore} that reports, and can record, every change to the model.
 *
 * Two things in the application need to know exactly which triples an
 * operation changed:
 *
 * - **Undo/redo.** A canvas command runs a model operation once, records the
 *   quads it actually added and removed, and from then on undo applies the
 *   inverse and redo re-applies the same diff — never re-running the operation,
 *   which would mint new IRIs and break everything that points at the old ones.
 * - **Collaboration.** The CRDT binding forwards each local change to the
 *   shared document and applies remote changes with a different origin, so it
 *   does not echo them back.
 *
 * Only the default graph — the model — is observed. Metamodel graphs are loaded
 * and dropped wholesale by the metamodel loader and are nobody's edit.
 *
 * A diff records only effective changes: adding a quad that is already there,
 * or removing one that is not, is not part of it, so its inverse never deletes
 * a triple the operation did not create. And it records them as the store holds
 * them, which for a typed literal may not be as they were added.
 *
 * It also keeps a copy of the model graph in JavaScript (Task 22): a read of the
 * model — the model whole, or a pattern in the default graph — is answered from
 * it, without a crossing into Oxigraph's WebAssembly and a conversion of every
 * quad back. The inner store keeps everything, for SPARQL and the metamodels.
 */

import { DataFactory, Store as N3Store } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore, SparqlResult } from './interfaces.js';

/** Quads an operation added and removed, in the default graph. */
export interface RdfDiff {
  added: Quad[];
  removed: Quad[];
}

/** Who made a change: the local user, a remote collaborator, a file load… */
export type ChangeOrigin = 'local' | 'remote' | 'load' | 'undo' | 'redo' | (string & {});

/** A batch of effective changes to the model. */
export interface StoreChange extends RdfDiff {
  origin: ChangeOrigin;
}

/** Listener for {@link ObservableRdfStore.subscribe}. */
export type StoreChangeListener = (change: StoreChange) => void;

const DEFAULT_GRAPH = DataFactory.defaultGraph();

/** Whether a quad is in the default graph (the model). */
function inDefaultGraph(q: Quad): boolean {
  return q.graph.termType === 'DefaultGraph';
}

/** Wraps a store and observes its default graph. */
export class ObservableRdfStore implements RdfStore {
  private listeners = new Set<StoreChangeListener>();
  private recording: RdfDiff[] = [];
  private origin: ChangeOrigin = 'local';
  /** Changes made inside {@link batch}, delivered once at the end. */
  private pending: RdfDiff | null = null;
  /** The model graph, as the inner store holds it. */
  private model = new N3Store();

  constructor(readonly inner: RdfStore & { has?(q: Quad): boolean }) {
    this.model.addQuads(this.defaultGraph() as never);
  }

  // ── Observation ────────────────────────────────────────────────────────

  /** Be told about every effective change to the model. Returns an unsubscribe. */
  subscribe(listener: StoreChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Run `fn` and return what it changed. Nested recordings each see their own
   * changes and their callers' recordings see them too.
   */
  record<T>(fn: () => T): { result: T } & RdfDiff {
    const diff: RdfDiff = { added: [], removed: [] };
    this.recording.push(diff);
    try {
      const result = fn();
      return { result, ...diff };
    } finally {
      this.recording.splice(this.recording.indexOf(diff), 1);
    }
  }

  /** Run `fn` with changes attributed to `origin` (e.g. `remote`). */
  withOrigin<T>(origin: ChangeOrigin, fn: () => T): T {
    const previous = this.origin;
    this.origin = origin;
    try {
      return fn();
    } finally {
      this.origin = previous;
    }
  }

  /**
   * Run `fn` and notify listeners once, with everything it changed, instead of
   * once per `addQuads`/`removeQuads` call. Nested batches fold into the outer.
   */
  batch<T>(fn: () => T): T {
    if (this.pending) return fn();
    this.pending = { added: [], removed: [] };
    try {
      return fn();
    } finally {
      const change = this.pending;
      this.pending = null;
      if (change.added.length > 0 || change.removed.length > 0) this.notify(change);
    }
  }

  /** Apply a recorded diff, or its inverse. */
  applyDiff(diff: RdfDiff, inverse = false): void {
    this.batch(() => {
      const [remove, add] = inverse ? [diff.added, diff.removed] : [diff.removed, diff.added];
      if (remove.length > 0) this.removeQuads(remove);
      if (add.length > 0) this.addQuads(add);
    });
  }

  // ── RdfStore ───────────────────────────────────────────────────────────

  addQuads(quads: Quad[]): void {
    const held = this.held(quads.filter(inDefaultGraph));
    this.guarded(() => this.inner.addQuads(quads));
    // What the model did not have: n3 says whether a quad was new as it adds it.
    this.track(held.filter((q) => this.model.addQuad(q as never)), []);
  }

  removeQuads(quads: Quad[]): void {
    const held = this.held(quads.filter(inDefaultGraph));
    this.guarded(() => this.inner.removeQuads(quads));
    this.track([], held.filter((q) => this.model.removeQuad(q as never)));
  }

  getQuads(
    subject?: NamedNode | null,
    predicate?: NamedNode | null,
    object?: NamedNode | null,
    graph?: NamedNode | null,
  ): Quad[] {
    // The model from the copy — but a literal asked for, which the inner store
    // matches in any of its forms (`"010"^^xsd:int` finds `"10"^^xsd:integer`).
    const termType = (term: unknown) => (term as { termType?: string } | null | undefined)?.termType;
    if (termType(graph) === 'DefaultGraph' && termType(object) !== 'Literal') {
      return this.model.getQuads(subject ?? null, predicate ?? null, object ?? null, DEFAULT_GRAPH) as unknown as Quad[];
    }
    // Everything: the model from the copy, the inner store's named graphs one by one.
    if (!subject && !predicate && !object && !graph && this.inner.namedGraphs) {
      const quads = this.model.getQuads(null, null, null, DEFAULT_GRAPH) as unknown as Quad[];
      for (const named of this.inner.namedGraphs()) {
        for (const q of this.inner.getQuads(null, null, null, named)) quads.push(q);
      }
      return quads;
    }
    return this.inner.getQuads(subject, predicate, object, graph);
  }

  /** How many quads the model has. */
  modelSize(): number {
    return this.model.size;
  }

  query(sparql: string): SparqlResult {
    return this.inner.query(sparql);
  }

  /**
   * SPARQL Update is diffed by reading the default graph after it against the
   * copy — the only way to know what an arbitrary update touched.
   */
  update(sparqlUpdate: string): void {
    this.guarded(() => this.inner.update(sparqlUpdate));
    const { added, removed } = this.resync();
    this.track(added, removed);
  }

  load(data: string, options: { format: string; graph?: string; baseIri?: string }): number {
    if (!this.inner.load) throw new Error('The underlying store cannot bulk-load');
    // Bulk loads target metamodel graphs; into the default graph they are rare
    // and are reported as one change computed by snapshot.
    if (options.graph) return this.inner.load(data, options);
    const count = this.guarded(() => (this.inner.load as NonNullable<RdfStore['load']>)(data, options));
    this.track(this.resync().added, []);
    return count;
  }

  size(): number {
    return this.inner.size ? this.inner.size() : this.inner.getQuads().length;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Quads as the store holds them: what it gives back — what the copy keeps,
   * undo removes, a peer keys and validation sees — is their form, not
   * necessarily the one added (`"010"^^xsd:int` kept as `"10"^^xsd:integer`).
   */
  private held(quads: Quad[]): Quad[] {
    if (quads.length === 0 || !this.inner.canonical) return quads;
    return this.inner.canonical(quads);
  }

  /** Run a write to the inner store; if it fails part-way, the copy is read again from it. */
  private guarded<T>(write: () => T): T {
    try {
      return write();
    } catch (err) {
      this.resync();
      throw err;
    }
  }

  /** Read the model graph again from the inner store into the copy: what that added and removed. */
  private resync(): RdfDiff {
    const before = this.model;
    const after = new N3Store();
    after.addQuads(this.defaultGraph() as never);
    const added = (after.getQuads(null, null, null, null) as unknown as Quad[]).filter((q) => !before.has(q as never));
    const removed = (before.getQuads(null, null, null, null) as unknown as Quad[]).filter((q) => !after.has(q as never));
    this.model = after;
    return { added, removed };
  }

  private defaultGraph(): Quad[] {
    return this.inner.getQuads(null, null, null, { termType: 'DefaultGraph', value: '' } as unknown as NamedNode);
  }

  private track(added: Quad[], removed: Quad[]): void {
    if (added.length === 0 && removed.length === 0) return;
    for (const diff of this.recording) {
      diff.added.push(...added);
      diff.removed.push(...removed);
    }
    if (this.pending) {
      this.pending.added.push(...added);
      this.pending.removed.push(...removed);
      return;
    }
    this.notify({ added, removed });
  }

  private notify(diff: RdfDiff): void {
    const change: StoreChange = { ...diff, origin: this.origin };
    for (const listener of this.listeners) listener(change);
  }
}

/**
 * A canonical string for a quad — N-Quads-like, stable across stores. Used as a
 * map key here and as the CRDT key in the collaboration binding.
 */
export function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)}${
    q.graph.termType === 'DefaultGraph' ? '' : ` ${termKey(q.graph)}`
  }`;
}

function termKey(term: Quad['object']): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value}>`;
    case 'BlankNode':
      return `_:${term.value}`;
    case 'Literal': {
      const lit = term as { value: string; language?: string; datatype?: { value: string } };
      const escaped = JSON.stringify(lit.value);
      if (lit.language) return `${escaped}@${lit.language}`;
      const dt = lit.datatype?.value;
      return dt && dt !== 'http://www.w3.org/2001/XMLSchema#string' ? `${escaped}^^<${dt}>` : escaped;
    }
    case 'Quad': {
      // An RDF 1.2 triple term, as N-Triples 1.2 writes it: `<<( s p o )>>`.
      const triple = term as Quad;
      return `<<( ${termKey(triple.subject)} ${termKey(triple.predicate)} ${termKey(triple.object)} )>>`;
    }
    default:
      return `?${term.value}`;
  }
}
