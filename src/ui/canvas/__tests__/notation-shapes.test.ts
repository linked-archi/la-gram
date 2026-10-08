// @vitest-environment jsdom

/**
 * Geometry for the `arch-vis:` notation vocabulary.
 *
 * jsdom has no SVG layout engine, so these assert on the produced element kind
 * and attribute values — never on measured geometry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Decoration, IconPlacement, ShapeType } from '../../../metamodel-manager/notation.js';
import {
  DECORATIONS,
  ICON_PLACEMENTS,
  NOTATION_DEFAULTS,
  SHAPE_TYPES,
  badgeBox,
  iconHref,
  labelLayout,
  markerDefinition,
  markerId,
  shapeGeometry,
  shapeLayout,
  shapePath,
  strokeDashArray,
  svgEl,
  wrapLabel,
} from '../notation-shapes.js';
import { getIntersections } from 'diagram-js/lib/layout/LayoutUtil.js';

/** Parse a `points` attribute into coordinate pairs. */
function parsePoints(points: string): Array<[number, number]> {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return [x, y] as [number, number];
    });
}

describe('shapeGeometry', () => {
  it('covers the whole ShapeType vocabulary', () => {
    expect([...SHAPE_TYPES].sort()).toEqual(
      [
        'Circle',
        'Diamond',
        'Ellipse',
        'Hexagon',
        'Octagon',
        'Parallelogram',
        'Rectangle',
        'RoundedRectangle',
        'BandedRectangle',
        'DoubleBandedRectangle',
        'TabbedRectangle',
        'Box3D',
        'WavyRectangle',
        'WavyBandedRectangle',
        'Cloud',
        'Folder',
        'Cylinder',
      ].sort(),
    );
  });

  it('draws Rectangle as a plain rect', () => {
    const geometry = shapeGeometry('Rectangle', 120, 55);
    expect(geometry.tag).toBe('rect');
    expect(geometry.attrs).toMatchObject({ x: 0, y: 0, width: 120, height: 55 });
    expect(geometry.attrs['rx']).toBeUndefined();
  });

  it('draws RoundedRectangle as a rect with corner radii', () => {
    const geometry = shapeGeometry('RoundedRectangle', 120, 55);
    expect(geometry.tag).toBe('rect');
    expect(geometry.attrs['rx']).toBe(NOTATION_DEFAULTS.cornerRadius);
    expect(geometry.attrs['ry']).toBe(NOTATION_DEFAULTS.cornerRadius);
  });

  it('clamps the corner radius on a shape smaller than the radius', () => {
    const geometry = shapeGeometry('RoundedRectangle', 8, 6);
    expect(geometry.attrs['rx']).toBe(3);
  });

  it('draws Ellipse as an ellipse filling the bounds', () => {
    const geometry = shapeGeometry('Ellipse', 120, 60);
    expect(geometry.tag).toBe('ellipse');
    expect(geometry.attrs).toMatchObject({ cx: 60, cy: 30, rx: 60, ry: 30 });
  });

  it('draws Circle as a circle sized by the smaller dimension', () => {
    const geometry = shapeGeometry('Circle', 120, 60);
    expect(geometry.tag).toBe('circle');
    expect(geometry.attrs).toMatchObject({ cx: 60, cy: 30, r: 30 });
  });

  it('draws Octagon as an eight-point polygon with cut corners', () => {
    const geometry = shapeGeometry('Octagon', 120, 60);
    expect(geometry.tag).toBe('polygon');
    const pts = parsePoints(String(geometry.attrs['points']));
    expect(pts).toHaveLength(8);
    // No point sits on a corner of the bounding box: every corner is cut.
    expect(pts).not.toContainEqual([0, 0]);
    expect(pts).not.toContainEqual([120, 60]);
  });

  it('draws Hexagon as a six-point polygon pointed left and right', () => {
    const geometry = shapeGeometry('Hexagon', 120, 60);
    expect(geometry.tag).toBe('polygon');
    const pts = parsePoints(String(geometry.attrs['points']));
    expect(pts).toHaveLength(6);
    expect(pts).toContainEqual([120, 30]);
    expect(pts).toContainEqual([0, 30]);
  });

  it('draws Diamond as a four-point polygon on the edge midpoints', () => {
    const geometry = shapeGeometry('Diamond', 120, 60);
    expect(geometry.tag).toBe('polygon');
    expect(parsePoints(String(geometry.attrs['points']))).toEqual([
      [60, 0],
      [120, 30],
      [60, 60],
      [0, 30],
    ]);
  });

  it('draws Parallelogram as a skewed four-point polygon', () => {
    const geometry = shapeGeometry('Parallelogram', 100, 50);
    expect(geometry.tag).toBe('polygon');
    expect(parsePoints(String(geometry.attrs['points']))).toEqual([
      [20, 0],
      [100, 0],
      [80, 50],
      [0, 50],
    ]);
  });

  it('produces a distinct geometry for every shape type', () => {
    const rendered = SHAPE_TYPES.map((type) => {
      const geometry = shapeGeometry(type, 120, 60);
      return `${geometry.tag}:${JSON.stringify(geometry.attrs)}:${geometry.details ?? ''}`;
    });
    expect(new Set(rendered).size).toBe(SHAPE_TYPES.length);
  });

  it('falls back to Rectangle for an absent shape type', () => {
    expect(shapeGeometry(undefined, 120, 55)).toEqual(shapeGeometry('Rectangle', 120, 55));
  });

  it('falls back to the default size for non-positive dimensions', () => {
    const geometry = shapeGeometry('Rectangle', 0, -5);
    expect(geometry.attrs).toMatchObject({
      width: NOTATION_DEFAULTS.width,
      height: NOTATION_DEFAULTS.height,
    });
  });
});

