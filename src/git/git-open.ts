/**
 * Open from Git (Req 18.9, 18.11): a model file from a repository, opened as
 * File › Open does, and the model bound to it.
 *
 * ```
 * the address (the dialog, or ?git=<link> at startup)
 *   a file           → open it
 *   a repository, a branch, a folder
 *                    → its model files (by extension), grouped by folder, to choose
 *                      one — or another branch
 *   → read the file at the branch's head commit
 *   → ask before the model is replaced (unsaved changes, a shared room) — only
 *     now, when there is something to replace it with
 *   → open it; bind the model to {branch, path, the file's version, that
 *     commit}, so Save to Git commits there
 * ```
 *
 * A repository is read without a token first — a public one needs none — unless
 * a token is kept for its host; when the host refuses (private repositories
 * answer 404), the token is asked for and the read tried again.
 */
import type { Dialogs, ChoiceOption } from '../ui/dialogs.js';
import { MODEL_FORMATS } from '@linked-archi/kernel/import-export/model-io.js';
import type { GitBindings } from './bindings.js';
import type { TokenStore } from './credentials.js';
import { GitError } from './errors.js';
import { branchProblem, formatOfPath, tokenFor } from './git-save.js';
import { type GitProviderKind, type RepositoryLink } from './link.js';
import type { GitConfig } from '../config.js';
import { learnKind, readLink, type HostKinds } from './host-kinds.js';
import type { PersonalGitSettings } from './git-save.js';
import type { GitHostProvider } from './providers/provider.js';

/** What the Open flow needs from la-gram, injected so it is tested without the UI. */
export interface GitOpenContext {
  dialogs: Dialogs;
  report(message: string, level?: 'info' | 'warning' | 'error'): void;
  tokens: TokenStore;
  bindings: GitBindings;
  provider(link: RepositoryLink, token: string | undefined): GitHostProvider;
  /** Ask before the model is replaced, as File › Open does; `false` to stop. */
  confirmReplace(what: string): Promise<boolean>;
  /** Open a model file's text, as File › Open does; the model's IRI after. */
  open(text: string, fileName: string): Promise<string | undefined>;
  /** The deployment's Git configuration: the hosts allowed, the default repository. */
  config?: GitConfig;
  /** The user's own defaults, read each time (Req 18.15). */
  personal?(): PersonalGitSettings;
  /** The kinds learned for self-hosted hosts (Req 18.16). */
  hostKinds?: HostKinds;
}

/** The value of the chooser's "another branch" entry: not a path (paths have no NUL). */
const OTHER_BRANCH = '\u0000branch';

/** Failures the host gives a read without a token that a token may cure. */
const NEEDS_TOKEN = new Set(['auth', 'forbidden', 'not-found', 'rate-limit']);

type ReadContext = Pick<GitOpenContext, 'tokens' | 'dialogs' | 'provider'>;

/**
 * A repository, read with the access it needs: without a token unless one is
 * kept, asking for one once when the host refuses (the History tab too).
 */
export class Access {
  private constructor(
    private readonly ctx: ReadContext,
    readonly link: RepositoryLink,
    private token: string | undefined,
    private provider: GitHostProvider,
  ) {}

  static async create(ctx: ReadContext, link: RepositoryLink): Promise<Access> {
    const token = await ctx.tokens.get(link.host);
    return new Access(ctx, link, token, ctx.provider(link, token));
  }

  /** Whether a token is in use (one refused then is forgotten). */
  get withToken(): boolean {
    return this.token !== undefined;
  }

  /**
   * Run a read; `null` when the user cancels the token prompt. Not to `ask`, a
   * refusal a token may cure is said so, and nothing is asked.
   */
  async run<T>(read: (provider: GitHostProvider) => Promise<T>, ask = true): Promise<T | null> {
    try {
      return await read(this.provider);
    } catch (err: unknown) {
      if (!(err instanceof GitError) || this.token !== undefined || !NEEDS_TOKEN.has(err.kind)) throw err;
      if (!ask) throw new GitError(err.kind, `${err.message} A token may be needed to read it.`, err.status, err.retryAt);
      const token = await tokenFor(this.ctx, this.link, 'open');
      if (token === null) return null;
      this.token = token;
      this.provider = this.ctx.provider(this.link, token);
      return read(this.provider);
    }
  }
}

