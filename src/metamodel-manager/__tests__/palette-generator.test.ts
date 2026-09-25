import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { N3MetamodelLoader } from '../metamodel-loader.js';
import { SparqlPaletteGenerator } from '../palette-generator.js';
import type { LoadedMetamodel, PaletteDefinition } from '../interfaces.js';

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
    expect(palette.relationshipTypes.length).toBe(11);
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

  it('offers both published classification axes', () => {
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

  it('finds the eleven relationship types with their line styles', () => {
    expect(palette.relationshipTypes.map((r) => r.label)).toEqual([
      'Access',
      'Aggregation',
      'Assignment',
      'Association',
      'Composition',
      'Flow',
      'Influence',
      'Realization',
      'Serving',
      'Specialization',
      'Triggering',
    ]);

    const serving = palette.relationshipTypes.find((r) => r.iri === `${AM4}Serving`);
    expect(serving?.unqualifiedPredicateIri).toBe(`${AM4}serves`);
    expect(serving?.relationshipStyle?.targetDecor).toBe('OpenArrowhead');
    // Constraints live on the unqualified property in ArchiMate 4.0.
    expect(serving?.domainTypes).toContain(`${AM4}BehaviorElement`);
    expect(serving?.rangeTypes).toContain(`${AM4}ActiveStructureElement`);
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
      'https://meta.linked.archi/archimate4/viewpoints#Organization',
    );
    const labels = filtered.elementGroups.flatMap((g) => g.elements).map((e) => e.label).sort();
    // The Organization viewpoint includes BusinessActor, Role, Collaboration,
    // BusinessInterface and Location.
    expect(labels).toEqual([
      'Business Actor',
      'Business Interface',
      'Collaboration',
      'Location',
      'Role',
    ]);
  });
});
