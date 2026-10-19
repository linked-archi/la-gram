/**
 * A repository link as copied from the browser's address bar, or from "Clone",
 * read into what the hosts' REST APIs need (Req 18.2).
 *
 * ```
 * https://github.com/org/repo                          a repository
 * https://github.com/org/repo/tree/main                a branch
 * https://github.com/org/repo/blob/main/models/a.ttl   a file on a branch
 * https://gitlab.com/group/sub/repo/-/blob/main/a.ttl  GitLab, subgroups and all
 * git@github.com:org/repo.git                          the SSH address, read as the HTTPS one
 * ```
 *
 * The host decides the provider: github.com and gitlab.com, a `/-/` in the path
 * (only GitLab writes one), or "github" / "gitlab" in a self-hosted name. Any
 * other host is taken as a self-managed GitLab unless the caller says otherwise
 * — the Save dialog lets the user say.
 *
 * A branch whose name has a slash (`feature/x`) cannot be told from the folder
 * after it in a file link; the link's first segment is taken as the branch, and
 * the dialog shows both to correct.
 */

/** The hosts la-gram talks to. */
export type GitProviderKind = 'github' | 'gitlab';

/** What a link names. */
export interface RepositoryLink {
  /** Lower-case host, with its port when the link has one: tokens are kept per host. */
  host: string;
  provider: GitProviderKind;
  /** Whether the provider follows from the link, rather than being assumed for an unknown host. */
  providerKnown: boolean;
  /** The REST API: `https://api.github.com`, `https://HOST/api/v3`, `https://HOST/api/v4`. */
  apiBase: string;
  /** `owner/repo` on GitHub; `group/subgroup/repo` on GitLab. */
  repository: string;
  /** The repository's page. */
  webUrl: string;
  /** The branch the link names, if any. */
  branch?: string;
  /** The file (or folder) the link names in the branch, if any. */
  path?: string;
}

const GITHUB = 'github.com';
const GITLAB = 'gitlab.com';

/** The problem with a link, in words, or `null` when it can be read. */
export function repositoryLinkProblem(text: string, provider?: GitProviderKind): string | null {
  try {
    parseRepositoryLink(text, provider);
    return null;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Read a repository link.
 *
 * @param provider The provider, when the user chose one: it wins over the guess
 *   for a self-hosted address (github.com and gitlab.com are what they are).
 * @throws Error with the problem in words.
 */
export function parseRepositoryLink(text: string, provider?: GitProviderKind): RepositoryLink {
  const address = fromSsh(text.trim());
  if (!address) throw new Error('Give the repository’s address, as it is in the browser: https://github.com/org/repo');
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error(`“${text.trim()}” is not an address: give it as https://host/owner/repository`);
  }
  if (url.username || url.password) {
    throw new Error('Take the user name and token out of the address: the token is given separately, and kept apart from it');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('The address must be https:// — a token is not sent over a plain connection');
  }
  const host = url.host.toLowerCase();
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));

  const kind = providerFor(url.hostname.toLowerCase(), segments, provider);
  const origin = `${url.protocol}//${host}`;
  return kind.provider === 'github'
    ? github(host, origin, segments, kind.known)
    : gitlab(host, origin, segments, kind.known);
}

/** `git@host:path` and `ssh://git@host/path` as `https://host/path`. */
function fromSsh(address: string): string {
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(address);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(address);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return address;
}

function providerFor(
  hostname: string,
  segments: string[],
  chosen: GitProviderKind | undefined,
): { provider: GitProviderKind; known: boolean } {
  if (hostname === GITHUB || hostname === 'www.github.com') return { provider: 'github', known: true };
  if (hostname === GITLAB || hostname === 'www.gitlab.com') return { provider: 'gitlab', known: true };
  if (chosen) return { provider: chosen, known: true };
  if (segments.includes('-')) return { provider: 'gitlab', known: true };
  if (/(^|\.)github\./.test(hostname)) return { provider: 'github', known: false };
  return { provider: 'gitlab', known: false };
}

/** A repository segment without the `.git` a clone address ends in. */
function bare(segment: string): string {
  return segment.replace(/\.git$/, '');
}

function github(host: string, origin: string, segments: string[], known: boolean): RepositoryLink {
  if (segments.length < 2) throw new Error('A GitHub address names an owner and a repository: https://github.com/org/repo');
  const repository = `${segments[0]}/${bare(segments[1])}`;
  const rest = segments.slice(2);
  const named = (rest[0] === 'tree' || rest[0] === 'blob') && rest.length >= 2 ? rest : [];
  return {
    host,
    provider: 'github',
    providerKnown: known,
    apiBase: host === GITHUB || host === 'www.github.com' ? 'https://api.github.com' : `${origin}/api/v3`,
    repository,
    webUrl: `${origin}/${repository}`,
    ...(named.length >= 2 ? { branch: named[1] } : {}),
    ...(named.length >= 3 ? { path: named.slice(2).join('/') } : {}),
  };
}

function gitlab(host: string, origin: string, segments: string[], known: boolean): RepositoryLink {
  const dash = segments.indexOf('-');
  const project = (dash >= 0 ? segments.slice(0, dash) : segments).map((s, i, all) => (i === all.length - 1 ? bare(s) : s));
  if (project.length < 2) throw new Error('A GitLab address names a group and a project: https://gitlab.com/group/project');
  const rest = dash >= 0 ? segments.slice(dash + 1) : [];
  const named = (rest[0] === 'tree' || rest[0] === 'blob') && rest.length >= 2 ? rest : [];
  const repository = project.join('/');
  return {
    host,
    provider: 'gitlab',
    providerKnown: known,
    apiBase: `${origin}/api/v4`,
    repository,
    webUrl: `${origin}/${repository}`,
    ...(named.length >= 2 ? { branch: named[1] } : {}),
    ...(named.length >= 3 ? { path: named.slice(2).join('/') } : {}),
  };
}
