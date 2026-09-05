import { describe, it, expect, beforeEach } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { N3MetamodelLoader } from '../metamodel-loader.js';
import { SparqlPaletteGenerator } from '../palette-generator.js';
import type { PaletteDefinition } from '../interfaces.js';

const METAMODEL_IRI = 'https://example.org/metamodel/test';

/**
 * Test metamodel with:
 * - arch:Element base class
 * - Two categories (Business, Application) via skos:broader
 * - Concrete elements: BusinessProcess, BusinessService (Business category),
 *   ApplicationComponent (Application category), UncategorizedThing (no category)
 * - One abstract element: AbstractElement (should be excluded)
 * - Two relationships: serves (with domain/range), accesses (with multiple domain/range)
 */
const TEST_METAMODEL = `
  @prefix owl:  <${NAMESPACES.owl}> .
  @prefix rdf:  <${NAMESPACES.rdf}> .
  @prefix rdfs: <${NAMESPACES.rdfs}> .
  @prefix dc:   <${NAMESPACES.dc}> .
  @prefix skos: <${NAMESPACES.skos}> .
  @prefix arch: <${NAMESPACES.arch}> .
  @prefix ex:   <https://example.org/metamodel/test#> .

  <${METAMODEL_IRI}>
    rdf:type owl:Ontology ;
    dc:title "Test Metamodel" ;
    owl:versionInfo "1.0.0" ;
    dc:description "Test metamodel for palette generation" .

  # Categories
  ex:BusinessCategory skos:prefLabel "Business" .
  ex:ApplicationCategory skos:prefLabel "Application" .

  # Concrete element types
  ex:BusinessProcess
    rdfs:subClassOf arch:Element ;
    skos:prefLabel "Business Process" ;
    arch:prefVisNotation <https://icons.example.org/bp.svg> ;
    skos:broader ex:BusinessCategory .

  ex:BusinessService
    rdfs:subClassOf arch:Element ;
    skos:prefLabel "Business Service" ;
    skos:broader ex:BusinessCategory .

  ex:ApplicationComponent
    rdfs:subClassOf arch:Element ;
    skos:prefLabel "Application Component" ;
    arch:prefVisNotation <https://icons.example.org/ac.svg> ;
    skos:broader ex:ApplicationCategory .

  ex:UncategorizedThing
    rdfs:subClassOf arch:Element ;
    skos:prefLabel "Uncategorized Thing" .

  # Abstract element (should be excluded from palette)
  ex:AbstractElement
    rdfs:subClassOf arch:Element ;
    skos:prefLabel "Abstract Element" ;
    arch:isAbstract true .

  # Relationship types
  ex:serves
    rdf:type arch:Relationship ;
    skos:prefLabel "Serves" ;
    arch:prefVisNotation <https://icons.example.org/serves.svg> ;
    arch:domainIncludes ex:ApplicationComponent ;
    arch:rangeIncludes ex:BusinessService .

  ex:accesses
    rdf:type arch:Relationship ;
    skos:prefLabel "Accesses" ;
    arch:domainIncludes ex:BusinessProcess ;
    arch:domainIncludes ex:BusinessService ;
    arch:rangeIncludes ex:ApplicationComponent .
`;

/** Viewpoint TTL that permits only Business elements and serves relationship. */
const VIEWPOINT_TTL = `
  @prefix rdf:  <${NAMESPACES.rdf}> .
  @prefix arch: <${NAMESPACES.arch}> .
  @prefix skos: <${NAMESPACES.skos}> .
  @prefix ex:   <https://example.org/metamodel/test#> .

  ex:BusinessViewpoint
    rdf:type arch:Viewpoint ;
    skos:prefLabel "Business Viewpoint" ;
    arch:permitsElement ex:BusinessProcess ;
    arch:permitsElement ex:BusinessService ;
    arch:permitsRelationship ex:serves .
`;

