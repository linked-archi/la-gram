/**
 * Platform Abstraction layer interfaces.
 *
 * Abstracts browser vs. Electron differences for file I/O and dialogs.
 */

/** File type filter for open/save dialogs. */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Platform-agnostic service for file operations and environment detection. */
export interface PlatformService {
  readFile(path?: string): Promise<{ content: string; name: string }>;
  writeFile(content: string, suggestedName?: string): Promise<void>;
  showOpenDialog(filters?: FileFilter[]): Promise<string | null>;
  showSaveDialog(filters?: FileFilter[]): Promise<string | null>;
  isDesktop(): boolean;
}