// ── shapePath ────────────────────────────────────────────────────────────

/**
 * `shapePath` is the outline connection docking crops against, so it is asserted
 * as an exact string per shape type: the path is data consumed by
 * `path-intersection`, not markup whose details do not matter.
 */
describe('shapePath', () => {
  // 100 × 60 at (10, 20) — a rectangle wider than it is tall, offset from the
  // origin, so a path that ignored either the position or an axis shows up.
  const X = 10;
  const Y = 20;
  const W = 100;
  const H = 60;

  const EXPECTED: Record<ShapeType, string> = {
    Rectangle: 'M10,20L110,20L110,80L10,80Z',
    RoundedRectangle:
      'M20,20L100,20A10,10 0 0 1 110,30' +
      'L110,70A10,10 0 0 1 100,80' +
      'L20,80A10,10 0 0 1 10,70' +
      'L10,30A10,10 0 0 1 20,20Z',
    // rx = w/2, ry = h/2 — two half sweeps from the left extreme.
    Ellipse: 'M10,50A50,30 0 0 1 110,50A50,30 0 0 1 10,50Z',
    // A true circle: r is half the *smaller* dimension, so it stays in bounds.
    Circle: 'M30,50A30,30 0 0 1 90,50A30,30 0 0 1 30,50Z',
    // Corner cut 15 = min(w, h) * 0.25.
    Octagon: 'M25,20L95,20L110,35L110,65L95,80L25,80L10,65L10,35Z',
    // Points left and right at mid-height, cut 25 = w * 0.25.
    Hexagon: 'M35,20L85,20L110,50L85,80L35,80L10,50Z',
    Diamond: 'M60,20L110,50L60,80L10,50Z',
    // Skew 20 = w * 0.2.
    Parallelogram: 'M30,20L110,20L90,80L10,80Z',
    // Inner lines are not outline: these dock as the rectangle.
    BandedRectangle: 'M10,20L110,20L110,80L10,80Z',
    DoubleBandedRectangle: 'M10,20L110,20L110,80L10,80Z',
    TabbedRectangle: 'M10,20L110,20L110,80L10,80Z',
    // Depth 12 = h * 0.2: the front face plus the top and side faces.
    Box3D: 'M10,32L22,20L110,20L110,68L98,80L10,80Z',
    // Band 10.4 = h * 0.173; the wave's control points 3 bands above and below its ends.
    WavyRectangle: 'M10,20L110,20L110,69.6C60,38.4 60,100.8 10,69.6Z',
    WavyBandedRectangle: 'M10,20L110,20L110,69.6C60,38.4 60,100.8 10,69.6Z',
    // The published 130 × 60 cloud, scaled to 100 × 60.
    Cloud: 'M32,29.6Q46,12.8 67,29.6Q97,17.6 102,42.2Q122,63.8 87,72.2Q62,89 37,67.4Q6,72.2 16,50.6Q2,29.6 32,29.6Z',
    // Tab 80 × 21 = w * 0.8 by h * 0.35.
    Folder: 'M10,20L90,20L90,41L110,41L110,80L10,80Z',
    // Rim 12 = h * 0.2: arcs over the top and round the bottom.
    Cylinder: 'M10,26A50,6 0 0 1 110,26L110,74A50,6 0 0 1 10,74Z',
  };

  for (const shapeType of SHAPE_TYPES) {
    it(`outlines ${shapeType} in absolute coordinates`, () => {
      expect(shapePath(shapeType, X, Y, W, H)).toBe(EXPECTED[shapeType]);
    });
  }

  it('gives every shape type a distinct outline, except the shapes told apart by inner lines', () => {
    // Shape type → the shape whose outline it shares.
    const sharing: Partial<Record<ShapeType, ShapeType>> = {
      BandedRectangle: 'Rectangle',
      DoubleBandedRectangle: 'Rectangle',
      TabbedRectangle: 'Rectangle',
      WavyBandedRectangle: 'WavyRectangle',
    };
    const outlined = SHAPE_TYPES.filter((shapeType) => !sharing[shapeType]);
    const paths = outlined.map((shapeType) => shapePath(shapeType, X, Y, W, H));
    expect(new Set(paths).size).toBe(outlined.length);
    for (const [shapeType, outline] of Object.entries(sharing) as Array<[ShapeType, ShapeType]>) {
      expect(shapePath(shapeType, X, Y, W, H)).toBe(EXPECTED[outline]);
    }
  });

  it('translates with the shape rather than redrawing at the origin', () => {
    for (const shapeType of SHAPE_TYPES) {
      const atOrigin = shapePath(shapeType, 0, 0, W, H);
      const moved = shapePath(shapeType, X, Y, W, H);
      expect(moved).not.toBe(atOrigin);
      // Same command sequence, coordinates shifted by exactly (X, Y).
      expect(shiftPath(atOrigin, X, Y)).toBe(moved);
    }
  });

  it('falls back to Rectangle for an absent shape type', () => {
    expect(shapePath(undefined, X, Y, W, H)).toBe(EXPECTED.Rectangle);
  });

  it('falls back to the default size for non-positive dimensions', () => {
    expect(shapePath('Rectangle', 0, 0, 0, -5)).toBe(
      shapePath('Rectangle', 0, 0, NOTATION_DEFAULTS.width, NOTATION_DEFAULTS.height),
    );
  });

  it('agrees with the polygon that shapeGeometry draws', () => {
    // The two are generated from one vertex list; this is what pins them together.
    for (const shapeType of ['Octagon', 'Hexagon', 'Diamond', 'Parallelogram', 'Box3D', 'Folder'] as ShapeType[]) {
      const geometry = shapeGeometry(shapeType, W, H);
      const vertices = parsePoints(String(geometry.attrs['points']));
      const expected = `M${vertices
        .map(([px, py]) => `${px},${py}`)
        .join('L')}Z`;
      expect(shapePath(shapeType, 0, 0, W, H)).toBe(expected);
    }
  });

  it('emits paths path-intersection can intersect, for every shape type', () => {
    // The consumer that matters: `CroppingConnectionDocking` crops through
    // `getIntersections`, which is `path-intersection`. A curve flavour it could
    // not parse would silently yield no intersections and no docking.
    const throughTheMiddle = `M${X - 200},${Y + H / 2}L${X + W + 200},${Y + H / 2}`;
    for (const shapeType of SHAPE_TYPES) {
      const intersections = getIntersections(shapePath(shapeType, X, Y, W, H), throughTheMiddle);
      expect(intersections.length, shapeType).toBeGreaterThanOrEqual(2);
    }
  });
});

