// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isElectronEnvironment, createPlatformService } from '../platform-factory.js';
import { WebPlatformService } from '../web-platform-service.js';

const BRIDGE = {
  showOpenDialog: async () => null,
  showSaveDialog: async () => null,
  readFile: async () => ({ content: '', name: '' }),
  writeFile: async () => undefined,
};

describe('isElectronEnvironment', () => {
  afterEach(() => {
    delete (window as Record<string, unknown>).laGramDesktop;
    delete (window as Record<string, unknown>).process;
  });

  it('returns false in a normal browser environment', () => {
    expect(isElectronEnvironment()).toBe(false);
  });

  it('returns true when the desktop preload exposes its bridge', () => {
    (window as Record<string, unknown>).laGramDesktop = BRIDGE;
    expect(isElectronEnvironment()).toBe(true);
  });

  it('does not go by process.versions.electron: the desktop renderer has no Node', () => {
    (window as Record<string, unknown>).process = { versions: { electron: '44.9.0' } };
    expect(isElectronEnvironment()).toBe(false);
  });
});

describe('createPlatformService', () => {
  afterEach(() => {
    delete (window as Record<string, unknown>).laGramDesktop;
  });

  it('returns WebPlatformService in a browser environment', async () => {
    const service = await createPlatformService();
    expect(service).toBeInstanceOf(WebPlatformService);
    expect(service.isDesktop()).toBe(false);
  });

  it('returns the desktop service when the bridge is there', async () => {
    (window as Record<string, unknown>).laGramDesktop = BRIDGE;
    const service = await createPlatformService();
    expect(service.isDesktop()).toBe(true);
  });
});
