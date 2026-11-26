/**
 * *Line shape* (Req 22.9; `.agents/tasks/line-shape/`): the selected lines given a shape, set once as their route —
 * *Straight*, *Right angles*, *Horizontal first*, *Vertical first*. *Straight* is the canvas's (a new line's route),
 * *Right angles* the router's (`orthogonal-router.ts`); the elbows are here.
 */

import type { Point } from './orthogonal-router.js';

export type LineShape = 'straight' | 'right-angles' | 'horizontal-first' | 'vertical-first';

/** The shapes, in the order the menus offer them, with their names and what each does. */
export const LINE_SHAPES: ReadonlyArray<{ shape: LineShape; label: string; title: string }> = [
  { shape: 'straight', label: 'Straight', title: 'Straight — the bends taken out: from centre to centre' },
  { shape: 'right-angles', label: 'Right angles', title: 'Right angles — around the elements in the way; the other lines stay' },
  {
    shape: 'horizontal-first',
    label: 'Horizontal first',
    title: 'Horizontal first — one bend: out of the source sideways, into the target from above or below',
  },
  {
    shape: 'vertical-first',
    label: 'Vertical first',
    title: 'Vertical first — one bend: out of the source upwards or downwards, into the target from the side',
  },
];

/** A placement's bounds. */
export interface LineBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a straight line between two facing sides runs, along them: the middle of the smaller side where the other
 * side reaches it, else the middle of what the two share — as the router docks a straight line.
 */
function shared(aLo: number, aHi: number, bLo: number, bHi: number): number {
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  const middle = aHi - aLo <= bHi - bLo ? (aLo + aHi) / 2 : (bLo + bHi) / 2;
  return Math.round(middle >= lo && middle <= hi ? middle : (lo + hi) / 2);
}

/**
 * The elbow (LS-4, LS-DD-3): one bend, at the corner of the two centres — out of the source along `first`, at the
 * middle of the side facing the target, and into the target along the other axis, at the middle of its side. Where
 * that corner would fall inside one of them, they are side by side or one above the other, and the line runs straight
 * between their facing sides. The bend does not go around other elements. None for placements that overlap.
 */
export function elbowRoute(source: LineBox, target: LineBox, first: 'horizontal' | 'vertical'): Point[] | undefined {
  const s = { left: source.x, top: source.y, right: source.x + source.width, bottom: source.y + source.height };
  const t = { left: target.x, top: target.y, right: target.x + target.width, bottom: target.y + target.height };
  const across = s.left < t.right && t.left < s.right;
  const down = s.top < t.bottom && t.top < s.bottom;
  if (across && down) return undefined;
  const sc = { x: Math.round((s.left + s.right) / 2), y: Math.round((s.top + s.bottom) / 2) };
  const tc = { x: Math.round((t.left + t.right) / 2), y: Math.round((t.top + t.bottom) / 2) };
  const outside = (v: number, lo: number, hi: number) => v < lo || v > hi;
  if (first === 'horizontal' && outside(tc.x, s.left, s.right) && outside(sc.y, t.top, t.bottom)) {
    return [
      { x: tc.x > sc.x ? s.right : s.left, y: sc.y },
      { x: tc.x, y: sc.y },
      { x: tc.x, y: tc.y > sc.y ? t.top : t.bottom },
    ];
  }
  if (first === 'vertical' && outside(sc.x, t.left, t.right) && outside(tc.y, s.top, s.bottom)) {
    return [
      { x: sc.x, y: tc.y > sc.y ? s.bottom : s.top },
      { x: sc.x, y: tc.y },
      { x: tc.x > sc.x ? t.left : t.right, y: tc.y },
    ];
  }
  if (down) {
    const y = shared(s.top, s.bottom, t.top, t.bottom);
    return t.left >= s.right ? [{ x: s.right, y }, { x: t.left, y }] : [{ x: s.left, y }, { x: t.right, y }];
  }
  const x = shared(s.left, s.right, t.left, t.right);
  return t.top >= s.bottom ? [{ x, y: s.bottom }, { x, y: t.top }] : [{ x, y: s.top }, { x, y: t.bottom }];
}
