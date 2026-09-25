// @vitest-environment jsdom

/**
 * The canvas working in views, against the real managers, the real bundled
 * ArchiMate 4.0 metamodel and a recording store.
 *
 * What is under test is the model/view contract:
 *
 * - a view is drawn *from the store*, and external changes are reconciled;
 * - creating on the canvas makes an element in the model *and* a node in the
 *   open view; undo takes both away, redo brings back the same IRI;
 * - moving writes the node's bounds, and undo puts the old bounds back;
 * - delete removes from the **view** — the element stays in the model;
 * - "delete from model" removes it everywhere, and one undo restores it all;
 * - placing an existing element draws its relationships to what is placed;
 * - a drawn relationship is a qualified resource with a link in the view.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
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
import { labelOf, modelQuads } from '../../../model-manager/model-queries.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas, OUTSIDE_VIEWPOINT_MARKER } from '../diagram-canvas.js';
import { buildClassClosure } from '../relationship-resolution.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';

installJsdomSvgSupport();

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const COMPONENT = `${AM4}ApplicationComponent`;
const ACTOR = `${AM4}BusinessActor`;
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

function mount() {
  const store = new ObservableRdfStore(base);
  const elements = new OxigraphElementManager(store);
  const relationships = new OxigraphRelationshipManager(store);
  const views = new OxigraphViewManager(store);
  const eventBus = new EventBus();
  const session = new ModelSession(store, elements, views);
  const { modelIri, viewIri } = session.newModel({ label: 'Test' });
  const confirm = vi.fn(() => true);
  const container = document.createElement('div');
  document.body.appendChild(container);

  const canvas = new DiagramCanvas({
    container,
    eventBus,
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
      return { typeIri, label: labelOf(store, iri) };
    },
    confirmDeleteFromModel: confirm,
  });
  mounted = canvas;
  canvas.showView(viewIri);

  const service = <T,>(name: string): T =>
    (canvas.getDiagram() as unknown as { get(n: string): T }).get(name);

  /** Create a new element the way the palette does: an IRI-less shape through `modeling`. */
  const createOnCanvas = (typeIri: string, label: string, at: { x: number; y: number }) => {
    const factory = service<{ createShape(a: Record<string, unknown>): { id: string } }>('elementFactory');
    const shape = factory.createShape({
      width: 120,
      height: 55,
      businessObject: { iri: '', typeIri, label, kind: 'element' },
    });
    const root = service<{ getRootElement(): unknown }>('canvas').getRootElement();
    service<{ createShape(s: unknown, p: unknown, parent: unknown): { id: string } }>('modeling').createShape(
      shape,
      at,
      root,
    );
    return shape.id;
  };

  return {
    store,
    elements,
    relationships,
    views,
    session,
    canvas,
    container,
    modelIri,
    viewIri,
    confirm,
    service,
    createOnCanvas,
    commandStack: service<{ undo(): void; redo(): void; canUndo(): boolean }>('commandStack'),
  };
}

