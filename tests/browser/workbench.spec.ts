/**
 * The model/view workbench in a real browser, with real pointer and keyboard
 * input, against the production build — and collaboration between two pages
 * through the real collaboration server.
 *
 * Run with `npm run test:browser:build` (builds `dist/web` first).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Dialog, Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startStaticServer, type StaticServer } from './static-server.js';
import { openSession, waitForAppReady, WEB_DIST, PROJECT_ROOT, type BrowserSession } from './harness.js';

const BUSINESS_ACTOR = 'https://meta.linked.archi/archimate4/onto#BusinessActor';
const PALETTE_ACTOR = `palette-panel .palette-item[data-iri="${BUSINESS_ACTOR}"]`;
const SHAPE = '.djs-container .djs-shape';

let server: StaticServer;
const sessions: BrowserSession[] = [];
const findings: string[] = [];

/** Poll until `fn` returns true. */
async function until(fn: () => Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Model facts, read through the app's own API in the page. */
async function model(page: Page) {
  return page.evaluate(() => {
    const app = (window as unknown as { __LA_GRAM_APP__: any }).__LA_GRAM_APP__;
    const store = app.components.store;
    const views = app.components.viewManager.getViews();
    const rdfType = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    const actors = store
      .getQuads(null, { termType: 'NamedNode', value: rdfType }, { termType: 'NamedNode', value: 'https://meta.linked.archi/archimate4/onto#BusinessActor' })
      .filter((q: any) => q.graph.termType === 'DefaultGraph')
      .map((q: any) => q.subject.value);
    return {
      views: views.map((v: any) => ({ iri: v.iri, label: v.label })) as Array<{ iri: string; label: string }>,
      activeView: app.session.activeViewIri as string,
      actors: actors as string[],
      nodesIn: Object.fromEntries(
        views.map((v: any) => [v.label, app.components.viewManager.getNodes(v.iri).map((n: any) => n.elementIri)]),
      ) as Record<string, string[]>,
    };
  });
}

/** Drag the Business Actor entry from the palette onto the canvas at an offset. */
async function dropActor(page: Page, dx: number, dy: number): Promise<void> {
  const entry = await page.locator(PALETTE_ACTOR).boundingBox();
  const host = await page.locator('.la-diagram-host').boundingBox();
  await page.mouse.move(entry!.x + entry!.width / 2, entry!.y + entry!.height / 2);
  await page.mouse.down();
  await page.mouse.move(host!.x + dx - 40, host!.y + dy, { steps: 8 });
  await page.mouse.move(host!.x + dx, host!.y + dy, { steps: 8 });
  await page.mouse.up();
  // diagram-js swallows the first click within 400 ms of a drag ending (its
  // ClickTrap, so the drop's own mouse-up is no click); a test clicking sooner
  // — as it can now the drop is quick — would lose its click.
  await page.waitForTimeout(450);
}

type XY = { x: number; y: number };

/**
 * The Graph tab's drawing, read through the panel in the page: where each element
 * is (model units, and rendered pixels inside the `.cy` box), the layout's state
 * (`data-layout`), the box's size, the stats line and the panel's selection.
 */
async function graphTab(page: Page) {
  return page.evaluate(() => {
    const panel = (window as any).__LA_GRAM_UI__.graphPanel;
    const cy = panel.shadowRoot.querySelector('.cy') as HTMLElement;
    return {
      layout: cy.dataset.layout as string,
      model: Object.fromEntries(panel.drawnPositions('model')) as Record<string, { x: number; y: number }>,
      rendered: Object.fromEntries(panel.drawnPositions('rendered')) as Record<string, { x: number; y: number }>,
      width: cy.clientWidth,
      height: cy.clientHeight,
      stats: (panel.shadowRoot.querySelector('.stats') as HTMLElement).innerText.trim(),
      root: (panel.shadowRoot.querySelector('.root') as HTMLElement).innerText.trim(),
      selected: panel.selectedIri as string,
    };
  });
}
type GraphTab = Awaited<ReturnType<typeof graphTab>>;

const apartBy = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
/** Every element's rendered centre inside the drawing: framed. */
const framed = (g: GraphTab) => Object.values(g.rendered).every((p) => p.x >= 0 && p.y >= 0 && p.x <= g.width && p.y <= g.height);
/** Rendered over model distance between two elements drawn at every depth. */
const zoomOf = (g: GraphTab, a: string, b: string) => apartBy(g.rendered[a]!, g.rendered[b]!) / apartBy(g.model[a]!, g.model[b]!);

/** Answer the open prompt dialog. */
async function answerPrompt(page: Page, text: string): Promise<void> {
  const input = page.locator('.la-dialog input.la-input');
  await input.waitFor({ state: 'visible' });
  await input.fill(text);
  await page.locator('.la-dialog .la-button.primary').click();
}

async function openPage(query = ''): Promise<{ session: BrowserSession; page: Page }> {
  const session = await openSession();
  sessions.push(session);
  await session.page.goto(`${server.baseUrl}/index.html${query}`, { waitUntil: 'load' });
  await waitForAppReady(session.page);
  return { session, page: session.page };
}

beforeAll(async () => {
  server = await startStaticServer(WEB_DIST);
}, 60_000);

afterAll(async () => {
  for (const s of sessions) await s.close();
  if (server) await server.close();
  // eslint-disable-next-line no-console
  console.log('\n── workbench findings ──\n' + findings.join('\n') + '\n');
}, 60_000);

describe('views: one model, many views', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  it('starts with a model and a default view, shown in the toolbar and the tree', async () => {
    const m = await model(page);
    expect(m.views.map((v) => v.label)).toEqual(['Default View']);
    await expect(page.locator('app-toolbar select[aria-label="Open view"]').inputValue()).resolves.toBe(m.activeView);
    expect(await page.locator('model-explorer .row[data-kind="model"]').count()).toBe(1);
  });

  it('a palette drop creates the element in the model and a node in the open view', async () => {
    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const m = await model(page);
    expect(m.nodesIn['Default View']).toEqual(m.actors);
    // It is in the tree, marked as placed in the open view.
    const row = page.locator(`model-explorer .row[data-iri="${m.actors[0]}"]`);
    await row.waitFor({ state: 'attached' });
    expect(await row.locator('.placed').count()).toBe(1);
  });

  it('a new view from the toolbar opens empty; dragging from the tree places the same element', async () => {
    await page.locator('app-toolbar button[data-menu="new-view"]').click();
    await page.locator('app-toolbar button[data-command="new-view"][data-value="Diagram"]').click();
    await answerPrompt(page, 'Context');
    // Then the viewpoint chooser, with "— none —" preselected.
    await page.locator('.la-dialog .la-choice-list').waitFor({ state: 'visible' });
    await page.locator('.la-dialog .la-button.primary').click();
    await until(async () => (await model(page)).views.length === 2, 'the second view');
    expect(await page.locator(SHAPE).count()).toBe(0);

    const m = await model(page);
    const row = await page.locator(`model-explorer .row[data-iri="${m.actors[0]}"]`).boundingBox();
    const host = await page.locator('.la-diagram-host').boundingBox();
    await page.mouse.move(row!.x + 40, row!.y + row!.height / 2);
    await page.mouse.down();
    await page.mouse.move(row!.x + 60, row!.y + row!.height / 2, { steps: 4 });
    await page.mouse.move(host!.x + 250, host!.y + 150, { steps: 12 });
    await page.mouse.up();

    await until(async () => ((await model(page)).nodesIn['Context'] ?? []).length === 1, 'the placement');
    const after = await model(page);
    expect(after.nodesIn['Context']).toEqual(after.actors);
    expect(after.actors).toHaveLength(1); // one element, two views
  });

  it('Delete removes it from this view only; the other view and the model keep it', async () => {
    await page.locator(SHAPE).first().click();
    await page.keyboard.press('Delete');
    await until(async () => ((await model(page)).nodesIn['Context'] ?? []).length === 0, 'removal from the view');
    const m = await model(page);
    expect(m.actors).toHaveLength(1);
    expect(m.nodesIn['Default View']).toEqual(m.actors);

    // Undo brings the placement back.
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => ((await model(page)).nodesIn['Context'] ?? []).length === 1, 'undo');
  });

  it('"Delete from model" asks, names the views, and removes it everywhere', async () => {
    await page.locator(SHAPE).first().click();
    await page.locator('.djs-context-pad .context-pad-delete-model').click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible' });
    const text = await dialog.innerText();
    expect(text).toContain('Default View');
    expect(text).toContain('Context');
    await session.screenshot('workbench-delete-from-model-dialog');
    await dialog.locator('.la-button.primary').click();
    await until(async () => (await model(page)).actors.length === 0, 'model deletion');
    const m = await model(page);
    expect(Object.values(m.nodesIn).flat()).toEqual([]);
    findings.push('delete from view / from model / undo: ok');
  });

  it('saves a TriG file with the model only', async () => {
    await dropActor(page, 200, 120);
    await until(async () => (await model(page)).actors.length === 1, 'a new actor');
    const download = page.waitForEvent('download');
    await page.locator('app-toolbar button[data-menu="file"]').click();
    await page.locator('app-toolbar button[data-command="save"]').click();
    const file = await download;
    const text = await readFile((await file.path())!, 'utf8');
    expect(file.suggestedFilename()).toMatch(/\.trig$/);
    // In its graphs: the geometry in the views graph (`{p}g:views`).
    expect(text).toMatch(/g:views \{/);
    expect(text).toContain('arch-vis:ArchNode');
    expect(text).toContain('arch:inView');
    expect(text).not.toContain('owl:Ontology');
    // The edit recorded (Req 9.16): the actor generated by an editing activity of this la-gram, in its own graph.
    const version = JSON.parse(await readFile('package.json', 'utf8')).version as string;
    const provenance = text.slice(text.indexOf('g:provenance {'));
    expect(provenance).toContain(`<https://app.linked.archi/la-gram/v${version}> a prov:SoftwareAgent, schema:SoftwareApplication`);
    expect(provenance).toMatch(/prov:wasGeneratedBy m?p:edit-[0-9a-f-]{36}/);
    expect(text).toMatch(/dcterms:created "[^"]+"\^\^xsd:dateTime/);
    findings.push(`saved ${file.suggestedFilename()} (${text.length} bytes)`);
    await session.screenshot('workbench-views');
  });
});

describe("the name, the icon and la-gram's menu", () => {
  it("shows the icon by the name, and the title by the model; About and the shortcuts from the name's menu", async () => {
    const { page, session } = await openPage();
    const bar = page.locator('app-toolbar');
    // The icon loads, beside the name, on one line.
    const brand = bar.locator('button.brand');
    await expect(brand.innerText().then((t) => t.replace(/\s+/g, ''))).resolves.toBe('la-gram▾');
    expect(await bar.locator('button[data-menu="help"]').count()).toBe(0);
    const icon = await brand.locator('img').evaluate((img: HTMLImageElement) => [img.complete, img.naturalWidth > 0, img.getBoundingClientRect().height]);
    expect(icon).toEqual([true, true, 20]);
    expect((await brand.boundingBox())!.height).toBeLessThan(32);
    expect(await page.title()).toBe('Untitled model — la-gram');
    // The favicons the page names are served.
    for (const href of await page.locator('link[rel="icon"]').evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href))) {
      expect((await page.request.get(href)).status()).toBe(200);
    }

    // About, from the name's menu: what it is, its version, its licence, what it is built with.
    await brand.click();
    await bar.locator('.dropdown [data-command="about"]').click();
    const dialog = page.locator('.la-dialog.la-dialog-details');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('.la-details-title').innerText()).toBe('la-gram');
    expect(await dialog.locator('.la-details-note').innerText()).toMatch(/^Version \d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(await dialog.locator('.la-details-header img').evaluate((img: HTMLImageElement) => img.naturalWidth > 0)).toBe(true);
    const text = await dialog.innerText();
    expect(text).toContain('Apache License 2.0');
    expect(text).toMatch(/diagram-js \d/);
    expect(text).toMatch(/d3-force 3\.0\.1/);
    expect(text).toContain('ArchiMate 4.0 Metamodel');
    await session.screenshot('help-about');
    await dialog.locator('.la-button.primary').click();
    await dialog.waitFor({ state: 'hidden' });

    // The same menu: the guides opening in another tab, the shortcuts.
    await brand.click();
    const links = bar.locator('.dropdown a[data-link]');
    expect(await links.count()).toBeGreaterThan(5);
    expect(await links.evaluateAll((as) => as.every((a) => (a as HTMLAnchorElement).target === '_blank'))).toBe(true);
    // la-gram's documentation first, the copy beside the app.
    expect(await links.first().getAttribute('data-link')).toBe('la-gram-docs');
    expect(await links.first().evaluate((a) => (a as HTMLAnchorElement).href)).toBe(`${server.baseUrl}/docs/`);
    await bar.locator('.dropdown [data-command="shortcuts"]').click();
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('.la-dialog-title').innerText()).toBe('Keyboard shortcuts');
    expect(await dialog.locator('kbd').count()).toBeGreaterThan(10);
    expect(await dialog.locator('.la-details-links a').getAttribute('href')).toBe(`${server.baseUrl}/docs/reference/keyboard/`);
    await session.screenshot('help-shortcuts');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    // Download the desktop app: a link for each platform's, on app.linked.archi.
    await brand.click();
    await bar.locator('.dropdown [data-command="download"]').click();
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('.la-dialog-title').innerText()).toBe('Download the desktop app');
    const apps = dialog.locator('.la-details-links a[href^="https://app.linked.archi/la-gram/downloads/la-gram-"]');
    expect(await apps.count()).toBe(5);
    expect(await apps.evaluateAll((as) => as.every((a) => (a as HTMLAnchorElement).target === '_blank'))).toBe(true);
    await session.screenshot('help-download');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    findings.push("icon by the name, title by the model, the name's menu: About (version, licence, built with), the shortcuts, the guides: ok");
  }, 90_000);
});

