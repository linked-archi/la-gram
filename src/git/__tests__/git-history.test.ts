/**
 * The History tab's Git history (Task 21), against a repository in memory: the
 * bound file's commits a page at a time, the file as a commit had it, the
 * branch against the default, a token asked for only on demand, and *Open this
 * version* — asking first, the binding left as it was.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gitHistorySource, historyKey } from '../git-history.js';
import type { GitOpenContext } from '../git-open.js';
import { GitBindings, type GitBinding } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import type { Dialogs } from '../../ui/dialogs.js';
import type { GitHostProvider } from '../providers/provider.js';
import { MemoryStorage } from './memory-storage.js';
import { Repository } from './memory-repository.js';

const PATH = 'models/shop.nt';
const LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const line = (id: string, name: string) => `<https://example.org/m/${id}> <${LABEL}> "${name}"@en .`;
const V1 = [line('e1', 'One')];
const V2 = [line('e1', 'One'), line('e2', 'Two')].sort();
const V3 = [line('e1', 'Uno'), line('e2', 'Two')].sort();

let repo: Repository;
let reports: string[];
let confirms: boolean[];
let asked: string[];
let replaced: string[][];
let cleared: number;
let tokens: WebTokenStore;
/** Without a token, the repository answers as a private one does: not found. */
let privateRepository: boolean;
let ctx: GitOpenContext;

beforeEach(() => {
  repo = new Repository('github', PATH, `${V1.join('\n')}\n`);
  repo.push('main', V2, 'Add Two');
  repo.push('main', V3, 'Rename One');
  reports = [];
  confirms = [];
  asked = [];
  replaced = [];
  cleared = 0;
  privateRepository = false;
  const storage = new MemoryStorage();
  tokens = new WebTokenStore(storage);
  const refused = new Proxy(repo, {
    get: (target, key) => {
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function'
        ? async () => {
            throw new GitError('not-found', 'The repository acme/arch was not found — or the token cannot see it.', 404);
          }
        : value;
    },
  });
  const dialogs: Dialogs = {
    prompt: vi.fn(async () => null),
    form: vi.fn(async (title: string) => {
      asked.push(`form:${title}`);
      return { token: 'TOKEN', remember: false };
    }),
    confirm: vi.fn(async (title: string) => {
      asked.push(`confirm:${title}`);
      return confirms.length ? confirms.shift()! : true;
    }),
    choose: vi.fn(async () => null),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  ctx = {
    dialogs,
    report: (message) => reports.push(message),
    tokens,
    bindings: new GitBindings(storage),
    provider: (_link, token): GitHostProvider => (privateRepository && !token ? refused : repo),
    confirmReplace: async () => true,
    open: async () => undefined,
  };
});

function binding(branch = 'main'): GitBinding {
  const head = repo.branches.get(branch)!;
  return {
    host: 'github.com',
    provider: 'github',
    apiBase: 'https://api.github.com',
    repository: 'acme/arch',
    webUrl: 'https://github.com/acme/arch',
    branch,
    path: PATH,
    version: 'v',
    commit: head,
  };
}

const source = (b = binding()) =>
  gitHistorySource(ctx, b, {
    replace: (snapshot) => replaced.push(snapshot),
    clearConflicts: () => cleared++,
    room: () => undefined,
  });

describe('the History tab’s Git history', () => {
  it('the bound file’s commits on its branch, newest first, a page at a time', async () => {
    const history = source();
    const first = await history.commits(1, false);
    expect(first.commits.map((c) => c.message)).toEqual(['Rename One', 'Add Two']);
    expect(first.more).toBe(true);
    const second = await history.commits(2, false);
    expect([second.commits.map((c) => c.commit), second.more]).toEqual([['root'], false]);
    expect(history.where).toBe(`acme/arch · main · ${PATH}`);
  });

  it('the file as a commit had it, read once; nothing where the file was not', async () => {
    const history = source();
    const read = vi.spyOn(repo, 'readFile');
    const [, older] = (await history.commits(1, false)).commits;
    expect(await history.snapshotAt(older!.commit)).toEqual(V2);
    expect(await history.snapshotAt(older!.commit)).toEqual(V2);
    expect(read).toHaveBeenCalledTimes(1);
    repo.commit('empty', [], new Map(), 'bare');
    expect(await history.snapshotAt('bare')).toEqual([]);
  });

  it('a branch against the default: where it left it, and its head', async () => {
    const fork = repo.branches.get('main')!;
    repo.commit('la-gram/shop', [fork], new Map(repo.commits.get(fork)!.files));
    const head = repo.push('la-gram/shop', [line('e1', 'Uno'), line('e2', 'Dos')].sort());
    repo.push('main', [line('e1', 'Uno')]);
    const history = source(binding('la-gram/shop'));
    expect(await history.defaultBranch(false)).toBe('main');
    expect(await history.branchRange('main')).toEqual({ base: fork, head });
  });

  it('a private repository with no token kept: when the tab opens, says a token may be needed — asking only on Read again', async () => {
    privateRepository = true;
    const history = source();
    await expect(history.commits(1, false)).rejects.toThrow(/A token may be needed to read it\./);
    expect(asked).toEqual([]);
    const page = await history.commits(1, true);
    expect(asked).toEqual(['form:Access token for github.com']);
    expect(page.commits).toHaveLength(2);
  });

  it('Open this version: asks, then the model is the file at that commit, its conflicts gone; the binding is not touched', async () => {
    const b = binding();
    const history = source(b);
    const [, older] = (await history.commits(1, false)).commits;
    await history.openVersion(older!);
    expect(asked).toEqual(['confirm:Open this version']);
    expect(replaced).toEqual([V2]);
    expect(cleared).toBe(1);
    expect(reports).toEqual([`The model is ${PATH} as at ${older!.commit.slice(0, 8)}. Save to Git commits it to main.`]);
    expect(historyKey(b)).toBe(history.key);
  });

  it('Open this version, declined: nothing changes; at a commit without the file: says so', async () => {
    const history = source();
    const [newest] = (await history.commits(1, false)).commits;
    confirms.push(false);
    await history.openVersion(newest!);
    expect(replaced).toEqual([]);
    await history.openVersion({ ...newest!, commit: 'nowhere' });
    expect(replaced).toEqual([]);
    expect(reports.at(-1)).toMatch(/could not be read|was not there/);
  });

  it('another commit bound — after a save — is another history', () => {
    expect(historyKey(binding())).not.toBe(historyKey({ ...binding(), commit: 'later' }));
  });
});
