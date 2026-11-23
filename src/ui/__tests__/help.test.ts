import { describe, it, expect } from 'vitest';
import { aboutBlocks, BUILD, downloadBlocks, isMacPlatform, keyCombo, runtimeOf, shortcutBlocks, systemOf, versionText, type AboutContext } from '../help.js';
import { DESKTOP_DOWNLOADS, docsHref, HELP_LINKS, helpHref, LA_GRAM_DOCS, laGramDocs, licencesHref } from '../../help-links.js';

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
    expect(headings).toEqual(['Files', 'On the canvas', 'Views', 'Model tree', 'SPARQL', 'Dialogs and lists']);
    const rows = blocks.flatMap((b) => (b.kind === 'rows' ? b.rows : []));
    expect(rows).toContainEqual(['Ctrl+O', 'Open a model file (File › Open…)']);
    expect(rows).toContainEqual(['Ctrl+S', 'Save the model as TriG (File › Save)']);
    expect(rows).toContainEqual(['Ctrl+Y / Ctrl+Shift+Z', 'Redo']);
    expect(rows).toContainEqual(['F2 / Double-click', 'Rename the selected element or relationship']);
    expect(rows).toContainEqual(['Alt+← / Alt+→', 'The view before, the view after']);
    expect(rows).toContainEqual(['Ctrl+Enter', 'Run the query']);
    expect(rows).toContainEqual(['Ctrl+Alt+V', 'Paste as references: the same elements, placed again']);
    expect(rows).toContainEqual(['Ctrl+D', 'Duplicate the selection, as copies']);
    expect(blocks.every((b) => b.kind !== 'rows' || b.keys)).toBe(true);
    const mac = shortcutBlocks(true).flatMap((b) => (b.kind === 'rows' ? b.rows : []));
    expect(mac).toContainEqual(['⌘Y / ⇧⌘Z', 'Redo']);
  });

  it("end with the documentation's page of them, the published one: the release's, or the alpha's", () => {
    const linkOf = (blocks: ReturnType<typeof shortcutBlocks>) => blocks.at(-1);
    expect(linkOf(shortcutBlocks(false))).toEqual({
      kind: 'links',
      links: [{ label: 'Keyboard and mouse, in the documentation', href: `${LA_GRAM_DOCS}reference/keyboard/` }],
    });
    expect(linkOf(shortcutBlocks(false, 'alpha'))).toMatchObject({
      links: [{ href: 'https://app.linked.archi/la-gram-alpha/docs/reference/keyboard/' }],
    });
  });
});

describe('Download the desktop app', () => {
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
  const LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

  it('knows the system it is asked from, as the apps are named — a Mac, Windows, Linux; not a phone', () => {
    expect([MAC, WINDOWS, LINUX, IPHONE, ''].map(systemOf)).toEqual(['darwin', 'win32', 'linux', undefined, undefined]);
  });

  it("links each platform's app of the latest release on app.linked.archi, this computer's first", () => {
    const links = (blocks: ReturnType<typeof downloadBlocks>) => blocks.flatMap((b) => (b.kind === 'links' ? b.links : []));
    const apps = (blocks: ReturnType<typeof downloadBlocks>) =>
      links(blocks).filter((l) => l.href.startsWith('https://app.linked.archi/la-gram/downloads/la-gram-')).map((l) => l.label);
    expect(apps(downloadBlocks())).toEqual(['macOS (Apple silicon)', 'macOS (Intel)', 'Windows (x64)', 'Linux (x64)', 'Linux (arm64)']);
    expect(apps(downloadBlocks({ system: 'linux' }))).toEqual(['Linux (x64)', 'Linux (arm64)', 'macOS (Apple silicon)', 'macOS (Intel)', 'Windows (x64)']);
    const headings = (blocks: ReturnType<typeof downloadBlocks>) => blocks.filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text);
    expect(headings(downloadBlocks({ system: 'win32' }))).toEqual(['For this computer', 'For the others', 'The first time']);
    expect(headings(downloadBlocks())).toEqual(['The first time']);
    // Each file under its name with no version, which the next release replaces.
    expect(DESKTOP_DOWNLOADS.map((d) => d.file)).toEqual([
      'la-gram-darwin-arm64.zip', 'la-gram-darwin-x64.zip', 'la-gram-win32-x64.zip', 'la-gram-linux-x64.tar.gz', 'la-gram-linux-arm64.tar.gz',
    ]);
    // How to open one, in the published documentation; the checksums; every release.
    const rest = links(downloadBlocks()).slice(5);
    expect(rest).toEqual([
      { label: 'Opening it, in the documentation', href: 'https://app.linked.archi/la-gram/docs/getting-started/desktop/' },
      { label: 'SHA-256 checksums', href: 'https://app.linked.archi/la-gram/downloads/SHA256SUMS.txt' },
      { label: 'Every release, on GitLab', href: 'https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/releases' },
    ]);
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
    // About too: the published documentation, wherever la-gram runs; the alpha's from an alpha build.
    const docsIn = (build: typeof context.build) =>
      aboutBlocks({ ...context, build, appBase: 'https://models.acme.example/tools/la-gram/' }).flatMap((b) => (b.kind === 'links' ? b.links.map((l) => l.href) : []))[0];
    expect(docsIn(context.build)).toBe('https://app.linked.archi/la-gram/docs/');
    expect(docsIn({ ...context.build, channel: 'alpha' })).toBe('https://app.linked.archi/la-gram-alpha/docs/');
  });

  it('links the licences of every bundled package: beside the web app it runs from; from the desktop app, the published web app\'s (Req 15.5, 15.9)', () => {
    const licences = (appBase?: string) =>
      aboutBlocks({ ...context, ...(appBase ? { appBase } : {}) })
        .flatMap((b) => (b.kind === 'links' ? b.links : []))
        .find((l) => l.label === 'Third-party licences')?.href;
    expect(licences('https://models.acme.example/tools/la-gram/index.html')).toBe('https://models.acme.example/tools/la-gram/third-party-licences.txt');
    expect(licences('http://localhost:8080/')).toBe('http://localhost:8080/third-party-licences.txt');
    expect(licences()).toBe('https://app.linked.archi/la-gram/third-party-licences.txt');
    expect(licencesHref()).toBe(licences());
  });

  it("la-gram's documentation is the published one, wherever la-gram runs: the release's, or the alpha's from an alpha build", () => {
    const docs = HELP_LINKS.find((l) => l.id === 'la-gram-docs')!;
    expect(docs.label).toBe('la-gram documentation');
    expect(helpHref(docs)).toBe('https://app.linked.archi/la-gram/docs/');
    expect(helpHref(docs, 'alpha')).toBe('https://app.linked.archi/la-gram-alpha/docs/');
    expect(docsHref('guide/model-tree/')).toBe('https://app.linked.archi/la-gram/docs/guide/model-tree/');
    expect(docsHref('reference/keyboard/', 'alpha')).toBe('https://app.linked.archi/la-gram-alpha/docs/reference/keyboard/');
    expect(laGramDocs()).toBe(LA_GRAM_DOCS);
    // Any other link is where it is, in either.
    const quick = HELP_LINKS.find((l) => l.id === 'quick-start')!;
    expect(helpHref(quick, 'alpha')).toBe(quick.href);
  });
});
