/**
 * The kinds learned for self-hosted Git hosts (Req 18.16): choosing GitHub or
 * GitLab for an address the host does not decide — not github.com or
 * gitlab.com, not in the deployment's list — remembers it for that host on this
 * machine, so the next address there needs no choice.
 *
 * Kept in `localStorage` (`la-gram:git-hosts`); forgotten in *File › Settings…*.
 */
import type { GitConfig } from '../config.js';
import { parseRepositoryLink, type GitProviderKind, type RepositoryLink } from './link.js';

const KEY = 'la-gram:git-hosts';

/** Learned kinds, per host. */
export class HostKinds {
  constructor(private readonly storage: Storage | undefined = safeLocalStorage()) {}

  get(host: string): GitProviderKind | undefined {
    const kind = this.all()[host.toLowerCase()];
    return kind === 'github' || kind === 'gitlab' ? kind : undefined;
  }

  set(host: string, kind: GitProviderKind): void {
    this.write({ ...this.all(), [host.toLowerCase()]: kind });
  }

  /** Every learned host, by name. */
  list(): Array<[string, GitProviderKind]> {
    return Object.entries(this.all())
      .filter((e): e is [string, GitProviderKind] => e[1] === 'github' || e[1] === 'gitlab')
      .sort(([a], [b]) => a.localeCompare(b));
  }

  clear(): void {
    this.write({});
  }

  private all(): Record<string, string> {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private write(all: Record<string, string>): void {
    try {
      if (Object.keys(all).length === 0) this.storage?.removeItem(KEY);
      else this.storage?.setItem(KEY, JSON.stringify(all));
    } catch {
      // Storage refused: not learned.
    }
  }
}

/**
 * Read an address as the dialogs do: the deployment's hosts list first; then
 * the kind the user chose; else, when the host does not decide, the kind
 * learned for it.
 */
export function readLink(
  text: string,
  chosen: GitProviderKind | undefined,
  config: GitConfig | undefined,
  kinds: HostKinds | undefined,
): RepositoryLink {
  const link = parseRepositoryLink(text, chosen, config?.hosts);
  if (chosen || link.providerKnown) return link;
  const learned = kinds?.get(link.host);
  return learned ? parseRepositoryLink(text, learned, config?.hosts) : link;
}

/** Learn the kind the user chose for a host that does not decide it. */
export function learnKind(text: string, chosen: GitProviderKind | undefined, config: GitConfig | undefined, kinds: HostKinds | undefined): void {
  if (!chosen || !kinds) return;
  const plain = parseRepositoryLink(text, undefined, config?.hosts);
  const decided = plain.host === 'github.com' || plain.host === 'gitlab.com' || config?.hosts?.some((h) => h.host === plain.host);
  if (!decided && !(plain.providerKnown && plain.provider === chosen)) kinds.set(plain.host, chosen);
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
