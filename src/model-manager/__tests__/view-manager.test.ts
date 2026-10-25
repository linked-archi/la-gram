import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { OxigraphViewManager } from '../view-manager.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode } = DataFactory;

const RDF_TYPE = NAMESPACES.rdf + 'type';
const ARCH = NAMESPACES.arch;
const VIS = NAMESPACES['arch-vis'];

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

function objects(store: OxigraphRdfStore, s: string, p: string): string[] {
  return store.getQuads(nn(s), nn(p)).map((q) => q.object.value);
}

describe('OxigraphViewManager', () => {
  let store: OxigraphRdfStore;
  let views: OxigraphViewManager;
  let elements: OxigraphElementManager;
  let rels: OxigraphRelationshipManager;
  const modelIri = 'https://example.org/model';
  const typeIri = 'https://example.org/lang#Component';

  beforeEach(() => {
    store = new OxigraphRdfStore();
    views = new OxigraphViewManager(store);
    elements = new OxigraphElementManager(store);
    rels = new OxigraphRelationshipManager(store);
  });

  describe('views', () => {
    it('creates an arch:View of the requested kind, in the model, with a label and viewpoint', () => {
      const view = views.createView('Diagram', 'https://example.org/vp#Layered', {
        modelIri,
        label: 'Layered',
      });
      expect(view.value).toMatch(/^https:\/\/example\.org\/view-[0-9a-f-]{36}$/);
      expect(objects(store, view.value, RDF_TYPE).sort()).toEqual([ARCH + 'Diagram', ARCH + 'View'].sort());
      expect(objects(store, view.value, ARCH + 'inModel')).toEqual([modelIri]);
      expect(objects(store, view.value, ARCH + 'viewConformsToViewpoint')).toEqual([
        'https://example.org/vp#Layered',
      ]);
      expect(views.getView(view.value)).toEqual({
        iri: view.value,
        label: 'Layered',
        type: 'Diagram',
        viewpointIri: 'https://example.org/vp#Layered',
        modelIri,
      });
    });

    it('lists every view, typed, sorted by label', () => {
      views.createView('Matrix', undefined, { label: 'B', modelIri });
      views.createView('Catalog', undefined, { label: 'A', modelIri });
      expect(views.getViews().map((v) => [v.label, v.type])).toEqual([
        ['A', 'Catalog'],
        ['B', 'Matrix'],
      ]);
    });

    it('renames and re-points a view', () => {
      const v = views.createView('Diagram', undefined, { label: 'Old', modelIri }).value;
      views.renameView(v, 'New');
      views.setViewpoint(v, 'https://example.org/vp#X');
      expect(views.getView(v)).toMatchObject({ label: 'New', viewpointIri: 'https://example.org/vp#X' });
      views.setViewpoint(v, undefined);
      expect(views.getView(v)?.viewpointIri).toBeUndefined();
    });

    it('deletes a view with its geometry, but never the concepts it showed', () => {
      const a = elements.createElement(typeIri, modelIri);
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      views.addElementToView(v, a.value);
      views.deleteView(v);
      expect(views.getView(v)).toBeUndefined();
      expect(store.getQuads(null, nn(VIS + 'view'))).toHaveLength(0);
      expect(store.getQuads(a, nn(ARCH + 'inView'))).toHaveLength(0);
      expect(objects(store, a.value, RDF_TYPE)).toEqual([typeIri]);
    });

    it('duplicates a view with its placements and links', () => {
      const a = elements.createElement(typeIri, modelIri);
      const b = elements.createElement(typeIri, modelIri);
      const v = views.createView('Diagram', undefined, { label: 'Main', modelIri }).value;
      views.addElementToView(v, a.value, { x: 1, y: 2, width: 3, height: 4 });
      views.addElementToView(v, b.value);
      const rel = rels.createQualifiedRelationship({ typeIri: ARCH + 'rel', sourceIri: a.value, targetIri: b.value });
      views.addRelationshipToView(v, rel.iri);

      const copy = views.duplicateView(v).value;

      expect(views.getView(copy)?.label).toBe('Main (copy)');
      expect(views.getNode(copy, a.value)?.bounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
      expect(views.getLinks(copy).map((l) => l.relationshipIri)).toEqual([rel.iri]);
      // Still one element resource.
      expect(objects(store, a.value, RDF_TYPE)).toEqual([typeIri]);
    });
  });

  describe('nodes', () => {
    it('places an element as an arch-vis:ArchNode with bounds, and records arch:inView', () => {
      const a = elements.createElement(typeIri, modelIri);
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      const nodeIri = views.addElementToView(v, a.value, { x: 10, y: 20, width: 130, height: 60 });

      expect(nodeIri).toMatch(/^https:\/\/example\.org\/node-[0-9a-f-]{36}$/);
      expect(objects(store, nodeIri, RDF_TYPE)).toEqual([VIS + 'ArchNode']);
      expect(objects(store, nodeIri, VIS + 'view')).toEqual([v]);
      expect(objects(store, nodeIri, VIS + 'archElement')).toEqual([a.value]);
      expect(objects(store, a.value, ARCH + 'inView')).toEqual([v]);
      expect(views.getNodes(v)).toEqual([
        { nodeIri, elementIri: a.value, bounds: { x: 10, y: 20, width: 130, height: 60 } },
      ]);
    });

    it('nests a node inside another (arch-vis:inNode), un-nests it, and un-nests what a removed node held', () => {
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      const [outer, inner] = [elements.createElement(typeIri, modelIri).value, elements.createElement(typeIri, modelIri).value];
      const outerNode = views.addElementToView(v, outer, { x: 0, y: 0, width: 300, height: 200 });
      const innerNode = views.addElementToView(v, inner, { x: 20, y: 40, width: 120, height: 55 });

      views.setNodeParent(v, inner, outer);
      expect(objects(store, innerNode, VIS + 'inNode')).toEqual([outerNode]);
      expect(views.getNode(v, inner)?.parentElementIri).toBe(outer);
      views.setNodeParent(v, inner, inner); // never inside itself
      expect(objects(store, innerNode, VIS + 'inNode')).toEqual([]);

      views.setNodeParent(v, inner, outer);
      views.removeElementFromView(v, outer);
      expect(objects(store, innerNode, VIS + 'inNode')).toEqual([]);
      expect(views.getNode(v, inner)?.bounds).toEqual({ x: 20, y: 40, width: 120, height: 55 });
    });

    it('a duplicated view keeps its nesting, between its own nodes', () => {
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      const [outer, inner] = [elements.createElement(typeIri, modelIri).value, elements.createElement(typeIri, modelIri).value];
      views.addElementToView(v, outer, { x: 0, y: 0, width: 300, height: 200 });
      views.addElementToView(v, inner, { x: 20, y: 40, width: 120, height: 55 });
      views.setNodeParent(v, inner, outer);

      const copy = views.duplicateView(v).value;
      const copied = views.getNode(copy, inner)!;
      expect(copied.parentElementIri).toBe(outer);
      expect(objects(store, copied.nodeIri, VIS + 'inNode')).toEqual([views.getNode(copy, outer)!.nodeIri]);
    });

    it('keeps one node per element per view, and one element resource across views', () => {
      const a = elements.createElement(typeIri, modelIri);
      const v1 = views.createView('Diagram', undefined, { modelIri }).value;
      const v2 = views.createView('Diagram', undefined, { modelIri }).value;
      const n1 = views.addElementToView(v1, a.value);
      expect(views.addElementToView(v1, a.value)).toBe(n1);
      views.addElementToView(v2, a.value);
      expect(views.getNodes(v1)).toHaveLength(1);
      expect(views.viewsContaining(a.value)).toEqual([v1, v2].sort());
      expect(objects(store, a.value, RDF_TYPE)).toEqual([typeIri]);
    });

    it('moves a node: exactly one value per bounds property afterwards', () => {
      const a = elements.createElement(typeIri, modelIri);
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      const nodeIri = views.addElementToView(v, a.value);
      views.updateNodeBounds(v, a.value, { x: 5, y: 6, width: 7, height: 8 });
      expect(store.getQuads(nn(nodeIri), nn(VIS + 'bounds-x'))).toHaveLength(1);
      expect(views.getNode(v, a.value)?.bounds).toEqual({ x: 5, y: 6, width: 7, height: 8 });
    });

    it('removes from a view only: node, its links, inView — the element stays in the model', () => {
      const a = elements.createElement(typeIri, modelIri);
      const b = elements.createElement(typeIri, modelIri);
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      const other = views.createView('Diagram', undefined, { modelIri }).value;
      views.addElementToView(v, a.value);
      views.addElementToView(v, b.value);
      views.addElementToView(other, a.value);
      const rel = rels.createQualifiedRelationship({ typeIri: ARCH + 'rel', sourceIri: a.value, targetIri: b.value });
      views.addRelationshipToView(v, rel.iri);

      views.removeElementFromView(v, a.value);

      expect(views.getNode(v, a.value)).toBeUndefined();
      expect(views.getLinks(v)).toEqual([]);
      expect(objects(store, a.value, ARCH + 'inView')).toEqual([other]);
      expect(objects(store, rel.iri, ARCH + 'inView')).toEqual([]);
      // Model untouched: the element and the relationship are still there.
      expect(objects(store, a.value, RDF_TYPE)).toEqual([typeIri]);
      expect(objects(store, rel.iri, ARCH + 'source')).toEqual([a.value]);
      expect(views.getNode(other, a.value)).toBeDefined();
    });

    it('collects exactly what a removal deletes, so the canvas can undo it', () => {
      const a = elements.createElement(typeIri, modelIri);
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      views.addElementToView(v, a.value, { x: 1, y: 1, width: 10, height: 10 });
      const before = store.getQuads().length;
      const snapshot = views.collectNodeQuads(v, a.value);
      views.removeElementFromView(v, a.value);
      expect(store.getQuads().length).toBe(before - snapshot.length);
      store.addQuads(snapshot);
      expect(views.getNode(v, a.value)?.bounds).toEqual({ x: 1, y: 1, width: 10, height: 10 });
    });
  });

  describe('links', () => {
    let a: string;
    let b: string;
    let v: string;
    let relIri: string;

    beforeEach(() => {
      a = elements.createElement(typeIri, modelIri).value;
      b = elements.createElement(typeIri, modelIri).value;
      v = views.createView('Diagram', undefined, { modelIri }).value;
      relIri = rels.createQualifiedRelationship({ typeIri: ARCH + 'rel', sourceIri: a, targetIri: b }).iri;
    });

    it('refuses to draw a relationship whose ends are not both placed', () => {
      views.addElementToView(v, a);
      expect(views.addRelationshipToView(v, relIri)).toBeUndefined();
      expect(views.getLinks(v)).toEqual([]);
    });

    it('draws it as an arch-vis:Link between the two nodes, with a route', () => {
      const na = views.addElementToView(v, a);
      const nb = views.addElementToView(v, b);
      const linkIri = views.addRelationshipToView(v, relIri, [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ]) as string;

      expect(objects(store, linkIri, RDF_TYPE)).toEqual([VIS + 'Link']);
      expect(objects(store, linkIri, VIS + 'archRelationship')).toEqual([relIri]);
      expect(objects(store, relIri, ARCH + 'inView')).toEqual([v]);
      expect(views.getLinks(v)).toEqual([
        {
          linkIri,
          relationshipIri: relIri,
          sourceNodeIri: na,
          targetNodeIri: nb,
          sourceElementIri: a,
          targetElementIri: b,
          waypoints: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
          ],
        },
      ]);
      // The route uses IRI-named cells, never blank nodes (they do not survive sync).
      expect(store.getQuads().some((q) => q.subject.termType === 'BlankNode')).toBe(false);
    });

    it('reads a route another tool wrote with blank-node list cells and points, and replaces it', () => {
      const { blankNode, literal, quad } = DataFactory;
      const na = views.addElementToView(v, a);
      const nb = views.addElementToView(v, b);
      const linkIri = views.addRelationshipToView(v, relIri) as string;
      const d = (n: number) => literal(String(n), namedNode('http://www.w3.org/2001/XMLSchema#double'));
      const [c0, c1, p0, p1] = [blankNode('c0'), blankNode('c1'), blankNode('p0'), blankNode('p1')];
      const RDFNS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
      store.addQuads([
        quad(namedNode(linkIri), namedNode(VIS + 'points'), c0),
        quad(c0, namedNode(RDFNS + 'first'), p0),
        quad(c0, namedNode(RDFNS + 'rest'), c1),
        quad(c1, namedNode(RDFNS + 'first'), p1),
        quad(c1, namedNode(RDFNS + 'rest'), namedNode(RDFNS + 'nil')),
        quad(p0, namedNode(VIS + 'point-x'), d(10)),
        quad(p0, namedNode(VIS + 'point-y'), d(20)),
        quad(p1, namedNode(VIS + 'point-x'), d(30)),
        quad(p1, namedNode(VIS + 'point-y'), d(40)),
      ] as never);
      expect(views.getLinks(v)[0]).toMatchObject({ sourceNodeIri: na, targetNodeIri: nb, waypoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }] });
      views.updateLinkWaypoints(v, relIri, [{ x: 1, y: 1 }]);
      expect(views.getLinks(v)[0].waypoints).toEqual([{ x: 1, y: 1 }]);
      expect(store.getQuads().some((q) => q.subject.termType === 'BlankNode')).toBe(false);
    });

    it('re-routes a link, replacing the whole point list', () => {
      views.addElementToView(v, a);
      views.addElementToView(v, b);
      views.addRelationshipToView(v, relIri, [{ x: 0, y: 0 }, { x: 9, y: 9 }]);
      views.updateLinkWaypoints(v, relIri, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
      expect(views.getLinks(v)[0].waypoints).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
      expect(store.getQuads(null, nn(VIS + 'point-x'))).toHaveLength(3);
    });

    it('removes a link from the view but keeps the relationship in the model', () => {
      views.addElementToView(v, a);
      views.addElementToView(v, b);
      views.addRelationshipToView(v, relIri, [{ x: 0, y: 0 }, { x: 9, y: 9 }]);
      views.removeRelationshipFromView(v, relIri);
      expect(views.getLinks(v)).toEqual([]);
      expect(store.getQuads(null, nn(VIS + 'point-x'))).toHaveLength(0);
      expect(objects(store, relIri, ARCH + 'source')).toEqual([a]);
    });
  });
});

