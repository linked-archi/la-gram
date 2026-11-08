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
 * ## Its own look in the view
 *
 * What a placement's or a line's own style sets (`model-manager/appearance.ts`,
 * the property panel's Appearance tab) is drawn over its notation's — which may
 * set any of it too, core-vis 0.7's font, line width, text placement, gradient
 * and icon colour as well as its colours — over la-gram's: fill and
 * its gradient, line colour and width, outline style, the glyph's colour, font,
 * and where its name sits — unless
 * {@link RenderOptions.notationOnly} says to draw the notation alone. The text
 * keeps the notation's colour when only the line colour is set. A figure, or a line from a note, has no notation: its own look is always
 * drawn.
 *
 * ## Icons are `<image href>`, not inlined SVG
 *
 * The glyphs are bundled files addressed by an asset-root-relative path
 * (`archimate4/icons/glyphs/actor.svg`), emitted verbatim next to the bundle and
 * therefore same-origin. `<image href>` needs no fetch, keeps rendering
 * synchronous (diagram-js redraws on every change, so an async icon path would
 * mean a second render pass and a cache to manage), and cannot inject foreign
 * markup into the document. Inlining would buy the ability to recolour the
 * glyph, which the notation never asks for: the guide draws the badge as
 * published. A placement given an icon colour has it drawn through an
 * SVG filter instead — the glyph's opaque lines flooded with the colour, its
 * transparent parts left so. The trade-off is that a 404 is only visible at load time, so an
 * `error` listener removes the badge node when the browser reports one.
 *
 * ## A relationship's name
 *
 * Drawn only when {@link RenderOptions.relationshipNames} says so (the canvas
 * toolbar's switch, off by default) and the relationship has a name of its
 * own: centred on the middle of its route — or near its source or its target
 * end, as its look's `labelAnchor` says — wrapped as a shape's name is, on a
 * white box so the line stops at the name; at the middle, just under the
 * derivation badge, which sits there. Moved (`rdf-link-label.ts`), at its
 * offset from that middle, so it follows the line, wherever it is anchored. {@link connectionLabelLayout} is
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
  ShapeType,
  VisualStyle,
} from '../../metamodel-manager/notation.js';
import type { FigureInfo } from '../../model-manager/interfaces.js';
import {
  hasFontStyle,
  imageUri,
  lookOf,
  type Appearance,
  type Gradient,
  type ImagePosition,
  type LabelAnchor,
  type TextAlignment,
  type TextPosition,
} from '../../model-manager/appearance.js';
import { figureColours } from '../figure-bar.js';
import { NotationStyleRegistry } from './notation-styles.js';
import {
  NOTATION_DEFAULTS,
  containerNameBand,
  textWidth,
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
  SHAPE_TYPES,
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

/** How far a name anchored at an end of its line keeps from that end, beyond its own half. */
const CONNECTION_LABEL_END_GAP = 8;

/** What the renderer draws beyond the notation; the canvas changes it, then redraws. */
export interface RenderOptions {
  /**
   * Draw a relationship's name on its line. Off by default: a view reads its
   * relationships from their lines' notation, and names on all of them crowd it.
   */
  relationshipNames: boolean;
  /**
   * Draw each element and relationship as its notation does, leaving out the
   * look set on it in the view (the canvas toolbar's "Notation only" switch,
   * off by default). Figures, which have no notation, keep theirs.
   */
  notationOnly?: boolean;
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
  /** The text's size: the line's own font size, else la-gram's. */
  fontSize: number;
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
 * or — with a derivation badge there — its top just under the badge; anchored at
 * an end (`anchor`), centred on the route just clear of that end; moved, its
 * centre `offset` from the route's middle, which it keeps as the route changes.
 * `undefined` without two waypoints.
 */
export function connectionLabelLayout(
  waypoints: ReadonlyArray<{ x: number; y: number }>,
  label: string,
  options: { badge?: boolean; offset?: LabelOffset; fontSize?: number; anchor?: LabelAnchor } = {},
): ConnectionLabelLayout | undefined {
  const middle = midpointOf(waypoints);
  if (!middle) return undefined;
  const fontSize = options.fontSize ?? NOTATION_DEFAULTS.fontSize;
  const lineHeight = Math.round(fontSize * 1.2);
  const lines = wrapLabel(label, NOTATION_DEFAULTS.width, fontSize);
  // The box fits the text as drawn: measured in a browser, estimated in jsdom.
  const widest = Math.max(0, ...lines.map((line) => textWidth(line, fontSize)));
  const width = widest + 2 * CONNECTION_LABEL_GAP;
  const height = Math.max(1, lines.length) * lineHeight;
  const { offset } = options;
  // At an end: as far along the route as the box reaches along its first (or last) segment, and a gap.
  const end = !offset && (options.anchor === 'source' || options.anchor === 'target') ? options.anchor : undefined;
  const at = end ? anchoredAt(waypoints, end, width, height) : middle;
  const centreX = at.x + (offset?.x ?? 0);
  const top = offset
    ? middle.y + offset.y - height / 2
    : options.badge && !end
      ? middle.y + DERIVATION_BADGE_RADIUS + CONNECTION_LABEL_GAP
      : at.y - height / 2;
  return {
    lines,
    x: round2(centreX),
    y: round2(top + fontSize * 0.85),
    lineHeight,
    fontSize,
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

/**
 * Where a box of `width` × `height` centred on the route sits clear of its
 * `end`: along the route by as much as the box reaches along the end's segment,
 * and a gap — no further than the middle.
 */
function anchoredAt(
  waypoints: ReadonlyArray<{ x: number; y: number }>,
  end: 'source' | 'target',
  width: number,
  height: number,
): { x: number; y: number } {
  const route = end === 'source' ? waypoints : [...waypoints].reverse();
  const [a, b] = route as [{ x: number; y: number }, { x: number; y: number }];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // The box's half-extent along the segment's direction: half its width when level, half its height when upright.
  const reach = length === 0 ? width / 2 : (Math.abs(b.x - a.x) * width + Math.abs(b.y - a.y) * height) / (2 * length);
  const total = route.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - route[i]!.x, p.y - route[i]!.y), 0);
  return pointAlong(route, Math.min(total / 2, reach + CONNECTION_LABEL_END_GAP))!;
}

/** The name drawn on a relationship's line: when names are shown and it has one of its own. */
export function drawnConnectionLabel(
  connection: Pick<RenderableElement, 'waypoints' | 'businessObject'>,
  options: RenderOptions,
  /** The relationship's notation's look for its name — its size, where it sits — under the line's own. */
  notation?: { fontSize?: number; labelAnchor?: LabelAnchor },
): ConnectionLabelLayout | undefined {
  const businessObject = connection.businessObject;
  // A line from a note says what it says always; a relationship's name, when names are shown.
  const connector = businessObject?.kind === 'connector';
  const named =
    connector || (options.relationshipNames && businessObject?.kind === 'relationship' && (businessObject.named || !!businessObject.labelText));
  // A relationship's name for the presentation context shown, else its own.
  const text = businessObject?.labelText ?? businessObject?.label;
  if (!businessObject || !named || !text) return undefined;
  const own = options.notationOnly && !connector ? undefined : businessObject.appearance;
  const fontSize = own?.fontSize ?? notation?.fontSize;
  const anchor = own?.labelAnchor ?? notation?.labelAnchor;
  const layout = connectionLabelLayout(connection.waypoints ?? [], text, {
    badge: !!businessObject.derivation,
    offset: businessObject.labelOffset,
    ...(fontSize ? { fontSize } : {}),
    ...(anchor ? { anchor } : {}),
  });
  return layout && layout.lines.length > 0 ? layout : undefined;
}

/** The point halfway along a polyline, by length; `undefined` without two points. */
export function midpointOf(waypoints: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } | undefined {
  if (waypoints.length < 2) return undefined;
  const total = waypoints.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - waypoints[i]!.x, p.y - waypoints[i]!.y), 0);
  return pointAlong(waypoints, total / 2);
}

/** The point `distance` along a polyline from its first point; `undefined` without two points. */
function pointAlong(waypoints: ReadonlyArray<{ x: number; y: number }>, distance: number): { x: number; y: number } | undefined {
  if (waypoints.length < 2) return undefined;
  const lengths = waypoints.slice(1).map((p, i) => Math.hypot(p.x - waypoints[i]!.x, p.y - waypoints[i]!.y));
  let remaining = distance;
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
   * What an element's label says when an expression says it (core-vis 0.7's
   * `arch-vis:labelExpression`): drawn in place of {@link label}, which stays
   * its name — what renaming edits. Its lines are the expression's.
   */
  labelText?: string;
  /**
   * Its element's picture for the presentation context shown (core 0.5.0:
   * `arch:altVisNotation` for that context, else `arch:prefVisNotation`): its
   * icon where it is drawn as its icon and its own style names none.
   */
  elementPicture?: string;
  /**
   * The label is the element's own name. Absent, `label` shows its type — a
   * shape too small to hold its label then draws none rather than repeat the
   * type under every junction. A relationship without it has no name to draw.
   */
  named?: boolean;
  /**
   * `element` for an element's shape, `relationship` for connections, `figure`
   * for drawing only, `connector` for a line drawn only — from a note or
   * another figure, standing for no relationship: its link is its `iri`.
   */
  kind?: 'element' | 'relationship' | 'figure' | 'connector';
  /** A figure — a group, a shape, a note — standing for no model element: its node is its `iri`. */
  figure?: FigureInfo;
  /** How this placement or line looks in the view, from its own style; a figure's is in its {@link figure}. */
  appearance?: Appearance;
  /**
   * The view's node this shape draws (`arch-vis:ArchNode`): which placement of
   * its element, when the view places it more than once.
   */
  nodeIri?: string;
  /**
   * The view's link this line draws (`arch-vis:Link`): which line of its
   * relationship, when the view draws it more than once.
   */
  linkIri?: string;
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
  /** A figure, with `la-figure-group`, `la-figure-shape` or `la-figure-note`. */
  figure: 'la-figure',
  /** A line standing for no relationship: a note's, to what it is about. */
  connector: 'la-connector',
  /** A picture drawn in a node (`arch-vis:image`). */
  image: 'la-shape-image',
} as const;

