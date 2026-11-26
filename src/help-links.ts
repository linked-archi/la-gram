/**
 * Where la-gram's help is: the links of la-gram's menu, in the toolbar, and of the
 * desktop app's own menu bar. No DOM here — the desktop app's main process
 * reads it too.
 */

/** A page la-gram's menu opens, in the browser (the system's, from the desktop app). */
export interface HelpLink {
  id: string;
  label: string;
  href: string;
  /** The menu's part it is listed in. */
  group: 'guides' | 'la-gram';
  /** A page of la-gram's own documentation, by its path there (`''`, its home page): see {@link helpHref}. */
  docsPage?: string;
}

const DOCS = 'https://meta.linked.archi/docs/';
/** la-gram's own documentation (`docs-site/`), as the release publishes it, in the web app's `docs/`. */
export const LA_GRAM_DOCS = 'https://app.linked.archi/la-gram/docs/';

/**
 * la-gram's documentation as published for a build's channel (`__LA_GRAM_BUILD__.channel`): the release's,
 * {@link LA_GRAM_DOCS}, or a channel's beside its app — the alpha's at `https://app.linked.archi/la-gram-alpha/docs/`.
 */
export function laGramDocs(channel = ''): string {
  return channel ? `https://app.linked.archi/la-gram-${channel}/docs/` : LA_GRAM_DOCS;
}
/** la-gram's source, issues and releases. */
export const REPOSITORY = 'https://github.com/linked-archi/la-gram';

export const HELP_LINKS: readonly HelpLink[] = [
  { id: 'la-gram-docs', label: 'la-gram documentation', href: LA_GRAM_DOCS, docsPage: '', group: 'guides' },
  { id: 'docs', label: 'Linked.Archi documentation', href: DOCS, group: 'guides' },
  { id: 'quick-start', label: 'Quick start', href: `${DOCS}guide/quick-start/`, group: 'guides' },
  { id: 'modelling-guide', label: 'Modelling guide', href: `${DOCS}guide/processes/modeling-guide/`, group: 'guides' },
  {
    id: 'archimate4',
    label: 'ArchiMate 4.0 primer',
    href: `${DOCS}guide/archimate/archimate-4.0-modeling-guide/`,
    group: 'guides',
  },
  {
    id: 'audiences',
    label: 'Names, labels and pictures per audience',
    href: `${DOCS}guide/names-and-labels-per-audience/`,
    group: 'guides',
  },
  { id: 'catalogue', label: 'Metamodel catalogue', href: 'https://meta.linked.archi/', group: 'guides' },
  { id: 'readme', label: 'la-gram: what it does (README)', href: `${REPOSITORY}/blob/main/README.md`, group: 'la-gram' },
  { id: 'source', label: 'Source code', href: REPOSITORY, group: 'la-gram' },
  // GitHub's tracker: anyone may read it; reporting takes a GitHub account.
  { id: 'issues', label: 'Report a problem or an idea', href: `${REPOSITORY}/issues`, group: 'la-gram' },
];

/**
 * A page of la-gram's documentation, always the published one, at app.linked.archi: the release's, or the
 * alpha's from an alpha build ({@link laGramDocs}). Absolute, so that an installation elsewhere — on another
 * host, in the desktop app, on a developer's machine — opens the documentation online, which it need not
 * serve itself.
 */
export function docsHref(page: string, channel = ''): string {
  return laGramDocs(channel) + page;
}

/** Where a link of la-gram's menu opens: a page of its documentation by {@link docsHref}, any other at its address. */
export function helpHref(link: Pick<HelpLink, 'href' | 'docsPage'>, channel = ''): string {
  return link.docsPage === undefined ? link.href : docsHref(link.docsPage, channel);
}

/** Every release: its desktop apps, under their versions, pre-releases too. */
export const RELEASES = `${REPOSITORY}/releases`;

/** The latest release's desktop apps, as the server puts them beside the web app (`ops/pull-deploy/la-gram-pull`). */
export const DOWNLOADS = 'https://app.linked.archi/la-gram/downloads/';

/** A desktop app to download: its platform, and its file in {@link DOWNLOADS}. */
export interface DesktopDownload {
  /** `<platform>-<arch>`, as Electron names them. */
  id: string;
  label: string;
  /** Its name with no version: the next release's replaces it, so a link to it stays. */
  file: string;
}

export const DESKTOP_DOWNLOADS: readonly DesktopDownload[] = [
  { id: 'darwin-arm64', label: 'macOS (Apple silicon)', file: 'la-gram-darwin-arm64.zip' },
  { id: 'darwin-x64', label: 'macOS (Intel)', file: 'la-gram-darwin-x64.zip' },
  { id: 'win32-x64', label: 'Windows (x64)', file: 'la-gram-win32-x64.zip' },
  { id: 'linux-x64', label: 'Linux (x64)', file: 'la-gram-linux-x64.tar.gz' },
  { id: 'linux-arm64', label: 'Linux (arm64)', file: 'la-gram-linux-arm64.tar.gz' },
];

/** The SHA-256 sums of {@link DESKTOP_DOWNLOADS}, as `sha256sum --check` reads them. */
export const DOWNLOAD_SUMS = `${DOWNLOADS}SHA256SUMS.txt`;

/** la-gram's licence, as published by Apache. */
export const LICENCE = { name: 'Apache License 2.0', href: 'https://www.apache.org/licenses/LICENSE-2.0' };

/**
 * The licences of every package bundled with la-gram (Req 15.9): the file each build writes beside its
 * `index.html`. The build names it (`scripts/third-party-licences.mjs`, `LICENCES_FILE`).
 */
export const THIRD_PARTY_LICENCES = 'third-party-licences.txt';

/**
 * Where About links those licences: beside the web app it runs from (`appBase`); from the desktop app, which
 * opens only web pages, in the system's browser, the published web app's — the same packages, as the desktop
 * renderer is the web build.
 */
export function licencesHref(appBase?: string): string {
  return new URL(THIRD_PARTY_LICENCES, appBase || 'https://app.linked.archi/la-gram/').href;
}

/** What la-gram calls itself, under its name. */
export const TAGLINE = 'Semantic Modeller for Enterprise and IT Architecture';
