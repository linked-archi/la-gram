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
 * The label takes `arch-vis:fontColor`, else the line colour (under an
 * IconCentric icon, else black).
 *
 * "Inside" is the shape's {@link shapeLayout}: below a band, on a 3D box's front
 * face, above a wave; a `Folder`'s label sits in its tab. A shape's inner lines
 * are drawn over its body, and `arch-vis:borderStyle` dashes or dots both.
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
 *
 * ## A relationship's name
 *
 * Drawn only when {@link RenderOptions.relationshipNames} says so (the canvas
 * toolbar's switch, off by default) and the relationship has a name of its
 * own: centred on the middle of its route, wrapped as a shape's name is, on a
 * white box so the line stops at the name — or just under the derivation
 * badge, which sits on that middle; moved (`rdf-link-label.ts`), at its offset
 * from that middle, so it follows the line. {@link connectionLabelLayout} is
 * the one place the geometry is worked out: the renaming text box and the
 * export's crop read it too.
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
  labelFitsInside,
  labelLayout,
  markerDefinition,
  markerId,
  parseDecorationSymbol,
  symbolMarkerDefinition,
  type DecorationSymbol,
  shapeGeometry,
  shapeLayout,
  shapePath,
  strokeDashArray,
  type Box,
  svgEl,
  type DecorationEnd,
  wrapLabel,
} from './notation-shapes.js';

/** Priority above diagram-js's DefaultRenderer (1) so this one wins. */
const RENDER_PRIORITY = 1500;

/** Radius of the D/P badge on a derived relationship's line. */
const DERIVATION_BADGE_RADIUS = 7;

/** Room around a relationship's name: between it and the badge above it, and around its lines. */
const CONNECTION_LABEL_GAP = 2;

/** What the renderer draws beyond the notation; the canvas changes it, then redraws. */
export interface RenderOptions {
  /**
   * Draw a relationship's name on its line. Off by default: a view reads its
   * relationships from their lines' notation, and names on all of them crowd it.
   */
  relationshipNames: boolean;
}

/** Where a relationship's name goes. */
export interface ConnectionLabelLayout {
  /** The name's lines, wrapped as a shape's name is; none for an empty name. */
  lines: string[];
  /** Horizontal centre of the lines (`text-anchor: middle`). */
  x: number;
  /** Baseline of the first line. */
  y: number;
  lineHeight: number;
  /** What the lines take, at least one line high: where the name is clicked and typed. */
  box: Box;
}

/** Where a name's centre is from the middle of its route. */
export interface LabelOffset {
  x: number;
  y: number;
}

/**
 * Where a relationship's name goes on its route: centred on the route's middle,
 * or — with a derivation badge there — its top just under the badge; moved, its
 * centre `offset` from the route's middle, which it keeps as the route changes.
 * `undefined` without two waypoints.
 */
export function connectionLabelLayout(
  waypoints: ReadonlyArray<{ x: number; y: number }>,
  label: string,
  options: { badge?: boolean; offset?: LabelOffset } = {},
): ConnectionLabelLayout | undefined {
  const middle = midpointOf(waypoints);
  if (!middle) return undefined;
  const { fontSize } = NOTATION_DEFAULTS;
  const lineHeight = Math.round(fontSize * 1.2);
  const lines = wrapLabel(label, NOTATION_DEFAULTS.width, fontSize);
  // wrapLabel's own estimate of a character's width.
  const textWidth = Math.max(0, ...lines.map((line) => line.length)) * fontSize * 0.55;
  const width = textWidth + 2 * CONNECTION_LABEL_GAP;
  const height = Math.max(1, lines.length) * lineHeight;
  const { offset } = options;
  const centreX = middle.x + (offset?.x ?? 0);
  const top = offset
    ? middle.y + offset.y - height / 2
    : options.badge
      ? middle.y + DERIVATION_BADGE_RADIUS + CONNECTION_LABEL_GAP
      : middle.y - height / 2;
  return {
    lines,
    x: round2(centreX),
    y: round2(top + fontSize * 0.85),
    lineHeight,
    box: { x: round2(centreX - width / 2), y: round2(top), width: round2(width), height },
  };
}

/**
 * The offset of a box's centre from the middle of a route: where a name kept in
 * the view (`arch-vis:LabelNode`, in the diagram's coordinates) is, relative to
 * the line it follows. `undefined` without two waypoints.
 */
