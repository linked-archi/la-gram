// @vitest-environment jsdom

/**
 * The RDF renderer, exercised through a real diagram-js instance.
 *
 * jsdom implements no SVG layout, so these assert on the DOM structure and the
 * attribute values the renderer emits — never on computed geometry.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type {
  Decoration,
  IconPlacement,
  LineStyle,
  ShapeType,
  VisualStyle,
} from '../../../metamodel-manager/notation.js';
import type { ElementTypeInfo } from '../../../metamodel-manager/interfaces.js';
import { effectiveRenderingMode } from '../../../metamodel-manager/notation.js';
import {
  DECORATIONS,
  ICON_PLACEMENTS,
  NOTATION_DEFAULTS,
  SHAPE_TYPES,
} from '../notation-shapes.js';
import { RENDER_CLASSES } from '../rdf-renderer.js';
import { createRenderHarness, paletteWith, type RenderHarness } from './render-harness.js';

const TYPE_IRI = 'https://example.org/mm#TestType';
const BUNDLED_GLYPH = 'archimate4/icons/glyphs/actor.svg';

let harness: RenderHarness | undefined;

afterEach(() => {
  harness?.destroy();
  harness = undefined;
});

/** An element type carrying the given style, with the guide's mode applied. */
function elementType(style: VisualStyle | undefined, label = 'Test Element'): ElementTypeInfo {
  return {
    iri: TYPE_IRI,
    label,
    isAbstract: false,
    style,
    renderingMode: style ? effectiveRenderingMode(style) : undefined,
  };
}

/** Boot a harness for one styled element type and draw a shape with it. */
function drawWithStyle(
  style: VisualStyle | undefined,
  options: { label?: string; width?: number; height?: number } = {},
): SVGElement {
  harness = createRenderHarness(paletteWith([elementType(style, options.label)]));
  return harness.drawShape(
    { iri: 'https://example.org/model/e1', typeIri: TYPE_IRI, kind: 'element' },
    { width: options.width ?? 120, height: options.height ?? 55 },
  );
}

const badgeStyle: VisualStyle = {
  shapeType: 'Rectangle',
  fillColor: '#FFFFB5',
  lineColor: '#000000',
  renderingMode: 'ShapeWithBadge',
  iconSymbol: BUNDLED_GLYPH,
  iconPlacement: 'TopRight',
  defaultWidth: 120,
  defaultHeight: 55,
};

// ── The diagram is really there ────────────────────────────────────────

describe('renderer inside a real diagram-js instance', () => {
  it('creates a diagram-js canvas in the host container', () => {
    harness = createRenderHarness(paletteWith([elementType(badgeStyle)]));
    expect(harness.container.querySelector('.djs-container')).not.toBeNull();
    expect(harness.container.querySelector('svg')).not.toBeNull();
  });

  it('a registered shape reaches the DOM inside diagram-js element wrappers', () => {
    harness = createRenderHarness(paletteWith([elementType(badgeStyle)]));
    const shape = harness.drawShape({
      iri: 'https://example.org/model/e1',
      typeIri: TYPE_IRI,
      kind: 'element',
    });

    // diagram-js owns .djs-element > .djs-visual; the renderer draws inside it.
    expect(shape.closest('.djs-visual')).not.toBeNull();
    expect(shape.closest('.djs-element')).not.toBeNull();
    expect(shape.getAttribute('data-element-iri')).toBe('https://example.org/model/e1');
  });
});

// ── Rendering modes ────────────────────────────────────────────────────