/** Room between a node's outline and a picture drawn in it. */
const IMAGE_INSET = 3;

/** Pictures' own sizes, by address: known, not loaded (`null`), or loading. */
const imageSizes = new Map<string, { width: number; height: number } | null | 'loading'>();

/**
 * Say what a picture's own size is — what loading it in a browser finds out —
 * or that it does not load (`null`): for tests, which load nothing.
 */
export function rememberImageSize(href: string, size: { width: number; height: number } | null): void {
  imageSizes.set(href, size);
}

/**
 * Where a picture is drawn in `area` at `position`: at its own `size`, made
 * smaller to fit — in a corner, at the middle of a side, or centred — or the
 * whole area at `Fill`, or for a picture with no size of its own (an SVG
 * without one), which is then fitted in the area as the position says.
 */
export function imageBox(area: Box, position: ImagePosition, size: { width: number; height: number } | undefined): Box {
  if (position === 'Fill' || !size || size.width <= 0 || size.height <= 0) return area;
  const scale = Math.min(1, area.width / size.width, area.height / size.height);
  const width = round2(size.width * scale);
  const height = round2(size.height * scale);
  const x = position.endsWith('Left') ? area.x : position.endsWith('Right') ? area.x + area.width - width : area.x + (area.width - width) / 2;
  const y = position.startsWith('Top') ? area.y : position.startsWith('Bottom') ? area.y + area.height - height : area.y + (area.height - height) / 2;
  return { x: round2(x), y: round2(y), width, height };
}

