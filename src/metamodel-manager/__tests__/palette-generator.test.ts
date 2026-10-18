import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { N3MetamodelLoader } from '../metamodel-loader.js';
import { SparqlPaletteGenerator } from '../palette-generator.js';
import type { LoadedMetamodel, PaletteDefinition } from '../interfaces.js';
import {
  AGGREGATION_STYLE,
  ARCH_ELEMENT,
  ASSOCIATION_STYLE,
  ARCH_QUALIFIED_RELATIONSHIP,
  BASIC,
  BASIC_METAMODEL,
  BUBBLE_ELEMENT_STYLE,
  BUBBLE_SET,
  GENERIC_RELATIONSHIP_STYLE,
  RECTANGLE_ELEMENT_STYLE,
  RECTANGLE_SET,
  WORKSHOP_CONTEXT,
  basicAssetSource,
} from './basic-fixture.js';

const EX = 'https://example.org/mm#';
const ONTOLOGY_IRI = 'https://example.org/mm';

/**
 * Hand-written metamodel shaped like the published ones rather than like the
 * old test fixture:
 *
 * - two classification axes over the *same* classes (by Layer, by Aspect), with
 *   `skos:narrower` pointing straight at the OWL classes
 * - abstractness via `arch:isAbstractClass`
 * - relationship types as `owl:Class rdfs:subClassOf arch:QualifiedRelationship`
 *   with the constraints hanging off the `arch:unqualifiedForm` property
 * - an `arch-vis:` notation set, plus a second one to prove set selection works
 * - a viewpoint using `arch:includesConcept`
 */
const TEST_METAMODEL = `
  @prefix owl:      <${NAMESPACES.owl}> .
  @prefix rdf:      <${NAMESPACES.rdf}> .
  @prefix rdfs:     <${NAMESPACES.rdfs}> .
  @prefix xsd:      <${NAMESPACES.xsd}> .
  @prefix dc:       <${NAMESPACES.dc}> .
  @prefix skos:     <${NAMESPACES.skos}> .
  @prefix arch:     <${NAMESPACES.arch}> .
  @prefix arch-vis: <${NAMESPACES['arch-vis']}> .
  @prefix ex:       <${EX}> .

  <${ONTOLOGY_IRI}>
    rdf:type owl:Ontology ;
    dc:title "Test Metamodel" ;
    owl:versionInfo "1.0.0" .

  ex:TestMetamodel
    rdf:type arch:Metamodel ;
    arch:conceptClassification ex:Scheme ;
    arch:notationSet ex:StandardNotation .

  # ── Taxonomy: two axes over the same classes ──────────────────────
  ex:Scheme rdf:type skos:ConceptScheme ; skos:prefLabel "Test Scheme"@en .

  ex:ByLayer
    rdf:type skos:Concept ; skos:inScheme ex:Scheme ;
    skos:prefLabel "Element by Layer"@en ;
    skos:narrower ex:BusinessLayer, ex:ApplicationLayer .

  ex:BusinessLayer
    rdf:type skos:Concept ; skos:inScheme ex:Scheme ;
    skos:prefLabel "Business Layer"@en ;
    skos:narrower ex:Process, ex:Actor .

  ex:ApplicationLayer
    rdf:type skos:Concept ; skos:inScheme ex:Scheme ;
    skos:prefLabel "Application Layer"@en ;
    skos:narrower ex:Component .

  ex:ByAspect
    rdf:type skos:Concept ; skos:inScheme ex:Scheme ;
    skos:prefLabel "Element by Aspect"@en ;
    skos:narrower ex:Behavior, ex:ActiveStructure .

  ex:Behavior
    rdf:type skos:Concept ; skos:inScheme ex:Scheme ;
    skos:prefLabel "Behavior"@en ;
    skos:narrower ex:Process .

  ex:ActiveStructure
    rdf:type skos:Concept ; skos:inScheme ex:Scheme ;
    skos:prefLabel "Active Structure"@en ;
    skos:narrower ex:Actor, ex:Component .

  # ── Ontology ─────────────────────────────────────────────────────
  ex:Element rdf:type owl:Class ; rdfs:subClassOf arch:Element ;
    arch:isAbstractClass true ; skos:prefLabel "Element"@en .

  ex:Process rdf:type owl:Class ; rdfs:subClassOf ex:Element ;
    skos:prefLabel "Process"@en ; skos:definition "Does work."@en .

  ex:Actor rdf:type owl:Class ; rdfs:subClassOf ex:Element ;
    skos:prefLabel "Actor"@en ;
    arch:prefVisNotation <https://meta.linked.archi/archimate4/icons/business-actor.svg> .

  ex:Component rdf:type owl:Class ; rdfs:subClassOf ex:Element ;
    skos:prefLabel "Component"@en .

  # Abstract, and not in the taxonomy: must not reach the palette.
  ex:AbstractThing rdf:type owl:Class ; rdfs:subClassOf ex:Element ;
    arch:isAbstractClass true ; skos:prefLabel "Abstract Thing"@en .

  # ── Relationships ────────────────────────────────────────────────
  ex:serves rdf:type owl:ObjectProperty ;
    skos:prefLabel "Serves"@en ;
    arch:domainIncludes ex:Component ;
    arch:rangeIncludes ex:Process .

  ex:Serving rdf:type owl:Class ;
    rdfs:subClassOf arch:QualifiedRelationship ;
    arch:unqualifiedForm ex:serves ;
    skos:prefLabel "Serving"@en .

  ex:Aggregation rdf:type owl:Class ;
    rdfs:subClassOf arch:QualifiedRelationship ;
    skos:prefLabel "Aggregation"@en .

  # Subclass of a relationship type — reached only by subClassOf+.
  ex:Composition rdf:type owl:Class ;
    rdfs:subClassOf ex:Aggregation ;
    skos:prefLabel "Composition"@en .

  ex:AbstractRelationship rdf:type owl:Class ;
    rdfs:subClassOf arch:QualifiedRelationship ;
    arch:isAbstractClass true ;
    skos:prefLabel "Abstract Relationship"@en .

  # ── Notation ─────────────────────────────────────────────────────
  ex:StandardNotation rdf:type arch-vis:NotationSet ; skos:prefLabel "Standard"@en .
  ex:AltNotation rdf:type arch-vis:NotationSet ; skos:prefLabel "Alternative"@en .

  ex:ProcessNotation
    rdf:type arch-vis:VisualNotation ;
    arch-vis:notationFor ex:Process ;
    arch-vis:inNotationSet ex:StandardNotation ;
    arch-vis:defaultStyle [
      rdf:type arch-vis:Style ;
      arch-vis:shapeType arch-vis:RoundedRectangle ;
      arch-vis:fillColor "#FFFFB5" ;
      arch-vis:lineColor "#000000" ;
      arch-vis:renderingMode arch-vis:ShapeWithBadge ;
      arch-vis:iconSymbol "https://meta.linked.archi/archimate4/icons/glyphs/process.svg"^^xsd:anyURI ;
      arch-vis:iconPlacement arch-vis:TopRight ;
      arch-vis:defaultWidth 120.0 ;
      arch-vis:defaultHeight 55.0 ;
    ] .

  ex:ProcessAltNotation
    rdf:type arch-vis:VisualNotation ;
    arch-vis:notationFor ex:Process ;
    arch-vis:inNotationSet ex:AltNotation ;
    arch-vis:defaultStyle [
      rdf:type arch-vis:Style ;
      arch-vis:shapeType arch-vis:Ellipse ;
      arch-vis:fillColor "#CCCCCC" ;
      arch-vis:renderingMode arch-vis:ShapeOnly ;
    ] .

  ex:ServingNotation
    rdf:type arch-vis:VisualNotation ;
    arch-vis:notationFor ex:Serving ;
    arch-vis:inNotationSet ex:StandardNotation ;
    arch-vis:lineStyle arch-vis:SolidLine ;
    arch-vis:sourceDecor arch-vis:NoDecoration ;
    arch-vis:targetDecor arch-vis:OpenArrowhead .

  # ── Presentation context selecting the alternative notation ──────
  ex:ExecutiveContext
    rdf:type skos:Concept ;
    skos:prefLabel "Executive"@en ;
    arch:usesNotationSet ex:AltNotation .

  # ── Viewpoint (real predicate: arch:includesConcept) ─────────────
  ex:BusinessViewpoint
    rdf:type arch:Viewpoint ;
    skos:prefLabel "Business Viewpoint"@en ;
    arch:includesConcept ex:Process, ex:Actor .

  ex:EmptyViewpoint
    rdf:type arch:Viewpoint ;
    skos:prefLabel "Empty Viewpoint"@en .

  # Names a superclass only: its subclasses are what it includes.
  ex:AnyElementViewpoint
    rdf:type arch:Viewpoint ;
    skos:prefLabel "Any Element Viewpoint"@en ;
    arch:includesConcept ex:Element .
`;

