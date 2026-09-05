// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isElectronEnvironment, createPlatformService } from '../platform-factory.js';
import { WebPlatformService } from '../web-platform-service.js';

describe('isElectronEnvironment', () => {
  afterEach(() => {
    // Clean up any window.process we may have set
    delete (window as Record<string, unknown>).process;
  });

  it('returns false in a normal browser environment', () => {
    expect(isElectronEnvironment()).toBe(false);
  });

  it('returns true when window.process.versions.electron is set', () => {
    (window as Record<string, unknown>).process = {
      versions: { electron: '28.0.0' },
    };
    expect(isElectronEnvironment()).toBe(true);
  });

  it('returns false when window.process exists but has no electron version', () => {
    (window as Record<string, unknown>).process = {
      versions: { node: '20.0.0' },
    };
    expect(isElectronEnvironment()).toBe(false);
  });
});

describe('createPlatformService', () => {
  afterEach(() => {
    delete (window as Record<string, unknown>).process;
  });

  it('returns WebPlatformService in a browser environment', async () => {
    const service = await createPlatformService();
    expect(service).toBeInstanceOf(WebPlatformService);
    expect(service.isDesktop()).toBe(false);
  });
});