export function labelOffsetOf(
  waypoints: ReadonlyArray<{ x: number; y: number }>,
  box: { x: number; y: number; width: number; height: number },
): LabelOffset | undefined {
  const middle = midpointOf(waypoints);
  if (!middle) return undefined;
  return { x: round2(box.x + box.width / 2 - middle.x), y: round2(box.y + box.height / 2 - middle.y) };
}

/** The name drawn on a relationship's line: when names are shown and it has one of its own. */
export function drawnConnectionLabel(
  connection: Pick<RenderableElement, 'waypoints' | 'businessObject'>,
  options: RenderOptions,
): ConnectionLabelLayout | undefined {
  const businessObject = connection.businessObject;
  if (!options.relationshipNames || businessObject?.kind !== 'relationship' || !businessObject.named || !businessObject.label) {
    return undefined;
  }
  const layout = connectionLabelLayout(connection.waypoints ?? [], businessObject.label, {
    badge: !!businessObject.derivation,
    offset: businessObject.labelOffset,
  });
  return layout && layout.lines.length > 0 ? layout : undefined;
}

/** The point halfway along a polyline, by length; `undefined` without two points. */
export function midpointOf(waypoints: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } | undefined {
  if (waypoints.length < 2) return undefined;
  const lengths = waypoints.slice(1).map((p, i) => Math.hypot(p.x - waypoints[i]!.x, p.y - waypoints[i]!.y));
  let remaining = lengths.reduce((sum, l) => sum + l, 0) / 2;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]!;
    if (remaining <= length) {
      const f = length === 0 ? 0 : remaining / length;
      const a = waypoints[i]!;
      const b = waypoints[i + 1]!;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= length;
  }
  return waypoints[waypoints.length - 1];
}

/** What a diagram-js element carries about its RDF identity. */
export interface RdfBusinessObject {
  /** IRI of the model element or relationship instance. */
  iri: string;
  /** IRI of its metamodel type. */
  typeIri: string;
  /** Display label. A relationship's is its own name, when it has one, and nothing else. */
  label?: string;
  /**
   * The label is the element's own name. Absent, `label` shows its type — a
   * shape too small to hold its label then draws none rather than repeat the
   * type under every junction. A relationship without it has no name to draw.
   */
  named?: boolean;
  /** `element` for shapes, `relationship` for connections. */
  kind?: 'element' | 'relationship';
  /**
   * Per-instance icon override.
   *
   * Rendering normally takes the glyph from the notation style, but a caller may
   * pin one to a single element; it is carried here and left to the caller.
   */
  iconUrl?: string;
  /**
   * Set on a shape being dropped from the model tree: the element already
   * exists, so creating the shape places it in the view rather than minting a
   * new element.
   */
  placeExisting?: boolean;
  /**
   * A relationship derived by a rule that the model does not state: a valid
   * derivation, or a potential one not confirmed. Drawn faded, with a badge.
   */
  derivation?: 'valid' | 'potential';
  /** The rule that derived it, by local name (`DR3`), for the badge's tooltip. */
  derivationRule?: string;
  /**
   * Where a relationship's name was moved to in this view: its centre's offset
   * from the middle of the route, so it follows the line. Absent, the name is at
   * the middle.
   */
  labelOffset?: LabelOffset;
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
  details: 'la-shape-details',
  badge: 'la-shape-badge',
  icon: 'la-shape-icon',
  label: 'la-shape-label',
  hitContainer: 'la-icon-container',
  connection: 'la-connection',
  /** A derived relationship's line, with `la-connection-valid` or `la-connection-potential`. */
  derivedConnection: 'la-connection-derived',
  derivationBadge: 'la-derivation-badge',
  /** A relationship's name on its line. */
  connectionLabel: 'la-connection-label',
} as const;

