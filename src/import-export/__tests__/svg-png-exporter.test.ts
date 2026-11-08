/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportSvg, exportPng, downloadBlob, downloadSvg, inlineImages, readImageAsDataUrl } from '../svg-png-exporter.js';

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
// inlineImages — the pictures put into the SVG (Req 14.2)
// ---------------------------------------------------------------------------
describe('inlineImages', () => {
  const XLINK = 'http://www.w3.org/1999/xlink';
  const GLYPH = 'https://app.example/assets/archimate4/icons/glyphs/actor.svg?v=1';
  const svgWith = (...images: string[]) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="${XLINK}" width="100" height="50"><g>${images.join('')}</g></svg>`;
  const image = (href: string) => `<image href="${href}" xlink:href="${href}" width="20" height="20"/>`;
  const hrefs = (svg: string) =>
    Array.from(new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('image')).map((i) => [
      i.getAttribute('href'),
      i.getAttributeNS(XLINK, 'href'),
    ]);

  it('replaces each linked picture with a data: URI, both href and xlink:href, reading each address once', async () => {
    const read = vi.fn(async (url: string) => `data:image/svg+xml;base64,${btoa(url)}`);
    const inline = 'data:image/png;base64,AAAA';
    const { svg, missing } = await inlineImages(svgWith(image(GLYPH), image(GLYPH), image(inline)), { read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(GLYPH);
    const expected = `data:image/svg+xml;base64,${btoa(GLYPH)}`;
    expect(hrefs(svg)).toEqual([[expected, expected], [expected, expected], [inline, inline]]);
    expect(missing).toEqual([]);
    expect(svg).not.toContain('https://app.example');
  });

  it('resolves a relative address against the base', async () => {
    const read = vi.fn(async () => 'data:image/png;base64,AAAA');
    await inlineImages(svgWith(image('pictures/logo.png')), { read, base: 'https://app.example/models/' });
    expect(read).toHaveBeenCalledWith('https://app.example/models/pictures/logo.png');
  });

  it('keeps — or, for a PNG, takes away — a picture that cannot be read, and reports it once', async () => {
    const read = vi.fn(async (url: string) => (url === GLYPH ? 'data:image/svg+xml;base64,AAAA' : undefined));
    const lost = 'https://elsewhere.example/logo.png';
    const failing = vi.fn(async (url: string) => {
      if (url === lost) throw new TypeError('Failed to fetch');
      return read(url);
    });
    const kept = await inlineImages(svgWith(image(GLYPH), image(lost), image(lost)), { read: failing });
    expect(kept.missing).toEqual([lost]);
    expect(hrefs(kept.svg).map(([href]) => href)).toEqual(['data:image/svg+xml;base64,AAAA', lost, lost]);
    const dropped = await inlineImages(svgWith(image(GLYPH), image(lost)), { read: failing, dropMissing: true });
    expect(dropped.missing).toEqual([lost]);
    expect(hrefs(dropped.svg).map(([href]) => href)).toEqual(['data:image/svg+xml;base64,AAAA']);
  });

  it('returns an SVG without linked pictures, or one that does not parse, as it was', async () => {
    const read = vi.fn();
    const plain = svgWith('<rect width="10" height="10"/>');
    expect(await inlineImages(plain, { read })).toEqual({ svg: plain, missing: [] });
    expect(await inlineImages('<svg><g></svg>', { read })).toEqual({ svg: '<svg><g></svg>', missing: [] });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('readImageAsDataUrl', () => {
  const OriginalFetch = globalThis.fetch;
  const respond = (type: string, body = '<svg/>', ok = true) =>
    vi.fn(async () => ({
      ok,
      blob: async () => ({ type, arrayBuffer: async () => new TextEncoder().encode(body).buffer }),
    })) as unknown as typeof fetch;
  afterEach(() => {
    globalThis.fetch = OriginalFetch;
  });

  it('a data: URI of the response, its type the response\'s', async () => {
    globalThis.fetch = respond('image/svg+xml; charset=utf-8');
    expect(await readImageAsDataUrl('https://a.example/glyph.svg')).toBe(`data:image/svg+xml;base64,${btoa('<svg/>')}`);
  });

  it("its type from the address's extension when the response does not name one", async () => {
    globalThis.fetch = respond('');
    expect(await readImageAsDataUrl('app://la-gram/assets/glyph.svg?v=2')).toMatch(/^data:image\/svg\+xml;base64,/);
    globalThis.fetch = respond('application/octet-stream');
    expect(await readImageAsDataUrl('https://a.example/photo.JPG')).toMatch(/^data:image\/jpeg;base64,/);
    globalThis.fetch = respond('text/xml');
    expect(await readImageAsDataUrl('https://a.example/glyph.svg')).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('nothing for a failed response, a page in its place, or an address that is not a picture', async () => {
    globalThis.fetch = respond('image/png', '', false);
    expect(await readImageAsDataUrl('https://a.example/missing.png')).toBeUndefined();
    globalThis.fetch = respond('text/html', '<!doctype html>');
    expect(await readImageAsDataUrl('https://a.example/glyph.svg')).toBeUndefined();
    globalThis.fetch = respond('');
    expect(await readImageAsDataUrl('https://a.example/notes.txt')).toBeUndefined();
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

  it('draws at a scale, the SVG sized to the PNG so it is rasterised sharp', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="150" viewBox="10 20 250 150"><rect/></svg>';
    await exportPng(svg, undefined, undefined, 2);
    expect([mockCanvas.width, mockCanvas.height]).toEqual([500, 300]);
    const drawn = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(drawn);
    });
    expect(text).toContain('width="500" height="300" viewBox="10 20 250 150"');
  });

  it('scales down what a browser could not draw', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="1000"><rect/></svg>';
    await exportPng(svg, undefined, undefined, 2);
    expect(mockCanvas.width).toBeLessThanOrEqual(16_384);
    expect(mockCanvas.height).toBe(Math.round(1000 * (16_384 / 20000)));
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
