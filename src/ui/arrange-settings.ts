/**
 * The arrange options' settings, remembered per browser as the canvas toolbar's switches are
 * (`notation-only.ts`): *Arrange view…*'s direction, spacing and bands (ELK task, R11); *Align to grid…*'s grid
 * and axis, and *Sizes…*'s reference and dimension (Req 22), which the toolbar's quick actions use too.
 */

import type { LayoutDirection, LayoutSpacing } from '../layout/layout-types.js';
import type { GridAxis, SizeDimension, SizeReference } from '../layout/arrange-geometry.js';

export interface ArrangeSettings {
  direction: LayoutDirection;
  spacing: LayoutSpacing;
  bands: boolean;
}

export const ARRANGE_DEFAULTS: ArrangeSettings = { direction: 'DOWN', spacing: 'normal', bands: true };

const KEY = 'la-gram:arrange-view';
const DIRECTIONS: readonly LayoutDirection[] = ['DOWN', 'RIGHT', 'UP', 'LEFT'];
const SPACINGS: readonly LayoutSpacing[] = ['compact', 'normal', 'roomy'];

/** The settings remembered, each checked; the defaults for what is not. */
export function arrangeSettings(): ArrangeSettings {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<ArrangeSettings>;
    return {
      direction: DIRECTIONS.includes(saved.direction as LayoutDirection) ? (saved.direction as LayoutDirection) : ARRANGE_DEFAULTS.direction,
      spacing: SPACINGS.includes(saved.spacing as LayoutSpacing) ? (saved.spacing as LayoutSpacing) : ARRANGE_DEFAULTS.spacing,
      bands: typeof saved.bands === 'boolean' ? saved.bands : ARRANGE_DEFAULTS.bands,
    };
  } catch {
    return { ...ARRANGE_DEFAULTS };
  }
}

export function rememberArrangeSettings(settings: ArrangeSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* not remembered: fine */
  }
}

/** *Align to grid…*'s settings (Req 22.4), which the toolbar's quick action uses too. */
export interface GridSettings {
  grid: number;
  axis: GridAxis;
}

export const GRID_DEFAULTS: GridSettings = { grid: 20, axis: 'both' };
export const GRID_SIZES: readonly number[] = [10, 20, 40];
const GRID_KEY = 'la-gram:arrange-grid';
const GRID_AXES: readonly GridAxis[] = ['both', 'x', 'y'];

export function gridSettings(): GridSettings {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(GRID_KEY) ?? '{}') as Partial<GridSettings>;
    return {
      grid: GRID_SIZES.includes(saved.grid as number) ? (saved.grid as number) : GRID_DEFAULTS.grid,
      axis: GRID_AXES.includes(saved.axis as GridAxis) ? (saved.axis as GridAxis) : GRID_DEFAULTS.axis,
    };
  } catch {
    return { ...GRID_DEFAULTS };
  }
}

export function rememberGridSettings(settings: GridSettings): void {
  try {
    globalThis.localStorage?.setItem(GRID_KEY, JSON.stringify(settings));
  } catch {
    /* not remembered: fine */
  }
}

/** *Sizes…*'s settings (Req 22.5): what the toolbar's match buttons match to. */
export interface SizeSettings {
  reference: SizeReference;
  dimension: SizeDimension;
}

export const SIZE_DEFAULTS: SizeSettings = { reference: 'largest', dimension: 'both' };
const SIZE_KEY = 'la-gram:arrange-sizes';
const REFERENCES: readonly SizeReference[] = ['largest', 'smallest', 'median'];
const DIMENSIONS: readonly SizeDimension[] = ['both', 'width', 'height'];

export function sizeSettings(): SizeSettings {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(SIZE_KEY) ?? '{}') as Partial<SizeSettings>;
    return {
      reference: REFERENCES.includes(saved.reference as SizeReference) ? (saved.reference as SizeReference) : SIZE_DEFAULTS.reference,
      dimension: DIMENSIONS.includes(saved.dimension as SizeDimension) ? (saved.dimension as SizeDimension) : SIZE_DEFAULTS.dimension,
    };
  } catch {
    return { ...SIZE_DEFAULTS };
  }
}

export function rememberSizeSettings(settings: SizeSettings): void {
  try {
    globalThis.localStorage?.setItem(SIZE_KEY, JSON.stringify(settings));
  } catch {
    /* not remembered: fine */
  }
}
