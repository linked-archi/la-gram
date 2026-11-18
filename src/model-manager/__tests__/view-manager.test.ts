import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { OxigraphViewManager, addRelationshipsToView } from '../view-manager.js';
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
      expect(view.value).toMatch(/^https:\/\/example\.org\/view\/[0-9a-f-]{36}$/);
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

      // Named in its view's IRI (DD-41).
      expect(nodeIri).toMatch(new RegExp(`^${v}#node/[0-9a-f-]{36}$`));
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

    describe('where its name was moved to (arch-vis:LabelNode)', () => {
      const box = { x: 210, y: 40, width: 90, height: 13 };
      const labelNodes = () => store.getQuads(null, nn(RDF_TYPE), nn(VIS + 'LabelNode')).map((q) => q.subject.value);

      it('is kept as a LabelNode hung on the link, in the view, with its bounds — and read back', () => {
        views.addElementToView(v, a);
        views.addElementToView(v, b);
        const linkIri = views.addRelationshipToView(v, relIri) as string;
        expect(views.getLinks(v)[0].label).toBeUndefined();

        views.setLinkLabel(v, relIri, box);
        const label = `${linkIri}/label`;
        expect(objects(store, linkIri, VIS + 'label')).toEqual([label]);
        expect(objects(store, label, RDF_TYPE)).toEqual([VIS + 'LabelNode']);
        expect(objects(store, label, VIS + 'view')).toEqual([v]);
        expect(objects(store, label, VIS + 'bounds-w')).toEqual(['90']);
        expect(views.getLinks(v)[0].label).toEqual(box);
        // Not a node of the view: it places no element.
        expect(views.getNodes(v).map((n) => n.elementIri).sort()).toEqual([a, b].sort());

        // Moved again: one label node, the new bounds.
        views.setLinkLabel(v, relIri, { ...box, x: 300 });
        expect(labelNodes()).toEqual([label]);
        expect(views.getLinks(v)[0].label?.x).toBe(300);

        // Back to the middle: gone.
        views.setLinkLabel(v, relIri, undefined);
        expect(labelNodes()).toEqual([]);
        expect(objects(store, linkIri, VIS + 'label')).toEqual([]);
        expect(views.getLinks(v)[0].label).toBeUndefined();
      });

      it('goes with its link — removed from the view, its view deleted, the relationship deleted from the model — and is collected for undo', () => {
        views.addElementToView(v, a);
        views.addElementToView(v, b);
        views.addRelationshipToView(v, relIri);
        views.setLinkLabel(v, relIri, box);
        const label = labelNodes()[0];
        expect(views.collectLinkQuads(v, relIri).some((q) => q.subject.value === label)).toBe(true);
        views.removeRelationshipFromView(v, relIri);
        expect(store.getQuads(nn(label))).toHaveLength(0);

        views.addRelationshipToView(v, relIri);
        views.setLinkLabel(v, relIri, box);
        rels.deleteRelationship(relIri);
        expect(labelNodes()).toEqual([]);

        const again = rels.createQualifiedRelationship({ typeIri: ARCH + 'rel', sourceIri: a, targetIri: b }).iri;
        views.addRelationshipToView(v, again);
        views.setLinkLabel(v, again, box);
        views.deleteView(v);
        expect(labelNodes()).toEqual([]);
      });

      it('is copied with its view', () => {
        views.addElementToView(v, a);
        views.addElementToView(v, b);
        views.addRelationshipToView(v, relIri);
        views.setLinkLabel(v, relIri, box);
        const copy = views.duplicateView(v).value;
        expect(views.getLinks(copy)[0].label).toEqual(box);
        expect(labelNodes()).toHaveLength(2);
      });

      it('reads a label node another tool wrote as a blank node, and replaces it', () => {
        const { blankNode, literal, quad } = DataFactory;
        views.addElementToView(v, a);
        views.addElementToView(v, b);
        const linkIri = views.addRelationshipToView(v, relIri) as string;
        const d = (n: number) => literal(String(n), namedNode('http://www.w3.org/2001/XMLSchema#double'));
        const label = blankNode('l0');
        store.addQuads([
          quad(namedNode(linkIri), namedNode(VIS + 'label'), label),
          quad(label, namedNode(RDF_TYPE), namedNode(VIS + 'LabelNode')),
          quad(label, namedNode(VIS + 'bounds-x'), d(5)),
          quad(label, namedNode(VIS + 'bounds-y'), d(6)),
          quad(label, namedNode(VIS + 'bounds-w'), d(70)),
          quad(label, namedNode(VIS + 'bounds-h'), d(12)),
        ] as never);
        expect(views.getLinks(v)[0].label).toEqual({ x: 5, y: 6, width: 70, height: 12 });
        views.setLinkLabel(v, relIri, box);
        expect(views.getLinks(v)[0].label).toEqual(box);
        expect(store.getQuads().some((q) => q.subject.termType === 'BlankNode')).toBe(false);
      });
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

  it('what it shows is kept as its shapes move, and read again when one is added or removed', async () => {
    const { views, view, a, b } = await setup();
    const shown = views.placedIn(view);
    expect([...shown]).toEqual([a]);
    views.updateNodeBounds(view, a, { x: 50, y: 60, width: 100, height: 50 });
    expect(views.placedIn(view)).toBe(shown);
    views.addElementToView(view, b, { x: 200, y: 0, width: 100, height: 50 });
    expect([...views.placedIn(view)].sort()).toEqual([a, b].sort());
    views.removeElementFromView(view, a);
    expect([...views.placedIn(view)]).toEqual([b]);
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

describe('a link ending on a link (core-vis 0.6)', () => {
  // r1: a → b. r2: c → r1, a relationship whose target is a relationship.
  const modelIri = 'https://example.org/model';
  const typeIri = 'https://example.org/lang#Component';
  let store: OxigraphRdfStore;
  let views: OxigraphViewManager;
  let rels: OxigraphRelationshipManager;
  let a: string;
  let b: string;
  let c: string;
  let r1: string;
  let r2: string;
  let v: string;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    views = new OxigraphViewManager(store);
    const elements = new OxigraphElementManager(store);
    rels = new OxigraphRelationshipManager(store);
    [a, b, c] = [0, 1, 2].map(() => elements.createElement(typeIri, modelIri).value);
    r1 = rels.createQualifiedRelationship({ typeIri: ARCH + 'rel', sourceIri: a, targetIri: b }).iri;
    r2 = rels.createQualifiedRelationship({ typeIri: ARCH + 'rel', sourceIri: c, targetIri: r1 }).iri;
    v = views.createView('Diagram', undefined, { modelIri }).value;
    for (const element of [a, b, c]) views.addElementToView(v, element);
  });

  it('is stored with the other link as its arch-vis:target, and read back so', () => {
    const l1 = views.addRelationshipToView(v, r1) as string;
    const l2 = views.addRelationshipToView(v, r2, [{ x: 10, y: 10 }]) as string;
    expect(l2).toBeDefined();
    expect(objects(store, l2, VIS + 'target')).toEqual([l1]);
    expect(views.getLinks(v).find((link) => link.relationshipIri === r2)).toMatchObject({
      linkIri: l2,
      targetNodeIri: l1,
      sourceElementIri: c,
      targetElementIri: r1,
      waypoints: [{ x: 10, y: 10 }],
    });
  });

  it('is not drawn before the link it ends on', () => {
    expect(views.addRelationshipToView(v, r2)).toBeUndefined();
  });

  it('comes after the link it ends on, whatever order the store has them in', () => {
    views.addRelationshipToView(v, r1);
    views.addRelationshipToView(v, r2);
    const fresh = new OxigraphViewManager(store);
    expect(fresh.getLinks(v).map((link) => link.relationshipIri)).toEqual([r1, r2]);
  });

  it('is drawn in passes when added together with what it ends on, in any order', () => {
    expect(addRelationshipsToView(views, v, [r2, r1])).toBe(2);
    expect(views.getLinks(v)).toHaveLength(2);
  });

  it('goes when the link it ends on is removed from the view, or that link’s node', () => {
    views.addRelationshipToView(v, r1);
    views.addRelationshipToView(v, r2);
    views.removeRelationshipFromView(v, r1);
    expect(views.getLinks(v)).toEqual([]);
    expect(objects(store, r2, ARCH + 'inView')).toEqual([]);

    views.addRelationshipToView(v, r1);
    views.addRelationshipToView(v, r2);
    views.removeElementFromView(v, a);
    expect(views.getLinks(v)).toEqual([]);
  });

  it('follows its relationship when that is reattached to an element', () => {
    views.addRelationshipToView(v, r1);
    const l2 = views.addRelationshipToView(v, r2) as string;
    rels.reconnectRelationship(r2, c, b);
    views.refreshLinksOf(r2);
    expect(objects(store, l2, VIS + 'target')).toEqual([views.getNode(v, b)?.nodeIri]);
  });

  it('is copied with its view', () => {
    views.addRelationshipToView(v, r1);
    views.addRelationshipToView(v, r2);
    const copy = views.duplicateView(v).value;
    const links = views.getLinks(copy);
    expect(links.map((link) => link.relationshipIri)).toEqual([r1, r2]);
    expect(links[1].targetNodeIri).toBe(links[0].linkIri);
  });

  it('goes with its relationship when the relationship it ends on is deleted from the model', () => {
    views.addRelationshipToView(v, r1);
    views.addRelationshipToView(v, r2);
    rels.deleteRelationship(r1);
    expect(objects(store, r2, ARCH + 'target')).toEqual([]);
    expect(store.getQuads(null, nn(VIS + 'archRelationship'))).toHaveLength(0);
    expect(views.getLinks(v)).toEqual([]);
  });
});

describe('figures: groups, shapes and notes, standing for no model element', () => {
  const VIS_NS = NAMESPACES['arch-vis'];
  const PREF_LABEL = NAMESPACES.skos + 'prefLabel';
  let store: OxigraphRdfStore;
  let views: OxigraphViewManager;
  let elements: OxigraphElementManager;
  let view: string;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    views = new OxigraphViewManager(store);
    elements = new OxigraphElementManager(store);
    view = views.createView('Diagram', undefined, { modelIri: 'https://example.org/model', label: 'V' }).value;
  });

  it('are drawn as core-vis nodes: a group and a shape as ContainerNodes, a note as a LabelNode; their text is their prefLabel', () => {
    const group = views.addFigure(view, { kind: 'group', text: 'Back office', bounds: { x: 0, y: 0, width: 400, height: 300 } });
    const ellipse = views.addFigure(view, { kind: 'shape', shapeType: VIS_NS + 'Ellipse', bounds: { x: 500, y: 0, width: 120, height: 80 } });
    const note = views.addFigure(view, { kind: 'note', text: 'Ask the CFO', bounds: { x: 700, y: 0, width: 185, height: 80 } });

    expect(objects(store, group, RDF_TYPE)).toEqual([VIS_NS + 'ContainerNode']);
    expect(objects(store, group, PREF_LABEL)).toEqual(['Back office']);
    expect(objects(store, ellipse, RDF_TYPE)).toEqual([VIS_NS + 'ContainerNode']);
    const [style] = objects(store, ellipse, VIS_NS + 'style');
    expect(objects(store, style!, VIS_NS + 'shapeType')).toEqual([VIS_NS + 'Ellipse']);
    expect(objects(store, note, RDF_TYPE)).toEqual([VIS_NS + 'LabelNode']);
    // None stands for an element, or is presented in the view as one.
    for (const figure of [group, ellipse, note]) expect(objects(store, figure, VIS_NS + 'archElement')).toEqual([]);
    expect(views.placedIn(view).size).toBe(0);

    expect(new Map(views.getNodes(view).map((n) => [n.elementIri, n.figure]))).toEqual(
      new Map<string, unknown>([
        [group, { kind: 'group', text: 'Back office' }],
        [ellipse, { kind: 'shape', shapeType: VIS_NS + 'Ellipse' }],
        [note, { kind: 'note', text: 'Ask the CFO' }],
      ]),
    );
  });

  it('are keyed by their node where an element is: moved, nested, holding elements, renamed, removed with their style', () => {
    const group = views.addFigure(view, { kind: 'group', bounds: { x: 0, y: 0, width: 400, height: 300 } });
    const box = views.addFigure(view, { kind: 'shape', shapeType: VIS_NS + 'Rectangle', bounds: { x: 20, y: 40, width: 120, height: 80 }, parentIri: group });
    const element = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'App' }).value;
    views.addElementToView(view, element, { x: 30, y: 150, width: 120, height: 55 });
    views.setNodeParent(view, element, group);
    views.updateNodeBounds(view, box, { x: 25, y: 45, width: 130, height: 90 });
    views.setFigureText(view, box, 'Inbox');

    const nodes = new Map(views.getNodes(view).map((n) => [n.elementIri, n]));
    expect(nodes.get(box)).toMatchObject({ parentElementIri: group, bounds: { x: 25, y: 45, width: 130, height: 90 }, figure: { text: 'Inbox' } });
    expect(nodes.get(element)?.parentElementIri).toBe(group);
    expect(views.getNode(view, box)?.nodeIri).toBe(box);

    const before = store.getQuads(null, null, null).length;
    views.removeElementFromView(view, box);
    expect(store.getQuads(nn(box), null, null)).toEqual([]);
    expect(store.getQuads(nn(`${box}/style`), null, null)).toEqual([]);
    expect(store.getQuads(null, null, null).length).toBeLessThan(before);
    expect(views.getNodes(view).map((n) => n.elementIri).sort()).toEqual([element, group].sort());
  });

  it('a note is a free-standing LabelNode — a relationship’s name kept in a view is not one', () => {
    const note = views.addFigure(view, { kind: 'note', text: 'n', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    store.addQuads([DataFactory.quad(nn('https://example.org/link'), nn(VIS_NS + 'label'), nn(note)) as never]);
    expect(views.getNodes(view)).toEqual([]);
  });

  it('are copied with their view, each a figure of the copy, what was inside one inside its copy', () => {
    const group = views.addFigure(view, { kind: 'group', text: 'G', bounds: { x: 0, y: 0, width: 400, height: 300 } });
    const element = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'App' }).value;
    views.addElementToView(view, element, { x: 30, y: 150, width: 120, height: 55 });
    views.setNodeParent(view, element, group);

    const copy = views.duplicateView(view).value;
    const nodes = views.getNodes(copy);
    const copiedGroup = nodes.find((n) => n.figure)!;
    expect(copiedGroup.elementIri).not.toBe(group);
    expect(copiedGroup.figure).toEqual({ kind: 'group', text: 'G' });
    expect(nodes.find((n) => n.elementIri === element)?.parentElementIri).toBe(copiedGroup.elementIri);
  });
});

