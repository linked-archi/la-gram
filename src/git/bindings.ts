/**
 * Which repository file a model is bound to (Req 18.8): set by a save to Git
 * (and an open from Git), it lets the next save commit there without asking
 * again, naming the file version it last saw.
 *
 * Kept per model IRI in this browser's `localStorage` — on this machine, as
 * version history is, and not in the model: a model handed on does not carry
 * where someone else commits it. Nothing here is secret (the token is kept
 * apart, `credentials.ts`).
 */
import type { GitProviderKind } from './link.js';

/** A model's place in a repository. */
export interface GitBinding {
  host: string;
  provider: GitProviderKind;
  apiBase: string;
  repository: string;
  /** The repository's page. */
  webUrl: string;
  branch: string;
  path: string;
  /** The file's version last incorporated by opening, saving or pulling. */
  version: string;
  /** The incorporated commit — a new branch starts there; undo does not rewind it. */
  commit: string;
  /**
   * Another branch merged into the model (*Update from main*), not yet
   * committed: the next save records it as merged — a merge commit on GitHub, a
   * new branch from it on GitLab.
   */
  update?: {
    branch: string;
    /** Its head when merged. */
    commit: string;
    /** The file's version there; absent when the file was not on it. */
    version?: string;
  };
}

const KEY = 'la-gram:git-bindings';
const LAST = 'la-gram:git-last-repository';

/** The bindings kept on this machine. */
export class GitBindings {
  private readonly memory = new Map<string, GitBinding>();

  constructor(private readonly storage: Storage | undefined = safeLocalStorage()) {}

  get(modelIri: string): GitBinding | undefined {
    const binding = this.memory.get(modelIri) ?? this.all()[modelIri];
    // Another tab may persist a newer base without this editor incorporating it.
    if (binding) this.memory.set(modelIri, binding);
    return binding;
  }

  set(modelIri: string, binding: GitBinding): void {
    this.memory.set(modelIri, binding);
    this.write({ ...this.all(), [modelIri]: binding });
    try {
      this.storage?.setItem(LAST, binding.webUrl);
    } catch {
      // as below
    }
  }

  forget(modelIri: string): void {
    this.memory.delete(modelIri);
    const all = this.all();
    delete all[modelIri];
    this.write(all);
  }

  /** The repository last committed to, to offer for a model that has none. */
  lastRepository(): string | undefined {
    try {
      return this.storage?.getItem(LAST) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private all(): Record<string, GitBinding> {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, GitBinding>) : {};
    } catch {
      return {};
    }
  }

  private write(all: Record<string, GitBinding>): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(all));
    } catch {
      // Storage refused: the binding holds in memory for the session.
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
