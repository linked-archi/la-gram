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
 * - **Real outlines, not degraded rectangles.** `Octagon`, `Hexagon`, `Diamond`,
 *   `Parallelogram`, `Box3D` and `Folder` are `<polygon>` elements with computed
 *   points; the wavy shapes, `Cloud` and `Cylinder` are `<path>`s. diagram-js
 *   hands the renderer direct SVG control, so there is no reason to approximate.
 *   {@link shapePath} emits the same outlines as SVG path strings, which is what
 *   connection docking crops against — one geometry, two encodings, so a line
 *   always meets the shape where it is actually drawn. The inner lines some
 *   shapes carry (a band, a tab, a 3D box's front edges, a cylinder's rim) are
 *   {@link ShapeGeometry.details}: drawn, but not part of the outline.
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
  tag: 'rect' | 'ellipse' | 'circle' | 'polygon' | 'path';
  attrs: SvgAttrs;
  /**
   * Inner lines drawn over the body, as a shape-local path (`M`/`L`/`A` only):
   * the band of a `BandedRectangle`, the tab of a `TabbedRectangle` or `Folder`,
   * the front edges of a `Box3D`, the front of a `Cylinder`'s rim. Stroked, not
   * filled, and not part of the outline connections dock against.
   */
  details?: string;
}

/** A box in shape-local coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Proportions of the shapes with inner lines or curved edges, against the
// shape's size; the comments give the 130 × 60 picture values they match.

/** Header band of the banded, tabbed and wavy shapes: h × 0.173 (10.4), at most 14. */
function bandHeight(h: number): number {
  return Math.min((h * 10.4) / 60, 14);
}

/** Depth of a `Box3D`'s top and side faces: h × 0.2 (12), at most 12, and no more than w × 0.2. */
function boxDepth(w: number, h: number): number {
  return Math.min(h * 0.2, w * 0.2, 12);
}

/** A `Folder`'s name tab: h × 0.35 (21) high, at most 21; w × 0.8 (104) wide, at most 200 or w / 2. */
function folderTab(w: number, h: number): { width: number; height: number } {
  return { width: Math.min(w * 0.8, Math.max(200, w / 2)), height: Math.min(h * 0.35, 21) };
}

/** Height of a `Cylinder`'s top rim: h × 0.2, at most 16. */
function cylinderRim(h: number): number {
  return Math.min(h * 0.2, 16);
}

/**
 * `Cloud`, as published in the ArchiMate pictures at 130 × 60: a start point
 * and six quadratic lobes, each a control point and an end point.
 */
const CLOUD_START: [number, number] = [28.6, 9.6];
const CLOUD_LOBES: Array<[[number, number], [number, number]]> = [
  [[46.8, -7.2], [74.1, 9.6]],
  [[113.1, -2.4], [119.6, 22.2]],
  [[145.6, 43.8], [100.1, 52.2]],
  [[67.6, 69], [35.1, 47.4]],
  [[-5.2, 52.2], [7.8, 30.6]],
  [[-10.4, 9.6], [28.6, 9.6]],
];

/** Shapes whose outline is a plain rectangle; they differ only in their inner lines. */
const RECTANGLE_OUTLINED: ReadonlySet<ShapeType> = new Set<ShapeType>([
  'BandedRectangle',
  'DoubleBandedRectangle',
  'TabbedRectangle',
]);

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

    case 'Box3D': {
      // The silhouette: front face plus the top and side faces behind it.
      const d = boxDepth(w, h);
      return [
        [0, d],
        [d, 0],
        [w, 0],
        [w, h - d],
        [w - d, h],
        [0, h],
      ];
    }

    case 'Folder': {
      const tab = folderTab(w, h);
      return [
        [0, 0],
        [tab.width, 0],
        [tab.width, tab.height],
        [w, tab.height],
        [w, h],
        [0, h],
      ];
    }

    default:
      return null;
  }
}

/**
 * Outline of the shape types drawn with curves, offset by (`dx`, `dy`), or
 * `null` for any other type. Absolute commands only, every coordinate a
 * `x,y` pair, so the outline can be offset and intersected as it stands.
 */