const BY_LAYER = `${EX}ByLayer`;
const BY_ASPECT = `${EX}ByAspect`;

describe('SparqlPaletteGenerator', () => {
  let store: OxigraphRdfStore;
  let generator: SparqlPaletteGenerator;
  let palette: PaletteDefinition;

  beforeEach(async () => {
    store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store);
    generator = new SparqlPaletteGenerator(store);

    await loader.loadMetamodel(TEST_METAMODEL);
    palette = generator.generatePalette(ONTOLOGY_IRI);
  });

  const allElements = (p: PaletteDefinition = palette) => p.elementGroups.flatMap((g) => g.elements);

  describe('element discovery', () => {
    it('says the palette is grouped by the taxonomy', () => {
      expect(palette.grouping).toBe('taxonomy');
    });

    it('says when it falls back to the OWL classes alone: no classification loaded', async () => {
      const bare = new OxigraphRdfStore();
      await new N3MetamodelLoader(new N3TtlParser(), bare).loadMetamodel(`
        @prefix owl:  <${NAMESPACES.owl}> .
        @prefix rdf:  <${NAMESPACES.rdf}> .
        @prefix rdfs: <${NAMESPACES.rdfs}> .
        @prefix arch: <${NAMESPACES.arch}> .
        @prefix ex:   <${EX}> .
        <${ONTOLOGY_IRI}> rdf:type owl:Ontology .
        ex:Widget rdf:type owl:Class ; rdfs:subClassOf arch:Element .
      `);
      const owlOnly = new SparqlPaletteGenerator(bare).generatePalette(ONTOLOGY_IRI);
      expect(owlOnly.grouping).toBe('owl');
      expect(allElements(owlOnly).map((e) => e.iri)).toContain(`${EX}Widget`);
      bare.dispose();
    });

    it('discovers the instantiable classes from the taxonomy', () => {
      const iris = allElements().map((e) => e.iri).sort();
      expect(iris).toEqual([`${EX}Actor`, `${EX}Component`, `${EX}Process`]);
    });

    it('excludes classes flagged arch:isAbstractClass', () => {
      const iris = allElements().map((e) => e.iri);
      expect(iris).not.toContain(`${EX}AbstractThing`);
      expect(iris).not.toContain(`${EX}Element`);
    });

    it('excludes relationship classes from the element entries', () => {
      const iris = allElements().map((e) => e.iri);
      expect(iris).not.toContain(`${EX}Serving`);
      expect(iris).not.toContain(`${EX}Composition`);
    });

    it('carries the skos label and definition', () => {
      const process = allElements().find((e) => e.iri === `${EX}Process`);
      expect(process?.label).toBe('Process');
      expect(process?.definition).toBe('Does work.');
    });
  });

  describe('classification axes', () => {
    it('exposes every axis so a "Group by" selector can be offered', () => {
      const labels = palette.axes?.map((a) => a.label);
      expect(labels).toContain('Element by Layer');
      expect(labels).toContain('Element by Aspect');
    });

    it('groups by the first axis by default', () => {
      expect(palette.activeAxisIri).toBe(BY_LAYER);
      const categories = palette.elementGroups.map((g) => g.category).sort();
      expect(categories).toEqual(['Application Layer', 'Business Layer']);
    });

    it('regroups when another axis is selected', () => {
      const byAspect = generator.generatePalette(ONTOLOGY_IRI, { axisIri: BY_ASPECT });
      expect(byAspect.activeAxisIri).toBe(BY_ASPECT);
      const categories = byAspect.elementGroups.map((g) => g.category).sort();
      expect(categories).toEqual(['Active Structure', 'Behavior']);
      // Same classes, different grouping.
      expect(allElements(byAspect)).toHaveLength(3);
    });

    it('records the group under every axis on each element', () => {
      const actor = allElements().find((e) => e.iri === `${EX}Actor`);
      expect(actor?.groupsByAxis).toEqual({
        [BY_LAYER]: 'Business Layer',
        [BY_ASPECT]: 'Active Structure',
      });
    });

    it('falls back to the default axis when the requested one is unknown', () => {
      const p = generator.generatePalette(ONTOLOGY_IRI, { axisIri: 'https://example.org/nope' });
      expect(p.activeAxisIri).toBe(BY_LAYER);
    });

    it('tags each group with the axis it came from', () => {
      for (const group of palette.elementGroups) {
        expect(group.axisIri).toBe(BY_LAYER);
      }
    });
  });

  describe('visual styles', () => {
    it('attaches the full VisualStyle from the notation set', () => {
      const process = allElements().find((e) => e.iri === `${EX}Process`);
      expect(process?.style).toMatchObject({
        shapeType: 'RoundedRectangle',
        fillColor: '#FFFFB5',
        lineColor: '#000000',
        iconPlacement: 'TopRight',
        renderingMode: 'ShapeWithBadge',
        defaultWidth: 120,
        defaultHeight: 55,
      });
      expect(process?.renderingMode).toBe('ShapeWithBadge');
    });

    it('resolves iconSymbol to a bundled path and keeps the published URI', () => {
      const process = allElements().find((e) => e.iri === `${EX}Process`);
      expect(process?.iconSymbol).toEqual({
        sourceUri: 'https://meta.linked.archi/archimate4/icons/glyphs/process.svg',
        bundledPath: 'archimate4/icons/glyphs/process.svg',
        url: 'archimate4/icons/glyphs/process.svg',
      });
      expect(process?.style?.iconSymbol).toBe('archimate4/icons/glyphs/process.svg');
    });

    it("falls back to the class's own arch:prefVisNotation when the set has no notation", () => {
      const actor = allElements().find((e) => e.iri === `${EX}Actor`);
      expect(actor?.style).toBeUndefined();
      expect(actor?.prefVisNotation?.bundledPath).toBe('archimate4/icons/business-actor.svg');
      expect(actor?.iconUrl).toBe('archimate4/icons/business-actor.svg');
    });

    it('leaves an unstyled, icon-less class without style or icon', () => {
      const component = allElements().find((e) => e.iri === `${EX}Component`);
      expect(component?.style).toBeUndefined();
      expect(component?.iconUrl).toBeUndefined();
    });

    it('uses the metamodel default notation set', () => {
      expect(palette.notationSetIri).toBe(`${EX}StandardNotation`);
      expect(palette.notationSetLabel).toBe('Standard');
    });

    it('honours an explicitly selected notation set', () => {
      const p = generator.generatePalette(ONTOLOGY_IRI, { notationSetIri: `${EX}AltNotation` });
      expect(p.notationSetIri).toBe(`${EX}AltNotation`);
      const process = allElements(p).find((e) => e.iri === `${EX}Process`);
      expect(process?.style?.shapeType).toBe('Ellipse');
      expect(process?.renderingMode).toBe('ShapeOnly');
    });

    it('resolves the notation set through a presentation context', () => {
      const p = generator.generatePalette(ONTOLOGY_IRI, {
        presentationContextIri: `${EX}ExecutiveContext`,
      });
      expect(p.notationSetIri).toBe(`${EX}AltNotation`);
    });
  });

  describe('relationship discovery', () => {
    it('finds classes under arch:QualifiedRelationship, transitively', () => {
      const iris = palette.relationshipTypes.map((r) => r.iri).sort();
      expect(iris).toEqual([`${EX}Aggregation`, `${EX}Composition`, `${EX}Serving`]);
    });

    it('excludes abstract relationship classes', () => {
      const iris = palette.relationshipTypes.map((r) => r.iri);
      expect(iris).not.toContain(`${EX}AbstractRelationship`);
    });

    it('gathers constraints from the arch:unqualifiedForm property', () => {
      const serving = palette.relationshipTypes.find((r) => r.iri === `${EX}Serving`);
      expect(serving?.unqualifiedPredicateIri).toBe(`${EX}serves`);
      expect(serving?.domainTypes).toEqual([`${EX}Component`]);
      expect(serving?.rangeTypes).toEqual([`${EX}Process`]);
    });

    it('attaches the relationship visual style', () => {
      const serving = palette.relationshipTypes.find((r) => r.iri === `${EX}Serving`);
      expect(serving?.relationshipStyle).toEqual({
        lineStyle: 'SolidLine',
        sourceDecor: 'NoDecoration',
        targetDecor: 'OpenArrowhead',
        lineColor: undefined,
      });
    });

    it('labels a relationship with no constraints and leaves them empty', () => {
      const aggregation = palette.relationshipTypes.find((r) => r.iri === `${EX}Aggregation`);
      expect(aggregation?.label).toBe('Aggregation');
      expect(aggregation?.domainTypes).toEqual([]);
      expect(aggregation?.rangeTypes).toEqual([]);
    });
  });

  describe('filterByViewpoint', () => {
    it('filters elements by arch:includesConcept', () => {
      const filtered = generator.filterByViewpoint(palette, `${EX}BusinessViewpoint`);
      const iris = allElements(filtered).map((e) => e.iri).sort();
      expect(iris).toEqual([`${EX}Actor`, `${EX}Process`]);
    });

    it('includes the subclasses of a class the viewpoint names', () => {
      const filtered = generator.filterByViewpoint(palette, `${EX}AnyElementViewpoint`);
      const iris = allElements(filtered).map((e) => e.iri).sort();
      expect(iris).toEqual([`${EX}Actor`, `${EX}Component`, `${EX}Process`]);
    });

    it('drops groups left empty by filtering', () => {
      const filtered = generator.filterByViewpoint(palette, `${EX}BusinessViewpoint`);
      expect(filtered.elementGroups.map((g) => g.category)).toEqual(['Business Layer']);
    });

    it('keeps all relationship types when the viewpoint names none', () => {
      const filtered = generator.filterByViewpoint(palette, `${EX}BusinessViewpoint`);
      expect(filtered.relationshipTypes).toHaveLength(palette.relationshipTypes.length);
    });

    it('returns the palette untouched for a viewpoint that names nothing', () => {
      const filtered = generator.filterByViewpoint(palette, `${EX}EmptyViewpoint`);
      expect(allElements(filtered)).toHaveLength(3);
      expect(filtered.relationshipTypes).toHaveLength(3);
    });

    it('preserves axis metadata through filtering', () => {
      const filtered = generator.filterByViewpoint(palette, `${EX}BusinessViewpoint`);
      expect(filtered.activeAxisIri).toBe(BY_LAYER);
      expect(filtered.axes).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('returns an empty palette for an empty store', async () => {
      const empty = new SparqlPaletteGenerator(new OxigraphRdfStore());
      const p = empty.generatePalette('https://example.org/nothing');
      expect(p.elementGroups).toHaveLength(0);
      expect(p.relationshipTypes).toHaveLength(0);
      expect(p.axes).toEqual([]);
      expect(p.activeAxisIri).toBeUndefined();
    });
  });
});

describe('a predicate a class shares with its subclasses', () => {
  // ex:AnyUse sorts before ex:Use; it is the subclass, and must not take the
  // shared predicate's look.
  const KINDS = `
    @prefix owl:      <${NAMESPACES.owl}> .
    @prefix rdf:      <${NAMESPACES.rdf}> .
    @prefix rdfs:     <${NAMESPACES.rdfs}> .
    @prefix arch:     <${NAMESPACES.arch}> .
    @prefix arch-vis: <${NAMESPACES['arch-vis']}> .
    @prefix ex:       <https://example.org/kinds#> .

    <https://example.org/kinds> rdf:type owl:Ontology .
    ex:Kinds rdf:type arch:Metamodel ; arch:notationSet ex:Set .
    ex:Set rdf:type arch-vis:NotationSet .

    ex:Use rdf:type owl:Class ; rdfs:subClassOf arch:QualifiedRelationship ; arch:unqualifiedForm ex:uses .
    ex:AnyUse rdf:type owl:Class ; rdfs:subClassOf ex:Use ; arch:unqualifiedForm ex:uses .

    ex:UseNotation rdf:type arch-vis:VisualNotation ;
      arch-vis:notationFor ex:Use ; arch-vis:inNotationSet ex:Set ;
      arch-vis:lineStyle arch-vis:DottedLine ;
      arch-vis:sourceDecor arch-vis:NoDecoration ; arch-vis:targetDecor arch-vis:NoDecoration .
    ex:AnyUseNotation rdf:type arch-vis:VisualNotation ;
      arch-vis:notationFor ex:AnyUse ; arch-vis:inNotationSet ex:Set ;
      arch-vis:lineStyle arch-vis:DottedLine ;
      arch-vis:sourceDecor arch-vis:OpenArrowhead ; arch-vis:targetDecor arch-vis:OpenArrowhead .
  `;

  it('draws a bare triple as the class, not as a subclass that sorts first', async () => {
    const store = new OxigraphRdfStore();
    const loaded = await new N3MetamodelLoader(new N3TtlParser(), store).loadMetamodel(KINDS);
    const p = new SparqlPaletteGenerator(store).generatePalette(loaded.metamodelIri);
    const index = p.notationIndex ?? {};
    expect(index['https://example.org/kinds#AnyUse']?.matchedClassIri).toBe('https://example.org/kinds#AnyUse');
    expect(index['https://example.org/kinds#uses']).toEqual(index['https://example.org/kinds#Use']);
  });
});

// ---------------------------------------------------------------------------
// Notation fallback: superclass descriptors and other metamodels' default sets.
// ---------------------------------------------------------------------------

/** The palette's relationship entry for `iri`. */
const relationship = (p: PaletteDefinition, iri: string) => p.relationshipTypes.find((r) => r.iri === iri);

describe('notation fallback layering', () => {
  const STANDARD = `${EX}StandardNotation`;
  let generator: SparqlPaletteGenerator;

  beforeAll(async () => {
    // TEST_METAMODEL beside the Basic asset set loaded through its manifest:
    // two metamodels, each with one default set; Basic's bubble set is named only
    // by a presentation context.
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store, basicAssetSource());
    await loader.loadMetamodel(TEST_METAMODEL);
    await loader.loadMetamodelByIri(BASIC_METAMODEL);
    generator = new SparqlPaletteGenerator(store);
  });

  const element = (p: PaletteDefinition, iri: string) =>
    p.elementGroups.flatMap((g) => g.elements).find((e) => e.iri === iri);

  it("styles basic:Node from the active Basic set's arch:Element descriptor", () => {
    const p = generator.generatePalette(undefined, { notationSetIri: RECTANGLE_SET });
    const node = element(p, `${BASIC}Node`);
    expect(node?.style).toEqual(RECTANGLE_ELEMENT_STYLE);
    expect(node?.renderingMode).toBe('ShapeOnly');
    // The inherited look includes the descriptor's composite image.
    expect(node?.prefVisNotation?.sourceUri).toBe('https://meta.linked.archi/basic/icons/element.svg');
    expect(p.notationIndex?.[`${BASIC}Node`]).toMatchObject({
      source: 'active-superclass',
      notationSetIri: RECTANGLE_SET,
      matchedClassIri: ARCH_ELEMENT,
    });
  });

  it('styles basic:Node from the bubble set when its presentation context is chosen', () => {
    const p = generator.generatePalette(undefined, { presentationContextIri: WORKSHOP_CONTEXT });
    expect(p.notationSetIri).toBe(BUBBLE_SET);
    expect(element(p, `${BASIC}Node`)?.style).toEqual(BUBBLE_ELEMENT_STYLE);
  });

  it('gives basic:Association and basic:Aggregation their own descriptors, with no colour', () => {
    const p = generator.generatePalette(undefined, { notationSetIri: RECTANGLE_SET });

    const association = relationship(p, `${BASIC}Association`);
    expect(association?.relationshipStyle).toEqual({
      lineStyle: 'SolidLine',
      sourceDecor: 'NoDecoration',
      targetDecor: 'NoDecoration',
      lineColor: undefined,
    });
    expect(association?.prefVisNotation?.sourceUri).toBe('https://meta.linked.archi/basic/icons/association.svg');
    expect(p.notationIndex?.[`${BASIC}Association`]).toMatchObject({
      source: 'active',
      notationSetIri: RECTANGLE_SET,
      matchedClassIri: `${BASIC}Association`,
    });
    // The direct predicate a model triple uses resolves the same way.
    expect(p.notationIndex?.[`${BASIC}association`]).toEqual(p.notationIndex?.[`${BASIC}Association`]);

    const aggregation = relationship(p, `${BASIC}Aggregation`);
    expect(aggregation?.relationshipStyle).toEqual({
      lineStyle: 'SolidLine',
      sourceDecor: 'HollowDiamond',
      targetDecor: 'NoDecoration',
      lineColor: undefined,
    });
    expect(p.notationIndex?.[`${BASIC}Aggregation`]).toMatchObject({
      source: 'active',
      matchedClassIri: `${BASIC}Aggregation`,
    });

    for (const entry of [association, aggregation]) expect(entry?.relationshipStyle?.lineColor).toBeUndefined();
  });

  it('with the test language first, keeps its styles and fills the gaps from Basic after the own image', () => {
    const p = generator.generatePalette(undefined, { defaultNotationSetIris: [STANDARD, RECTANGLE_SET] });
    expect(p.notationSetIri).toBe(STANDARD);
    const index = p.notationIndex ?? {};

    // 1. Exact in the active set: unchanged.
    expect(element(p, `${EX}Process`)?.style?.shapeType).toBe('RoundedRectangle');
    expect(index[`${EX}Process`]?.source).toBe('active');
    expect(relationship(p, `${EX}Serving`)?.relationshipStyle?.targetDecor).toBe('OpenArrowhead');
    expect(index[`${EX}Serving`]?.source).toBe('active');

    // 2. Basic's relationship classes keep their own descriptors from its default set.
    expect(relationship(p, `${BASIC}Aggregation`)?.relationshipStyle).toEqual(AGGREGATION_STYLE);
    expect(index[`${BASIC}Aggregation`]).toMatchObject({ source: 'fallback', notationSetIri: RECTANGLE_SET });

    // 3 before 4: the class's own arch:prefVisNotation wins, so no style is borrowed.
    const actor = element(p, `${EX}Actor`);
    expect(actor?.style).toBeUndefined();
    expect(actor?.prefVisNotation?.bundledPath).toBe('archimate4/icons/business-actor.svg');
    expect(index[`${EX}Actor`]?.source).toBe('pref-vis-notation');

    // 4. Nothing published for the class, nothing in the active set: Basic's generic descriptors.
    expect(element(p, `${EX}Component`)?.style).toEqual(RECTANGLE_ELEMENT_STYLE);
    expect(index[`${EX}Component`]).toMatchObject({
      source: 'fallback-superclass',
      notationSetIri: RECTANGLE_SET,
      matchedClassIri: ARCH_ELEMENT,
    });
    expect(element(p, `${BASIC}Node`)?.style).toEqual(RECTANGLE_ELEMENT_STYLE);
    expect(index[`${EX}Composition`]).toMatchObject({
      source: 'fallback-superclass',
      matchedClassIri: ARCH_QUALIFIED_RELATIONSHIP,
    });
  });

  it("with Basic first, the other language keeps what it publishes; Basic's generic descriptors fill only the gaps", () => {
    const p = generator.generatePalette(undefined, { defaultNotationSetIris: [RECTANGLE_SET, STANDARD] });
    expect(p.notationSetIri).toBe(RECTANGLE_SET);
    const index = p.notationIndex ?? {};

    // 2 before 4: an exact descriptor in the other set beats Basic's arch:Element one.
    expect(element(p, `${EX}Process`)?.style?.shapeType).toBe('RoundedRectangle');
    expect(index[`${EX}Process`]).toMatchObject({
      source: 'fallback',
      notationSetIri: STANDARD,
      matchedClassIri: `${EX}Process`,
    });
    expect(index[`${EX}Serving`]).toMatchObject({ source: 'fallback', notationSetIri: STANDARD });

    // 3 before 4: so does the class's own image.
    expect(element(p, `${EX}Actor`)?.style).toBeUndefined();
    expect(index[`${EX}Actor`]?.source).toBe('pref-vis-notation');

    // 4. Nothing published for the class itself: Basic's generic descriptors.
    expect(element(p, `${EX}Component`)?.style).toEqual(RECTANGLE_ELEMENT_STYLE);
    expect(index[`${EX}Component`]).toMatchObject({
      source: 'active-superclass',
      notationSetIri: RECTANGLE_SET,
      matchedClassIri: ARCH_ELEMENT,
    });
    expect(relationship(p, `${EX}Composition`)?.relationshipStyle).toEqual(GENERIC_RELATIONSHIP_STYLE);
    expect(index[`${EX}Composition`]).toMatchObject({
      source: 'active-superclass',
      matchedClassIri: ARCH_QUALIFIED_RELATIONSHIP,
    });
  });

  it('palette entries and the notation index give the same answer for every class', () => {
    for (const options of [
      { defaultNotationSetIris: [STANDARD, RECTANGLE_SET] },
      { defaultNotationSetIris: [RECTANGLE_SET, STANDARD] },
      { presentationContextIri: WORKSHOP_CONTEXT },
    ]) {
      const p = generator.generatePalette(undefined, options);
      const index = p.notationIndex ?? {};
      for (const entry of p.elementGroups.flatMap((g) => g.elements)) {
        expect(index[entry.iri]?.style, entry.iri).toEqual(entry.style);
        expect(index[entry.iri]?.renderingMode, entry.iri).toEqual(entry.renderingMode);
      }
      for (const entry of p.relationshipTypes) {
        expect(index[entry.iri]?.relationshipStyle, entry.iri).toEqual(entry.relationshipStyle);
      }
    }
  });

  it('keeps the index through viewpoint filtering', () => {
    const p = generator.generatePalette(undefined, { notationSetIri: RECTANGLE_SET });
    const filtered = generator.filterByViewpoint(p, `${EX}BusinessViewpoint`);
    expect(filtered.notationIndex).toBe(p.notationIndex);
  });
});