describe('the canvas in view mode', () => {
  it('draws a view from the store, route included', () => {
    const f = mount();
    const a = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    const b = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const rel = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: b, targetIri: a });
    f.views.addElementToView(f.viewIri, a, { x: 0, y: 0, width: 120, height: 55 });
    f.views.addElementToView(f.viewIri, b, { x: 300, y: 0, width: 120, height: 55 });
    f.views.addRelationshipToView(f.viewIri, rel.iri, [
      { x: 300, y: 27 },
      { x: 200, y: 100 },
      { x: 120, y: 27 },
    ]);

    f.canvas.showView(f.viewIri);

    expect(f.canvas.getElement(a)?.label).toBe('Web');
    expect(f.canvas.getElement(b)?.bounds).toMatchObject({ x: 300, y: 0 });
    const connection = f.service<{ get(id: string): { waypoints: unknown[]; businessObject: { typeIri: string } } }>(
      'elementRegistry',
    ).get(rel.iri);
    expect(connection.businessObject.typeIri).toBe(`${AM4}Serving`);
    expect(connection.waypoints).toHaveLength(3);
    expect(f.commandStack.canUndo()).toBe(false);
  });

  it('creating makes an element in the model and a node in the view; undo removes both; redo restores the same IRI', () => {
    const f = mount();
    const iri = f.createOnCanvas(COMPONENT, 'Order Service', { x: 200, y: 100 });

    expect(iri).toMatch(new RegExp(`^${f.modelIri}/element/`));
    expect(labelOf(f.store, iri)).toBe('Order Service');
    // The node agrees with the drawn shape (centred on the drop point).
    expect(f.views.getNode(f.viewIri, iri)?.bounds).toEqual(f.canvas.getElement(iri)?.bounds);

    f.commandStack.undo();
    expect(f.store.getQuads(nn(iri))).toHaveLength(0);
    expect(f.views.getNodes(f.viewIri)).toHaveLength(0);

    f.commandStack.redo();
    expect(labelOf(f.store, iri)).toBe('Order Service');
    expect(f.views.getNode(f.viewIri, iri)).toBeDefined();
    expect(f.canvas.getElement(iri)).toBeDefined();
  });

  it('moving writes the node bounds, and undo puts the old ones back', () => {
    const f = mount();
    const iri = f.createOnCanvas(COMPONENT, 'X', { x: 100, y: 100 });
    const before = f.views.getNode(f.viewIri, iri)!.bounds;
    const shape = f.service<{ get(id: string): unknown }>('elementRegistry').get(iri);

    f.service<{ moveElements(e: unknown[], d: unknown): void }>('modeling').moveElements([shape], { x: 50, y: 25 });
    expect(f.views.getNode(f.viewIri, iri)!.bounds).toMatchObject({ x: before.x + 50, y: before.y + 25 });

    f.commandStack.undo();
    expect(f.views.getNode(f.viewIri, iri)!.bounds).toEqual(before);
  });

  it('delete removes from the view only; the element stays in the model; undo restores the node', () => {
    const f = mount();
    const iri = f.createOnCanvas(COMPONENT, 'Keep me', { x: 100, y: 100 });
    const shape = f.service<{ get(id: string): unknown }>('elementRegistry').get(iri);

    f.service<{ removeElements(e: unknown[]): void }>('modeling').removeElements([shape]);

    expect(f.canvas.getElement(iri)).toBeUndefined();
    expect(f.views.getNode(f.viewIri, iri)).toBeUndefined();
    expect(labelOf(f.store, iri)).toBe('Keep me');
    expect(f.store.getQuads(nn(iri), nn(NAMESPACES.rdf + 'type'))).toHaveLength(1);

    f.commandStack.undo();
    expect(f.views.getNode(f.viewIri, iri)).toBeDefined();
    expect(f.canvas.getElement(iri)).toBeDefined();
  });

  it('delete from model removes it from every view with its relationships, after confirming; one undo restores all', () => {
    const f = mount();
    const a = f.createOnCanvas(COMPONENT, 'A', { x: 100, y: 100 });
    const b = f.createOnCanvas(COMPONENT, 'B', { x: 400, y: 100 });
    const rel = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: a, targetIri: b });
    f.views.addRelationshipToView(f.viewIri, rel.iri);
    const other = f.views.createView('Diagram', undefined, { modelIri: f.modelIri }).value;
    f.views.addElementToView(other, a);
    f.canvas.syncFromStore();
    const before = modelQuads(f.store).length;

    expect(f.canvas.deleteFromModel(a)).toBe(true);

    expect(f.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ iri: a, kind: 'element', label: 'A', views: [f.viewIri, other].sort() }),
    );
    expect(f.store.getQuads(nn(a))).toHaveLength(0);
    expect(f.views.getNode(other, a)).toBeUndefined();
    expect(f.store.getQuads(nn(rel.iri))).toHaveLength(0);
    expect(f.canvas.getElement(a)).toBeUndefined();

    f.commandStack.undo();
    expect(modelQuads(f.store).length).toBe(before);
    expect(f.views.getNode(other, a)).toBeDefined();
    expect(f.canvas.getElement(a)).toBeDefined();
  });

  it('does nothing when the model delete is not confirmed', () => {
    const f = mount();
    const a = f.createOnCanvas(COMPONENT, 'A', { x: 100, y: 100 });
    f.confirm.mockReturnValueOnce(false);
    expect(f.canvas.deleteFromModel(a)).toBe(false);
    expect(f.store.getQuads(nn(a)).length).toBeGreaterThan(0);
  });

  it('placing an existing element draws its relationships to what is already placed', () => {
    const f = mount();
    const a = f.createOnCanvas(COMPONENT, 'A', { x: 100, y: 100 });
    const b = f.elements.createElement(COMPONENT, f.modelIri, { label: 'B' }).value;
    const rel = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: b, targetIri: a });

    expect(f.canvas.placeExisting(b, { x: 400, y: 100 })).toBe(true);

    expect(f.views.getNode(f.viewIri, b)).toBeDefined();
    expect(f.views.getLinks(f.viewIri).map((l) => l.relationshipIri)).toEqual([rel.iri]);
    expect(f.canvas.getRelationships().has(rel.iri)).toBe(true);
    // Still one element: a placement, not a copy.
    expect(f.store.getQuads(nn(b), nn(NAMESPACES.rdf + 'type'))).toHaveLength(1);

    f.commandStack.undo();
    expect(f.views.getNode(f.viewIri, b)).toBeUndefined();
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    expect(f.store.getQuads(nn(rel.iri)).length).toBeGreaterThan(0);
  });

  it('draws an existing relationship into the view when both ends are placed, undoably', () => {
    const f = mount();
    const a = f.createOnCanvas(COMPONENT, 'A', { x: 100, y: 100 });
    const b = f.createOnCanvas(COMPONENT, 'B', { x: 400, y: 100 });
    const rel = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: a, targetIri: b });
    const lonely = f.elements.createElement(COMPONENT, f.modelIri).value;
    const unplaced = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: a, targetIri: lonely });

    expect(f.canvas.drawExistingRelationship(unplaced.iri)).toBe(false);
    expect(f.canvas.drawExistingRelationship(rel.iri)).toBe(true);
    expect(f.views.getLinks(f.viewIri).map((l) => l.relationshipIri)).toEqual([rel.iri]);

    f.commandStack.undo();
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    // The relationship itself was never touched.
    expect(f.store.getQuads(nn(rel.iri)).length).toBeGreaterThan(0);
  });

  it('reattaching a connection end moves the relationship in the model and in other views; undo restores', () => {
    const f = mount();
    const a = f.createOnCanvas(ACTOR, 'A', { x: 100, y: 100 });
    const b = f.createOnCanvas(ACTOR, 'B', { x: 400, y: 100 });
    const c = f.createOnCanvas(ACTOR, 'C', { x: 400, y: 300 });
    const registry = f.service<{ get(id: string): any }>('elementRegistry');
    const connection = f.service<{ connect(s: unknown, t: unknown): any }>('modeling').connect(registry.get(a), registry.get(b));
    const relIri = connection.businessObject.iri as string;
    const predicate = f.relationships.getRelationship(relIri)!.predicateIri!;
    // Another view shows A and B and the relationship, but not C.
    const other = f.views.createView('Diagram', undefined, { modelIri: f.modelIri }).value;
    f.views.addElementToView(other, a);
    f.views.addElementToView(other, b);
    f.views.addRelationshipToView(other, relIri);

    const target = registry.get(c);
    f.service<{ reconnectEnd(conn: unknown, t: unknown, p: unknown): void }>('modeling').reconnectEnd(
      connection,
      target,
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    );

    expect(f.relationships.getRelationship(relIri)).toMatchObject({ sourceIri: a, targetIri: c });
    expect(f.store.getQuads(nn(a), nn(predicate), nn(c))).toHaveLength(1);
    expect(f.store.getQuads(nn(a), nn(predicate), nn(b))).toHaveLength(0);
    const [link] = f.views.getLinks(f.viewIri);
    expect(link).toMatchObject({ relationshipIri: relIri, targetElementIri: c });
    // C is not in the other view, so the link there had to go.
    expect(f.views.getLinks(other)).toEqual([]);

    f.commandStack.undo();
    expect(f.relationships.getRelationship(relIri)).toMatchObject({ sourceIri: a, targetIri: b });
    expect(f.store.getQuads(nn(a), nn(predicate), nn(b))).toHaveLength(1);
    expect(f.views.getLinks(other).map((l) => l.relationshipIri)).toEqual([relIri]);
  });

  it('connecting writes a qualified relationship and a link, and persists the route', () => {
    const f = mount();
    const a = f.createOnCanvas(ACTOR, 'Customer', { x: 100, y: 100 });
    const b = f.createOnCanvas(ACTOR, 'Clerk', { x: 400, y: 100 });
    const registry = f.service<{ get(id: string): unknown }>('elementRegistry');

    const connection = f.service<{ connect(s: unknown, t: unknown): { businessObject: { iri: string } } }>(
      'modeling',
    ).connect(registry.get(a), registry.get(b));

    const relIri = connection.businessObject.iri;
    expect(relIri).toMatch(new RegExp(`^${f.modelIri}/relationship/`));
    expect(f.store.getQuads(nn(relIri), nn(NAMESPACES.arch + 'source')).map((q) => q.object.value)).toEqual([a]);
    const [link] = f.views.getLinks(f.viewIri);
    expect(link.relationshipIri).toBe(relIri);
    expect(link.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  it('reconciles with changes made elsewhere (a collaborator, the model tree)', () => {
    const f = mount();
    const a = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Remote' }).value;
    f.views.addElementToView(f.viewIri, a, { x: 10, y: 10, width: 120, height: 55 });
    f.canvas.syncFromStore();
    expect(f.canvas.getElement(a)?.label).toBe('Remote');

    f.views.updateNodeBounds(f.viewIri, a, { x: 90, y: 10, width: 120, height: 55 });
    f.elements.updateProperty(a, NAMESPACES.skos + 'prefLabel', DataFactory.literal('Renamed', 'en') as never);
    f.canvas.syncFromStore();
    expect(f.canvas.getElement(a)).toMatchObject({ label: 'Renamed', bounds: { x: 90 } });

    f.views.removeElementFromView(f.viewIri, a);
    f.canvas.syncFromStore();
    expect(f.canvas.getElement(a)).toBeUndefined();
    // Store-led changes never land on the undo stack.
    expect(f.commandStack.canUndo()).toBe(false);
  });

  it('greys out shapes whose type the view viewpoint does not include', () => {
    const f = mount();
    const a = f.createOnCanvas(COMPONENT, 'A', { x: 100, y: 100 });
    const b = f.createOnCanvas(ACTOR, 'B', { x: 400, y: 100 });
    f.canvas.setViewpointFilter((typeIri) => typeIri === COMPONENT);
    const canvas = f.service<{ hasMarker(e: unknown, m: string): boolean }>('canvas');
    const registry = f.service<{ get(id: string): unknown }>('elementRegistry');
    expect(canvas.hasMarker(registry.get(a), OUTSIDE_VIEWPOINT_MARKER)).toBe(false);
    expect(canvas.hasMarker(registry.get(b), OUTSIDE_VIEWPOINT_MARKER)).toBe(true);
  });
});
