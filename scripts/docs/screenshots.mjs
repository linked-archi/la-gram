/**
 * The User guide's screenshots: la-gram's production web build, in Chrome,
 * with the documentation's example model open.
 *
 *   npm run build:web            first: the screenshots are of dist/web
 *   npm run docs:screenshots     writes docs-site/assets/screenshots/guide/<page>/*.png
 *
 * The model is docs-site/examples/shop.ttl, Acme's online shop, opened as the
 * published site opens it: /la-gram/?model=docs/examples/shop.ttl&assets=offline.
 * Gift wrapping is realized by nothing on purpose: validation-tab.png shows
 * the ServiceWithoutRealizationShape warning it raises, and the model says so
 * in its skos:editorialNote. Do not "fix" the model. The script waits for that
 * warning, and stops if it is gone.
 *
 * Each shot gets a browser context of its own, so nothing a shot leaves in
 * storage (a bottom tab, a panel's width) reaches the next. Every wait is for
 * a state, never for a time. The PNGs are written only once every shot has
 * succeeded, so a failed run leaves the committed ones as they were.
 *
 * Chrome is the system's (channel "chrome"), or the one LA_GRAM_CHROME names.
 *
 * Exit 0 when all eight are written; 1 when a shot fails (a wait timed out, the
 * page threw) or a file cannot be written; 2 when the build, the model or
 * Chrome is missing.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = path.join(ROOT, 'dist/web');
const EXAMPLES = path.join(ROOT, 'docs-site/examples');
const OUT = path.join(ROOT, 'docs-site/assets/screenshots');
const MODEL_PATH = '/la-gram/?model=docs/examples/shop.ttl&assets=offline';
const SHOP = 'https://example.org/acme/shop/';
const VIEWPORT = { width: 1600, height: 1000 };
const SCALE = 2;
/** How long a state may take to arrive (the app's start gets longer). */
const WAIT_MS = 15_000;
const READY_MS = 30_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  // Chrome refuses a streamed WebAssembly module served as anything else.
  '.wasm': 'application/wasm',
  '.ttl': 'text/turtle; charset=utf-8',
  '.trig': 'application/trig',
  '.nt': 'application/n-triples',
  '.nq': 'application/n-quads',
  '.jsonld': 'application/ld+json',
  '.rdf': 'application/rdf+xml',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** A wait or a step that did not happen: the shot and what it waited for. */
class ShotError extends Error {}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** /la-gram/docs/examples/ is the example folder, as the published site has it; the rest of /la-gram/ is the build. */
function resolveFile(pathname) {
  const mounts = [
    ['/la-gram/docs/examples/', EXAMPLES],
    ['/la-gram/', WEB],
  ];
  for (const [prefix, root] of mounts) {
    if (!pathname.startsWith(prefix)) continue;
    const wanted = path.resolve(root, pathname.slice(prefix.length) || 'index.html');
    // Refuse anything that escapes the folder.
    if (wanted !== root && !wanted.startsWith(root + path.sep)) return { status: 403 };
    const file = isFile(wanted) ? wanted : isFile(path.join(wanted, 'index.html')) ? path.join(wanted, 'index.html') : null;
    return file ? { file } : { status: 404 };
  }
  return { status: 404 };
}

async function startServer() {
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      return response.writeHead(400).end('Bad Request');
    }
    if (pathname.includes('\0')) return response.writeHead(400).end('Bad Request');
    const { file, status } = resolveFile(pathname);
    if (!file) return response.writeHead(status).end(status === 403 ? 'Forbidden' : 'Not Found');
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(statSync(file).size),
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/** The element of an IRI in the example, as the canvas draws it. */
const shape = (local) => `.la-diagram-host .djs-shape[data-element-id="${SHOP}${local}"]`;

/** Wait for `locator`, naming the shot and the selector if it does not come. */
async function waitFor(shot, locator, selector, state = 'visible', timeout = WAIT_MS) {
  try {
    await locator.first().waitFor({ state, timeout });
  } catch {
    throw new ShotError(`${shot}: timed out after ${timeout / 1000} s waiting for ${selector} (${state})`);
  }
}

