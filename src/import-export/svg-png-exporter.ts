/**
 * SVG/PNG Exporter — exports diagram views as SVG or PNG images.
 *
 * `exportSvg` cleans/formats an SVG string (from diagram-js saveSVG) for download.
 * `exportPng` rasterises an SVG string to a PNG Blob via the browser Canvas API.
 * `downloadSvg` / `downloadBlob` trigger browser downloads.
 *
 * Requirements: 12.3
 */

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

/**
 * Converts an SVG string to a PNG Blob using the browser Image + Canvas API.
 *
 * @param svgString - A valid SVG string.
 * @param width     - Desired PNG width in pixels (defaults to SVG intrinsic width or 800).
 * @param height    - Desired PNG height in pixels (defaults to SVG intrinsic height or 600).
 * @returns A Promise resolving to a PNG Blob.
 */
export function exportPng(
  svgString: string,
  width?: number,
  height?: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const resolvedWidth = width ?? parseSvgDimension(svgString, 'width') ?? 800;
    const resolvedHeight = height ?? parseSvgDimension(svgString, 'height') ?? 600;

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
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