describe('the RDF panel', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  it('is hidden by default, and the toolbar toggle shows the model as Turtle', async () => {
    const panel = page.locator('rdf-panel');
    expect(await panel.isVisible()).toBe(false);
    const toggle = page.locator('app-toolbar button[data-command="toggle-rdf"]');
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');

    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    await toggle.click();
    await panel.waitFor({ state: 'visible' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    const code = panel.locator('.code');
    // The open view, by default: its shapes are there.
    expect(await panel.locator('select.scope').inputValue()).toBe('view');
    await until(async () => (await code.innerText()).includes('arch-vis:ArchNode'), 'the Turtle text');
    expect(await code.innerText()).toContain('@prefix am4:');
    const box = await panel.boundingBox();
    expect(box!.width).toBeGreaterThan(250); // a real column, not a sliver

    // Renaming on the canvas side shows up in the Turtle.
    const [actor] = (await model(page)).actors;
    await page.evaluate((iri) => {
      (window as any).__LA_GRAM_APP__.components.eventBus.emit('property-edited', {
        elementIri: iri,
        property: 'http://www.w3.org/2004/02/skos/core#prefLabel',
        value: 'Renamed in the model',
      });
    }, actor);
    await until(async () => (await code.innerText()).includes('Renamed in the model'), 'the refreshed Turtle');

    // Clicking the element's statements selects it on the canvas.
    await panel.locator(`.rdf-block[data-subject="${actor}"]`).first().click();
    await until(
      () =>
        page.evaluate(
          (iri) =>
            ((window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram().get('selection').get() as any[]).some(
              (e) => e.id === iri,
            ),
          actor,
        ),
      'the canvas selection',
    );
    expect(await panel.locator('.rdf-block.selected').count()).toBeGreaterThan(0);
    await session.screenshot('workbench-rdf-panel');

    // ⤢ lays the panel over the whole workspace; Esc puts it back.
    const narrow = (await panel.boundingBox())!.width;
    await panel.locator('button.maximize').click();
    await until(async () => (await panel.boundingBox())!.width > narrow * 2, 'the maximized panel');
    expect(await panel.locator('button.maximize').getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press('Escape');
    await until(async () => Math.abs((await panel.boundingBox())!.width - narrow) < 2, 'the restored panel');

    await panel.locator('button.close').click();
    await panel.waitFor({ state: 'hidden' });
    findings.push('RDF panel: hidden by default, toggle, live refresh, block → selection: ok');
  });

  it('writes the model by its prefixes, one per kind (DD-41); Model settings moves it into another namespace', async () => {
    const panel = page.locator('rdf-panel');
    await page.locator('app-toolbar button[data-command="toggle-rdf"]').click();
    await panel.waitFor({ state: 'visible' });
    const code = panel.locator('.code');
    // The whole model, as Save writes it.
    await panel.locator('select.scope').selectOption('model');
    await until(async () => /^m:model a arch:Model;/m.test(await code.innerText()), 'm:model in the Turtle');
    expect(await code.innerText()).toMatch(/@prefix m: <https:\/\/example\.org\/archimate\/[0-9a-f-]{36}\/>\./);
    expect(await code.innerText()).toMatch(/^me:[0-9a-f-]{36} a am4:BusinessActor;/m);

    // The model name opens Model settings: name, namespace, prefix, and whether to move.
    await page.locator('app-toolbar button.model-name').click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor();
    expect(await dialog.locator('#la-form-rename').isChecked()).toBe(true);
    await dialog.locator('#la-form-prefix').fill('skos');
    await dialog.locator('button.primary').click();
    // A prefix that already stands for another namespace is refused in place.
    await until(async () => (await dialog.locator('.la-dialog-error').innerText()).includes('already stands for'), 'the error');
    await session.screenshot('workbench-model-settings');
    await dialog.locator('#la-form-namespace').fill('https://acme.com/ea/crm/');
    await dialog.locator('#la-form-prefix').fill('crm');
    await dialog.locator('button.primary').click();
    await dialog.waitFor({ state: 'detached' });

    await until(async () => (await code.innerText()).includes('@prefix crm: <https://acme.com/ea/crm/>.'), 'the new prefix');
    const text = await code.innerText();
    expect(text).toMatch(/^crm:model a arch:Model;/m);
    expect(text).toMatch(/^crme:[0-9a-f-]{36} a am4:BusinessActor;/m);
    expect(text).not.toContain('example.org');
    // The same view is open, under its new IRI, with its shape.
    const state = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      return { view: app.session.activeViewIri as string, nodes: app.components.viewManager.getNodes(app.session.activeViewIri).length };
    });
    expect(state.view).toMatch(/^https:\/\/acme\.com\/ea\/crm\/view\//);
    expect(state.nodes).toBe(1);
    expect((await model(page)).actors).toHaveLength(1);
    await session.screenshot('workbench-model-namespace');
    await panel.locator('select.scope').selectOption('view');
    findings.push('Model settings: namespace + prefix, IRIs moved, CURIEs in Turtle: ok');
  });
});

describe('the layout and the property panel', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  const boxOf = async (selector: string) => (await page.locator(selector).first().boundingBox())!;

  /** Drag a resize handle by (dx, dy). */
  async function drag(selector: string, dx: number, dy: number): Promise<void> {
    const handle = await boxOf(selector);
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
  }

  it('lays out the tree left, the palette right, and Properties / Validation / SPARQL tabs under the canvas', async () => {
    await page.locator('property-panel').waitFor({ state: 'visible' });
    const tree = await boxOf('model-explorer');
    const canvas = await boxOf('.la-diagram-host');
    const palette = await boxOf('palette-panel');
    const tabs = await boxOf('app-shell .tabs');
    expect(tree.x + tree.width).toBeLessThanOrEqual(canvas.x + 1);
    expect(palette.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
    expect(tabs.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    // The left column runs the full height: the tree, and the type guide under it.
    const column = await boxOf('app-shell .panel-explorer');
    expect(column.height).toBeGreaterThan(canvas.height);
    const guide = await boxOf('type-guide-panel');
    expect(guide.y).toBeGreaterThanOrEqual(tree.y + tree.height - 1);
    expect(guide.y + guide.height).toBeGreaterThan(column.y + column.height - 2);
    expect(await page.locator('app-shell .tab').allInnerTexts()).toEqual([
      expect.stringMatching(/^Properties/),
      expect.stringMatching(/^Validation/),
      expect.stringMatching(/^SPARQL Query/),
      expect.stringMatching(/^Graph/),
      expect.stringMatching(/^History/),
    ]);

    // Validation: its own tab. The new model's view has no viewpoint — a Warning, listed, not counted.
    await page.locator('app-shell .tab[data-tab="validation"]').click();
    await page.locator('validation-panel').waitFor({ state: 'visible' });
    expect(await page.locator('property-panel').isVisible()).toBe(false);
    await until(async () => /warning/i.test(await page.locator('validation-panel .summary').innerText()), 'the viewpoint warning');
    const badge = page.locator('app-shell .tab[data-tab="validation"] .badge');
    expect(await badge.count()).toBe(0);
    // A Violation (an element without a name) is counted on the tab, and the count goes when it is fixed.
    // Not drawn in the open view, it is one more in the model — counted when the tab shows the model.
    const unnamed = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      return app.components.elementManager.createElement(
        'https://meta.linked.archi/archimate4/onto#BusinessActor',
        app.session.modelIri,
      ).value as string;
    });
    await page.evaluate(() => (window as any).__LA_GRAM_APP__.scheduleValidation());
    // Its missing name, and — a SPARQL-based principle, run in the worker with Oxigraph, as Info — that it relates to nothing.
    await until(async () => /2 more in the model/.test(await page.locator('validation-panel .summary').innerText()), 'the findings elsewhere');
    expect(await badge.count()).toBe(0);
    const scope = page.locator('validation-panel select.scope');
    await scope.selectOption('model');
    await until(async () => (await badge.count()) === 1 && (await badge.innerText()) === '1', 'the violation count');
    expect(await page.locator('validation-panel .summary').innerText()).toMatch(/1 violation/);
    await scope.selectOption('view');
    await until(async () => (await badge.count()) === 0, 'the view’s count');
    await page.evaluate((iri) => {
      const app = (window as any).__LA_GRAM_APP__;
      app.components.elementManager.deleteElement(iri);
      app.scheduleValidation();
    }, unnamed);
    await until(async () => (await badge.count()) === 0, 'the count cleared');
    await page.locator('app-shell .tab[data-tab="sparql"]').click();
    await page.locator('sparql-editor').waitFor({ state: 'visible' });

    // The open tab folds the panel to its tabs; the canvas takes the room.
    await page.locator('app-shell .tab[data-tab="sparql"]').click();
    await page.locator('sparql-editor').waitFor({ state: 'hidden' });
    await until(async () => (await boxOf('.la-diagram-host')).height > canvas.height + 150, 'the taller canvas');
    await page.locator('app-shell .tab[data-tab="properties"]').click();
    await page.locator('property-panel').waitFor({ state: 'visible' });

    // The bottom panel grows by its top edge, the palette by its left edge; both remembered.
    const bottomBefore = (await boxOf('app-shell .panel-bottom')).height;
    await drag('app-shell .panel-bottom .resizer', 0, -100);
    const bottomAfter = (await boxOf('app-shell .panel-bottom')).height;
    expect(bottomAfter).toBeGreaterThan(bottomBefore + 80);
    const paletteBefore = (await boxOf('app-shell .panel-palette')).width;
    await drag('app-shell .panel-palette .resizer', -80, 0);
    const paletteAfter = (await boxOf('app-shell .panel-palette')).width;
    expect(paletteAfter).toBeGreaterThan(paletteBefore + 60);
    // The tree grows by its right edge.
    const treeBefore = (await boxOf('app-shell .panel-explorer')).width;
    await drag('app-shell .panel-explorer .resizer', 80, 0);
    const treeAfter = (await boxOf('app-shell .panel-explorer')).width;
    expect(treeAfter).toBeGreaterThan(treeBefore + 60);
    const remembered = await page.evaluate(() => [
      Number(localStorage.getItem('la-gram:bottom-panel-height')),
      Number(localStorage.getItem('la-gram:palette-panel-width')),
      Number(localStorage.getItem('la-gram:explorer-panel-width')),
    ]);
    expect(Math.abs(remembered[0] - bottomAfter)).toBeLessThanOrEqual(2);
    expect(Math.abs(remembered[1] - paletteAfter)).toBeLessThanOrEqual(2);
    expect(Math.abs(remembered[2] - treeAfter)).toBeLessThanOrEqual(2);
    await session.screenshot('workbench-layout');

    // The palette hides from the toolbar.
    const toggle = page.locator('app-toolbar button[data-command="toggle-palette"]');
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    await toggle.click();
    await page.locator('palette-panel').waitFor({ state: 'hidden' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await toggle.click();
    await page.locator('palette-panel').waitFor({ state: 'visible' });
    // So does the tree, and the canvas takes its room.
    const treeToggle = page.locator('app-toolbar button[data-command="toggle-explorer"]');
    const canvasWidth = (await boxOf('.la-diagram-host')).width;
    await treeToggle.click();
    await page.locator('model-explorer').waitFor({ state: 'hidden' });
    await until(async () => (await boxOf('.la-diagram-host')).width > canvasWidth + 150, 'the wider canvas');
    await treeToggle.click();
    await page.locator('model-explorer').waitFor({ state: 'visible' });

    // Leave the defaults for whatever runs next in this browser.
    await page.evaluate(() => {
      for (const key of ['bottom-panel-height', 'palette-panel-width', 'explorer-panel-width', 'bottom-panel-tab', 'bottom-panel-folded', 'guide-height', 'guide-folded']) {
        localStorage.removeItem(`la-gram:${key}`);
      }
    });
    await page.reload();
    await page.locator('palette-panel .palette-item').first().waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as any).__LA_GRAM_APP__), undefined, { timeout: 30_000 });
    findings.push(
      `layout: tree | canvas + tabs | palette; bottom ${Math.round(bottomBefore)} → ${Math.round(bottomAfter)}px, palette ${Math.round(paletteBefore)} → ${Math.round(paletteAfter)}px, tree ${Math.round(treeBefore)} → ${Math.round(treeAfter)}px; tree and palette hide: ok`,
    );
  });

  it('shows the element in vertical tabs: information, properties (added here), analysis, views', async () => {
    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const [actor] = (await model(page)).actors;
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.selectConcept(iri), actor);
    const panel = page.locator('property-panel');
    const openTab = (id: string) => panel.locator(`.vtab[data-tab="${id}"]`).click();
    const labels = async () =>
      (await panel.locator('.pane li.property-row .property-label').allInnerTexts()).map((t) => t.trim().split(/\s/)[0]);

    // Vertical tabs on the left, with counts; the information tab: ID, type, model, name, definition.
    await openTab('info');
    await until(async () => (await labels()).includes('Name'), 'the element’s fields');
    expect((await panel.locator('.vtab .vtab-name').allInnerTexts()).map((t) => t.trim())).toEqual([
      'Element information',
      'Properties',
      'Analysis',
      'Appears in views',
    ]);
    // Its name and its picture for each audience (the metamodel's presentation contexts), then when it was last
    // changed, by whom and with which la-gram — read-only (Req 9.16) — by their first words.
    expect(await labels()).toEqual(['ID', 'Type', 'Model', 'Name', 'Definition', 'Names', 'Pictures', 'Last']);
    const changed = panel.locator('.pane [data-provenance="changed"]');
    expect(await changed.innerText()).toMatch(/^\d{1,2} \w{3} \d{4}, \d\d:\d\d · with la-gram \d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(await panel.locator('.pane li.provenance-row input, .pane li.provenance-row textarea').count()).toBe(0);
    // Named, not by IRI: the model by its name, the ID by its short identifier; a click shows the IRIs.
    const modelRow = panel.locator('.pane li.property-row', { has: page.locator('.field-name', { hasText: 'Model' }) });
    expect(await modelRow.locator('.named').innerText()).not.toMatch(/^https?:/);
    await modelRow.locator('.named').click();
    expect(await modelRow.locator('.iris dd').allInnerTexts()).toEqual([
      'https://meta.linked.archi/core#inModel',
      await page.evaluate(() => (window as any).__LA_GRAM_APP__.session.modelIri as string),
    ]);
    await modelRow.locator('.field-name').click();
    expect(await modelRow.locator('.iris').count()).toBe(0);

    // Under the model tree, in the left panel: what the ontology and the taxonomy say about the type.
    const guide = page.locator('type-guide-panel');
    await until(async () => (await guide.locator('.header .title').innerText()) === 'About Business Actor', 'the guide');
    const tree = (await page.locator('model-explorer').boundingBox())!;
    const guideBox = (await guide.boundingBox())!;
    expect(guideBox.y).toBeGreaterThanOrEqual(tree.y + tree.height - 1); // under the tree
    expect(Math.abs(guideBox.x - tree.x)).toBeLessThanOrEqual(1); // in the same column
    expect(await guide.locator('.definition').innerText()).toBe(
      'A business actor represents a business entity that is capable of performing behavior.',
    );
    expect(await guide.locator('details[data-section="guidance"] p').count()).toBe(4);
    expect(await guide.locator('details[data-section="classification"]').innerText()).toMatch(/Business Domain/);
    await session.screenshot('workbench-type-guide');
    // A type in the same group opens its own page; ← comes back.
    await guide.locator('.members a', { hasText: 'Business Interface' }).first().click();
    await until(async () => /Business Interface/.test(await guide.locator('.type').innerText()), 'the Business Interface page');
    await guide.locator('.back a').click();
    await until(async () => /Business Actor/.test(await guide.locator('.type').innerText()), 'back to Business Actor');
    // Picking a type in the palette shows that type — before anything is created;
    // Esc drops the create gesture, and nothing is added.
    const before = (await model(page)).actors.length;
    await page.locator('palette-panel .palette-item[data-iri$="#BusinessInterface"]').click();
    await until(async () => (await guide.locator('.header .title').innerText()) === 'About Business Interface', 'the picked type');
    expect(await guide.locator('.definition').innerText()).toMatch(/^A business interface represents a point of access/);
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 500);
    expect((await model(page)).actors.length).toBe(before);
    expect(
      await page.evaluate(() => {
        const store = (window as any).__LA_GRAM_APP__.components.store;
        return store.getQuads(null, { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }, {
          termType: 'NamedNode',
          value: 'https://meta.linked.archi/archimate4/onto#BusinessInterface',
        }).length as number;
      }),
    ).toBe(0);
    // Selecting a concept again shows its own type.
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.selectConcept(iri), actor);
    await until(async () => (await guide.locator('.header .title').innerText()) === 'About Business Actor', 'the selection’s type again');

    // It folds to its header, and the tree takes the room.
    await guide.locator('.header').click();
    await until(async () => ((await page.locator('model-explorer').boundingBox())!.height > tree.height + 150), 'the taller tree');
    await guide.locator('.header').click();
    await until(async () => (await guide.locator('.body').isVisible()), 'the guide again');
    expect(await panel.locator('li.id-row .named').innerText()).toBe(actor.slice(actor.search(/[^/#]+$/)));
    await panel.locator('li.id-row .named').click();
    expect(await panel.locator('li.id-row .iris dd').innerText()).toBe(actor);
    const side = (await panel.locator('.side').boundingBox())!;
    const pane = (await panel.locator('.pane').boundingBox())!;
    expect(side.x + side.width).toBeLessThanOrEqual(pane.x + 1); // tabs on the left

    // The definition is listed under the name, empty, to be filled in; emptying it removes it again.
    const definitions = async () =>
      page.evaluate(
        (iri) =>
          (window as any).__LA_GRAM_APP__.components.store.getQuads(
            { termType: 'NamedNode', value: iri },
            { termType: 'NamedNode', value: 'http://www.w3.org/2004/02/skos/core#definition' },
          ).map((q: any) => q.object.value) as string[],
        actor,
      );
    const definition = panel.locator('.pane li.property-row textarea');
    expect(await definition.getAttribute('placeholder')).toBe('Add a definition…');
    await definition.fill('Serves customers at the counter.');
    await definition.press('Tab');
    await until(async () => (await definitions()).length === 1, 'the definition');
    expect(await definitions()).toEqual(['Serves customers at the counter.']);
    await session.screenshot('workbench-property-panel-added');
    await panel.locator('.pane li.property-row textarea').fill('');
    await panel.locator('.pane li.property-row textarea').press('Tab');
    await until(async () => (await definitions()).length === 0, 'the definition removed');
    expect(await labels()).toContain('Definition');

    // The Properties tab: a plain name typed in the picker is a new property in the model's namespace.
    await openTab('properties');
    const picker = panel.locator('property-picker input');
    for (const [name, value] of [
      ['owner', 'Team A'],
      ['cost', '100'],
    ]) {
      await picker.fill(name);
      await picker.press('Enter');
      await panel.locator('.add-row .new-value').fill(value);
      await panel.locator('.add-row button.add').click();
    }
    await until(async () => (await labels()).includes('Cost'), 'the added properties');
    // With the two dates la-gram keeps as the element is edited, shown and saved as any property (Req 9.16).
    expect(await labels()).toEqual(['Cost', 'Created', 'Modified', 'Owner']);
    expect(await panel.locator('.vtab[data-tab="properties"] .count').innerText()).toBe('4');
    const ns = await page.evaluate(() => (window as any).__LA_GRAM_APP__.session.namespace().namespace as string);
    const owner = await page.evaluate(
      ([iri, p]) => (window as any).__LA_GRAM_APP__.components.store.getQuads({ termType: 'NamedNode', value: iri }, { termType: 'NamedNode', value: p }).length,
      [actor, `${ns}owner`],
    );
    expect(owner).toBe(1);
    await session.screenshot('workbench-property-tabs');

    // The list: what applies to a Business Actor, what the model uses, documentation; More folded; no geometry.
    await picker.click();
    const list = panel.locator('property-picker .list');
    await list.waitFor();
    const groups = await list.locator('.group').allInnerTexts();
    expect(groups.slice(0, 3)).toEqual(['FOR BUSINESS ACTOR', 'USED IN THIS MODEL', 'DOCUMENTATION']);
    expect(groups[3]).toMatch(/^MORE \(\d+\)/);
    const options = await list.locator('.option').allInnerTexts();
    expect(options.some((o) => /bounds|point-x|fillColor|unqualifiedForm|skos:definition|dcterms:description/.test(o))).toBe(false);
    expect(options.some((o) => o.includes('m:owner'))).toBe(true);
    // The name reads first; the prefixed IRI is quieter.
    const [nameColor, curieColor] = await list.locator('.option').first().evaluate((o) => [
      getComputedStyle(o.querySelector('.name')!).color,
      getComputedStyle(o.querySelector('.iri')!).color,
    ]);
    expect(nameColor).toBe('rgb(32, 33, 36)');
    expect(curieColor).toBe('rgb(128, 134, 139)');
    await session.screenshot('workbench-property-picker');
    await picker.press('Escape');

    // A link's value is picked from the model by name — here, the view — and shown by it.
    await picker.fill('rdfs:seeAlso');
    await picker.press('Enter');
    const linkValue = panel.locator('.add-row named-picker.link-value input[type="text"]');
    await linkValue.fill('Default');
    const viewIri = await page.evaluate(() => (window as any).__LA_GRAM_APP__.session.activeViewIri as string);
    await panel.locator(`.add-row named-picker.link-value .option[data-iri="${viewIri}"]`).click();
    await panel.locator('.add-row button.add').click();
    const seeAlso = panel.locator('.pane li.property-row', { has: page.locator('.field-name', { hasText: 'See also' }) });
    await until(async () => (await seeAlso.count()) === 1, 'the link');
    expect(await seeAlso.locator('.named').innerText()).toBe('Default View');
    const linked = await page.evaluate(
      ([iri, p]) =>
        (window as any).__LA_GRAM_APP__.components.store
          .getQuads({ termType: 'NamedNode', value: iri }, { termType: 'NamedNode', value: p })
          .map((q: any) => [q.object.termType, q.object.value]),
      [actor, 'http://www.w3.org/2000/01/rdf-schema#seeAlso'],
    );
    expect(linked).toEqual([['NamedNode', viewIri]]);

    // Analysis and views have tabs of their own.
    await openTab('views');
    expect(await panel.locator('.pane').innerText()).toContain('Default View');
    await openTab('analysis');
    expect(await panel.locator('.pane').innerText()).toContain('No relationships');
    await openTab('info');
    await page.evaluate(() => localStorage.removeItem('la-gram:property-panel-tab'));
    findings.push('property panel: vertical tabs (information, properties, analysis, views); picker groups, no geometry: ok');
  });
});

describe('appending from the context pad', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  it('shows the types with their icons, and asks which relationship when several are permitted', async () => {
    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    // The drop leaves the shape selected, and clicking a selected shape deselects it: start clean.
    const shape = (await page.locator(SHAPE).first().boundingBox())!;
    await page.mouse.click(shape.x + shape.width + 200, shape.y + shape.height + 150);
    await page.locator(SHAPE).first().click();
    await page.locator('.djs-context-pad .context-pad-append').click();
    const menu = page.locator('.djs-popup');
    await menu.waitFor({ state: 'visible' });

    // Every entry's image loads (the glyphs used to be asset-relative paths the page could not resolve).
    await until(
      async () =>
        menu.locator('img').evaluateAll((imgs) => imgs.length > 0 && imgs.every((i) => (i as HTMLImageElement).complete)),
      'the icons',
    );
    const broken = await menu
      .locator('img')
      .evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).naturalWidth === 0).map((i) => (i as HTMLImageElement).src));
    expect(broken).toEqual([]);
    const icons = await menu.locator('img').count();
    expect(icons).toBeGreaterThan(20);

    // Business Actor → Application Component: Serving (its hints describe the pair), Triggering, Flow — so it asks.
    const component = menu.locator('.entry', { hasText: 'Application Component' }).first();
    expect(await component.innerText()).toMatch(/choose: Serving \/ Triggering \/ Flow/);
    await session.screenshot('workbench-append-menu');
    await component.click();
    await until(async () => (await menu.locator('.entry').allInnerTexts()).some((t) => t.includes('Serving')), 'the relationship step');
    const step = (await menu.locator('.entry .djs-popup-label').allInnerTexts()).map((t) => t.trim());
    expect(step).toEqual(['Serving', 'Triggering', 'Flow', 'Association', 'Directed Association']);
    // Each with its icon: ArchiMate publishes none for its relationships, so each is drawn from its line and ends.
    const relationshipIcons = await menu.locator('.entry img').evaluateAll((imgs) =>
      imgs.map((i) => [(i as HTMLImageElement).src.startsWith('data:image/svg+xml'), (i as HTMLImageElement).naturalWidth > 0]),
    );
    expect(relationshipIcons).toEqual(Array(5).fill([true, true]));
    // And in the palette.
    const paletteRelationships = await page.locator('palette-panel .palette-item[data-kind="relationship"] img').evaluateAll((imgs) =>
      imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length,
    );
    expect(paletteRelationships).toBeGreaterThanOrEqual(15);
    await session.screenshot('workbench-append-relationship');
    await menu.locator('.entry', { hasText: 'Serving' }).first().click();

    // The element and a Serving relationship to it; nothing the shapes reject.
    await until(
      async () =>
        page.evaluate(() => {
          const store = (window as any).__LA_GRAM_APP__.components.store;
          return store.getQuads(null, { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }, {
            termType: 'NamedNode',
            value: 'https://meta.linked.archi/archimate4/onto#Serving',
          }).length === 1;
        }),
      'the Serving relationship',
    );
    await page.evaluate(() => (window as any).__LA_GRAM_APP__.runValidation());
    const violations = await page.evaluate(() =>
      ((window as any).__LA_GRAM_UI__.validationPanel.results as any[])
        .filter((r) => r.severity === 'Violation')
        .map((r) => r.message as string),
    );
    expect(violations).toEqual([]);
    findings.push(`append: ${icons} icons loaded; ambiguous target asked (Flow / Serving / Triggering / Association); Serving created, valid: ok`);
  });

  it('brings a related element back from the Existing relationships tab', async () => {
    const shapes = async () =>
      page.evaluate(() => {
        const app = (window as any).__LA_GRAM_APP__;
        return app.components.viewManager.getNodes(app.session.activeViewIri).length as number;
      });
    const links = async () =>
      page.evaluate(() => {
        const app = (window as any).__LA_GRAM_APP__;
        return app.components.viewManager.getLinks(app.session.activeViewIri).length as number;
      });
    expect(await shapes()).toBe(2);
    // The appended Application Component is selected: take it out of this view (not the model).
    await page.keyboard.press('Delete');
    await until(async () => (await shapes()) === 1 && (await links()) === 0, 'the component gone from the view');

    // "+" on the actor: two tabs; the relationship is still in the model.
    const actor = page.locator(SHAPE).first();
    const box = (await actor.boundingBox())!;
    await page.mouse.click(box.x + box.width + 200, box.y + box.height + 150);
    await actor.click();
    await page.locator('.djs-context-pad .context-pad-append').click();
    const menu = page.locator('.djs-popup');
    await menu.waitFor({ state: 'visible' });
    const tabs = menu.locator('.la-append-tab');
    expect((await tabs.allInnerTexts()).map((t) => t.trim())).toEqual(['New element', 'Existing relationships (1)']);
    expect(await menu.locator('.la-append-tab.active').innerText()).toBe('New element');

    await menu.locator('.la-append-tab-existing').click();
    await until(async () => (await menu.locator('.la-append-tab.active').innerText()) === 'Existing relationships (1)', 'the tab');
    // The provider's class sits on the row's name element, inside the `.entry` row. The list
    // follows the header a paint later (diagram-js applies new entries in an effect).
    const entry = menu.locator('.entry', { has: page.locator('.la-append-existing') });
    await until(async () => (await entry.count()) === 1, 'the existing relationship');
    expect(await entry.innerText()).toMatch(/Application Component[\s\S]*→ Serving/);
    await session.screenshot('workbench-append-existing');
    await entry.click();

    // Back in the view, with the Serving link drawn — and nothing new in the model.
    await until(async () => (await shapes()) === 2 && (await links()) === 1, 'the component and link back');
    const servings = await page.evaluate(() =>
      (window as any).__LA_GRAM_APP__.components.store.getQuads(null, { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }, {
        termType: 'NamedNode',
        value: 'https://meta.linked.archi/archimate4/onto#Serving',
      }).length,
    );
    expect(servings).toBe(1);
    findings.push('append: Existing relationships tab brings the related element and its link back: ok');
  });

  it('draws the relationships around the selected element in the Graph tab, filters them, and exports query and Turtle', async () => {
    const actor = page.locator(SHAPE).first();
    const box = (await actor.boundingBox())!;
    await page.mouse.click(box.x + box.width + 200, box.y + box.height + 150);
    await actor.click();
    await page.locator('app-shell .tab[data-tab="graph"]').click();
    const panel = page.locator('graph-panel');
    await panel.waitFor({ state: 'visible' });

    // Drawn by Cytoscape into its canvas: the actor and the component it serves.
    await until(async () => (await panel.locator('.cy canvas').count()) > 0, 'the drawing');
    const stats = panel.locator('.stats');
    await until(async () => (await stats.innerText()).includes('2 elements · 1 relationships'), 'the graph');
    expect((await panel.locator('.root').innerText()).trim()).toMatch(/^Business Actor/);
    // Force, live: the graph moves into place and comes to rest.
    await panel.locator('.cy[data-layout="settled"]').waitFor({ state: 'attached' });
    await session.screenshot('workbench-graph');

    // Filtering out Serving prunes it: the actor alone.
    const serving = panel.locator('details[data-kind="relationship"] label', { hasText: 'Serving' }).locator('input');
    await serving.uncheck();
    await until(async () => (await stats.innerText()).includes('1 elements · 0 relationships'), 'the filtered graph');
    await serving.check();
    await until(async () => (await stats.innerText()).includes('2 elements · 1 relationships'), 'the graph again');
    await panel.locator('.cy[data-layout="settled"]').waitFor({ state: 'attached' });

    // The exports: the query (a SELECT by default), and the drawn triples as Turtle.
    const [rq] = await Promise.all([page.waitForEvent('download'), panel.locator('[data-export="sparql"]').click()]);
    expect(rq.suggestedFilename()).toBe('Business-Actor-graph-select.rq');
    const query = await readFile((await rq.path())!, 'utf8');
    expect(query).toMatch(/^# Relationships within 2 hops of "Business Actor"/);
    expect(query).toContain('SELECT DISTINCT (?s AS ?source)');
    const [ttl] = await Promise.all([page.waitForEvent('download'), panel.locator('[data-export="turtle"]').click()]);
    const turtle = await readFile((await ttl.path())!, 'utf8');
    expect(turtle).toMatch(/^@prefix /);
    expect(turtle).toMatch(/mr:[0-9a-f-]{36} a am4:Serving;/);

    // The graph becomes a view, laid out as drawn: two elements and their link, side by side or stacked.
    const drawnAt = (await graphTab(page)).model;
    await panel.locator('[data-export="view"]').click();
    await answerPrompt(page, 'Around the actor');
    await until(
      async () =>
        page.evaluate(() => {
          const app = (window as any).__LA_GRAM_APP__;
          return app.components.viewManager.getView(app.session.activeViewIri)?.label === 'Around the actor';
        }),
      'the new view',
    );
    await until(async () => (await page.locator(SHAPE).count()) === 2, 'its two elements on the canvas');
    const [first, second] = await Promise.all([page.locator(SHAPE).nth(0).boundingBox(), page.locator(SHAPE).nth(1).boundingBox()]);
    const apart = Math.abs(first!.x - second!.x) >= first!.width || Math.abs(first!.y - second!.y) >= first!.height;
    expect(apart).toBe(true);
    // As drawn: the centres in the view differ by 1.3 times what they differ by in the drawing (placeNodes rounds).
    const [p, q] = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      return app.components.viewManager
        .getNodes(app.session.activeViewIri)
        .map((n: any) => ({ iri: n.elementIri as string, x: n.bounds.x + n.bounds.width / 2, y: n.bounds.y + n.bounds.height / 2 }));
    });
    expect(Math.abs(q!.x - p!.x - 1.3 * (drawnAt[q!.iri]!.x - drawnAt[p!.iri]!.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(q!.y - p!.y - 1.3 * (drawnAt[q!.iri]!.y - drawnAt[p!.iri]!.y))).toBeLessThanOrEqual(1);
    await session.screenshot('workbench-graph-new-view');

    // Maximized, the panel covers the workspace and the drawing grows with it; Esc restores.
    const drawingWidth = async () => (await panel.locator('.cy').boundingBox())!.width;
    const before = await drawingWidth();
    await page.locator('app-shell .fold[data-action="maximize"]').click();
    await until(async () => (await drawingWidth()) > before + 200, 'the drawing to grow');
    const covered = await page.locator('app-shell .panel-bottom').boundingBox();
    expect(covered!.width).toBeGreaterThan(1500);
    await until(async () => (await panel.locator('.cy canvas').first().boundingBox())!.width > before + 200, 'Cytoscape to redraw at the new size');
    await session.screenshot('workbench-graph-maximized');
    await page.keyboard.press('Escape');
    await until(async () => Math.abs((await drawingWidth()) - before) < 2, 'the panel restored');

    // The query runs in the SPARQL tab: a table, one row per relationship.
    // (The Graph tab is still the one open: clicking it would fold the panel.)
    await panel.locator('[data-export="open-sparql"]').click();
    const editor = page.locator('sparql-editor');
    await editor.waitFor({ state: 'visible' });
    await until(async () => (await editor.locator('tbody tr').count()) === 1, 'the result table');
    expect(await editor.locator('tbody tr').innerText()).toMatch(/me:[\s\S]*Business Actor[\s\S]*am4:Serving[\s\S]*Application Component/);
    await session.screenshot('workbench-graph-select');
    // … and as a CONSTRUCT: the triples.
    await page.locator('app-shell .tab[data-tab="graph"]').click();
    await panel.locator('[data-form="construct"]').click();
    await panel.locator('[data-export="open-sparql"]').click();
    await until(async () => /triple\(s\)/.test(await editor.locator('.construct-count').innerText().catch(() => '')), 'the triples');
    expect(await editor.locator('th').allInnerTexts()).toEqual(['subject', 'predicate', 'object']);
    await page.locator('app-shell .tab[data-tab="graph"]').click();
    await panel.locator('[data-form="select"]').click();
    findings.push('graph: drawn, filter prunes, .rq and .ttl exported, made a view as drawn, SELECT table and CONSTRUCT triples in the SPARQL tab: ok');
  });

  it("lays the Graph tab out live: it comes to rest, is framed and stops, a dragged element pulls its neighbour and is released, the middle stays, hiding the tab stops it, reduced motion shows it at rest, a switch of layout mid-run ends the run, the user's camera is kept, and click, double-click and pan work", async () => {
    // Distances in model units unless said otherwise; "the zoom" is the rendered over the model distance
    // between the middle actor and the component, drawn at every depth.
    const panel = page.locator('graph-panel');
    const cyBox = async () => (await panel.locator('.cy').boundingBox())!;
    const rest = (what: string) => until(async () => (await graphTab(page)).layout === 'settled', what);
    const statsRead = (text: string) => until(async () => (await graphTab(page)).stats === text, `the stats to read "${text}"`);
    /** Where an element is drawn, in the page. */
    const pointOf = async (g: GraphTab, iri: string) => {
      const box = await cyBox();
      return { x: box.x + g.rendered[iri]!.x, y: box.y + g.rendered[iri]!.y };
    };
    /** A model change through the app: a new Business Actor that `from` serves. */
    const relate = (from: string, label: string) =>
      page.evaluate(
        ([from, label]) => {
          const app = (window as any).__LA_GRAM_APP__;
          const AM4 = 'https://meta.linked.archi/archimate4/onto#';
          const m = app.session.modelIri;
          const iri: string = app.components.elementManager.createElement(AM4 + 'BusinessActor', m, { label }).value;
          app.components.relationshipManager.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: from, targetIri: iri, modelIri: m });
          app.components.eventBus.emit('model-changed', { origin: 'test' });
          return iri;
        },
        [from, label] as const,
      );
    const fitButton = panel.locator('button[title="Fit the graph to the panel"]');

    // 1. A Business Actor served by the component: round the first actor, a chain of three. The panel draws
    // 300 ms after the model change; it comes to rest, framed.
    const [middle] = (await model(page)).actors;
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.selectConcept(iri), middle!);
    const component = await page.evaluate(() => {
      const graph = (window as any).__LA_GRAM_UI__.graphPanel;
      return (graph.graph.nodes as Array<{ iri: string }>).find((n) => n.iri !== graph.rootIri)!.iri;
    });
    const far = await relate(component, 'Courier');
    await statsRead('3 elements · 2 relationships');
    await rest('the chain at rest');
    let g = await graphTab(page);
    expect(framed(g)).toBe(true);

    // 2. At rest nothing runs; a rename elsewhere moves nothing, and neither does the camera.
    await page.waitForTimeout(600);
    const later = await graphTab(page);
    expect(later.model).toEqual(g.model);
    expect(later.rendered).toEqual(g.rendered);
    await page.evaluate((iri) => {
      (window as any).__LA_GRAM_APP__.components.eventBus.emit('property-edited', {
        elementIri: iri,
        property: 'http://www.w3.org/2004/02/skos/core#prefLabel',
        value: 'Dispatch',
      });
    }, component);
    await until(
      async () =>
        page.evaluate((iri) => (window as any).__LA_GRAM_UI__.graphPanel.graph.nodes.some((n: any) => n.iri === iri && n.label === 'Dispatch'), component),
      'the renamed component in the graph',
    );
    const renamed = await graphTab(page);
    expect(renamed.model).toEqual(g.model);
    expect(renamed.rendered).toEqual(g.rendered);

    // 3. The far actor dragged 200 px straight away from the middle actor and held: live, its neighbour follows.
    const from = await pointOf(g, far);
    const centre = await pointOf(g, middle!);
    const reach = apartBy(from, centre);
    const to = { x: from.x + (200 * (from.x - centre.x)) / reach, y: from.y + (200 * (from.y - centre.y)) / reach };
    const component0 = g.model[component]!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    expect((await graphTab(page)).layout).toBe('running');
    const held = Date.now();
    let towards = 0;
    while (Date.now() - held < 500 && towards <= 10) {
      const now = await graphTab(page);
      const c = now.model[component]!;
      const f = now.model[far]!;
      towards = ((c.x - component0.x) * (f.x - component0.x) + (c.y - component0.y) * (f.y - component0.y)) / apartBy(f, component0);
      if (towards <= 10) await page.waitForTimeout(40);
    }
    expect(towards).toBeGreaterThan(10);
    const dropped = (await graphTab(page)).model[far]!;
    await page.mouse.up();
    await rest('the chain at rest after the drag');
    const released = await graphTab(page);
    expect(apartBy(released.model[far]!, dropped)).toBeGreaterThan(10);
    expect(apartBy(released.model[middle!]!, g.model[middle!]!)).toBeLessThan(0.5);
    expect(apartBy(released.rendered[middle!]!, g.rendered[middle!]!)).toBeLessThanOrEqual(1);
    await fitButton.click();
    expect(framed(await graphTab(page))).toBe(true);
    await session.screenshot('workbench-graph-live');

    // 4. The middle actor dragged 150 px left: it stays where it is dropped, and the graph follows its anchor.
    g = await graphTab(page);
    const anchor = await pointOf(g, middle!);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x - 150, anchor.y, { steps: 15 });
    const middleDrop = (await graphTab(page)).model[middle!]!;
    await page.mouse.up();
    await rest('the graph at rest round its new anchor');
    const moved = await graphTab(page);
    expect(apartBy(moved.model[middle!]!, middleDrop)).toBeLessThanOrEqual(1);
    expect(apartBy(moved.model[component]!, g.model[component]!)).toBeGreaterThan(30);

    // 5. Depth 1: the camera stays while the layout runs, and frames it at rest. Depth 2 and at once the
    // Properties tab: the layout stops where it is, still unsettled, and goes on when the tab is back.
    const zoom = zoomOf(moved, middle!, component);
    await panel.locator('.depth button[data-depth="1"]').click();
    const running = await graphTab(page);
    expect(running.layout).toBe('running');
    expect(Math.abs(zoomOf(running, middle!, component) / zoom - 1)).toBeLessThanOrEqual(0.001);
    await rest('depth 1 at rest');
    expect(framed(await graphTab(page))).toBe(true);
    await panel.locator('.depth button[data-depth="2"]').click();
    await page.locator('app-shell .tab[data-tab="properties"]').click();
    const hidden = await graphTab(page);
    await page.waitForTimeout(300);
    const stillHidden = await graphTab(page);
    expect(stillHidden.model).toEqual(hidden.model);
    expect(stillHidden.layout).toBe('running');
    await page.locator('app-shell .tab[data-tab="graph"]').click();
    await rest('depth 2 at rest, back on the Graph tab');

    // 6. Reduced motion: laid out at once and shown at rest; a dragged element moves alone.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const depth of [1, 2]) {
      await panel.locator(`.depth button[data-depth="${depth}"]`).click();
      // Laid out without movement: at once, or a slice a frame within 1.5 s — never drawn on the way. Whether
      // it is at once depends on how quick the frame was, so wait for the rest and check nothing moved meanwhile.
      const settling = await page.evaluate(async () => {
        const graph = (window as any).__LA_GRAM_UI__.graphPanel;
        const cy = graph.shadowRoot.querySelector('.cy') as HTMLElement;
        const drawn = new Set<string>();
        const start = performance.now();
        while (cy.dataset.layout !== 'settled' && performance.now() - start < 1500) {
          drawn.add(JSON.stringify(Object.fromEntries(graph.drawnPositions('model'))));
          await new Promise((r) => requestAnimationFrame(r));
        }
        return { settled: cy.dataset.layout === 'settled', drawnWhileRunning: drawn.size };
      });
      expect(settling.settled).toBe(true);
      expect(settling.drawnWhileRunning).toBeLessThanOrEqual(1);
      const frames = await page.evaluate(async () => {
        const graph = (window as any).__LA_GRAM_UI__.graphPanel;
        const seen: string[] = [];
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          seen.push(JSON.stringify(Object.fromEntries(graph.drawnPositions('model'))));
        }
        return seen;
      });
      expect(new Set(frames).size).toBe(1);
    }
    g = await graphTab(page);
    const farAt = await pointOf(g, far);
    await page.mouse.move(farAt.x, farAt.y);
    await page.mouse.down();
    await page.mouse.move(farAt.x + 80, farAt.y + 40, { steps: 8 });
    await page.mouse.up();
    const alone = await graphTab(page);
    expect(alone.model[component]).toEqual(g.model[component]);
    expect(apartBy(alone.model[far]!, g.model[far]!)).toBeGreaterThan(10);
    expect(alone.layout).toBe('settled');
    await page.emulateMedia({ reducedMotion: null });

    // 7. Tree, then Force, and Rings while Force runs: the run ends at once, Rings remembered. Force again.
    const layout = panel.locator('select[aria-label="Layout"]');
    await layout.selectOption('tree');
    expect((await graphTab(page)).layout).toBe('settled');
    await layout.selectOption('force');
    expect((await graphTab(page)).layout).toBe('running');
    await layout.selectOption('rings');
    expect((await graphTab(page)).layout).toBe('settled');
    expect(await page.evaluate(() => localStorage.getItem('la-gram:graph-layout'))).toBe('rings');
    await layout.selectOption('force');
    expect((await graphTab(page)).layout).toBe('running');
    await rest('Force at rest again');

    // 8. Zoomed in by the user: a tab switch and a model change keep the camera.
    g = await graphTab(page);
    const over = await pointOf(g, middle!);
    await page.mouse.move(over.x, over.y);
    await page.mouse.wheel(0, -120);
    await until(async () => Math.abs(zoomOf(await graphTab(page), middle!, component) / zoomOf(g, middle!, component) - 1) > 0.01, 'the zoom');
    const zoomed = await graphTab(page);
    const zoomIn = zoomOf(zoomed, middle!, component);
    await page.locator('app-shell .tab[data-tab="properties"]').click();
    await page.locator('app-shell .tab[data-tab="graph"]').click();
    await until(async () => (await graphTab(page)).width > 0, 'the drawing shown again');
    await page.waitForTimeout(200);
    const back = await graphTab(page);
    expect(Math.abs(zoomOf(back, middle!, component) / zoomIn - 1)).toBeLessThanOrEqual(0.001);
    expect(apartBy(back.rendered[middle!]!, zoomed.rendered[middle!]!)).toBeLessThanOrEqual(1);
    await relate(component, 'Warehouse');
    await statsRead('4 elements · 3 relationships');
    await rest('the graph at rest with a fourth element');
    const kept = await graphTab(page);
    expect(Math.abs(zoomOf(kept, middle!, component) / zoomIn - 1)).toBeLessThanOrEqual(0.001);
    expect(apartBy(kept.rendered[middle!]!, zoomed.rendered[middle!]!)).toBeLessThanOrEqual(1);

    // 9. At rest: a click selects, a double-click recentres and is framed at rest, a drag of the background
    // pans by its length, and the next rest, after a model change, does not re-fit.
    await fitButton.click();
    g = await graphTab(page);
    const farPoint = await pointOf(g, far);
    await page.mouse.click(farPoint.x, farPoint.y);
    await until(async () => (await graphTab(page)).selected === far, 'the far actor selected');
    const componentPoint = await pointOf(await graphTab(page), component);
    await page.mouse.dblclick(componentPoint.x, componentPoint.y);
    await until(async () => (await graphTab(page)).root.startsWith('Dispatch'), 'the component in the middle');
    await rest('the graph recentred at rest');
    g = await graphTab(page);
    expect(framed(g)).toBe(true);
    const box = await cyBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 110, box.y + 10, { steps: 10 });
    await page.mouse.up();
    const panned = await graphTab(page);
    for (const iri of Object.keys(g.rendered)) {
      expect(Math.abs(panned.rendered[iri]!.x - g.rendered[iri]!.x - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(panned.rendered[iri]!.y - g.rendered[iri]!.y)).toBeLessThanOrEqual(1);
    }
    expect(panned.model).toEqual(g.model);
    await relate(component, 'Supplier');
    await statsRead('5 elements · 4 relationships');
    await rest('the graph at rest after the pan');
    const last = await graphTab(page);
    expect(Math.abs(zoomOf(last, middle!, component) / zoomOf(panned, middle!, component) - 1)).toBeLessThanOrEqual(0.001);
    expect(apartBy(last.rendered[component]!, panned.rendered[component]!)).toBeLessThanOrEqual(1);
    findings.push(
      'graph, live force: at rest and framed, stops; drag pulls and releases; middle pinned; paused while hidden; reduced motion at once; Rings mid-run ends it; camera kept; click, double-click, pan: ok',
    );
  }, 180_000);

  it('sets the forces with sliders (Req 17.13): keys on Link distance move the graph, framed at rest, the middle pinned; laid out at once only when let go; remembered across a reload; Reset forgets them; shown with Force only', async () => {
    // Continues from the test before: five elements round "Dispatch", Force, at rest, depth 2.
    const panel = page.locator('graph-panel');
    const rest = (what: string) => until(async () => (await graphTab(page)).layout === 'settled', what);
    const forces = panel.locator('details.forces');
    const link = panel.getByLabel('Link distance');
    const charge = panel.getByLabel('Charge strength');
    const collide = panel.getByLabel('Collision radius');
    const sliders = async () => [await link.inputValue(), await charge.inputValue(), await collide.inputValue()];
    const shown = async () => Promise.all(['force-link', 'force-charge', 'force-collide'].map((id) => panel.locator(`output[for="${id}"]`).innerText()));
    const storedForces = async () => page.evaluate(() => localStorage.getItem('la-gram:graph-forces'));
    const middle = await page.evaluate(() => (window as any).__LA_GRAM_UI__.graphPanel.rootIri as string);
    /** The mean distance, in model units, from the middle element to the others. */
    const spread = (g: GraphTab) => {
      const others = Object.keys(g.model).filter((iri) => iri !== middle);
      return others.reduce((sum, iri) => sum + apartBy(g.model[iri]!, g.model[middle]!), 0) / others.length;
    };
    await rest('the graph at rest');
    const before = await graphTab(page);
    expect(before.stats).toBe('5 elements · 4 relationships');

    // 1. Folded at first; opened, the defaults.
    expect(await forces.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await forces.locator('summary').click();
    expect(await sliders()).toEqual(['180', '350', '1']);
    expect(await shown()).toEqual(['180 px', '350', '1.0×']);

    // 2. By keyboard: Tab to Link distance, its focus ring shown; End and ←: 390 px. The graph runs, and comes to
    // rest with longer lines, the middle element where it was, framed; the three remembered.
    await page.keyboard.press('Tab');
    expect(await link.evaluate((el) => (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true);
    expect(await link.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineWidth, getComputedStyle(el).outlineColor])).toEqual([
      'solid',
      '2px',
      'rgb(26, 115, 232)',
    ]);
    await page.keyboard.press('End');
    expect((await graphTab(page)).layout).toBe('running');
    await page.keyboard.press('ArrowLeft');
    expect(await link.inputValue()).toBe('390');
    expect((await shown())[0]).toBe('390 px');
    expect(await link.getAttribute('aria-valuetext')).toBe('390 pixels');
    await rest('the graph at rest with longer lines');
    const longer = await graphTab(page);
    expect(spread(longer)).toBeGreaterThan(spread(before) + 40);
    expect(apartBy(longer.model[middle]!, before.model[middle]!)).toBeLessThan(0.5);
    expect(framed(longer)).toBe(true);
    expect(JSON.parse((await storedForces())!)).toEqual({ linkDistance: 390, chargeStrength: -350, collideScale: 1 });
    await session.screenshot('workbench-graph-forces');

    // 3. A click still selects; Collision radius at 2.0×: the graph runs again and comes to rest.
    const other = Object.keys(longer.rendered).find((iri) => iri !== middle)!;
    const box = (await panel.locator('.cy').boundingBox())!;
    await page.mouse.click(box.x + longer.rendered[other]!.x, box.y + longer.rendered[other]!.y);
    await until(async () => (await graphTab(page)).selected === other, 'the element selected');
    await collide.fill('2');
    expect((await shown())[2]).toBe('2.0×');
    expect(await collide.getAttribute('aria-valuetext')).toBe('2.0 times');
    await rest('the graph at rest at 2.0×');
    expect(JSON.parse((await storedForces())!)).toMatchObject({ collideScale: 2 });

    // 4. Under reduced motion, laid out at once: a slider moving changes nothing; let go, the graph is shown at rest.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await graphTab(page);
    await charge.evaluate((el) => {
      (el as HTMLInputElement).value = '1000';
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
    expect((await shown())[1]).toBe('1000');
    expect((await graphTab(page)).model).toEqual(still.model);
    await charge.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
    const pushed = await graphTab(page);
    expect(pushed.layout).toBe('settled');
    expect(pushed.model).not.toEqual(still.model);
    expect(apartBy(pushed.model[middle]!, still.model[middle]!)).toBeLessThan(0.5);
    await page.emulateMedia({ reducedMotion: null });

    // 5. Rings and Tree have no forces; Force has them again.
    const layout = panel.locator('select[aria-label="Layout"]');
    await layout.selectOption('rings');
    await until(async () => (await forces.count()) === 0, 'no forces with Rings');
    await layout.selectOption('tree');
    await until(async () => (await forces.count()) === 0, 'no forces with Tree');
    await layout.selectOption('force');
    await forces.waitFor({ state: 'attached' });
    await rest('Force at rest again');

    // 6. Remembered across a reload. la-gram asks before leaving a changed model: leave it.
    const leave = (dialog: Dialog) => void dialog.accept();
    page.on('dialog', leave);
    await page.reload();
    await waitForAppReady(page);
    page.off('dialog', leave);
    await page.evaluate(() => (window as any).__LA_GRAM_UI__.showBottomTab('graph'));
    await forces.waitFor({ state: 'visible' });
    expect(await sliders()).toEqual(['390', '1000', '2']);

    // 7. Reset: the defaults, and nothing remembered.
    await forces.locator('summary').click();
    await panel.locator('details.forces button[data-force="reset"]').click();
    await until(async () => (await sliders()).join() === '180,350,1', 'the defaults');
    expect(await shown()).toEqual(['180 px', '350', '1.0×']);
    expect(await storedForces()).toBeNull();
    findings.push('graph forces: keys on Link distance move the graph, framed at rest, middle pinned; reduced motion on release only; remembered across a reload; Reset forgets; Force only: ok');
  }, 120_000);
});

describe('nesting', () => {
  it('drops an element into another: drawn inside, stored inside, and the relationship asked for', async () => {
    const { page, session } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    const team = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const iri = app.components.elementManager
        .createElement('https://meta.linked.archi/archimate4/onto#Collaboration', app.session.modelIri, { label: 'Sales team' }).value;
      app.components.viewManager.addElementToView(app.session.activeViewIri, iri, { x: 150, y: 100, width: 400, height: 250 });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return iri as string;
    });
    await dropActor(page, 350, 240);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const [actor] = (await model(page)).actors;
    const parentOf = () =>
      page.evaluate((iri) => {
        const app = (window as any).__LA_GRAM_APP__;
        return app.components.viewManager.getNode(app.session.activeViewIri, iri)?.parentElementIri as string | undefined;
      }, actor);
    expect(await parentOf()).toBe(team);

    // Which relationship the nesting stands for: what the notation lets nesting draw and the metamodel permits.
    const entries = page.locator('.djs-popup .entry');
    await entries.first().waitFor({ state: 'visible' });
    const labels = (await entries.allInnerTexts()).map((s) => s.split('\n')[0].trim());
    expect(labels).toContain('Aggregation');
    expect(labels.at(-1)).toBe('None');
    await session.screenshot('workbench-nesting-offer');
    await entries.filter({ hasText: 'Aggregation' }).first().click();
    const related = await page.evaluate(
      ([a, b]) => (window as any).__LA_GRAM_APP__.components.relationshipManager.getRelationshipsOf(b)
        .filter((r: any) => r.sourceIri === a).map((r: any) => r.classIri.split('#')[1]) as string[],
      [team, actor],
    );
    expect(related).toEqual(['Aggregation']);
    findings.push(`nesting: offered ${labels.join(', ')}`);
  }, 60_000);

  it('drags a view’s row from the tree into an element’s box: a reference to it, drawn and kept inside, refining it if asked; a line drawn to it is a relationship with the view; it opens it (Req 3.23, VC-3, VC-5)', async () => {
    const { page, session } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    const { team, clerk, payments, holder } = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const holder = app.session.activeViewIri as string;
      const payments = app.session.createView('Diagram', { label: 'Payments', open: false }) as string;
      const team = app.components.elementManager
        .createElement('https://meta.linked.archi/archimate4/onto#Collaboration', app.session.modelIri, { label: 'Sales team' }).value as string;
      app.components.viewManager.addElementToView(holder, team, { x: 150, y: 100, width: 400, height: 250 });
      const clerk = app.components.elementManager
        .createElement('https://meta.linked.archi/archimate4/onto#BusinessActor', app.session.modelIri, { label: 'Clerk' }).value as string;
      app.components.viewManager.addElementToView(holder, clerk, { x: 700, y: 150, width: 120, height: 55 });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return { team, clerk, payments, holder };
    });
    const row = page.locator(`model-explorer .row[data-iri="${payments}"]`);
    await row.waitFor({ state: 'visible' });
    const from = (await row.boundingBox())!;
    const box = (await page.locator(`.djs-element[data-element-id="${team}"]`).boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(450);

    const references = () =>
      page.evaluate((view) => {
        const app = (window as any).__LA_GRAM_APP__;
        return (app.components.viewManager.getNodes(view) as any[])
          .filter((n) => n.figure?.kind === 'reference')
          .map((n) => ({ node: n.nodeIri as string, opens: n.figure.view as string, inside: n.parentElementIri as string | undefined }));
      }, holder);
    await until(async () => (await references()).length === 1, 'the reference');
    const [reference] = await references();
    expect(reference).toMatchObject({ opens: payments, inside: team });
    const drawn = page.locator(`.djs-element[data-element-id="${reference!.node}"]`);
    await expect(drawn.locator('[data-view-reference]').count()).resolves.toBe(1);
    await expect(drawn.textContent()).resolves.toContain('Payments');

    // Inside an element's box, it asks what the nesting stands for: the element having the view as a part, or the
    // view refining the element (VC-5).
    const entries = page.locator('.djs-popup .entry');
    await entries.first().waitFor({ state: 'visible' });
    const labels = (await entries.allInnerTexts()).map((s) => s.split('\n')[0].trim());
    expect(labels).toEqual(['Has Part', 'Refines', 'None']);
    await session.screenshot('workbench-view-reference');
    await entries.filter({ hasText: 'Refines' }).first().click();
    const relationshipsOf = (iri: string) =>
      page.evaluate(
        (end) =>
          ((window as any).__LA_GRAM_APP__.components.relationshipManager.getRelationshipsOf(end) as any[]).map((r) => ({
            iri: r.iri as string,
            from: r.sourceIri as string,
            to: r.targetIri as string,
            type: (r.classIri as string).split('#')[1],
          })),
        iri,
      );
    await until(async () => (await relationshipsOf(payments)).length === 1, 'the view refining the element');
    expect((await relationshipsOf(payments))[0]).toMatchObject({ from: payments, to: team, type: 'Refines' });

    // A line drawn with the pad from an element to it is a relationship with the view, drawn to the reference (VC-3).
    await page.locator(`.djs-shape[data-element-id="${clerk}"]`).click();
    const connect = page.locator('.djs-context-pad .context-pad-connect');
    await connect.waitFor({ state: 'visible' });
    await connect.click();
    const to = (await drawn.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.down();
    await page.mouse.up();
    await until(async () => (await relationshipsOf(clerk)).length === 1, 'the relationship with the view');
    const [line] = await relationshipsOf(clerk);
    expect(line).toMatchObject({ from: clerk, to: payments, type: 'Association' });
    const link = await page.evaluate(
      ([view, rel]) =>
        ((window as any).__LA_GRAM_APP__.components.viewManager.getLinks(view) as any[]).find((l) => l.relationshipIri === rel),
      [holder, line!.iri],
    );
    expect(link).toMatchObject({ targetNodeIri: reference!.node, targetElementIri: payments });
    expect(await page.locator(`.djs-connection [data-relationship-iri="${line!.iri}"]`).count()).toBe(1);
    expect(session.diagnostics.pageErrors).toEqual([]);

    // Double-clicked, it opens the view it references.
    await page.keyboard.press('Escape');
    await drawn.dblclick();
    await until(async () => (await model(page)).activeView === payments, 'the referenced view');
  }, 60_000);
});

