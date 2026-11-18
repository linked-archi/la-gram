/**
 * GitHub's and GitLab's REST APIs, against recorded exchanges (Req 18.3, 18.5,
 * 18.7, 18.10): the requests la-gram makes, and what it makes of the answers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GitHubProvider } from '../providers/github.js';
import { GitLabProvider } from '../providers/gitlab.js';
import { fromBase64, toBase64, retryTime } from '../providers/provider.js';
import { GitError, setDesktop } from '../errors.js';
import { parseRepositoryLink } from '../link.js';
import { fakeHost, unreachable } from './fake-host.js';

const TOKEN = 'ghp_secretTOKEN123';
const TEXT = '@prefix m: <https://example.org/m/> .\nm:a m:label "Café 中 ✓" .\n';
const github = parseRepositoryLink('https://github.com/acme/arch');
const gitlab = parseRepositoryLink('https://gitlab.com/acme/platform/arch');
const GH = 'https://api.github.com/repos/acme/arch';
const GL = 'https://gitlab.com/api/v4/projects/acme%2Fplatform%2Farch';

beforeEach(() => setDesktop(false));

async function failure(promise: Promise<unknown>): Promise<GitError> {
  try {
    await promise;
  } catch (err: unknown) {
    if (err instanceof GitError) return err;
    throw err;
  }
  throw new Error('expected a GitError');
}

describe('base64, as the hosts send and take it', () => {
  it('round-trips UTF-8, and reads GitHub’s line-broken base64', () => {
    expect(fromBase64(toBase64(TEXT))).toBe(TEXT);
    const broken = toBase64(TEXT).replace(/(.{20})/g, '$1\n');
    expect(fromBase64(broken)).toBe(TEXT);
  });
});

describe('retry timing for scheduled reads', () => {
  it('retains retry headers on a provider error without exposing the host’s body', async () => {
    const host = fakeHost([{ method: 'GET', url: `${GH}/branches/main`, status: 429,
      headers: { 'retry-after': '120' }, text: `secret ${TOKEN}` }]);
    const before = Date.now();
    const error = await failure(new GitHubProvider(github, TOKEN, host.fetch).branchHead('main'));
    expect(error.retryAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(error.kind).toBe('rate-limit');
    expect(error.message).not.toContain(TOKEN);
  });

  it('accepts HTTP dates and rate-limit reset times, and ignores malformed or past values', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(retryTime(new Headers({ 'retry-after': 'Wed, 18 Nov 2026 12:02:00 GMT' }), now)).toBe(now + 120_000);
    expect(retryTime(new Headers({ 'retry-after': '30', 'x-ratelimit-reset': String(now / 1000 + 90) }), now)).toBe(now + 90_000);
    expect(retryTime(new Headers({ 'retry-after': 'unknown', 'x-ratelimit-reset': '0' }), now)).toBeUndefined();
  });
});

describe('GitHub', () => {
  it('commits a new file to a branch: the token in the header only, the content base64, no sha', async () => {
    const host = fakeHost([
      {
        method: 'PUT',
        url: `${GH}/contents/models/shop%20floor.ttl`,
        status: 201,
        body: { content: { sha: 'blob1' }, commit: { sha: 'c0ffee11', html_url: 'https://github.com/acme/arch/commit/c0ffee11' } },
      },
    ]);
    const result = await new GitHubProvider(github, TOKEN, host.fetch).commitFile({
      branch: 'main',
      path: 'models/shop floor.ttl',
      text: TEXT,
      message: 'Add shop',
    });
    expect(result).toEqual({ version: 'blob1', commit: 'c0ffee11', branch: 'main', webUrl: 'https://github.com/acme/arch/commit/c0ffee11' });
    const [call] = host.calls;
    expect(call.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(call.url).not.toContain(TOKEN);
    expect(call.body).toEqual({ message: 'Add shop', content: toBase64(TEXT), branch: 'main' });
  });

  it('replaces the version it names, and a file that moved on is a conflict', async () => {
    const host = fakeHost([{ method: 'PUT', url: `${GH}/contents/models/shop.ttl`, status: 409, text: '{"message":"is at abc but expected blob1"}' }]);
    const err = await failure(
      new GitHubProvider(github, TOKEN, host.fetch).commitFile({
        branch: 'main',
        path: 'models/shop.ttl',
        text: TEXT,
        message: 'Update',
        expectedVersion: 'blob1',
      }),
    );
    expect(host.calls[0].body?.['sha']).toBe('blob1');
    expect(err.kind).toBe('conflict');
    expect(err.message).toMatch(/models\/shop\.ttl changed in the repository/);
  });

  it('a file that is there but was not named is a conflict too (422, no sha)', async () => {
    const host = fakeHost([{ method: 'PUT', url: /contents/, status: 422, text: '{"message":"Invalid request.\\n\\n\\"sha\\" wasn\'t supplied."}' }]);
    const err = await failure(new GitHubProvider(github, TOKEN, host.fetch).commitFile({ branch: 'main', path: 'a.ttl', text: TEXT, message: 'x' }));
    expect(err.kind).toBe('conflict');
  });

  it('a new branch: from the commit the model was at, or from the base branch’s head', async () => {
    const answers = [
      { method: 'GET', url: `${GH}/branches/main`, body: { commit: { sha: 'head1' } } },
      { method: 'POST', url: `${GH}/git/refs`, status: 201, body: {} },
      { method: 'PUT', url: `${GH}/contents/a.ttl`, body: { content: { sha: 'b2' }, commit: { sha: 'c2', html_url: 'u' } } },
    ];
    const from = fakeHost(answers);
    const result = await new GitHubProvider(github, TOKEN, from.fetch).commitFile({
      branch: 'main',
      newBranch: 'la-gram/shop',
      startFrom: 'opened1',
      path: 'a.ttl',
      text: TEXT,
      message: 'x',
      expectedVersion: 'b1',
    });
    expect(from.calls.map((c) => `${c.method} ${c.url.replace(GH, '')}`)).toEqual(['POST /git/refs', 'PUT /contents/a.ttl']);
    expect(from.calls[0].body).toEqual({ ref: 'refs/heads/la-gram/shop', sha: 'opened1' });
    expect(from.calls[1].body?.['branch']).toBe('la-gram/shop');
    expect(result.branch).toBe('la-gram/shop');

    const head = fakeHost(answers);
    await new GitHubProvider(github, TOKEN, head.fetch).commitFile({ branch: 'main', newBranch: 'x', path: 'a.ttl', text: TEXT, message: 'x' });
    expect(head.calls[1].body).toEqual({ ref: 'refs/heads/x', sha: 'head1' });
  });

  it('a branch name already taken', async () => {
    const host = fakeHost([{ method: 'POST', url: `${GH}/git/refs`, status: 422, text: '{"message":"Reference already exists"}' }]);
    const err = await failure(
      new GitHubProvider(github, TOKEN, host.fetch).commitFile({ branch: 'main', newBranch: 'dev', startFrom: 's', path: 'a.ttl', text: TEXT, message: 'x' }),
    );
    expect(err.kind).toBe('exists');
  });

  it('reads a file and its version; a missing file is undefined; a folder is refused', async () => {
    const host = fakeHost([
      { method: 'GET', url: `${GH}/contents/models/shop.ttl?ref=main`, body: { type: 'file', sha: 'blob1', size: 60, encoding: 'base64', content: toBase64(TEXT) } },
      { method: 'GET', url: `${GH}/contents/none.ttl?ref=main`, status: 404, body: { message: 'Not Found' } },
      { method: 'GET', url: `${GH}/contents/models?ref=main`, body: [{ type: 'file', sha: 'x', size: 1 }] },
    ]);
    const provider = new GitHubProvider(github, TOKEN, host.fetch);
    expect(await provider.readFile('main', 'models/shop.ttl')).toEqual({ text: TEXT, version: 'blob1' });
    expect(await provider.readFile('main', 'none.ttl')).toBeUndefined();
    expect((await failure(provider.readFile('main', 'models'))).kind).toBe('invalid');
  });

  it('a file over a megabyte comes raw, asked again', async () => {
    const host = fakeHost([
      { method: 'GET', url: /contents\/big\.ttl/, body: { type: 'file', sha: 'big1', size: 2_000_000, encoding: 'none', content: '' } },
    ]);
    // The second answer is the raw text: replace the route once the first is asked.
    let asked = 0;
    const fetchFn: typeof host.fetch = async (url, init) => {
      asked++;
      if (asked === 2) {
        expect((init?.headers as Record<string, string>)['Accept']).toBe('application/vnd.github.raw');
        return new Response(TEXT, { status: 200 });
      }
      return host.fetch(url, init);
    };
    expect(await new GitHubProvider(github, TOKEN, fetchFn).readFile('main', 'big.ttl')).toEqual({ text: TEXT, version: 'big1' });
  });

  it('the default branch and a branch’s head', async () => {
    const host = fakeHost([
      { method: 'GET', url: GH, body: { default_branch: 'trunk' } },
      { method: 'GET', url: `${GH}/branches/feature%2Fx`, body: { commit: { sha: 'f1' } } },
    ]);
    const provider = new GitHubProvider(github, TOKEN, host.fetch);
    expect(await provider.defaultBranch()).toBe('trunk');
    expect(await provider.branchHead('feature/x')).toBe('f1');
  });

  it('GitHub Enterprise: the API under the host', async () => {
    const host = fakeHost([{ method: 'GET', url: 'https://github.acme.example/api/v3/repos/p/arch', body: { default_branch: 'main' } }]);
    await new GitHubProvider(parseRepositoryLink('https://github.acme.example/p/arch'), TOKEN, host.fetch).defaultBranch();
    expect(host.calls).toHaveLength(1);
  });
});

describe('GitLab', () => {
  it('commits a new file through the Commits API, the project by its encoded path', async () => {
    const host = fakeHost([
      { method: 'POST', url: `${GL}/repository/commits`, status: 201, body: { id: 'c1d2e3f4', web_url: 'https://gitlab.com/acme/platform/arch/-/commit/c1d2e3f4' } },
    ]);
    const result = await new GitLabProvider(gitlab, TOKEN, host.fetch).commitFile({ branch: 'main', path: 'models/shop.ttl', text: TEXT, message: 'Add shop' });
    expect(result).toEqual({ version: 'c1d2e3f4', commit: 'c1d2e3f4', branch: 'main', webUrl: 'https://gitlab.com/acme/platform/arch/-/commit/c1d2e3f4' });
    expect(host.calls[0].headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(host.calls[0].body).toEqual({
      branch: 'main',
      commit_message: 'Add shop',
      actions: [{ action: 'create', file_path: 'models/shop.ttl', content: TEXT }],
    });
  });

  it('an update names the file’s last commit; a file that moved on is a conflict', async () => {
    const host = fakeHost([
      {
        method: 'POST',
        url: `${GL}/repository/commits`,
        status: 400,
        text: '{"message":"You are attempting to update a file that has changed since you started editing it."}',
      },
    ]);
    const err = await failure(
      new GitLabProvider(gitlab, TOKEN, host.fetch).commitFile({ branch: 'main', path: 'a.ttl', text: TEXT, message: 'x', expectedVersion: 'last1' }),
    );
    expect(host.calls[0].body?.['actions']).toEqual([{ action: 'update', file_path: 'a.ttl', content: TEXT, last_commit_id: 'last1' }]);
    expect(err.kind).toBe('conflict');
  });

  it('a new branch from the commit the model was at, or from the base branch', async () => {
    const answer = { method: 'POST', url: `${GL}/repository/commits`, body: { id: 'c9', web_url: 'u' } };
    const from = fakeHost([answer]);
    await new GitLabProvider(gitlab, TOKEN, from.fetch).commitFile({ branch: 'main', newBranch: 'x', startFrom: 'opened1', path: 'a.ttl', text: TEXT, message: 'm' });
    expect(from.calls[0].body).toMatchObject({ branch: 'x', start_sha: 'opened1' });
    const base = fakeHost([answer]);
    await new GitLabProvider(gitlab, TOKEN, base.fetch).commitFile({ branch: 'main', newBranch: 'x', path: 'a.ttl', text: TEXT, message: 'm' });
    expect(base.calls[0].body).toMatchObject({ branch: 'x', start_branch: 'main' });
    expect(base.calls[0].body).not.toHaveProperty('start_sha');
  });

  it('a branch name already taken', async () => {
    const host = fakeHost([{ method: 'POST', url: /commits/, status: 400, text: '{"message":"A branch called \'x\' already exists."}' }]);
    const err = await failure(new GitLabProvider(gitlab, TOKEN, host.fetch).commitFile({ branch: 'main', newBranch: 'x', path: 'a.ttl', text: TEXT, message: 'm' }));
    expect(err.kind).toBe('exists');
  });

  it('reads a file and its last commit; a missing file is undefined', async () => {
    const host = fakeHost([
      {
        method: 'GET',
        url: `${GL}/repository/files/models%2Fshop.ttl?ref=dev`,
        body: { content: toBase64(TEXT), encoding: 'base64', last_commit_id: 'last7', commit_id: 'head9' },
      },
      { method: 'GET', url: /files\/none/, status: 404, body: { message: '404 File Not Found' } },
    ]);
    const provider = new GitLabProvider(gitlab, TOKEN, host.fetch);
    expect(await provider.readFile('dev', 'models/shop.ttl')).toEqual({ text: TEXT, version: 'last7' });
    expect(await provider.readFile('dev', 'none.ttl')).toBeUndefined();
  });

  it('the default branch and a branch’s head', async () => {
    const host = fakeHost([
      { method: 'GET', url: GL, body: { default_branch: 'main' } },
      { method: 'GET', url: `${GL}/repository/branches/dev`, body: { commit: { id: 'd1' } } },
    ]);
    const provider = new GitLabProvider(gitlab, TOKEN, host.fetch);
    expect(await provider.defaultBranch()).toBe('main');
    expect(await provider.branchHead('dev')).toBe('d1');
  });
});

describe('merging (the Git collaboration plan)', () => {
  it('GitHub: the merge base of two commits, by the compare API', async () => {
    const host = fakeHost([{ method: 'GET', url: `${GH}/compare/aaa111...bbb222`, body: { merge_base_commit: { sha: 'base000' } } }]);
    expect(await new GitHubProvider(github, TOKEN, host.fetch).mergeBase('aaa111', 'bbb222')).toBe('base000');
  });

  it('GitHub: a merge commit — the head’s tree, a blob, a tree, a commit with both parents, the branch moved without force', async () => {
    const host = fakeHost([
      { method: 'GET', url: `${GH}/git/commits/head111`, body: { tree: { sha: 'tree0' } } },
      { method: 'POST', url: `${GH}/git/blobs`, status: 201, body: { sha: 'blob9' } },
      { method: 'POST', url: `${GH}/git/trees`, status: 201, body: { sha: 'tree9' } },
      { method: 'POST', url: `${GH}/git/commits`, status: 201, body: { sha: 'merge9', html_url: 'https://github.com/acme/arch/commit/merge9' } },
      { method: 'PATCH', url: `${GH}/git/refs/heads/la-gram/feature`, body: { object: { sha: 'merge9' } } },
    ]);
    const result = await new GitHubProvider(github, TOKEN, host.fetch).commitMerge({
      branch: 'la-gram/feature',
      head: 'head111',
      mergeOf: 'main222',
      path: 'models/shop.ttl',
      text: TEXT,
      message: 'Merge main into la-gram/feature',
    });
    expect(result).toEqual({ version: 'blob9', commit: 'merge9', branch: 'la-gram/feature', webUrl: 'https://github.com/acme/arch/commit/merge9' });
    const bodies = host.calls.map((c) => c.body);
    expect(fromBase64(String(bodies[1]?.['content']))).toBe(TEXT);
    expect(bodies[2]).toEqual({ base_tree: 'tree0', tree: [{ path: 'models/shop.ttl', mode: '100644', type: 'blob', sha: 'blob9' }] });
    expect(bodies[3]).toEqual({ message: 'Merge main into la-gram/feature', tree: 'tree9', parents: ['head111', 'main222'] });
    expect(bodies[4]).toEqual({ sha: 'merge9', force: false });
    expect(host.calls.every((c) => c.headers['Authorization'] === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('GitHub: the branch moved on meanwhile — not a fast-forward — is a conflict', async () => {
    const host = fakeHost([
      { method: 'GET', url: `${GH}/git/commits/head111`, body: { tree: { sha: 'tree0' } } },
      { method: 'POST', url: `${GH}/git/blobs`, status: 201, body: { sha: 'blob9' } },
      { method: 'POST', url: `${GH}/git/trees`, status: 201, body: { sha: 'tree9' } },
      { method: 'POST', url: `${GH}/git/commits`, status: 201, body: { sha: 'merge9', html_url: 'x' } },
      { method: 'PATCH', url: `${GH}/git/refs/heads/main`, status: 422, body: { message: 'Update is not a fast forward' } },
    ]);
    const err = await failure(
      new GitHubProvider(github, TOKEN, host.fetch).commitMerge({ branch: 'main', head: 'head111', mergeOf: 'x', path: 'models/shop.ttl', text: TEXT, message: 'm' }),
    );
    expect(err.kind).toBe('conflict');
  });

  it('GitLab: the merge base of two commits; no merge commit', async () => {
    const host = fakeHost([{ method: 'GET', url: `${GL}/repository/merge_base?refs%5B%5D=aaa111&refs%5B%5D=bbb222`, body: { id: 'base000' } }]);
    const provider = new GitLabProvider(gitlab, TOKEN, host.fetch);
    expect(await provider.mergeBase('aaa111', 'bbb222')).toBe('base000');
    expect(provider.commitMerge).toBeUndefined();
  });
});

describe('review (the Git collaboration plan, Phase 2)', () => {
  const ghCommit = (sha: string, parent: string) => ({
    sha,
    html_url: `https://github.com/acme/arch/commit/${sha}`,
    parents: [{ sha: parent }],
    commit: { message: `Change ${sha}\n\nMore words.`, author: { name: 'Ada', date: '2026-11-05T10:00:00Z' }, committer: { date: '2026-11-05T10:05:00Z' } },
    author: { login: 'ada' },
  });

  it('GitHub: a file’s commits on a branch, a page at a time — newest first, with parents, author, date and link', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ghCommit(`c${i}`, `c${i + 1}`));
    const host = fakeHost([
      { method: 'GET', url: `${GH}/commits?sha=la-gram%2Ffeature&path=models%2Fshop.ttl&per_page=100&page=1`, body: full },
      { method: 'GET', url: `${GH}/commits?sha=la-gram%2Ffeature&path=models%2Fshop.ttl&per_page=100&page=2`, body: [ghCommit('c100', 'root')] },
    ]);
    const provider = new GitHubProvider(github, TOKEN, host.fetch);
    const first = await provider.fileCommits('la-gram/feature', 'models/shop.ttl');
    expect(first.more).toBe(true);
    expect(first.commits[0]).toEqual({
      commit: 'c0',
      parents: ['c1'],
      author: 'Ada',
      date: '2026-11-05T10:00:00Z',
      message: 'Change c0\n\nMore words.',
      webUrl: 'https://github.com/acme/arch/commit/c0',
    });
    const second = await provider.fileCommits('la-gram/feature', 'models/shop.ttl', 2);
    expect([second.commits.map((c) => c.commit), second.more]).toEqual([['c100'], false]);
  });

  it('GitHub: the open pull request from a branch, by owner:branch; none is undefined', async () => {
    const pull = { number: 7, title: 'Shop', html_url: 'https://github.com/acme/arch/pull/7', head: { ref: 'la-gram/shop' }, base: { ref: 'main' } };
    const host = fakeHost([
      { method: 'GET', url: `${GH}/pulls?state=open&head=acme%3Ala-gram%2Fshop&base=main`, body: [pull] },
      { method: 'GET', url: `${GH}/pulls?state=open&head=acme%3Aother&base=main`, body: [] },
    ]);
    const provider = new GitHubProvider(github, TOKEN, host.fetch);
    expect(await provider.findMergeRequest('la-gram/shop', 'main')).toEqual({
      number: 7, title: 'Shop', webUrl: 'https://github.com/acme/arch/pull/7', source: 'la-gram/shop', target: 'main',
    });
    expect(await provider.findMergeRequest('other', 'main')).toBeUndefined();
  });

  it('GitHub: opens a pull request — title, head, base and body', async () => {
    const host = fakeHost([
      {
        method: 'POST', url: `${GH}/pulls`, status: 201,
        body: { number: 8, title: 'Shop', html_url: 'https://github.com/acme/arch/pull/8', head: { ref: 'la-gram/shop' }, base: { ref: 'main' } },
      },
    ]);
    const opened = await new GitHubProvider(github, TOKEN, host.fetch).openMergeRequest({ source: 'la-gram/shop', target: 'main', title: 'Shop', description: '**2** changed' });
    expect(opened).toEqual({ number: 8, title: 'Shop', webUrl: 'https://github.com/acme/arch/pull/8', source: 'la-gram/shop', target: 'main' });
    expect(host.calls[0]?.body).toEqual({ title: 'Shop', head: 'la-gram/shop', base: 'main', body: '**2** changed' });
    expect(host.calls[0]?.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('GitLab: a file’s commits, the open merge request, and opening one', async () => {
    const mr = { iid: 3, title: 'Shop', web_url: 'https://gitlab.com/acme/platform/arch/-/merge_requests/3', source_branch: 'la-gram/shop', target_branch: 'main' };
    const host = fakeHost([
      {
        method: 'GET', url: `${GL}/repository/commits?ref_name=main&path=models%2Fshop.ttl&per_page=100&page=1`,
        body: [{ id: 'g1', parent_ids: ['g0'], message: 'Change g1\n', title: 'Change g1', author_name: 'Grace', authored_date: '2026-11-05T11:00:00.000+01:00', web_url: 'https://gitlab.com/acme/platform/arch/-/commit/g1' }],
      },
      { method: 'GET', url: `${GL}/merge_requests?state=opened&source_branch=la-gram%2Fshop&target_branch=main`, body: [mr] },
      { method: 'POST', url: `${GL}/merge_requests`, status: 201, body: mr },
    ]);
    const provider = new GitLabProvider(gitlab, TOKEN, host.fetch);
    expect(await provider.fileCommits('main', 'models/shop.ttl')).toEqual({
      commits: [{ commit: 'g1', parents: ['g0'], author: 'Grace', date: '2026-11-05T11:00:00.000+01:00', message: 'Change g1\n', webUrl: 'https://gitlab.com/acme/platform/arch/-/commit/g1' }],
      more: false,
    });
    const found = { number: 3, title: 'Shop', webUrl: mr.web_url, source: 'la-gram/shop', target: 'main' };
    expect(await provider.findMergeRequest('la-gram/shop', 'main')).toEqual(found);
    expect(await provider.openMergeRequest({ source: 'la-gram/shop', target: 'main', title: 'Shop', description: 'd' })).toEqual(found);
    expect(host.calls.at(-1)?.body).toEqual({ source_branch: 'la-gram/shop', target_branch: 'main', title: 'Shop', description: 'd' });
  });
});

describe('failures, in words, and never with the token', () => {
  const ask = (status: number, text: string, headers: Record<string, string> = {}) =>
    failure(new GitHubProvider(github, TOKEN, fakeHost([{ method: 'GET', url: GH, status, text, headers }]).fetch).defaultBranch());

  it('a refused token, no access, nothing there, a rate limit, the host failing', async () => {
    expect((await ask(401, '{"message":"Bad credentials"}')).kind).toBe('auth');
    expect((await ask(403, '{}')).kind).toBe('forbidden');
    expect((await ask(403, '{}', { 'x-ratelimit-remaining': '0' })).kind).toBe('rate-limit');
    expect((await ask(429, '{}')).kind).toBe('rate-limit');
    expect((await ask(404, '{}')).message).toMatch(/The repository acme\/arch was not found — or the token cannot see it/);
    expect((await ask(502, '<html>')).kind).toBe('server');
  });

  it('the host’s own text — which may quote the token — is matched, never shown', async () => {
    const err = await ask(400, `{"message":"bad token ${TOKEN}"}`);
    expect(err.message).not.toContain(TOKEN);
  });

  it('unreachable: in the browser, the cross-origin refusal is named; on the desktop it is not', async () => {
    const browser = await failure(new GitHubProvider(github, TOKEN, unreachable).defaultBranch());
    expect(browser.kind).toBe('network');
    expect(browser.message).toMatch(/cross-origin/);
    setDesktop(true);
    const desktop = await failure(new GitHubProvider(github, TOKEN, unreachable).defaultBranch());
    expect(desktop.message).toBe('github.com could not be reached.');
  });

  it('no token: no Authorization header at all', async () => {
    const host = fakeHost([{ method: 'GET', url: GH, body: { default_branch: 'main' } }]);
    await new GitHubProvider(github, undefined, host.fetch).defaultBranch();
    expect(host.calls[0].headers).not.toHaveProperty('Authorization');
  });
});

describe('listing a branch’s files and the branches (Open from Git)', () => {
  it('GitHub: the whole tree in one answer, files only; truncated said', async () => {
    const host = fakeHost([
      {
        method: 'GET',
        url: `${GH}/git/trees/abc123?recursive=1`,
        body: {
          truncated: true,
          tree: [
            { path: 'models', type: 'tree' },
            { path: 'models/shop.ttl', type: 'blob' },
            { path: 'README.md', type: 'blob' },
          ],
        },
      },
      { method: 'GET', url: `${GH}/branches?per_page=100&page=1`, body: [{ name: 'main' }, { name: 'feature/x' }] },
    ]);
    const provider = new GitHubProvider(github, TOKEN, host.fetch);
    expect(await provider.listFiles('abc123')).toEqual({ paths: ['models/shop.ttl', 'README.md'], truncated: true });
    expect(await provider.listBranches()).toEqual(['main', 'feature/x']);
  });

  it('GitLab: paged until a page comes back short', async () => {
    const page = (n: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ path: `m/${n}-${i}.ttl`, type: 'blob' }));
    const host = fakeHost([
      { method: 'GET', url: `${GL}/repository/tree?recursive=true&ref=c9&per_page=100&page=1`, body: page(1, 100) },
      { method: 'GET', url: `${GL}/repository/tree?recursive=true&ref=c9&per_page=100&page=2`, body: [...page(2, 3), { path: 'm', type: 'tree' }] },
      { method: 'GET', url: `${GL}/repository/branches?per_page=100&page=1`, body: [{ name: 'main' }] },
    ]);
    const provider = new GitLabProvider(gitlab, TOKEN, host.fetch);
    const listed = await provider.listFiles('c9');
    expect(listed.paths).toHaveLength(103);
    expect(listed.truncated).toBe(false);
    expect(host.calls).toHaveLength(2);
    expect(await provider.listBranches()).toEqual(['main']);
  });
});
