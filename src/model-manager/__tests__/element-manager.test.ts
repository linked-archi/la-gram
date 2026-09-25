import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Literal } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { OxigraphViewManager } from '../view-manager.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = NAMESPACES.rdf + 'type';
const ARCH = NAMESPACES.arch;
const VIS = NAMESPACES['arch-vis'];
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';

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
  });

  describe('createElement', () => {
    it('mints a flat UUID IRI in the model namespace', () => {
      const node = manager.createElement(typeIri, modelIri);
      expect(node.termType).toBe('NamedNode');
      // `https://example.org/model` declares no namespace: `{ns}model` → `{ns}`.
      expect(node.value).toMatch(/^https:\/\/example\.org\/element-[0-9a-f-]{36}$/);
    });

    it('never reuses an IRI, even across managers (a loaded model must not collide)', () => {
      const other = new OxigraphElementManager(store);
      const a = manager.createElement(typeIri, modelIri);
      const b = other.createElement(typeIri, modelIri);
      expect(a.value).not.toBe(b.value);
    });

    it('writes rdf:type and arch:inModel, and nothing about geometry', () => {
      const node = manager.createElement(typeIri, modelIri);
      const quads = store.getQuads(node);
      expect(quads.map((q) => [q.predicate.value, q.object.value]).sort()).toEqual(
        [
          [ARCH + 'inModel', modelIri],
          [RDF_TYPE, typeIri],
        ].sort(),
      );
      expect(store.getQuads(null, nn(VIS + 'bounds-x'))).toHaveLength(0);
    });

    it('writes the label language-tagged, as the element shapes require', () => {
      const node = manager.createElement(typeIri, modelIri, { label: 'Order Service' });
      const label = store.getQuads(node, nn(SKOS_PREF_LABEL))[0].object as Literal;
      expect(label.value).toBe('Order Service');
      expect(label.language).toBe('en');
    });

    it('honours a given IRI (redo, import, collaboration)', () => {
      const node = manager.createElement(typeIri, modelIri, { iri: 'https://example.org/model/element/fixed' });
      expect(node.value).toBe('https://example.org/model/element/fixed');
    });
  });

  describe('updateProperty', () => {
    it('replaces the value of a property, leaving other triples alone', () => {
      const node = manager.createElement(typeIri, modelIri, { label: 'Old' });
      manager.updateProperty(node.value, SKOS_PREF_LABEL, literal('New', 'en') as never);
      const labels = store.getQuads(node, nn(SKOS_PREF_LABEL));
      expect(labels.map((q) => q.object.value)).toEqual(['New']);
      expect(store.getQuads(node, nn(RDF_TYPE))).toHaveLength(1);
    });
  });

  describe('deleteElement (from the model)', () => {
    let views: OxigraphViewManager;
    let rels: OxigraphRelationshipManager;

    beforeEach(() => {
      views = new OxigraphViewManager(store);
      rels = new OxigraphRelationshipManager(store);
    });

    it('removes every triple about the element', () => {
      const node = manager.createElement(typeIri, modelIri, { label: 'X' });
      manager.deleteElement(node.value);
      expect(store.getQuads(node)).toHaveLength(0);
      expect(store.getQuads(null, null, node)).toHaveLength(0);
    });

    it('does not affect other elements', () => {
      const a = manager.createElement(typeIri, modelIri);
      const b = manager.createElement(typeIri, modelIri);
      manager.deleteElement(a.value);
      expect(store.getQuads(b).length).toBeGreaterThan(0);
    });

    it('removes its placements in every view, and the links ending at them', () => {
      const a = manager.createElement(typeIri, modelIri);
      const b = manager.createElement(typeIri, modelIri);
      const v1 = views.createView('Diagram', undefined, { modelIri }).value;
      const v2 = views.createView('Diagram', undefined, { modelIri }).value;
      for (const v of [v1, v2]) {
        views.addElementToView(v, a.value);
        views.addElementToView(v, b.value);
      }
      const rel = rels.createQualifiedRelationship({ typeIri: ARCH + 'someRel', sourceIri: a.value, targetIri: b.value });
      views.addRelationshipToView(v1, rel.iri, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);

      manager.deleteElement(a.value);

      expect(views.getNodes(v1).map((n) => n.elementIri)).toEqual([b.value]);
      expect(views.getNodes(v2).map((n) => n.elementIri)).toEqual([b.value]);
      expect(views.getLinks(v1)).toEqual([]);
      // The route's points and list cells went with the link.
      expect(store.getQuads(null, nn(VIS + 'point-x'))).toHaveLength(0);
      expect(store.getQuads(null, nn(NAMESPACES.rdf + 'first'))).toHaveLength(0);
      // The relationship went too.
      expect(store.getQuads(nn(rel.iri))).toHaveLength(0);
      // The other element stays.
      expect(store.getQuads(b).length).toBeGreaterThan(0);
    });

    it('exposes the exact quads it removes, so the removal can be undone', () => {
      const a = manager.createElement(typeIri, modelIri, { label: 'A' });
      const v = views.createView('Diagram', undefined, { modelIri }).value;
      views.addElementToView(v, a.value, { x: 10, y: 10, width: 100, height: 50 });
      const before = store.getQuads().length;

      const snapshot = manager.collectElementQuads(a.value);
      manager.deleteElement(a.value);
      store.addQuads(snapshot);

      expect(store.getQuads().length).toBe(before);
      expect(views.getNode(v, a.value)?.bounds).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    });

    it('still cascades relationships written with the retired relSource/relTarget', () => {
      const a = manager.createElement(typeIri, modelIri);
      const qr = nn('https://example.org/model/legacy-qr');
      store.addQuads([
        quad(qr as never, namedNode(RDF_TYPE), namedNode(ARCH + 'QualifiedRelationship')) as never,
        quad(qr as never, namedNode(ARCH + 'relSource'), a as never) as never,
      ]);
      manager.deleteElement(a.value);
      expect(store.getQuads(qr)).toHaveLength(0);
    });
  });
});
