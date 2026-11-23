/**
 * Where a build keeps what it stores in the browser (Req 15.10). The release at `/la-gram/` and the alpha at
 * `/la-gram-alpha/` are one origin, and an origin's `localStorage` and IndexedDB are shared by every page of
 * it: a build of a channel (`LA_GRAM_CHANNEL=alpha`, `__LA_GRAM_BUILD__.channel`) keeps its own — settings,
 * tokens, the files models are bound to, checkpoints — so that what an alpha writes, in a form the release
 * may not read yet, and what the release writes stay apart. A release keeps them as it always has.
 *
 * Scoped where it is stored, not where it is used: every key `localStorage` is asked for is put under
 * `{channel}:`, and the checkpoints' database is named with the channel ({@link scopedName}).
 */

/** The channel this build is of (`alpha`); `''` for a release, and under Vitest. */
export function storageChannel(): string {
  return typeof __LA_GRAM_BUILD__ === 'object' && __LA_GRAM_BUILD__ ? (__LA_GRAM_BUILD__.channel ?? '') : '';
}

/** `name` as this build's channel keeps it: an IndexedDB database's name. */
export function scopedName(name: string, channel = storageChannel()): string {
  return channel ? `${name}-${channel}` : name;
}

/** A storage event's key as la-gram names it: without the channel's prefix; `null` for another channel's. */
export function unscopedKey(key: string | null, channel = storageChannel()): string | null {
  if (key === null || !channel) return key;
  const prefix = `${channel}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/** A `Storage` whose keys are another's under a prefix: what `localStorage` is for a channel's build. */
export class ScopedStorage implements Storage {
  constructor(
    private readonly inner: Storage,
    private readonly prefix: string,
  ) {}

  get length(): number {
    return this.keys().length;
  }

  key(index: number): string | null {
    return this.keys()[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.inner.getItem(this.prefix + key);
  }

  setItem(key: string, value: string): void {
    this.inner.setItem(this.prefix + key, value);
  }

  removeItem(key: string): void {
    this.inner.removeItem(this.prefix + key);
  }

  /** Only this scope's keys: another channel's, and the release's, stay. */
  clear(): void {
    for (const key of this.keys()) this.inner.removeItem(this.prefix + key);
  }

  private keys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < this.inner.length; i++) {
      const key = this.inner.key(i);
      if (key?.startsWith(this.prefix)) keys.push(key.slice(this.prefix.length));
    }
    return keys;
  }
}

/**
 * For a channel's build, put `localStorage` under the channel's prefix — before anything reads it: the entry
 * point imports this first. A release's build, and a browser that refuses storage, are left as they are.
 */
export function scopeBrowserStorage(channel = storageChannel(), global: typeof globalThis = globalThis): void {
  if (!channel) return;
  let inner: Storage | undefined;
  try {
    inner = global.localStorage;
  } catch {
    return; // Storage refused: nothing is kept, in any scope.
  }
  if (!inner || inner instanceof ScopedStorage) return;
  Object.defineProperty(global, 'localStorage', { value: new ScopedStorage(inner, `${channel}:`), configurable: true });
}
