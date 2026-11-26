/**
 * The Graph tab's wheel zoom (Req 17.14): the same distance scrolled zooms the same, whatever sends it.
 */

import { describe, it, expect } from 'vitest';
import { wheelZoomFactor } from '../wheel-zoom.js';

const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => ({ deltaY, deltaMode, ctrlKey });

describe('wheelZoomFactor', () => {
  it('a mouse’s notch zooms by 15–18%, in or out: 100 px (Windows, macOS), 120 px (Linux), three lines (Firefox)', () => {
    expect(wheelZoomFactor(wheel(-100))).toBeCloseTo(1.149, 3);
    expect(wheelZoomFactor(wheel(-120))).toBeCloseTo(1.181, 3);
    expect(wheelZoomFactor(wheel(-3, 1))).toBeCloseTo(1.181, 3);
    expect(wheelZoomFactor(wheel(120)) * wheelZoomFactor(wheel(-120))).toBeCloseTo(1, 10);
  });

  it('a trackpad’s many small steps zoom as far as one long one: 1 000 px, four times', () => {
    let zoom = 1;
    for (let i = 0; i < 200; i++) zoom *= wheelZoomFactor(wheel(-5));
    expect(zoom).toBeCloseTo(4, 6);
  });

  it('a pinch follows the fingers: the browser’s 69 px for twice the spread, twice the zoom', () => {
    let zoom = 1;
    for (let i = 0; i < 23; i++) zoom *= wheelZoomFactor(wheel(-3, 0, true));
    expect(zoom).toBeCloseTo(Math.exp(0.69), 6);
  });

  it('no event zooms more than 1.41×: a held Ctrl with a notch, a free-spinning wheel, a page', () => {
    expect(wheelZoomFactor(wheel(-120, 0, true))).toBeCloseTo(Math.SQRT2, 10);
    expect(wheelZoomFactor(wheel(5000))).toBeCloseTo(1 / Math.SQRT2, 10);
    expect(wheelZoomFactor(wheel(-1, 2), 600)).toBeCloseTo(Math.SQRT2, 10);
  });
});
