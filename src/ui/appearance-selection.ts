/**
 * What the property panel's Appearance tab edits: the things selected on the
 * canvas — an element's placement, a figure, a relationship's line, a line from
 * a note — each by its node's or link's IRI, as one. The tab shows the first
 * one's own look over what it is drawn with where it sets nothing, offers the
 * fields every one of them has, and a change applies to them all.
 */

import { APPEARANCE_KEYS, lookOf, type Appearance, type AppearanceKey, type FigureMode } from '../model-manager/appearance.js';
import type { FigureKind } from '../model-manager/interfaces.js';
import { FIGURE_DEFAULT_COLOURS } from './figure-bar.js';
import { NOTATION_DEFAULTS } from './canvas/notation-shapes.js';

/** What a thing drawn is, for its look: an element's placement, a figure of a kind, a line. */
export type AppearanceKind = 'element' | 'relationship' | 'connector' | FigureKind;

/** A line from a note's own: its style and its ends — a relationship's are its notation's, which say what it is. */
const LINE_KEYS: readonly AppearanceKey[] = ['lineStyle', 'sourceDecor', 'targetDecor'];
/** What the Appearance tab sets for a shape: all but the figure, which is the Figure tab's, and a line's own. */
const LOOK_KEYS = APPEARANCE_KEYS.filter((key) => key !== 'renderingMode' && key !== 'shapeType' && !LINE_KEYS.includes(key));
const FIGURE_KEYS = LOOK_KEYS.filter((key) => key !== 'iconColor');

/**
 * The fields each kind has. Only an element has a glyph to colour. A
 * relationship's line keeps its notation's line style, which says what kind of
 * relationship it is; a group's name sits in its tab; a line from a note has
 * no text.
 */
export const APPEARANCE_FIELDS: Record<AppearanceKind, readonly AppearanceKey[]> = {
  element: LOOK_KEYS,
  shape: FIGURE_KEYS,
  note: FIGURE_KEYS,
  group: FIGURE_KEYS.filter((key) => key !== 'textAlignment' && key !== 'textPosition'),
  relationship: ['lineColor', 'lineWidth', 'fontName', 'fontSize', 'fontStyle', 'fontColor'],
  connector: ['lineColor', 'lineWidth', 'lineStyle', 'sourceDecor', 'targetDecor', 'fontName', 'fontSize', 'fontStyle', 'fontColor'],
};

/** One thing selected: its node's or link's IRI, and what it is. */
export interface AppearanceTarget {
  iri: string;
  kind: AppearanceKind;
}

/** One figure the Figure tab offers. */
export interface FigureOption {
  label: string;
  /** How it is drawn: its rendering mode. */
  mode: FigureMode;
  /** The notation's own figure: drawn without one of the placement's own. */
  notation?: boolean;
  /** One of the notation's other figures (`arch-vis:alternativeStyle`), by its shape's IRI. */
  shapeIri?: string;
  /** What choosing it writes on each one selected: its shape and mode — none of either for the notation's own. */
  changes: { renderingMode: FigureMode | null; shapeType: string | null };
  /** Its preview: the glyph alone, or an outline 72 × 40 — its inner lines, its glyph as a badge or none. */
  preview: { icon: true } | { outline: string; details?: string; badge: boolean; dashed: boolean };
}

/**
 * The figures the selected elements may be drawn as — the Figure tab: their
 * notation's own, its other figures (when every one selected is
 * of one type), the glyph itself with the name under it, the shape alone.
 * Offered when every one selected is an element whose notation has a glyph.
 */
export interface FigureChoices {
  options: FigureOption[];
  /** The one the first selected is drawn as: an index into {@link options}. */
  selected: number;
  /** For the previews: the glyph, and the first one's fill and line colours. */
  iconHref: string;
  fillColor: string;
  lineColor: string;
}

export interface AppearanceSelection {
  targets: AppearanceTarget[];
  /** The Figure tab's choices, for elements with a glyph. */
  figure?: FigureChoices;
  /** What the first one sets on its own style. */
  own: Appearance;
  /** What the first one is drawn with where it sets nothing: its notation's, or la-gram's. */
  defaults: Appearance;
  /** The fields every one selected has, in the tab's order. */
  fields: AppearanceKey[];
  /** Those whose value — its own, else its default — differs among the selected: the tab says so. */
  mixed?: AppearanceKey[];
}

/** The fields every kind given has. */
export function fieldsFor(kinds: readonly AppearanceKind[]): AppearanceKey[] {
  return APPEARANCE_KEYS.filter((key) => kinds.every((kind) => APPEARANCE_FIELDS[kind].includes(key)));
}

/** What la-gram draws any text and line with, where neither the notation nor the thing says. */
const BASE: Appearance = {
  lineWidth: NOTATION_DEFAULTS.strokeWidth,
  borderStyle: 'SolidLine',
  fontSize: NOTATION_DEFAULTS.fontSize,
};

/** How a figure is drawn where it sets nothing: its kind's colours; a note's text from its top left. */
export function figureDefaults(kind: FigureKind): Appearance {
  return {
    ...BASE,
    ...FIGURE_DEFAULT_COLOURS[kind],
    ...(kind === 'note' ? { textAlignment: 'left', textPosition: 'top' } : { textAlignment: 'center', textPosition: 'middle' }),
  };
}

/**
 * How an element is drawn where its placement sets nothing: its notation's
 * look — its colours and outline, and what core-vis 0.7 lets a notation say of
 * its font, line width, text placement, gradient and glyph — its text in the
 * notation's text colour, else its line colour, as core-vis has it; where the
 * notation says nothing, la-gram's: centred, the glyph as published (shown
 * black).
 */
export function elementDefaults(notation: object | undefined): Appearance {
  const said = lookOf(notation);
  const lineColor = said.lineColor ?? NOTATION_DEFAULTS.lineColor;
  return {
    ...BASE,
    iconColor: '#000000',
    textAlignment: 'center',
    textPosition: 'middle',
    ...said,
    fillColor: said.fillColor ?? NOTATION_DEFAULTS.fillColor,
    lineColor,
    fontColor: said.fontColor ?? lineColor,
    borderStyle: said.borderStyle ?? 'SolidLine',
  };
}

/**
 * How a line is drawn where it sets nothing: its notation's colour, width and
 * font — a line from a note's own grey — its name in its notation's text
 * colour, else its line colour.
 */
export function lineDefaults(notation: object | undefined): Appearance {
  const said = lookOf(notation);
  const colour = said.lineColor ?? NOTATION_DEFAULTS.lineColor;
  return { ...BASE, ...said, lineColor: colour, fontColor: said.fontColor ?? colour };
}

/** The look a figure's info carries. */
export function appearanceOfFigure(figure: Appearance): Appearance {
  const own: Record<string, unknown> = {};
  for (const key of APPEARANCE_KEYS) if (figure[key] !== undefined) own[key] = figure[key];
  return own as Appearance;
}
