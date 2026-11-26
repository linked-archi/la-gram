/**
 * What la-gram's menu shows in a dialog: About la-gram and the keyboard
 * shortcuts, as {@link DetailBlock}s.
 */

import type { DetailBlock } from './dialogs.js';
import { DESKTOP_DOWNLOADS, docsHref, DOWNLOAD_SUMS, DOWNLOADS, HELP_LINKS, helpHref, LICENCE, licencesHref, RELEASES, TAGLINE } from '../help-links.js';

/** An open-source component la-gram is built with, as its package says. */
export interface BuildComponent {
  name: string;
  version: string;
  license: string;
}

/** What the build knows: la-gram's version and what it is built with. */
export interface BuildInfo {
  version: string;
  /** The channel it is built for (`alpha`); none, or `''`, for a release: its documentation is the channel's. */
  channel?: string;
  components: BuildComponent[];
}

/** What the build says (`__LA_GRAM_BUILD__`); under Vitest, which defines none, no version and no components. */
export const BUILD: BuildInfo =
  typeof __LA_GRAM_BUILD__ === 'object' && __LA_GRAM_BUILD__ ? __LA_GRAM_BUILD__ : { version: '', components: [] };

/** Where la-gram runs, from a user agent: the desktop app and its Electron, or the browser. */
export function runtimeOf(userAgent: string): string {
  const version = (re: RegExp) => userAgent.match(re)?.[1];
  const major = (re: RegExp) => version(re)?.split('.')[0];
  const electron = version(/Electron\/([\d.]+)/);
  if (electron) {
    const chromium = major(/Chrome\/([\d.]+)/);
    return `Desktop app — Electron ${electron}${chromium ? `, Chromium ${chromium}` : ''}`;
  }
  const browsers: Array<[string, RegExp]> = [
    ['Edge', /Edg\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Chrome', /Chrome\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari\//],
  ];
  for (const [name, re] of browsers) {
    const v = major(re);
    if (v) return `Web — ${name} ${v}`;
  }
  return 'Web browser';
}

/** What About shows besides the build: where it runs, the metamodels, the bundled assets' snapshot. */
export interface AboutContext {
  build: BuildInfo;
  runtime: string;
  /** The loaded metamodels' names. */
  metamodels: string[];
  /** The bundled assets' snapshot (their digest), when the build says. */
  assetsVersion?: string;
  /** The web app's address, its licences file beside it ({@link licencesHref}); none in the desktop app. */
  appBase?: string;
}

const versionLabel = (build: BuildInfo) => (build.version ? `Version ${build.version}` : 'Development build');

/** About la-gram: what it is, its version and where it runs, help, its licence, and what it is built with. */
export function aboutBlocks(context: AboutContext): DetailBlock[] {
  const { build } = context;
  const links = (ids: string[]) =>
    HELP_LINKS.filter((link) => ids.includes(link.id)).map((link) => ({ label: link.label, href: helpHref(link, build.channel) }));
  return [
    { kind: 'header', image: 'favicon.svg', title: 'la-gram', subtitle: TAGLINE, note: versionLabel(build) },
    {
      kind: 'rows',
      rows: [
        ['Running as', context.runtime],
        ['Metamodels', context.metamodels.join(', ') || 'none loaded'],
        ...(context.assetsVersion ? [['Bundled metamodels', `snapshot ${context.assetsVersion}`] as [string, string]] : []),
      ],
    },
    { kind: 'heading', text: 'Linked.Archi' },
    {
      kind: 'text',
      text:
        'la-gram models architecture in any language whose metamodel follows the Linked.Archi principles: the ' +
        'reference metamodels published at meta.linked.archi — ArchiMate and the others in its catalogue — or your ' +
        'own, loaded from an address or a file. Its palette, rules, notation and checks come from the metamodels ' +
        'themselves, and the model is kept as RDF.',
    },
    { kind: 'links', links: links(['la-gram-docs', 'docs', 'catalogue', 'source', 'issues']) },
    { kind: 'heading', text: 'Licence' },
    {
      kind: 'text',
      text:
        `la-gram is licensed under the ${LICENCE.name}. The metamodels it ships are Linked.Archi's, each under the ` +
        'licence it states — Creative Commons Attribution 4.0 for most. The open-source packages built into it ' +
        'are each under their own licence, listed with their texts in Third-party licences.',
    },
    {
      kind: 'links',
      links: [
        { label: LICENCE.name, href: LICENCE.href },
        { label: 'Third-party licences', href: licencesHref(context.appBase) },
      ],
    },
    ...(build.components.length > 0
      ? ([
          { kind: 'heading', text: 'Built with' },
          { kind: 'rows', rows: build.components.map((c) => [`${c.name} ${c.version}`, c.license]) },
        ] as DetailBlock[])
      : []),
  ];
}

/** One line to paste into a report: version, where it runs, metamodels, snapshot. */
export function versionText(context: AboutContext): string {
  return [
    `la-gram ${context.build.version || '(development build)'}`,
    context.runtime,
    `metamodels: ${context.metamodels.join(', ') || 'none'}`,
    ...(context.assetsVersion ? [`bundled metamodels: ${context.assetsVersion}`] : []),
  ].join(' · ');
}

/** The system a user agent runs on, as the desktop apps are named — or none known (a phone, say). */
export function systemOf(userAgent: string): 'darwin' | 'win32' | 'linux' | undefined {
  if (/iPhone|iPad|Android/.test(userAgent)) return undefined;
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'darwin';
  if (/Windows/.test(userAgent)) return 'win32';
  if (/Linux|X11|CrOS/.test(userAgent)) return 'linux';
  return undefined;
}

/**
 * Download the desktop app: the latest release's, a link for each platform — the system it is asked from
 * first — how to open one, the checksums, and every release. `channel` is the build's, for the documentation
 * ({@link docsHref}).
 */
export function downloadBlocks(options: { system?: 'darwin' | 'win32' | 'linux'; channel?: string } = {}): DetailBlock[] {
  const ours = DESKTOP_DOWNLOADS.filter((d) => options.system && d.id.startsWith(`${options.system}-`));
  const others = DESKTOP_DOWNLOADS.filter((d) => !ours.includes(d));
  const link = (d: (typeof DESKTOP_DOWNLOADS)[number]) => ({ label: d.label, href: DOWNLOADS + d.file });
  return [
    {
      kind: 'text',
      text:
        'The latest release, as an app for your computer: the same la-gram, working offline, with nothing ' +
        'else to install. Unzip it (on Linux, untar it) and open it.',
    },
    ...(ours.length > 0
      ? ([
          { kind: 'heading', text: 'For this computer' },
          { kind: 'links', links: ours.map(link) },
          { kind: 'heading', text: 'For the others' },
        ] as DetailBlock[])
      : []),
    { kind: 'links', links: others.map(link) },
    { kind: 'heading', text: 'The first time' },
    {
      kind: 'text',
      text:
        'The apps are not signed by a developer: the first time, macOS asks you to allow it (System ' +
        'Settings › Privacy & Security › Open Anyway), and Windows to run it (More info › Run anyway).',
    },
    {
      kind: 'links',
      links: [
        { label: 'Opening it, in the documentation', href: docsHref('getting-started/desktop/', options.channel) },
        { label: 'SHA-256 checksums', href: DOWNLOAD_SUMS },
        { label: 'Every release, on GitHub', href: RELEASES },
      ],
    },
  ];
}

/** Whether keys are shown as on a Mac (⌘, ⌥, ⇧). */
export function isMacPlatform(nav: { platform?: string; userAgent?: string } | undefined = globalThis.navigator): boolean {
  return /Mac|iPhone|iPad/.test(nav?.platform || nav?.userAgent || '');
}

const MAC_MODIFIERS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' };
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];

