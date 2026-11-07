/**
 * How one thing drawn in a view looks — an element's placement, a figure, a
 * relationship's line, a line from a note — set on its own core-vis style
 * (`arch-vis:style`): the look of that one diagram object.
 * Each value absent leaves the notation's choice, or la-gram's.
 *
 * | key | core-vis | value |
 * | --- | --- | --- |
 * | `fillColor`, `lineColor`, `fontColor` | `arch-vis:fillColor` … | a CSS colour; its alpha its opacity |
 * | `gradient` | `arch-vis:gradient` (0.7) | `arch-vis:GradientTop`, `GradientLeft`, `GradientRight`, `GradientBottom` |
 * | `iconColor` | `arch-vis:iconColor` (0.7) | a CSS colour: the glyph's |
 * | `lineStyle` | `arch-vis:lineStyle` | a line from a note's: `arch-vis:SolidLine`, `DashedLine`, `DottedLine` |
 * | `sourceDecor`, `targetDecor` | `arch-vis:sourceDecor`, `targetDecor` | a line from a note's ends: `arch-vis:NoDecoration`, `OpenArrowhead`, … |
 * | `shapeType` | `arch-vis:shapeType` | the shape an element's placement is drawn as: one of its notation's alternatives (`arch-vis:alternativeStyle`) |
 * | `renderingMode` | `arch-vis:renderingMode` | `arch-vis:ShapeWithBadge`, `IconCentric`, `ShapeOnly`: the figure an element's placement is drawn as (the Figure tab) |
 * | `lineWidth` | `arch-vis:lineWidth` (0.7) | a positive integer |
 * | `borderStyle` | `arch-vis:borderStyle` | `arch-vis:SolidLine`, `DashedLine`, `DottedLine` |
 * | `fontName` | `arch-vis:fontName` | a font family |
 * | `fontSize` | `arch-vis:fontSize` | a positive integer, in the diagram's units |
 * | `fontStyle` | `arch-vis:fontStyle` (0.7) | `bold`, `italic`, `underline`, separated by spaces |
 * | `textAlignment` | `arch-vis:textAlignment` (0.7) | `arch-vis:AlignLeft`, `AlignCenter`, `AlignRight` |
 * | `textPosition` | `arch-vis:textPosition` (0.7) | `arch-vis:PositionTop`, `PositionMiddle`, `PositionBottom` |
 *
 * ## A colour's alpha
 *
 * core-vis says a colour is a CSS colour string, its alpha CSS's (0–1), but
 * the ArchiMate converter wrote the exchange format's alpha as it is before
 * core-vis 0.7 said so — a percentage, `rgba(255,247,179,100)` — or out of
 * 255. CSS reads any alpha above 1 as opaque, so {@link cssColour} reads one
 * above 1 as meant: a percentage up to 100, else out of 255. la-gram writes
 * `#rrggbb`, or `#rrggbbaa` when a colour is not opaque, which no reader can
 * take two ways.
 */

import { NAMESPACES } from '../rdf-engine/namespaces.js';

const VIS = NAMESPACES['arch-vis'];

export type TextAlignment = 'left' | 'center' | 'right';
export type TextPosition = 'top' | 'middle' | 'bottom';
export type BorderStyle = 'SolidLine' | 'DashedLine' | 'DottedLine';
/** What an end of a line is drawn with (core-vis's `arch-vis:Decoration`s). */
export type LineDecoration =
  | 'NoDecoration'
  | 'OpenArrowhead'
  | 'ClosedArrowhead'
  | 'HollowArrowhead'
  | 'HollowDiamond'
  | 'FilledDiamond'
  | 'HalfArrowhead'
  | 'CircleDot';
const DECORATION_NAMES: readonly LineDecoration[] = [
  'NoDecoration',
  'OpenArrowhead',
  'ClosedArrowhead',
  'HollowArrowhead',
  'HollowDiamond',
  'FilledDiamond',
  'HalfArrowhead',
  'CircleDot',
];

/** How an element is drawn: a shape with its glyph as a badge, the glyph as the figure, or the shape alone. */
export type FigureMode = 'ShapeWithBadge' | 'IconCentric' | 'ShapeOnly';
/** The side a fill shades from — its colour there, white at the opposite side. */
export type Gradient = 'top' | 'left' | 'right' | 'bottom';

