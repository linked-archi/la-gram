/**
 * Palette Generator implementation.
 *
 * Builds the tool palette out of the three layers a Linked.Archi metamodel
 * publishes, each of which already has a module of its own:
 *
 * - **taxonomy** (`taxonomy.ts`) — which classes are instantiable, and how they
 *   group along each classification axis ("Element by Domain", "Element by
 *   Aspect"). The axis is what a "Group by" selector switches between.
 * - **notation** (`notation.ts`) — the `arch-vis:` visual style per concept,
 *   scoped to a notation set.
 * - **ontology** — `rdfs:subClassOf+ arch:QualifiedRelationship` for the
 *   relationship types, with `arch:domainIncludes` / `arch:rangeIncludes`
 *   gathered from the class *and* from whatever `arch:unqualifiedForm` names,
 *   exactly as `RelationshipManager` does it.
 *
 * ## Notation lookup
 *
 * Each class is styled by `notation-resolver.ts`, in five steps (Req 2.16).
 *
 * For a class C, the active set A is the set that the active presentation
 * context names with `arch:usesNotationSet`, or else the primary metamodel's
 * `arch:notationSet`. The fallback layers F are the default sets
 * (`arch:notationSet`) of all loaded metamodels except A itself, in load order.
 * F includes the default set of A's own metamodel when a presentation context
 * picked an alternative set.
 *
 * 1. A descriptor in A for C.
 * 2. A descriptor for C in F, the first match in load order.
 * 3. C's own `arch:prefVisNotation`.
 * 4. A descriptor for the nearest superclass of C that has one in A or F. The
 *    walk goes breadth-first over `rdfs:subClassOf`: by distance first, and
 *    superclasses at the same distance in IRI order. It stops at `arch:Element`
 *    and `arch:QualifiedRelationship`. For each superclass, A is checked first,
 *    then F in load order.
 * 5. Built-in defaults. Elements: a rectangle with a white fill and a black
 *    line. Relationships: a solid black line.
 *
 * Anything published for the class itself beats anything inherited; among
 * inherited descriptors the nearest ancestor wins; the active set only breaks
 * ties.
 *
 * Here a set chosen explicitly (`PaletteOptions.notationSetIri`) comes before
 * the context's, and the primary metamodel is the first of
 * `PaletteOptions.defaultNotationSetIris` whose set has descriptors.
 *
 * The palette entries and the `notationIndex` the canvas reads come from the
 * same resolver, so palette and canvas cannot disagree.
 *
 * ## Why this is not SPARQL any more
 *
 * The previous implementation queried `?type rdfs:subClassOf+ arch:Element`,
 * grouped by a single `skos:broader` hop, filtered on `arch:isAbstract`, and
 * looked for `?rel a arch:Relationship`. Against the published ArchiMate 4.0
 * data every one of those is wrong: grouping is multi-axis through
 * `skos:narrower` onto the OWL classes, the abstractness flag is
 * `arch:isAbstractClass`, and `arch:Relationship` does not occur at all —
 * relationship types are `owl:Class`es under `arch:QualifiedRelationship`.
 *
 * `taxonomy.ts` and `notation.ts` encode those rules and operate on an n3
 * `Store`, so this module reads the quads out of the application's `RdfStore`
 * and hands them a snapshot rather than duplicating the logic in SPARQL.
 *
 * ## Icons
 *
 * Icon URIs are published absolute (`https://meta.linked.archi/archimate4/…`).
 * They are passed through {@link resolveIconUri} so the bundled copies load with
 * no network, and the published URI is kept alongside in a {@link ResolvedUri}
 * so a caller with network access can still choose it.
 */

