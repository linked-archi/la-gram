/**
 * Browser smoke suite — la-gram in real headless Chrome.
 *
 * ## Why this exists
 *
 * The unit suite runs under jsdom, which has no layout engine: every
 * `getBoundingClientRect()` is zeros, nothing is painted, no image is ever
 * fetched. That is enough to assert on DOM *structure* and on the calls the
 * model managers receive, and 1128 such tests still missed a palette that
 * rendered three tools and nothing else, because no test looked at the rendered
 * palette at all and no test could look at geometry.
 *
 * So this suite asserts only things that need a browser: real pixels, real
 * resource loading, real pointer input. It builds nothing — it serves whatever
 * is in `dist/web` — so a stale bundle is a stale test; `npm run
 * test:browser:build` is the entry point that guarantees otherwise.
 *
 * ## Shape of the run
 *
 * One page load for the whole file. The assertions are read-only up to the
 * point where shapes get created, and creation order matters (the connection
 * test needs the two shapes the create test made), so `describe` blocks run in
 * declaration order against shared state rather than re-booting per test — a
 * boot costs an Oxigraph WASM init plus nine metamodel graphs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';

import { startStaticServer, type StaticServer } from './static-server.js';
import {
  openSession,
  waitForAppReady,
  WEB_DIST,
  ALLOWED_CONSOLE_PATTERNS,
  type BrowserSession,
} from './harness.js';

/** ArchiMate 4.0 types the assertions name explicitly. */
const BUSINESS_ACTOR = 'https://meta.linked.archi/archimate4/onto#BusinessActor';

/**
 * The sidebar palette's entry for a BusinessActor.
 *
 * Playwright's CSS engine pierces open shadow roots, so the entry can be
 * addressed straight through the `palette-panel` host — which matters, because
 * everything the panel renders lives in its shadow DOM.
 */
const BUSINESS_ACTOR_PALETTE_ENTRY = `palette-panel .palette-item[data-iri="${BUSINESS_ACTOR}"]`;

/** A tool button in the strip above the diagram. */
const toolButton = (tool: string): string => `canvas-toolbar button[data-tool="${tool}"]`;

/**
 * A shape drawn by `RdfRenderer`.
 *
 * Note this is *not* `.djs-element`: diagram-js owns that wrapper and stamps it
 * with `data-element-id`, while the renderer's own group inside it carries
 * `data-element-iri` and `data-type-iri`. Asserting on the renderer's group is
 * what ties the assertion to this app's output rather than to the framework's.
 */
const DRAWN_SHAPE = '.la-shape[data-element-iri]';

/** The colour the ArchiMate 4.0 notation gives every Business-layer element. */
const BUSINESS_LAYER_FILL = '#FFFFB5';

let server: StaticServer;
let session: BrowserSession;
let page: Page;

/**
 * Poll a locator until it matches exactly `expected` elements.
 *
 * Vitest's `expect` has no `toHaveCount`; that is a `@playwright/test` matcher,
 * and pulling in the whole Playwright *runner* just for its assertion library
 * would mean two test runners in one repo. Polling is what the matcher does
 * anyway, and this keeps the wait state-based rather than a sleep.
 */
async function expectCount(
  locator: import('playwright').Locator,
  expected: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let actual = await locator.count();
  while (actual !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    actual = await locator.count();
  }
  expect(actual, `expected ${expected} match(es) for the locator, saw ${actual}`).toBe(expected);
}

/**
 * Poll an attribute until it reads `expected`.
 *
 * Same reason as {@link expectCount}: `toHaveAttribute` is a `@playwright/test`
 * matcher, and this repo runs Playwright's library under Vitest rather than
 * bringing in a second test runner. Vitest 1.x has no `expect.poll` either.
 */
async function expectAttribute(
  locator: import('playwright').Locator,
  name: string,
  expected: string | null,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let actual = await locator.getAttribute(name);
  while (actual !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    actual = await locator.getAttribute(name);
  }
  expect(actual, `expected ${name}="${expected}", saw "${actual}"`).toBe(expected);
}

/** Reported at the end of the run so the numbers are visible, not just asserted. */
const findings: string[] = [];