export interface Appearance {
  fillColor?: string;
  /** None when absent: the fill all one colour. */
  gradient?: Gradient;
  lineColor?: string;
  fontColor?: string;
  lineWidth?: number;
  borderStyle?: BorderStyle;
  /** The colour of an element's glyph — its badge, or its icon — drawn as published when absent. */
  iconColor?: string;
  fontName?: string;
  fontSize?: number;
  /** `bold`, `italic`, `underline`, separated by spaces, in that order. */
  fontStyle?: string;
  textAlignment?: TextAlignment;
  textPosition?: TextPosition;
  /** The figure an element's placement is drawn as, in place of its notation's (the Figure tab). */
  renderingMode?: FigureMode;
  /** The shape it is drawn as, by IRI — a figure's, or one of its notation's alternatives (the Figure tab). */
  shapeType?: string;
  /** A line from a note's style — a relationship's is its notation's, which says what it is. */
  lineStyle?: BorderStyle;
  /** What a line from a note is drawn with at its start, and at its end. */
  sourceDecor?: LineDecoration;
  targetDecor?: LineDecoration;
}

export type AppearanceKey = keyof Appearance;

/** Changes to an appearance: a value sets it, `null` takes it back to the default, absent leaves it. */
export type AppearanceChanges = { [K in AppearanceKey]?: Appearance[K] | null };

/** The keys, in the order the Appearance tab lists them. */
export const APPEARANCE_KEYS: readonly AppearanceKey[] = [
  'fillColor',
  'gradient',
  'lineColor',
  'lineWidth',
  'borderStyle',
  'iconColor',
  'textAlignment',
  'textPosition',
  'fontName',
  'fontSize',
  'fontStyle',
  'fontColor',
  'renderingMode',
  'shapeType',
  'lineStyle',
  'sourceDecor',
  'targetDecor',
];

const ENUMERATIONS = {
  borderStyle: { SolidLine: VIS + 'SolidLine', DashedLine: VIS + 'DashedLine', DottedLine: VIS + 'DottedLine' },
  textAlignment: { left: VIS + 'AlignLeft', center: VIS + 'AlignCenter', right: VIS + 'AlignRight' },
  textPosition: { top: VIS + 'PositionTop', middle: VIS + 'PositionMiddle', bottom: VIS + 'PositionBottom' },
  gradient: { top: VIS + 'GradientTop', left: VIS + 'GradientLeft', right: VIS + 'GradientRight', bottom: VIS + 'GradientBottom' },
  renderingMode: { ShapeWithBadge: VIS + 'ShapeWithBadge', IconCentric: VIS + 'IconCentric', ShapeOnly: VIS + 'ShapeOnly' },
  lineStyle: { SolidLine: VIS + 'SolidLine', DashedLine: VIS + 'DashedLine', DottedLine: VIS + 'DottedLine' },
  sourceDecor: Object.fromEntries(DECORATION_NAMES.map((name) => [name, VIS + name])) as Record<LineDecoration, string>,
  targetDecor: Object.fromEntries(DECORATION_NAMES.map((name) => [name, VIS + name])) as Record<LineDecoration, string>,
} as const satisfies Partial<Record<AppearanceKey, Record<string, string>>>;

/** Each key's predicate. */
export const APPEARANCE_PREDICATES: Record<AppearanceKey, string> = {
  fillColor: VIS + 'fillColor',
  gradient: VIS + 'gradient',
  lineColor: VIS + 'lineColor',
  fontColor: VIS + 'fontColor',
  iconColor: VIS + 'iconColor',
  lineWidth: VIS + 'lineWidth',
  borderStyle: VIS + 'borderStyle',
  fontName: VIS + 'fontName',
  fontSize: VIS + 'fontSize',
  fontStyle: VIS + 'fontStyle',
  textAlignment: VIS + 'textAlignment',
  textPosition: VIS + 'textPosition',
  renderingMode: VIS + 'renderingMode',
  shapeType: VIS + 'shapeType',
  lineStyle: VIS + 'lineStyle',
  sourceDecor: VIS + 'sourceDecor',
  targetDecor: VIS + 'targetDecor',
};

/** How a value is written: an enumeration's member (an IRI), an integer, or a string. */
export function appearanceObject(
  key: AppearanceKey,
  value: NonNullable<Appearance[AppearanceKey]>,
): { iri: string } | { integer: number } | { string: string } | undefined {
  if (isEnumeration(key)) {
    const iri = (ENUMERATIONS[key] as Record<string, string>)[String(value)];
    return iri ? { iri } : undefined;
  }
  if (key === 'shapeType') {
    const iri = String(value).trim();
    return /^[a-z][\w+.-]*:/i.test(iri) ? { iri } : undefined;
  }
  if (key === 'lineWidth' || key === 'fontSize') {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 ? { integer: n } : undefined;
  }
  if (key === 'fontStyle') {
    const style = fontStyleOf(String(value));
    return style ? { string: style } : undefined;
  }
  const text = String(value).trim();
  return text ? { string: text } : undefined;
}

