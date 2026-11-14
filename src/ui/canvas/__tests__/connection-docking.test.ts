// @vitest-environment jsdom

/**
 * Connection docking, through a real diagram-js instance.
 *
 * Two things are under test, and they are the same defect seen from two ends:
 *
 * 1. `connectionDocking` is bound at all — diagram-js's `features/modeling`
 *    binds only `modeling` and `layouter`, so without the binding in
 *    `rdfModelingModule` a connection's waypoints run to the shape *centres* and
 *    the line is painted underneath the shapes.
 * 2. The path it crops against is the shape's real outline — `getShapePath` used
 *    to return a rectangle for every element, so an octagon or a diamond docked
 *    as if it were a box.
 *
 * And the ways an end used to come off: a move, resize or reattach squashing a
 * bent route to two points; an end dropped beside its element, in the empty
 * corner of its box, or on empty canvas; and an end on another relationship,
 * left behind when either of the two moved.
 *
 * jsdom has no SVG geometry engine, so every assertion here is on an emitted
 * path *string* or on waypoint coordinates, both of which diagram-js computes in
 * plain JavaScript (`path-intersection`). Nothing is measured.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import CroppingConnectionDockingClass from 'diagram-js/lib/layout/CroppingConnectionDocking.js';
import type { ShapeType, VisualStyle } from '../../../metamodel-manager/notation.js';
import type {
  ElementTypeInfo,
  PaletteDefinition,
} from '../../../metamodel-manager/interfaces.js';
import type { ElementManager, RelationshipManager } from '../../../model-manager/interfaces.js';
import { DiagramCanvas } from '../diagram-canvas.js';
import { CroppingLayouter } from '../connection-docking.js';
import { SHAPE_TYPES, shapePath } from '../notation-shapes.js';
import { archimateShape } from './notation-shape-fixtures.js';
import { EventBus } from '../../event-bus.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const { namedNode } = DataFactory;

const MODEL_IRI = 'https://example.org/model/test';
const REL_TYPE = 'https://example.org/mm#Serves';
/** An element type the palette does not know at all. */
const UNKNOWN_TYPE = 'https://example.org/mm#NotInThePalette';
/** A type in the palette but carrying no `style` — the no-notation case. */
const UNSTYLED_TYPE = 'https://example.org/mm#Unstyled';
/** A type drawn with a notation's own shape: ArchiMate's 3D box. */
const BOX3D_TYPE = 'https://example.org/mm#Box3D';
/** A type rendered as a bare glyph, so no shape body is drawn. */
const ICON_CENTRIC_TYPE = 'https://example.org/mm#IconCentric';
/** A glyph the bundle really ships, so `iconHref` resolves it. */
const BUNDLED_GLYPH = 'archimate4/icons/glyphs/actor.svg';

/** Type IRI for the element type drawn with `shapeType`. */
function typeIriFor(shapeType: ShapeType): string {
  return `https://example.org/mm#${shapeType}`;
}

function styledType(shapeType: ShapeType): ElementTypeInfo {
  const style: VisualStyle = {
    shapeType,
    fillColor: '#FFFFFF',
    lineColor: '#000000',
    renderingMode: 'ShapeOnly',
    defaultWidth: 100,
    defaultHeight: 100,
  };
  return { iri: typeIriFor(shapeType), label: shapeType, isAbstract: false, style, renderingMode: 'ShapeOnly' };
}

function palette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Shapes',
        elements: [
          ...SHAPE_TYPES.map(styledType),
          {
            iri: BOX3D_TYPE,
            label: '3D box',
            isAbstract: false,
            style: { shapeType: 'Rectangle', customShape: archimateShape('Box3D'), renderingMode: 'ShapeOnly' },
            renderingMode: 'ShapeOnly',
          },
          { iri: UNSTYLED_TYPE, label: 'Unstyled', isAbstract: false },
          {
            iri: ICON_CENTRIC_TYPE,
            label: 'Icon Centric',
            isAbstract: false,
            style: {
              shapeType: 'Ellipse',
              fillColor: '#FFFFFF',
              lineColor: '#000000',
              renderingMode: 'IconCentric',
              iconSymbol: BUNDLED_GLYPH,
              defaultWidth: 100,
              defaultHeight: 100,
            },
            renderingMode: 'IconCentric',
          },
        ],
      },
    ],
    relationshipTypes: [
      {
        iri: REL_TYPE,
        label: 'Serves',
        domainTypes: SHAPE_TYPES.map(typeIriFor),
        rangeTypes: SHAPE_TYPES.map(typeIriFor),
        relationshipStyle: {
          lineStyle: 'SolidLine',
          sourceDecor: 'NoDecoration',
          targetDecor: 'OpenArrowhead',
        },
      },
    ],
  };
}

let created: DiagramCanvas[] = [];

afterEach(() => {
  for (const canvas of created) canvas.destroy();
  created = [];
  document.body.innerHTML = '';
});

/**
 * A canvas over the test palette. `permit` makes the metamodel allow `Serves`
 * between any two elements, which the rules need before a drag may reattach an
 * end; nothing else here consults them.
 */
function mount(options: { permit?: boolean } = {}): DiagramCanvas {
  const elementManager: ElementManager = {
    createElement: vi.fn(() => namedNode('https://example.org/model/new') as unknown as NamedNode),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn().mockReturnValue(options.permit ? palette().relationshipTypes : []),
    createRelationship: vi.fn(
      () => namedNode('https://example.org/model/rel-1') as unknown as NamedNode,
    ),
    deleteRelationship: vi.fn(),
  };

  const container = document.createElement('div');
  document.body.appendChild(container);

  const canvas = new DiagramCanvas({
    container,
    eventBus: new EventBus(),
    elementManager,
    relationshipManager,
    paletteDefinition: palette(),
    modelIri: MODEL_IRI,
  });
  created.push(canvas);
  return canvas;
}