describe('a view read once, over a store that tells of its writes (Task 22)', () => {
  const AM4 = 'https://meta.linked.archi/archimate4/onto#';

  async function setup() {
    const { ObservableRdfStore } = await import('../../rdf-engine/observable-store.js');
    const store = new ObservableRdfStore(new OxigraphRdfStore());
    const views = new OxigraphViewManager(store);
    const elements = new OxigraphElementManager(store);
    const model = 'https://example.org/m/model';
    const view = views.createView('Diagram', undefined, { label: 'V', modelIri: model }).value;
    const a = elements.createElement(AM4 + 'BusinessActor', model, { label: 'A' }).value;
    const b = elements.createElement(AM4 + 'Role', model, { label: 'B' }).value;
    views.addElementToView(view, a, { x: 0, y: 0, width: 100, height: 50 });
    return { store, views, elements, view, a, b };
  }

  it('is read again when its geometry changes — inside a batch too, and whoever writes', async () => {
    const { store, views, view, a, b } = await setup();
    expect(views.getNodes(view).map((n) => n.elementIri)).toEqual([a]);
    views.addElementToView(view, b, { x: 200, y: 0, width: 100, height: 50 });
    expect(views.getNodes(view).map((n) => n.elementIri).sort()).toEqual([a, b].sort());
    store.batch(() => {
      views.updateNodeBounds(view, a, { x: 5, y: 6, width: 100, height: 50 });
      expect(views.getNodes(view).find((n) => n.elementIri === a)?.bounds.x).toBe(5);
    });
    const { added, removed } = store.record(() => views.removeElementFromView(view, b));
    expect(views.getNodes(view).map((n) => n.elementIri)).toEqual([a]);
    store.applyDiff({ added, removed }, true); // undo, as the canvas does
    expect(views.getNodes(view).map((n) => n.elementIri).sort()).toEqual([a, b].sort());
  });

  it('is not read again for a change that is not its geometry; what is returned can be changed by the caller', async () => {
    const { views, elements, view, a } = await setup();
    const first = views.getNodes(view);
    elements.updateProperty(a, 'http://www.w3.org/2004/02/skos/core#prefLabel', DataFactory.literal('Renamed', 'en') as never);
    const again = views.getNodes(view);
    expect(again[0]).toBe(first[0]);
    again.pop();
    expect(views.getNodes(view)).toHaveLength(1);
  });
});
