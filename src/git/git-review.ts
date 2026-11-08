/**
 * *Open merge request* (Phase 2 of the Git collaboration plan): the bound
 * branch, proposed for merging into the default branch — a merge request on
 * GitLab, a pull request on GitHub.
 *
 * ```
 * the model bound to a branch (Save to Git first)
 *   → the token for the host; the default branch (or the branch given)
 *   → one open already from this branch into that one: say where it is
 *   → changes not saved to Git: ask (the request shows what is committed)
 *   → nothing on the branch the other has not: say so
 *   → the dialog: its title (the branch's last commit of the file), its
 *     description (the branch's changes by element, in Markdown, as
 *     `model-diff-text.ts` words them)
 *   → open it; say where it is
 * ```
 *
 * The description is the changes as they are when it is opened; commits after
 * it are the host's to show (and CI's to comment on, Phase 3).
 *
 * The token needs, on GitHub, *Pull requests: read and write* on the
 * repository besides *Contents*; on GitLab, the `api` scope it has already.
 */
import { diffByElement } from '../model-manager/model-diff.js';
import { markdownOfDiff, type DiffWords } from '../model-manager/model-diff-text.js';
import { snapshotOfText } from '../model-manager/model-merge.js';
import { GitError } from './errors.js';
import { hostNotAllowed, type GitProviderKind } from './link.js';
import { bindingLink, tokenFor, type GitSaveContext } from './git-save.js';
import type { GitHostProvider, MergeRequest } from './providers/provider.js';

/** What the host calls it. */
export function reviewName(provider: GitProviderKind): string {
  return provider === 'github' ? 'pull request' : 'merge request';
}

/** `#7` on GitHub, `!3` on GitLab. */
function reference(provider: GitProviderKind, request: MergeRequest): string {
  return `${provider === 'github' ? '#' : '!'}${request.number}`;
}

/** Without the metamodels' names: types and properties by their IRIs' last part. */
const PLAIN_WORDS: DiffWords = {
  typeName: (iri) => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1),
  propertyName: (iri) => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1),
};

/**
 * Open a merge request from the bound branch.
 *
 * @param target The branch to merge into; the repository's default when absent.
 */
export async function openMergeRequest(ctx: GitSaveContext, target?: string): Promise<MergeRequest | undefined> {
  const modelIri = ctx.modelIri();
  const binding = modelIri ? ctx.bindings.get(modelIri) : undefined;
  if (!binding) {
    ctx.report('Save the model to Git first: a merge request merges the branch it is committed to.', 'warning');
    return undefined;
  }
  const hosts = ctx.config?.hosts;
  if (hosts && !hosts.some((h) => h.host === binding.host)) {
    ctx.report(hostNotAllowed(binding.host, hosts), 'error');
    return undefined;
  }
  const link = bindingLink(ctx, binding);
  const kind = reviewName(link.provider);
  const token = await tokenFor(ctx, link);
  if (token === null) return undefined;
  const provider = ctx.provider(link, token);
  const source = binding.branch;
  let into = target;
  try {
    into ??= await provider.defaultBranch();
    if (source === into) {
      ctx.report(`The model is on ${source}, the branch a ${kind} would merge into. Save to Git as… commits it to a branch of its own.`, 'warning');
      return undefined;
    }
    const open = await provider.findMergeRequest(source, into);
    if (open) {
      ctx.report(`A ${kind} from ${source} into ${into} is open already: ${reference(link.provider, open)} ${open.title} — ${open.webUrl}`);
      return open;
    }
    if (ctx.isDirty?.()) {
      const go = await ctx.dialogs.confirm(
        'Changes not saved to Git',
        `The model has changes not committed to ${source}. The ${kind} shows what is committed: Save to Git first to include them.`,
        { confirmLabel: `Open the ${kind} anyway` },
      );
      if (!go) return undefined;
    }
    const [intoHead, head] = await Promise.all([provider.branchHead(into), provider.branchHead(source)]);
    const base = await provider.mergeBase(intoHead, head);
    if (base === head) {
      ctx.report(`${source} has nothing ${into} does not: there is nothing to merge.`, 'warning');
      return undefined;
    }

    const draft = await describe(ctx, provider, binding.path, source, base, head);
    const values = await ctx.dialogs.form(
      `Open ${kind}`,
      [
        { name: 'title', label: 'Title', value: draft.title },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          value: draft.description,
          hint: `Markdown. The changes by element as they are now; the host shows the commits made after.`,
        },
      ],
      {
        message: `From ${source} into ${into} in ${link.repository}.`,
        confirmLabel: `Open ${kind}`,
        validate: (v) => (String(v['title']) ? null : { message: `A ${kind} needs a title.`, field: 'title' }),
      },
    );
    if (!values) return undefined;
    const opened = await provider.openMergeRequest({ source, target: into, title: String(values['title']), description: String(values['description']) });
    ctx.report(`Opened ${kind} ${reference(link.provider, opened)} from ${source} into ${into} — ${opened.webUrl}`);
    return opened;
  } catch (err: unknown) {
    if (err instanceof GitError) {
      if (err.kind === 'auth') {
        await ctx.tokens.forget(link.host);
        ctx.report(`${err.message} It is forgotten; try again to give another.`, 'error');
        return undefined;
      }
      if (err.kind === 'forbidden') {
        ctx.report(
          link.provider === 'github'
            ? `The token may not open pull requests in ${link.repository}: it needs Pull requests: read and write on the repository, besides Contents.`
            : `The token may not open merge requests in ${link.repository}: it needs the api scope.`,
          'error',
        );
        return undefined;
      }
      // Opened meanwhile — from another la-gram, or on the host.
      const open = into ? await provider.findMergeRequest(source, into).catch(() => undefined) : undefined;
      if (open) {
        ctx.report(`A ${kind} from ${source} into ${into} is open already: ${reference(link.provider, open)} ${open.title} — ${open.webUrl}`);
        return open;
      }
    }
    ctx.report(err instanceof Error ? err.message : String(err), 'error');
    return undefined;
  }
}

/** A title — the branch's last commit of the file — and its changes by element, as the description. */
async function describe(
  ctx: GitSaveContext,
  provider: GitHostProvider,
  path: string,
  source: string,
  base: string,
  head: string,
): Promise<{ title: string; description: string }> {
  const [history, before, after] = await Promise.all([
    provider.fileCommits(source, path).catch(() => undefined),
    provider.readFile(base, path),
    provider.readFile(head, path),
  ]);
  const title = history?.commits[0]?.message.split('\n')[0]?.trim() || `Update ${ctx.modelLabel()}`;
  const diff = diffByElement(before ? snapshotOfText(before.text, path) : [], after ? snapshotOfText(after.text, path) : [], {
    ...(ctx.merge ? { singleValued: ctx.merge.options().singleValued } : {}),
  });
  return { title, description: `${markdownOfDiff(diff, ctx.words ?? PLAIN_WORDS)}\n\n_In \`${path}\`, when this was opened._` };
}