function service<T>(canvas: DiagramCanvas, name: string): T {
  const diagram = canvas.getDiagram();
  if (!diagram) throw new Error('canvas has no diagram');
  return (diagram as unknown as { get(n: string): T }).get(name);
}

interface Point {
  x: number;
  y: number;
  original?: Point;
}

interface Shape {
  x: number;
  y: number;
  width: number;
  height: number;
  waypoints?: Point[];
}

function registry(canvas: DiagramCanvas) {
  return service<{ get(id: string): Shape | undefined }>(canvas, 'elementRegistry');
}

/** The path diagram-js would crop a connection against for this element. */
function shapePathOf(canvas: DiagramCanvas, iri: string): string {
  const element = registry(canvas).get(iri);
  return service<{ getShapePath(e: unknown): string }>(canvas, 'graphicsFactory').getShapePath(
    element,
  );
}

/**
 * Two shapes plus a connection between them.
 *
 * The default bounds put the two side by side, 100 apart, so a straight
 * centre-to-centre line crosses the facing edges well away from any corner.
 */
function withConnection(
  canvas: DiagramCanvas,
  sourceType: string,
  targetType: string,
  bounds: { source?: Partial<Shape>; target?: Partial<Shape> } = {},
): { source: Shape; target: Shape; waypoints: Point[] } {
  const sourceBounds = { x: 0, y: 0, width: 100, height: 100, ...bounds.source };
  const targetBounds = { x: 200, y: 100, width: 100, height: 100, ...bounds.target };

  canvas.addElement(SOURCE_IRI, sourceType, sourceBounds);
  canvas.addElement(TARGET_IRI, targetType, targetBounds);
  canvas.addRelationship(SOURCE_IRI, TARGET_IRI, REL_TYPE);

  const source = registry(canvas).get(SOURCE_IRI);
  const target = registry(canvas).get(TARGET_IRI);
  const connection = registry(canvas).get(
    [...canvas.getRelationships().keys()][0] as string,
  );
  if (!source || !target || !connection?.waypoints) throw new Error('connection not drawn');

  return { source, target, waypoints: connection.waypoints };
}

const SOURCE_IRI = 'https://example.org/model/source';
const TARGET_IRI = 'https://example.org/model/target';

/** Centre of a shape, as `BaseLayouter` would compute it. */
function mid(shape: Shape): Point {
  return {
    x: Math.round(shape.x + shape.width / 2),
    y: Math.round(shape.y + shape.height / 2),
  };
}

// ── The services are bound ───────────────────────────────────────────────

describe('connectionDocking service', () => {
  it('resolves, and is diagram-js\u2019s CroppingConnectionDocking', () => {
    const canvas = mount();

    const docking = service<object>(canvas, 'connectionDocking');

    expect(docking).toBeInstanceOf(CroppingConnectionDockingClass);
    // Not the no-op base: the cropping implementation is the one with a
    // graphics factory behind it.
    expect(
      typeof (docking as { getCroppedWaypoints?: unknown }).getCroppedWaypoints,
    ).toBe('function');
  });

  it('replaces BaseLayouter with the cropping one', () => {
    const canvas = mount();

    expect(service<object>(canvas, 'layouter')).toBeInstanceOf(CroppingLayouter);
  });
});

// ── getShapePath follows the notation ────────────────────────────────────

describe('getShapePath', () => {
  for (const shapeType of SHAPE_TYPES) {
    it(`emits the ${shapeType} outline, offset by the shape position`, () => {
      const canvas = mount();
      canvas.addElement(SOURCE_IRI, typeIriFor(shapeType), {
        x: 10,
        y: 20,
        width: 100,
        height: 60,
      });

      expect(shapePathOf(canvas, SOURCE_IRI)).toBe(shapePath(shapeType, 10, 20, 100, 60));
    });
  }

  it('emits a notation\'s own shape\'s outline from its template, offset by the shape position', () => {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, BOX3D_TYPE, { x: 10, y: 20, width: 100, height: 60 });
    expect(shapePathOf(canvas, SOURCE_IRI)).toBe('M10,32L22,20L110,20L110,68L98,80L10,80Z');
  });

  it('gives every shape type its own path', () => {
    const canvas = mount();
    const paths = SHAPE_TYPES.map((shapeType) => {
      const iri = `https://example.org/model/${shapeType}`;
      canvas.addElement(iri, typeIriFor(shapeType), { x: 10, y: 20, width: 100, height: 60 });
      return shapePathOf(canvas, iri);
    });

    expect(new Set(paths).size).toBe(SHAPE_TYPES.length);
  });

  it('follows the shape as it moves, resizes and is retyped — though it is kept between asks (Task 22)', () => {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, typeIriFor('Rectangle'), { x: 10, y: 20, width: 100, height: 60 });
    expect(shapePathOf(canvas, SOURCE_IRI)).toBe(shapePath('Rectangle', 10, 20, 100, 60));
    canvas.updateElement(SOURCE_IRI, { bounds: { x: 30, y: 40, width: 80, height: 50 } });
    expect(shapePathOf(canvas, SOURCE_IRI)).toBe(shapePath('Rectangle', 30, 40, 80, 50));
    const shape = registry(canvas).get(SOURCE_IRI) as unknown as { businessObject: { typeIri: string } };
    shape.businessObject.typeIri = typeIriFor('Diamond');
    expect(shapePathOf(canvas, SOURCE_IRI)).toBe(shapePath('Diamond', 30, 40, 80, 50));
  });

  it('falls back to the rectangle path for a type with no notation style', () => {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, UNSTYLED_TYPE, { x: 10, y: 20, width: 100, height: 60 });

    expect(shapePathOf(canvas, SOURCE_IRI)).toBe(shapePath('Rectangle', 10, 20, 100, 60));
  });

  it('falls back to the rectangle path for a type the palette does not know', () => {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, UNKNOWN_TYPE, { x: 10, y: 20, width: 100, height: 60 });

    expect(shapePathOf(canvas, SOURCE_IRI)).toBe(shapePath('Rectangle', 10, 20, 100, 60));
  });

  it('uses the full bounds for an IconCentric type, which draws no body', () => {
    // IconCentric paints a glyph over a transparent full-bounds hit container
    // and no shape at all, so that container is the outline a connection has to
    // meet — the style's `shapeType` is never drawn.
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, ICON_CENTRIC_TYPE, { x: 10, y: 20, width: 100, height: 60 });

    expect(shapePathOf(canvas, SOURCE_IRI)).toBe(shapePath('Rectangle', 10, 20, 100, 60));
    expect(shapePathOf(canvas, SOURCE_IRI)).not.toBe(shapePath('Ellipse', 10, 20, 100, 60));
  });
});