describe('renaming on the canvas', () => {
  it('edits an element’s name in its box: double-click or F2, Enter keeps, Esc drops, undo restores', async () => {
    const { page, session } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const [actor] = (await model(page)).actors;
    const names = async () =>
      page.evaluate(
        (iri) =>
          (window as any).__LA_GRAM_APP__.components.store
            .getQuads({ termType: 'NamedNode', value: iri }, { termType: 'NamedNode', value: 'http://www.w3.org/2004/02/skos/core#prefLabel' })
            .map((q: any) => `${q.object.value}@${q.object.language}`) as string[],
        actor,
      );
    const shape = page.locator(SHAPE).first();
    const drawn = async () =>
      (await shape.locator('text tspan').evaluateAll((lines) => lines.map((t) => t.textContent ?? '')))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    const editor = page.locator('.djs-direct-editing-content');
    expect(await names()).toEqual(['Business Actor@en']);

    // Double-click: the name is selected in a box over the shape; typing replaces it.
    await shape.dblclick();
    await editor.waitFor({ state: 'visible' });
    expect(await editor.innerText()).toBe('Business Actor');
    await session.screenshot('workbench-rename-editing');
    await page.keyboard.type('Front  desk clerk');
    await page.keyboard.press('Enter');
    await editor.waitFor({ state: 'hidden' });
    await until(async () => (await names())[0] === 'Front desk clerk@en', 'the new name in the model');
    expect(await drawn()).toBe('Front desk clerk');
    // The tree follows.
    await page.locator('model-explorer').getByText('Front desk clerk').first().waitFor({ state: 'visible' });

    // Undo gives the old name back, in the model and on the canvas.
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    await page.keyboard.press('Control+z');
    await until(async () => (await names())[0] === 'Business Actor@en', 'the old name back');
    expect(await drawn()).toBe('Business Actor');
    await page.keyboard.press('Control+y');
    await until(async () => (await names())[0] === 'Front desk clerk@en', 'redone');

    // F2 on the selected element; Esc drops the edit.
    await shape.click();
    await page.keyboard.press('F2');
    await editor.waitFor({ state: 'visible' });
    await page.keyboard.type('Nobody');
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden' });
    expect(await names()).toEqual(['Front desk clerk@en']);

    // A name cannot be emptied.
    await shape.dblclick();
    await editor.waitFor({ state: 'visible' });
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await editor.waitFor({ state: 'hidden' });
    expect(await names()).toEqual(['Front desk clerk@en']);
    expect(await drawn()).toBe('Front desk clerk');
    findings.push('rename on canvas: double-click/F2, Enter, Esc, undo/redo, empty refused: ok');
  }, 60_000);

  it('names a relationship on its line, shows names only when switched on, and removes an emptied one, undoably', async () => {
    const { page, session } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    const rel = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const [m, v] = [app.session.modelIri, app.session.activeViewIri];
      const make = (type: string, label: string, x: number) => {
        const iri = app.components.elementManager.createElement(AM4 + type, m, { label }).value;
        app.components.viewManager.addElementToView(v, iri, { x, y: 100, width: 120, height: 55 });
        return iri;
      };
      const a = make('ApplicationComponent', 'Portal', 100);
      const b = make('BusinessActor', 'Clerk', 500);
      const r = app.components.relationshipManager.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: a, targetIri: b, modelIri: m }).iri;
      app.components.viewManager.addRelationshipToView(v, r);
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return r as string;
    });
    const names = async () =>
      page.evaluate(
        (iri) =>
          (window as any).__LA_GRAM_APP__.components.store
            .getQuads({ termType: 'NamedNode', value: iri }, { termType: 'NamedNode', value: 'http://www.w3.org/2004/02/skos/core#prefLabel' })
            .map((q: any) => `${q.object.value}@${q.object.language}`) as string[],
        rel,
      );
    const drawn = async () =>
      (await page.locator(`.djs-connection[data-element-id="${rel}"] .la-connection-label tspan`).allTextContents()).join(' ');
    // The middle of the line, on the page.
    const mid = await page.evaluate((r) => {
      const d = (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram();
      const line = d.get('elementRegistry').get(r);
      const canvas = d.get('canvas');
      const vb = canvas.viewbox();
      const svg = canvas._svg.getBoundingClientRect();
      const [p, q] = [line.waypoints[0], line.waypoints[line.waypoints.length - 1]];
      return { x: svg.x + ((p.x + q.x) / 2 - vb.x) * vb.scale, y: svg.y + ((p.y + q.y) / 2 - vb.y) * vb.scale };
    }, rel);
    const editor = page.locator('.djs-direct-editing-content');
    const namesSwitch = page.locator('canvas-toolbar button[data-switch="relationship-names"]');
    const blank = async () => page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });

    // Unnamed, and names are off: the box opens empty — not with the type's name.
    expect(await namesSwitch.getAttribute('aria-pressed')).toBe('false');
    await page.mouse.dblclick(mid.x, mid.y);
    await editor.waitFor({ state: 'visible' });
    expect(await editor.innerText()).toBe('');
    await page.keyboard.type('Serves the clerk');
    await page.keyboard.press('Enter');
    await editor.waitFor({ state: 'hidden' });
    await until(async () => (await names())[0] === 'Serves the clerk@en', 'the name in the model');
    expect(await drawn()).toBe('');

    // Switched on: the name is on the line; the switch is remembered.
    await namesSwitch.click();
    expect(await namesSwitch.getAttribute('aria-pressed')).toBe('true');
    expect(await drawn()).toBe('Serves the clerk');
    expect(await page.evaluate(() => localStorage.getItem('la-gram:canvas-relationship-names'))).toBe('true');
    await session.screenshot('workbench-relationship-name');

    // Undo takes the name away, from the model and the line; redo brings it back.
    await blank();
    await page.keyboard.press('Control+z');
    await until(async () => (await names()).length === 0, 'the name undone');
    expect(await drawn()).toBe('');
    await page.keyboard.press('Control+y');
    await until(async () => (await names())[0] === 'Serves the clerk@en', 'redone');
    expect(await drawn()).toBe('Serves the clerk');

    // F2 on the selected line; emptied, the name is removed.
    await page.mouse.click(mid.x, mid.y);
    await page.keyboard.press('F2');
    await editor.waitFor({ state: 'visible' });
    expect(await editor.innerText()).toBe('Serves the clerk');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await editor.waitFor({ state: 'hidden' });
    await until(async () => (await names()).length === 0, 'the name removed');
    expect(await drawn()).toBe('');

    // Switched off again for the pages after.
    await namesSwitch.click();
    expect(await namesSwitch.getAttribute('aria-pressed')).toBe('false');
    findings.push('relationship name on its line: double-click/F2, names switch, undo/redo, emptied removed: ok');
  }, 60_000);
});

