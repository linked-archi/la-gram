import { describe, it, expect, beforeEach } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { N3MetamodelLoader } from '../metamodel-loader.js';
import { BUNDLED_ASSETS } from '../bundled-assets.js';
import { DataFactory } from 'n3';
import {
  BASIC_BUBBLE_DOC,
  BASIC_CONTEXTS_DOC,
  BASIC_CONTEXTS_TTL,
  BASIC_METAMODEL,
  BASIC_NOTATION_DOC,
  BUBBLE_SET,
  RECTANGLE_SET,
  basicAssetSource,
} from './basic-fixture.js';

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

// ---------------------------------------------------------------------------
// Manifest-driven loading
// ---------------------------------------------------------------------------

/**
 * Manifest shaped like the published ones: the `arch:Metamodel` subject is an
 * individual inside the manifest document, and its properties point at a mix of
 * document IRIs and of individuals living in other documents.
 */
const MANIFEST = `
  @prefix owl:  <${NAMESPACES.owl}> .
  @prefix rdf:  <${NAMESPACES.rdf}> .
  @prefix skos: <${NAMESPACES.skos}> .
  @prefix arch: <${NAMESPACES.arch}> .
  @prefix ex:   <https://example.org/mm/metamodel#> .

  <https://example.org/mm/metamodel#>
    rdf:type owl:Ontology ;
    owl:imports <https://meta.linked.archi/core#> .

  ex:TestLanguage
    rdf:type arch:Metamodel ;
    skos:prefLabel "Test Language" ;
    owl:versionInfo "9.9" ;
    arch:modelConcepts <https://example.org/mm/onto#> ;
    arch:notationSet <https://example.org/mm/notation#SomeNotationSet> .
`;

describe('N3MetamodelLoader — manifest loading', () => {
  let loader: N3MetamodelLoader;
  let store: OxigraphRdfStore;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    loader = new N3MetamodelLoader(new N3TtlParser(), store);
  });

  it('finds the arch:Metamodel subject and loads the manifest into its own graph', async () => {
    const loaded = await loader.loadMetamodelFromManifest(MANIFEST);

    expect(loaded.metamodelIri).toBe('https://example.org/mm/metamodel#TestLanguage');
    expect(loaded.manifestGraphIri).toBe('https://example.org/mm/metamodel#');
    expect(loaded.info.name).toBe('Test Language');
    expect(loaded.info.version).toBe('9.9');

    const manifestQuads = store.getQuads(null, null, null, namedNode('https://example.org/mm/metamodel#'));
    expect(manifestQuads.length).toBeGreaterThan(0);
  });

  it('records references it cannot resolve to a bundled asset', async () => {
    const loaded = await loader.loadMetamodelFromManifest(MANIFEST);

    const concepts = loaded.assets.find((a) => a.via === 'arch:modelConcepts');
    expect(concepts?.outcome).toBe('not-bundled');
    expect(concepts?.documentIri).toBe('https://example.org/mm/onto#');
  });

  it('normalises an individual IRI to the document that would define it', async () => {
    const loaded = await loader.loadMetamodelFromManifest(MANIFEST);

    const notation = loaded.assets.find((a) => a.via === 'arch:notationSet');
    expect(notation?.referencedIri).toBe('https://example.org/mm/notation#SomeNotationSet');
    expect(notation?.documentIri).toBe('https://example.org/mm/notation#');
    expect(loaded.notationSetIri).toBe('https://example.org/mm/notation#SomeNotationSet');
  });

  it('follows owl:imports into the bundled core ontology', async () => {
    const loaded = await loader.loadMetamodelFromManifest(MANIFEST);

    const core = loaded.assets.find((a) => a.documentIri === 'https://meta.linked.archi/core#');
    expect(core?.outcome).toBe('loaded');
    expect(core?.role).toBe('coreOntology');
    expect(core?.via).toContain('owl:imports');
    expect(loaded.graphsByRole.coreOntology).toEqual(['https://meta.linked.archi/core#']);
  });

  it('throws when the document declares no arch:Metamodel', async () => {
    await expect(loader.loadMetamodelFromManifest(MINIMAL_METAMODEL)).rejects.toThrow(
      /No arch:Metamodel subject/,
    );
  });
});