// ── Waypoints stop at the edge ───────────────────────────────────────────

describe('a drawn connection docks to the shape boundaries', () => {
  it('does not run to the shape centres', () => {
    const canvas = mount();
    // Rectangles at (0,0,100,100) and (200,0,100,100): the centre-to-centre
    // line is y = 50, crossing the right edge of one at x = 100 and the left
    // edge of the other at x = 200. Centres would be x = 50 and x = 250.
    const { source, target, waypoints } = withConnection(
      canvas,
      typeIriFor('Rectangle'),
      typeIriFor('Rectangle'),
      { target: { x: 200, y: 0 } },
    );

    expect(waypoints).toHaveLength(2);
    expect(waypoints[0]).toMatchObject({ x: 100, y: 50 });
    expect(waypoints[1]).toMatchObject({ x: 200, y: 50 });

    // The defect, stated directly.
    expect(waypoints[0]).not.toMatchObject(mid(source));
    expect(waypoints[1]).not.toMatchObject(mid(target));
  });

  it('remembers the uncropped centre on each endpoint', () => {
    // `original` is what diagram-js re-docks from when a shape moves; without it
    // each move would compound the previous crop.
    const canvas = mount();
    const { source, target, waypoints } = withConnection(
      canvas,
      typeIriFor('Rectangle'),
      typeIriFor('Rectangle'),
      { target: { x: 200, y: 0 } },
    );

    expect(waypoints[0].original).toEqual(mid(source));
    expect(waypoints[1].original).toEqual(mid(target));
  });

  it('docks a Diamond differently from a Rectangle of the same bounds', () => {
    // Source (0,0,100,100), target (200,100,100,100): the centre-to-centre line
    // runs from (50,50) to (250,150), slope 1/2. It leaves a rectangle at its
    // right edge, (100,75); it leaves a diamond on the upper-right facet
    // x + y = 150, at (83,67). Neither point is a vertex, so the difference is
    // geometry and not a rounding artefact.
    const rectangle = withConnection(
      mount(),
      typeIriFor('Rectangle'),
      typeIriFor('Rectangle'),
    ).waypoints;
    const diamond = withConnection(
      mount(),
      typeIriFor('Diamond'),
      typeIriFor('Rectangle'),
    ).waypoints;

    expect(rectangle[0]).toMatchObject({ x: 100, y: 75 });
    expect(diamond[0]).toMatchObject({ x: 83, y: 67 });

    // Both start from the same centre, so only the outline can explain this.
    expect(diamond[0].original).toEqual(rectangle[0].original);
    // Inside the rectangle's bounds, so a box-shaped path could not produce it.
    expect(diamond[0].x).toBeLessThan(rectangle[0].x);
    // The unchanged target end is identical, which isolates the source outline
    // as the only difference.
    expect(diamond[1]).toEqual(rectangle[1]);
  });

  it('docks an Octagon inside the rectangle it used to be cropped as', () => {
    // Target at (200,160) puts the centre-to-centre line on slope 0.8, which
    // leaves a rectangle at (100,90) but crosses the octagon's cut corner —
    // the segment x + y = 175 — at (92,83). A shallower bearing would exit
    // exactly through the octagon's (100,75) vertex and prove nothing.
    const bounds = { target: { x: 200, y: 160 } };
    const octagon = withConnection(
      mount(),
      typeIriFor('Octagon'),
      typeIriFor('Rectangle'),
      bounds,
    ).waypoints;
    const rectangle = withConnection(
      mount(),
      typeIriFor('Rectangle'),
      typeIriFor('Rectangle'),
      bounds,
    ).waypoints;

    expect(rectangle[0]).toMatchObject({ x: 100, y: 90 });
    expect(octagon[0]).toMatchObject({ x: 92, y: 83 });
    expect(octagon[1]).toEqual(rectangle[1]);
  });
});

// ── Re-docking ───────────────────────────────────────────────────────────

describe('a new line between two elements', () => {
  it('runs centre to centre, wherever the gesture pressed and let go, cropped at the outlines', () => {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, typeIriFor('Rectangle'), { x: 0, y: 0, width: 100, height: 100 });
    canvas.addElement(TARGET_IRI, typeIriFor('Rectangle'), { x: 200, y: 0, width: 100, height: 100 });
    const source = registry(canvas).get(SOURCE_IRI)!;
    const target = registry(canvas).get(TARGET_IRI)!;
    const layouter = service<{ layoutConnection(connection: unknown, hints?: unknown): Point[] }>(canvas, 'layouter');

    // As `Connect` asks it: pressed near the source's bottom-left corner, let go near the target's top-right.
    const waypoints = layouter.layoutConnection(
      { source, target },
      { source, target, connectionStart: { x: 10, y: 90 }, connectionEnd: { x: 290, y: 5 } },
    );

    expect(waypoints).toHaveLength(2);
    expect(waypoints[0]).toMatchObject({ x: 100, y: 50 });
    expect(waypoints[1]).toMatchObject({ x: 200, y: 50 });
  });
});