/** Shift every coordinate pair in a path by (dx, dy), leaving commands alone. */
function shiftPath(path: string, dx: number, dy: number): string {
  // Arc radii are not coordinates, so they must not be shifted: split on the
  // arc's "rx,ry 0 0 f " prefix and only move the endpoint pair that follows.
  // C and Q take several pairs, every one a coordinate.
  return path.replace(
    /([MLACQ])((?:-?[\d.]+,-?[\d.]+)(?: 0 0 [01] -?[\d.]+,-?[\d.]+| -?[\d.]+,-?[\d.]+)*)/g,
    (_all, command: string, args: string) => {
      if (command === 'A') {
        const [, radii, flags, endpoint] = /^(\S+) (0 0 [01]) (\S+)$/.exec(args)!;
        return `A${radii} ${flags} ${shiftPair(endpoint!, dx, dy)}`;
      }
      return `${command}${args
        .split(' ')
        .map((pair) => shiftPair(pair, dx, dy))
        .join(' ')}`;
    },
  );
}

function shiftPair(pair: string, dx: number, dy: number): string {
  const [px, py] = pair.split(',').map(Number);
  return `${px + dx},${py + dy}`;
}

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
  const text = readFileSync(join(process.cwd(), 'assets', path), 'utf8');
  const outer = text.slice(0, text.indexOf('<svg', 5) > 0 ? text.indexOf('<svg', 5) : undefined);
  const element = new RegExp(`<${tag}\\b[^>]*\\b${name}=['"]([^'"]+)['"]`).exec(outer);
  if (!element) throw new Error(`${path}: no <${tag} ${name}>`);
  return element[1]!;
}

