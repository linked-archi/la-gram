/**
 * Merging in Git (the Git collaboration plan, Phase 1): two versions of a bound
 * file combined by la-gram's three-way merge (`model-manager/model-merge.ts`),
 * so that a save the host refused, or a branch behind main, need not end on a
 * new branch.
 *
 * ```
 * Merge with the newer version   the save was refused: the file moved on
 *   base    the file at the commit the model was opened or last saved at
 *   theirs  the file at the branch's head
 *   ours    the model
 *   → no conflicts: the merged model replaces the model (one undoable step) and
 *     is committed, naming the head's version; merged again if the branch moved
 *     on meanwhile
 *   → conflicts: the merged model replaces the model, which is bound to the head,
 *     and the Conflicts tab lists them; Save to Git commits once they are chosen
 *
 * Update from main               another branch merged into the bound one
 *   base    the file at the two branches' merge base
 *   theirs  the file at the other branch's head
 *   ours    the model (first merged with its own branch, if that moved on)
 *   → the model is merged, and the binding remembers the other branch's head;
 *     the next commit records it as merged: on GitHub a merge commit (two
 *     parents), on GitLab — whose REST API makes commits of one parent only —
 *     a new branch started from the other branch's head
 * ```
 *
 * All three versions are read the same way — the model through its own
 * serialization — so a difference of form is never taken for a change.
 */
import type { MergeConflict, MergeOptions, MergeResult } from '../model-manager/model-merge.js';
import { NamespaceConflict, mergeSnapshots, snapshotModel, snapshotOfText } from '../model-manager/model-merge.js';
import type { GitBinding } from './bindings.js';
import { GitError } from './errors.js';
import type { CommitResult, GitHostProvider } from './providers/provider.js';
import type { GitSaveContext, Target } from './git-save.js';
import { bindingLink, branchProblem, formatOfPath, gitDefaults, saveToGit, slug, tokenFor } from './git-save.js';

/** What merging needs of la-gram, beside the Save flow's context. */
export interface MergeSupport {
  /** The single-value rules and the count check the merge runs with. */
  options(): MergeOptions;
  /**
   * Make the model this snapshot, as one undoable step. A snapshot that has the
   * model under another IRI — moved to another namespace there (DD-41) — moves
   * the open model there: `modelIri()` is the new IRI after it, and the binding
   * is kept under it.
   */
  replace(snapshot: string[]): void;
  /** Show the conflicts left by merging `against` (the branch, at a commit). */
  conflicts(conflicts: MergeConflict[], against: { branch: string; commit: string }, activate?: boolean): void;
  /** How many of the conflicts shown are not chosen yet. */
  unresolved(): number;
  /** The conflicts are done with: the model was committed. */
  clear(): void;
  /** How many of the model's triples have a blank node. */
  blankNodes(): number;
}

/** How many times a merge is tried again when the branch moves on while merging. */
export const MERGE_ATTEMPTS = 3;

/**
 * Reconcile and apply once, without committing; shared by Pull and Save. `where`: the branch theirs is from.
 * With `follow`, a move made there is followed ({@link mergeHere}): `followed` is the model's IRI after it.
 */
export function reconcile(merge: MergeSupport, base: string[], ours: string[], theirs: string[], where: string, follow = false) {
  const result = mergeHere(merge, base, ours, theirs, where, follow);
  const changed = !sameLines(result.merged, ours);
  if (changed) merge.replace(result.merged);
  return { ...result, changed };
}

/**
 * The model, `ours`, merged with a version from `where`. A move to another
 * namespace here is merged into, with the other version moved after it
 * (DD-41). One made there gives the merged model another IRI than the open one:
 * with `follow` — a merge someone asked for — the result is returned with
 * `followed`, the IRI the open model moves to when it is applied; without it — a
 * check or a commit made automatically — it is refused before anything is
 * applied, for the open model is not moved behind its user's back. Moved here
 * and there, to two namespaces: refused either way.
 */
