/**
 * The benchmark (Task 22): open models in the built web app, in Chrome, and
 * measure what a modeller waits for — opening the model, opening its largest
 * view, renaming an element in it, opening the model again over itself — and
 * the memory it holds.
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
 *
 * The Graph tab (key decision 17), in four passes — animated and under reduced
 * motion, each at CPU rate 1 and throttled 4× — on every model at depths 1–5
 * round its most connected element, and on a graph model made for it
 * (`test-results/bench/graph.ttl`: a tree of each size from 100 to 3 000
 * elements), each tree drawn at depth 5 and, animated, a leaf dragged. How each
 * graph was laid out comes from the panel's `layoutStats()`; the frames from a
 * sampler of animation frames. The force layout's limits are read from the
 * throttled sweep, and checked by it:
 *
 *   node scripts/bench.mjs --graph              the graph model's sweep alone
 *
 * After the results are written, the run fails (exit 1) when a sweep row was not
 * laid out as the limits say, or a node limit is above 3 000.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { generateGraphModel, generateModel, GRAPH_SWEEP, graphTree } from './bench-model.mjs';

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
  // Options that take a value; --graph takes none.
  const flags = new Set(['--sizes', '--view-size', '--out']);
  const files = argv.filter((a, i) => !a.startsWith('--') && !flags.has(argv[i - 1]));
  const graph = argv.includes('--graph');
  return {
    files,
    sizes: value('sizes') ? value('sizes').split(',').map(Number) : files.length > 0 || graph ? [] : DEFAULT_SIZES,
    viewSize: Number(value('view-size') ?? 40),
    graph,
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

/** The graph model's file (`bench-model.mjs` `generateGraphModel`), made when it is not there yet. */
function generatedGraph() {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'graph.ttl');
  if (!existsSync(file)) writeFileSync(file, generateGraphModel({ seed: 1 }).text);
  return file;
}

/** The Graph tab's four passes. */
const PASSES = [
  { name: 'animated', reducedMotion: false, rate: 1 },
  { name: 'reduced motion', reducedMotion: true, rate: 1 },
  { name: 'animated, 4× CPU', reducedMotion: false, rate: 4 },
  { name: 'reduced motion, 4× CPU', reducedMotion: true, rate: 4 },
];
/** An animated pass of the sweep stops at the first size whose median frame interval passes this. */
const SWEEP_STOP_MS = 100;
/** The sweep's largest size: no node limit may be above it. */
const LIMIT_CEILING = 3000;
/** How long one Graph measurement may take before it is given up. */
const GRAPH_LIMIT_MS = 10 * 60 * 1000;

/** Emulate a pass: the reduced-motion preference and the CPU rate (through CDP). */
async function setPass(page, cdp, pass) {
  await page.emulateMedia({ reducedMotion: pass?.reducedMotion ? 'reduce' : null });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: pass?.rate ?? 1 });
}

/**
 * One Graph tab measurement, in the page (key design decision 17):
 * a frame sampler that records each animation frame's time and nothing else, the
 * call (select an element, or set the depth: both draw before they return), a wait
 * for `data-layout="settled"` polled every frame, two frames more; then the graph,
 * how it was laid out (`layoutStats()`), the time to rest, the frame intervals,
 * the longest task in the window and, when the simulation laid it out, its run.
 */