describe('the shapes with inner lines and curves', () => {
  it('draw inner lines only where the shape has them', () => {
    const details = Object.fromEntries(SHAPE_TYPES.map((type) => [type, shapeGeometry(type, 130, 60).details]));
    expect(details).toEqual({
      Rectangle: undefined,
      RoundedRectangle: undefined,
      Octagon: undefined,
      Ellipse: undefined,
      Circle: undefined,
      Hexagon: undefined,
      Diamond: undefined,
      Parallelogram: undefined,
      BandedRectangle: 'M0,10.4L130,10.4',
      DoubleBandedRectangle: 'M0,10.4L130,10.4M0,49.6L130,49.6',
      TabbedRectangle: 'M0,10.4L65,10.4L65,0',
      // The front face's top and right edges, and the edge from its corner to the back.
      Box3D: 'M0,12L118,12L118,60M118,12L130,0',
      WavyRectangle: undefined,
      WavyBandedRectangle: 'M0,10.4L130,10.4',
      Cloud: undefined,
      Folder: 'M0,21L104,21',
      // The front of the rim (12 high): the lower half of the top ellipse.
      Cylinder: 'M0,6A65,6 0 0 0 130,6',
    });
  });

  it('keep the band and the 3D depth in proportion to the height, up to a limit', () => {
    expect(shapeGeometry('BandedRectangle', 120, 55).details).toBe('M0,9.53L120,9.53');
    expect(shapeGeometry('BandedRectangle', 300, 200).details).toBe('M0,14L300,14');
    expect(shapeGeometry('Box3D', 300, 200).attrs['points']).toBe('0,12 12,0 300,0 300,188 288,200 0,200');
    // A large folder's tab stops at 200 wide or half the width, and 21 high.
    expect(shapeGeometry('Folder', 300, 200).attrs['points']).toBe('0,0 200,0 200,21 300,21 300,200 0,200');
    expect(shapeGeometry('Folder', 600, 400).attrs['points']).toBe('0,0 300,0 300,21 600,21 600,400 0,400');
  });

  it('draw the path they dock against', () => {
    for (const type of ['WavyRectangle', 'WavyBandedRectangle', 'Cloud', 'Cylinder'] as ShapeType[]) {
      const geometry = shapeGeometry(type, 100, 60);
      expect(geometry.tag, type).toBe('path');
      expect(geometry.attrs['d'], type).toBe(shapePath(type, 0, 0, 100, 60));
    }
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
    for (const type of ['WavyRectangle', 'Cloud'] as ShapeType[]) {
      const points = sample(shapePath(type, 0, 0, W, H));
      expect(points.length, type).toBeGreaterThan(0);
      for (const [x, y] of points) {
        expect(x, type).toBeGreaterThanOrEqual(0);
        expect(x, type).toBeLessThanOrEqual(W);
        expect(y, type).toBeGreaterThanOrEqual(0);
        expect(y, type).toBeLessThanOrEqual(H);
      }
    }
  });

  it('reproduce the published ArchiMate pictures at their 130 × 60 size', () => {
    // Read from the bundled pictures (`assets/` mirrors meta.linked.archi).
    expect(pathNumbers(shapePath('WavyRectangle', 0, 0, 130, 60))).toEqual(
      pathNumbers(pictureAttribute('archimate4/icons/deliverable.svg', 'path', 'd')),
    );
    expect(pathNumbers(shapePath('Cloud', 0, 0, 130, 60))).toEqual(
      pathNumbers(pictureAttribute('archimate4/icons/meaning.svg', 'path', 'd')),
    );
    // The picture draws the silhouette open at the bottom-left corner; the polygon closes it.
    expect(pathNumbers(String(shapeGeometry('Box3D', 130, 60).attrs['points']))).toEqual([
      ...pathNumbers(pictureAttribute('archimate4/icons/device.svg', 'polyline', 'points')),
      0,
      60,
    ]);
    expect(pathNumbers(shapeGeometry('TabbedRectangle', 130, 60).details!)).toEqual(
      pathNumbers(pictureAttribute('archimate4/icons/product.svg', 'polyline', 'points')),
    );
    expect(shapeGeometry('BandedRectangle', 130, 60).details).toBe(
      `M0,${Number(pictureAttribute('archimate4/icons/business-object.svg', 'line', 'y1'))}L130,10.4`,
    );
    // The grouping picture's tab: up the left edge, across, and down to the body.
    const tab = pathNumbers(pictureAttribute('archimate4/icons/grouping.svg', 'polyline', 'points'));
    expect(tab).toEqual([0, 21, 0, 0, 104, 0, 104, 21]);
    expect(pathNumbers(String(shapeGeometry('Folder', 130, 60).attrs['points'])).slice(0, 6)).toEqual(tab.slice(2));
  });
});

