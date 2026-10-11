/**
 * Electron main process entry point.
 *
 * Creates a BrowserWindow that loads the renderer bundle and
 * handles standard app lifecycle events (ready, window-all-closed, activate).
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'path';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the renderer bundle produced by the electron-renderer webpack config
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Web links (a type's source in the specification) open in the system
  // browser: the renderer runs with Node integration, so no web page is ever
  // loaded into this window or a child of it.
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
