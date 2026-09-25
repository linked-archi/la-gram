/**
 * Real-time collaboration on the model: the store's default graph ⇄ a Y.Doc.
 *
 * ## What is shared
 *
 * The *model* — every triple of the default graph, geometry included. Not the
 * canvas: diagram-js state is a projection of the store (`DiagramCanvas.
 * syncFromStore`), so sharing the store is sharing everything, and a client that
 * shows a different view, or no canvas at all, still participates. This is the
 * "CRDT is the truth at runtime; RDF is the truth at rest" principle with
 * nothing in between.
 *
 * ## Shape of the document
 *
 * One `Y.Map<true>` named `triples`, keyed by the triple's canonical N-Triples
 * form (`quadKey`). An RDF graph *is* a set of triples, and a map-as-set is the
 * CRDT for a set: concurrent adds of different triples merge, an add and a
 * remove of the same triple resolve deterministically, and the keys are valid
 * N-Triples lines, so the server can persist the document as an `.nt` file
 * without understanding Yjs or RDF. Blank-node labels travel verbatim (the
 * model layer mints none, but imported files may carry them).
 *
 * ## Single-valued properties
 *
 * A set CRDT keeps both values when two people change the same property at once
 * — two `arch-vis:bounds-x` after concurrent moves, two English labels after
 * concurrent renames. After every remote change the binding therefore
 * normalises the properties that are single-valued by definition: it keeps the
 * greatest key and retracts the others, locally and in the document. Every
 * client applies the same rule to the same set, so they converge without
 * coordinating. (Selecting a concept also locks it for the others — see
 * `presence.ts` — which makes such races rare in the first place.)
 *
 * ## Echo prevention
 *
 * Local changes are pushed in a transaction with {@link LOCAL_ORIGIN}; remote
 * ones are applied to the store under origin `remote`, which the store listener
 * ignores. Neither side ever re-sends what it just received.
 */

