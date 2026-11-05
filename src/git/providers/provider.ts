/**
 * What la-gram asks of a Git host, over its REST API (Req 18.3). One
 * implementation per host kind: GitHub (`github.ts`), GitLab (`gitlab.ts`).
 *
 * A file's *version* is what a commit names to say which file it replaces: the
 * blob SHA on GitHub, the file's last commit on GitLab. A commit that names a
 * version the branch has moved past is refused by the host — that is how a save
 * never overwrites a change it has not seen (Req 18.7).
 */
import { GitError, networkError, responseError } from '../errors.js';
import type { RepositoryLink } from '../link.js';

/** A file read from a branch. */
export interface GitFile {
  text: string;
  /** What a commit replacing it names (`GitHostProvider.commitFile`'s `expectedVersion`). */
  version: string;
}

/** One file committed. */
export interface FileChange {
  /** The branch to commit to — or to start the new branch from. */
  branch: string;
  /** Commit to a new branch of this name, started from `startFrom` or else `branch`'s head. */
  newBranch?: string;
  /** The commit a new branch starts from: the one the model was opened or last saved at. */
  startFrom?: string;
  path: string;
  text: string;
  message: string;
  /** The version of the file this replaces; absent for a file that is not there yet. */
  expectedVersion?: string;
}

/** A commit made. */
export interface CommitResult {
  /** The file's version now. */
  version: string;
  /** The commit. */
  commit: string;
  /** The branch it is on. */
  branch: string;
  /** The commit's page on the host. */
  webUrl: string;
}

/**
 * A file committed as the merge of another commit into a branch: a commit with
 * two parents, so the host counts the other commit as merged — a merge request
 * from the branch then merges cleanly (*Update from main*).
 */
export interface MergeCommitChange {
  branch: string;
  /** The commit the branch is at: the first parent. The branch moves only if it is still there. */
  head: string;
  /** The commit merged in: the second parent. */
  mergeOf: string;
  path: string;
  text: string;
  message: string;
}

/** The files of a branch. */
export interface FileList {
  /** Every file's path, folders left out. */
  paths: string[];
  /** Whether the host stopped short of the whole tree (a very large repository). */
  truncated: boolean;
}

/** A commit, as a file's history lists it. */
export interface GitCommit {
  commit: string;
  /** Its parents: the first is the commit before it on the branch. */
  parents: string[];
  /** Who wrote it (Git's author name). */
  author: string;
  /** When it was written, ISO 8601. */
  date: string;
  message: string;
  /** Its page on the host. */
  webUrl: string;
}

/** A page of a file's commits. */
export interface CommitPage {
  /** Newest first. */
  commits: GitCommit[];
  /** Whether there may be older ones: the page was full. */
  more: boolean;
}

/** A merge request — a pull request on GitHub. */
export interface MergeRequest {
  /** Its number in the repository: GitHub's pull request number, GitLab's `iid`. */
  number: number;
  title: string;
  webUrl: string;
  /** The branch it merges. */
  source: string;
  /** The branch it merges into. */
  target: string;
}

/** A merge request to open. */
export interface MergeRequestChange {
  source: string;
  target: string;
  title: string;
  /** Markdown. */
  description: string;
}

/** Commits listed a page at a time. */
export const COMMITS_PER_PAGE = 100;

/** How many pages of a paged listing are read at most (100 entries a page). */
export const MAX_PAGES = 50;

