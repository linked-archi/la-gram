/**
 * jsdom shims for DOM APIs diagram-js calls but jsdom does not implement.
 *
 * These are not test conveniences — they fill gaps that only exist because jsdom
 * has no layout engine. Every one of them is present in a real browser, so a test
 * that needs a shim here is still exercising the production code path.
 */

/**
 * `document.elementFromPoint`.
 *
 * diagram-js's `HoverFix._findTargetGfx` calls it to recover a hover target when
 * a drag begins away from the element being dragged — which is precisely the
 * sidebar palette's gesture. It first checks `event instanceof MouseEvent`, so the
 * canvas tests that feed it diagram-js's own synthetic events never reach the
 * call; the ones that dispatch a real `MouseEvent` do, and jsdom throws.
 *
 * `null` is the honest answer: jsdom lays nothing out, so no element occupies any
 * point. `HoverFix` treats that as "no hover to fix", which leaves the drag
 * unhovered — the same state it is in before the pointer reaches the canvas.
 */
if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = (): Element | null => null;
}
