/**
 * The History tab's Git history (Task 21): for a model bound to a file in Git,
 * that file's commits on its branch, the file as a commit had it — to compare,
 * by element, with the commit before it or the model now — the branch against
 * the default branch, and *Open this version*.
 *
 * Read with the token Save and Open use: a public repository without one. When
 * the tab opens, nothing is asked — a host that wants a token says so in the
 * tab, and *Read again* asks for it.
 *
 * *Open this version* makes the model the file at that commit, as one undoable
 * step, and leaves the binding as it was: the next Save to Git names the version
 * it last saw, so it commits the old version as a change on top — or, if the
 * branch moved on, offers the conflict's choices. A version that has the model
 * under another IRI — from before it was moved to another namespace, or after —
 * is opened once its user agrees: the open model moves to that IRI with it,
 * still bound to the file (DD-41), and undo does not take the move back.
 */
import type { HistoryGitCommit, HistoryGitSource } from '../ui/panels/history-panel.js';
import { snapshotModel, snapshotOfText } from '@linked-archi/kernel/model-manager/model-merge.js';
import type { GitBinding } from './bindings.js';
import { GitError } from './errors.js';
import { Access, type GitOpenContext } from './git-open.js';
import { bindingLink } from './git-save.js';
import type { GitHostProvider } from './providers/provider.js';

/** What opening a version needs of la-gram. */
export interface GitHistoryOptions {
  /** Make the model this snapshot, as one undoable step; one under another IRI moves the open model there. */
  replace(snapshot: string[]): void;
  /** Take away a merge's conflicts: they are about the model being replaced. */
  clearConflicts?(): void;
  /** The room the model is shared in, if it is. */
  room?(): string | undefined;
  /** The open model's IRI: a version that has the model under another is opened only once its user agrees. */
  model?(): string | undefined;
}

/** Files read, kept per commit for the comparisons. */
const SNAPSHOTS_KEPT = 8;

/** What a source lists, as a key: another file, branch or commit is another list. */
export function historyKey(binding: GitBinding): string {
  return [binding.host, binding.repository, binding.branch, binding.path, binding.commit].join('\u0000');
}

/** The bound file's history, for the History tab. */
export function gitHistorySource(ctx: GitOpenContext, binding: GitBinding, options: GitHistoryOptions): HistoryGitSource {
  const link = bindingLink(ctx, binding);
  let access: Promise<Access> | undefined;
  const run = async <T>(read: (provider: GitHostProvider) => Promise<T>, ask = true): Promise<T> => {
    access ??= Access.create(ctx, link);
    const result = await (await access).run(read, ask);
    if (result === null) throw new GitError('auth', 'No token was given.');
    return result;
  };

  const snapshots = new Map<string, Promise<string[]>>();
  const snapshotAt = (commit: string): Promise<string[]> => {
    const kept = snapshots.get(commit);
    if (kept) {
      // The most recently used is kept longest.
      snapshots.delete(commit);
      snapshots.set(commit, kept);
      return kept;
    }
    const read = run(async (provider) => {
      const file = await provider.readFile(commit, binding.path);
      return file ? snapshotOfText(file.text, binding.path) : [];
    });
    read.catch(() => snapshots.delete(commit));
    snapshots.set(commit, read);
    while (snapshots.size > SNAPSHOTS_KEPT) snapshots.delete(snapshots.keys().next().value as string);
    return read;
  };

  const openVersion = async (commit: HistoryGitCommit): Promise<void> => {
    const short = commit.commit.slice(0, 8);
    const when = commit.date ? ` of ${new Date(commit.date).toLocaleString()}` : '';
    const room = options.room?.();
    const go = await ctx.dialogs.confirm(
      'Open this version',
      `The model becomes ${binding.path} as commit ${short}${when} had it. It stays bound to ${binding.branch}: ` +
        'Save to Git commits it there, on top of the version last opened or saved. Undo takes it back while this view stays open.',
      { confirmLabel: 'Open this version', ...(room ? { details: [`It changes for everyone in room "${room}".`] } : {}) },
    );
    if (!go) return;
    try {
      const snapshot = await snapshotAt(commit.commit);
      if (snapshot.length === 0) {
        ctx.report(`${binding.path} was not there at ${short}: nothing to open.`, 'warning');
        return;
      }
      // The model under another IRI: moved to another namespace before or after that commit (DD-41).
      // Opened, the open model moves there, which its user is asked first: undo does not take it back.
      const open = options.model?.();
      const there = snapshotModel(snapshot)?.model;
      const moves = open !== undefined && there !== undefined && there !== open;
      if (moves) {
        const move = await ctx.dialogs.confirm(
          'Open this version',
          `Commit ${short} has the model as ${there}, in another namespace. Opened, the open model moves there with it, ` +
            `and stays bound to ${binding.path} on ${binding.branch}; undo does not take the move back.`,
          { confirmLabel: 'Open and move', ...(room ? { details: [`It changes for everyone in room "${room}".`] } : {}) },
        );
        if (!move) return;
      }
      options.clearConflicts?.();
      options.replace(snapshot);
      ctx.report(
        `The model is ${binding.path} as at ${short}${moves ? `, as ${there}` : ''}. Save to Git commits it to ${binding.branch}.`,
      );
    } catch (err: unknown) {
      ctx.report(`That version could not be read: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return {
    key: historyKey(binding),
    where: `${binding.repository} · ${binding.branch} · ${binding.path}`,
    branch: binding.branch,
    commits: (page, ask) => run((provider) => provider.fileCommits(binding.branch, binding.path, page), ask),
    defaultBranch: (ask) => run((provider) => provider.defaultBranch(), ask),
    branchRange: (target) =>
      run(async (provider) => {
        const [targetHead, head] = await Promise.all([provider.branchHead(target), provider.branchHead(binding.branch)]);
        return { base: await provider.mergeBase(targetHead, head), head };
      }),
    snapshotAt,
    openVersion,
  };
}