/** The model-file extensions, for messages. */
const EXTENSIONS = MODEL_FORMATS.map((f) => `.${f.extension}`).join(' ');

/**
 * Open a model from Git.
 *
 * @param address A link to open without the dialog (`?git=<link>`).
 * @returns The opened model's IRI, or `undefined` when nothing was opened.
 */
export async function openFromGit(ctx: GitOpenContext, address?: string): Promise<string | undefined> {
  let link: RepositoryLink;
  let branchAsked = '';
  try {
    if (address !== undefined) {
      link = readLink(address, undefined, ctx.config, ctx.hostKinds);
    } else {
      const asked = await askAddress(ctx);
      if (!asked) return undefined;
      ({ link, branch: branchAsked } = asked);
    }
  } catch (err: unknown) {
    ctx.report(err instanceof Error ? err.message : String(err), 'error');
    return undefined;
  }

  const access = await Access.create(ctx, link);
  try {
    let branch: string | null = branchAsked || link.branch || (await access.run((p) => p.defaultBranch()));
    if (branch === null) return undefined;
    // A link to a file opens it; to a folder, lists what is in it.
    if (link.path && !formatOfPath(link.path) && /\.[^/.]+$/.test(link.path)) {
      throw new GitError('invalid', `${link.path} is not a model file: la-gram opens ${EXTENSIONS}`);
    }
    let path = link.path && formatOfPath(link.path) ? link.path : undefined;
    if (!path) {
      const chosen = await chooseFile(ctx, access, branch, link.path);
      if (!chosen) return undefined;
      ({ branch, path } = chosen);
    }
    return await openFile(ctx, access, branch, path, 'Open from Git');
  } catch (err: unknown) {
    if (err instanceof GitError && err.kind === 'auth' && access.withToken) {
      await ctx.tokens.forget(link.host);
      ctx.report(`${err.message} It is forgotten; open again to give another.`, 'error');
      return undefined;
    }
    ctx.report(err instanceof Error ? err.message : String(err), 'error');
    return undefined;
  }
}

/**
 * Open the newest version of a bound file — the conflict choice "Open the
 * newer version" (Req 18.7). Asks before the model is replaced.
 */
export async function reopenFromGit(ctx: GitOpenContext, link: RepositoryLink, branch: string, path: string): Promise<boolean> {
  try {
    return (await openFile(ctx, await Access.create(ctx, link), branch, path, 'Open the newer version')) !== undefined;
  } catch (err: unknown) {
    ctx.report(err instanceof Error ? err.message : String(err), 'error');
    return false;
  }
}

/** The Open from Git dialog: the address, the host kind, the branch. */
async function askAddress(ctx: GitOpenContext): Promise<{ link: RepositoryLink; branch: string } | undefined> {
  const providerOf = (v: Record<string, string | boolean>): GitProviderKind | undefined =>
    v['provider'] === 'github' || v['provider'] === 'gitlab' ? v['provider'] : undefined;
  const suggestedBranch = ctx.personal?.().branch ?? ctx.config?.defaults.branch ?? '';
  const values = await ctx.dialogs.form(
    'Open from Git',
    [
      {
        name: 'repository',
        label: 'Address',
        value: ctx.personal?.().repository ?? ctx.bindings.lastRepository() ?? ctx.config?.defaults.repository ?? '',
        hint: ctx.config?.hosts
          ? `A link to a model file opens it; to a repository, a branch or a folder lists its model files. This installation allows ${ctx.config.hosts.map((h) => h.host).join(', ')}.`
          : 'A link to a model file opens it; a link to a repository, a branch or a folder lists its model files.',
      },
      {
        name: 'provider',
        label: 'Host',
        type: 'select',
        value: 'auto',
        options: [
          { value: 'auto', label: 'Decided by the address (github.com, gitlab.com)' },
          { value: 'github', label: 'GitHub (also GitHub Enterprise Server)' },
          { value: 'gitlab', label: 'GitLab (also self-managed)' },
        ],
      },
      {
        name: 'branch',
        label: 'Branch',
        value: suggestedBranch,
        hint: 'Empty: the one the address names, or the repository’s default.',
      },
    ],
    {
      confirmLabel: 'Open',
      validate: (v) => {
        try {
          readLink(String(v['repository']), providerOf(v), ctx.config, ctx.hostKinds);
        } catch (err: unknown) {
          return err instanceof Error ? err.message : String(err);
        }
        return v['branch'] ? branchProblem(String(v['branch'])) : null;
      },
    },
  );
  if (!values) return undefined;
  learnKind(String(values['repository']), providerOf(values), ctx.config, ctx.hostKinds);
  const link = readLink(String(values['repository']), providerOf(values), ctx.config, ctx.hostKinds);
  // A link's branch wins over a branch the dialog only suggested.
  const branchField = String(values['branch']);
  return { link, branch: branchField === suggestedBranch && link.branch ? link.branch : branchField };
}

