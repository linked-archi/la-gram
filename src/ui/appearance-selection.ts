/**
 * What the property panel's Appearance tab edits: the things selected on the
 * canvas — an element's placement, a figure, a relationship's line, a line from
 * a note — each by its node's or link's IRI, as one. The tab shows the first
 * one's own look over what it is drawn with where it sets nothing, offers the
 * fields every one of them has, and a change applies to them all.
 */

import { APPEARANCE_KEYS, type Appearance, type AppearanceKey } from '../model-manager/appearance.js';
import type { FigureKind } from '../model-manager/interfaces.js';
import { FIGURE_DEFAULT_COLOURS } from './figure-bar.js';
import { NOTATION_DEFAULTS } from './canvas/notation-shapes.js';

/** What a thing drawn is, for its look: an element's placement, a figure of a kind, a line. */
export type AppearanceKind = 'element' | 'relationship' | 'connector' | FigureKind;

const FIGURE_KEYS = APPEARANCE_KEYS.filter((key) => key !== 'iconColor');

/**
 * The fields each kind has. Only an element has a glyph to colour. A
 * relationship's line keeps its notation's line style, which says what kind of
 * relationship it is; a group's name sits in its tab; a line from a note has
 * no text.
 */
export const APPEARANCE_FIELDS: Record<AppearanceKind, readonly AppearanceKey[]> = {
  element: APPEARANCE_KEYS,
  shape: FIGURE_KEYS,
  note: FIGURE_KEYS,
  group: FIGURE_KEYS.filter((key) => key !== 'textAlignment' && key !== 'textPosition'),
  relationship: ['lineColor', 'lineWidth', 'fontName', 'fontSize', 'fontStyle', 'fontColor'],
  connector: ['lineColor', 'lineWidth'],
};

/** One thing selected: its node's or link's IRI, and what it is. */
export interface AppearanceTarget {
  iri: string;
  kind: AppearanceKind;
}

export interface AppearanceSelection {
  targets: AppearanceTarget[];
  /** What the first one sets on its own style. */
  own: Appearance;
  /** What the first one is drawn with where it sets nothing: its notation's, or la-gram's. */
  defaults: Appearance;
  /** The fields every one selected has, in the tab's order. */
  fields: AppearanceKey[];
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
 * colours and outline — its text in the notation's text colour, else its line
 * colour, as core-vis has it — centred; its glyph as published, shown black.
 */
export function elementDefaults(notation: { fillColor?: string; lineColor?: string; fontColor?: string; borderStyle?: Appearance['borderStyle'] } | undefined): Appearance {
  const lineColor = notation?.lineColor ?? NOTATION_DEFAULTS.lineColor;
  return {
    ...BASE,
    fillColor: notation?.fillColor ?? NOTATION_DEFAULTS.fillColor,
    lineColor,
    fontColor: notation?.fontColor ?? lineColor,
    borderStyle: notation?.borderStyle ?? 'SolidLine',
    iconColor: '#000000',
    textAlignment: 'center',
    textPosition: 'middle',
  };
}

/** How a line is drawn where it sets nothing: its notation's colour — a line from a note's own grey — its name in it. */
export function lineDefaults(lineColor: string | undefined): Appearance {
  const colour = lineColor ?? NOTATION_DEFAULTS.lineColor;
  return { ...BASE, lineColor: colour, fontColor: colour };
}

/** The look a figure's info carries. */
export function appearanceOfFigure(figure: Appearance): Appearance {
  const own: Record<string, unknown> = {};
  for (const key of APPEARANCE_KEYS) if (figure[key] !== undefined) own[key] = figure[key];
  return own as Appearance;
}
