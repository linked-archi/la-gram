/**
 * Access tokens, kept per host and sent only to it (Req 18.5).
 *
 * Every token given is held for the session, in memory. Remembered beyond it:
 *
 * - **desktop** — encrypted with the operating system's keychain, by the main
 *   process (Electron `safeStorage`), which the renderer asks through the
 *   preload bridge (`secretGet` / `secretSet` / `secretDelete`); it never sees
 *   the encrypted file. Where there is no keychain (Linux without one) a token
 *   is kept for the session only;
 * - **web** — in this browser's `localStorage`, when the user asks for it: the
 *   page's own origin can read it, so it is opt-in, and said so.
 *
 * Nothing here logs a token or puts it in an error.
 */
import type { DesktopBridge } from '../platform/desktop-bridge.js';

/** Where tokens are kept. */
export interface TokenStore {
  /** The token for a host: the session's, or a remembered one. */
  get(host: string): Promise<string | undefined>;
  /** Keep a token for a host — for the session, and beyond it when `remember`. */
  set(host: string, token: string, remember: boolean): Promise<void>;
  /** Forget a host's token, the session's and the remembered one. */
  forget(host: string): Promise<void>;
  /** Hosts with a token, in the session or remembered. */
  hosts(): Promise<string[]>;
  /** Forget the session's tokens (the module switched off). */
  clearSession(): void;
  /** The "remember" checkbox's label; `undefined` when tokens cannot be remembered here. */
  readonly rememberLabel: string | undefined;
  /** Whether the checkbox starts ticked. */
  readonly rememberByDefault: boolean;
}

const WEB_KEY = 'la-gram:git-tokens';

/** Hosts as tokens are keyed: lower case, with the port when there is one. */
function key(host: string): string {
  return host.trim().toLowerCase();
}

/** The web build's store: the session, and `localStorage` when asked. */
export class WebTokenStore implements TokenStore {
  private readonly session = new Map<string, string>();
  readonly rememberLabel = 'Remember on this browser (stored unencrypted; anyone using this browser profile can read it)';
  readonly rememberByDefault = false;

  constructor(private readonly storage: Storage | undefined = safeLocalStorage()) {}

  async get(host: string): Promise<string | undefined> {
    return this.session.get(key(host)) ?? this.remembered()[key(host)];
  }

  async set(host: string, token: string, remember: boolean): Promise<void> {
    this.session.set(key(host), token);
    const all = this.remembered();
    if (remember) all[key(host)] = token;
    else delete all[key(host)];
    this.write(all);
  }

  async forget(host: string): Promise<void> {
    this.session.delete(key(host));
    const all = this.remembered();
    delete all[key(host)];
    this.write(all);
  }

  async hosts(): Promise<string[]> {
    return [...new Set([...this.session.keys(), ...Object.keys(this.remembered())])].sort();
  }

  clearSession(): void {
    this.session.clear();
  }

  private remembered(): Record<string, string> {
    try {
      const raw = this.storage?.getItem(WEB_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private write(all: Record<string, string>): void {
    try {
      if (Object.keys(all).length === 0) this.storage?.removeItem(WEB_KEY);
      else this.storage?.setItem(WEB_KEY, JSON.stringify(all));
    } catch {
      // Storage refused (private window, quota): the session copy stands.
    }
  }
}

/** The desktop build's store: the session, and the system keychain through the bridge. */
export class DesktopTokenStore implements TokenStore {
  private readonly session = new Map<string, string>();
  readonly rememberByDefault = true;

  private constructor(
    private readonly bridge: Required<Pick<DesktopBridge, 'secretGet' | 'secretSet' | 'secretDelete' | 'secretKeys'>>,
    readonly rememberLabel: string | undefined,
  ) {}

  /** The store, once the main process has said whether it can encrypt. */
  static async create(bridge: DesktopBridge): Promise<DesktopTokenStore | undefined> {
    if (!bridge.secretGet || !bridge.secretSet || !bridge.secretDelete || !bridge.secretKeys || !bridge.secretsAvailable) {
      return undefined;
    }
    const available = await bridge.secretsAvailable().catch(() => false);
    return new DesktopTokenStore(
      { secretGet: bridge.secretGet, secretSet: bridge.secretSet, secretDelete: bridge.secretDelete, secretKeys: bridge.secretKeys },
      available ? 'Remember on this computer (encrypted with the system keychain)' : undefined,
    );
  }

  async get(host: string): Promise<string | undefined> {
    const session = this.session.get(key(host));
    if (session) return session;
    if (!this.rememberLabel) return undefined;
    const stored = await this.bridge.secretGet(`git:${key(host)}`).catch(() => null);
    return stored ?? undefined;
  }

  async set(host: string, token: string, remember: boolean): Promise<void> {
    this.session.set(key(host), token);
    if (!this.rememberLabel) return;
    if (remember) await this.bridge.secretSet(`git:${key(host)}`, token);
    else await this.bridge.secretDelete(`git:${key(host)}`).catch(() => undefined);
  }

  async forget(host: string): Promise<void> {
    this.session.delete(key(host));
    if (this.rememberLabel) await this.bridge.secretDelete(`git:${key(host)}`).catch(() => undefined);
  }

  async hosts(): Promise<string[]> {
    const stored = this.rememberLabel ? await this.bridge.secretKeys().catch(() => [] as string[]) : [];
    const remembered = stored.filter((k) => k.startsWith('git:')).map((k) => k.slice('git:'.length));
    return [...new Set([...this.session.keys(), ...remembered])].sort();
  }

  clearSession(): void {
    this.session.clear();
  }
}

/** `localStorage`, or `undefined` where the browser refuses it. */
function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