describe('moving a relationship’s name', () => {
  it('drags the name off the middle — not the line — keeps it in the view, follows the line, and moves it back, undoably', async () => {
    const { page, session } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    const ids = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const [m, v] = [app.session.modelIri, app.session.activeViewIri];
      const make = (type: string, label: string, x: number) => {
        const iri = app.components.elementManager.createElement(AM4 + type, m, { label }).value;
        app.components.viewManager.addElementToView(v, iri, { x, y: 100, width: 120, height: 55 });
        return iri;
      };
      const a = make('ApplicationComponent', 'Portal', 100);
      const b = make('BusinessActor', 'Clerk', 500);
      const r = app.components.relationshipManager.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: a, targetIri: b, modelIri: m }).iri;
      app.components.store.addQuads([
        {
          termType: 'Quad', value: '',
          subject: { termType: 'NamedNode', value: r },
          predicate: { termType: 'NamedNode', value: 'http://www.w3.org/2004/02/skos/core#prefLabel' },
          object: { termType: 'Literal', value: 'Serves the clerk', language: 'en', datatype: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' } },
          graph: { termType: 'DefaultGraph', value: '' },
        },
      ]);
      app.components.viewManager.addRelationshipToView(v, r);
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return { a, b, r, v };
    });
    const namesSwitch = page.locator('canvas-toolbar button[data-switch="relationship-names"]');
    await namesSwitch.click();
    const name = page.locator(`.djs-connection[data-element-id="${ids.r}"] .la-connection-label rect`);
    await name.waitFor({ state: 'attached' });
    // The name's box fits the name as drawn — measured, not estimated: 2 px each side.
    const fit = await page.evaluate((r) => {
      const group = document.querySelector(`.djs-connection[data-element-id="${r}"] .la-connection-label`)!;
      const text = (group.querySelector('text') as SVGTextElement).getBBox().width;
      return { box: Number(group.querySelector('rect')!.getAttribute('width')), text };
    }, ids.r);
    expect(Math.abs(fit.box - (fit.text + 4))).toBeLessThan(1.5);
    const facts = async () =>
      page.evaluate(({ r, v }) => {
        const ui = (window as any).__LA_GRAM_UI__;
        const app = (window as any).__LA_GRAM_APP__;
        const line = ui.diagramCanvas.getDiagram().get('elementRegistry').get(r);
        const link = app.components.viewManager.getLinks(v).find((l: any) => l.relationshipIri === r);
        const w = line.waypoints;
        return {
          route: w.map((p: any) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '),
          middle: { x: (w[0].x + w[w.length - 1].x) / 2, y: (w[0].y + w[w.length - 1].y) / 2 },
          kept: link?.label as { x: number; y: number; width: number; height: number } | undefined,
        };
      }, ids);
    const centre = async () => {
      const box = (await name.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const before = await facts();
    expect(before.kept).toBeUndefined();
    const at = await centre();

    // Pressed on the name — over the segment handle diagram-js draws on the line's middle — and dragged up.
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.move(at.x + 10, at.y - 30, { steps: 5 });
    await page.mouse.move(at.x + 20, at.y - 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(450);
    const moved = await facts();
    // The line stayed where it was; the name went, and the view keeps where.
    expect(moved.route).toBe(before.route);
    expect(moved.kept).toBeDefined();
    const now = await centre();
    expect(now.y).toBeLessThan(at.y - 40);
    expect(now.x).toBeGreaterThan(at.x + 10);
    await session.screenshot('workbench-relationship-name-moved');

    // Undo puts it back at the middle; redo where it was put.
    const blank = async () => page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    await blank();
    await page.keyboard.press('Control+z');
    await until(async () => (await facts()).kept === undefined, 'the move undone');
    expect(Math.abs((await centre()).y - at.y)).toBeLessThan(2);
    await page.keyboard.press('Control+y');
    await until(async () => (await facts()).kept !== undefined, 'the move redone');

    // An end moves: the name keeps its place relative to the middle of the line.
    const offsetOf = (f: Awaited<ReturnType<typeof facts>>) => ({
      x: f.kept!.x + f.kept!.width / 2 - f.middle.x,
      y: f.kept!.y + f.kept!.height / 2 - f.middle.y,
    });
    const kept = offsetOf(await facts());
    await page.evaluate((b) => {
      const d = (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram();
      d.get('modeling').moveElements([d.get('elementRegistry').get(b)], { x: 0, y: 120 });
    }, ids.b);
    const after = await facts();
    expect(after.route).not.toBe(moved.route);
    expect(Math.abs(offsetOf(after).x - kept.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(offsetOf(after).y - kept.y)).toBeLessThanOrEqual(1);

    // The right-click menu on the name: back to the middle.
    const c = await centre();
    await page.mouse.click(c.x, c.y, { button: 'right' });
    const menu = page.locator('.djs-popup.la-context-menu');
    await menu.waitFor({ state: 'visible' });
    await menu.locator('.entry', { hasText: 'Move name back to its place' }).click();
    await until(async () => (await facts()).kept === undefined, 'the name back at the middle');

    await namesSwitch.click();
    findings.push('relationship name moved: drag (not the line), kept in the view, undo/redo, follows its line, back to the middle: ok');
  }, 60_000);
});

describe('changing an element’s type', () => {
  it('offers the loaded types from the right-click menu and the property panel, keeps the element, warns about relationships, and undoes', async () => {
    const { page, session } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const [actor] = (await model(page)).actors;
    const AM4 = 'https://meta.linked.archi/archimate4/onto#';
    const facts = async () =>
      page.evaluate((iri) => {
        const app = (window as any).__LA_GRAM_APP__;
        const store = app.components.store;
        const nn = (value: string) => ({ termType: 'NamedNode', value });
        return {
          types: store.getQuads(nn(iri), nn('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).map((q: any) => q.object.value),
          name: store.getQuads(nn(iri), nn('http://www.w3.org/2004/02/skos/core#prefLabel')).map((q: any) => q.object.value)[0],
          drawnType: app.components.viewManager ? (window as any).__LA_GRAM_UI__.diagramCanvas.getElement(iri)?.typeIri : undefined,
        };
      }, actor);
    const shape = page.locator(SHAPE).first();
    const menu = page.locator('.djs-popup');
    // Right-click: the context menu; "Change type…" opens the type menu.
    const openTypeMenu = async () => {
      await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
      await shape.click({ button: 'right' });
      const context = page.locator('.djs-popup.la-context-menu');
      await context.waitFor({ state: 'visible' });
      await context.locator('.entry', { hasText: 'Change type…' }).click();
      await page.locator('.djs-popup.la-element-replace').waitFor({ state: 'visible' });
    };

    // The right-click menu itself: the actions, in sections; the pad no longer changes an element's type.
    await shape.click({ button: 'right' });
    const contextMenu = page.locator('.djs-popup.la-context-menu');
    await contextMenu.waitFor({ state: 'visible' });
    expect((await contextMenu.locator('.entry').allInnerTexts()).map((t) => t.trim())).toEqual([
      'Rename',
      'Change type…',
      'Cut',
      'Copy',
      'Duplicate',
      'Append…',
      'Properties',
      'Show in model tree',
      'Show relationship graph',
      'Ask about this element…',
      'Copy IRI',
      'Delete from view',
      'Delete from model…',
    ]);
    expect(await page.locator('.djs-context-pad .context-pad-replace').count()).toBe(0);
    await session.screenshot('workbench-context-menu');
    await page.keyboard.press('Escape');
    await contextMenu.waitFor({ state: 'hidden' });

    // The menu: every loaded element type, grouped as in the palette, the current one marked; searchable.
    await openTypeMenu();
    expect(await menu.locator('.la-element-type').count()).toBeGreaterThan(40);
    expect(await menu.locator('.la-element-type-current').innerText()).toMatch(/Business Actor/);
    await session.screenshot('workbench-change-type-menu');
    await page.keyboard.type('Application Comp');
    await until(async () => (await menu.locator('.la-element-type').count()) === 1, 'the search');
    await menu.locator('.entry', { hasText: 'Application Component' }).first().click();
    // Same element, new type; its default name follows the type; drawn as one.
    await until(async () => (await facts()).types.includes(AM4 + 'ApplicationComponent'), 'the new type');
    expect(await facts()).toEqual({ types: [AM4 + 'ApplicationComponent'], name: 'Application Component', drawnType: AM4 + 'ApplicationComponent' });
    expect((await model(page)).actors).toEqual([]);
    // The About section and the property panel follow.
    await until(async () => (await page.locator('type-guide-panel .header .title').innerText()) === 'About Application Component', 'the guide');

    // Undo: the actor back, with its name.
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    await page.keyboard.press('Control+z');
    await until(async () => (await facts()).types.includes(AM4 + 'BusinessActor'), 'the old type back');
    expect(await facts()).toEqual({ types: [AM4 + 'BusinessActor'], name: 'Business Actor', drawnType: AM4 + 'BusinessActor' });

    // With a relationship the new type is not permitted in: named, and kept if the user goes ahead.
    const role = await page.evaluate((actorIri) => {
      const app = (window as any).__LA_GRAM_APP__;
      const model = app.session.modelIri;
      const view = app.session.activeViewIri;
      const role = app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#Role', model, { label: 'Cashier' }).value;
      app.components.viewManager.addElementToView(view, role, { x: 600, y: 180, width: 120, height: 55 });
      const rel = app.components.relationshipManager.createQualifiedRelationship({
        typeIri: 'https://meta.linked.archi/archimate4/onto#Assignment',
        sourceIri: actorIri,
        targetIri: role,
        modelIri: model,
      });
      app.components.viewManager.addRelationshipToView(view, rel.iri);
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return role as string;
    }, actor);
    await until(async () => (await page.locator(SHAPE).count()) === 2, 'the role');
    await openTypeMenu();
    await page.keyboard.type('Business Object');
    await menu.locator('.entry', { hasText: 'Business Object' }).first().click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.innerText()).toMatch(/Assignment → Cashier/);
    await session.screenshot('workbench-change-type-warning');
    await dialog.locator('.la-button:not(.primary)').first().click(); // Cancel
    await dialog.waitFor({ state: 'hidden' });
    expect((await facts()).types).toEqual([AM4 + 'BusinessActor']);

    await openTypeMenu();
    await page.keyboard.type('Business Object');
    await menu.locator('.entry', { hasText: 'Business Object' }).first().click();
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('.la-button.primary').click();
    await until(async () => (await facts()).types.includes(AM4 + 'BusinessObject'), 'the business object');
    const kept = await page.evaluate(
      ([a, r]) => (window as any).__LA_GRAM_APP__.components.relationshipManager.getRelationshipsOf(a).filter((x: any) => x.targetIri === r).length,
      [actor, role],
    );
    expect(kept).toBe(1);
    // The same from the property panel's type field.
    // (Showing the tab rather than clicking it: clicking the open tab folds the panel.)
    await page.evaluate(() => (window as any).__LA_GRAM_UI__.showBottomTab('properties'));
    // (A click on an already selected shape deselects it: click the canvas first.)
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    await shape.click();
    const typeField = page.locator('property-panel named-picker.type-picker input[type="text"]');
    await typeField.waitFor({ state: 'visible' });
    expect(await typeField.inputValue()).toBe('Business Object');
    const typeRow = page.locator('property-panel .property-row').filter({ has: page.locator('named-picker.type-picker') });
    const typeIri = typeRow.getByRole('button', { name: 'Show the type IRI', exact: true });
    await typeIri.click();
    expect(await typeRow.locator('.iris').innerText()).toContain(AM4 + 'BusinessObject');
    expect(await typeField.getAttribute('aria-expanded')).toBe('false');
    expect((await facts()).types).toEqual([AM4 + 'BusinessObject']);
    await session.screenshot('workbench-type-iri');
    // The same disclosure works from the keyboard without entering the type chooser.
    await typeIri.press('Enter');
    expect(await typeRow.locator('.iris').count()).toBe(0);
    expect(await typeField.getAttribute('aria-expanded')).toBe('false');
    // Searched by name; the list's switch shows the IRIs, and is put back as it was.
    await typeField.click();
    await typeField.fill('Product');
    const productOption = page.locator(`property-panel named-picker.type-picker .option[data-iri="${AM4}Product"]`);
    expect(await productOption.locator('.iri').count()).toBe(0);
    await page.locator('property-panel named-picker.type-picker .iri-switch input').check();
    expect(await productOption.locator('.iri').innerText()).toBe(AM4 + 'Product');
    await page.locator('property-panel named-picker.type-picker .iri-switch input').uncheck();
    await productOption.click();
    // The relationship is still not permitted: the same warning, from here too.
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.innerText()).toMatch(/Assignment → Cashier/);
    await dialog.locator('.la-button.primary').click();
    await until(async () => (await facts()).types.includes(AM4 + 'Product'), 'the product');
    expect(await typeField.inputValue()).toBe('Product');
    await typeIri.click();
    expect(await typeRow.locator('.iris').innerText()).toContain(AM4 + 'Product');
    expect(await typeRow.locator('.iris').innerText()).not.toContain(AM4 + 'BusinessObject');
    expect(await typeField.getAttribute('aria-expanded')).toBe('false');
    findings.push('change element type: right-click menu and property panel (search, current marked), default name follows, undo, not-permitted relationships named and kept: ok');
  }, 90_000);

  it('opens the right-click menu on a relationship — even over its handles — and on the empty canvas, for the view', async () => {
    const { page } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    const ids = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const [m, v] = [app.session.modelIri, app.session.activeViewIri];
      const make = (type: string, label: string, x: number) => {
        const iri = app.components.elementManager.createElement(AM4 + type, m, { label }).value;
        app.components.viewManager.addElementToView(v, iri, { x, y: 100, width: 120, height: 55 });
        return iri;
      };
      const a = make('ApplicationComponent', 'Portal', 100);
      const b = make('BusinessActor', 'Clerk', 500);
      const r = app.components.relationshipManager.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: a, targetIri: b, modelIri: m }).iri;
      app.components.viewManager.addRelationshipToView(v, r);
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return { a, b, r, v };
    });
    // The middle of the line, on the page.
    const mid = await page.evaluate((r) => {
      const d = (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram();
      const line = d.get('elementRegistry').get(r);
      const canvas = d.get('canvas');
      const vb = canvas.viewbox();
      const svg = canvas._svg.getBoundingClientRect();
      const [p, q] = [line.waypoints[0], line.waypoints[line.waypoints.length - 1]];
      return { x: svg.x + ((p.x + q.x) / 2 - vb.x) * vb.scale, y: svg.y + ((p.y + q.y) / 2 - vb.y) * vb.scale };
    }, ids.r);
    const menu = page.locator('.djs-popup.la-context-menu');
    const entries = async () => (await menu.locator('.entry').allInnerTexts()).map((t) => t.trim());

    // Hovering the line puts diagram-js's segment handles over it; the right-click still reaches the line.
    await page.mouse.move(mid.x, mid.y);
    await page.waitForTimeout(150);
    await page.mouse.click(mid.x, mid.y, { button: 'right' });
    await menu.waitFor({ state: 'visible' });
    expect(await entries()).toEqual([
      'Rename', 'Change relationship type…', 'Properties', 'Show in model tree', 'Show source', 'Show target', 'Copy IRI',
      'Delete from view', 'Delete from model…',
    ]);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });

    // The empty canvas: the open view's menu; "Select all" selects everything drawn.
    const host = (await page.locator('.la-diagram-host').boundingBox())!;
    await page.mouse.click(host.x + host.width - 80, host.y + host.height - 80, { button: 'right' });
    await menu.waitFor({ state: 'visible' });
    expect(await entries()).toEqual([
      'Rename view…', 'Set viewpoint…', 'Duplicate view', 'Arrange view…', 'Arrange relationships…', 'Align to grid…', 'Sizes…', 'Select all', 'Zoom to fit', 'View properties', 'Show in model tree',
      'Copy IRI', 'Copy view as PNG', 'Copy view as SVG', 'Export view as SVG', 'Export view as PNG', 'Delete view…',
    ]);
    // Export from it: the pictures — the notation's glyphs — in the file, and a PNG drawn with them, at twice the size.
    const exported: Record<string, Buffer> = {};
    for (const id of ['export-svg', 'export-png']) {
      if (!(await menu.isVisible())) {
        await page.mouse.click(host.x + host.width - 80, host.y + host.height - 80, { button: 'right' });
        await menu.waitFor({ state: 'visible' });
      }
      const [download] = await Promise.all([page.waitForEvent('download'), menu.locator(`.entry[data-id="${id}"]`).click()]);
      expect(download.suggestedFilename()).toMatch(id === 'export-svg' ? /\.svg$/ : /\.png$/);
      exported[id] = await readFile((await download.path())!);
    }
    const svgFile = exported['export-svg']!.toString('utf8');
    const pictures = [...svgFile.matchAll(/<image\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]!);
    expect(pictures.length).toBeGreaterThanOrEqual(2);
    expect(pictures.filter((href) => !href.startsWith('data:image/'))).toEqual([]);
    const png = exported['export-png']!;
    const [svgWidth, svgHeight] = [/<svg\b[^>]*\bwidth="(\d+)"/, /<svg\b[^>]*\bheight="(\d+)"/].map((re) => Number(svgFile.match(re)![1]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([svgWidth! * 2, svgHeight! * 2]);
    // The PNG has the glyphs drawn: the actor's badge, top right of "Clerk", is not all fill colour.
    const inked = await page.evaluate(async ({ data, box }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [image.width, image.height];
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(box.x, box.y, box.width, box.height).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! < 200) dark++;
      return dark;
    }, {
      data: png.toString('base64'),
      // Clerk is at x 500 of the drawing; the drawing's left edge is the SVG's viewBox x.
      box: await (async () => {
        const viewBox = svgFile.match(/viewBox="(-?[\d.]+) (-?[\d.]+)/)!;
        const [vx, vy] = [Number(viewBox[1]), Number(viewBox[2])];
        return { x: (500 + 120 - 26 - vx) * 2, y: (100 + 2 - vy) * 2, width: 24 * 2, height: 24 * 2 };
      })(),
    });
    expect(inked).toBeGreaterThan(20);

    // Copied rather than saved: on the clipboard, the PNG as a picture at the size of the file, the SVG as vector
    // and as its markup, with its pictures in it.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    const clipboard = async (id: string) => {
      if (!(await menu.isVisible())) {
        await page.mouse.click(host.x + host.width - 80, host.y + host.height - 80, { button: 'right' });
        await menu.waitFor({ state: 'visible' });
      }
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await menu.locator(`.entry[data-id="${id}"]`).click();
      // Read until the copy has written: the picture is drawn after the click.
      for (let attempt = 0; attempt < 60; attempt++) {
        const read = await page.evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          if (!item || item.types.length === 0) return null;
          if (item.types.length === 1 && item.types[0] === 'text/plain' && !(await (await item.getType('text/plain')).text())) return null;
          const types: Record<string, string> = {};
          for (const type of item.types) {
            const blob = await item.getType(type);
            types[type] = type === 'image/png'
              ? await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
                  reader.readAsDataURL(blob);
                })
              : await blob.text();
          }
          return types;
        });
        if (read) return read;
        await page.waitForTimeout(250);
      }
      throw new Error(`nothing on the clipboard after ${id}`);
    };
    const copiedPng = await clipboard('copy-png');
    expect(Object.keys(copiedPng)).toEqual(['image/png']);
    const pngCopy = Buffer.from(copiedPng['image/png']!, 'base64');
    expect([pngCopy.readUInt32BE(16), pngCopy.readUInt32BE(20)]).toEqual([svgWidth! * 2, svgHeight! * 2]);
    const copiedSvg = await clipboard('copy-svg');
    expect(Object.keys(copiedSvg).sort()).toEqual(['image/svg+xml', 'text/plain']);
    expect(copiedSvg['text/plain']).toMatch(/^<svg\b/);
    expect([...copiedSvg['text/plain']!.matchAll(/<image\b[^>]*\bhref="([^"]*)"/g)].every((m) => m[1]!.startsWith('data:image/'))).toBe(true);
    if (await menu.isVisible()) await page.keyboard.press('Escape');
    await page.mouse.click(host.x + host.width - 80, host.y + host.height - 80, { button: 'right' });
    await menu.waitFor({ state: 'visible' });
    await menu.locator('.entry', { hasText: 'Select all' }).click();
    // An entry that changes neither the model nor the zoom closes the menu too.
    await menu.waitFor({ state: 'hidden' });
    const selected = await page.evaluate(() =>
      (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram().get('selection').get().map((e: any) => e.id) as string[],
    );
    expect(selected).toEqual(expect.arrayContaining([ids.a, ids.b, ids.r]));

    // A click on the empty canvas: nothing selected there, so the Properties tab shows the view —
    // also when what it showed was picked in the tree, with nothing on the canvas to deselect.
    const shown = () => page.evaluate(() => {
      const panel = (window as any).__LA_GRAM_UI__.propertyPanel;
      return [panel.selectedIri, panel.heading?.kind] as [string, string];
    });
    await page.mouse.click(host.x + host.width - 80, host.y + host.height - 80);
    await until(async () => (await shown())[0] === ids.v, 'the view shown');
    expect(await shown()).toEqual([ids.v, 'View']);
    // The model, picked in the tree: not drawn, so nothing is selected on the canvas.
    const modelIri = await page.evaluate(() => {
      const iri = (window as any).__LA_GRAM_APP__.session.modelIri as string;
      (window as any).__LA_GRAM_UI__.selectConcept(iri);
      return iri;
    });
    expect(await shown()).toEqual([modelIri, 'Model']);
    await page.mouse.click(host.x + host.width - 80, host.y + host.height - 80);
    await until(async () => (await shown())[0] === ids.v, 'the view shown again');
    findings.push('right-click menu on a relationship (over its handles) and on the empty canvas, for the view; export as SVG and PNG from it, glyphs in the files: ok');
  }, 90_000);

  it('goes back to the previous view as it was left — zoom and scroll — from the toolbar or with Alt+←', async () => {
    const { page } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    const views = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const first = app.session.activeViewIri as string;
      const actor = app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#BusinessActor', app.session.modelIri, { label: 'Clerk' }).value;
      app.components.viewManager.addElementToView(first, actor, { x: 200, y: 150, width: 120, height: 55 });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return { first, second: app.session.createView('Diagram', { label: 'Elsewhere', open: false }) as string };
    });
    const canvas = () => (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram().get('canvas');
    const viewbox = () =>
      page.evaluate(() => {
        const vb = (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram().get('canvas').viewbox();
        return { x: Math.round(vb.x), y: Math.round(vb.y), scale: Math.round(vb.scale * 100) / 100 };
      });
    const active = () => page.evaluate(() => (window as any).__LA_GRAM_APP__.session.activeViewIri as string);
    void canvas;
    // Zoomed in somewhere in the first view.
    await page.evaluate(() => (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram().get('canvas').zoom(1.7, { x: 300, y: 200 }));
    const left = await viewbox();

    await page.locator('app-toolbar select[aria-label="Open view"]').selectOption(views.second);
    await until(async () => (await active()) === views.second, 'the second view');
    const back = page.locator('app-toolbar button[data-command="view-back"]');
    expect(await back.getAttribute('title')).toBe('Back to Default View (Alt+←)');
    await page.evaluate(() => (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram().get('canvas').zoom(0.6));

    await back.click();
    await until(async () => (await active()) === views.first, 'back to the first view');
    expect(await viewbox()).toEqual(left);
    // Forward with the keyboard, the canvas focused.
    await page.locator('.la-diagram-host').click({ position: { x: 600, y: 400 } });
    await page.keyboard.press('Alt+ArrowRight');
    await until(async () => (await active()) === views.second, 'forward to the second view');
    expect((await viewbox()).scale).toBe(0.6);
    findings.push('back and forward between views, as they were left: ok');
  }, 90_000);
});

