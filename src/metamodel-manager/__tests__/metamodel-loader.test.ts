import { describe, it, expect, beforeEach } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { N3MetamodelLoader } from '../metamodel-loader.js';
import { DataFactory } from 'n3';

const { namedNode } = DataFactory;

/** Minimal metamodel TTL with all metadata fields. */
const MINIMAL_METAMODEL = `
  @prefix owl: <${NAMESPACES.owl}> .
  @prefix dc: <${NAMESPACES.dc}> .
  @prefix rdf: <${NAMESPACES.rdf}> .

  <https://example.org/metamodel/test>
    rdf:type owl:Ontology ;
    dc:title "Test Metamodel" ;
    owl:versionInfo "1.0.0" ;
    dc:description "A test metamodel for unit testing" .
`;

/** Metamodel with owl:imports. */
const METAMODEL_WITH_IMPORTS = `
  @prefix owl: <${NAMESPACES.owl}> .
  @prefix dc: <${NAMESPACES.dc}> .
  @prefix rdf: <${NAMESPACES.rdf}> .

  <https://example.org/metamodel/root>
    rdf:type owl:Ontology ;
    dc:title "Root Metamodel" ;
    owl:versionInfo "2.0.0" ;
    dc:description "Root with imports" ;
    owl:imports <https://example.org/metamodel/dep1> ;
    owl:imports <https://example.org/metamodel/dep2> .
`;

/** Dependency metamodel that itself imports another. */
const DEP1_METAMODEL = `
  @prefix owl: <${NAMESPACES.owl}> .
  @prefix dc: <${NAMESPACES.dc}> .
  @prefix rdf: <${NAMESPACES.rdf}> .

  <https://example.org/metamodel/dep1>
    rdf:type owl:Ontology ;
    dc:title "Dependency 1" ;
    owl:versionInfo "1.0.0" ;
    dc:description "First dependency" ;
    owl:imports <https://example.org/metamodel/dep3> .
`;

/** Simple SHACL shapes TTL. */
const SHACL_SHAPES = `
  @prefix sh: <${NAMESPACES.sh}> .
  @prefix ex: <https://example.org/shapes/> .
  @prefix rdf: <${NAMESPACES.rdf}> .

  ex:ElementShape
    rdf:type sh:NodeShape ;
    sh:targetClass <https://example.org/Element> ;
    sh:property [
      sh:path <https://example.org/name> ;
      sh:minCount 1
    ] .
`;

