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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('runs the renderer without Node, under its Content-Security-Policy, and reaches files only through the bridge', async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name, value]) => name !== 'ELECTRON_RUN_AS_NODE' && value !== undefined),
    ) as Record<string, string>;
    const dir = mkdtempSync(path.join(tmpdir(), 'la-gram-electron-'));
    const file = path.join(dir, 'model.ttl');
    const app = await electron.launch({ args: [MAIN], cwd: PROJECT_ROOT, env });
    try {
      const page = await app.firstWindow();
      const violations: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await page.waitForFunction(() => (window as any).__LA_GRAM_APP__?.loadedMetamodel, undefined, { timeout: 30_000 });

      const renderer = await page.evaluate(async () => ({
        url: location.href,
        require: typeof (window as any).require,
        process: typeof (window as any).process,
        bridge: Object.keys((window as any).laGramDesktop ?? {}).sort(),
        csp: (await fetch(location.href)).headers.get('content-security-policy'),
      }));
      expect(renderer.url).toBe('app://la-gram/index.html');
      expect(renderer.require).toBe('undefined');
      expect(renderer.process).toBe('undefined');
      // Files chosen in a dialog, and the Git module's secrets (encrypted by the main process).
      expect(renderer.bridge).toEqual([
        'readFile',
        'secretDelete',
        'secretGet',
        'secretKeys',
        'secretSet',
        'secretsAvailable',
        'showOpenDialog',
        'showSaveDialog',
        'writeFile',
      ]);
      expect(renderer.csp).toContain("script-src 'self' 'wasm-unsafe-eval'");

      // Validation runs in a worker, under the same policy: an element without a name is reported — and,
      // Oxigraph's WebAssembly loaded there too, the shapes' SPARQL-based rules run (it relates to nothing).
      const validation = await page.evaluate(async () => {
        const app = (window as any).__LA_GRAM_APP__;
        const unnamed: string = app.components.elementManager.createElement(
          'https://meta.linked.archi/archimate4/onto#BusinessActor',
          app.session.modelIri,
        ).value;
        const SPARQL = 'http://www.w3.org/ns/shacl#SPARQLConstraintComponent';
        const reported = new Promise<{ shapes: boolean; rules: boolean }>((resolve) => {
          app.components.eventBus.on('validation-updated', (e: any) => {
            const about = e.detail.results.filter((r: any) => r.focusNode.value === unnamed);
            const found = { shapes: about.some((r: any) => r.sourceConstraintComponent?.value !== SPARQL), rules: about.some((r: any) => r.sourceConstraintComponent?.value === SPARQL) };
            if (found.shapes && found.rules) resolve(found);
          });
          setTimeout(() => resolve({ shapes: false, rules: false }), 30_000);
        });
        await app.runValidation();
        return { where: app.validation.where, reported: await reported };
      });
      expect(validation).toEqual({ where: 'worker', reported: { shapes: true, rules: true } });

      // The native dialogs, answered by the main process with a file in a temporary directory.
      await app.evaluate(({ dialog }, chosen) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: chosen })) as typeof dialog.showSaveDialog;
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog;
      }, file);
      const roundTrip = await page.evaluate(async () => {
        const desktop = (window as any).laGramDesktop;
        const refused = await desktop.readFile('/etc/hosts').then(() => 'read', (e: Error) => e.message);
        const saveTo = await desktop.showSaveDialog(undefined, 'model.ttl');
        await desktop.writeFile(saveTo, '@prefix ex: <https://example.org/> .\n');
        const openFrom = await desktop.showOpenDialog();
        return { refused, saveTo, openFrom, read: await desktop.readFile(openFrom) };
      });
      expect(roundTrip.refused).toMatch(/chosen in a dialog/);
      expect(roundTrip.saveTo).toBe(file);
      expect(readFileSync(file, 'utf8')).toBe('@prefix ex: <https://example.org/> .\n');
      expect(roundTrip.read).toEqual({ content: '@prefix ex: <https://example.org/> .\n', name: 'model.ttl' });
      expect(violations).toEqual([]);
    } finally {
      await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
      app.process().kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