/** Choose a model file on a branch — or move to another branch. `null` when cancelled. */
async function chooseFile(
  ctx: GitOpenContext,
  access: Access,
  start: string,
  folder: string | undefined,
): Promise<{ branch: string; path: string } | null> {
  let branch = start;
  const within = folder ? `${folder.replace(/\/+$/, '')}/` : '';
  for (;;) {
    const head = await access.run((p) => p.branchHead(branch));
    if (head === null) return null;
    const listed = await access.run((p) => p.listFiles(head));
    if (listed === null) return null;
    // By folder, then name, so a folder's files stay under one heading.
    const split = (path: string) => {
      const cut = path.lastIndexOf('/');
      return { path, dir: cut >= 0 ? path.slice(0, cut) : '', name: path.slice(cut + 1) };
    };
    const models = listed.paths
      .filter((p) => formatOfPath(p) && p.startsWith(within))
      .map(split)
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir.localeCompare(b.dir)));
    const options: ChoiceOption[] = models.map(({ path, dir, name }) => ({ value: path, label: name, group: dir || '(top level)' }));
    if (models.length === 0) {
      options.push({
        value: '\u0000none',
        label: `No model files ${within ? `in ${within}` : 'here'} (${EXTENSIONS})`,
        disabled: true,
      });
    }
    if (listed.truncated) {
      options.push({
        value: '\u0000truncated',
        label: 'The repository is too large to list in full — open a file by its link',
        disabled: true,
      });
    }
    options.push({ value: OTHER_BRANCH, label: 'Another branch…', detail: `This is ${branch}.`, group: 'Branch' });
    const choice = await ctx.dialogs.choose(`Open from ${access.link.repository} · ${branch}`, options, models[0]?.path ?? OTHER_BRANCH);
    if (choice === null) return null;
    if (choice !== OTHER_BRANCH) return { branch, path: choice };
    const branches = await access.run((p) => p.listBranches());
    if (branches === null) return null;
    const next = await ctx.dialogs.choose(
      `Branches of ${access.link.repository}`,
      branches.map((b) => ({ value: b, label: b })),
      branch,
    );
    if (next === null) return null;
    branch = next;
  }
}

/**
 * Read the file at the branch's head; ask before the model is replaced
 * (`what` names the action); open it; bind the model to it.
 */
async function openFile(ctx: GitOpenContext, access: Access, branch: string, path: string, what: string): Promise<string | undefined> {
  const head = await access.run((p) => p.branchHead(branch));
  if (head === null) return undefined;
  const file = await access.run((p) => p.readFile(head, path));
  if (file === null) return undefined;
  if (file === undefined) throw new GitError('not-found', `${path} is not on ${branch} in ${access.link.repository}.`);
  if (!(await ctx.confirmReplace(what))) return undefined;
  const modelIri = await ctx.open(file.text, path.split('/').pop() ?? path);
  if (!modelIri) return undefined;
  const { link } = access;
  ctx.bindings.set(modelIri, {
    host: link.host,
    provider: link.provider,
    apiBase: link.apiBase,
    repository: link.repository,
    webUrl: link.webUrl,
    branch,
    path,
    version: file.version,
    commit: head,
  });
  ctx.report(`From ${link.repository} · ${branch} · ${path} at ${head.slice(0, 8)}: Save to Git commits there.`);
  return modelIri;
}