describe('Basic primary beside the bundled ArchiMate 4.0', () => {
  const AM4_ONTO = 'https://meta.linked.archi/archimate4/onto#';
  const AM4_SET = 'https://meta.linked.archi/archimate4/notation#ArchiMate40StandardNotation';
  let palette: PaletteDefinition;

  beforeAll(async () => {
    // Basic first, as the primary metamodel: its rectangle set is active.
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store, basicAssetSource());
    const basic = await loader.loadMetamodelByIri(BASIC_METAMODEL);
    const am4 = await loader.loadBundledMetamodel();
    const defaultNotationSetIris = [basic.notationSetIri, am4.notationSetIri].filter(
      (iri): iri is string => !!iri,
    );
    palette = new SparqlPaletteGenerator(store).generatePalette(undefined, { defaultNotationSetIris });
  }, 60_000);

  it("keeps ArchiMate's filled diamond on am4:Composition: its own descriptor beats Basic's generic line", () => {
    expect(palette.notationSetIri).toBe(RECTANGLE_SET);

    const composition = relationship(palette, `${AM4_ONTO}Composition`);
    expect(composition?.relationshipStyle).toMatchObject({
      lineStyle: 'SolidLine',
      sourceDecor: 'FilledDiamond',
      targetDecor: 'NoDecoration',
    });
    expect(composition?.relationshipStyle?.lineColor).toBeUndefined();
    expect(palette.notationIndex?.[`${AM4_ONTO}Composition`]).toMatchObject({
      source: 'fallback',
      notationSetIri: AM4_SET,
    });

    // Basic's own relationship keeps its own descriptor from the active set.
    expect(relationship(palette, `${BASIC}Association`)?.relationshipStyle).toMatchObject(ASSOCIATION_STYLE);
  });
});