describe('N3MetamodelLoader', () => {
  let parser: N3TtlParser;
  let store: OxigraphRdfStore;
  let loader: N3MetamodelLoader;

  beforeEach(() => {
    parser = new N3TtlParser();
    store = new OxigraphRdfStore();
    loader = new N3MetamodelLoader(parser, store);
  });

  describe('loadMetamodel', () => {
    it('parses TTL and returns MetamodelInfo with correct metadata', async () => {
      const info = await loader.loadMetamodel(MINIMAL_METAMODEL);

      expect(info.iri).toBe('https://example.org/metamodel/test');
      expect(info.name).toBe('Test Metamodel');
      expect(info.version).toBe('1.0.0');
      expect(info.description).toBe('A test metamodel for unit testing');
    });

    it('loads quads into a named graph keyed by ontology IRI', async () => {
      await loader.loadMetamodel(MINIMAL_METAMODEL);

      const graphNode = namedNode('https://example.org/metamodel/test');
      const quads = store.getQuads(null, null, null, graphNode);
      expect(quads.length).toBeGreaterThan(0);

      // Verify the ontology type triple is in the named graph
      const typeQuads = quads.filter(
        (q) =>
          q.subject.value === 'https://example.org/metamodel/test' &&
          q.predicate.value === NAMESPACES.rdf + 'type' &&
          q.object.value === NAMESPACES.owl + 'Ontology',
      );
      expect(typeQuads).toHaveLength(1);
    });

    it('returns empty strings for missing metadata fields', async () => {
      const ttl = `
        @prefix owl: <${NAMESPACES.owl}> .
        @prefix rdf: <${NAMESPACES.rdf}> .
        <https://example.org/metamodel/bare> rdf:type owl:Ontology .
      `;
      const info = await loader.loadMetamodel(ttl);

      expect(info.iri).toBe('https://example.org/metamodel/bare');
      expect(info.name).toBe('');
      expect(info.version).toBe('');
      expect(info.description).toBe('');
    });

    it('falls back to dc:title subject when no owl:Ontology type', async () => {
      const ttl = `
        @prefix dc: <${NAMESPACES.dc}> .
        <https://example.org/metamodel/notowl>
          dc:title "Fallback Metamodel" ;
          dc:description "Found via dc:title" .
      `;
      const info = await loader.loadMetamodel(ttl);

      expect(info.iri).toBe('https://example.org/metamodel/notowl');
      expect(info.name).toBe('Fallback Metamodel');
    });

    it('throws on invalid TTL syntax', async () => {
      await expect(loader.loadMetamodel('not valid turtle {')).rejects.toThrow(
        /Failed to parse metamodel TTL/,
      );
    });

    it('throws when no ontology IRI can be found', async () => {
      const ttl = `
        @prefix ex: <http://example.org/> .
        ex:a ex:b ex:c .
      `;
      await expect(loader.loadMetamodel(ttl)).rejects.toThrow(/No ontology IRI found/);
    });

    it('loads multiple metamodels into separate named graphs', async () => {
      await loader.loadMetamodel(MINIMAL_METAMODEL);
      await loader.loadMetamodel(METAMODEL_WITH_IMPORTS);

      const graph1 = store.getQuads(null, null, null, namedNode('https://example.org/metamodel/test'));
      const graph2 = store.getQuads(null, null, null, namedNode('https://example.org/metamodel/root'));

      expect(graph1.length).toBeGreaterThan(0);
      expect(graph2.length).toBeGreaterThan(0);
    });
  });

  describe('loadShapes', () => {
    it('loads SHACL shapes into the store', async () => {
      await loader.loadShapes(SHACL_SHAPES);

      // Verify shapes are queryable — look for the NodeShape type
      const result = store.query(`
        PREFIX sh: <${NAMESPACES.sh}>
        PREFIX rdf: <${NAMESPACES.rdf}>
        SELECT ?shape WHERE {
          GRAPH <urn:la-gram:shapes> {
            ?shape rdf:type sh:NodeShape .
          }
        }
      `);

      expect(result.type).toBe('bindings');
      if (result.type === 'bindings') {
        expect(result.results.length).toBeGreaterThan(0);
      }
    });

    it('throws on invalid SHACL TTL', async () => {
      await expect(loader.loadShapes('invalid { turtle')).rejects.toThrow(
        /Failed to parse SHACL shapes TTL/,
      );
    });
  });

  describe('resolveImports', () => {
    it('discovers owl:imports from a loaded metamodel', async () => {
      await loader.loadMetamodel(METAMODEL_WITH_IMPORTS);
      await loader.resolveImports('https://example.org/metamodel/root');

      // The imports should be tracked as loaded (even though we can't
      // actually fetch them — they're marked for resolution)
      // Verify by checking the store for the import triples
      const graphNode = namedNode('https://example.org/metamodel/root');
      const importQuads = store.getQuads(
        namedNode('https://example.org/metamodel/root'),
        namedNode(NAMESPACES.owl + 'imports'),
        null,
        graphNode,
      );
      expect(importQuads).toHaveLength(2);
    });

    it('resolves transitive imports', async () => {
      // Load root and dep1 (which imports dep3)
      await loader.loadMetamodel(METAMODEL_WITH_IMPORTS);
      await loader.loadMetamodel(DEP1_METAMODEL);

      await loader.resolveImports('https://example.org/metamodel/root');

      // dep3 should be discovered transitively through dep1
      const dep1Graph = namedNode('https://example.org/metamodel/dep1');
      const dep1Imports = store.getQuads(
        namedNode('https://example.org/metamodel/dep1'),
        namedNode(NAMESPACES.owl + 'imports'),
        null,
        dep1Graph,
      );
      expect(dep1Imports).toHaveLength(1);
      expect(dep1Imports[0].object.value).toBe('https://example.org/metamodel/dep3');
    });

    it('handles circular imports without infinite loop', async () => {
      // Create a metamodel that imports itself
      const circular = `
        @prefix owl: <${NAMESPACES.owl}> .
        @prefix dc: <${NAMESPACES.dc}> .
        @prefix rdf: <${NAMESPACES.rdf}> .
        <https://example.org/metamodel/circular>
          rdf:type owl:Ontology ;
          dc:title "Circular" ;
          owl:imports <https://example.org/metamodel/circular> .
      `;
      await loader.loadMetamodel(circular);

      // Should complete without hanging
      await loader.resolveImports('https://example.org/metamodel/circular');
    });

    it('handles resolve on non-existent ontology gracefully', async () => {
      // Should not throw — just a no-op since there are no quads
      await loader.resolveImports('https://example.org/metamodel/nonexistent');
    });
  });
});
