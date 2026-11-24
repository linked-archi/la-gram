/**
 * Web / Electron renderer entry point.
 *
 * Bootstraps the application (`createApp()`, which awaits the Oxigraph WASM
 * initialization needed in the browser) and then mounts the UI into an
 * `<app-shell>`. All panel construction and wiring lives in `ui/mount-ui.ts`.
 *
 * ## URL parameters
 *
 * | Parameter    | Meaning                                                        |
 * |--------------|----------------------------------------------------------------|
 * | `metamodel`  | Metamodel IRI(s) to load at startup (repeatable or comma-separated); ArchiMate 4.0 by default |
 * | `assets`     | `bundled-first` (default), `remote-first` or `offline`         |
 * | `model`      | URL of a model file to open at startup                         |
 * | `room`       | Collaboration room to join (see `collab/`)                     |
 * | `ws`         | Collaboration server, `ws://localhost:1234` by default         |
 * | `user`       | Display name shown to collaborators                            |
 * | `rdf`        | `1` to start with the RDF panel open (hidden by default)       |
 * | `base`       | Base new models' namespaces are minted under, `https://example.org/` by default |
 * | `git`        | a repository file's link to open from Git at startup; `off` switches Git storage off for the session (see `modules.ts`) |
 */
// First: a channel's build keeps its browser storage apart (storage-scope.ts), before anything reads it.
import './storage-scope-install.js';
import { createApp } from './app.js';
import { mountUi } from './ui/mount-ui.js';
import { startCollaboration } from './collab/start.js';
import type { AssetMode } from '@linked-archi/kernel/metamodel-manager/asset-sources.js';
import { ModuleSwitchboard } from './modules.js';
import { loadDeploymentConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  // The deployment's configuration, beside the page (Req 19): read while the app starts.
  const deployment = loadDeploymentConfig();
  const metamodels = params
    .getAll('metamodel')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  const assets = params.get('assets');
  const assetMode: AssetMode | undefined =
    assets === 'offline' || assets === 'remote-first' || assets === 'bundled-first' ? assets : undefined;

  const app = await createApp({
    ...(metamodels.length > 0 ? { metamodels } : {}),
    ...(assetMode ? { assetMode } : {}),
    ...(params.get('base') ? { base: params.get('base') as string } : {}),
    validationDelayMs: 300,
    // Who changed a concept, when and with which la-gram, recorded as it is edited (Req 9.16).
    recordEdits: true,
  });
  const root = document.getElementById('app') ?? document.body;
  const ui = mountUi(app, root, { rdfOpen: params.get('rdf') === '1' });

  // The metamodels are already in the store; announcing them now — after the
  // panels have subscribed — is what fills the palette. Nothing happens if the
  // assets failed to load, and the app stays usable with an empty palette.
  app.announceLoadedMetamodel();

  const modelUrl = params.get('model');
  if (modelUrl) {
    try {
      const response = await fetch(modelUrl, { headers: { Accept: 'text/turtle' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      await app.openModel(await response.text(), modelUrl.split(/[/?#]/).filter(Boolean).pop() ?? 'model.ttl');
    } catch (err: unknown) {
      console.error(`[la-gram] Could not open ${modelUrl}`, err);
    }
  }

  const room = params.get('room');
  const collaboration = startCollaboration(app, ui, {
    ...(room ? { room } : {}),
    ...(params.get('ws') ? { serverUrl: params.get('ws') as string } : {}),
    ...(params.get('user') ? { userName: params.get('user') as string } : {}),
  });

  // The configuration's problems are said; one that failed its check fails
  // closed: the modules it governs do not start (Req 19.4).
  const { config, failed, problems } = await deployment;
  for (const problem of problems) {
    console.warn(`[la-gram] ${problem}`);
    ui.report(failed ? `${problem} Git storage is off until it is fixed.` : problem, failed ? 'error' : 'warning');
  }

  // Switchable modules (Req 18.1). A build without one never registers it: the
  // branch is dropped, and with it the module's chunk.
  const modules = new ModuleSwitchboard(params, undefined, undefined, failed ? { git: 'unavailable' } : config.modules);
  if (__LA_GRAM_GIT__) {
    // `?git=<link>` opens that file once, when the module first starts.
    let openAtStart = params.get('git') && params.get('git') !== 'off' ? (params.get('git') as string) : undefined;
    modules.register({
      id: 'git',
      label: 'Git storage',
      detail: 'open a model from a GitHub or GitLab repository, and save it there as a commit',
      start: async () => {
        const open = openAtStart;
        openAtStart = undefined;
        return (await import(/* webpackChunkName: "git" */ './git/module.js')).startGitStorage(app, ui, {
          config: config.git,
          ...(open ? { open } : {}),
        });
      },
    });
  }
  ui.setModuleSwitches(
    () => modules.list(),
    (id, on) => modules.set(id, on),
  );
  await modules.startEnabled();

  // Leaving with unsaved changes asks first — unless collaborators hold a copy.
  window.addEventListener('beforeunload', (event) => {
    if (app.isDirty() && !collaboration.isConnected()) {
      event.preventDefault();
    }
  });

  // Expose the app instance for debugging in development
  const w = window as unknown as Record<string, unknown>;
  w.__LA_GRAM_APP__ = app;
  w.__LA_GRAM_UI__ = ui;
  w.__LA_GRAM_COLLAB__ = collaboration;
  w.__LA_GRAM_MODULES__ = modules;
}

bootstrap().catch((err) => {
  console.error('Failed to start la-gram:', err);
});