describe('ShapeWithBadge', () => {
  it('draws the shape body, a badge and a label', () => {
    const shape = drawWithStyle(badgeStyle);

    expect(shape.getAttribute('data-rendering-mode')).toBe('ShapeWithBadge');
    expect(shape.querySelector(`.${RENDER_CLASSES.body}`)).not.toBeNull();
    expect(shape.querySelector(`.${RENDER_CLASSES.badge}`)).not.toBeNull();
    expect(shape.querySelector(`.${RENDER_CLASSES.label}`)).not.toBeNull();
  });

  it('sizes the badge within the 16–24px range the guide asks for', () => {
    const shape = drawWithStyle(badgeStyle);
    const badge = shape.querySelector(`.${RENDER_CLASSES.badge}`)!;
    const size = Number(badge.getAttribute('width'));
    expect(size).toBeGreaterThanOrEqual(16);
    expect(size).toBeLessThanOrEqual(24);
    expect(badge.getAttribute('height')).toBe(badge.getAttribute('width'));
  });

  it('points the badge at the bundled glyph', () => {
    const shape = drawWithStyle(badgeStyle);
    const badge = shape.querySelector(`.${RENDER_CLASSES.badge}`)!;
    expect(badge.getAttribute('href')).toContain(`assets/${BUNDLED_GLYPH}`);
  });

  it('applies fillColor and lineColor from the style, not hardcoded values', () => {
    const shape = drawWithStyle({ ...badgeStyle, fillColor: '#C9E7B7', lineColor: '#336699' });
    const body = shape.querySelector(`.${RENDER_CLASSES.body}`)!;

    expect(body.getAttribute('fill')).toBe('#C9E7B7');
    expect(body.getAttribute('stroke')).toBe('#336699');
    // The pre-notation renderer's hardcoded values must be gone.
    expect(body.getAttribute('fill')).not.toBe('#ffffff');
    expect(body.getAttribute('stroke')).not.toBe('#333333');
  });

  it('colours the label with the line colour', () => {
    const shape = drawWithStyle({ ...badgeStyle, lineColor: '#336699' });
    expect(shape.querySelector(`.${RENDER_CLASSES.label}`)!.getAttribute('fill')).toBe('#336699');
  });
});

describe('IconCentric', () => {
  const iconCentricStyle: VisualStyle = {
    renderingMode: 'IconCentric',
    iconSymbol: BUNDLED_GLYPH,
    lineColor: '#000000',
  };

  it('draws the icon at full width with no shape body', () => {
    const shape = drawWithStyle(iconCentricStyle, { width: 80, height: 80 });

    expect(shape.getAttribute('data-rendering-mode')).toBe('IconCentric');
    expect(shape.querySelector(`.${RENDER_CLASSES.body}`)).toBeNull();
    expect(shape.querySelector(`.${RENDER_CLASSES.badge}`)).toBeNull();

    const icon = shape.querySelector(`.${RENDER_CLASSES.icon}`)!;
    expect(icon).not.toBeNull();
    expect(Number(icon.getAttribute('width'))).toBe(80);
    expect(Number(icon.getAttribute('height'))).toBeGreaterThan(40);
  });

  it('puts the label below the icon', () => {
    const shape = drawWithStyle(iconCentricStyle, { width: 80, height: 80 });
    const icon = shape.querySelector(`.${RENDER_CLASSES.icon}`)!;
    const label = shape.querySelector(`.${RENDER_CLASSES.label}`)!;

    const iconBottom = Number(icon.getAttribute('y')) + Number(icon.getAttribute('height'));
    expect(Number(label.getAttribute('y'))).toBeGreaterThan(iconBottom);
  });

  it('keeps a minimal transparent container for selection and hover', () => {
    const shape = drawWithStyle(iconCentricStyle, { width: 80, height: 80 });
    const container = shape.querySelector(`.${RENDER_CLASSES.hitContainer}`)!;

    expect(container).not.toBeNull();
    expect(container.getAttribute('fill')).toBe('none');
    expect(container.getAttribute('pointer-events')).toBe('all');
    expect(Number(container.getAttribute('width'))).toBe(80);
    expect(Number(container.getAttribute('height'))).toBe(80);
  });
});

