/**
 * Where la-gram's help is: the Help menu's links, in the toolbar and in the
 * desktop app's own menu bar. No DOM here — the desktop app's main process
 * reads it too.
 */

/** A page the Help menu opens, in the browser (the system's, from the desktop app). */
export interface HelpLink {
  id: string;
  label: string;
  href: string;
  /** The menu's part it is listed in. */
  group: 'guides' | 'la-gram';
}

const DOCS = 'https://meta.linked.archi/docs/';
const REPOSITORY = 'https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram';

export const HELP_LINKS: readonly HelpLink[] = [
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
  { id: 'readme', label: 'la-gram: what it does (README)', href: `${REPOSITORY}/-/blob/main/README.md`, group: 'la-gram' },
  { id: 'source', label: 'Source code', href: REPOSITORY, group: 'la-gram' },
  // GitLab's tracker: anyone may read it; reporting takes a GitLab account.
  { id: 'issues', label: 'Report a problem or an idea', href: `${REPOSITORY}/-/issues`, group: 'la-gram' },
];

/** la-gram's licence, as published by Apache. */
export const LICENCE = { name: 'Apache License 2.0', href: 'https://www.apache.org/licenses/LICENSE-2.0' };

/** What la-gram calls itself, under its name. */
export const TAGLINE = 'Semantic Architecture Modeller';
