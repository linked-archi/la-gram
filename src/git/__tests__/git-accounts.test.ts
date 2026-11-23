/**
 * The user's Git accounts (Req 18.29, 9.16): read once a session per host with its token, kept on this
 * machine; the one an edit names is the open model's host's, else the one read last.
 */
import { describe, it, expect } from 'vitest';
import { GitAccounts } from '../git-accounts.js';
import { PersonalSettings } from '../../settings.js';
import type { GitAccount, GitHostProvider } from '../providers/provider.js';
import { MemoryStorage } from './memory-storage.js';

const ADA_LAB: GitAccount = { url: 'https://gitlab.com/ada', username: 'ada', name: 'Ada Lovelace' };
const ADA_HUB: GitAccount = { url: 'https://github.com/ada-l', username: 'ada-l' };

function reading(account: GitAccount | Error): { provider: GitHostProvider; asked: () => number } {
  let asked = 0;
  const provider = {
    currentAccount: async () => {
      asked++;
      if (account instanceof Error) throw account;
      return account;
    },
  } as unknown as GitHostProvider;
  return { provider, asked: () => asked };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the user’s Git accounts', () => {
  it('read once a session per host, kept; the host’s own, else the one read last', async () => {
    const storage = new MemoryStorage();
    let changes = 0;
    const accounts = new GitAccounts(new PersonalSettings(storage as unknown as Storage), () => changes++);
    const lab = reading(ADA_LAB);
    accounts.learn('gitlab.com', lab.provider);
    accounts.learn('gitlab.com', lab.provider);
    await settled();
    expect(lab.asked()).toBe(1);
    expect(accounts.of('gitlab.com')).toEqual(ADA_LAB);
    const hub = reading(ADA_HUB);
    accounts.learn('github.com', hub.provider);
    await settled();
    expect(accounts.for('gitlab.com')).toEqual(ADA_LAB);
    expect(accounts.for('git.example.org')).toEqual(ADA_HUB);
    expect(accounts.for(undefined)).toEqual(ADA_HUB);
    expect(changes).toBe(2);
    // Kept on this machine: another session knows them before reading.
    expect(new GitAccounts(new PersonalSettings(storage as unknown as Storage)).of('gitlab.com')).toEqual(ADA_LAB);
  });

  it('a token that may not read its account leaves it unknown, and nothing fails', async () => {
    const accounts = new GitAccounts(new PersonalSettings(new MemoryStorage() as unknown as Storage));
    accounts.learn('gitlab.com', reading(new Error('403 insufficient_scope')).provider);
    await settled();
    expect(accounts.for('gitlab.com')).toBeUndefined();
  });

  it('forgotten: none, until one is read again', async () => {
    const accounts = new GitAccounts(new PersonalSettings(new MemoryStorage() as unknown as Storage));
    accounts.keep('gitlab.com', ADA_LAB);
    accounts.forget();
    expect(accounts.latest()).toBeUndefined();
  });
});
