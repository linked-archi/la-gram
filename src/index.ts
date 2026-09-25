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
 */
import { createApp } from './app.js';
import { mountUi } from './ui/mount-ui.js';
import { startCollaboration } from './collab/start.js';
import type { AssetMode } from './metamodel-manager/asset-sources.js';

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
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
    validationDelayMs: 300,
  });
  const root = document.getElementById('app') ?? document.body;
  const ui = mountUi(app, root);

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
}

bootstrap().catch((err) => {
  console.error('Failed to start RDF Architecture Modeler:', err);
});
