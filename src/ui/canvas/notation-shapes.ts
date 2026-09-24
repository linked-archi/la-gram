/**
 * SVG geometry for the `arch-vis:` visual notation vocabulary.
 *
 * Everything here is pure: it turns a {@link ShapeType}, {@link IconPlacement},
 * {@link LineStyle} or {@link Decoration} into SVG elements and attributes, and
 * knows nothing about diagram-js, the RDF store or the element registry.
 * `rdf-renderer.ts` composes these into the three rendering modes.
 *
 * Two deliberate choices:
 *
 * - **Real polygons, not degraded rectangles.** `Octagon`, `Hexagon`, `Diamond`
 *   and `Parallelogram` are `<polygon>` elements with computed points. diagram-js
 *   hands the renderer direct SVG control, so there is no reason to approximate.
 *   {@link shapePath} emits the same eight outlines as SVG path strings, which is
 *   what connection docking crops against — one geometry, two encodings, so a
 *   line always meets the shape where it is actually drawn.
 * - **No measurement.** Label layout is computed from a character-width estimate
 *   rather than `getComputedTextLength`, so it is deterministic and behaves the
 *   same under jsdom as in a browser. The cost is that very wide glyphs can
 *   overflow slightly; the benefit is that rendering never depends on layout
 *   having happened.
 */

import type {
  Decoration,
  IconPlacement,
  LineStyle,
  ShapeType,
} from '../../metamodel-manager/notation.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fallbacks for style properties the notation data may leave out. */
export const NOTATION_DEFAULTS = {
  /** `arch-vis:shapeType` absent → a plain rectangle, ArchiMate's base shape. */
  shapeType: 'Rectangle' as ShapeType,
  fillColor: '#FFFFFF',
  lineColor: '#000000',
  /** `arch-vis:defaultWidth` / `defaultHeight` absent. */
  width: 120,
  height: 55,
  strokeWidth: 1,
  fontSize: 11,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  /** Badge edge length. The guide asks for 16–24px. */
  badgeSize: 20,
  /** Gap between the badge and the shape edge. */
  badgePadding: 4,
  /** Corner radius used for `RoundedRectangle`. */
  cornerRadius: 10,
  /** Height reserved under an `IconCentric` icon for its label. */
  iconCentricLabelBand: 16,
  /** Maximum label lines before the rest is dropped. */
  maxLabelLines: 3,
} as const;

/** Attributes to put on an SVG element, already stringifiable. */
export type SvgAttrs = Record<string, string | number>;

/** Create an SVG element in the SVG namespace and apply attributes. */
export function svgEl(tag: string, attrs: SvgAttrs = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }
  return el;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The SVG element kind and attributes that draw a given {@link ShapeType}. */
export interface ShapeGeometry {
  tag: 'rect' | 'ellipse' | 'circle' | 'polygon';
  attrs: SvgAttrs;
}