describe('re-docking', () => {
  it('re-docks a connection when the target shape moves', () => {
    const canvas = mount();
    const { waypoints } = withConnection(
      canvas,
      typeIriFor('Rectangle'),
      typeIriFor('Rectangle'),
      { target: { x: 200, y: 0 } },
    );
    expect(waypoints[1]).toMatchObject({ x: 200, y: 50 });

    const target = registry(canvas).get(TARGET_IRI);
    service<{ moveElements(elements: unknown[], delta: unknown): void }>(
      canvas,
      'modeling',
    ).moveElements([target], { x: 0, y: 300 });

    const connectionId = [...canvas.getRelationships().keys()][0] as string;
    const moved = registry(canvas).get(connectionId)?.waypoints;
    if (!moved) throw new Error('connection lost its waypoints');

    // Target centre is now (250, 350); the line enters through the top edge.
    expect(moved[1].original).toEqual({ x: 250, y: 350 });
    expect(moved[1].y).toBe(300);
    expect(moved[1]).not.toMatchObject({ x: 250, y: 350 });
    // The source end re-docks too, on the line's new bearing.
    expect(moved[0]).not.toEqual(waypoints[0]);
    expect(moved[0].original).toEqual({ x: 50, y: 50 });
  });

  it('re-docks against the new outline when the source moves', () => {
    const canvas = mount();
    withConnection(canvas, typeIriFor('Diamond'), typeIriFor('Rectangle'), {
      target: { x: 400, y: 0 },
    });

    const source = registry(canvas).get(SOURCE_IRI);
    service<{ moveElements(elements: unknown[], delta: unknown): void }>(
      canvas,
      'modeling',
    ).moveElements([source], { x: 0, y: 200 });

    const connectionId = [...canvas.getRelationships().keys()][0] as string;
    const moved = registry(canvas).get(connectionId)?.waypoints;
    if (!moved) throw new Error('connection lost its waypoints');

    // The diamond is now at (0,200,100,100), centre (50,250). The docking point
    // must sit on its outline: |x - 50| / 50 + |y - 250| / 50 == 1.
    const onOutline = Math.abs(moved[0].x - 50) / 50 + Math.abs(moved[0].y - 250) / 50;
    expect(onOutline).toBeCloseTo(1, 1);
  });
});

// ── Bendpoints ───────────────────────────────────────────────────────────

