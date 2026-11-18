/** Manual same-branch synchronization, with no repository writes (Req 18.24). */
import { snapshotOfText } from '../model-manager/model-merge.js';
import { GitError } from './errors.js';
import { reconcile, sameLines } from './git-merge.js';
import { formatOfPath, type GitSaveContext } from './git-save.js';
import { bindingKey, checkSnapshot, observeGit, ObsoleteGitRead, type GitObservation } from './git-observation.js';

export interface GitPullContext extends GitSaveContext {
  /** Still the same editor lifecycle, including a reload of the same model IRI. */
  current(): boolean;
  room(): string | undefined;
  /** Refresh the dirty marker and History after advancing the binding. */
  changed(): void;
  pulled?(observed: GitObservation, dirty: boolean): void;
}

export type PullOutcome = 'unchanged' | 'pulled' | 'merged' | 'conflicts' | 'stopped' | 'obsolete';

/** Apply a checked version, with a final synchronous clean-only guard for automation. */
export function applyGitObservation(ctx: GitPullContext, observed: GitObservation, cleanOnly = false) {
  const { modelIri, binding, head, version, base, remote } = observed;
  const merge = ctx.merge;
  if (!ctx.current() || ctx.room() || ctx.modelIri() !== modelIri || bindingKey(ctx.bindings.get(modelIri)) !== bindingKey(binding)
    || !merge || merge.unresolved() > 0 || binding.update) throw new ObsoleteGitRead();
  const format = formatOfPath(binding.path);
  if (!format) throw new GitError('invalid', `The file format of ${binding.path} is not supported.`);
  const ours = snapshotOfText(ctx.serialize(format), binding.path);
  checkSnapshot(ours, modelIri);
  if (cleanOnly && !sameLines(ours, base)) return { applied: false, changed: false, conflicts: [], dirty: true };
  const { conflicts, changed } = reconcile(merge, base, ours, remote);
  ctx.bindings.set(modelIri, { ...binding, commit: head, version });
  if (conflicts.length) merge.conflicts(conflicts, { branch: binding.branch, commit: head });
  else merge.clear();
  const dirty = conflicts.length > 0 || !sameLines(snapshotOfText(ctx.serialize(format), binding.path), remote);
  if (dirty) ctx.changed();
  else ctx.saved(binding.path.split('/').pop() ?? binding.path);
  return { applied: true, changed, conflicts, dirty };
}

/** Read at a pinned head, then reconcile against the latest local snapshot, synchronously. */
export async function pullFromGit(ctx: GitPullContext): Promise<PullOutcome> {
  const modelIri = ctx.modelIri();
  const original = modelIri ? ctx.bindings.get(modelIri) : undefined;
  const merge = ctx.merge;
  if (!modelIri || !original || !merge) {
    ctx.report('Open from Git or Save to Git before pulling.', 'warning');
    return 'stopped';
  }
  if (ctx.room()) {
    ctx.report('Pull from Git is available outside shared rooms.', 'warning');
    return 'stopped';
  }
  if (merge.unresolved() > 0 || original.update) {
    ctx.report(original.update
      ? 'Finish the pending branch merge with Save to Git before pulling.'
      : 'Choose the remaining changes in the Conflicts tab before pulling again.', 'warning');
    return 'stopped';
  }
  const bound = { ...original };
  const key = bindingKey(bound);
  const current = () => ctx.current() && !ctx.room() && ctx.modelIri() === modelIri
    && bindingKey(ctx.bindings.get(modelIri)) === key && merge.unresolved() === 0;
  try {
    ctx.report(`Pulling ${bound.path} from ${bound.branch}…`);
    const observed = await observeGit(ctx, bound, current, true);
    if (!observed) return 'stopped';
    const { head, incoming } = observed;
    const { conflicts, changed, dirty } = applyGitObservation(ctx, observed);
    ctx.pulled?.(observed, dirty);
    if (conflicts.length) {
      ctx.report(`Pulled ${bound.branch} at ${head.slice(0, 8)}. Choose ${conflicts.length === 1 ? 'the change' : `${conflicts.length} changes`} in the Conflicts tab, then Save to Git when ready. Nothing was committed.`, 'warning');
      return 'conflicts';
    }
    ctx.report(`${incoming ? `Pulled ${bound.branch} at ${head.slice(0, 8)}.` : 'No incoming model changes.'}${dirty ? ' Local changes are kept; Save to Git when ready.' : ''} Nothing was committed.`);
    return dirty ? 'merged' : changed ? 'pulled' : 'unchanged';
  } catch (err: unknown) {
    if (err instanceof ObsoleteGitRead || !current()) {
      ctx.report('Pull discarded because the open model or its Git destination changed.', 'info');
      return 'obsolete';
    }
    if (err instanceof GitError && err.kind === 'auth') await ctx.tokens.forget(bound.host);
    ctx.report(`Pull from Git failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return 'stopped';
  }
}
