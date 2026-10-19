/**
 * What the desktop build's preload exposes to the renderer as
 * `window.laGramDesktop` (`electron-preload.ts`): the native open and save
 * dialogs, and reading or writing the file chosen in one. The main process
 * answers each call, and reads or writes only a file the user chose in a dialog.
 *
 * And secrets — the Git module's access tokens (Req 18.5): the main process
 * keeps them encrypted with the operating system's keychain (`safeStorage`),
 * under keys `git:<host>`; the renderer never sees the encrypted file.
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
  /** Whether secrets can be kept encrypted here (a system keychain is there). */
  secretsAvailable?(): Promise<boolean>;
  /** A kept secret, or `null`. */
  secretGet?(key: string): Promise<string | null>;
  /** Keep a secret, encrypted. Refused where there is no keychain. */
  secretSet?(key: string, value: string): Promise<void>;
  /** Forget a secret. */
  secretDelete?(key: string): Promise<void>;
  /** The keys secrets are kept under. */
  secretKeys?(): Promise<string[]>;
}

/** The bridge, when the page runs in the desktop build. */
export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = (window as unknown as { laGramDesktop?: DesktopBridge }).laGramDesktop;
  return typeof bridge === 'object' && bridge !== null ? bridge : undefined;
}