export function mergeHere(
  merge: Pick<MergeSupport, 'options'>,
  base: string[],
  ours: string[],
  theirs: string[],
  where: string,
  follow = false,
): MergeResult & { followed?: string } {
  let result: MergeResult;
  try {
    result = mergeSnapshots(base, ours, theirs, merge.options());
  } catch (err: unknown) {
    if (!(err instanceof NamespaceConflict)) throw err;
    throw new GitError(
      'invalid',
      `The model was moved to another namespace both here, to ${err.ours.namespace}, and on ${where}, to ${err.theirs.namespace}: move it to the same one on both, then merge again.`,
    );
  }
  const open = snapshotModel(ours)?.model;
  const merged = snapshotModel(result.merged)?.model;
  if (open && merged && merged !== open) {
    // A move is to another namespace, and makes the model `{to}model` (DD-41). Another IRI in the
    // same namespace, or not named so, is another model in the file: not this one moved.
    const before = snapshotModel(base);
    const there = snapshotModel(theirs);
    const moved = before !== undefined && there !== undefined && there.model === merged
      && there.namespace !== before.namespace && merged === `${there.namespace}model`;
    if (!moved) throw new GitError('invalid', anotherModel(where, merged));
    if (!follow) throw new GitError('invalid', movedElsewhere(where, merged));
    return { ...result, followed: merged };
  }
  return result;
}

/** Why la-gram does not merge a version that has another model than the open one, and what to do instead. */
export function anotherModel(where: string, model: string): string {
  return (
    `${where} has another model now, ${model}: not this one moved to another namespace, so it is not merged into it. ` +
    `Open ${where} from Git to open that model; Save to Git as… keeps this one on a branch of its own.`
  );
}

/**
 * A binding after the model may have moved from `before` to `now`, following a
 * move made elsewhere: kept under `now`, noting the IRI its file has the model
 * under while that is not `now` — as `GitBindings.move` keeps it.
 */
export function keptAs(binding: GitBinding, before: string, now: string): GitBinding {
  if (now === before) return binding;
  const { movedFrom, ...rest } = binding;
  const inFile = movedFrom ?? before;
  return inFile === now ? rest : { ...rest, movedFrom: inFile };
}

/** What la-gram says when the open model followed a move made on `where` to `model`. */
export function followedMove(where: string, model: string): string {
  return (
    `${where} has the model in another namespace, as ${model}: the open model moved there too, and stays bound to its file. ` +
    'Auto-commit, if it was on, is off for it until you turn it on again.'
  );
}

/** What Model settings says before it moves a model saved to Git into another namespace (DD-41). */
export function namespaceMoveMessage(binding: Pick<GitBinding, 'repository' | 'branch' | 'path'>, to: string): string {
  return (
    `This model is saved to Git: ${binding.repository} · ${binding.branch} · ${binding.path}. Moving it to ${to} renames every IRI in it, ` +
    'and Save to Git commits that to the same file — do it right after, so that the move is a commit of its own. ' +
    'A branch started before the move is merged into the new namespace by Update from main… on the moved branch, and by la-gram-git merge.'
  );
}

/**
 * A binding moved on to a version of its file: its `movedFrom` kept only while
 * that version still has the model under the IRI it had before it was moved here.
 */
export function advanced(binding: GitBinding, to: { commit: string; version: string }, file: readonly string[]): GitBinding {
  const { movedFrom, ...rest } = binding;
  const still = movedFrom !== undefined && snapshotModel(file)?.model === movedFrom;
  return { ...rest, commit: to.commit, version: to.version, ...(still ? { movedFrom } : {}) };
}

/**
 * Why an automatic check or commit does not merge a version that has the model
 * moved to another namespace there, and what moves the open model there instead.
 */
export function movedElsewhere(where: string, model: string): string {
  return (
    `${where} has the model in another namespace now, as ${model}. Automatic checks and auto-commit do not move the open model there: ` +
    'Pull from Git does.'
  );
}

/**
 * Merge the model with the newer version of its file and commit the result —
 * the first choice when a save is refused. `undefined` when nothing was
 * committed: conflicts to choose, nothing of the model's own left, or a failure
 * (reported).
 */
