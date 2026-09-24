/**
 * RdfRenderer — diagram-js renderer driven by the `arch-vis:` visual notation.
 *
 * Registers on diagram-js's `render.shape` / `render.connection` events (via
 * {@link BaseRenderer}) and draws each element from the {@link VisualStyle} that
 * `PaletteGenerator` extracted from the metamodel, looked up through
 * {@link NotationStyleRegistry}.
 *
 * ## The three rendering modes
 *
 * Which one applies is decided by `effectiveRenderingMode` in
 * `metamodel-manager/notation.ts` — the single place the guide's fallback rules
 * live. This renderer applies one further degradation of its own: a style that
 * *declares* an `iconSymbol` whose value cannot be drawn (blank, or a scheme
 * that is not fetchable) falls back to `ShapeOnly`, because a badge that cannot
 * load is worse than no badge.
 *
 * | mode | shape | icon | label |
 * | --- | --- | --- | --- |
 * | `ShapeWithBadge` | `shapeType`, filled/stroked from the style | glyph as a 20px badge at `iconPlacement` | centred inside |
 * | `IconCentric` | invisible hit container only | glyph at full size | below the icon |
 * | `ShapeOnly` | `shapeType`, filled/stroked from the style | none at all | centred inside |
 *
 * ## Icons are `<image href>`, not inlined SVG
 *
 * The glyphs are bundled files addressed by an asset-root-relative path
 * (`archimate4/icons/glyphs/actor.svg`), emitted verbatim next to the bundle and
 * therefore same-origin. `<image href>` needs no fetch, keeps rendering
 * synchronous (diagram-js redraws on every change, so an async icon path would
 * mean a second render pass and a cache to manage), and cannot inject foreign
 * markup into the document. Inlining would only buy the ability to recolour the
 * glyph, which the ArchiMate notation never asks for: the guide draws the badge
 * as published. The trade-off is that a 404 is only visible at load time, so an
 * `error` listener removes the badge node when the browser reports one.
 */

// diagram-js ships JSDoc-generated declarations alongside its ESM source; the
// `.js` specifier resolves to `BaseRenderer.d.ts` for types.
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer.js';

import { assetUrl } from '../../metamodel-manager/bundled-assets.js';
import type {
  Decoration,
  RelationshipVisualStyle,
  RenderingMode,
  VisualStyle,
} from '../../metamodel-manager/notation.js';
import { NotationStyleRegistry } from './notation-styles.js';
import {
  NOTATION_DEFAULTS,
  badgeBox,
  iconHref,
  labelLayout,
  markerDefinition,
  markerId,
  shapeGeometry,
  shapePath,
  strokeDashArray,
  svgEl,
  type DecorationEnd,
} from './notation-shapes.js';

/** Priority above diagram-js's DefaultRenderer (1) so this one wins. */
const RENDER_PRIORITY = 1500;

/** What a diagram-js element carries about its RDF identity. */
export interface RdfBusinessObject {
  /** IRI of the model element or relationship instance. */
  iri: string;
  /** IRI of its metamodel type. */
  typeIri: string;
  /** Display label. */
  label?: string;
  /** `element` for shapes, `relationship` for connections. */
  kind?: 'element' | 'relationship';
  /**
   * Per-instance icon override.
   *
   * Rendering normally takes the glyph from the notation style, but a caller may
   * pin one to a single element; it is carried here and left to the caller.
   */
  iconUrl?: string;
}

/** The subset of a diagram-js element this renderer reads. */
export interface RenderableElement {
  id: string;
  width?: number;
  height?: number;
  waypoints?: Array<{ x: number; y: number }>;
  businessObject?: RdfBusinessObject;
  [key: string]: unknown;
}

/** CSS classes the renderer puts on the nodes it creates. */
export const RENDER_CLASSES = {
  shape: 'la-shape',
  body: 'la-shape-body',
  badge: 'la-shape-badge',
  icon: 'la-shape-icon',
  label: 'la-shape-label',
  hitContainer: 'la-icon-container',
  connection: 'la-connection',
} as const;