import { DataFactory, Store } from 'n3';
import type { Quad as N3Quad } from 'n3';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { resolveIconUri } from './bundled-assets.js';
import {
  buildClasses,
  buildClassificationAxes,
  isCoreAxis,
  type SemanticClass,
  type TaxonomyAxis,
} from './taxonomy.js';
import {
  buildDecorationSymbols,
  buildVisualNotations,
  effectiveRenderingMode,
  resolveNotationSetForContext,
  type Decoration,
  type NotationSet,
  type VisualNotation,
  type VisualStyle,
} from './notation.js';
import { NOTATION_ROOTS, buildSuperClassMap, closureOf, compareIris } from './class-hierarchy.js';
import {
  NotationResolver,
  orderedFallbackSets,
  storeDefaultNotationSetIris,
  type NotationIndexEntry,
  type ResolvedNotation,
} from './notation-resolver.js';
import type {
  PaletteGenerator,
  PaletteDefinition,
  PaletteOptions,
  PaletteAxis,
  ElementTypeInfo,
  ElementGroup,
  RelationshipTypeInfo,
  ResolvedUri,
} from './interfaces.js';

const { namedNode } = DataFactory;

const RDF_TYPE = `${NAMESPACES.rdf}type`;
const RDFS_LABEL = `${NAMESPACES.rdfs}label`;
const RDFS_COMMENT = `${NAMESPACES.rdfs}comment`;
const RDFS_SEE_ALSO = `${NAMESPACES.rdfs}seeAlso`;
const RDFS_SUBCLASS_OF = `${NAMESPACES.rdfs}subClassOf`;
const SKOS_PREF_LABEL = `${NAMESPACES.skos}prefLabel`;
const SKOS_DEFINITION = `${NAMESPACES.skos}definition`;

const ARCH_QUALIFIED_RELATIONSHIP = `${NAMESPACES.arch}QualifiedRelationship`;
const ARCH_RELATIONSHIP_LEGACY = `${NAMESPACES.arch}Relationship`;
const ARCH_UNQUALIFIED_FORM = `${NAMESPACES.arch}unqualifiedForm`;
const ARCH_DOMAIN_INCLUDES = `${NAMESPACES.arch}domainIncludes`;
const ARCH_RANGE_INCLUDES = `${NAMESPACES.arch}rangeIncludes`;
const ARCH_IS_ABSTRACT_CLASS = `${NAMESPACES.arch}isAbstractClass`;

/**
 * How real viewpoints express membership.
 *
 * Verified against `archimate4-viewpoints.ttl`: every one of the 18 viewpoints
 * uses `arch:includesConcept`, and `arch:permitsElement` /
 * `arch:permitsRelationship` — which the previous implementation assumed —
 * appear nowhere. The core ontology types `arch:includesConcept` with
 * `rdfs:range arch:ModelConcept`, so one predicate covers both elements and
 * relationship types.
 */
const ARCH_INCLUDES_CONCEPT = `${NAMESPACES.arch}includesConcept`;
/** Legacy membership predicates, still honoured for older/hand-written data. */
const ARCH_PERMITS_ELEMENT = `${NAMESPACES.arch}permitsElement`;
const ARCH_PERMITS_RELATIONSHIP = `${NAMESPACES.arch}permitsRelationship`;

/** Group label used when an element has no group under the active axis. */
const UNCATEGORIZED = 'Other';

/**
 * PaletteGenerator over the metamodel quads held in an {@link RdfStore}.
 *
 * Each `generatePalette` call takes a fresh snapshot of the store, so a palette
 * generated after loading more of the metamodel reflects the addition.
 */
export class SparqlPaletteGenerator implements PaletteGenerator {
  constructor(private store: RdfStore) {}