describe('model questions', () => {
  it('asks about an element from its right-click menu, picks from the Questions menu, and runs the model checks', async () => {
    const { page, session } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const [actor] = (await model(page)).actors;

    // Right-click → "Ask about this element…": the SPARQL tab, the questions about it.
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    await page.locator(SHAPE).first().click({ button: 'right' });
    const context = page.locator('.djs-popup.la-context-menu');
    await context.waitFor({ state: 'visible' });
    await context.locator('.entry', { hasText: 'Ask about this element…' }).click();
    const editor = page.locator('sparql-editor');
    const menu = editor.locator('.questions-menu');
    await menu.waitFor({ state: 'visible' });
    expect(await menu.locator('.menu-title').innerText()).toMatch(/About\s+Business Actor/);
    const about = await menu.locator('button.question .q-label').allInnerTexts();
    expect(about).toEqual(expect.arrayContaining(['What is recorded about this element?', 'What is affected if this element changes?']));
    await session.screenshot('questions-about-element');
    await menu.locator('button.question', { hasText: 'What is recorded about this element?' }).click();
    await until(async () => (await editor.locator('tbody tr').count()) > 0, 'its answer');
    expect(await editor.locator('.asked').innerText()).toContain('What is recorded about this element?');
    expect(await editor.locator('tbody').innerText()).toContain('Business Actor');
    await session.screenshot('questions-element-detail');

    // The Questions menu: by stage, filterable by concern; a pick runs with the open model bound.
    await editor.locator('.questions-btn').click();
    await menu.waitFor({ state: 'visible' });
    const titles = await menu.locator('.group-title').allInnerTexts();
    expect(titles.map((t) => t.toLowerCase())).toEqual(expect.arrayContaining(['orientation', 'analysis', 'quality', 'views']));
    const all = await menu.locator('button.question').count();
    expect(all).toBe(40);
    const concern = menu.locator('select.concern');
    const firstConcern = await concern.locator('option').nth(1).getAttribute('value');
    await concern.selectOption(firstConcern!);
    await until(async () => (await menu.locator('button.question').count()) < all, 'the concern filter');
    await concern.selectOption('');
    await menu.locator('button.question', { hasText: 'Which elements take part in no relationship?' }).click();
    await until(async () => (await editor.locator('tbody tr').count()) > 0, 'the orphans');
    expect(await editor.locator('tbody').innerText()).toContain('Business Actor');
    expect(await editor.locator('.asked').innerText()).toMatch(/Does not prove:/);

    // The model checks, in the Validation tab: on request, beside the shapes' findings.
    await page.locator('app-shell .tab[data-tab="validation"]').click();
    const validation = page.locator('validation-panel');
    await validation.locator('.checks-btn').click();
    await until(async () => /Model checks: \d+ run/.test(await validation.locator('.checks-status').innerText().catch(() => '')), 'the checks');
    expect(await validation.locator('.checks-status').innerText()).toMatch(/Model checks: 14 run/);
    await validation.locator('select.scope').selectOption('model');
    await until(async () => (await validation.locator('.result-item', { hasText: 'Which elements take part in no relationship?' }).count()) > 0, 'the orphan finding');
    const finding = validation.locator('.result-item', { hasText: 'Which elements take part in no relationship?' }).first();
    expect(await finding.innerText()).toMatch(/Check: orphans/);
    // The check, as a shape is, a link to its IRI — opened apart, the finding's concept not shown for it.
    const link = finding.locator('a.shape');
    expect(await link.getAttribute('href')).toMatch(/^https:\/\/meta\.linked\.archi\/.+#orphans$/);
    expect(await link.getAttribute('target')).toBe('_blank');
    expect(await validation.locator('.result-item a.shape[href^="https://meta.linked.archi/"]').count()).toBeGreaterThan(1);
    await session.screenshot('questions-model-checks');
    expect(actor).toBeTruthy();
    findings.push('questions: asked about an element from its right-click menu, picked from the Questions menu with a concern filter, model checks listed in Validation: ok');
  });
});

describe('Basic, the generic language', () => {
  it('adds Basic from the Metamodels menu — bundled, offline — and places a Node', async () => {
    const { page, session } = await openPage();
    await page.locator('palette-panel .palette-item').first().waitFor({ state: 'attached', timeout: 30_000 });
    await page.locator('app-toolbar button[data-menu="metamodels"]').click();
    const entry = page.locator(
      'app-toolbar button[data-command="add-metamodel"][data-value="https://meta.linked.archi/basic/metamodel#Basic"]',
    );
    // The catalogue's sections that offer something, from meta.linked.archi's catalogue.
    await page
      .locator('app-toolbar button[data-command="add-metamodel"][data-value="https://meta.linked.archi/4plus1/metamodel#FourPlusOneMetamodel"]')
      .waitFor({ state: 'attached', timeout: 30_000 });
    const sections = (await page.locator('app-toolbar .dropdown .group').allInnerTexts()).map((t) => t.trim().toLowerCase());
    expect(sections).toEqual(['loaded', 'modelling languages', 'frameworks', 'extensions']);
    await entry.click();
    const node = page.locator('palette-panel .palette-item[data-iri="https://meta.linked.archi/basic#Node"]');
    await node.waitFor({ state: 'visible', timeout: 30_000 });
    expect((await node.locator('.palette-label').innerText()).trim()).toBe('Node');
    // ArchiMate has a Node too: each says which language it is from.
    expect(await node.locator('.palette-tag').innerText()).toBe('basic');
    expect(await page.locator('palette-panel .palette-item[data-iri="https://meta.linked.archi/archimate4/onto#Node"] .palette-tag').innerText()).toBe('am4');
    expect(await node.getAttribute('title')).toBe('Node — basic:Node');
    const connection = page.locator('palette-panel .palette-item[data-iri="https://meta.linked.archi/basic#Connection"]');
    expect((await connection.locator('.palette-label').innerText()).trim()).toBe('Connection');
    expect(await connection.locator('.palette-tag').count()).toBe(0);

    // Dropped on the canvas: an element typed basic:Node, named, in the view. Under
    // ArchiMate's axis, Basic's types are in "Other", at the foot of the palette, where a
    // notice may cover them: found with the palette's search, at its top.
    await page.locator('palette-panel input[type="search"]').fill('basic:Node');
    await node.scrollIntoViewIfNeeded();
    const box = (await node.boundingBox())!;
    const host = (await page.locator('.la-diagram-host').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(host.x + 260, host.y + 200, { steps: 8 });
    await page.mouse.move(host.x + 300, host.y + 200, { steps: 8 });
    await page.mouse.up();
    const created = async () =>
      page.evaluate(() => {
        const app = (window as any).__LA_GRAM_APP__;
        const store = app.components.store;
        const typed = store.getQuads(null, { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }, {
          termType: 'NamedNode',
          value: 'https://meta.linked.archi/basic#Node',
        }).filter((q: any) => q.graph.termType === 'DefaultGraph');
        return typed.map((q: any) => ({
          iri: q.subject.value,
          types: store.getQuads(q.subject, { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }).map((t: any) => t.object.value),
          nodes: app.components.viewManager.getNodes(app.session.activeViewIri).filter((n: any) => n.elementIri === q.subject.value).length,
        }));
      });
    await until(async () => (await created()).length === 1, 'the Node');
    const [made] = await created();
    expect(made.types).toEqual(['https://meta.linked.archi/basic#Node']);
    expect(made.nodes).toBe(1);
    // Selected, the guide under the tree says what a Node is.
    const guide = page.locator('type-guide-panel');
    await until(async () => (await guide.locator('.header .title').innerText()) === 'About Node', 'the guide');
    await session.screenshot('workbench-basic-node');
    findings.push('Basic: added from the menu (bundled), Node dropped as basic:Node: ok');
  }, 60_000);
});

describe('metamodels from the network', () => {
  it('loads a published metamodel that is not bundled (C4) and offers its types', async () => {
    const online = await fetch('https://meta.linked.archi/c4/metamodel', { headers: { Accept: 'text/turtle' } })
      .then((r) => r.ok)
      .catch(() => false);
    if (!online) {
      findings.push('network metamodel: skipped (meta.linked.archi unreachable)');
      return;
    }
    const { page } = await openPage();
    await page.locator('app-toolbar button[data-menu="metamodels"]').click();
    await page
      .locator('app-toolbar button[data-command="add-metamodel"][data-value="https://meta.linked.archi/c4/metamodel#C4Model"]')
      .click();
    await until(
      () =>
        page.evaluate(() =>
          (window as any).__LA_GRAM_UI__.palettePanel.palette.elementGroups
            .flatMap((g: any) => g.elements)
            .some((e: any) => e.iri.startsWith('https://meta.linked.archi/c4/')),
        ),
      'C4 types in the palette',
      30_000,
    );
    const assets = await page.evaluate(() =>
      (window as any).__LA_GRAM_APP__.loadedMetamodels().flatMap((m: any) => m.assets.map((a: any) => `${a.outcome}:${a.origin ?? ''}`)),
    );
    expect(assets).toContain('loaded:remote');
    findings.push(`network metamodel C4: ${assets.filter((a: string) => a === 'loaded:remote').length} documents fetched live`);
  }, 60_000);
});

describe('version history', () => {
  it('saves a checkpoint of the model from the History tab and keeps it in IndexedDB', async () => {
    const { page, session } = await openPage();
    await page.locator('app-shell .tab[data-tab="history"]').click();
    // A checkpoint, not a commit: "commit" is Git's (Save to Git).
    const button = page.locator('history-panel button.commit');
    expect((await button.innerText()).trim()).toBe('Save checkpoint');
    expect(await button.getAttribute('title')).toMatch(/not a Git commit/);
    expect(await page.locator('history-panel .status').innerText()).toMatch(/No checkpoints yet/);
    await page.locator('history-panel input.commit-message').fill('First version');
    await button.click();
    await until(async () => (await page.locator('history-panel li[data-commit]').count()) === 1, 'the commit listed');
    expect(await page.locator('history-panel li[data-commit] .message').innerText()).toBe('First version');
    await page.locator('history-panel li[data-commit]').click();
    expect((await page.locator('history-panel button.restore').innerText()).trim()).toBe('Restore this checkpoint');
    await session.screenshot('workbench-history-checkpoint');
    // Nothing changed since: the button waits for a change.
    expect(await page.locator('history-panel button.commit').isDisabled()).toBe(true);

    const stored = await page.evaluate(async () => {
      const modelIri = (window as any).__LA_GRAM_APP__.session.modelIri as string;
      // The release's la-gram-history; a channel's build its own, la-gram-history-alpha (storage-scope.ts).
      const names = (await indexedDB.databases()).map((d) => d.name ?? '');
      const name = names.find((n) => n.startsWith('la-gram-history')) ?? 'la-gram-history';
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const all = await new Promise<any[]>((resolve, reject) => {
        const request = db.transaction('commits').objectStore('commits').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return all.filter((c) => c.modelIri === modelIri).map((c) => ({ message: c.message, triples: c.triples.length }));
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].message).toBe('First version');
    expect(stored[0].triples).toBeGreaterThan(0);
    findings.push(`history: a commit of ${stored[0].triples} triples kept in IndexedDB`);
  }, 60_000);

  it('scrolls a long history: the checkpoints and the one selected each scroll, the message field stays', async () => {
    const { page, session } = await openPage();
    await page.locator('app-shell .tab[data-tab="history"]').click();
    // Its own (empty) history read first, so it does not replace what is set below.
    await until(async () => /No checkpoints yet/.test(await page.locator('history-panel .status').innerText()), 'the history read');
    await page.waitForTimeout(300);
    // Forty checkpoints, each adding a triple, in a bottom panel of its usual height.
    await page.evaluate(() => {
      const ui = (window as any).__LA_GRAM_UI__;
      const modelIri = (window as any).__LA_GRAM_APP__.session.modelIri as string;
      const triples: string[] = [];
      ui.historyPanel.commits = Array.from({ length: 40 }, (_, i) => {
        triples.push(`<urn:x:e${i}> <http://www.w3.org/2000/01/rdf-schema#label> "Element ${i}" .`);
        return {
          id: `${String(1000 + i)}-test`,
          modelIri,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
          message: `Checkpoint ${i + 1}`,
          ...(i > 0 ? { parent: `${String(1000 + i - 1)}-test` } : {}),
          triples: [...triples],
        };
      }).reverse();
    });
    const list = page.locator('history-panel ul.commits');
    await until(async () => (await page.locator('history-panel li[data-commit]').count()) === 40, 'forty checkpoints listed');
    const box = (selector: string) => page.locator(selector).first().boundingBox();
    const input = await box('history-panel input.commit-message');

    // The list is taller than its room, and scrolls to its oldest checkpoint, which then shows.
    const sizes = await list.evaluate((ul) => ({ scroll: ul.scrollHeight, client: ul.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    await list.evaluate((ul) => (ul.scrollTop = ul.scrollHeight));
    const oldest = page.locator('history-panel li[data-commit]').last();
    expect(await oldest.locator('.message').innerText()).toBe('Checkpoint 1');
    const [listBox, oldestBox] = [await list.boundingBox(), await oldest.boundingBox()];
    expect(oldestBox!.y + oldestBox!.height).toBeLessThanOrEqual(listBox!.y + listBox!.height + 1);
    // The panel itself did not scroll: the message field is where it was.
    expect((await box('history-panel input.commit-message'))!.y).toBe(input!.y);

    // The one selected — the oldest, with its forty-odd added triples — scrolls on its own.
    await oldest.click();
    const detail = page.locator('history-panel .detail');
    await detail.waitFor({ state: 'visible' });
    const overflowY = await detail.evaluate((d) => getComputedStyle(d).overflowY);
    expect(overflowY).toBe('auto');
    await session.screenshot('workbench-history-scrolled');
    findings.push(`history: 40 checkpoints scroll (${sizes.scroll}px in ${sizes.client}px), the message field stays: ok`);
  }, 60_000);
});

describe('collaboration: two pages, one room', () => {
  let collab: ChildProcess;
  let dataDir: string;
  const port = 14000 + Math.floor(Math.random() * 1000);
  let a: Page;
  let b: Page;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'la-gram-rooms-'));
    collab = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server/collab-server.mjs')], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('collab server did not start')), 15_000);
      collab.stdout!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('ws://')) {
          clearTimeout(timer);
          resolve();
        }
      });
      collab.on('exit', (code) => reject(new Error(`collab server exited ${code}`)));
    });
    const query = `?room=e2e&ws=ws://localhost:${port}`;
    ({ page: a } = await openPage(`${query}&user=Ana`));
    await until(() => a.evaluate(() => (window as any).__LA_GRAM_COLLAB__.isConnected()), 'A connected');
    ({ page: b } = await openPage(`${query}&user=Ben`));
    await until(() => b.evaluate(() => (window as any).__LA_GRAM_COLLAB__.isConnected()), 'B connected');
  }, 120_000);

  afterAll(async () => {
    collab?.kill();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('B joins A’s room and receives A’s model', async () => {
    const [ma, mb] = [await model(a), await model(b)];
    expect(mb.views).toEqual(ma.views);
    // …and shows it: the view selector names the room's view.
    await until(
      async () => (await b.locator('app-toolbar select[aria-label="Open view"]').inputValue()) === mb.activeView,
      'B’s view selector',
    );
  });

  it('an element created on A appears on B’s canvas and tree', async () => {
    await dropActor(a, 320, 220);
    await until(async () => (await model(b)).actors.length === 1, 'the actor on B');
    const [actor] = (await model(b)).actors;
    await b.locator(`.djs-element[data-element-id="${actor}"], ${SHAPE}`).first().waitFor({ state: 'attached' });
    expect(await b.locator(SHAPE).count()).toBe(1);
    expect(await b.locator(`model-explorer .row[data-iri="${actor}"]`).count()).toBe(1);
  });

  it('shows the other collaborator, and locks what they have selected', async () => {
    await until(async () => (await a.locator('app-toolbar .peer').count()) === 1, 'B’s avatar on A');
    // A selects the shape; B sees it locked. Click empty canvas first: the
    // shape is still selected from its creation, and diagram-js toggles a
    // selected element *off* on click.
    const host = await a.locator('.la-diagram-host').boundingBox();
    await a.mouse.click(host!.x + 20, host!.y + host!.height - 20);
    await a.locator(SHAPE).first().click();
    await until(async () => (await b.locator('.djs-element.la-locked').count()) === 1, 'the lock on B');
    // …and B cannot move it.
    const locked = await b.locator(SHAPE).first().boundingBox();
    await b.mouse.move(locked!.x + locked!.width / 2, locked!.y + locked!.height / 2);
    await b.mouse.down();
    await b.mouse.move(locked!.x + 200, locked!.y + 100, { steps: 8 });
    await b.mouse.up();
    const after = await b.locator(SHAPE).first().boundingBox();
    expect(Math.round(after!.x)).toBe(Math.round(locked!.x));
    findings.push('presence: avatars + remote selection lock: ok');
  });

  it('a rename on B reaches A', async () => {
    const [actor] = (await model(b)).actors;
    await b.evaluate((iri) => {
      const app = (window as any).__LA_GRAM_APP__;
      app.components.eventBus.emit('property-edited', {
        elementIri: iri,
        property: 'http://www.w3.org/2004/02/skos/core#prefLabel',
        value: 'Customer',
      });
    }, actor);
    await until(
      () => a.evaluate((iri) => (window as any).__LA_GRAM_UI__.diagramCanvas.getElement(iri)?.label === 'Customer', actor),
      'the new label on A',
    );
  });

  it('the server persists the room as N-Triples and Turtle', async () => {
    await until(async () => {
      try {
        return (await readFile(path.join(dataDir, 'e2e.ttl'), 'utf8')).includes('Customer');
      } catch {
        return false;
      }
    }, 'the persisted room', 20_000);
    const nt = await readFile(path.join(dataDir, 'e2e.nt'), 'utf8');
    expect(nt).toContain('<https://meta.linked.archi/core#inModel>');
    const response = await fetch(`http://localhost:${port}/rooms/e2e.ttl`);
    expect(await response.text()).toContain('Customer');
    await sessions.at(-1)!.screenshot('workbench-collab-B');
    findings.push('collab server persistence + HTTP /rooms/e2e.ttl: ok');
  });
});