describe('cropping preserves the middle of the connection', () => {
  it('replaces only the two ends, keeping the bendpoints between them', () => {
    // The path a bendpoint drag takes: `BendpointMove` re-crops the connection
    // through the docking service rather than re-laying it out, so the user's
    // routing has to survive.
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, typeIriFor('Rectangle'), {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    canvas.addElement(TARGET_IRI, typeIriFor('Rectangle'), {
      x: 400,
      y: 0,
      width: 100,
      height: 100,
    });
    canvas.addRelationship(SOURCE_IRI, TARGET_IRI, REL_TYPE);

    const connectionId = [...canvas.getRelationships().keys()][0] as string;
    const connection = registry(canvas).get(connectionId);
    const bend = { x: 250, y: -200 };

    service<{ updateWaypoints(c: unknown, w: unknown[]): void }>(
      canvas,
      'modeling',
    ).updateWaypoints(connection, [{ x: 50, y: 50 }, bend, { x: 450, y: 50 }]);

    const cropped = service<{
      getCroppedWaypoints(c: unknown): Point[];
    }>(canvas, 'connectionDocking').getCroppedWaypoints(connection);

    expect(cropped).toHaveLength(3);
    expect(cropped[1]).toEqual(bend);
    // Both ends leave through the top edge, on the way to the bendpoint above.
    expect(cropped[0]).not.toMatchObject({ x: 50, y: 50 });
    expect(cropped[0].x).toBe(90);
    expect(cropped[0].y).toBeCloseTo(0);
    expect(cropped[2]).not.toMatchObject({ x: 450, y: 50 });
    expect(cropped[2].x).toBe(410);
    expect(cropped[2].y).toBeCloseTo(0);
  });
});

// ── Re-stacking after a change (Task 22) ─────────────────────────────────

describe('the graphics of what changed', () => {
  type Element = { id: string; parent?: Element; children?: Element[] };
  /** Each parent's graphics, in order: the ids of the groups its children container holds. */
  function stacked(canvas: DiagramCanvas, parent: Element): string[] {
    const graphics = service<{ _getChildrenContainer(e: Element): SVGElement }>(canvas, 'graphicsFactory');
    const elements = service<{ get(gfx: SVGElement): Element | undefined }>(canvas, 'elementRegistry');
    return [...graphics._getChildrenContainer(parent).children]
      .filter((g) => g.classList.contains('djs-group'))
      .map((g) => elements.get(g.firstElementChild as SVGElement)?.id ?? '?');
  }

  it('stay in their parent’s order after a move and a nesting, and only they are moved', () => {
    const canvas = mount();
    const ids = ['a', 'b', 'c', 'd'].map((x) => `https://example.org/model/${x}`);
    ids.forEach((iri, i) => canvas.addElement(iri, typeIriFor('Rectangle'), { x: 10 + i * 200, y: 20, width: 150, height: 150 }));
    canvas.addRelationship(ids[0], ids[1], REL_TYPE, 'https://example.org/model/r1');
    const reg = registry(canvas) as unknown as { get(id: string): Element };
    const root = service<{ getRootElement(): Element }>(canvas, 'canvas').getRootElement();
    const modeling = service<{ moveShape(s: Element, d: { x: number; y: number }, parent?: Element): void }>(canvas, 'modeling');
    const container = service<{ _getChildrenContainer(e: Element): SVGElement }>(canvas, 'graphicsFactory')._getChildrenContainer(root);

    const inserts = vi.spyOn(container, 'insertBefore');
    modeling.moveShape(reg.get(ids[2]), { x: 0, y: 40 });
    expect(stacked(canvas, root)).toEqual(root.children!.map((c) => c.id));
    expect(inserts.mock.calls.length).toBeLessThanOrEqual(1);

    // Into a container: its graphics move into the container's.
    modeling.moveShape(reg.get(ids[3]), { x: -580, y: 10 }, reg.get(ids[0]));
    expect(reg.get(ids[3]).parent?.id).toBe(ids[0]);
    expect(stacked(canvas, reg.get(ids[0]))).toEqual([ids[3]]);
    expect(stacked(canvas, root)).toEqual(root.children!.map((c) => c.id));
  });
});

// ── Routes stored with or without their ends ─────────────────────────────

describe('a right-angled route, as Arrange view draws it, when an element moves', () => {
  const A = 'https://example.org/model/sa';
  const B = 'https://example.org/model/sb';
  const REL = 'https://example.org/model/square';
  /** A over B, to its right: down from A's bottom, across, down into B's top. */
  function arranged() {
    const canvas = mount();
    canvas.addElement(A, typeIriFor('Rectangle'), { x: 0, y: 0, width: 100, height: 60 });
    canvas.addElement(B, typeIriFor('Rectangle'), { x: 300, y: 200, width: 100, height: 60 });
    canvas.addRelationship(A, B, REL_TYPE, REL, [
      { x: 50, y: 60 },
      { x: 50, y: 130 },
      { x: 350, y: 130 },
      { x: 350, y: 200 },
    ]);
    return canvas;
  }
  const move = (canvas: DiagramCanvas, iri: string, delta: Point) =>
    service<{ moveElements(elements: unknown[], delta: unknown): void }>(canvas, 'modeling').moveElements([registry(canvas).get(iri)], delta);
  const routeOf = (canvas: DiagramCanvas) =>
    (registry(canvas).get(REL)!.waypoints ?? []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const square = (route: Point[]) =>
    route.every((p, i) => i === 0 || Math.abs(p.x - route[i - 1]!.x) <= 1 || Math.abs(p.y - route[i - 1]!.y) <= 1);

  it('keeps its right angles: the bend next to the moved end follows it, the others stay', () => {
    const canvas = arranged();
    move(canvas, B, { x: 40, y: 0 });
    expect(routeOf(canvas)).toEqual([
      { x: 50, y: 60 },
      { x: 50, y: 130 },
      { x: 390, y: 130 },
      { x: 390, y: 200 },
    ]);
  });

  it('moved the other way, along its own segment, too', () => {
    const canvas = arranged();
    move(canvas, A, { x: 0, y: 30 });
    const route = routeOf(canvas);
    expect(square(route)).toBe(true);
    expect(route[0]).toEqual({ x: 50, y: 90 });
    expect(route.at(-1)).toEqual({ x: 350, y: 200 });
  });

  it('is routed again at right angles where the old bends would fall inside an element', () => {
    const canvas = arranged();
    // B moved up beside A: the bend at y = 130 is inside it now.
    move(canvas, B, { x: 0, y: -100 });
    const route = routeOf(canvas);
    expect(square(route)).toBe(true);
    expect(route.length).toBeGreaterThanOrEqual(2);
  });

  /** A over B, an arranged straight line from A's bottom to B's top — on the outlines, not the centres. */
  function stacked() {
    const canvas = mount();
    canvas.addElement(A, typeIriFor('Rectangle'), { x: 0, y: 0, width: 100, height: 60 });
    canvas.addElement(B, typeIriFor('Rectangle'), { x: 0, y: 200, width: 100, height: 60 });
    canvas.addRelationship(A, B, REL_TYPE, REL, [{ x: 50, y: 60 }, { x: 50, y: 200 }]);
    return canvas;
  }

  it('an arranged straight line becomes right-angled when an element leaves its axis, its ends where they were', () => {
    const canvas = stacked();
    move(canvas, B, { x: 150, y: 0 });
    const route = routeOf(canvas);
    expect(square(route)).toBe(true);
    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual({ x: 50, y: 60 });
    expect(route.at(-1)).toEqual({ x: 200, y: 200 });
  });

  it('an arranged straight line moved along its axis stays straight', () => {
    const canvas = stacked();
    move(canvas, B, { x: 0, y: 50 });
    expect(routeOf(canvas)).toEqual([{ x: 50, y: 60 }, { x: 50, y: 250 }]);
  });

  it('leaves a straight line straight, aimed at the centres', () => {
    const canvas = mount();
    const { waypoints } = withConnection(canvas, typeIriFor('Rectangle'), typeIriFor('Rectangle'), { target: { x: 200, y: 0 } });
    expect(waypoints).toHaveLength(2);
    move(canvas, TARGET_IRI, { x: 0, y: 120 });
    const id = [...canvas.getRelationships().keys()][0] as string;
    const moved = registry(canvas).get(id)!.waypoints!;
    expect(moved).toHaveLength(2);
    expect(moved[0].original).toEqual({ x: 50, y: 50 });
    expect(moved[1].original).toEqual({ x: 250, y: 170 });
  });
});

describe('a stored route', () => {
  const A = 'https://example.org/model/ra';
  const B = 'https://example.org/model/rb';
  const REL = 'https://example.org/model/route';
  function draw(points: Array<{ x: number; y: number }>, shape: ShapeType = 'Rectangle') {
    const canvas = mount();
    canvas.addElement(A, typeIriFor(shape), { x: 0, y: 0, width: 100, height: 100 });
    canvas.addElement(B, typeIriFor(shape), { x: 400, y: 0, width: 100, height: 100 });
    canvas.addRelationship(A, B, REL_TYPE, REL, points);
    return (registry(canvas).get(REL)!.waypoints ?? []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }

  it('with its ends on its shapes — as la-gram writes it — is drawn as it is', () => {
    expect(draw([{ x: 100, y: 50 }, { x: 250, y: -40 }, { x: 400, y: 50 }])).toEqual([{ x: 100, y: 50 }, { x: 250, y: -40 }, { x: 400, y: 50 }]);
  });

  it('of bends only runs from the shapes’ outlines through them', () => {
    // From each centre towards its bend, out through the box's side.
    expect(draw([{ x: 200, y: -60 }, { x: 300, y: -60 }])).toEqual([{ x: 100, y: 13 }, { x: 200, y: -60 }, { x: 300, y: -60 }, { x: 400, y: 13 }]);
  });

  it('of one point is one bend', () => {
    const route = draw([{ x: 250, y: 200 }]);
    expect(route).toHaveLength(3);
    expect(route[1]).toEqual({ x: 250, y: 200 });
    expect(route[0]).toEqual({ x: 100, y: 88 });
    expect(route[2]).toEqual({ x: 400, y: 88 });
  });

  it('a bend inside its shape, off the outline, is still a bend', () => {
    const route = draw([{ x: 50, y: 70 }, { x: 450, y: 70 }]);
    expect(route).toHaveLength(4);
    expect(route.slice(1, 3)).toEqual([{ x: 50, y: 70 }, { x: 450, y: 70 }]);
  });

  it('ends are found on an outline that is not the box: an octagon’s', () => {
    const outline = shapePath('Octagon', 0, 0, 100, 100);
    const route = draw([{ x: 200, y: -60 }, { x: 300, y: -60 }], 'Octagon');
    // The first point lies on the octagon's cut corner, not on its bounding box.
    expect(route).toHaveLength(4);
    expect(route[0].x).toBeLessThan(100);
    expect(route[0].y).toBeGreaterThan(0);
    expect(draw([route[0], { x: 200, y: -60 }, { x: 300, y: -60 }, route[3]], 'Octagon')).toEqual(route);
    expect(outline.startsWith('M')).toBe(true);
  });
});

// ── Moving an end keeps the route's bends ────────────────────────────────

/** A route's points, rounded as they are persisted. */
function rounded(points: readonly Point[] | undefined): Point[] {
  return (points ?? []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

function moveElements(canvas: DiagramCanvas, iris: string[], delta: Point): void {
  service<{ moveElements(elements: unknown[], delta: Point): void }>(canvas, 'modeling').moveElements(
    iris.map((iri) => registry(canvas).get(iri)),
    delta,
  );
}

describe('moving an element keeps the bends of its relationships', () => {
  const BENT = 'https://example.org/model/bent';

  /** Boxes at (0,0) and (400,0), 100 square, joined over two bends above them. */
  function bent(): DiagramCanvas {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, typeIriFor('Rectangle'), { x: 0, y: 0, width: 100, height: 100 });
    canvas.addElement(TARGET_IRI, typeIriFor('Rectangle'), { x: 400, y: 0, width: 100, height: 100 });
    canvas.addRelationship(SOURCE_IRI, TARGET_IRI, REL_TYPE, BENT, [{ x: 200, y: -60 }, { x: 300, y: -60 }]);
    expect(rounded(registry(canvas).get(BENT)?.waypoints)).toEqual([
      { x: 100, y: 13 },
      { x: 200, y: -60 },
      { x: 300, y: -60 },
      { x: 400, y: 13 },
    ]);
    return canvas;
  }

  it('when the target moves: the bends stay, the end docks on the moved target', () => {
    const canvas = bent();
    moveElements(canvas, [TARGET_IRI], { x: 0, y: 100 });

    // Target now (400,100)–(500,200), centre (450,150). From the last bend
    // (300,-60) the line enters through the top edge, at x = 300 + 150·160/210.
    expect(rounded(registry(canvas).get(BENT)?.waypoints)).toEqual([
      { x: 100, y: 13 },
      { x: 200, y: -60 },
      { x: 300, y: -60 },
      { x: 414, y: 100 },
    ]);
  });

  it('when the source moves: the bends stay, the start docks on the moved source', () => {
    const canvas = bent();
    moveElements(canvas, [SOURCE_IRI], { x: 0, y: 100 });

    // Source now (0,100)–(100,200), centre (50,150). Towards the first bend
    // (200,-60) the line leaves through the top edge, at x = 50 + 150·50/210.
    expect(rounded(registry(canvas).get(BENT)?.waypoints)).toEqual([
      { x: 86, y: 100 },
      { x: 200, y: -60 },
      { x: 300, y: -60 },
      { x: 400, y: 13 },
    ]);
  });

  it('when an end is resized: the bends stay', () => {
    const canvas = bent();
    service<{ resizeShape(shape: unknown, bounds: Partial<Shape>): void }>(canvas, 'modeling').resizeShape(
      registry(canvas).get(TARGET_IRI),
      { x: 400, y: 0, width: 200, height: 200 },
    );
    expect(rounded(registry(canvas).get(BENT)?.waypoints).slice(1, 3)).toEqual([
      { x: 200, y: -60 },
      { x: 300, y: -60 },
    ]);
  });

  it('when a resize swallows a bend: that bend is dropped, the others stay', () => {
    // Grown left and up over the bend at (300,-60) but not the one at
    // (200,-60): diagram-js makes the swallowed bend the end's new anchor
    // (`getResizedTargetAnchor`), and the end docks on the new left edge.
    const canvas = bent();
    service<{ resizeShape(shape: unknown, bounds: Partial<Shape>): void }>(canvas, 'modeling').resizeShape(
      registry(canvas).get(TARGET_IRI),
      { x: 250, y: -100, width: 250, height: 200 },
    );
    expect(rounded(registry(canvas).get(BENT)?.waypoints)).toEqual([
      { x: 100, y: 13 },
      { x: 200, y: -60 },
      { x: 250, y: -60 },
    ]);
  });
});

// ── An end left off its element docks onto it ────────────────────────────

/** `|x−cx|/rx + |y−cy|/ry` for a diamond filling `shape`: 1 on its outline, below 1 inside. */
function diamondMeasure(point: Point, shape: Shape): number {
  const rx = shape.width / 2;
  const ry = shape.height / 2;
  return Math.abs(point.x - (shape.x + rx)) / rx + Math.abs(point.y - (shape.y + ry)) / ry;
}

interface Dragging {
  setOptions(options: Record<string, unknown>): void;
  hover(event: { element: unknown; gfx: unknown }): void;
  move(event: unknown): void;
  end(event?: unknown): void;
}

function canvasEvent(canvas: DiagramCanvas, x: number, y: number, type: string): unknown {
  return service<{ createEvent(data: Record<string, unknown>): unknown }>(canvas, 'eventBus').createEvent({
    type,
    target: service<{ getContainer(): HTMLElement }>(canvas, 'canvas').getContainer(),
    clientX: x,
    clientY: y,
    offsetX: x,
    offsetY: y,
    button: 0,
  });
}

describe('an end dropped off its element', () => {
  const REL = 'https://example.org/model/reattached';

  it('docks on the element’s outline — a drag of the start handle into a diamond’s empty corner', () => {
    // diagram-js hit-tests a shape on its bounding box (plus a 15px stroke), so
    // the corner of a diamond's box is "over the diamond" though outside it.
    const canvas = mount({ permit: true });
    canvas.addElement(SOURCE_IRI, typeIriFor('Diamond'), { x: 0, y: 0, width: 100, height: 100 });
    canvas.addElement(TARGET_IRI, typeIriFor('Rectangle'), { x: 400, y: 0, width: 100, height: 100 });
    canvas.addRelationship(SOURCE_IRI, TARGET_IRI, REL_TYPE, REL);
    const connection = registry(canvas).get(REL);
    const source = registry(canvas).get(SOURCE_IRI) as Shape;

    const dragging = service<Dragging>(canvas, 'dragging');
    dragging.setOptions({ manual: true });
    service<{ start(event: unknown, connection: unknown, index: number): void }>(canvas, 'bendpointMove').start(
      canvasEvent(canvas, 100, 50, 'mousedown'),
      connection,
      0,
    );
    dragging.move(canvasEvent(canvas, 95, 95, 'mousemove'));
    dragging.hover({
      element: source,
      gfx: service<{ getGraphics(e: unknown): unknown }>(canvas, 'elementRegistry').getGraphics(source),
    });
    dragging.move(canvasEvent(canvas, 95, 95, 'mousemove'));
    dragging.end();

    const start = registry(canvas).get(REL)?.waypoints?.[0];
    if (!start?.original) throw new Error('start lost its docking reference');
    expect(start).not.toMatchObject({ x: 95, y: 95 });
    expect(diamondMeasure(start, source)).toBeCloseTo(1, 1);
    // What later moves re-dock from lies inside the diamond, not where the pointer was.
    expect(diamondMeasure(start.original, source)).toBeLessThan(1);
  });

  it('cannot be let go on empty canvas: the relationship stays on its element', () => {
    const canvas = mount({ permit: true });
    canvas.addElement(SOURCE_IRI, typeIriFor('Rectangle'), { x: 0, y: 0, width: 100, height: 100 });
    canvas.addElement(TARGET_IRI, typeIriFor('Rectangle'), { x: 400, y: 0, width: 100, height: 100 });
    canvas.addRelationship(SOURCE_IRI, TARGET_IRI, REL_TYPE, REL);
    const connection = registry(canvas).get(REL) as Shape & { source?: unknown };
    const before = rounded(connection.waypoints);
    const root = service<{ getRootElement(): unknown }>(canvas, 'canvas').getRootElement();

    const dragging = service<Dragging>(canvas, 'dragging');
    dragging.setOptions({ manual: true });
    service<{ start(event: unknown, connection: unknown, index: number): void }>(canvas, 'bendpointMove').start(
      canvasEvent(canvas, 100, 50, 'mousedown'),
      connection,
      0,
    );
    dragging.move(canvasEvent(canvas, 200, 300, 'mousemove'));
    dragging.hover({
      element: root,
      gfx: service<{ getGraphics(e: unknown): unknown }>(canvas, 'elementRegistry').getGraphics(root),
    });
    dragging.move(canvasEvent(canvas, 200, 300, 'mousemove'));
    dragging.end();

    expect(connection.source).toBe(registry(canvas).get(SOURCE_IRI));
    expect(rounded(connection.waypoints)).toEqual(before);
  });

  it('docks on the outline whatever placed it there — the docking service itself', () => {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, typeIriFor('Rectangle'), { x: 0, y: 0, width: 100, height: 100 });
    canvas.addElement(TARGET_IRI, typeIriFor('Rectangle'), { x: 400, y: 0, width: 100, height: 100 });
    const source = registry(canvas).get(SOURCE_IRI);
    const target = registry(canvas).get(TARGET_IRI);
    const docking = service<{ getCroppedWaypoints(c: unknown, s: unknown, t: unknown): Point[] }>(
      canvas,
      'connectionDocking',
    );

    // 4px beyond the source's right edge, heading away from it: the line never
    // meets the source's outline, which is what left the end hanging there.
    const cropped = docking.getCroppedWaypoints({ waypoints: [{ x: 104, y: 50 }, { x: 450, y: 50 }] }, source, target);
    expect(rounded(cropped)).toEqual([
      { x: 100, y: 50 },
      { x: 400, y: 50 },
    ]);
  });
});

// ── A relationship whose end is another relationship ─────────────────────

/** Distance from `point` to the polyline through `points`. */
function distanceToPolyline(point: Point, points: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

describe('a relationship ending on another relationship', () => {
  const LINE = 'https://example.org/model/line';
  const ON_LINE = 'https://example.org/model/on-line';
  const THIRD_IRI = 'https://example.org/model/third';

  /**
   * `LINE` joins boxes at `at` and `at + (400,0)`; `ON_LINE` runs from a third
   * box to `LINE`, dropped on it at `on` — as the connect tool's drop does,
   * which snaps the end onto the line.
   */
  function attached(at: Point, third: Point, on: Point): DiagramCanvas {
    const canvas = mount();
    canvas.addElement(SOURCE_IRI, typeIriFor('Rectangle'), { ...at, width: 100, height: 100 });
    canvas.addElement(TARGET_IRI, typeIriFor('Rectangle'), { x: at.x + 400, y: at.y, width: 100, height: 100 });
    canvas.addElement(THIRD_IRI, typeIriFor('Rectangle'), { ...third, width: 100, height: 100 });
    canvas.addRelationship(SOURCE_IRI, TARGET_IRI, REL_TYPE, LINE);
    const from = registry(canvas).get(THIRD_IRI) as Shape;
    service<{ connect(s: unknown, t: unknown, attrs: unknown, hints: unknown): void }>(canvas, 'modeling').connect(
      from,
      registry(canvas).get(LINE),
      { id: ON_LINE, businessObject: { iri: ON_LINE, typeIri: REL_TYPE, kind: 'relationship' } },
      { connectionStart: mid(from), connectionEnd: on },
    );
    return canvas;
  }

  const endOf = (canvas: DiagramCanvas): Point => {
    const points = registry(canvas).get(ON_LINE)?.waypoints ?? [];
    return points[points.length - 1];
  };
  const lineOf = (canvas: DiagramCanvas): Point[] => registry(canvas).get(LINE)?.waypoints ?? [];

  it('is drawn to the relationship, not cropped against an outline it does not have', () => {
    // From (-150,-150) to (450,350) the line passes the diagram's origin, where
    // a relationship's missing x/y/width/height would put a default-sized box.
    const canvas = attached({ x: 300, y: 300 }, { x: -200, y: -200 }, { x: 450, y: 350 });
    expect(rounded([endOf(canvas)])).toEqual([{ x: 450, y: 350 }]);
  });

  it('stays on the relationship, at the same place along it, when that relationship moves', () => {
    // LINE runs (100,50)–(400,50); the end is a sixth of the way along.
    const canvas = attached({ x: 0, y: 0 }, { x: 200, y: 300 }, { x: 150, y: 50 });
    moveElements(canvas, [TARGET_IRI], { x: 0, y: 200 });

    // LINE now runs (100,75)–(400,225): a sixth of the way is (150,100).
    expect(rounded(lineOf(canvas))).toEqual([
      { x: 100, y: 75 },
      { x: 400, y: 225 },
    ]);
    expect(distanceToPolyline(endOf(canvas), lineOf(canvas))).toBeLessThan(1);
    expect(rounded([endOf(canvas)])).toEqual([{ x: 150, y: 100 }]);
  });

  it('goes back with the relationship on one undo', () => {
    const canvas = attached({ x: 0, y: 0 }, { x: 200, y: 300 }, { x: 150, y: 50 });
    moveElements(canvas, [TARGET_IRI], { x: 0, y: 200 });
    service<{ undo(): void }>(canvas, 'commandStack').undo();
    expect(rounded(lineOf(canvas))).toEqual([
      { x: 100, y: 50 },
      { x: 400, y: 50 },
    ]);
    expect(rounded([endOf(canvas)])).toEqual([{ x: 150, y: 50 }]);
  });

  it('stays where it was attached when its own element moves', () => {
    const canvas = attached({ x: 0, y: 0 }, { x: 200, y: 300 }, { x: 150, y: 50 });
    moveElements(canvas, [THIRD_IRI], { x: 100, y: 0 });
    expect(rounded([endOf(canvas)])).toEqual([{ x: 150, y: 50 }]);
  });

  it('moves with everything when everything moves', () => {
    const canvas = attached({ x: 0, y: 0 }, { x: 200, y: 300 }, { x: 150, y: 50 });
    moveElements(canvas, [SOURCE_IRI, TARGET_IRI, THIRD_IRI], { x: 30, y: 40 });
    expect(rounded([endOf(canvas)])).toEqual([{ x: 180, y: 90 }]);
    expect(distanceToPolyline(endOf(canvas), lineOf(canvas))).toBeLessThan(1);
  });

  it('follows the relationship when it is bent', () => {
    const canvas = attached({ x: 0, y: 0 }, { x: 200, y: 300 }, { x: 150, y: 50 });
    const line = registry(canvas).get(LINE);
    const points = lineOf(canvas);
    service<{ updateWaypoints(c: unknown, w: Point[]): void }>(canvas, 'modeling').updateWaypoints(line, [
      points[0],
      { x: 250, y: -100 },
      points[1],
    ]);
    expect(distanceToPolyline(endOf(canvas), lineOf(canvas))).toBeLessThan(1);
  });
});
