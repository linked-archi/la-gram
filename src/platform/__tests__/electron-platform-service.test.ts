import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElectronPlatformService } from '../electron-platform-service.js';

function createMockDialog() {
  return {
    showOpenDialogSync: vi.fn(),
    showSaveDialogSync: vi.fn(),
  };
}

function createMockFs() {
  return {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
}

describe('ElectronPlatformService', () => {
  let dialog: ReturnType<typeof createMockDialog>;
  let fs: ReturnType<typeof createMockFs>;
  let service: ElectronPlatformService;

  beforeEach(() => {
    dialog = createMockDialog();
    fs = createMockFs();
    service = new ElectronPlatformService(dialog, fs);
  });

  describe('isDesktop', () => {
    it('returns true', () => {
      expect(service.isDesktop()).toBe(true);
    });
  });

  describe('readFile', () => {
    it('reads file at the given path', async () => {
      fs.readFileSync.mockReturnValue('@prefix arch: <urn:arch#> .');
      const result = await service.readFile('/home/user/model.ttl');
      expect(fs.readFileSync).toHaveBeenCalledWith('/home/user/model.ttl', 'utf-8');
      expect(result.content).toBe('@prefix arch: <urn:arch#> .');
      expect(result.name).toBe('model.ttl');
    });

    it('opens a dialog when no path is provided', async () => {
      dialog.showOpenDialogSync.mockReturnValue(['/tmp/selected.ttl']);
      fs.readFileSync.mockReturnValue('content');

      const result = await service.readFile();
      expect(dialog.showOpenDialogSync).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/selected.ttl', 'utf-8');
      expect(result.content).toBe('content');
      expect(result.name).toBe('selected.ttl');
    });

    it('throws when dialog is cancelled and no path given', async () => {
      dialog.showOpenDialogSync.mockReturnValue(undefined);
      await expect(service.readFile()).rejects.toThrow('No file selected');
    });

    it('extracts filename from Windows-style paths', async () => {
      fs.readFileSync.mockReturnValue('data');
      const result = await service.readFile('C:\\Users\\dev\\model.ttl');
      expect(result.name).toBe('model.ttl');
    });
  });

  describe('writeFile', () => {
    it('writes content to the path chosen in save dialog', async () => {
      dialog.showSaveDialogSync.mockReturnValue('/tmp/output.ttl');
      await service.writeFile('rdf data', 'output.ttl');
      expect(dialog.showSaveDialogSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/output.ttl', 'rdf data', 'utf-8');
    });

    it('throws when save dialog is cancelled', async () => {
      dialog.showSaveDialogSync.mockReturnValue(undefined);
      await expect(service.writeFile('data')).rejects.toThrow('Save cancelled');
    });
  });

  describe('showOpenDialog', () => {
    it('returns the selected file path', async () => {
      dialog.showOpenDialogSync.mockReturnValue(['/home/user/file.ttl']);
      const result = await service.showOpenDialog();
      expect(result).toBe('/home/user/file.ttl');
    });

    it('returns null when cancelled', async () => {
      dialog.showOpenDialogSync.mockReturnValue(undefined);
      const result = await service.showOpenDialog();
      expect(result).toBeNull();
    });

    it('passes custom filters to the dialog', async () => {
      dialog.showOpenDialogSync.mockReturnValue(undefined);
      const filters = [{ name: 'RDF', extensions: ['ttl', 'rdf'] }];
      await service.showOpenDialog(filters);
      expect(dialog.showOpenDialogSync).toHaveBeenCalledWith(
        expect.objectContaining({ filters }),
      );
    });
  });

  describe('showSaveDialog', () => {
    it('returns the chosen save path', async () => {
      dialog.showSaveDialogSync.mockReturnValue('/tmp/save.ttl');
      const result = await service.showSaveDialog();
      expect(result).toBe('/tmp/save.ttl');
    });

    it('returns null when cancelled', async () => {
      dialog.showSaveDialogSync.mockReturnValue(undefined);
      const result = await service.showSaveDialog();
      expect(result).toBeNull();
    });
  });
});
