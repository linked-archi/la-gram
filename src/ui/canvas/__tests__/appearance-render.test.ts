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
import {
  RENDER_CLASSES,
  connectionLabelLayout,
  drawnConnectionLabel,
  imageBox,
  rememberImageSize,
  type RenderOptions,
} from '../rdf-renderer.js';
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

  it('its element’s picture for the presentation shown: as its icon in icon mode, inside the box in box mode — the badge its type’s; its own picture first', () => {
    const PICTURE = 'https://example.org/pictures/card-payments.png';
    const drawWithPicture = (appearance?: Appearance) => {
      const type: ElementTypeInfo = { iri: TYPE_IRI, label: 'Actor', isAbstract: false, style: BADGED, renderingMode: effectiveRenderingMode(BADGED) };
      harness = createRenderHarness(paletteWith([type]));
      return harness.drawShape(
        { iri: 'https://example.org/model/a1', typeIri: TYPE_IRI, kind: 'element', label: 'Clerk', named: true, elementPicture: PICTURE, ...(appearance ? { appearance } : {}) },
        { width: 120, height: 60 },
      );
    };
    // As its icon: the picture, as it is — not in the icon colour.
    const icon = drawWithPicture({ renderingMode: 'IconCentric', iconColor: '#7a0019' }).querySelector(`.${RENDER_CLASSES.icon}`)!;
    expect([icon.getAttribute('href'), icon.getAttribute('data-element-picture'), icon.getAttribute('filter')]).toEqual([PICTURE, 'true', null]);
    harness!.destroy();
    // In box-with-badge mode it is drawn inside the box, at the top left; the badge stays the notation's glyph,
    // which says the element's type.
    const boxed = drawWithPicture();
    expect(boxed.querySelector(`.${RENDER_CLASSES.badge}`)!.getAttribute('href')).toContain('actor.svg');
    const inside = boxed.querySelector(`.${RENDER_CLASSES.image}`);
    // Drawn once its size is known (loaded); its position, until then, is what the picture is drawn at.
    if (inside) expect([inside.getAttribute('href'), inside.getAttribute('data-image-position')]).toEqual([PICTURE, 'TopLeft']);
    harness!.destroy();
    // At the placement's own image position; and not at all where the placement has a picture of its own inside,
    // or as its badge.
    const placed = drawWithPicture({ image: 'https://example.org/own-inside.png', imagePosition: 'BottomRight' }).querySelectorAll(`.${RENDER_CLASSES.image}`);
    expect([...placed].map((i) => i.getAttribute('href'))).not.toContain(PICTURE);
    harness!.destroy();
    // Asked for as its badge (core-vis 0.8): the picture in place of the glyph, its box kept, not inside as well.
    const asBadge = drawWithPicture({ useElementPicture: true });
    expect([asBadge.getAttribute('data-rendering-mode'), asBadge.querySelector(`.${RENDER_CLASSES.badge}`)!.getAttribute('href')]).toEqual([
      'ShapeWithBadge',
      PICTURE,
    ]);
    expect(asBadge.querySelector(`.${RENDER_CLASSES.image}`)).toBeNull();
    harness!.destroy();
    // And as its figure where it is drawn as its icon.
    const asFigure = drawWithPicture({ useElementPicture: true, renderingMode: 'IconCentric' }).querySelector(`.${RENDER_CLASSES.icon}`)!;
    expect(asFigure.getAttribute('href')).toBe(PICTURE);
    harness!.destroy();
    // A picture of its own comes first.
    expect(drawWithPicture({ useElementPicture: true, iconSymbol: 'https://example.org/own.png' }).querySelector(`.${RENDER_CLASSES.badge}`)!.getAttribute('href')).toBe(
      'https://example.org/own.png',
    );
    harness!.destroy();
    const ownBadge = drawWithPicture({ iconSymbol: 'https://example.org/own-badge.png' });
    expect(ownBadge.querySelector(`.${RENDER_CLASSES.badge}`)!.getAttribute('href')).toBe('https://example.org/own-badge.png');
    expect([...ownBadge.querySelectorAll(`.${RENDER_CLASSES.image}`)].map((i) => i.getAttribute('href'))).not.toContain(PICTURE);
    harness!.destroy();
    // The placement's own icon comes first.
    const own = drawWithPicture({ renderingMode: 'IconCentric', iconSymbol: 'https://example.org/own.png' }).querySelector(`.${RENDER_CLASSES.icon}`)!;
    expect([own.getAttribute('href'), own.getAttribute('data-element-picture')]).toEqual(['https://example.org/own.png', null]);
  });

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

