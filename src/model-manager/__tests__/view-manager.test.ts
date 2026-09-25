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
