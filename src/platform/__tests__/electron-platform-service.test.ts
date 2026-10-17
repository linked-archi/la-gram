import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElectronPlatformService } from '../electron-platform-service.js';

/** The preload's bridge (`window.laGramDesktop`), as the main process would answer it. */
function createMockBridge() {
  return {
    showOpenDialog: vi.fn<(filters?: unknown, defaultPath?: string) => Promise<string | null>>(),
    showSaveDialog: vi.fn<(filters?: unknown, defaultPath?: string) => Promise<string | null>>(),
    readFile: vi.fn<(file: string) => Promise<{ content: string; name: string }>>(),
    writeFile: vi.fn<(file: string, content: string) => Promise<void>>(),
  };
}

describe('ElectronPlatformService', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let service: ElectronPlatformService;

  beforeEach(() => {
    bridge = createMockBridge();
    service = new ElectronPlatformService(bridge);
  });

  it('refuses to start without the desktop bridge', () => {
    expect(() => new ElectronPlatformService()).toThrow('desktop bridge');
  });

  describe('isDesktop', () => {
    it('returns true', () => {
      expect(service.isDesktop()).toBe(true);
    });
  });

  describe('readFile', () => {
    it('reads the file at the given path through the bridge', async () => {
      bridge.readFile.mockResolvedValue({ content: '@prefix arch: <urn:arch#> .', name: 'model.ttl' });
      const result = await service.readFile('/home/user/model.ttl');
      expect(bridge.readFile).toHaveBeenCalledWith('/home/user/model.ttl');
      expect(bridge.showOpenDialog).not.toHaveBeenCalled();
      expect(result).toEqual({ content: '@prefix arch: <urn:arch#> .', name: 'model.ttl' });
    });

    it('opens a dialog when no path is provided, and reads the chosen file', async () => {
      bridge.showOpenDialog.mockResolvedValue('/tmp/selected.ttl');
      bridge.readFile.mockResolvedValue({ content: 'content', name: 'selected.ttl' });

      const result = await service.readFile();
      expect(bridge.showOpenDialog).toHaveBeenCalledWith([{ name: 'Turtle files', extensions: ['ttl'] }]);
      expect(bridge.readFile).toHaveBeenCalledWith('/tmp/selected.ttl');
      expect(result).toEqual({ content: 'content', name: 'selected.ttl' });
    });

    it('throws when the dialog is cancelled and no path given', async () => {
      bridge.showOpenDialog.mockResolvedValue(null);
      await expect(service.readFile()).rejects.toThrow('No file selected');
      expect(bridge.readFile).not.toHaveBeenCalled();
    });
  });

  describe('writeFile', () => {
    it('writes to the path chosen in the save dialog, which starts at the suggested name', async () => {
      bridge.showSaveDialog.mockResolvedValue('/tmp/output.ttl');
      await service.writeFile('rdf data', 'output.ttl');
      expect(bridge.showSaveDialog).toHaveBeenCalledWith([{ name: 'Turtle files', extensions: ['ttl'] }], 'output.ttl');
      expect(bridge.writeFile).toHaveBeenCalledWith('/tmp/output.ttl', 'rdf data');
    });

    it('throws when the save dialog is cancelled', async () => {
      bridge.showSaveDialog.mockResolvedValue(null);
      await expect(service.writeFile('data')).rejects.toThrow('Save cancelled');
      expect(bridge.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('showOpenDialog', () => {
    it('returns the selected file path', async () => {
      bridge.showOpenDialog.mockResolvedValue('/home/user/file.ttl');
      expect(await service.showOpenDialog()).toBe('/home/user/file.ttl');
    });

    it('returns null when cancelled', async () => {
      bridge.showOpenDialog.mockResolvedValue(null);
      expect(await service.showOpenDialog()).toBeNull();
    });

    it('passes custom filters to the dialog', async () => {
      bridge.showOpenDialog.mockResolvedValue(null);
      const filters = [{ name: 'RDF', extensions: ['ttl', 'rdf'] }];
      await service.showOpenDialog(filters);
      expect(bridge.showOpenDialog).toHaveBeenCalledWith(filters);
    });
  });

  describe('showSaveDialog', () => {
    it('returns the chosen save path', async () => {
      bridge.showSaveDialog.mockResolvedValue('/tmp/save.ttl');
      expect(await service.showSaveDialog()).toBe('/tmp/save.ttl');
    });

    it('returns null when cancelled', async () => {
      bridge.showSaveDialog.mockResolvedValue(null);
      expect(await service.showSaveDialog()).toBeNull();
    });
  });
});
