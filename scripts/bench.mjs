/**
 * The benchmark (Task 22): open models in the built web app, in Chrome, and
 * measure what a modeller waits for — opening the model, opening its largest
 * view, renaming an element in it — and the memory it holds.
 *
 *   npm run build:web
 *   node scripts/bench.mjs                      generated models of 10 000 … 500 000 triples
 *   node scripts/bench.mjs --sizes 10000,100000 [--view-size 1000]
 *   node scripts/bench.mjs path/to/model.ttl …  models of your own (Archisurance, say)
 *
 * Generated models (`bench-model.mjs`) are kept in `test-results/bench/`, with
 * the results as JSON; a table is printed. Chrome is the system's, as for the
 * browser tests (`LA_GRAM_CHROME` to name another). Each model gets a browser
 * of its own.
 *
 * For each phase: how long until it was done — its last long task over, or what
 * it waits for there (the app ready, the view drawn), whichever is later — the
 * UI blocked (the long tasks, summed) and the longest freeze; and when the
 * findings came (validation runs in a worker, so they follow).
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { generateModel } from './bench-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'dist/web');
const OUT = path.join(ROOT, 'test-results/bench');
const DEFAULT_SIZES = [10000, 50000, 100000, 250000, 500000];
/** No long task for this long: the phase is over. */
const QUIET_MS = 2000;
/** How long to wait for anything at all. */
const LIMIT_MS = 30 * 60 * 1000;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ttl': 'text/turtle', '.trig': 'application/trig', '.nt': 'application/n-triples', '.nq': 'application/n-quads',
  '.jsonld': 'application/ld+json', '.rdf': 'application/rdf+xml', '.xml': 'application/xml',
};

function options(argv) {
  const value = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flags = new Set(['--sizes', '--view-size', '--out']);
  const files = argv.filter((a, i) => !a.startsWith('--') && !flags.has(argv[i - 1]));
  return {
    files,
    sizes: value('sizes') ? value('sizes').split(',').map(Number) : files.length > 0 ? [] : DEFAULT_SIZES,
    viewSize: Number(value('view-size') ?? 40),
    out: value('out') ?? path.join(OUT, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
  };
}

/** A generated model's file, made when it is not there yet. */
function generated(triples, viewSize) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `model-${triples}${viewSize === 40 ? '' : `-view${viewSize}`}.ttl`);
  if (!existsSync(file)) writeFileSync(file, generateModel({ triples, viewSize }).text);
  return file;
}

