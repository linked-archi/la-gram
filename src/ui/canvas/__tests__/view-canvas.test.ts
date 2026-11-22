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
import { labelOf, modelNameOf, modelQuads } from '../../../model-manager/model-queries.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas, OUTSIDE_VIEWPOINT_MARKER } from '../diagram-canvas.js';
import { MOVE_LINK_LABEL_COMMAND } from '../rdf-link-label.js';
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
  const loader = new N3MetamodelLoader(new N3TtlParser(), base);
  // The core first, as the app loads it: its notation draws Refines, which nesting may stand for (VC-DD-5).
  await loader.loadCoreAssets();
  const loaded = await loader.loadBundledMetamodel();
  palette = new SparqlPaletteGenerator(base).generatePalette(loaded.metamodelIri, {
    ...(loaded.notationSetIri ? { defaultNotationSetIris: [loaded.notationSetIri] } : {}),
  });
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

function mount(extra: Partial<ConstructorParameters<typeof DiagramCanvas>[0]> = {}) {
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
      return { typeIri, label: labelOf(store, iri), modelName: modelNameOf(store, iri) };
    },
    confirmDeleteFromModel: confirm,
    ...extra,
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

    // Minted in the model's namespace, `{ns}model` → `{ns}element/…` (DD-41).
    expect(iri).toMatch(new RegExp(`^${f.modelIri.replace(/model$/, '')}element/`));
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
    expect(relIri).toMatch(new RegExp(`^${f.modelIri.replace(/model$/, '')}relationship/`));
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

describe('nesting', () => {
  const NODE = `${AM4}Node`;
  const SOFTWARE = `${AM4}SystemSoftware`;
  type Shape = { id: string; x: number; y: number; width: number; height: number; parent?: { id: string } };

  /** Draw an element from the store, at the given bounds. */
  const place = (f: ReturnType<typeof mount>, typeIri: string, label: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const iri = f.elements.createElement(typeIri, f.modelIri, { label }).value;
    f.views.addElementToView(f.viewIri, iri, bounds);
    return iri;
  };
  const shapeOf = (f: ReturnType<typeof mount>, iri: string) => f.service<{ get(id: string): Shape }>('elementRegistry').get(iri);
  const contains = (outer: Shape, inner: Shape) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

  it('an element created inside another is drawn and stored inside it; the container grows to hold it; undo takes both back', () => {
    const f = mount();
    const server = f.createOnCanvas(NODE, 'Server', { x: 300, y: 200 });
    const before = f.views.getNode(f.viewIri, server)!.bounds;
    const factory = f.service<{ createShape(a: Record<string, unknown>): Shape }>('elementFactory');
    const shape = factory.createShape({ width: 120, height: 55, businessObject: { iri: '', typeIri: SOFTWARE, label: 'Linux', kind: 'element' } });
    f.service<{ createShape(s: unknown, p: unknown, parent: unknown): unknown }>('modeling').createShape(shape, { x: 300, y: 205 }, shapeOf(f, server));
    const linux = shape.id;

    expect(f.views.getNode(f.viewIri, linux)?.parentElementIri).toBe(server);
    expect(shapeOf(f, linux).parent?.id).toBe(server);
    expect(contains(shapeOf(f, server), shapeOf(f, linux))).toBe(true);
    expect(f.views.getNode(f.viewIri, server)!.bounds).toEqual(f.canvas.getElement(server)?.bounds);

    f.commandStack.undo();
    expect(f.views.getNode(f.viewIri, linux)).toBeUndefined();
    expect(f.views.getNode(f.viewIri, server)!.bounds).toEqual(before);
  });

  it('moving an element into another nests it, the container carries it, and moving it out un-nests it', () => {
    const f = mount();
    const server = place(f, NODE, 'Server', { x: 100, y: 100, width: 300, height: 200 });
    const linux = place(f, SOFTWARE, 'Linux', { x: 600, y: 100, width: 120, height: 55 });
    f.canvas.showView(f.viewIri);
    const modeling = f.service<{ moveElements(e: unknown[], d: unknown, target?: unknown): void }>('modeling');

    modeling.moveElements([shapeOf(f, linux)], { x: -450, y: 60 }, shapeOf(f, server));
    expect(f.views.getNode(f.viewIri, linux)?.parentElementIri).toBe(server);

    modeling.moveElements([shapeOf(f, server)], { x: 40, y: 0 });
    expect(f.views.getNode(f.viewIri, linux)!.bounds.x).toBe(190);

    const root = f.service<{ getRootElement(): unknown }>('canvas').getRootElement();
    modeling.moveElements([shapeOf(f, linux)], { x: 500, y: 0 }, root);
    expect(f.views.getNode(f.viewIri, linux)?.parentElementIri).toBeUndefined();

    f.commandStack.undo();
    expect(f.views.getNode(f.viewIri, linux)?.parentElementIri).toBe(server);
  });

  it('a drop into an element offers what the nesting may stand for; the one picked is created, not drawn, undoably', async () => {
    const f = mount();
    const server = place(f, NODE, 'Server', { x: 100, y: 100, width: 300, height: 200 });
    const linux = place(f, SOFTWARE, 'Linux', { x: 600, y: 100, width: 120, height: 55 });
    f.canvas.showView(f.viewIri);
    f.service<{ moveElements(e: unknown[], d: unknown, target?: unknown): void }>('modeling').moveElements(
      [shapeOf(f, linux)],
      { x: -450, y: 60 },
      shapeOf(f, server),
    );
    await Promise.resolve();

    const entries = f.canvas.nestMenuProvider.getPopupMenuEntries(undefined) as Record<string, { label: string; description: string; action(): void }>;
    const labels = Object.values(entries).map((e) => e.label);
    expect(labels).toContain('Composition');
    expect(labels).not.toContain('Serving');
    expect(labels.at(-1)).toBe('None');
    const composition = Object.values(entries).find((e) => e.label === 'Composition')!;
    expect(composition.description).toBe('Server → Linux');

    composition.action();
    const related = f.relationships.getRelationshipsOf!(linux);
    expect(related.map((r) => [r.classIri, r.sourceIri, r.targetIri])).toEqual([[`${AM4}Composition`, server, linux]]);
    expect(f.views.getLinks(f.viewIri)).toHaveLength(0);

    f.commandStack.undo();
    expect(f.relationships.getRelationshipsOf!(linux)).toHaveLength(0);
  });

  it('draws nodes inside their containers from the store, and follows when the store moves one out', () => {
    const f = mount();
    const server = place(f, NODE, 'Server', { x: 100, y: 100, width: 300, height: 200 });
    const linux = place(f, SOFTWARE, 'Linux', { x: 150, y: 160, width: 120, height: 55 });
    f.views.setNodeParent(f.viewIri, linux, server);
    f.canvas.showView(f.viewIri);
    expect(shapeOf(f, linux).parent?.id).toBe(server);

    f.views.setNodeParent(f.viewIri, linux, undefined);
    f.canvas.syncFromStore();
    expect(shapeOf(f, linux).parent?.id).not.toBe(server);

    // Removing a container from the view leaves what was inside it drawn.
    f.views.setNodeParent(f.viewIri, linux, server);
    f.canvas.syncFromStore();
    f.views.removeElementFromView(f.viewIri, server);
    f.canvas.syncFromStore();
    expect(shapeOf(f, linux)).toBeDefined();
    expect(f.views.getNode(f.viewIri, linux)?.parentElementIri).toBeUndefined();
  });

  it('a junction holds nothing', () => {
    const f = mount();
    const junction = place(f, `${AM4}AndJunction`, 'J', { x: 100, y: 100, width: 15, height: 15 });
    const linux = place(f, SOFTWARE, 'Linux', { x: 300, y: 100, width: 120, height: 55 });
    f.canvas.showView(f.viewIri);
    const rules = f.service<{ allowed(action: string, context: unknown): unknown }>('rules');
    expect(rules.allowed('elements.move', { shapes: [shapeOf(f, linux)], target: shapeOf(f, junction) })).toBe(false);
  });
});

describe('a relationship drawn onto a relationship', () => {
  type Point = { x: number; y: number };
  type Drawn = { waypoints: Point[]; target?: unknown; businessObject: { iri: string } };

  /** Distance from `p` to the polyline through `points`. */
  function offLine(p: Point, points: readonly Point[]): number {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    return best;
  }

  /** Web → API (Serving) drawn in the view; Clerk placed below it, not yet connected. */
  function scene() {
    const f = mount();
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const clerk = f.elements.createElement(ACTOR, f.modelIri, { label: 'Clerk' }).value;
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: web, targetIri: api }).iri;
    f.views.addElementToView(f.viewIri, web, { x: 0, y: 0, width: 120, height: 55 });
    f.views.addElementToView(f.viewIri, api, { x: 400, y: 0, width: 120, height: 55 });
    f.views.addElementToView(f.viewIri, clerk, { x: 200, y: 300, width: 120, height: 55 });
    f.views.addRelationshipToView(f.viewIri, serving);
    f.canvas.showView(f.viewIri);
    const registry = f.service<{ get(id: string): Drawn | undefined }>('elementRegistry');
    const association = palette.relationshipTypes.find((r) => r.iri === `${AM4}Association`);
    if (!association) throw new Error('the bundled metamodel has no Association');
    // As the connect tool's drop on a line does: the end snapped onto the line.
    const drawn = f.service<{ connect(s: unknown, t: unknown, attrs: unknown, hints: unknown): Drawn }>('modeling').connect(
      registry.get(clerk),
      registry.get(serving),
      { typeIri: association.iri, unqualifiedPredicateIri: association.unqualifiedPredicateIri },
      { connectionStart: { x: 260, y: 327 }, connectionEnd: { x: 200, y: 27 } },
    );
    return { f, web, api, clerk, serving, registry, carried: drawn.businessObject.iri };
  }

  it('is a relationship in the model whose target is the relationship, and a link in the view ending on its link', () => {
    const { f, serving, carried } = scene();
    expect(f.store.getQuads(nn(carried), nn(NAMESPACES.arch + 'target')).map((q) => q.object.value)).toEqual([serving]);
    const links = f.views.getLinks(f.viewIri);
    const servingLink = links.find((l) => l.relationshipIri === serving);
    expect(links.find((l) => l.relationshipIri === carried)).toMatchObject({
      targetElementIri: serving,
      targetNodeIri: servingLink?.linkIri,
    });
  });

  it('is drawn again, docked on the line, when the view is reopened', () => {
    const { f, serving, carried, registry } = scene();
    const saved = f.views.getLinks(f.viewIri).find((l) => l.relationshipIri === carried)?.waypoints ?? [];
    expect(saved.length).toBeGreaterThanOrEqual(2);

    const other = f.views.createView('Diagram', undefined, { modelIri: f.modelIri }).value;
    f.canvas.showView(other);
    expect(registry.get(carried)).toBeUndefined();
    f.canvas.showView(f.viewIri);
    const line = registry.get(serving);
    const redrawn = registry.get(carried);
    expect(redrawn?.target).toBe(line);
    const end = redrawn!.waypoints[redrawn!.waypoints.length - 1];
    expect(offLine(end, line!.waypoints)).toBeLessThan(1);
    expect(end).toMatchObject(saved[saved.length - 1]);
  });

  it('keeps its saved end on the line when the line moves', () => {
    const { f, api, serving, carried, registry } = scene();
    f.service<{ moveElements(e: unknown[], d: Point): void }>('modeling').moveElements([registry.get(api)], { x: 0, y: 200 });
    const lineRoute = f.views.getLinks(f.viewIri).find((l) => l.relationshipIri === serving)?.waypoints ?? [];
    const route = f.views.getLinks(f.viewIri).find((l) => l.relationshipIri === carried)?.waypoints ?? [];
    expect(offLine(route[route.length - 1], lineRoute)).toBeLessThan(1);
  });

  it('goes from the view with the relationship it ends on', () => {
    const { f, serving, registry } = scene();
    f.service<{ removeElements(e: unknown[]): void }>('modeling').removeElements([registry.get(serving)]);
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    f.commandStack.undo();
    expect(f.views.getLinks(f.viewIri)).toHaveLength(2);
  });

  it('is drawn with the element it starts at when that element is placed in the view', () => {
    const { f, clerk, serving, carried, registry } = scene();
    f.service<{ removeElements(e: unknown[]): void }>('modeling').removeElements([registry.get(clerk)]);
    expect(f.views.getLinks(f.viewIri).map((l) => l.relationshipIri)).toEqual([serving]);
    expect(f.canvas.placeExisting(clerk, { x: 260, y: 327 })).toBe(true);
    expect(f.views.getLinks(f.viewIri).map((l) => l.relationshipIri)).toEqual([serving, carried]);
  });
});

