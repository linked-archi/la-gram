/**
 * SVG/PNG Exporter — exports diagram views as SVG or PNG images.
 *
 * `exportSvg` cleans/formats an SVG string (from diagram-js saveSVG) for download.
 * `inlineImages` puts the pictures an SVG links to into the SVG itself.
 * `exportPng` rasterises an SVG string to a PNG Blob via the browser Canvas API.
 * `downloadSvg` / `downloadBlob` trigger browser downloads.
 *
 * Requirements: 14.1, 14.2
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Takes a raw SVG string (e.g. from diagram-js `saveSVG`) and returns a
 * cleaned, self-contained SVG string suitable for standalone use or download.
 *
 * - Ensures the XML namespace declaration is present.
 * - Ensures an `xmlns:xlink` declaration is present (needed by many SVG viewers).
 * - Trims leading/trailing whitespace.
 */
export function exportSvg(diagramSvg: string): string {
  let svg = diagramSvg.trim();

  // Ensure root <svg has the SVG namespace
  if (svg.includes('<svg') && !svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Ensure xlink namespace (used by many renderers for href attributes)
  if (svg.includes('<svg') && !svg.includes('xmlns:xlink')) {
    svg = svg.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  return svg;
}

/** Reads a picture's address as a `data:` URI; `undefined` when it is not a picture or cannot be read. */
export type ImageReader = (url: string) => Promise<string | undefined>;

/** What {@link inlineImages} made: the SVG, and the addresses it could not read. */
export interface SelfContainedSvg {
  svg: string;
  /** The addresses that could not be read, each once, as the SVG wrote them. */
  missing: string[];
}

export interface InlineImagesOptions {
  /** How a picture is read; by default fetched ({@link readImageAsDataUrl}). */
  read?: ImageReader;
  /** What a relative address is relative to; by default the page's address. */
  base?: string;
  /**
   * Take away a picture that could not be read, instead of leaving its address:
   * for a PNG, where it would be drawn as a broken image.
   */
  dropMissing?: boolean;
}

/**
 * Puts every picture an SVG links to — the notation's glyphs, the badges, the
 * pictures chosen for a figure, a line's end symbols — into the SVG itself, as
 * a `data:` URI, each address read once. A file saved so shows its pictures
 * wherever it is opened, without the server or the app it was drawn in; and it
 * can be drawn as a PNG, which an SVG linking to its pictures cannot: an SVG
 * drawn as an image loads nothing from outside itself.
 *
 * A picture that cannot be read keeps its address (or, with `dropMissing`, is
 * taken away) and is reported in `missing`. An SVG that does not parse is
 * returned as it was.
 */
export async function inlineImages(svg: string, options: InlineImagesOptions = {}): Promise<SelfContainedSvg> {
  const read = options.read ?? readImageAsDataUrl;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { svg, missing: [] };

  const linked: Array<{ image: Element; href: string; url: string }> = [];
  for (const image of Array.from(doc.getElementsByTagNameNS(SVG_NS, 'image'))) {
    const href = (image.getAttribute('href') || image.getAttributeNS(XLINK_NS, 'href') || '').trim();
    if (!href || href.startsWith('data:')) continue;
    linked.push({ image, href, url: resolveAddress(href, options.base) });
  }
  if (linked.length === 0) return { svg, missing: [] };

  const reads = new Map<string, Promise<string | undefined>>();
  for (const { url } of linked) {
    if (!reads.has(url)) reads.set(url, read(url).catch(() => undefined));
  }
  const missing = new Set<string>();
  for (const { image, href, url } of linked) {
    const data = await reads.get(url);
    if (data) {
      image.setAttribute('href', data);
      // Both, as drawn: `xlink:href` for the renderers that predate SVG 2.
      image.setAttributeNS(XLINK_NS, 'xlink:href', data);
    } else {
      missing.add(href);
      if (options.dropMissing) image.parentNode?.removeChild(image);
    }
  }
  return { svg: new XMLSerializer().serializeToString(doc), missing: [...missing] };
}

/**
 * Fetches a picture and returns it as a `data:` URI, its type from the response
 * or, when the response does not say, from the address's extension; nothing for
 * a failed response or one that is not a picture (as a page a server answers a
 * missing file with).
 */
export async function readImageAsDataUrl(url: string): Promise<string | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const blob = await response.blob();
  const type = imageTypeOf(blob.type, url);
  if (!type) return undefined;
  return `data:${type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

/** The largest PNG side and area drawn; browsers refuse a canvas much larger. */
const MAX_PNG_SIDE = 16_384;
const MAX_PNG_AREA = 120_000_000;

/**
 * Converts an SVG string to a PNG Blob using the browser Image + Canvas API.
 *
 * @param svgString - A valid SVG string.
 * @param width     - Desired PNG width in pixels (defaults to SVG intrinsic width or 800).
 * @param height    - Desired PNG height in pixels (defaults to SVG intrinsic height or 600).
 * @param scale     - Pixels per SVG unit: 2 draws it at twice its size, sharp on a
 *                    high-density screen or in print. Lowered when the PNG would
 *                    be larger than a browser can draw.
 * @returns A Promise resolving to a PNG Blob.
 */
export function exportPng(
  svgString: string,
  width?: number,
  height?: number,
  scale = 1,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const baseWidth = width ?? parseSvgDimension(svgString, 'width') ?? 800;
    const baseHeight = height ?? parseSvgDimension(svgString, 'height') ?? 600;
    const fit = Math.min(scale, MAX_PNG_SIDE / Math.max(baseWidth, baseHeight), Math.sqrt(MAX_PNG_AREA / (baseWidth * baseHeight)));
    const factor = Number.isFinite(fit) && fit > 0 ? fit : 1;
    const resolvedWidth = Math.max(1, Math.round(baseWidth * factor));
    const resolvedHeight = Math.max(1, Math.round(baseHeight * factor));
    // Drawn at the PNG's own size, so the vector is rasterised sharp rather than
    // drawn small and stretched.
    const sized = factor === 1 ? svgString : withSvgSize(svgString, resolvedWidth, resolvedHeight);

    const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = resolvedWidth;
        canvas.height = resolvedHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to get 2D rendering context'));
          return;
        }

        // White background (PNG is opaque by default in most viewers)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, resolvedWidth, resolvedHeight);
        ctx.drawImage(img, 0, 0, resolvedWidth, resolvedHeight);

        URL.revokeObjectURL(url);

        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            resolve(pngBlob);
          } else {
            reject(new Error('Canvas toBlob returned null'));
          }
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG into Image element'));
    };

    img.src = url;
  });
}

/**
 * Triggers a browser download of a Blob with the given filename.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Clean up
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Triggers a browser download of an SVG string with the given filename.
 */
export function downloadSvg(svgString: string, filename: string): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** An address resolved against `base` (or the page's address); as it was when it does not resolve. */
function resolveAddress(href: string, base?: string): string {
  try {
    return new URL(href, base ?? globalThis.document?.baseURI).href;
  } catch {
    return href;
  }
}

const IMAGE_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

/** Response types that do not say what the file is: the address's extension does. */
const UNNAMED_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const XML_TYPES = new Set(['text/xml', 'application/xml']);

/**
 * A picture's media type: the response's when it names an image; else, when the
 * response does not say (or says XML, for an SVG), the address's extension's.
 * Anything else — a page served in its place — is not a picture.
 */
function imageTypeOf(responseType: string, url: string): string | undefined {
  const type = responseType.split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return type;
  if (!UNNAMED_TYPES.has(type) && !XML_TYPES.has(type)) return undefined;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute address: its own text.
  }
  const extension = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  const byExtension = IMAGE_TYPES[extension];
  return XML_TYPES.has(type) && byExtension !== 'image/svg+xml' ? undefined : byExtension;
}

/** Bytes as base64, in slices (one call per byte would overflow the stack on a large picture). */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The SVG with its root's `width` and `height` set (its `viewBox`, if any, kept: it is scaled). */
function withSvgSize(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    let sized = tag;
    for (const [attr, value] of [['width', width], ['height', height]] as const) {
      const re = new RegExp(`(\\s${attr}=)"[^"]*"`, 'i');
      sized = re.test(sized) ? sized.replace(re, `$1"${value}"`) : sized.replace(/^<svg\b/i, `<svg ${attr}="${value}"`);
    }
    return sized;
  });
}

/**
 * Attempts to parse a numeric dimension (width or height) from the root `<svg>` tag.
 * Returns `undefined` when the attribute is missing or non-numeric.
 */
function parseSvgDimension(svg: string, attr: 'width' | 'height'): number | undefined {
  const re = new RegExp(`<svg[^>]*\\b${attr}="(\\d+(?:\\.\\d+)?)"`, 'i');
  const m = svg.match(re);
  if (m) {
    const val = parseFloat(m[1]);
    if (!Number.isNaN(val) && val > 0) return val;
  }
  return undefined;
}
