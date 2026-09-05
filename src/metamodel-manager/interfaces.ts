/**
 * Metamodel Manager layer interfaces.
 *
 * Handles loading metamodel ontologies, generating palettes via SPARQL,
 * and managing viewpoint filtering.
 */

// ---------------------------------------------------------------------------
// Metamodel Loader
// ---------------------------------------------------------------------------

/** Metadata extracted from a loaded metamodel ontology. */
export interface MetamodelInfo {
  /** The ontology IRI. */
  iri: string;
  /** dc:title of the metamodel. */
  name: string;
  /** owl:versionInfo of the metamodel. */
  version: string;
  /** dc:description of the metamodel. */
  description: string;
}

/** Loads metamodel TTL ontologies and SHACL shapes into the RDF store. */
export interface MetamodelLoader {
  loadMetamodel(ttlContent: string): Promise<MetamodelInfo>;
  loadShapes(ttlContent: string): Promise<void>;
  resolveImports(ontologyIri: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Palette Generator
// ---------------------------------------------------------------------------

/** Information about a single element type discovered from the metamodel. */
export interface ElementTypeInfo {
  /** IRI of the element type class. */
  iri: string;
  /** skos:prefLabel display label. */
  label: string;
  /** arch:prefVisNotation icon URL (optional). */
  iconUrl?: string;
  /** Whether this type is abstract (should not appear in palette). */
  isAbstract: boolean;
}

/** A group of element types sharing the same skos:broader category. */
export interface ElementGroup {
  /** Category label (from skos:broader). */
  category: string;
  /** Element types in this group. */
  elements: ElementTypeInfo[];
}

/** Information about a relationship type discovered from the metamodel. */
export interface RelationshipTypeInfo {
  /** IRI of the relationship type. */
  iri: string;
  /** skos:prefLabel display label. */
  label: string;
  /** arch:prefVisNotation icon URL (optional). */
  iconUrl?: string;
  /** IRIs of valid source element types (arch:domainIncludes). */
  domainTypes: string[];
  /** IRIs of valid target element types (arch:rangeIncludes). */
  rangeTypes: string[];
}

/** Complete palette definition generated from a metamodel. */
export interface PaletteDefinition {
  elementGroups: ElementGroup[];
  relationshipTypes: RelationshipTypeInfo[];
}

/** Generates UI palettes from metamodel definitions via SPARQL. */
export interface PaletteGenerator {
  generatePalette(metamodelGraph: string): PaletteDefinition;
  filterByViewpoint(palette: PaletteDefinition, viewpointIri: string): PaletteDefinition;
}

// ---------------------------------------------------------------------------
// Viewpoint Manager
// ---------------------------------------------------------------------------

/** Information about a viewpoint defined in the metamodel. */
export interface ViewpointInfo {
  /** IRI of the viewpoint. */
  iri: string;
  /** Display label. */
  label: string;
  /** Permitted element type IRIs. */
  permittedElements: string[];
  /** Permitted relationship type IRIs. */
  permittedRelationships: string[];
}

/** Manages viewpoint definitions and type filtering. */
export interface ViewpointManager {
  getViewpoints(): ViewpointInfo[];
  getPermittedTypes(viewpointIri: string): { elements: string[]; relationships: string[] };
}
