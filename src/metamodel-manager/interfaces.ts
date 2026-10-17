/**
 * Metamodel Manager layer interfaces.
 *
 * Handles loading metamodel ontologies from a manifest, generating palettes
 * from the taxonomy + visual-notation layers, and viewpoint filtering.
 */

import type { BundledAssetRole } from './bundled-assets.js';
import type { Decoration, RelationshipVisualStyle, RenderingMode, VisualStyle } from './notation.js';
import type { NotationIndexEntry } from './notation-resolver.js';

// ---------------------------------------------------------------------------
// Metamodel Loader
// ---------------------------------------------------------------------------

/** Metadata extracted from a loaded metamodel ontology. */
export interface MetamodelInfo {
  /** The ontology IRI. */
  iri: string;
  /** dc:title / dcterms:title / skos:prefLabel of the metamodel. */
  name: string;
  /** owl:versionInfo of the metamodel. */
  version: string;
  /** dc:description / dcterms:description of the metamodel. */
  description: string;
}

/** Outcome of trying to load one asset discovered from a manifest. */
export type MetamodelAssetOutcome =
  /** Fetched, parsed and loaded into its own named graph. */
  | 'loaded'
  /** Already present in the store from an earlier step (dedup by document IRI). */
  | 'already-loaded'
  /** Referenced by the manifest but not shipped in this bundle (bundle-only source). */
  | 'not-bundled'
  /** No configured source (upload, network, bundle) could provide it. */
  | 'unavailable'
  /** Deliberately not fetched: the editor has no use for it (derivation rules, templates). */
  | 'skipped'
  /** A source should have had it but the fetch or the parse failed. */
  | 'error';

/**
 * Per-asset record of what happened while loading a metamodel.
 *
 * A caller that wants to report a partial load honestly ("viewpoints and
 * derivation rules are missing") has everything it needs here.
 */
export interface MetamodelAssetStatus {
  /** The IRI as written in the manifest (may name an individual, not a document). */
  referencedIri: string;
  /** The document IRI it resolved to — the named graph key when loaded. */
  documentIri: string;
  /** Which manifest property (or `owl:imports`) pointed at it. */
  via: string;
  /** Role of the bundled asset, when the document IRI matched one. */
  role?: BundledAssetRole;
  outcome: MetamodelAssetOutcome;
  /** Quads loaded into the graph. Present when `outcome === 'loaded'`. */
  quadCount?: number;
  /** Failure detail when `outcome === 'error'`, reason for `skipped`/`unavailable`. */
  message?: string;
  /** Which source answered, when one did. */
  origin?: 'bundled' | 'remote' | 'uploaded';
}

/**
 * Handle describing a metamodel that was loaded from a manifest.
 *
 * `graphsByRole` is the practical part: it names the graph each layer of the
 * language landed in, so a caller can query the taxonomy or the notation graph
 * directly instead of guessing IRIs.
 */
export interface LoadedMetamodel {
  /** IRI of the `arch:Metamodel` subject (e.g. `am4mm:ArchiMate4`). */
  metamodelIri: string;
  /** Graph the manifest document itself was loaded into. */
  manifestGraphIri: string;
  /** Metadata read off the `arch:Metamodel` subject and its ontology. */
  info: MetamodelInfo;
  /** Graph IRIs per bundled-asset role. Multi-valued because `shapes` is. */
  graphsByRole: Partial<Record<BundledAssetRole, string[]>>;
  /** Notation set the manifest names via `arch:notationSet`, when it does. */
  notationSetIri?: string;
  /** Concept scheme the manifest names via `arch:presentationContextScheme`. */
  presentationContextSchemeIri?: string;
  /** One entry per discovered asset, in discovery order. */
  assets: MetamodelAssetStatus[];
}

