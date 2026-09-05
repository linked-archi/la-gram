import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { OxigraphRelationshipManager, resetQrCounter } from '../relationship-manager.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = NAMESPACES.rdf + 'type';
const ARCH = NAMESPACES.arch;
const SKOS = NAMESPACES.skos;

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

/** Helper: seed the store with a relationship type definition including domain/range. */
function addRelationshipType(
  store: OxigraphRdfStore,
  iri: string,
  label: string,
  domains: string[],
  ranges: string[],
): void {
  const quads: Quad[] = [
    quad(nn(iri) as any, nn(RDF_TYPE) as any, nn(ARCH + 'Relationship') as any) as unknown as Quad,
    quad(nn(iri) as any, nn(SKOS + 'prefLabel') as any, literal(label) as any) as unknown as Quad,
  ];
  for (const d of domains) {
    quads.push(
      quad(nn(iri) as any, nn(ARCH + 'domainIncludes') as any, nn(d) as any) as unknown as Quad,
    );
  }
  for (const r of ranges) {
    quads.push(
      quad(nn(iri) as any, nn(ARCH + 'rangeIncludes') as any, nn(r) as any) as unknown as Quad,
    );
  }
  store.addQuads(quads);
}

describe('OxigraphRelationshipManager', () => {
  let store: OxigraphRdfStore;
  let manager: OxigraphRelationshipManager;

  const appComp = 'https://example.org/archimate#ApplicationComponent';
  const appService = 'https://example.org/archimate#ApplicationService';
  const busProcess = 'https://example.org/archimate#BusinessProcess';
  const servesRel = 'https://example.org/archimate#serves';
  const composesRel = 'https://example.org/archimate#composedOf';

  const sourceIri = 'https://example.org/model/elem-1';
  const targetIri = 'https://example.org/model/elem-2';

  beforeEach(() => {
    store = new OxigraphRdfStore();
    manager = new OxigraphRelationshipManager(store);
    resetQrCounter();
  });

  describe('getValidRelationships', () => {
    it('returns relationship types matching source domain and target range', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);

      const valid = manager.getValidRelationships(appComp, appService);
      expect(valid).toHaveLength(1);
      expect(valid[0].iri).toBe(servesRel);
      expect(valid[0].label).toBe('Serves');
    });

    it('returns empty array when no relationship matches', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);

      const valid = manager.getValidRelationships(busProcess, appService);
      expect(valid).toHaveLength(0);
    });

    it('returns multiple matching relationship types', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);
      addRelationshipType(store, composesRel, 'Composed Of', [appComp], [appService]);

      const valid = manager.getValidRelationships(appComp, appService);
      expect(valid).toHaveLength(2);
      const iris = valid.map((r) => r.iri).sort();
      expect(iris).toEqual([composesRel, servesRel].sort());
    });

    it('includes all domain and range types in the returned info', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp, busProcess], [appService]);

      const valid = manager.getValidRelationships(appComp, appService);
      expect(valid).toHaveLength(1);
      expect(valid[0].domainTypes).toContain(appComp);
      expect(valid[0].domainTypes).toContain(busProcess);
      expect(valid[0].rangeTypes).toContain(appService);
    });

    it('does not match when source matches domain but target does not match range', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);

      const valid = manager.getValidRelationships(appComp, busProcess);
      expect(valid).toHaveLength(0);
    });
  });

  describe('createRelationship (direct)', () => {
    it('returns null for a direct (non-qualified) relationship', () => {
      const result = manager.createRelationship(servesRel, sourceIri, targetIri);
      expect(result).toBeNull();
    });

    it('creates a direct triple in the store', () => {
      manager.createRelationship(servesRel, sourceIri, targetIri);

      const quads = store.getQuads(nn(sourceIri), nn(servesRel), nn(targetIri));
      expect(quads).toHaveLength(1);
    });

    it('creates a direct triple when qualified is explicitly false', () => {
      manager.createRelationship(servesRel, sourceIri, targetIri, false);

      const quads = store.getQuads(nn(sourceIri), nn(servesRel), nn(targetIri));
      expect(quads).toHaveLength(1);
    });
  });

  describe('createRelationship (qualified)', () => {
    it('returns a NamedNode for a qualified relationship', () => {
      const result = manager.createRelationship(servesRel, sourceIri, targetIri, true);
      expect(result).not.toBeNull();
      expect(result!.termType).toBe('NamedNode');
    });

    it('creates a QualifiedRelationship with correct type triple', () => {
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;

      const typeQuads = store.getQuads(qr, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);
      expect(typeQuads[0].object.value).toBe(ARCH + 'QualifiedRelationship');
    });

    it('creates relSource, relTarget, and relPredicate triples', () => {
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;

      const srcQuads = store.getQuads(qr, nn(ARCH + 'relSource'));
      expect(srcQuads).toHaveLength(1);
      expect(srcQuads[0].object.value).toBe(sourceIri);

      const tgtQuads = store.getQuads(qr, nn(ARCH + 'relTarget'));
      expect(tgtQuads).toHaveLength(1);
      expect(tgtQuads[0].object.value).toBe(targetIri);

      const predQuads = store.getQuads(qr, nn(ARCH + 'relPredicate'));
      expect(predQuads).toHaveLength(1);
      expect(predQuads[0].object.value).toBe(servesRel);
    });

    it('creates exactly 4 triples for a qualified relationship', () => {
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      const allQuads = store.getQuads(qr);
      expect(allQuads).toHaveLength(4);
    });

    it('generates unique IRIs for successive qualified relationships', () => {
      const qr1 = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      const qr2 = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      expect(qr1.value).not.toBe(qr2.value);
    });
  });

  describe('deleteRelationship', () => {
    it('removes all triples of a QualifiedRelationship', () => {
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      expect(store.getQuads(qr)).toHaveLength(4);

      manager.deleteRelationship(qr.value);
      expect(store.getQuads(qr)).toHaveLength(0);
    });

    it('leaves source and target elements intact after deleting a QR', () => {
      // Add some triples for source and target elements
      store.addQuads([
        quad(nn(sourceIri) as any, nn(RDF_TYPE) as any, nn(appComp) as any) as unknown as Quad,
        quad(nn(targetIri) as any, nn(RDF_TYPE) as any, nn(appService) as any) as unknown as Quad,
      ]);

      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      manager.deleteRelationship(qr.value);

      // Source and target still have their type triples
      expect(store.getQuads(nn(sourceIri), nn(RDF_TYPE))).toHaveLength(1);
      expect(store.getQuads(nn(targetIri), nn(RDF_TYPE))).toHaveLength(1);
    });

    it('is a no-op when the IRI does not exist', () => {
      // Should not throw
      manager.deleteRelationship('https://example.org/nonexistent');
    });
  });
});