export async function mergeWithNewer(
  ctx: GitSaveContext,
  provider: GitHostProvider,
  target: Target,
  bound: GitBinding,
): Promise<CommitResult | undefined> {
  const merge = ctx.merge;
  const modelIri = ctx.modelIri();
  if (!merge || !modelIri) return undefined;
  const { branch, path } = bound;
  const baseFile = await provider.readFile(bound.commit, path);
  if (!baseFile) {
    ctx.report(`The version this model was opened at (${bound.commit.slice(0, 8)}) could not be read, so it cannot be merged. Save to a new branch instead.`, 'error');
    return undefined;
  }
  let base = snapshotOfText(baseFile.text, path);
  let binding = bound;
  // The model's IRI as the loop goes: a merge follows a move made on the branch (DD-41).
  let iri = modelIri;
  for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
    const head = await provider.branchHead(branch);
    const there = await provider.readFile(head, path);
    if (!there) {
      ctx.report(`${path} is no longer on ${branch}: there is nothing to merge with. Save to Git as… puts the model back.`, 'error');
      return undefined;
    }
    const theirs = snapshotOfText(there.text, path);
    const ours = snapshotOfText(ctx.serialize(target.format), path);
    const { merged, conflicts, followed } = reconcile(merge, base, ours, theirs, branch, true);
    if (followed) {
      ctx.bindings.forget(iri);
      binding = keptAs(binding, iri, followed);
      iri = followed;
      ctx.report(followedMove(branch, followed));
    }
    binding = advanced(binding, { version: there.version, commit: head }, theirs);

    if (conflicts.length > 0) {
      ctx.bindings.set(iri, binding);
      merge.conflicts(conflicts, { branch, commit: head });
      ctx.report(
        `Merged with ${branch} at ${head.slice(0, 8)}: ${conflicts.length === 1 ? 'one change' : `${conflicts.length} changes`} made on both sides to choose between in the Conflicts tab — then Save to Git.`,
        'warning',
      );
      return undefined;
    }
    if (sameLines(merged, theirs) && !binding.update) {
      // Everything here was there already: nothing to commit.
      ctx.bindings.set(iri, binding);
      merge.clear();
      ctx.saved(path.split('/').pop() ?? path);
      ctx.report(`The model is now ${branch} at ${head.slice(0, 8)}, which had all of its changes: nothing to commit.`);
      return undefined;
    }
    try {
      return await commitBound(ctx, provider, target, binding);
    } catch (err: unknown) {
      if (!(err instanceof GitError) || err.kind !== 'conflict') throw err;
      // It moved on again meanwhile: merge with the newer one, from what was merged.
      base = theirs;
    }
  }
  ctx.report(`${branch} kept changing while the model was merged with it. Save to Git again.`, 'warning');
  return undefined;
}

/**
 * Commit the model to the file it is bound to, naming the version it replaces;
 * with another branch merged in and not yet recorded, as {@link commitUpdate}.
 */
export async function commitBound(
  ctx: GitSaveContext,
  provider: GitHostProvider,
  target: Target,
  binding: GitBinding,
): Promise<CommitResult | undefined> {
  if (binding.update) return commitUpdate(ctx, provider, target, binding);
  return provider.commitFile({
    branch: binding.branch,
    path: binding.path,
    text: ctx.serialize(target.format),
    message: target.message,
    expectedVersion: binding.version,
  });
}

/**
 * Commit a model another branch was merged into, recording it as merged. On a
 * host that can make a merge commit (GitHub), one with the branch's head and
 * the other branch's as parents; elsewhere (GitLab), to a new branch started
 * from the other branch's head, which a merge request then merges cleanly.
 * A conflict when the bound branch moved on since the merge.
 */
export async function commitUpdate(
  ctx: GitSaveContext,
  provider: GitHostProvider,
  target: Target,
  binding: GitBinding,
): Promise<CommitResult | undefined> {
  const update = binding.update!;
  const head = await provider.branchHead(binding.branch);
  if (head !== binding.commit) {
    throw new GitError('conflict', `${binding.path} changed on ${binding.branch} since ${update.branch} was merged into the model.`);
  }
  const text = ctx.serialize(target.format);
  if (provider.commitMerge) {
    return provider.commitMerge({ branch: binding.branch, head: binding.commit, mergeOf: update.commit, path: binding.path, text, message: target.message });
  }
  const stamp = (ctx.now?.() ?? new Date()).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const prefix = gitDefaults(ctx.config, ctx.personal?.()).branchPrefix;
  const name = await ctx.dialogs.prompt(
    'Commit to a new branch',
    `${binding.host} cannot record ${update.branch} as merged into ${binding.branch}, so the merged model goes to a new branch started from ${update.branch} — open its merge request, and close the one from ${binding.branch}. Branch name`,
    `${prefix}${slug(ctx.modelLabel())}-${stamp}`,
  );
  if (!name) return undefined;
  const problem = branchProblem(name);
  if (problem) throw new GitError('invalid', problem);
  return provider.commitFile({
    branch: update.branch,
    newBranch: name,
    startFrom: update.commit,
    path: binding.path,
    text,
    message: target.message,
    ...(update.version ? { expectedVersion: update.version } : {}),
  });
}

/**
 * *Update from main*: merge another branch — the default one, offered first —
 * into the bound model, then commit it (asking for the message) when nothing
 * conflicts.
 */