// ---------------------------------------------------------------------------
// The real thing: bundled ArchiMate 4.0, loaded through the manifest loader.
// ---------------------------------------------------------------------------

const AM4 = 'https://meta.linked.archi/archimate4/onto#';

describe('palette from the bundled ArchiMate 4.0 metamodel', () => {
  let loaded: LoadedMetamodel;
  let generator: SparqlPaletteGenerator;
  let palette: PaletteDefinition;

  beforeAll(async () => {
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store);
    loaded = await loader.loadBundledMetamodel();
    generator = new SparqlPaletteGenerator(store);
    palette = generator.generatePalette(loaded.metamodelIri);
  });

  it('loads the manifest and its linked graphs', () => {
    expect(loaded.metamodelIri).toBe('https://meta.linked.archi/archimate4/metamodel#ArchiMate4');
    expect(loaded.info.name).toBe('ArchiMate 4.0 Metamodel');
    expect(loaded.graphsByRole.ontology).toEqual([`${AM4}`]);
    expect(loaded.graphsByRole.taxonomy).toEqual(['https://meta.linked.archi/archimate4/tax#']);
    expect(loaded.graphsByRole.notation).toEqual(['https://meta.linked.archi/archimate4/notation#']);
    expect(loaded.graphsByRole.viewpoints).toEqual([
      'https://meta.linked.archi/archimate4/viewpoints#',
    ]);
    expect(loaded.graphsByRole.presentationContexts).toEqual([
      'https://meta.linked.archi/archimate4/presentation-contexts#',
    ]);
    // Reference data names the values properties take: loaded, so choices are labelled.
    expect(loaded.graphsByRole.referenceData).toEqual(['https://meta.linked.archi/archimate4/reference-data#']);
    // core# and core-vis# arrive through owl:imports, not through the manifest.
    expect(loaded.graphsByRole.coreOntology).toEqual(['https://meta.linked.archi/core#']);
    expect(loaded.graphsByRole.coreVisOntology).toEqual(['https://meta.linked.archi/core-vis#']);
  });

  it('reports the assets it did not load instead of hiding them', () => {
    const skipped = loaded.assets.filter((a) => a.outcome === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.map((a) => a.documentIri)).toContain(
      'https://meta.linked.archi/archimate4/derivation#',
    );
    expect(loaded.assets.some((a) => a.outcome === 'error')).toBe(false);
  });

  it('generates a populated palette', () => {
    const elements = palette.elementGroups.flatMap((g) => g.elements);
    expect(elements.length).toBe(42);
    expect(palette.elementGroups.length).toBe(7);
    expect(palette.relationshipTypes.length).toBe(15);
    expect(palette.notationSetIri).toBe(
      'https://meta.linked.archi/archimate4/notation#ArchiMate40StandardNotation',
    );
  });

  it('groups the elements by domain, with every element in a real group', () => {
    expect(palette.elementGroups.map((g) => g.category)).toEqual([
      'Application Domain',
      'Business Domain',
      'Common Domain',
      'Implementation and Migration Domain',
      'Motivation Domain',
      'Strategy Domain',
      'Technology Domain',
    ]);
  });

  it('offers both element classification axes — the relationship categories group no element', () => {
    expect(palette.axes?.map((a) => a.label)).toEqual([
      'Element by Domain',
      'Element by Aspect',
    ]);
    expect(palette.activeAxisIri).toBe('https://meta.linked.archi/archimate4/tax#ElementByDomain');
  });

  it('styles am4:BusinessActor from the real notation set with a bundled icon', () => {
    const actor = palette.elementGroups
      .flatMap((g) => g.elements)
      .find((e) => e.iri === `${AM4}BusinessActor`);

    expect(actor).toBeDefined();
    expect(actor?.label).toBe('Business Actor');
    expect(actor?.style?.fillColor).toBe('#FFFFB5');
    expect(actor?.style?.shapeType).toBe('Rectangle');
    expect(actor?.renderingMode).toBe('ShapeWithBadge');
    expect(actor?.iconUrl).toBe('archimate4/icons/business-actor.svg');
    expect(actor?.prefVisNotation?.bundledPath).toBe('archimate4/icons/business-actor.svg');
    expect(actor?.iconSymbol?.bundledPath).toBe('archimate4/icons/glyphs/actor.svg');
    // The published URI stays available for callers that can reach the network.
    expect(actor?.prefVisNotation?.sourceUri).toBe(
      'https://meta.linked.archi/archimate4/icons/business-actor.svg',
    );
  });

  it('resolves a shape, fill colour and bundled icon for every element', () => {
    const elements = palette.elementGroups.flatMap((g) => g.elements);
    const unstyled = elements.filter((e) => !e.style?.fillColor || !e.style?.shapeType);
    const withoutBundledIcon = elements.filter((e) => !e.prefVisNotation?.bundledPath);
    expect(unstyled.map((e) => e.iri)).toEqual([]);
    expect(withoutBundledIcon.map((e) => e.iri)).toEqual([]);
  });

  it('finds the eleven relationship types, and the kinds of access and association, with their line styles', () => {
    expect(palette.relationshipTypes.map((r) => r.label)).toEqual([
      'Access',
      'Aggregation',
      'Assignment',
      'Association',
      'Composition',
      'Directed Association',
      'Flow',
      'Influence',
      'Read Access',
      'Read-Write Access',
      'Realization',
      'Serving',
      'Specialization',
      'Triggering',
      'Write Access',
    ]);

    const serving = palette.relationshipTypes.find((r) => r.iri === `${AM4}Serving`);
    expect(serving?.unqualifiedPredicateIri).toBe(`${AM4}serves`);
    expect(serving?.relationshipStyle?.targetDecor).toBe('OpenArrowhead');
    // Constraints live on the unqualified property in ArchiMate 4.0.
    expect(serving?.domainTypes).toContain(`${AM4}BehaviorElement`);
    expect(serving?.rangeTypes).toContain(`${AM4}ActiveStructureElement`);
  });

  it('draws each kind of access and the directed association with their own ends', () => {
    const style = (local: string) => palette.relationshipTypes.find((r) => r.iri === `${AM4}${local}`)?.relationshipStyle;
    expect(style('Access')).toMatchObject({ lineStyle: 'DottedLine', sourceDecor: 'NoDecoration', targetDecor: 'NoDecoration' });
    expect(style('ReadAccess')).toMatchObject({ lineStyle: 'DottedLine', sourceDecor: 'OpenArrowhead', targetDecor: 'NoDecoration' });
    expect(style('WriteAccess')).toMatchObject({ lineStyle: 'DottedLine', sourceDecor: 'NoDecoration', targetDecor: 'OpenArrowhead' });
    expect(style('ReadWriteAccess')).toMatchObject({ sourceDecor: 'OpenArrowhead', targetDecor: 'OpenArrowhead' });
    expect(style('DirectedAssociation')).toMatchObject({ lineStyle: 'SolidLine', sourceDecor: 'NoDecoration', targetDecor: 'HalfArrowhead' });
    // The kinds share their class's predicate; a bare triple is drawn as the class.
    const read = palette.relationshipTypes.find((r) => r.iri === `${AM4}ReadAccess`);
    expect(read?.unqualifiedPredicateIri).toBe(`${AM4}accesses`);
    expect(palette.notationIndex?.[`${AM4}accesses`]).toEqual(palette.notationIndex?.[`${AM4}Access`]);
    expect(palette.notationIndex?.[`${AM4}associatedWith`]).toEqual(palette.notationIndex?.[`${AM4}Association`]);
  });

  it('regroups by the aspect axis with every element in a real group', () => {
    const aspectIri = 'https://meta.linked.archi/archimate4/tax#ElementByAspect';
    const byAspect = generator.generatePalette(loaded.metamodelIri, { axisIri: aspectIri });
    expect(byAspect.activeAxisIri).toBe(aspectIri);

    // The published aspect axis nests its groups (Structure → Active Structure → Internal
    // Active Structure → members), so every level that actually lists members becomes a
    // section. Nothing falls through to "Other".
    expect(byAspect.elementGroups.map((g) => ({ category: g.category, count: g.elements.length }))).toEqual([
      { category: 'Active Structure', count: 3 },
      { category: 'Behavior', count: 4 },
      { category: 'Composite', count: 4 },
      { category: 'Event', count: 1 },
      { category: 'External Active Structure', count: 3 },
      { category: 'External Behavior', count: 1 },
      { category: 'Internal Active Structure', count: 9 },
      { category: 'Internal Behavior', count: 2 },
      { category: 'Motivation', count: 9 },
      { category: 'Passive Structure', count: 5 },
      { category: 'Structure', count: 1 },
    ]);
    // Same 42 classes, only regrouped.
    expect(byAspect.elementGroups.flatMap((g) => g.elements)).toHaveLength(42);
  });

  it('lists the aspect axis groups on the axis descriptor', () => {
    const aspect = palette.axes?.find((a) => a.label === 'Element by Aspect');
    expect(aspect?.groups).toEqual([
      'Active Structure',
      'Behavior',
      'Composite',
      'Event',
      'External Active Structure',
      'External Behavior',
      'Internal Active Structure',
      'Internal Behavior',
      'Motivation',
      'Passive Structure',
      'Structure',
    ]);
  });

  it('filters by a real viewpoint through arch:includesConcept', () => {
    const filtered = generator.filterByViewpoint(
      palette,
      'https://meta.linked.archi/archimate4/viewpoints#OrganizationViewpoint',
    );
    const labels = filtered.elementGroups.flatMap((g) => g.elements).map((e) => e.label).sort();
    // The Organization viewpoint includes BusinessActor, Role, Collaboration,
    // BusinessInterface and Location — and Grouping and the junctions, which
    // Appendix C admits in every viewpoint.
    expect(labels).toEqual(expect.arrayContaining([
      'Business Actor',
      'Business Interface',
      'Collaboration',
      'Grouping',
      'Location',
      'Role',
    ]));
    expect(labels).not.toContain('Process');
  });
});