describe('two selected elements, and catalog and matrix views', () => {
  let page: Page;

  beforeAll(async () => {
    ({ page } = await openPage());
  }, 120_000);

  it('a two-element selection offers "Connect these two…", which creates the relationship picked', async () => {
    await dropActor(page, 250, 200);
    await dropActor(page, 550, 200);
    await until(async () => (await model(page)).actors.length === 2, 'two actors');
    const shapes = page.locator(SHAPE);
    const first = (await shapes.nth(0).boundingBox())!;
    // Clear the selection, then select both: a click, and a shift-click.
    await page.mouse.click(first.x + first.width + 120, first.y + first.height + 200);
    await shapes.nth(0).click();
    await shapes.nth(1).click({ modifiers: ['Shift'] });

    const entry = page.locator('.djs-context-pad [data-action="connect-pair"]');
    await entry.waitFor({ state: 'visible' });
    await entry.click();
    const menu = page.locator('.djs-popup');
    await menu.waitFor({ state: 'visible' });
    // Both directions; the derived-only ones say so.
    expect(await menu.locator('.entry').count()).toBeGreaterThan(4);
    expect(await menu.innerText()).toContain('only by derivation');
    await menu.locator('.entry', { hasText: 'Aggregation' }).first().click();

    await until(
      async () =>
        page.evaluate(() => {
          const store = (window as any).__LA_GRAM_APP__.components.store;
          return store.getQuads(null, { termType: 'NamedNode', value: 'https://meta.linked.archi/core#source' }).length === 1;
        }),
      'the relationship',
    );
    expect(await page.locator('.djs-container .djs-connection').count()).toBe(1);
    findings.push('two selected → Connect these two… → relationship: ok');
  });

  it('a catalog lists the elements added to it, by type', async () => {
    await page.locator('app-toolbar button[data-menu="new-view"]').click();
    await page.locator('app-toolbar button[data-command="new-view"][data-value="Catalog"]').click();
    await answerPrompt(page, 'People');
    const chooser = page.locator('.la-dialog .la-choice-list');
    if (await chooser.isVisible().catch(() => false)) await page.locator('.la-dialog .la-button.primary').click();

    const catalog = page.locator('catalog-view');
    await catalog.waitFor({ state: 'visible' });
    expect(await catalog.locator('.empty-message').innerText()).toContain('lists no elements yet');
    await catalog.locator('.view-add select').selectOption({ label: 'Business Actor (2)' });
    await until(async () => (await catalog.locator('tbody tr').count()) === 2, 'two rows');
    expect(await catalog.locator('.type-header').innerText()).toBe('Business Actor (2)');
    findings.push('catalog: lists its members by type, adds from the picker: ok');
  });
});

describe('the model tree makes elements and views in a folder (Req 10.16)', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  /** Right-click a row of the model tree, then pick `action` in its menu. */
  async function treeMenu(row: ReturnType<Page['locator']>, action: string): Promise<void> {
    await row.click({ button: 'right' });
    await page.locator(`model-explorer .menu button[data-action="${action}"]`).click();
  }

  /** The folders an IRI is filed in (`dcterms:isPartOf`). */
  const filedIn = (iri: string) =>
    page.evaluate((member) => {
      const store = (window as any).__LA_GRAM_APP__.components.store;
      return store
        .getQuads({ termType: 'NamedNode', value: member }, { termType: 'NamedNode', value: 'http://purl.org/dc/terms/isPartOf' })
        .map((q: any) => q.object.value) as string[];
    }, iri);

  it('New element… on a folder of elements: a type, a name — the element in the folder, in no view', async () => {
    await treeMenu(page.locator('model-explorer .row[data-id="folder:elements"]'), 'new-folder');
    await answerPrompt(page, 'People');
    const folder = page.locator('model-explorer .row[data-kind="folder"][data-id^="folder-iri:element:"]', { hasText: 'People' });
    await folder.waitFor({ state: 'visible' });
    const folderIri = (await folder.getAttribute('data-iri'))!;

    await treeMenu(folder, 'new-element');
    await page.locator(`.la-dialog .la-choice[data-value="${BUSINESS_ACTOR}"]`).click();
    await page.locator('.la-dialog .la-button.primary').click();
    await page.locator('.la-dialog .la-choice-list').waitFor({ state: 'detached' });
    // The name offered is the type's.
    await expect(page.locator('.la-dialog input.la-input').inputValue()).resolves.toBe('Business Actor');
    await answerPrompt(page, 'Customer');

    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const m = await model(page);
    const customer = m.actors[0];
    expect(m.nodesIn['Default View']).toEqual([]);
    expect(await filedIn(customer)).toEqual([folderIri]);
    // The tree opens the folder and selects the element, to be dragged onto a diagram.
    const row = page.locator(`model-explorer .row[data-iri="${customer}"]`);
    await row.waitFor({ state: 'visible' });
    expect(await row.getAttribute('class')).toContain('selected');
    // Its row is in the folder's: the row of the list item around its own.
    const parent = await row.evaluate((r) => r.closest('li')?.parentElement?.closest('li')?.querySelector(':scope > .row')?.getAttribute('data-iri'));
    expect(parent).toBe(folderIri);
    await session.screenshot('workbench-tree-new-element');
    findings.push('tree: New element… on a folder → type, name → in the folder, in no view: ok');
  });

  it('New catalog view on a folder of views: named, filed there and opened', async () => {
    await treeMenu(page.locator('model-explorer .row[data-id="folder:views"]'), 'new-folder');
    await answerPrompt(page, 'Overviews');
    const folder = page.locator('model-explorer .row[data-kind="folder"][data-id^="folder-iri:view:"]', { hasText: 'Overviews' });
    await folder.waitFor({ state: 'visible' });
    const folderIri = (await folder.getAttribute('data-iri'))!;

    await treeMenu(folder, 'new-catalog');
    await answerPrompt(page, 'All customers');
    const chooser = page.locator('.la-dialog .la-choice-list');
    if (await chooser.isVisible().catch(() => false)) await page.locator('.la-dialog .la-button.primary').click();

    await page.locator('catalog-view').waitFor({ state: 'visible' });
    const m = await model(page);
    const catalog = m.views.find((v) => v.label === 'All customers')!;
    expect(m.activeView).toBe(catalog.iri);
    expect(await filedIn(catalog.iri)).toEqual([folderIri]);
    findings.push('tree: New catalog view on a folder → named, filed, opened: ok');
  });
});

