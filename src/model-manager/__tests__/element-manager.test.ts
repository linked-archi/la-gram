import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { OxigraphElementManager, resetElementCounter } from '../element-manager.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = NAMESPACES.rdf + 'type';
const ARCH_VIS = NAMESPACES['arch-vis'];
const ARCH = NAMESPACES.arch;
const XSD_DOUBLE = NAMESPACES.xsd + 'double';

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

describe('OxigraphElementManager', () => {
  let store: OxigraphRdfStore;
  let manager: OxigraphElementManager;
  const modelIri = 'https://example.org/model';
  const typeIri = 'https://example.org/archimate#ApplicationComponent';

  beforeEach(() => {
    store = new OxigraphRdfStore();
    manager = new OxigraphElementManager(store);
    resetElementCounter();
  });

  describe('createElement', () => {
    it('returns a NamedNode with a unique IRI in the model namespace', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 10, y: 20, width: 130, height: 60 });
      expect(node.termType).toBe('NamedNode');
      expect(node.value).toMatch(new RegExp(`^${modelIri}/elem-\\d+$`));
    });

    it('adds rdf:type triple for the element', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const typeQuads = store.getQuads(node, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);
      expect(typeQuads[0].object.value).toBe(typeIri);
    });

    it('adds arch-vis layout triples with xsd:double values', () => {
      const bounds = { x: 100, y: 200, width: 130, height: 60 };
      const node = manager.createElement(typeIri, modelIri, bounds);

      const xQuads = store.getQuads(node, nn(ARCH_VIS + 'bounds-x'));
      expect(xQuads).toHaveLength(1);
      expect(xQuads[0].object.value).toBe('100');

      const yQuads = store.getQuads(node, nn(ARCH_VIS + 'bounds-y'));
      expect(yQuads).toHaveLength(1);
      expect(yQuads[0].object.value).toBe('200');

      const wQuads = store.getQuads(node, nn(ARCH_VIS + 'bounds-w'));
      expect(wQuads).toHaveLength(1);
      expect(wQuads[0].object.value).toBe('130');

      const hQuads = store.getQuads(node, nn(ARCH_VIS + 'bounds-h'));
      expect(hQuads).toHaveLength(1);
      expect(hQuads[0].object.value).toBe('60');
    });

    it('generates unique IRIs for successive elements', () => {
      const node1 = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const node2 = manager.createElement(typeIri, modelIri, { x: 50, y: 50, width: 100, height: 50 });
      expect(node1.value).not.toBe(node2.value);
    });

    it('creates exactly 5 triples (1 type + 4 layout)', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const allQuads = store.getQuads(node);
      expect(allQuads).toHaveLength(5);
    });
  });

  describe('updateProperty', () => {
    it('updates an existing property value', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const labelPred = NAMESPACES.skos + 'prefLabel';

      // Set initial label
      manager.updateProperty(node.value, labelPred, literal('Old Label') as any);
      let labelQuads = store.getQuads(node, nn(labelPred));
      expect(labelQuads).toHaveLength(1);
      expect(labelQuads[0].object.value).toBe('Old Label');

      // Update label
      manager.updateProperty(node.value, labelPred, literal('New Label') as any);
      labelQuads = store.getQuads(node, nn(labelPred));
      expect(labelQuads).toHaveLength(1);
      expect(labelQuads[0].object.value).toBe('New Label');
    });

    it('leaves other triples unchanged', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 10, y: 20, width: 130, height: 60 });
      const labelPred = NAMESPACES.skos + 'prefLabel';
      manager.updateProperty(node.value, labelPred, literal('My Label') as any);

      // Total: 5 original + 1 label = 6
      const allQuads = store.getQuads(node);
      expect(allQuads).toHaveLength(6);

      // Update label — should still be 6 total
      manager.updateProperty(node.value, labelPred, literal('Updated') as any);
      const afterUpdate = store.getQuads(node);
      expect(afterUpdate).toHaveLength(6);

      // Type triple still intact
      const typeQuads = store.getQuads(node, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);
      expect(typeQuads[0].object.value).toBe(typeIri);
    });

    it('adds a new property when none exists', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const defPred = NAMESPACES.skos + 'definition';
      manager.updateProperty(node.value, defPred, literal('A definition') as any);

      const defQuads = store.getQuads(node, nn(defPred));
      expect(defQuads).toHaveLength(1);
      expect(defQuads[0].object.value).toBe('A definition');
    });
  });

  describe('deleteElement', () => {
    it('removes all triples where element is the subject', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      expect(store.getQuads(node)).toHaveLength(5);

      manager.deleteElement(node.value);
      expect(store.getQuads(node)).toHaveLength(0);
    });

    it('removes direct relationship triples where element is the object', () => {
      const elem1 = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const elem2 = manager.createElement(typeIri, modelIri, { x: 200, y: 0, width: 100, height: 50 });

      // Add a direct relationship: elem1 --serves--> elem2
      const relPred = 'https://example.org/archimate#serves';
      store.addQuads([
        quad(elem1 as any, namedNode(relPred) as any, elem2 as any) as unknown as Quad,
      ]);

      // Delete elem2 — should also remove the relationship triple
      manager.deleteElement(elem2.value);
      const relQuads = store.getQuads(elem1, nn(relPred));
      expect(relQuads).toHaveLength(0);
    });

    it('cascade-deletes QualifiedRelationship resources referencing the element', () => {
      const elem1 = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const elem2 = manager.createElement(typeIri, modelIri, { x: 200, y: 0, width: 100, height: 50 });

      // Create a QualifiedRelationship: qr --relSource--> elem1, qr --relTarget--> elem2
      const qrIri = `${modelIri}/qr-1`;
      const qrNode = namedNode(qrIri);
      const relPredIri = 'https://example.org/archimate#serves';
      store.addQuads([
        quad(qrNode as any, namedNode(RDF_TYPE) as any, namedNode(ARCH + 'QualifiedRelationship') as any) as unknown as Quad,
        quad(qrNode as any, namedNode(ARCH + 'relSource') as any, elem1 as any) as unknown as Quad,
        quad(qrNode as any, namedNode(ARCH + 'relTarget') as any, elem2 as any) as unknown as Quad,
        quad(qrNode as any, namedNode(ARCH + 'relPredicate') as any, namedNode(relPredIri) as any) as unknown as Quad,
      ]);

      // Delete elem1 — should cascade-delete the QualifiedRelationship
      manager.deleteElement(elem1.value);
      const qrQuads = store.getQuads(nn(qrIri));
      expect(qrQuads).toHaveLength(0);
    });

    it('does not affect other elements when deleting one', () => {
      const elem1 = manager.createElement(typeIri, modelIri, { x: 0, y: 0, width: 100, height: 50 });
      const elem2 = manager.createElement(typeIri, modelIri, { x: 200, y: 0, width: 100, height: 50 });

      manager.deleteElement(elem1.value);

      // elem2 should still have all its triples
      expect(store.getQuads(elem2)).toHaveLength(5);
    });
  });

  describe('updateLayout', () => {
    it('updates all four layout properties', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 10, y: 20, width: 130, height: 60 });

      const newBounds = { x: 50, y: 100, width: 200, height: 80 };
      manager.updateLayout(node.value, newBounds);

      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-x'))[0].object.value).toBe('50');
      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-y'))[0].object.value).toBe('100');
      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-w'))[0].object.value).toBe('200');
      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-h'))[0].object.value).toBe('80');
    });

    it('preserves non-layout triples', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 10, y: 20, width: 130, height: 60 });
      manager.updateProperty(node.value, NAMESPACES.skos + 'prefLabel', literal('Test') as any);

      manager.updateLayout(node.value, { x: 0, y: 0, width: 50, height: 50 });

      // Type triple still present
      const typeQuads = store.getQuads(node, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);

      // Label still present
      const labelQuads = store.getQuads(node, nn(NAMESPACES.skos + 'prefLabel'));
      expect(labelQuads).toHaveLength(1);
      expect(labelQuads[0].object.value).toBe('Test');
    });

    it('keeps exactly one value per layout property after update', () => {
      const node = manager.createElement(typeIri, modelIri, { x: 10, y: 20, width: 130, height: 60 });
      manager.updateLayout(node.value, { x: 50, y: 100, width: 200, height: 80 });

      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-x'))).toHaveLength(1);
      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-y'))).toHaveLength(1);
      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-w'))).toHaveLength(1);
      expect(store.getQuads(node, nn(ARCH_VIS + 'bounds-h'))).toHaveLength(1);
    });
  });
});
