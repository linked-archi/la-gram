import { describe, it, expect } from 'vitest';
import { aboutBlocks, BUILD, isMacPlatform, keyCombo, runtimeOf, shortcutBlocks, versionText, type AboutContext } from '../help.js';
import { docsHref, HELP_LINKS, helpHref, LA_GRAM_DOCS } from '../../help-links.js';

const ELECTRON =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) la-gram/0.1.0 Chrome/142.0.7444.59 Electron/44.9.0 Safari/537.36';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/142.0.3595.53`;
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';

describe('where la-gram runs', () => {
  it('the desktop app with its Electron and Chromium, or the browser by name and major version', () => {
    expect(runtimeOf(ELECTRON)).toBe('Desktop app — Electron 44.9.0, Chromium 142');
    expect(runtimeOf(CHROME)).toBe('Web — Chrome 142');
    expect(runtimeOf(EDGE)).toBe('Web — Edge 142');
    expect(runtimeOf(FIREFOX)).toBe('Web — Firefox 144');
    expect(runtimeOf(SAFARI)).toBe('Web — Safari 26');
    expect(runtimeOf('')).toBe('Web browser');
  });

  it('keys as on a Mac on a Mac', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ platform: '', userAgent: FIREFOX })).toBe(true);
  });
});

describe('the keyboard shortcuts', () => {
  it('written with Ctrl and plus signs, or with the Mac symbols in their order', () => {
    expect(keyCombo('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(keyCombo('Mod+Shift+Z', true)).toBe('⇧⌘Z');
    expect(keyCombo('Alt+←', true)).toBe('⌥←');
    expect(keyCombo('Mod++', false)).toBe('Ctrl++');
    expect(keyCombo('Mod+-', true)).toBe('⌘-');
    expect(keyCombo('F2', true)).toBe('F2');
  });

  it('by where they work, each a key and what it does', () => {
    const blocks = shortcutBlocks(false);
    const headings = blocks.filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text);
    expect(headings).toEqual(['On the canvas', 'Views', 'Model tree', 'SPARQL', 'Dialogs and lists']);
    const rows = blocks.flatMap((b) => (b.kind === 'rows' ? b.rows : []));
    expect(rows).toContainEqual(['Ctrl+Y / Ctrl+Shift+Z', 'Redo']);
    expect(rows).toContainEqual(['F2 / Double-click', 'Rename the selected element or relationship']);
    expect(rows).toContainEqual(['Alt+← / Alt+→', 'The view before, the view after']);
    expect(rows).toContainEqual(['Ctrl+Enter', 'Run the query']);
    expect(blocks.every((b) => b.kind !== 'rows' || b.keys)).toBe(true);
    const mac = shortcutBlocks(true).flatMap((b) => (b.kind === 'rows' ? b.rows : []));
    expect(mac).toContainEqual(['⌘Y / ⇧⌘Z', 'Redo']);
  });

  it("end with the documentation's page of them: beside the web app, or the published one", () => {
    const linkOf = (blocks: ReturnType<typeof shortcutBlocks>) => blocks.at(-1);
    expect(linkOf(shortcutBlocks(false, 'https://app.linked.archi/la-gram/index.html?room=x'))).toEqual({
      kind: 'links',
      links: [{ label: 'Keyboard and mouse, in the documentation', href: 'https://app.linked.archi/la-gram/docs/reference/keyboard/' }],
    });
    expect(linkOf(shortcutBlocks(false))).toMatchObject({ links: [{ href: `${LA_GRAM_DOCS}reference/keyboard/` }] });
  });
});

describe('About la-gram', () => {
  const context: AboutContext = {
    build: { version: '0.1.0', components: [{ name: 'diagram-js', version: '14.11.3', license: 'MIT' }] },
    runtime: 'Web — Chrome 142',
    metamodels: ['ArchiMate 4.0 Metamodel'],
    assetsVersion: 'e4882df07d49',
  };

  it('says what it is, its version and where it runs, links to help, its licence and what it is built with', () => {
    const blocks = aboutBlocks(context);
    expect(blocks[0]).toEqual({
      kind: 'header',
      image: 'favicon.svg',
      title: 'la-gram',
      subtitle: 'Semantic Modeller for Enterprise and IT Architecture',
      note: 'Version 0.1.0',
    });
    const rows = blocks.flatMap((b) => (b.kind === 'rows' ? b.rows : []));
    expect(rows).toEqual([
      ['Running as', 'Web — Chrome 142'],
      ['Metamodels', 'ArchiMate 4.0 Metamodel'],
      ['Bundled metamodels', 'snapshot e4882df07d49'],
      ['diagram-js 14.11.3', 'MIT'],
    ]);
    const links = blocks.flatMap((b) => (b.kind === 'links' ? b.links.map((l) => l.href) : []));
    expect(links).toContain('https://meta.linked.archi/docs/');
    expect(links).toContain(LA_GRAM_DOCS);
    expect(links).toContain('https://www.apache.org/licenses/LICENSE-2.0');
    expect(links).toContain('https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/issues');
    expect(versionText(context)).toBe(
      'la-gram 0.1.0 · Web — Chrome 142 · metamodels: ArchiMate 4.0 Metamodel · bundled metamodels: e4882df07d49',
    );
  });

  it('without a build (as under test): a development build, nothing listed as built with', () => {
    expect(BUILD).toEqual({ version: '', components: [] });
    const blocks = aboutBlocks({ build: BUILD, runtime: 'Web browser', metamodels: [] });
    expect(blocks[0]).toMatchObject({ note: 'Development build' });
    expect(blocks.some((b) => b.kind === 'heading' && b.text === 'Built with')).toBe(false);
    expect(blocks.flatMap((b) => (b.kind === 'rows' ? b.rows : []))).toContainEqual(['Metamodels', 'none loaded']);
  });

  it("links to la-gram's documentation, the guides on meta.linked.archi and to la-gram's own pages", () => {
    for (const link of HELP_LINKS) expect(link.href).toMatch(/^https:\/\//);
    expect(HELP_LINKS.filter((l) => l.group === 'guides').map((l) => l.id)).toEqual([
      'la-gram-docs', 'docs', 'quick-start', 'modelling-guide', 'archimate4', 'audiences', 'catalogue',
    ]);
    // About too, beside the web app where it runs in one.
    const about = aboutBlocks({ ...context, appBase: 'https://models.acme.example/tools/la-gram/' });
    expect(about.flatMap((b) => (b.kind === 'links' ? b.links.map((l) => l.href) : []))[0]).toBe('https://models.acme.example/tools/la-gram/docs/');
  });

  it("la-gram's documentation is the copy beside the web app, wherever it is deployed; from the desktop app, the published one", () => {
    const docs = HELP_LINKS.find((l) => l.id === 'la-gram-docs')!;
    expect(docs.label).toBe('la-gram documentation');
    expect(helpHref(docs, 'https://app.linked.archi/la-gram/index.html')).toBe('https://app.linked.archi/la-gram/docs/');
    expect(helpHref(docs, 'http://localhost:8080/')).toBe('http://localhost:8080/docs/');
    expect(helpHref(docs)).toBe('https://app.linked.archi/la-gram/docs/');
    expect(docsHref('guide/model-tree/', 'https://models.acme.example/la-gram/')).toBe('https://models.acme.example/la-gram/docs/guide/model-tree/');
    // Any other link is where it is, in either.
    const quick = HELP_LINKS.find((l) => l.id === 'quick-start')!;
    expect(helpHref(quick, 'https://app.linked.archi/la-gram/')).toBe(quick.href);
  });
});