describe('where a line’s text sits along it (arch-vis:labelAnchor)', () => {
  const route = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
  ];
  const centre = (layout: ReturnType<typeof connectionLabelLayout>) => layout!.box.x + layout!.box.width / 2;

  it('at the middle, or clear of an end — as far in as the text reaches, and a gap; moved, where it was put', () => {
    const middle = connectionLabelLayout(route, 'pays', {})!;
    expect(centre(middle)).toBeCloseTo(150);
    const half = middle.box.width / 2;
    expect(centre(connectionLabelLayout(route, 'pays', { anchor: 'source' }))).toBeCloseTo(half + 8);
    expect(centre(connectionLabelLayout(route, 'pays', { anchor: 'target' }))).toBeCloseTo(300 - half - 8);
    // Upright: as far in as it is high.
    const upright = connectionLabelLayout(
      [
        { x: 0, y: 0 },
        { x: 0, y: 300 },
      ],
      'pays',
      { anchor: 'source' },
    )!;
    expect(upright.box.y + upright.box.height / 2).toBeCloseTo(upright.box.height / 2 + 8);
    // A line too short for it: at its middle.
    const short = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(centre(connectionLabelLayout(short, 'pays', { anchor: 'target' }))).toBeCloseTo(10);
    // Moved by hand: from the middle, wherever it is anchored.
    expect(centre(connectionLabelLayout(route, 'pays', { anchor: 'source', offset: { x: 40, y: -20 } }))).toBeCloseTo(190);
  });

  it('the line’s own, else its notation’s; with "Notation only", a relationship’s notation’s — a line from a note’s its own', () => {
    const line = (kind: 'relationship' | 'connector', labelAnchor?: 'source' | 'target') => ({
      waypoints: route,
      businessObject: { iri: 'https://example.org/model/r1', typeIri: '', kind, label: 'pays', named: true, ...(labelAnchor ? { appearance: { labelAnchor } } : {}) },
    });
    const at = (layout: ReturnType<typeof drawnConnectionLabel>) => Math.round(centre(layout));
    const shown: RenderOptions = { relationshipNames: true };
    expect(at(drawnConnectionLabel(line('relationship', 'source'), shown, { labelAnchor: 'target' }))).toBeLessThan(150);
    expect(at(drawnConnectionLabel(line('relationship'), shown, { labelAnchor: 'target' }))).toBeGreaterThan(150);
    expect(at(drawnConnectionLabel(line('relationship', 'source'), { ...shown, notationOnly: true }))).toBe(150);
    expect(at(drawnConnectionLabel(line('connector', 'source'), { relationshipNames: false, notationOnly: true }))).toBeLessThan(150);
  });
});

describe('a picture drawn in a node (the Image tab)', () => {
  const LOGO = 'https://example.org/logo.png';
  const WIDE = 'https://example.org/wide.png';
  const image = (shape: SVGElement) => shape.querySelector(`.${RENDER_CLASSES.image}`);
  const boxOf = (el: Element | null) => ['x', 'y', 'width', 'height'].map((a) => Number(el?.getAttribute(a)));

  it('at its own size, in the corner or at the side it names, inside the outline; over the fill, under the text', () => {
    rememberImageSize(LOGO, { width: 40, height: 20 });
    const shape = drawElement({ image: LOGO, imagePosition: 'BottomRight' });
    const drawn = image(shape)!;
    // 160 × 80 less 3 all round: its bottom right corner at (157, 77).
    expect(boxOf(drawn)).toEqual([117, 57, 40, 20]);
    expect(drawn.getAttribute('href')).toBe(LOGO);
    expect(drawn.getAttribute('data-image-position')).toBe('BottomRight');
    const order = [...shape.children];
    expect(order.indexOf(body(shape))).toBeLessThan(order.indexOf(drawn));
    expect(order.indexOf(drawn)).toBeLessThan(order.indexOf(label(shape)));
    // Top left when it says nothing.
    harness!.destroy();
    expect(boxOf(image(drawElement({ image: LOGO })))).toEqual([3, 3, 40, 20]);
  });

  it('made smaller to fit — never larger — or filling the node; a picture not loaded, not drawn', () => {
    rememberImageSize(WIDE, { width: 400, height: 100 });
    expect(imageBox({ x: 3, y: 3, width: 154, height: 74 }, 'Center', { width: 400, height: 100 })).toEqual({ x: 3, y: 20.75, width: 154, height: 38.5 });
    expect(boxOf(image(drawElement({ image: WIDE, imagePosition: 'MiddleLeft' })))).toEqual([3, 20.75, 154, 38.5]);
    harness!.destroy();
    // Filling it, at any size: the picture stretched to the node.
    const filled = image(drawElement({ image: 'https://example.org/unknown-size.png', imagePosition: 'Fill' }))!;
    expect([...boxOf(filled), filled.getAttribute('preserveAspectRatio')]).toEqual([3, 3, 154, 74, 'none']);
    harness!.destroy();
    // Its size not known — loading, which jsdom never finishes — or not loading at all: nothing yet.
    expect(image(drawElement({ image: 'https://example.org/unknown-size.png' }))).toBeNull();
    harness!.destroy();
    rememberImageSize('https://example.org/missing.png', null);
    expect(image(drawElement({ image: 'https://example.org/missing.png' }))).toBeNull();
  });

  it('as the figure: a placement’s own icon drawn as its notation’s glyph would be — as it is, not in the icon colour', () => {
    const shape = drawElement({ iconSymbol: LOGO, renderingMode: 'IconCentric', iconColor: '#7a0019' });
    expect(shape.getAttribute('data-rendering-mode')).toBe('IconCentric');
    const icon = shape.querySelector(`.${RENDER_CLASSES.icon}`)!;
    expect([icon.getAttribute('href'), icon.getAttribute('data-own-icon'), icon.getAttribute('filter')]).toEqual([LOGO, 'true', null]);
    harness!.destroy();
    // As its badge, with the shape: its own picture in the glyph's place.
    const badged = drawElement({ iconSymbol: LOGO, renderingMode: 'ShapeWithBadge' });
    expect(badged.querySelector(`.${RENDER_CLASSES.badge}`)?.getAttribute('href')).toBe(LOGO);
  });

  it('not with "Notation only" — it is the placement’s own look; a figure’s, always', () => {
    rememberImageSize(LOGO, { width: 40, height: 20 });
    expect(image(drawElement({ image: LOGO }, { relationshipNames: false, notationOnly: true }))).toBeNull();
    harness!.destroy();
    const note = boot({ relationshipNames: false, notationOnly: true }).drawShape(
      { iri: 'https://example.org/model/n1', typeIri: '', kind: 'figure', label: 'n', figure: { kind: 'note', image: LOGO, imagePosition: 'TopRight' } },
      { width: 185, height: 80 },
    );
    expect(boxOf(image(note))).toEqual([142, 3, 40, 20]);
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