describe('Git storage, a switchable module (Req 18.1)', () => {
  it('on: File › Git offers Save to Git…, and File Settings…; the dialog asks for the token unseen', async () => {
    const { page, session } = await openPage();
    await page.locator('app-toolbar button[data-menu="file"]').click();
    await page.locator('app-toolbar button[data-submenu="module-git"]').click();
    const save = page.locator('app-toolbar button[data-command="module"][data-value="git:save"]');
    await save.waitFor({ state: 'visible' });
    expect(await save.innerText()).toContain('Save to Git…');
    expect(await page.locator('app-toolbar button[data-command="settings"]').count()).toBe(1);

    await save.click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('select[name="provider"]').count()).toBe(1);
    expect(await dialog.locator('input[name="path"]').inputValue()).toMatch(/^models\/.+\.ttl$/);
    await dialog.locator('input[name="repository"]').fill('https://github.com/acme/arch');
    await dialog.locator('.la-button.primary').click();

    const token = page.locator('.la-dialog input[name="token"]');
    await token.waitFor({ state: 'visible' });
    expect(await token.getAttribute('type')).toBe('password');
    expect(await token.getAttribute('autocomplete')).toBe('off');
    expect(await page.locator('.la-dialog').innerText()).toContain('sends it to github.com only');
    await session.screenshot('workbench-git-token');
    await page.keyboard.press('Escape');
    await page.locator('.la-dialog').waitFor({ state: 'detached' });
    findings.push('git: Save to Git… → the address → the token, typed unseen: ok');
  });

  it('on: File › Git offers Open from Git…, first; a link to a repository asks for the branch it lists', async () => {
    const { page } = await openPage();
    await page.locator('app-toolbar button[data-menu="file"]').click();
    await page.locator('app-toolbar button[data-submenu="module-git"]').click();
    const open = page.locator('app-toolbar button[data-command="module"][data-value="git:open"]');
    await open.waitFor({ state: 'visible' });
    expect(await open.innerText()).toContain('Open from Git…');
    await open.click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('input[name="repository"]').count()).toBe(1);
    expect(await dialog.locator('input[name="branch"]').count()).toBe(1);
    await page.keyboard.press('Escape');
    await page.locator('.la-dialog').waitFor({ state: 'detached' });
    findings.push('git: Open from Git… → the address dialog: ok');
  });

  /** A page whose deployment serves `la-gram.config.json` with `body`. */
  async function openConfigured(body: string): Promise<{ session: BrowserSession; page: Page }> {
    const session = await openSession();
    sessions.push(session);
    await session.page.route('**/la-gram.config.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body }),
    );
    await session.page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'load' });
    await waitForAppReady(session.page);
    return { session, page: session.page };
  }

  it('a deployment that makes Git unavailable: nothing of it, nor a switch to turn it on', async () => {
    const { page } = await openConfigured(JSON.stringify({ modules: { git: 'unavailable' } }));
    await page.locator('app-toolbar button[data-menu="file"]').click();
    await page.locator('app-toolbar button[data-command="save"]').waitFor({ state: 'visible' });
    expect(await page.locator('app-toolbar button[data-submenu="module-git"]').count()).toBe(0);
    expect(await page.locator('app-toolbar button[data-command="module"]').count()).toBe(0);
    // Settings has la-gram's own (Metamodels, You), but no Git section and no switch to turn Git on.
    await page.locator('app-toolbar button[data-command="settings"]').click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('.la-form-tab').allInnerTexts()).toEqual(['Metamodels', 'You']);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    findings.push('config: git unavailable → no entries, no switch: ok');
  });

  it('a configuration that fails its check: said, and Git storage off (fails closed)', async () => {
    const { page } = await openConfigured('{ "git": { "rememberTokens": "always" } }');
    await page.locator('.la-toast.error').first().waitFor({ state: 'visible' });
    expect(await page.locator('.la-toast.error').first().innerText()).toMatch(/rememberTokens must be "ask" or "never".*Git storage is off/);
    await page.locator('app-toolbar button[data-menu="file"]').click();
    expect(await page.locator('app-toolbar button[data-submenu="module-git"]').count()).toBe(0);
    expect(await page.locator('app-toolbar button[data-command="module"]').count()).toBe(0);
    findings.push('config: a failed check → said, Git off: ok');
  });

  it('a hosts list: the Save dialog names it, and refuses another host', async () => {
    const { page } = await openConfigured(
      JSON.stringify({ git: { hosts: [{ host: 'git.acme.example', kind: 'gitlab' }], defaults: { folder: 'architecture' } } }),
    );
    await page.locator('app-toolbar button[data-menu="file"]').click();
    await page.locator('app-toolbar button[data-submenu="module-git"]').click();
    const save = page.locator('app-toolbar button[data-command="module"][data-value="git:save"]');
    await save.waitFor({ state: 'visible' });
    await save.click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.innerText()).toContain('This installation allows git.acme.example');
    expect(await dialog.locator('input[name="path"]').inputValue()).toMatch(/^architecture\/.+\.ttl$/);
    await dialog.locator('input[name="repository"]').fill('https://github.com/acme/arch');
    await dialog.locator('.la-button.primary').click();
    const error = dialog.locator('.la-dialog-error');
    await error.waitFor({ state: 'visible' });
    expect(await error.innerText()).toContain('github.com is not one of the Git hosts this installation allows: git.acme.example.');
    await page.keyboard.press('Escape');
    findings.push('config: hosts list → named, another host refused in the dialog: ok');
  });

  it('File › Settings…: Git’s section and the modules’; what the deployment sets is shown fixed', async () => {
    const { page, session } = await openConfigured(
      JSON.stringify({ git: { hosts: [{ host: 'git.acme.example', kind: 'gitlab' }], rememberTokens: 'never' } }),
    );
    await page.locator('app-toolbar button[data-menu="file"]').click();
    const settings = page.locator('app-toolbar button[data-command="settings"]');
    await settings.waitFor({ state: 'visible' });
    // The Git section is there once the module has started.
    await page.locator('app-toolbar button[data-submenu="module-git"]').waitFor({ state: 'visible' });
    await settings.click();
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible' });
    // A tab per part; Git's fields in its own.
    expect(await dialog.locator('.la-form-tab').allInnerTexts()).toEqual(['Metamodels', 'You', 'Git storage', 'Modules']);
    expect(await dialog.locator('input[name="git.folder"]').isVisible()).toBe(false);
    await dialog.locator('.la-form-tab', { hasText: 'Git storage' }).click();
    const hosts = dialog.locator('input[name="git.hosts"]');
    expect(await hosts.isDisabled()).toBe(true);
    expect(await hosts.inputValue()).toBe('git.acme.example (GitLab)');
    expect(await dialog.locator('input[name="git.remember"]').isDisabled()).toBe(true);
    await dialog.locator('input[name="git.folder"]').fill('architecture');
    await session.screenshot('workbench-settings');
    await dialog.locator('.la-button.primary').click();
    await page.locator('.la-dialog').waitFor({ state: 'detached' });
    const kept = await page.evaluate(() => localStorage.getItem('la-gram:settings'));
    expect(JSON.parse(kept!)).toEqual({ git: { folder: 'architecture' } });
    findings.push('settings: Git and Modules sections, the deployment’s values fixed, a default kept: ok');
  });

  it('?git=off: nothing of it in the File menu, and its code never fetched', async () => {
    const { page } = await openPage('?git=off');
    await page.locator('app-toolbar button[data-menu="file"]').click();
    await page.locator('app-toolbar button[data-command="settings"]').waitFor({ state: 'visible' });
    expect(await page.locator('app-toolbar button[data-submenu="module-git"]').count()).toBe(0);
    expect(await page.locator('app-toolbar button[data-command="module"]').count()).toBe(0);
    const fetched = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((name) => /\/git\.[0-9a-f]+\.js$/.test(name)),
    );
    expect(fetched).toEqual([]);
    findings.push('git: ?git=off → no entries, no chunk fetched: ok');
  });
});

