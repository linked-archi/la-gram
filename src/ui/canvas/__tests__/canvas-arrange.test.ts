// @vitest-environment jsdom

/**
 * The arrange options on the canvas (Req 22), against the real managers and the bundled ArchiMate 4.0
 * metamodel: each writes the view's bounds or routes, as one undo step, and what the selection allows is said.
 * *Line shape* (Req 22.9, `.agents/tasks/line-shape/`) too: the selected lines' routes.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { N3TtlParser } from '@linked-archi/kernel/rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '@linked-archi/kernel/rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '@linked-archi/kernel/rdf-engine/observable-store.js';
import { N3MetamodelLoader } from '@linked-archi/kernel/metamodel-manager/metamodel-loader.js';
import { SparqlPaletteGenerator } from '@linked-archi/kernel/metamodel-manager/palette-generator.js';
import type { PaletteDefinition } from '@linked-archi/kernel/metamodel-manager/interfaces.js';
import { OxigraphElementManager } from '@linked-archi/kernel/model-manager/element-manager.js';
import { OxigraphRelationshipManager } from '@linked-archi/kernel/model-manager/relationship-manager.js';
import { OxigraphViewManager } from '@linked-archi/kernel/model-manager/view-manager.js';
import { ModelSession } from '@linked-archi/kernel/model-manager/model-session.js';
import { labelOf, modelNameOf, modelQuads } from '@linked-archi/kernel/model-manager/model-queries.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas, type CanvasContextAction } from '../diagram-canvas.js';
import type { ContextMenuAction } from '../rdf-context-menu-provider.js';
import { buildClassClosure } from '../relationship-resolution.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';

installJsdomSvgSupport();

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const COMPONENT = `${AM4}ApplicationComponent`;
const nn = (v: string) => DataFactory.namedNode(v) as unknown as NamedNode;

let base: OxigraphRdfStore;
let palette: PaletteDefinition;

beforeAll(async () => {
  base = new OxigraphRdfStore();
  const loaded = await new N3MetamodelLoader(new N3TtlParser(), base).loadBundledMetamodel();
  palette = new SparqlPaletteGenerator(base).generatePalette(loaded.metamodelIri);
}, 60_000);

afterAll(() => base.dispose());

let mounted: DiagramCanvas | undefined;
afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
  const data = modelQuads(base);
  if (data.length > 0) base.removeQuads(data);
});

/** A view with elements placed as given, and relationships between them — each with the bends given — drawn on the canvas. */
function mount(
  placed: Array<{ label: string; x: number; y: number; width?: number; height?: number }>,
  related: Array<[number, number] | [number, number, Array<{ x: number; y: number }>]> = [],
  onContextAction?: (action: CanvasContextAction, iri: string) => void,
) {
  const store = new ObservableRdfStore(base);
  const elements = new OxigraphElementManager(store);
  const relationships = new OxigraphRelationshipManager(store);
  const views = new OxigraphViewManager(store);
  const session = new ModelSession(store, elements, views);
  const { modelIri, viewIri } = session.newModel({ label: 'Test' });
  const iris = placed.map((p) => {
    const iri = elements.createElement(COMPONENT, modelIri, { label: p.label }).value;
    views.addElementToView(viewIri, iri, { x: p.x, y: p.y, width: p.width ?? 120, height: p.height ?? 55 });
    return iri;
  });
  const lines = related.map(([s, t, bends]) => {
    const rel = relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: iris[s], targetIri: iris[t] });
    views.addRelationshipToView(viewIri, rel.iri, bends ?? []);
    return rel.iri;
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = new DiagramCanvas({
    container,
    eventBus: new EventBus(),
    elementManager: elements,
    relationshipManager: relationships,
    paletteDefinition: palette,
    modelIri,
    classClosure: buildClassClosure(base),
    rdfStore: store,
    viewManager: views,
    changeStore: store,
    ...(onContextAction ? { onContextAction } : {}),
    describeElement: (iri) => {
      const types = store.getQuads(nn(iri), nn(NAMESPACES.rdf + 'type')).map((q) => q.object.value);
      const typeIri = types.find((t) => t !== NAMESPACES.arch + 'QualifiedRelationship') ?? types[0];
      return { typeIri, label: labelOf(store, iri), modelName: modelNameOf(store, iri) };
    },
  });
  mounted = canvas;
  canvas.showView(viewIri);
  const service = <T,>(name: string): T => (canvas.getDiagram() as unknown as { get(n: string): T }).get(name);
  const bounds = () => iris.map((iri) => views.getNode(viewIri, iri)!.bounds);
  const route = (iri: string) => views.getLinks(viewIri).find((l) => l.relationshipIri === iri)!.waypoints;
  const connection = (iri: string) => service<{ get(id: string): unknown }>('elementRegistry').get(iri);
  return {
    canvas,
    iris,
    lines,
    bounds,
    route,
    connection,
    /** The right-click menu on a line. */
    menuOn: (iri: string) => (canvas as unknown as { contextMenuActions(target: unknown): ContextMenuAction[] }).contextMenuActions(connection(iri)),
    commandStack: service<{ undo(): void; canUndo(): boolean }>('commandStack'),
  };
}

