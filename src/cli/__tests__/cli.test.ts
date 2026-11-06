/**
 * la-gram-git against real Git repositories, made in a temporary folder with
 * model files la-gram writes: a good change passes; a file not as la-gram
 * writes it, a reference to what is not there, and a violation the change adds
 * each fail — one already there where the branch started does not; `fix`
 * rewrites; `diff` says the changes by element, and comments on the request a
 * CI job runs for; the merge driver merges by element; `init` sets a
 * repository up. Phase 3 of the Git collaboration plan.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataFactory } from 'n3';
import { createApp } from '../../app.js';
import { main } from '../main.js';
import { commentTarget, postComment, COMMENT_MARKER } from '../diff.js';
import { mergeFiles } from '../merge.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';

let repo: string;
/** The model as la-gram writes it: Billing serves Portal; and with Billing named otherwise. */
const versions: Record<string, string> = {};
let billing = '';
let portal = '';

const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (path: string, text: string) => {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const commit = (message: string) => {
  sh('add', '-A');
  sh('commit', '-q', '-m', message);
};

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), cwd: repo, env: {} });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

beforeAll(async () => {
  const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
  const { modelIri } = app.newModel('Shop');
  const { elementManager: e, relationshipManager: r, store } = app.components;
  billing = e.createElement(AM4 + 'ApplicationComponent', modelIri, { label: 'Billing' }).value;
  portal = e.createElement(AM4 + 'ApplicationComponent', modelIri, { label: 'Portal' }).value;
  r.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: billing, targetIri: portal });
  versions['base'] = app.saveModel('turtle').text;
  const label = store.getQuads(DataFactory.namedNode(billing) as never, DataFactory.namedNode(PREF_LABEL) as never, null);
  store.removeQuads(label);
  store.addQuads([DataFactory.quad(DataFactory.namedNode(billing), DataFactory.namedNode(PREF_LABEL), DataFactory.literal('Invoicing', 'en')) as never]);
  versions['renamed'] = app.saveModel('turtle').text;
  store.removeQuads(store.getQuads(DataFactory.namedNode(billing) as never, DataFactory.namedNode(PREF_LABEL) as never, null));
  versions['unnamed'] = app.saveModel('turtle').text;

  repo = mkdtempSync(join(tmpdir(), 'la-gram-git-'));
  sh('init', '-q', '-b', 'main');
  sh('config', 'user.email', 'test@example.org');
  sh('config', 'user.name', 'Test');
  sh('config', 'commit.gpgsign', 'false');
  write('models/shop.ttl', versions['base']!);
  write('ontology/extra.ttl', '@prefix ex: <https://example.org/ex#> .\nex:Thing a <http://www.w3.org/2000/01/rdf-schema#Class> .\n');
  commit('Shop');
}, 120_000);

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('la-gram-git check', () => {
  it('a file as la-gram writes it, whole and valid, passes; a folder’s files that are not models are left alone', async () => {
    const { code, out } = await run('check');
    expect(code).toBe(0);
    expect(out).toContain('✓ models/shop.ttl');
    expect(out).not.toContain('ontology/extra.ttl');
    expect(out).toContain('1 model file checked: all well.');
  }, 60_000);

  it('a file that is not a model, named: fails', async () => {
    const { code, out } = await run('check', 'ontology/extra.ttl');
    expect(code).toBe(1);
    expect(out).toContain('not a la-gram model: it has no arch:Model');
  }, 60_000);

  it('a file not as la-gram writes it fails, saying where — and fix rewrites it', async () => {
    write('models/shop.ttl', versions['base']!.replace(/\n/, '\n\n'));
    const failed = await run('check', 'models/shop.ttl');
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(/not as la-gram writes it \(from line \d+\): `la-gram-git fix models\/shop\.ttl` rewrites it/);
    const fixed = await run('fix');
    expect(fixed.out).toContain('Rewrote models/shop.ttl');
    expect(readFileSync(join(repo, 'models/shop.ttl'), 'utf8')).toBe(versions['base']);
    expect((await run('check', 'models/shop.ttl')).code).toBe(0);
  }, 60_000);

  it('a reference to what the file no longer has fails — as a text merge can leave', async () => {
    // Portal's own lines taken out — its subject's, up to the line that ends it — as one branch
    // deleting it and another keeping the relationship to it would leave the file.
    const lines = versions['base']!.split('\n');
    const local = portal.split('/').pop()!;
    const start = lines.findIndex((l) => l.startsWith(`m:${local} `));
    const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('.'));
    expect(start).toBeGreaterThan(0);
    write('models/shop.ttl', [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n'));
    const { code, out } = await run('check', 'models/shop.ttl');
    expect(code).toBe(1);
    expect(out).toMatch(/Its target is not in the model: .*element-/);
    write('models/shop.ttl', versions['base']!);
  }, 60_000);

  it('with --base: a violation the change adds fails; one already there where the branch started does not', async () => {
    sh('checkout', '-q', '-b', 'unnamed');
    write('models/shop.ttl', versions['unnamed']!);
    commit('Billing loses its name');
    const added = await run('check', '--base', 'main');
    expect(added.code).toBe(1);
    expect(added.out).toMatch(/✗ models\/shop\.ttl\n.*\(Application Component\) · Name: /);
    // Each finding names its shape: the label's rule is written inline, in the element shape.
    expect(added.out).toMatch(/· Name: .*\(https:\/\/meta\.linked\.archi\/archimate4\/element-shapes#ArchiMateElementShape\)/);

    sh('checkout', '-q', '-b', 'later');
    write('models/shop.ttl', versions['unnamed']!.replace('Portal', 'Web portal'));
    commit('Portal renamed');
    const already = await run('check', '--base', 'unnamed');
    expect(already.code).toBe(0);
    expect(already.out).toContain('1 violation already there where the branch started (not failed)');
    sh('checkout', '-q', 'main');
  }, 120_000);

  it('the shapes’ SPARQL-based rules are reported, not failed', async () => {
    const { code, out } = await run('check');
    expect(code).toBe(0);
    expect(out).toMatch(/from the shapes' SPARQL-based rules \(advisory\)/);
    expect(out).toMatch(/\(https:\/\/meta\.linked\.archi\/archimate4\/[a-z-]+shapes#\w+\)/);
  }, 60_000);
});

describe('la-gram-git diff', () => {
  it('the changes by element since the branch left main, as Markdown', async () => {
    sh('checkout', '-q', '-b', 'rename');
    write('models/shop.ttl', versions['renamed']!);
    commit('Billing becomes Invoicing');
    const { code, out } = await run('diff', 'main');
    sh('checkout', '-q', 'main');
    expect(code).toBe(0);
    expect(out).toContain(COMMENT_MARKER);
    expect(out).toContain('### `models/shop.ttl`');
    expect(out).toContain('**Changes by element:** 1 changed');
    expect(out).toContain('Name (en): “Billing” → “Invoicing”');
  }, 60_000);

  it('where to comment, from the CI’s environment — or why not', () => {
    const event = join(repo, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { number: 12 } }));
    expect(commentTarget({ GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 't', GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'acme/arch' })).toEqual({
      host: 'github', api: 'https://api.github.com', repository: 'acme/arch', number: 12, token: 't',
    });
    expect(commentTarget({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: event })).toMatch(/GITHUB_TOKEN is not set/);
    expect(commentTarget({ GITLAB_CI: 'true', CI_MERGE_REQUEST_IID: '3', CI_PROJECT_ID: '42', CI_API_V4_URL: 'https://gitlab.example/api/v4', LA_GRAM_GIT_TOKEN: 'g' })).toEqual({
      host: 'gitlab', api: 'https://gitlab.example/api/v4', project: '42', iid: '3', token: 'g',
    });
    expect(commentTarget({ GITLAB_CI: 'true', CI_MERGE_REQUEST_IID: '3' })).toMatch(/LA_GRAM_GIT_TOKEN is not set/);
    expect(commentTarget({})).toMatch(/not running in GitHub Actions or GitLab CI/);
  });

  it('comments once, then updates its own comment — the token only in the header', async () => {
    const calls: Array<{ method: string; url: string; auth: string; body?: string }> = [];
    let existing: Array<{ id: number; body: string }> = [{ id: 1, body: 'someone else' }];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET', url, auth: (init.headers as Record<string, string>)['Authorization']!, ...(init.body ? { body: String(init.body) } : {}) });
      if ((init.method ?? 'GET') === 'GET') return new Response(JSON.stringify(existing), { status: 200 });
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const target = { host: 'gitlab' as const, api: 'https://gitlab.example/api/v4', project: 'acme/arch', iid: '3', token: 'SECRET' };
    expect(await postComment(target, `${COMMENT_MARKER}\nfirst`, fetchFn)).toBe('commented on merge request !3');
    existing = [...existing, { id: 7, body: `${COMMENT_MARKER}\nfirst` }];
    expect(await postComment(target, `${COMMENT_MARKER}\nsecond`, fetchFn)).toBe('updated the comment on merge request !3');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://gitlab.example/api/v4/projects/acme%2Farch/merge_requests/3/notes?per_page=100&sort=desc',
      'POST https://gitlab.example/api/v4/projects/acme%2Farch/merge_requests/3/notes',
      'GET https://gitlab.example/api/v4/projects/acme%2Farch/merge_requests/3/notes?per_page=100&sort=desc',
      'PUT https://gitlab.example/api/v4/projects/acme%2Farch/merge_requests/3/notes/7',
    ]);
    expect(calls.every((c) => c.auth === 'Bearer SECRET' && !c.url.includes('SECRET') && !(c.body ?? '').includes('SECRET'))).toBe(true);
  });
});

describe('la-gram-git merge', () => {
  it('changes that do not meet: merged, as la-gram writes it', async () => {
    const theirs = versions['base']!.replace('"Portal"@en', '"Web portal"@en');
    const outcome = await mergeFiles(versions['base']!, versions['renamed']!, theirs, 'models/shop.ttl');
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.text).toContain('"Invoicing"@en');
    expect(outcome.text).toContain('"Web portal"@en');
  }, 60_000);

  it('the same name changed on both sides: a conflict in words, the name as it was held', async () => {
    const theirs = versions['base']!.replace('"Billing"@en', '"Accounts"@en');
    const outcome = await mergeFiles(versions['base']!, versions['renamed']!, theirs, 'models/shop.ttl');
    expect(outcome.conflicts).toEqual(['Billing (Application Component) · Name (en) — changed differently on each side: ours “Invoicing”, theirs “Accounts”']);
    expect(outcome.text).toContain('"Billing"@en');
    expect(outcome.text).not.toMatch(/<<<<<<<|>>>>>>>/);
  }, 60_000);

  it('a file that is not a model — an ontology, a shapes file — is merged as Git merges text', async () => {
    const lines = ['A', 'B', 'C', 'D', 'E'].map((x) => `ex:${x} a ex:Class .`);
    const text = (change: Record<number, string>) =>
      `@prefix ex: <https://example.org/ex#> .\n${lines.map((l, i) => change[i] ?? l).join('\n')}\n`;
    const files = (ours: string, theirs: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'la-gram-git-merge-'));
      const at = (name: string, body: string) => (writeFileSync(join(dir, name), body), join(dir, name));
      return { base: at('base', text({})), ours: at('ours', ours), theirs: at('theirs', theirs), dir };
    };

    const apart = files(text({ 0: 'ex:A a ex:Thing .' }), text({ 4: 'ex:E a ex:Thing .' }));
    const merged = await run('merge', apart.base, apart.ours, apart.theirs, 'ontology/extra.ttl');
    expect(merged.code).toBe(0);
    expect(readFileSync(apart.ours, 'utf8')).toBe(text({ 0: 'ex:A a ex:Thing .', 4: 'ex:E a ex:Thing .' }));

    const met = files(text({ 2: 'ex:C a ex:Thing .' }), text({ 2: 'ex:C a ex:Other .' }));
    const conflicted = await run('merge', met.base, met.ours, met.theirs, 'ontology/extra.ttl');
    expect(conflicted.code).toBe(1);
    expect(conflicted.err).toContain('ontology/extra.ttl is not a la-gram model, so it was merged as text: 1 conflict');
    expect(readFileSync(met.ours, 'utf8')).toMatch(/<<<<<<< ours\nex:C a ex:Thing \.\n=======\nex:C a ex:Other \.\n>>>>>>> theirs/);
    for (const { dir } of [apart, met]) rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});

describe('la-gram-git init', () => {
  it('github: the workflow; gitlab: the job, beside a .gitlab-ci.yml that is there; nothing overwritten', async () => {
    expect((await run('init', 'github')).out).toContain('Wrote .github/workflows/la-gram-git.yml');
    expect(readFileSync(join(repo, '.github/workflows/la-gram-git.yml'), 'utf8')).toContain('la-gram-git@0 check --base');
    expect((await run('init', 'github')).out).toContain('is there already: left as it is.');
    writeFileSync(join(repo, '.gitlab-ci.yml'), 'stages: [test]\n');
    const gitlab = await run('init', 'gitlab');
    expect(gitlab.out).toContain('Wrote la-gram-git.gitlab-ci.yml beside your .gitlab-ci.yml');
    expect(readFileSync(join(repo, '.gitlab-ci.yml'), 'utf8')).toBe('stages: [test]\n');
    expect(existsSync(join(repo, 'la-gram-git.gitlab-ci.yml'))).toBe(true);
  });

  it('merge-driver: the model files routed to it in .gitattributes, the driver defined in this clone', async () => {
    const { out } = await run('init', 'merge-driver');
    expect(out).toContain('Added 6 lines to .gitattributes');
    expect(readFileSync(join(repo, '.gitattributes'), 'utf8')).toContain('*.ttl merge=la-gram-git');
    expect(sh('config', 'merge.la-gram-git.driver').trim()).toBe('la-gram-git merge %O %A %B %P');
    expect((await run('init', 'merge-driver')).out).toContain('.gitattributes routes the model files already.');
  });

  it('no command, or a wrong one: the usage, and 2', async () => {
    expect((await run()).code).toBe(2);
    const wrong = await run('frobnicate');
    expect([wrong.code, wrong.err]).toEqual([2, 'la-gram-git: No command "frobnicate".\n`la-gram-git --help` lists the commands.']);
  });
});
