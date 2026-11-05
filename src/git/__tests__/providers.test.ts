/**
 * GitHub's and GitLab's REST APIs, against recorded exchanges (Req 18.3, 18.5,
 * 18.7, 18.10): the requests la-gram makes, and what it makes of the answers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GitHubProvider } from '../providers/github.js';
import { GitLabProvider } from '../providers/gitlab.js';
import { fromBase64, toBase64 } from '../providers/provider.js';
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