describe('a relationship’s name on its line', () => {
  const PREF_LABEL = NAMESPACES.skos + 'prefLabel';

  it('is drawn when names are shown, follows a rename made elsewhere, and is renamed and removed on the line, undoably', () => {
    const f = mount();
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: api, targetIri: web }).iri;
    const name = (value: string) => DataFactory.quad(nn(serving), nn(PREF_LABEL), DataFactory.literal(value, 'en'));
    f.store.addQuads([name('Serves pages') as never]);
    f.views.addElementToView(f.viewIri, web, { x: 0, y: 0, width: 120, height: 55 });
    f.views.addElementToView(f.viewIri, api, { x: 400, y: 0, width: 120, height: 55 });
    f.views.addRelationshipToView(f.viewIri, serving);
    f.canvas.showView(f.viewIri);
    const drawnName = () =>
      [...(f.container.querySelector(`[data-element-id="${serving}"]`)?.querySelectorAll('.la-connection-label tspan') ?? [])]
        .map((t) => t.textContent)
        .join(' ');

    // Hidden until switched on.
    expect(f.canvas.relationshipNamesShown()).toBe(false);
    expect(drawnName()).toBe('');
    f.canvas.setRelationshipNamesShown(true);
    expect(drawnName()).toBe('Serves pages');
    // The export's crop takes the name in.
    expect(f.canvas.toSvg()).toContain('Serves pages');
    // The export is an XML document: no interaction chrome, the line's end marker defined in it (Req 14.1).
    const exported = new DOMParser().parseFromString(f.canvas.toSvg(), 'image/svg+xml');
    expect(exported.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(exported.documentElement.getAttribute('viewBox')).toMatch(/^-?\d+ -?\d+ \d+ \d+$/);
    expect(exported.querySelectorAll('.djs-hit, .djs-outline')).toHaveLength(0);
    const ends = [...exported.querySelectorAll('[marker-end], [marker-start]')].map(
      (line) => (line.getAttribute('marker-end') ?? line.getAttribute('marker-start'))!.slice(5, -1),
    );
    expect(ends.length).toBeGreaterThan(0);
    for (const id of ends) expect(exported.getElementById(id)?.localName).toBe('marker');

    // Renamed elsewhere — the property panel, the model tree's dialog, a collaborator.
    f.store.removeQuads([name('Serves pages') as never]);
    f.store.addQuads([name('Serves all pages') as never]);
    f.canvas.syncFromStore();
    expect(drawnName()).toBe('Serves all pages');

    // Renamed on the line: the box opens with the name in it.
    const connection = f.service<{ get(id: string): unknown }>('elementRegistry').get(serving);
    const directEditing = f.service<{ activate(e: unknown): boolean; complete(): void; isActive(): boolean }>('directEditing');
    const typeIn = (current: string, text: string) => {
      expect(directEditing.activate(connection)).toBe(true);
      const box = f.container.querySelector('.djs-direct-editing-content') as HTMLElement & { innerText: string };
      expect(box.innerText).toBe(current);
      box.innerText = text;
      directEditing.complete();
    };
    typeIn('Serves all pages', 'Serves the web');
    expect(modelNameOf(f.store, serving)).toBe('Serves the web');
    expect(drawnName()).toBe('Serves the web');
    f.commandStack.undo();
    expect(modelNameOf(f.store, serving)).toBe('Serves all pages');
    expect(drawnName()).toBe('Serves all pages');
    f.commandStack.redo();
    expect(drawnName()).toBe('Serves the web');

    // Emptied: the name is removed; undo brings it back.
    typeIn('Serves the web', '');
    expect(modelNameOf(f.store, serving)).toBeUndefined();
    expect(drawnName()).toBe('');
    f.commandStack.undo();
    expect(modelNameOf(f.store, serving)).toBe('Serves the web');
    expect(drawnName()).toBe('Serves the web');

    // Switched off: gone from the line, kept in the model.
    f.canvas.setRelationshipNamesShown(false);
    expect(drawnName()).toBe('');
    expect(modelNameOf(f.store, serving)).toBe('Serves the web');
  });

  it('is read from the model alone', () => {
    const f = mount();
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: api, targetIri: web }).iri;
    const elsewhere = nn('https://example.org/some-graph');
    f.store.addQuads([DataFactory.quad(nn(serving), nn(PREF_LABEL), DataFactory.literal('From another graph', 'en'), elsewhere as never) as never]);
    expect(modelNameOf(f.store, serving)).toBeUndefined();
    expect(labelOf(f.store, serving)).toBe('From another graph');
    f.store.removeQuads(f.store.getQuads(null, null, null, elsewhere));
  });
});

describe('a relationship’s name moved on its line', () => {
  const PREF_LABEL = NAMESPACES.skos + 'prefLabel';

  function scene() {
    const f = mount();
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: api, targetIri: web }).iri;
    f.store.addQuads([DataFactory.quad(nn(serving), nn(PREF_LABEL), DataFactory.literal('Serves pages', 'en')) as never]);
    f.views.addElementToView(f.viewIri, web, { x: 0, y: 0, width: 120, height: 55 });
    f.views.addElementToView(f.viewIri, api, { x: 400, y: 0, width: 120, height: 55 });
    f.views.addRelationshipToView(f.viewIri, serving);
    f.canvas.showView(f.viewIri);
    f.canvas.setRelationshipNamesShown(true);
    const registry = f.service<{ get(id: string): any }>('elementRegistry');
    const line = () => registry.get(serving);
    const kept = () => f.views.getLinks(f.viewIri)[0].label;
    const centreOf = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const middle = () => {
      const w = line().waypoints as Array<{ x: number; y: number }>;
      return { x: (w[0].x + w[w.length - 1].x) / 2, y: (w[0].y + w[w.length - 1].y) / 2 };
    };
    const drawnX = () =>
      Number(f.container.querySelector(`[data-element-id="${serving}"] .la-connection-label text`)?.getAttribute('x'));
    /** Within a pixel: the view keeps whole pixels. */
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    const move = (offset: { x: number; y: number } | undefined) =>
      f.service<{ execute(c: string, ctx: unknown): void }>('commandStack').execute(MOVE_LINK_LABEL_COMMAND, { connection: line(), offset });
    return { f, web, api, serving, registry, line, kept, centreOf, middle, drawnX, move, near };
  }

  it('is kept in the view where it was put, as one undoable step', () => {
    const { f, kept, centreOf, middle, drawnX, move, line, near } = scene();
    expect(kept()).toBeUndefined();
    const before = drawnX();

    move({ x: 30, y: -40 });
    expect(line().businessObject.labelOffset).toEqual({ x: 30, y: -40 });
    expect(drawnX()).toBeCloseTo(before + 30);
    const centre = centreOf(kept()!);
    near(centre.x - middle().x, 30);
    near(centre.y - middle().y, -40);

    f.commandStack.undo();
    expect(kept()).toBeUndefined();
    expect(line().businessObject.labelOffset).toBeUndefined();
    expect(drawnX()).toBeCloseTo(before);
    f.commandStack.redo();
    expect(kept()).toBeDefined();
    expect(drawnX()).toBeCloseTo(before + 30);

    // Back to the middle: the label node goes; undo puts it back.
    move(undefined);
    expect(kept()).toBeUndefined();
    expect(drawnX()).toBeCloseTo(before);
    f.commandStack.undo();
    expect(kept()).toBeDefined();
  });

  it('follows its line when an end moves, in the same step, and is drawn there when the view is reopened', () => {
    const { f, api, registry, kept, centreOf, middle, move, line, near } = scene();
    move({ x: 0, y: -40 });
    f.service<{ moveElements(e: unknown[], d: unknown): void }>('modeling').moveElements([registry.get(api)], { x: 0, y: 200 });
    // Kept at the same offset from the middle of the re-laid route.
    const centre = centreOf(kept()!);
    near(centre.x - middle().x, 0);
    near(centre.y - middle().y, -40);
    // One undo takes the move and the name's new place back together.
    const movedTo = kept();
    f.commandStack.undo();
    expect(kept()).not.toEqual(movedTo);
    f.commandStack.redo();
    expect(kept()).toEqual(movedTo);

    // Reopened: the same offset, read from the view.
    f.canvas.showView(f.viewIri);
    const offset = line().businessObject.labelOffset;
    near(offset.x, 0);
    near(offset.y, -40);
  });

  it('follows a move made elsewhere — a collaborator, or an edit undone', () => {
    const { f, serving, drawnX, line, middle } = scene();
    const m = middle();
    f.views.setLinkLabel(f.viewIri, serving, { x: m.x + 50 - 45, y: m.y + 60 - 6, width: 90, height: 12 });
    f.canvas.syncFromStore();
    expect(line().businessObject.labelOffset).toEqual({ x: 50, y: 60 });
    expect(drawnX()).toBeCloseTo(m.x + 50);
    f.views.setLinkLabel(f.viewIri, serving, undefined);
    f.canvas.syncFromStore();
    expect(line().businessObject.labelOffset).toBeUndefined();
  });
});

