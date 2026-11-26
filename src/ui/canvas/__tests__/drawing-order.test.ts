// @vitest-environment jsdom

/**
 * Drawing order on the canvas (`.agents/tasks/drawing-order/`, core-vis 0.10 `arch-vis:zOrder`), against the real
 * managers and the bundled ArchiMate 4.0 metamodel: shapes drawn in the store's order; *Bring to front* and the rest
 * as one undo step; a move keeping the order; a new shape in front of what it overlaps; a collaborator's change
 * followed; the right-click group.
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
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas, type CanvasContextAction } from '../diagram-canvas.js';
import { buildClassClosure } from '../relationship-resolution.js';
import type { ContextMenuAction } from '../rdf-context-menu-provider.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

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

interface Drawn {
  id: string;
  businessObject?: { iri?: string; nodeIri?: string; zOrder?: number; kind?: string };
  children?: Drawn[];
  waypoints?: unknown;
}

/**
 * Three overlapping components, A, B and C, and a note over them — none with a zOrder: drawn in the order of their
 * nodes' IRIs, which are random. `given` sets some first.
 */
function mount(given: Record<string, number> = {}, onContextAction?: (action: CanvasContextAction, iri: string) => void) {
  const store = new ObservableRdfStore(base);
  const elements = new OxigraphElementManager(store);
  const relationships = new OxigraphRelationshipManager(store);
  const views = new OxigraphViewManager(store);
  const session = new ModelSession(store, elements, views);
  const { modelIri, viewIri } = session.newModel({ label: 'Test' });
  const nodes: Record<string, string> = {};
  const iris: Record<string, string> = {};
  for (const [label, x] of [
    ['A', 0],
    ['B', 40],
    ['C', 80],
  ] as const) {
    iris[label] = elements.createElement(COMPONENT, modelIri, { label }).value;
    nodes[label] = views.addElementToView(viewIri, iris[label], { x, y: x / 2, width: 120, height: 55 });
  }
  nodes['Note'] = views.addFigure(viewIri, { kind: 'note', text: 'Note', bounds: { x: 20, y: 10, width: 100, height: 40 } });
  iris['Note'] = nodes['Note'];
  for (const [label, z] of Object.entries(given)) views.setNodeZOrder(viewIri, nodes[label], z);

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
  const root = () => service<{ getRootElement(): Drawn }>('canvas').getRootElement();
  const labelOfNode = Object.fromEntries(Object.entries(nodes).map(([label, node]) => [node, label]));
  /** The shapes at the top level as drawn, the lowest first, by their labels. */
  const drawn = () =>
    (root().children ?? [])
      .filter((c) => !c.waypoints && (c.businessObject?.kind === 'element' || c.businessObject?.kind === 'figure'))
      .map((c) => labelOfNode[c.businessObject?.nodeIri ?? c.businessObject?.iri ?? ''] ?? c.businessObject?.iri);
  /** The graphics, in the SVG's order: what is drawn above what on screen. */
  const painted = () =>
    [...container.querySelectorAll<SVGElement>('.djs-element.djs-shape')]
      .map((g) => g.getAttribute('data-element-id'))
      .map((id) => {
        const shape = service<{ get(id: string): Drawn }>('elementRegistry').get(id!);
        return labelOfNode[shape?.businessObject?.nodeIri ?? shape?.businessObject?.iri ?? ''];
      })
      .filter(Boolean);
  const zOrders = () => Object.fromEntries(Object.entries(nodes).map(([label, node]) => [label, views.getNodes(viewIri).find((n) => n.nodeIri === node)?.zOrder]));
  return {
    canvas,
    views,
    viewIri,
    nodes,
    iris,
    drawn,
    painted,
    zOrders,
    service,
    commandStack: service<{ undo(): void; redo(): void; canUndo(): boolean }>('commandStack'),
    select: (...labels: string[]) => canvas.selectIris(labels.map((l) => iris[l])),
    menuOn: (label: string) =>
      (canvas as unknown as { contextMenuActions(target: unknown): ContextMenuAction[] }).contextMenuActions(
        service<{ get(id: string): unknown }>('elementRegistry').get(label === 'Note' ? nodes[label] : iris[label]),
      ),
  };
}