/** A node's box less the room kept between its outline and a picture. */
function insetBox(width: number, height: number): Box {
  return { x: IMAGE_INSET, y: IMAGE_INSET, width: Math.max(0, width - 2 * IMAGE_INSET), height: Math.max(0, height - 2 * IMAGE_INSET) };
}

/** How SVG aligns a picture fitted in its box at `position`. */
function imageAlignment(position: ImagePosition): string {
  if (position === 'Fill') return 'none';
  const x = position.endsWith('Left') ? 'xMin' : position.endsWith('Right') ? 'xMax' : 'xMid';
  const y = position.startsWith('Top') ? 'YMin' : position.startsWith('Bottom') ? 'YMax' : 'YMid';
  return `${x}${y} meet`;
}

/** How a line standing for no relationship is drawn where it sets nothing of its own. */
export const CONNECTOR_STYLE = { lineColor: '#5f6368', strokeWidth: 1, dashArray: '4 3' } as const;

/** A text's font, as a thing's own look sets it: la-gram's where it sets nothing. */
interface TextFont {
  family: string;
  size: number;
  /** `bold`, `italic`, `underline`. */
  style?: string;
}

/** A font as CSS `font` shorthand, to measure text in — only where it is a look's own, not la-gram's. */
function cssFontOf(font: TextFont): string | undefined {
  if (font.family === NOTATION_DEFAULTS.fontFamily && !font.style) return undefined;
  const italic = hasFontStyle(font.style, 'italic') ? 'italic ' : '';
  const bold = hasFontStyle(font.style, 'bold') ? 'bold ' : '';
  return `${italic}${bold}${font.size}px ${font.family}`;
}

/** The font a look sets, la-gram's where it sets none. */
function fontOf(own: Appearance | undefined): TextFont {
  return {
    family: fontFamilyOf(own?.fontName),
    size: own?.fontSize ?? NOTATION_DEFAULTS.fontSize,
    ...(own?.fontStyle ? { style: own.fontStyle } : {}),
  };
}