describe('what is drawn above what', () => {
  const NODE = `${AM4}Node`;
  type El = { id: string; waypoints?: unknown; parent?: El; children?: El[]; x: number; y: number; width: number; height: number };

  /** An element placed in the open view from the store — as a collaborator's edit arrives — and drawn, as the app syncs. */
  const place = (f: ReturnType<typeof mount>, typeIri: string, label: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const iri = f.elements.createElement(typeIri, f.modelIri, { label }).value;
    f.views.addElementToView(f.viewIri, iri, bounds);
    f.canvas.syncFromStore();
    return iri;
  };
  const registryOf = (f: ReturnType<typeof mount>) =>
    f.service<{ get(id: string): El; getAll(): El[]; getGraphics(e: El): SVGElement }>('elementRegistry');
  const rootOf = (f: ReturnType<typeof mount>) => f.service<{ getRootElement(): El }>('canvas').getRootElement();
  const modelingOf = (f: ReturnType<typeof mount>) =>
    f.service<{ moveElements(e: unknown[], d: unknown, target?: unknown): void; connect(s: unknown, t: unknown): El }>('modeling');

  /** What is out of place: a line not the root's, or drawn before — under — a shape, nested ones included. */
  const misplaced = (f: ReturnType<typeof mount>): string[] => {
    const registry = registryOf(f);
    const root = rootOf(f);
    const all = registry.getAll().filter((e) => e !== root);
    const lines = all.filter((e) => e.waypoints);
    const shapes = all.filter((e) => !e.waypoints);
    const out: string[] = [];
    for (const line of lines) {
      if (line.parent !== root) out.push(`${line.id} is not the root's`);
      const drawn = registry.getGraphics(line);
      for (const shape of shapes) {
        if (!(registry.getGraphics(shape).compareDocumentPosition(drawn) & 4 /* FOLLOWING */)) out.push(`${line.id} under ${shape.id}`);
      }
    }
    return out;
  };

  /** Two elements and a relationship between them, drawn. */
  const linked = () => {
    const f = mount();
    const web = place(f, COMPONENT, 'Web', { x: 100, y: 100, width: 120, height: 55 });
    const api = place(f, COMPONENT, 'API', { x: 600, y: 100, width: 120, height: 55 });
    const rel = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: api, targetIri: web });
    f.views.addRelationshipToView(f.viewIri, rel.iri);
    f.canvas.showView(f.viewIri);
    return { f, web, api };
  };

  it('a shape moved over a line stays under it', () => {
    const { f } = linked();
    const box = place(f, NODE, 'Box', { x: 300, y: 300, width: 200, height: 150 });
    expect(misplaced(f)).toEqual([]);
    modelingOf(f).moveElements([registryOf(f).get(box)], { x: 0, y: -260 });
    expect(misplaced(f)).toEqual([]);
  });

  it('a shape created after a line, or added by a collaborator, is drawn under it', () => {
    const { f } = linked();
    f.createOnCanvas(NODE, 'New', { x: 400, y: 120 });
    expect(misplaced(f)).toEqual([]);
    place(f, NODE, 'Theirs', { x: 380, y: 60, width: 160, height: 120 });
    expect(misplaced(f)).toEqual([]);
  });

  it('nesting an element, or taking it out, keeps the lines above; a line from a nested element is the root’s', () => {
    // As the nesting tests above: a Node holds System Software.
    const f = mount();
    const server = place(f, NODE, 'Server', { x: 100, y: 100, width: 300, height: 200 });
    const linux = place(f, `${AM4}SystemSoftware`, 'Linux', { x: 600, y: 100, width: 120, height: 55 });
    const app = place(f, COMPONENT, 'App', { x: 600, y: 400, width: 120, height: 55 });
    const rel = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: linux, targetIri: app });
    f.views.addRelationshipToView(f.viewIri, rel.iri);
    f.canvas.showView(f.viewIri);
    const modeling = modelingOf(f);

    modeling.moveElements([registryOf(f).get(linux)], { x: -450, y: 60 }, registryOf(f).get(server));
    expect(registryOf(f).get(linux).parent?.id).toBe(server);
    expect(misplaced(f)).toEqual([]);

    const other = place(f, COMPONENT, 'Other', { x: 700, y: 250, width: 120, height: 55 });
    modeling.connect(registryOf(f).get(linux), registryOf(f).get(other));
    expect(misplaced(f)).toEqual([]);

    // The container moved: its lines laid out again with it, after it in the drawing.
    modeling.moveElements([registryOf(f).get(server)], { x: 30, y: 0 });
    expect(misplaced(f)).toEqual([]);
    modeling.moveElements([registryOf(f).get(linux)], { x: 500, y: 0 }, rootOf(f));
    expect(registryOf(f).get(linux).parent?.id).toBe(rootOf(f).id);
    expect(misplaced(f)).toEqual([]);
    f.commandStack.undo();
    expect(misplaced(f)).toEqual([]);
  });
});

describe("a container's name", () => {
  type El = { id: string; x: number; y: number; width: number; height: number; parent?: { id: string } };
  const place = (f: ReturnType<typeof mount>, typeIri: string, label: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const iri = f.elements.createElement(typeIri, f.modelIri, { label }).value;
    f.views.addElementToView(f.viewIri, iri, bounds);
    f.canvas.syncFromStore();
    return iri;
  };
  const registryOf = (f: ReturnType<typeof mount>) =>
    f.service<{ get(id: string): El; getGraphics(e: El): SVGElement }>('elementRegistry');
  /** Where the container's name is drawn, from its top: the first line's baseline. */
  const nameAt = (f: ReturnType<typeof mount>, iri: string) => {
    const text = registryOf(f).getGraphics(registryOf(f).get(iri)).querySelector('text');
    return Number(text?.getAttribute('y') ?? text?.querySelector('tspan')?.getAttribute('y'));
  };
  /** A Node, Server, holding System Software, Linux — nested by a move, as on the canvas. */
  const nested = () => {
    const f = mount();
    const server = place(f, `${AM4}Node`, 'Server', { x: 100, y: 100, width: 300, height: 200 });
    const linux = place(f, `${AM4}SystemSoftware`, 'Linux', { x: 600, y: 100, width: 120, height: 55 });
    const middle = nameAt(f, server);
    f.service<{ moveElements(e: unknown[], d: unknown, target?: unknown): void }>('modeling').moveElements(
      [registryOf(f).get(linux)],
      { x: -450, y: 100 },
      registryOf(f).get(server),
    );
    expect(registryOf(f).get(linux).parent?.id).toBe(server);
    return { f, server, linux, middle };
  };

  it('is at the top once something is inside — and still there when the view is opened again', () => {
    const { f, server, middle } = nested();
    const top = nameAt(f, server);
    expect(top).toBeLessThan(40);
    expect(middle).toBeGreaterThan(80);

    const other = f.views.createView('Diagram', undefined, { modelIri: f.modelIri }).value;
    f.canvas.showView(other);
    f.canvas.showView(f.viewIri);
    expect(nameAt(f, server)).toBe(top);
  });

  it('goes back to the middle when a collaborator takes out what was inside', () => {
    const { f, server, linux, middle } = nested();
    f.views.removeElementFromView(f.viewIri, linux);
    f.canvas.syncFromStore();
    expect(nameAt(f, server)).toBe(middle);
  });

  it('is never covered: what is dropped into its band makes the container grow above it', () => {
    const f = mount();
    const server = place(f, `${AM4}Node`, 'Server', { x: 100, y: 100, width: 300, height: 200 });
    const linux = place(f, `${AM4}SystemSoftware`, 'Linux', { x: 600, y: 100, width: 120, height: 55 });
    // Dropped 32 px below the container's top: inside the 34 px band the name takes
    // (the trigger was 30 px, and the second line went under what was dropped).
    f.service<{ moveElements(e: unknown[], d: unknown, target?: unknown): void }>('modeling').moveElements(
      [registryOf(f).get(linux)],
      { x: -450, y: 32 },
      registryOf(f).get(server),
    );
    const outer = registryOf(f).get(server);
    const inner = registryOf(f).get(linux);
    expect(inner.parent?.id).toBe(server);
    // Two lines of the name, and the padding round them, fit above it.
    expect(inner.y - outer.y).toBeGreaterThanOrEqual(2 * Math.round(11 * 1.2) + 2 * 4);
  });
});

describe('what a nesting shows', () => {
  const NODE = `${AM4}Node`;
  const SOFTWARE = `${AM4}SystemSoftware`;
  type El = { id: string; parent?: { id: string } };
  type Entries = Record<string, { label: string; action(): void }>;
  const place = (f: ReturnType<typeof mount>, typeIri: string, label: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const iri = f.elements.createElement(typeIri, f.modelIri, { label }).value;
    f.views.addElementToView(f.viewIri, iri, bounds);
    f.canvas.syncFromStore();
    return iri;
  };
  const registryOf = (f: ReturnType<typeof mount>) => f.service<{ get(id: string): El | undefined }>('elementRegistry');
  const rootOf = (f: ReturnType<typeof mount>) => f.service<{ getRootElement(): El }>('canvas').getRootElement();
  const move = (f: ReturnType<typeof mount>, iri: string, delta: { x: number; y: number }, into?: string) =>
    f.service<{ moveElements(e: unknown[], d: unknown, target?: unknown): void }>('modeling').moveElements(
      [registryOf(f).get(iri)],
      delta,
      into ? registryOf(f).get(into) : rootOf(f),
    );
  /** What the view says of a relationship: whether it is the view's, and whether it has a line there. */
  const inView = (f: ReturnType<typeof mount>, rel: string) => ({
    theViews: f.views.viewsContaining(rel).includes(f.viewIri),
    line: f.views.getLinks(f.viewIri).some((l) => l.relationshipIri === rel),
    drawn: Boolean(registryOf(f).get(rel)),
  });
  const serverAndLinux = () => {
    const f = mount();
    const server = place(f, NODE, 'Server', { x: 100, y: 100, width: 300, height: 200 });
    const linux = place(f, SOFTWARE, 'Linux', { x: 600, y: 100, width: 120, height: 55 });
    return { f, server, linux };
  };

  it('the relationship picked for a nesting is the view’s, shown by it; taken out, it is drawn; back in, hidden — each undoable', async () => {
    const { f, server, linux } = serverAndLinux();
    move(f, linux, { x: -450, y: 60 }, server);
    await Promise.resolve();
    const entries = f.canvas.nestMenuProvider.getPopupMenuEntries(undefined) as Entries;
    Object.values(entries).find((e) => e.label === 'Composition')!.action();
    const [composition] = f.relationships.getRelationshipsOf!(linux);
    expect(inView(f, composition!.iri)).toEqual({ theViews: true, line: false, drawn: false });

    move(f, linux, { x: 500, y: 0 });
    expect(registryOf(f).get(linux)?.parent?.id).toBe(rootOf(f).id);
    expect(inView(f, composition!.iri)).toEqual({ theViews: true, line: true, drawn: true });

    f.commandStack.undo();
    expect(inView(f, composition!.iri)).toEqual({ theViews: true, line: false, drawn: false });
    f.commandStack.redo();
    expect(inView(f, composition!.iri)).toEqual({ theViews: true, line: true, drawn: true });

    move(f, linux, { x: -500, y: 0 }, server);
    expect(inView(f, composition!.iri)).toEqual({ theViews: true, line: false, drawn: false });
    f.commandStack.undo();
    expect(inView(f, composition!.iri)).toEqual({ theViews: true, line: true, drawn: true });
  });

  it('nesting hides every line between the element and its container, either way, and keeps them the view’s; taken out, they are drawn again', async () => {
    const { f, server, linux } = serverAndLinux();
    const composition = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Composition`, sourceIri: server, targetIri: linux });
    // From the child to the container: not one nesting may stand for, hidden all the same.
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: linux, targetIri: server });
    f.views.addRelationshipToView(f.viewIri, composition.iri);
    f.views.addRelationshipToView(f.viewIri, serving.iri);
    f.canvas.syncFromStore();
    expect(inView(f, composition.iri).drawn).toBe(true);
    expect(inView(f, serving.iri).drawn).toBe(true);

    move(f, linux, { x: -450, y: 60 }, server);
    await Promise.resolve();
    expect(inView(f, composition.iri)).toEqual({ theViews: true, line: false, drawn: false });
    expect(inView(f, serving.iri)).toEqual({ theViews: true, line: false, drawn: false });

    f.commandStack.undo();
    expect(inView(f, composition.iri)).toEqual({ theViews: true, line: true, drawn: true });
    expect(inView(f, serving.iri)).toEqual({ theViews: true, line: true, drawn: true });

    f.commandStack.redo();
    move(f, linux, { x: 500, y: 0 });
    expect(inView(f, composition.iri)).toEqual({ theViews: true, line: true, drawn: true });
    expect(inView(f, serving.iri)).toEqual({ theViews: true, line: true, drawn: true });
  });

  it('a relationship the model has between the two that the view does not show stays out of it, nested or not', async () => {
    const { f, server, linux } = serverAndLinux();
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: linux, targetIri: server });
    move(f, linux, { x: -450, y: 60 }, server);
    await Promise.resolve();
    expect(inView(f, serving.iri)).toEqual({ theViews: false, line: false, drawn: false });
    move(f, linux, { x: 500, y: 0 });
    expect(inView(f, serving.iri)).toEqual({ theViews: false, line: false, drawn: false });
  });

  it('nested as the model was opened, taken out: what the nesting stood for is drawn, not what it could not', () => {
    const { f, server, linux } = serverAndLinux();
    // Nested in the store, as a converted model is opened: nothing says what the nesting stands for.
    const composition = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Composition`, sourceIri: server, targetIri: linux });
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: linux, targetIri: server });
    f.views.updateNodeBounds(f.viewIri, linux, { x: 150, y: 160, width: 120, height: 55 });
    f.views.setNodeParent!(f.viewIri, linux, server);
    f.canvas.syncFromStore();
    expect(registryOf(f).get(linux)?.parent?.id).toBe(server);
    expect(inView(f, composition.iri).theViews).toBe(false);

    move(f, linux, { x: 500, y: 0 });
    // The composition is what the nesting showed; the serving, the view never did.
    expect(inView(f, composition.iri)).toEqual({ theViews: true, line: true, drawn: true });
    expect(inView(f, serving.iri)).toEqual({ theViews: false, line: false, drawn: false });
    f.commandStack.undo();
    expect(inView(f, composition.iri)).toEqual({ theViews: false, line: false, drawn: false });
  });
});

