/**
 * Git's section of File › Settings… (Req 18.15–18.16, Req 19.5–19.7): the
 * user's defaults over the deployment's, never over its policies; the tokens
 * and host kinds kept, to forget; host kinds learned.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { gitSettingsSection } from '../settings-section.js';
import { gitDefaults } from '../git-save.js';
import { HostKinds, learnKind, readLink } from '../host-kinds.js';
import { WebTokenStore } from '../credentials.js';
import { PersonalSettings } from '../../settings.js';
import type { GitConfig } from '../../config.js';
import type { FormValues } from '../../ui/dialogs.js';
import { MemoryStorage } from './memory-storage.js';

const DEPLOYMENT: GitConfig = {
  hosts: [
    { host: 'github.com', kind: 'github', api: 'https://api.github.com' },
    { host: 'git.acme.example', kind: 'gitlab', api: 'https://git.acme.example/api/v4' },
  ],
  rememberTokens: 'ask',
  defaults: { repository: 'https://git.acme.example/arch/models', folder: 'architecture', branchPrefix: 'arch/' },
};

let storage: MemoryStorage;
let personal: PersonalSettings;
let tokens: WebTokenStore;
let kinds: HostKinds;
let reports: string[];

beforeEach(() => {
  storage = new MemoryStorage();
  personal = new PersonalSettings(storage);
  tokens = new WebTokenStore(storage);
  kinds = new HostKinds(storage);
  reports = [];
});

const section = (config: GitConfig | undefined) =>
  gitSettingsSection({ config, personal, tokens, hostKinds: kinds, report: (m) => reports.push(m) });

describe('the defaults, resolved', () => {
  it('the user’s over the deployment’s over la-gram’s; “.” is the repository’s top', () => {
    expect(gitDefaults(DEPLOYMENT, {})).toMatchObject({ folder: 'architecture', branchPrefix: 'arch/', message: '{action} {model}' });
    expect(gitDefaults(DEPLOYMENT, { folder: 'mine', message: '{model}: {action}' })).toMatchObject({
      folder: 'mine',
      message: '{model}: {action}',
      branchPrefix: 'arch/',
    });
    expect(gitDefaults(DEPLOYMENT, { folder: '.' }).folder).toBe('');
    expect(gitDefaults(undefined, {}).folder).toBe('models');
  });
});

describe('the section’s fields', () => {
  it('what the deployment sets is shown, not offered for change; its defaults are named in the hints', async () => {
    const fields = await section({ ...DEPLOYMENT, rememberTokens: 'never' }).fields();
    const field = (name: string) => fields.find((f) => f.name === name);
    expect(field('hosts')).toMatchObject({ disabled: true, value: 'github.com (GitHub), git.acme.example (GitLab)', hint: 'Set by the deployment.' });
    expect(field('remember')).toMatchObject({ disabled: true, hint: 'Set by the deployment.' });
    expect(field('repository')?.hint).toMatch(/the deployment’s, https:\/\/git\.acme\.example\/arch\/models/);
    expect(field('folder')?.hint).toMatch(/^Empty: architecture \(the deployment’s\)/);
    expect(field('branchPrefix')?.hint).toBe('Empty: arch/');
  });

  it('without a deployment: la-gram’s defaults; Remember is the user’s to set', async () => {
    const fields = await section(undefined).fields();
    expect(fields.find((f) => f.name === 'hosts')).toBeUndefined();
    expect(fields.find((f) => f.name === 'folder')?.hint).toMatch(/^Empty: models\./);
    expect(fields.find((f) => f.name === 'remember')).toMatchObject({ type: 'checkbox', value: false });
  });

  it('the tokens kept and the host kinds learned, to forget', async () => {
    await tokens.set('github.com', 'tok', false);
    kinds.set('code.example.org', 'gitlab');
    const fields = await section(undefined).fields();
    expect(fields.find((f) => f.name === 'forget:github.com')).toMatchObject({ type: 'checkbox', value: false });
    expect(fields.find((f) => f.name === 'forgetKinds')?.label).toMatch(/code\.example\.org \(GitLab\)/);
  });
});

describe('checking and applying', () => {
  const values = (v: FormValues): FormValues => ({ repository: '', branch: '', folder: '', message: '', branchPrefix: '', ...v });

  it('refuses a repository on a host the deployment does not allow, a folder from the top, a bad prefix', () => {
    const s = section(DEPLOYMENT);
    expect(s.validate!(values({ repository: 'https://gitlab.com/a/b' }))).toMatch(/not one of the Git hosts/);
    expect(s.validate!(values({ folder: '/models' }))).toMatch(/not \/models/);
    expect(s.validate!(values({ folder: '.' }))).toBeNull();
    expect(s.validate!(values({ branchPrefix: 'a b/' }))).toMatch(/cannot start with/);
    expect(s.validate!(values({ repository: 'https://git.acme.example/arch/models', branch: 'main' }))).toBeNull();
  });

  it('keeps what is given, drops what is emptied; Remember applies to the token store at once', async () => {
    const s = section(undefined);
    await s.apply(values({ folder: 'arch/', message: '{action} {model}', remember: true }));
    expect(personal.get('git')).toEqual({ folder: 'arch', message: '{action} {model}', rememberByDefault: true });
    expect(tokens.rememberByDefault).toBe(true);
    await s.apply(values({ remember: false }));
    expect(personal.get('git')).toEqual({ rememberByDefault: false });
  });

  it('forgets the tokens ticked, and the host kinds when asked', async () => {
    await tokens.set('github.com', 'a', false);
    await tokens.set('gitlab.com', 'b', false);
    kinds.set('code.example.org', 'github');
    await section(undefined).apply(values({ 'forget:github.com': true, 'forget:gitlab.com': false, forgetKinds: true }));
    expect(await tokens.hosts()).toEqual(['gitlab.com']);
    expect(reports).toEqual(['The token for github.com is forgotten.']);
    expect(kinds.list()).toEqual([]);
  });

  it('a fixed field’s value is not kept as a setting', async () => {
    await section({ ...DEPLOYMENT, rememberTokens: 'never' }).apply(values({ hosts: 'github.com', remember: 'Never' }));
    expect(personal.get('git')).toEqual({});
  });
});

describe('host kinds learned (Req 18.16)', () => {
  it('a kind chosen for a host that does not decide it is learned, and used when the dialog says “auto”', () => {
    learnKind('https://code.example.org/acme/arch', 'github', undefined, kinds);
    expect(kinds.get('code.example.org')).toBe('github');
    expect(readLink('https://code.example.org/acme/arch', undefined, undefined, kinds)).toMatchObject({
      provider: 'github',
      apiBase: 'https://code.example.org/api/v3',
    });
  });

  it('not learned for github.com, gitlab.com, a listed host, or a link that says it (/-/)', () => {
    learnKind('https://gitlab.com/a/b', 'github', undefined, kinds);
    learnKind('https://git.acme.example/a/b', 'github', DEPLOYMENT, kinds);
    learnKind('https://code.example.org/a/b/-/tree/main', 'gitlab', undefined, kinds);
    expect(kinds.list()).toEqual([]);
  });

  it('the user’s choice wins over what was learned', () => {
    kinds.set('code.example.org', 'github');
    expect(readLink('https://code.example.org/acme/arch', 'gitlab', undefined, kinds).provider).toBe('gitlab');
  });
});