  /**
   * Build a palette from everything currently in the store.
   *
   * @param metamodelGraph Retained for call-site compatibility and used only to
   *   scope the snapshot when that graph exists on its own. A metamodel spans
   *   several named graphs (ontology, taxonomy, notation …), and the taxonomy
   *   and notation layers must see all of them, so by default the snapshot is
   *   the whole store.
   * @param options Which axis to group by and which notation set to style from.
   */
  generatePalette(metamodelGraph?: string, options?: PaletteOptions): PaletteDefinition {
    const graph = this.snapshot();

    const taxonomyAxes = buildClassificationAxes(graph);
    const semanticClasses = buildClasses(graph, taxonomyAxes);

    const activeAxis = this.pickAxis(taxonomyAxes, options?.axisIri);
    const notationSet = this.resolveNotationSet(graph, options);

    // One hierarchy map and one resolver per palette: relationship discovery,
    // the palette entries and the canvas index all read the same answers.
    const superClassMap = buildSuperClassMap(graph);
    const fallbackSets = orderedFallbackSets(
      graph,
      notationSet?.iri,
      options?.defaultNotationSetIris ?? storeDefaultNotationSetIris(graph),
    );
    const resolver = new NotationResolver(graph, notationSet, fallbackSets, superClassMap);

    const elements = semanticClasses.map((cls) => this.toElementTypeInfo(cls, activeAxis, resolver));
    const elementGroups = this.groupElements(elements, activeAxis);
    const relationshipTypes = this.discoverRelationships(graph, resolver, superClassMap, taxonomyAxes);
    const notationIndex = buildNotationIndex(graph, resolver, superClassMap, [
      ...(notationSet ? [notationSet] : []),
      ...fallbackSets,
    ]);

    const axes: PaletteAxis[] = taxonomyAxes.map((axis) => ({
      iri: axis.iri,
      label: axis.label,
      groups: uniqueInOrder([...axis.groups.values()]).sort((a, b) => a.localeCompare(b)),
    }));

    // `metamodelGraph` is deliberately unused for scoping — see the doc above.
    void metamodelGraph;

    return {
      elementGroups,
      relationshipTypes,
      axes,
      activeAxisIri: activeAxis?.iri,
      notationSetIri: notationSet?.iri,
      notationSetLabel: notationSet?.label,
      notationIndex,
      decorationSymbols: resolvedDecorationSymbols(graph),
    };
  }

  /**
   * Restrict a palette to the concepts a viewpoint includes.
   *
   * ArchiMate viewpoints list element types only — `arch:includesConcept` never
   * names a relationship type in the published data. Filtering relationships
   * against an element-only list would empty the relationship section, so
   * relationships are filtered only when the viewpoint actually names at least
   * one of them. A viewpoint that names nothing at all leaves the palette
   * untouched: `arch:includesConcept` is documented as a palette hint, not a
   * restriction.
   */
  filterByViewpoint(palette: PaletteDefinition, viewpointIri: string): PaletteDefinition {
    const included = this.readViewpointConcepts(viewpointIri);
    if (included.size === 0) return palette;

    const elementGroups: ElementGroup[] = palette.elementGroups
      .map((group) => ({ ...group, elements: group.elements.filter((e) => included.has(e.iri)) }))
      .filter((group) => group.elements.length > 0);

    const namedRelationships = palette.relationshipTypes.filter((r) => included.has(r.iri));
    const relationshipTypes =
      namedRelationships.length > 0 ? namedRelationships : palette.relationshipTypes;

    return { ...palette, elementGroups, relationshipTypes };
  }

  // ── Snapshot ─────────────────────────────────────────────────────────

  /**
   * Copy the store's quads into an n3 `Store`.
   *
   * `taxonomy.ts` and `notation.ts` take an n3 `Store` — they are synchronous,
   * unit-testable against hand-written Turtle, and independent of the
   * application's RDF abstraction. Quads keep their graph term; n3 treats a
   * `null` graph argument as a wildcard, which is what both modules pass, so
   * per-document graphs stay visible without special handling.
   */
  private snapshot(): Store {
    const graph = new Store();
    for (const q of this.store.getQuads()) {
      // The application's Quad is @rdfjs/types-shaped and n3's addQuad wants its
      // own term unions; the terms are the same objects (both come from n3's
      // DataFactory), so the assertion is a typing bridge, not a conversion.
      graph.addQuad(
        q.subject as unknown as N3Quad['subject'],
        q.predicate as unknown as N3Quad['predicate'],
        q.object as unknown as N3Quad['object'],
        q.graph as unknown as N3Quad['graph'],
      );
    }
    return graph;
  }