beforeAll(async () => {
  server = await startStaticServer(WEB_DIST);
  session = await openSession();
  page = session.page;

  await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'load' });
  await waitForAppReady(page);
}, 120_000);

afterAll(async () => {
  if (session) {
    const file = await session.screenshot('smoke');
    findings.push(`screenshot: ${file}`);
    await session.close();
  }
  if (server) await server.close();

  // eslint-disable-next-line no-console
  console.log('\n── browser smoke findings ──\n' + findings.join('\n') + '\n');
}, 60_000);

describe('1. page health', () => {
  it('loads with no console errors, no uncaught exceptions and no failed requests', () => {
    const { unexpectedConsoleErrors, pageErrors, failedRequests, badResponses, console: all } =
      session.diagnostics;

    findings.push(
      `console messages: ${all.length} total ` +
        `(${all.filter((m) => m.type === 'warning').length} warning, ` +
        `${all.filter((m) => m.type === 'error').length} error), ` +
        `allowlisted patterns: ${ALLOWED_CONSOLE_PATTERNS.map(String).join(' ')}`,
    );

    expect(unexpectedConsoleErrors, JSON.stringify(unexpectedConsoleErrors, null, 2)).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    expect(failedRequests, failedRequests.join('\n')).toEqual([]);
    expect(badResponses, JSON.stringify(badResponses)).toEqual([]);
  });

  it('mounts the shell, all five slots and the diagram-js canvas', async () => {
    const slots = await page.evaluate(() => {
      const shell = document.querySelector('app-shell');
      if (!shell) return null;
      return Array.from(shell.children).map((child) => (child as HTMLElement).slot);
    });

    expect(slots).not.toBeNull();
    expect(new Set(slots ?? [])).toEqual(
      new Set(['palette', 'explorer', 'property-panel', 'canvas', 'validation']),
    );

    // diagram-js names the root layer `layer-root-<n>` after the root element's
    // registry index, hence the prefix match rather than an exact class.
    await expectCount(page.locator('.djs-container svg [class^="layer-root"]').first(), 1);
  });
});

describe('2. metamodel', () => {
  it('reports the loaded metamodel on its own console line', () => {
    const line = session.diagnostics.console.find((message) =>
      message.text.startsWith('[app] Loaded metamodel'),
    );
    expect(line, 'no "[app] Loaded metamodel" console line was emitted').toBeDefined();
    findings.push(`metamodel console line: ${line?.text}`);
    expect(line?.text).toMatch(/\(\d+ graphs, notation set https?:\/\/\S+\)/);
  });

  it('exposes the loaded metamodel as observable state', async () => {
    const loaded = await page.evaluate(() => {
      const app = (window as unknown as Record<string, unknown>).__LA_GRAM_APP__ as {
        loadedMetamodel: { metamodelIri: string; notationSetIri?: string } | null;
      };
      return app.loadedMetamodel;
    });
    expect(loaded?.metamodelIri).toContain('archimate4');
    expect(loaded?.notationSetIri).toBeTruthy();
  });
});

describe('3. the canvas toolbar (and no in-canvas palette)', () => {
  it('does not render diagram-js\'s own palette at all', async () => {
    // It used to carry the three global tools *and* all 42 element types, which
    // is exactly what the sidebar lists — two palettes offering the same thing.
    // The feature is no longer registered, so there is no `.djs-palette` DOM.
    const palettes = await page.locator('.djs-palette').count();
    findings.push(`in-canvas palettes rendered: ${palettes}`);
    expect(palettes).toBe(0);
  });

  it('renders the three global tools as real, painted buttons', async () => {
    const tools = ['connect', 'lasso', 'hand'];
    const boxes: Record<string, unknown> = {};

    for (const tool of tools) {
      const locator = page.locator(toolButton(tool));
      await expectCount(locator, 1);
      const box = await locator.boundingBox();
      boxes[tool] = box;
      expect(box?.width ?? 0, `${tool} button has no width`).toBeGreaterThan(0);
      expect(box?.height ?? 0, `${tool} button has no height`).toBeGreaterThan(0);
      // Reachable without a mouse, and named for a screen reader.
      expect(await locator.getAttribute('aria-label')).toBeTruthy();
      expect(await locator.getAttribute('aria-pressed')).toBe('false');
    }

    findings.push(`toolbar buttons: ${JSON.stringify(boxes)}`);
  });

  it('sits above the diagram rather than floating over it', async () => {
    const toolbar = await page.locator('canvas-toolbar').boundingBox();
    const host = await page.locator('.la-diagram-host').boundingBox();
    expect(toolbar).not.toBeNull();
    expect(host).not.toBeNull();

    findings.push(
      `toolbar rect=${JSON.stringify(toolbar)} diagram host rect=${JSON.stringify(host)}`,
    );

    // The strip ends where the host begins: a column flexbox, not an overlay.
    expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(host!.y + 1);
    // ...and the diagram still got real room, which is what `min-height: 0` on the
    // flex item buys.
    expect(host!.height).toBeGreaterThan(200);
  });

  it('shows which tool is armed, and stops showing it when the tool is dropped', async () => {
    const connect = page.locator(toolButton('connect'));

    await connect.click();
    expect(await connect.getAttribute('aria-pressed')).toBe('true');

    // `Escape` cancels the drag, `ToolManager` clears the active tool, and the
    // toolbar hears about it — which is why it does not track its own clicks.
    await page.keyboard.press('Escape');
    await expectAttribute(connect, 'aria-pressed', 'false');
  });
});