describe('an element placed more than once in a view', () => {
  const ARCH_NS = NAMESPACES.arch;
  let store: OxigraphRdfStore;
  let views: OxigraphViewManager;
  let elements: OxigraphElementManager;
  let rels: OxigraphRelationshipManager;
  let view: string;
  let api: string;
  let web: string;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    views = new OxigraphViewManager(store);
    elements = new OxigraphElementManager(store);
    rels = new OxigraphRelationshipManager(store);
    view = views.createView('Diagram', undefined, { modelIri: 'https://example.org/model', label: 'V' }).value;
    api = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'API' }).value;
    web = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'Web' }).value;
  });

  it('is placed again only when asked; each placement is keyed by its node', () => {
    const first = views.addElementToView(view, api, { x: 0, y: 0, width: 120, height: 55 });
    expect(views.addElementToView(view, api, { x: 9, y: 9, width: 1, height: 1 })).toBe(first);
    const second = views.addElementToView(view, api, { x: 400, y: 0, width: 120, height: 55 }, { another: true });
    expect(second).not.toBe(first);
    expect(views.getNodes(view).map((n) => n.elementIri)).toEqual([api, api]);

    views.updateNodeBounds(view, second, { x: 410, y: 20, width: 130, height: 60 });
    expect(views.getNode(view, second)?.bounds).toEqual({ x: 410, y: 20, width: 130, height: 60 });
    expect(views.getNode(view, first)?.bounds).toEqual({ x: 0, y: 0, width: 120, height: 55 });
  });

  it('a placement is nested on its own, and removed on its own: the element leaves the view with its last', () => {
    const first = views.addElementToView(view, api, { x: 0, y: 0, width: 120, height: 55 });
    const second = views.addElementToView(view, api, { x: 400, y: 0, width: 120, height: 55 }, { another: true });
    const container = views.addElementToView(view, web, { x: 380, y: -20, width: 300, height: 200 });
    views.setNodeParent(view, second, container);
    expect(views.getNode(view, second)).toMatchObject({ parentElementIri: web, parentNodeIri: container });
    expect(views.getNode(view, first)?.parentNodeIri).toBeUndefined();

    views.removeElementFromView(view, second);
    expect(views.getNodes(view).filter((n) => n.elementIri === api).map((n) => n.nodeIri)).toEqual([first]);
    expect(objects(store, api, ARCH_NS + 'inView')).toEqual([view]);
    views.removeElementFromView(view, first);
    expect(objects(store, api, ARCH_NS + 'inView')).toEqual([]);
  });

  it('a relationship is drawn between the placements named, else the first ones; a copy keeps them', () => {
    views.addElementToView(view, api, { x: 0, y: 0, width: 120, height: 55 });
    const second = views.addElementToView(view, api, { x: 400, y: 0, width: 120, height: 55 }, { another: true });
    const webNode = views.addElementToView(view, web, { x: 200, y: 200, width: 120, height: 55 });
    const serving = rels.createQualifiedRelationship({ typeIri: 'https://example.org/lang#Serving', sourceIri: api, targetIri: web }).iri;
    views.addRelationshipToView(view, serving, undefined, { sourceNodeIri: second, targetNodeIri: webNode });
    expect(views.getLinks(view).map((l) => [l.sourceNodeIri, l.targetNodeIri])).toEqual([[second, webNode]]);

    const copy = views.duplicateView(view).value;
    const nodes = views.getNodes(copy);
    expect(nodes.filter((n) => n.elementIri === api)).toHaveLength(2);
    const [link] = views.getLinks(copy);
    const copiedSource = nodes.find((n) => n.nodeIri === link!.sourceNodeIri)!;
    expect(copiedSource.bounds).toEqual({ x: 400, y: 0, width: 120, height: 55 });
  });
});

