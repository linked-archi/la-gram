/**
 * Web / Electron renderer entry point.
 *
 * Bootstraps the application (`createApp()`, which awaits the Oxigraph WASM
 * initialization needed in the browser) and then mounts the UI into an
 * `<app-shell>`. All panel construction and wiring lives in `ui/mount-ui.ts`.
 */
import { createApp } from './app.js';
import { mountUi } from './ui/mount-ui.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const root = document.getElementById('app') ?? document.body;
  const ui = mountUi(app, root);

  // The metamodel is already in the store; announcing it now — after the panels
  // have subscribed — is what fills the palette. Nothing happens if the bundled
  // assets failed to load, and the app stays usable with an empty palette.
  app.announceLoadedMetamodel();

  // Expose the app instance for debugging in development
  if (typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    w.__LA_GRAM_APP__ = app;
    w.__LA_GRAM_UI__ = ui;
  }
}

bootstrap().catch((err) => {
  console.error('Failed to start RDF Architecture Modeler:', err);
});