describe('4. the sidebar palette (Lit, shadow DOM)', () => {
  it('renders grouped element entries inside its shadow root', async () => {
    const panel = await page.evaluate(() => {
      const host = document.querySelector('palette-panel');
      const root = host?.shadowRoot;
      if (!root) return null;
      const groups = Array.from(root.querySelectorAll('.group')).map((group) => ({
        header: group.querySelector('.group-header')?.textContent?.trim() ?? '',
        items: group.querySelectorAll('.palette-item').length,
      }));
      const images = Array.from(root.querySelectorAll('img.palette-icon')) as HTMLImageElement[];
      return {
        hasHeader: root.querySelector('.palette-header')?.textContent?.trim() ?? '',
        groups,
        elementItems: root.querySelectorAll('.group .palette-item').length,
        totalItems: root.querySelectorAll('.palette-item').length,
        relationshipSection: Boolean(root.querySelector('.section-divider')),
        hasSearch: Boolean(root.querySelector('input[type="search"]')),
        hasAxisSelector: Boolean(root.querySelector('#palette-axis')),
        icons: images.length,
        brokenIcons: images
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.src),
      };
    });

    expect(panel, 'palette-panel has no shadow root').not.toBeNull();
    findings.push(
      `sidebar palette: header="${panel!.hasHeader}", ` +
        `${panel!.groups.length} groups, ${panel!.elementItems} element types + ` +
        `${panel!.totalItems - panel!.elementItems} relationships, ` +
        `search=${panel!.hasSearch}, axis selector=${panel!.hasAxisSelector}; groups → ` +
        panel!.groups.map((g) => `${g.header.replace(/^▾\s*/, '')}:${g.items}`).join(', '),
    );

    expect(panel!.hasHeader).toBe('Palette');
    expect(panel!.groups.length).toBeGreaterThan(1);
    // ArchiMate 4.0 publishes 42 concrete element types.
    expect(panel!.elementItems).toBeGreaterThanOrEqual(40);
    for (const group of panel!.groups) expect(group.items).toBeGreaterThan(0);
    expect(panel!.relationshipSection).toBe(true);
    // Both of the things a canvas strip had nowhere to put.
    expect(panel!.hasSearch).toBe(true);
    expect(panel!.hasAxisSelector).toBe(true);

    findings.push(
      `sidebar palette icons: ${panel!.icons} <img>, ${panel!.brokenIcons.length} broken`,
    );
    expect(panel!.icons).toBeGreaterThan(0);
    expect(panel!.brokenIcons, panel!.brokenIcons.join('\n')).toEqual([]);
  });

  it('renders the BusinessActor entry as a visible control with a glyph that loads', async () => {
    const entry = page.locator(BUSINESS_ACTOR_PALETTE_ENTRY);
    await expectCount(entry, 1);
    const box = await entry.boundingBox();

    // `PaletteGenerator` hands out asset-root-relative icon paths, so this is where
    // a missing `assets/` prefix shows up — as 404s and broken images, neither of
    // which jsdom notices because it fetches nothing.
    const icon = await entry.locator('img').evaluate((image) => ({
      src: (image as HTMLImageElement).src,
      naturalWidth: (image as HTMLImageElement).naturalWidth,
      complete: (image as HTMLImageElement).complete,
    }));

    findings.push(
      `sidebar BusinessActor entry: box=${JSON.stringify(box)} ` +
        `icon=${icon.src} naturalWidth=${icon.naturalWidth}`,
    );

    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
    expect(icon.src).toContain('/assets/archimate4/icons/');
    expect(icon.complete).toBe(true);
    expect(icon.naturalWidth, 'the palette glyph did not load').toBeGreaterThan(0);
  });

  it('filters to the typed query, and restores the full list when cleared', async () => {
    const search = page.locator('palette-panel input[type="search"]');
    const items = page.locator('palette-panel .palette-item');
    const visibleLabels = (): Promise<string[]> =>
      page.evaluate(() => {
        const root = document.querySelector('palette-panel')?.shadowRoot;
        return Array.from(root?.querySelectorAll('.palette-item') ?? []).map(
          (item) => item.querySelector('.palette-label')?.textContent?.trim() ?? '',
        );
      });

    const before = (await visibleLabels()).length;

    await search.fill('business actor');
    await expectCount(items, 1);
    expect(await visibleLabels()).toEqual(['Business Actor']);

    await search.fill('nothing matches this');
    await expectCount(items, 0);
    const empty = await page.locator('palette-panel .palette-empty').textContent();
    findings.push(`sidebar search: ${before} types unfiltered, miss message="${empty?.trim()}"`);
    expect(empty).toContain('No type matches');

    // The clear button, which is the affordance the panel offers.
    await page.locator('palette-panel .palette-search button').click();
    await expectCount(items, before);
  });

  it('lets the keyboard edit the search box, rather than the diagram eating the keys', async () => {
    // Regression, and the reason `DiagramCanvas.guardKeyboardAgainstShadowInputs`
    // exists. diagram-js's `keyboard` is bound to `document` and decides a key
    // belongs to a text field by looking at `event.target` — which shadow-DOM
    // retargeting has already rewritten to `<palette-panel>`. So `editorActions`
    // claimed Backspace and Delete for `removeSelection` and `preventDefault`ed
    // them, and characters could not be deleted from this box at all.
    const search = page.locator('palette-panel input[type="search"]');
    const items = page.locator('palette-panel .palette-item');

    await search.fill('');
    const before = await items.count();

    await search.click();
    await page.keyboard.type('business actorX');
    await expectCount(items, 0);

    // The keystroke the diagram used to swallow.
    await page.keyboard.press('Backspace');
    await expectCount(items, 1);
    expect(await search.inputValue()).toBe('business actor');

    // And a selection on the canvas survives typing in the box.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await expectCount(items, before);
    expect(await search.inputValue()).toBe('');

    findings.push('search box accepts Backspace / Ctrl+A / Delete without the diagram claiming them');
  });
});