describe('a relationship drawn more than once in a view', () => {
  const ARCH_NS = NAMESPACES.arch;
  let store: OxigraphRdfStore;
  let views: OxigraphViewManager;
  let view: string;
  let serving: string;
  let first: string;
  let second: string;
  let webNode: string;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    views = new OxigraphViewManager(store);
    const elements = new OxigraphElementManager(store);
    const rels = new OxigraphRelationshipManager(store);
    view = views.createView('Diagram', undefined, { modelIri: 'https://example.org/model', label: 'V' }).value;
    const api = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'API' }).value;
    const web = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'Web' }).value;
    first = views.addElementToView(view, api, { x: 0, y: 0, width: 120, height: 55 });
    second = views.addElementToView(view, api, { x: 0, y: 300, width: 120, height: 55 }, { another: true });
    webNode = views.addElementToView(view, web, { x: 400, y: 150, width: 120, height: 55 });
    serving = rels.createQualifiedRelationship({ typeIri: 'https://example.org/lang#Serving', sourceIri: api, targetIri: web }).iri;
  });

  it('is drawn again only when asked, each line a link of its own: routed, named and removed on its own', () => {
    const one = views.addRelationshipToView(view, serving, undefined, { sourceNodeIri: first, targetNodeIri: webNode })!;
    expect(views.addRelationshipToView(view, serving, undefined, { sourceNodeIri: second, targetNodeIri: webNode })).toBe(one);
    const two = views.addRelationshipToView(view, serving, undefined, { sourceNodeIri: second, targetNodeIri: webNode }, { another: true })!;
    expect(two).not.toBe(one);
    expect(views.getLinks(view).map((l) => [l.linkIri, l.sourceNodeIri]).sort()).toEqual([[one, first], [two, second]].sort());

    views.updateLinkWaypoints(view, two, [{ x: 60, y: 327 }, { x: 460, y: 177 }]);
    views.setLinkLabel(view, two, { x: 200, y: 240, width: 40, height: 14 });
    const byLink = new Map(views.getLinks(view).map((l) => [l.linkIri, l]));
    expect(byLink.get(two)?.waypoints).toHaveLength(2);
    expect(byLink.get(one)?.waypoints).toEqual([]);
    expect(byLink.get(two)?.label).toBeDefined();
    expect(byLink.get(one)?.label).toBeUndefined();

    views.removeRelationshipFromView(view, two);
    expect(views.getLinks(view).map((l) => l.linkIri)).toEqual([one]);
    expect(objects(store, serving, ARCH_NS + 'inView')).toEqual([view]);
    views.removeRelationshipFromView(view, one);
    expect(objects(store, serving, ARCH_NS + 'inView')).toEqual([]);
  });

  it('a copy of the view draws it as often, between the copies of its placements', () => {
    views.addRelationshipToView(view, serving, undefined, { sourceNodeIri: first, targetNodeIri: webNode });
    views.addRelationshipToView(view, serving, [{ x: 60, y: 327 }, { x: 460, y: 177 }], { sourceNodeIri: second, targetNodeIri: webNode }, { another: true });
    const copy = views.duplicateView(view).value;
    const nodes = new Map(views.getNodes(copy).map((n) => [n.nodeIri, n]));
    const links = views.getLinks(copy);
    expect(links).toHaveLength(2);
    expect(links.map((l) => nodes.get(l.sourceNodeIri)?.bounds.y).sort((a, b) => a! - b!)).toEqual([0, 300]);
    expect(links.find((l) => nodes.get(l.sourceNodeIri)?.bounds.y === 300)?.waypoints).toHaveLength(2);
  });
});

