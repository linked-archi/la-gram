/** Observe immutable versions without advancing the editor's incorporated base. */
import { quadsOfSnapshot, snapshotOfText } from '../model-manager/model-merge.js';
import { IRI } from '../model-manager/vocabulary.js';
import type { GitBinding } from './bindings.js';
import { GitError } from './errors.js';
import { Access } from './git-open.js';
import { sameLines } from './git-merge.js';
import { bindingLink, type GitSaveContext } from './git-save.js';

export interface GitObservation {
  modelIri: string;
  binding: GitBinding;
  head: string;
  version: string;
  base: string[];
  remote: string[];
  incoming: boolean;
}

/** The full editor baseline, including an unfinished cross-branch merge. */
export function bindingKey(b: GitBinding | undefined): string {
  return b ? JSON.stringify([b.host, b.provider, b.apiBase, b.repository, b.webUrl, b.branch, b.path,
    b.commit, b.version, b.update?.branch, b.update?.commit, b.update?.version]) : '';
}

/** Ownership and operation locks are shared across model IRIs for the same destination. */
export function destinationKey(b: GitBinding): string {
  return JSON.stringify([b.host, b.provider, b.apiBase, b.repository, b.branch, b.path]);
}

/**
 * A version of the bound file holds the open model, and no blank node. The file
 * may still have the model under the IRI it had before it was moved here
 * (`binding.movedFrom`): the merge moves that version after it. A newer version
 * (`moved`, the branch's head) may have it under another IRI, moved there: the
 * merge decides whether the open model follows it.
 */
export function checkSnapshot(
  snapshot: string[],
  modelIri: string,
  binding?: Pick<GitBinding, 'branch' | 'movedFrom'>,
  moved = false,
): void {
  const quads = quadsOfSnapshot(snapshot);
  const models = quads.filter((q) => q.predicate.value === IRI.rdfType && q.object.value === IRI.Model);
  const model = models.length === 1 ? models[0]!.subject.value : undefined;
  if (model !== modelIri && (model === undefined || (model !== binding?.movedFrom && !moved))) {
    throw new GitError('invalid', 'The file does not contain the same model. Open from Git to open it separately.');
  }
  if (quads.some((q) => q.subject.termType === 'BlankNode' || q.object.termType === 'BlankNode')) {
    throw new GitError('invalid', 'Pull cannot safely match blank nodes between versions. Use IRI-named model data before pulling.');
  }
}

export class ObsoleteGitRead extends Error {}

/** Public reads need no token; only an explicit manual action may ask for one. */
export async function observeGit(
  ctx: GitSaveContext,
  binding: GitBinding,
  current: () => boolean,
  ask: boolean,
  cached?: GitObservation,
): Promise<GitObservation | null> {
  const modelIri = ctx.modelIri()!;
  const key = bindingKey(binding);
  const check = () => {
    if (!current() || ctx.modelIri() !== modelIri || bindingKey(ctx.bindings.get(modelIri)) !== key) throw new ObsoleteGitRead();
  };
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    try { return await operation(); } finally { check(); }
  };
  check();
  const access = await read(() => Access.create(ctx, bindingLink(ctx, binding)));
  const cache = cached?.modelIri === modelIri && bindingKey(cached.binding) === key ? cached : undefined;
  const observation = await access.run(async (provider) => {
    const head = await read(() => provider.branchHead(binding.branch));
    let base = cache?.base;
    let baseVersion = binding.version;
    if (!base) {
      const file = await read(() => provider.readFile(binding.commit, binding.path));
      if (!file) throw new GitError('invalid', 'The previously incorporated version cannot be read. It is needed to preserve local changes.');
      base = snapshotOfText(file.text, binding.path);
      baseVersion = file.version;
      checkSnapshot(base, modelIri, binding);
    }
    let remote: string[];
    let version: string;
    if (cache?.head === head) {
      remote = cache.remote;
      version = cache.version;
    } else if (head === binding.commit) {
      remote = base;
      version = baseVersion;
    } else {
      const file = await read(() => provider.readFile(head, binding.path));
      if (!file) throw new GitError('invalid', `${binding.path} is no longer on ${binding.branch}. The model is unchanged.`);
      remote = snapshotOfText(file.text, binding.path);
      version = file.version;
      checkSnapshot(remote, modelIri, binding, true);
    }
    check();
    return { modelIri, binding: { ...binding }, head, version, base, remote, incoming: !sameLines(base, remote) };
  }, ask);
  check();
  return observation;
}