/** A Git host's REST API, for one repository. */
export interface GitHostProvider {
  /** The repository's default branch. */
  defaultBranch(): Promise<string>;
  /** The commit a branch is at. */
  branchHead(branch: string): Promise<string>;
  /** A file on a branch (or at a commit); `undefined` when it is not there. */
  readFile(ref: string, path: string): Promise<GitFile | undefined>;
  /** Commit one file: create it, or replace the version it names. */
  commitFile(change: FileChange): Promise<CommitResult>;
  /** The files on a branch (or at a commit). */
  listFiles(ref: string): Promise<FileList>;
  /** The repository's branches, by name. */
  listBranches(): Promise<string[]>;
  /** The last commit two commits have in common. */
  mergeBase(a: string, b: string): Promise<string>;
  /** A file's commits on a branch (or from a commit), newest first, a page of {@link COMMITS_PER_PAGE} at a time (`page` from 1). */
  fileCommits(ref: string, path: string, page?: number): Promise<CommitPage>;
  /** The open merge request from `source` into `target`, if there is one. */
  findMergeRequest(source: string, target: string): Promise<MergeRequest | undefined>;
  /** Open a merge request (a pull request on GitHub). */
  openMergeRequest(change: MergeRequestChange): Promise<MergeRequest>;
  /**
   * Commit a file as a merge — a commit with two parents. Only where the host's
   * API can make one: GitHub's Git database API can, GitLab's REST API cannot
   * (a commit there has one parent).
   */
  commitMerge?(change: MergeCommitChange): Promise<CommitResult>;
}

/** `fetch`, injectable for tests. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** What every provider shares: the API base, the token, and asking. */
export abstract class RestProvider implements GitHostProvider {
  constructor(
    protected readonly link: Pick<RepositoryLink, 'apiBase' | 'repository' | 'host'>,
    private readonly token: string | undefined,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  abstract defaultBranch(): Promise<string>;
  abstract branchHead(branch: string): Promise<string>;
  abstract readFile(ref: string, path: string): Promise<GitFile | undefined>;
  abstract commitFile(change: FileChange): Promise<CommitResult>;
  abstract listFiles(ref: string): Promise<FileList>;
  abstract listBranches(): Promise<string[]>;
  abstract mergeBase(a: string, b: string): Promise<string>;
  abstract fileCommits(ref: string, path: string, page?: number): Promise<CommitPage>;
  abstract findMergeRequest(source: string, target: string): Promise<MergeRequest | undefined>;
  abstract openMergeRequest(change: MergeRequestChange): Promise<MergeRequest>;

  /**
   * Every entry of a paged listing (`per_page=100&page=N`), reading pages until
   * one comes back short — the paging headers are not always exposed to a page
   * of another origin. `truncated` when `MAX_PAGES` is reached.
   */
  protected async paged<T>(path: string, what: string): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    const joiner = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = (await this.request<T[]>('GET', `${path}${joiner}per_page=100&page=${page}`, what)) ?? [];
      items.push(...batch);
      if (batch.length < 100) return { items, truncated: false };
    }
    return { items, truncated: true };
  }

  /** Headers the host wants on every request, besides the token. */
  protected abstract headers(): Record<string, string>;

  /**
   * Ask the API. `what` names the thing asked for in a failure's message; a
   * 404 resolves to `undefined` when `missingOk`.
   */
  protected async request<T>(
    method: string,
    path: string,
    what: string,
    options: { body?: unknown; accept?: string; missingOk?: boolean; text?: boolean } = {},
  ): Promise<T | undefined> {
    const headers: Record<string, string> = { ...this.headers() };
    if (options.accept) headers['Accept'] = options.accept;
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchFn(`${this.link.apiBase}${path}`, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        // The token is in the header; no cookie of the host's is wanted.
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw networkError(this.link.host);
    }
    if (response.status === 404 && options.missingOk) return undefined;
    if (!response.ok) {
      const hint = await response.text().catch(() => '');
      throw responseError(response.status, what, {
        rateLimited: response.headers.get('x-ratelimit-remaining') === '0',
        hint,
      });
    }
    if (options.text) return (await response.text()) as T;
    if (response.status === 204) return undefined;
    try {
      return (await response.json()) as T;
    } catch {
      throw new GitError('server', `The host answered for ${what} with something that is not JSON.`, response.status);
    }
  }
}

/** A path's segments, each URL-encoded: `models/a b.ttl` → `models/a%20b.ttl`. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** UTF-8 text as base64. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** base64 (line breaks allowed, as GitHub sends it) as UTF-8 text. */
export function fromBase64(base64: string): string {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
