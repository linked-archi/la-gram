---
title: Testing and benchmarks
description: How to run la-gram's type check, unit tests, browser suite and benchmarks, and which of them CI runs.
---
# Testing and benchmarks

| Command | Runs | In CI |
|---|---|---|
| [`npm run typecheck`](#npm-run-typecheck) | the TypeScript compiler, with no output | yes |
| [`npm test`](#npm-test) | the unit and integration tests, in Vitest with jsdom | yes, without the benchmarks |
| [`npm run test:browser`](#npm-run-test-browser) | the browser suite, in Chrome against `dist/web`, and the desktop app's | **no** |
| [`npm run bench`](#npm-run-bench) | the benchmark, in Chrome | no |

Before a merge request, run what CI runs:

```sh
npm run typecheck && npx vitest run --exclude '**/{*-bench,bench-*}.test.ts'
```

## `npm run typecheck` {#npm-run-typecheck}

`tsc --noEmit`: the whole project type-checked, nothing written. It prints nothing when all is well, and
the errors with their files and lines when not.

```console
$ npm run typecheck

> la-gram@0.1.0 typecheck
> tsc --noEmit

```

## `npm test` {#npm-test}

Vitest, once: every `src/**/*.test.ts` (property tests included), in jsdom with the shims in
`tests/setup/jsdom-shims.ts`. It needs no build and no browser. Name test files after `--` to run only
those. Two variants:

| Script | Runs |
|---|---|
| `npm test` | Vitest once (`vitest --run`) |
| `npm run test:watch` | Vitest in watch mode: again on every change, until ++q++ |
| `npm run test:coverage` | Vitest once, with V8 coverage of `src/**/*.ts`: a table in the terminal and an HTML report in `coverage/` |

The kernel’s own tests run in the kernel repository; the 14 app-dependent integrations stay in
`src/__tests__/kernel/`. `kernel-package.test.ts` checks runtime dependency identity and build asset sources.

The suite includes benchmark tests (`*-bench.test.ts`, `bench-*.test.ts`), which time the machine they
run on. `npm test` runs them last and on their own — Vitest's *timing* project, after the *unit* project's
files, which run side by side — so they time the code and not the other tests; CI leaves them out with
`--exclude`. `npm test -- --project unit` runs the rest alone, `npm test -- --project timing` only the
benchmarks.

```console
$ npm test -- src/__tests__/config.test.ts

> la-gram@0.1.0 test
> vitest --run src/__tests__/config.test.ts

 RUN  v1.6.1 …

 ✓ src/__tests__/config.test.ts  (19 tests) 5ms

 Test Files  1 passed (1)
      Tests  19 passed (19)
```

```console
$ npm run test:watch -- src/__tests__/config.test.ts
…
 ✓ src/__tests__/config.test.ts  (19 tests) 5ms
…
 PASS  Waiting for file changes...
       press h to show help, press q to quit
```

```console
$ npm run test:coverage -- src/__tests__/config.test.ts --coverage.include=src/config.ts
…
 % Coverage report from v8
-----------|---------|----------|---------|---------|---------------------------
File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------|---------|----------|---------|---------|---------------------------
All files  |   94.66 |    86.11 |      90 |   94.66 |
 config.ts |   94.66 |    86.11 |      90 |   94.66 | ...26-228,236-238,276-277
-----------|---------|----------|---------|---------|---------------------------
```

## `npm run test:browser` {#npm-run-test-browser}

The browser suite: Vitest drives Chrome with Playwright against the built web app, `dist/web`, served by
the suite's own static server, and `tests/browser/electron.spec.ts` starts the desktop app from
`dist/electron`. It covers what jsdom cannot: the canvas, the WebAssembly store, the worker, the panels,
Git merges in the page, and the desktop app's isolation.

- **Build first:** `npm run build:web`, and `npm run build:electron` for the Electron tests, which are
  skipped without `dist/electron` or Electron's binary. `npm run test:browser:build` builds the web app
  and runs the suite in one go.
- **Chrome:** the system's, or `LA_GRAM_CHROME` ([below](#chrome)).
- **Screenshots** go to `test-results/browser/`, git-ignored.
- **CI does not run it.** The pipeline's `test` job runs the type check and Vitest only: the browser suite
  and the Electron test run only where you run them. Run it before a release, and after any change to the
  canvas, the panels or the desktop app.

With `dist/web` and `dist/electron` built:

```console
$ npm run test:browser
…
 ✓ tests/browser/git-merge.spec.ts  (4 tests) 6578ms
 ✓ tests/browser/electron.spec.ts  (2 tests) 2638ms

 Test Files  4 passed (4)
      Tests  76 passed (76)
   Duration  105.43s
```

## Chrome {#chrome}

The browser suite, the benchmark, `npm run icons` and `npm run docs:screenshots` drive Google Chrome
through Playwright: the system's Chrome by default (Playwright's `chrome` channel). `LA_GRAM_CHROME`
names another Chrome or Chromium executable instead, for a machine without Chrome or with it elsewhere.

```console
$ LA_GRAM_CHROME=/tmp/la-gram-docs-nowhere/chrome npm run docs:screenshots
…
Chrome did not start (LA_GRAM_CHROME=/tmp/la-gram-docs-nowhere/chrome): browserType.launch: Failed to launch chromium because executable doesn't exist at /tmp/la-gram-docs-nowhere/chrome
Install Google Chrome, or set LA_GRAM_CHROME to the path of a Chrome or Chromium executable.
```

On macOS, the system's Chrome is
`LA_GRAM_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

## `npm run bench` {#npm-run-bench}

What a modeller waits for on a large model: the built web app opens each model in Chrome, then its
largest view, renames an element in it, and opens the model again over itself, and the memory it holds
is measured; then the Graph tab, round the model's most connected element, at each depth from 1 to 5.
Then comes the Graph tab's sweep, on a graph model made for it ([below](#bench-graph)), and last
*Arrange view* on three diagrams made for it ([below](#bench-layout)). Build first with
`npm run build:web`. Each model gets a browser of its own, and tables are printed.

| Option | Values | Default |
|---|---|---|
| `--sizes <n,n…>` | the sizes of generated models, in triples | **10 000, 50 000, 100 000, 250 000, 500 000**, when no model file is given |
| `--view-size <n>` | the nodes of each generated model's largest view | **40** |
| `--graph` | the Graph tab's sweep alone, without the other models | **off**: the sweep follows the models |
| `--layout` | *Arrange view* alone, without the other models; with `--graph`, the two without the models | **off**: it follows the Graph tab's sweep |
| `--out <file>` | where the results go, as JSON | **`test-results/bench/results-<date and time>.json`** |
| model files | your own models, instead of generated ones: `npm run bench -- path/to/model.ttl …` | — |

Generated models are kept in `test-results/bench/`, as `model-<n>.ttl` (or `model-<n>-view<m>.ttl`),
`graph.ttl` and `layout-<n>.ttl`, and reused when they are there. `--out` names a file, not a folder. All of `test-results/` is
git-ignored.

A small generated model, its largest view ten nodes, the results to a scratch file:

```console
$ npm run bench -- --sizes 1000 --view-size 10 --out /tmp/la-gram-docs-bench/sizes.json
…
model-1000-view10.ttl … opened in 1.03 s
graph.ttl, the Graph tab's sweep …
…
| Model | Triples | Open (s) | Longest freeze (s) | Findings (after opening, s) | Largest view: nodes, open (s) | Rename: UI blocked (ms) | Findings after rename (s) | Open again, over it (s) | Graph, depth 5: elements, laid out, at rest (s), p95 frame (ms) | Heap: UI + worker (MB) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| model-1000-view10.ttl | 984 | 1.03 | 0.45 | 10 (1.24) | 11, 0.04 | 0 | 0.33 | 0.10 | 30, animated, 1.38, 17 | 26 + 30 |
…
```

A model file of your own:

```console
$ npm run bench -- /tmp/la-gram-docs-bench/model.ttl --out /tmp/la-gram-docs-bench/results.json
…
model.ttl … opened in 2.97 s
…
| model.ttl | 958 | 2.97 | 1.21 | 11 (3.46) | 11, 0.10 | 0 | 0.35 | 0.23 | 30, unchanged, 0.00, 17 | 53 + 31 |
…
```

Times depend on the machine: compare runs made on the same one.

### The Graph tab {#bench-graph}

Each Graph measurement makes the call a user's click makes — selecting an element, or a depth — and
waits for the graph at rest, sampling the animation frames meanwhile. It is made in four **passes**:
*animated*, and under *reduced motion*, each at the processor's own speed and slowed four times
(*4× CPU*: Chrome's CPU throttling, through its DevTools protocol), which stands for a typical laptop.

- **The depth walk**, on every model: round the element with the most relationships, depth 1 to 5. The
  models' table has the column *Graph, depth 5: elements, laid out, at rest (s), p95 frame (ms)*, from
  the animated pass: how many elements, how Force laid them out — *animated*, *at once*, *rings*, or
  *unchanged* when the depth reached nothing more — when it came to rest, and the 95th percentile of
  the frame intervals.
- **The sweep**, on `test-results/bench/graph.ttl`: a tree of each size from 100 to 3 000 elements (12 300
  Application Components and 17 207 Flow relationships, made by `generateGraphModel` in
  `scripts/bench-model.mjs`), each drawn whole at depth 5 from its root, smallest first; in an animated
  pass, its last element is dragged 200 px after. The sweep's table gives, for each size and pass: how it
  was laid out, the time to rest from the call, the call's own time, the median and the 95th-percentile
  frame interval, the longest task (and the longest after the call), the layout's steps, its mean step,
  the alpha it reached, and the p95 frame while the element was dragged (*not measured* where the drag
  was not live). An animated pass stops at the first size whose median frame passes 100 ms; the sizes
  after it are *not measured*.

**The limits.** The sweep measures the force layout's three limits, `animateMaxNodes`,
`liveDragMaxNodes` and `forceMaxNodes` in `src/ui/panels/graph-force.ts`, and checks them. la-gram's are
**100**, **100** and **800** ([Relationship graph › Layout](../guide/graph.md#layout)). To measure them
again:

1. Set the three to 5 000, then `npm run build:web` and `npm run bench -- --graph`.
2. Read the *4× CPU* rows. Each limit is the largest size at and below which every size passes:
   `forceMaxNodes`, the reduced-motion mean step at most 16 ms; `animateMaxNodes`, at most that, the
   animated median frame at most 20 ms, its p95 at most two 60 Hz frames (33 ms), and the graph at rest
   within 3 s of the call's return (*At rest* less *The call*); `liveDragMaxNodes`, between the two, the
   drag's p95 at most 50 ms.
3. Set the values, build again, and run `npm run bench -- --graph` again.

Every run ends by checking each row of the sweep against the limits it ran with: animated up to
`animateMaxNodes` in an animated pass, laid out at once otherwise, in rings above `forceMaxNodes`; and
that none of the three is above 3 000, the sweep's largest size. When one does not hold, the run fails
with exit code 1, after writing its results, as a measuring run with limits of 5 000 does.

The sweep alone, with la-gram's limits:

```console
$ npm run bench -- --graph --out test-results/bench/graph-regression.json
…
graph.ttl, the Graph tab's sweep …
  100 elements, animated: animated, at rest in 2.50 s, p95 frame 17 ms
  200 elements, animated: at once, at rest in 1.00 s, p95 frame 817 ms
…
Graph sweep, graph.ttl (limits: animateMaxNodes 100, liveDragMaxNodes 100, forceMaxNodes 800)

| Elements | Pass | Laid out | At rest (s) | The call (s) | Median frame (ms) | p95 frame (ms) | Longest task (ms) | after the call (ms) | Steps | Mean step (ms) | Alpha | Drag p95 (ms) |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 100 | animated | animated | 2.50 | 0.61 | 17 | 17 | 615 | 194 | 300 | 0.3 | 0.001 | 17 |
| 200 | animated | at once | 1.00 | 0.67 | 17 | 817 | 667 | 177 | 200 | 0.5 | 0.001 | not measured (not live) |
…
| 1000 | animated | rings | 0.78 | 0.78 | 933 | 933 | 174 | 174 | – | – | – | not measured (animation past 100 ms a frame) |
| 1200 | animated | not measured | | | | | | | | | | |
…
| 800 | reduced motion, 4× CPU | at once | 5.42 | 2.27 | 17 | 17 | 2275 | 765 | 129 | 11.6 | 0.012 |  |
| 1000 | reduced motion, 4× CPU | rings | 2.79 | 2.79 | 3300 | 3300 | 560 | 560 | – | – | – |  |
…
test-results/bench/graph-regression.json
```

The end of a measuring run, the three limits at 5 000:

```console
$ npm run bench -- --graph --out test-results/bench/graph-measuring-2.json
…
test-results/bench/graph-measuring-2.json

The Graph tab's limits do not hold:
- animateMaxNodes is 5000: above 3000, the sweep's largest size
- liveDragMaxNodes is 5000: above 3000, the sweep's largest size
- forceMaxNodes is 5000: above 3000, the sweep's largest size
```

### Arrange view {#bench-layout}

Three generated models, `test-results/bench/layout-100.ttl`, `layout-500.ttl` and `layout-2000.ttl`, each
one diagram of that many elements with every relationship between them drawn — two from each element, to
elements of the types ArchiMate 4.0 permits, so twice as many relationships, between every band. Each is
opened, validation is let finish, and *Arrange view…* is run from the canvas toolbar with the dialog's
defaults, at the processor's own speed and at *4× CPU*. The table gives, for each: whether ELK laid it out
or the grid, the time from *Arrange* to la-gram's message, the UI blocked in that time (the long tasks
summed), the longest task, and how many pairs of elements are over one another.

The run fails with exit code 1, after writing its results, when a diagram at the processor's own speed was
placed in the grid, was not arranged, or has an element over another. ELK's effort by the diagram's size
(Req 21.13) was set from these runs.

```console
$ npm run bench -- --layout
…
layout-100.ttl, Arrange view …
  100 elements, CPU 1×: elk, 0.43 s, longest task 101 ms
  100 elements, CPU 4×: elk, 0.82 s, longest task 594 ms
layout-500.ttl, Arrange view …
  500 elements, CPU 1×: elk, 1.92 s, longest task 525 ms
…
Arrange view

| Elements | Relationships | Pass | Laid out by | Arranged in (s) | UI blocked (ms) | Longest task (ms) | Overlapping pairs |
|--:|--:|---|---|--:|--:|--:|--:|
| 100 | 200 | CPU 1× | ELK | 0.43 | 101 | 101 | 0 |
| 100 | 200 | CPU 4× | ELK | 0.82 | 594 | 594 | 0 |
| 500 | 1000 | CPU 1× | ELK | 1.92 | 525 | 525 | 0 |
| 500 | 1000 | CPU 4× | ELK | 4.24 | 2929 | 2929 | 0 |
| 2000 | 4000 | CPU 1× | ELK | 6.62 | 2141 | 2078 | 0 |
| 2000 | 4000 | CPU 4× | ELK | 16.0 | 11540 | 11301 | 0 |

test-results/bench/results-2026-11-15T11-15-07-873Z.json
```

The layout itself runs in a worker; the long tasks are writing its result and drawing the diagram again.

## `npm run bench:model` {#npm-run-bench-model}

Writes a generated benchmark model, to open by hand or to give to `npm run bench`. The same options give
the same model: the elements of 30 types, two permitted relationships each, laid-out views, and a few
planted faults (an unnamed element in every 997, an impermissible relationship in every 503), so
validation always finds the same. It prints what it wrote, as JSON.

| Option | Values | Default |
|---|---|---|
| `--triples <n>` | about how many triples | **10000** |
| `--view-size <n>` | the nodes in the largest view | **40** |
| `--seed <n>` | the generator's seed | **1** |
| `--language <v>` | the ArchiMate version: `4.0` or `3.2` | **`4.0`** |
| `--out <file>` | the file to write | **`model-<n>[-view<m>][-am3].ttl`**, in the checkout's top folder |

`--view-size`, `--seed` and `--language` are not in the README; they are in the script.

```console
$ npm run bench:model -- --triples 1000 --view-size 10 --seed 2 --language 3.2 --out /tmp/la-gram-docs-bench/model.ttl
…
{"out":"/tmp/la-gram-docs-bench/model.ttl","triples":842,"elements":30,"relationships":60,"views":3,"nodes":32,"links":28,"unnamed":0,"notPermitted":0}
$ npm run bench:model -- --triples 1000 --out /tmp/la-gram-docs-bench/model-am4.ttl
…
{"out":"/tmp/la-gram-docs-bench/model-am4.ttl","triples":1010,"elements":30,"relationships":60,"views":1,"nodes":30,"links":60,"unnamed":0,"notPermitted":0}
```

## The merge benchmark {#merge-benchmark}

In the **linked-archi-kernel checkout**, two tests time and test the shared three-way merge, the one *Save to Git* and `la-gram-git merge` use, and
take their size from the environment:

| Variable | Test | Default |
|---|---|---|
| `MERGE_BENCH_TRIPLES` | `src/model-manager/__tests__/model-merge-bench.test.ts`: reads and merges a generated model of this many triples within a time limit | **100 000** (the limit: 1 s, more in proportion above 116 667 triples) |
| `MERGE_RUNS` | `src/model-manager/__tests__/model-merge.property.test.ts`: the number of random cases per property | **60** |

```console
$ MERGE_BENCH_TRIPLES=10000 npx vitest run src/model-manager/__tests__/model-merge-bench.test.ts
…
merge bench: 9980 lines; reading one version 23 ms; merging 20 ms; 1 conflicts; diff by element 6 ms, 6 concepts
 ✓ src/model-manager/__tests__/model-merge-bench.test.ts  (1 test) 67ms
$ MERGE_RUNS=5 npx vitest run src/model-manager/__tests__/model-merge.property.test.ts
…
 ✓ src/model-manager/__tests__/model-merge.property.test.ts  (4 tests) 130ms
```

`MERGE_BENCH_TRIPLES=350000` measures the large case the test was written for; `MERGE_RUNS=1000`
searches longer.
