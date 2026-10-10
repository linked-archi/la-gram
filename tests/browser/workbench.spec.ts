/**
 * The model/view workbench in a real browser, with real pointer and keyboard
 * input, against the production build — and collaboration between two pages
 * through the real collaboration server.
 *
 * Run with `npm run test:browser:build` (builds `dist/web` first).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';
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
}

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

  it('saves a Turtle file with the model only', async () => {
    await dropActor(page, 200, 120);
    await until(async () => (await model(page)).actors.length === 1, 'a new actor');
    const download = page.waitForEvent('download');
    await page.locator('app-toolbar button[data-menu="file"]').click();
    await page.locator('app-toolbar button[data-command="save"]').click();
    const file = await download;
    const text = await readFile((await file.path())!, 'utf8');
    expect(file.suggestedFilename()).toMatch(/\.ttl$/);
    expect(text).toContain('arch-vis:ArchNode');
    expect(text).toContain('arch:inView');
    expect(text).not.toContain('owl:Ontology');
    findings.push(`saved ${file.suggestedFilename()} (${text.length} bytes)`);
    await session.screenshot('workbench-views');
  });
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

    await panel.locator('button.close').click();
    await panel.waitFor({ state: 'hidden' });
    findings.push('RDF panel: hidden by default, toggle, live refresh, block → selection: ok');
  });

  it('writes the model as m: prefixed names; Model settings moves it into another namespace', async () => {
    const panel = page.locator('rdf-panel');
    await page.locator('app-toolbar button[data-command="toggle-rdf"]').click();
    await panel.waitFor({ state: 'visible' });
    const code = panel.locator('.code');
    await until(async () => /^m:model a arch:Model;/m.test(await code.innerText()), 'm:model in the Turtle');
    expect(await code.innerText()).toMatch(/@prefix m: <https:\/\/example\.org\/archimate\/[0-9a-f-]{36}\/>\./);
    expect(await code.innerText()).toMatch(/^m:element-[0-9a-f-]{36} a am4:BusinessActor;/m);

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
    expect(text).toMatch(/^crm:element-[0-9a-f-]{36} a am4:BusinessActor;/m);
    expect(text).not.toContain('example.org');
    // The same view is open, under its new IRI, with its shape.
    const state = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      return { view: app.session.activeViewIri as string, nodes: app.components.viewManager.getNodes(app.session.activeViewIri).length };
    });
    expect(state.view).toMatch(/^https:\/\/acme\.com\/ea\/crm\/view-/);
    expect(state.nodes).toBe(1);
    expect((await model(page)).actors).toHaveLength(1);
    await session.screenshot('workbench-model-namespace');
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
    ]);

    // Validation: its own tab. The new model's view has no viewpoint — a Warning, listed, not counted.
    await page.locator('app-shell .tab[data-tab="validation"]').click();
    await page.locator('validation-panel').waitFor({ state: 'visible' });
    expect(await page.locator('property-panel').isVisible()).toBe(false);
    await until(async () => /warning/i.test(await page.locator('validation-panel .summary').innerText()), 'the viewpoint warning');
    const badge = page.locator('app-shell .tab[data-tab="validation"] .badge');
    expect(await badge.count()).toBe(0);
    // A Violation (an element without a name) is counted on the tab, and the count goes when it is fixed.
    const unnamed = await page.evaluate(() => {
      const app = (window as any).__LA_GRAM_APP__;
      return app.components.elementManager.createElement(
        'https://meta.linked.archi/archimate4/onto#BusinessActor',
        app.session.modelIri,
      ).value as string;
    });
    await page.evaluate(() => (window as any).__LA_GRAM_APP__.scheduleValidation());
    await until(async () => (await badge.count()) === 1 && (await badge.innerText()) === '1', 'the violation count');
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

    // Vertical tabs on the left, with counts; the information tab: ID, type, inModel, name, definition.
    await openTab('info');
    await until(async () => (await labels()).includes('prefLabel'), 'the element’s fields');
    expect((await panel.locator('.vtab .vtab-name').allInnerTexts()).map((t) => t.trim())).toEqual([
      'Element information',
      'Properties',
      'Analysis',
      'Appears in views',
    ]);
    expect(await labels()).toEqual(['ID', 'type', 'inModel', 'prefLabel', 'definition']);

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
    expect(await panel.locator('li.id-row input').inputValue()).toBe(actor);
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
    expect(await labels()).toContain('definition');

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
    await until(async () => (await labels()).includes('cost'), 'the added properties');
    expect(await labels()).toEqual(['cost', 'owner']);
    expect(await panel.locator('.vtab[data-tab="properties"] .count').innerText()).toBe('2');
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
      getComputedStyle(o.querySelector('.curie')!).color,
    ]);
    expect(nameColor).toBe('rgb(32, 33, 36)');
    expect(curieColor).toBe('rgb(128, 134, 139)');
    await session.screenshot('workbench-property-picker');
    await picker.press('Escape');

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

    // Business Actor → Application Component: Flow, Serving, Triggering — so it asks.
    const component = menu.locator('.entry', { hasText: 'Application Component' }).first();
    expect(await component.innerText()).toMatch(/choose: Flow \/ Serving \/ Triggering/);
    await session.screenshot('workbench-append-menu');
    await component.click();
    await until(async () => (await menu.locator('.entry').allInnerTexts()).some((t) => t.includes('Serving')), 'the relationship step');
    const step = (await menu.locator('.entry .djs-popup-label').allInnerTexts()).map((t) => t.trim());
    expect(step).toEqual(['Flow', 'Serving', 'Triggering', 'Association', 'Directed Association']);
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
    await session.screenshot('workbench-graph');

    // Filtering out Serving prunes it: the actor alone.
    const serving = panel.locator('details[data-kind="relationship"] label', { hasText: 'Serving' }).locator('input');
    await serving.uncheck();
    await until(async () => (await stats.innerText()).includes('1 elements · 0 relationships'), 'the filtered graph');
    await serving.check();
    await until(async () => (await stats.innerText()).includes('2 elements · 1 relationships'), 'the graph again');

    // The exports: the query (a SELECT by default), and the drawn triples as Turtle.
    const [rq] = await Promise.all([page.waitForEvent('download'), panel.locator('[data-export="sparql"]').click()]);
    expect(rq.suggestedFilename()).toBe('Business-Actor-graph-select.rq');
    const query = await readFile((await rq.path())!, 'utf8');
    expect(query).toMatch(/^# Relationships within 2 hops of "Business Actor"/);
    expect(query).toContain('SELECT DISTINCT (?s AS ?source)');
    const [ttl] = await Promise.all([page.waitForEvent('download'), panel.locator('[data-export="turtle"]').click()]);
    const turtle = await readFile((await ttl.path())!, 'utf8');
    expect(turtle).toMatch(/^@prefix /);
    expect(turtle).toMatch(/m:relationship-[0-9a-f-]{36} a am4:Serving;/);

    // The graph becomes a view, laid out as drawn: two elements and their link, side by side or stacked.
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
    expect(await editor.locator('tbody tr').innerText()).toMatch(/m:element-[\s\S]*Business Actor[\s\S]*am4:Serving[\s\S]*Application Component/);
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
      'Append…',
      'Properties',
      'Show in model tree',
      'Show relationship graph',
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
    const typeField = page.locator('property-panel select.type-select');
    await typeField.waitFor({ state: 'visible' });
    expect(await typeField.inputValue()).toBe(AM4 + 'BusinessObject');
    await typeField.selectOption(AM4 + 'Product');
    // The relationship is still not permitted: the same warning, from here too.
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.innerText()).toMatch(/Assignment → Cashier/);
    await dialog.locator('.la-button.primary').click();
    await until(async () => (await facts()).types.includes(AM4 + 'Product'), 'the product');
    expect(await typeField.inputValue()).toBe(AM4 + 'Product');
    findings.push('change element type: right-click menu and property panel (search, current marked), default name follows, undo, not-permitted relationships named and kept: ok');
  }, 90_000);
});

describe('the core metamodel: a generic element', () => {
  it('adds "Linked.Archi Core" from the Metamodels menu and places a generic Element', async () => {
    const { page, session } = await openPage();
    await page.locator('palette-panel .palette-item').first().waitFor({ state: 'attached', timeout: 30_000 });
    await page.locator('app-toolbar button[data-menu="metamodels"]').click();
    const entry = page.locator(
      'app-toolbar button[data-command="add-metamodel"][data-value="https://meta.linked.archi/core/metamodel#Core"]',
    );
    // Its own section, first.
    const sections = (await page.locator('app-toolbar .dropdown .group').allInnerTexts()).map((t) => t.trim().toLowerCase());
    expect(sections.slice(0, 3)).toEqual(['loaded', 'core', 'modelling languages']);
    await entry.click();
    const element = page.locator('palette-panel .palette-item[data-iri="https://meta.linked.archi/core#Element"]');
    await element.waitFor({ state: 'visible', timeout: 30_000 });
    expect((await element.innerText()).trim()).toBe('Element');
    const relationship = page.locator('palette-panel .palette-item[data-iri="https://meta.linked.archi/core#QualifiedRelationship"]');
    expect((await relationship.innerText()).trim()).toBe('Relationship');

    // Dropped on the canvas: an element typed arch:Element only, named, in the view.
    const box = (await element.boundingBox())!;
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
          value: 'https://meta.linked.archi/core#Element',
        }).filter((q: any) => q.graph.termType === 'DefaultGraph');
        return typed.map((q: any) => ({
          iri: q.subject.value,
          types: store.getQuads(q.subject, { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }).map((t: any) => t.object.value),
          nodes: app.components.viewManager.getNodes(app.session.activeViewIri).filter((n: any) => n.elementIri === q.subject.value).length,
        }));
      });
    await until(async () => (await created()).length === 1, 'the generic element');
    const [made] = await created();
    expect(made.types).toEqual(['https://meta.linked.archi/core#Element']);
    expect(made.nodes).toBe(1);
    // Selected, the guide under the tree says what an Element is.
    const guide = page.locator('type-guide-panel');
    await until(async () => (await guide.locator('.header .title').innerText()) === 'About Element', 'the guide');
    await session.screenshot('workbench-core-element');
    findings.push('core metamodel: added from the menu, Generic › Element dropped as arch:Element: ok');
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