describe('shapeLayout', () => {
  it('lays a plain shape out over the whole of it', () => {
    const whole = { x: 0, y: 0, width: 120, height: 55 };
    expect(shapeLayout('Rectangle', 120, 55)).toEqual({ content: whole, label: whole });
    expect(shapeLayout(undefined, 120, 55)).toEqual({ content: whole, label: whole });
  });

  it('keeps the badge and label below a band, on the front face, above a wave and under a rim', () => {
    expect(shapeLayout('BandedRectangle', 130, 60).content).toEqual({ x: 0, y: 10.4, width: 130, height: 49.6 });
    expect(shapeLayout('DoubleBandedRectangle', 130, 60).content).toEqual({ x: 0, y: 10.4, width: 130, height: 39.2 });
    expect(shapeLayout('Box3D', 130, 60).content).toEqual({ x: 0, y: 12, width: 118, height: 48 });
    expect(shapeLayout('WavyRectangle', 130, 60).content).toEqual({ x: 0, y: 0, width: 130, height: 49.6 });
    expect(shapeLayout('Cylinder', 130, 60).content).toEqual({ x: 0, y: 12, width: 130, height: 42 });
  });

  it('puts a Folder\'s label in its tab, on one line, and its badge in the body', () => {
    const layout = shapeLayout('Folder', 130, 60);
    expect(layout.label).toEqual({ x: 0, y: 0, width: 104, height: 21 });
    expect(layout.maxLabelLines).toBe(1);
    expect(layout.content).toEqual({ x: 0, y: 21, width: 130, height: 39 });
  });
});