export class RdfRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'notationStyles', 'rdfRenderOptions'];

  private notationStyles: NotationStyleRegistry;
  private readonly renderOptions: RenderOptions;

  /** Marker ids already added to the canvas `<defs>`. */
  private installedMarkers = new Set<string>();
  /** The `<defs>` markers were installed into, to upgrade them when a symbol arrives. */
  private markerDefs = new Set<Element>();
  /** Published decoration symbols by URL: loaded, failed (`null`) or loading. */
  private symbols = new Map<string, DecorationSymbol | null | Promise<void>>();

  constructor(eventBus: unknown, notationStyles: NotationStyleRegistry, renderOptions: RenderOptions) {
    // BaseRenderer's constructor wires the render.* listeners.
    super(eventBus as never, RENDER_PRIORITY);
    this.notationStyles = notationStyles;
    this.renderOptions = renderOptions;
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
      this.drawIconCentric(group, width, height, label, href as string, style?.fontColor);
    } else {
      this.drawShapeBody(group, style, width, height);
      const color = style?.fontColor ?? style?.lineColor ?? NOTATION_DEFAULTS.lineColor;
      if (!labelFitsInside(width, height)) {
        // A junction: no room for a badge, and its name, if it has one, under it.
        if (businessObject?.named) this.appendLabel(group, label, { x: 0, y: 0, width, height }, { outside: true, color });
        parentGfx.appendChild(group);
        return group;
      }
      const layout = containerLayout(shapeLayout(style?.customShape ?? style?.shapeType, width, height), element);
      // Present exactly when a badge is drawn — ShapeOnly reserves no room.
      const badgePlacement =
        mode === 'ShapeWithBadge' && href ? (style?.iconPlacement ?? 'TopRight') : undefined;
      if (badgePlacement && href) {
        this.drawBadge(group, href, badgePlacement, layout.content);
      }
      this.appendLabel(group, label, layout.label, {
        // The label makes room for the badge only when the two share a box.
        badgePlacement: layout.label === layout.content || layout.labelBesideBadge ? badgePlacement : undefined,
        maxLines: layout.maxLabelLines,
        // The label's own colour, else the line colour, as the vocabulary says.
        color,
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

  /** The filled, stroked `shapeType` body, and its inner lines over it. */
  private drawShapeBody(
    group: SVGElement,
    style: VisualStyle | undefined,
    width: number,
    height: number,
  ): SVGElement {
    const geometry = shapeGeometry(style?.customShape ?? style?.shapeType, width, height);
    const lineColor = style?.lineColor ?? NOTATION_DEFAULTS.lineColor;
    const dash = strokeDashArray(style?.borderStyle);
    const stroke = (element: SVGElement) => {
      element.setAttribute('stroke', lineColor);
      element.setAttribute('stroke-width', String(NOTATION_DEFAULTS.strokeWidth));
      if (dash) element.setAttribute('stroke-dasharray', dash);
    };

    const body = svgEl(geometry.tag, geometry.attrs);
    body.setAttribute('class', RENDER_CLASSES.body);
    body.setAttribute('fill', style?.fillColor ?? NOTATION_DEFAULTS.fillColor);
    stroke(body);
    group.appendChild(body);

    if (geometry.details) {
      const details = svgEl('path', { d: geometry.details, fill: 'none' });
      details.setAttribute('class', RENDER_CLASSES.details);
      stroke(details);
      group.appendChild(details);
    }
    return body;
  }

  /** The small glyph badge at `iconPlacement` within the shape's content box. */
  private drawBadge(
    group: SVGElement,
    href: string,
    placement: VisualStyle['iconPlacement'],
    area: Box,
  ): SVGElement {
    const box = badgeBox(placement, area.width, area.height);
    const badge = svgEl('image', {
      x: offset(area.x, box.x),
      y: offset(area.y, box.y),
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
    fontColor: string | undefined,
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

    this.appendLabel(group, label, { x: 0, y: 0, width, height }, {
      below: true,
      // Under the icon, on the canvas: the line colour is no guide here.
      color: fontColor ?? NOTATION_DEFAULTS.lineColor,
    });
  }

  /** Multi-line label, centred in `area` (or below the icon, or under the shape). */
  private appendLabel(
    group: SVGElement,
    label: string,
    area: Box,
    options: {
      badgePlacement?: VisualStyle['iconPlacement'];
      below?: boolean;
      outside?: boolean;
      maxLines?: number;
      color: string;
    },
  ): SVGElement | null {
    const local = labelLayout(label, area.width, area.height, {
      badgePlacement: options.badgePlacement,
      below: options.below,
      outside: options.outside,
      maxLines: options.maxLines,
    });
    if (local.lines.length === 0) return null;
    const layout = { ...local, x: offset(area.x, local.x), y: offset(area.y, local.y) };

    const text = svgEl('text', {
      x: layout.x,
      y: layout.y,
      'text-anchor': 'middle',
      'font-size': NOTATION_DEFAULTS.fontSize,
      'font-family': NOTATION_DEFAULTS.fontFamily,
      fill: options.color,
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
    const derivation = businessObject?.derivation;
    const opacity = derivation ? (derivation === 'valid' ? '0.6' : '0.4') : undefined;
    if (derivation && opacity) {
      // The notation's line, faded; and a badge saying what it is — the line style stays the notation's.
      line.setAttribute('class', `${RENDER_CLASSES.connection} ${RENDER_CLASSES.derivedConnection} la-connection-${derivation}`);
      line.setAttribute('stroke-opacity', opacity);
      line.setAttribute('data-derivation', derivation);
      this.drawDerivationBadge(parentGfx, waypoints, derivation, businessObject?.derivationRule, lineColor);
    }
    const label = drawnConnectionLabel(connection, this.renderOptions);
    if (label) this.drawConnectionLabel(parentGfx, label, lineColor, opacity);
    return line;
  }

  /**
   * A relationship's name: the lines on a white box, so the route stops at the
   * name rather than running through it — between the words too, which a halo
   * round the letters alone leaves crossed — in the line's colour (faded as a
   * derived line is). The halo stays for a letter wider than the box's estimate.
   *
   * diagram-js leaves its drawn graphics deaf to the pointer and hits a line on
   * its stroke alone; the box, open to the pointer as an IconCentric shape's
   * container is, lets a click or a double-click on the name reach the
   * relationship too.
   */
  private drawConnectionLabel(
    parentGfx: SVGElement,
    layout: ConnectionLabelLayout,
    color: string,
    opacity: string | undefined,
  ): void {
    const group = svgEl('g', { class: RENDER_CLASSES.connectionLabel });
    if (opacity) group.setAttribute('opacity', opacity);
    const box = svgEl('rect', { ...layout.box, fill: '#ffffff', stroke: 'none' });
    box.setAttribute('pointer-events', 'all');
    group.appendChild(box);
    const text = svgEl('text', {
      x: layout.x,
      y: layout.y,
      'text-anchor': 'middle',
      'font-size': NOTATION_DEFAULTS.fontSize,
      'font-family': NOTATION_DEFAULTS.fontFamily,
      fill: color,
      stroke: '#ffffff',
      'stroke-width': 3,
      'stroke-linejoin': 'round',
      'paint-order': 'stroke',
    });
    layout.lines.forEach((line, index) => {
      const span = svgEl('tspan', { x: layout.x, dy: index === 0 ? 0 : layout.lineHeight });
      span.textContent = line;
      text.appendChild(span);
    });
    group.appendChild(text);
    parentGfx.appendChild(group);
  }

  /** A small badge at the middle of a derived relationship's line: D for valid, P for potential. */
  private drawDerivationBadge(
    parentGfx: SVGElement,
    waypoints: ReadonlyArray<{ x: number; y: number }>,
    derivation: 'valid' | 'potential',
    rule: string | undefined,
    lineColor: string,
  ): void {
    const middle = midpointOf(waypoints);
    if (!middle) return;
    const badge = svgEl('g', { class: RENDER_CLASSES.derivationBadge, 'data-derivation': derivation });
    const title = svgEl('title');
    title.textContent = `${derivation === 'valid' ? 'Derived (valid)' : 'Potential derivation, not confirmed'}${rule ? ` — ${rule}` : ''}`;
    badge.appendChild(title);
    badge.appendChild(
      svgEl('circle', {
        cx: middle.x,
        cy: middle.y,
        r: DERIVATION_BADGE_RADIUS,
        fill: '#ffffff',
        stroke: lineColor,
        'stroke-width': 1,
        ...(derivation === 'potential' ? { 'stroke-dasharray': '2 2' } : {}),
      }),
    );
    const letter = svgEl('text', {
      x: middle.x,
      y: middle.y + 3.5,
      'text-anchor': 'middle',
      'font-size': 9,
      'font-family': 'sans-serif',
      fill: lineColor,
    });
    letter.textContent = derivation === 'valid' ? 'D' : 'P';
    badge.appendChild(letter);
    parentGfx.appendChild(badge);
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
      // The published symbol when it is here; built-in geometry until it is.
      const symbol = this.decorationSymbol(decoration);
      const marker = symbol ? symbolMarkerDefinition(symbol, decoration, end, lineColor) : markerDefinition(decoration, end, lineColor);
      if (marker) defs.appendChild(marker.element);
    }
    this.markerDefs.add(defs);
    this.installedMarkers.add(id);
  }

  /**
   * The published symbol of a decoration (`arch-vis:decorSymbol`), once loaded.
   * The first ask starts loading it; markers drawn meanwhile use built-in
   * geometry and are replaced when it arrives ({@link upgradeMarkers}).
   */
  private decorationSymbol(decoration: Decoration): DecorationSymbol | undefined {
    const href = iconHref(this.notationStyles.decorationSymbolFor?.(decoration), assetUrl);
    if (!href) return undefined;
    const known = this.symbols.get(href);
    if (known === undefined) this.symbols.set(href, this.loadSymbol(href, decoration));
    return known && !(known instanceof Promise) ? known : undefined;
  }

  private async loadSymbol(href: string, decoration: Decoration): Promise<void> {
    let symbol: DecorationSymbol | null = null;
    try {
      const response = await fetch(href, { cache: 'no-cache' });
      if (response.ok) symbol = parseDecorationSymbol(await response.text());
    } catch {
      symbol = null; // unreachable or unreadable: the built-in geometry stays
    }
    this.symbols.set(href, symbol);
    if (symbol) this.upgradeMarkers(decoration, symbol);
  }

  /** Replace the built-in markers of a decoration with its published symbol, wherever installed. */
  private upgradeMarkers(decoration: Decoration, symbol: DecorationSymbol): void {
    for (const defs of this.markerDefs) {
      for (const old of Array.from(defs.querySelectorAll(`marker[data-decoration="${decoration}"][data-source="built-in"]`))) {
        const end = old.getAttribute('data-end') as DecorationEnd;
        const color = old.getAttribute('data-color') ?? NOTATION_DEFAULTS.lineColor;
        old.replaceWith(symbolMarkerDefinition(symbol, decoration, end, color).element);
      }
    }
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
    // Asked for once a link end — four times a shape when a view is drawn
    // (Task 22) — so kept until the shape moves, resizes, is retyped or the
    // notation changes.
    const stamp = `${shape['x']},${shape['y']},${shape.width},${shape.height},${typeIri},${this.notationStyles.version}`;
    const known = this.shapePaths.get(shape);
    if (known?.stamp === stamp) return known.path;

    const style = this.notationStyles.styleFor(typeIri);

    const x = (shape['x'] as number) ?? 0;
    const y = (shape['y'] as number) ?? 0;
    const width = shape.width ?? style?.defaultWidth ?? NOTATION_DEFAULTS.width;
    const height = shape.height ?? style?.defaultHeight ?? NOTATION_DEFAULTS.height;

    const mode = this.effectiveMode(typeIri, iconHref(style?.iconSymbol, assetUrl));
    const outline = mode === 'IconCentric' ? 'Rectangle' : (style?.customShape ?? style?.shapeType);

    const path = shapePath(outline, x, y, width, height);
    this.shapePaths.set(shape, { stamp, path });
    return path;
  }

  /** Each shape's outline as last computed, and what it was computed for. */
  private readonly shapePaths = new WeakMap<object, { stamp: string; path: string }>();

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
/** A shape-local coordinate moved by a box's offset, to two decimals as the geometry is. */
function offset(origin: number, value: number): number {
  return Math.round((origin + value) * 100) / 100;
}

/** To two decimals, as the geometry is. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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
 * diagram-js module registering the renderer, the style registry and the
 * render options.
 *
 * `notationStyles` and `renderOptions` are `value` bindings rather than types,
 * so `DiagramCanvas` can keep a reference to each — re-index the styles when the
 * palette changes, switch relationship names on and off — and redraw.
 */
export function rdfRendererModule(
  notationStyles: NotationStyleRegistry,
  renderOptions: RenderOptions = { relationshipNames: false },
): Record<string, unknown> {
  return {
    __init__: ['rdfRenderer'],
    rdfRenderer: ['type', RdfRenderer],
    notationStyles: ['value', notationStyles],
    rdfRenderOptions: ['value', renderOptions],
  };
}

/**
 * A container's layout: once something is drawn inside it, its name goes to
 * the top of its content box, on at most two lines, where what is inside does
 * not cover it. A label box of its own (a folder's tab) stays as it is.
 */
function containerLayout(layout: ReturnType<typeof shapeLayout>, element: RenderableElement): ReturnType<typeof shapeLayout> {
  const children = (element as { children?: Array<{ waypoints?: unknown }> }).children ?? [];
  if (!children.some((child) => !child.waypoints) || layout.label !== layout.content) return layout;
  const lineHeight = Math.round(NOTATION_DEFAULTS.fontSize * 1.2);
  const band = Math.min(layout.content.height, 2 * lineHeight + 2 * NOTATION_DEFAULTS.badgePadding);
  return { ...layout, label: { ...layout.content, height: band }, maxLabelLines: 2, labelBesideBadge: true };
}