async function measureGraph(page, call) {
  return page.evaluate(
    async ([call, limitMs]) => {
      const ui = window.__LA_GRAM_UI__;
      const panel = ui.graphPanel;
      const cy = () => panel.shadowRoot.querySelector('.cy');
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const frames = [];
      let sampling = true;
      const sample = (t) => {
        frames.push(t);
        if (sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      const start = performance.now();
      if (call.kind === 'select') {
        ui.selectConcept(call.iri);
        await panel.updateComplete;
      } else panel.setDepth(call.depth);
      const called = performance.now();
      let timedOut = false;
      while (cy().dataset.layout !== 'settled') {
        if (performance.now() - start > limitMs) {
          timedOut = true;
          break;
        }
        await frame();
      }
      await frame();
      await frame();
      sampling = false;
      const end = performance.now();
      // Long tasks are reported after they end: give the observer a moment.
      await new Promise((r) => setTimeout(r, 100));
      const stats = panel.layoutStats();
      // This call's run: a depth that reaches nothing more changes nothing drawn, starts no run, and leaves an
      // earlier run's figures, which started before the call.
      const run = stats.drawnBy === 'force' && stats.run && !(stats.run.startedAt < start) ? stats.run : undefined;
      const intervals = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
      const at = (q) => (intervals.length > 0 ? intervals[Math.min(intervals.length - 1, Math.floor(q * intervals.length))] : null);
      const tasks = window.__bench.tasks.filter(([t, d]) => t + d >= start && t <= end);
      // After the call: the frames of an animation or the slices of a layout laid out at once.
      const after = tasks.filter(([t]) => t >= called);
      return {
        elements: panel.graph?.nodes.length ?? 0,
        lines: panel.graph?.edges.length ?? 0,
        laidOut: stats.drawnBy === 'force' ? (run ? (run.mode === 'animate' ? 'animated' : 'at once') : 'unchanged') : stats.drawnBy,
        restMs: run?.endedAt !== undefined ? run.endedAt - start : called - start,
        // The call's own time: the walk, the drawing's update and what a selection does elsewhere. The time to
        // rest less this is the layout's own, which the animation limit's 3 s rule is about.
        callMs: called - start,
        medianFrameMs: at(0.5),
        p95FrameMs: at(0.95),
        longestTaskMs: Math.max(0, ...tasks.map(([, d]) => d)),
        longestAfterCallMs: Math.max(0, ...after.map(([, d]) => d)),
        ...(run ? { steps: run.steps, syncMs: run.syncMs, meanStepMs: run.steps > 0 ? run.computeMs / run.steps : null, alpha: run.alpha } : {}),
        ...(timedOut ? { timedOut } : {}),
        limits: stats.limits,
      };
    },
    [call, GRAPH_LIMIT_MS],
  );
}

/**
 * Drag a drawn element: pressed at its rendered centre, moved 200 px towards the
 * drawing's middle in 30 mouse steps, released; then a wait for rest. The frame
 * intervals while it is held. Not measured when its centre is outside the
 * drawing, or when `data-layout` did not read `running` while it was held: the
 * drag was not live (a live drag keeps the simulation running; a pan reports nothing).
 */
async function dragGraph(page, iri) {
  const box = await page.locator('graph-panel .cy').boundingBox();
  const centre = await page.evaluate((iri) => {
    const p = window.__LA_GRAM_UI__.graphPanel.drawnPositions('rendered').get(iri);
    return p ? { x: p.x, y: p.y } : null;
  }, iri);
  if (!box || !centre || centre.x < 0 || centre.y < 0 || centre.x > box.width || centre.y > box.height) return { measured: false, why: 'outside the drawing' };
  await page.evaluate(() => {
    const sampler = { frames: [], on: true };
    window.__benchDrag = sampler;
    const sample = (t) => {
      sampler.frames.push(t);
      if (sampler.on) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const from = { x: box.x + centre.x, y: box.y + centre.y };
  const toward = centre.x > box.width / 2 ? -1 : 1;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + toward * 200, from.y, { steps: 30 });
  const held = await page.evaluate(() => document.querySelector('graph-panel').shadowRoot.querySelector('.cy').dataset.layout);
  const frames = await page.evaluate(() => {
    window.__benchDrag.on = false;
    return window.__benchDrag.frames;
  });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('graph-panel').shadowRoot.querySelector('.cy').dataset.layout === 'settled', null, {
    timeout: GRAPH_LIMIT_MS,
    polling: 'raf',
  });
  if (held !== 'running') return { measured: false, why: 'not live' };
  const intervals = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const at = (q) => (intervals.length > 0 ? intervals[Math.min(intervals.length - 1, Math.floor(q * intervals.length))] : null);
  return { measured: true, medianFrameMs: at(0.5), p95FrameMs: at(0.95) };
}

/** Wait for the Graph tab at rest with a graph drawn. */
async function graphAtRest(page) {
  await page.waitForFunction(
    () => {
      const panel = window.__LA_GRAM_UI__.graphPanel;
      return (panel.graph?.nodes.length ?? 0) > 0 && panel.shadowRoot.querySelector('.cy')?.dataset.layout === 'settled';
    },
    null,
    { timeout: GRAPH_LIMIT_MS, polling: 'raf' },
  );
}

/** The depth walk: round the model's most connected element, depth 1 to 5, in each pass. */
async function graphWalk(page) {
  const hub = await page.evaluate(() => {
    const store = window.__LA_GRAM_APP__.components.store;
    const counts = new Map();
    for (const p of ['https://meta.linked.archi/core#source', 'https://meta.linked.archi/core#target'])
      for (const q of store.getQuads(null, { termType: 'NamedNode', value: p }, null))
        if (q.graph.termType === 'DefaultGraph' && q.object.termType === 'NamedNode') counts.set(q.object.value, (counts.get(q.object.value) ?? 0) + 1);
    let best = null;
    for (const [iri, n] of counts) if (!best || n > best.n) best = { iri, n };
    return best;
  });
  if (!hub) return null;
  // Two tasks, as a user's: the selection, then the tab, so the drawing is made with the tab shown.
  await page.evaluate((iri) => window.__LA_GRAM_UI__.selectConcept(iri), hub.iri);
  await page.evaluate(() => window.__LA_GRAM_UI__.showBottomTab('graph'));
  await graphAtRest(page);
  const cdp = await page.context().newCDPSession(page);
  const passes = [];
  try {
    for (const pass of PASSES) {
      await setPass(page, cdp, pass);
      const depths = [];
      for (let depth = 1; depth <= 5; depth++) depths.push({ depth, ...(await measureGraph(page, { kind: 'depth', depth })) });
      passes.push({ pass: pass.name, depths });
    }
  } finally {
    await setPass(page, cdp, undefined);
  }
  return { element: hub.iri, relationships: hub.n, passes };
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

    // Opening it again, over itself — as File › Open over an open model does.
    const again = await (async () => {
      const start = await now();
      await page.evaluate(async ([url, name]) => {
        const text = await (await fetch(url)).text();
        await window.__LA_GRAM_APP__.openModel(text, name);
      }, [base + modelPath, path.basename(file)]);
      return phase(start, await now());
    })();

    // The Graph tab round the most connected element, depth 1 to 5, in each pass.
    const graph = await graphWalk(page);

    return { model: path.basename(file), ...facts, open: { ...open, ...openFindings }, view, rename, again, graph, heapMB: await heaps(browser, page) };
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * The sweep on the graph model: the depth set to 5, each tree's root selected in
 * turn, smallest first — a first drawing of exactly the tree's size — and, in an
 * animated pass, its last element dragged. An animated pass stops at the first
 * size whose median frame passes 100 ms; the larger sizes are not measured.
 */
async function measureSweep(file) {
  const { server, base, modelPath } = await serve(file);
  const executablePath = process.env.LA_GRAM_CHROME;
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: 'chrome' }), args: ['--disable-gpu'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.addInitScript(instrument);
    await page.goto(`${base}/index.html?model=${encodeURIComponent(base + modelPath)}`, { waitUntil: 'load' });
    const last = graphTree(GRAPH_SWEEP.at(-1)).root;
    await page.waitForFunction(
      (iri) => window.__bench?.ready != null && window.__LA_GRAM_APP__.components.store.getQuads({ termType: 'NamedNode', value: iri }, null, null).length > 0,
      last,
      { timeout: LIMIT_MS, polling: 500 },
    );
    // Validation runs in a worker; the sweep's frames are not to share the machine with it.
    for (const started = Date.now(); Date.now() - started < LIMIT_MS; ) {
      if (!(await page.evaluate(() => window.__LA_GRAM_APP__.validationPending()))) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await page.evaluate(() => window.__LA_GRAM_UI__.showBottomTab('graph'));
    await page.evaluate(() => window.__LA_GRAM_UI__.graphPanel.setDepth(5));
    const cdp = await page.context().newCDPSession(page);
    const rows = [];
    try {
      for (const pass of PASSES) {
        await setPass(page, cdp, pass);
        let stopped = false;
        for (const size of GRAPH_SWEEP) {
          const row = { size, pass: pass.name, reducedMotion: pass.reducedMotion, rate: pass.rate };
          if (stopped) {
            rows.push({ ...row, measured: false });
            continue;
          }
          const { root, leaf } = graphTree(size);
          const m = await measureGraph(page, { kind: 'select', iri: root });
          Object.assign(row, { measured: true }, m);
          if (!pass.reducedMotion) {
            if (m.medianFrameMs !== null && m.medianFrameMs > SWEEP_STOP_MS) {
              stopped = true;
              row.drag = { measured: false, why: `animation past ${SWEEP_STOP_MS} ms a frame` };
            } else row.drag = await dragGraph(page, leaf);
          }
          rows.push(row);
          process.stderr.write(`  ${size} elements, ${pass.name}: ${m.laidOut}, at rest in ${s(m.restMs)} s, p95 frame ${Math.round(m.p95FrameMs ?? 0)} ms\n`);
        }
      }
    } finally {
      await setPass(page, cdp, undefined);
    }
    const limits = await page.evaluate(() => window.__LA_GRAM_UI__.graphPanel.layoutStats()?.limits);
    return { model: path.basename(file), limits, rows };
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
const ms = (n, digits = 0) => (n === null || n === undefined ? '–' : n.toFixed(digits));
/** The models table's Graph column: depth 5 in the animated pass at CPU rate 1. */
function graphCell(r) {
  const d5 = r.graph?.passes.find((p) => p.pass === PASSES[0].name)?.depths.find((d) => d.depth === 5);
  return d5 ? `${d5.elements}, ${d5.laidOut}, ${s(d5.restMs)}, ${ms(d5.p95FrameMs)}` : '–';
}
function table(rows) {
  const lines = [
    '| Model | Triples | Open (s) | Longest freeze (s) | Findings (after opening, s) | Largest view: nodes, open (s) | Rename: UI blocked (ms) | Findings after rename (s) | Open again, over it (s) | Graph, depth 5: elements, laid out, at rest (s), p95 frame (ms) | Heap: UI + worker (MB) |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.model} | ${r.triples?.toLocaleString('en-GB') ?? '–'} | ${s(r.open.ms)} | ${s(r.open.longestMs)} | ${r.open.findings ?? '–'} (${s(r.open.findingsAfterMs)}) | ${r.view ? `${r.view.nodes}, ${s(r.view.ms)}` : '–'} | ${r.rename?.blockedMs ?? '–'} | ${s(r.rename?.findingsAfterMs)} | ${s(r.again?.ms)} | ${graphCell(r)} | ${r.heapMB.ui} + ${r.heapMB.workers.join(' + ') || 0} |`,
    );
  }
  return lines.join('\n');
}

/** The sweep: for each size and pass, how it was laid out, the time to rest, the frames, the longest task, the run, the drag. */
function sweepTable(sweep) {
  const lines = [
    `Graph sweep, ${sweep.model} (limits: animateMaxNodes ${sweep.limits?.animateMaxNodes}, liveDragMaxNodes ${sweep.limits?.liveDragMaxNodes}, forceMaxNodes ${sweep.limits?.forceMaxNodes})`,
    '',
    '| Elements | Pass | Laid out | At rest (s) | The call (s) | Median frame (ms) | p95 frame (ms) | Longest task (ms) | after the call (ms) | Steps | Mean step (ms) | Alpha | Drag p95 (ms) |',
    '|--:|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const r of sweep.rows) {
    if (!r.measured) {
      lines.push(`| ${r.size} | ${r.pass} | not measured | | | | | | | | | | |`);
      continue;
    }
    const drag = r.drag === undefined ? '' : r.drag.measured ? ms(r.drag.p95FrameMs) : `not measured (${r.drag.why})`;
    lines.push(
      `| ${r.size} | ${r.pass} | ${r.laidOut}${r.timedOut ? ' (timed out)' : ''} | ${s(r.restMs)} | ${s(r.callMs)} | ${ms(r.medianFrameMs)} | ${ms(r.p95FrameMs)} | ${ms(r.longestTaskMs)} | ${ms(r.longestAfterCallMs)} | ${r.steps ?? '–'} | ${ms(r.meanStepMs, 1)} | ${r.alpha === undefined ? '–' : r.alpha.toFixed(3)} | ${drag} |`,
    );
  }
  return lines.join('\n');
}

/**
 * The sweep's checks: every row laid out as its limits say — animated up to
 * animateMaxNodes in an animated pass, laid out at once otherwise, in rings above
 * forceMaxNodes — and no node limit above the sweep's largest size.
 */
function sweepErrors(sweep) {
  const errors = [];
  const limits = sweep.limits;
  if (!limits) return [`${sweep.model}: the Graph tab gave no limits`];
  for (const name of ['animateMaxNodes', 'liveDragMaxNodes', 'forceMaxNodes'])
    if (!(limits[name] <= LIMIT_CEILING)) errors.push(`${name} is ${limits[name]}: above ${LIMIT_CEILING}, the sweep's largest size`);
  for (const r of sweep.rows.filter((r) => r.measured)) {
    const expected = r.size > limits.forceMaxNodes ? 'rings' : !r.reducedMotion && r.size <= limits.animateMaxNodes ? 'animated' : 'at once';
    if (r.timedOut) errors.push(`${r.size} elements, ${r.pass}: did not come to rest`);
    if (r.elements !== r.size) errors.push(`${r.size} elements, ${r.pass}: drew ${r.elements}`);
    if (r.laidOut !== expected) errors.push(`${r.size} elements, ${r.pass}: laid out ${r.laidOut}; the limits say ${expected}`);
  }
  return errors;
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (!existsSync(path.join(WEB, 'index.html'))) {
    console.error('Build the web app first: npm run build:web');
    process.exit(1);
  }
  const files = opts.graph ? [] : [...opts.sizes.map((n) => generated(n, opts.viewSize)), ...opts.files.map((f) => path.resolve(f))];
  const rows = [];
  for (const file of files) {
    process.stderr.write(`${path.basename(file)} … `);
    const row = await measureModel(file);
    process.stderr.write(`opened in ${s(row.open.ms)} s\n`);
    rows.push(row);
  }
  // The graph model's sweep, after the other models (or alone, with --graph).
  const graphFile = generatedGraph();
  process.stderr.write(`${path.basename(graphFile)}, the Graph tab's sweep …\n`);
  const sweeps = [await measureSweep(graphFile)];
  mkdirSync(path.dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify({ date: new Date().toISOString(), rows, sweeps }, null, 1));
  if (rows.length > 0) console.log(table(rows) + '\n');
  for (const sweep of sweeps) console.log(sweepTable(sweep) + '\n');
  console.log(path.relative(ROOT, opts.out));
  // After the results are written, so that a run that fails keeps them.
  const errors = sweeps.flatMap(sweepErrors);
  if (errors.length > 0) {
    console.error(`\nThe Graph tab's limits do not hold:\n${errors.map((e) => `- ${e}`).join('\n')}`);
    process.exit(1);
  }
}

await main();
