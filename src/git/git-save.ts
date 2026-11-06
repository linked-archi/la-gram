/**
 * Save to Git (Req 18.6–18.8, 18.10): commit the model as one file.
 *
 * ```
 * not bound, or "Save to Git as…"   the dialog: repository, branch, new branch, path, message
 * bound                             the message only; repository, branch and path are the binding's
 *   → the token for the host (asked, when there is none)
 *   → the version the commit replaces: the binding's — or, for a file the model
 *     was never bound to, whatever is there (asking before replacing it)
 *   → commit; the host refuses a version it has moved past (a conflict), and the
 *     user chooses: a new branch from where the model was, overwrite, or open
 *     the newer version instead
 *   → bind the model to the commit, mark it saved, say where it went
 * ```
 *
 * The file's extension decides the format (`.ttl`, `.trig`, `.jsonld`, `.nq`,
 * `.nt`, `.rdf`, as Save offers them); serialization is deterministic, so the
 * commit's diff is the change (Req 9.12).
 */
import type { Dialogs, FormValues } from '../ui/dialogs.js';
import { MODEL_FORMATS, type ModelFormat } from '../import-export/model-io.js';
import type { GitBinding, GitBindings } from './bindings.js';
import type { TokenStore } from './credentials.js';
import { GitError } from './errors.js';
import { hostNotAllowed, type GitProviderKind, type RepositoryLink } from './link.js';
import type { GitConfig } from '../config.js';
import { learnKind, readLink, type HostKinds } from './host-kinds.js';
import type { CommitResult, FileChange, GitHostProvider } from './providers/provider.js';

/** What the Save flow needs from la-gram, injected so it is tested without the UI. */
export interface GitSaveContext {
  /** The model's IRI, or `undefined` when there is none. */
  modelIri(): string | undefined;
  modelLabel(): string;
  /** The model serialized in a format. */
  serialize(format: ModelFormat): string;
  /** The model is saved: clears the unsaved-changes marker (`model-saved`). */
  saved(fileName: string): void;
  dialogs: Dialogs;
  report(message: string, level?: 'info' | 'warning' | 'error'): void;
  tokens: TokenStore;
  bindings: GitBindings;
  /** A provider for a repository, with a token. */
  provider(link: RepositoryLink, token: string | undefined): GitHostProvider;
  /** The time, for a new branch's suggested name. */
  now?(): Date;
  /** The deployment's Git configuration: the hosts allowed, the defaults (Req 18.13–18.14). */
  config?: GitConfig;
  /** The user's own defaults, read each time (Req 18.15). */
  personal?(): PersonalGitSettings;
  /** The kinds learned for self-hosted hosts (Req 18.16). */
  hostKinds?: HostKinds;
  /**
   * Open the newer version of the file instead — the conflict's third choice
   * (Open from Git); absent, the choice is not offered.
   */
  reopen?(link: RepositoryLink, branch: string, path: string): Promise<boolean>;
}

/** Where a save goes. */
interface Target {
  link: RepositoryLink;
  /** Empty: the repository's default branch. */
  branch: string;
  newBranch?: string;
  path: string;
  format: ModelFormat;
  message: string;
}

/** The user's Git settings (*File › Settings…*), each optional. */
export interface PersonalGitSettings {
  repository?: string;
  branch?: string;
  /** `.` for the repository's top. */
  folder?: string;
  message?: string;
  branchPrefix?: string;
  /** Whether *Remember* starts ticked. */
  rememberByDefault?: boolean;
}

/** The defaults a save starts from: the user's, else the deployment's, else la-gram's (Req 18.14–18.15). */
export interface ResolvedDefaults {
  repository?: string;
  branch?: string;
  /** The folder new files go in; empty for the repository's top. */
  folder: string;
  /** The commit message's template: `{action}`, `{model}`, `{path}`, `{branch}`. */
  message: string;
  branchPrefix: string;
}

/** The defaults, resolved: the user's over the deployment's over la-gram's. */
export function gitDefaults(config: GitConfig | undefined, personal: PersonalGitSettings = {}): ResolvedDefaults {
  const deployment = config?.defaults ?? {};
  const pick = (key: 'repository' | 'branch' | 'folder' | 'message' | 'branchPrefix') => personal[key] || deployment[key];
  const folder = personal.folder === '.' ? '' : pick('folder');
  return {
    ...(pick('repository') ? { repository: pick('repository') } : {}),
    ...(pick('branch') ? { branch: pick('branch') } : {}),
    folder: folder ?? 'models',
    message: pick('message') || '{action} {model}',
    branchPrefix: pick('branchPrefix') ?? 'la-gram/',
  };
}

/** A commit message from its template. */
export function commitMessage(
  template: string,
  values: { action: 'Add' | 'Update'; model: string; path: string; branch: string },
): string {
  return template.replace(/\{(action|model|path|branch)\}/g, (_m, key: keyof typeof values) => values[key]).trim();
}