/** Serve the built app and the model, on a port of its own. */
async function serve(modelFile) {
  const modelPath = `/model${path.extname(modelFile)}`;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = url.pathname === modelPath ? modelFile : path.join(WEB, decodeURIComponent(url.pathname));
    if (!file.startsWith(WEB) && file !== modelFile) return res.writeHead(404).end();
    let body;
    try {
      body = readFileSync(file);
    } catch {
      return res.writeHead(404).end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}`, modelPath };
}

/** In the page, before the app: the long tasks, when the app is ready, and each validation's findings. */
function instrument() {
  const bench = { tasks: [], validations: [], ready: null };
  window.__bench = bench;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) bench.tasks.push([e.startTime, e.duration]);
  }).observe({ type: 'longtask', buffered: true });
  const poll = setInterval(() => {
    const app = window.__LA_GRAM_APP__;
    if (!app || !window.__LA_GRAM_MODULES__) return;
    clearInterval(poll);
    bench.ready = performance.now();
    app.components.eventBus.on('validation-updated', (e) => bench.validations.push({ at: performance.now(), count: e.detail?.resultCount ?? 0 }));
  }, 5);
}

async function measureModel(file) {
  const { server, base, modelPath } = await serve(file);
  const executablePath = process.env.LA_GRAM_CHROME;
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), args: ['--disable-gpu'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.addInitScript(instrument);
    const now = () => page.evaluate(() => performance.now());
    const state = () => page.evaluate(() => ({ now: performance.now(), tasks: window.__bench?.tasks ?? [], validations: window.__bench?.validations ?? [], ready: window.__bench?.ready }));
    const until = async (test, what) => {
      const started = Date.now();
      for (;;) {
        const s = await state();
        if (test(s)) return s;
        if (Date.now() - started > LIMIT_MS) throw new Error(`Gave up waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    /** A phase from `start` (page time) on: over when no long task ran for a while after `doneAt`. */
    const phase = async (start, doneAt) => {
      const s = await until((s) => {
        const lastEnd = Math.max(doneAt ?? start, ...s.tasks.filter(([t]) => t >= start).map(([t, d]) => t + d));
        return s.now - lastEnd >= QUIET_MS;
      }, 'the UI to settle');
      const tasks = s.tasks.filter(([t]) => t >= start);
      const end = Math.max(doneAt ?? start, ...tasks.map(([t, d]) => t + d));
      return { ms: Math.round(end - start), blockedMs: Math.round(tasks.reduce((a, [, d]) => a + d, 0)), longestMs: Math.round(Math.max(0, ...tasks.map(([, d]) => d))) };
    };
    /** The findings of the first validation published after the `seen`th, `start` being when it was asked for. */
    const findings = async (start, seen) => {
      const s = await until((s) => s.validations.length > seen, 'the findings');
      const v = s.validations[seen];
      return { findings: v.count, findingsAfterMs: Math.round(v.at - start) };
    };

    // Opening, from navigation (page time 0) to the app ready and settled.
    await page.goto(`${base}/index.html?model=${encodeURIComponent(base + modelPath)}`, { waitUntil: 'load' });
    const ready = (await until((s) => s.ready !== null, 'the app')).ready;
    const open = await phase(0, ready);
    // The model's findings: the last published once no validation is due or
    // running (the first may be the empty model the app starts with) — or, when
    // they were published before the app could be watched, the Validation
    // panel's count, at a time unknown.
    for (const started = Date.now(); Date.now() - started < LIMIT_MS; ) {
      if (!(await page.evaluate(() => window.__LA_GRAM_APP__.validationPending()))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const last = (await state()).validations.at(-1);
    const openFindings = last
      ? { findings: last.count, findingsAfterMs: Math.round(last.at) }
      : { findings: await page.evaluate(() => document.querySelector('validation-panel')?.results?.length ?? null), findingsAfterMs: null };

    const facts = await page.evaluate(() => {
      const app = window.__LA_GRAM_APP__;
      const vm = app.components.viewManager;
      const views = vm.getViews().map((v) => ({ iri: v.iri, nodes: vm.getNodes(v.iri).length })).sort((a, b) => b.nodes - a.nodes);
      return { triples: app.components.store.modelSize?.() ?? null, views: views.length, largest: views[0] ?? null };
    });

    // Opening its largest view.
    let view = null;
    if (facts.largest && facts.largest.nodes > 0) {
      const start = await now();
      await page.evaluate((iri) => window.__LA_GRAM_UI__.runCommand({ command: 'open-view', value: iri }), facts.largest.iri);
      await page.waitForFunction(() => document.querySelectorAll('.djs-shape').length > 0, null, { timeout: LIMIT_MS, polling: 'raf' });
      view = { nodes: facts.largest.nodes, ...(await phase(start, await now())) };
    }

    // Renaming an element of it.
    let rename = null;
    const element = await page.evaluate(() => {
      const app = window.__LA_GRAM_APP__;
      return app.components.viewManager.getNodes(app.session.activeViewIri)[0]?.elementIri ?? null;
    });
    if (element) {
      const seen = (await state()).validations.length;
      const start = await now();
      await page.evaluate((iri) => {
        window.__LA_GRAM_APP__.components.eventBus.emit('property-edited', {
          elementIri: iri,
          property: 'http://www.w3.org/2004/02/skos/core#prefLabel',
          value: 'Renamed by the benchmark',
        });
      }, element);
      rename = { ...(await phase(start)), ...(await findings(start, seen)) };
    }

    return { model: path.basename(file), ...facts, open: { ...open, ...openFindings }, view, rename, heapMB: await heaps(browser, page) };
  } finally {
    await browser.close();
    server.close();
  }
}

/** The heap after a collection, in MB: the page's, and each worker's. */
async function heaps(browser, page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const ui = Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6);
  const workers = [];
  const session = await browser.newBrowserCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  for (const target of targetInfos.filter((t) => t.type === 'worker')) {
    const { sessionId } = await session.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let id = 0;
    const call = (method) =>
      new Promise((resolve) => {
        const mine = ++id;
        const listen = (m) => {
          const message = JSON.parse(m.message);
          if (m.sessionId !== sessionId || message.id !== mine) return;
          session.off('Target.receivedMessageFromTarget', listen);
          resolve(message.result);
        };
        session.on('Target.receivedMessageFromTarget', listen);
        session.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: mine, method }) });
      });
    await call('HeapProfiler.collectGarbage');
    workers.push(Math.round((await call('Runtime.getHeapUsage')).usedSize / 1e6));
  }
  return { ui, workers };
}

const s = (ms) => (ms === null || ms === undefined ? '–' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1));
function table(rows) {
  const lines = [
    '| Model | Triples | Open (s) | Longest freeze (s) | Findings (after opening, s) | Largest view: nodes, open (s) | Rename: UI blocked (ms) | Findings after rename (s) | Heap: UI + worker (MB) |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.model} | ${r.triples?.toLocaleString('en-GB') ?? '–'} | ${s(r.open.ms)} | ${s(r.open.longestMs)} | ${r.open.findings ?? '–'} (${s(r.open.findingsAfterMs)}) | ${r.view ? `${r.view.nodes}, ${s(r.view.ms)}` : '–'} | ${r.rename?.blockedMs ?? '–'} | ${s(r.rename?.findingsAfterMs)} | ${r.heapMB.ui} + ${r.heapMB.workers.join(' + ') || 0} |`,
    );
  }
  return lines.join('\n');
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (!existsSync(path.join(WEB, 'index.html'))) {
    console.error('Build the web app first: npm run build:web');
    process.exit(1);
  }
  const files = [...opts.sizes.map((n) => generated(n, opts.viewSize)), ...opts.files.map((f) => path.resolve(f))];
  const rows = [];
  for (const file of files) {
    process.stderr.write(`${path.basename(file)} … `);
    const row = await measureModel(file);
    process.stderr.write(`opened in ${s(row.open.ms)} s\n`);
    rows.push(row);
  }
  mkdirSync(path.dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify({ date: new Date().toISOString(), rows }, null, 1));
  console.log(table(rows));
  console.log(`\n${path.relative(ROOT, opts.out)}`);
}

await main();