export class RdfRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'notationStyles'];

  private notationStyles: NotationStyleRegistry;

  /** Marker ids already added to the canvas `<defs>`. */
  private installedMarkers = new Set<string>();

  constructor(eventBus: unknown, notationStyles: NotationStyleRegistry) {
    // BaseRenderer's constructor wires the render.* listeners.
    super(eventBus as never, RENDER_PRIORITY);
    this.notationStyles = notationStyles;
  }

  /** This renderer draws every element on an RDF diagram. */
  canRender(): boolean {
    return true;
  }

  // ── Shapes ───────────────────────────────────────────────────────────

  drawShape(parentGfx: SVGElement, element: RenderableElement): SVGElement {
    const businessObject = element.businessObject;
    const typeIri = businessObject?.typeIri;
    const style = this.notationStyles.styleFor(typeIri);

    const width = element.width ?? style?.defaultWidth ?? NOTATION_DEFAULTS.width;
    const height = element.height ?? style?.defaultHeight ?? NOTATION_DEFAULTS.height;
    const label =
      businessObject?.label ?? this.notationStyles.labelFor(typeIri) ?? localName(element.id);

    const href = iconHref(style?.iconSymbol, assetUrl);
    const mode = this.effectiveMode(typeIri, href);

    const group = svgEl('g');
    group.setAttribute('class', `${RENDER_CLASSES.shape} la-mode-${mode}`);
    if (businessObject?.iri) group.setAttribute('data-element-iri', businessObject.iri);
    if (typeIri) group.setAttribute('data-type-iri', typeIri);
    group.setAttribute('data-rendering-mode', mode);

    if (mode === 'IconCentric') {
      this.drawIconCentric(group, width, height, label, href as string);
    } else {
      this.drawShapeBody(group, style, width, height);
      // Present exactly when a badge is drawn — ShapeOnly reserves no room.
      const badgePlacement =
        mode === 'ShapeWithBadge' && href ? (style?.iconPlacement ?? 'TopRight') : undefined;
      if (badgePlacement && href) {
        this.drawBadge(group, href, badgePlacement, width, height);
      }
      this.appendLabel(group, label, width, height, {
        badgePlacement,
        lineColor: style?.lineColor ?? NOTATION_DEFAULTS.lineColor,
      });
    }

    parentGfx.appendChild(group);
    return group;
  }

  /**
   * The mode actually used, given whether the badge glyph can be drawn.
   *
   * `effectiveRenderingMode` (through the registry) has already downgraded a
   * style with no `iconSymbol` at all. This adds the case the guide does not
   * cover: a declared icon whose URI is unusable.
   */
  private effectiveMode(typeIri: string | undefined, href: string | null): RenderingMode {
    const declared = this.notationStyles.renderingModeFor(typeIri);
    if (declared === 'ShapeOnly') return 'ShapeOnly';
    return href ? declared : 'ShapeOnly';
  }

  /** The filled, stroked `shapeType` body. */
  private drawShapeBody(
    group: SVGElement,
    style: VisualStyle | undefined,
    width: number,
    height: number,
  ): SVGElement {
    const geometry = shapeGeometry(style?.shapeType, width, height);
    const body = svgEl(geometry.tag, geometry.attrs);
    body.setAttribute('class', RENDER_CLASSES.body);
    body.setAttribute('fill', style?.fillColor ?? NOTATION_DEFAULTS.fillColor);
    body.setAttribute('stroke', style?.lineColor ?? NOTATION_DEFAULTS.lineColor);
    body.setAttribute('stroke-width', String(NOTATION_DEFAULTS.strokeWidth));
    group.appendChild(body);
    return body;
  }

  /** The small glyph badge at `iconPlacement`. */
  private drawBadge(
    group: SVGElement,
    href: string,
    placement: VisualStyle['iconPlacement'],
    width: number,
    height: number,
  ): SVGElement {
    const box = badgeBox(placement, width, height);
    const badge = svgEl('image', {
      x: box.x,
      y: box.y,
      width: box.size,
      height: box.size,
      href,
      preserveAspectRatio: 'xMidYMid meet',
    });
    // `xlink:href` alongside `href` for renderers that predate SVG 2.
    badge.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    badge.setAttribute('class', RENDER_CLASSES.badge);
    badge.setAttribute('data-icon-placement', placement ?? 'TopRight');
    this.removeOnLoadError(badge);
    group.appendChild(badge);
    return badge;
  }

  /**
   * IconCentric: the glyph is the element.
   *
   * A transparent rectangle over the full bounds gives diagram-js's hover and
   * selection something to sit on — without it only the icon's own painted
   * pixels would be interactive.
   */
  private drawIconCentric(
    group: SVGElement,
    width: number,
    height: number,
    label: string,
    href: string,
  ): void {
    const container = svgEl('rect', { x: 0, y: 0, width, height });
    container.setAttribute('class', RENDER_CLASSES.hitContainer);
    container.setAttribute('fill', 'none');
    container.setAttribute('stroke', 'none');
    container.setAttribute('pointer-events', 'all');
    group.appendChild(container);

    const iconHeight = Math.max(1, height - NOTATION_DEFAULTS.iconCentricLabelBand);
    const icon = svgEl('image', {
      x: 0,
      y: 0,
      width,
      height: iconHeight,
      href,
      preserveAspectRatio: 'xMidYMid meet',
    });
    icon.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    icon.setAttribute('class', RENDER_CLASSES.icon);
    this.removeOnLoadError(icon);
    group.appendChild(icon);

    this.appendLabel(group, label, width, height, {
      below: true,
      lineColor: NOTATION_DEFAULTS.lineColor,
    });
  }

  /** Centred (or below-icon) multi-line label. */
  private appendLabel(
    group: SVGElement,
    label: string,
    width: number,
    height: number,
    options: { badgePlacement?: VisualStyle['iconPlacement']; below?: boolean; lineColor: string },
  ): SVGElement | null {
    const layout = labelLayout(label, width, height, {
      badgePlacement: options.badgePlacement,
      below: options.below,
    });
    if (layout.lines.length === 0) return null;

    const text = svgEl('text', {
      x: layout.x,
      y: layout.y,
      'text-anchor': 'middle',
      'font-size': NOTATION_DEFAULTS.fontSize,
      'font-family': NOTATION_DEFAULTS.fontFamily,
      fill: options.lineColor,
    });
    text.setAttribute('class', RENDER_CLASSES.label);

    layout.lines.forEach((line, index) => {
      const span = svgEl('tspan', {
        x: layout.x,
        dy: index === 0 ? 0 : layout.lineHeight,
      });
      span.textContent = line;
      text.appendChild(span);
    });

    group.appendChild(text);
    return text;
  }

  // ── Connections ──────────────────────────────────────────────────────

  drawConnection(parentGfx: SVGElement, connection: RenderableElement): SVGElement {
    const businessObject = connection.businessObject;
    const style: RelationshipVisualStyle | undefined = this.notationStyles.relationshipStyleFor(
      businessObject?.typeIri,
    );
    const lineColor = style?.lineColor ?? NOTATION_DEFAULTS.lineColor;
    const waypoints = connection.waypoints ?? [];

    const line = svgEl('polyline', {
      points: waypoints.map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke: lineColor,
      'stroke-width': NOTATION_DEFAULTS.strokeWidth,
      'stroke-linejoin': 'round',
    });
    line.setAttribute('class', RENDER_CLASSES.connection);
    if (businessObject?.iri) line.setAttribute('data-relationship-iri', businessObject.iri);
    if (businessObject?.typeIri) line.setAttribute('data-type-iri', businessObject.typeIri);

    const dashArray = strokeDashArray(style?.lineStyle);
    if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
    line.setAttribute('data-line-style', style?.lineStyle ?? 'SolidLine');

    this.applyDecoration(parentGfx, line, style?.sourceDecor, 'source', lineColor);
    this.applyDecoration(parentGfx, line, style?.targetDecor, 'target', lineColor);

    parentGfx.appendChild(line);
    return line;
  }

  /** Install the marker in the canvas `<defs>` and reference it from the line. */
  private applyDecoration(
    parentGfx: SVGElement,
    line: SVGElement,
    decoration: Decoration | undefined,
    end: DecorationEnd,
    lineColor: string,
  ): void {
    const decor = decoration ?? 'NoDecoration';
    line.setAttribute(end === 'source' ? 'data-source-decor' : 'data-target-decor', decor);
    if (decor === 'NoDecoration') return;

    const id = markerId(decor, end, lineColor);
    this.ensureMarker(parentGfx, decor, end, lineColor);
    line.setAttribute(end === 'source' ? 'marker-start' : 'marker-end', `url(#${id})`);
  }

  /**
   * Add a `<marker>` to the canvas's `<defs>` once per (decoration, end, colour).
   *
   * Markers are referenced by id, so they must live in the same SVG document as
   * the connection; `ownerSVGElement` finds it without reaching into the Canvas
   * service's private fields.
   */
  private ensureMarker(
    parentGfx: SVGElement,
    decoration: Decoration,
    end: DecorationEnd,
    lineColor: string,
  ): void {
    const id = markerId(decoration, end, lineColor);
    if (this.installedMarkers.has(id)) return;

    const svg = parentGfx.ownerSVGElement ?? closestSvg(parentGfx);
    if (!svg) return;

    let defs = svg.querySelector('defs.la-notation-markers');
    if (!defs) {
      defs = svgEl('defs');
      defs.setAttribute('class', 'la-notation-markers');
      svg.insertBefore(defs, svg.firstChild);
    }

    if (!defs.querySelector(`#${cssEscapeId(id)}`)) {
      const marker = markerDefinition(decoration, end, lineColor);
      if (marker) defs.appendChild(marker.element);
    }
    this.installedMarkers.add(id);
  }

  // ── Paths (used by connection cropping / docking) ─────────────────────

  /**
   * Outline of the shape, in absolute coordinates.
   *
   * diagram-js crops connections against exactly this path (see
   * `CroppingConnectionDocking`), so it has to be the outline
   * {@link drawShape} actually painted — the style's `shapeType`, not a
   * rectangle for everything. An `Octagon` or `Diamond` docked as a box would
   * take lines across its empty corners.
   *
   * The one place it deviates from the *body* geometry is `IconCentric`, where
   * no body is drawn at all: what the pointer and the eye see there is the
   * full-bounds hit container, so that is what a connection docks against.
   */
  getShapePath(shape: RenderableElement): string {
    const typeIri = shape.businessObject?.typeIri;
    const style = this.notationStyles.styleFor(typeIri);

    const x = (shape['x'] as number) ?? 0;
    const y = (shape['y'] as number) ?? 0;
    const width = shape.width ?? style?.defaultWidth ?? NOTATION_DEFAULTS.width;
    const height = shape.height ?? style?.defaultHeight ?? NOTATION_DEFAULTS.height;

    const mode = this.effectiveMode(typeIri, iconHref(style?.iconSymbol, assetUrl));
    const shapeType = mode === 'IconCentric' ? 'Rectangle' : style?.shapeType;

    return shapePath(shapeType, x, y, width, height);
  }

  /**
   * The connection as a polyline path.
   *
   * `M`/`L` over the waypoints, which is both what `drawConnection` paints (a
   * `<polyline>` over the same points) and what `path-intersection` — the
   * intersector behind connection cropping — parses: it normalises `L` through
   * `lineToCurve` before intersecting, so a straight-segment path is its
   * simplest input rather than a special case.
   */
  getConnectionPath(connection: RenderableElement): string {
    const waypoints = connection.waypoints ?? [];
    return waypoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('');
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Drop a badge whose image fails to load.
   *
   * A missing glyph then leaves a clean shape rather than the browser's broken
   * image placeholder — the render-time equivalent of degrading to `ShapeOnly`.
   * Nothing fires in jsdom (there is no image loader), which is why the
   * unresolvable-URI case is handled up front instead of relying on this.
   */
  private removeOnLoadError(image: SVGElement): void {
    image.addEventListener('error', () => {
      image.parentNode?.removeChild(image);
    });
  }
}

/** Nearest ancestor `<svg>`, for nodes not yet attached to one. */
function closestSvg(node: Element | null): SVGSVGElement | null {
  let current: Element | null = node;
  while (current) {
    if (current.tagName.toLowerCase() === 'svg') return current as SVGSVGElement;
    current = current.parentElement;
  }
  return null;
}

/** Escape an id for use in a CSS selector. */
function cssEscapeId(id: string): string {
  return id.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

/** Last path/fragment segment of an IRI, used when nothing supplies a label. */
function localName(iri: string): string {
  if (iri.includes('#')) return iri.slice(iri.lastIndexOf('#') + 1);
  const trimmed = iri.replace(/\/$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || iri;
}

/**
 * diagram-js module registering the renderer and the style registry.
 *
 * `notationStyles` is a `value` binding rather than a `type`, so `DiagramCanvas`
 * can keep a reference and re-index it when the palette changes.
 */
export function rdfRendererModule(notationStyles: NotationStyleRegistry): Record<string, unknown> {
  return {
    __init__: ['rdfRenderer'],
    rdfRenderer: ['type', RdfRenderer],
    notationStyles: ['value', notationStyles],
  };
}