describe('SparqlPaletteGenerator', () => {
  let store: OxigraphRdfStore;
  let generator: SparqlPaletteGenerator;
  let palette: PaletteDefinition;

  beforeEach(async () => {
    const parser = new N3TtlParser();
    store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(parser, store);
    generator = new SparqlPaletteGenerator(store);

    await loader.loadMetamodel(TEST_METAMODEL);
    palette = generator.generatePalette(METAMODEL_IRI);
  });

  describe('generatePalette — element discovery', () => {
    it('discovers all concrete element types', () => {
      const allElements = palette.elementGroups.flatMap((g) => g.elements);
      const iris = allElements.map((e) => e.iri);

      expect(iris).toContain('https://example.org/metamodel/test#BusinessProcess');
      expect(iris).toContain('https://example.org/metamodel/test#BusinessService');
      expect(iris).toContain('https://example.org/metamodel/test#ApplicationComponent');
      expect(iris).toContain('https://example.org/metamodel/test#UncategorizedThing');
      expect(allElements).toHaveLength(4);
    });

    it('excludes abstract element types', () => {
      const allElements = palette.elementGroups.flatMap((g) => g.elements);
      const iris = allElements.map((e) => e.iri);
      expect(iris).not.toContain('https://example.org/metamodel/test#AbstractElement');
    });

    it('populates skos:prefLabel for each element', () => {
      const allElements = palette.elementGroups.flatMap((g) => g.elements);
      const bp = allElements.find((e) => e.iri.endsWith('#BusinessProcess'));
      expect(bp?.label).toBe('Business Process');
    });

    it('populates arch:prefVisNotation when present', () => {
      const allElements = palette.elementGroups.flatMap((g) => g.elements);
      const bp = allElements.find((e) => e.iri.endsWith('#BusinessProcess'));
      expect(bp?.iconUrl).toBe('https://icons.example.org/bp.svg');

      const bs = allElements.find((e) => e.iri.endsWith('#BusinessService'));
      expect(bs?.iconUrl).toBeUndefined();
    });

    it('sets isAbstract to false for all palette elements', () => {
      const allElements = palette.elementGroups.flatMap((g) => g.elements);
      for (const elem of allElements) {
        expect(elem.isAbstract).toBe(false);
      }
    });
  });

  describe('generatePalette — grouping by category', () => {
    it('groups elements by skos:broader category', () => {
      const businessGroup = palette.elementGroups.find(
        (g) => g.category === 'https://example.org/metamodel/test#BusinessCategory',
      );
      expect(businessGroup).toBeDefined();
      expect(businessGroup!.elements).toHaveLength(2);

      const appGroup = palette.elementGroups.find(
        (g) => g.category === 'https://example.org/metamodel/test#ApplicationCategory',
      );
      expect(appGroup).toBeDefined();
      expect(appGroup!.elements).toHaveLength(1);
    });

    it('places uncategorized elements in "Uncategorized" group', () => {
      const uncatGroup = palette.elementGroups.find((g) => g.category === 'Uncategorized');
      expect(uncatGroup).toBeDefined();
      expect(uncatGroup!.elements).toHaveLength(1);
      expect(uncatGroup!.elements[0].iri).toBe(
        'https://example.org/metamodel/test#UncategorizedThing',
      );
    });

    it('each element appears in exactly one group', () => {
      const allElements = palette.elementGroups.flatMap((g) => g.elements);
      const iris = allElements.map((e) => e.iri);
      const uniqueIris = new Set(iris);
      expect(iris.length).toBe(uniqueIris.size);
    });
  });

  describe('generatePalette — relationship discovery', () => {
    it('discovers all relationship types', () => {
      expect(palette.relationshipTypes).toHaveLength(2);
      const iris = palette.relationshipTypes.map((r) => r.iri);
      expect(iris).toContain('https://example.org/metamodel/test#serves');
      expect(iris).toContain('https://example.org/metamodel/test#accesses');
    });

    it('populates label and icon for relationships', () => {
      const serves = palette.relationshipTypes.find((r) => r.iri.endsWith('#serves'));
      expect(serves?.label).toBe('Serves');
      expect(serves?.iconUrl).toBe('https://icons.example.org/serves.svg');

      const accesses = palette.relationshipTypes.find((r) => r.iri.endsWith('#accesses'));
      expect(accesses?.label).toBe('Accesses');
      expect(accesses?.iconUrl).toBeUndefined();
    });

    it('aggregates domain and range types', () => {
      const serves = palette.relationshipTypes.find((r) => r.iri.endsWith('#serves'));
      expect(serves?.domainTypes).toEqual([
        'https://example.org/metamodel/test#ApplicationComponent',
      ]);
      expect(serves?.rangeTypes).toEqual([
        'https://example.org/metamodel/test#BusinessService',
      ]);

      const accesses = palette.relationshipTypes.find((r) => r.iri.endsWith('#accesses'));
      expect(accesses?.domainTypes).toHaveLength(2);
      expect(accesses?.domainTypes).toContain('https://example.org/metamodel/test#BusinessProcess');
      expect(accesses?.domainTypes).toContain('https://example.org/metamodel/test#BusinessService');
      expect(accesses?.rangeTypes).toEqual([
        'https://example.org/metamodel/test#ApplicationComponent',
      ]);
    });
  });

  describe('filterByViewpoint', () => {
    it('filters palette to only permitted types', () => {
      // Load viewpoint data into the store (in default graph for simplicity)
      const parser = new N3TtlParser();
      const result = parser.parse(VIEWPOINT_TTL);
      if (result.ok) store.addQuads(result.quads);

      const filtered = generator.filterByViewpoint(
        palette,
        'https://example.org/metamodel/test#BusinessViewpoint',
      );

      // Only Business elements should remain
      const allElements = filtered.elementGroups.flatMap((g) => g.elements);
      expect(allElements).toHaveLength(2);
      const iris = allElements.map((e) => e.iri);
      expect(iris).toContain('https://example.org/metamodel/test#BusinessProcess');
      expect(iris).toContain('https://example.org/metamodel/test#BusinessService');

      // Only serves relationship should remain
      expect(filtered.relationshipTypes).toHaveLength(1);
      expect(filtered.relationshipTypes[0].iri).toBe(
        'https://example.org/metamodel/test#serves',
      );
    });

    it('removes empty groups after filtering', () => {
      const parser = new N3TtlParser();
      const result = parser.parse(VIEWPOINT_TTL);
      if (result.ok) store.addQuads(result.quads);

      const filtered = generator.filterByViewpoint(
        palette,
        'https://example.org/metamodel/test#BusinessViewpoint',
      );

      // Application and Uncategorized groups should be removed
      const categories = filtered.elementGroups.map((g) => g.category);
      expect(categories).not.toContain('https://example.org/metamodel/test#ApplicationCategory');
      expect(categories).not.toContain('Uncategorized');
    });
  });

  describe('edge cases', () => {
    it('returns empty palette for empty metamodel graph', () => {
      const emptyPalette = generator.generatePalette('https://example.org/nonexistent');
      expect(emptyPalette.elementGroups).toHaveLength(0);
      expect(emptyPalette.relationshipTypes).toHaveLength(0);
    });

    it('handles metamodel with only abstract types', async () => {
      const parser = new N3TtlParser();
      const abstractOnly = `
        @prefix owl:  <${NAMESPACES.owl}> .
        @prefix rdf:  <${NAMESPACES.rdf}> .
        @prefix rdfs: <${NAMESPACES.rdfs}> .
        @prefix dc:   <${NAMESPACES.dc}> .
        @prefix skos: <${NAMESPACES.skos}> .
        @prefix arch: <${NAMESPACES.arch}> .
        @prefix ex2:  <https://example.org/metamodel/abstract#> .

        <https://example.org/metamodel/abstract>
          rdf:type owl:Ontology ;
          dc:title "Abstract Only" .

        ex2:OnlyAbstract
          rdfs:subClassOf arch:Element ;
          skos:prefLabel "Only Abstract" ;
          arch:isAbstract true .
      `;
      const loader = new N3MetamodelLoader(parser, store);
      await loader.loadMetamodel(abstractOnly);

      const p = generator.generatePalette('https://example.org/metamodel/abstract');
      expect(p.elementGroups).toHaveLength(0);
    });
  });
});
