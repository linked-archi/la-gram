/**
 * `la-gram-git diff`: what a branch changes in its model files, by element
 * (`model-diff.ts`, worded by `model-diff-text.ts` as the History tab and a
 * merge request's description word it) — from where it left the branch it goes
 * into, as the host's own diff of a merge request is.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { diffByElement } from '../model-manager/model-diff.js';
import { markdownOfDiff } from '../model-manager/model-diff-text.js';
import { snapshotOfText } from '../model-manager/model-merge.js';
import { changedFiles, fileAt, mergeBase } from './git.js';
import { hasModelExtension, isModel, openModel, wordsOf } from './models.js';

/** The marker that finds la-gram-git's comment again, to update it. */
export const COMMENT_MARKER = '<!-- la-gram-git:diff -->';

/** Options for {@link diffMarkdown}. */
export interface DiffOptions {
  /** The branch the change goes into. */
  base: string;
  /** The change: `HEAD` when absent. */
  head?: string;
  /** Model files to compare; those changed when absent. */
  paths?: readonly string[];
  cwd?: string;
}

/** The changes by element, as Markdown, headed by la-gram-git's marker. */
export async function diffMarkdown(options: DiffOptions): Promise<string> {
  const head = options.head ?? 'HEAD';
  const since = mergeBase(options.base, head, options.cwd);
  const paths = (options.paths ?? changedFiles(since, head, options.cwd)).filter(hasModelExtension);
  const sections: string[] = [];
  for (const path of paths) {
    const before = fileAt(since, path, options.cwd);
    const after = fileAt(head, path, options.cwd);
    const model = (text: string | undefined) => {
      try {
        return text !== undefined && isModel(text, path);
      } catch {
        return false;
      }
    };
    if (!model(before) && !model(after)) continue;
    // Named as the later version's metamodels name things.
    const open = await openModel((model(after) ? after : before)!, path);
    const words = wordsOf(open.app);
    const diff = diffByElement(before !== undefined ? snapshotOfText(before, basename(path)) : [], after !== undefined ? snapshotOfText(after, basename(path)) : [], {
      singleValued: open.app.singleValued(),
    });
    const status = before === undefined ? ' (new)' : after === undefined ? ' (removed)' : '';
    sections.push(`### \`${path}\`${status}\n\n${markdownOfDiff(diff, words)}`);
  }
  const title = `## Model changes by element`;
  const body = sections.length > 0 ? sections.join('\n\n') : '_No model file changed._';
  return `${COMMENT_MARKER}\n${title}\n\n${body}\n\n<sub>la-gram-git, from ${since.slice(0, 8)} to ${head === 'HEAD' ? 'this change' : head}</sub>\n`;
}

/** Where a comment goes, read from the CI's environment. */
export type CommentTarget =
  | { host: 'github'; api: string; repository: string; number: number; token: string }
  | { host: 'gitlab'; api: string; project: string; iid: string; token: string };

/**
 * The pull or merge request this CI job runs for, from its environment — or why
 * there is none: not in CI, not for a request, or no token to comment with.
 */
export function commentTarget(env: NodeJS.ProcessEnv = process.env, readFile: (path: string) => string = defaultRead): CommentTarget | string {
  if (env['GITHUB_ACTIONS'] === 'true') {
    const token = env['GITHUB_TOKEN'];
    if (!token) return 'GITHUB_TOKEN is not set for this step (env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}).';
    let number: number | undefined;
    try {
      const event = JSON.parse(readFile(env['GITHUB_EVENT_PATH'] ?? '')) as { pull_request?: { number?: number } };
      number = event.pull_request?.number;
    } catch {
      number = undefined;
    }
    if (!number) return 'this workflow does not run for a pull request.';
    return { host: 'github', api: env['GITHUB_API_URL'] ?? 'https://api.github.com', repository: env['GITHUB_REPOSITORY'] ?? '', number, token };
  }
  if (env['GITLAB_CI'] === 'true') {
    const iid = env['CI_MERGE_REQUEST_IID'];
    if (!iid) return 'this pipeline does not run for a merge request.';
    const token = env['LA_GRAM_GIT_TOKEN'];
    if (!token) return 'LA_GRAM_GIT_TOKEN is not set: a project or group access token, in a masked CI/CD variable, is needed to comment (the job token cannot).';
    return { host: 'gitlab', api: env['CI_API_V4_URL'] ?? 'https://gitlab.com/api/v4', project: env['CI_PROJECT_ID'] ?? '', iid, token };
  }
  return 'not running in GitHub Actions or GitLab CI.';
}

/**
 * Post the comment, or update la-gram-git's last one on the request. Returns
 * what was done, in words. The token goes to the host's API only, in a header.
 */
export async function postComment(target: CommentTarget, body: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const ask = async (method: string, url: string, payload?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    headers['Authorization'] = `Bearer ${target.token}`;
    if (target.host === 'github') headers['X-GitHub-Api-Version'] = '2022-11-28';
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchFn(url, { method, headers, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
    if (!response.ok) throw new Error(`the host answered ${response.status} to ${method} ${url.replace(/\?.*$/, '')}`);
    return response.status === 204 ? undefined : response.json();
  };
  if (target.host === 'github') {
    const base = `${target.api}/repos/${target.repository}/issues/${target.number}/comments`;
    const comments = (await ask('GET', `${base}?per_page=100`)) as Array<{ id: number; body?: string }>;
    const ours = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (ours) {
      await ask('PATCH', `${target.api}/repos/${target.repository}/issues/comments/${ours.id}`, { body });
      return `updated the comment on pull request #${target.number}`;
    }
    await ask('POST', base, { body });
    return `commented on pull request #${target.number}`;
  }
  const base = `${target.api}/projects/${encodeURIComponent(target.project)}/merge_requests/${target.iid}/notes`;
  const notes = (await ask('GET', `${base}?per_page=100&sort=desc`)) as Array<{ id: number; body?: string }>;
  const ours = notes.find((n) => n.body?.includes(COMMENT_MARKER));
  if (ours) {
    await ask('PUT', `${base}/${ours.id}`, { body });
    return `updated the comment on merge request !${target.iid}`;
  }
  await ask('POST', base, { body });
  return `commented on merge request !${target.iid}`;
}

function defaultRead(path: string): string {
  return readFileSync(path, 'utf8');
}
