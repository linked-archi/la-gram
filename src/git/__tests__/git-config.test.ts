/**
 * Git storage as the deployment configures it (Req 18.13–18.14): the hosts
 * list — refused before anything is asked or sent —, the token policy, the
 * defaults of a new save.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseRepositoryLink } from '../link.js';
import { providerFor } from '../module.js';
import { saveToGit, gitDefaults, commitMessage, type GitSaveContext } from '../git-save.js';
import { openFromGit, type GitOpenContext } from '../git-open.js';
import { GitBindings } from '../bindings.js';
import { DesktopTokenStore, WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import type { GitConfig } from '../../config.js';
import type { Dialogs, FormField, FormOptions, FormValues } from '../../ui/dialogs.js';
import type { CommitResult, FileChange, GitHostProvider } from '../providers/provider.js';
import type { DesktopBridge } from '../../platform/desktop-bridge.js';
import { MemoryStorage } from './memory-storage.js';

const HOSTS: GitConfig['hosts'] = [
  { host: 'github.com', kind: 'github', api: 'https://api.github.com' },
  { host: 'git.acme.example', kind: 'gitlab', api: 'https://git.acme.example/gitlab/api/v4' },
];

describe('the hosts list', () => {
  it('a listed host: its kind and API address are the list’s', () => {
    expect(parseRepositoryLink('https://git.acme.example/arch/models', 'github', HOSTS)).toMatchObject({
      provider: 'gitlab',
      providerKnown: true,
      apiBase: 'https://git.acme.example/gitlab/api/v4',
    });
  });

  it('any other host is refused, naming the ones allowed', () => {
    expect(() => parseRepositoryLink('https://gitlab.com/acme/arch', undefined, HOSTS)).toThrow(
      'gitlab.com is not one of the Git hosts this installation allows: github.com, git.acme.example.',
    );
    expect(() => parseRepositoryLink('https://github.com/a/b', undefined, [])).toThrow('This installation allows no Git host.');
  });

  it('the last check before a request: no provider for another host', () => {
    const link = parseRepositoryLink('https://gitlab.com/acme/arch');
    expect(() => providerFor(link, 't', { hosts: HOSTS, rememberTokens: 'ask', defaults: {} })).toThrow(GitError);
    expect(providerFor(link, 't', { rememberTokens: 'ask', defaults: {} })).toBeDefined();
  });
});

describe('the token policy “never”', () => {
  it('the web: no checkbox, nothing kept in the browser', async () => {
    const storage = new MemoryStorage();
    storage.setItem('la-gram:git-tokens', JSON.stringify({ 'github.com': 'kept-before' }));
    const store = new WebTokenStore(storage, false);
    expect(store.rememberLabel).toBeUndefined();
    expect(await store.get('github.com')).toBeUndefined();
    await store.set('github.com', 'tok', true);
    expect(storage.dump()).not.toContain('"tok"');
    expect(await store.get('github.com')).toBe('tok');
  });

  it('the desktop: the keychain neither read nor written', async () => {
    const secretGet = vi.fn(async () => 'kept-before');
    const secretSet = vi.fn(async () => undefined);
    const bridge = {
      secretsAvailable: async () => true,
      secretGet,
      secretSet,
      secretDelete: async () => undefined,
      secretKeys: async () => ['git:github.com'],
    } as unknown as DesktopBridge;
    const store = (await DesktopTokenStore.create(bridge, false))!;
    expect(store.rememberLabel).toBeUndefined();
    expect(await store.get('github.com')).toBeUndefined();
    await store.set('github.com', 'tok', true);
    expect(secretGet).not.toHaveBeenCalled();
    expect(secretSet).not.toHaveBeenCalled();
  });
});

describe('the defaults of a new save', () => {
  it('la-gram’s own, and the deployment’s over them', () => {
    expect(gitDefaults(undefined)).toEqual({ folder: 'models', message: '{action} {model}', branchPrefix: 'la-gram/' });
    expect(gitDefaults({ rememberTokens: 'ask', defaults: { folder: '', branch: 'trunk', branchPrefix: 'arch/' } })).toEqual({
      branch: 'trunk',
      folder: '',
      message: '{action} {model}',
      branchPrefix: 'arch/',
    });
  });

  it('the message template', () => {
    expect(commitMessage('{action} {model} in {path} on {branch}', { action: 'Add', model: 'Shop', path: 'm/shop.ttl', branch: 'main' })).toBe(
      'Add Shop in m/shop.ttl on main',
    );
    expect(commitMessage('arch: {model}', { action: 'Update', model: 'Shop', path: '', branch: '' })).toBe('arch: Shop');
  });
});

/** Flows against a host that records whether anything was asked of it. */
describe('the flows with a configuration', () => {
  let requests: string[];
  let asked: string[];
  let forms: Array<FormValues | null>;
  let storage: MemoryStorage;
  let reports: Array<{ message: string; level?: string }>;
  let commits: FileChange[];
  const config: GitConfig = {
    hosts: HOSTS,
    rememberTokens: 'ask',
    defaults: { repository: 'https://git.acme.example/arch/models', folder: 'architecture', message: 'arch: {action} {model}', branchPrefix: 'arch/' },
  };

  const repo: GitHostProvider = {
    defaultBranch: async () => (requests.push('defaultBranch'), 'main'),
    branchHead: async (b) => (requests.push(`head:${b}`), 'h1'),
    readFile: async (ref, path) => (requests.push(`read:${ref}:${path}`), undefined),
    listFiles: async () => (requests.push('list'), { paths: [], truncated: false }),
    listBranches: async () => (requests.push('branches'), []),
    commitFile: async (change): Promise<CommitResult> => {
      requests.push('commit');
      commits.push(change);
      return { version: 'v1', commit: 'c1', branch: change.branch, webUrl: 'u' };
    },
  };

  function dialogs(): Dialogs {
    return {
      prompt: vi.fn(async (title: string) => (asked.push(`prompt:${title}`), 'msg')),
      form: vi.fn(async (title: string, fields: FormField[], options?: FormOptions) => {
        asked.push(`form:${title}`);
        const answer = forms.length ? forms.shift()! : {};
        if (answer === null) return null;
        const values: FormValues = { ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...answer };
        const problem = options?.validate?.(values);
        if (problem) throw new Error(`form rejected: ${problem}`);
        return values;
      }),
      confirm: vi.fn(async () => true),
      choose: vi.fn(async () => null),
      info: vi.fn(async () => undefined),
      toast: vi.fn(),
    };
  }

  function saveContext(): GitSaveContext {
    return {
      modelIri: () => 'https://example.org/m/1',
      modelLabel: () => 'Shop',
      serialize: () => '# model',
      saved: () => undefined,
      dialogs: dialogs(),
      report: (message, level) => reports.push({ message, ...(level ? { level } : {}) }),
      tokens: new WebTokenStore(storage),
      bindings: new GitBindings(storage),
      provider: (link, token) => providerFor(link, token, config) && repo,
      config,
    };
  }

  beforeEach(() => {
    requests = [];
    asked = [];
    forms = [];
    reports = [];
    commits = [];
    storage = new MemoryStorage();
  });

  it('the Save dialog starts from the deployment’s defaults and names the hosts allowed', async () => {
    const ctx = saveContext();
    forms.push({}, { token: 't' });
    await saveToGit(ctx);
    const fields = vi.mocked(ctx.dialogs.form).mock.calls[0][1];
    const value = (name: string) => fields.find((f) => f.name === name)?.value;
    expect(value('repository')).toBe('https://git.acme.example/arch/models');
    expect(value('path')).toBe('architecture/shop.ttl');
    expect(value('message')).toBe('arch: Add Shop');
    expect(fields.find((f) => f.name === 'repository')?.hint).toMatch(/allows github\.com, git\.acme\.example/);
    expect(commits[0]).toMatchObject({ path: 'architecture/shop.ttl', message: 'arch: Add Shop' });
  });

  it('a save to a host not listed: refused in the dialog, before any token or request', async () => {
    forms.push({ repository: 'https://gitlab.com/acme/arch' });
    await expect(saveToGit(saveContext())).rejects.toThrow(/gitlab\.com is not one of the Git hosts this installation allows/);
    expect(asked).toEqual(['form:Save to Git']);
    expect(requests).toEqual([]);
  });

  it('a model bound to a host the list no longer has: refused before anything is asked', async () => {
    const ctx = saveContext();
    ctx.bindings.set('https://example.org/m/1', {
      host: 'gitlab.com',
      provider: 'gitlab',
      apiBase: 'https://gitlab.com/api/v4',
      repository: 'acme/arch',
      webUrl: 'https://gitlab.com/acme/arch',
      branch: 'main',
      path: 'models/shop.ttl',
      version: 'v0',
      commit: 'c0',
    });
    await saveToGit(ctx);
    expect(asked).toEqual([]);
    expect(requests).toEqual([]);
    expect(reports[0]).toMatchObject({ level: 'error' });
    expect(reports[0].message).toMatch(/not one of the Git hosts.*Save to Git as… commits elsewhere/);
  });

  it('Open from Git: a host not listed is refused before any request; the default repository is offered', async () => {
    const open: GitOpenContext = {
      dialogs: dialogs(),
      report: (message, level) => reports.push({ message, ...(level ? { level } : {}) }),
      tokens: new WebTokenStore(storage),
      bindings: new GitBindings(storage),
      provider: () => repo,
      confirmReplace: async () => true,
      open: async () => 'https://example.org/m/2',
      config,
    };
    await openFromGit(open, 'https://gitlab.com/acme/arch/-/blob/main/a.ttl');
    expect(requests).toEqual([]);
    expect(reports.at(-1)?.message).toMatch(/gitlab\.com is not one of the Git hosts/);

    forms.push(null);
    await openFromGit(open);
    const repository = vi.mocked(open.dialogs.form).mock.calls[0][1].find((f) => f.name === 'repository');
    expect(repository?.value).toBe('https://git.acme.example/arch/models');
    expect(repository?.hint).toMatch(/allows github\.com, git\.acme\.example/);
  });
});
