/**
 * Desktop smoke test: the Electron build starts, shows the workbench and loads
 * the bundled metamodel — offline, from its own files.
 *
 * Needs `npm run build:electron` and the Electron binary (`node_modules/electron`
 * downloads it on install; `node node_modules/electron/install.js` when it did
 * not). Skipped without either, so a machine without Electron still runs the
 * rest of the suite.
 *
 * `ELECTRON_RUN_AS_NODE` is cleared for the launch: a terminal inside VS Code
 * (itself Electron) inherits it, and Electron then runs the main script as
 * plain Node, where `require('electron')` has no `app`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { PROJECT_ROOT } from './harness.js';

const MAIN = path.join(PROJECT_ROOT, 'dist/electron/main.cjs');
const BINARY_PATH = path.join(PROJECT_ROOT, 'node_modules/electron/path.txt');
const binaryInstalled =
  existsSync(BINARY_PATH) &&
  existsSync(path.join(PROJECT_ROOT, 'node_modules/electron/dist', readFileSync(BINARY_PATH, 'utf8').trim()));

describe.skipIf(!existsSync(MAIN) || !binaryInstalled)('the desktop build', () => {
  it('starts, loads the bundled ArchiMate 4.0 and shows the workbench', async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name, value]) => name !== 'ELECTRON_RUN_AS_NODE' && value !== undefined),
    ) as Record<string, string>;
    const app = await electron.launch({ args: [MAIN], cwd: PROJECT_ROOT, env });
    try {
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.waitForFunction(
        () => (window as any).__LA_GRAM_APP__?.loadedMetamodel && (window as any).__LA_GRAM_UI__,
        undefined,
        { timeout: 30_000 },
      );
      const facts = await page.evaluate(() => ({
        metamodel: (window as any).__LA_GRAM_APP__.loadedMetamodel.metamodelIri as string,
        origins: [...new Set((window as any).__LA_GRAM_APP__.loadedMetamodel.assets.map((a: any) => a.origin).filter(Boolean))] as string[],
        paletteItems: document.querySelector('palette-panel')!.shadowRoot!.querySelectorAll('.palette-item').length,
        tabs: [...document.querySelector('app-shell')!.shadowRoot!.querySelectorAll('.tab')].map((t) => t.textContent!.trim()),
        indexedDB: typeof indexedDB,
      }));
      expect(facts.metamodel).toBe('https://meta.linked.archi/archimate4/metamodel#ArchiMate4');
      expect(facts.origins).toEqual(['bundled']);
      expect(facts.paletteItems).toBeGreaterThan(40);
      expect(facts.tabs.map((t) => t.split(/\s/)[0])).toEqual(['Properties', 'Validation', 'SPARQL', 'Graph', 'History']);
      expect(facts.indexedDB).toBe('object');
      expect(errors).toEqual([]);
    } finally {
      // Quit without unloading: a new model has unsaved changes, and closing the
      // window would ask about them.
      await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
      app.process().kill();
    }
  }, 90_000);
});
