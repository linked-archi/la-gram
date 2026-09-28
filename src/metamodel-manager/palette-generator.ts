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
  buildVisualNotations,
  effectiveRenderingMode,
  resolveNotationSetForContext,
  type NotationSet,
  type VisualStyle,
} from './notation.js';
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
const RDFS_SUBCLASS_OF = `${NAMESPACES.rdfs}subClassOf`;
const RDFS_SEE_ALSO = `${NAMESPACES.rdfs}seeAlso`;
const OWL_CLASS = `${NAMESPACES.owl}Class`;
const SKOS_PREF_LABEL = `${NAMESPACES.skos}prefLabel`;
const SKOS_DEFINITION = `${NAMESPACES.skos}definition`;

const ARCH_QUALIFIED_RELATIONSHIP = `${NAMESPACES.arch}QualifiedRelationship`;
const ARCH_RELATIONSHIP_LEGACY = `${NAMESPACES.arch}Relationship`;
const ARCH_UNQUALIFIED_FORM = `${NAMESPACES.arch}unqualifiedForm`;
const ARCH_DOMAIN_INCLUDES = `${NAMESPACES.arch}domainIncludes`;
const ARCH_RANGE_INCLUDES = `${NAMESPACES.arch}rangeIncludes`;
const ARCH_PREF_VIS_NOTATION = `${NAMESPACES.arch}prefVisNotation`;
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

    const elements = semanticClasses.map((cls) =>
      this.toElementTypeInfo(graph, cls, activeAxis, notationSet),
    );
    const elementGroups = this.groupElements(elements, activeAxis);
    const relationshipTypes = this.discoverRelationships(graph, notationSet, taxonomyAxes);

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
   * The notation set to style from: an explicit IRI, else the set a presentation
   * context asks for, else the metamodel's default (resolved inside
   * `buildVisualNotations`).
   */
  private resolveNotationSet(graph: Store, options?: PaletteOptions): NotationSet | null {
    if (options?.notationSetIri) return buildVisualNotations(graph, options.notationSetIri);
    if (options?.presentationContextIri) {
      const fromContext = resolveNotationSetForContext(graph, options.presentationContextIri);
      if (fromContext) return buildVisualNotations(graph, fromContext);
    }
    return buildVisualNotations(graph);
  }

  private toElementTypeInfo(
    graph: Store,
    cls: SemanticClass,
    activeAxis: TaxonomyAxis | undefined,
    notationSet: NotationSet | null,
  ): ElementTypeInfo {
    const notation = notationSet?.notations.get(cls.iri);

    // Fallback documented in the visual notation guide: when the active notation
    // set has no VisualNotation for a class, the class's own
    // arch:prefVisNotation is the pre-rendered image to use.
    const prefVisNotationUri =
      notation?.prefVisNotation ?? objectValue(graph, cls.iri, ARCH_PREF_VIS_NOTATION);
    const prefVisNotation = resolveUri(prefVisNotationUri);
    const iconSymbol = resolveUri(notation?.style?.iconSymbol);

    // The style handed to renderers carries the *resolved* icon URL; the
    // published URI stays available on `iconSymbol`.
    const style: VisualStyle | undefined = notation?.style
      ? { ...notation.style, iconSymbol: iconSymbol?.url ?? notation.style.iconSymbol }
      : undefined;

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
    notationSet: NotationSet | null,
    axes: readonly TaxonomyAxis[] = [],
  ): RelationshipTypeInfo[] {
    const superClassMap = buildSuperClassMap(graph);
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

      const notation = notationSet?.notations.get(iri);
      const prefVisNotation = resolveUri(
        notation?.prefVisNotation ?? objectValue(graph, iri, ARCH_PREF_VIS_NOTATION),
      );

      const named = iri === ARCH_QUALIFIED_RELATIONSHIP ? generic : undefined;
      relationships.push({
        iri,
        label: named?.label || labelFor(graph, iri),
        definition: named?.definition || definitionFor(graph, iri),
        iconUrl: prefVisNotation?.url,
        prefVisNotation,
        relationshipStyle: notation?.relationshipStyle,
        domainTypes,
        rangeTypes,
        unqualifiedPredicateIri,
      });
    }

    return relationships.sort((a, b) => a.label.localeCompare(b.label));
  }

  // ── Viewpoints ───────────────────────────────────────────────────────

  /**
   * The concept IRIs a viewpoint names.
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

/** Map every class IRI in the graph to its direct `rdfs:subClassOf` parents. */
function buildSuperClassMap(graph: Store): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const record = (iri: string): void => {
    if (map.has(iri)) return;
    map.set(
      iri,
      uniqueInOrder(
        graph
          .getObjects(namedNode(iri), namedNode(RDFS_SUBCLASS_OF), null)
          .filter((term) => term.termType === 'NamedNode')
          .map((term) => term.value),
      ),
    );
  };

  for (const subject of graph.getSubjects(namedNode(RDF_TYPE), namedNode(OWL_CLASS), null)) {
    if (subject.termType === 'NamedNode') record(subject.value);
  }
  for (const subject of graph.getSubjects(namedNode(RDFS_SUBCLASS_OF), null, null)) {
    if (subject.termType === 'NamedNode') record(subject.value);
  }
  return map;
}

/** Transitive `rdfs:subClassOf` closure of `iri`, excluding `iri` itself. */
function closureOf(iri: string, superClassMap: Map<string, string[]>): string[] {
  const seen = new Set<string>();
  const stack = [...(superClassMap.get(iri) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const parent of superClassMap.get(current) ?? []) stack.push(parent);
  }
  return [...seen];
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
