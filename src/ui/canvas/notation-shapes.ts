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
 * - **Real outlines, not degraded rectangles.** The core `Octagon`, `Hexagon`,
 *   `Diamond` and `Parallelogram` are `<polygon>` elements with computed points;
 *   a notation's own shape (ArchiMate's 3D box, C4's person) is a `<path>` drawn
 *   from its path templates ({@link drawCustomShape}), so no notation needs code
 *   here. {@link shapePath} emits the same outlines as SVG path strings, which is
 *   what connection docking crops against — one geometry, two encodings, so a
 *   line always meets the shape where it is actually drawn. A notation's own
 *   shape's inner lines are {@link ShapeGeometry.details}: drawn, but not outline.
 * - **No measurement.** Label layout is computed from a character-width estimate
 *   rather than `getComputedTextLength`, so it is deterministic and behaves the
 *   same under jsdom as in a browser. The cost is that very wide glyphs can
 *   overflow slightly; the benefit is that rendering never depends on layout
 *   having happened.
 */

import type {
  CustomShape,
  Decoration,
  IconPlacement,
  LineStyle,
  RelationshipVisualStyle,
  ShapeType,
} from '../../metamodel-manager/notation.js';
import type { PaletteDefinition } from '../../metamodel-manager/interfaces.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fallbacks for style properties the notation data may leave out. */
/**
 * How tall a container's name band is: once something is drawn inside it, its
 * name goes to the top of its content box, on at most two lines with the badge
 * padding (`containerLayout` in the renderer). What is inside is kept below it
 * (`RdfAutoResize`).
 */
export function containerNameBand(fontSize = 11, badgePadding = 4): number {
  return 2 * Math.round(fontSize * 1.2) + 2 * badgePadding;
}

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

/** What to draw: a core shape, or a notation's own shape drawn from its templates. */
export type ShapeRef = ShapeType | CustomShape | undefined;

/** The SVG element kind and attributes that draw a shape. */
export interface ShapeGeometry {
  tag: 'rect' | 'ellipse' | 'circle' | 'polygon' | 'path';
  attrs: SvgAttrs;
  /**
   * Inner lines drawn over the body, as a shape-local path — a notation's own
   * shape's `arch-vis:detailPath` (a band, a tab, a 3D box's front edges).
   * Stroked, not filled, and not part of the outline connections dock against.
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

/** A notation's own shape, as opposed to a core one. */
function isCustom(shape: ShapeRef): shape is CustomShape {
  return typeof shape === 'object' && shape !== null;
}

/** A vertex list in shape-local coordinates, or `null` for a non-polygon. */
type Vertices = Array<[number, number]>;

/**
 * Vertices of the polygonal core shapes, in shape-local coordinates.
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
 * Geometry for a shape at `width` × `height`.
 *
 * A core shape is drawn natively; an unknown or absent one falls back to
 * {@link NOTATION_DEFAULTS.shapeType}. `Circle` is a true circle — its radius is
 * half the *smaller* dimension, so it stays inside the declared bounds rather
 * than being squashed into an ellipse. A notation's own shape is drawn from its
 * templates ({@link drawCustomShape}); when they cannot be evaluated, as its
 * fallback.
 */
export function shapeGeometry(shape: ShapeRef, width: number, height: number): ShapeGeometry {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);

  if (isCustom(shape)) {
    const drawn = drawCustomShape(shape, w, h);
    if (!drawn) return shapeGeometry(shape.fallback, w, h);
    return { tag: 'path', attrs: { d: drawn.outline }, ...(drawn.details ? { details: drawn.details } : {}) };
  }

