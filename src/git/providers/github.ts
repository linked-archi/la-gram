/**
 * GitHub's REST API (v3): github.com through `https://api.github.com`, GitHub
 * Enterprise Server through `https://HOST/api/v3`. A token is a fine-grained
 * personal access token with *Contents: read and write* on the repository
 * (read, to open only), sent as `Authorization: Bearer`.
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
 */
import { GitError } from '../errors.js';
import {
  RestProvider,
  encodePath,
  fromBase64,
  toBase64,
  type CommitResult,
  type FileChange,
  type MergeCommitChange,
  type FileList,
  type GitFile,
} from './provider.js';

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
      body: { message: change.message, tree: tree!.sha, parents: [change.head, change.mergeOf] },
    });
    // Without force: refused (422, not a fast-forward) when the branch moved on meanwhile.
    await this.request('PATCH', `${git}/refs/heads/${encodePath(change.branch)}`, change.path, { body: { sha: commit!.sha, force: false } });
    return { version: blob!.sha, commit: commit!.sha, branch: change.branch, webUrl: commit!.html_url };
  }
}
