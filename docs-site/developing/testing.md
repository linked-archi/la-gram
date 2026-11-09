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

The suite includes benchmark tests (`*-bench.test.ts`, `bench-*.test.ts`), which time the machine they
run on; CI leaves them out with `--exclude`.

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
is measured. Build first with `npm run build:web`. Each model gets a browser of its own, and a table is
printed.

| Option | Values | Default |
|---|---|---|
| `--sizes <n,n…>` | the sizes of generated models, in triples | **10 000, 50 000, 100 000, 250 000, 500 000**, when no model file is given |
| `--view-size <n>` | the nodes of each generated model's largest view | **40** |
| `--out <file>` | where the results go, as JSON | **`test-results/bench/results-<date and time>.json`** |
| model files | your own models, instead of generated ones: `npm run bench -- path/to/model.ttl …` | — |

Generated models are kept in `test-results/bench/`, as `model-<n>.ttl` (or `model-<n>-view<m>.ttl`), and
reused when they are there. `--out` names a file, not a folder. All of `test-results/` is git-ignored.

A small generated model, its largest view ten nodes, the results to a scratch file:

```console
$ npm run bench -- --sizes 1000 --view-size 10 --out /tmp/la-gram-docs-bench/sizes.json
…
model-1000-view10.ttl … opened in 1.11 s
| Model | Triples | Open (s) | Longest freeze (s) | Findings (after opening, s) | Largest view: nodes, open (s) | Rename: UI blocked (ms) | Findings after rename (s) | Open again, over it (s) | Heap: UI + worker (MB) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| model-1000-view10.ttl | 984 | 1.11 | 0.47 | 10 (1.26) | 11, 0.03 | 0 | 0.31 | 0.09 | 23 + 30 |
```

A model file of your own:

```console
$ npm run bench -- /tmp/la-gram-docs-bench/model.ttl --out /tmp/la-gram-docs-bench/results.json
model.ttl … opened in 3.34 s
…
| model.ttl | 958 | 3.34 | 1.34 | 11 (3.87) | 11, 0.10 | 0 | 0.33 | 0.23 | 49 + 31 |
```

Times depend on the machine: compare runs made on the same one.

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

Two tests time and test la-gram's three-way merge, the one *Save to Git* and `la-gram-git merge` use, and
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
