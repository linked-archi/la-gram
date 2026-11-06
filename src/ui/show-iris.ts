/**
 * Whether lists of names show each one's IRI under it: the "Show IRIs" switch of
 * the property panel's pickers (`panels/named-picker.ts`) and of the canvas's
 * "Change type…" menu (`canvas/rdf-element-replace-menu-provider.ts`). One
 * setting, remembered per browser; entries that share a name show their IRIs
 * whatever it says, so they can be told apart.
 */

/** localStorage key of the setting. */
const SHOW_IRIS_KEY = 'la-gram:picker-show-iris';

/** Whether IRIs are shown; off when nothing is remembered or storage is unavailable. */
export function showIris(): boolean {
  try {
    return globalThis.localStorage?.getItem(SHOW_IRIS_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remember the setting. */
export function rememberShowIris(shown: boolean): void {
  try {
    globalThis.localStorage?.setItem(SHOW_IRIS_KEY, String(shown));
  } catch {
    /* not remembered: fine */
  }
}

/** The names, lower-cased, that more than one of `labels` has. */
export function sharedNames(labels: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const label of labels) {
    const name = label.toLowerCase();
    if (seen.has(name)) shared.add(name);
    seen.add(name);
  }
  return shared;
}
