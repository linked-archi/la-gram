import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { OxigraphViewManager, resetViewCounter } from '../view-manager.js';
import { OxigraphElementManager, resetElementCounter } from '../element-manager.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = NAMESPACES.rdf + 'type';
const ARCH = NAMESPACES.arch;
const ARCH_VIS = NAMESPACES['arch-vis'];
const SKOS = NAMESPACES.skos;

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

describe('OxigraphViewManager', () => {
  let store: OxigraphRdfStore;
  let viewManager: OxigraphViewManager;
  let elementManager: OxigraphElementManager;
  const modelIri = 'https://example.org/model';
  const typeIri = 'https://example.org/archimate#ApplicationComponent';

  beforeEach(() => {
    store = new OxigraphRdfStore();
    viewManager = new OxigraphViewManager(store);
    elementManager = new OxigraphElementManager(store);
    resetViewCounter();
    resetElementCounter();
  });

  describe('createView', () => {
    it('returns a NamedNode with a unique IRI', () => {
      const view = viewManager.createView('Diagram');
      expect(view.termType).toBe('NamedNode');
      expect(view.value).toMatch(/^urn:la-gram:view-\d+$/);
    });

    it('adds rdf:type arch:View triple', () => {
      const view = viewManager.createView('Diagram');
      const typeQuads = store.getQuads(view, nn(RDF_TYPE), nn(ARCH + 'View'));
      expect(typeQuads).toHaveLength(1);
    });

    it('adds rdf:type arch:Diagram for Diagram views', () => {
      const view = viewManager.createView('Diagram');
      const typeQuads = store.getQuads(view, nn(RDF_TYPE), nn(ARCH + 'Diagram'));
      expect(typeQuads).toHaveLength(1);
    });

    it('adds rdf:type arch:Catalog for Catalog views', () => {
      const view = viewManager.createView('Catalog');
      const typeQuads = store.getQuads(view, nn(RDF_TYPE), nn(ARCH + 'Catalog'));
      expect(typeQuads).toHaveLength(1);
    });

    it('adds rdf:type arch:Matrix for Matrix views', () => {
      const view = viewManager.createView('Matrix');
      const typeQuads = store.getQuads(view, nn(RDF_TYPE), nn(ARCH + 'Matrix'));
      expect(typeQuads).toHaveLength(1);
    });

    it('adds arch:viewpoint triple when viewpointIri is provided', () => {
      const vpIri = 'https://example.org/viewpoint/application-cooperation';
      const view = viewManager.createView('Diagram', vpIri);
      const vpQuads = store.getQuads(view, nn(ARCH + 'viewpoint'));
      expect(vpQuads).toHaveLength(1);
      expect(vpQuads[0].object.value).toBe(vpIri);
    });

    it('does not add arch:viewpoint triple when viewpointIri is omitted', () => {
      const view = viewManager.createView('Diagram');
      const vpQuads = store.getQuads(view, nn(ARCH + 'viewpoint'));
      expect(vpQuads).toHaveLength(0);
    });

    it('generates unique IRIs for successive views', () => {
      const v1 = viewManager.createView('Diagram');
      const v2 = viewManager.createView('Catalog');
      expect(v1.value).not.toBe(v2.value);
    });

    it('creates exactly 2 triples without viewpoint, 3 with viewpoint', () => {
      const v1 = viewManager.createView('Diagram');
      expect(store.getQuads(v1)).toHaveLength(2);

      const v2 = viewManager.createView('Catalog', 'https://example.org/vp');
      expect(store.getQuads(v2)).toHaveLength(3);
    });
  });

  describe('getViews', () => {
    it('returns empty array when no views exist', () => {
      expect(viewManager.getViews()).toHaveLength(0);
    });

    it('returns all created views', () => {
      viewManager.createView('Diagram');
      viewManager.createView('Catalog');
      viewManager.createView('Matrix');

      const views = viewManager.getViews();
      expect(views).toHaveLength(3);
    });

    it('returns correct type for each view', () => {
      viewManager.createView('Diagram');
      viewManager.createView('Catalog');
      viewManager.createView('Matrix');

      const views = viewManager.getViews();
      const types = views.map((v) => v.type).sort();
      expect(types).toEqual(['Catalog', 'Diagram', 'Matrix']);
    });

    it('returns label from skos:prefLabel', () => {
      const view = viewManager.createView('Diagram');
      // Manually add a label
      store.addQuads([
        quad(
          view as any,
          nn(SKOS + 'prefLabel') as any,
          literal('My Diagram') as any,
        ) as unknown as Quad,
      ]);

      const views = viewManager.getViews();
      expect(views).toHaveLength(1);
      expect(views[0].label).toBe('My Diagram');
    });

    it('returns viewpointIri when present', () => {
      const vpIri = 'https://example.org/vp/app';
      viewManager.createView('Diagram', vpIri);

      const views = viewManager.getViews();
      expect(views).toHaveLength(1);
      expect(views[0].viewpointIri).toBe(vpIri);
    });

    it('returns undefined viewpointIri when not present', () => {
      viewManager.createView('Diagram');

      const views = viewManager.getViews();
      expect(views).toHaveLength(1);
      expect(views[0].viewpointIri).toBeUndefined();
    });
  });

  describe('addElementToView', () => {
    it('creates an arch-vis:view triple linking element to view', () => {
      const view = viewManager.createView('Diagram');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });

      viewManager.addElementToView(view.value, elem.value);

      const viewQuads = store.getQuads(elem, nn(ARCH_VIS + 'view'), view);
      expect(viewQuads).toHaveLength(1);
    });

    it('does not create a new element resource', () => {
      const view = viewManager.createView('Diagram');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const quadsBefore = store.getQuads(elem).length;

      viewManager.addElementToView(view.value, elem.value);

      // Only 1 new triple (the arch-vis:view link)
      const quadsAfter = store.getQuads(elem).length;
      expect(quadsAfter).toBe(quadsBefore + 1);
    });

    it('allows adding the same element to multiple views', () => {
      const v1 = viewManager.createView('Diagram');
      const v2 = viewManager.createView('Catalog');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });

      viewManager.addElementToView(v1.value, elem.value);
      viewManager.addElementToView(v2.value, elem.value);

      const viewQuads = store.getQuads(elem, nn(ARCH_VIS + 'view'));
      expect(viewQuads).toHaveLength(2);
    });
  });

  describe('removeElementFromView', () => {
    it('removes the arch-vis:view triple', () => {
      const view = viewManager.createView('Diagram');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });

      viewManager.addElementToView(view.value, elem.value);
      expect(store.getQuads(elem, nn(ARCH_VIS + 'view'), view)).toHaveLength(1);

      viewManager.removeElementFromView(view.value, elem.value);
      expect(store.getQuads(elem, nn(ARCH_VIS + 'view'), view)).toHaveLength(0);
    });

    it('does not remove the element resource itself', () => {
      const view = viewManager.createView('Diagram');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });

      viewManager.addElementToView(view.value, elem.value);
      viewManager.removeElementFromView(view.value, elem.value);

      // Element still has its original 5 triples (type + 4 layout)
      expect(store.getQuads(elem)).toHaveLength(5);
    });

    it('only removes the link to the specified view, not other views', () => {
      const v1 = viewManager.createView('Diagram');
      const v2 = viewManager.createView('Catalog');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });

      viewManager.addElementToView(v1.value, elem.value);
      viewManager.addElementToView(v2.value, elem.value);

      viewManager.removeElementFromView(v1.value, elem.value);

      // Still linked to v2
      expect(store.getQuads(elem, nn(ARCH_VIS + 'view'), v2)).toHaveLength(1);
      // No longer linked to v1
      expect(store.getQuads(elem, nn(ARCH_VIS + 'view'), v1)).toHaveLength(0);
    });

    it('is a no-op when the element is not in the view', () => {
      const view = viewManager.createView('Diagram');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });

      // Should not throw
      viewManager.removeElementFromView(view.value, elem.value);
      expect(store.getQuads(elem)).toHaveLength(5);
    });
  });

  describe('single RDF resource across views', () => {
    it('element in multiple views has exactly one RDF resource', () => {
      const v1 = viewManager.createView('Diagram');
      const v2 = viewManager.createView('Catalog');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 10, y: 20, width: 130, height: 60 });

      viewManager.addElementToView(v1.value, elem.value);
      viewManager.addElementToView(v2.value, elem.value);

      // Only one rdf:type triple for the element (not duplicated)
      const typeQuads = store.getQuads(elem, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);
      expect(typeQuads[0].object.value).toBe(typeIri);
    });

    it('property changes are visible from all view contexts', () => {
      const v1 = viewManager.createView('Diagram');
      const v2 = viewManager.createView('Catalog');
      const elem = elementManager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });

      viewManager.addElementToView(v1.value, elem.value);
      viewManager.addElementToView(v2.value, elem.value);

      // Update a property
      elementManager.updateProperty(elem.value, SKOS + 'prefLabel', literal('Updated Label') as any);

      // The label is on the single element resource — visible regardless of view
      const labelQuads = store.getQuads(elem, nn(SKOS + 'prefLabel'));
      expect(labelQuads).toHaveLength(1);
      expect(labelQuads[0].object.value).toBe('Updated Label');
    });
  });
});
