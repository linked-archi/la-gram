/**
 * Electron desktop implementation of PlatformService.
 *
 * The renderer has no Node and no Electron modules (`electron-main.ts`): native
 * file dialogs and file access go through the preload bridge,
 * `window.laGramDesktop` (`desktop-bridge.ts`), to the main process.
 */
import type { PlatformService, FileFilter } from './interfaces.js';
import { desktopBridge, type DesktopBridge } from './desktop-bridge.js';

const TURTLE: FileFilter[] = [{ name: 'Turtle files', extensions: ['ttl'] }];

export class ElectronPlatformService implements PlatformService {
  private readonly bridge: DesktopBridge;

  constructor(bridge?: DesktopBridge) {
    const found = bridge ?? desktopBridge();
    if (!found) throw new Error('The desktop bridge (window.laGramDesktop) is not available');
    this.bridge = found;
  }

  async readFile(path?: string): Promise<{ content: string; name: string }> {
    const filePath = path ?? (await this.showOpenDialog());
    if (!filePath) {
      throw new Error('No file selected');
    }
    return this.bridge.readFile(filePath);
  }

  async writeFile(content: string, suggestedName?: string): Promise<void> {
    const filePath = await this.bridge.showSaveDialog(TURTLE, suggestedName);
    if (!filePath) {
      throw new Error('Save cancelled');
    }
    await this.bridge.writeFile(filePath, content);
  }

  async showOpenDialog(filters?: FileFilter[]): Promise<string | null> {
    return this.bridge.showOpenDialog(filters ?? TURTLE);
  }

  async showSaveDialog(filters?: FileFilter[]): Promise<string | null> {
    return this.bridge.showSaveDialog(filters ?? TURTLE);
  }

  isDesktop(): boolean {
    return true;
  }
}