/** Poll until `test(texts)` holds, where texts are the elements' innerText, trimmed. */
async function waitForText(shot, locator, selector, test, what, timeout = WAIT_MS) {
  const until = Date.now() + timeout;
  for (;;) {
    const texts = await locator.evaluateAll((elements) => elements.map((e) => e.innerText.trim())).catch(() => []);
    if (test(texts)) return texts;
    if (Date.now() > until) throw new ShotError(`${shot}: timed out after ${timeout / 1000} s waiting for ${selector} ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Open the example, wait for the app and for the diagram. */
async function commonLoad(shot, page, origin) {
  await page.goto(origin + MODEL_PATH, { waitUntil: 'load' });
  try {
    await page.waitForFunction(
      () => Boolean(window.__LA_GRAM_APP__?.loadedMetamodel) && Boolean(window.__LA_GRAM_UI__),
      null,
      { timeout: READY_MS },
    );
  } catch {
    throw new ShotError(`${shot}: timed out after ${READY_MS / 1000} s waiting for the app (window.__LA_GRAM_APP__.loadedMetamodel, window.__LA_GRAM_UI__)`);
  }
  await waitFor(shot, page.locator('palette-panel .palette-item'), 'palette-panel .palette-item', 'attached', READY_MS);
  await waitFor(shot, page.locator(shape('gift-wrapping')), shape('gift-wrapping'), 'attached');
  const shapes = page.locator('.la-diagram-host .djs-shape[data-element-id]');
  const until = Date.now() + WAIT_MS;
  while ((await shapes.count()) < 8) {
    if (Date.now() > until) throw new ShotError(`${shot}: timed out waiting for 8 .la-diagram-host .djs-shape[data-element-id], ${await shapes.count()} drawn`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Select an element as a user does: a click at the centre of its shape. */
async function select(shot, page, local) {
  const locator = page.locator(shape(local));
  await waitFor(shot, locator, shape(local));
  await locator.click();
}

/**
 * Show a bottom tab. A click on the tab already showing folds the panel, so the
 * tab is clicked only when it is not the one selected.
 */
async function showTab(shot, page, id) {
  const selector = `app-shell .tab[data-tab="${id}"]`;
  const tab = page.locator(selector);
  await waitFor(shot, tab, selector);
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  try {
    await page.locator(`${selector}[aria-selected="true"]`).waitFor({ state: 'visible', timeout: WAIT_MS });
  } catch {
    throw new ShotError(`${shot}: timed out waiting for ${selector}[aria-selected="true"]`);
  }
}

async function click(shot, page, selector) {
  const locator = page.locator(selector);
  await waitFor(shot, locator, selector);
  await locator.first().click();
}

/** The union of the boxes, grown by `padding` on every side, inside the viewport. */
async function clipOf(shot, page, selectors, padding) {
  const boxes = [];
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new ShotError(`${shot}: ${selector} has no box to clip to`);
    boxes.push(box);
  }
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - padding);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - padding);
  const right = Math.min(VIEWPORT.width, Math.max(...boxes.map((b) => b.x + b.width)) + padding);
  const bottom = Math.min(VIEWPORT.height, Math.max(...boxes.map((b) => b.y + b.height)) + padding);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The shots of design §12: the steps after the common load, the waits, and the clip. */
const SHOTS = [
  {
    file: 'guide/index/workbench.png',
    async take() {
      return null;
    },
  },
  {
    file: 'guide/canvas/context-pad.png',
    async take(shot, page) {
      await select(shot, page, 'web-shop');
      await waitFor(shot, page.locator('.djs-context-pad.open'), '.djs-context-pad.open');
      return clipOf(shot, page, [shape('web-shop'), '.djs-context-pad.open'], 24);
    },
  },
  {
    file: 'guide/appearance/appearance-tab.png',
    async take(shot, page) {
      await select(shot, page, 'web-shop');
      await showTab(shot, page, 'properties');
      await click(shot, page, 'property-panel .vtab[data-tab="appearance"]');
      await waitFor(shot, page.locator('property-panel .vtab[data-tab="appearance"][aria-selected="true"]'), 'property-panel .vtab[data-tab="appearance"][aria-selected="true"]');
      await waitFor(shot, page.locator('property-panel .pane[data-tab="appearance"]'), 'property-panel .pane[data-tab="appearance"]');
      return clipOf(shot, page, ['app-shell .panel-bottom'], 0);
    },
  },
  {
    file: 'guide/validation/validation-tab.png',
    async take(shot, page) {
      await showTab(shot, page, 'validation');
      const selector = 'validation-panel .result-item.warning';
      try {
        await waitForText(
          shot,
          page.locator(selector),
          selector,
          (texts) => texts.some((t) => t.includes('Gift wrapping') && t.includes('is not realized by anything')),
          'naming Gift wrapping',
        );
      } catch (error) {
        if (!(error instanceof ShotError)) throw error;
        throw new ShotError(
          `${shot}: the planted warning on Gift wrapping is missing: see docs-site/examples/shop.ttl's editorial note (waited for ${selector})`,
        );
      }
      return clipOf(shot, page, ['app-shell .panel-bottom'], 0);
    },
  },
  {
    file: 'guide/sparql/questions-menu.png',
    async take(shot, page) {
      await showTab(shot, page, 'sparql');
      await click(shot, page, 'sparql-editor .questions-btn');
      await waitFor(shot, page.locator('sparql-editor .questions-menu'), 'sparql-editor .questions-menu');
      await waitFor(shot, page.locator('sparql-editor .questions-menu button.question'), 'sparql-editor .questions-menu button.question');
      return clipOf(shot, page, ['app-shell .panel-bottom', 'sparql-editor .questions-menu'], 0);
    },
  },
  {
    file: 'guide/graph/graph-tab.png',
    async take(shot, page) {
      await select(shot, page, 'web-shop');
      await showTab(shot, page, 'graph');
      await click(shot, page, 'graph-panel .depth button[data-depth="2"]');
      const layout = page.locator('graph-panel select[aria-label="Layout"]');
      await waitFor(shot, layout, 'graph-panel select[aria-label="Layout"]');
      // Force is live: at rest first, so that a choice that restarts it starts from the same place each time,
      // then at rest again, framed.
      const settled = 'graph-panel .cy[data-layout="settled"]';
      await waitFor(shot, page.locator(settled), settled, 'attached');
      await layout.selectOption('force');
      await waitFor(shot, page.locator(settled), settled, 'attached');
      await waitFor(shot, page.locator('graph-panel .cy canvas'), 'graph-panel .cy canvas', 'attached');
      await waitForText(shot, page.locator('graph-panel .root'), 'graph-panel .root', (t) => t.some((x) => x.startsWith('Web shop')), 'starting "Web shop"');
      await waitForText(
        shot,
        page.locator('graph-panel .stats'),
        'graph-panel .stats',
        (t) => t.some((x) => /^\d+ elements · \d+ relationships$/.test(x)),
        'matching "N elements · N relationships"',
      );
      return clipOf(shot, page, ['app-shell .panel-bottom'], 0);
    },
  },
  {
    file: 'guide/rdf-panel/rdf-panel.png',
    async take(shot, page) {
      await click(shot, page, 'app-toolbar button[data-command="toggle-rdf"]');
      await waitFor(shot, page.locator('rdf-panel'), 'rdf-panel');
      const scope = page.locator('rdf-panel select.scope');
      await waitFor(shot, scope, 'rdf-panel select.scope');
      const until = Date.now() + WAIT_MS;
      while ((await scope.inputValue()) !== 'view') {
        if (Date.now() > until) throw new ShotError(`${shot}: timed out waiting for rdf-panel select.scope to be "view"`);
        await new Promise((r) => setTimeout(r, 100));
      }
      await waitForText(shot, page.locator('rdf-panel .code'), 'rdf-panel .code', (t) => t.some((x) => x.includes('arch-vis:ArchNode')), 'containing arch-vis:ArchNode');
      return clipOf(shot, page, ['app-shell .panel-rdf'], 0);
    },
  },
  {
    file: 'guide/metamodels/metamodels-menu.png',
    async take(shot, page) {
      await click(shot, page, 'app-toolbar button[data-menu="metamodels"]');
      await waitFor(shot, page.locator('app-toolbar .dropdown'), 'app-toolbar .dropdown');
      // The Loaded heading, and at least one section of the catalogue below it.
      // The headings are uppercase by CSS, and innerText is what is rendered.
      await waitForText(
        shot,
        page.locator('app-toolbar .dropdown .group'),
        'app-toolbar .dropdown .group',
        (t) => t[0]?.toLowerCase() === 'loaded' && t.length >= 2,
        'headed "Loaded", with at least one more',
      );
      return clipOf(shot, page, ['app-toolbar button[data-menu="metamodels"]', 'app-toolbar .dropdown'], 24);
    },
  },
];

