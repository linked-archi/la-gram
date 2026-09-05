/**
 * Electron desktop implementation of PlatformService.
 *
 * Uses Electron `dialog` module for file dialogs and Node.js `fs` for
 * reading/writing files on the native file system.
 */
import type { PlatformService, FileFilter } from './interfaces.js';

/** Minimal typing for the Electron dialog module. */
interface ElectronDialog {
  showOpenDialogSync(options: {
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }): string[] | undefined;
  showSaveDialogSync(options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): string | undefined;
}

/** Minimal typing for Node.js fs module. */
interface NodeFs {
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: string, encoding: string): void;
}

/**
 * Resolve the Electron `dialog` module at runtime so this file can be
 * imported without hard-depending on Electron at compile time.
 */
function getElectronDialog(): ElectronDialog {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dialog } = require('electron');
  return dialog as ElectronDialog;
}

function getNodeFs(): NodeFs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  return fs as NodeFs;
}

export class ElectronPlatformService implements PlatformService {
  private dialog: ElectronDialog;
  private fs: NodeFs;

  constructor(dialog?: ElectronDialog, fs?: NodeFs) {
    this.dialog = dialog ?? getElectronDialog();
    this.fs = fs ?? getNodeFs();
  }

  async readFile(path?: string): Promise<{ content: string; name: string }> {
    const filePath = path ?? (await this.showOpenDialog());
    if (!filePath) {
      throw new Error('No file selected');
    }
    const content = this.fs.readFileSync(filePath, 'utf-8');
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    return { content, name };
  }

  async writeFile(content: string, suggestedName?: string): Promise<void> {
    const filePath = await this.showSaveDialog(
      suggestedName
        ? [{ name: 'Turtle files', extensions: ['ttl'] }]
        : undefined,
    );
    if (!filePath) {
      throw new Error('Save cancelled');
    }
    this.fs.writeFileSync(filePath, content, 'utf-8');
  }

  async showOpenDialog(filters?: FileFilter[]): Promise<string | null> {
    const result = this.dialog.showOpenDialogSync({
      filters: filters ?? [{ name: 'Turtle files', extensions: ['ttl'] }],
      properties: ['openFile'],
    });
    return result?.[0] ?? null;
  }

  async showSaveDialog(filters?: FileFilter[]): Promise<string | null> {
    const result = this.dialog.showSaveDialogSync({
      filters: filters ?? [{ name: 'Turtle files', extensions: ['ttl'] }],
    });
    return result ?? null;
  }

  isDesktop(): boolean {
    return true;
  }
}
