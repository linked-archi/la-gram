// @vitest-environment jsdom

/**
 * Search on the canvas (Req 23.2–23.5), against the real managers and the bundled ArchiMate 4.0 metamodel: what is
 * found by its name, its text or its type, in reading order, outlined, the current one selected; stepping, *Select
 * all*, searching again after a change, and closing.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
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
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas } from '../diagram-canvas.js';
import { buildClassClosure } from '../relationship-resolution.js';
import { SEARCH_CURRENT_MARKER, SEARCH_MATCH_MARKER, searchTextsOf, textsMatch } from '../canvas-search.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
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

/** A diagram: Order service (an application service) and two components, a line, and a note. */
function mount() {
  const store = new ObservableRdfStore(base);
  const elements = new OxigraphElementManager(store);
  const relationships = new OxigraphRelationshipManager(store);
  const views = new OxigraphViewManager(store);
  const session = new ModelSession(store, elements, views);
  const { modelIri, viewIri } = session.newModel({ label: 'Test' });
  const place = (type: string, label: string, x: number, y: number) => {
    const iri = elements.createElement(`${AM4}${type}`, modelIri, { label }).value;
    views.addElementToView(viewIri, iri, { x, y, width: 120, height: 55 });
    return iri;
  };
  // Out of reading order on purpose: Billing is above and right of Orders.
  const orders = place('ApplicationComponent', 'Orders', 0, 200);
  const billing = place('ApplicationComponent', 'Billing', 400, 0);
  const service = place('ApplicationService', 'Order service', 400, 205);
  const serving = relationships.createQualifiedRelationship({ typeIri: `${AM4}Serving`, sourceIri: service, targetIri: billing }).iri;
  views.addRelationshipToView(viewIri, serving, []);
  const note = views.addFigure(viewIri, { kind: 'note', text: 'Ask about orders', bounds: { x: 0, y: 400, width: 185, height: 80 } });
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
  const service_ = <T,>(name: string): T => (canvas.getDiagram() as unknown as { get(n: string): T }).get(name);
  const markers = (marker: string) =>
    service_<{ getAll(): Array<{ id: string; businessObject?: { iri?: string } }> }>('elementRegistry')
      .getAll()
      .filter((e) => service_<{ hasMarker(e: unknown, m: string): boolean }>('canvas').hasMarker(e, marker))
      .map((e) => e.businessObject?.iri);
  return { canvas, elements, views, viewIri, orders, billing, service, serving, note, markers };
}

describe('what a shape is found by', () => {
  it('its name, its own text, and its type’s name; case and runs of white space ignored', () => {
    const texts = searchTextsOf({ iri: 'x', typeIri: `${AM4}ApplicationComponent`, kind: 'element', label: 'Order\\nmanagement' } as never, () => 'Application Component');
    expect(textsMatch(texts, 'application  COMPONENT')).toBe(true);
    expect(textsMatch(['Order\nmanagement'], 'order management')).toBe(true);
    expect(textsMatch(texts, '  ')).toBe(false);
    // A figure has no type to be found by.
    expect(searchTextsOf({ iri: 'n', typeIri: '', kind: 'figure', label: 'Ask the CFO' } as never, () => 'Note')).toEqual(['Ask the CFO']);
  });
});

describe('search on the canvas (Req 23.2–23.5)', () => {
  it('names and a note’s text, in reading order; the first selected, every one outlined', () => {
    const f = mount();
    expect(f.canvas.search('order')).toEqual({ query: 'order', count: 3, current: 0 });
    // Orders (y 200) and Order service (y 205) share a row, read left to right; the note is below.
    expect(f.markers(SEARCH_MATCH_MARKER)).toEqual(expect.arrayContaining([f.orders, f.service, f.note]));
    expect(f.canvas.selectedIris()).toEqual([f.orders]);
    expect(f.markers(SEARCH_CURRENT_MARKER)).toEqual([f.orders]);

    expect(f.canvas.searchStep(1).current).toBe(1);
    expect(f.canvas.selectedIris()).toEqual([f.service]);
    f.canvas.searchStep(1);
    expect(f.canvas.selectedIris()).toEqual([f.note]);
    // Past the last, the first; before the first, the last.
    expect(f.canvas.searchStep(1).current).toBe(0);
    expect(f.canvas.searchStep(-1).current).toBe(2);
    expect(f.markers(SEARCH_CURRENT_MARKER)).toEqual([f.note]);
  });

  it('by a type’s name: every component, and a relationship by its type', () => {
    const f = mount();
    expect(f.canvas.search('application component').count).toBe(2);
    expect(f.canvas.search('serving').count).toBe(1);
    expect(f.canvas.selectedIris()).toEqual([f.serving]);
  });

  it('Select all selects every match; closing takes the outlines away and leaves the selection', () => {
    const f = mount();
    f.canvas.search('order');
    f.canvas.searchSelectAll();
    expect(f.canvas.selectedIris().sort()).toEqual([f.orders, f.service, f.note].sort());
    f.canvas.endSearch();
    expect(f.markers(SEARCH_MATCH_MARKER)).toEqual([]);
    expect(f.markers(SEARCH_CURRENT_MARKER)).toEqual([]);
    expect(f.canvas.selectedIris()).toHaveLength(3);
  });

  it('searched again after a change: the current match kept while it matches, nothing selected anew', () => {
    const f = mount();
    f.canvas.search('order');
    f.canvas.searchStep(1); // Order service
    f.canvas.selectIris([f.billing]);
    f.elements.updateProperty(f.orders, `${NAMESPACES.skos}prefLabel`, DataFactory.literal('Sales', 'en') as never);
    f.canvas.syncFromStore();
    expect(f.canvas.search('order', true)).toEqual({ query: 'order', count: 2, current: 0 });
    expect(f.markers(SEARCH_CURRENT_MARKER)).toEqual([f.service]);
    expect(f.canvas.selectedIris()).toEqual([f.billing]);
  });

  it('no match: none current, nothing selected', () => {
    const f = mount();
    f.canvas.selectIris([f.billing]);
    expect(f.canvas.search('warehouse')).toEqual({ query: 'warehouse', count: 0, current: -1 });
    expect(f.canvas.selectedIris()).toEqual([f.billing]);
    expect(f.canvas.searchStep(1).current).toBe(-1);
  });
});
