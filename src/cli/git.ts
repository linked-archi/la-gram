/**
 * What la-gram-git asks of Git: the `git` on the path, in the working
 * directory — files at a commit, the commit two refs share, the files changed
 * between two commits. Read without checking anything out, so it works on a
 * CI's detached checkout.
 */
import { execFileSync } from 'node:child_process';

/** Run `git` and give its output; throws with Git's own message when it fails. */
export function git(args: readonly string[], cwd = process.cwd()): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (err instanceof Error ? err.message : String(err)));
  }
}

/** A file at a commit (or any ref); `undefined` when it is not there. */
export function fileAt(ref: string, path: string, cwd?: string): string | undefined {
  try {
    return git(['show', `${ref}:${path}`], cwd);
  } catch {
    return undefined;
  }
}

/** The last commit `a` and `b` have in common. */
export function mergeBase(a: string, b: string, cwd?: string): string {
  return git(['merge-base', a, b], cwd).trim();
}

/** The files changed from `from` to `to`, as paths from the repository's top. */
export function changedFiles(from: string, to: string, cwd?: string): string[] {
  return git(['diff', '--name-only', '--no-renames', from, to], cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The repository's top folder. */
export function topLevel(cwd?: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}