/** A key combination written `Mod+Shift+Z`, as shown: `Ctrl+Shift+Z`, or `⇧⌘Z` on a Mac. */
export function keyCombo(combo: string, mac: boolean): string {
  const parts = combo.split(/\+(?!$)/);
  const key = parts.pop()!;
  const modifiers = parts;
  if (mac) {
    const ordered = [...modifiers].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return ordered.map((m) => MAC_MODIFIERS[m] ?? m).join('') + key;
  }
  return [...modifiers.map((m) => (m === 'Mod' ? 'Ctrl' : m)), key].join('+');
}

/**
 * The keyboard and mouse shortcuts, by where they work, then the documentation's page of them — `channel` the
 * build's ({@link docsHref}).
 */
export function shortcutBlocks(mac: boolean, channel?: string): DetailBlock[] {
  const keys = (...combos: string[]) => combos.map((c) => keyCombo(c, mac)).join(' / ');
  const section = (text: string, rows: Array<[string, string]>): DetailBlock[] => [
    { kind: 'heading', text },
    { kind: 'rows', keys: true, rows },
  ];
  return [
    ...section('Files', [
      [keys('Mod+O'), 'Open a model file (File › Open…)'],
      [keys('Mod+S'), 'Save the model as TriG (File › Save)'],
    ]),
    ...section('On the canvas', [
      [keys('Mod+Z'), 'Undo'],
      [keys('Mod+Y', 'Mod+Shift+Z'), 'Redo'],
      [keys('F2', 'Double-click'), 'Rename the selected element or relationship'],
      [keys('Delete', 'Backspace'), 'Delete the selection from the view (the model keeps it)'],
      [keys('Mod+C'), 'Copy the selection'],
      [keys('Mod+X'), 'Cut the selection: copy it, and delete it from the view'],
      [keys('Mod+V'), 'Paste: the same elements into another view of the model; copies into this view or another model'],
      [keys('Mod+Shift+V'), 'Paste as copies: new elements and relationships'],
      [keys('Mod+Alt+V'), 'Paste as references: the same elements, placed again'],
      [keys('Mod+D'), 'Duplicate the selection, as copies'],
      [keys('Mod+Shift+]', 'Mod+]'), 'Bring the selection to the front, one step forward'],
      [keys('Mod+[', 'Mod+Shift+['), 'Send the selection one step backward, to the back'],
      [keys('Shift+Click'), 'Add to the selection, or take from it'],
      [keys('Shift+Drag'), 'Select with a lasso'],
      [keys('Drag'), 'Move around the diagram, from the empty canvas'],
      [keys('Mod+Scroll', 'Mod++', 'Mod+-'), 'Zoom in or out'],
      [keys('Mod+0'), 'Zoom to 100 %'],
      [keys('Shift+Scroll'), 'Scroll sideways'],
      [keys('Esc'), 'Put the format painter down'],
    ]),
    ...section('Search', [
      [keys('Mod+F'), 'Search the diagram; in the RDF panel, its text; in the model tree, its filter'],
      [keys('Enter', 'Shift+Enter'), 'The next match, the previous'],
      [keys('Esc'), 'Close the search'],
    ]),
    ...section('Views', [[keys('Alt+←', 'Alt+→'), 'The view before, the view after']]),
    ...section('Model tree', [[keys('Mod+Click', 'Shift+Click'), 'Select several']]),
    ...section('SPARQL', [[keys('Mod+Enter'), 'Run the query']]),
    ...section('Dialogs and lists', [
      [keys('Enter'), 'Confirm'],
      [keys('Esc'), 'Cancel'],
      [keys('↑', '↓'), "Move through a list, or the property panel's tabs"],
    ]),
    { kind: 'links', links: [{ label: 'Keyboard and mouse, in the documentation', href: docsHref('reference/keyboard/', channel) }] },
  ];
}