async function main() {
  if (!isFile(path.join(WEB, 'index.html'))) {
    console.error(`${path.relative(ROOT, path.join(WEB, 'index.html'))} is missing: run npm run build:web first.`);
    return 2;
  }
  if (!isFile(path.join(EXAMPLES, 'shop.ttl'))) {
    console.error(`${path.relative(ROOT, path.join(EXAMPLES, 'shop.ttl'))} is missing: the screenshots show that model.`);
    return 2;
  }
  const chrome = process.env.LA_GRAM_CHROME;
  const { server, origin } = await startServer();
  let browser;
  try {
    try {
      browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : { channel: 'chrome' }), args: ['--disable-gpu'] });
    } catch (error) {
      console.error(
        `Chrome did not start (${chrome ? `LA_GRAM_CHROME=${chrome}` : "channel 'chrome'"}): ${error.message.split('\n')[0]}\n` +
          'Install Google Chrome, or set LA_GRAM_CHROME to the path of a Chrome or Chromium executable.',
      );
      return 2;
    }
    const taken = [];
    for (const { file, take } of SHOTS) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'light' });
      try {
        // Nothing leaves the machine: the example is opened with assets=offline, and anything off-origin is refused.
        await context.route((url) => url.origin !== origin, (route) => route.abort('blockedbyclient'));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
        await commonLoad(file, page, origin);
        const clip = await take(file, page);
        await page.evaluate(() => document.fonts.ready);
        const png = await page.screenshot(clip ? { clip } : {});
        if (errors.length > 0) throw new ShotError(`${file}: the page threw: ${errors.join('; ')}`);
        taken.push({ file, png });
      } catch (error) {
        // Playwright's own errors (a click that found nothing to click) are named after the shot too.
        if (error instanceof ShotError) throw error;
        throw new ShotError(`${file}: ${error.message.split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
    let total = 0;
    const written = [];
    try {
      for (const { file, png } of taken) {
        const target = path.join(OUT, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, png);
        written.push(target);
        total += png.length;
        console.log(`${path.relative(ROOT, target)}  ${(png.length / 1024).toFixed(0)} KiB`);
      }
    } catch (error) {
      console.error(`Could not write a screenshot: ${error.message}`);
      if (written.length > 0) console.error(`Written before the error: ${written.map((w) => path.relative(ROOT, w)).join(', ')}`);
      return 1;
    }
    console.log(`${taken.length} screenshots, ${(total / 1024 / 1024).toFixed(2)} MiB, at ${VIEWPORT.width}×${VIEWPORT.height} × ${SCALE}`);
    return 0;
  } catch (error) {
    if (error instanceof ShotError) {
      console.error(error.message);
      return 1;
    }
    console.error(error);
    return 1;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
