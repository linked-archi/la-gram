/** No-dialog same-file writes, with reconciliation and uncertain-response recovery (Req 18.26). */
import { snapshotOfText } from '../model-manager/model-merge.js';
import { AutoCommitStore, autoCommitKey, type PendingCommit } from './auto-commit-settings.js';
import type { GitBinding } from './bindings.js';
import { GitError } from './errors.js';
import { MERGE_ATTEMPTS, sameLines } from './git-merge.js';
import { bindingKey, checkSnapshot, observeGit, ObsoleteGitRead, type GitObservation } from './git-observation.js';
import { applyGitObservation, type GitPullContext } from './git-pull.js';
import { bindingLink, commitMessage, formatOfPath, gitDefaults } from './git-save.js';
import type { CommitResult, GitHostProvider } from './providers/provider.js';

export interface AutoCommitContext {
  context: GitPullContext;
  store: AutoCommitStore;
  stamp: string;
  /** A sent write can settle after Pause/Off, but never in a different editor lifecycle. */
  active(): boolean;
  canWrite(): boolean;
  revision(): number;
  /** Synchronous adoption keeps the controller's binding guard current during its own merge. */
  observed(value: GitObservation, incorporated: boolean): void;
  committed(result: CommitResult): void;
}

export async function snapshotHash(lines: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines.join('\n')));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** At most one history page is read, only after a write whose result is uncertain. */
async function confirmWrite(provider: GitHostProvider, pending: PendingCommit, check: () => void) {
  const read = async <T>(op: () => Promise<T>): Promise<T> => { check(); try { return await op(); } finally { check(); } };
  const { binding, hash } = pending;
  const head = await read(() => provider.branchHead(binding.branch));
  const candidates = [pending.receipt?.commit, head].filter((s): s is string => !!s);
  let historyRead = false;
  const seen = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const commit = candidates[i]!;
    if (!seen.has(commit) && commit !== binding.commit) {
      seen.add(commit);
      const file = await read(() => provider.readFile(commit, binding.path));
      if (file) {
        const lines = snapshotOfText(file.text, binding.path);
        if (await read(() => snapshotHash(lines)) === hash
          && await read(() => provider.mergeBase(commit, binding.commit)) === binding.commit
          && await read(() => provider.mergeBase(head, commit)) === commit) {
          return { result: { commit, version: file.version, branch: binding.branch, webUrl: binding.webUrl }, lines };
        }
      }
    }
    if (i === candidates.length - 1 && !historyRead) {
      historyRead = true;
      const page = await read(() => provider.fileCommits(head, binding.path, 1));
      candidates.push(...page.commits.map((c) => c.commit));
    }
  }
  return undefined;
}

