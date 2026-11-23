import { defineConfig } from 'vitest/config';
import path from 'path';

/** The tests that time the machine they run on (benchmarks): run after the others, alone. */
const BENCH = 'src/**/{*-bench,bench-*}.test.ts';

export default defineConfig({
  resolve: {
    alias: {
      '@rdf-engine': path.resolve(__dirname, 'src/rdf-engine'),
      '@metamodel-manager': path.resolve(__dirname, 'src/metamodel-manager'),
      '@model-manager': path.resolve(__dirname, 'src/model-manager'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@platform': path.resolve(__dirname, 'src/platform'),
      '@import-export': path.resolve(__dirname, 'src/import-export'),
    },
  },
  test: {
    globals: true,
    // Fills DOM gaps jsdom leaves that diagram-js depends on. See the file.
    setupFiles: ['tests/setup/jsdom-shims.ts'],
    // Vitest's 5 s is too little for the tests that load whole metamodels into the mounted app: 2–3 s on a
    // developer's machine, past 5 s on a shared CI runner, about twice as slow. A test that hangs still fails.
    testTimeout: 20_000,
    // Two groups, run one after the other: every unit test file, side by side; then the benchmarks,
    // alone — beside the others a benchmark measures the machine's load, not what it times.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'src/**/*.property.test.ts'],
          exclude: [BENCH],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: { name: 'timing', include: [BENCH], sequence: { groupOrder: 1 } },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.property.test.ts'],
    },
  },
});
