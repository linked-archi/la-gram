/**
 * Factory that selects the correct PlatformService implementation
 * based on the runtime environment (browser vs. Electron).
 */
import type { PlatformService } from './interfaces.js';
import { WebPlatformService } from './web-platform-service.js';
import { desktopBridge } from './desktop-bridge.js';

/**
 * Detect whether we are running inside the desktop build's renderer: its preload
 * exposes the desktop bridge (`window.laGramDesktop`). The renderer has no Node,
 * so `process.versions.electron` is not there to look at.
 */
export function isElectronEnvironment(): boolean {
  return desktopBridge() !== undefined;
}

/**
 * Create the appropriate PlatformService for the current runtime.
 *
 * In Electron the `ElectronPlatformService` is loaded dynamically, so the web
 * bundle's main chunk does not carry it.
 */
export async function createPlatformService(): Promise<PlatformService> {
  if (isElectronEnvironment()) {
    const { ElectronPlatformService } = await import(
      './electron-platform-service.js'
    );
    return new ElectronPlatformService();
  }
  return new WebPlatformService();
}
