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
 * a triple the operation did not create.
 */

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

  constructor(readonly inner: RdfStore & { has?(q: Quad): boolean }) {}

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
    const effective = quads.filter((q) => !inDefaultGraph(q) || !this.has(q));
    this.inner.addQuads(quads);
    this.track(effective.filter(inDefaultGraph), []);
  }

  removeQuads(quads: Quad[]): void {
    const effective = quads.filter((q) => inDefaultGraph(q) && this.has(q));
    this.inner.removeQuads(quads);
    this.track([], effective);
  }

  getQuads(
    subject?: NamedNode | null,
    predicate?: NamedNode | null,
    object?: NamedNode | null,
    graph?: NamedNode | null,
  ): Quad[] {
    return this.inner.getQuads(subject, predicate, object, graph);
  }

  query(sparql: string): SparqlResult {
    return this.inner.query(sparql);
  }

  /**
   * SPARQL Update is diffed by snapshotting the default graph around it — the
   * only way to know what an arbitrary update touched.
   */
  update(sparqlUpdate: string): void {
    if (this.listeners.size === 0 && this.recording.length === 0) {
      this.inner.update(sparqlUpdate);
      return;
    }
    const key = (q: Quad) => quadKey(q);
    const before = new Map(this.defaultGraph().map((q) => [key(q), q]));
    this.inner.update(sparqlUpdate);
    const after = new Map(this.defaultGraph().map((q) => [key(q), q]));
    const added = [...after].filter(([k]) => !before.has(k)).map(([, q]) => q);
    const removed = [...before].filter(([k]) => !after.has(k)).map(([, q]) => q);
    this.track(added, removed);
  }

  load(data: string, options: { format: string; graph?: string; baseIri?: string }): number {
    if (!this.inner.load) throw new Error('The underlying store cannot bulk-load');
    // Bulk loads target metamodel graphs; into the default graph they are rare
    // and are reported as one change computed by snapshot.
    if (options.graph) return this.inner.load(data, options);
    const before = new Set(this.defaultGraph().map(quadKey));
    const count = this.inner.load(data, options);
    const added = this.defaultGraph().filter((q) => !before.has(quadKey(q)));
    this.track(added, []);
    return count;
  }

  size(): number {
    return this.inner.size ? this.inner.size() : this.inner.getQuads().length;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private has(q: Quad): boolean {
    if (this.inner.has) return this.inner.has(q);
    return (
      this.inner.getQuads(
        q.subject as NamedNode,
        q.predicate as NamedNode,
        q.object as NamedNode,
        q.graph as NamedNode,
      ).length > 0
    );
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
    default:
      return `?${term.value}`;
  }
}
