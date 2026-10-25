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
 * quad back. The inner store keeps everything, for SPARQL and the metamodels —
 * but a large addition (opening a model) reaches it in the background, in
 * slices shorter than a frame, its terms checked at once as the inner store
 * would; until it is there, a read of every graph is the copy's model and the
 * inner store's named graphs, and SPARQL over the model waits for it.
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
/** A model addition this large is given to the inner store in the background. */
const IN_BACKGROUND_FROM = 5000;
/** How long one background slice may run, in ms: well under a frame. */
const SLICE_MS = 12;
/** Quads the inner store is given at a time. */
const STEP = 1000;
/** Subject and predicate of the quad a literal pattern is put in its held form through. */
const SCRATCH = DataFactory.namedNode('urn:la-gram:pattern');

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Whether a quad is in the default graph (the model). */
function inDefaultGraph(q: Quad): boolean {
  return q.graph.termType === 'DefaultGraph';
}

/** Wraps a store and observes its default graph. */
export class ObservableRdfStore implements RdfStore {
  private listeners = new Set<StoreChangeListener>();
  private writeListeners = new Set<(diff: RdfDiff) => void>();
  private recording: RdfDiff[] = [];
  private origin: ChangeOrigin = 'local';
  /** Changes made inside {@link batch}, delivered once at the end. */
  private pending: RdfDiff | null = null;
  /** The model graph, as the inner store holds it. */
  private model = new N3Store();
  /** Model quads the inner store is still to be given, in order, and how far it has got. */
  private backlog: Quad[] = [];
  private given = 0;
  private backlogTimer: ReturnType<typeof setTimeout> | null = null;

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
   * Be told of each write to the model as it is made — inside a {@link batch}
   * too, where {@link subscribe}rs hear only at its end — for a cache of what
   * was read from the store, which must not outlive it. Returns an unsubscribe.
   */
  onEveryWrite(listener: (diff: RdfDiff) => void): () => void {
    this.writeListeners.add(listener);
    return () => this.writeListeners.delete(listener);
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
    const named = quads.filter((q) => !inDefaultGraph(q));
    if (named.length > 0) {
      this.namedChanged();
      this.inner.addQuads(named);
    }
    // What the model did not have: n3 says whether a quad was new as it adds it.
    const added = this.held(quads.filter(inDefaultGraph)).filter((q) => this.model.addQuad(q as never));
    if (added.length === 0) return;
    try {
      if (added.length >= IN_BACKGROUND_FROM && this.inner.check) {
        this.inner.check(added); // refused now, as adding them would be
        this.giveLater(added);
      } else {
        this.inner.addQuads(added);
      }
    } catch (err) {
      // What the inner store refused is not the model's.
      for (const q of added) if (!this.innerHas(q)) this.model.removeQuad(q as never);
      throw err;
    }
    this.track(added, []);
  }

  removeQuads(quads: Quad[]): void {
    const named = quads.filter((q) => !inDefaultGraph(q));
    if (named.length > 0) {
      this.namedChanged();
      this.inner.removeQuads(named);
    }
    const removed = this.held(quads.filter(inDefaultGraph)).filter((q) => this.model.removeQuad(q as never));
    if (removed.length === 0) return;
    // One still waiting in the backlog is passed over when it comes up.
    try {
      this.inner.removeQuads(removed);
    } catch (err) {
      for (const q of removed) if (this.innerHas(q)) this.model.addQuad(q as never);
      throw err;
    }
    this.track([], removed);
  }

  getQuads(
    subject?: NamedNode | null,
    predicate?: NamedNode | null,
    object?: NamedNode | null,
    graph?: NamedNode | null,
  ): Quad[] {
    const termType = (term: unknown) => (term as { termType?: string } | null | undefined)?.termType;
    // A literal asked for, in the form held: the inner store matches any of its
    // forms (`"010"^^xsd:int` finds `"10"^^xsd:integer`), and so must the copy.
    const pattern = termType(object) === 'Literal' ? this.heldTerm(object as unknown as Quad['object']) : object;
    // The model, from the copy.
    if (termType(graph) === 'DefaultGraph') {
      return this.model.getQuads(subject ?? null, predicate ?? null, (pattern ?? null) as never, DEFAULT_GRAPH) as unknown as Quad[];
    }
    // Everything: the model from the copy, the inner store's named graphs one by one.
    if (!subject && !predicate && !object && !graph && this.inner.namedGraphs) {
      const quads = this.model.getQuads(null, null, null, DEFAULT_GRAPH) as unknown as Quad[];
      for (const named of this.namedGraphs()) {
        for (const q of this.inner.getQuads(null, null, null, named)) quads.push(q);
      }
      return quads;
    }
    // One named graph; or every graph, once the inner store has the whole model.
    if (graph || !this.behind) return this.inner.getQuads(subject, predicate, object, graph);
    // Every graph while the inner store is being given the model: the model
    // from the copy, the rest from the inner store.
    const quads = this.model.getQuads(subject ?? null, predicate ?? null, (pattern ?? null) as never, DEFAULT_GRAPH) as unknown as Quad[];
    for (const q of this.inner.getQuads(subject, predicate, object, null)) if (!inDefaultGraph(q)) quads.push(q);
    return quads;
  }

  /** How many quads the model has. */
  modelSize(): number {
    return this.model.size;
  }

  /** The model graph, to read from without a copy — never to write to. */
  modelGraph(): N3Store {
    return this.model;
  }

