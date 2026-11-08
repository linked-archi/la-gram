/**
 * A repository in memory for the Git flows' tests: commits with their parents,
 * files and messages, branches, file versions by content (GitHub) or by the
 * last commit that changed the file (GitLab), a file's history, merge requests.
 * GitHub's kind makes merge commits; GitLab's cannot.
 */
import { GitError } from '../errors.js';
import type {
  CommitPage,
  CommitResult,
  FileChange,
  GitCommit,
  GitHostProvider,
  MergeCommitChange,
  MergeRequest,
  MergeRequestChange,
} from '../providers/provider.js';

export class Repository implements GitHostProvider {
  readonly commits = new Map<string, { parents: string[]; files: Map<string, string> }>();
  readonly branches = new Map<string, string>();
  readonly made: Array<{ kind: 'file' | 'merge'; branch: string; commit: string; parents: string[] }> = [];
  readonly messages = new Map<string, string>();
  /** Merge requests opened, open ones first. */
  readonly requests: Array<MergeRequest & { description: string; open: boolean }> = [];
  /** The order commits were made in, which a file's history lists newest first. */
  private readonly order: string[] = [];
  /** Run before the next commit — another client committing meanwhile. */
  beforeCommit?: () => void;
  commitMerge?: (change: MergeCommitChange) => Promise<CommitResult>;
  private n = 0;

  constructor(
    readonly kind: 'github' | 'gitlab',
    /** The model file's path. */
    readonly path: string,
    initial: string,
  ) {
    this.commit('main', [], new Map([[path, initial]]), 'root');
    if (kind === 'github') {
      this.commitMerge = async (change) => {
        this.beforeCommit?.();
        this.beforeCommit = undefined;
        if (this.branches.get(change.branch) !== change.head) throw new GitError('conflict', `${change.path} changed.`, 422);
        const files = new Map(this.commits.get(change.head)!.files).set(change.path, change.text);
        const commit = this.commit(change.branch, [change.head, change.mergeOf], files, undefined, change.message);
        this.made.push({ kind: 'merge', branch: change.branch, commit, parents: [change.head, change.mergeOf] });
        return { version: this.version(change.text), commit, branch: change.branch, webUrl: `https://host/commit/${commit}` };
      };
    }
  }

  /** A commit on a branch, as someone else would push it. */
  commit(branch: string, parents: string[], files: Map<string, string>, id = `c${++this.n}`, message = `Commit ${id}`): string {
    this.commits.set(id, { parents, files });
    this.branches.set(branch, id);
    this.messages.set(id, message);
    this.order.push(id);
    return id;
  }

  /** Someone else changes the file on a branch: its lines, a line each. */
  push(branch: string, lines: string[], message?: string): string {
    const head = this.branches.get(branch)!;
    return this.commit(branch, [head], new Map(this.commits.get(head)!.files).set(this.path, `${lines.join('\n')}\n`), undefined, message);
  }

  fileAt(ref: string): string | undefined {
    return this.commits.get(this.branches.get(ref) ?? ref)?.files.get(this.path);
  }

  version(content: string): string {
    return `blob-${content.length}-${[...content].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)}`;
  }

  async defaultBranch() {
    return 'main';
  }
  async branchHead(branch: string) {
    const head = this.branches.get(branch);
    if (!head) throw new GitError('not-found', `The branch ${branch} was not found.`, 404);
    return head;
  }
  async readFile(ref: string, path: string) {
    const content = this.commits.get(this.branches.get(ref) ?? ref)?.files.get(path);
    return content === undefined ? undefined : { text: content, version: this.kind === 'github' ? this.version(content) : this.lastChange(ref, path) };
  }
  async commitFile(change: FileChange): Promise<CommitResult> {
    this.beforeCommit?.();
    this.beforeCommit = undefined;
    const branch = change.newBranch ?? change.branch;
    if (change.newBranch && this.branches.has(change.newBranch)) throw new GitError('exists', 'A branch of that name is already in the repository.', 400);
    const start = change.newBranch ? (change.startFrom ?? this.branches.get(change.branch)!) : this.branches.get(branch)!;
    const there = await this.readFile(start, change.path);
    if ((there?.version ?? undefined) !== change.expectedVersion) throw new GitError('conflict', `${change.path} changed.`, 409);
    const commit = this.commit(branch, [start], new Map(this.commits.get(start)!.files).set(change.path, change.text), undefined, change.message);
    this.made.push({ kind: 'file', branch, commit, parents: [start] });
    return { version: (await this.readFile(commit, change.path))!.version, commit, branch, webUrl: `https://host/commit/${commit}` };
  }
  async listFiles() {
    return { paths: [this.path], truncated: false };
  }
  async listBranches() {
    return [...this.branches.keys()];
  }
  async mergeBase(a: string, b: string) {
    const ancestors = (from: string) => {
      const seen: string[] = [];
      const queue = [from];
      while (queue.length) {
        const c = queue.shift()!;
        if (seen.includes(c)) continue;
        seen.push(c);
        queue.push(...this.commits.get(c)!.parents);
      }
      return seen;
    };
    const ofA = new Set(ancestors(a));
    return ancestors(b).find((c) => ofA.has(c))!;
  }

  /** The commits reachable from `ref` that changed the file, newest first: as `git log -- path`. */
  async fileCommits(ref: string, path: string, page = 1): Promise<CommitPage> {
    const reachable = new Set<string>();
    const queue = [this.branches.get(ref) ?? ref];
    while (queue.length) {
      const c = queue.shift()!;
      if (reachable.has(c) || !this.commits.has(c)) continue;
      reachable.add(c);
      queue.push(...this.commits.get(c)!.parents);
    }
    const changed = [...this.order].reverse().filter((c) => {
      if (!reachable.has(c)) return false;
      const { parents, files } = this.commits.get(c)!;
      const parent = parents[0];
      return files.has(path) && (!parent || this.commits.get(parent)!.files.get(path) !== files.get(path));
    });
    // Two a page, so that paging is tested on a short history.
    const PER_PAGE = 2;
    const slice = changed.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    return {
      commits: slice.map(
        (c): GitCommit => ({
          commit: c,
          parents: this.commits.get(c)!.parents,
          author: 'Ada',
          // A second apart, in the order they were made.
          date: new Date(Date.UTC(2026, 10, 5, 9, 0, this.order.indexOf(c))).toISOString(),
          message: this.messages.get(c) ?? '',
          webUrl: `https://host/commit/${c}`,
        }),
      ),
      more: slice.length === PER_PAGE && changed.length > page * PER_PAGE,
    };
  }

  async findMergeRequest(source: string, target: string): Promise<MergeRequest | undefined> {
    const found = this.requests.find((r) => r.open && r.source === source && r.target === target);
    return found ? { number: found.number, title: found.title, webUrl: found.webUrl, source, target } : undefined;
  }

  async openMergeRequest(change: MergeRequestChange): Promise<MergeRequest> {
    const number = this.requests.length + 1;
    const request = { number, title: change.title, webUrl: `https://host/acme/arch/requests/${number}`, source: change.source, target: change.target };
    this.requests.push({ ...request, description: change.description, open: true });
    return request;
  }

  /** GitLab's version: the last commit that changed the file, on the way to `ref`. */
  private lastChange(ref: string, path: string): string {
    let commit = this.branches.get(ref) ?? ref;
    for (;;) {
      const { parents, files } = this.commits.get(commit)!;
      const parent = parents[0];
      if (!parent || this.commits.get(parent)!.files.get(path) !== files.get(path)) return commit;
      commit = parent;
    }
  }
}
