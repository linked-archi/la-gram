/** Personal, destination-scoped opt-in and durable write receipts (Req 18.26). */
import type { GitBinding } from './bindings.js';
import { destinationKey } from './git-observation.js';
import type { CommitResult } from './providers/provider.js';

export interface AutoCommitSettings {
  mode: 'off' | 'idle' | 'interval';
  idleMinutes: number;
  intervalMinutes: number;
  paused?: string;
}

export interface PendingCommit {
  modelIri: string;
  binding: GitBinding;
  /** Identifies the editor lifecycle that captured the submitted snapshot. */
  stamp: string;
  hash: string;
  receipt?: CommitResult;
}

export const AUTO_COMMIT_PREFIX = 'la-gram:git-auto-commit:';
export function autoCommitKey(modelIri: string, binding: GitBinding): string {
  return JSON.stringify([modelIri, destinationKey(binding)]);
}

function safeStorage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }

export class AutoCommitStore {
  private readonly memory = new Map<string, string>();
  private readonly unsaved = new Set<string>();
  constructor(private readonly storage: Storage | undefined = safeStorage()) {}

  private read(key: string): string | undefined {
    if (this.unsaved.has(key)) return this.memory.get(key);
    try { return this.storage?.getItem(key) ?? this.memory.get(key); }
    catch { return this.memory.get(key); }
  }

  get(key: string): AutoCommitSettings {
    let value: Partial<AutoCommitSettings> = {};
    try { value = JSON.parse(this.read(AUTO_COMMIT_PREFIX + key) ?? '{}') ?? {}; } catch { /* Use Off. */ }
    return { mode: value.mode === 'idle' || value.mode === 'interval' ? value.mode : 'off',
      idleMinutes: [1, 2, 5, 10].includes(value.idleMinutes!) ? value.idleMinutes! : 2,
      intervalMinutes: [5, 10, 15, 30].includes(value.intervalMinutes!) ? value.intervalMinutes! : 10,
      ...(typeof value.paused === 'string' ? { paused: value.paused } : {}) };
  }

  set(key: string, value: AutoCommitSettings): void {
    const name = AUTO_COMMIT_PREFIX + key;
    const raw = JSON.stringify(value);
    this.memory.set(name, raw);
    try {
      if (!this.storage) { this.unsaved.add(name); return; }
      this.storage.setItem(name, raw);
      this.unsaved.delete(name);
    } catch { this.unsaved.add(name); /* Keep a pause effective even when storage becomes full. */ }
  }

  pause(key: string, reason: string): void { this.set(key, { ...this.get(key), paused: reason }); }
  resume(key: string): void { const { paused: _, ...settings } = this.get(key); this.set(key, settings); }

  pending(key: string): PendingCommit | undefined {
    const raw = this.read(AUTO_COMMIT_PREFIX + 'pending:' + key);
    if (!raw) return undefined;
    // A corrupt journal must not be interpreted as permission for another write.
    let value: PendingCommit | undefined;
    try { value = JSON.parse(raw) as PendingCommit; } catch { /* Refuse a write below. */ }
    if (!value?.binding || !value.hash || !value.stamp || autoCommitKey(value.modelIri, value.binding) !== key) {
      throw new Error('The pending Git write cannot be read. Save to Git manually before resuming auto-commit.');
    }
    return value;
  }

  journal(key: string, value: PendingCommit): void {
    const name = AUTO_COMMIT_PREFIX + 'pending:' + key;
    const raw = JSON.stringify(value);
    if (!this.storage) throw new Error('Auto-commit needs local storage to record pending writes. Use Save to Git.');
    try {
      this.storage.setItem(name, raw);
      if (this.storage.getItem(name) !== raw) throw new Error();
    } catch { throw new Error('The pending Git write could not be recorded. Use Save to Git.'); }
  }

  clear(key: string): void {
    this.storage?.removeItem(AUTO_COMMIT_PREFIX + 'pending:' + key);
    this.memory.delete(AUTO_COMMIT_PREFIX + 'pending:' + key);
  }
}
