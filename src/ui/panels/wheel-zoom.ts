/**
 * How far one wheel event zooms the Graph tab (Req 17.14): the same distance scrolled zooms the same, whatever sends
 * it — a mouse's notches, a trackpad's stream of small steps, a pinch.
 *
 * The drawing library's own wheel zoom tells the two apart and treats them differently: a wheel whose events all
 * have one size is taken as notches, each a fixed small step, and anything else is zoomed by every pixel. A mouse on
 * Linux then needed about 90 notches to zoom in twice as far, while a trackpad zoomed sixteen times over in a
 * thousand pixels of scrolling. Here every event is measured in pixels and zoomed by its length.
 */

/** What a wheel event says that the zoom reads. */
export interface WheelLike {
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (`WheelEvent.DOM_DELTA_*`). */
  deltaMode: number;
  /** Held, or a trackpad's pinch, which browsers send as a wheel with Ctrl. */
  ctrlKey: boolean;
}

/** Pixels scrolled per doubling of the zoom: a mouse's notch, 100–120 px, zooms by 15–18%; a trackpad's 1 000 px, 4×. */
const PIXELS_PER_DOUBLING = 500;
/** A line, where the browser counts in lines (Firefox): its notch, three lines, as a notch elsewhere. */
const LINE_PIXELS = 40;
/**
 * A pinch's events: browsers give a pinch that doubles the fingers' spread about 70 px (the scale as `e^(−Δ/100)`),
 * so the drawing follows the fingers.
 */
const PINCH_PIXELS_PER_DOUBLING = 100 * Math.LN2;
/** The most one event zooms, in doublings: a held Ctrl with a mouse's notch, or a free-spinning wheel. */
const MOST = 0.5;

/** The factor one wheel event multiplies the zoom by: above 1 zooms in (scrolling up, or spreading the fingers). */
export function wheelZoomFactor(event: WheelLike, pageHeight = 800): number {
  const pixels = event.deltaMode === 1 ? event.deltaY * LINE_PIXELS : event.deltaMode === 2 ? event.deltaY * pageHeight : event.deltaY;
  const doublings = -pixels / (event.ctrlKey ? PINCH_PIXELS_PER_DOUBLING : PIXELS_PER_DOUBLING);
  return 2 ** Math.max(-MOST, Math.min(MOST, doublings));
}