describe('drawing order on the canvas', () => {
  it('drawn in the store’s order: zOrder first, then IRI — on the canvas and in the SVG', () => {
    const f = mount({ A: 3, Note: -1, C: 1 });
    expect(f.drawn()).toEqual(['Note', 'B', 'C', 'A']);
    expect(f.painted()).toEqual(['Note', 'B', 'C', 'A']);
  });

  it('Send to back: one undo step; undone, the order is back', () => {
    const f = mount({ A: 1, B: 2, C: 3, Note: 4 });
    f.select('C');
    expect(f.canvas.reorderSelection('back')).toEqual({ selected: 1, changed: 1 });
    expect(f.drawn()).toEqual(['C', 'A', 'B', 'Note']);
    expect(f.painted()).toEqual(['C', 'A', 'B', 'Note']);
    // One less than the lowest beside it, 1: 0, which is written as none.
    expect(f.zOrders().C).toBeUndefined();

    f.commandStack.undo();
    expect(f.drawn()).toEqual(['A', 'B', 'C', 'Note']);
    expect(f.zOrders().C).toBe(3);
    f.commandStack.redo();
    expect(f.drawn()).toEqual(['C', 'A', 'B', 'Note']);
  });

  it('Bring forward past the next it overlaps; Send backward; already in front, nothing', () => {
    const f = mount({ A: 1, B: 2, C: 3, Note: 4 });
    f.select('A');
    f.canvas.reorderSelection('forward');
    expect(f.drawn()).toEqual(['B', 'A', 'C', 'Note']);
    f.select('Note');
    f.canvas.reorderSelection('backward');
    expect(f.drawn()).toEqual(['B', 'A', 'Note', 'C']);
    f.select('C');
    expect(f.canvas.reorderSelection('front')).toEqual({ selected: 1, changed: 0 });
  });

  it('a move keeps a shape’s place in the order: it does not come to the top', () => {
    const f = mount({ A: 1, B: 2, C: 3, Note: 4 });
    const shape = f.service<{ get(id: string): unknown }>('elementRegistry').get(f.iris['A']);
    f.service<{ moveElements(e: unknown[], d: { x: number; y: number }): void }>('modeling').moveElements([shape], { x: 15, y: 5 });
    expect(f.drawn()).toEqual(['A', 'B', 'C', 'Note']);
    expect(f.zOrders().A).toBe(1);
  });

  it('a shape drawn from the palette over others goes in front of them, in the same step', () => {
    const f = mount({ A: 1, B: 2, C: 3, Note: 4 });
    const factory = f.service<{ createShape(a: Record<string, unknown>): Drawn }>('elementFactory');
    const shape = factory.createShape({ width: 120, height: 55, businessObject: { iri: '', typeIri: COMPONENT, label: 'D', kind: 'element' } });
    const root = f.service<{ getRootElement(): unknown }>('canvas').getRootElement();
    f.service<{ createShape(s: unknown, p: unknown, parent: unknown): unknown }>('modeling').createShape(shape, { x: 70, y: 40 }, root);
    const node = f.views.getNodes(f.viewIri).find((n) => n.elementIri === shape.businessObject?.iri)!;
    expect(node.zOrder).toBe(5);
    expect((f.service<{ getRootElement(): Drawn }>('canvas').getRootElement().children ?? []).filter((c) => !c.waypoints).at(-1)).toBe(shape);
    // Far from everything: nothing written.
    const alone = factory.createShape({ width: 120, height: 55, businessObject: { iri: '', typeIri: COMPONENT, label: 'E', kind: 'element' } });
    f.service<{ createShape(s: unknown, p: unknown, parent: unknown): unknown }>('modeling').createShape(alone, { x: 900, y: 900 }, root);
    expect(f.views.getNodes(f.viewIri).find((n) => n.elementIri === alone.businessObject?.iri)?.zOrder).toBeUndefined();
    // Undone in one step: the shape and its order.
    f.commandStack.undo();
    f.commandStack.undo();
    expect(f.views.getNodes(f.viewIri)).toHaveLength(4);
  });

  it('a collaborator’s change of order, read from the store, re-stacks the shapes', () => {
    const f = mount({ A: 1, B: 2, C: 3, Note: 4 });
    f.views.setNodeZOrder(f.viewIri, f.nodes['A'], 9);
    f.canvas.syncFromStore();
    expect(f.drawn()).toEqual(['B', 'C', 'Note', 'A']);
    expect(f.painted()).toEqual(['B', 'C', 'Note', 'A']);
  });

  it('the right-click menu on an element and on a figure: the four, in a group of their own; several selected kept', () => {
    const asked = vi.fn();
    const f = mount({}, asked);
    f.select('A');
    const order = (label: string) => f.menuOn(label).filter((a) => a.section === 'order');
    expect(order('A').map((a) => a.label)).toEqual(['Bring to front', 'Bring forward', 'Send backward', 'Send to back']);
    expect(order('A')[0].shortcut).toMatch(/\]/);
    f.canvas.selectIris([f.nodes['Note']]);
    expect(order('Note').map((a) => a.id)).toEqual(['order-front', 'order-forward', 'order-backward', 'order-back']);
    // Two elements selected: the menu acts on both.
    f.select('A', 'B');
    const several = f.menuOn('A');
    expect(several.filter((a) => a.section === 'order')).toHaveLength(4);
    several.find((a) => a.id === 'order-back')!.run();
    expect(asked).toHaveBeenCalledWith('order-back', f.iris['A']);
    expect(f.canvas.selectedIris().sort()).toEqual([f.iris['A'], f.iris['B']].sort());
  });
});