describe('badgeBox', () => {
  it('covers the whole IconPlacement vocabulary', () => {
    expect([...ICON_PLACEMENTS].sort()).toEqual(
      ['BottomCenter', 'Center', 'TopCenter', 'TopLeft', 'TopRight'].sort(),
    );
  });

  it('positions every placement differently', () => {
    const positions = ICON_PLACEMENTS.map((placement) => {
      const box = badgeBox(placement, 120, 60);
      return `${box.x},${box.y}`;
    });
    expect(new Set(positions).size).toBe(ICON_PLACEMENTS.length);
  });

  it('puts TopRight against the right edge and TopLeft against the left', () => {
    expect(badgeBox('TopLeft', 120, 60)).toEqual({ x: 4, y: 4, size: 20 });
    expect(badgeBox('TopRight', 120, 60)).toEqual({ x: 96, y: 4, size: 20 });
  });

  it('centres TopCenter, Center and BottomCenter horizontally', () => {
    for (const placement of ['TopCenter', 'Center', 'BottomCenter'] as IconPlacement[]) {
      expect(badgeBox(placement, 120, 60).x).toBe(50);
    }
  });

  it('stacks TopCenter above Center above BottomCenter', () => {
    const top = badgeBox('TopCenter', 120, 60).y;
    const middle = badgeBox('Center', 120, 60).y;
    const bottom = badgeBox('BottomCenter', 120, 60).y;
    expect(top).toBeLessThan(middle);
    expect(middle).toBeLessThan(bottom);
  });

  it('defaults to TopRight when no placement is declared', () => {
    expect(badgeBox(undefined, 120, 60)).toEqual(badgeBox('TopRight', 120, 60));
  });

  it('shrinks the badge to fit a shape smaller than the badge', () => {
    expect(badgeBox('TopRight', 12, 10).size).toBe(10);
  });
});

describe('wrapLabel', () => {
  it('keeps a short label on one line', () => {
    expect(wrapLabel('Actor', 120)).toEqual(['Actor']);
  });

  it('wraps on word boundaries', () => {
    expect(wrapLabel('Application Collaboration', 90, 11)).toEqual([
      'Application',
      'Collaboration',
    ]);
  });

  it('hard-breaks a word wider than a line, keeping a prefix of the original', () => {
    const lines = wrapLabel('AAAAAAAAAAAAAAAAAAAAAAAA', 30, 11);
    expect(lines.length).toBeGreaterThan(1);
    expect('AAAAAAAAAAAAAAAAAAAAAAAA'.startsWith(lines.join(''))).toBe(true);
    // Every line stays inside the estimated character budget.
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(5);
  });

  it('stops at the line limit', () => {
    const lines = wrapLabel('one two three four five six seven eight', 30, 11, 2);
    expect(lines).toHaveLength(2);
  });

  it('returns nothing for a blank label', () => {
    expect(wrapLabel('   ', 120)).toEqual([]);
  });
});