function curvedOutline(type: ShapeType, w: number, h: number, dx: number, dy: number): string | null {
  const at = (x: number, y: number) => `${round(dx + x)},${round(dy + y)}`;
  switch (type) {
    case 'WavyRectangle':
    case 'WavyBandedRectangle': {
      // The bottom edge is one wave from the right end to the left, both one
      // band above the bottom; it stays inside the bounds (its lowest point is
      // 0.13 band above the bottom).
      const b = bandHeight(h);
      return (
        `M${at(0, 0)}L${at(w, 0)}L${at(w, h - b)}` +
        `C${at(w / 2, h - 4 * b)} ${at(w / 2, h + 2 * b)} ${at(0, h - b)}Z`
      );
    }

    case 'Cloud': {
      const sx = w / 130;
      const sy = h / 60;
      const lobes = CLOUD_LOBES.map(([[cx, cy], [ex, ey]]) => `Q${at(cx * sx, cy * sy)} ${at(ex * sx, ey * sy)}`);
      return `M${at(CLOUD_START[0] * sx, CLOUD_START[1] * sy)}${lobes.join('')}Z`;
    }

    case 'Cylinder': {
      // Over the top of the rim, down the right side, round the bottom, up the left.
      const ry = cylinderRim(h) / 2;
      const rx = round(w / 2);
      const r = round(ry);
      return (
        `M${at(0, ry)}A${rx},${r} 0 0 1 ${at(w, ry)}` +
        `L${at(w, h - ry)}A${rx},${r} 0 0 1 ${at(0, h - ry)}Z`
      );
    }

    default:
      return null;
  }
}