describe('5. creating a shape from the sidebar by real pointer input', () => {
  it('places a BusinessActor by click-to-place, and paints it with real geometry', async () => {
    const before = await page.locator(DRAWN_SHAPE).count();

    // Click the sidebar entry, then click on the canvas. The panel reports the
    // click, `DiagramCanvas.startCreate` hands it to diagram-js's `create`, and
    // `Create.start` arms `Dragging` with `autoActivate` — so the shape follows the
    // pointer until the closing click. The same code path a user drives.
    await page.locator(BUSINESS_ACTOR_PALETTE_ENTRY).click();

    const host = await page.locator('.la-diagram-host').boundingBox();
    expect(host).not.toBeNull();

    await page.mouse.move(host!.x + 260, host!.y + 200, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();

    await expectCount(page.locator(DRAWN_SHAPE), before + 1);

    const shape = page.locator(DRAWN_SHAPE).last();
    const box = await shape.boundingBox();
    findings.push(`click-to-place shape client rect: ${JSON.stringify(box)}`);

    // The whole point of leaving jsdom: a painted box with real pixels.
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(20);
    expect(box!.height).toBeGreaterThan(20);

    // And the model was actually written, not just the DOM.
    const modelled = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__LA_GRAM_UI__ as {
        diagramCanvas: { getElements(): Map<string, { typeIri: string }> };
      };
      return Array.from(ui.diagramCanvas.getElements().values()).map((e) => e.typeIri);
    });
    expect(modelled).toContain(BUSINESS_ACTOR);
  });

  it('places one by pressing on the entry and dragging onto the canvas', async () => {
    // The interaction that used to be untestable. While the sidebar dragged with
    // the HTML5 drag-and-drop API, Chrome fired `dragover`/`drop` and no
    // `mousemove` — and `mousemove` is what diagram-js's `Dragging` binds on
    // `document`. Starting from `mousedown` instead means a press that begins
    // outside the canvas is tracked all the way onto it, so this is a real
    // press-move-release with no synthetic events anywhere.
    const before = await page.locator(DRAWN_SHAPE).count();

    const entry = await page.locator(BUSINESS_ACTOR_PALETTE_ENTRY).boundingBox();
    const host = await page.locator('.la-diagram-host').boundingBox();
    expect(entry).not.toBeNull();
    expect(host).not.toBeNull();

    await page.mouse.move(entry!.x + entry!.width / 2, entry!.y + entry!.height / 2);
    await page.mouse.down();
    // Enough intermediate moves that the drag passes diagram-js's threshold and
    // the canvas root registers a hover before the release.
    await page.mouse.move(host!.x + 200, host!.y + 120, { steps: 10 });
    await page.mouse.move(host!.x + 420, host!.y + 130, { steps: 10 });
    await page.mouse.up();

    await expectCount(page.locator(DRAWN_SHAPE), before + 1);

    const box = await page.locator(DRAWN_SHAPE).last().boundingBox();
    findings.push(`sidebar drag → drop shape client rect: ${JSON.stringify(box)}`);
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(20);

    // Dropped where the pointer was released, not at some default position — which
    // is diagram-js computing the position through its own viewbox.
    expect(box!.x).toBeGreaterThan(host!.x + 250);
  });

  it('cancels a drag released outside the canvas instead of creating anything', async () => {
    const before = await page.locator(DRAWN_SHAPE).count();

    const entry = await page.locator(BUSINESS_ACTOR_PALETTE_ENTRY).boundingBox();
    const explorer = await page.locator('model-explorer').boundingBox();
    expect(entry).not.toBeNull();
    expect(explorer).not.toBeNull();

    await page.mouse.move(entry!.x + entry!.width / 2, entry!.y + entry!.height / 2);
    await page.mouse.down();
    await page.mouse.move(explorer!.x + 20, explorer!.y + 40, { steps: 8 });
    await page.mouse.up();

    // No hover target off the canvas, so `create.end` refuses — the right answer,
    // and reached without any special-casing of the sidebar.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await page.locator(DRAWN_SHAPE).count()).toBe(before);

    // Leave no armed drag behind for the tests that follow.
    await page.keyboard.press('Escape');
  });
});