/** Every segment along an axis. */
const rightAngled = (route: Array<{ x: number; y: number }>) => route.every((p, i) => i === 0 || p.x === route[i - 1].x || p.y === route[i - 1].y);

describe('align and distribute', () => {
  it('align left: one step, written to the view, and undone in one', () => {
    const f = mount([
      { label: 'A', x: 40, y: 20 },
      { label: 'B', x: 300, y: 120 },
      { label: 'C', x: 160, y: 240 },
    ]);
    const before = f.bounds();
    f.canvas.selectIris(f.iris);

    expect(f.canvas.alignSelection('left')).toBe(2);
    expect(f.bounds().map((b) => b.x)).toEqual([40, 40, 40]);

    f.commandStack.undo();
    expect(f.bounds()).toEqual(before);
    expect(f.commandStack.canUndo()).toBe(false);
  });

  it('distribute horizontally: equal gaps, the outer two staying', () => {
    const f = mount([
      { label: 'A', x: 0, y: 0 },
      { label: 'B', x: 150, y: 0 },
      { label: 'C', x: 480, y: 0 },
    ]);
    f.canvas.selectIris(f.iris);
    f.canvas.distributeSelection('horizontal');
    expect(f.bounds().map((b) => b.x)).toEqual([0, 240, 480]);
  });

  it('what the selection allows: align from two, distribute from three', () => {
    const f = mount([
      { label: 'A', x: 0, y: 0 },
      { label: 'B', x: 200, y: 0 },
    ]);
    expect(f.canvas.arrangeAvailability()).toMatchObject({ selected: 0, align: false });
    f.canvas.selectIris(f.iris);
    expect(f.canvas.arrangeAvailability()).toEqual({ selected: 2, align: true, distribute: false, match: true, lines: 0 });
  });
});

describe('the grid and sizes', () => {
  it('nothing selected: every element of the view to the grid', () => {
    const f = mount([
      { label: 'A', x: 13, y: 27 },
      { label: 'B', x: 207, y: 41 },
    ]);
    expect(f.canvas.alignToGrid('both', 20)).toBe(2);
    expect(f.bounds().map((b) => [b.x, b.y])).toEqual([
      [20, 20],
      [200, 40],
    ]);
  });

  it('match to the largest about each centre, then each back to its default size', () => {
    const f = mount([
      { label: 'A', x: 0, y: 0, width: 120, height: 55 },
      { label: 'B', x: 300, y: 0, width: 200, height: 95 },
    ]);
    f.canvas.selectIris(f.iris);
    f.canvas.matchSizes('largest', 'both');
    expect(f.bounds()[0]).toEqual({ x: -40, y: -20, width: 200, height: 95 });

    f.canvas.defaultSizes();
    expect(f.bounds().map((b) => [b.width, b.height])).toEqual([
      [120, 55],
      [120, 55],
    ]);
  });
});