/** Inner lines of a shape type, shape-local — see {@link ShapeGeometry.details}. */
function shapeDetails(type: ShapeType, w: number, h: number): string | undefined {
  const at = (x: number, y: number) => `${round(x)},${round(y)}`;
  const band = bandHeight(h);
  switch (type) {
    case 'BandedRectangle':
    case 'WavyBandedRectangle':
      return `M${at(0, band)}L${at(w, band)}`;
    case 'DoubleBandedRectangle':
      return `M${at(0, band)}L${at(w, band)}M${at(0, h - band)}L${at(w, h - band)}`;
    case 'TabbedRectangle':
      return `M${at(0, band)}L${at(w / 2, band)}L${at(w / 2, 0)}`;
    case 'Box3D': {
      const d = boxDepth(w, h);
      return `M${at(0, d)}L${at(w - d, d)}L${at(w - d, h)}M${at(w - d, d)}L${at(w, 0)}`;
    }
    case 'Folder': {
      const tab = folderTab(w, h);
      return `M${at(0, tab.height)}L${at(tab.width, tab.height)}`;
    }
    case 'Cylinder': {
      // The front of the rim: the lower half of the top ellipse.
      const ry = round(cylinderRim(h) / 2);
      return `M${at(0, ry)}A${round(w / 2)},${ry} 0 0 0 ${at(w, ry)}`;
    }
    default:
      return undefined;
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
  const details = shapeDetails(type, w, h);
  const withDetails = (geometry: ShapeGeometry): ShapeGeometry => (details ? { ...geometry, details } : geometry);

  if (RECTANGLE_OUTLINED.has(type)) return withDetails(shapeGeometry('Rectangle', w, h));

  const vertices = polygonVertices(type, w, h);
  if (vertices) return withDetails({ tag: 'polygon', attrs: { points: points(vertices) } });

  const curved = curvedOutline(type, w, h, 0, 0);
  if (curved) return withDetails({ tag: 'path', attrs: { d: curved } });

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
 * The counterpart to {@link shapeGeometry}: same shapes, same geometry,
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
 * renderer draws as true conics. A `Cylinder`'s ends are arcs for the same
 * reason; the wave and the `Cloud` are the cubic and quadratic curves the
 * ArchiMate pictures draw, which `pathToCurve` also takes as they stand.
 *
 * Inner lines are not outline: a `BandedRectangle`, `DoubleBandedRectangle` or
 * `TabbedRectangle` docks as the rectangle it is drawn in.
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
  const requested = shapeType ?? NOTATION_DEFAULTS.shapeType;
  // Inner lines are not outline: a banded rectangle docks as a rectangle.
  const type = RECTANGLE_OUTLINED.has(requested) ? 'Rectangle' : requested;

  const curved = curvedOutline(type, w, h, left, top);
  if (curved) return curved;

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
  'BandedRectangle',
  'DoubleBandedRectangle',
  'TabbedRectangle',
  'Box3D',
  'WavyRectangle',
  'WavyBandedRectangle',
  'Cloud',
  'Folder',
  'Cylinder',
];

/** Where a shape's badge and label go, in shape-local coordinates. */
export interface ShapeLayout {
  /** The area inside the inner lines: the badge is placed in it, and so is the label unless {@link label} differs. */
  content: Box;
  /** The area the label is laid out in. */
  label: Box;
  /** The most label lines {@link label} holds, when that is fewer than the default. */
  maxLabelLines?: number;
}

/**
 * The areas a shape's badge and label are laid out in: the whole shape, except
 * where inner lines or curves take part of it — below a band, on a 3D box's
 * front face, above a wave, inside a cloud, under a cylinder's rim. A `Folder`'s
 * label goes in its tab (one line), leaving the body for what it contains.
 */
export function shapeLayout(shapeType: ShapeType | undefined, width: number, height: number): ShapeLayout {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);
  const box = (x: number, y: number, bw: number, bh: number): Box => ({
    x: round(x),
    y: round(y),
    width: round(Math.max(1, bw)),
    height: round(Math.max(1, bh)),
  });
  const band = bandHeight(h);
  const same = (content: Box): ShapeLayout => ({ content, label: content });

  switch (shapeType ?? NOTATION_DEFAULTS.shapeType) {
    case 'BandedRectangle':
    case 'TabbedRectangle':
      return same(box(0, band, w, h - band));
    case 'DoubleBandedRectangle':
    case 'WavyBandedRectangle':
      return same(box(0, band, w, h - 2 * band));
    case 'WavyRectangle':
      return same(box(0, 0, w, h - band));
    case 'Box3D': {
      const d = boxDepth(w, h);
      return same(box(0, d, w - d, h - d));
    }
    case 'Cloud':
      return same(box(w * 0.1, h * 0.15, w * 0.8, h * 0.7));
    case 'Cylinder': {
      const rim = cylinderRim(h);
      return same(box(0, rim, w, h - rim - rim / 2));
    }
    case 'Folder': {
      const tab = folderTab(w, h);
      return { content: box(0, tab.height, w, h - tab.height), label: box(0, 0, tab.width, tab.height), maxLabelLines: 1 };
    }
    default:
      return same(box(0, 0, w, h));
  }
}

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
    /** At most this many lines; {@link NOTATION_DEFAULTS.maxLabelLines} when absent. */
    maxLines?: number;
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
  const lines = wrapLabel(label, available, fontSize, options.maxLines);
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

// ── Decorations from their published symbols ────────────────────────────

/**
 * A decoration's published marker symbol (`arch-vis:decorSymbol`): its viewBox,
 * the size it is drawn at, and its drawing.
 */
export interface DecorationSymbol {
  viewBox: { x: number; y: number; width: number; height: number };
  /** Drawn size in user units: the file's `width`/`height`, else the viewBox's. */
  width: number;
  height: number;
  /** The drawing: plain shape elements only — see {@link parseDecorationSymbol}. */
  content: Element[];
}

/** Shape elements a symbol may draw with; anything else is dropped. */
const SYMBOL_ELEMENTS = new Set(['g', 'path', 'polygon', 'polyline', 'circle', 'ellipse', 'rect', 'line']);

/** Geometry and paint attributes a symbol may use; anything else is dropped. */
const SYMBOL_ATTRIBUTES = new Set([
  'd', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'transform',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap',
  'stroke-dasharray', 'stroke-opacity', 'opacity',
]);

