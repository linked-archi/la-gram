/**
 * *Arrange view…*'s settings (ELK task, R11): the direction, the spacing and whether to keep bands —
 * remembered per browser, as the canvas toolbar's switches are (`notation-only.ts`).
 */

import type { LayoutDirection, LayoutSpacing } from '../layout/layout-types.js';

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