/** Loads metamodel TTL ontologies and SHACL shapes into the RDF store. */
export interface MetamodelLoader {
  /**
   * Load a single raw TTL document into a named graph keyed by its ontology
   * IRI. Use {@link loadMetamodelFromManifest} for a real multi-file metamodel.
   */
  loadMetamodel(ttlContent: string): Promise<MetamodelInfo>;
  /**
   * Load a metamodel from its `arch:Metamodel` manifest, following the
   * manifest's asset-pointing properties and `owl:imports` transitively.
   */
  loadMetamodelFromManifest(manifestTtl: string): Promise<LoadedMetamodel>;
  /** Load a bundled metamodel (ArchiMate 4.0 by default) with no network. */
  loadBundledMetamodel(idOrIri?: string): Promise<LoadedMetamodel>;
  /** Load a metamodel by its `arch:Metamodel` IRI or manifest document IRI. */
  loadMetamodelByIri(iri: string): Promise<LoadedMetamodel>;
  /** Load the core ontologies and core shapes every model is validated against. */
  loadCoreAssets(): Promise<Partial<Record<BundledAssetRole, string[]>>>;
  /** Drop a metamodel's graphs, keeping those shared with `keep`. */
  unloadMetamodel(loaded: LoadedMetamodel, keep?: readonly LoadedMetamodel[]): string[];
  /** Load one standalone document (extension ontology, shapes file). */
  loadDocument(
    text: string,
    options?: {
      format?: import('./asset-sources.js').AssetFormat;
      role?: BundledAssetRole;
      documentIri?: string;
    },
  ): Promise<MetamodelAssetStatus>;
  loadShapes(ttlContent: string): Promise<void>;
  resolveImports(ontologyIri: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Palette Generator
// ---------------------------------------------------------------------------

/**
 * A URI from the metamodel together with its offline resolution.
 *
 * Icon URIs are published as absolute `https://meta.linked.archi/...` URLs.
 * Offline, they resolve to paths under the bundled asset root — but only for
 * the icon sets this bundle actually ships. Keeping both forms lets a renderer
 * use the bundled path while a caller that has network access (or wants to
 * report what is missing) can still see what the metamodel really said.
 */
export interface ResolvedUri {
  /** The URI exactly as published in the metamodel. */
  sourceUri: string;
  /** Asset-root-relative bundled path, when this bundle ships the file. */
  bundledPath?: string;
  /** What to render: `bundledPath` when present, otherwise `sourceUri`. */
  url: string;
}

/** A classification axis a palette can be grouped by. */
export interface PaletteAxis {
  /** IRI of the axis concept (e.g. "Element by Domain"). */
  iri: string;
  /** Human-readable axis label. */
  label: string;
  /** Group labels under this axis, in palette order. */
  groups: string[];
}

/** Information about a single element type discovered from the metamodel. */
export interface ElementTypeInfo {
  /** IRI of the element type class. */
  iri: string;
  /** skos:prefLabel display label. */
  label: string;
  /** skos:definition / rdfs:comment, when published. */
  definition?: string;
  /**
   * Icon to show in a palette or on a shape, already resolved for offline use.
   *
   * The composite `arch:prefVisNotation` image when there is one, otherwise the
   * `arch-vis:iconSymbol` badge glyph.
   */
  iconUrl?: string;
  /** `arch:prefVisNotation` composite image, source and resolved form. */
  prefVisNotation?: ResolvedUri;
  /** `arch-vis:iconSymbol` badge glyph, source and resolved form. */
  iconSymbol?: ResolvedUri;
  /**
   * Full visual style from the notation lookup (`notation-resolver.ts`): a
   * descriptor for the class itself in the active set or a fallback layer, or,
   * failing that and its own image, the nearest superclass's descriptor in
   * either.
   *
   * `style.iconSymbol` carries the *resolved* URL so a renderer can use it
   * directly; {@link iconSymbol} keeps the published URI.
   */
  style?: VisualStyle;
  /** Rendering mode after the notation guide's fallbacks are applied. */
  renderingMode?: RenderingMode;
  /** Group label under the axis the palette is currently grouped by. */
  group?: string;
  /** Group label per classification axis IRI — the dual-classification result. */
  groupsByAxis?: Record<string, string>;
  /** Whether this type is abstract (should not appear in palette). */
  isAbstract: boolean;
}

/** A group of element types under the active classification axis. */
export interface ElementGroup {
  /** Group label, e.g. "Business Domain". */
  category: string;
  /** IRI of the axis this grouping came from, when a taxonomy supplied it. */
  axisIri?: string;
  /** Element types in this group. */
  elements: ElementTypeInfo[];
}

/** Information about a relationship type discovered from the metamodel. */
export interface RelationshipTypeInfo {
  /** IRI of the relationship type. */
  iri: string;
  /** skos:prefLabel display label. */
  label: string;
  /** skos:definition, when published. */
  definition?: string;
  /** Icon URL, resolved for offline use. */
  iconUrl?: string;
  /** `arch:prefVisNotation` image, source and resolved form. */
  prefVisNotation?: ResolvedUri;
  /**
   * Line style and endpoint decorations from the notation lookup. Carries a
   * colour only when the descriptor states one; renderers draw black otherwise.
   */
  relationshipStyle?: RelationshipVisualStyle;
  /** IRIs of valid source element types (arch:domainIncludes). */
  domainTypes: string[];
  /** IRIs of valid target element types (arch:rangeIncludes). */
  rangeTypes: string[];
  /**
   * IRI of the unqualified (direct) predicate form, from `arch:unqualifiedForm`.
   *
   * Relationship types are modelled twice in the Linked.Archi ontologies: as an
   * `owl:Class` subclassing `arch:QualifiedRelationship` (the palette concept)
   * and as an `owl:ObjectProperty` (the direct triple predicate). This links the
   * former to the latter. Absent when the metamodel declares no mapping.
   */
  unqualifiedPredicateIri?: string;
  /**
   * Ranking score used to order candidates for a given source/target pair.
   *
   * Higher is a better fit. Only populated by rankers such as
   * `RelationshipManager.getValidRelationships`; undefined when the type is
   * listed without reference to a concrete pair (e.g. in a palette).
   */
  score?: number;
  /**
   * Human-readable explanation of why this type was allowed for the queried
   * source/target pair. Undefined outside a pair-specific query.
   */
  reason?: string;
  /**
   * For the queried pair: `true` when the metamodel's relationship tables let a
   * modeller draw this relationship directly, `false` when they permit it only as
   * the conclusion of a derivation. Undefined when the tables do not say, or
   * outside a pair-specific query.
   */
  direct?: boolean;
}

/** Complete palette definition generated from a metamodel. */
export interface PaletteDefinition {
  elementGroups: ElementGroup[];
  relationshipTypes: RelationshipTypeInfo[];
  /** Every classification axis the taxonomy offers — drives a "Group by" UI. */
  axes?: PaletteAxis[];
  /** IRI of the axis the `elementGroups` are grouped by. */
  activeAxisIri?: string;
  /**
   * How the element types were found and grouped: `taxonomy` from the
   * metamodel's classification (`arch:conceptClassification`, SKOS), `owl` by
   * the OWL-only fallback — every non-abstract `arch:Element` subclass, grouped
   * by a heuristic on its name — when no classification is loaded. The palette
   * says so in the second case.
   */
  grouping?: 'taxonomy' | 'owl';
  /** IRI of the active notation set: the one consulted first. */
  notationSetIri?: string;
  /** Label of that notation set. */
  notationSetLabel?: string;
  /**
   * The resolved notation of every class the generator could resolve, keyed by
   * class IRI, plus each relationship class's `arch:unqualifiedForm` predicate.
   *
   * Entries come from the same lookup as the palette entries, so the two agree;
   * the canvas reads this for types the palette does not list (a class no
   * taxonomy names). Classes that resolve to nothing are absent.
   */
  notationIndex?: Record<string, NotationIndexEntry>;

  /**
   * The published marker symbol of each relationship-end decoration
   * (`arch-vis:decorSymbol`), resolved to the bundled copy where this bundle
   * ships one. Renderers draw decorations from these, falling back to built-in
   * geometry for a decoration with no symbol.
   */
  decorationSymbols?: Partial<Record<Decoration, ResolvedUri>>;
}

/** How to build a palette: which axis groups it, which notation styles it. */
export interface PaletteOptions {
  /**
   * Classification axis to group elements by. Defaults to the taxonomy's
   * preferred (first) axis. Ignored when the metamodel declares no such axis.
   */
  axisIri?: string;
  /** Notation set to take visual styles from. Defaults to the metamodel's. */
  notationSetIri?: string;
  /**
   * Presentation context whose `arch:usesNotationSet` selects the notation set.
   * Ignored when {@link notationSetIri} is given.
   */
  presentationContextIri?: string;
  /**
   * The loaded metamodels' default sets (`arch:notationSet`), in load order.
   *
   * With no set chosen, the first that has descriptors is the active set. Every
   * set here except the active one is a fallback layer, consulted for a class
   * the active set does not describe; when a context or an explicit choice
   * picked another set, that includes the first. Without it, the graph's
   * metamodels are used, in IRI order.
   */
  defaultNotationSetIris?: readonly string[];
}

/** Generates UI palettes from metamodel definitions. */
export interface PaletteGenerator {
  generatePalette(metamodelGraph?: string, options?: PaletteOptions): PaletteDefinition;
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
