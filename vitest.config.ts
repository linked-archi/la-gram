import { defineConfig } from 'vitest/config';
import path from 'path';

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
    include: ['src/**/*.test.ts', 'src/**/*.property.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.property.test.ts'],
    },
  },
});
