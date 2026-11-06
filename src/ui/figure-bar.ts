/**
 * The canvas toolbar's row of figures — groups, notes and core-vis shapes,
 * drawing with no model element behind it — and whether it is open: closed by
 * default, remembered per browser, as the "Relationship names" switch is
 * (`relationship-names.ts`).
 */

import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { FigureKind } from '../model-manager/interfaces.js';

/** A figure the toolbar offers. */
export interface FigureChoice {
  kind: FigureKind;
  /** A shape's core-vis shape type (`arch-vis:Ellipse`). */
  shapeType?: string;
  label: string;
}

const VIS = NAMESPACES['arch-vis'];

/** The toolbar's figures, in order: a group, a note, then the shapes every renderer draws natively. */
export const FIGURE_CHOICES: readonly FigureChoice[] = [
  { kind: 'group', label: 'Group' },
  { kind: 'note', label: 'Note' },
  { kind: 'shape', shapeType: VIS + 'Rectangle', label: 'Rectangle' },
  { kind: 'shape', shapeType: VIS + 'RoundedRectangle', label: 'Rounded rectangle' },
  { kind: 'shape', shapeType: VIS + 'Ellipse', label: 'Ellipse' },
  { kind: 'shape', shapeType: VIS + 'Circle', label: 'Circle' },
  { kind: 'shape', shapeType: VIS + 'Diamond', label: 'Diamond' },
  { kind: 'shape', shapeType: VIS + 'Hexagon', label: 'Hexagon' },
  { kind: 'shape', shapeType: VIS + 'Octagon', label: 'Octagon' },
  { kind: 'shape', shapeType: VIS + 'Parallelogram', label: 'Parallelogram' },
];

/** localStorage key of the setting. */
const FIGURE_BAR_KEY = 'la-gram:canvas-figures';

/** Whether the row of figures is open; closed when nothing is remembered or storage is unavailable. */
export function figureBarOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(FIGURE_BAR_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remember the setting. */
export function rememberFigureBarOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(FIGURE_BAR_KEY, String(open));
  } catch {
    /* not remembered: fine */
  }
}