describe('ShapeOnly', () => {
  it('draws no icon element at all, even when one is declared', () => {
    const shape = drawWithStyle({
      shapeType: 'Ellipse',
      fillColor: '#FFFFB5',
      lineColor: '#000000',
      renderingMode: 'ShapeOnly',
      iconSymbol: BUNDLED_GLYPH,
      iconPlacement: 'Center',
    });

    expect(shape.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    expect(shape.querySelectorAll('image')).toHaveLength(0);
    expect(shape.querySelector(`.${RENDER_CLASSES.badge}`)).toBeNull();
    expect(shape.querySelector(`.${RENDER_CLASSES.icon}`)).toBeNull();
  });

  it('still draws the shape body and a centred label', () => {
    const shape = drawWithStyle({
      shapeType: 'Ellipse',
      fillColor: '#FFFFB5',
      lineColor: '#000000',
      renderingMode: 'ShapeOnly',
    });

    expect(shape.querySelector(`.${RENDER_CLASSES.body}`)!.tagName).toBe('ellipse');
    const label = shape.querySelector(`.${RENDER_CLASSES.label}`)!;
    expect(label.getAttribute('text-anchor')).toBe('middle');
    expect(label.textContent).toContain('Test');
  });
});

describe('degradation when the icon cannot be drawn', () => {
  it('falls back to ShapeOnly for a ShapeWithBadge style with no iconSymbol', () => {
    const shape = drawWithStyle({
      shapeType: 'Rectangle',
      fillColor: '#FFFFB5',
      lineColor: '#000000',
      renderingMode: 'ShapeWithBadge',
    });

    expect(shape.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    expect(shape.querySelectorAll('image')).toHaveLength(0);
  });

  it('falls back to ShapeOnly for an unresolvable icon URI, without throwing', () => {
    let shape: SVGElement | undefined;
    expect(() => {
      shape = drawWithStyle({
        shapeType: 'Rectangle',
        fillColor: '#FFFFB5',
        lineColor: '#000000',
        renderingMode: 'ShapeWithBadge',
        iconSymbol: 'urn:missing:glyph',
      });
    }).not.toThrow();

    expect(shape!.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    expect(shape!.querySelectorAll('image')).toHaveLength(0);
    // The shape itself is still drawn, so the element remains usable.
    expect(shape!.querySelector(`.${RENDER_CLASSES.body}`)).not.toBeNull();
  });

  it('falls back to ShapeOnly for an IconCentric style with no icon', () => {
    const shape = drawWithStyle({ renderingMode: 'IconCentric', lineColor: '#000000' });
    expect(shape.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    expect(shape.querySelector(`.${RENDER_CLASSES.icon}`)).toBeNull();
  });

  it('draws an unstyled element type with the notation defaults', () => {
    const shape = drawWithStyle(undefined);
    const body = shape.querySelector(`.${RENDER_CLASSES.body}`)!;

    expect(shape.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    expect(body.tagName).toBe('rect');
    expect(body.getAttribute('fill')).toBe(NOTATION_DEFAULTS.fillColor);
    expect(body.getAttribute('stroke')).toBe(NOTATION_DEFAULTS.lineColor);
  });
});

// ── Shapes and placements through the renderer ─────────────────────────

describe('shape types through the renderer', () => {
  const expectedTag: Record<ShapeType, string> = {
    Rectangle: 'rect',
    RoundedRectangle: 'rect',
    Octagon: 'polygon',
    Ellipse: 'ellipse',
    Circle: 'circle',
    Hexagon: 'polygon',
    Diamond: 'polygon',
    Parallelogram: 'polygon',
    BandedRectangle: 'rect',
    DoubleBandedRectangle: 'rect',
    TabbedRectangle: 'rect',
    Box3D: 'polygon',
    WavyRectangle: 'path',
    WavyBandedRectangle: 'path',
    Cloud: 'path',
    Folder: 'polygon',
    RightArrow: 'polygon',
    Stadium: 'rect',
    Cylinder: 'path',
  };

  it.each(SHAPE_TYPES)('%s draws the expected SVG element', (shapeType: ShapeType) => {
    const shape = drawWithStyle({
      shapeType,
      fillColor: '#FFFFB5',
      lineColor: '#000000',
      renderingMode: 'ShapeOnly',
    });
    const body = shape.querySelector(`.${RENDER_CLASSES.body}`)!;
    expect(body.tagName).toBe(expectedTag[shapeType]);
  });

  it('distinguishes RoundedRectangle from Rectangle by its corner radius', () => {
    const plain = drawWithStyle({ shapeType: 'Rectangle', renderingMode: 'ShapeOnly' });
    const plainRx = plain.querySelector(`.${RENDER_CLASSES.body}`)!.getAttribute('rx');
    harness?.destroy();
    harness = undefined;

    const rounded = drawWithStyle({ shapeType: 'RoundedRectangle', renderingMode: 'ShapeOnly' });
    const roundedRx = rounded.querySelector(`.${RENDER_CLASSES.body}`)!.getAttribute('rx');

    expect(plainRx).toBeNull();
    expect(Number(roundedRx)).toBeGreaterThan(0);
  });

  it('draws a shape\'s inner lines over its body, stroked and unfilled', () => {
    const shape = drawWithStyle({ ...badgeStyle, shapeType: 'Box3D', lineColor: '#333333' }, { width: 130, height: 60 });
    const [body, details] = [...shape.children];
    expect(body!.getAttribute('class')).toBe(RENDER_CLASSES.body);
    expect(details!.getAttribute('class')).toBe(RENDER_CLASSES.details);
    expect(details!.getAttribute('d')).toBe('M0,12L118,12L118,60M118,12L130,0');
    expect([details!.getAttribute('fill'), details!.getAttribute('stroke')]).toEqual(['none', '#333333']);
    harness?.destroy();
    harness = undefined;

    // A shape with no inner lines draws none.
    const plain = drawWithStyle({ ...badgeStyle, shapeType: 'Rectangle' });
    expect(plain.querySelector(`.${RENDER_CLASSES.details}`)).toBeNull();
  });

  it('dashes the outline and the inner lines for a dashed borderStyle', () => {
    const shape = drawWithStyle({ ...badgeStyle, shapeType: 'Folder', borderStyle: 'DashedLine' });
    const dashes = [RENDER_CLASSES.body, RENDER_CLASSES.details].map((name) =>
      shape.querySelector(`.${name}`)!.getAttribute('stroke-dasharray'),
    );
    expect(dashes).toEqual(['8 4', '8 4']);
    harness?.destroy();
    harness = undefined;

    const solid = drawWithStyle({ ...badgeStyle, shapeType: 'Folder' });
    expect(solid.querySelector(`.${RENDER_CLASSES.body}`)!.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('puts the badge and label on a 3D box\'s front face', () => {
    const shape = drawWithStyle({ ...badgeStyle, shapeType: 'Box3D' }, { width: 130, height: 60, label: 'Server' });
    const badge = shape.querySelector(`.${RENDER_CLASSES.badge}`)!;
    // Front face: x 0–118, y 12–60; the badge in its top-right corner.
    expect([badge.getAttribute('x'), badge.getAttribute('y')]).toEqual(['94', '16']);
    const label = shape.querySelector(`.${RENDER_CLASSES.label}`)!;
    expect(label.getAttribute('x')).toBe('59');
    expect(Number(label.getAttribute('y'))).toBeGreaterThan(12 + 24);
  });

  it('puts a Folder\'s label in its tab, on one line, and its badge in the body', () => {
    const shape = drawWithStyle(
      { ...badgeStyle, shapeType: 'Folder' },
      { width: 130, height: 60, label: 'A grouping with a name too long for one line' },
    );
    const label = shape.querySelector(`.${RENDER_CLASSES.label}`)!;
    expect(label.querySelectorAll('tspan')).toHaveLength(1);
    // Centred in the 104 × 21 tab.
    expect(label.getAttribute('x')).toBe('52');
    expect(Number(label.getAttribute('y'))).toBeLessThan(21);
    const badge = shape.querySelector(`.${RENDER_CLASSES.badge}`)!;
    expect(Number(badge.getAttribute('y'))).toBeGreaterThanOrEqual(21);
  });

  it('colours the label with fontColor, else the line colour', () => {
    const labelFill = (style: VisualStyle) => {
      harness?.destroy();
      const shape = drawWithStyle(style, { label: 'Story' });
      return shape.querySelector(`.${RENDER_CLASSES.label}`)!.getAttribute('fill');
    };
    // EDGY's facets: white border, black name.
    expect(labelFill({ shapeType: 'RightArrow', fillColor: '#75F0A5', lineColor: '#FFFFFF', fontColor: '#000000', renderingMode: 'ShapeOnly' })).toBe('#000000');
    // Its tag: a black pill with the name in white, inside.
    expect(labelFill({ shapeType: 'Stadium', fillColor: '#000000', lineColor: '#000000', fontColor: '#FFFFFF', renderingMode: 'ShapeOnly' })).toBe('#FFFFFF');
    // No fontColor: the line colour, as before.
    expect(labelFill({ shapeType: 'Rectangle', lineColor: '#1565C0', renderingMode: 'ShapeOnly' })).toBe('#1565C0');
    // Under an IconCentric icon the label is on the canvas: black unless fontColor says otherwise.
    expect(labelFill({ ...badgeStyle, lineColor: '#FFFFFF', renderingMode: 'IconCentric' })).toBe(NOTATION_DEFAULTS.lineColor);
    expect(labelFill({ ...badgeStyle, fontColor: '#333333', renderingMode: 'IconCentric' })).toBe('#333333');
  });

  it('keeps the label below a band', () => {
    const shape = drawWithStyle({ ...badgeStyle, shapeType: 'BandedRectangle', renderingMode: 'ShapeOnly' }, { width: 130, height: 60, label: 'Order' });
    const label = shape.querySelector(`.${RENDER_CLASSES.label}`)!;
    // Centred in the 49.6 below the band rather than in the whole 60.
    const centred = Number(label.getAttribute('y'));
    harness?.destroy();
    harness = undefined;
    const plain = drawWithStyle({ ...badgeStyle, shapeType: 'Rectangle', renderingMode: 'ShapeOnly' }, { width: 130, height: 60, label: 'Order' });
    const plainY = Number(plain.querySelector(`.${RENDER_CLASSES.label}`)!.getAttribute('y'));
    expect(centred - plainY).toBeCloseTo(10.4 / 2, 1);
  });
});

describe('icon placements through the renderer', () => {
  function badgePosition(placement: IconPlacement): string {
    harness?.destroy();
    const shape = drawWithStyle({ ...badgeStyle, iconPlacement: placement });
    const badge = shape.querySelector(`.${RENDER_CLASSES.badge}`)!;
    expect(badge.getAttribute('data-icon-placement')).toBe(placement);
    return `${badge.getAttribute('x')},${badge.getAttribute('y')}`;
  }

  it('positions all five placements differently', () => {
    const positions = ICON_PLACEMENTS.map(badgePosition);
    expect(new Set(positions).size).toBe(ICON_PLACEMENTS.length);
  });

  it('defaults an undeclared placement to TopRight', () => {
    const shape = drawWithStyle({ ...badgeStyle, iconPlacement: undefined });
    expect(
      shape.querySelector(`.${RENDER_CLASSES.badge}`)!.getAttribute('data-icon-placement'),
    ).toBe('TopRight');
  });
});

// ── Connections ────────────────────────────────────────────────────────

describe('connection rendering', () => {
  const RELATION_IRI = 'https://example.org/mm#TestRelation';

  function drawRelationship(
    lineStyle: LineStyle | undefined,
    sourceDecor: Decoration,
    targetDecor: Decoration,
    lineColor = '#000000',
  ): SVGElement {
    harness?.destroy();
    harness = createRenderHarness(
      paletteWith(
        [],
        [
          {
            iri: RELATION_IRI,
            label: 'Test Relation',
            domainTypes: [],
            rangeTypes: [],
            relationshipStyle: { lineStyle, sourceDecor, targetDecor, lineColor },
          },
        ],
      ),
    );
    return harness.drawConnection({
      iri: 'https://example.org/model/r1',
      typeIri: RELATION_IRI,
      kind: 'relationship',
    });
  }

  it('draws a polyline through the waypoints', () => {
    const line = drawRelationship('SolidLine', 'NoDecoration', 'NoDecoration');
    expect(line.tagName).toBe('polyline');
    expect(line.getAttribute('points')).toBe('0,0 200,0');
    expect(line.getAttribute('fill')).toBe('none');
  });

  it('renders the three line styles distinguishably', () => {
    const dashArrays = (['SolidLine', 'DashedLine', 'DottedLine'] as LineStyle[]).map(
      (lineStyle) =>
        drawRelationship(lineStyle, 'NoDecoration', 'NoDecoration').getAttribute(
          'stroke-dasharray',
        ) ?? 'solid',
    );
    expect(new Set(dashArrays).size).toBe(3);
    expect(dashArrays[0]).toBe('solid');
  });

  it('applies the relationship line colour', () => {
    const line = drawRelationship('SolidLine', 'NoDecoration', 'NoDecoration', '#336699');
    expect(line.getAttribute('stroke')).toBe('#336699');
  });

  it('adds no marker reference for NoDecoration', () => {
    const line = drawRelationship('SolidLine', 'NoDecoration', 'NoDecoration');
    expect(line.getAttribute('marker-start')).toBeNull();
    expect(line.getAttribute('marker-end')).toBeNull();
  });

  it.each(DECORATIONS.filter((d) => d !== 'NoDecoration'))(
    '%s renders as a marker referenced from the line',
    (decoration: Decoration) => {
      const line = drawRelationship('SolidLine', 'NoDecoration', decoration);
      const markerEnd = line.getAttribute('marker-end');
      expect(markerEnd).toMatch(/^url\(#la-marker-/);
      expect(line.getAttribute('data-target-decor')).toBe(decoration);

      const id = markerEnd!.slice('url(#'.length, -1);
      const defs = harness!.markerDefs();
      expect(defs).not.toBeNull();
      expect(defs!.querySelector(`[id="${id}"]`)).not.toBeNull();
    },
  );

  it('gives all eight decorations distinguishable markup', () => {
    const signatures = DECORATIONS.map((decoration) => {
      const line = drawRelationship('SolidLine', 'NoDecoration', decoration);
      const markerEnd = line.getAttribute('marker-end');
      if (!markerEnd) return 'none';
      const id = markerEnd.slice('url(#'.length, -1);
      const marker = harness!.markerDefs()!.querySelector(`[id="${id}"]`)!;
      const glyph = marker.firstElementChild!;
      return `${glyph.tagName}|${glyph.getAttribute('d') ?? ''}|${glyph.getAttribute('fill')}`;
    });
    expect(new Set(signatures).size).toBe(DECORATIONS.length);
  });

  it('renders a source decoration as marker-start', () => {
    const line = drawRelationship('SolidLine', 'FilledDiamond', 'NoDecoration');
    expect(line.getAttribute('marker-start')).toMatch(/^url\(#la-marker-FilledDiamond-source-/);
    expect(line.getAttribute('marker-end')).toBeNull();
  });

  it('renders both ends when the notation decorates both', () => {
    const line = drawRelationship('SolidLine', 'CircleDot', 'ClosedArrowhead');
    expect(line.getAttribute('marker-start')).toContain('CircleDot');
    expect(line.getAttribute('marker-end')).toContain('ClosedArrowhead');
  });

  it('draws an unstyled relationship type as a plain solid line', () => {
    harness = createRenderHarness(paletteWith([]));
    const line = harness.drawConnection({
      iri: 'https://example.org/model/r1',
      typeIri: 'https://example.org/mm#Unknown',
      kind: 'relationship',
    });
    expect(line.getAttribute('stroke-dasharray')).toBeNull();
    expect(line.getAttribute('data-line-style')).toBe('SolidLine');
    expect(line.getAttribute('marker-end')).toBeNull();
  });
});
