// @vitest-environment jsdom

/**
 * A notation's own shapes, drawn from the path templates its notation file
 * declares (`arch-vis:outlinePath`, `detailPath`, `contentBox`, `labelBox`,
 * `shapeVariables`) — ArchiMate's as the bundled files declare them, C4's and
 * EDGY's as linked-archi-meta does (mirrored in the fixtures). The expectations
 * are the ones the shapes had when they were coded here, and the published
 * pictures they reproduce.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getIntersections } from 'diagram-js/lib/layout/LayoutUtil.js';
import type { CustomShape } from '@linked-archi/kernel/metamodel-manager/notation.js';
import {
  ShapeTemplateError,
  drawCustomShape,
  evaluateExpression,
  fillTemplate,
  shapeGeometry,
  shapeLayout,
  shapePath,
  translatePath,
} from '../notation-shapes.js';
import { archimateShape, C4_SHAPES, EDGY_SHAPES } from './notation-shape-fixtures.js';

const AM4 = (name: string) => archimateShape(name, '4.0');
const AM3 = (name: string) => archimateShape(name, '3.2');

afterEach(() => vi.restoreAllMocks());

describe('template expressions', () => {
  const names = { w: 130, h: 60, b: 10.4 };

  it('evaluate numbers, names, + - * /, parentheses, min and max, by precedence', () => {
    expect(evaluateExpression('h - 4 * b', names)).toBeCloseTo(18.4);
    expect(evaluateExpression('(w + h) / 2', names)).toBe(95);
    expect(evaluateExpression('min(h * 0.2, w * 0.2, 12)', names)).toBe(12);
    expect(evaluateExpression('max(200, w / 2)', names)).toBe(200);
    expect(evaluateExpression('-b + -(-1)', names)).toBeCloseTo(-9.4);
    expect(evaluateExpression('.5 * w', names)).toBe(65);
  });

  it('refuse anything else, rather than evaluate it as code', () => {
    for (const bad of ['x + 1', 'sqrt(4)', 'w +', '1 2', 'w / 0', 'alert(1)', 'w; h', 'constructor']) {
      expect(() => evaluateExpression(bad, names), bad).toThrow(ShapeTemplateError);
    }
  });

  it('fill a template in the compact path form, two decimals', () => {
    expect(fillTemplate('M0,{b} L{w},{b} A{b / 3},{b / 3} 0 0 1 {w},{h}', names)).toBe('M0,10.4L130,10.4A3.47,3.47 0 0 1 130,60');
  });

  it('move a path by an offset, leaving arc radii and flags alone', () => {
    expect(translatePath('M0,6A50,6 0 0 1 100,6L100,54C50,18 50,80 0,54Q1,2 3,4H5V7Z', 10, 20)).toBe(
      'M10,26A50,6 0 0 1 110,26L110,74C60,38 60,100 10,74Q11,22 13,24H15V27Z',
    );
    expect(() => translatePath('m0,0 l10,10', 1, 1)).toThrow(ShapeTemplateError);
  });

  it('draw a shape whose templates cannot be evaluated as its fallback, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: CustomShape = { iri: 'https://example.org/n#Broken', fallback: 'Hexagon', outline: 'M0,0 L{nope},0 Z' };
    expect(drawCustomShape(broken, 100, 60)).toBeUndefined();
    expect(shapeGeometry(broken, 100, 60)).toEqual(shapeGeometry('Hexagon', 100, 60));
    expect(shapePath(broken, 10, 20, 100, 60)).toBe(shapePath('Hexagon', 10, 20, 100, 60));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/** Every number in a path or point list, H and V expanded into full pairs. */
function pathNumbers(d: string): number[] {
  const numbers = (text: string) => (text.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map((n) => Math.round(Number(n) * 100) / 100);
  if (!/[A-Za-z]/.test(d)) return numbers(d);
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const [, command, args] of d.matchAll(/([MLHVCQAZ])([^MLHVCQAZ]*)/gi)) {
    const values = numbers(args!);
    if (command === 'H') x = values[0]!;
    else if (command === 'V') y = values[0]!;
    else if (values.length >= 2) [x, y] = values.slice(-2) as [number, number];
    if (command === 'H' || command === 'V') out.push(x, y);
    else out.push(...values);
  }
  return out;
}

