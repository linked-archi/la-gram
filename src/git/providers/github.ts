/**
 * GitHub's REST API (v3): github.com through `https://api.github.com`, GitHub
 * Enterprise Server through `https://HOST/api/v3`. A token is a fine-grained
 * personal access token with *Contents: read and write* on the repository
 * (read, to open only) — and *Pull requests: read and write* to open pull
 * requests — sent as `Authorization: Bearer`.
 *
 * | | |
 * |---|---|
 * | default branch | `GET /repos/{repo}` → `default_branch` |
 * | branch head | `GET /repos/{repo}/branches/{branch}` → `commit.sha` |
 * | read | `GET /repos/{repo}/contents/{path}?ref=` → base64 `content`, the blob `sha` (the version); over 1 MB the content comes raw, asked again |
 * | new branch | `POST /repos/{repo}/git/refs` from the commit the model was at, or the base branch's head |
 * | commit | `PUT /repos/{repo}/contents/{path}` — `message`, base64 `content`, `branch`, `sha` = the version replaced; 409 when the file moved on |
 * | files | `GET /repos/{repo}/git/trees/{ref}?recursive=1` — the whole tree in one answer, `truncated` past GitHub's limit |
 * | branches | `GET /repos/{repo}/branches`, paged |
 * | merge base | `GET /repos/{repo}/compare/{a}...{b}` → `merge_base_commit.sha` |
 * | merge commit | the Git database API: the head commit's tree, `POST …/git/blobs`, `POST …/git/trees` (on that tree), `POST …/git/commits` with both parents, then `PATCH …/git/refs/heads/{branch}` without force — 422 when the branch moved on |
 * | a file's commits | `GET /repos/{repo}/commits?sha={ref}&path={path}`, a page of 100 at a time |
 * | the open pull request | `GET /repos/{repo}/pulls?state=open&head={owner}:{branch}&base={target}` |
 * | open a pull request | `POST /repos/{repo}/pulls` — `title`, `head`, `base`, `body`; the token needs *Pull requests: read and write* |
 * | the token's account | `GET /user` → `html_url`, `login`, `name`, `email` (the public one) |
 *
 * A commit is written by the user from *Settings › You* (`author`) where both their name and address are
 * known — GitHub takes an author only with both — and else by the token's owner, its committer either way.
 */
import { GitError } from '../errors.js';
import {
  RestProvider,
  account,
  encodePath,
  fromBase64,
  toBase64,
  type CommitResult,
  type FileChange,
  type GitAccount,
  type MergeCommitChange,
  type FileList,
  type GitFile,
  type CommitPage,
  type MergeRequest,
  type MergeRequestChange,
  COMMITS_PER_PAGE,
} from './provider.js';

interface CommitEntry {
  sha: string;
  html_url: string;
  parents?: Array<{ sha: string }>;
  commit: { message: string; author?: { name?: string; date?: string }; committer?: { date?: string } };
  author?: { login?: string } | null;
}

interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
}

interface ContentsFile {
  type: string;
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

export class GitHubProvider extends RestProvider {
  private get repo(): string {
    return this.link.repository.split('/').map(encodeURIComponent).join('/');
  }

  protected headers(): Record<string, string> {
    return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }

  async defaultBranch(): Promise<string> {
    const repo = await this.request<{ default_branch: string }>('GET', `/repos/${this.repo}`, `the repository ${this.link.repository}`);
    return repo!.default_branch;
  }

  async branchHead(branch: string): Promise<string> {
    const found = await this.request<{ commit: { sha: string } }>(
      'GET',
      `/repos/${this.repo}/branches/${encodeURIComponent(branch)}`,
      `the branch ${branch}`,
    );
    return found!.commit.sha;
  }

  async readFile(ref: string, path: string): Promise<GitFile | undefined> {
    const at = `/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
    const file = await this.request<ContentsFile | ContentsFile[]>('GET', at, path, { missingOk: true });
    if (file === undefined) return undefined;
    if (Array.isArray(file) || file.type !== 'file') throw new GitError('invalid', `${path} is a folder, not a file.`);
    if (file.encoding === 'base64' && file.content !== undefined && (file.content !== '' || file.size === 0)) {
      return { text: fromBase64(file.content), version: file.sha };
    }
    // Over a megabyte the JSON leaves the content out; the raw media type gives it.
    const text = await this.request<string>('GET', at, path, { accept: 'application/vnd.github.raw', text: true });
    return { text: text ?? '', version: file.sha };
  }

  async commitFile(change: FileChange): Promise<CommitResult> {
    const branch = change.newBranch ?? change.branch;
    if (change.newBranch) {
      const from = change.startFrom ?? (await this.branchHead(change.branch));
      await this.request('POST', `/repos/${this.repo}/git/refs`, `the branch ${change.newBranch}`, {
        body: { ref: `refs/heads/${change.newBranch}`, sha: from },
      });
    }
    const result = await this.request<{ content: { sha: string }; commit: { sha: string; html_url: string } }>(
      'PUT',
      `/repos/${this.repo}/contents/${encodePath(change.path)}`,
      change.path,
      {
        body: {
          message: change.message,
          content: toBase64(change.text),
          branch,
          ...(change.expectedVersion ? { sha: change.expectedVersion } : {}),
          ...this.authorField(change),
        },
      },
    );
    return { version: result!.content.sha, commit: result!.commit.sha, branch, webUrl: result!.commit.html_url };
  }

  async listFiles(ref: string): Promise<FileList> {
    const tree = await this.request<{ tree: Array<{ path: string; type: string }>; truncated: boolean }>(
      'GET',
      `/repos/${this.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      `the branch ${ref}`,
    );
    return { paths: tree!.tree.filter((e) => e.type === 'blob').map((e) => e.path), truncated: tree!.truncated === true };
  }

