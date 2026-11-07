/**
 * Whether the canvas draws each element and relationship as its notation does,
 * leaving out the look set on it in the view (the Appearance tab's): the canvas
 * toolbar's "Notation only" switch. Off by default — a diagram converted from
 * Archi shows its own colours — and remembered per browser, as "Relationship
 * names" is (`relationship-names.ts`).
 */

/** localStorage key of the setting. */
const NOTATION_ONLY_KEY = 'la-gram:canvas-notation-only';

/** Whether the notation alone is drawn; off when nothing is remembered or storage is unavailable. */
export function notationOnly(): boolean {
  try {
    return globalThis.localStorage?.getItem(NOTATION_ONLY_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remember the setting. */
export function rememberNotationOnly(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(NOTATION_ONLY_KEY, String(on));
  } catch {
    /* not remembered: fine */
  }
}