describe('arrange relationships', () => {
  it('routes a line around an element in the way, the elements staying; undone in one step', () => {
    const f = mount(
      [
        { label: 'A', x: 0, y: 100 },
        { label: 'B', x: 500, y: 100 },
        { label: 'In the way', x: 220, y: 60, width: 120, height: 140 },
      ],
      [[0, 1]],
    );
    const before = f.bounds();
    const routeBefore = f.route(f.lines[0]);

    expect(f.canvas.arrangeRelationships()).toBe(1);
    const route = f.route(f.lines[0]);
    expect(f.bounds()).toEqual(before);
    // At right angles, and clear of the element in the way.
    expect(route.every((p, i) => i === 0 || p.x === route[i - 1].x || p.y === route[i - 1].y)).toBe(true);
    const blocker = before[2];
    const crosses = route.some((p, i) => {
      if (i === 0) return false;
      const q = route[i - 1];
      const [lo, hi] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
      const [top, bottom] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
      return lo < blocker.x + blocker.width && blocker.x < hi && top < blocker.y + blocker.height && blocker.y < bottom;
    });
    expect(crosses).toBe(false);

    f.commandStack.undo();
    expect(f.route(f.lines[0])).toEqual(routeBefore);
  });
});

describe('arrange relationships, a line selected (LS-9)', () => {
  it('routes the selected line, and no other', () => {
    const f = mount(
      [
        { label: 'A', x: 0, y: 0 },
        { label: 'B', x: 400, y: 200 },
        { label: 'C', x: 0, y: 300 },
      ],
      [
        [0, 1],
        [2, 1],
      ],
    );
    const other = f.route(f.lines[1]);
    f.canvas.selectIris([f.lines[0]]);
    expect(f.canvas.arrangeAvailability()).toMatchObject({ selected: 0, lines: 1 });

    expect(f.canvas.arrangeRelationships()).toBe(1);
    expect(rightAngled(f.route(f.lines[0]))).toBe(true);
    expect(f.route(f.lines[1])).toEqual(other);
  });
});