/**
 * Read a published decoration symbol (SVG text) into a {@link DecorationSymbol},
 * or `null` when it is not a usable SVG.
 *
 * The symbol is drawn inside the canvas, so it is rebuilt rather than inserted:
 * only plain shape elements and their geometry and paint attributes survive —
 * no scripts, event handlers, styles, links or references to other content.
 */
export function parseDecorationSymbol(svgText: string): DecorationSymbol | null {
  if (typeof DOMParser === 'undefined') return null;
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length > 0) return null;

  const numbers = (value: string | null) => (value ?? '').trim().split(/[\s,]+/).map(Number);
  const size = (value: string | null) => {
    const n = Number.parseFloat(value ?? '');
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const [vx, vy, vw, vh] = numbers(root.getAttribute('viewBox'));
  const width = size(root.getAttribute('width'));
  const height = size(root.getAttribute('height'));
  const viewBox =
    [vx, vy, vw, vh].every((n) => Number.isFinite(n)) && vw! > 0 && vh! > 0
      ? { x: vx!, y: vy!, width: vw!, height: vh! }
      : width && height
        ? { x: 0, y: 0, width, height }
        : undefined;
  if (!viewBox) return null;

  const rebuild = (source: Element): Element | null => {
    if (!SYMBOL_ELEMENTS.has(source.localName)) return null;
    const copy = document.createElementNS(SVG_NS, source.localName);
    for (const attribute of Array.from(source.attributes)) {
      if (!SYMBOL_ATTRIBUTES.has(attribute.name)) continue;
      if (/url\(|javascript:/i.test(attribute.value)) continue;
      copy.setAttribute(attribute.name, attribute.value);
    }
    for (const child of Array.from(source.children)) {
      const kept = rebuild(child);
      if (kept) copy.appendChild(kept);
    }
    return copy;
  };
  const content = Array.from(root.children).map(rebuild).filter((e): e is Element => e !== null);
  if (content.length === 0) return null;
  return { viewBox, width: width ?? viewBox.width, height: height ?? viewBox.height, content };
}

/**
 * The `<marker>` drawing a decoration from its published symbol, placed as the
 * vocabulary describes `arch-vis:decorSymbol`: the symbol points in +x, the
 * connector meets it at the middle of its viewBox's right edge, and it is
 * mirrored at a source end; `currentColor` takes the line's colour.
 */
export function symbolMarkerDefinition(
  symbol: DecorationSymbol,
  decoration: Decoration,
  end: DecorationEnd,
  lineColor: string,
): MarkerDefinition {
  const id = markerId(decoration, end, lineColor);
  const { viewBox } = symbol;
  const marker = svgEl('marker', {
    id,
    viewBox: `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
    markerWidth: symbol.width,
    markerHeight: symbol.height,
    refX: viewBox.x + viewBox.width,
    refY: viewBox.y + viewBox.height / 2,
    markerUnits: 'userSpaceOnUse',
    orient: end === 'source' ? 'auto-start-reverse' : 'auto',
  });
  marker.setAttribute('class', `la-marker la-marker-${decoration}`);
  marker.setAttribute('color', lineColor);
  markMarker(marker, decoration, end, lineColor, 'published');
  for (const element of symbol.content) marker.appendChild(element.cloneNode(true));
  return { id, element: marker };
}

/** What a marker draws, so it can be found and replaced once a symbol arrives. */
function markMarker(marker: SVGElement, decoration: Decoration, end: DecorationEnd, lineColor: string, source: 'built-in' | 'published'): void {
  marker.setAttribute('data-decoration', decoration);
  marker.setAttribute('data-end', end);
  marker.setAttribute('data-color', lineColor);
  marker.setAttribute('data-source', source);
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
  markMarker(marker, decoration, end, lineColor, 'built-in');

  const glyph = svgEl(shape.tag, shape.attrs);
  glyph.setAttribute('stroke', lineColor);
  glyph.setAttribute('stroke-width', String(NOTATION_DEFAULTS.strokeWidth));
  glyph.setAttribute('fill', shape.fill === 'line' ? lineColor : shape.fill === 'hollow' ? '#FFFFFF' : 'none');
  marker.appendChild(glyph);

  return { id, element: marker };
}
