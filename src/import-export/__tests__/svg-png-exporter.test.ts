/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportSvg, exportPng, downloadBlob, downloadSvg } from '../svg-png-exporter.js';

// ---------------------------------------------------------------------------
// exportSvg — pure string transformation
// ---------------------------------------------------------------------------
describe('exportSvg', () => {
  it('trims whitespace from the SVG string', () => {
    const raw = '  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>  ';
    expect(exportSvg(raw)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>',
    );
  });

  it('adds xmlns when missing', () => {
    const raw = '<svg width="100" height="100"><rect/></svg>';
    const result = exportSvg(raw);
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('does not duplicate xmlns when already present', () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = exportSvg(raw);
    const count = (result.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) || []).length;
    expect(count).toBe(1);
  });

  it('adds xmlns:xlink when missing', () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = exportSvg(raw);
    expect(result).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });

  it('does not duplicate xmlns:xlink when already present', () => {
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>';
    const result = exportSvg(raw);
    const count = (result.match(/xmlns:xlink/g) || []).length;
    expect(count).toBe(1);
  });

  it('returns the string unchanged when both namespaces are present', () => {
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>';
    expect(exportSvg(raw)).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Stub URL.createObjectURL / revokeObjectURL (not available in jsdom)
// ---------------------------------------------------------------------------
beforeEach(() => {
  URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// exportPng — requires browser API mocks (jsdom environment)
// ---------------------------------------------------------------------------
describe('exportPng', () => {
  let mockCtx: any;
  let mockCanvas: any;
  const OriginalImage = globalThis.Image;

  beforeEach(() => {
    mockCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => {
        cb(new Blob(['png-data'], { type: 'image/png' }));
      }),
    };

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') return mockCanvas;
      // Fall through to real implementation for other tags
      return Object.assign(document.createDocumentFragment(), { tagName: tag });
    }) as any);

    // Mock Image so that setting `src` triggers `onload` on the next microtask
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = '';
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        Promise.resolve().then(() => { if (this.onload) this.onload(); });
      }
    } as any;
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
  });

  it('resolves with a PNG Blob using explicit dimensions', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect/></svg>';
    const blob = await exportPng(svg, 400, 300);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(mockCanvas.width).toBe(400);
    expect(mockCanvas.height).toBe(300);
    expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 400, 300);
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it('falls back to SVG intrinsic dimensions when none provided', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="150"><rect/></svg>';
    await exportPng(svg);

    expect(mockCanvas.width).toBe(250);
    expect(mockCanvas.height).toBe(150);
  });

  it('falls back to 800x600 when SVG has no dimensions', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    await exportPng(svg);

    expect(mockCanvas.width).toBe(800);
    expect(mockCanvas.height).toBe(600);
  });

  it('rejects when getContext returns null', async () => {
    mockCanvas.getContext = vi.fn(() => null);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    await expect(exportPng(svg)).rejects.toThrow('Failed to get 2D rendering context');
  });

  it('rejects when toBlob returns null', async () => {
    mockCanvas.toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(null));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    await expect(exportPng(svg)).rejects.toThrow('Canvas toBlob returned null');
  });
});

// ---------------------------------------------------------------------------
// downloadBlob / downloadSvg — verify DOM interactions
// ---------------------------------------------------------------------------
describe('downloadBlob', () => {
  it('creates an anchor, clicks it, and cleans up', () => {
    const clickSpy = vi.fn();
    const mockAnchor = { href: '', download: '', click: clickSpy } as any;

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') return mockAnchor;
      return Object.assign(document.createDocumentFragment(), { tagName: tag });
    }) as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
    vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);

    const blob = new Blob(['hello'], { type: 'text/plain' });
    downloadBlob(blob, 'test.txt');

    expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchor);
    expect(clickSpy).toHaveBeenCalled();
    expect(document.body.removeChild).toHaveBeenCalledWith(mockAnchor);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(mockAnchor.download).toBe('test.txt');
  });
});

describe('downloadSvg', () => {
  it('triggers a download with an SVG blob', () => {
    const clickSpy = vi.fn();
    const mockAnchor = { href: '', download: '', click: clickSpy } as any;

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') return mockAnchor;
      return Object.assign(document.createDocumentFragment(), { tagName: tag });
    }) as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
    vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);

    downloadSvg('<svg></svg>', 'diagram.svg');

    expect(clickSpy).toHaveBeenCalled();
    expect(mockAnchor.download).toBe('diagram.svg');
  });
});