describe('6. the notation is really applied', () => {
  it('fills a BusinessActor with the Business-layer colour', async () => {
    const body = page
      .locator(`.la-shape[data-type-iri="${BUSINESS_ACTOR}"] .la-shape-body`)
      .first();
    await expectCount(body, 1);

    const attributeFill = await body.getAttribute('fill');
    // Computed, not just declared: this is what the browser actually paints.
    const computedFill = await body.evaluate((node) => getComputedStyle(node).fill);
    findings.push(`BusinessActor fill: attribute=${attributeFill} computed=${computedFill}`);

    expect(attributeFill).toBe(BUSINESS_LAYER_FILL);
    // Chrome normalises #FFFFB5 to rgb(255, 255, 181).
    expect(computedFill.replace(/\s/g, '')).toBe('rgb(255,255,181)');
  });

  it('draws a badge <image> whose glyph resolves and actually loads', async () => {
    const badge = page
      .locator(`.la-shape[data-type-iri="${BUSINESS_ACTOR}"] .la-shape-badge`)
      .first();

    // The renderer removes a badge whose image raises `error`, so surviving in
    // the DOM is itself evidence — but not proof of decodable pixels, so the
    // resource is checked three ways below.
    await expectCount(badge, 1);

    const href = await badge.evaluate((node) => (node as SVGImageElement).href.baseVal);
    const box = await badge.boundingBox();

    const loaded = await page.evaluate(async (url: string) => {
      const response = await fetch(url, { cache: 'no-store' });
      const contentType = response.headers.get('content-type');

      // `SVGImageElement` exposes no `naturalWidth`, so the same URL is loaded
      // through an `HTMLImageElement`, which does. A non-zero `naturalWidth`
      // means Chrome fetched *and* decoded the glyph.
      const intrinsic = await new Promise<{ width: number; height: number } | null>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve(null);
        image.src = url;
      });

      return { status: response.status, contentType, intrinsic };
    }, href);

    findings.push(
      `BusinessActor badge: href=${href} rect=${JSON.stringify(box)} ` +
        `http=${loaded.status} ${loaded.contentType} ` +
        `naturalSize=${loaded.intrinsic ? `${loaded.intrinsic.width}x${loaded.intrinsic.height}` : 'FAILED TO LOAD'}`,
    );

    expect(href).toMatch(/^https?:\/\/.+\.svg$/);
    expect(loaded.status).toBe(200);
    expect(loaded.contentType).toContain('image/svg+xml');
    expect(loaded.intrinsic, 'the glyph did not decode as an image').not.toBeNull();
    expect(loaded.intrinsic!.width).toBeGreaterThan(0);
    expect(loaded.intrinsic!.height).toBeGreaterThan(0);

    // Painted, too — not merely present in the DOM.
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
  });
});

