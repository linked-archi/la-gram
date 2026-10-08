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

function mount(): DiagramCanvas {
  const elementManager: ElementManager = {
    createElement: vi.fn(() => namedNode('https://example.org/model/new') as unknown as NamedNode),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn().mockReturnValue([]),
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

  it('gives every shape type its own path, except that inner lines are not outline', () => {
    const canvas = mount();
    const paths = SHAPE_TYPES.map((shapeType) => {
      const iri = `https://example.org/model/${shapeType}`;
      canvas.addElement(iri, typeIriFor(shapeType), { x: 10, y: 20, width: 100, height: 60 });
      return shapePathOf(canvas, iri);
    });

    // The banded and tabbed rectangles dock as the rectangle they are drawn in,
    // and the wavy banded one as the wavy one.
    const sharingAnOutline = ['BandedRectangle', 'DoubleBandedRectangle', 'TabbedRectangle', 'WavyBandedRectangle'];
    expect(new Set(paths).size).toBe(SHAPE_TYPES.length - sharingAnOutline.length);
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