describe('drawing a relationship the model already has', () => {
  type El = { id: string };
  type Entries = Record<string, { label: string; description: string; action(): void }>;
  const SERVING = `${AM4}Serving`;
  const place = (f: ReturnType<typeof mount>, label: string, x: number) => {
    const iri = f.elements.createElement(COMPONENT, f.modelIri, { label }).value;
    f.views.addElementToView(f.viewIri, iri, { x, y: 100, width: 120, height: 55 });
    f.canvas.syncFromStore();
    return iri;
  };
  const registryOf = (f: ReturnType<typeof mount>) => f.service<{ get(id: string): El | undefined }>('elementRegistry');
  /** A line drawn from one to the other, typed Serving, as a connect drag ends. */
  const draw = (f: ReturnType<typeof mount>, from: string, to: string) => {
    const serving = palette.relationshipTypes.find((t) => t.iri === SERVING)!;
    return f
      .service<{ connect(s: unknown, t: unknown, attrs: unknown): El | undefined }>('modeling')
      .connect(registryOf(f).get(from), registryOf(f).get(to), { typeIri: serving.iri, unqualifiedPredicateIri: serving.unqualifiedPredicateIri });
  };
  const servingOf = (f: ReturnType<typeof mount>, from: string) =>
    f.relationships.getRelationshipsOf!(from).filter((r) => r.classIri === SERVING && r.sourceIri === from);
  /** API serves Web in the model — drawn in no view. */
  const known = () => {
    const f = mount();
    const api = place(f, 'API', 100);
    const web = place(f, 'Web', 500);
    const existing = f.relationships.createQualifiedRelationship({ typeIri: SERVING, sourceIri: api, targetIri: web }).iri;
    return { f, api, web, existing };
  };

  it('asks first: nothing is drawn or made until answered; the existing one is then drawn here, undoably', async () => {
    const { f, api, web, existing } = known();
    expect(draw(f, api, web)).toBeUndefined();
    expect(servingOf(f, api)).toHaveLength(1);
    expect(registryOf(f).get(existing)).toBeUndefined();

    await Promise.resolve();
    const entries = Object.values(f.canvas.reuseMenuProvider.getPopupMenuEntries(undefined) as Entries);
    expect(entries.map((e) => [e.label, e.description])).toEqual([
      ['Use the existing Serving', 'API → Web'],
      ['New Serving', 'API → Web'],
    ]);
    entries[0]!.action();
    expect(servingOf(f, api)).toHaveLength(1);
    expect(registryOf(f).get(existing)).toBeDefined();
    expect(f.views.getLinks(f.viewIri).map((l) => l.relationshipIri)).toEqual([existing]);

    f.commandStack.undo();
    expect(registryOf(f).get(existing)).toBeUndefined();
    expect(servingOf(f, api)).toHaveLength(1);
  });

  it('or makes a new one, as the line asked', async () => {
    const { f, api, web, existing } = known();
    draw(f, api, web);
    await Promise.resolve();
    Object.values(f.canvas.reuseMenuProvider.getPopupMenuEntries(undefined) as Entries).find((e) => e.label === 'New Serving')!.action();
    const all = servingOf(f, api).map((r) => r.iri);
    expect(all).toHaveLength(2);
    const made = all.find((iri) => iri !== existing)!;
    expect(f.views.getLinks(f.viewIri).map((l) => l.relationshipIri)).toEqual([made]);
  });

  it('does not ask when it is drawn here already, or runs the other way', () => {
    const { f, api, web, existing } = known();
    // The other way round: Web serves API is another relationship.
    expect(draw(f, web, api)).toBeDefined();
    f.views.addRelationshipToView(f.viewIri, existing);
    f.canvas.syncFromStore();
    expect(draw(f, api, web)).toBeDefined();
    expect(f.canvas.reuseMenuProvider.pending).toBeUndefined();
  });
});

