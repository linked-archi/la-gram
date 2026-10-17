/**
 * Electron preload: the renderer's one way to the desktop.
 *
 * The renderer runs sandboxed and without Node (`electron-main.ts`). What it
 * needs from the desktop — the native open and save dialogs, and reading or
 * writing the file chosen in one — this exposes as `window.laGramDesktop`, each
 * call a message to the main process, which reads or writes only a file the user
 * chose in a dialog. `ElectronPlatformService` is its one user.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './platform/desktop-bridge.js';

const bridge: DesktopBridge = {
  showOpenDialog: (filters) => ipcRenderer.invoke('la-gram:show-open-dialog', filters),
  showSaveDialog: (filters, defaultPath) => ipcRenderer.invoke('la-gram:show-save-dialog', filters, defaultPath),
  readFile: (file) => ipcRenderer.invoke('la-gram:read-file', file),
  writeFile: (file, content) => ipcRenderer.invoke('la-gram:write-file', file, content),
};

contextBridge.exposeInMainWorld('laGramDesktop', bridge);
