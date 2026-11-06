/**
 * Version history: explicit commits of the working state, their differences,
 * and restoring one (Req 9.10, 9.14; tool spec §5.11). The user sees them as
 * *checkpoints* (the History tab), so that "commit" means a Git commit — Save to
 * Git (Req 18); the names here are the older ones, and what is kept under them
 * is unchanged.
 *
 * A commit is a snapshot of the model — the store's default graph, model data
 * and view geometry alike — as canonical N-Triples: one triple per line,
 * sorted, so two snapshots compare line by line and the same model always
 * gives the same commit. Snapshots rather than deltas keep restore and diff
 * independent of every other commit; a model of a few thousand triples is a
 * few hundred kilobytes.
 *
 * Commits are kept per model IRI in a {@link VersionStore}: IndexedDB in the
 * browser and in Electron (both are Chromium), in memory where there is none
 * (tests, or storage the browser refuses). They stay on this machine; a file
 * saved from the model does not carry them.
 *
 * Blank nodes are written with the labels the store gives them, which are not
 * stable between sessions, so a triple about a blank node can show as removed
 * and added again. Models made here mint IRIs for everything they create.
 */

import { DataFactory, Parser, Writer } from 'n3';
import type { Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { modelQuads } from './model-queries.js';

/** One explicit commit of a model's working state. */
export interface Commit {
  /** Unique, and orders a model's commits in time (its timestamp, with a random tail). */
  id: string;
  /** The model it is a version of (`arch:Model` IRI). */
  modelIri: string;
  /** When it was made, ISO 8601. */
  timestamp: string;
  /** Who made it, when known (the collaboration name). */
  author?: string;
  message: string;
  /** The commit before it in this model's history. */
  parent?: string;
  /** The snapshot: canonical N-Triples lines, sorted, without duplicates. */
  triples: string[];
}

/** Lines added and removed between two snapshots. */
export interface SnapshotDiff {
  added: string[];
  removed: string[];
}

/** Where commits are kept. */
export interface VersionStore {
  /** A model's commits, oldest first. */
  list(modelIri: string): Promise<Commit[]>;
  put(commit: Commit): Promise<void>;
}

/** Commits held in memory only — for tests, and where IndexedDB is unavailable. */
export class MemoryVersionStore implements VersionStore {
  private readonly commits: Commit[] = [];

  async list(modelIri: string): Promise<Commit[]> {
    return this.commits.filter((c) => c.modelIri === modelIri).sort(byId);
  }

  async put(commit: Commit): Promise<void> {
    this.commits.push(commit);
  }
}

const DB_NAME = 'la-gram-history';
const DB_STORE = 'commits';

/** Commits in IndexedDB, one record per commit, indexed by model. */
export class IndexedDbVersionStore implements VersionStore {
  private db?: Promise<IDBDatabase>;

  constructor(private readonly factory: IDBFactory) {}

  async list(modelIri: string): Promise<Commit[]> {
    const db = await this.open();
    const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).index('modelIri').getAll(modelIri);
    const commits = await done<Commit[]>(request);
    return commits.sort(byId);
  }

  async put(commit: Commit): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(DB_STORE, 'readwrite');
    transaction.objectStore(DB_STORE).put(commit);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(DB_STORE, { keyPath: 'id' });
        store.createIndex('modelIri', 'modelIri');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
}

/** IndexedDB when the environment has it, else memory. */
export function createVersionStore(): VersionStore {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return factory ? new IndexedDbVersionStore(factory) : new MemoryVersionStore();
}

/** The model's triples as canonical N-Triples lines: sorted, each once. */
export function snapshotOf(quads: readonly Quad[]): string[] {
  const writer = new Writer({ format: 'N-Triples' });
  for (const q of quads) {
    writer.addQuad(DataFactory.quad(q.subject as never, q.predicate as never, q.object as never));
  }
  let text = '';
  writer.end((_err: Error | null, result: string) => {
    text = result ?? '';
  });
  return [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))].sort();
}

/** What changed from `from` to `to`, both sorted snapshots. */
export function diffSnapshots(from: readonly string[], to: readonly string[]): SnapshotDiff {
  const before = new Set(from);
  const after = new Set(to);
  return {
    added: to.filter((line) => !before.has(line)),
    removed: from.filter((line) => !after.has(line)),
  };
}

/** A snapshot back as quads, in the default graph. */
export function quadsOf(snapshot: readonly string[]): Quad[] {
  return new Parser({ format: 'N-Triples' }).parse(snapshot.join('\n')) as unknown as Quad[];
}

/** Commit, list, compare and restore one model's versions. */
export class VersionHistory {
  constructor(
    private readonly store: RdfStore,
    private readonly versions: VersionStore = createVersionStore(),
  ) {}

  /** The model's working state as a snapshot. */
  workingSnapshot(): string[] {
    return snapshotOf(modelQuads(this.store));
  }

  /** The model's commits, newest first. */
  async list(modelIri: string): Promise<Commit[]> {
    return (await this.versions.list(modelIri)).reverse();
  }

  /** Commit the working state, after the model's latest commit. */
  async commit(modelIri: string, message: string, author?: string): Promise<Commit> {
    const [latest] = await this.list(modelIri);
    // Strictly after the latest, so commits made within one millisecond keep their order.
    const timestamp = new Date(Math.max(Date.now(), latest ? Date.parse(latest.timestamp) + 1 : 0)).toISOString();
    const commit: Commit = {
      id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      modelIri,
      timestamp,
      message: message.trim(),
      triples: this.workingSnapshot(),
      ...(author ? { author } : {}),
      ...(latest ? { parent: latest.id } : {}),
    };
    await this.versions.put(commit);
    return commit;
  }

  /**
   * Make the working state the commit's: one function, so the caller can run
   * it as an undoable step. Only the model's default graph changes.
   */
  restorer(commit: Commit): () => void {
    return () => {
      const current = modelQuads(this.store);
      if (current.length > 0) this.store.removeQuads(current);
      this.store.addQuads(quadsOf(commit.triples));
    };
  }
}

function byId(a: Commit, b: Commit): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function done<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}
