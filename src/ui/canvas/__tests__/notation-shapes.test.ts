// @vitest-environment jsdom

/**
 * Geometry for the `arch-vis:` notation vocabulary.
 *
 * jsdom has no SVG layout engine, so these assert on the produced element kind
 * and attribute values — never on measured geometry.
 */

import { describe, it, expect } from 'vitest';
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
      return `${geometry.tag}:${JSON.stringify(geometry.attrs)}`;
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
  };

  for (const shapeType of SHAPE_TYPES) {
    it(`outlines ${shapeType} in absolute coordinates`, () => {
      expect(shapePath(shapeType, X, Y, W, H)).toBe(EXPECTED[shapeType]);
    });
  }

  it('gives every shape type a distinct outline', () => {
    const paths = SHAPE_TYPES.map((shapeType) => shapePath(shapeType, X, Y, W, H));
    expect(new Set(paths).size).toBe(SHAPE_TYPES.length);
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
    for (const shapeType of ['Octagon', 'Hexagon', 'Diamond', 'Parallelogram'] as ShapeType[]) {
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
  // arc's "rx,ry 0 0 1 " prefix and only move the endpoint pair that follows.
  return path.replace(
    /([MLA])((?:-?[\d.]+,-?[\d.]+)(?: 0 0 1 -?[\d.]+,-?[\d.]+)?)/g,
    (_all, command: string, args: string) => {
      if (command === 'A') {
        const [radii, endpoint] = args.split(' 0 0 1 ');
        return `A${radii} 0 0 1 ${shiftPair(endpoint, dx, dy)}`;
      }
      return `${command}${shiftPair(args, dx, dy)}`;
    },
  );
}

function shiftPair(pair: string, dx: number, dy: number): string {
  const [px, py] = pair.split(',').map(Number);
  return `${px + dx},${py + dy}`;
}

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