/** Clamp to a sane, non-negative size. */
function size(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Format a polygon point list. */
function points(pairs: Array<[number, number]>): string {
  return pairs.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A vertex list in shape-local coordinates, or `null` for a non-polygon. */
type Vertices = Array<[number, number]>;

/**
 * Vertices of the polygonal shape types, in shape-local coordinates.
 *
 * The single source of the polygon geometry: {@link shapeGeometry} formats these
 * into a `<polygon points>` attribute and {@link shapePath} into an SVG path, so
 * the drawn outline and the outline connections dock against cannot drift apart.
 */
function polygonVertices(type: ShapeType, w: number, h: number): Vertices | null {
  switch (type) {
    case 'Octagon': {
      // Corner cut, capped so the cuts never meet in the middle.
      const c = Math.min(Math.min(w, h) * 0.25, w / 2, h / 2);
      return [
        [c, 0],
        [w - c, 0],
        [w, c],
        [w, h - c],
        [w - c, h],
        [c, h],
        [0, h - c],
        [0, c],
      ];
    }

    case 'Hexagon': {
      // Points left and right at mid-height, flat top and bottom.
      const c = Math.min(w * 0.25, w / 2);
      return [
        [c, 0],
        [w - c, 0],
        [w, h / 2],
        [w - c, h],
        [c, h],
        [0, h / 2],
      ];
    }

    case 'Diamond':
      return [
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ];

    case 'Parallelogram': {
      const skew = Math.min(w * 0.2, w / 2);
      return [
        [skew, 0],
        [w, 0],
        [w - skew, h],
        [0, h],
      ];
    }

    default:
      return null;
  }
}

/**
 * Geometry for a shape of the given type at `width` × `height`.
 *
 * An unknown or absent `shapeType` falls back to
 * {@link NOTATION_DEFAULTS.shapeType}. `Circle` is a true circle — its radius
 * is half the *smaller* dimension, so it stays inside the declared bounds
 * rather than being squashed into an ellipse.
 */
export function shapeGeometry(
  shapeType: ShapeType | undefined,
  width: number,
  height: number,
): ShapeGeometry {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);
  const type = shapeType ?? NOTATION_DEFAULTS.shapeType;

  const vertices = polygonVertices(type, w, h);
  if (vertices) return { tag: 'polygon', attrs: { points: points(vertices) } };

  switch (type) {
    case 'RoundedRectangle': {
      const r = cornerRadius(w, h);
      return { tag: 'rect', attrs: { x: 0, y: 0, width: w, height: h, rx: round(r), ry: round(r) } };
    }

    case 'Ellipse':
      return {
        tag: 'ellipse',
        attrs: { cx: round(w / 2), cy: round(h / 2), rx: round(w / 2), ry: round(h / 2) },
      };

    case 'Circle':
      return {
        tag: 'circle',
        attrs: { cx: round(w / 2), cy: round(h / 2), r: round(Math.min(w, h) / 2) },
      };

    case 'Rectangle':
    default:
      return { tag: 'rect', attrs: { x: 0, y: 0, width: w, height: h } };
  }
}

/** Corner radius actually used for `RoundedRectangle` at this size. */
function cornerRadius(w: number, h: number): number {
  return Math.min(NOTATION_DEFAULTS.cornerRadius, w / 2, h / 2);
}

/**
 * SVG path outlining a shape of the given type, in **absolute** coordinates.
 *
 * The counterpart to {@link shapeGeometry}: same eight shapes, same geometry,
 * expressed as a `d` attribute rather than as element attributes, and offset by
 * the shape's position on the diagram instead of drawn shape-local. This is what
 * connection cropping needs — diagram-js hands the shape's path and the
 * connection's path to `path-intersection` and docks the line where they meet,
 * so a path that did not match the drawn outline would dock in mid-air.
 *
 * ## Curves
 *
 * `Ellipse`, `Circle` and the rounded corners of `RoundedRectangle` are emitted
 * as **elliptical arcs** (`A`), not beziers. `path-intersection` normalises
 * every path through `pathToCurve`, whose `case 'A'` runs `arcToCurve` — arcs are
 * converted to cubic segments *exactly*, in one place, by the library itself.
 * Approximating them here with beziers would add our own error on top of that
 * conversion for no gain, and would not match `<ellipse>`/`<circle>`, which the
 * renderer draws as true conics.
 *
 * An ellipse needs two arcs rather than one: a single arc whose end point equals
 * its start point is degenerate and SVG renders nothing, so the outline is split
 * at the left and right extremes into two half-sweeps.
 */
export function shapePath(
  shapeType: ShapeType | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  const type = shapeType ?? NOTATION_DEFAULTS.shapeType;

  const vertices = polygonVertices(type, w, h);
  if (vertices) {
    // Every vertex list above has at least three entries, so `M` always has one.
    const absolute = vertices.map(([vx, vy]) => `${round(left + vx)},${round(top + vy)}`);
    return `M${absolute[0]}${absolute.slice(1).map((p) => `L${p}`).join('')}Z`;
  }

  switch (type) {
    case 'RoundedRectangle': {
      const r = round(cornerRadius(w, h));
      const x0 = round(left);
      const y0 = round(top);
      const x1 = round(left + w);
      const y1 = round(top + h);
      return (
        `M${round(x0 + r)},${y0}` +
        `L${round(x1 - r)},${y0}A${r},${r} 0 0 1 ${x1},${round(y0 + r)}` +
        `L${x1},${round(y1 - r)}A${r},${r} 0 0 1 ${round(x1 - r)},${y1}` +
        `L${round(x0 + r)},${y1}A${r},${r} 0 0 1 ${x0},${round(y1 - r)}` +
        `L${x0},${round(y0 + r)}A${r},${r} 0 0 1 ${round(x0 + r)},${y0}Z`
      );
    }

    case 'Ellipse':
      return arcOutline(left + w / 2, top + h / 2, w / 2, h / 2);

    case 'Circle': {
      const r = Math.min(w, h) / 2;
      return arcOutline(left + w / 2, top + h / 2, r, r);
    }

    case 'Rectangle':
    default: {
      const x0 = round(left);
      const y0 = round(top);
      const x1 = round(left + w);
      const y1 = round(top + h);
      return `M${x0},${y0}L${x1},${y0}L${x1},${y1}L${x0},${y1}Z`;
    }
  }
}

/** Closed outline of an ellipse centred at (`cx`, `cy`), as two half arcs. */
function arcOutline(cx: number, cy: number, rx: number, ry: number): string {
  const left = round(cx - rx);
  const right = round(cx + rx);
  const mid = round(cy);
  const rrx = round(rx);
  const rry = round(ry);
  return (
    `M${left},${mid}` +
    `A${rrx},${rry} 0 0 1 ${right},${mid}` +
    `A${rrx},${rry} 0 0 1 ${left},${mid}Z`
  );
}

/** Every {@link ShapeType} this module draws — the full vocabulary. */
export const SHAPE_TYPES: readonly ShapeType[] = [
  'Rectangle',
  'RoundedRectangle',
  'Octagon',
  'Ellipse',
  'Circle',
  'Hexagon',
  'Diamond',
  'Parallelogram',
];

// ---------------------------------------------------------------------------
// Icon placement
// ---------------------------------------------------------------------------

/** Top-left corner and edge length of a badge inside a shape. */
export interface BadgeBox {
  x: number;
  y: number;
  size: number;
}

/** Every {@link IconPlacement} this module positions. */
export const ICON_PLACEMENTS: readonly IconPlacement[] = [
  'TopRight',
  'TopLeft',
  'TopCenter',
  'Center',
  'BottomCenter',
];

/**
 * Where the badge sits for a given placement.
 *
 * An absent placement is `TopRight` — the same fallback `notation.ts` applies
 * when `arch-vis:iconSymbol` is present without `arch-vis:iconPlacement`.
 */
export function badgeBox(
  placement: IconPlacement | undefined,
  width: number,
  height: number,
  badgeSize: number = NOTATION_DEFAULTS.badgeSize,
): BadgeBox {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);
  const b = Math.min(badgeSize, w, h);
  const pad = NOTATION_DEFAULTS.badgePadding;
  const centreX = round((w - b) / 2);

  switch (placement ?? 'TopRight') {
    case 'TopLeft':
      return { x: pad, y: pad, size: b };
    case 'TopCenter':
      return { x: centreX, y: pad, size: b };
    case 'Center':
      return { x: centreX, y: round((h - b) / 2), size: b };
    case 'BottomCenter':
      return { x: centreX, y: round(h - b - pad), size: b };
    case 'TopRight':
    default:
      return { x: round(w - b - pad), y: pad, size: b };
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** A laid-out label: lines plus the baseline of the first one. */
export interface LabelLayout {
  lines: string[];
  /** Horizontal anchor (always the shape's centre line). */
  x: number;
  /** Baseline y of the first line. */
  y: number;
  lineHeight: number;
}

/**
 * Split a label into lines that plausibly fit `availableWidth`.
 *
 * Uses a fixed 0.55em-per-character estimate rather than measuring, so the
 * result is deterministic. Words longer than a line are hard-broken.
 */
export function wrapLabel(
  label: string,
  availableWidth: number,
  fontSize: number = NOTATION_DEFAULTS.fontSize,
  maxLines: number = NOTATION_DEFAULTS.maxLabelLines,
): string[] {
  const text = label.trim();
  if (text === '') return [];

  const perChar = fontSize * 0.55;
  const budget = Math.max(3, Math.floor(availableWidth / perChar));
  if (text.length <= budget) return [text];

  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/)) {
    let remaining = word;
    // Hard-break a word that cannot fit on a line of its own.
    while (remaining.length > budget) {
      if (current !== '') {
        lines.push(current);
        current = '';
      }
      lines.push(remaining.slice(0, budget));
      remaining = remaining.slice(budget);
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
    }
    const candidate = current === '' ? remaining : `${current} ${remaining}`;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      lines.push(current);
      current = remaining;
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
    }
  }

  if (current !== '') lines.push(current);
  return lines.slice(0, maxLines);
}

