/**
 * What the Help menu shows in a dialog: About la-gram and the keyboard
 * shortcuts, as {@link DetailBlock}s.
 */

import type { DetailBlock } from './dialogs.js';
import { HELP_LINKS, LICENCE, TAGLINE } from '../help-links.js';

/** An open-source component la-gram is built with, as its package says. */
export interface BuildComponent {
  name: string;
  version: string;
  license: string;
}

/** What the build knows: la-gram's version and what it is built with. */
export interface BuildInfo {
  version: string;
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
}

const versionLabel = (build: BuildInfo) => (build.version ? `Version ${build.version}` : 'Development build');

/** About la-gram: what it is, its version and where it runs, help, its licence, and what it is built with. */
export function aboutBlocks(context: AboutContext): DetailBlock[] {
  const { build } = context;
  const links = (ids: string[]) => HELP_LINKS.filter((link) => ids.includes(link.id)).map(({ label, href }) => ({ label, href }));
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
        'la-gram models architecture in the languages Linked.Archi publishes — ArchiMate and the others in its ' +
        'catalogue — its palette, rules, notation and checks taken from the metamodels themselves, the model kept as RDF.',
    },
    { kind: 'links', links: links(['docs', 'catalogue', 'source', 'issues']) },
    { kind: 'heading', text: 'Licence' },
    {
      kind: 'text',
      text:
        `la-gram is licensed under the ${LICENCE.name}. The metamodels it ships are Linked.Archi's, each under the ` +
        'licence it states — Creative Commons Attribution 4.0 for most.',
    },
    { kind: 'links', links: [{ label: LICENCE.name, href: LICENCE.href }] },
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

/** The keyboard and mouse shortcuts, by where they work. */
export function shortcutBlocks(mac: boolean): DetailBlock[] {
  const keys = (...combos: string[]) => combos.map((c) => keyCombo(c, mac)).join(' / ');
  const section = (text: string, rows: Array<[string, string]>): DetailBlock[] => [
    { kind: 'heading', text },
    { kind: 'rows', keys: true, rows },
  ];
  return [
    ...section('On the canvas', [
      [keys('Mod+Z'), 'Undo'],
      [keys('Mod+Y', 'Mod+Shift+Z'), 'Redo'],
      [keys('F2', 'Double-click'), 'Rename the selected element or relationship'],
      [keys('Delete', 'Backspace'), 'Delete the selection from the view (the model keeps it)'],
      [keys('Shift+Click'), 'Add to the selection, or take from it'],
      [keys('Shift+Drag'), 'Select with a lasso'],
      [keys('Drag'), 'Move around the diagram, from the empty canvas'],
      [keys('Mod+Scroll', 'Mod++', 'Mod+-'), 'Zoom in or out'],
      [keys('Mod+0'), 'Zoom to 100 %'],
      [keys('Shift+Scroll'), 'Scroll sideways'],
      [keys('Esc'), 'Put the format painter down'],
    ]),
    ...section('Views', [[keys('Alt+←', 'Alt+→'), 'The view before, the view after']]),
    ...section('Model tree', [[keys('Mod+Click', 'Shift+Click'), 'Select several']]),
    ...section('SPARQL', [[keys('Mod+Enter'), 'Run the query']]),
    ...section('Dialogs and lists', [
      [keys('Enter'), 'Confirm'],
      [keys('Esc'), 'Cancel'],
      [keys('↑', '↓'), "Move through a list, or the property panel's tabs"],
    ]),
  ];
}
