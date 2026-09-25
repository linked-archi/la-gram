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

describe('the property panel', () => {
  let page: Page;
  let session: BrowserSession;

  beforeAll(async () => {
    ({ page, session } = await openPage());
  }, 120_000);

  const widthOf = async (selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0;

  it('is shown by default; hides from its × and the toolbar, and resizes by its left edge', async () => {
    const panel = page.locator('property-panel');
    const toggle = page.locator('app-toolbar button[data-command="toggle-properties"]');
    await panel.waitFor({ state: 'visible' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    const canvasShown = await widthOf('.la-diagram-host');

    // Hidden from its own ×: the canvas takes the room.
    await panel.locator('button.close').click();
    await panel.waitFor({ state: 'hidden' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await until(async () => (await widthOf('.la-diagram-host')) > canvasShown + 250, 'the wider canvas');

    // Back from the toolbar.
    await toggle.click();
    await panel.waitFor({ state: 'visible' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    const before = await widthOf('app-shell .panel-property');
    expect(Math.round(before)).toBe(300);

    // Dragging the left edge left widens it; the width is remembered.
    const handle = (await page.locator('app-shell .panel-property .resizer').boundingBox())!;
    const y = handle.y + 200;
    await page.mouse.move(handle.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(handle.x - 150, y, { steps: 6 });
    await page.mouse.up();
    const after = await widthOf('app-shell .panel-property');
    expect(after).toBeGreaterThan(before + 120);
    const stored = await page.evaluate(() => Number(localStorage.getItem('la-gram:property-panel-width')));
    expect(Math.abs(stored - after)).toBeLessThanOrEqual(2);
    await session.screenshot('workbench-property-panel-resized');

    // Leave the default width for whatever runs next in this browser.
    await page.evaluate(() => localStorage.removeItem('la-gram:property-panel-width'));
    findings.push(`property panel: × / toolbar toggle, resized ${Math.round(before)} → ${Math.round(after)}px, remembered: ok`);
  });

  it('lists ID, type, inModel, prefLabel, then the added properties (no inView rows)', async () => {
    await dropActor(page, 300, 200);
    await until(async () => (await model(page)).actors.length === 1, 'the actor');
    const [actor] = (await model(page)).actors;
    await page.evaluate((iri) => (window as any).__LA_GRAM_UI__.selectConcept(iri), actor);
    const panel = page.locator('property-panel');
    const labels = async () =>
      (await panel.locator('li.property-row .property-label').allInnerTexts()).map((t) => t.trim().split(/\s/)[0]);
    await until(async () => (await labels()).includes('prefLabel'), 'the element’s fields');

    for (const [predicate, value] of [
      ['https://example.org/props#owner', 'Team A'],
      ['https://example.org/props#cost', '100'],
    ]) {
      await panel.locator('.add-row input').nth(0).fill(predicate);
      await panel.locator('.add-row input').nth(1).fill(value);
      await panel.locator('.add-row button.add').click();
    }
    await until(async () => (await labels()).includes('cost'), 'the added properties');
    expect(await labels()).toEqual(['ID', 'type', 'inModel', 'prefLabel', 'cost', 'owner']);
    expect(await panel.locator('li.id-row input').inputValue()).toBe(actor);
    expect(await panel.locator('li.property-row.first-added .property-label').innerText()).toMatch(/^cost/);
    await session.screenshot('workbench-property-panel-added');
    findings.push('property panel: ID, type, inModel, prefLabel, then added properties: ok');
  });
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