/**
 * Vertical band the label occupies, given the badge that shares the shape.
 *
 * `ShapeWithBadge` centres the label, except where the badge would sit on top
 * of it: a `Center` badge pushes the label to the lower half, a `BottomCenter`
 * badge pushes it to the upper half. `ShapeOnly` always centres.
 */
export function labelLayout(
  label: string,
  width: number,
  height: number,
  options: {
    /**
     * Where the badge sits — present exactly when a badge is drawn, so it
     * doubles as the "reserve room for a badge" flag.
     */
    badgePlacement?: IconPlacement;
    fontSize?: number;
    /** Reserve the bottom band and put the label in it (IconCentric). */
    below?: boolean;
  } = {},
): LabelLayout {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);
  const fontSize = options.fontSize ?? NOTATION_DEFAULTS.fontSize;
  const lineHeight = round(fontSize * 1.2);
  const pad = NOTATION_DEFAULTS.badgePadding;

  // With a badge in a corner, give up its width so the two do not overlap.
  const available = options.below
    ? w
    : options.badgePlacement
      ? Math.max(w - NOTATION_DEFAULTS.badgeSize - 2 * pad, w * 0.5)
      : Math.max(w - 2 * pad, w * 0.5);
  const lines = wrapLabel(label, available, fontSize);
  const block = lines.length * lineHeight;

  let centreY: number;
  if (options.below) {
    // Sits in the reserved band under the icon.
    centreY = h - NOTATION_DEFAULTS.iconCentricLabelBand / 2;
  } else if (options.badgePlacement === 'Center') {
    centreY = h - pad - block / 2;
  } else if (options.badgePlacement === 'BottomCenter') {
    centreY = pad + block / 2;
  } else {
    centreY = h / 2;
  }

  // Baseline of the first line: shift the block up by half its height, then
  // down by the ascent of one line.
  const y = round(centreY - block / 2 + fontSize * 0.85);
  return { lines, x: round(w / 2), y, lineHeight };
}

