/**
 * Factory that selects the correct PlatformService implementation
 * based on the runtime environment (browser vs. Electron).
 */
import type { PlatformService } from './interfaces.js';
import { WebPlatformService } from './web-platform-service.js';

/**
 * Detect whether we are running inside an Electron renderer process.
 */
export function isElectronEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as Record<string, unknown>;
  const proc = win.process as Record<string, unknown> | undefined;
  if (typeof proc !== 'object' || proc === null) return false;
  const versions = proc.versions as Record<string, unknown> | undefined;
  if (typeof versions !== 'object' || versions === null) return false;
  return typeof versions.electron === 'string';
}

/**
 * Create the appropriate PlatformService for the current runtime.
 *
 * In Electron the `ElectronPlatformService` is loaded dynamically so
 * the web bundle never pulls in Node.js / Electron dependencies.
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