describe('figures from the toolbar: groups, notes, shapes', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  /** The open view's figures, through the app's API. */
  const figures = async () =>
    page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      return app.components.viewManager
        .getNodes(app.session.activeViewIri)
        .filter((n: any) => n.figure)
        .map((n: any) => ({ iri: n.elementIri, kind: n.figure.kind, text: n.figure.text, parent: n.parentElementIri }));
    }) as Promise<Array<{ iri: string; kind: string; text?: string; parent?: string }>>;

  /** Press a figure's button in the toolbar's second row and drag it onto the canvas. */
  const dropFigure = async (figure: string, dx: number, dy: number) => {
    const button = await page.locator(`canvas-toolbar .figures button[data-figure="${figure}"]`).boundingBox();
    const host = await page.locator('.la-diagram-host').boundingBox();
    await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2);
    await page.mouse.down();
    await page.mouse.move(host!.x + dx - 40, host!.y + dy, { steps: 8 });
    await page.mouse.move(host!.x + dx, host!.y + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  };

  it('the Shapes switch opens a row of figures, remembered; a note is dragged on, drawn and kept in the view', async () => {
    expect(await page.locator('canvas-toolbar .figures').count()).toBe(0);
    await page.locator('canvas-toolbar button[data-switch="figures"]').click();
    const buttons = await page.locator('canvas-toolbar .figures button').evaluateAll((all) => all.map((b) => b.getAttribute('data-figure')));
    expect(buttons).toEqual(['group', 'note', 'Rectangle', 'RoundedRectangle', 'Ellipse', 'Circle', 'Diamond', 'Hexagon', 'Octagon', 'Parallelogram']);
    expect(await page.evaluate(() => localStorage.getItem('la-gram:canvas-figures'))).toBe('true');

    await dropFigure('note', 600, 120);
    const [note] = await figures();
    expect(note).toMatchObject({ kind: 'note' });
    expect(await page.locator(`.djs-shape[data-element-id="${note!.iri}"] [data-figure="note"]`).count()).toBe(1);
  });

  it('a note is renamed on the canvas: its text is written and drawn; selected, the panels show it without errors', async () => {
    const [note] = await figures();
    const shape = page.locator(`.djs-shape[data-element-id="${note!.iri}"]`);
    await shape.dblclick();
    const editor = page.locator('.djs-direct-editing-content');
    await editor.waitFor({ state: 'visible' });
    await page.keyboard.type('Ask the CFO');
    await page.locator('.la-diagram-host').click({ position: { x: 20, y: 400 } });
    await until(async () => (await figures())[0]?.text === 'Ask the CFO', 'the note’s text written');
    expect(await shape.locator('[data-figure="note"]').textContent()).toBe('Ask the CFO');

    await shape.click();
    await page.waitForTimeout(200);
    // Selected, the panel shows its text, and its look in an Appearance tab — no definition, no type.
    const panel = page.locator('property-panel');
    await expect(panel.locator('.panel-header').textContent()).resolves.toContain('Note');
    expect(await panel.getByText('Definition').count()).toBe(0);
    expect((await panel.locator('.vtab .vtab-name').allInnerTexts()).map((t) => t.trim())).toEqual(['Note information', 'Appearance', 'Image']);
    await panel.locator('.vtab[data-tab="appearance"]').click();
    expect(await panel.locator('.appearance-field').count()).toBe(11);
    await panel.locator('.appearance-field[data-field="fillColor"] input').evaluate((input: HTMLInputElement) => {
      input.value = '#ffd6e0';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(
      async () => (await shape.locator('.la-shape-body').getAttribute('fill')) === '#ffd6e0',
      'the note drawn in its new colour',
    );
    await session.screenshot('workbench-appearance');
    expect((await figures())[0]).toMatchObject({ kind: 'note' });
    expect(session.diagnostics.pageErrors).toEqual([]);
  });

  it('a group holds an element dropped into it, and an ellipse is drawn as one', async () => {
    await dropFigure('group', 300, 300);
    const group = (await figures()).find((f) => f.kind === 'group')!;
    await dropActor(page, 300, 320);
    const m = await model(page);
    const actor = m.actors[m.actors.length - 1]!;
    const parent = await page.evaluate(
      (iri) => {
        const app = (window as any).__LA_GRAM_APP__;
        return app.components.viewManager.getNode(app.session.activeViewIri, iri)?.parentElementIri;
      },
      actor,
    );
    expect(parent).toBe(group.iri);

    await dropFigure('Ellipse', 800, 400);
    const ellipse = (await figures()).find((f) => f.kind === 'shape')!;
    expect(await page.locator(`.djs-shape[data-element-id="${ellipse.iri}"] [data-figure="shape"] ellipse`).count()).toBe(1);
    expect(session.diagnostics.pageErrors).toEqual([]);
    expect(session.diagnostics.unexpectedConsoleErrors).toEqual([]);
  });

  it('a line drawn from the note to an element with the pad stands for no relationship; selected, the panel says what it joins', async () => {
    const note = (await figures()).find((f) => f.kind === 'note')!;
    const m = await model(page);
    const actor = m.actors[m.actors.length - 1]!;
    const relationshipsOf = () =>
      page.evaluate((iri) => {
        const app = (window as any).__LA_GRAM_APP__;
        return app.components.relationshipManager.getRelationshipsOf(iri).length as number;
      }, actor);
    const before = await relationshipsOf();

    const noteShape = page.locator(`.djs-shape[data-element-id="${note.iri}"]`);
    await noteShape.click({ position: { x: 20, y: 60 } });
    const connect = page.locator('.djs-context-pad .context-pad-connect');
    await connect.waitFor({ state: 'visible' });
    // Clicked, the pad's connect follows the pointer to the click on the target.
    await connect.click();
    const to = await page.locator(`.djs-shape[data-element-id="${actor}"]`).boundingBox();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(450);

    const connectors = () =>
      page.evaluate(() => {
        const app = (window as any).__LA_GRAM_APP__;
        return app.components.viewManager
          .getLinks(app.session.activeViewIri)
          .filter((l: any) => l.connector)
          .map((l: any) => ({ iri: l.linkIri, from: l.sourceElementIri, to: l.targetElementIri }));
      }) as Promise<Array<{ iri: string; from: string; to: string }>>;
    await until(async () => (await connectors()).length === 1, 'the note’s line written in the view');
    const [line] = await connectors();
    expect(line).toMatchObject({ from: note.iri, to: actor });
    expect(await relationshipsOf()).toBe(before);
    expect(await page.locator(`.djs-connection[data-element-id="${line!.iri}"] .la-connector`).count()).toBe(1);

    await page.evaluate((iri) => {
      (window as any).__LA_GRAM_UI__.diagramCanvas.reveal(iri);
    }, line!.iri);
    await page.waitForTimeout(200);
    const panel = page.locator('property-panel');
    await until(async () => ((await panel.locator('.panel-header').textContent()) ?? '').includes('Line'), 'the panel showing the line');
    // Its look the Appearance tab's — open, as the note's was: the tab is kept from one selection to the next.
    expect((await panel.locator('.vtab .vtab-name').allInnerTexts()).map((t) => t.trim())).toEqual(['Line information', 'Appearance']);
    expect(await panel.locator('.appearance-field').evaluateAll((fields) => fields.map((f) => f.getAttribute('data-field')))).toEqual([
      'lineColor',
      'lineWidth',
      'lineOpacity',
      'lineStyle',
      'sourceDecor',
      'targetDecor',
      'labelAnchor',
      'font',
      'fontColor',
    ]);
    // Dotted, a filled arrow at its end: drawn so.
    const drawnLine = page.locator(`.djs-connection[data-element-id="${line!.iri}"] .la-connector`);
    expect(await drawnLine.getAttribute('data-line-style')).toBe('DashedLine');
    const pick = (field: string, value: string) =>
      panel.locator(`.appearance-field[data-field="${field}"] select`).evaluate((select: HTMLSelectElement, v) => {
        select.value = v;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    await pick('lineStyle', 'DottedLine');
    await until(async () => (await drawnLine.getAttribute('data-line-style')) === 'DottedLine', 'the line dotted');
    await pick('targetDecor', 'ClosedArrowhead');
    await until(async () => ((await drawnLine.getAttribute('marker-end')) ?? '').includes('ClosedArrowhead'), 'an arrowhead at its end');
    expect(await drawnLine.getAttribute('marker-start')).toBeNull();
    await panel.locator('.vtab[data-tab="info"]').click();
    expect(await panel.locator('.line-note').textContent()).toContain('Ask the CFO');

    // What it says, typed on it: its skos:prefLabel, drawn at its middle, shown as its Text.
    const mid = await page.evaluate((iri) => {
      const d = (window as any).__LA_GRAM_UI__.diagramCanvas.getDiagram();
      const drawn = d.get('elementRegistry').get(iri);
      const canvas = d.get('canvas');
      const vb = canvas.viewbox();
      const svg = canvas._svg.getBoundingClientRect();
      const [p, q] = [drawn.waypoints[0], drawn.waypoints[drawn.waypoints.length - 1]];
      return { x: svg.x + ((p.x + q.x) / 2 - vb.x) * vb.scale, y: svg.y + ((p.y + q.y) / 2 - vb.y) * vb.scale };
    }, line!.iri);
    const editor = page.locator('.djs-direct-editing-content');
    await page.mouse.dblclick(mid.x, mid.y);
    await editor.waitFor({ state: 'visible' });
    expect(await editor.innerText()).toBe('');
    await page.keyboard.type('asks first');
    await page.keyboard.press('Enter');
    await editor.waitFor({ state: 'hidden' });
    const said = () =>
      page.evaluate((iri) => {
        const app = (window as any).__LA_GRAM_APP__;
        return app.components.viewManager.getLinks(app.session.activeViewIri).find((l: any) => l.linkIri === iri)?.text;
      }, line!.iri);
    await until(async () => (await said()) === 'asks first', 'the line’s text in the view');
    const drawnText = page.locator(`.djs-connection[data-element-id="${line!.iri}"] .la-connection-label tspan`);
    await until(async () => (await drawnText.allTextContents()).join(' ') === 'asks first', 'the text on the line');
    await page.evaluate((iri) => {
      (window as any).__LA_GRAM_UI__.diagramCanvas.reveal(iri);
    }, line!.iri);
    const textField = panel.locator('.property-list .property-row .property-value');
    await until(async () => (await textField.count()) === 1 && (await textField.inputValue()) === 'asks first', 'the line’s Text field');
    expect(await panel.locator('.property-list').textContent()).toContain('Text');
    await session.screenshot('workbench-figures');
    expect(session.diagnostics.pageErrors).toEqual([]);
    expect(session.diagnostics.unexpectedConsoleErrors).toEqual([]);
  });
});

describe('an element placed twice in one view', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  /** Drag a model tree row onto the canvas at an offset. */
  const dragFromTree = async (iri: string, dx: number, dy: number) => {
    const row = await page.locator(`model-explorer .row[data-iri="${iri}"]`).boundingBox();
    const host = await page.locator('.la-diagram-host').boundingBox();
    await page.mouse.move(row!.x + 40, row!.y + row!.height / 2);
    await page.mouse.down();
    await page.mouse.move(row!.x + 60, row!.y + row!.height / 2, { steps: 4 });
    await page.mouse.move(host!.x + dx, host!.y + dy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  };

  it('dragged from the tree again, it is placed again; selected in the tree, both placements are', async () => {
    await dropActor(page, 200, 150);
    const [actor] = (await model(page)).actors;
    await dragFromTree(actor!, 500, 350);
    await until(async () => ((await model(page)).nodesIn['Default View'] ?? []).length === 2, 'the second placement');
    expect((await model(page)).nodesIn['Default View']).toEqual([actor, actor]);
    expect(await page.locator('.djs-shape[data-element-id]').evaluateAll((all) => all.length)).toBe(2);

    await page.locator(`model-explorer .row[data-iri="${actor}"]`).click();
    await until(async () => (await page.locator('.djs-shape.selected').count()) === 2, 'both placements selected');
    expect(session.diagnostics.pageErrors).toEqual([]);
  });
});

describe('the Appearance tab', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  /** Set a field of the Appearance tab as a person does: the value typed or picked, then committed. */
  const setField = (selector: string, value: string) =>
    page.locator('property-panel').locator(selector).evaluate((input: HTMLInputElement | HTMLSelectElement, v) => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

  it('an element’s line colour and width, and a relationship line’s, are drawn as set', async () => {
    await dropActor(page, 200, 200);
    await dropActor(page, 500, 200);
    await until(async () => (await model(page)).actors.length === 2, 'two actors');
    const [a, b] = (await model(page)).actors;
    const rel = await page.evaluate(
      ([source, target]) => {
        const app = (window as any).__LA_GRAM_APP__;
        const iri = app.components.relationshipManager.createQualifiedRelationship({
          typeIri: 'https://meta.linked.archi/archimate4/onto#Association',
          sourceIri: source,
          targetIri: target,
          modelIri: app.session.modelIri,
        }).iri;
        app.components.viewManager.addRelationshipToView(app.session.activeViewIri, iri);
        app.components.eventBus.emit('model-changed', { origin: 'test' });
        return iri as string;
      },
      [a!, b!],
    );
    const panel = page.locator('property-panel');
    const body = page.locator(`.djs-shape[data-element-id="${a}"] .la-shape-body`);

    // Selected on the canvas — through its selection, as a click selects.
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([iri]), a);
    await panel.locator('.vtab[data-tab="appearance"]').click();
    await setField('.appearance-field[data-field="lineColor"] input', '#d93025');
    await until(async () => (await body.getAttribute('stroke')) === '#d93025', 'the element’s outline in its new colour');
    await setField('.appearance-field[data-field="lineWidth"] select', '3');
    await until(async () => (await body.getAttribute('stroke-width')) === '3', 'the element’s outline in its new width');
    expect(await body.getAttribute('stroke')).toBe('#d93025');

    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([iri]), rel);
    const line = page.locator(`.djs-connection[data-element-id="${rel}"] .la-connection`);
    await until(async () => (await panel.locator('.appearance-field[data-field="lineColor"]').count()) === 1, 'the line’s Appearance');
    await setField('.appearance-field[data-field="lineColor"] input', '#1a73e8');
    await until(async () => (await line.getAttribute('stroke')) === '#1a73e8', 'the line in its new colour');
    await setField('.appearance-field[data-field="lineWidth"] select', '2');
    await until(async () => (await line.getAttribute('stroke-width')) === '2', 'the line in its new width');
    expect(await line.getAttribute('stroke')).toBe('#1a73e8');
    await session.screenshot('appearance-lines');

    // A gradient: the fill shades from its colour at the left.
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([iri]), a);
    await until(async () => (await panel.locator('.appearance-field[data-field="gradient"]').count()) === 1, 'the element’s Appearance');
    await setField('.appearance-field[data-field="gradient"] select', 'left');
    await until(async () => ((await body.getAttribute('fill')) ?? '').startsWith('url(#la-gradient-left-'), 'the element filled with a gradient');

    // "Notation only" on: the look set here is not drawn, and the tab says so; its button draws it again.
    await page.locator('canvas-toolbar button[data-switch="notation-only"]').click();
    await until(async () => (await body.getAttribute('stroke')) !== '#d93025', 'the element drawn as its notation has it');
    const notice = panel.locator('.appearance-notice');
    await notice.waitFor({ state: 'visible' });
    expect(await notice.textContent()).toContain('Notation only');
    await session.screenshot('appearance-notation-only');
    await notice.locator('button.show-own').click();
    await until(async () => (await body.getAttribute('stroke')) === '#d93025', 'the element drawn with its own look again');
    expect(await notice.count()).toBe(0);
    expect(await page.locator('canvas-toolbar button[data-switch="notation-only"]').getAttribute('aria-pressed')).toBe('false');
    await session.screenshot('appearance-element');
    expect(session.diagnostics.pageErrors).toEqual([]);
  });

  it('the Figure tab draws an element as its icon; renamed in place, the box is under the icon', async () => {
    const [a] = (await model(page)).actors;
    const panel = page.locator('property-panel');
    const shape = page.locator(`.djs-shape[data-element-id="${a}"]`);
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([iri]), a);
    await panel.locator('.vtab[data-tab="figure"]').click();
    await panel.locator('.figure-choice[data-mode="IconCentric"]').click();
    await until(async () => (await shape.locator('[data-rendering-mode]').getAttribute('data-rendering-mode')) === 'IconCentric', 'drawn as its icon');
    await session.screenshot('appearance-figure');
    // Renamed in place: the box is the band under the icon, not the whole shape.
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([iri]), a);
    await page.keyboard.press('F2');
    const editor = page.locator('.djs-direct-editing-parent');
    await editor.waitFor({ state: 'visible' });
    // The element's bounds: the icon figure's hit area (the shape's own box takes in its selection outline).
    const [box, drawn] = [await editor.boundingBox(), await shape.locator('.la-icon-container').boundingBox()];
    expect(box!.height).toBeLessThan(drawn!.height / 2);
    expect(box!.y + box!.height).toBeCloseTo(drawn!.y + drawn!.height, -1);
    await page.keyboard.press('Escape');
    expect(session.diagnostics.pageErrors).toEqual([]);
  });

  it('objects, a product, a work package and the 3D-box elements are boxes with their glyph', async () => {
    const placed = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const types = ['BusinessObject', 'DataObject', 'Product', 'WorkPackage', 'Device', 'Equipment', 'Facility', 'Plateau', 'Grouping', 'Deliverable', 'Meaning', 'Value', 'ValueStream'];
      return types.map((type, i) => {
        const iri = app.components.elementManager.createElement(AM4 + type, app.session.modelIri, { label: type }).value as string;
        app.components.viewManager.addElementToView(app.session.activeViewIri, iri, {
          x: 200 + 160 * (i % 4),
          y: 420 + 80 * Math.floor(i / 4),
          width: 120,
          height: 55,
        });
        return iri;
      });
    });
    await page.evaluate(() => (window as any).__LA_GRAM_APP__.components.eventBus.emit('model-changed', { origin: 'test' }));
    for (const iri of placed) {
      const shape = page.locator(`.djs-shape[data-element-id="${iri}"] [data-rendering-mode]`);
      await until(async () => (await shape.count()) === 1, 'the object drawn');
      expect(await shape.getAttribute('data-rendering-mode')).toBe('ShapeWithBadge');
      expect(await shape.locator('.la-shape-badge').count()).toBe(1);
    }
    // A grouping: dashed, its name from its top left.
    const grouping = page.locator(`.djs-shape[data-element-id="${placed[8]}"]`);
    expect(await grouping.locator('.la-shape-body').getAttribute('stroke-dasharray')).toBeTruthy();
    expect(await grouping.locator('.la-shape-label').getAttribute('text-anchor')).toBe('start');
    await session.screenshot('objects');
    // A data object's Figure tab: its notation's own figure, its banded box, its icon, its shape alone.
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([iri]), placed[1]);
    const panel = page.locator('property-panel');
    await panel.locator('.vtab[data-tab="figure"]').click();
    expect((await panel.locator('.figure-choice').allInnerTexts()).map((t) => t.trim())).toEqual([
      'Shape with icon (notation)',
      'Banded Rectangle',
      'Icon',
      'Shape only',
    ]);
    await session.screenshot('figure-alternatives');
  });

  it('renamed in place, text set at the bottom stays at the bottom as lines are typed', async () => {
    const iri = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const element = app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#BusinessActor', app.session.modelIri, {
        label: 'Bottom',
      }).value as string;
      const node = app.components.viewManager.addElementToView(app.session.activeViewIri, element, { x: 900, y: 420, width: 160, height: 120 });
      app.components.viewManager.setAppearance(app.session.activeViewIri, node, { textPosition: 'bottom' });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return element;
    });
    await page.evaluate((element) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([element]), iri);
    await page.keyboard.press('F2');
    const parent = page.locator('.djs-direct-editing-parent');
    const content = page.locator('.djs-direct-editing-content');
    await parent.waitFor({ state: 'visible' });
    const gap = async () => {
      const [box, text] = [await parent.boundingBox(), await content.boundingBox()];
      return box!.y + box!.height - (text!.y + text!.height);
    };
    const paddingTop = () => content.evaluate((el: HTMLElement) => parseFloat(el.style.paddingTop));
    const before = await paddingTop();
    await page.keyboard.type(' with a name long enough to wrap onto several lines of its own');
    // More lines: the padding above them shrinks, and their last stays at the bottom.
    expect(await paddingTop()).toBeLessThan(before);
    expect(Math.abs(await gap())).toBeLessThan(3);
    await page.keyboard.press('Escape');
    expect(session.diagnostics.pageErrors).toEqual([]);
  });

  it('the Label tab: what a label says, line by line, in the presentation in use', async () => {
    const iri = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const element = app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#ApplicationComponent', app.session.modelIri, {
        label: 'Ledger',
      }).value as string;
      app.components.viewManager.addElementToView(app.session.activeViewIri, element, { x: 1100, y: 560, width: 160, height: 80 });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return element;
    });
    const panel = page.locator('property-panel');
    await page.evaluate((element) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([element]), iri);
    await panel.locator('.vtab[data-tab="label"]').click();
    await panel.locator('.label-expression').fill('{name}\n«{type}»');
    await panel.locator('.label-expression').evaluate((area: HTMLTextAreaElement) => area.dispatchEvent(new Event('change')));
    const lines = page.locator(`.djs-shape[data-element-id="${iri}"] .la-shape-label tspan`);
    // Its name on a line of its own; the type under it, wrapped as the box allows.
    await until(async () => (await lines.allTextContents()).join(' ') === 'Ledger «Application Component»', 'the label, line by line');
    expect((await lines.allTextContents())[0]).toBe('Ledger');
    expect(await panel.locator('.label-shown').textContent()).toBe('Ledger\n«Application Component»');
    await session.screenshot('appearance-label');
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    expect(session.diagnostics.pageErrors).toEqual([]);
  });

  it('a colour for executives alone, from the Appearance tab with that presentation chosen', async () => {
    const PC = 'https://meta.linked.archi/archimate4/presentation-contexts#';
    const iri = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const element = app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#ApplicationComponent', app.session.modelIri, {
        label: 'Coloured for executives',
      }).value as string;
      app.components.viewManager.addElementToView(app.session.activeViewIri, element, { x: 1100, y: 840, width: 160, height: 80 });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return element;
    });
    const body = page.locator(`.djs-shape[data-element-id="${iri}"] .la-shape-body`);
    const notationFill = await body.getAttribute('fill');
    await page.evaluate((context) => (window as any).__LA_GRAM_APP__.setPresentationContext(context), `${PC}ExecutiveContext`);
    const panel = page.locator('property-panel');
    await page.evaluate((element) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([element]), iri);
    await panel.locator('.vtab[data-tab="appearance"]').click();
    expect(await panel.locator('.look-scope').textContent()).toContain('Executive / C-Level');
    await panel.locator('.appearance-field[data-field="fillColor"] input').evaluate((input: HTMLInputElement) => {
      input.value = '#ffd6e0';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(async () => (await body.getAttribute('fill')) === '#ffd6e0', 'pink for executives');
    await page.evaluate((context) => (window as any).__LA_GRAM_APP__.setPresentationContext(context), `${PC}DeveloperContext`);
    await until(async () => (await body.getAttribute('fill')) === notationFill, 'the notation’s colour for developers');
    await page.evaluate(() => (window as any).__LA_GRAM_APP__.setPresentationContext(undefined));
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    expect(session.diagnostics.pageErrors).toEqual([]);
  });

  it('an element’s own picture for executives, drawn as its figure when they are the presentation chosen', async () => {
    const PC = 'https://meta.linked.archi/archimate4/presentation-contexts#';
    const iri = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const element = app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#ApplicationComponent', app.session.modelIri, {
        label: 'Card gateway',
      }).value as string;
      app.components.viewManager.addElementToView(app.session.activeViewIri, element, { x: 1100, y: 700, width: 160, height: 80 });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return element;
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" rx="6" fill="#e37400"/></svg>';
    const panel = page.locator('property-panel');
    await page.evaluate((element) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([element]), iri);
    await panel.locator('.vtab[data-tab="info"]').click();
    await panel
      .locator(`.context-picture[data-context="${PC}ExecutiveContext"] .context-picture-file`)
      .setInputFiles({ name: 'card.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
    await until(
      async () =>
        (await page.evaluate((element) => {
          const store = (window as any).__LA_GRAM_APP__.components.store;
          return store.getQuads({ termType: 'NamedNode', value: element }, { termType: 'NamedNode', value: 'https://meta.linked.archi/core#altVisNotation' }).length;
        }, iri)) === 1,
      'the picture for executives kept in the model',
    );
    // Executives chosen: drawn inside its box at once, the type's glyph its badge (core-vis 0.8).
    await page.evaluate((context) => (window as any).__LA_GRAM_APP__.setPresentationContext(context), `${PC}ExecutiveContext`);
    const drawnPicture = page.locator(`.djs-shape[data-element-id="${iri}"] .la-shape-image`);
    await until(async () => /^data:image\/svg\+xml;base64,/.test((await drawnPicture.getAttribute('href').catch(() => null)) ?? ''), 'drawn inside its box');
    expect(await page.locator(`.djs-shape[data-element-id="${iri}"] .la-shape-badge`).getAttribute('href')).toMatch(/glyphs\//);
    // The Image tab draws it as the figure, for them…
    await panel.locator('.vtab[data-tab="image"]').click();
    expect(await panel.locator('.image-preview').getAttribute('data-element-picture')).toBe('true');
    await panel.locator('.image-draw-as input[value="figure"]').check();
    const shape = page.locator(`.djs-shape[data-element-id="${iri}"] [data-rendering-mode]`);
    await until(async () => (await shape.getAttribute('data-rendering-mode')) === 'IconCentric', 'drawn as its picture');
    expect(await page.locator(`.djs-shape[data-element-id="${iri}"] .la-shape-icon`).getAttribute('href')).toMatch(/^data:image\/svg\+xml;base64,/);
    await session.screenshot('appearance-picture-per-presentation');
    // … or as its badge, its box kept.
    await panel.locator('.image-draw-as input[value="badge"]').check();
    await until(async () => (await shape.getAttribute('data-rendering-mode')) === 'ShapeWithBadge', 'its box again');
    expect(await page.locator(`.djs-shape[data-element-id="${iri}"] .la-shape-badge`).getAttribute('href')).toMatch(/^data:image\/svg\+xml;base64,/);
    await session.screenshot('appearance-picture-as-badge');
    // Developers: its box.
    await page.evaluate((context) => (window as any).__LA_GRAM_APP__.setPresentationContext(context), `${PC}DeveloperContext`);
    await until(async () => (await shape.getAttribute('data-rendering-mode')) === 'ShapeWithBadge', 'its box for developers');
    await page.evaluate(() => (window as any).__LA_GRAM_APP__.setPresentationContext(undefined));
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    expect(session.diagnostics.pageErrors).toEqual([]);
  });

  it('a picture file chosen in the Image tab is kept in the model, drawn at its own size once loaded, where it is put', async () => {
    const iri = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const element = app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#ApplicationComponent', app.session.modelIri, {
        label: 'Pictured',
      }).value as string;
      app.components.viewManager.addElementToView(app.session.activeViewIri, element, { x: 1100, y: 420, width: 160, height: 80 });
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return element;
    });
    // A 24 × 16 picture file, chosen: kept in the model as a data: URI.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="#1a73e8"/></svg>';
    const panel = page.locator('property-panel');
    await page.evaluate((element) => (window as any).__LA_GRAM_UI__.diagramCanvas.selectIris([element]), iri);
    await panel.locator('.vtab[data-tab="image"]').click();
    await panel.locator('.image-file').setInputFiles({ name: 'blue.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
    const kept = () =>
      page.evaluate((element) => {
        const app = (window as any).__LA_GRAM_APP__;
        const node = app.components.viewManager.getNodes(app.session.activeViewIri).find((n: any) => n.elementIri === element);
        return node?.appearance?.image as string | undefined;
      }, iri);
    await until(async () => (await kept()) === `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, 'the file kept in the model');
    const drawn = page.locator(`.djs-shape[data-element-id="${iri}"] .la-shape-image`);
    // Loaded, then drawn: its own size, in the top left inside the outline.
    await until(async () => (await drawn.count()) === 1, 'the picture drawn once loaded');
    expect(await drawn.evaluate((el) => ['x', 'y', 'width', 'height'].map((a) => el.getAttribute(a)))).toEqual(['3', '3', '24', '16']);
    await panel.locator('.image-tab select').selectOption('BottomRight');
    await until(async () => (await drawn.getAttribute('data-image-position')) === 'BottomRight', 'moved to the bottom right');
    expect(await drawn.evaluate((el) => [el.getAttribute('x'), el.getAttribute('y')])).toEqual(['133', '61']);
    expect(await panel.locator('.image-preview img').count()).toBe(1);
    await session.screenshot('appearance-image');
    // The keyboard back to the canvas for what comes next.
    await page.locator('.la-diagram-host').click({ position: { x: 700, y: 450 } });
    expect(session.diagnostics.pageErrors).toEqual([]);
  });
});

describe('copy and paste on the canvas', () => {
  it('copies two elements, pastes the same ones into another view, duplicates and pastes as copies, undoes, and cuts from the view — keys and the right-click menu', async () => {
    const { page } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    await dropActor(page, 200, 150);
    await dropActor(page, 420, 150);
    await until(async () => (await model(page)).actors.length === 2, 'two actors');
    const shapes = page.locator(SHAPE);
    await shapes.nth(0).click();
    await shapes.nth(1).click({ modifiers: ['Shift'] });

    await page.keyboard.press('ControlOrMeta+c');

    // The right-click menu on an element: cut, copy, duplicate — and, something copied, the three pastes.
    const menu = page.locator('.djs-popup.la-context-menu');
    await shapes.nth(1).click({ button: 'right' });
    await menu.waitFor({ state: 'visible' });
    for (const id of ['cut', 'copy', 'duplicate', 'paste', 'paste-copies', 'paste-references']) {
      expect(await menu.locator(`.la-context-${id}`).count(), id).toBe(1);
    }
    await page.keyboard.press('Escape');

    // Another view: pasted with the pointer over it — the same two elements, placed again.
    await page.locator('app-toolbar button[data-menu="new-view"]').click();
    await page.locator('app-toolbar button[data-command="new-view"][data-value="Diagram"]').click();
    await answerPrompt(page, 'Copies');
    await page.locator('.la-dialog .la-choice-list').waitFor({ state: 'visible' });
    await page.locator('.la-dialog .la-button.primary').click();
    await until(async () => (await model(page)).views.length === 2, 'the second view');
    const host = await page.locator('.la-diagram-host').boundingBox();
    await page.mouse.move(host!.x + 300, host!.y + 250);
    await page.keyboard.press('ControlOrMeta+v');
    await until(async () => ((await model(page)).nodesIn['Copies'] ?? []).length === 2, 'the paste');
    let m = await model(page);
    expect(m.actors).toHaveLength(2);
    expect([...m.nodesIn['Copies']].sort()).toEqual([...m.actors].sort());

    // What was pasted is selected: Ctrl/⌘+D duplicates it as new elements; undo takes them back.
    await page.keyboard.press('ControlOrMeta+d');
    await until(async () => (await model(page)).actors.length === 4, 'the duplicate');
    expect((await model(page)).nodesIn['Copies']).toHaveLength(4);
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await model(page)).actors.length === 2, 'undo');

    // Paste as copies, from the keys; undone.
    await page.keyboard.press('ControlOrMeta+Shift+v');
    await until(async () => (await model(page)).actors.length === 4, 'paste as copies');
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await model(page)).actors.length === 2, 'undo');

    // Cut one: out of the view, kept in the model.
    await shapes.nth(0).click();
    await page.keyboard.press('ControlOrMeta+x');
    await until(async () => ((await model(page)).nodesIn['Copies'] ?? []).length === 1, 'the cut');
    m = await model(page);
    expect(m.actors).toHaveLength(2);

    // From the model tree: Copy on the one cut, pasted back with the pointer over the diagram.
    const cut = m.actors.find((iri) => !m.nodesIn['Copies'].includes(iri))!;
    await page.locator(`model-explorer .row[data-iri="${cut}"]`).click({ button: 'right' });
    await page.locator('model-explorer .menu [data-action="copy"]').click();
    await page.mouse.move(host!.x + 500, host!.y + 300);
    await page.keyboard.press('ControlOrMeta+v');
    await until(async () => ((await model(page)).nodesIn['Copies'] ?? []).length === 2, 'the paste from the tree');
    m = await model(page);
    expect(m.actors).toHaveLength(2);
    expect(m.nodesIn['Copies']).toContain(cut);
    findings.push('copy and paste: references into another view, duplicate, paste as copies, undo, cut, copy from the tree: ok');
  }, 120_000);
});

describe('arranging a view', () => {
  it('lays out a diagram from the toolbar — no element over another, in a worker — and undoes it in one step', async () => {
    const { page } = await openPage();
    await page.locator(PALETTE_ACTOR).waitFor({ state: 'visible', timeout: 30_000 });
    const view = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const [m, v] = [app.session.modelIri, app.session.activeViewIri];
      const make = (type: string, label: string) => {
        const iri = app.components.elementManager.createElement(AM4 + type, m, { label }).value;
        app.components.viewManager.addElementToView(v, iri, { x: 200, y: 200, width: 120, height: 55 });
        return iri;
      };
      const actor = make('BusinessActor', 'Clerk');
      const process = make('Process', 'Handle claim');
      const app1 = make('ApplicationComponent', 'Claims app');
      const node = make('Node', 'Server');
      const relate = (type: string, s: string, t: string) => {
        const r = app.components.relationshipManager.createQualifiedRelationship({ typeIri: AM4 + type, sourceIri: s, targetIri: t, modelIri: m }).iri;
        app.components.viewManager.addRelationshipToView(v, r);
      };
      relate('Assignment', actor, process);
      relate('Serving', app1, process);
      relate('Serving', node, app1);
      app.components.eventBus.emit('model-changed', { origin: 'test' });
      return v as string;
    });
    const boxes = () =>
      page.evaluate((v) => (window as any).__LA_GRAM_APP__.components.viewManager.getNodes(v).map((n: any) => n.bounds), view) as Promise<
        Array<{ x: number; y: number; width: number; height: number }>
      >;
    const overlapping = (bs: Array<{ x: number; y: number; width: number; height: number }>) =>
      bs.some((a, i) => bs.some((b, j) => i < j && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
    const before = await boxes();
    expect(overlapping(before)).toBe(true);

    await page.locator('canvas-toolbar button[data-action="arrange-view"]').click({ timeout: 10_000 });
    const dialog = page.locator('.la-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.locator('.la-button.primary').click({ timeout: 10_000 });
    await until(async () => !overlapping(await boxes()), 'the layout', 30_000);

    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => JSON.stringify(await boxes()) === JSON.stringify(before), 'undo');
    findings.push('arrange view: laid out with no overlaps, undone in one step: ok');
  }, 120_000);
});
