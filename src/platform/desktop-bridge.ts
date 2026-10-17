/**
 * What the desktop build's preload exposes to the renderer as
 * `window.laGramDesktop` (`electron-preload.ts`): the native open and save
 * dialogs, and reading or writing the file chosen in one. The main process
 * answers each call, and reads or writes only a file the user chose in a dialog.
 */
import type { FileFilter } from './interfaces.js';

export interface DesktopBridge {
  /** The native open dialog; the chosen path, or `null` when cancelled. */
  showOpenDialog(filters?: FileFilter[]): Promise<string | null>;
  /** The native save dialog, starting at `defaultPath`; the chosen path, or `null`. */
  showSaveDialog(filters?: FileFilter[], defaultPath?: string): Promise<string | null>;
  /** A file chosen in a dialog, as text, with its name. */
  readFile(file: string): Promise<{ content: string; name: string }>;
  /** Write text to a file chosen in a dialog. */
  writeFile(file: string, content: string): Promise<void>;
}

/** The bridge, when the page runs in the desktop build. */
export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = (window as unknown as { laGramDesktop?: DesktopBridge }).laGramDesktop;
  return typeof bridge === 'object' && bridge !== null ? bridge : undefined;
}