describe('7. connection docking', () => {
  it('docks a drawn connection to the shape boundaries, not their centres', async () => {
    const host = await page.locator('.la-diagram-host').boundingBox();
    expect(host).not.toBeNull();

    // A third BusinessActor, well clear of the others, so the connection has an
    // unambiguous direction. Same click-to-place gesture as above.
    const existing = await page.locator(`.la-shape[data-type-iri="${BUSINESS_ACTOR}"]`).count();
    await page.locator(BUSINESS_ACTOR_PALETTE_ENTRY).click();
    await page.mouse.move(host!.x + 700, host!.y + 480, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();

    await expectCount(
      page.locator(`.la-shape[data-type-iri="${BUSINESS_ACTOR}"]`),
      existing + 1,
    );

    const shapes = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__LA_GRAM_UI__ as {
        diagramCanvas: {
          getElements(): Map<
            string,
            { iri: string; bounds: { x: number; y: number; width: number; height: number } }
          >;
        };
      };
      return Array.from(ui.diagramCanvas.getElements().values()).map((e) => ({
        iri: e.iri,
        ...e.bounds,
      }));
    });
    expect(shapes.length).toBeGreaterThanOrEqual(2);

    // The two most recently placed, which are the two furthest apart.
    const source = shapes[shapes.length - 2];
    const target = shapes[shapes.length - 1];

    const sourceBox = await page
      .locator(`.la-shape[data-element-iri="${source.iri}"]`)
      .boundingBox();
    const targetBox = await page
      .locator(`.la-shape[data-element-iri="${target.iri}"]`)
      .boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const centreOf = (b: { x: number; y: number; width: number; height: number }) => ({
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
    });
    const from = centreOf(sourceBox!);
    const to = centreOf(targetBox!);

    // The toolbar's connect tool, driven exactly as a user does it: pick the
    // tool, click the source, then click the target. `GlobalConnect` arms a drag
    // on the tool click, resolves the source on the click that ends it, and
    // hands off to `Connect`, which follows the pointer to the target. All real
    // trusted input — nothing is called directly on the canvas here.
    await page.locator(toolButton('connect')).click();

    await page.mouse.move(from.x, from.y, { steps: 6 });
    await page.mouse.down();
    await page.mouse.up();

    // Enough intermediate moves that the drag passes diagram-js's threshold and
    // the hover lands on the target before the closing click.
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.down();
    await page.mouse.up();

    const connection = page.locator('.djs-connection .la-connection').first();
    await expectCount(connection, 1);

    const geometry = await page.evaluate(
      ({ sourceIri, targetIri }) => {
        const ui = (window as unknown as Record<string, unknown>).__LA_GRAM_UI__ as {
          diagramCanvas: { getDiagram(): { get(name: string): any } | null };
        };
        const registry = ui.diagramCanvas.getDiagram()!.get('elementRegistry');
        const connections = registry
          .getAll()
          .filter((element: { waypoints?: unknown[] }) => Array.isArray(element.waypoints));
        const source = registry.get(sourceIri);
        const target = registry.get(targetIri);
        const path = document.querySelector('.djs-connection .la-connection');
        return {
          waypoints: connections[0]?.waypoints ?? null,
          typeIri: connections[0]?.businessObject?.typeIri ?? null,
          source: { x: source.x, y: source.y, width: source.width, height: source.height },
          target: { x: target.x, y: target.y, width: target.width, height: target.height },
          source_id: source.id,
          target_id: target.id,
          connectionSourceId: connections[0]?.source?.id ?? null,
          connectionTargetId: connections[0]?.target?.id ?? null,
          // Measured by the browser's own geometry engine; zero would mean
          // nothing was drawn. This is the assertion jsdom can never make.
          pathTag: path?.tagName ?? null,
          pathLength: path ? (path as SVGGeometryElement).getTotalLength() : 0,
          pathGeometry: path?.getAttribute('points') ?? path?.getAttribute('d') ?? null,
        };
      },
      { sourceIri: source.iri, targetIri: target.iri },
    );

    const first = geometry.waypoints![0];
    const last = geometry.waypoints![geometry.waypoints!.length - 1];
    const sourceCentre = { x: geometry.source.x + geometry.source.width / 2, y: geometry.source.y + geometry.source.height / 2 };
    const targetCentre = { x: geometry.target.x + geometry.target.width / 2, y: geometry.target.y + geometry.target.height / 2 };

    findings.push(
      `connection type=${geometry.typeIri} ` +
        `${geometry.connectionSourceId} → ${geometry.connectionTargetId}\n` +
        `  source bounds=${JSON.stringify(geometry.source)} centre=${JSON.stringify(sourceCentre)}\n` +
        `  target bounds=${JSON.stringify(geometry.target)} centre=${JSON.stringify(targetCentre)}\n` +
        `  endpoints=${JSON.stringify(first)} → ${JSON.stringify(last)}\n` +
        `  rendered <${geometry.pathTag}> ${geometry.pathGeometry} ` +
        `length=${geometry.pathLength.toFixed(2)}`,
    );

    // The connection joined the two shapes the gesture named, in that direction.
    expect(geometry.connectionSourceId).toBe(geometry.source_id);
    expect(geometry.connectionTargetId).toBe(geometry.target_id);
    expect(geometry.typeIri, 'the connection carries no relationship type').toBeTruthy();

    // Rendered, with real length measured by the browser's own geometry engine.
    expect(geometry.pathLength).toBeGreaterThan(10);

    // The docking claim. `BaseLayouter` alone runs the line centre-to-centre;
    // `connectionDocking` cuts it back to the outlines. So each endpoint must
    // sit *on* its shape's rectangle and be measurably off the centre.
    const onBoundary = (
      point: { x: number; y: number },
      b: { x: number; y: number; width: number; height: number },
    ): boolean => {
      const tolerance = 1.5;
      const onVertical =
        (Math.abs(point.x - b.x) <= tolerance || Math.abs(point.x - b.x - b.width) <= tolerance) &&
        point.y >= b.y - tolerance &&
        point.y <= b.y + b.height + tolerance;
      const onHorizontal =
        (Math.abs(point.y - b.y) <= tolerance || Math.abs(point.y - b.y - b.height) <= tolerance) &&
        point.x >= b.x - tolerance &&
        point.x <= b.x + b.width + tolerance;
      return onVertical || onHorizontal;
    };

    expect(
      onBoundary(first, geometry.source),
      `source endpoint ${JSON.stringify(first)} is not on ${JSON.stringify(geometry.source)}`,
    ).toBe(true);
    expect(
      onBoundary(last, geometry.target),
      `target endpoint ${JSON.stringify(last)} is not on ${JSON.stringify(geometry.target)}`,
    ).toBe(true);

    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    expect(distance(first, sourceCentre)).toBeGreaterThan(5);
    expect(distance(last, targetCentre)).toBeGreaterThan(5);
  });
});
