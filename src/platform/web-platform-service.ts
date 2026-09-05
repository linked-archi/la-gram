/**
 * Web browser implementation of PlatformService.
 *
 * Uses File API, `<input type="file">` for open dialogs,
 * and download links for save/write operations.
 */
import type { PlatformService, FileFilter } from './interfaces.js';

export class WebPlatformService implements PlatformService {
  /**
   * Read a file by prompting the user with a file picker.
   * The `path` parameter is ignored in the web implementation —
   * the browser always shows a file-open dialog.
   */
  async readFile(_path?: string): Promise<{ content: string; name: string }> {
    const file = await this.pickFile();
    const content = await file.text();
    return { content, name: file.name };
  }

  /**
   * Write content by triggering a browser download.
   */
  async writeFile(content: string, suggestedName?: string): Promise<void> {
    const blob = new Blob([content], { type: 'text/turtle;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName ?? 'model.ttl';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Show an open-file dialog. Returns the selected file name, or null if cancelled.
   */
  async showOpenDialog(filters?: FileFilter[]): Promise<string | null> {
    try {
      const file = await this.pickFile(filters);
      return file.name;
    } catch {
      return null;
    }
  }

  /**
   * Show a save dialog. In the browser there is no native save dialog,
   * so we return the suggested name (the actual save happens in writeFile).
   */
  async showSaveDialog(_filters?: FileFilter[]): Promise<string | null> {
    // Browsers don't have a native save-file dialog outside of the
    // File System Access API (limited support). Return a default name
    // so callers know the user "accepted".
    return 'model.ttl';
  }

  isDesktop(): boolean {
    return false;
  }

  // ── private helpers ──────────────────────────────────────────────

  private pickFile(filters?: FileFilter[]): Promise<File> {
    return new Promise<File>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';

      if (filters && filters.length > 0) {
        input.accept = filters
          .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
          .join(',');
      }

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) {
          resolve(file);
        } else {
          reject(new Error('No file selected'));
        }
      });

      // Handle cancel — the input fires no event on cancel in most browsers,
      // but we can listen for focus returning to the window.
      input.addEventListener('cancel', () => {
        reject(new Error('File selection cancelled'));
      });

      input.click();
    });
  }
}