  // ── Elements ─────────────────────────────────────────────────────────

  /** The axis to group by: the requested one, else the taxonomy's preferred one. */
  private pickAxis(axes: TaxonomyAxis[], axisIri?: string): TaxonomyAxis | undefined {
    if (axisIri) {
      const requested = axes.find((axis) => axis.iri === axisIri);
      if (requested) return requested;
    }
    return axes[0];
  }

  /**
   * The active notation set: an explicit IRI, else the set a presentation
   * context asks for, else the first of the loaded metamodels' default sets that
   * has descriptors, else the graph's default (resolved inside
   * `buildVisualNotations`).
   *
   * Taking the primary metamodel's set when the caller gives the load order is
   * what makes the default deterministic with several metamodels loaded: the
   * graph alone yields whichever `arch:notationSet` the store iterates first.
   */
  private resolveNotationSet(graph: Store, options?: PaletteOptions): NotationSet | null {
    if (options?.notationSetIri) return buildVisualNotations(graph, options.notationSetIri);
    if (options?.presentationContextIri) {
      const fromContext = resolveNotationSetForContext(graph, options.presentationContextIri);
      if (fromContext) return buildVisualNotations(graph, fromContext);
    }
    for (const iri of options?.defaultNotationSetIris ?? []) {
      const set = buildVisualNotations(graph, iri);
      if (set) return set;
    }
    return buildVisualNotations(graph);
  }

  private toElementTypeInfo(
    cls: SemanticClass,
    activeAxis: TaxonomyAxis | undefined,
    resolver: NotationResolver,
  ): ElementTypeInfo {
    // The five-step lookup (module doc). Its `prefVisNotation` already applies
    // the guide's fallback to the class's own arch:prefVisNotation.
    const resolved = resolver.resolve(cls.iri);
    const notation = resolved.notation;
    const prefVisNotation = resolveUri(resolved.prefVisNotation);
    const iconSymbol = resolveUri(notation?.style?.iconSymbol);
    const style = styleWithResolvedIcon(notation);

    // Under a chosen axis, a class with no group there goes to "Other" rather
    // than borrowing its label from another axis — mixing axes in one grouping
    // is exactly the collapse this rewrite exists to avoid. With no axis at all
    // the taxonomy's own default group (its OWL-only fallback) is used. The one
    // exception: a class only the core's classification groups (the generic
    // element) keeps that group under a language's axis — no language classifies
    // it, and "Generic" says what it is where "Other" would not.
    const onlyCore = Object.keys(cls.groupsByAxis).length > 0 && Object.keys(cls.groupsByAxis).every(isCoreAxis);
    const group = activeAxis ? (cls.groupsByAxis[activeAxis.iri] ?? (onlyCore ? cls.group : undefined)) : cls.group;

    return {
      iri: cls.iri,
      label: cls.label,
      definition: cls.definition,
      iconUrl: prefVisNotation?.url ?? iconSymbol?.url,
      prefVisNotation,
      iconSymbol,
      style,
      renderingMode: style ? effectiveRenderingMode(style) : undefined,
      group: group || UNCATEGORIZED,
      groupsByAxis: cls.groupsByAxis,
      isAbstract: cls.isAbstract,
    };
  }

