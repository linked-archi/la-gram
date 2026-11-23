/**
 * The user's Git accounts, as the hosts report them (Req 18.29): read with the token la-gram is given for a
 * host, once a session, and kept on this machine — so that what la-gram records of who made an edit names the
 * account (its page and username: Req 9.16), and *Settings › You* can show it.
 *
 * The account an edit names is the one on the host the open model is kept on; for a model not kept in Git,
 * the one read last. A token that may not read its account (GitLab's without `read_user`, `read_api` or
 * `api`) only leaves the account unknown: nothing the user asked for failed.
 */

import type { PersonalSettings } from '../settings.js';
import type { GitAccount, GitHostProvider } from './providers/provider.js';

/** The section of the personal settings the accounts are kept in. */
const SECTION = 'git-accounts';

interface Kept {
  /** By host. */
  accounts?: Record<string, GitAccount>;
  /** The host whose account was read last. */
  last?: string;
}

export class GitAccounts {
  private readonly asked = new Set<string>();

  constructor(
    private readonly settings: PersonalSettings,
    /** Told when an account is read that was not known, or has changed. */
    private readonly changed: () => void = () => undefined,
  ) {}

  /** The account on `host`, as last read. */
  of(host: string): GitAccount | undefined {
    const account = this.kept().accounts?.[host];
    return isAccount(account) ? account : undefined;
  }

  /** The account on `host` when there is one, else the one read last. */
  for(host: string | undefined): GitAccount | undefined {
    return (host ? this.of(host) : undefined) ?? this.latest();
  }

  /** The account read last, on any host. */
  latest(): GitAccount | undefined {
    const last = this.kept().last;
    return last ? this.of(last) : undefined;
  }

  /**
   * Read the account `provider`'s token acts for on `host` — once a session — in the background. Kept when it
   * is read; a refusal leaves what was known.
   */
  learn(host: string, provider: GitHostProvider): void {
    if (this.asked.has(host) || !provider.currentAccount) return;
    this.asked.add(host);
    provider.currentAccount().then(
      (account) => this.keep(host, account),
      () => undefined,
    );
  }

  /** Keep `account` as the one on `host`, read now. */
  keep(host: string, account: GitAccount): void {
    const kept = this.kept();
    const before = kept.accounts?.[host];
    const same = JSON.stringify(before) === JSON.stringify(account) && kept.last === host;
    this.settings.set(SECTION, { accounts: { ...(kept.accounts ?? {}), [host]: account }, last: host });
    if (!same) this.changed();
  }

  /** Forget every account: an edit names none until one is read again. */
  forget(): void {
    this.settings.set(SECTION, {});
    this.asked.clear();
    this.changed();
  }

  private kept(): Kept {
    return this.settings.get<Kept>(SECTION);
  }
}

function isAccount(value: unknown): value is GitAccount {
  return Boolean(value) && typeof (value as GitAccount).url === 'string' && /^https?:\/\//.test((value as GitAccount).url);
}
