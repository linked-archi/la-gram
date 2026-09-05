import { describe, it, expect, beforeEach } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { SparqlViewpointManager } from '../viewpoint-manager.js';

const EX = 'https://example.org/vp-test#';

const VIEWPOINT_DATA = `
  @prefix rdf:  <${NAMESPACES.rdf}> .
  @prefix arch: <${NAMESPACES.arch}> .
  @prefix skos: <${NAMESPACES.skos}> .
  @prefix ex:   <${EX}> .

  ex:BusinessViewpoint
    rdf:type arch:Viewpoint ;
    skos:prefLabel "Business Viewpoint" ;
    arch:permitsElement ex:BusinessProcess ;
    arch:permitsElement ex:BusinessService ;
    arch:permitsRelationship ex:serves .

  ex:TechViewpoint
    rdf:type arch:Viewpoint ;
    skos:prefLabel "Technology Viewpoint" ;
    arch:permitsElement ex:ApplicationComponent ;
    arch:permitsRelationship ex:accesses .
`;

describe('SparqlViewpointManager', () => {
  let store: OxigraphRdfStore;
  let manager: SparqlViewpointManager;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    manager = new SparqlViewpointManager(store);
    const parser = new N3TtlParser();
    const result = parser.parse(VIEWPOINT_DATA);
    if (result.ok) store.addQuads(result.quads);
  });

  describe('getViewpoints', () => {
    it('discovers all viewpoint instances', () => {
      const viewpoints = manager.getViewpoints();
      expect(viewpoints).toHaveLength(2);
      const iris = viewpoints.map((v) => v.iri);
      expect(iris).toContain(`${EX}BusinessViewpoint`);
      expect(iris).toContain(`${EX}TechViewpoint`);
    });

    it('populates labels from skos:prefLabel', () => {
      const viewpoints = manager.getViewpoints();
      const biz = viewpoints.find((v) => v.iri === `${EX}BusinessViewpoint`);
      expect(biz?.label).toBe('Business Viewpoint');
      const tech = viewpoints.find((v) => v.iri === `${EX}TechViewpoint`);
      expect(tech?.label).toBe('Technology Viewpoint');
    });

    it('populates permitted elements for each viewpoint', () => {
      const viewpoints = manager.getViewpoints();
      const biz = viewpoints.find((v) => v.iri === `${EX}BusinessViewpoint`);
      expect(biz?.permittedElements).toHaveLength(2);
      expect(biz?.permittedElements).toContain(`${EX}BusinessProcess`);
      expect(biz?.permittedElements).toContain(`${EX}BusinessService`);

      const tech = viewpoints.find((v) => v.iri === `${EX}TechViewpoint`);
      expect(tech?.permittedElements).toHaveLength(1);
      expect(tech?.permittedElements).toContain(`${EX}ApplicationComponent`);
    });

    it('populates permitted relationships for each viewpoint', () => {
      const viewpoints = manager.getViewpoints();
      const biz = viewpoints.find((v) => v.iri === `${EX}BusinessViewpoint`);
      expect(biz?.permittedRelationships).toHaveLength(1);
      expect(biz?.permittedRelationships).toContain(`${EX}serves`);

      const tech = viewpoints.find((v) => v.iri === `${EX}TechViewpoint`);
      expect(tech?.permittedRelationships).toHaveLength(1);
      expect(tech?.permittedRelationships).toContain(`${EX}accesses`);
    });

    it('returns empty array when no viewpoints exist', () => {
      const emptyStore = new OxigraphRdfStore();
      const emptyManager = new SparqlViewpointManager(emptyStore);
      expect(emptyManager.getViewpoints()).toHaveLength(0);
    });
  });

  describe('getPermittedTypes', () => {
    it('returns permitted elements and relationships for a viewpoint', () => {
      const result = manager.getPermittedTypes(`${EX}BusinessViewpoint`);
      expect(result.elements).toHaveLength(2);
      expect(result.elements).toContain(`${EX}BusinessProcess`);
      expect(result.elements).toContain(`${EX}BusinessService`);
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships).toContain(`${EX}serves`);
    });

    it('returns empty arrays for unknown viewpoint IRI', () => {
      const result = manager.getPermittedTypes('https://example.org/nonexistent');
      expect(result.elements).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
    });
  });
});
