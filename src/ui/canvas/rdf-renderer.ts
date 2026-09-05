/**
 * RdfRenderer — custom diagram-js renderer for RDF architecture elements.
 *
 * Renders elements as rectangles with a label and optional icon
 * based on `arch:prefVisNotation`.
 */

/** Visual representation data for a canvas element. */
export interface RenderableElement {
  id: string;
  iri: string;
  typeIri: string;
  label: string;
  iconUrl?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rendering configuration constants. */
export const RENDER_DEFAULTS = {
  fillColor: '#ffffff',
  strokeColor: '#333333',
  strokeWidth: 2,
  fontSize: 12,
  fontFamily: 'Arial, sans-serif',
  padding: 8,
  iconSize: 20,
  cornerRadius: 4,
} as const;

/**
 * Produces SVG markup for a renderable element.
 *
 * Elements are drawn as rounded rectangles with:
 * - A label centered in the rectangle
 * - An optional icon in the top-right corner (from arch:prefVisNotation)
 */
export class RdfRenderer {
  /**
   * Generate SVG group markup for a single element.
   * Returns an SVG `<g>` element string that can be appended to the canvas.
   */
  renderElement(element: RenderableElement): string {
    const { x, y, width, height, label, iconUrl } = element;
    const { fillColor, strokeColor, strokeWidth, fontSize, fontFamily, padding, iconSize, cornerRadius } =
      RENDER_DEFAULTS;

    let svg = `<g data-element-iri="${element.iri}" transform="translate(${x}, ${y})">`;

    // Background rectangle
    svg += `<rect width="${width}" height="${height}" rx="${cornerRadius}" ry="${cornerRadius}" `;
    svg += `fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;

    // Icon (top-right corner) if available
    if (iconUrl) {
      const iconX = width - iconSize - padding;
      const iconY = padding;
      svg += `<image href="${iconUrl}" x="${iconX}" y="${iconY}" `;
      svg += `width="${iconSize}" height="${iconSize}" />`;
    }

    // Label (centered)
    const textX = width / 2;
    const textY = height / 2 + fontSize / 3;
    svg += `<text x="${textX}" y="${textY}" text-anchor="middle" `;
    svg += `font-size="${fontSize}" font-family="${fontFamily}" fill="${strokeColor}">`;
    svg += this.escapeXml(label);
    svg += `</text>`;

    svg += `</g>`;
    return svg;
  }

  /**
   * Determine the visual properties for an element based on its type.
   * Returns rendering metadata without producing SVG.
   */
  getElementStyle(element: RenderableElement): {
    fillColor: string;
    strokeColor: string;
    hasIcon: boolean;
  } {
    return {
      fillColor: RENDER_DEFAULTS.fillColor,
      strokeColor: RENDER_DEFAULTS.strokeColor,
      hasIcon: !!element.iconUrl,
    };
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