/** The model formats by the extension that names them. */
const BY_EXTENSION = new Map(MODEL_FORMATS.map((f) => [f.extension, f.id]));

/** The format a path's extension names, or `undefined`. */
export function formatOfPath(path: string): ModelFormat | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension ? BY_EXTENSION.get(extension) : undefined;
}

/** The problem with a path in a repository, or `null`. */
export function pathProblem(path: string): string | null {
  if (!path) return 'Give the path of the file in the repository, e.g. models/shop.ttl';
  if (path.startsWith('/') || path.endsWith('/')) return 'The path is relative to the repository: models/shop.ttl, not /models/shop.ttl';
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..')) return 'The path may not have empty, . or .. segments';
  if (!formatOfPath(path)) {
    return `The file’s extension decides the format: ${MODEL_FORMATS.map((f) => `.${f.extension}`).join(', ')}`;
  }
  return null;
}

/** The problem with a branch name, or `null`. Git's rules, the ones a person meets. */
export function branchProblem(name: string): string | null {
  if (/\s/.test(name)) return 'A branch name has no spaces';
  if (/[~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|^-|\.lock$|\.$/.test(name)) return `“${name}” is not a branch name Git accepts`;
  return null;
}

/** A file-safe slug of a model's name. */
function slug(label: string): string {
  return label.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'model';
}

/**
 * Save the model to Git.
 *
 * @param ask Ask where even when the model is bound (*Save to Git as…*).
 */
export async function saveToGit(ctx: GitSaveContext, ask = false): Promise<CommitResult | undefined> {
  const modelIri = ctx.modelIri();
  if (!modelIri) {
    ctx.report('There is no model to save.', 'warning');
    return undefined;
  }
  const binding = ctx.bindings.get(modelIri);
  const hosts = ctx.config?.hosts;
  if (binding && !ask && hosts && !hosts.some((h) => h.host === binding.host)) {
    // Bound before the deployment listed its hosts: refused before anything is asked or sent.
    ctx.report(`${hostNotAllowed(binding.host, hosts)} Save to Git as… commits elsewhere.`, 'error');
    return undefined;
  }
  const target = binding && !ask ? await boundTarget(ctx, binding) : await askTarget(ctx, binding);
  if (!target) return undefined;

  const token = await tokenFor(ctx, target.link);
  if (token === null) return undefined;
  const provider = ctx.provider(target.link, token);

  try {
    const branch = target.branch || (await provider.defaultBranch());
    const sameFile =
      binding !== undefined &&
      binding.host === target.link.host &&
      binding.repository === target.link.repository &&
      binding.branch === branch &&
      binding.path === target.path;

    let expectedVersion: string | undefined;
    let startFrom: string | undefined;
    if (sameFile) {
      expectedVersion = binding.version;
      startFrom = binding.commit;
    } else {
      // A file the model was never bound to: replace what is there only when told.
      const there = await provider.readFile(branch, target.path);
      if (there) {
        const replace = await ctx.dialogs.confirm(
          'The file is there',
          `${target.path} is already on ${branch} in ${target.link.repository}. Replace it with this model?`,
          { confirmLabel: 'Replace', danger: true },
        );
        if (!replace) return undefined;
        expectedVersion = there.version;
      }
    }

    const change: FileChange = {
      branch,
      ...(target.newBranch ? { newBranch: target.newBranch } : {}),
      ...(target.newBranch && startFrom ? { startFrom } : {}),
      path: target.path,
      text: ctx.serialize(target.format),
      message: target.message,
      ...(expectedVersion ? { expectedVersion } : {}),
    };
    let result: CommitResult | undefined;
    try {
      result = await provider.commitFile(change);
    } catch (err: unknown) {
      if (!(err instanceof GitError) || err.kind !== 'conflict') throw err;
      result = await resolveConflict(ctx, provider, target, change, startFrom);
      if (!result) return undefined;
    }

    ctx.bindings.set(modelIri, {
      host: target.link.host,
      provider: target.link.provider,
      apiBase: target.link.apiBase,
      repository: target.link.repository,
      webUrl: target.link.webUrl,
      branch: result.branch,
      path: target.path,
      version: result.version,
      commit: result.commit,
    });
    ctx.saved(target.path.split('/').pop() ?? target.path);
    ctx.report(`Committed ${result.commit.slice(0, 8)} to ${target.link.repository} · ${result.branch} · ${target.path} — ${result.webUrl}`);
    return result;
  } catch (err: unknown) {
    if (err instanceof GitError && err.kind === 'auth') {
      // A refused token is no use kept: the next save asks for another.
      await ctx.tokens.forget(target.link.host);
      ctx.report(`${err.message} It is forgotten; save again to give another.`, 'error');
      return undefined;
    }
    ctx.report(err instanceof Error ? err.message : String(err), 'error');
    return undefined;
  }
}

/** A bound save: only the message is asked. */
async function boundTarget(ctx: GitSaveContext, binding: GitBinding): Promise<Target | undefined> {
  const format = formatOfPath(binding.path) ?? 'turtle';
  const suggested = commitMessage(gitDefaults(ctx.config, ctx.personal?.()).message, {
    action: 'Update',
    model: ctx.modelLabel(),
    path: binding.path,
    branch: binding.branch,
  });
  const message = await ctx.dialogs.prompt('Save to Git', `Commit message — ${binding.repository} · ${binding.branch} · ${binding.path}`, suggested);
  if (message === null) return undefined;
  // A listed host's API address is the deployment's, now.
  const listed = ctx.config?.hosts?.find((h) => h.host === binding.host);
  return {
    link: {
      host: binding.host,
      provider: listed?.kind ?? binding.provider,
      providerKnown: true,
      apiBase: listed?.api ?? binding.apiBase,
      repository: binding.repository,
      webUrl: binding.webUrl,
    },
    branch: binding.branch,
    path: binding.path,
    format,
    message: message || suggested,
  };
}

/** The Save to Git dialog. */
async function askTarget(ctx: GitSaveContext, binding: GitBinding | undefined): Promise<Target | undefined> {
  const label = ctx.modelLabel();
  const personal = ctx.personal?.() ?? {};
  const defaults = gitDefaults(ctx.config, personal);
  const hosts = ctx.config?.hosts;
  const defaultPath = binding?.path ?? `${defaults.folder ? `${defaults.folder}/` : ''}${slug(label)}.ttl`;
  const defaultBranch = binding?.branch ?? defaults.branch ?? '';
  const suggested = commitMessage(defaults.message, {
    action: binding ? 'Update' : 'Add',
    model: label,
    path: defaultPath,
    branch: defaultBranch,
  });
  const providerOf = (v: FormValues): GitProviderKind | undefined =>
    v['provider'] === 'github' || v['provider'] === 'gitlab' ? v['provider'] : undefined;
  const values = await ctx.dialogs.form(
    'Save to Git',
    [
      {
        name: 'repository',
        label: 'Repository',
        // The model's file; else the user's default; else the last used; else the deployment's.
        value: binding?.webUrl ?? personal.repository ?? ctx.bindings.lastRepository() ?? ctx.config?.defaults.repository ?? '',
        hint: hosts
          ? `Its address, as in the browser. This installation allows ${hosts.map((h) => h.host).join(', ')}.`
          : 'Its address, as in the browser: https://github.com/org/repo, https://gitlab.com/group/repo. A link to a branch or a file fills those in.',
      },
      {
        name: 'provider',
        label: 'Host',
        type: 'select',
        value: binding?.provider ?? 'auto',
        options: [
          { value: 'auto', label: 'Decided by the address (github.com, gitlab.com)' },
          { value: 'github', label: 'GitHub (also GitHub Enterprise Server)' },
          { value: 'gitlab', label: 'GitLab (also self-managed)' },
        ],
      },
      { name: 'branch', label: 'Branch', value: defaultBranch, hint: 'Empty: the repository’s default branch.' },
      {
        name: 'newBranch',
        label: 'New branch',
        value: '',
        hint: 'To commit to a new branch, started from the one above. Empty: commit to that branch.',
      },
      {
        name: 'path',
        label: 'Path',
        value: defaultPath,
        hint: `In the repository; created when it is not there. The extension decides the format: ${MODEL_FORMATS.map((f) => `.${f.extension}`).join(' ')}.`,
      },
      { name: 'message', label: 'Commit message', value: suggested },
    ],
    {
      confirmLabel: 'Commit',
      validate: (v) => {
        let link: RepositoryLink;
        try {
          link = readLink(String(v['repository']), providerOf(v), ctx.config, ctx.hostKinds);
        } catch (err: unknown) {
          return err instanceof Error ? err.message : String(err);
        }
        const path = String(v['path']) === defaultPath && link.path ? link.path : String(v['path']);
        const branch = String(v['branch']);
        const newBranch = String(v['newBranch']);
        return (
          pathProblem(path) ??
          (branch ? branchProblem(branch) : null) ??
          (newBranch ? branchProblem(newBranch) : null) ??
          (newBranch && newBranch === (branch || link.branch) ? 'The new branch needs a name of its own' : null)
        );
      },
    },
  );
  if (!values) return undefined;
  const link = readLink(String(values['repository']), providerOf(values), ctx.config, ctx.hostKinds);
  learnKind(String(values['repository']), providerOf(values), ctx.config, ctx.hostKinds);
  // A link to a branch or a file fills in what the user left as it was.
  const path = String(values['path']) === defaultPath && link.path ? link.path : String(values['path']);
  // A link's branch wins over a branch the dialog only suggested.
  const branchField = String(values['branch']);
  const branch = (branchField === defaultBranch && link.branch) || branchField || link.branch || '';
  const newBranch = String(values['newBranch']);
  return {
    link,
    branch,
    ...(newBranch ? { newBranch } : {}),
    path,
    format: formatOfPath(path) ?? 'turtle',
    message: String(values['message']) || suggested,
  };
}

/**
 * The token for a host: kept, or asked for. `null` when the user cancels.
 *
 * @param purpose What it is for, which decides the access the prompt names:
 *   committing needs write access, opening a private repository read access.
 */
export async function tokenFor(
  ctx: Pick<GitSaveContext, 'tokens' | 'dialogs'>,
  link: RepositoryLink,
  purpose: 'save' | 'open' = 'save',
): Promise<string | null> {
  const kept = await ctx.tokens.get(link.host);
  if (kept) return kept;
  const scope =
    purpose === 'open'
      ? link.provider === 'github'
        ? 'The repository is private, or not there. A fine-grained personal access token with Contents: read on it opens it (read and write saves too).'
        : 'The project is private, or not there. An access token with read_repository opens it (api saves too).'
      : link.provider === 'github'
        ? 'A fine-grained personal access token with Contents: read and write on this repository.'
        : 'A personal, project or group access token with the api scope.';
  const values = await ctx.dialogs.form(
    `Access token for ${link.host}`,
    [
      { name: 'token', label: 'Token', type: 'password', hint: scope },
      ...(ctx.tokens.rememberLabel
        ? [{ name: 'remember', label: ctx.tokens.rememberLabel, type: 'checkbox' as const, value: ctx.tokens.rememberByDefault }]
        : []),
    ],
    {
      message: `la-gram sends it to ${link.host} only, and never writes it into the model or a file.`,
      confirmLabel: 'Use this token',
      validate: (v) => (String(v['token']) ? null : purpose === 'open' ? 'A token is needed to read it.' : 'A token is needed to commit.'),
    },
  );
  if (!values) return null;
  const token = String(values['token']);
  await ctx.tokens.set(link.host, token, values['remember'] === true);
  return token;
}

/** The file moved on: a new branch from where the model was, or overwrite. */
async function resolveConflict(
  ctx: GitSaveContext,
  provider: GitHostProvider,
  target: Target,
  change: FileChange,
  startFrom: string | undefined,
): Promise<CommitResult | undefined> {
  const where = change.newBranch ?? change.branch;
  const choice = await ctx.dialogs.choose(`${target.path} changed in the repository`, [
    {
      value: 'branch',
      label: 'Save to a new branch',
      detail: startFrom
        ? 'Commit this model to a new branch, started from the version you opened or last saved; merge the two in the repository.'
        : `Commit this model to a new branch, started from ${where} as it is now.`,
    },
    {
      value: 'overwrite',
      label: `Overwrite it on ${where}`,
      detail: 'Replace the newer version with this model. What changed there stays in the branch’s history, but not in its latest file.',
    },
    ...(ctx.reopen
      ? [
          {
            value: 'open',
            label: 'Open the newer version',
            detail: 'Replace the model here with the repository’s. What you changed here is lost — save it to a new branch first to keep it.',
          },
        ]
      : []),
  ]);
  if (choice === 'open') {
    await ctx.reopen?.(target.link, where, target.path);
    return undefined;
  }
  if (choice === 'branch') {
    const stamp = (ctx.now?.() ?? new Date()).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const prefix = gitDefaults(ctx.config, ctx.personal?.()).branchPrefix;
    const name = await ctx.dialogs.prompt('Save to a new branch', 'Branch name', `${prefix}${slug(ctx.modelLabel())}-${stamp}`);
    if (!name) return undefined;
    const problem = branchProblem(name);
    if (problem) throw new GitError('invalid', problem);
    if (startFrom) return provider.commitFile({ ...change, newBranch: name, startFrom });
    // Not bound here before: branch from now, replacing what is there.
    const there = await provider.readFile(where, target.path);
    const { expectedVersion: _stale, ...rest } = change;
    return provider.commitFile({ ...rest, newBranch: name, ...(there ? { expectedVersion: there.version } : {}) });
  }
  if (choice === 'overwrite') {
    const sure = await ctx.dialogs.confirm(
      'Overwrite',
      `Replace the newer ${target.path} on ${where} with this model?`,
      { confirmLabel: 'Overwrite', danger: true },
    );
    if (!sure) return undefined;
    const there = await provider.readFile(where, target.path);
    const { newBranch: _new, startFrom: _start, expectedVersion: _stale, ...rest } = change;
    return provider.commitFile({ ...rest, branch: where, ...(there ? { expectedVersion: there.version } : {}) });
  }
  return undefined;
}
