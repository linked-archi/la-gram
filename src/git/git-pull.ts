/** Manual same-branch synchronization, with no repository writes (Req 18.24). */
import { quadsOfSnapshot, snapshotOfText } from '../model-manager/model-merge.js';
import { IRI } from '../model-manager/vocabulary.js';
import type { GitBinding } from './bindings.js';
import { GitError } from './errors.js';
import { Access } from './git-open.js';
import { reconcile, sameLines } from './git-merge.js';
import { bindingLink, formatOfPath, type GitSaveContext } from './git-save.js';

export interface GitPullContext extends GitSaveContext {
  /** Still the same editor lifecycle, including a reload of the same model IRI. */
  current(): boolean;
  room(): string | undefined;
  /** Refresh the dirty marker and History after advancing the binding. */
  changed(): void;
}

export type PullOutcome = 'unchanged' | 'pulled' | 'merged' | 'conflicts' | 'stopped' | 'obsolete';

/** Includes the incorporated base and pending merge, not just the destination. */
function bindingKey(b: GitBinding | undefined): string {
  return JSON.stringify(b && [b.host, b.provider, b.apiBase, b.repository, b.webUrl, b.branch, b.path,
    b.commit, b.version, b.update?.branch, b.update?.commit, b.update?.version]);
}

/** Refuse a replacement model or blank nodes whose identities cannot be matched across files. */
function checkSnapshot(snapshot: string[], modelIri: string): void {
  const quads = quadsOfSnapshot(snapshot);
  const models = quads.filter((q) => q.predicate.value === IRI.rdfType && q.object.value === IRI.Model);
  if (models.length !== 1 || models[0]!.subject.value !== modelIri) {
    throw new GitError('invalid', 'The file does not contain the same model. Open from Git to open it separately.');
  }
  if (quads.some((q) => q.subject.termType === 'BlankNode' || q.object.termType === 'BlankNode')) {
    throw new GitError('invalid', 'Pull cannot safely match blank nodes between versions. Use IRI-named model data before pulling.');
  }
}

class ObsoletePull extends Error {}

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
  const check = () => { if (!current()) throw new ObsoletePull(); };
  // Also check rejected reads: an obsolete failure must not prompt for credentials.
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    try { return await operation(); } finally { check(); }
  };
  let access: Access | undefined;
  try {
    check();
    const format = formatOfPath(bound.path);
    if (!format) throw new GitError('invalid', `The file format of ${bound.path} is not supported.`);
    const link = bindingLink(ctx, bound);
    access = await read(() => Access.create(ctx, link));
    ctx.report(`Pulling ${bound.path} from ${bound.branch}…`);
    const files = await access.run(async (provider) => {
      const head = await read(() => provider.branchHead(bound.branch));
      const base = await read(() => provider.readFile(bound.commit, bound.path));
      if (!base) throw new GitError('invalid', 'The previously incorporated version cannot be read. Pull needs that version to preserve local changes.');
      const remote = head === bound.commit ? base : await read(() => provider.readFile(head, bound.path));
      if (!remote) throw new GitError('invalid', `${bound.path} is no longer on ${bound.branch}. Pull left the model unchanged.`);
      return { head, base, remote };
    });
    check();
    if (!files) return 'stopped';
    const { head, base, remote } = files;
    const theirs = snapshotOfText(remote.text, bound.path);
    const baseline = snapshotOfText(base.text, bound.path);
    // Take this only after all I/O: edits and undo during the reads belong in ours.
    const ours = snapshotOfText(ctx.serialize(format), bound.path);
    for (const snapshot of [baseline, theirs, ours]) checkSnapshot(snapshot, modelIri);
    const { conflicts, changed } = reconcile(merge, baseline, ours, theirs);
    ctx.bindings.set(modelIri, { ...bound, commit: head, version: remote.version });
    if (conflicts.length) merge.conflicts(conflicts, { branch: bound.branch, commit: head });
    else merge.clear();
    // A local-file save may have cleared the app's marker without saving to Git.
    // Re-read after application in case synchronous model listeners made edits.
    const dirty = conflicts.length > 0 || !sameLines(snapshotOfText(ctx.serialize(format), bound.path), theirs);
    if (dirty) ctx.changed();
    else ctx.saved(bound.path.split('/').pop() ?? bound.path);
    if (conflicts.length) {
      ctx.report(`Pulled ${bound.branch} at ${head.slice(0, 8)}. Choose ${conflicts.length === 1 ? 'the change' : `${conflicts.length} changes`} in the Conflicts tab, then Save to Git when ready. Nothing was committed.`, 'warning');
      return 'conflicts';
    }
    const incoming = !sameLines(baseline, theirs);
    ctx.report(`${incoming ? `Pulled ${bound.branch} at ${head.slice(0, 8)}.` : 'No incoming model changes.'}${dirty ? ' Local changes are kept; Save to Git when ready.' : ''} Nothing was committed.`);
    return dirty ? 'merged' : changed ? 'pulled' : 'unchanged';
  } catch (err: unknown) {
    if (err instanceof ObsoletePull || !current()) {
      ctx.report('Pull discarded because the open model or its Git destination changed.', 'info');
      return 'obsolete';
    }
    if (err instanceof GitError && err.kind === 'auth' && access?.withToken) await ctx.tokens.forget(bound.host);
    ctx.report(`Pull from Git failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return 'stopped';
  }
}