/** The first attribute `name` of element `tag` in an SVG file, before any nested badge. */
function pictureAttribute(path: string, tag: string, name: string): string {
  const text = readFileSync(join(process.cwd(), 'node_modules/@linked-archi/kernel/assets', path), 'utf8');
  const outer = text.slice(0, text.indexOf('<svg', 5) > 0 ? text.indexOf('<svg', 5) : undefined);
  const element = new RegExp(`<${tag}\\b[^>]*\\b${name}=['"]([^'"]+)['"]`).exec(outer);
  if (!element) throw new Error(`${path}: no <${tag} ${name}>`);
  return element[1]!;
}

describe('ArchiMate\'s shapes, from its notation files', () => {
  // 100 × 60 at (10, 20), as the core shapes' outlines are checked.
  const at = (shape: CustomShape) => shapePath(shape, 10, 20, 100, 60);

  it('outline as they did when coded here', () => {
    // Inner lines are not outline: these dock as the rectangle.
    for (const name of ['BandedRectangle', 'TabbedRectangle']) expect(at(AM4(name)), name).toBe('M10,20L110,20L110,80L10,80Z');
    expect(at(AM3('DoubleBandedRectangle'))).toBe('M10,20L110,20L110,80L10,80Z');
    // Depth 12 = h * 0.2: the front face plus the top and side faces.
    expect(at(AM4('Box3D'))).toBe('M10,32L22,20L110,20L110,68L98,80L10,80Z');
    // Band 10.4 = h * 0.173; the wave's control points 3 bands above and below its ends.
    expect(at(AM4('WavyRectangle'))).toBe('M10,20L110,20L110,69.6C60,38.4 60,100.8 10,69.6Z');
    expect(at(AM3('WavyBandedRectangle'))).toBe('M10,20L110,20L110,69.6C60,38.4 60,100.8 10,69.6Z');
    // The published 130 × 60 cloud, scaled to 100 × 60.
    expect(at(AM4('Cloud'))).toBe('M32,29.6Q46,12.8 67,29.6Q97,17.6 102,42.2Q122,63.8 87,72.2Q62,89 37,67.4Q6,72.2 16,50.6Q2,29.6 32,29.6Z');
    // Tab 80 × 21 = w * 0.8 by h * 0.35.
    expect(at(AM4('Folder'))).toBe('M10,20L90,20L90,41L110,41L110,80L10,80Z');
  });

  it('draw inner lines where they have them', () => {
    const details = (shape: CustomShape) => shapeGeometry(shape, 130, 60).details;
    expect(details(AM4('BandedRectangle'))).toBe('M0,10.4L130,10.4');
    expect(details(AM3('DoubleBandedRectangle'))).toBe('M0,10.4L130,10.4M0,49.6L130,49.6');
    expect(details(AM4('TabbedRectangle'))).toBe('M0,10.4L65,10.4L65,0');
    // The front face's top and right edges, and the edge from its corner to the back.
    expect(details(AM4('Box3D'))).toBe('M0,12L118,12L118,60M118,12L130,0');
    expect(details(AM4('WavyRectangle'))).toBeUndefined();
    expect(details(AM3('WavyBandedRectangle'))).toBe('M0,10.4L130,10.4');
    expect(details(AM4('Cloud'))).toBeUndefined();
    expect(details(AM4('Folder'))).toBe('M0,21L104,21');
  });

  it('keep the band and the 3D depth in proportion to the height, up to a limit', () => {
    expect(shapeGeometry(AM4('BandedRectangle'), 120, 55).details).toBe('M0,9.53L120,9.53');
    expect(shapeGeometry(AM4('BandedRectangle'), 300, 200).details).toBe('M0,14L300,14');
    expect(shapeGeometry(AM4('Box3D'), 300, 200).attrs['d']).toBe('M0,12L12,0L300,0L300,188L288,200L0,200Z');
    // A large folder's tab stops at 200 wide or half the width, and 21 high.
    expect(shapeGeometry(AM4('Folder'), 300, 200).attrs['d']).toBe('M0,0L200,0L200,21L300,21L300,200L0,200Z');
    expect(shapeGeometry(AM4('Folder'), 600, 400).attrs['d']).toBe('M0,0L300,0L300,21L600,21L600,400L0,400Z');
  });

  it('keep the badge and label below a band, on the front face, above a wave; a folder\'s label in its tab', () => {
    expect(shapeLayout(AM4('BandedRectangle'), 130, 60).content).toEqual({ x: 0, y: 10.4, width: 130, height: 49.6 });
    expect(shapeLayout(AM3('DoubleBandedRectangle'), 130, 60).content).toEqual({ x: 0, y: 10.4, width: 130, height: 39.2 });
    expect(shapeLayout(AM4('Box3D'), 130, 60).content).toEqual({ x: 0, y: 12, width: 118, height: 48 });
    expect(shapeLayout(AM4('WavyRectangle'), 130, 60).content).toEqual({ x: 0, y: 0, width: 130, height: 49.6 });
    const folder = shapeLayout(AM4('Folder'), 130, 60);
    expect(folder.label).toEqual({ x: 0, y: 0, width: 104, height: 21 });
    expect(folder.maxLabelLines).toBe(1);
    expect(folder.content).toEqual({ x: 0, y: 21, width: 130, height: 39 });
  });

  it('keep the wave and the cloud inside the bounds', () => {
    // Sample the curves: a lobe or wave that bulged out would draw outside the
    // shape's box, under its neighbours and outside its selection outline.
    const W = 120;
    const H = 55;
    const sample = (d: string) => {
      const points: Array<[number, number]> = [];
      let from: [number, number] = [0, 0];
      for (const [, command, args] of d.matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
        const v = (args!.match(/-?[\d.]+/g) ?? []).map(Number);
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i + 1 < v.length; i += 2) pairs.push([v[i]!, v[i + 1]!]);
        for (let s = 0; s <= 20; s += 1) {
          const k = s / 20;
          const u = 1 - k;
          if (command === 'C') {
            const [p1, p2, p3] = pairs as [[number, number], [number, number], [number, number]];
            points.push([0, 1].map((a) => u ** 3 * from[a]! + 3 * u * u * k * p1[a]! + 3 * u * k * k * p2[a]! + k ** 3 * p3[a]!) as [number, number]);
          } else if (command === 'Q') {
            const [p1, p2] = pairs as [[number, number], [number, number]];
            points.push([0, 1].map((a) => u * u * from[a]! + 2 * u * k * p1[a]! + k * k * p2[a]!) as [number, number]);
          }
        }
        if (pairs.length > 0) from = pairs[pairs.length - 1]!;
      }
      return points;
    };
    for (const shape of [AM4('WavyRectangle'), AM4('Cloud')]) {
      const points = sample(shapePath(shape, 0, 0, W, H));
      expect(points.length, shape.iri).toBeGreaterThan(0);
      for (const [x, y] of points) {
        expect(x, shape.iri).toBeGreaterThanOrEqual(0);
        expect(x, shape.iri).toBeLessThanOrEqual(W);
        expect(y, shape.iri).toBeGreaterThanOrEqual(0);
        expect(y, shape.iri).toBeLessThanOrEqual(H);
      }
    }
  });

  it('reproduce the published ArchiMate pictures at their 130 × 60 size', () => {
    // The wavy box and the cloud — a deliverable's and a meaning's other figure now — as their published
    // pictures drew them.
    expect(pathNumbers(shapePath(AM4('WavyRectangle'), 0, 0, 130, 60))).toEqual(
      pathNumbers('M 0 0 H 130.0 V 49.6 C 65.0,18.4 65.0,80.8 0,49.6Z'),
    );
    expect(pathNumbers(shapePath(AM4('Cloud'), 0, 0, 130, 60))).toEqual(
      pathNumbers(
        'M 28.6 9.6 Q 46.8 -7.199999999999999 74.1 9.6 Q 113.1 -2.4 119.60000000000001 22.2 Q 145.60000000000002 43.8 100.10000000000001 52.2 Q 67.60000000000001 69.0 35.1 47.400000000000006 Q -5.2 52.2 7.8 30.6 Q -10.4 9.6 28.6 9.6',
      ),
    );
    // A device, a product, an object and a contract are drawn as a box with its glyph now; the 3D,
    // tabbed and banded boxes stay declared — the other figure each may be drawn as — as the
    // published pictures drew them before: the 3D silhouette (open at the bottom left, which the
    // outline closes), the product's tab, the band at the top.
    expect(pathNumbers(shapePath(AM4('Box3D'), 0, 0, 130, 60))).toEqual([0, 12, 12, 0, 130, 0, 130, 48, 118, 60, 0, 60]);
    expect(pathNumbers(shapeGeometry(AM4('TabbedRectangle'), 130, 60).details!)).toEqual([0, 10.4, 65, 10.4, 65, 0]);
    expect(shapeGeometry(AM4('BandedRectangle'), 130, 60).details).toBe('M0,10.4L130,10.4');
    // The folder — a grouping's other figure, as its published picture drew it — its tab up the
    // left edge, across, and down to the body.
    const tab = [0, 21, 0, 0, 104, 0, 104, 21];
    expect(pathNumbers(shapePath(AM4('Folder'), 0, 0, 130, 60)).slice(0, 6)).toEqual(tab.slice(2));
  });
});

