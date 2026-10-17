/**
 * Electron main process entry point.
 *
 * Creates a BrowserWindow that loads the renderer bundle and
 * handles standard app lifecycle events (ready, window-all-closed, activate).
 *
 * ## The renderer has no Node
 *
 * The window is sandboxed, with context isolation and without Node integration:
 * the renderer is the web build, and the little it needs from the desktop — the
 * native open and save dialogs, and reading or writing the file chosen in one —
 * crosses the preload bridge (`electron-preload.ts`) to the handlers below. A
 * handler reads or writes only a file the user chose in a dialog this session.
 *
 * The renderer's page and bundled assets are served from `app://la-gram/` — the
 * build output's `renderer/` directory — a standard, secure scheme registered
 * here: the renderer fetches its assets as the web build fetches them from its
 * server, it has an origin (IndexedDB keeps the working state), and every
 * response carries the Content-Security-Policy below.
 */
import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type IpcMainInvokeEvent } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const SCHEME = 'app';
const HOST = 'la-gram';
const ORIGIN = `${SCHEME}://${HOST}`;
const RENDERER_ROOT = path.join(__dirname, 'renderer');

/**
 * Script only from the app itself, and WebAssembly (Oxigraph); styles inline too
 * (the page's own, and diagram-js's); data from wherever a metamodel or the
 * collaboration server lives.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws: wss: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttl': 'text/turtle; charset=utf-8',
  '.woff2': 'font/woff2',
};

const TURTLE = [{ name: 'Turtle files', extensions: ['ttl'] }];

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/** A file of the renderer build, by its `app://la-gram/` URL; nothing outside it. */
async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const file = path.normalize(path.join(RENDERER_ROOT, decodeURIComponent(url.pathname)));
  if (url.host !== HOST || !file.startsWith(RENDERER_ROOT + path.sep)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    return new Response(await readFile(file), {
      headers: {
        'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// ── The bridge's handlers ──────────────────────────────────────────────

/** Files the user chose in a dialog this session — the only ones the renderer may read or write. */
const chosen = new Set<string>();

/** Only the app's own page may ask. */
function fromApp(event: IpcMainInvokeEvent): BrowserWindow {
  const url = event.senderFrame?.url ?? '';
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!url.startsWith(`${ORIGIN}/`) || !window) throw new Error('Not the la-gram window');
  return window;
}

function registerBridge(): void {
  ipcMain.handle('la-gram:show-open-dialog', async (event, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog(fromApp(event), {
      filters: filters ?? TURTLE,
      properties: ['openFile'],
    });
    const file = result.canceled ? undefined : result.filePaths[0];
    if (file) chosen.add(file);
    return file ?? null;
  });

  ipcMain.handle('la-gram:show-save-dialog', async (event, filters?: Electron.FileFilter[], defaultPath?: string) => {
    const result = await dialog.showSaveDialog(fromApp(event), {
      filters: filters ?? TURTLE,
      ...(defaultPath ? { defaultPath } : {}),
    });
    const file = result.canceled ? undefined : result.filePath;
    if (file) chosen.add(file);
    return file ?? null;
  });

  ipcMain.handle('la-gram:read-file', async (event, file: string) => {
    fromApp(event);
    if (!chosen.has(file)) throw new Error('Only a file chosen in a dialog can be read');
    return { content: await readFile(file, 'utf-8'), name: path.basename(file) };
  });

  ipcMain.handle('la-gram:write-file', async (event, file: string, content: string) => {
    fromApp(event);
    if (!chosen.has(file)) throw new Error('Only a file chosen in a dialog can be written');
    await writeFile(file, content, 'utf-8');
  });
}

// ── The window ─────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void win.loadURL(`${ORIGIN}/index.html`);

  // Web links (a type's source in the specification) open in the system
  // browser: nothing but the app's own page is loaded into this window or a
  // child of it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });

  // The renderer guards unsaved changes with `beforeunload`. A browser asks the
  // user; Electron cancels the close without a word, so the window would not
  // close at all. Ask here, and close when told to.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'The model has changes that are not saved.',
      detail: 'Closing the window discards them.',
    });
    if (choice === 0) event.preventDefault();
  });

  return win;
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, serve);
  registerBridge();
  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