// ---------------------------------------------------------------------------
// Icon hrefs
// ---------------------------------------------------------------------------

/** Values that can be used directly as an `<image href>`. */
const DIRECT_HREF_PREFIXES = ['https://', 'http://', 'data:', '/', './', '../'];

/**
 * Turn an `arch-vis:iconSymbol` value into an `<image href>`, or `null` when it
 * cannot be drawn.
 *
 * `PaletteGenerator` hands renderers the *resolved* icon URL: an
 * asset-root-relative path such as `archimate4/icons/glyphs/actor.svg` when the
 * bundle ships the file, and otherwise the published `https://meta.linked.archi/`
 * URI unchanged. Both are usable; anything else (an empty string, a `urn:` or
 * other non-fetchable scheme) is not, and returning `null` is what makes the
 * renderer degrade to `ShapeOnly` instead of emitting a broken badge.
 *
 * @param resolveAssetUrl Maps an asset-root-relative path to a URL. Injected so
 *   this stays pure and testable.
 */
export function iconHref(
  iconSymbol: string | undefined,
  resolveAssetUrl: (assetPath: string) => string,
): string | null {
  const value = iconSymbol?.trim();
  if (!value) return null;

  if (DIRECT_HREF_PREFIXES.some((prefix) => value.startsWith(prefix))) return value;

  // Any other explicit scheme cannot be loaded as an image.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;

  return resolveAssetUrl(value);
}

// ---------------------------------------------------------------------------
// Relationship lines
// ---------------------------------------------------------------------------

/**
 * `stroke-dasharray` for a line style, or `null` for a solid line.
 *
 * An absent `lineStyle` is solid — the ArchiMate default.
 */
export function strokeDashArray(lineStyle: LineStyle | undefined): string | null {
  switch (lineStyle) {
    case 'DashedLine':
      return '8 4';
    case 'DottedLine':
      return '2 3';
    case 'SolidLine':
    default:
      return null;
  }
}

/** Which end of a connection a decoration sits on. */
export type DecorationEnd = 'source' | 'target';

/** Every {@link Decoration} this module draws — the full vocabulary. */
export const DECORATIONS: readonly Decoration[] = [
  'NoDecoration',
  'OpenArrowhead',
  'ClosedArrowhead',
  'HollowArrowhead',
  'HollowDiamond',
  'FilledDiamond',
  'HalfArrowhead',
  'CircleDot',
];

/** A `<marker>` and the id it is referenced by. */
export interface MarkerDefinition {
  id: string;
  element: SVGElement;
}