describe('labelLayout', () => {
  it('centres the label when no badge is drawn', () => {
    const layout = labelLayout('Actor', 120, 60);
    expect(layout.x).toBe(60);
    // Single line, centred: baseline just below the vertical centre.
    expect(layout.y).toBeGreaterThan(25);
    expect(layout.y).toBeLessThan(40);
  });

  it('pushes the label below a Center badge', () => {
    const centred = labelLayout('Actor', 120, 60).y;
    const belowBadge = labelLayout('Actor', 120, 60, { badgePlacement: 'Center' }).y;
    expect(belowBadge).toBeGreaterThan(centred);
  });

  it('pushes the label above a BottomCenter badge', () => {
    const centred = labelLayout('Actor', 120, 60).y;
    const aboveBadge = labelLayout('Actor', 120, 60, { badgePlacement: 'BottomCenter' }).y;
    expect(aboveBadge).toBeLessThan(centred);
  });

  it('places the label in the bottom band for IconCentric', () => {
    const layout = labelLayout('Actor', 120, 60, { below: true });
    expect(layout.y).toBeGreaterThan(60 - NOTATION_DEFAULTS.iconCentricLabelBand);
  });

  it('reserves less width when a badge shares the shape', () => {
    const withBadge = labelLayout('Application Collaboration', 120, 60, {
      badgePlacement: 'TopRight',
    });
    const withoutBadge = labelLayout('Application Collaboration', 120, 60);
    expect(withBadge.lines.length).toBeGreaterThanOrEqual(withoutBadge.lines.length);
  });
});

describe('iconHref', () => {
  const resolve = (assetPath: string): string => `/base/assets/${assetPath}`;

  it('resolves a bundled asset-root-relative path', () => {
    expect(iconHref('archimate4/icons/glyphs/actor.svg', resolve)).toBe(
      '/base/assets/archimate4/icons/glyphs/actor.svg',
    );
  });

  it('passes an https URL through unchanged', () => {
    const url = 'https://meta.linked.archi/archimate4/icons/glyphs/actor.svg';
    expect(iconHref(url, resolve)).toBe(url);
  });

  it('passes a data URI through unchanged', () => {
    expect(iconHref('data:image/svg+xml,<svg/>', resolve)).toBe('data:image/svg+xml,<svg/>');
  });

  it('rejects an absent, blank or unfetchable icon', () => {
    expect(iconHref(undefined, resolve)).toBeNull();
    expect(iconHref('', resolve)).toBeNull();
    expect(iconHref('   ', resolve)).toBeNull();
    expect(iconHref('urn:not:an:image', resolve)).toBeNull();
  });
});

describe('strokeDashArray', () => {
  it('gives no dash array for a solid or absent line style', () => {
    expect(strokeDashArray('SolidLine')).toBeNull();
    expect(strokeDashArray(undefined)).toBeNull();
  });

  it('distinguishes dashed from dotted', () => {
    const dashed = strokeDashArray('DashedLine');
    const dotted = strokeDashArray('DottedLine');
    expect(dashed).toBeTruthy();
    expect(dotted).toBeTruthy();
    expect(dashed).not.toBe(dotted);
  });
});

