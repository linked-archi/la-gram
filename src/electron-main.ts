/**
 * Electron main process entry point.
 *
 * Creates a BrowserWindow that loads the renderer bundle and
 * handles standard app lifecycle events (ready, window-all-closed, activate).
 */
import { app, BrowserWindow } from 'electron';
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