describe('figures: groups, shapes and notes', () => {
  const VIS_NS = NAMESPACES['arch-vis'];
  type El = { id: string; x: number; y: number; width: number; height: number; parent?: El; businessObject?: { iri: string; kind?: string; label?: string } };
  const registryOf = (f: ReturnType<typeof mount>) =>
    f.service<{ get(id: string): El | undefined; getGraphics(e: El): SVGElement }>('elementRegistry');
  const rootOf = (f: ReturnType<typeof mount>) => f.service<{ getRootElement(): El }>('canvas').getRootElement();
  const drawFigure = (f: ReturnType<typeof mount>, figure: { kind: 'group' | 'shape' | 'note'; shapeType?: string }, at: { x: number; y: number }, into?: El) => {
    const shape = f.service<{ createShape(a: Record<string, unknown>): El }>('elementFactory').createShape({
      width: 200,
      height: 120,
      businessObject: { iri: '', typeIri: '', kind: 'figure', figure },
    });
    f.service<{ createShape(s: unknown, p: unknown, parent: unknown): El }>('modeling').createShape(shape, at, into ?? rootOf(f));
    return shape;
  };

  it('are drawn from the store as figures — a group with its tab, a shape of its core-vis type, a note — not as elements', () => {
    const f = mount();
    const group = f.views.addFigure(f.viewIri, { kind: 'group', text: 'Back office', bounds: { x: 0, y: 0, width: 400, height: 300 } });
    const ellipse = f.views.addFigure(f.viewIri, { kind: 'shape', shapeType: VIS_NS + 'Ellipse', text: 'Idea', bounds: { x: 500, y: 0, width: 120, height: 80 } });
    const note = f.views.addFigure(f.viewIri, { kind: 'note', text: 'Ask the CFO', bounds: { x: 700, y: 0, width: 185, height: 80 } });
    f.canvas.syncFromStore();
    const gfx = (iri: string) => registryOf(f).getGraphics(registryOf(f).get(iri)!);
    expect(gfx(group).querySelector('[data-figure="group"]')?.textContent).toBe('Back office');
    expect(gfx(ellipse).querySelector('[data-figure="shape"] ellipse')).not.toBeNull();
    expect(gfx(note).querySelector('[data-figure="note"]')?.textContent).toBe('Ask the CFO');
    // No element behind them: the model tree has nothing of them.
    expect(f.elements.getElement?.(group)).toBeFalsy();
  });

  it('drawn on the canvas, one is written in the view in the same command: undo takes it back, redo the same one', () => {
    const f = mount();
    const shape = drawFigure(f, { kind: 'shape', shapeType: VIS_NS + 'Diamond' }, { x: 300, y: 200 });
    const iri = shape.id;
    expect(iri).toMatch(/#node-/);
    expect(f.views.getNodes(f.viewIri).map((n) => [n.elementIri, n.figure?.shapeType])).toEqual([[iri, VIS_NS + 'Diamond']]);
    expect(f.views.getNode(f.viewIri, iri)?.bounds).toEqual({ x: 200, y: 140, width: 200, height: 120 });
    f.commandStack.undo();
    expect(f.views.getNodes(f.viewIri)).toEqual([]);
    f.commandStack.redo();
    expect(f.views.getNodes(f.viewIri).map((n) => n.elementIri)).toEqual([iri]);
  });

  it('a group holds elements: dropped in, carried with it, written as inside it; deleted, it goes and undo brings it back', () => {
    const f = mount();
    const group = drawFigure(f, { kind: 'group' }, { x: 300, y: 250 });
    const app = f.elements.createElement(COMPONENT, f.modelIri, { label: 'App' }).value;
    f.views.addElementToView(f.viewIri, app, { x: 700, y: 100, width: 120, height: 55 });
    f.canvas.syncFromStore();
    const modeling = f.service<{ moveElements(e: unknown[], d: unknown, target?: unknown): void; removeElements(e: unknown[]): void }>('modeling');
    modeling.moveElements([registryOf(f).get(app)], { x: -440, y: 160 }, registryOf(f).get(group.id));
    expect(f.views.getNode(f.viewIri, app)?.parentElementIri).toBe(group.id);
    modeling.moveElements([registryOf(f).get(group.id)], { x: 50, y: 0 });
    expect(f.views.getNode(f.viewIri, app)?.bounds.x).toBe(310);

    modeling.removeElements([registryOf(f).get(group.id)]);
    expect(f.views.getNode(f.viewIri, group.id)).toBeUndefined();
    f.commandStack.undo();
    expect(f.views.getNode(f.viewIri, group.id)?.figure?.kind).toBe('group');
    expect(f.views.getNode(f.viewIri, app)?.parentElementIri).toBe(group.id);
  });

  it('is drawn in its own colours, else its kind’s, and redrawn when they change', () => {
    const f = mount();
    const note = f.views.addFigure(f.viewIri, { kind: 'note', text: 'n', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    f.canvas.syncFromStore();
    const body = () => registryOf(f).getGraphics(registryOf(f).get(note)!).querySelector('.la-shape-body');
    expect(body()?.getAttribute('fill')).toBe('#fff7b3');
    f.views.setFigureColours(f.viewIri, note, { fillColor: '#ffd6e0', lineColor: '#7a0019' });
    f.canvas.syncFromStore();
    expect([body()?.getAttribute('fill'), body()?.getAttribute('stroke')]).toEqual(['#ffd6e0', '#7a0019']);
    f.views.setFigureColours(f.viewIri, note, { fillColor: null });
    f.canvas.syncFromStore();
    expect(body()?.getAttribute('fill')).toBe('#fff7b3');
  });

  it('its text, changed by a collaborator, is drawn', () => {
    const f = mount();
    const note = f.views.addFigure(f.viewIri, { kind: 'note', text: 'Draft', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    f.canvas.syncFromStore();
    f.views.setFigureText(f.viewIri, note, 'Final');
    f.canvas.syncFromStore();
    expect(registryOf(f).getGraphics(registryOf(f).get(note)!).textContent).toBe('Final');
  });

  it('is no end of a relationship — a line to one stands for none — and a note holds nothing', () => {
    const f = mount();
    const shape = drawFigure(f, { kind: 'shape', shapeType: VIS_NS + 'Rectangle' }, { x: 300, y: 200 });
    const note = drawFigure(f, { kind: 'note' }, { x: 700, y: 200 });
    const app = f.elements.createElement(COMPONENT, f.modelIri, { label: 'App' }).value;
    f.views.addElementToView(f.viewIri, app, { x: 300, y: 500, width: 120, height: 55 });
    f.canvas.syncFromStore();
    const rules = f.service<{ allowed(action: string, context: unknown): unknown }>('rules');
    const el = registryOf(f).get(app)!;
    expect(rules.allowed('connection.create', { source: el, target: registryOf(f).get(shape.id) })).toMatchObject({ connector: true, typeIri: '' });
    expect(rules.allowed('connection.create', { source: registryOf(f).get(shape.id), target: el })).toMatchObject({ connector: true });
    expect(rules.allowed('elements.move', { target: registryOf(f).get(note.id), shapes: [el] })).toBe(false);
    expect(rules.allowed('elements.move', { target: registryOf(f).get(shape.id), shapes: [el] })).toBe(true);
  });
});

describe('lines from a note: drawing, no relationship', () => {
  const SERVING = `${AM4}Serving`;
  type El = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    waypoints?: Array<{ x: number; y: number }>;
    source?: El;
    target?: El;
    businessObject?: { iri: string; kind?: string; linkIri?: string };
  };
  const registryOf = (f: ReturnType<typeof mount>) =>
    f.service<{ get(id: string): El | undefined; getAll(): El[]; getGraphics(e: El): SVGElement }>('elementRegistry');
  const modelingOf = (f: ReturnType<typeof mount>) =>
    f.service<{
      connect(s: unknown, t: unknown, attrs?: unknown): El | undefined;
      removeElements(e: unknown[]): void;
      reconnectEnd(c: unknown, t: unknown, dockingOrPoints: unknown): void;
      moveElements(e: unknown[], d: unknown): void;
    }>('modeling');
  const rulesOf = (f: ReturnType<typeof mount>) => f.service<{ allowed(action: string, context: unknown): unknown }>('rules');
  /** A note, and two components: API serving Web. */
  const scene = () => {
    const f = mount();
    const note = f.views.addFigure(f.viewIri, { kind: 'note', text: 'Owned by team A', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    f.views.addElementToView(f.viewIri, api, { x: 400, y: 0, width: 120, height: 55 });
    f.views.addElementToView(f.viewIri, web, { x: 400, y: 300, width: 120, height: 55 });
    f.canvas.syncFromStore();
    return { f, note, api, web };
  };
  /** Draw a line as the connect gesture does: the rules' answer handed to `modeling.connect`. */
  const draw = (f: ReturnType<typeof mount>, source: El, target: El) =>
    modelingOf(f).connect(source, target, rulesOf(f).allowed('connection.create', { source, target }));

  it('drawn from a note to an element, is a link of the view with no relationship: undo takes it back, redo the same one', () => {
    const { f, note, api } = scene();
    const before = f.relationships.getRelationshipsOf?.(api)?.length ?? 0;
    const line = draw(f, registryOf(f).get(note)!, registryOf(f).get(api)!)!;
    expect(line.businessObject?.kind).toBe('connector');
    expect(line.id).toMatch(/#link-/);
    const [link] = f.views.getLinks(f.viewIri);
    expect(link).toMatchObject({ linkIri: line.id, relationshipIri: line.id, connector: true, sourceNodeIri: note, targetElementIri: api });
    // Its route is written as a relationship's is.
    expect(link.waypoints.length).toBeGreaterThan(0);
    // Nothing in the model, nothing the view shows.
    expect(f.relationships.getRelationshipsOf?.(api)?.length ?? 0).toBe(before);
    expect([...f.views.placedIn(f.viewIri)]).not.toContain(line.id);
    expect(registryOf(f).getGraphics(line).querySelector('.la-connector')?.getAttribute('stroke-dasharray')).toBe('4 3');
    f.commandStack.undo();
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    expect(registryOf(f).get(line.id)).toBeUndefined();
    f.commandStack.redo();
    expect(f.views.getLinks(f.viewIri).map((l) => l.linkIri)).toEqual([line.id]);
  });

  it('is drawn from the store, kept up as it is re-routed or re-pointed, and goes with its note', () => {
    const { f, note, api, web } = scene();
    const link = f.views.addConnector(f.viewIri, { sourceNodeIri: note, targetNodeIri: api })!;
    f.canvas.syncFromStore();
    const line = () => registryOf(f).get(link);
    expect([line()?.source?.id, line()?.target?.id, line()?.businessObject?.kind]).toEqual([note, api, 'connector']);
    f.views.updateLinkWaypoints(f.viewIri, link, [{ x: 100, y: 80 }, { x: 100, y: 200 }, { x: 400, y: 200 }]);
    f.canvas.syncFromStore();
    expect(line()?.waypoints).toContainEqual({ x: 100, y: 200 });
    f.views.reconnectConnector(f.viewIri, link, { sourceNodeIri: note, targetNodeIri: web });
    f.canvas.syncFromStore();
    expect(line()?.target?.id).toBe(web);
    modelingOf(f).removeElements([registryOf(f).get(note)]);
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    expect(line()).toBeUndefined();
  });

  it('deleted, only it goes; moved to another element, it is re-pointed there; not onto a relationship’s end', () => {
    const { f, note, api, web } = scene();
    const serving = f.relationships.createQualifiedRelationship({ typeIri: SERVING, sourceIri: api, targetIri: web }).iri;
    f.views.addRelationshipToView(f.viewIri, serving);
    f.canvas.syncFromStore();
    const line = draw(f, registryOf(f).get(note)!, registryOf(f).get(api)!)!;
    const rules = rulesOf(f);
    // Its end may go to any element or figure; a relationship's end not onto the note.
    expect(rules.allowed('connection.reconnect', { connection: line, source: registryOf(f).get(note), target: registryOf(f).get(web) })).toMatchObject({ connector: true });
    expect(rules.allowed('connection.reconnect', { connection: line, source: registryOf(f).get(api), target: registryOf(f).get(web) })).toBe(false);
    const servingLine = registryOf(f).get(serving)!;
    expect(rules.allowed('connection.reconnect', { connection: servingLine, source: registryOf(f).get(note), target: registryOf(f).get(web) })).toBe(false);
    modelingOf(f).reconnectEnd(line, registryOf(f).get(web), { x: 460, y: 327 });
    expect(f.views.getLinks(f.viewIri).find((l) => l.connector)?.targetElementIri).toBe(web);
    f.commandStack.undo();
    expect(f.views.getLinks(f.viewIri).find((l) => l.connector)?.targetElementIri).toBe(api);
    modelingOf(f).removeElements([registryOf(f).get(line.id)]);
    expect(f.views.getLinks(f.viewIri).map((l) => l.relationshipIri)).toEqual([serving]);
    expect(f.views.placedIn(f.viewIri).has(serving)).toBe(true);
  });

  it('a line taken off by the store leaves its ends: an end deleted here after deletes no ghost of it', () => {
    const { f, api, web } = scene();
    const serving = f.relationships.createQualifiedRelationship({ typeIri: SERVING, sourceIri: api, targetIri: web }).iri;
    f.views.addRelationshipToView(f.viewIri, serving);
    f.canvas.syncFromStore();
    // A collaborator takes the line off the view.
    f.views.removeRelationshipFromView(f.viewIri, serving);
    f.canvas.syncFromStore();
    expect(() => modelingOf(f).removeElements([registryOf(f).get(api)])).not.toThrow();
    expect(f.views.getNode(f.viewIri, api)).toBeUndefined();
  });

  it('between two elements, a line is a relationship still; with a relationship type picked, none to a note', () => {
    const { f, note, api, web } = scene();
    const rules = rulesOf(f);
    expect(rules.allowed('connection.create', { source: registryOf(f).get(api), target: registryOf(f).get(web) })).toMatchObject({ typeIri: expect.stringContaining(AM4) });
    expect(rules.allowed('connection.start', { source: registryOf(f).get(note) })).toBe(true);
    expect(rules.allowed('connection.create', { source: registryOf(f).get(note), target: registryOf(f).get(note) })).toBe(false);
    f.canvas.setPreferredRelationshipType?.(SERVING);
    expect(rules.allowed('connection.create', { source: registryOf(f).get(note), target: registryOf(f).get(api) })).toBe(false);
  });

  it('is copied with its view, between the copies of its ends', () => {
    const { f, note, api } = scene();
    f.views.addConnector(f.viewIri, { sourceNodeIri: note, targetNodeIri: api }, [{ x: 185, y: 40 }, { x: 400, y: 27 }]);
    const copy = f.views.duplicateView(f.viewIri).value;
    const [link] = f.views.getLinks(copy);
    const copiedNote = f.views.getNodes(copy).find((n) => n.figure)!.nodeIri;
    expect(link).toMatchObject({ connector: true, sourceNodeIri: copiedNote, targetElementIri: api, waypoints: [{ x: 185, y: 40 }, { x: 400, y: 27 }] });
  });
});

describe('a reference to another view, made and used on the canvas (Req 3.23)', () => {
  type El = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    parent?: El;
    waypoints?: unknown;
    businessObject?: { iri: string; kind?: string; label?: string; named?: boolean };
  };
  type Fixture = ReturnType<typeof mount>;
  const IN_VIEW = NAMESPACES.arch + 'inView';
  const registryOf = (f: Fixture) => f.service<{ get(id: string): El | undefined; getGraphics(e: El): SVGElement }>('elementRegistry');
  const rootOf = (f: Fixture) => f.service<{ getRootElement(): El }>('canvas').getRootElement();
  const modelingOf = (f: Fixture) =>
    f.service<{
      moveElements(e: unknown[], d: unknown, target?: unknown): void;
      connect(s: unknown, t: unknown, attrs: unknown): El | undefined;
    }>('modeling');
  const rulesOf = (f: Fixture) => f.service<{ allowed(action: string, context: unknown): unknown }>('rules');
  const references = (f: Fixture) => f.views.getNodes(f.viewIri).filter((n) => n.figure?.kind === 'reference');
  const presentedIn = (f: Fixture, viewIri: string) => f.store.getQuads(nn(viewIri), nn(IN_VIEW)).map((q) => q.object.value);
  const textOf = (f: Fixture, iri: string) => registryOf(f).getGraphics(registryOf(f).get(iri)!).textContent;
  /** A pointer event on the canvas, as the model tree hands one over. */
  const pointer = (f: Fixture, x: number, y: number, type = 'mousemove') =>
    f.service<{ createEvent(data: Record<string, unknown>): unknown }>('eventBus').createEvent({
      type,
      target: f.container,
      clientX: x,
      clientY: y,
      offsetX: x,
      offsetY: y,
      button: 0,
    });
  /** A view's row dragged from the model tree and let go over `over` — the diagram or a shape — or, none, off the canvas. */
  const dragView = (f: Fixture, viewIri: string, over: El | undefined, at = { x: 200, y: 450 }) => {
    const dragging = f.service<{ setOptions(o: unknown): void; move(e: unknown): void; hover(e: unknown): void; end(): void }>('dragging');
    dragging.setOptions({ manual: true });
    f.canvas.startCreateReference(viewIri, pointer(f, 5, 5, 'mousedown'));
    dragging.move(pointer(f, at.x - 10, at.y - 10));
    if (over) dragging.hover({ element: over, gfx: registryOf(f).getGraphics(over) });
    dragging.move(pointer(f, at.x, at.y));
    dragging.end();
  };
  /** The open view, "Payments" to reference, and "Shop", an element big enough to hold a reference. */
  const scene = (extra: Parameters<typeof mount>[0] = {}) => {
    const f = mount(extra);
    const payments = f.views.createView('Diagram', undefined, { modelIri: f.modelIri, label: 'Payments' }).value;
    const shop = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Shop' }).value;
    f.views.addElementToView(f.viewIri, shop, { x: 400, y: 100, width: 300, height: 200 });
    f.canvas.syncFromStore();
    return { f, payments, shop };
  };
  const placed = (f: Fixture, viewIri: string, y = 450) =>
    f.views.addFigure(f.viewIri, { kind: 'reference', view: viewIri, bounds: { x: 0, y, width: 120, height: 55 } });

  it('dragged from the tree onto the diagram, is made where it is let go: 120 × 55, no text of its own, its view presented there, selected; one undo (VR-1, VR-3)', () => {
    const { f, payments } = scene();
    dragView(f, payments, rootOf(f));
    const [made] = references(f);
    expect(made?.figure).toEqual({ kind: 'reference', view: payments });
    expect([made!.bounds.width, made!.bounds.height]).toEqual([120, 55]);
    expect(Math.abs(made!.bounds.x + 60 - 200)).toBeLessThanOrEqual(1);
    expect(presentedIn(f, payments)).toEqual([f.viewIri]);
    // Drawn with its view's name — named as its view is, no text of its own (VC-DD-4) — and of its view's class.
    expect(textOf(f, made!.nodeIri)).toBe('Payments');
    expect(registryOf(f).get(made!.nodeIri)?.businessObject).toMatchObject({
      label: 'Payments',
      named: true,
      nodeIri: made!.nodeIri,
      typeIri: NAMESPACES.arch + 'Diagram',
    });
    expect(registryOf(f).get(made!.nodeIri)?.businessObject).not.toHaveProperty('labelText');
    expect(f.canvas.selectedIris()).toEqual([made!.nodeIri]);
    f.commandStack.undo();
    expect(references(f)).toEqual([]);
    expect(presentedIn(f, payments)).toEqual([]);
    f.commandStack.redo();
    expect(references(f).map((n) => n.nodeIri)).toEqual([made!.nodeIri]);
  });

  it('let go in an element’s box, a group or a shape, is drawn and kept inside it, moves with it and comes out when dragged out; nothing goes in it (VR-5)', async () => {
    const { f, payments, shop } = scene();
    dragView(f, payments, registryOf(f).get(shop), { x: 550, y: 220 });
    const [made] = references(f);
    expect(made?.parentElementIri).toBe(shop);
    const reference = registryOf(f).get(made!.nodeIri)!;
    expect(reference.parent?.id).toBe(shop);
    // In an element's box it asks what the nesting stands for (VC-5): answered None, it is only drawn there.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const popup = f.service<{ isOpen(): boolean }>('popupMenu');
    expect(popup.isOpen()).toBe(true);
    (f.canvas.nestMenuProvider.getPopupMenuEntries(reference) as Record<string, { action: () => void }>)['la-nest-none']!.action();
    expect(popup.isOpen()).toBe(false);
    const x = f.views.getNode(f.viewIri, made!.nodeIri)!.bounds.x;
    modelingOf(f).moveElements([registryOf(f).get(shop)], { x: 40, y: 0 });
    expect(f.views.getNode(f.viewIri, made!.nodeIri)!.bounds.x).toBe(x + 40);
    modelingOf(f).moveElements([reference], { x: -500, y: 400 }, rootOf(f));
    expect(f.views.getNode(f.viewIri, made!.nodeIri)?.parentElementIri).toBeUndefined();
    expect(rulesOf(f).allowed('elements.move', { target: reference, shapes: [registryOf(f).get(shop)] })).toBe(false);
    // A group and a shape hold one too.
    const group = f.views.addFigure(f.viewIri, { kind: 'group', text: 'G', bounds: { x: 0, y: 700, width: 400, height: 260 } });
    const ellipse = f.views.addFigure(f.viewIri, { kind: 'shape', shapeType: NAMESPACES['arch-vis'] + 'Ellipse', bounds: { x: 500, y: 700, width: 300, height: 200 } });
    f.canvas.syncFromStore();
    dragView(f, payments, registryOf(f).get(group), { x: 200, y: 850 });
    dragView(f, payments, registryOf(f).get(ellipse), { x: 650, y: 800 });
    const holders = references(f).filter((n) => n.nodeIri !== made!.nodeIri).map((n) => n.parentElementIri);
    expect(holders).toEqual(expect.arrayContaining([group, ellipse]));
  });

  it('the open view’s own row makes nothing on its own diagram, and says why when let go there (VR-1)', () => {
    const notices: string[] = [];
    const { f } = scene({ onNotice: (message) => void notices.push(message) });
    dragView(f, f.viewIri, rootOf(f));
    expect(references(f)).toEqual([]);
    expect(notices).toEqual(["This is the open view: drag it onto another view's diagram to reference it."]);
    // Let go off the canvas — in the tree, on a folder — it says nothing.
    dragView(f, f.viewIri, undefined);
    expect(notices).toHaveLength(1);
    expect(f.commandStack.canUndo()).toBe(false);
  });

  it('the tree’s Reference in the open view: made at the centre of the visible area, selected, one undoable step (VR-2)', () => {
    const { f, payments } = scene();
    expect(f.canvas.placeReference(f.viewIri)).toBe(false);
    expect(f.canvas.placeReference(payments)).toBe(true);
    const [made] = references(f);
    const box = f.service<{ viewbox(): { x: number; y: number; width: number; height: number } }>('canvas').viewbox();
    expect(Math.abs(made!.bounds.x + 60 - Math.round(box.x + box.width / 2))).toBeLessThanOrEqual(1);
    expect(made?.figure).toEqual({ kind: 'reference', view: payments });
    expect(f.canvas.selectedIris()).toEqual([made!.nodeIri]);
    f.commandStack.undo();
    expect(references(f)).toEqual([]);
  });

  it('is named as its view is now — renamed in the tree, by a collaborator, by F2 on it — and draws its own text, an empty one too, in its place (VR-4, VC-2)', () => {
    const { f, payments } = scene();
    const node = placed(f, payments);
    const second = placed(f, payments, 600);
    f.canvas.syncFromStore();
    expect(textOf(f, node)).toBe('Payments');
    // Renamed in the tree, and by a collaborator: nothing else asked to redraw it.
    f.session.renameView(payments, 'Payments v2');
    expect(textOf(f, node)).toBe('Payments v2');
    f.views.renameView(payments, 'Payments v3');
    expect(textOf(f, node)).toBe('Payments v3');
    // F2 on it renames the view — every reference to it — in one undoable step, and never to nothing.
    const prefLabel = nn(NAMESPACES.skos + 'prefLabel');
    const editor = f.service<{ update(element: unknown, text: string): void }>('rdfLabelEditingProvider');
    editor.update(registryOf(f).get(node), 'Payment flows');
    expect(f.views.getView(payments)?.label).toBe('Payment flows');
    expect([textOf(f, node), textOf(f, second)]).toEqual(['Payment flows', 'Payment flows']);
    expect(f.store.getQuads(nn(node), prefLabel)).toEqual([]);
    editor.update(registryOf(f).get(node), '');
    expect(f.views.getView(payments)?.label).toBe('Payment flows');
    f.commandStack.undo();
    expect(f.views.getView(payments)?.label).toBe('Payments v3');
    expect([textOf(f, node), textOf(f, second)]).toEqual(['Payments v3', 'Payments v3']);
    // Its own text — the property panel's Text — drawn in place of the name, which F2 still renames.
    f.views.setFigureText(f.viewIri, node, 'See also');
    f.canvas.syncFromStore();
    expect(textOf(f, node)).toBe('See also');
    expect(registryOf(f).get(node)?.businessObject).toMatchObject({ label: 'Payments v3', labelText: 'See also' });
    f.session.renameView(payments, 'Payments v4');
    expect([textOf(f, node), textOf(f, second)]).toEqual(['See also', 'Payments v4']);
    // An empty one of its own draws nothing.
    f.store.removeQuads(f.store.getQuads(nn(node), prefLabel));
    f.store.addQuads([DataFactory.quad(nn(node), prefLabel, DataFactory.literal('', 'en')) as never]);
    f.canvas.syncFromStore();
    expect(f.views.getNode(f.viewIri, node)?.figure?.text).toBe('');
    expect(textOf(f, node)).toBe('');
    // With none of its own — the panel's × — it shows the view's name again.
    f.views.setFigureText(f.viewIri, node, undefined);
    f.canvas.syncFromStore();
    expect(textOf(f, node)).toBe('Payments v4');
    expect(registryOf(f).get(node)?.businessObject).not.toHaveProperty('labelText');
  });

  it('a note’s, a group’s or a shape’s text emptied on the canvas goes: nothing drawn, undoably', () => {
    const { f } = scene();
    const note = f.views.addFigure(f.viewIri, { kind: 'note', text: 'Draft', bounds: { x: 0, y: 450, width: 185, height: 80 } });
    f.canvas.syncFromStore();
    const editor = f.service<{ update(element: unknown, text: string): void }>('rdfLabelEditingProvider');
    editor.update(registryOf(f).get(note), '');
    expect(f.store.getQuads(nn(note), nn(NAMESPACES.skos + 'prefLabel'))).toEqual([]);
    expect(textOf(f, note)).toBe('');
    f.commandStack.undo();
    expect(textOf(f, note)).toBe('Draft');
  });

  it('follows a collaborator: drawn as they made it, pointed at another view, taken off (VR-12)', () => {
    const { f, payments } = scene();
    const orders = f.views.createView('Diagram', undefined, { modelIri: f.modelIri, label: 'Orders' }).value;
    const node = placed(f, payments);
    f.canvas.syncFromStore();
    expect(textOf(f, node)).toBe('Payments');
    f.views.setReferenceView(f.viewIri, node, orders);
    f.canvas.syncFromStore();
    expect(textOf(f, node)).toBe('Orders');
    f.views.removeElementFromView(f.viewIri, node);
    f.canvas.syncFromStore();
    expect(registryOf(f).get(node)).toBeUndefined();
  });

  it('double-clicked, or Open view on its pad or in its menu, asks to open the view it opens — not to rename it (VR-7)', () => {
    const bus = new EventBus();
    const asked: unknown[] = [];
    bus.on('open-referenced-view', (event) => void asked.push(event.detail));
    const { f, payments } = scene({ eventBus: bus });
    const node = placed(f, payments);
    f.canvas.syncFromStore();
    const reference = registryOf(f).get(node)!;
    f.service<{ fire(type: string, data: unknown): void }>('eventBus').fire('element.dblclick', {
      element: reference,
      gfx: registryOf(f).getGraphics(reference),
      originalEvent: new MouseEvent('dblclick'),
    });
    expect(asked).toEqual([{ nodeIri: node, viewIri: payments }]);
    expect(f.service<{ isActive(): boolean }>('directEditing').isActive()).toBe(false);
    const pad = f.canvas.contextPadProvider.getContextPadEntries(reference as never);
    expect(Object.keys(pad)).toEqual(['delete', 'connect', 'open-view']);
    expect(pad['open-view']!.title).toBe('Open view');
    (pad['open-view']!.action as () => void)();
    const menu = f.canvas.contextMenuProvider.getPopupMenuEntries(reference) as Record<string, { label: string; action: () => void }>;
    // Its menu renames its view, too (VC-2).
    expect(Object.keys(menu)).toEqual(['open-view', 'rename', 'delete']);
    expect(menu['open-view']!.label).toBe('Open view');
    menu['open-view']!.action();
    expect(asked).toHaveLength(3);
    // A note has no Open view.
    const note = f.views.addFigure(f.viewIri, { kind: 'note', text: 'n', bounds: { x: 0, y: 700, width: 185, height: 80 } });
    f.canvas.syncFromStore();
    expect(Object.keys(f.canvas.contextPadProvider.getContextPadEntries(registryOf(f).get(note) as never))).toEqual(['delete', 'connect']);
  });

  it('connects to an element by a relationship with the view as its end — the core’s, where no language relates them; undoably (VC-3)', () => {
    const { f, payments, shop } = scene();
    const node = placed(f, payments);
    f.canvas.syncFromStore();
    const reference = registryOf(f).get(node)!;
    const element = registryOf(f).get(shop)!;
    const rules = rulesOf(f);
    expect(f.canvas.contextPadProvider.getContextPadEntries(reference as never)['connect']?.title).toBe('Connect');
    // ArchiMate relates no view: the core's three, Association first (Req 4.21).
    const attrs = rules.allowed('connection.create', { source: element, target: reference }) as { typeIri: string; candidates: Array<{ iri: string }> };
    expect(attrs.typeIri).toBe(NAMESPACES.arch + 'Association');
    expect(attrs.candidates.map((c) => c.iri)).toEqual(['Association', 'HasPart', 'Refines'].map((t) => NAMESPACES.arch + t));
    const line = modelingOf(f).connect(element, reference, attrs)!;
    expect(line.businessObject?.kind).toBe('relationship');
    const [relationship] = f.relationships.getRelationshipsOf(payments);
    expect(relationship).toMatchObject({ sourceIri: shop, targetIri: payments, classIri: NAMESPACES.arch + 'Association' });
    expect(f.views.getLinks(f.viewIri)).toEqual([
      expect.objectContaining({ relationshipIri: relationship!.iri, targetNodeIri: node, targetElementIri: payments }),
    ]);
    expect(line.businessObject?.iri).toBe(relationship!.iri);
    f.commandStack.undo();
    expect(f.relationships.getRelationshipsOf(payments)).toEqual([]);
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    f.commandStack.redo();
    expect(f.relationships.getRelationshipsOf(payments).map((r) => r.iri)).toEqual([relationship!.iri]);
    // Taken off the view, the reference goes with its line; the relationship stays in the model (VC-8).
    (f.canvas.contextPadProvider.getContextPadEntries(registryOf(f).get(node) as never)['delete']!.action as () => void)();
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    expect(f.relationships.getRelationshipsOf(payments).map((r) => r.iri)).toEqual([relationship!.iri]);
  });

  it('a type picked in the palette is drawn when the pair permits it; a line from a note to it stands for no relationship (VC-3)', () => {
    const { f, payments, shop } = scene();
    const node = placed(f, payments);
    const note = f.views.addFigure(f.viewIri, { kind: 'note', text: 'n', bounds: { x: 0, y: 700, width: 185, height: 80 } });
    f.canvas.syncFromStore();
    const [reference, element] = [registryOf(f).get(node)!, registryOf(f).get(shop)!];
    const rules = rulesOf(f);
    f.canvas.setPreferredRelationshipType(`${AM4}Serving`);
    expect(rules.allowed('connection.create', { source: element, target: reference })).toBe(false);
    f.canvas.setPreferredRelationshipType(NAMESPACES.arch + 'Refines');
    const refines = rules.allowed('connection.create', { source: reference, target: element });
    expect(refines).toMatchObject({ typeIri: NAMESPACES.arch + 'Refines' });
    // Drawn from the reference it was drawn from, where the view is referenced twice.
    const another = placed(f, payments, 300);
    f.canvas.syncFromStore();
    modelingOf(f).connect(registryOf(f).get(another), element, refines);
    expect(f.views.getLinks(f.viewIri)).toEqual([expect.objectContaining({ sourceNodeIri: another, sourceElementIri: payments, targetElementIri: shop })]);
    expect(f.store.getQuads(nn(payments), nn(NAMESPACES.arch + 'refines')).map((q) => q.object.value)).toEqual([shop]);
    f.commandStack.undo();
    f.canvas.setPreferredRelationshipType(undefined);
    const attrs = rules.allowed('connection.create', { source: registryOf(f).get(note), target: reference });
    expect(attrs).toMatchObject({ connector: true, typeIri: '' });
    modelingOf(f).connect(registryOf(f).get(note), reference, attrs);
    expect(f.views.getLinks(f.viewIri)).toEqual([expect.objectContaining({ connector: true, sourceElementIri: note, targetNodeIri: node })]);
    expect(f.relationships.getRelationshipsOf(payments)).toEqual([]);
  });

  it('made, draws its view’s relationships to what the diagram shows, in the same undo step (VC-4)', () => {
    const { f, payments, shop } = scene();
    const refines = f.relationships.createQualifiedRelationship({
      typeIri: NAMESPACES.arch + 'Refines',
      predicateIri: NAMESPACES.arch + 'refines',
      sourceIri: payments,
      targetIri: shop,
      modelIri: f.modelIri,
    }).iri;
    dragView(f, payments, rootOf(f));
    const [made] = references(f);
    expect(f.views.getLinks(f.viewIri)).toEqual([expect.objectContaining({ relationshipIri: refines, sourceNodeIri: made!.nodeIri, targetElementIri: shop })]);
    expect(registryOf(f).get(refines)?.waypoints).toBeDefined();
    f.commandStack.undo();
    expect(references(f)).toEqual([]);
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    expect(f.relationships.getRelationshipsOf(payments).map((r) => r.iri)).toEqual([refines]);
  });

  it('let go in an element’s box, asks what the nesting stands for: Refines, made and shown by it; taken out, drawn as a line (VC-5)', async () => {
    const { f, payments, shop } = scene();
    dragView(f, payments, registryOf(f).get(shop), { x: 550, y: 220 });
    const [made] = references(f);
    const reference = registryOf(f).get(made!.nodeIri)!;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.service<{ isOpen(): boolean }>('popupMenu').isOpen()).toBe(true);
    const offers = f.canvas.nestMenuProvider.getPopupMenuEntries(reference) as Record<string, { label: string; description: string; action: () => void }>;
    expect(Object.keys(offers)).toEqual(['la-nest-0', 'la-nest-none']);
    expect([offers['la-nest-0']!.label, offers['la-nest-0']!.description]).toEqual(['Refines', 'Payments → Shop']);
    offers['la-nest-0']!.action();
    const [refines] = f.relationships.getRelationshipsOf(payments);
    expect(refines).toMatchObject({ sourceIri: payments, targetIri: shop, classIri: NAMESPACES.arch + 'Refines' });
    expect(f.store.getQuads(nn(payments), nn(NAMESPACES.arch + 'refines')).map((q) => q.object.value)).toEqual([shop]);
    // Shown by the nesting: the view's, with no line.
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    expect(presentedIn(f, refines!.iri)).toEqual([f.viewIri]);
    // Taken out of the box: drawn as a line, in the same step as the move.
    modelingOf(f).moveElements([reference], { x: -500, y: 400 }, rootOf(f));
    expect(f.views.getLinks(f.viewIri)).toEqual([expect.objectContaining({ relationshipIri: refines!.iri, sourceNodeIri: made!.nodeIri })]);
    f.commandStack.undo();
    expect(f.views.getLinks(f.viewIri)).toEqual([]);
    f.commandStack.undo();
    expect(f.relationships.getRelationshipsOf(payments)).toEqual([]);
  });

  it('is selected when its view is — in the tree, by its link — and tells which reference is selected (VC-1)', () => {
    const { f, payments } = scene();
    const node = placed(f, payments);
    const second = placed(f, payments, 600);
    f.canvas.syncFromStore();
    expect(f.canvas.reveal(payments)).toBe(true);
    expect(f.canvas.selectedIris().sort()).toEqual([node, second].sort());
    expect(f.canvas.selectedReference()).toEqual({ nodeIri: expect.any(String), viewIri: payments });
    f.canvas.selectIris([second]);
    expect(f.canvas.selectedReference()).toEqual({ nodeIri: second, viewIri: payments });
    f.canvas.selectIris([]);
    expect(f.canvas.selectedReference()).toBeUndefined();
  });

  it('zooms in from an element or a relationship a view refines, drawn or not: the one opens, several are listed by name (VC-6)', () => {
    const bus = new EventBus();
    const opened: unknown[] = [];
    bus.on('open-view', (event) => void opened.push(event.detail));
    const { f, payments, shop } = scene({ eventBus: bus });
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    f.views.addElementToView(f.viewIri, api, { x: 0, y: 100, width: 120, height: 55 });
    const serving = f.relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: api, targetIri: shop }).iri;
    f.views.addRelationshipToView(f.viewIri, serving);
    f.canvas.syncFromStore();
    const padOf = (iri: string) => f.canvas.contextPadProvider.getContextPadEntries(registryOf(f).get(iri) as never);
    const menuOf = (iri: string) => f.canvas.contextMenuProvider.getPopupMenuEntries(registryOf(f).get(iri)) as Record<string, { label: string; action: () => void }>;
    expect(padOf(shop)['zoom-in']).toBeUndefined();
    // Payments refines Shop, with no reference to it drawn; another tool's Overview is what the line is refined into.
    const quadOf = (s: string, p: string, o: string) => DataFactory.quad(nn(s), nn(p), nn(o)) as never;
    f.store.addQuads([quadOf(payments, NAMESPACES.arch + 'refines', shop)]);
    const overview = f.views.createView('Diagram', undefined, { modelIri: f.modelIri, label: 'Overview' }).value;
    f.store.addQuads([quadOf(serving, NAMESPACES.arch + 'refinedInto', overview)]);
    expect(padOf(shop)['zoom-in']?.title).toBe('Zoom in');
    (padOf(shop)['zoom-in']!.action as (event: unknown) => void)(new MouseEvent('click'));
    expect(opened).toEqual([{ viewIri: payments }]);
    expect(menuOf(shop)['zoom-in-0']?.label).toBe('Zoom in: Payments');
    (padOf(serving)['zoom-in']!.action as (event: unknown) => void)(new MouseEvent('click'));
    expect(opened).toEqual([{ viewIri: payments }, { viewIri: overview }]);
    // Refined by two: the pad's lists them, by name, and the one picked opens.
    f.store.addQuads([quadOf(overview, NAMESPACES.arch + 'refines', shop)]);
    (padOf(shop)['zoom-in']!.action as (event: unknown) => void)(new MouseEvent('click'));
    expect(f.service<{ isOpen(): boolean }>('popupMenu').isOpen()).toBe(true);
    const listed = f.canvas.zoomMenuProvider.getPopupMenuEntries(registryOf(f).get(shop)) as Record<string, { label: string; action: () => void }>;
    expect(Object.values(listed).map((entry) => entry.label)).toEqual(['Overview', 'Payments']);
    listed['la-zoom-0']!.action();
    expect(opened.at(-1)).toEqual({ viewIri: overview });
    expect(f.service<{ isOpen(): boolean }>('popupMenu').isOpen()).toBe(false);
    expect(Object.values(menuOf(shop)).map((entry) => entry.label).filter((label) => label.startsWith('Zoom in'))).toEqual([
      'Zoom in: Overview',
      'Zoom in: Payments',
    ]);
  });

  it('is deleted as any figure — its pad, its menu — its view leaving the holder with its last reference there; undo brings both back (VR-9)', () => {
    const { f, payments } = scene();
    const first = placed(f, payments);
    const second = placed(f, payments, 600);
    f.canvas.syncFromStore();
    (f.canvas.contextPadProvider.getContextPadEntries(registryOf(f).get(first) as never)['delete']!.action as () => void)();
    expect(presentedIn(f, payments)).toEqual([f.viewIri]);
    (f.canvas.contextMenuProvider.getPopupMenuEntries(registryOf(f).get(second)) as Record<string, { action: () => void }>)['delete']!.action();
    expect(references(f)).toEqual([]);
    expect(presentedIn(f, payments)).toEqual([]);
    f.commandStack.undo();
    expect(presentedIn(f, payments)).toEqual([f.viewIri]);
    expect(references(f).map((n) => n.nodeIri)).toEqual([second]);
  });
});

describe('an element placed more than once in a view', () => {
  const SERVING = `${AM4}Serving`;
  type El = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    waypoints?: unknown;
    source?: El;
    businessObject?: { iri: string; nodeIri?: string; label?: string; typeIri?: string };
  };
  const registryOf = (f: ReturnType<typeof mount>) =>
    f.service<{ get(id: string): El | undefined; getAll(): El[] }>('elementRegistry');
  const placementsOf = (f: ReturnType<typeof mount>, iri: string) =>
    registryOf(f).getAll().filter((e) => !e.waypoints && e.businessObject?.iri === iri);
  const modelingOf = (f: ReturnType<typeof mount>) =>
    f.service<{
      createShape(s: unknown, p: unknown, parent: unknown): El;
      moveElements(e: unknown[], d: unknown, target?: unknown): void;
      removeElements(e: unknown[]): void;
      connect(s: unknown, t: unknown, attrs: unknown): El | undefined;
    }>('modeling');
  const rootOf = (f: ReturnType<typeof mount>) => f.service<{ getRootElement(): El }>('canvas').getRootElement();
  /** API (placed twice from the store) and Web, API serving Web. */
  const twice = () => {
    const f = mount();
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    const first = f.views.addElementToView(f.viewIri, api, { x: 100, y: 100, width: 120, height: 55 });
    const second = f.views.addElementToView(f.viewIri, api, { x: 100, y: 400, width: 120, height: 55 }, { another: true });
    const webNode = f.views.addElementToView(f.viewIri, web, { x: 500, y: 400, width: 120, height: 55 });
    f.canvas.syncFromStore();
    return { f, api, web, first, second, webNode };
  };

  it('is drawn once a placement, each its node; a line joins the placements its link names', () => {
    const { f, api, web, second, webNode } = twice();
    const serving = f.relationships.createQualifiedRelationship({ typeIri: SERVING, sourceIri: api, targetIri: web }).iri;
    f.views.addRelationshipToView(f.viewIri, serving, undefined, { sourceNodeIri: second, targetNodeIri: webNode });
    f.canvas.syncFromStore();
    const placed = placementsOf(f, api);
    expect(placed.map((p) => p.businessObject?.nodeIri).sort()).toEqual(f.views.getNodes(f.viewIri).filter((n) => n.elementIri === api).map((n) => n.nodeIri).sort());
    // The element's IRI keys one placement, the other its node.
    expect(placed.map((p) => p.id).sort()).toEqual([api, second].sort());
    expect(registryOf(f).get(serving)?.source?.businessObject?.nodeIri).toBe(second);
  });

  it('dragged in again, it gets another placement, with no lines of its own; undo takes that one back', () => {
    const f = mount();
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    f.views.addElementToView(f.viewIri, api, { x: 100, y: 100, width: 120, height: 55 });
    f.views.addElementToView(f.viewIri, web, { x: 500, y: 100, width: 120, height: 55 });
    const serving = f.relationships.createQualifiedRelationship({ typeIri: SERVING, sourceIri: api, targetIri: web }).iri;
    f.views.addRelationshipToView(f.viewIri, serving);
    f.canvas.syncFromStore();

    const shape = f.service<{ createShape(a: Record<string, unknown>): El }>('elementFactory').createShape({
      id: api,
      width: 120,
      height: 55,
      businessObject: { iri: api, typeIri: COMPONENT, label: 'API', kind: 'element', placeExisting: true },
    });
    modelingOf(f).createShape(shape, { x: 160, y: 450 }, rootOf(f));
    expect(placementsOf(f, api)).toHaveLength(2);
    expect(shape.id).toBe(shape.businessObject?.nodeIri);
    expect(f.views.getNodes(f.viewIri).filter((n) => n.elementIri === api)).toHaveLength(2);
    expect(f.views.getLinks(f.viewIri)).toHaveLength(1);

    f.commandStack.undo();
    expect(placementsOf(f, api)).toHaveLength(1);
    expect(f.views.getNodes(f.viewIri).filter((n) => n.elementIri === api)).toHaveLength(1);
  });

  it('each placement moves on its own, and is deleted on its own: the element leaves the view with its last', () => {
    const { f, api, first, second } = twice();
    const secondShape = placementsOf(f, api).find((p) => p.businessObject?.nodeIri === second)!;
    modelingOf(f).moveElements([secondShape], { x: 50, y: 0 });
    expect(f.views.getNode(f.viewIri, second)?.bounds.x).toBe(150);
    expect(f.views.getNode(f.viewIri, first)?.bounds.x).toBe(100);

    modelingOf(f).removeElements([secondShape]);
    expect(f.views.getNodes(f.viewIri).filter((n) => n.elementIri === api).map((n) => n.nodeIri)).toEqual([first]);
    expect(f.views.viewsContaining(api)).toContain(f.viewIri);
    f.commandStack.undo();
    expect(f.views.getNodes(f.viewIri).filter((n) => n.elementIri === api)).toHaveLength(2);

    for (const placement of placementsOf(f, api)) modelingOf(f).removeElements([placement]);
    expect(f.views.viewsContaining(api)).not.toContain(f.viewIri);
  });

  it('a line drawn from a placement is drawn from it', () => {
    const { f, api, web, second } = twice();
    const secondShape = placementsOf(f, api).find((p) => p.businessObject?.nodeIri === second)!;
    const serving = palette.relationshipTypes.find((t) => t.iri === SERVING)!;
    modelingOf(f).connect(secondShape, placementsOf(f, web)[0], { typeIri: serving.iri, unqualifiedPredicateIri: serving.unqualifiedPredicateIri });
    const [link] = f.views.getLinks(f.viewIri);
    expect(link?.sourceNodeIri).toBe(second);
  });

  it('selected, every placement is; renamed or retyped, every placement shows it', async () => {
    const { f, api } = twice();
    f.canvas.reveal(api);
    expect(f.service<{ get(): El[] }>('selection').get().map((e) => e.businessObject?.nodeIri).length).toBe(2);

    f.elements.updateProperty(api, NAMESPACES.skos + 'prefLabel', DataFactory.literal('Gateway', 'en') as never);
    f.canvas.syncFromStore();
    expect(placementsOf(f, api).map((p) => p.businessObject?.label)).toEqual(['Gateway', 'Gateway']);

    await f.canvas.retypeElement(api, `${AM4}ApplicationInterface`);
    expect(placementsOf(f, api).map((p) => p.businessObject?.typeIri)).toEqual([`${AM4}ApplicationInterface`, `${AM4}ApplicationInterface`]);

    // Renamed on the canvas, on one placement: both show it, and undo takes both back.
    f.service<{ execute(c: string, ctx: unknown): void }>('commandStack').execute('rdf.element.relabel', { element: placementsOf(f, api)[0], label: 'Edge' });
    expect(placementsOf(f, api).map((p) => p.businessObject?.label)).toEqual(['Edge', 'Edge']);
    f.commandStack.undo();
    expect(placementsOf(f, api).map((p) => p.businessObject?.label)).toEqual(['Gateway', 'Gateway']);
  });
});

describe('a relationship drawn more than once in a view', () => {
  const SERVING = `${AM4}Serving`;
  type El = {
    id: string;
    waypoints?: unknown;
    source?: El;
    target?: El;
    businessObject?: { iri: string; nodeIri?: string; linkIri?: string; label?: string; typeIri?: string };
  };
  type Entries = Record<string, { label: string; action(): void }>;
  const registryOf = (f: ReturnType<typeof mount>) => f.service<{ getAll(): El[] }>('elementRegistry');
  const linesOf = (f: ReturnType<typeof mount>, iri: string) => registryOf(f).getAll().filter((e) => e.waypoints && e.businessObject?.iri === iri);
  const placementsOf = (f: ReturnType<typeof mount>, iri: string) =>
    registryOf(f).getAll().filter((e) => !e.waypoints && e.businessObject?.iri === iri);
  /** API placed twice, Web once; API serves Web, drawn from API's first placement. */
  const scene = () => {
    const f = mount();
    const api = f.elements.createElement(COMPONENT, f.modelIri, { label: 'API' }).value;
    const web = f.elements.createElement(COMPONENT, f.modelIri, { label: 'Web' }).value;
    const first = f.views.addElementToView(f.viewIri, api, { x: 100, y: 100, width: 120, height: 55 });
    const second = f.views.addElementToView(f.viewIri, api, { x: 100, y: 400, width: 120, height: 55 }, { another: true });
    const webNode = f.views.addElementToView(f.viewIri, web, { x: 500, y: 250, width: 120, height: 55 });
    const serving = f.relationships.createQualifiedRelationship({ typeIri: SERVING, sourceIri: api, targetIri: web }).iri;
    f.views.addRelationshipToView(f.viewIri, serving, undefined, { sourceNodeIri: first, targetNodeIri: webNode });
    f.canvas.syncFromStore();
    const at = (node: string) => placementsOf(f, api).find((p) => p.businessObject?.nodeIri === node)!;
    return { f, api, web, first, second, webNode, serving, at };
  };
  const drawFrom = (f: ReturnType<typeof mount>, from: El, to: El) => {
    const type = palette.relationshipTypes.find((t) => t.iri === SERVING)!;
    return f
      .service<{ connect(s: unknown, t: unknown, attrs: unknown): El | undefined }>('modeling')
      .connect(from, to, { typeIri: type.iri, unqualifiedPredicateIri: type.unqualifiedPredicateIri });
  };

  it('drawn from the other placement, the relationship the model has is offered — and drawn again there, undoably', async () => {
    const { f, api, web, second, serving, at } = scene();
    expect(drawFrom(f, at(second), placementsOf(f, web)[0]!)).toBeUndefined();
    await Promise.resolve();
    const entries = Object.values(f.canvas.reuseMenuProvider.getPopupMenuEntries(undefined) as Entries);
    entries.find((e) => e.label === 'Use the existing Serving')!.action();

    expect(f.relationships.getRelationshipsOf!(api).filter((r) => r.classIri === SERVING)).toHaveLength(1);
    expect(linesOf(f, serving)).toHaveLength(2);
    const links = f.views.getLinks(f.viewIri).filter((l) => l.relationshipIri === serving);
    expect(links.map((l) => l.sourceNodeIri)).toContain(second);
    f.commandStack.undo();
    expect(linesOf(f, serving)).toHaveLength(1);
    expect(f.views.getLinks(f.viewIri)).toHaveLength(1);
  });

  it('between the same placements again, nothing is asked: that is another relationship', () => {
    const { f, web, first, serving, at } = scene();
    expect(drawFrom(f, at(first), placementsOf(f, web)[0]!)).toBeDefined();
    expect(f.canvas.reuseMenuProvider.pending).toBeUndefined();
    expect(linesOf(f, serving)).toHaveLength(1);
  });

  it('each line is its own: deleted on its own, the relationship leaving the view with its last; reopened, each between its placements', () => {
    const { f, web, second, webNode, serving } = scene();
    f.canvas.drawExistingRelationship(serving, { source: placementsOf(f, f.views.getNode(f.viewIri, second)!.elementIri).find((p) => p.businessObject?.nodeIri === second) as never, target: placementsOf(f, web)[0] as never });
    expect(linesOf(f, serving)).toHaveLength(2);

    const other = f.views.createView('Diagram', undefined, { modelIri: f.modelIri }).value;
    f.canvas.showView(other);
    f.canvas.showView(f.viewIri);
    const lines = linesOf(f, serving);
    expect(lines.map((l) => l.source?.businessObject?.nodeIri).sort()).toEqual(
      f.views.getLinks(f.viewIri).map((l) => l.sourceNodeIri).sort(),
    );
    expect(lines.every((l) => l.target?.businessObject?.nodeIri === webNode)).toBe(true);

    const modeling = f.service<{ removeElements(e: unknown[]): void }>('modeling');
    modeling.removeElements([lines.find((l) => l.source?.businessObject?.nodeIri === second)]);
    expect(f.views.getLinks(f.viewIri).filter((l) => l.relationshipIri === serving)).toHaveLength(1);
    expect(f.views.viewsContaining(serving)).toContain(f.viewIri);
    modeling.removeElements(linesOf(f, serving));
    expect(f.views.viewsContaining(serving)).not.toContain(f.viewIri);
  });

  it('selected, every line is; renamed on one line, every line shows it', () => {
    const { f, web, second, serving, at } = scene();
    f.canvas.drawExistingRelationship(serving, { source: at(second) as never, target: placementsOf(f, web)[0] as never });
    f.canvas.reveal(serving);
    expect(f.service<{ get(): El[] }>('selection').get().filter((e) => e.waypoints)).toHaveLength(2);
    f.service<{ execute(c: string, ctx: unknown): void }>('commandStack').execute('rdf.element.relabel', { element: linesOf(f, serving)[0], label: 'Calls' });
    expect(linesOf(f, serving).map((l) => l.businessObject?.label)).toEqual(['Calls', 'Calls']);
  });
});