import * as Y from 'yjs';
import { Parser as N3Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import { quadKey, type ObservableRdfStore, type StoreChange } from '../rdf-engine/observable-store.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { modelQuads } from '../model-manager/model-queries.js';

/** Transaction origin of changes this client made. */
export const LOCAL_ORIGIN = 'la-gram:local';

/** Name of the shared map. */
export const TRIPLES_MAP = 'triples';

/**
 * Predicates with one value per subject — or, for labels, one per language.
 * Everything geometric, plus the endpoint and membership links a diagram
 * element must not have two of.
 */
const SINGLE_VALUED = new Set([
  NAMESPACES['arch-vis'] + 'bounds-x',
  NAMESPACES['arch-vis'] + 'bounds-y',
  NAMESPACES['arch-vis'] + 'bounds-w',
  NAMESPACES['arch-vis'] + 'bounds-h',
  NAMESPACES['arch-vis'] + 'point-x',
  NAMESPACES['arch-vis'] + 'point-y',
  NAMESPACES['arch-vis'] + 'archElement',
  NAMESPACES['arch-vis'] + 'archRelationship',
  NAMESPACES['arch-vis'] + 'view',
  NAMESPACES['arch-vis'] + 'source',
  NAMESPACES['arch-vis'] + 'target',
  NAMESPACES['arch-vis'] + 'points',
  NAMESPACES.rdf + 'first',
  NAMESPACES.rdf + 'rest',
  NAMESPACES.arch + 'source',
  NAMESPACES.arch + 'target',
  NAMESPACES.skos + 'prefLabel',
]);

/** Parse N-Triples keys back into quads (default graph). */
export function keysToQuads(keys: Iterable<string>): Quad[] {
  const text = [...keys].map((k) => `${k} .`).join('\n');
  if (!text) return [];
  // `blankNodePrefix: ''` keeps blank-node labels as they are, so the same
  // label names the same node on every client.
  return new N3Parser({ format: 'N-Triples', blankNodePrefix: '' }).parse(text) as unknown as Quad[];
}

/** How the first sync resolves a local model against the room's. */
export type SeedPolicy =
  /** The room wins when it has content; an empty room receives the local model. */
  | 'prefer-room'
  /** The local model replaces whatever the room holds (e.g. "share this model"). */
  | 'push-local';

/** Options for {@link RdfYjsBinding}. */
export interface RdfYjsBindingOptions {
  /** Called after remote changes were applied to the store. */
  onRemoteChange?: (change: StoreChange) => void;
}

export class RdfYjsBinding {
  readonly triples: Y.Map<true>;
  private unsubscribe: (() => void) | null = null;
  private readonly observer: (event: Y.YMapEvent<true>, tx: Y.Transaction) => void;
  private started = false;

  constructor(
    private readonly store: ObservableRdfStore,
    readonly doc: Y.Doc,
    private readonly options: RdfYjsBindingOptions = {},
  ) {
    this.triples = doc.getMap<true>(TRIPLES_MAP);
    this.observer = (event, tx) => this.onRemote(event, tx);
  }

  /**
   * Start syncing. Call once the provider has synced with the server, so the
   * room's current content is known.
   */
  start(policy: SeedPolicy = 'prefer-room'): void {
    if (this.started) return;
    this.started = true;
    this.seed(policy);
    this.triples.observe(this.observer);
    this.unsubscribe = this.store.subscribe((change) => this.onLocal(change));
  }

  /** Stop syncing; the store keeps what it has. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.triples.unobserve(this.observer);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Reconcile the store and the room once, at start. */
  private seed(policy: SeedPolicy): void {
    const local = modelQuads(this.store);
    if (policy === 'prefer-room' && this.triples.size > 0) {
      const remote = keysToQuads(this.triples.keys());
      this.store.withOrigin('remote', () =>
        this.store.batch(() => {
          if (local.length > 0) this.store.removeQuads(local);
          this.store.addQuads(remote);
        }),
      );
      this.options.onRemoteChange?.({ added: remote, removed: local, origin: 'remote' });
      return;
    }
    // The room is empty (or is to be overwritten): it gets the local model.
    this.doc.transact(() => {
      if (policy === 'push-local') this.triples.clear();
      for (const q of local) this.triples.set(quadKey(q), true);
    }, LOCAL_ORIGIN);
  }

  /** A change made here: forward it to the room. */
  private onLocal(change: StoreChange): void {
    if (change.origin === 'remote') return;
    this.doc.transact(() => {
      for (const q of change.removed) this.triples.delete(quadKey(q));
      for (const q of change.added) this.triples.set(quadKey(q), true);
    }, LOCAL_ORIGIN);
  }

  /** A change made elsewhere: apply it here, then settle single-valued properties. */
  private onRemote(event: Y.YMapEvent<true>, tx: Y.Transaction): void {
    if (tx.origin === LOCAL_ORIGIN) return;
    const added: string[] = [];
    const removed: string[] = [];
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'delete') removed.push(key);
      else if (change.action === 'add') added.push(key);
    }
    if (added.length === 0 && removed.length === 0) return;
    const addedQuads = keysToQuads(added);
    const removedQuads = keysToQuads(removed);
    this.store.withOrigin('remote', () =>
      this.store.batch(() => {
        if (removedQuads.length > 0) this.store.removeQuads(removedQuads);
        if (addedQuads.length > 0) this.store.addQuads(addedQuads);
      }),
    );
    this.normalize(addedQuads);
    this.options.onRemoteChange?.({ added: addedQuads, removed: removedQuads, origin: 'remote' });
  }

  /**
   * Retract all but one value of each single-valued property the change touched.
   * Deterministic (greatest key wins), so every client ends in the same state.
   */
  private normalize(touched: Quad[]): void {
    const groups = new Set<string>();
    for (const q of touched) {
      if (SINGLE_VALUED.has(q.predicate.value)) groups.add(`${q.subject.value}\u0000${q.predicate.value}`);
    }
    if (groups.size === 0) return;
    const losers: Quad[] = [];
    for (const group of groups) {
      const [subject, predicate] = group.split('\u0000');
      const values = this.store
        .getQuads({ termType: 'NamedNode', value: subject } as never, { termType: 'NamedNode', value: predicate } as never)
        .filter((q) => q.graph.termType === 'DefaultGraph');
      if (values.length < 2) continue;
      // Labels are single-valued per language, not overall.
      const byLang = new Map<string, Quad[]>();
      for (const q of values) {
        const lang = predicate === NAMESPACES.skos + 'prefLabel' ? ((q.object as { language?: string }).language ?? '') : '';
        const list = byLang.get(lang) ?? [];
        list.push(q);
        byLang.set(lang, list);
      }
      for (const list of byLang.values()) {
        if (list.length < 2) continue;
        const sorted = [...list].sort((a, b) => (quadKey(a) < quadKey(b) ? 1 : -1));
        losers.push(...sorted.slice(1));
      }
    }
    if (losers.length === 0) return;
    // A local change: the store listener forwards the retraction to the room.
    this.store.removeQuads(losers);
  }
}
