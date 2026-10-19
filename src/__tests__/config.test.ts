/**
 * The deployment's configuration (Req 19.1–19.4, Req 18.13–18.14, 18.17): the
 * check, case by case, and reading the file — none, a server's fallback page,
 * one that fails closed.
 */
import { describe, it, expect } from 'vitest';
import { checkConfig, loadDeploymentConfig, defaultConfig } from '../config.js';

const serve =
  (status: number, body: string, contentType = 'application/json') =>
  async () =>
    new Response(status === 204 ? null : body, { status, headers: { 'Content-Type': contentType } });

describe('the check', () => {
  it('a full configuration', () => {
    const loaded = checkConfig({
      modules: { git: 'off' },
      git: {
        hosts: [
          { host: 'GitHub.com', kind: 'github' },
          { host: 'git.acme.example:8443', kind: 'gitlab' },
          { host: 'ghe.acme.example', kind: 'github', api: 'https://ghe.acme.example/api/v3/' },
        ],
        rememberTokens: 'never',
        defaults: { repository: 'https://git.acme.example:8443/arch/models', folder: 'architecture/', message: '{action} {model} ({path})', branchPrefix: 'arch/' },
      },
    });
    expect(loaded.failed).toBe(false);
    expect(loaded.problems).toEqual([]);
    expect(loaded.config).toEqual({
      modules: { git: 'off' },
      git: {
        hosts: [
          { host: 'github.com', kind: 'github', api: 'https://api.github.com' },
          { host: 'git.acme.example:8443', kind: 'gitlab', api: 'https://git.acme.example:8443/api/v4' },
          { host: 'ghe.acme.example', kind: 'github', api: 'https://ghe.acme.example/api/v3' },
        ],
        rememberTokens: 'never',
        defaults: { repository: 'https://git.acme.example:8443/arch/models', folder: 'architecture', message: '{action} {model} ({path})', branchPrefix: 'arch/' },
      },
    });
  });

  it('an empty object is la-gram’s own defaults', () => {
    expect(checkConfig({})).toEqual({ config: defaultConfig(), present: true, failed: false, problems: [] });
  });

  it('unknown keys are said, and ignored', () => {
    const loaded = checkConfig({ theme: 'dark', git: { colour: 'red', defaults: { author: 'x' } } });
    expect(loaded.failed).toBe(false);
    expect(loaded.problems[0]).toMatch(/ignored what la-gram does not know: theme, git\.colour, git\.defaults\.author/);
  });

  it.each([
    ['not an object', [], /must be a JSON object/],
    ['a module value', { modules: { git: 'maybe' } }, /modules\.git must be "on", "off" or "unavailable"/],
    ['a token policy', { git: { rememberTokens: 'always' } }, /rememberTokens must be "ask" or "never"/],
    ['hosts not a list', { git: { hosts: 'github.com' } }, /git\.hosts must be a list/],
    ['a host’s kind', { git: { hosts: [{ host: 'git.acme.example', kind: 'gitea' }] } }, /kind must be "github" or "gitlab"/],
    ['a host’s name', { git: { hosts: [{ host: 'https://git.acme.example', kind: 'gitlab' }] } }, /\.host must be a host name/],
    ['a plain-http API', { git: { hosts: [{ host: 'a.example', kind: 'gitlab', api: 'http://a.example/api/v4' }] } }, /\.api must be an https:\/\/ address/],
    ['a folder from the top', { git: { defaults: { folder: '/models' } } }, /folder is a folder in the repository/],
    ['a repository that is not an address', { git: { defaults: { repository: 'acme/arch' } } }, /repository must be the repository’s https:\/\/ address/],
  ])('fails closed on %s', (_what, raw, problem) => {
    const loaded = checkConfig(raw);
    expect(loaded.failed).toBe(true);
    expect(loaded.problems.join('\n')).toMatch(problem);
    expect(loaded.config).toEqual(defaultConfig());
  });

  it('never a token: a key named like one, a value shaped like one, an address with one', () => {
    const named = checkConfig({ git: { hosts: [{ host: 'github.com', kind: 'github', token: 'x' }] } });
    expect(named.failed).toBe(true);
    expect(named.problems.join()).toMatch(/git\.hosts\[0\]\.token: tokens and passwords are never configured/);
    const shaped = checkConfig({ git: { defaults: { message: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' } } });
    expect(shaped.problems.join()).toMatch(/git\.defaults\.message holds what looks like an access token/);
    expect(checkConfig({ note: 'glpat-ABCDEFGHIJKLMNOPQRST' }).failed).toBe(true);
    const address = checkConfig({ git: { defaults: { repository: 'https://oauth2:abc@gitlab.com/a/b' } } });
    expect(address.problems.join()).toMatch(/address with credentials/);
  });

  it('“rememberTokens” is la-gram’s own key, not a secret', () => {
    expect(checkConfig({ git: { rememberTokens: 'ask' } }).failed).toBe(false);
  });
});

describe('reading the file', () => {
  it('none there: no configuration, nothing said', async () => {
    expect(await loadDeploymentConfig(serve(404, 'Not Found', 'text/plain'), 'https://ea.example/la-gram/')).toEqual({
      config: defaultConfig(),
      present: false,
      failed: false,
      problems: [],
    });
  });

  it('a server answering with its page for every path has no file', async () => {
    const loaded = await loadDeploymentConfig(serve(200, '<!doctype html><html>', 'text/html'), 'https://ea.example/');
    expect(loaded.present).toBe(false);
    expect(loaded.failed).toBe(false);
  });

  it('beside the page, never from elsewhere', async () => {
    let asked = '';
    await loadDeploymentConfig(async (url) => {
      asked = url;
      return new Response('{}', { status: 200 });
    }, 'https://ea.example/tools/la-gram/index.html?room=x');
    expect(asked).toBe('https://ea.example/tools/la-gram/la-gram.config.json');
  });

  it('not JSON, or the server failing: fails closed', async () => {
    const broken = await loadDeploymentConfig(serve(200, '{ "git": '), 'https://ea.example/');
    expect(broken.failed).toBe(true);
    expect(broken.problems[0]).toMatch(/la-gram\.config\.json is not JSON/);
    const error = await loadDeploymentConfig(serve(500, 'oops', 'text/plain'), 'https://ea.example/');
    expect(error.failed).toBe(true);
    expect(error.problems[0]).toMatch(/could not be read \(500\)/);
  });

  it('a good file', async () => {
    const loaded = await loadDeploymentConfig(serve(200, JSON.stringify({ modules: { git: 'unavailable' } })), 'https://ea.example/');
    expect(loaded).toMatchObject({ present: true, failed: false, config: { modules: { git: 'unavailable' } } });
  });
});
