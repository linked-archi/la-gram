import { defineConfig } from 'vitest/config';

/**
 * Browser smoke suite — deliberately a *separate* Vitest config.
 *
 * Why a second config rather than a project or a standalone runner:
 *
 * - Separate config, not a Vitest "project": the two suites share nothing.
 *   The unit suite runs in jsdom against `src/`; this one runs in Node, drives
 *   Chrome over Playwright, and needs `dist/web` on disk. A workspace would
 *   make `npm test` responsible for both, and the whole point is that
 *   `npm test` stays a five-second feedback loop with no build step.
 * - Not a standalone runner: `describe`/`it`/`expect`, per-test timeouts and
 *   the failure reporting are exactly what a runner would have to reimplement,
 *   and Vitest is already a dependency. Nothing is gained by hand-rolling it.
 *
 * The unit config's `include` is `src/**` and this suite lives in `tests/`, so
 * neither config can pick up the other's files even by accident.
 */
export default defineConfig({
  test: {
    include: ['tests/browser/**/*.spec.ts'],
    // Node, not jsdom: the DOM under test is Chrome's.
    environment: 'node',
    globals: true,
    // Chrome launch + Oxigraph WASM init + nine metamodel graphs. Generous, but
    // every wait in the suite is state-based, so a real hang still fails fast
    // enough to be useful.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One browser at a time: the suite shares a single page across files and
    // parallel Chrome instances only add flakiness. One fork, its modules kept
    // from file to file (`isolate: false`), so the files share that page.
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
  },
});