  const type = shape ?? NOTATION_DEFAULTS.shapeType;
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
 * SVG path outlining a shape, in **absolute** coordinates.
 *
 * The counterpart to {@link shapeGeometry}: same shapes, same geometry,
 * expressed as a `d` attribute rather than as element attributes, and offset by
 * the shape's position on the diagram instead of drawn shape-local. This is what
 * connection cropping needs — diagram-js hands the shape's path and the
 * connection's path to `path-intersection` and docks the line where they meet,
 * so a path that did not match the drawn outline would dock in mid-air. For a
 * notation's own shape it is its outline template, moved; its inner lines are
 * not outline.
 *
 * ## Curves
 *
 * `Ellipse`, `Circle` and the rounded corners of `RoundedRectangle` are emitted
 * as **elliptical arcs** (`A`), not beziers. `path-intersection` normalises
 * every path through `pathToCurve`, whose `case 'A'` runs `arcToCurve` — arcs are
 * converted to cubic segments *exactly*, in one place, by the library itself.
 * Approximating them here with beziers would add our own error on top of that
 * conversion for no gain, and would not match `<ellipse>`/`<circle>`, which the
 * renderer draws as true conics. A template's arcs and curves go the same way.
 *
 * An ellipse needs two arcs rather than one: a single arc whose end point equals
 * its start point is degenerate and SVG renders nothing, so the outline is split
 * at the left and right extremes into two half-sweeps.
 */
export function shapePath(shape: ShapeRef, x: number, y: number, width: number, height: number): string {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;

  if (isCustom(shape)) {
    const drawn = drawCustomShape(shape, w, h);
    return drawn ? translatePath(drawn.outline, left, top) : shapePath(shape.fallback, left, top, w, h);
  }

  const type = shape ?? NOTATION_DEFAULTS.shapeType;
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

/** Every core {@link ShapeType} — the shapes every renderer draws natively. */
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

/** Where a shape's badge and label go, in shape-local coordinates. */
export interface ShapeLayout {
  /** Where the badge goes — and the label, unless {@link label} differs. */
  content: Box;
  /** The area the label is laid out in. */
  label: Box;
  /** The most label lines {@link label} holds, when that is fewer than the default. */
  maxLabelLines?: number;
  /** The label shares the content box with the badge — a band of it — so keeps clear of it. */
  labelBesideBadge?: boolean;
}

/**
 * The areas a shape's badge and label are laid out in: the whole shape for a
 * core one; for a notation's own, its `arch-vis:contentBox` (below a band, on a
 * 3D box's front face) and `arch-vis:labelBox` (a folder's tab), the label
 * taking as many lines as that box is tall enough for.
 */
export function shapeLayout(shape: ShapeRef, width: number, height: number): ShapeLayout {
  const w = size(width, NOTATION_DEFAULTS.width);
  const h = size(height, NOTATION_DEFAULTS.height);
  const whole = clampBox({ x: 0, y: 0, width: w, height: h });
  if (!isCustom(shape)) return { content: whole, label: whole };

  const drawn = drawCustomShape(shape, w, h);
  const content = drawn?.content ? clampBox(drawn.content) : whole;
  if (!drawn?.label) return { content, label: content };
  const label = clampBox(drawn.label);
  const lineHeight = round(NOTATION_DEFAULTS.fontSize * 1.2);
  const fits = Math.max(1, Math.min(NOTATION_DEFAULTS.maxLabelLines, Math.floor(label.height / lineHeight)));
  return { content, label, ...(fits < NOTATION_DEFAULTS.maxLabelLines ? { maxLabelLines: fits } : {}) };
}

function clampBox(box: Box): Box {
  return {
    x: round(box.x),
    y: round(box.y),
    width: round(Math.max(1, box.width)),
    height: round(Math.max(1, box.height)),
  };
}

// ── A notation's own shapes: path templates ──────────────────────────────

/** A template that cannot be evaluated: a syntax error, an unknown name, a non-finite value. */
export class ShapeTemplateError extends Error {}

/**
 * A template expression's value: numbers, the names in `names` (`w`, `h` and the
 * shape's variables), `+ - * /`, parentheses, and `min()` / `max()`. Parsed
 * here, never evaluated as code.
 */
export function evaluateExpression(source: string, names: Readonly<Record<string, number>>): number {
  const tokens = source.match(/\d+(?:\.\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|\S/g) ?? [];
  let at = 0;
  const fail = (why: string): never => {
    throw new ShapeTemplateError(`${why} in "${source}"`);
  };
  const take = (expected: string) => {
    if (tokens[at] !== expected) fail(`expected "${expected}"`);
    at += 1;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++];
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  const product = (): number => {
    let value = unary();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++];
      const right = unary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const unary = (): number => {
    const token = tokens[at++];
    if (token === undefined) return fail('unexpected end');
    if (token === '-') return -unary();
    if (token === '+') return unary();
    if (token === '(') {
      const value = sum();
      take(')');
      return value;
    }
    if (/^[\d.]/.test(token)) return Number(token);
    if (/^[A-Za-z_]/.test(token)) {
      if (tokens[at] === '(') {
        at += 1;
        const args = [sum()];
        while (tokens[at] === ',') {
          at += 1;
          args.push(sum());
        }
        take(')');
        if (token === 'min') return Math.min(...args);
        if (token === 'max') return Math.max(...args);
        return fail(`unknown function "${token}"`);
      }
      if (Object.prototype.hasOwnProperty.call(names, token)) return names[token]!;
      return fail(`unknown name "${token}"`);
    }
    return fail(`unexpected "${token}"`);
  };
  const value = sum();
  if (at < tokens.length) fail(`unexpected "${tokens[at]}"`);
  if (!Number.isFinite(value)) fail('not a finite number');
  return value;
}

/**
 * A template with each `{expression}` replaced by its value (two decimals), in
 * the compact form the core shapes' paths use (`M0,12L12,0A9,9 0 0 1 …`).
 */
export function fillTemplate(template: string, names: Readonly<Record<string, number>>): string {
  return template
    .replace(/\{([^{}]*)\}/g, (_all, expression: string) => String(round(evaluateExpression(expression, names))))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*([A-Za-z])\s*/g, '$1');
}

/** `w`, `h` and a shape's `arch-vis:shapeVariables`, each assignment able to use the ones before it. */
function shapeNames(shape: CustomShape, w: number, h: number): Record<string, number> {
  const names: Record<string, number> = { w, h };
  for (const assignment of (shape.variables ?? '').split(';')) {
    if (assignment.trim() === '') continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(assignment);
    if (!match || match[1] === 'w' || match[1] === 'h') throw new ShapeTemplateError(`bad assignment "${assignment.trim()}"`);
    names[match[1]!] = evaluateExpression(match[2]!, names);
  }
  return names;
}

/** An `x y width height` box template. */
function fillBox(template: string, names: Readonly<Record<string, number>>): Box {
  const values = template
    .replace(/\{([^{}]*)\}/g, (_all, expression: string) => String(evaluateExpression(expression, names)))
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) throw new ShapeTemplateError(`bad box "${template}"`);
  const [x, y, width, height] = values as [number, number, number, number];
  return { x, y, width, height };
}

/** A notation's own shape at a size: its outline, inner lines and boxes. */
export interface DrawnCustomShape {
  outline: string;
  details?: string;
  content?: Box;
  label?: Box;
}

/** Template errors already reported, so a broken shape warns once rather than on every redraw. */
const reportedTemplates = new Set<string>();

/**
 * A notation's own shape evaluated at `w` × `h`, or `undefined` when its
 * templates cannot be — then it is drawn as its fallback.
 */
export function drawCustomShape(shape: CustomShape, w: number, h: number): DrawnCustomShape | undefined {
  try {
    const names = shapeNames(shape, w, h);
    return {
      outline: fillTemplate(shape.outline, names),
      ...(shape.details ? { details: fillTemplate(shape.details, names) } : {}),
      ...(shape.contentBox ? { content: fillBox(shape.contentBox, names) } : {}),
      ...(shape.labelBox ? { label: fillBox(shape.labelBox, names) } : {}),
    };
  } catch (error) {
    if (!(error instanceof ShapeTemplateError)) throw error;
    if (!reportedTemplates.has(shape.iri)) {
      reportedTemplates.add(shape.iri);
      console.warn(`[la-gram] ${shape.iri}: drawn as its fallback — ${error.message}`);
    }
    return undefined;
  }
}

/** How many numbers each path command takes, and which of them are x / y coordinates. */
const PATH_ARGS: Record<string, { count: number; xs: number[]; ys: number[] }> = {
  M: { count: 2, xs: [0], ys: [1] },
  L: { count: 2, xs: [0], ys: [1] },
  T: { count: 2, xs: [0], ys: [1] },
  H: { count: 1, xs: [0], ys: [] },
  V: { count: 1, xs: [], ys: [0] },
  C: { count: 6, xs: [0, 2, 4], ys: [1, 3, 5] },
  S: { count: 4, xs: [0, 2], ys: [1, 3] },
  Q: { count: 4, xs: [0, 2], ys: [1, 3] },
  A: { count: 7, xs: [5], ys: [6] },
  Z: { count: 0, xs: [], ys: [] },
};

/**
 * A path in absolute commands moved by (`dx`, `dy`), in the compact form
 * {@link fillTemplate} writes. Arc radii and flags are not coordinates and
 * stay as they are.
 */
export function translatePath(d: string, dx: number, dy: number): string {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let out = '';
  let at = 0;
  while (at < tokens.length) {
    const command = tokens[at++]!;
    const args = PATH_ARGS[command];
    if (!args) throw new ShapeTemplateError(`path command "${command}" is not absolute`);
    do {
      const values = tokens.slice(at, at + args.count).map(Number);
      at += args.count;
      for (const i of args.xs) values[i] = round(values[i]! + dx);
      for (const i of args.ys) values[i] = round(values[i]! + dy);
      out += command + formatArgs(command, values);
    } while (args.count > 0 && at < tokens.length && !/^[A-Za-z]$/.test(tokens[at]!));
  }
  return out;
}

/** A command's numbers as {@link fillTemplate} writes them: coordinate pairs joined by commas. */
function formatArgs(command: string, v: number[]): string {
  switch (command) {
    case 'H':
    case 'V':
      return `${v[0]}`;
    case 'A':
      return `${v[0]},${v[1]} ${v[2]} ${v[3]} ${v[4]} ${v[5]},${v[6]}`;
    case 'Z':
      return '';
    default: {
      const pairs: string[] = [];
      for (let i = 0; i < v.length; i += 2) pairs.push(`${v[i]},${v[i + 1]}`);
      return pairs.join(' ');
    }
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
 * Whether a shape this size holds one line of its label — a few characters'
 * width and a line's height. A junction's circle does not, so its name goes
 * under it.
 */
export function labelFitsInside(
  width: number,
  height: number,
  fontSize: number = NOTATION_DEFAULTS.fontSize,
): boolean {
  return width >= fontSize * 3 && height >= round(fontSize * 1.2);
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
    /** Under the shape, outside it — for a shape too small to hold its name. */
    outside?: boolean;
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
  const available = options.outside
    ? Math.max(w, NOTATION_DEFAULTS.width)
    : options.below
    ? w
    : options.badgePlacement
      ? Math.max(w - NOTATION_DEFAULTS.badgeSize - 2 * pad, w * 0.5)
      : Math.max(w - 2 * pad, w * 0.5);
  const lines = wrapLabel(label, available, fontSize, options.maxLines);
  const block = lines.length * lineHeight;

  if (options.outside) {
    // First baseline just under the shape's bottom edge.
    return { lines, x: round(w / 2), y: round(h + NOTATION_DEFAULTS.badgePadding + fontSize * 0.85), lineHeight };
  }

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
      // One barb, on the upper side only.
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
      // A filled dot whose edge meets the end of the line — ArchiMate's
      // assignment, at the source end; as the published symbol draws it.
      return {
        tag: 'circle',
        attrs: { cx: 8.5, cy: 6, r: 3.5 },
        width: 12,
        height: 12,
        refX: 12,
        refY: 6,
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

/** How much smaller a decoration is drawn on a relationship icon than on the canvas. */
const ICON_MARKER_SCALE = 0.75;

/** Text for an XML attribute value. */
function xmlAttr(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A relationship type's icon drawn from its notation — for a type whose
 * notation publishes none (ArchiMate's relationships have none, Basic's have):
 * a short line, source at the lower left, in its line style and colour, with
 * its end decorations, as the canvas draws it. A type without a notation gets a
 * plain line. A `data:` URI of a standalone SVG, for an `<img>`.
 */
export function relationshipIconDataUri(style: RelationshipVisualStyle | undefined): string {
  const color = style?.lineColor ?? NOTATION_DEFAULTS.lineColor;
  const markers: string[] = [];
  const ends: string[] = [];
  for (const [end, decoration] of [['source', style?.sourceDecor], ['target', style?.targetDecor]] as const) {
    const shape = decoration ? decorationShape(decoration) : null;
    if (!shape) continue;
    const fill = shape.fill === 'line' ? color : shape.fill === 'hollow' ? '#FFFFFF' : 'none';
    const attrs = Object.entries(shape.attrs).map(([name, value]) => ` ${name}="${xmlAttr(value)}"`).join('');
    markers.push(
      `<marker id="${end}" viewBox="0 0 ${shape.width} ${shape.height}"` +
        ` markerWidth="${shape.width * ICON_MARKER_SCALE}" markerHeight="${shape.height * ICON_MARKER_SCALE}"` +
        ` refX="${shape.refX}" refY="${shape.refY}" markerUnits="userSpaceOnUse"` +
        ` orient="${end === 'source' ? 'auto-start-reverse' : 'auto'}">` +
        `<${shape.tag}${attrs} stroke="${xmlAttr(color)}" stroke-width="2" fill="${xmlAttr(fill)}"/></marker>`,
    );
    ends.push(` marker-${end === 'source' ? 'start' : 'end'}="url(#${end})"`);
  }
  // The canvas's dashes, shortened to the icon's length.
  const dash = strokeDashArray(style?.lineStyle)
    ?.split(' ')
    .map((n) => Number(n) * 0.6)
    .join(' ');
  const svg =
    `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" width="24" height="24">` +
    (markers.length > 0 ? `<defs>${markers.join('')}</defs>` : '') +
    `<line x1="3" y1="21" x2="21" y2="3" stroke="${xmlAttr(color)}" stroke-width="2"` +
    (dash ? ` stroke-dasharray="${dash}"` : '') +
    `${ends.join('')}/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * The palette with an icon for every relationship type: the one its notation
 * publishes, else — none, or one `broken` says does not load — one drawn from it.
 */
export function withRelationshipIcons(palette: PaletteDefinition, broken: (iconUrl: string) => boolean = () => false): PaletteDefinition {
  const usable = (iconUrl: string | undefined): iconUrl is string => Boolean(iconUrl) && !broken(iconUrl!);
  if (palette.relationshipTypes.every((r) => usable(r.iconUrl))) return palette;
  return {
    ...palette,
    relationshipTypes: palette.relationshipTypes.map((r) =>
      usable(r.iconUrl) ? r : { ...r, iconUrl: relationshipIconDataUri(r.relationshipStyle) },
    ),
  };
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