/** A font name before la-gram's own, which stands in where it is not installed. */
export function fontFamilyOf(name: string | undefined): string {
  const family = name?.replace(/["\\;{}<>]/g, '').trim();
  return family ? `"${family}", ${NOTATION_DEFAULTS.fontFamily}` : NOTATION_DEFAULTS.fontFamily;
}

/** A `<text>`'s font attributes. */
function fontAttributes(font: TextFont): Record<string, string | number> {
  return {
    'font-size': font.size,
    'font-family': font.family,
    ...(hasFontStyle(font.style, 'bold') ? { 'font-weight': 'bold' } : {}),
    ...(hasFontStyle(font.style, 'italic') ? { 'font-style': 'italic' } : {}),
    ...(hasFontStyle(font.style, 'underline') ? { 'text-decoration': 'underline' } : {}),
  };
}

/** Where a gradient runs, in the body's bounding box: from its colour at a side to white at the opposite one. */
const GRADIENT_VECTORS: Record<Gradient, { x1: number; y1: number; x2: number; y2: number }> = {
  top: { x1: 0, y1: 0, x2: 0, y2: 1 },
  bottom: { x1: 0, y1: 1, x2: 0, y2: 0 },
  left: { x1: 0, y1: 0, x2: 1, y2: 0 },
  right: { x1: 1, y1: 0, x2: 0, y2: 0 },
};

/** A colour as part of an id. */
function colourSlug(colour: string): string {
  return colour.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Put a definition in a shape's own group, so the shape draws as it is
 * wherever it is — on the canvas, exported. Named by what it draws, so two
 * shapes defining the same one define it alike.
 */
function defineIn(group: SVGElement, definition: SVGElement): void {
  const defs = svgEl('defs');
  defs.appendChild(definition);
  group.insertBefore(defs, group.firstChild);
}

/** Shade `body`'s fill from its colour at `side` to white at the opposite side. */
function applyGradient(group: SVGElement, body: SVGElement, side: Gradient): void {
  const fill = body.getAttribute('fill');
  if (!fill || fill === 'none' || fill.startsWith('url(')) return;
  const id = `la-gradient-${side}-${colourSlug(fill)}`;
  const gradient = svgEl('linearGradient', { id, ...GRADIENT_VECTORS[side] });
  gradient.appendChild(svgEl('stop', { offset: 0, 'stop-color': fill }));
  gradient.appendChild(svgEl('stop', { offset: 1, 'stop-color': '#ffffff' }));
  defineIn(group, gradient);
  body.setAttribute('fill', `url(#${id})`);
}

/**
 * Draw a glyph in `colour`: its opaque lines painted so, what shows the fill
 * through it left so — as core-vis's glyphs are drawn (`arch-vis:iconSymbol`).
 */
function colourGlyph(group: SVGElement, glyph: SVGElement, colour: string): void {
  const id = `la-icon-colour-${colourSlug(colour)}`;
  const filter = svgEl('filter', { id, x: 0, y: 0, width: 1, height: 1, 'color-interpolation-filters': 'sRGB' });
  filter.appendChild(svgEl('feFlood', { 'flood-color': colour, result: 'colour' }));
  filter.appendChild(svgEl('feComposite', { in: 'colour', in2: 'SourceAlpha', operator: 'in' }));
  defineIn(group, filter);
  glyph.setAttribute('filter', `url(#${id})`);
}

/** A style drawn as another shape: its shape type, and the notation's own shape when it is one. */
function withShape(style: VisualStyle | undefined, shape: Pick<VisualStyle, 'shapeType' | 'customShape'> | undefined): VisualStyle | undefined {
  if (!shape) return style;
  const { customShape: _drop, ...rest } = style ?? ({} as VisualStyle);
  return { ...rest, ...(shape.shapeType ? { shapeType: shape.shapeType } : {}), ...(shape.customShape ? { customShape: shape.customShape } : {}) } as VisualStyle;
}

/** A notation's style with a thing's own fill, line colour and outline over it. */
function withOwnStyle(notation: VisualStyle | undefined, own: Appearance): VisualStyle {
  return {
    ...(notation ?? {}),
    ...(own.fillColor ? { fillColor: own.fillColor } : {}),
    ...(own.lineColor ? { lineColor: own.lineColor } : {}),
    ...(own.borderStyle ? { borderStyle: own.borderStyle } : {}),
    // Its own picture in place of the notation's glyph — the figure itself when drawn as its icon.
    ...(own.iconSymbol ? { iconSymbol: own.iconSymbol } : {}),
  } as VisualStyle;
}

/** What a figure's colours do not say: a group's tab, a note's fold. */
const FIGURE_STYLE = {
  group: { tab: '#e3e7ea', tabHeight: 20 },
  note: { fold: '#f2e58a' },
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

  /** Where an element is redrawn once a picture drawn in it has loaded. */
  private readonly bus: { fire(event: string, payload: unknown): unknown } | undefined;
  /** What was drawn without its picture, by the picture's address: redrawn once it loads. */
  private waitingForImage = new Map<string, Set<RenderableElement>>();

  constructor(eventBus: unknown, notationStyles: NotationStyleRegistry, renderOptions: RenderOptions) {
    // BaseRenderer's constructor wires the render.* listeners.
    super(eventBus as never, RENDER_PRIORITY);
    this.notationStyles = notationStyles;
    this.renderOptions = renderOptions;
    this.bus = typeof (eventBus as { fire?: unknown })?.fire === 'function' ? (eventBus as RdfRenderer['bus']) : undefined;
  }

  /** This renderer draws every element on an RDF diagram. */
  canRender(): boolean {
    return true;
  }

  // ── Shapes ───────────────────────────────────────────────────────────

  drawShape(parentGfx: SVGElement, element: RenderableElement): SVGElement {
    if (element.businessObject?.kind === 'figure') return this.drawFigure(parentGfx, element);
    const businessObject = element.businessObject;
    const typeIri = businessObject?.typeIri;
    const notation = this.notationStyles.styleFor(typeIri);
    // Its own look in this view over its notation's, over la-gram's.
    const own = this.ownAppearance(businessObject);
    // Drawn as another of its notation's figures, when the placement says so (the Figure tab).
    const style = withShape(own ? withOwnStyle(notation, own) : notation, this.ownShape(businessObject));
    const look: Appearance = { ...lookOf(notation), ...own };
    const font = fontOf(look);

    const width = element.width ?? style?.defaultWidth ?? NOTATION_DEFAULTS.width;
    const height = element.height ?? style?.defaultHeight ?? NOTATION_DEFAULTS.height;
    // What a label expression says, else its name.
    const label =
      businessObject?.labelText ?? businessObject?.label ?? this.notationStyles.labelFor(typeIri) ?? localName(element.id);

    const { href, elementPicture } = this.iconOf(businessObject, style, own);
    // Its own figure, when the placement has one (the Figure tab).
    const mode = this.effectiveMode(typeIri, href, own?.renderingMode);

    const group = svgEl('g');
    group.setAttribute('class', `${RENDER_CLASSES.shape} la-mode-${mode}`);
    if (businessObject?.iri) group.setAttribute('data-element-iri', businessObject.iri);
    if (typeIri) group.setAttribute('data-type-iri', typeIri);
    group.setAttribute('data-rendering-mode', mode);

    // The icon colour is the notation's glyph's: a placement's own picture, or its element's, is drawn as it is.
    const iconColor = own?.iconSymbol || elementPicture ? undefined : look.iconColor;
    if (mode === 'IconCentric') {
      this.drawImage(group, element, look, { x: 0, y: 0, width, height });
      const icon = this.drawIconCentric(group, width, height, label, href as string, look.fontColor, font);
      if (own?.iconSymbol) icon.setAttribute('data-own-icon', 'true');
      if (elementPicture) icon.setAttribute('data-element-picture', 'true');
      if (iconColor) colourGlyph(group, icon, iconColor);
    } else {
      const body = this.drawShapeBody(group, style, width, height, look.lineWidth);
      if (look.gradient) applyGradient(group, body, look.gradient);
      // Its own text colour, else the notation's — not a line colour of its own.
      const color = look.fontColor ?? notation?.lineColor ?? NOTATION_DEFAULTS.lineColor;
      if (!labelFitsInside(width, height)) {
        // A junction: no room for a badge, and its name, if it has one, under it.
        if (businessObject?.named) this.appendLabel(group, label, { x: 0, y: 0, width, height }, { outside: true, color, font });
        parentGfx.appendChild(group);
        return group;
      }
      this.drawImage(group, element, look, insetBox(width, height));
      const layout = containerLayout(shapeLayout(style?.customShape ?? style?.shapeType, width, height), element);
      // Present exactly when a badge is drawn — ShapeOnly reserves no room.
      const badgePlacement =
        mode === 'ShapeWithBadge' && href ? (style?.iconPlacement ?? 'TopRight') : undefined;
      if (badgePlacement && href) {
        const badge = this.drawBadge(group, href, badgePlacement, layout.content);
        if (iconColor) colourGlyph(group, badge, iconColor);
      }
      this.appendLabel(group, label, layout.label, {
        // The label makes room for the badge only when the two share a box.
        badgePlacement: layout.label === layout.content || layout.labelBesideBadge ? badgePlacement : undefined,
        maxLines: layout.maxLabelLines,
        // The label's own colour, else the line colour, as the vocabulary says.
        color,
        font,
        ...(look.textAlignment ? { align: look.textAlignment } : {}),
        ...(look.textPosition ? { position: look.textPosition } : {}),
      });
    }

    parentGfx.appendChild(group);
    return group;
  }

  /**
   * A figure: drawing only, no model element behind it.
   *
   * - a group: a box with its name in a tab at its top left;
   * - a shape: its core-vis shape type, its text in the middle — or, holding
   *   something, at its top, as an element's name is;
   * - a note: a sticky note, folded at its top right, its text from the top left.
   */
  private drawFigure(parentGfx: SVGElement, element: RenderableElement): SVGElement {
    const businessObject = element.businessObject!;
    const figure = businessObject.figure ?? { kind: 'shape' };
    const width = element.width ?? NOTATION_DEFAULTS.width;
    const height = element.height ?? NOTATION_DEFAULTS.height;
    const text = businessObject.label ?? '';
    // Its own colours, else its kind's; its own line and font.
    const colours = figureColours(figure);
    const font = fontOf(figure);
    const dash = strokeDashArray(figure.borderStyle);
    const outline = {
      stroke: colours.lineColor,
      'stroke-width': figure.lineWidth ?? NOTATION_DEFAULTS.strokeWidth,
      ...(dash ? { 'stroke-dasharray': dash } : {}),
    };
    const group = svgEl('g');
    group.setAttribute('class', `${RENDER_CLASSES.shape} ${RENDER_CLASSES.figure} ${RENDER_CLASSES.figure}-${figure.kind}`);
    if (businessObject.iri) group.setAttribute('data-element-iri', businessObject.iri);
    group.setAttribute('data-figure', figure.kind);

    if (figure.kind === 'group') {
      const tabWidth = Math.min(width, Math.max(60, textWidth(text) + 16));
      const tabHeight = Math.min(FIGURE_STYLE.group.tabHeight, height);
      // The tab its own grey, unless the group is given a colour.
      const tabFill = figure.fillColor ?? FIGURE_STYLE.group.tab;
      const tab = svgEl('rect', { x: 0, y: 0, width: tabWidth, height: tabHeight, fill: tabFill, ...outline });
      tab.setAttribute('class', RENDER_CLASSES.details);
      group.appendChild(tab);
      const body = svgEl('rect', { x: 0, y: tabHeight, width, height: Math.max(0, height - tabHeight), fill: colours.fillColor, ...outline });
      body.setAttribute('class', RENDER_CLASSES.body);
      group.appendChild(body);
      if (figure.gradient) applyGradient(group, body, figure.gradient);
      const below = insetBox(width, Math.max(0, height - tabHeight));
      this.drawImage(group, element, figure, { ...below, y: below.y + tabHeight });
      this.appendFigureText(group, text, { x: 6, y: 0, width: tabWidth - 8, height: tabHeight }, 1, colours.fontColor, font);
    } else if (figure.kind === 'note') {
      const fold = Math.min(14, width / 4, height / 4);
      const body = svgEl('path', {
        d: `M0,0 H${round2(width - fold)} L${round2(width)},${round2(fold)} V${round2(height)} H0 Z`,
        fill: colours.fillColor,
        ...outline,
      });
      body.setAttribute('class', RENDER_CLASSES.body);
      group.appendChild(body);
      if (figure.gradient) applyGradient(group, body, figure.gradient);
      // The fold a shade of the note: its own yellow, or the colour given, darkened.
      const corner = svgEl('path', {
        d: `M${round2(width - fold)},0 V${round2(fold)} H${round2(width)} Z`,
        fill: figure.fillColor ?? FIGURE_STYLE.note.fold,
        ...outline,
      });
      corner.setAttribute('class', RENDER_CLASSES.details);
      group.appendChild(corner);
      if (figure.fillColor) {
        const shade = svgEl('path', { d: `M${round2(width - fold)},0 V${round2(fold)} H${round2(width)} Z`, fill: '#000000', 'fill-opacity': 0.12, stroke: 'none' });
        group.appendChild(shade);
      }
      this.drawImage(group, element, figure, insetBox(width, height));
      const lineHeight = Math.round(font.size * 1.2);
      // From its top left, unless it says otherwise.
      this.appendFigureText(
        group,
        text,
        { x: 6, y: 4, width: width - 12 - fold / 2, height: height - 8 },
        Math.max(1, Math.floor((height - 8) / lineHeight)),
        colours.fontColor,
        font,
        figure.textAlignment ?? 'left',
        figure.textPosition ?? 'top',
      );
    } else {
      const shapeType = figureShapeType(figure);
      const body = this.drawShapeBody(
        group,
        { shapeType, fillColor: colours.fillColor, lineColor: colours.lineColor, ...(figure.borderStyle ? { borderStyle: figure.borderStyle } : {}) } as VisualStyle,
        width,
        height,
        figure.lineWidth,
      );
      if (figure.gradient) applyGradient(group, body, figure.gradient);
      this.drawImage(group, element, figure, insetBox(width, height));
      const layout = containerLayout(shapeLayout(shapeType, width, height), element);
      this.appendLabel(group, text, layout.label, {
        color: colours.fontColor,
        font,
        ...(layout.maxLabelLines ? { maxLines: layout.maxLabelLines } : {}),
        ...(figure.textAlignment ? { align: figure.textAlignment } : {}),
        ...(figure.textPosition ? { position: figure.textPosition } : {}),
      });
    }
    parentGfx.appendChild(group);
    return group;
  }

  /**
   * A node's picture (`arch-vis:image`), over its fill and under its text and
   * glyph: in `area` at its position, at its own size made smaller to fit, or
   * filling it. A picture whose size is not known yet is drawn once it has
   * loaded (the element redrawn); one that does not load, not at all.
   */
  private drawImage(group: SVGElement, element: RenderableElement, look: Pick<Appearance, 'image' | 'imagePosition'>, area: Box): void {
    const href = imageUri(look.image);
    if (!href || area.width <= 0 || area.height <= 0) return;
    const position = look.imagePosition ?? 'TopLeft';
    let size: { width: number; height: number } | undefined;
    if (position !== 'Fill') {
      const known = this.imageSizeOf(href, element);
      if (!known) return;
      size = known;
    }
    const box = imageBox(area, position, size);
    const image = svgEl('image', { ...box, href, preserveAspectRatio: imageAlignment(position) });
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    image.setAttribute('class', RENDER_CLASSES.image);
    image.setAttribute('data-image-position', position);
    image.setAttribute('pointer-events', 'none');
    group.appendChild(image);
  }

  /** A picture's own size when known; else it is loaded, and `element` redrawn when it has. */
  private imageSizeOf(href: string, element: RenderableElement): { width: number; height: number } | undefined {
    const known = imageSizes.get(href);
    if (known && known !== 'loading') return known;
    if (known === null) return undefined;
    const waiting = this.waitingForImage.get(href) ?? new Set<RenderableElement>();
    waiting.add(element);
    this.waitingForImage.set(href, waiting);
    if (known === 'loading' || typeof Image === 'undefined') return undefined;
    imageSizes.set(href, 'loading');
    const picture = new Image();
    const done = (size: { width: number; height: number } | null) => {
      imageSizes.set(href, size);
      const drawn = this.waitingForImage.get(href) ?? new Set();
      this.waitingForImage.delete(href);
      if (size) for (const each of drawn) this.bus?.fire('element.changed', { element: each });
    };
    picture.onload = () => done({ width: picture.naturalWidth, height: picture.naturalHeight });
    picture.onerror = () => done(null);
    picture.src = href;
    return undefined;
  }

  /**
   * A figure's text in `area`, wrapped to it, on at most `maxLines`: from its
   * top left unless `align` and `position` say otherwise; one line alone — a
   * group's tab — centred down it.
   */
  private appendFigureText(
    group: SVGElement,
    text: string,
    area: Box,
    maxLines: number,
    color: string,
    font: TextFont,
    align: TextAlignment = 'left',
    position: TextPosition = 'top',
  ): void {
    const lines = text === '' ? [] : wrapLabel(text, Math.max(0, area.width), font.size, maxLines, cssFontOf(font));
    if (lines.length === 0) return;
    const lineHeight = Math.round(font.size * 1.2);
    const block = lines.length * lineHeight;
    const top =
      position === 'middle' ? area.y + (area.height - block) / 2 : position === 'bottom' ? area.y + area.height - block : area.y;
    const y = lines.length === 1 && maxLines === 1 ? area.y + (area.height + font.size * 0.7) / 2 : top + font.size;
    const x = align === 'center' ? area.x + area.width / 2 : align === 'right' ? area.x + area.width : area.x;
    const element = svgEl('text', {
      x: round2(x),
      y: round2(y),
      ...(align === 'left' ? {} : { 'text-anchor': align === 'center' ? 'middle' : 'end' }),
      ...fontAttributes(font),
      fill: color,
    });
    element.setAttribute('class', RENDER_CLASSES.label);
    lines.forEach((line, index) => {
      const span = svgEl('tspan', { x: round2(x), dy: index === 0 ? 0 : lineHeight });
      span.textContent = line;
      element.appendChild(span);
    });
    group.appendChild(element);
  }

  /** The shape a placement's own style draws it as — one its notation offers — or none. */
  private ownShape(businessObject: RdfBusinessObject | undefined): Pick<VisualStyle, 'shapeType' | 'customShape'> | undefined {
    const iri = this.ownAppearance(businessObject)?.shapeType;
    return iri && businessObject?.kind === 'element' ? this.notationStyles.shapeFor(businessObject.typeIri, iri) : undefined;
  }

  /** A thing's own look, drawn — unless the canvas draws the notation alone. */
  private ownAppearance(businessObject: RdfBusinessObject | undefined): Appearance | undefined {
    return this.renderOptions.notationOnly ? undefined : businessObject?.appearance;
  }

  /**
   * The mode actually used, given whether the badge glyph can be drawn.
   *
   * `effectiveRenderingMode` (through the registry) has already downgraded a
   * style with no `iconSymbol` at all. This adds the case the guide does not
   * cover: a declared icon whose URI is unusable.
   */
  private effectiveMode(typeIri: string | undefined, href: string | null, own?: RenderingMode): RenderingMode {
    const declared = own ?? this.notationStyles.renderingModeFor(typeIri);
    if (declared === 'ShapeOnly') return 'ShapeOnly';
    return href ? declared : 'ShapeOnly';
  }

  /**
   * The look a shape or a line is drawn with — its own over its notation's,
   * as the canvas draws it now — for what types on it (the in-place editor):
   * a figure's own, its text from a note's top left, a group's in its tab.
   */
  drawnLook(element: RenderableElement): Appearance {
    const businessObject = element.businessObject;
    if (businessObject?.kind === 'figure') {
      const figure = businessObject.figure;
      const placed: Appearance =
        figure?.kind === 'note'
          ? { textAlignment: 'left', textPosition: 'top' }
          : figure?.kind === 'group'
            ? { textAlignment: 'left', textPosition: 'top' }
            : {};
      return { ...placed, ...lookOf(figure) };
    }
    // A line from a note has no notation: its own look, always.
    if (businessObject?.kind === 'connector') return { ...businessObject.appearance };
    const own = this.ownAppearance(businessObject);
    if (businessObject?.kind === 'relationship') {
      return { ...lookOf(this.notationStyles.relationshipStyleFor(businessObject.typeIri)), ...own };
    }
    return { ...lookOf(this.notationStyles.styleFor(businessObject?.typeIri)), ...own };
  }

  /** The figure an element's shape is drawn as now: its own, else its notation's, as far as its glyph allows. */
  drawnMode(element: RenderableElement): RenderingMode {
    const typeIri = element.businessObject?.typeIri;
    const own = this.ownAppearance(element.businessObject);
    const notation = this.notationStyles.styleFor(typeIri);
    const { href } = this.iconOf(element.businessObject, own ? withOwnStyle(notation, own) : notation, own);
    return this.effectiveMode(typeIri, href, own?.renderingMode);
  }

  /**
   * The icon a shape is drawn with: its own (`arch-vis:iconSymbol`, already on
   * `style`) — else, where it is drawn as its icon, its element's picture for
   * the presentation shown (core-vis 0.7's `arch-vis:IconCentric`) — else its
   * notation's glyph. In box-with-badge mode the badge stays the glyph: it
   * says the element's type.
   */
  private iconOf(
    businessObject: RdfBusinessObject | undefined,
    style: VisualStyle | undefined,
    own: Appearance | undefined,
  ): { href: string | null; elementPicture: boolean } {
    const picture = businessObject?.elementPicture;
    if (!own?.iconSymbol && picture) {
      const declared = own?.renderingMode ?? this.notationStyles.renderingModeFor(businessObject?.typeIri);
      if (declared === 'IconCentric') return { href: picture, elementPicture: true };
    }
    return { href: iconHref(style?.iconSymbol, assetUrl), elementPicture: false };
  }

  /** The filled, stroked `shapeType` body, and its inner lines over it. */
  private drawShapeBody(
    group: SVGElement,
    style: VisualStyle | undefined,
    width: number,
    height: number,
    lineWidth: number = NOTATION_DEFAULTS.strokeWidth,
  ): SVGElement {
    const geometry = shapeGeometry(style?.customShape ?? style?.shapeType, width, height);
    const lineColor = style?.lineColor ?? NOTATION_DEFAULTS.lineColor;
    const dash = strokeDashArray(style?.borderStyle);
    const stroke = (element: SVGElement) => {
      element.setAttribute('stroke', lineColor);
      element.setAttribute('stroke-width', String(lineWidth));
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
    font: TextFont = fontOf(undefined),
  ): SVGElement {
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
      font,
    });
    return icon;
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
      font?: TextFont;
      align?: TextAlignment;
      position?: TextPosition;
    },
  ): SVGElement | null {
    const font = options.font ?? fontOf(undefined);
    const local = labelLayout(label, area.width, area.height, {
      badgePlacement: options.badgePlacement,
      below: options.below,
      outside: options.outside,
      maxLines: options.maxLines,
      fontSize: font.size,
      ...(cssFontOf(font) ? { font: cssFontOf(font) } : {}),
      ...(options.align ? { align: options.align } : {}),
      ...(options.position ? { position: options.position } : {}),
    });
    if (local.lines.length === 0) return null;
    const layout = { ...local, x: offset(area.x, local.x), y: offset(area.y, local.y) };

    const text = svgEl('text', {
      x: layout.x,
      y: layout.y,
      'text-anchor': layout.anchor ?? 'middle',
      ...fontAttributes(font),
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
    if (businessObject?.kind === 'connector') return this.drawConnector(parentGfx, connection);
    const style: RelationshipVisualStyle | undefined = this.notationStyles.relationshipStyleFor(
      businessObject?.typeIri,
    );
    // Its own colour, width and font in this view over its notation's; its style — what it means — the notation's.
    const own = this.ownAppearance(businessObject);
    const look: Appearance = { ...lookOf(style), ...own };
    const lineColor = look.lineColor ?? NOTATION_DEFAULTS.lineColor;
    const waypoints = connection.waypoints ?? [];

    const line = svgEl('polyline', {
      points: waypoints.map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke: lineColor,
      'stroke-width': look.lineWidth ?? NOTATION_DEFAULTS.strokeWidth,
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
    const label = drawnConnectionLabel(connection, this.renderOptions, style);
    if (label) this.drawConnectionLabel(parentGfx, label, look.fontColor ?? lineColor, opacity, { ...fontOf(look), size: label.fontSize });
    return line;
  }

  /**
   * A line standing for no relationship — a note's, to what it is about: thin,
   * dashed, grey, no ends drawn, so it is not read as a relationship (an
   * association is solid).
   */
  private drawConnector(parentGfx: SVGElement, connection: RenderableElement): SVGElement {
    // Drawing only, no notation: its own look always — dashed, no ends, where it sets none.
    const own = connection.businessObject?.appearance;
    const lineColor = own?.lineColor ?? CONNECTOR_STYLE.lineColor;
    const lineStyle = own?.lineStyle ?? 'DashedLine';
    const dash = lineStyle === 'DashedLine' ? CONNECTOR_STYLE.dashArray : strokeDashArray(lineStyle);
    const line = svgEl('polyline', {
      points: (connection.waypoints ?? []).map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke: lineColor,
      'stroke-width': own?.lineWidth ?? CONNECTOR_STYLE.strokeWidth,
      ...(dash ? { 'stroke-dasharray': dash } : {}),
      'stroke-linejoin': 'round',
    });
    line.setAttribute('class', `${RENDER_CLASSES.connection} ${RENDER_CLASSES.connector}`);
    line.setAttribute('data-line-style', lineStyle);
    if (connection.businessObject?.iri) line.setAttribute('data-link-iri', connection.businessObject.iri);
    // Its ends as it says: an arrowhead, a diamond, a dot — as a relationship's are drawn.
    this.applyDecoration(parentGfx, line, own?.sourceDecor, 'source', lineColor);
    this.applyDecoration(parentGfx, line, own?.targetDecor, 'target', lineColor);
    parentGfx.appendChild(line);
    // What it says, at its middle — or where it was moved to — as a relationship's name is drawn.
    const label = drawnConnectionLabel(connection, this.renderOptions);
    if (label) this.drawConnectionLabel(parentGfx, label, own?.fontColor ?? lineColor, undefined, { ...fontOf(own), size: label.fontSize });
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
    font: TextFont = fontOf(undefined),
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
      ...fontAttributes(font),
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
    const figure = shape.businessObject?.kind === 'figure' ? shape.businessObject.figure : undefined;
    if (figure) {
      const outline = figure.kind === 'shape' ? figureShapeType(figure) : 'Rectangle';
      return shapePath(outline, (shape['x'] as number) ?? 0, (shape['y'] as number) ?? 0, shape.width ?? NOTATION_DEFAULTS.width, shape.height ?? NOTATION_DEFAULTS.height);
    }
    const typeIri = shape.businessObject?.typeIri;
    // Asked for once a link end — four times a shape when a view is drawn
    // (Task 22) — so kept until the shape moves, resizes, is retyped or the
    // notation changes.
    const ownMode = this.ownAppearance(shape.businessObject)?.renderingMode;
    const ownShapeIri = this.ownAppearance(shape.businessObject)?.shapeType;
    const ownIcon = this.ownAppearance(shape.businessObject)?.iconSymbol;
    const picture = shape.businessObject?.elementPicture;
    const stamp = `${shape['x']},${shape['y']},${shape.width},${shape.height},${typeIri},${ownMode ?? ''},${ownShapeIri ?? ''},${ownIcon ? 'own-icon' : ''},${picture ? 'picture' : ''},${this.notationStyles.version}`;
    const known = this.shapePaths.get(shape);
    if (known?.stamp === stamp) return known.path;

    // The outline drawn: its own figure's, when it has one.
    const style = withShape(this.notationStyles.styleFor(typeIri), this.ownShape(shape.businessObject));

    const x = (shape['x'] as number) ?? 0;
    const y = (shape['y'] as number) ?? 0;
    const width = shape.width ?? style?.defaultWidth ?? NOTATION_DEFAULTS.width;
    const height = shape.height ?? style?.defaultHeight ?? NOTATION_DEFAULTS.height;

    const ownLook = this.ownAppearance(shape.businessObject);
    const { href } = this.iconOf(shape.businessObject, ownIcon ? { ...style, iconSymbol: ownIcon } : style, ownLook);
    const mode = this.effectiveMode(typeIri, href, ownMode);
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
/** A shape figure's core-vis shape type, by its local name — `arch-vis:Ellipse` is `Ellipse`; a rectangle without one. */
function figureShapeType(figure: FigureInfo): ShapeType {
  const name = figure.shapeType ? localName(figure.shapeType) : 'Rectangle';
  return (SHAPE_TYPES as readonly string[]).includes(name) ? (name as ShapeType) : 'Rectangle';
}

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
  const band = Math.min(layout.content.height, containerNameBand(NOTATION_DEFAULTS.fontSize, NOTATION_DEFAULTS.badgePadding));
  return { ...layout, label: { ...layout.content, height: band }, maxLabelLines: 2, labelBesideBadge: true };
}
