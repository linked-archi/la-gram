/**
 * Automatic layout (ELK task, R1–R8): the ELK graph, its result, the service's fallbacks, the grid, and a
 * view laid out and written back.
 */
import { describe, it, expect, vi } from 'vitest';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../rdf-engine/observable-store.js';
import { OxigraphElementManager } from '../../model-manager/element-manager.js';
import { OxigraphRelationshipManager } from '../../model-manager/relationship-manager.js';
import { OxigraphViewManager } from '../../model-manager/view-manager.js';
import { snapshotOf } from '../../model-manager/version-history.js';
import type { Bounds } from '../../model-manager/interfaces.js';
import { toElkGraph, laidOutEdges, MODEL_ORDER_MAX_NODES, THOROUGH_MAX_NODES } from '../elk-graph.js';
import { fromElkGraph } from '../elk-result.js';
import { gridLayout } from '../grid-layout.js';
import { layout } from '../layout-service.js';
import type { LayoutEngine } from '../elk-engine.js';
import { bundledEngine } from '../elk-node-engine.js';
import { applyViewLayout, viewLayoutInput, type ViewLayoutContext } from '../view-layout.js';
import { DEFAULT_LAYOUT_OPTIONS, type LayoutInput, type LayoutOptions } from '../layout-types.js';

const options = (over: Partial<LayoutOptions> = {}): LayoutOptions => ({ ...DEFAULT_LAYOUT_OPTIONS, ...over });
const overlap = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (child: Bounds, parent: Bounds, top = 0) =>
  child.x >= parent.x && child.y >= parent.y + top && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height;

/** Six boxes in a chain, two of them inside a third. */
const input: LayoutInput = {
  nodes: [
    { id: 'f', width: 120, height: 55, key: 'f' },
    { id: 'a', width: 120, height: 55, key: 'a' },
    { id: 'p', width: 120, height: 55, key: 'p', padding: { top: 46, right: 12, bottom: 12, left: 12 } },
    { id: 'c1', width: 100, height: 40, parent: 'p', key: 'c1' },
    { id: 'c2', width: 100, height: 40, parent: 'p', key: 'c2' },
    { id: 'b', width: 160, height: 70, key: 'b' },
  ],
  edges: [
    { id: 'e3', source: 'c1', target: 'c2' },
    { id: 'e1', source: 'a', target: 'c1' },
    { id: 'e2', source: 'c2', target: 'b' },
    { id: 'e4', source: 'a', target: 'f', kind: 'association' },
    { id: 'nest', source: 'p', target: 'c1' },
    { id: 'dangling', source: 'a', target: 'nowhere' },
  ],
};

describe('the ELK graph', () => {
  it('nests nodes under their parents, in the order of their keys, padding only what holds others', () => {
    const graph = toElkGraph(input, options());
    expect(graph.children!.map((n) => n.id)).toEqual(['a', 'b', 'f', 'p']);
    const p = graph.children!.find((n) => n.id === 'p')!;
    expect(p.children!.map((n) => n.id)).toEqual(['c1', 'c2']);
    expect(p.layoutOptions!['elk.padding']).toBe('[top=46,left=12,bottom=12,right=12]');
    expect(graph.children!.find((n) => n.id === 'a')!.layoutOptions).toBeUndefined();
  });

  it('routes edges between laid-out nodes by IRI — not one inside the other, not to a node not laid out; an association does not lead', () => {
    expect(laidOutEdges(input).map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    const graph = toElkGraph(input, options());
    expect(graph.edges!.find((e) => e.id === 'e4')!.layoutOptions).toEqual({ 'elk.layered.priority.direction': '0' });
  });

  it('asks for the direction, spacing, a fixed seed and root-relative coordinates; bands only when asked and given', () => {
    const graph = toElkGraph(input, options({ direction: 'RIGHT', spacing: 'roomy' }));
    expect(graph.layoutOptions).toMatchObject({
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '80',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      'elk.randomSeed': '1',
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT',
    });
    expect(graph.layoutOptions!['elk.partitioning.activate']).toBeUndefined();
    const banded = { ...input, nodes: input.nodes.map((n, i) => ({ ...n, band: i % 2 })) };
    expect(toElkGraph(banded, options({ bands: true })).layoutOptions!['elk.partitioning.activate']).toBe('true');
    expect(toElkGraph(banded, options({ bands: false })).layoutOptions!['elk.partitioning.activate']).toBeUndefined();
  });

  it("spends ELK's effort by the diagram's size: the given order kept up to 150 elements, banded layers by longest path above, less crossing effort above 500 (R13)", () => {
    const nodes = (n: number, band?: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `n${String(i).padStart(4, '0')}`, width: 120, height: 55, ...(band !== undefined ? { band: i % band } : {}) }));
    const opts = (n: number, bands: boolean) => toElkGraph({ nodes: nodes(n, bands ? 3 : undefined), edges: [] }, options({ bands })).layoutOptions!;
    const order = 'elk.layered.considerModelOrder.strategy';
    const layering = 'elk.layered.layering.strategy';
    const thoroughness = 'elk.layered.thoroughness';
    expect(opts(MODEL_ORDER_MAX_NODES, true)).toMatchObject({ [order]: 'NODES_AND_EDGES' });
    expect(opts(MODEL_ORDER_MAX_NODES, true)[layering]).toBeUndefined();
    const larger = opts(MODEL_ORDER_MAX_NODES + 1, true);
    expect(larger[order]).toBeUndefined();
    expect(larger[layering]).toBe('LONGEST_PATH');
    expect(larger[thoroughness]).toBeUndefined();
    // Without bands, network simplex — ELK's default — is quick enough.
    expect(opts(MODEL_ORDER_MAX_NODES + 1, false)[layering]).toBeUndefined();
    expect(opts(THOROUGH_MAX_NODES, true)[thoroughness]).toBeUndefined();
    expect(opts(THOROUGH_MAX_NODES + 1, true)[thoroughness]).toBe('1');
  });
});