export async function updateFromBranch(ctx: GitSaveContext): Promise<CommitResult | undefined> {
  const merge = ctx.merge;
  const modelIri = ctx.modelIri();
  const bound = modelIri ? ctx.bindings.get(modelIri) : undefined;
  if (!merge || !modelIri || !bound) {
    ctx.report('Update from main merges another branch into the file the model is bound to: save it to Git, or open it from Git, first.', 'warning');
    return undefined;
  }
  const open = merge.unresolved();
  if (open > 0) {
    ctx.report(`Choose the ${open === 1 ? 'conflict' : `${open} conflicts`} in the Conflicts tab first, then update.`, 'warning');
    return undefined;
  }
  const link = bindingLink(ctx, bound);
  const token = await tokenFor(ctx, link);
  if (token === null) return undefined;
  const provider = ctx.provider(link, token);
  const { branch, path } = bound;
  const format = formatOfPath(path) ?? 'turtle';
  const read = async (ref: string) => {
    const file = await provider.readFile(ref, path);
    return file ? { file, snapshot: snapshotOfText(file.text, path) } : undefined;
  };

  try {
    const main = await provider.defaultBranch();
    const others = [main, ...(await provider.listBranches()).filter((b) => b !== main)].filter((b) => b !== branch);
    if (others.length === 0) {
      ctx.report(`${bound.repository} has no branch but ${branch} to update from.`);
      return undefined;
    }
    const source = await ctx.dialogs.choose(
      `Update ${branch} from…`,
      others.map((b) => ({ value: b, label: b, ...(b === main ? { detail: 'The default branch' } : {}) })),
    );
    if (!source) return undefined;

    // The model's own branch first, if it moved on: the update is merged on top of it.
    let binding: GitBinding = bound;
    // The model's IRI as the update goes: each merge follows a move made where it merges from (DD-41).
    let iri = modelIri;
    let ours = snapshotOfText(ctx.serialize(format), path);
    const head = await provider.branchHead(branch);
    if (head !== bound.commit) {
      const [base, newer] = await Promise.all([read(bound.commit), read(head)]);
      if (!base || !newer) {
        ctx.report(`${path} could not be read on ${branch}: the update is not made.`, 'error');
        return undefined;
      }
      const caughtUp = mergeHere(merge, base.snapshot, ours, newer.snapshot, branch, true);
      if (!sameLines(caughtUp.merged, ours)) merge.replace(caughtUp.merged);
      if (caughtUp.followed) {
        ctx.bindings.forget(iri);
        binding = keptAs(binding, iri, caughtUp.followed);
        iri = caughtUp.followed;
        ctx.report(followedMove(branch, iri));
      }
      binding = advanced(binding, { version: newer.file.version, commit: head }, newer.snapshot);
      ctx.bindings.set(iri, binding);
      if (caughtUp.conflicts.length > 0) {
        merge.conflicts(caughtUp.conflicts, { branch, commit: head });
        ctx.report(
          `${branch} moved on, so it was merged into the model first — with changes made on both sides to choose between in the Conflicts tab. Then Update from main again.`,
          'warning',
        );
        return undefined;
      }
      ours = caughtUp.merged;
    }

    const sourceHead = await provider.branchHead(source);
    const baseCommit = await provider.mergeBase(binding.commit, sourceHead);
    if (baseCommit === sourceHead) {
      ctx.report(`${branch} already has everything on ${source}.`);
      return undefined;
    }
    const theirs = await read(sourceHead);
    if (!theirs) {
      ctx.report(`${source} has no ${path}: there is nothing to update from.`, 'warning');
      return undefined;
    }
    const base = await read(baseCommit);
    const { merged, conflicts, followed } = mergeHere(merge, base?.snapshot ?? [], ours, theirs.snapshot, source, true);
    if (!sameLines(merged, ours)) merge.replace(merged);
    if (followed) {
      // Moved on the other branch: the file on this one still has the model as it was, until the
      // update is committed.
      ctx.bindings.forget(iri);
      binding = keptAs(binding, iri, followed);
      iri = followed;
      ctx.report(followedMove(source, iri));
    }
    ctx.bindings.set(iri, {
      ...binding,
      update: { branch: source, commit: sourceHead, version: theirs.file.version },
    });
    if (conflicts.length > 0) {
      merge.conflicts(conflicts, { branch: source, commit: sourceHead });
      ctx.report(
        `${source} merged into the model, with ${conflicts.length === 1 ? 'one change' : `${conflicts.length} changes`} made on both sides to choose between in the Conflicts tab — then Save to Git records the update.`,
        'warning',
      );
      return undefined;
    }
    ctx.report(`${source} at ${sourceHead.slice(0, 8)} merged into the model.`);
    return await saveToGit(ctx);
  } catch (err: unknown) {
    ctx.report(err instanceof Error ? err.message : String(err), 'error');
    return undefined;
  }
}

export function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