/** Geometry of one decoration inside its marker viewport. */
interface DecorationShape {
  tag: string;
  attrs: SvgAttrs;
  width: number;
  height: number;
  refX: number;
  refY: number;
  /** Whether the glyph is filled with the line colour or left hollow. */
  fill: 'line' | 'hollow' | 'none';
}

/**
 * Marker geometry per decoration.
 *
 * Hollow versus filled is semantic in ArchiMate — realization and
 * specialization use a *hollow* arrowhead, triggering a *filled* one; and
 * composition's diamond is filled where aggregation's is hollow. Hollow glyphs
 * therefore get an opaque white fill (not `none`) so the line underneath does
 * not show through them.
 */
function decorationShape(decoration: Decoration): DecorationShape | null {
  switch (decoration) {
    case 'OpenArrowhead':
      // Two barbs only, no closing edge: the line shows through.
      return {
        tag: 'path',
        attrs: { d: 'M 1 1 L 10 6 L 1 11' },
        width: 12,
        height: 12,
        refX: 10,
        refY: 6,
        fill: 'none',
      };

    case 'ClosedArrowhead':
      return {
        tag: 'path',
        attrs: { d: 'M 1 1 L 11 6 L 1 11 z' },
        width: 12,
        height: 12,
        refX: 11,
        refY: 6,
        fill: 'line',
      };

    case 'HollowArrowhead':
      return {
        tag: 'path',
        attrs: { d: 'M 1 1 L 13 7 L 1 13 z' },
        width: 14,
        height: 14,
        refX: 13,
        refY: 7,
        fill: 'hollow',
      };

    case 'HollowDiamond':
      return {
        tag: 'path',
        attrs: { d: 'M 1 7 L 8 1 L 15 7 L 8 13 z' },
        width: 16,
        height: 14,
        refX: 15,
        refY: 7,
        fill: 'hollow',
      };

    case 'FilledDiamond':
      return {
        tag: 'path',
        attrs: { d: 'M 1 7 L 8 1 L 15 7 L 8 13 z' },
        width: 16,
        height: 14,
        refX: 15,
        refY: 7,
        fill: 'line',
      };

    case 'HalfArrowhead':
      // One barb, on the upper side only — ArchiMate's Flow notation.
      return {
        tag: 'path',
        attrs: { d: 'M 1 1 L 11 6 L 3 6' },
        width: 12,
        height: 12,
        refX: 11,
        refY: 6,
        fill: 'none',
      };

    case 'CircleDot':
      return {
        tag: 'circle',
        attrs: { cx: 5, cy: 5, r: 4 },
        width: 10,
        height: 10,
        refX: 5,
        refY: 5,
        fill: 'line',
      };

    case 'NoDecoration':
    default:
      return null;
  }
}

/** Reduce a colour to something safe to embed in an element id. */
function colorSlug(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'default';
}

/** Stable id for the marker drawing `decoration` at `end` in `lineColor`. */
export function markerId(decoration: Decoration, end: DecorationEnd, lineColor: string): string {
  return `la-marker-${decoration}-${end}-${colorSlug(lineColor)}`;
}

/**
 * Build the `<marker>` for a decoration, or `null` for `NoDecoration`.
 *
 * Source markers use `orient="auto-start-reverse"` so the same geometry points
 * the right way at both ends; that is an SVG 2 feature, supported by every
 * browser engine this app targets (Chromium via Electron, plus current
 * Firefox/Safari).
 */
export function markerDefinition(
  decoration: Decoration,
  end: DecorationEnd,
  lineColor: string,
): MarkerDefinition | null {
  const shape = decorationShape(decoration);
  if (!shape) return null;

  const id = markerId(decoration, end, lineColor);
  const marker = svgEl('marker', {
    id,
    markerWidth: shape.width,
    markerHeight: shape.height,
    refX: shape.refX,
    refY: shape.refY,
    markerUnits: 'userSpaceOnUse',
    orient: end === 'source' ? 'auto-start-reverse' : 'auto',
  });
  marker.setAttribute('class', `la-marker la-marker-${decoration}`);

  const glyph = svgEl(shape.tag, shape.attrs);
  glyph.setAttribute('stroke', lineColor);
  glyph.setAttribute('stroke-width', String(NOTATION_DEFAULTS.strokeWidth));
  glyph.setAttribute('fill', shape.fill === 'line' ? lineColor : shape.fill === 'hollow' ? '#FFFFFF' : 'none');
  marker.appendChild(glyph);

  return { id, element: marker };
}
