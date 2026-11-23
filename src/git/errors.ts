/**
 * What went wrong talking to a Git host, in words (Req 18.10).
 *
 * A message is made from the status code and what was asked for — never from
 * the request, whose `Authorization` header carries the token (Req 18.5), and
 * never from the host's own error text, which may quote it back.
 */

/** The kinds of failure the Save and Open flows treat differently. */
export type GitErrorKind =
  | 'auth' // the token was refused: wrong, expired, revoked
  | 'forbidden' // the token cannot do this here
  | 'not-found' // no such repository, branch or file — or the token cannot see it
  | 'conflict' // the file moved on since it was opened or last saved
  | 'exists' // a branch of that name is already there
  | 'rate-limit'
  | 'too-large'
  | 'network' // unreachable, or a cross-origin refusal in the browser
  | 'invalid' // the host refused the request as malformed
  | 'server';

/** A failure talking to a Git host. */
export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    message: string,
    readonly status?: number,
    /** Earliest retry time supplied by the host, in epoch milliseconds. */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/** Whether the page runs in a browser tab, where a host may refuse a cross-origin request. */
let inBrowserTab = true;

/** Say whether la-gram runs as the desktop app (no cross-origin restriction there). */
export function setDesktop(desktop: boolean): void {
  inBrowserTab = !desktop;
}

/** The failure for a `fetch` that did not get a response. */
export function networkError(host: string): GitError {
  return new GitError(
    'network',
    inBrowserTab
      ? `${host} could not be reached, or it refused a request from this page (a cross-origin refusal). The desktop app is not restricted that way.`
      : `${host} could not be reached.`,
  );
}

/**
 * The failure for an unsuccessful response.
 *
 * @param what What was asked for, as the message names it: “the repository
 *   org/repo”, “the branch main”, “models/shop.ttl”.
 * @param hint Words the host sent that say which failure it is (GitLab answers
 *   400 for several); only matched, never shown.
 */
export function responseError(status: number, what: string, options: { rateLimited?: boolean; hint?: string; retryAt?: number } = {}): GitError {
  const hint = (options.hint ?? '').toLowerCase();
  if (status === 401) return new GitError('auth', 'The token was refused: it is wrong, or it has expired.', status);
  if (status === 429 || (status === 403 && options.rateLimited)) {
    return new GitError('rate-limit', 'The host’s rate limit is reached. Try again later.', status, options.retryAt);
  }
  if (status === 403) {
    return new GitError(
      'forbidden',
      `The token may not do this with ${what}. On GitHub it needs Contents: read and write on the repository; on GitLab, the api scope.`,
      status,
    );
  }
  if (status === 404) return new GitError('not-found', `${capitalize(what)} was not found — or the token cannot see it.`, status);
  if (status === 409 || /changed since|has been changed|does not match|sha\W*wasn.t supplied|already exists|not a fast.forward/.test(hint)) {
    if (/branch|reference/.test(hint) && /already exists/.test(hint)) {
      return new GitError('exists', `A branch of that name is already in the repository.`, status);
    }
    return new GitError('conflict', `${capitalize(what)} changed in the repository since it was opened or last saved.`, status);
  }
  if (status === 413 || /too large|too big/.test(hint)) return new GitError('too-large', `${capitalize(what)} is too large for the host.`, status);
  if (status >= 500) return new GitError('server', `The host had a problem (${status}). Try again.`, status, options.retryAt);
  return new GitError('invalid', `The host refused the request for ${what} (${status}).`, status);
}

/** “the branch main” → “The branch main”; a file's path is left as it is. */
function capitalize(text: string): string {
  return text.startsWith('the ') ? `T${text.slice(1)}` : text;
}