  async listBranches(): Promise<string[]> {
    const { items } = await this.paged<{ name: string }>(`/repos/${this.repo}/branches`, `the repository ${this.link.repository}`);
    return items.map((b) => b.name);
  }

  async mergeBase(a: string, b: string): Promise<string> {
    const compared = await this.request<{ merge_base_commit: { sha: string } }>(
      'GET',
      `/repos/${this.repo}/compare/${encodeURIComponent(a)}...${encodeURIComponent(b)}`,
      `the commits ${a.slice(0, 8)} and ${b.slice(0, 8)}`,
    );
    return compared!.merge_base_commit.sha;
  }

  async commitMerge(change: MergeCommitChange): Promise<CommitResult> {
    const git = `/repos/${this.repo}/git`;
    const head = await this.request<{ tree: { sha: string } }>('GET', `${git}/commits/${encodeURIComponent(change.head)}`, `the commit ${change.head.slice(0, 8)}`);
    const blob = await this.request<{ sha: string }>('POST', `${git}/blobs`, change.path, {
      body: { content: toBase64(change.text), encoding: 'base64' },
    });
    const tree = await this.request<{ sha: string }>('POST', `${git}/trees`, change.path, {
      body: { base_tree: head!.tree.sha, tree: [{ path: change.path, mode: '100644', type: 'blob', sha: blob!.sha }] },
    });
    const commit = await this.request<{ sha: string; html_url: string }>('POST', `${git}/commits`, change.path, {
      body: { message: change.message, tree: tree!.sha, parents: [change.head, change.mergeOf], ...this.authorField(change) },
    });
    // Without force: refused (422, not a fast-forward) when the branch moved on meanwhile.
    await this.request('PATCH', `${git}/refs/heads/${encodePath(change.branch)}`, change.path, { body: { sha: commit!.sha, force: false } });
    return { version: blob!.sha, commit: commit!.sha, branch: change.branch, webUrl: commit!.html_url };
  }

  async currentAccount(): Promise<GitAccount> {
    const user = await this.request<{ html_url: string; login?: string; name?: string | null; email?: string | null }>('GET', '/user', 'your account');
    return account(user!.html_url, user!.login, user!.name, user!.email);
  }

  /** The commit's `author`, where both a name and an address are known: GitHub refuses one without either. */
  private authorField(change: { author?: { name: string; email?: string } }): { author?: { name: string; email: string } } {
    const author = this.authorOf(change);
    return author?.email ? { author: { name: author.name, email: author.email } } : {};
  }

  async fileCommits(ref: string, path: string, page = 1): Promise<CommitPage> {
    const entries =
      (await this.request<CommitEntry[]>(
        'GET',
        `/repos/${this.repo}/commits?sha=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}&per_page=${COMMITS_PER_PAGE}&page=${page}`,
        `the history of ${path}`,
      )) ?? [];
    return {
      commits: entries.map((e) => ({
        commit: e.sha,
        parents: (e.parents ?? []).map((p) => p.sha),
        author: e.commit.author?.name || e.author?.login || '',
        date: e.commit.author?.date ?? e.commit.committer?.date ?? '',
        message: e.commit.message,
        webUrl: e.html_url,
      })),
      more: entries.length === COMMITS_PER_PAGE,
    };
  }

  async findMergeRequest(source: string, target: string): Promise<MergeRequest | undefined> {
    const owner = this.link.repository.split('/')[0] ?? '';
    const open =
      (await this.request<PullRequest[]>(
        'GET',
        `/repos/${this.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${source}`)}&base=${encodeURIComponent(target)}`,
        `the pull requests from ${source}`,
      )) ?? [];
    const found = open.find((p) => p.head.ref === source && p.base.ref === target);
    return found ? pullRequest(found) : undefined;
  }

  async openMergeRequest(change: MergeRequestChange): Promise<MergeRequest> {
    const opened = await this.request<PullRequest>('POST', `/repos/${this.repo}/pulls`, `a pull request from ${change.source} into ${change.target}`, {
      body: { title: change.title, head: change.source, base: change.target, body: change.description },
    });
    return pullRequest(opened!);
  }
}

function pullRequest(p: PullRequest): MergeRequest {
  return { number: p.number, title: p.title, webUrl: p.html_url, source: p.head.ref, target: p.base.ref };
}
