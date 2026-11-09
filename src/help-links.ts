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
const REPOSITORY = 'https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram';

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
  { id: 'download', label: 'Download the desktop app', href: `${REPOSITORY}/-/releases`, group: 'la-gram' },
  { id: 'readme', label: 'la-gram: what it does (README)', href: `${REPOSITORY}/-/blob/main/README.md`, group: 'la-gram' },
  { id: 'source', label: 'Source code', href: REPOSITORY, group: 'la-gram' },
  // GitLab's tracker: anyone may read it; reporting takes a GitLab account.
  { id: 'issues', label: 'Report a problem or an idea', href: `${REPOSITORY}/-/issues`, group: 'la-gram' },
];

/**
 * A page of la-gram's documentation. The web app's own copy, served beside it in `docs/` — `appBase` is
 * the app's address, so the link follows wherever the app is deployed, and its documentation is of the
 * same version. With no `appBase` — the desktop app, whose files are no site — the published one.
 */
export function docsHref(page: string, appBase?: string): string {
  return appBase ? new URL(`docs/${page}`, appBase).href : LA_GRAM_DOCS + page;
}

/** Where a link of la-gram's menu opens: a page of its documentation by {@link docsHref}, any other at its address. */
export function helpHref(link: Pick<HelpLink, 'href' | 'docsPage'>, appBase?: string): string {
  return link.docsPage === undefined ? link.href : docsHref(link.docsPage, appBase);
}

/** la-gram's licence, as published by Apache. */
export const LICENCE = { name: 'Apache License 2.0', href: 'https://www.apache.org/licenses/LICENSE-2.0' };

/** What la-gram calls itself, under its name. */
export const TAGLINE = 'Semantic Modeller for Enterprise and IT Architecture';