  /**
   * The named graphs — the metamodels' documents — as last listed, until one
   * is written to: listing them was a scan of every metamodel quad, asked for
   * at every relationship lookup (Task 22).
   */
  namedGraphs(): NamedNode[] {
    if (!this.namedList) this.namedList = this.inner.namedGraphs?.() ?? [];
    return this.namedList;
  }

  private namedList: NamedNode[] | undefined;

  /** A named graph may have been written to: its list is to be read again. */
  private namedChanged(): void {
    this.namedList = undefined;
  }

  /** Every quad of the named graphs: the metamodels. */
  namedGraphQuads(): Quad[] {
    const quads: Quad[] = [];
    const graphs = this.inner.namedGraphs ? this.namedGraphs() : [];
    for (const graph of graphs) for (const q of this.inner.getQuads(null, null, null, graph)) quads.push(q);
    if (!this.inner.namedGraphs) for (const q of this.inner.getQuads()) if (!inDefaultGraph(q)) quads.push(q);
    return quads;
  }

  /** SPARQL over everything — the model the inner store is still to be given, given first. */
  query(sparql: string): SparqlResult {
    this.giveAll();
    return this.inner.query(sparql);
  }

  /**
   * SPARQL about the metamodels — viewpoints, relationship tables, the class
   * hierarchy — which reads the default graph only for metamodel data put
   * there. It does not wait for the model: right after a model is opened, the
   * inner store may hold only part of it (Task 22).
   */
  queryMetamodels(sparql: string): SparqlResult {
    return this.inner.query(sparql);
  }

  /**
   * SPARQL Update is diffed by reading the default graph after it against the
   * copy — the only way to know what an arbitrary update touched.
   */
  update(sparqlUpdate: string): void {
    this.giveAll();
    this.namedChanged();
    this.guarded(() => this.inner.update(sparqlUpdate));
    const { added, removed } = this.resync();
    this.track(added, removed);
  }

  load(data: string, options: { format: string; graph?: string; baseIri?: string }): number {
    if (!this.inner.load) throw new Error('The underlying store cannot bulk-load');
    // Bulk loads target metamodel graphs; into the default graph they are rare
    // and are reported as one change computed by snapshot.
    if (options.graph) {
      this.namedChanged();
      return this.inner.load(data, options);
    }
    this.giveAll();
    const count = this.guarded(() => (this.inner.load as NonNullable<RdfStore['load']>)(data, options));
    this.track(this.resync().added, []);
    return count;
  }

  size(): number {
    this.giveAll();
    return this.inner.size ? this.inner.size() : this.inner.getQuads().length;
  }

  /** Whether the inner store is still to be given part of the model. */
  get behind(): boolean {
    return this.given < this.backlog.length;
  }

  /** Give the inner store, now, the model quads it is still to have. */
  giveAll(): void {
    if (this.backlogTimer) {
      clearTimeout(this.backlogTimer);
      this.backlogTimer = null;
    }
    this.give(Infinity);
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

  /** The inner store is to have these model quads, in the background. */
  private giveLater(quads: Quad[]): void {
    this.backlog = this.behind ? this.backlog.slice(this.given).concat(quads) : quads;
    this.given = 0;
    this.scheduleGiving();
  }

  private scheduleGiving(): void {
    if (this.backlogTimer || !this.behind) return;
    this.backlogTimer = setTimeout(() => {
      this.backlogTimer = null;
      this.give(SLICE_MS);
      this.scheduleGiving();
    }, 0);
  }

  /** Give the inner store backlogged quads the model still has, for about `budgetMs`. */
  private give(budgetMs: number): void {
    const started = now();
    while (this.behind) {
      const end = Math.min(this.backlog.length, this.given + STEP);
      const step: Quad[] = [];
      for (let i = this.given; i < end; i++) if (this.model.has(this.backlog[i] as never)) step.push(this.backlog[i]);
      this.given = end;
      this.giveStep(step);
      if (now() - started >= budgetMs) break;
    }
    if (!this.behind) {
      this.backlog = [];
      this.given = 0;
    }
  }

  /**
   * Give the inner store one step of the backlog. Its terms were checked when
   * added; should it refuse one even so, that quad leaves the model — said, and
   * told to listeners as a removal — rather than the copy and the store differ.
   */
  private giveStep(step: Quad[]): void {
    try {
      this.inner.addQuads(step);
      return;
    } catch {
      // One at a time, to find the one refused.
    }
    const refused: Quad[] = [];
    for (const q of step) {
      try {
        this.inner.addQuads([q]);
      } catch (err) {
        console.warn('[la-gram] The store refused a quad of the model', err);
        if (this.model.removeQuad(q as never)) refused.push(q);
      }
    }
    this.track([], refused);
  }

  /** Whether the inner store has a quad — not one it cannot even hold. */
  private innerHas(q: Quad): boolean {
    try {
      if (this.inner.has) return this.inner.has(q);
      return this.inner.getQuads(q.subject as NamedNode, q.predicate as NamedNode, q.object as NamedNode, q.graph as NamedNode).length > 0;
    } catch {
      return false;
    }
  }

  /** A term in the form the store holds it (a literal canonical, as Oxigraph keeps it). */
  private heldTerm(term: Quad['object']): Quad['object'] {
    if (!this.inner.canonical) return term;
    return this.inner.canonical([DataFactory.quad(SCRATCH, SCRATCH, term as never) as unknown as Quad])[0].object;
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
    this.giveAll();
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
    for (const listener of this.writeListeners) listener({ added, removed });
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
