// @vitest-environment jsdom

/**
 * How a placement, a line, a figure and a line from a note are drawn with the
 * look set on them in the view (the Appearance tab) — over their notation's,
 * unless the canvas draws the notation alone.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { VisualStyle } from '../../../metamodel-manager/notation.js';
import type { ElementTypeInfo } from '../../../metamodel-manager/interfaces.js';
import { effectiveRenderingMode } from '../../../metamodel-manager/notation.js';
import type { Appearance } from '../../../model-manager/appearance.js';
import { NOTATION_DEFAULTS } from '../notation-shapes.js';
import { RENDER_CLASSES, type RenderOptions } from '../rdf-renderer.js';
import { createRenderHarness, paletteWith, type RenderHarness } from './render-harness.js';

const TYPE_IRI = 'https://example.org/mm#Component';
const NOTATION: VisualStyle = { shapeType: 'Rectangle', fillColor: '#B5FFFF', lineColor: '#000000', renderingMode: 'ShapeOnly' };

let harness: RenderHarness | undefined;
afterEach(() => {
  harness?.destroy();
  harness = undefined;
});

function boot(options?: RenderOptions): RenderHarness {
  const type: ElementTypeInfo = { iri: TYPE_IRI, label: 'Component', isAbstract: false, style: NOTATION, renderingMode: effectiveRenderingMode(NOTATION) };
  harness = createRenderHarness(paletteWith([type]), options);
  return harness;
}

function drawElement(appearance: Appearance | undefined, options?: RenderOptions, size = { width: 160, height: 80 }): SVGElement {
  return boot(options).drawShape(
    { iri: 'https://example.org/model/e1', typeIri: TYPE_IRI, kind: 'element', label: 'Payment API', named: true, ...(appearance ? { appearance } : {}) },
    size,
  );
}

const body = (shape: SVGElement) => shape.querySelector(`.${RENDER_CLASSES.body}`)!;
const label = (shape: SVGElement) => shape.querySelector(`.${RENDER_CLASSES.label}`)!;

describe('a placement drawn with its own look', () => {
  it('its fill, line colour, width and style over its notation’s; its text the notation’s colour still', () => {
    const shape = drawElement({ fillColor: '#ffd6e080', lineColor: '#7a0019', lineWidth: 3, borderStyle: 'DashedLine' });
    expect(body(shape).getAttribute('fill')).toBe('#ffd6e080');
    expect(body(shape).getAttribute('stroke')).toBe('#7a0019');
    expect(body(shape).getAttribute('stroke-width')).toBe('3');
    expect(body(shape).getAttribute('stroke-dasharray')).toBeTruthy();
    expect(label(shape).getAttribute('fill')).toBe('#000000');
  });

  it('its font: the name before la-gram’s own, its size, bold, italic, underlined, in its colour', () => {
    const shape = drawElement({ fontName: 'Georgia', fontSize: 14, fontStyle: 'bold italic underline', fontColor: '#1a73e8' });
    const text = label(shape);
    expect(text.getAttribute('font-family')).toBe(`"Georgia", ${NOTATION_DEFAULTS.fontFamily}`);
    expect(text.getAttribute('font-size')).toBe('14');
    expect([text.getAttribute('font-weight'), text.getAttribute('font-style'), text.getAttribute('text-decoration')]).toEqual([
      'bold',
      'italic',
      'underline',
    ]);
    expect(text.getAttribute('fill')).toBe('#1a73e8');
  });

  it('its text aligned left or right, from the top or at the bottom', () => {
    const centred = label(drawElement(undefined));
    expect(centred.getAttribute('text-anchor')).toBe('middle');
    const middleY = Number(centred.getAttribute('y'));
    harness!.destroy();
    const left = label(drawElement({ textAlignment: 'left', textPosition: 'top' }));
    expect(left.getAttribute('text-anchor')).toBe('start');
    expect(Number(left.getAttribute('x'))).toBeLessThan(80);
    expect(Number(left.getAttribute('y'))).toBeLessThan(middleY);
    harness!.destroy();
    const right = label(drawElement({ textAlignment: 'right', textPosition: 'bottom' }));
    expect(right.getAttribute('text-anchor')).toBe('end');
    expect(Number(right.getAttribute('x'))).toBeGreaterThan(80);
    expect(Number(right.getAttribute('y'))).toBeGreaterThan(middleY);
  });

  it('not with "Notation only": its notation’s look alone', () => {
    const shape = drawElement({ fillColor: '#ffd6e0', fontSize: 20, textAlignment: 'left' }, { relationshipNames: false, notationOnly: true });
    expect(body(shape).getAttribute('fill')).toBe('#B5FFFF');
    expect(label(shape).getAttribute('font-size')).toBe(String(NOTATION_DEFAULTS.fontSize));
    expect(label(shape).getAttribute('text-anchor')).toBe('middle');
  });
});

describe('a gradient, and the glyph’s colour', () => {
  it('a placement’s fill shades from its colour at the side given to white; its badge in the icon colour', () => {
    const badged: VisualStyle = { ...NOTATION, renderingMode: 'ShapeWithBadge', iconSymbol: 'archimate4/icons/glyphs/actor.svg', iconPlacement: 'TopRight' };
    const type: ElementTypeInfo = { iri: TYPE_IRI, label: 'Component', isAbstract: false, style: badged, renderingMode: effectiveRenderingMode(badged) };
    harness = createRenderHarness(paletteWith([type]));
    const shape = harness.drawShape(
      { iri: 'https://example.org/model/e1', typeIri: TYPE_IRI, kind: 'element', label: 'Payment API', named: true, appearance: { fillColor: '#ffd6e0', gradient: 'left', iconColor: '#1a237e' } },
      { width: 160, height: 80 },
    );
    const fill = body(shape).getAttribute('fill')!;
    expect(fill).toMatch(/^url\(#la-gradient-left-ffd6e0\)$/);
    const gradient = shape.querySelector(`linearGradient#la-gradient-left-ffd6e0`)!;
    expect([gradient.getAttribute('x1'), gradient.getAttribute('x2')]).toEqual(['0', '1']);
    expect([...gradient.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color'))).toEqual(['#ffd6e0', '#ffffff']);
    const badge = shape.querySelector(`.${RENDER_CLASSES.badge}`)!;
    expect(badge.getAttribute('filter')).toBe('url(#la-icon-colour-1a237e)');
    expect(shape.querySelector('filter#la-icon-colour-1a237e feFlood')!.getAttribute('flood-color')).toBe('#1a237e');
  });

  it('a note’s fill shades too, in its kind’s colour when it has none of its own', () => {
    const shape = boot().drawShape(
      { iri: 'https://example.org/model/n2', typeIri: '', kind: 'figure', label: 'n', figure: { kind: 'note', gradient: 'top' } },
      { width: 185, height: 80 },
    );
    expect(body(shape).getAttribute('fill')).toBe('url(#la-gradient-top-fff7b3)');
  });
});

describe('a notation’s look, beneath the placement’s own', () => {
  const SAYS: VisualStyle = { ...NOTATION, fontName: 'Georgia', fontSize: 9, lineWidth: 2, textAlignment: 'left', gradient: 'top' };
  function drawWith(style: VisualStyle, appearance?: Appearance, options?: RenderOptions): SVGElement {
    const type: ElementTypeInfo = { iri: TYPE_IRI, label: 'Component', isAbstract: false, style, renderingMode: effectiveRenderingMode(style) };
    harness = createRenderHarness(paletteWith([type]), options);
    return harness.drawShape(
      { iri: 'https://example.org/model/e1', typeIri: TYPE_IRI, kind: 'element', label: 'Payment API', named: true, ...(appearance ? { appearance } : {}) },
      { width: 160, height: 80 },
    );
  }

  it('drawn where the placement sets nothing — "Notation only" too — and under what it sets', () => {
    const shape = drawWith(SAYS);
    expect(label(shape).getAttribute('font-family')).toBe(`"Georgia", ${NOTATION_DEFAULTS.fontFamily}`);
    expect([label(shape).getAttribute('font-size'), label(shape).getAttribute('text-anchor')]).toEqual(['9', 'start']);
    expect(body(shape).getAttribute('stroke-width')).toBe('2');
    expect(body(shape).getAttribute('fill')).toBe('url(#la-gradient-top-b5ffff)');
    harness!.destroy();
    const own = drawWith(SAYS, { fontSize: 14, lineWidth: 3, textAlignment: 'right' });
    expect([label(own).getAttribute('font-size'), label(own).getAttribute('text-anchor')]).toEqual(['14', 'end']);
    expect(body(own).getAttribute('stroke-width')).toBe('3');
    harness!.destroy();
    const notationOnly = drawWith(SAYS, { fontSize: 14 }, { relationshipNames: false, notationOnly: true });
    expect(label(notationOnly).getAttribute('font-size')).toBe('9');
  });
});

describe('a placement drawn as another figure (the Figure tab)', () => {
  const BADGED: VisualStyle = { ...NOTATION, renderingMode: 'ShapeWithBadge', iconSymbol: 'archimate4/icons/glyphs/actor.svg', iconPlacement: 'TopRight' };
  function draw(appearance?: Appearance): SVGElement {
    const type: ElementTypeInfo = { iri: TYPE_IRI, label: 'Actor', isAbstract: false, style: BADGED, renderingMode: effectiveRenderingMode(BADGED) };
    harness = createRenderHarness(paletteWith([type]));
    return harness.drawShape(
      { iri: 'https://example.org/model/a1', typeIri: TYPE_IRI, kind: 'element', label: 'Clerk', named: true, ...(appearance ? { appearance } : {}) },
      { width: 120, height: 60 },
    );
  }

  it('its icon, its name under it — or its shape alone; its notation’s figure otherwise', () => {
    expect(draw().getAttribute('data-rendering-mode')).toBe('ShapeWithBadge');
    harness!.destroy();
    const icon = draw({ renderingMode: 'IconCentric' });
    expect(icon.getAttribute('data-rendering-mode')).toBe('IconCentric');
    expect(icon.querySelector(`.${RENDER_CLASSES.icon}`)).not.toBeNull();
    expect(icon.querySelector(`.${RENDER_CLASSES.body}`)).toBeNull();
    harness!.destroy();
    const plain = draw({ renderingMode: 'ShapeOnly' });
    expect(plain.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    expect(plain.querySelector(`.${RENDER_CLASSES.badge}`)).toBeNull();
  });
});

describe('a line drawn with its own look', () => {
  it('a relationship’s: its colour and width — its name in its font when names are shown', () => {
    const line = boot({ relationshipNames: true }).drawConnection(
      { iri: 'https://example.org/model/r1', typeIri: '', kind: 'relationship', label: 'pays', named: true, appearance: { lineColor: '#1a73e8', lineWidth: 2, fontSize: 15 } },
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
    );
    expect([line.getAttribute('stroke'), line.getAttribute('stroke-width')]).toEqual(['#1a73e8', '2']);
    const name = harness!.container.querySelector(`.${RENDER_CLASSES.connectionLabel} text`)!;
    expect([name.getAttribute('font-size'), name.getAttribute('fill')]).toEqual(['15', '#1a73e8']);
  });

  it('a line from a note’s style and its ends: dashed with none unless it says — dotted, arrowheads, a dot', () => {
    const plain = boot().drawConnection({ iri: 'https://example.org/model/l0', typeIri: '', kind: 'connector' });
    expect([plain.getAttribute('stroke-dasharray'), plain.getAttribute('marker-start'), plain.getAttribute('marker-end')]).toEqual(['4 3', null, null]);
    harness!.destroy();
    const styled = boot().drawConnection({
      iri: 'https://example.org/model/l1',
      typeIri: '',
      kind: 'connector',
      appearance: { lineStyle: 'DottedLine', sourceDecor: 'CircleDot', targetDecor: 'ClosedArrowhead', lineColor: '#7a0019' },
    });
    expect(styled.getAttribute('stroke-dasharray')).toBe('2 3');
    expect(styled.getAttribute('marker-start')).toContain('CircleDot');
    expect(styled.getAttribute('marker-end')).toContain('ClosedArrowhead');
    harness!.destroy();
    const solid = boot().drawConnection({ iri: 'https://example.org/model/l2', typeIri: '', kind: 'connector', appearance: { lineStyle: 'SolidLine' } });
    expect(solid.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('a line from a note’s text: at its middle, in its line colour or its font’s — names shown or not', () => {
    const line = boot({ relationshipNames: false }).drawConnection(
      { iri: 'https://example.org/model/l1', typeIri: '', kind: 'connector', label: 'asks', named: true, appearance: { lineColor: '#7a0019', fontSize: 14 } },
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
    );
    expect(line).toBeTruthy();
    const text = harness!.container.querySelector(`.${RENDER_CLASSES.connectionLabel} text`)!;
    expect([text.textContent, text.getAttribute('font-size'), text.getAttribute('fill')]).toEqual(['asks', '14', '#7a0019']);
    harness!.destroy();
    boot({ relationshipNames: false, notationOnly: true }).drawConnection(
      { iri: 'https://example.org/model/l2', typeIri: '', kind: 'connector', label: 'asks', named: true, appearance: { fontColor: '#1a73e8' } },
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
    );
    expect(harness!.container.querySelector(`.${RENDER_CLASSES.connectionLabel} text`)!.getAttribute('fill')).toBe('#1a73e8');
    harness!.destroy();
    boot().drawConnection({ iri: 'https://example.org/model/l3', typeIri: '', kind: 'connector' });
    expect(harness!.container.querySelector(`.${RENDER_CLASSES.connectionLabel}`)).toBeNull();
  });

  it('a line from a note’s, which has no notation: its own even with "Notation only"', () => {
    const line = boot({ relationshipNames: false, notationOnly: true }).drawConnection({
      iri: 'https://example.org/model/l1',
      typeIri: '',
      kind: 'connector',
      appearance: { lineColor: '#7a0019', lineWidth: 3 },
    });
    expect([line.getAttribute('stroke'), line.getAttribute('stroke-width')]).toEqual(['#7a0019', '3']);
  });
});

describe('a figure drawn with its own look', () => {
  it('a note’s outline, and its text centred, at its bottom, in its font', () => {
    const shape = boot().drawShape(
      {
        iri: 'https://example.org/model/n1',
        typeIri: '',
        kind: 'figure',
        label: 'Ask the CFO',
        figure: { kind: 'note', lineWidth: 2, borderStyle: 'DottedLine', textAlignment: 'center', textPosition: 'bottom', fontStyle: 'italic' },
      },
      { width: 185, height: 80 },
    );
    expect(body(shape).getAttribute('stroke-width')).toBe('2');
    expect(body(shape).getAttribute('stroke-dasharray')).toBeTruthy();
    const text = label(shape);
    expect(text.getAttribute('text-anchor')).toBe('middle');
    expect(Number(text.getAttribute('y'))).toBeGreaterThan(40);
    expect(text.getAttribute('font-style')).toBe('italic');
  });
});