describe('C4\'s and EDGY\'s shapes', () => {
  it('reproduce the C4 pictures at their sizes: person, mobile app, web browser and database', () => {
    // person.svg, 120 × 120: the head at 60,20 with radius 18; the body from 42 with corners of 18.
    expect(shapePath(C4_SHAPES.Person, 0, 0, 120, 120)).toMatch(/^M18,42L102,42A18,18 .*ZM42,19\.8A18,18 0 0 1 78,19\.8/);
    expect(shapeLayout(C4_SHAPES.Person, 120, 120).content).toEqual({ x: 0, y: 42, width: 120, height: 78 });
    // mobile-app.svg, 160 × 110: the screen 10–150 × 14–104, the home button at 80,7 with radius 3.
    expect(shapeLayout(C4_SHAPES.MobileDevice, 160, 110).content).toEqual({ x: 9.9, y: 14.3, width: 140.2, height: 89.65 });
    expect(shapeGeometry(C4_SHAPES.MobileDevice, 160, 110).details).toContain('M77.03,7.15A2.97,2.97 0 0 1 82.97,7.15');
    // web-browser.svg, 160 × 110: the content area 3–157 × 17–107, dots at 10, 20 and 30, the bar from 38 to 153.
    expect(shapeLayout(C4_SHAPES.WebBrowser, 160, 110).content).toEqual({ x: 3, y: 17.05, width: 154, height: 89.95 });
    const browser = shapeGeometry(C4_SHAPES.WebBrowser, 160, 110).details!;
    for (const dot of ['M7.16,9.04', 'M17.39,9.04', 'M27.62,9.04']) expect(browser).toContain(dot);
    expect(browser).toContain('M42.28,5.12L149.08,5.12');
    // database.svg, 160 × 110: the rim's half-height 15.
    expect(shapePath(C4_SHAPES.Cylinder, 0, 0, 160, 110)).toBe('M0,14.85A80,14.85 0 0 1 160,14.85L160,95.15A80,14.85 0 0 1 0,95.15Z');
    expect(shapeGeometry(C4_SHAPES.Cylinder, 130, 60).details).toBe('M0,8.1A65,8.1 0 0 0 130,8.1');
  });

  it('draw EDGY\'s arrow as its official shape, and a pill with ends of half the height', () => {
    // EDGY 23's Shape-Activity: points 100 81, 1 81, 1 1, 100 1, 124 41 inside a 1-unit stroke margin.
    expect(shapePath(EDGY_SHAPES.RightArrow, 0, 0, 123, 80)).toBe('M0,0L99,0L123,40L99,80L0,80Z');
    // A narrow arrow keeps its point inside the shape.
    expect(shapePath(EDGY_SHAPES.RightArrow, 0, 0, 20, 80)).toBe('M0,0L10,0L20,40L10,80L0,80Z');
    expect(shapeLayout(EDGY_SHAPES.RightArrow, 130, 60).content).toEqual({ x: 0, y: 0, width: 112, height: 60 });
    // EDGY 23's tags: an 88 × 24 pill, ends of radius 12.
    expect(shapePath(EDGY_SHAPES.Pill, 0, 0, 88, 24)).toMatch(/^M12,0L76,0A12,12 0 0 1 88,12/);
    expect(shapeLayout(EDGY_SHAPES.Pill, 90, 22).content).toEqual({ x: 5.5, y: 0, width: 79, height: 22 });
  });
});

describe('every notation shape here', () => {
  const ALL: CustomShape[] = [
    ...['BandedRectangle', 'TabbedRectangle', 'Box3D', 'WavyRectangle', 'Cloud', 'Folder'].map(AM4),
    AM3('DoubleBandedRectangle'),
    AM3('WavyBandedRectangle'),
    ...Object.values(C4_SHAPES),
    ...Object.values(EDGY_SHAPES),
  ];

  it('draws the outline it docks against', () => {
    for (const shape of ALL) {
      const geometry = shapeGeometry(shape, 100, 60);
      expect(geometry.tag, shape.iri).toBe('path');
      expect(geometry.attrs['d'], shape.iri).toBe(shapePath(shape, 0, 0, 100, 60));
    }
  });

  it('emits an outline path-intersection can intersect, wherever the shape is', () => {
    const throughTheMiddle = 'M-190,50L310,50';
    for (const shape of ALL) {
      expect(getIntersections(shapePath(shape, 10, 20, 100, 60), throughTheMiddle).length, shape.iri).toBeGreaterThanOrEqual(2);
    }
  });
});
