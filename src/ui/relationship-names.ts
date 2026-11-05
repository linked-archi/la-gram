/**
 * Whether the canvas shows relationships' names on their lines: the canvas
 * toolbar's "Relationship names" switch. Off by default — a view reads its
 * relationships from their lines' notation — and remembered per browser, as
 * "Show IRIs" is (`show-iris.ts`).
 */

/** localStorage key of the setting. */
const RELATIONSHIP_NAMES_KEY = 'la-gram:canvas-relationship-names';

/** Whether names are shown; off when nothing is remembered or storage is unavailable. */
export function relationshipNamesShown(): boolean {
  try {
    return globalThis.localStorage?.getItem(RELATIONSHIP_NAMES_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remember the setting. */
export function rememberRelationshipNamesShown(shown: boolean): void {
  try {
    globalThis.localStorage?.setItem(RELATIONSHIP_NAMES_KEY, String(shown));
  } catch {
    /* not remembered: fine */
  }
}