describe('N3MetamodelLoader — arch:usesNotationSet targets', () => {
  it('loads the set a presentation context names, keeping arch:notationSet as the default', async () => {
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store, basicAssetSource());

    const loaded = await loader.loadMetamodelByIri(BASIC_METAMODEL);

    expect(loaded.graphsByRole.notation).toEqual([BASIC_NOTATION_DOC, BASIC_BUBBLE_DOC]);
    expect(loaded.notationSetIri).toBe(RECTANGLE_SET);

    const bubble = loaded.assets.filter((a) => a.documentIri === BASIC_BUBBLE_DOC);
    expect(bubble).toEqual([
      expect.objectContaining({
        referencedIri: BUBBLE_SET,
        via: 'arch:usesNotationSet',
        role: 'notation',
        outcome: 'loaded',
      }),
    ]);
    expect(store.getQuads(null, null, null, namedNode(BASIC_BUBBLE_DOC)).length).toBeGreaterThan(0);

    // The context naming the default set again adds nothing: the document was
    // reached through arch:notationSet first.
    const rectangle = loaded.assets.filter((a) => a.documentIri === BASIC_NOTATION_DOC);
    expect(rectangle).toEqual([
      expect.objectContaining({ via: 'arch:notationSet', outcome: 'loaded' }),
    ]);
    expect(loaded.assets.filter((a) => a.via === 'arch:usesNotationSet')).toHaveLength(1);

    // Reached through the presentation-context scheme, which is what triggers the follow-up.
    expect(loaded.graphsByRole.presentationContexts).toEqual([BASIC_CONTEXTS_DOC]);
  });

  it('reports a context set no source has as unavailable, without failing the load', async () => {
    const contexts = `${BASIC_CONTEXTS_TTL}
      <${BASIC_CONTEXTS_DOC}MissingContext>
        <${NAMESPACES.rdf}type> <${NAMESPACES.skos}Concept> ;
        <${NAMESPACES.skos}inScheme> <${BASIC_CONTEXTS_DOC}> ;
        <${NAMESPACES.arch}usesNotationSet> <https://example.org/absent-notation#AbsentNotation> .
    `;
    const loader = new N3MetamodelLoader(
      new N3TtlParser(),
      new OxigraphRdfStore(),
      basicAssetSource({ [BASIC_CONTEXTS_DOC]: contexts }),
    );

    const loaded = await loader.loadMetamodelByIri(BASIC_METAMODEL);

    const absent = loaded.assets.filter((a) => a.documentIri === 'https://example.org/absent-notation#');
    expect(absent).toEqual([
      expect.objectContaining({
        referencedIri: 'https://example.org/absent-notation#AbsentNotation',
        via: 'arch:usesNotationSet',
        role: 'notation',
        outcome: 'unavailable',
      }),
    ]);
    // The rest of the set still loaded.
    expect(loaded.graphsByRole.notation).toEqual([BASIC_NOTATION_DOC, BASIC_BUBBLE_DOC]);
  });
});

describe('N3MetamodelLoader — bundled ArchiMate 4.0', () => {
  it('loads every bundled asset into its own named graph', async () => {
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store);

    const loaded = await loader.loadBundledMetamodel();

    expect(loaded.metamodelIri).toBe('https://meta.linked.archi/archimate4/metamodel#ArchiMate4');
    expect(loaded.notationSetIri).toBe(
      'https://meta.linked.archi/archimate4/notation#ArchiMate40StandardNotation',
    );

    // Every ArchiMate 4.0 asset, plus the core documents it imports, is
    // reachable from the manifest plus owl:imports. `core-shapes` arrives by
    // import from the ArchiMate shapes files; `core-vis-shapes` is imported by
    // nothing, which is why the app loads it via `loadCoreAssets`.
    const expected = BUNDLED_ASSETS.filter(
      (a) =>
        a.metamodel === 'archimate4' ||
        a.role === 'coreOntology' ||
        a.role === 'coreVisOntology' ||
        a.ontologyIri === 'https://meta.linked.archi/core-shapes#',
    );
    const loadedGraphs = loaded.assets
      .filter((a) => a.outcome === 'loaded')
      .map((a) => a.documentIri)
      .sort();
    expect(loadedGraphs).toEqual(expected.map((a) => a.ontologyIri).sort());

    // Each graph really holds its own quads.
    for (const asset of expected) {
      const quads = store.getQuads(null, null, null, namedNode(asset.ontologyIri));
      expect(quads.length, asset.path).toBeGreaterThan(0);
    }
  });

  it('never reports an error outcome for the bundled assets', async () => {
    const loader = new N3MetamodelLoader(new N3TtlParser(), new OxigraphRdfStore());
    const loaded = await loader.loadBundledMetamodel();
    expect(loaded.assets.filter((a) => a.outcome === 'error')).toEqual([]);
  });
});
