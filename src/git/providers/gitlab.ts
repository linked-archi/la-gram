/**
 * GitLab's REST API (v4): gitlab.com and self-managed GitLab, both at
 * `https://HOST/api/v4`. A token is a personal, project or group access token
 * with the `api` scope (`read_repository` to open only), sent as
 * `Authorization: Bearer`. The project is addressed by its URL-encoded path
 * (`group%2Fsub%2Frepo`).
 *
 * | | |
 * |---|---|
 * | default branch | `GET /projects/{id}` → `default_branch` |
 * | branch head | `GET /projects/{id}/repository/branches/{branch}` → `commit.id` |
 * | read | `GET /projects/{id}/repository/files/{path}?ref=` → base64 `content`, `last_commit_id` (the version) |
 * | commit | `POST /projects/{id}/repository/commits` — one `create` or `update` action with `last_commit_id` = the version replaced (400 when the file moved on); `start_sha` / `start_branch` for a new branch. The commit is the file's new version |
 * | files | `GET /projects/{id}/repository/tree?recursive=true&ref=`, paged |
 * | branches | `GET /projects/{id}/repository/branches`, paged |
 * | merge base | `GET /projects/{id}/repository/merge_base?refs[]=a&refs[]=b` → `id` |
 *
 * No merge commit: a commit made through the REST API has one parent, so
 * *Update from main* commits to a new branch started from the other one's head
 * instead (`git-merge.ts`).
 *
 * The Commits API rather than the Repository Files API's `PUT`: it answers with
 * the commit, which is the file's version from then on.
 */
import { RestProvider, fromBase64, type CommitResult, type FileChange, type FileList, type GitFile } from './provider.js';

export class GitLabProvider extends RestProvider {
  private get project(): string {
    return encodeURIComponent(this.link.repository);
  }

  protected headers(): Record<string, string> {
    return { Accept: 'application/json' };
  }

  async defaultBranch(): Promise<string> {
    const project = await this.request<{ default_branch: string }>('GET', `/projects/${this.project}`, `the project ${this.link.repository}`);
    return project!.default_branch;
  }

  async branchHead(branch: string): Promise<string> {
    const found = await this.request<{ commit: { id: string } }>(
      'GET',
      `/projects/${this.project}/repository/branches/${encodeURIComponent(branch)}`,
      `the branch ${branch}`,
    );
    return found!.commit.id;
  }

  async readFile(ref: string, path: string): Promise<GitFile | undefined> {
    const file = await this.request<{ content: string; encoding: string; last_commit_id: string }>(
      'GET',
      `/projects/${this.project}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
      path,
      { missingOk: true },
    );
    if (file === undefined) return undefined;
    return { text: file.encoding === 'base64' ? fromBase64(file.content) : file.content, version: file.last_commit_id };
  }

  async commitFile(change: FileChange): Promise<CommitResult> {
    const branch = change.newBranch ?? change.branch;
    const start = change.newBranch
      ? change.startFrom
        ? { start_sha: change.startFrom }
        : { start_branch: change.branch }
      : {};
    const commit = await this.request<{ id: string; web_url: string }>(
      'POST',
      `/projects/${this.project}/repository/commits`,
      change.path,
      {
        body: {
          branch,
          commit_message: change.message,
          ...start,
          actions: [
            {
              action: change.expectedVersion ? 'update' : 'create',
              file_path: change.path,
              content: change.text,
              ...(change.expectedVersion ? { last_commit_id: change.expectedVersion } : {}),
            },
          ],
        },
      },
    );
    return { version: commit!.id, commit: commit!.id, branch, webUrl: commit!.web_url };
  }

  async listFiles(ref: string): Promise<FileList> {
    const { items, truncated } = await this.paged<{ path: string; type: string }>(
      `/projects/${this.project}/repository/tree?recursive=true&ref=${encodeURIComponent(ref)}`,
      `the branch ${ref}`,
    );
    return { paths: items.filter((e) => e.type === 'blob').map((e) => e.path), truncated };
  }

  async listBranches(): Promise<string[]> {
    const { items } = await this.paged<{ name: string }>(`/projects/${this.project}/repository/branches`, `the project ${this.link.repository}`);
    return items.map((b) => b.name);
  }

  async mergeBase(a: string, b: string): Promise<string> {
    const commit = await this.request<{ id: string }>(
      'GET',
      `/projects/${this.project}/repository/merge_base?refs%5B%5D=${encodeURIComponent(a)}&refs%5B%5D=${encodeURIComponent(b)}`,
      `the commits ${a.slice(0, 8)} and ${b.slice(0, 8)}`,
    );
    return commit!.id;
  }
}