describe('line shape (Req 22.9)', () => {
  // The source below and to the right of its target, as a specialisation drawn up to what it specialises.
  const placed = [
    { label: 'General', x: 0, y: 0, width: 100, height: 50 },
    { label: 'Detail', x: 300, y: 200, width: 100, height: 50 },
    { label: 'Other', x: 0, y: 300, width: 100, height: 50 },
  ];

  it('vertical first: one bend, out of the source upwards and into the target from the side; undone in one step', () => {
    const f = mount(placed, [[1, 0]]);
    const before = f.route(f.lines[0]);
    f.canvas.selectIris([f.lines[0]]);

    expect(f.canvas.shapeLines('vertical-first')).toEqual({ shaped: 1, unchanged: 0, kept: 0 });
    expect(f.route(f.lines[0])).toEqual([
      { x: 350, y: 200 },
      { x: 350, y: 25 },
      { x: 100, y: 25 },
    ]);
    // Shaped so: said, and nothing written.
    expect(f.canvas.shapeLines('vertical-first')).toEqual({ shaped: 0, unchanged: 1, kept: 0 });

    f.commandStack.undo();
    expect(f.route(f.lines[0])).toEqual(before);
    expect(f.commandStack.canUndo()).toBe(false);
  });

  it('horizontal first: out of the source sideways, into the target from below', () => {
    const f = mount(placed, [[1, 0]]);
    f.canvas.selectIris([f.lines[0]]);
    f.canvas.shapeLines('horizontal-first');
    expect(f.route(f.lines[0])).toEqual([
      { x: 300, y: 225 },
      { x: 50, y: 225 },
      { x: 50, y: 50 },
    ]);
  });

  it('straight: the bends taken out, from centre to centre, ending on the outlines', () => {
    // A step through the gap between them.
    const step = [
      { x: 300, y: 225 },
      { x: 200, y: 225 },
      { x: 200, y: 25 },
      { x: 100, y: 25 },
    ];
    const f = mount(placed, [[1, 0, step]]);
    f.canvas.selectIris([f.lines[0]]);
    expect(f.route(f.lines[0])).toEqual(step);

    expect(f.canvas.shapeLines('straight').shaped).toBe(1);
    const route = f.route(f.lines[0]);
    expect(route).toHaveLength(2);
    // The line between the two centres, (350, 225) and (50, 25), from where it leaves Detail's top edge to where it
    // meets General's bottom edge.
    const near = (p: { x: number; y: number }, x: number, y: number) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1;
    expect(near(route[0], 312.5, 200)).toBe(true);
    expect(near(route[1], 87.5, 50)).toBe(true);
  });

  it('right angles: this line routed, the others staying where they are; it docks beside them and crosses none', () => {
    // Two lines out of Detail's top, both turning left: one shaped already, then the other. Alone, each would leave
    // at the middle of the top.
    const f = mount(
      [placed[0], placed[1], { label: 'Other', x: 0, y: 100, width: 100, height: 50 }],
      [
        [1, 0],
        [1, 2],
      ],
    );
    f.canvas.selectIris([f.lines[1]]);
    f.canvas.shapeLines('vertical-first');
    const kept = f.route(f.lines[1]);
    expect(kept).toEqual([
      { x: 350, y: 200 },
      { x: 350, y: 125 },
      { x: 100, y: 125 },
    ]);
    f.canvas.selectIris([f.lines[0]]);
    expect(f.canvas.shapeLines('right-angles').shaped).toBe(1);
    const route = f.route(f.lines[0]);

    expect(rightAngled(route)).toBe(true);
    expect(f.route(f.lines[1])).toEqual(kept);
    expect(route[0]).toEqual({ x: 362, y: 200 });
  });

  it('several lines at once; a line between placements one of which holds the other is left as it is', () => {
    const f = mount(
      [
        { label: 'A', x: 0, y: 0 },
        { label: 'B', x: 300, y: 200 },
        { label: 'Holder', x: 600, y: 0, width: 300, height: 200 },
        { label: 'Held', x: 650, y: 60 },
      ],
      [
        [0, 1],
        [2, 3],
      ],
    );
    f.canvas.selectIris(f.lines);
    expect(f.canvas.arrangeAvailability().lines).toBe(2);
    expect(f.canvas.shapeLines('horizontal-first')).toEqual({ shaped: 1, unchanged: 0, kept: 1 });
  });

  it('the right-click menu on a line: the four shapes in a group of their own, each shaping the selected lines', () => {
    const asked = vi.fn();
    const f = mount(placed, [[1, 0]], asked);
    f.canvas.selectIris([f.lines[0]]);
    const shapes = f.menuOn(f.lines[0]).filter((a) => a.section === 'route');
    expect(shapes.map((a) => a.label)).toEqual(['Straight', 'Right angles', 'Horizontal first', 'Vertical first']);
    shapes[3].run();
    expect(asked).toHaveBeenCalledWith('line-vertical-first', f.lines[0]);
  });

  it('on one of several lines selected, the right-click menu keeps them selected and offers the shapes for all', () => {
    const f = mount(
      placed,
      [
        [1, 0],
        [1, 2],
      ],
      vi.fn(),
    );
    f.canvas.selectIris(f.lines);
    const menu = f.menuOn(f.lines[1]);
    expect(menu.filter((a) => a.section === 'route').map((a) => a.id)).toEqual(['line-straight', 'line-right-angles', 'line-horizontal-first', 'line-vertical-first']);
    // The model has no folders: nothing to move them to.
    expect(menu.some((a) => a.id === 'move-to-folder')).toBe(false);
    expect(f.canvas.shapeLines('vertical-first').shaped).toBe(2);
  });
});