/** Returns the last local edit included in this attempt; newer edits remain scheduled. */
export async function autoCommit(deps: AutoCommitContext): Promise<number> {
  const ctx = deps.context;
  const modelIri = ctx.modelIri()!;
  let binding = ctx.bindings.get(modelIri)!;
  const key = autoCommitKey(modelIri, binding);
  let expected = bindingKey(binding);
  const active = () => deps.active() && ctx.modelIri() === modelIri && !ctx.room()
    && bindingKey(ctx.bindings.get(modelIri)) === expected;
  const check = () => { if (!active() || !deps.canWrite()) throw new ObsoleteGitRead(); };
  const pause = (reason: string) => { deps.store.pause(key, reason); };
  const format = formatOfPath(binding.path);
  if (!format) throw new GitError('invalid', 'This file format cannot be committed automatically.');
  const snapshot = () => snapshotOfText(ctx.serialize(format), binding.path);
  const accept = (result: CommitResult, lines: string[]) => {
    // Committed from here: the file has the model as it is now, moved or not.
    const { movedFrom: _committed, ...rest } = binding;
    binding = { ...rest, commit: result.commit, version: result.version };
    ctx.bindings.set(modelIri, binding);
    expected = bindingKey(binding);
    deps.observed({ modelIri, binding, head: result.commit, version: result.version, base: lines, remote: lines, incoming: false }, true);
    if (sameLines(snapshot(), lines)) ctx.saved(binding.path.split('/').pop() ?? binding.path);
    else ctx.changed();
    deps.committed(result);
  };
  const recover = async (provider: GitHostProvider, pending: PendingCommit): Promise<void> => {
    pause('A Git write needs confirmation. Resume auto-commit to check again, or Save to Git manually.');
    // Recovery only reads; a paused setting does not prevent confirming an already-sent write.
    const found = await confirmWrite(provider, pending, () => { if (!active()) throw new ObsoleteGitRead(); });
    if (!found) return;
    if (pending.stamp === deps.stamp && expected === bindingKey(pending.binding)) {
      accept(found.result, found.lines);
    } else {
      // A reloaded editor must already incorporate the confirmed commit (Open/Pull/Save).
      const ancestor = await provider.mergeBase(binding.commit, found.result.commit);
      if (!active()) throw new ObsoleteGitRead();
      if (ancestor !== found.result.commit) {
        pause('A previous editor committed this file. Pull from Git or open it again before resuming auto-commit.');
        return;
      }
    }
    deps.store.clear(key);
    // Keep the pause explicit even when confirmation succeeds: newer edits were never authorized by this recovery.
    pause('The pending Git write is confirmed. Resume auto-commit when ready.');
  };

  check();
  if (!ctx.merge || ctx.merge.unresolved() || binding.update || ctx.merge.blankNodes()) {
    throw new GitError('invalid', 'Resolve conflicts, blank nodes or the pending branch merge with Save to Git before resuming auto-commit.');
  }
  const token = await ctx.tokens.get(binding.host);
  check();
  if (!token) throw new GitError('auth', 'Auto-commit needs a token. Save to Git to provide one, then resume auto-commit.');
  const provider = ctx.provider(bindingLink(ctx, binding), token);
  const pending = deps.store.pending(key);
  if (pending) { await recover(provider, pending); return deps.revision(); }

  for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
    check();
    const observed = await observeGit(ctx, binding, () => active() && deps.canWrite(), false);
    check();
    if (!observed) return deps.revision();
    const local = snapshot();
    checkSnapshot(local, modelIri);
    deps.observed(observed, false);
    if (sameLines(local, observed.base)) return deps.revision();
    const applied = applyGitObservation({ ...ctx, current: () => active() && deps.canWrite() }, observed, false, false);
    binding = ctx.bindings.get(modelIri)!;
    expected = bindingKey(binding);
    deps.observed({ ...observed, binding, base: observed.remote, incoming: false }, true);
    if (applied.conflicts.length) {
      pause('Choose the changes in the Conflicts tab, then Save to Git or Resume auto-commit.');
      return deps.revision();
    }
    const revision = deps.revision();
    const text = ctx.serialize(format);
    const submitted = snapshotOfText(text, binding.path);
    if (sameLines(submitted, observed.remote)) return revision;
    const hash = await snapshotHash(submitted);
    check();
    const journal: PendingCommit = { modelIri, binding, stamp: deps.stamp, hash };
    deps.store.journal(key, journal);
    let result: CommitResult;
    try {
      result = await provider.commitFile({ branch: binding.branch, path: binding.path, text, expectedVersion: binding.version,
        message: commitMessage(gitDefaults(ctx.config, ctx.personal?.()).message,
          { action: 'Update', model: ctx.modelLabel(), path: binding.path, branch: binding.branch }) });
      if (!result?.commit || !result.version || result.branch !== binding.branch) {
        throw new GitError('server', 'The host did not confirm the expected commit.');
      }
    } catch (error: unknown) {
      const certain = error instanceof GitError && !['network', 'server'].includes(error.kind);
      if (certain) {
        deps.store.clear(key);
        check();
        if (error.kind === 'conflict') continue;
        throw error;
      }
      pause('A Git write needs confirmation. Resume auto-commit to check again, or Save to Git manually.');
      if (active()) await recover(provider, journal);
      return revision;
    }
    if (!active()) {
      pause('A previous editor completed a Git commit. Pull from Git or open it again before resuming auto-commit.');
      ctx.report(`Auto-commit completed for ${binding.repository} · ${binding.branch} · ${binding.path} (${result.commit.slice(0, 8)}). The current model was not marked saved.`, 'warning');
      deps.store.journal(key, { ...journal, receipt: result });
      return revision;
    }
    accept(result, submitted);
    deps.store.clear(key);
    return revision;
  }
  throw new GitError('conflict', 'The remote file keeps changing. Save to Git manually or Resume auto-commit to try again.');
}