describe('markerDefinition', () => {
  it('covers the whole Decoration vocabulary', () => {
    expect([...DECORATIONS].sort()).toEqual(
      [
        'CircleDot',
        'ClosedArrowhead',
        'FilledDiamond',
        'HalfArrowhead',
        'HollowArrowhead',
        'HollowDiamond',
        'NoDecoration',
        'OpenArrowhead',
      ].sort(),
    );
  });

  it('draws no marker for NoDecoration', () => {
    expect(markerDefinition('NoDecoration', 'target', '#000000')).toBeNull();
  });

  it('produces a distinguishable marker for each of the seven drawn decorations', () => {
    const drawn = DECORATIONS.filter((d) => d !== 'NoDecoration');
    const signatures = drawn.map((decoration) => {
      const marker = markerDefinition(decoration, 'target', '#000000');
      expect(marker).not.toBeNull();
      const glyph = marker!.element.firstElementChild!;
      return [
        glyph.tagName,
        glyph.getAttribute('d') ?? '',
        glyph.getAttribute('fill'),
        marker!.element.getAttribute('markerWidth'),
      ].join('|');
    });
    expect(new Set(signatures).size).toBe(drawn.length);
  });

  it('fills ClosedArrowhead and FilledDiamond with the line colour', () => {
    for (const decoration of ['ClosedArrowhead', 'FilledDiamond', 'CircleDot'] as Decoration[]) {
      const marker = markerDefinition(decoration, 'target', '#336699')!;
      expect(marker.element.firstElementChild!.getAttribute('fill')).toBe('#336699');
    }
  });

  it('fills HollowArrowhead and HollowDiamond opaque white, stroked in the line colour', () => {
    for (const decoration of ['HollowArrowhead', 'HollowDiamond'] as Decoration[]) {
      const glyph = markerDefinition(decoration, 'target', '#336699')!.element.firstElementChild!;
      expect(glyph.getAttribute('fill')).toBe('#FFFFFF');
      expect(glyph.getAttribute('stroke')).toBe('#336699');
    }
  });

  it('leaves the open arrowheads unfilled so the line shows through', () => {
    for (const decoration of ['OpenArrowhead', 'HalfArrowhead'] as Decoration[]) {
      const glyph = markerDefinition(decoration, 'target', '#000000')!.element.firstElementChild!;
      expect(glyph.getAttribute('fill')).toBe('none');
    }
  });

  it('distinguishes the symmetric open arrowhead from the half arrowhead', () => {
    const open = markerDefinition('OpenArrowhead', 'target', '#000000')!;
    const half = markerDefinition('HalfArrowhead', 'target', '#000000')!;
    expect(open.element.firstElementChild!.getAttribute('d')).not.toBe(
      half.element.firstElementChild!.getAttribute('d'),
    );
  });

  it('reverses the orientation for a source-end marker', () => {
    expect(markerDefinition('FilledDiamond', 'source', '#000000')!.element.getAttribute('orient')).toBe(
      'auto-start-reverse',
    );
    expect(markerDefinition('FilledDiamond', 'target', '#000000')!.element.getAttribute('orient')).toBe(
      'auto',
    );
  });

  it('gives source, target and colour variants distinct ids', () => {
    const ids = new Set([
      markerId('FilledDiamond', 'source', '#000000'),
      markerId('FilledDiamond', 'target', '#000000'),
      markerId('FilledDiamond', 'target', '#FF0000'),
      markerId('HollowDiamond', 'target', '#000000'),
    ]);
    expect(ids.size).toBe(4);
  });

  it('ids are safe to use as element ids', () => {
    expect(markerId('OpenArrowhead', 'target', '#FFFFB5')).toMatch(/^[A-Za-z][\w-]*$/);
  });
});

describe('svgEl', () => {
  it('creates elements in the SVG namespace with the given attributes', () => {
    const rect = svgEl('rect', { x: 1, y: 2, fill: '#abc' });
    expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(rect.tagName).toBe('rect');
    expect(rect.getAttribute('x')).toBe('1');
    expect(rect.getAttribute('fill')).toBe('#abc');
  });
});

describe('every ShapeType is exercised', () => {
  it.each(SHAPE_TYPES)('%s produces a drawable SVG element', (shapeType: ShapeType) => {
    const geometry = shapeGeometry(shapeType, 120, 60);
    const element = svgEl(geometry.tag, geometry.attrs);
    expect(element.tagName).toBe(geometry.tag);
    if (geometry.tag === 'polygon') {
      expect(element.getAttribute('points')).toMatch(/^[\d.,\s]+$/);
    }
  });
});
