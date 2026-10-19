/**
 * The deployment's configuration (Req 19.1–19.4): `la-gram.config.json`
 * beside `index.html`, set once by whoever hosts la-gram or packages the
 * desktop app.
 *
 * ```json
 * {
 *   "modules": { "git": "on" },
 *   "git": {
 *     "hosts": [
 *       { "host": "github.com", "kind": "github" },
 *       { "host": "git.acme.example", "kind": "gitlab", "api": "https://git.acme.example/api/v4" }
 *     ],
 *     "rememberTokens": "ask",
 *     "defaults": { "repository": "https://git.acme.example/architecture/models", "folder": "models" }
 *   }
 * }
 * ```
 *
 * Read once at startup, from the app's own origin: no URL parameter names
 * another file, so a link cannot widen what the deployment allows. No file
 * (404, or a server answering with its HTML page instead): no configuration.
 * A file that is there but fails the check is reported, and fails closed — the
 * modules it governs do not start: a deployment that meant to restrict the Git
 * hosts must not get none. Unknown keys are only reported.
 *
 * A configuration never holds a secret: a key named like one (`token`,
 * `password`, `secret`, …) or a value shaped like a GitHub or GitLab token, or
 * an address with credentials in it, fails the check.
 */

/** A module's availability: on by default, off by default, or not offered. */
export type ModuleAvailability = 'on' | 'off' | 'unavailable';

/** A Git host the deployment allows. */
export interface GitHostConfig {
  /** Lower case, with the port when it has one. */
  host: string;
  kind: 'github' | 'gitlab';
  /** The REST API's base; when not given, as a link's would be. */
  api: string;
}

/** Defaults for new saves (Req 18.14–18.15). */
export interface GitDefaults {
  repository?: string;
  branch?: string;
  folder?: string;
  /** The commit message: `{action}` (Add, Update), `{model}`, `{path}`, `{branch}`. */
  message?: string;
  /** What a new branch's suggested name starts with. */
  branchPrefix?: string;
}

/** Git storage, as the deployment configures it. */
export interface GitConfig {
  /** The allow-list; `undefined`: any host. */
  hosts?: GitHostConfig[];
  rememberTokens: 'ask' | 'never';
  defaults: GitDefaults;
}

/** The checked configuration. */
export interface DeploymentConfig {
  modules: Record<string, ModuleAvailability>;
  git: GitConfig;
}

/** What reading the file gave. */
export interface LoadedConfig {
  /** The configuration — la-gram's own defaults when there is no file, or it failed. */
  config: DeploymentConfig;
  /** Whether a file was there. */
  present: boolean;
  /** The file was there and failed the check: what it governs does not start. */
  failed: boolean;
  /** What to tell: the failures, or the keys ignored. */
  problems: string[];
}

/** The file's name, beside `index.html`. */
export const CONFIG_FILE = 'la-gram.config.json';

/** la-gram's own: everything on, any host, tokens remembered when asked. */
export function defaultConfig(): DeploymentConfig {
  return { modules: {}, git: { rememberTokens: 'ask', defaults: {} } };
}

/**
 * Read `la-gram.config.json` from beside the page.
 *
 * @param fetchFn `fetch`, injectable for tests.
 * @param base The page's address (the file is resolved against it).
 */
