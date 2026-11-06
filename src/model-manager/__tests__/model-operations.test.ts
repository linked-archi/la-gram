import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3TtlSerializer } from '../../rdf-engine/ttl-serializer.js';
import { ModelOperations, resetModelCounter } from '../model-operations.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode } = DataFactory;

const RDF_TYPE = NAMESPACES.rdf + 'type';
const ARCH_MODEL = NAMESPACES.arch + 'Model';
const ARCH_CONFORMS = NAMESPACES.arch + 'modelConformsToMetamodel';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

describe('ModelOperations', () => {
  let store: OxigraphRdfStore;
  let parser: N3TtlParser;
  let serializer: N3TtlSerializer;
  let ops: ModelOperations;
  const metamodelIri = 'https://meta.linked.archi/archimate3.1#';

  beforeEach(() => {
    store = new OxigraphRdfStore();
    parser = new N3TtlParser();
    serializer = new N3TtlSerializer();
    ops = new ModelOperations(parser, serializer, store);
    resetModelCounter();
  });

  describe('createModel', () => {
    it('returns a NamedNode with a unique model IRI', () => {
      const model = ops.createModel(metamodelIri);
      expect(model.termType).toBe('NamedNode');
      expect(model.value).toMatch(/^https:\/\/example\.org\/archimate\/[0-9a-f-]{36}\/model$/);
    });

    it('adds rdf:type arch:Model triple', () => {
      const model = ops.createModel(metamodelIri);
      const typeQuads = store.getQuads(model, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);
      expect(typeQuads[0].object.value).toBe(ARCH_MODEL);
    });

    it('adds arch:modelConformsToMetamodel triple', () => {
      const model = ops.createModel(metamodelIri);
      const conformsQuads = store.getQuads(model, nn(ARCH_CONFORMS));
      expect(conformsQuads).toHaveLength(1);
      expect(conformsQuads[0].object.value).toBe(metamodelIri);
    });

    it('adds skos:prefLabel when label is provided', () => {
      const model = ops.createModel(metamodelIri, 'My Architecture Model');
      const labelQuads = store.getQuads(model, nn(SKOS_PREF_LABEL));
      expect(labelQuads).toHaveLength(1);
      expect(labelQuads[0].object.value).toBe('My Architecture Model');
    });

    it('does not add skos:prefLabel when label is omitted', () => {
      const model = ops.createModel(metamodelIri);
      const labelQuads = store.getQuads(model, nn(SKOS_PREF_LABEL));
      expect(labelQuads).toHaveLength(0);
    });

    it('creates exactly 4 triples without label (type, conformance, namespace, prefix), 5 with label', () => {
      const noLabel = ops.createModel(metamodelIri);
      expect(store.getQuads(noLabel)).toHaveLength(4);

      const withLabel = ops.createModel(metamodelIri, 'Test');
      expect(store.getQuads(withLabel)).toHaveLength(5);
    });

    it('generates unique IRIs for successive models', () => {
      const m1 = ops.createModel(metamodelIri);
      const m2 = ops.createModel(metamodelIri);
      expect(m1.value).not.toBe(m2.value);
    });
  });

  describe('saveModel', () => {
    it('serializes all store quads to valid TTL', () => {
      ops.createModel(metamodelIri, 'Test Model');
      const ttl = ops.saveModel();
      expect(ttl).toContain('arch:Model');
      expect(ttl).toContain('arch:modelConformsToMetamodel');
    });

    it('preserves namespace prefixes in output', () => {
      ops.createModel(metamodelIri);
      const ttl = ops.saveModel();
      expect(ttl).toContain('@prefix');
      expect(ttl).toContain('arch:');
    });

    it('returns empty-ish output for an empty store', () => {
      const ttl = ops.saveModel();
      // Should not contain any triple statements (only possibly prefix declarations)
      expect(ttl).not.toContain('arch:Model');
    });
  });

  describe('loadModel', () => {
    it('parses TTL and loads quads into the store', () => {
      const ttl = `
        @prefix arch: <https://meta.linked.archi/core#> .
        @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
        <urn:test:model-1> a arch:Model ;
          arch:conformsToMetamodel <https://meta.linked.archi/archimate3.1#> ;
          skos:prefLabel "Loaded Model" .
      `;
      const result = ops.loadModel(ttl);
      expect(result.quadCount).toBe(3);
      expect(result.modelIri).toBe('urn:test:model-1');
    });

    it('returns modelIri as null when no arch:Model resource exists', () => {
      const ttl = `
        @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
        <urn:test:thing> skos:prefLabel "Not a model" .
      `;
      const result = ops.loadModel(ttl);
      expect(result.modelIri).toBeNull();
      expect(result.quadCount).toBe(1);
    });

    it('throws on invalid TTL', () => {
      expect(() => ops.loadModel('this is not valid turtle {')).toThrow(
        /Failed to parse TTL/,
      );
    });

    it('makes loaded quads queryable in the store', () => {
      const ttl = `
        @prefix arch: <https://meta.linked.archi/core#> .
        <urn:test:model-1> a arch:Model ;
          arch:conformsToMetamodel <https://meta.linked.archi/archimate3.1#> .
      `;
      ops.loadModel(ttl);

      const modelQuads = store.getQuads(nn('urn:test:model-1'), nn(RDF_TYPE));
      expect(modelQuads).toHaveLength(1);
      expect(modelQuads[0].object.value).toBe(ARCH_MODEL);
    });
  });

  describe('round-trip: create → save → load', () => {
    it('preserves model triples across save and reload', () => {
      // Create a model in the first store
      ops.createModel(metamodelIri, 'Round Trip Model');
      const ttl = ops.saveModel();

      // Load into a fresh store
      const store2 = new OxigraphRdfStore();
      const ops2 = new ModelOperations(parser, serializer, store2);
      const result = ops2.loadModel(ttl);

      expect(result.modelIri).toMatch(/^https:\/\/example\.org\/archimate\//);
      expect(result.quadCount).toBe(5); // type + conformsTo + label + namespace + prefix

      // Verify the triples are present
      const modelNode = nn(result.modelIri!);
      const typeQuads = store2.getQuads(modelNode, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);
      expect(typeQuads[0].object.value).toBe(ARCH_MODEL);

      const conformsQuads = store2.getQuads(modelNode, nn(ARCH_CONFORMS));
      expect(conformsQuads).toHaveLength(1);
      expect(conformsQuads[0].object.value).toBe(metamodelIri);

      const labelQuads = store2.getQuads(modelNode, nn(SKOS_PREF_LABEL));
      expect(labelQuads).toHaveLength(1);
      expect(labelQuads[0].object.value).toBe('Round Trip Model');
    });
  });
});
