// @vitest-environment jsdom

/**
 * The arrange options on the canvas (Req 22), against the real managers and the bundled ArchiMate 4.0
 * metamodel: each writes the view's bounds or routes, as one undo step, and what the selection allows is said.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { N3TtlParser } from '../../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../../rdf-engine/observable-store.js';
import { N3MetamodelLoader } from '../../../metamodel-manager/metamodel-loader.js';
import { SparqlPaletteGenerator } from '../../../metamodel-manager/palette-generator.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import { OxigraphElementManager } from '../../../model-manager/element-manager.js';
import { OxigraphRelationshipManager } from '../../../model-manager/relationship-manager.js';
import { OxigraphViewManager } from '../../../model-manager/view-manager.js';
import { ModelSession } from '../../../model-manager/model-session.js';
import { labelOf, modelNameOf, modelQuads } from '../../../model-manager/model-queries.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas } from '../diagram-canvas.js';
import { buildClassClosure } from '../relationship-resolution.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';

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

/** A view with elements placed as given, and relationships between them, drawn on the canvas. */
function mount(placed: Array<{ label: string; x: number; y: number; width?: number; height?: number }>, related: Array<[number, number]> = []) {
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
  const lines = related.map(([s, t]) => {
    const rel = relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: iris[s], targetIri: iris[t] });
    views.addRelationshipToView(viewIri, rel.iri, []);
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
  return {
    canvas,
    iris,
    lines,
    bounds,
    route,
    commandStack: service<{ undo(): void; canUndo(): boolean }>('commandStack'),
  };
}

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
    expect(f.canvas.arrangeAvailability()).toEqual({ selected: 2, align: true, distribute: false, match: true });
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