  /** Bucket elements by their group under the active axis, groups sorted by label. */
  private groupElements(
    elements: ElementTypeInfo[],
    activeAxis: TaxonomyAxis | undefined,
  ): ElementGroup[] {
    const buckets = new Map<string, ElementTypeInfo[]>();
    for (const element of elements) {
      const category = element.group || UNCATEGORIZED;
      const bucket = buckets.get(category);
      if (bucket) bucket.push(element);
      else buckets.set(category, [element]);
    }

    return [...buckets.entries()]
      .map(([category, groupElements]) => ({
        category,
        axisIri: activeAxis?.iri,
        elements: groupElements.sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  // ── Relationships ────────────────────────────────────────────────────

  /**
   * Relationship types: `owl:Class`es whose `rdfs:subClassOf+` closure reaches
   * `arch:QualifiedRelationship`.
   *
   * `+` rather than `*` because the intermediate steps are real (ArchiMate's
   * `Composition` subclasses `Aggregation`) and `arch:QualifiedRelationship`
   * itself is not a relationship type — unless a loaded taxonomy names it (the
   * core metamodel's "Generic" group): then it is the generic relationship,
   * labelled as the taxonomy labels it. A legacy `?rel a arch:Relationship`
   * typing is also accepted so hand-written metamodels keep working, even though
   * the published ArchiMate 4.0 data never uses it.
   */
  private discoverRelationships(
    graph: Store,
    resolver: NotationResolver,
    superClassMap: Map<string, string[]>,
    axes: readonly TaxonomyAxis[] = [],
  ): RelationshipTypeInfo[] {
    const generic = taxonomyNameFor(graph, axes, ARCH_QUALIFIED_RELATIONSHIP);

    const candidates = new Set<string>();
    for (const [iri, supers] of superClassMap) {
      if (supers.length === 0) continue;
      if (closureOf(iri, superClassMap).includes(ARCH_QUALIFIED_RELATIONSHIP)) candidates.add(iri);
    }
    for (const subject of graph.getSubjects(
      namedNode(RDF_TYPE),
      namedNode(ARCH_RELATIONSHIP_LEGACY),
      null,
    )) {
      if (subject.termType === 'NamedNode') candidates.add(subject.value);
    }

    const relationships: RelationshipTypeInfo[] = [];

    if (generic) candidates.add(ARCH_QUALIFIED_RELATIONSHIP);

    for (const iri of candidates) {
      if (iri === ARCH_QUALIFIED_RELATIONSHIP && !generic) continue;
      if (isAbstractClass(graph, iri)) continue;

      const unqualifiedPredicateIri = objectValue(graph, iri, ARCH_UNQUALIFIED_FORM);

      // ArchiMate 4.0 hangs the constraints off the unqualified *property*
      // (am4:serves), C4 repeats them on both; gather from each and dedupe.
      const constraintSubjects = [iri, ...(unqualifiedPredicateIri ? [unqualifiedPredicateIri] : [])];
      const domainTypes = uniqueInOrder(
        constraintSubjects.flatMap((subject) => objectValues(graph, subject, ARCH_DOMAIN_INCLUDES)),
      );
      const rangeTypes = uniqueInOrder(
        constraintSubjects.flatMap((subject) => objectValues(graph, subject, ARCH_RANGE_INCLUDES)),
      );

      // Same lookup as the elements. A descriptor carries a line colour only
      // when it states one; with none the renderer draws black.
      const resolved = resolver.resolve(iri);
      const prefVisNotation = resolveUri(resolved.prefVisNotation);

      const named = iri === ARCH_QUALIFIED_RELATIONSHIP ? generic : undefined;
      relationships.push({
        iri,
        label: named?.label || labelFor(graph, iri),
        definition: named?.definition || definitionFor(graph, iri),
        iconUrl: prefVisNotation?.url,
        prefVisNotation,
        relationshipStyle: resolved.notation?.relationshipStyle,
        domainTypes,
        rangeTypes,
        unqualifiedPredicateIri,
      });
    }

    return relationships.sort((a, b) => a.label.localeCompare(b.label));
  }

  // ── Viewpoints ───────────────────────────────────────────────────────

  /**
   * The concept IRIs a viewpoint names, and their subclasses — a viewpoint
   * naming a class includes its subclasses, as `ViewpointManager` reads it.
   *
   * Read straight off the store rather than through SPARQL so the IRI never has
   * to be interpolated into a query string.
   */
  private readViewpointConcepts(viewpointIri: string): Set<string> {
    const concepts = new Set<string>();
    const subject = namedNode(viewpointIri);
    for (const predicate of [
      ARCH_INCLUDES_CONCEPT,
      ARCH_PERMITS_ELEMENT,
      ARCH_PERMITS_RELATIONSHIP,
    ]) {
      for (const q of this.store.getQuads(subject, namedNode(predicate), null, null)) {
        if (q.object.termType === 'NamedNode') concepts.add(q.object.value);
      }
    }
    // A Set visits what is added during iteration, so this walks the closure.
    for (const iri of concepts) {
      for (const q of this.store.getQuads(null, namedNode(RDFS_SUBCLASS_OF), namedNode(iri), null)) {
        if (q.subject.termType === 'NamedNode') concepts.add(q.subject.value);
      }
    }
    return concepts;
  }
}

// ── Module-level graph helpers ──────────────────────────────────────────

/**
 * How the core's own classification names a core class, when one of its axes
 * lists it — by a concept pointing at it with `rdfs:seeAlso`.
 */
function taxonomyNameFor(
  graph: Store,
  axes: readonly TaxonomyAxis[],
  classIri: string,
): { label: string; definition?: string } | undefined {
  for (const axis of axes) {
    if (!isCoreAxis(axis.iri)) continue;
    for (const member of axis.groups.keys()) {
      const names =
        member === classIri ||
        graph.getQuads(namedNode(member), namedNode(RDFS_SEE_ALSO), namedNode(classIri), null).length > 0;
      if (names) {
        const definition = definitionFor(graph, member);
        return { label: labelFor(graph, member) || labelFor(graph, classIri), ...(definition ? { definition } : {}) };
      }
    }
  }
  return undefined;
}

/**
 * The canvas's copy of the notation lookup (`PaletteDefinition.notationIndex`).
 *
 * Covers every class the graph declares, every class a consulted set describes
 * (a set may describe a class whose ontology is not loaded) and the two roots;
 * classes that resolve to nothing are left out, so the renderer's defaults
 * apply. Each class's `arch:unqualifiedForm` predicate is added as an alias,
 * because a model triple uses the predicate, never overwriting a class key.
 * A predicate a class shares with its subclasses aliases the class: a bare
 * `am4:accesses` triple is an `am4:Access`, not an `am4:ReadAccess`. Keys are
 * visited in IRI order so a predicate unrelated classes share always aliases
 * the same one.
 */
function buildNotationIndex(
  graph: Store,
  resolver: NotationResolver,
  superClassMap: ReadonlyMap<string, readonly string[]>,
  consultedSets: readonly NotationSet[],
): Record<string, NotationIndexEntry> {
  const classes = new Set<string>([...superClassMap.keys(), ...NOTATION_ROOTS]);
  for (const set of consultedSets) {
    for (const conceptIri of set.notations.keys()) classes.add(conceptIri);
  }
  const ordered = [...classes].sort(compareIris);

  const index = new Map<string, NotationIndexEntry>();
  for (const iri of ordered) {
    const entry = indexEntryFor(resolver.resolve(iri));
    if (entry) index.set(iri, entry);
  }
  for (const iri of ordered) {
    const entry = index.get(iri);
    if (!entry) continue;
    const predicate = objectValue(graph, iri, ARCH_UNQUALIFIED_FORM);
    if (!predicate || index.has(predicate)) continue;
    const inherited = closureOf(iri, superClassMap).some(
      (superClass) => objectValue(graph, superClass, ARCH_UNQUALIFIED_FORM) === predicate,
    );
    if (!inherited) index.set(predicate, entry);
  }
  return Object.fromEntries(index);
}

/** A resolved notation as index data, or `undefined` when nothing applies. */
function indexEntryFor(resolved: ResolvedNotation): NotationIndexEntry | undefined {
  if (resolved.source === 'default') return undefined;
  const style = styleWithResolvedIcon(resolved.notation);
  const relationshipStyle = resolved.notation?.relationshipStyle;
  return {
    source: resolved.source,
    ...(resolved.notationSetIri ? { notationSetIri: resolved.notationSetIri } : {}),
    ...(resolved.matchedClassIri ? { matchedClassIri: resolved.matchedClassIri } : {}),
    // The same derivation as a palette entry's `renderingMode`.
    ...(style ? { style, renderingMode: effectiveRenderingMode(style) } : {}),
    ...(relationshipStyle ? { relationshipStyle } : {}),
  };
}

/**
 * A descriptor's element style as renderers take it: the icon URL resolved to
 * the bundled copy when there is one. The published URI stays available on the
 * palette entry's `iconSymbol`.
 */
function styleWithResolvedIcon(notation: VisualNotation | undefined): VisualStyle | undefined {
  if (!notation?.style) return undefined;
  const iconSymbol = resolveUri(notation.style.iconSymbol);
  return { ...notation.style, iconSymbol: iconSymbol?.url ?? notation.style.iconSymbol };
}

/** True when the class carries `arch:isAbstractClass true`. */
function isAbstractClass(graph: Store, iri: string): boolean {
  return graph
    .getObjects(namedNode(iri), namedNode(ARCH_IS_ABSTRACT_CLASS), null)
    .some((term) => term.value === 'true');
}

/** First object value for subject + predicate, whatever the term type. */
function objectValue(graph: Store, subjectIri: string, predicate: string): string | undefined {
  for (const object of graph.getObjects(namedNode(subjectIri), namedNode(predicate), null)) {
    return object.value;
  }
  return undefined;
}

/** All named-node object values for subject + predicate. */
function objectValues(graph: Store, subjectIri: string, predicate: string): string[] {
  return graph
    .getObjects(namedNode(subjectIri), namedNode(predicate), null)
    .filter((term) => term.termType === 'NamedNode')
    .map((term) => term.value);
}

/** Preferred label: English `skos:prefLabel`, any `skos:prefLabel`, `rdfs:label`, else the IRI fragment. */
function labelFor(graph: Store, iri: string): string {
  for (const predicate of [SKOS_PREF_LABEL, RDFS_LABEL]) {
    const literals = graph
      .getObjects(namedNode(iri), namedNode(predicate), null)
      .filter((term) => term.termType === 'Literal');
    const english = literals.find((term) => 'language' in term && term.language === 'en');
    const chosen = english ?? literals[0];
    if (chosen) return chosen.value;
  }
  return fragmentToLabel(iriFragment(iri));
}

/** Definition: `skos:definition`, then `rdfs:comment`. */
function definitionFor(graph: Store, iri: string): string | undefined {
  return objectValue(graph, iri, SKOS_DEFINITION) ?? objectValue(graph, iri, RDFS_COMMENT);
}

/** Pair a published URI with its bundled path, when this bundle ships one. */
/** {@link buildDecorationSymbols}, each symbol resolved to its bundled copy where there is one. */
function resolvedDecorationSymbols(graph: Store): Partial<Record<Decoration, ResolvedUri>> {
  const resolved: Partial<Record<Decoration, ResolvedUri>> = {};
  for (const [decoration, uri] of Object.entries(buildDecorationSymbols(graph)) as Array<[Decoration, string]>) {
    const symbol = resolveUri(uri);
    if (symbol) resolved[decoration] = symbol;
  }
  return resolved;
}

function resolveUri(sourceUri: string | undefined): ResolvedUri | undefined {
  if (!sourceUri) return undefined;
  const bundledPath = resolveIconUri(sourceUri) ?? undefined;
  return { sourceUri, bundledPath, url: bundledPath ?? sourceUri };
}

/** Local name of an IRI: after the last `#`, or after the last `/`. */
function iriFragment(iri: string): string {
  return iri.includes('#') ? iri.slice(iri.lastIndexOf('#') + 1) : iri.slice(iri.lastIndexOf('/') + 1);
}

/** Humanises a local name: `BusinessActor` becomes `Business Actor`. */
function fragmentToLabel(fragment: string): string {
  return fragment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueInOrder(items: string[]): string[] {
  return [...new Set(items)];
}