describe("ELK's result", () => {
  it('top-left bounds and routes with their ends, rounded, the drawing moved to the origin', () => {
    const result = fromElkGraph(
      {
        id: 'root',
        children: [{ id: 'a', x: 12.4, y: 12, width: 120, height: 55, children: [{ id: 'c', x: 24.6, y: 52, width: 60, height: 20 }] }],
        edges: [{ id: 'e', sources: ['a'], targets: ['c'], sections: [{ id: 's', startPoint: { x: 72, y: 67 }, bendPoints: [{ x: 72.5, y: 80 }], endPoint: { x: 90, y: 80 } }] }],
      },
      { x: 100, y: 200 },
    );
    expect(result.bounds.get('a')).toEqual({ x: 100, y: 200, width: 120, height: 55 });
    expect(result.bounds.get('c')).toEqual({ x: 112, y: 240, width: 60, height: 20 });
    expect(result.routes.get('e')).toEqual([
      { x: 160, y: 255 },
      { x: 160, y: 268 },
      { x: 178, y: 268 },
    ]);
  });
});

describe('the layout, with ELK', () => {
  it('places the nested inside their parent below its padding, no two at one level overlapping, every edge routed', async () => {
    const result = await layout(input, options(), bundledEngine);
    expect(result.engine).toBe('elk');
    const b = (id: string) => result.bounds.get(id)!;
    expect(inside(b('c1'), b('p'), 46)).toBe(true);
    expect(inside(b('c2'), b('p'), 46)).toBe(true);
    const top = ['a', 'b', 'f', 'p'];
    for (const x of top) for (const y of top) if (x < y) expect(overlap(b(x), b(y)), `${x} ${y}`).toBe(false);
    expect(overlap(b('c1'), b('c2'))).toBe(false);
    expect([...result.routes.keys()].sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(Math.min(...top.map((id) => b(id).x))).toBe(DEFAULT_LAYOUT_OPTIONS.origin.x);
    expect(Math.min(...top.map((id) => b(id).y))).toBe(DEFAULT_LAYOUT_OPTIONS.origin.y);
  });

  it('gives the same result for the same input (R6)', async () => {
    const one = await layout(input, options(), bundledEngine);
    const two = await layout({ nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }, options(), bundledEngine);
    expect([...two.bounds].sort()).toEqual([...one.bounds].sort());
    expect([...two.routes].sort()).toEqual([...one.routes].sort());
  });

  it('keeps bands in order, down the page (R4)', async () => {
    const banded: LayoutInput = {
      nodes: [
        { id: 'tech', width: 120, height: 55, band: 2 },
        { id: 'biz', width: 120, height: 55, band: 0 },
        { id: 'app', width: 120, height: 55, band: 1 },
      ],
      edges: [
        { id: 'r1', source: 'tech', target: 'app' },
        { id: 'r2', source: 'app', target: 'biz' },
      ],
    };
    const result = await layout(banded, options({ bands: true }), bundledEngine);
    const y = (id: string) => result.bounds.get(id)!.y;
    expect(y('biz')).toBeLessThan(y('app'));
    expect(y('app')).toBeLessThan(y('tech'));
  });

  it('lays out a large banded diagram the faster way — bands in order, nothing over anything, every edge routed (R4, R13)', async () => {
    const count = THOROUGH_MAX_NODES + 20;
    const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${String(i).padStart(4, '0')}`, width: 120, height: 55, band: i % 4 }));
    // Each to two others a fixed stride away: a graph as tangled as the benchmark's, the same every run.
    const edges = nodes.flatMap((n, i) => [7, 31].map((stride) => ({ id: `e${i}-${stride}`, source: n.id, target: nodes[(i + stride) % count].id })));
    const result = await layout({ nodes, edges }, options({ bands: true }), bundledEngine);
    expect(result.engine).toBe('elk');
    const boxes = nodes.map((n) => ({ band: n.band, ...result.bounds.get(n.id)! }));
    const byY = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 1; i < byY.length; i++) expect(byY[i].band).toBeGreaterThanOrEqual(byY[i - 1].band);
    const rows = new Map<number, typeof boxes>();
    for (const b of boxes) rows.set(b.y, [...(rows.get(b.y) ?? []), b]);
    for (const row of rows.values())
      for (let i = 0; i < row.length; i++) for (let j = i + 1; j < row.length; j++) expect(overlap(row[i], row[j])).toBe(false);
    expect(result.routes.size).toBe(edges.length);
  }, 60_000);
});

describe('the grid instead (R8)', () => {
  it('when ELK fails, takes too long — stopped — or there are too many nodes, unless forced', async () => {
    const failing: LayoutEngine = { layout: () => Promise.reject(new Error('no')) };
    expect(await layout(input, options(), failing)).toMatchObject({ engine: 'grid', reason: 'failed' });
    const stop = vi.fn();
    const hanging: LayoutEngine = { layout: () => new Promise(() => {}), stop };
    expect(await layout(input, options({ timeoutMs: 20 }), hanging)).toMatchObject({ engine: 'grid', reason: 'timed-out' });
    expect(stop).toHaveBeenCalled();
    expect(await layout(input, options({ maxNodes: 3 }), bundledEngine)).toMatchObject({ engine: 'grid', reason: 'too-many' });
    expect((await layout(input, options({ maxNodes: 3, force: true }), bundledEngine)).engine).toBe('elk');
  });

  it('places the top level in rows, what is nested inside its parent, the parent grown to hold it; routes straight', () => {
    const result = gridLayout(input, { origin: { x: 40, y: 40 } });
    const b = (id: string) => result.bounds.get(id)!;
    expect(inside(b('c1'), b('p'), 46)).toBe(true);
    expect(inside(b('c2'), b('p'), 46)).toBe(true);
    expect(b('p').width).toBeGreaterThan(120);
    expect(overlap(b('a'), b('p'))).toBe(false);
    expect(result.routes.size).toBe(0);
  });
});

describe('a view, laid out and written back', () => {
  it('each placement and line by its own IRI, a line on a line made straight, one change undone exactly', async () => {
    const MODEL = 'https://model.example.com/m/model';
    const AM4 = 'https://meta.linked.archi/archimate4/onto#';
    const store = new ObservableRdfStore(new OxigraphRdfStore());
    const elements = new OxigraphElementManager(store);
    const relationships = new OxigraphRelationshipManager(store);
    const views = new OxigraphViewManager(store);
    const view = views.createView('Diagram', undefined, { modelIri: MODEL }).value;
    const make = (label: string, x: number) => {
      const iri = elements.createElement(`${AM4}ApplicationComponent`, MODEL, { label }).value;
      views.addElementToView(view, iri, { x, y: 100, width: 120, height: 55 });
      return iri;
    };
    const [a, b, c] = [make('A', 100), make('B', 120), make('C', 140)];
    const relate = (type: string, predicate: string, s: string, t: string) =>
      relationships.createQualifiedRelationship({ typeIri: AM4 + type, predicateIri: AM4 + predicate, sourceIri: s, targetIri: t, modelIri: MODEL }).iri;
    const ab = relate('Serving', 'serves', a, b);
    const bc = relate('Serving', 'serves', b, c);
    views.addRelationshipToView(view, ab, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
    views.addRelationshipToView(view, bc);
    const onLine = relate('Association', 'associatedWith', c, ab);
    const abLink = views.getLinks(view).find((l) => l.relationshipIri === ab)!.linkIri;
    const cNode = views.getNodes(view).find((n) => n.elementIri === c)!.nodeIri;
    views.addRelationshipToView(view, onLine, [{ x: 9, y: 9 }, { x: 8, y: 8 }, { x: 7, y: 7 }], { sourceNodeIri: cNode, targetNodeIri: abLink });

    const context: ViewLayoutContext = {
      views,
      typeOf: () => `${AM4}ApplicationComponent`,
      labelOf: (iri) => ({ [a]: 'A', [b]: 'B', [c]: 'C' })[iri] ?? '',
      isAssociation: (iri) => iri === onLine,
      nameBand: 34,
    };
    const { input: fromView, origin } = viewLayoutInput(context, view);
    expect(fromView.nodes).toHaveLength(3);
    expect(fromView.edges.map((e) => e.id).sort()).toEqual([abLink, views.getLinks(view).find((l) => l.relationshipIri === bc)!.linkIri].sort());
    expect(origin).toEqual({ x: 100, y: 100 });

    const result = await layout(fromView, options({ origin }), bundledEngine);
    const before = snapshotOf(store.getQuads());
    const { added, removed } = store.record(() => applyViewLayout(views, view, result));
    const nodes = views.getNodes(view);
    for (const p of nodes) for (const q of nodes) if (p.nodeIri < q.nodeIri) expect(overlap(p.bounds, q.bounds)).toBe(false);
    expect(views.getLinks(view).find((l) => l.relationshipIri === ab)!.waypoints).toEqual(result.routes.get(abLink));
    expect(views.getLinks(view).find((l) => l.relationshipIri === onLine)!.waypoints).toEqual([]);
    store.applyDiff({ added, removed }, true);
    expect(snapshotOf(store.getQuads())).toEqual(before);
  });
});