describe('a figure’s colours', () => {
  const VIS_NS = NAMESPACES['arch-vis'];
  it('are kept on its own style, taken back to the default with null, and copied with its view', () => {
    const store = new OxigraphRdfStore();
    const views = new OxigraphViewManager(store);
    const view = views.createView('Diagram', undefined, { modelIri: 'https://example.org/model', label: 'V' }).value;
    const note = views.addFigure(view, { kind: 'note', text: 'n', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    views.setFigureColours(view, note, { fillColor: '#ffd6e0', fontColor: '#7a0019' });
    expect(views.getNode(view, note)?.figure).toEqual({ kind: 'note', text: 'n', fillColor: '#ffd6e0', fontColor: '#7a0019' });
    expect(objects(store, `${note}/style`, VIS_NS + 'fillColor')).toEqual(['#ffd6e0']);

    views.setFigureColours(view, note, { fontColor: null, lineColor: '#333333' });
    expect(views.getNode(view, note)?.figure).toEqual({ kind: 'note', text: 'n', fillColor: '#ffd6e0', lineColor: '#333333' });

    const copy = views.duplicateView(view).value;
    expect(views.getNodes(copy)[0]?.figure).toMatchObject({ fillColor: '#ffd6e0', lineColor: '#333333' });
    views.removeElementFromView(view, note);
    expect(store.getQuads(nn(`${note}/style`), null, null)).toEqual([]);
  });
});

describe('how a placement or a line looks: its own style (the Appearance tab)', () => {
  const VIS_NS = NAMESPACES['arch-vis'];
  const XSD = NAMESPACES.xsd;
  let store: OxigraphRdfStore;
  let views: OxigraphViewManager;
  let view: string;
  let api: string;
  let first: string;
  let second: string;
  let serving: string;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    views = new OxigraphViewManager(store);
    const elements = new OxigraphElementManager(store);
    const rels = new OxigraphRelationshipManager(store);
    view = views.createView('Diagram', undefined, { modelIri: 'https://example.org/model', label: 'V' }).value;
    api = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'API' }).value;
    const web = elements.createElement('https://example.org/lang#Component', 'https://example.org/model', { label: 'Web' }).value;
    first = views.addElementToView(view, api, { x: 0, y: 0, width: 120, height: 55 });
    second = views.addElementToView(view, api, { x: 0, y: 300, width: 120, height: 55 }, { another: true });
    views.addElementToView(view, web, { x: 400, y: 150, width: 120, height: 55 });
    serving = rels.createQualifiedRelationship({ typeIri: 'https://example.org/lang#Serving', sourceIri: api, targetIri: web }).iri;
  });

  it('a placement’s, on a style of its own: the other placement of its element keeps its notation’s', () => {
    views.setAppearance(view, first, { fillColor: '#ffd6e0', lineWidth: 2, textAlignment: 'left', fontStyle: 'bold', fontName: 'Georgia', fontSize: 9 });
    expect(views.getNode(view, first)?.appearance).toEqual({
      fillColor: '#ffd6e0',
      lineWidth: 2,
      textAlignment: 'left',
      fontStyle: 'bold',
      fontName: 'Georgia',
      fontSize: 9,
    });
    expect(views.getNode(view, second)?.appearance).toBeUndefined();
    expect(objects(store, first, VIS_NS + 'style')).toEqual([`${first}/style`]);
    // As core-vis 0.7 writes them: a member of the enumeration, a typed integer.
    expect(objects(store, `${first}/style`, VIS_NS + 'textAlignment')).toEqual([VIS_NS + 'AlignLeft']);
    expect(store.getQuads(nn(`${first}/style`), nn(VIS_NS + 'lineWidth'))[0]?.object).toMatchObject({ value: '2', datatype: { value: XSD + 'integer' } });
  });

  it('a placement’s figure — the Figure tab’s — as core-vis’s rendering mode', () => {
    views.setAppearance(view, first, { renderingMode: 'IconCentric' });
    expect(objects(store, `${first}/style`, VIS_NS + 'renderingMode')).toEqual([VIS_NS + 'IconCentric']);
    expect(views.getNode(view, first)?.appearance).toEqual({ renderingMode: 'IconCentric' });
  });

  it('a value taken back with null; all of them, and the style goes too', () => {
    views.setAppearance(view, first, { fillColor: '#ffd6e0', lineColor: '#7a0019' });
    views.setAppearance(view, first, { fillColor: null });
    expect(views.getNode(view, first)?.appearance).toEqual({ lineColor: '#7a0019' });
    views.setAppearance(view, first, { lineColor: null });
    expect(views.getNode(view, first)?.appearance).toBeUndefined();
    expect(store.getQuads(nn(`${first}/style`), null, null)).toEqual([]);
    expect(objects(store, first, VIS_NS + 'style')).toEqual([]);
  });

  it('a converter’s blank-node style is read as the placement’s look — its alpha as meant — and copied before a change', () => {
    const blank = DataFactory.blankNode();
    store.addQuads([
      DataFactory.quad(nn(first) as never, namedNode(VIS_NS + 'style'), blank),
      DataFactory.quad(blank, namedNode(VIS_NS + 'fillColor'), DataFactory.literal('rgba(181,201,255,100)')),
      DataFactory.quad(blank, namedNode(VIS_NS + 'fontName'), DataFactory.literal('Segoe UI')),
    ] as never);
    expect(views.getNode(view, first)?.appearance).toEqual({ fillColor: '#b5c9ff', fontName: 'Segoe UI' });
    views.setAppearance(view, first, { textPosition: 'top' });
    expect(views.getNode(view, first)?.appearance).toEqual({ fillColor: '#b5c9ff', fontName: 'Segoe UI', textPosition: 'top' });
    expect(store.getQuads(blank as never, null, null)).toEqual([]);
  });

  it('a line’s, on its link; taken from the view, its style goes with it', () => {
    const link = views.addRelationshipToView(view, serving, [], { sourceNodeIri: first })!;
    views.setAppearance(view, link, { lineColor: '#1a73e8', lineWidth: 3 });
    expect(views.getLinks(view)[0]?.appearance).toEqual({ lineColor: '#1a73e8', lineWidth: 3 });
    views.removeRelationshipFromView(view, link);
    expect(store.getQuads(nn(`${link}/style`), null, null)).toEqual([]);
  });

  it('is copied with its view, placement by placement and line by line; nothing outside the view is written', () => {
    const link = views.addRelationshipToView(view, serving, [], { sourceNodeIri: second })!;
    views.setAppearance(view, second, { fillColor: '#ffd6e0' });
    views.setAppearance(view, link, { lineWidth: 2 });
    views.setAppearance(view, api, { fillColor: '#000000' });
    views.setAppearance('https://example.org/other-view', second, { fillColor: '#000000' });
    const copy = views.duplicateView(view).value;
    const nodes = views.getNodes(copy);
    expect(nodes.map((n) => [n.bounds.y, n.appearance?.fillColor]).sort()).toEqual([
      [0, undefined],
      [150, undefined],
      [300, '#ffd6e0'],
    ]);
    expect(views.getLinks(copy)[0]?.appearance).toEqual({ lineWidth: 2 });
    expect(views.getNode(view, second)?.appearance).toEqual({ fillColor: '#ffd6e0' });
  });

  it('a picture, as an xsd:anyURI, and where; the pictures the model uses, once each', () => {
    views.setAppearance(view, first, { image: 'https://example.org/logo.png', imagePosition: 'BottomRight' });
    views.setAppearance(view, second, { image: 'https://example.org/logo.png' });
    const note = views.addFigure(view, { kind: 'note', text: 'n', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    views.setAppearance(view, note, { image: 'data:image/png;base64,iVBORw0KGgo=', imagePosition: 'Fill' });
    expect(store.getQuads(nn(`${first}/style`), nn(VIS_NS + 'image'))[0]?.object).toMatchObject({
      value: 'https://example.org/logo.png',
      datatype: { value: XSD + 'anyURI' },
    });
    expect(objects(store, `${first}/style`, VIS_NS + 'imagePosition')).toEqual([VIS_NS + 'BottomRight']);
    expect(views.getNode(view, first)?.appearance).toEqual({ image: 'https://example.org/logo.png', imagePosition: 'BottomRight' });
    expect(views.getNode(view, note)?.figure).toMatchObject({ image: 'data:image/png;base64,iVBORw0KGgo=', imagePosition: 'Fill' });
    expect(views.usedImages()).toEqual(['data:image/png;base64,iVBORw0KGgo=', 'https://example.org/logo.png']);
    // A placement's own icon is one of the model's pictures; a notation's glyph — on a style no diagram element hangs — is not.
    views.setAppearance(view, second, { iconSymbol: 'https://example.org/own.png', renderingMode: 'IconCentric' });
    const notationStyle = DataFactory.blankNode();
    store.addQuads([
      DataFactory.quad(notationStyle, nn(VIS_NS + 'iconSymbol') as never, DataFactory.literal('https://meta.linked.archi/archimate4/icons/glyphs/actor.svg', nn(XSD + 'anyURI') as never)),
    ] as never);
    expect(views.usedImages()).toEqual(['data:image/png;base64,iVBORw0KGgo=', 'https://example.org/logo.png', 'https://example.org/own.png']);
    expect(store.getQuads(nn(`${second}/style`), nn(VIS_NS + 'iconSymbol'))[0]?.object).toMatchObject({ datatype: { value: XSD + 'anyURI' } });
    views.setAppearance(view, second, { iconSymbol: null, renderingMode: null });
    // A picture's address that is none is not written — and takes nothing away.
    views.setAppearance(view, second, { image: 'javascript:alert(1)' as never });
    expect(views.getNode(view, second)?.appearance).toEqual({ image: 'https://example.org/logo.png' });
  });

  it('where a line’s text sits; set elsewhere, a name moved by hand is no longer where it was put', () => {
    const link = views.addRelationshipToView(view, serving, [], { sourceNodeIri: first })!;
    const moved = { x: 140, y: 20, width: 40, height: 16 };
    views.setLinkLabel(view, link, moved);
    views.setAppearance(view, link, { lineWidth: 2 });
    expect(views.getLinks(view)[0]?.label).toEqual(moved);
    views.setAppearance(view, link, { labelAnchor: 'target' });
    expect(objects(store, `${link}/style`, VIS_NS + 'labelAnchor')).toEqual([VIS_NS + 'AnchorTarget']);
    expect(views.getLinks(view)[0]).toMatchObject({ appearance: { lineWidth: 2, labelAnchor: 'target' } });
    expect(views.getLinks(view)[0]?.label).toBeUndefined();
    // The same anchor again — a format painter's — leaves a name moved since where it is.
    views.setLinkLabel(view, link, moved);
    views.setAppearance(view, link, { labelAnchor: 'target', lineWidth: null });
    expect(views.getLinks(view)[0]?.label).toEqual(moved);
  });

  it('what a placement’s label says: one expression a presentation context, one for every context — replaced, taken away, copied, gone with it', () => {
    const DEVELOPER = 'https://example.org/contexts#Developer';
    views.setLabelExpression(view, first, undefined, '{name}');
    views.setLabelExpression(view, first, DEVELOPER, '{name}\n«{type}»');
    expect(views.getNode(view, first)?.labelExpressions).toEqual([
      { context: DEVELOPER, expression: '{name}\n«{type}»' },
      { expression: '{name}' },
    ]);
    // As core-vis 0.7 writes it: on the placement's own style, named after it.
    const scoped = objects(store, `${first}/style`, VIS_NS + 'labelExpression').find((iri) => iri !== `${first}/label-expression`)!;
    expect(scoped).toMatch(new RegExp(`^${first}/label-expression/[0-9a-f]{8}$`));
    expect(objects(store, scoped, RDF_TYPE)).toEqual([VIS_NS + 'LabelExpression']);
    expect(objects(store, scoped, NAMESPACES.arch + 'inPresentationContext')).toEqual([DEVELOPER]);
    // Replaced for its set; the other placement of the element says nothing of its own.
    views.setLabelExpression(view, first, DEVELOPER, '{name} ({dcterms:creator})');
    expect(views.getNode(view, first)?.labelExpressions?.[0]).toEqual({ context: DEVELOPER, expression: '{name} ({dcterms:creator})' });
    expect(views.getNode(view, second)?.labelExpressions).toBeUndefined();
    // Copied with its view.
    const copy = views.duplicateView(view).value;
    expect(views.getNodes(copy).find((n) => n.bounds.y === 0)?.labelExpressions).toHaveLength(2);
    // Taken away, both: no style left.
    views.setLabelExpression(view, first, DEVELOPER, null);
    views.setLabelExpression(view, first, undefined, '');
    expect(views.getNode(view, first)?.labelExpressions).toBeUndefined();
    expect(store.getQuads(nn(`${first}/style`), null, null)).toEqual([]);
    expect(store.getQuads(nn(scoped), null, null)).toEqual([]);
    // Gone with the placement.
    views.setLabelExpression(view, second, undefined, '{name}');
    views.removeElementFromView(view, second);
    expect(store.getQuads(nn(`${second}/label-expression`), null, null)).toEqual([]);
  });

  it('a look for one presentation context: a style of its own for it, beside the one for every context — copied, emptied, gone with it', () => {
    const EXECUTIVE = 'https://example.org/contexts#Executive';
    views.setAppearance(view, first, { fillColor: '#b5c9ff' });
    views.setAppearance(view, first, { renderingMode: 'IconCentric', image: 'https://example.org/logo.png' }, EXECUTIVE);
    const node = views.getNode(view, first)!;
    expect(node.appearance).toEqual({ fillColor: '#b5c9ff' });
    expect(node.contextAppearances).toEqual({ [EXECUTIVE]: { renderingMode: 'IconCentric', image: 'https://example.org/logo.png' } });
    // As core-vis 0.7 writes it: a second arch-vis:style, typed, for its context, named after the node.
    const styles = objects(store, first, VIS_NS + 'style');
    expect(styles).toHaveLength(2);
    const forExecutives = styles.find((s) => s !== `${first}/style`)!;
    expect(forExecutives).toMatch(new RegExp(`^${first}/style/[0-9a-f]{8}$`));
    expect(objects(store, forExecutives, NAMESPACES.arch + 'inPresentationContext')).toEqual([EXECUTIVE]);
    expect(objects(store, forExecutives, RDF_TYPE)).toEqual([VIS_NS + 'Style']);
    // The one for every context is written as before — a converter's copied into it, the context's left alone.
    views.setAppearance(view, first, { lineWidth: 2 });
    expect(views.getNode(view, first)?.appearance).toEqual({ fillColor: '#b5c9ff', lineWidth: 2 });
    expect(views.getNode(view, first)?.contextAppearances?.[EXECUTIVE]).toEqual({ renderingMode: 'IconCentric', image: 'https://example.org/logo.png' });
    // Copied with its view.
    const copy = views.duplicateView(view).value;
    expect(views.getNodes(copy).find((n) => n.bounds.y === 0)?.contextAppearances).toEqual({
      [EXECUTIVE]: { renderingMode: 'IconCentric', image: 'https://example.org/logo.png' },
    });
    // Emptied, it goes — its context with it.
    views.setAppearance(view, first, { renderingMode: null, image: null }, EXECUTIVE);
    expect(views.getNode(view, first)?.contextAppearances).toBeUndefined();
    expect(store.getQuads(nn(forExecutives), null, null)).toEqual([]);
    expect(objects(store, first, VIS_NS + 'style')).toEqual([`${first}/style`]);
    // Gone with its placement.
    views.setAppearance(view, second, { image: 'https://example.org/logo.png' }, EXECUTIVE);
    const secondStyle = objects(store, second, VIS_NS + 'style')[0]!;
    views.removeElementFromView(view, second);
    expect(store.getQuads(nn(secondStyle), null, null)).toEqual([]);
  });

  it('a note’s and a line’s look for one presentation context too: read, copied with the view', () => {
    const EXECUTIVE = 'https://example.org/contexts#Executive';
    const note = views.addFigure(view, { kind: 'note', text: 'n', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    views.setAppearance(view, note, { fillColor: '#ffd6e0' }, EXECUTIVE);
    const link = views.addRelationshipToView(view, serving, [], { sourceNodeIri: first })!;
    views.setAppearance(view, link, { lineColor: '#7a0019', lineWidth: 3 }, EXECUTIVE);
    expect(views.getNode(view, note)?.figure).toEqual({ kind: 'note', text: 'n' });
    expect(views.getNode(view, note)?.contextAppearances).toEqual({ [EXECUTIVE]: { fillColor: '#ffd6e0' } });
    expect(views.getLinks(view)[0]?.contextAppearances).toEqual({ [EXECUTIVE]: { lineColor: '#7a0019', lineWidth: 3 } });
    const copy = views.duplicateView(view).value;
    expect(views.getNodes(copy).find((n) => n.figure)?.contextAppearances).toEqual({ [EXECUTIVE]: { fillColor: '#ffd6e0' } });
    expect(views.getLinks(copy)[0]?.contextAppearances).toEqual({ [EXECUTIVE]: { lineColor: '#7a0019', lineWidth: 3 } });
  });

  it('a figure’s, every value of it, copied with its view', () => {
    const note = views.addFigure(view, { kind: 'note', text: 'n', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    views.setAppearance(view, note, { textAlignment: 'center', textPosition: 'middle', borderStyle: 'DashedLine', fontColor: '#7a0019' });
    expect(views.getNode(view, note)?.figure).toEqual({
      kind: 'note',
      text: 'n',
      textAlignment: 'center',
      textPosition: 'middle',
      borderStyle: 'DashedLine',
      fontColor: '#7a0019',
    });
    const copy = views.duplicateView(view).value;
    expect(views.getNodes(copy).find((n) => n.figure)?.figure).toMatchObject({ textAlignment: 'center', borderStyle: 'DashedLine' });
  });
});

describe('a line from a note: a link standing for no relationship', () => {
  const VIS_NS = NAMESPACES['arch-vis'];
  const setup = () => {
    const store = new OxigraphRdfStore();
    const views = new OxigraphViewManager(store);
    const elements = new OxigraphElementManager(store);
    const view = views.createView('Diagram', undefined, { modelIri: 'https://example.org/model', label: 'V' }).value;
    const note = views.addFigure(view, { kind: 'note', text: 'n', bounds: { x: 0, y: 0, width: 185, height: 80 } });
    const app = elements.createElement('https://example.org/am4#ApplicationComponent', 'https://example.org/model', { label: 'App' }).value;
    const db = elements.createElement('https://example.org/am4#ApplicationComponent', 'https://example.org/model', { label: 'DB' }).value;
    const appNode = views.addElementToView(view, app, { x: 300, y: 0, width: 120, height: 55 });
    views.addElementToView(view, db, { x: 300, y: 300, width: 120, height: 55 });
    return { store, views, view, note, app, appNode, db };
  };

  it('is an arch-vis:Link with no archRelationship, its own key; no concept enters the view', () => {
    const { store, views, view, note, app, appNode } = setup();
    const link = views.addConnector(view, { sourceNodeIri: note, targetNodeIri: appNode }, [{ x: 200, y: 30 }])!;
    expect(objects(store, link, RDF_TYPE)).toEqual([VIS_NS + 'Link']);
    expect(objects(store, link, VIS_NS + 'archRelationship')).toEqual([]);
    expect(views.getLinks(view)).toEqual([
      {
        linkIri: link,
        relationshipIri: link,
        connector: true,
        sourceNodeIri: note,
        targetNodeIri: appNode,
        sourceElementIri: note,
        targetElementIri: app,
        waypoints: [{ x: 200, y: 30 }],
      },
    ]);
    expect(views.placedIn(view).has(link)).toBe(false);
    expect(store.getQuads(nn(link), nn(NAMESPACES.arch + 'inView'), null)).toEqual([]);
    // Keyed by its link, as a relationship's line is.
    views.updateLinkWaypoints(view, link, [{ x: 250, y: 30 }]);
    expect(views.getLinks(view)[0]?.waypoints).toEqual([{ x: 250, y: 30 }]);
  });

  it('joins two different nodes of the view — an element names its first placement — or nothing', () => {
    const { views, view, note, app, appNode } = setup();
    expect(views.addConnector(view, { sourceNodeIri: note, targetNodeIri: note })).toBeUndefined();
    expect(views.addConnector(view, { sourceNodeIri: note, targetNodeIri: 'https://example.org/model/nowhere' })).toBeUndefined();
    const other = views.createView('Diagram', undefined, { modelIri: 'https://example.org/model', label: 'W' }).value;
    expect(views.addConnector(other, { sourceNodeIri: note, targetNodeIri: app })).toBeUndefined();
    const link = views.addConnector(view, { sourceNodeIri: app, targetNodeIri: note })!;
    expect(views.getLinks(view)[0]).toMatchObject({ linkIri: link, sourceNodeIri: appNode, targetNodeIri: note });
  });

  it('is re-pointed, removed on its own, and goes with an end', () => {
    const { store, views, view, note, appNode, db } = setup();
    const link = views.addConnector(view, { sourceNodeIri: note, targetNodeIri: appNode })!;
    views.reconnectConnector(view, link, { sourceNodeIri: note, targetNodeIri: db });
    expect(views.getLinks(view)[0]?.targetElementIri).toBe(db);
    views.removeRelationshipFromView(view, link);
    expect(views.getLinks(view)).toEqual([]);
    expect(store.getQuads(nn(link), null, null)).toEqual([]);

    const again = views.addConnector(view, { sourceNodeIri: note, targetNodeIri: appNode }, [{ x: 200, y: 30 }])!;
    views.removeElementFromView(view, note);
    expect(views.getLinks(view)).toEqual([]);
    expect(store.getQuads(nn(again), null, null)).toEqual([]);
    expect(store.getQuads(nn(`${again}/point/0`), null, null)).toEqual([]);
  });

  it('is copied with its view, between the copies of its ends', () => {
    const { views, view, note, app, appNode } = setup();
    views.addConnector(view, { sourceNodeIri: appNode, targetNodeIri: note });
    const copy = views.duplicateView(view).value;
    const copiedNote = views.getNodes(copy).find((n) => n.figure)!.nodeIri;
    expect(views.getLinks(copy)).toEqual([expect.objectContaining({ connector: true, sourceElementIri: app, targetNodeIri: copiedNote })]);
  });

  it('says what its skos:prefLabel says — read again once written — and is copied saying it, where it was moved to', () => {
    const { store, views, view, note, appNode } = setup();
    const link = views.addConnector(view, { sourceNodeIri: note, targetNodeIri: appNode })!;
    expect(views.getLinks(view)[0]?.text).toBeUndefined();
    store.addQuads([DataFactory.quad(nn(link), nn(NAMESPACES.skos + 'prefLabel'), DataFactory.literal('asks', 'en'))]);
    views.setLinkLabel(view, link, { x: 140, y: 20, width: 40, height: 16 });
    expect(views.getLinks(view)[0]).toMatchObject({ text: 'asks', label: { x: 140, y: 20, width: 40, height: 16 } });
    const copy = views.duplicateView(view).value;
    expect(views.getLinks(copy)[0]).toMatchObject({ connector: true, text: 'asks', label: { x: 140, y: 20, width: 40, height: 16 } });
    // Its text goes with it.
    views.removeRelationshipFromView(view, link);
    expect(store.getQuads(nn(link), null, null)).toEqual([]);
  });
});