/** A value as read from a style: `undefined` for what is not one of the key's. */
export function appearanceValue<K extends AppearanceKey>(key: K, term: { termType: string; value: string }): Appearance[K] | undefined {
  const value = term.value.trim();
  if (isEnumeration(key)) {
    const members = ENUMERATIONS[key] as Record<string, string>;
    return Object.keys(members).find((member) => members[member] === value) as Appearance[K] | undefined;
  }
  if (key === 'shapeType') return (term.termType === 'NamedNode' ? value : undefined) as Appearance[K] | undefined;
  if (key === 'lineWidth' || key === 'fontSize') {
    const n = Number(value);
    return (Number.isFinite(n) && n > 0 ? n : undefined) as Appearance[K] | undefined;
  }
  if (key === 'fontStyle') return fontStyleOf(value) as Appearance[K] | undefined;
  if (key === 'fillColor' || key === 'lineColor' || key === 'fontColor' || key === 'iconColor') {
    return (value ? cssColour(value) : undefined) as Appearance[K] | undefined;
  }
  return (value || undefined) as Appearance[K] | undefined;
}

function isEnumeration(key: AppearanceKey): key is keyof typeof ENUMERATIONS {
  return key in ENUMERATIONS;
}

const FONT_STYLES = ['bold', 'italic', 'underline'] as const;

/** A font style's keywords, known ones only, in order; `undefined` for plain. */
export function fontStyleOf(style: string | undefined): string | undefined {
  const words = new Set((style ?? '').toLowerCase().split(/\s+/));
  const kept = FONT_STYLES.filter((word) => words.has(word));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

/** Whether a font style has a keyword. */
export function hasFontStyle(style: string | undefined, word: (typeof FONT_STYLES)[number]): boolean {
  return (style ?? '').split(/\s+/).includes(word);
}

// ── Colours ─────────────────────────────────────────────────────────────

/** A colour's red, green and blue (0–255) and alpha (0–1); `undefined` for what la-gram cannot read. */
export function parseColour(colour: string | undefined): { r: number; g: number; b: number; a: number } | undefined {
  const value = colour?.trim().toLowerCase();
  if (!value) return undefined;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const byte = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
    return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? round3(byte(3) / 255) : 1 };
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*(%?)\s*)?\)$/.exec(value);
  if (!rgb) return undefined;
  const channel = (i: number) => Math.min(255, Number(rgb[i]));
  return { r: channel(1), g: channel(2), b: channel(3), a: alphaOf(rgb[4], rgb[5] === '%') };
}

/**
 * An `rgba()` alpha as meant: CSS's 0–1, a percentage — the exchange format's,
 * written as it is, up to 100 — or out of 255 beyond it.
 */
function alphaOf(text: string | undefined, percent: boolean): number {
  if (text === undefined) return 1;
  const n = Number(text);
  if (!Number.isFinite(n)) return 1;
  if (percent) return clamp01(n / 100);
  if (n <= 1) return clamp01(n);
  return clamp01(n <= 100 ? n / 100 : n / 255);
}

/**
 * A colour as CSS should draw it: `#rrggbb`, or `#rrggbbaa` when it is not
 * opaque — its alpha read as meant (see the module's notes). A colour la-gram
 * cannot read (a name: `red`) is kept as it is.
 */
export function cssColour(colour: string): string {
  const parts = parseColour(colour);
  if (!parts) return colour.trim();
  return withAlpha(hexOf(parts), parts.a);
}

/** A colour as `#rrggbb`, what a colour picker shows; `undefined` for what la-gram cannot read. */
export function hexColour(colour: string | undefined): string | undefined {
  const parts = parseColour(colour);
  return parts ? hexOf(parts) : undefined;
}

/** A colour's opacity, 0–1: 1 for an opaque one, or one la-gram cannot read. */
export function colourAlpha(colour: string | undefined): number {
  return parseColour(colour)?.a ?? 1;
}

/** `#rrggbb` at `alpha` (0–1): itself when opaque, else `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const base = hexColour(hex) ?? hex;
  const a = clamp01(alpha);
  return a >= 1 ? base : `${base}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

function hexOf(parts: { r: number; g: number; b: number }): string {
  return `#${[parts.r, parts.g, parts.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Whether two appearances say the same. */
export function sameAppearance(a: Appearance | undefined, b: Appearance | undefined): boolean {
  return APPEARANCE_KEYS.every((key) => (a?.[key] ?? undefined) === (b?.[key] ?? undefined));
}

/** The look a style — a notation's, a thing's own — says, from whatever of the keys it has. */
export function lookOf(style: object | undefined): Appearance {
  const look: Record<string, unknown> = {};
  if (!style) return look as Appearance;
  for (const key of APPEARANCE_KEYS) {
    // A notation's shape type is the shape's local name, not a placement's IRI: not a look to take over.
    if (key === 'shapeType') continue;
    const value = (style as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) look[key] = value;
  }
  return look as Appearance;
}

/** An appearance with nothing set is none. */
export function appearanceOrNone(appearance: Appearance): Appearance | undefined {
  return APPEARANCE_KEYS.some((key) => appearance[key] !== undefined) ? appearance : undefined;
}