export async function loadDeploymentConfig(
  fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
  base: string = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/',
): Promise<LoadedConfig> {
  const none: LoadedConfig = { config: defaultConfig(), present: false, failed: false, problems: [] };
  let response: Response;
  try {
    response = await fetchFn(new URL(CONFIG_FILE, base).href, { cache: 'no-store', credentials: 'same-origin' });
  } catch {
    return none; // the app's own origin unreachable: there is nothing else to run either
  }
  if (response.status === 404) return none;
  const text = await response.text().catch(() => '');
  // A server that answers every path with its page (a single-page fallback) has no file.
  if ((response.headers.get('content-type') ?? '').includes('text/html') || /^\s*</.test(text)) return none;
  if (!response.ok) return failed(`${CONFIG_FILE} could not be read (${response.status}).`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err: unknown) {
    return failed(`${CONFIG_FILE} is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return checkConfig(raw);
}

function failed(problem: string): LoadedConfig {
  return { config: defaultConfig(), present: true, failed: true, problems: [problem] };
}

/** Check a parsed configuration (Req 19.4). */
export function checkConfig(raw: unknown): LoadedConfig {
  const fatal: string[] = [];
  const ignored: string[] = [];
  const config = defaultConfig();

  for (const problem of secrets(raw, '')) fatal.push(problem);
  if (!isObject(raw)) {
    return { config, present: true, failed: true, problems: [`${CONFIG_FILE} must be a JSON object.`] };
  }
  for (const key of Object.keys(raw)) if (key !== 'modules' && key !== 'git') ignored.push(key);

  if (raw['modules'] !== undefined) {
    if (!isObject(raw['modules'])) fatal.push('“modules” must be an object: { "git": "on" | "off" | "unavailable" }.');
    else {
      for (const [id, value] of Object.entries(raw['modules'])) {
        if (value === 'on' || value === 'off' || value === 'unavailable') config.modules[id] = value;
        else fatal.push(`modules.${id} must be "on", "off" or "unavailable", not ${JSON.stringify(value)}.`);
      }
    }
  }

  const git = raw['git'];
  if (git !== undefined) {
    if (!isObject(git)) fatal.push('“git” must be an object.');
    else {
      for (const key of Object.keys(git)) if (!['hosts', 'rememberTokens', 'defaults'].includes(key)) ignored.push(`git.${key}`);
      if (git['hosts'] !== undefined) {
        const hosts = checkHosts(git['hosts'], fatal);
        if (hosts) config.git.hosts = hosts;
      }
      if (git['rememberTokens'] !== undefined) {
        if (git['rememberTokens'] === 'ask' || git['rememberTokens'] === 'never') config.git.rememberTokens = git['rememberTokens'];
        else fatal.push(`git.rememberTokens must be "ask" or "never", not ${JSON.stringify(git['rememberTokens'])}.`);
      }
      if (git['defaults'] !== undefined) config.git.defaults = checkDefaults(git['defaults'], fatal, ignored);
    }
  }

  if (fatal.length > 0) {
    return { config: defaultConfig(), present: true, failed: true, problems: fatal.map((p) => `${CONFIG_FILE}: ${p}`) };
  }
  return {
    config,
    present: true,
    failed: false,
    problems: ignored.length > 0 ? [`${CONFIG_FILE}: ignored what la-gram does not know: ${ignored.join(', ')}.`] : [],
  };
}

function checkHosts(value: unknown, fatal: string[]): GitHostConfig[] | undefined {
  if (!Array.isArray(value)) {
    fatal.push('git.hosts must be a list: [{ "host": "github.com", "kind": "github" }, …].');
    return undefined;
  }
  const hosts: GitHostConfig[] = [];
  value.forEach((entry: unknown, i) => {
    const at = `git.hosts[${i}]`;
    if (!isObject(entry)) {
      fatal.push(`${at} must be an object with “host” and “kind”.`);
      return;
    }
    const host = typeof entry['host'] === 'string' ? entry['host'].trim().toLowerCase() : '';
    if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) {
      fatal.push(`${at}.host must be a host name, with a port if it has one (git.acme.example:8443), not ${JSON.stringify(entry['host'])}.`);
      return;
    }
    const kind = entry['kind'];
    if (kind !== 'github' && kind !== 'gitlab') {
      fatal.push(`${at}.kind must be "github" or "gitlab", not ${JSON.stringify(kind)}.`);
      return;
    }
    let api: string;
    if (entry['api'] === undefined) api = defaultApi(host, kind);
    else {
      const given = typeof entry['api'] === 'string' ? entry['api'].replace(/\/+$/, '') : '';
      let url: URL | undefined;
      try {
        url = new URL(given);
      } catch {
        url = undefined;
      }
      if (!url || url.protocol !== 'https:' || url.username || url.password) {
        fatal.push(`${at}.api must be an https:// address, not ${JSON.stringify(entry['api'])}.`);
        return;
      }
      api = given;
    }
    for (const key of Object.keys(entry)) if (!['host', 'kind', 'api'].includes(key)) fatal.push(`${at}.${key} is not a host's setting.`);
    hosts.push({ host, kind, api });
  });
  return hosts;
}

/** The API base a link to a host would give. */
export function defaultApi(host: string, kind: 'github' | 'gitlab'): string {
  if (kind === 'github') return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  return `https://${host}/api/v4`;
}

function checkDefaults(value: unknown, fatal: string[], ignored: string[]): GitDefaults {
  if (!isObject(value)) {
    fatal.push('git.defaults must be an object.');
    return {};
  }
  const defaults: GitDefaults = {};
  for (const [key, v] of Object.entries(value)) {
    if (!['repository', 'branch', 'folder', 'message', 'branchPrefix'].includes(key)) {
      ignored.push(`git.defaults.${key}`);
      continue;
    }
    if (typeof v !== 'string') {
      fatal.push(`git.defaults.${key} must be text.`);
      continue;
    }
    const text = v.trim();
    if (key === 'folder' && (text.startsWith('/') || text.split('/').some((s) => s === '.' || s === '..'))) {
      fatal.push('git.defaults.folder is a folder in the repository, as models or arch/models — not /models, nor with . or ..');
      continue;
    }
    if (key === 'repository' && !/^https:\/\//.test(text)) {
      fatal.push('git.defaults.repository must be the repository’s https:// address.');
      continue;
    }
    (defaults as Record<string, string>)[key] = key === 'folder' ? text.replace(/\/+$/, '') : text;
  }
  return defaults;
}

/** Keys named like a secret — but for la-gram's own, which only name a policy. */
const SECRET_KEY = /token|password|passwd|secret|credential|private.?key|api.?key|^key$/i;
const OWN_KEYS = new Set(['rememberTokens']);
/** Values shaped like a GitHub or GitLab token. */
const SECRET_VALUE = /\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|gl(dt|ptt|rt|cbt)-[A-Za-z0-9_-]{16,})\b/;

/** Everything in the configuration that looks like a secret — a refusal each; `at` is the key path. */
function secrets(value: unknown, at: string): string[] {
  const where = at || 'the file';
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) return [`${where} holds what looks like an access token: tokens are never configured, each user gives their own.`];
    if (/^[a-z][\w+.-]*:\/\/[^/@\s]+@/i.test(value)) return [`${where} is an address with credentials in it: take them out.`];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => secrets(v, `${at}[${i}]`));
  if (isObject(value)) {
    return Object.entries(value).flatMap(([k, v]) => {
      const path = at ? `${at}.${k}` : k;
      return SECRET_KEY.test(k) && !OWN_KEYS.has(k)
        ? [`${path}: tokens and passwords are never configured, each user gives their own.`]
        : secrets(v, path);
    });
  }
  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
