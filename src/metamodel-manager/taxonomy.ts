/**
 * Multi-axis SKOS taxonomy resolution.
 *
 * A real ArchiMate taxonomy classifies the *same* element class along several orthogonal
 * axes at once — "Layer", "Aspect", "Domain". Grouping by a
 * single `skos:broader` hop collapses those axes and lets one silently overwrite another.
 *
 * This module resolves each axis separately and records, for every palette class, its group
 * under every axis (`groupsByAxis`) plus a default `group` taken from the first (preferred) axis.
 *
 * Axes are inferred **structurally** from the graph shape — never from IRI or label pattern
 * matching — so it works across metamodels; a concept the metamodel manifest's
 * `arch:paletteGrouping` names is an axis as well:
 *
 *   - `leaf`  — an element type, which the ontology declares: a child that is not a SKOS concept (the
 *               class itself), or a SKOS concept with no children that stands for a class (rdfs:seeAlso
 *               or the same local name).
 *               A concept with nothing under it and no class behind it is an empty concept, no leaf.
 *   - `group` — a SKOS concept that directly holds at least one leaf (e.g. "Business Layer")
 *   - `axis`  — a SKOS concept that holds no leaf itself, every concept-child of which classifies
 *               something, at least one of them directly (e.g. "Layer"); an empty concept-child is
 *               left out of the count
 *   - a group under no axis and no other group (e.g. "Junction", a top concept of its own) is kept
 *     as a standalone axis of its one group, so its members are classified; it is no way of grouping
 *
 * An axis's groups take the order of the ISO 25964 thesaurus array whose `iso-thes:superOrdinate`
 * is the axis: an ordered collection that lists them (meta's DD-36). The classification stays in
 * `skos:broader`/`skos:narrower`; the array only orders it, and an axis without one has no order.
 *
 * Groups may nest. The published ArchiMate 4.0 aspect axis nests three deep
 * (`Structure` → `Active Structure` → `Internal Active Structure` → members), so members are
 * collected transitively beneath each of the axis's direct children.
 *
 * The module deliberately operates directly on an n3 {@link Store} and has no dependency on the
 * application's `RdfStore` abstraction, so it can be exercised against hand-written Turtle.
 */

import { DataFactory, Store, type Literal, type NamedNode, type Term } from 'n3';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const { namedNode } = DataFactory;

/**
 * `arch:` core namespace. Verified identical to the source implementation's `CORE`
 * constant (`https://meta.linked.archi/core#`).
 */
const CORE = NAMESPACES.arch;
const SKOS_NS = NAMESPACES.skos;

const RDF_TYPE = `${NAMESPACES.rdf}type`;
const RDFS_LABEL = `${NAMESPACES.rdfs}label`;
const RDFS_COMMENT = `${NAMESPACES.rdfs}comment`;
const RDFS_SUBCLASS = `${NAMESPACES.rdfs}subClassOf`;
const RDFS_SEE_ALSO = `${NAMESPACES.rdfs}seeAlso`;
const OWL_CLASS = `${NAMESPACES.owl}Class`;

const SKOS_PREF_LABEL = `${SKOS_NS}prefLabel`;
const SKOS_DEFINITION = `${SKOS_NS}definition`;
const SKOS_NARROWER = `${SKOS_NS}narrower`;
const SKOS_BROADER = `${SKOS_NS}broader`;
const SKOS_IN_SCHEME = `${SKOS_NS}inScheme`;
const SKOS_TOP_CONCEPT_OF = `${SKOS_NS}topConceptOf`;
const SKOS_HAS_TOP_CONCEPT = `${SKOS_NS}hasTopConcept`;
const SKOS_CONCEPT = `${SKOS_NS}Concept`;
const SKOS_CONCEPT_SCHEME = `${SKOS_NS}ConceptScheme`;
const SKOS_MEMBER = `${SKOS_NS}member`;
const SKOS_MEMBER_LIST = `${SKOS_NS}memberList`;
const RDF_FIRST = `${NAMESPACES.rdf}first`;
const RDF_REST = `${NAMESPACES.rdf}rest`;
/**
 * ISO 25964's SKOS extension: a thesaurus array names, with this, the concept whose narrower concepts it
 * lists — an axis's array gives the order of its groups. Not in NAMESPACES, which also prefixes saved files.
 */
const ISO_THES_SUPER_ORDINATE = 'http://purl.org/iso25964/skos-thes#superOrdinate';

const ARCH_CONCEPT_CLASSIFICATION = `${CORE}conceptClassification`;
/** The axes a metamodel's palette groups by, main one first (an ordered collection of axis concepts). */
const ARCH_PALETTE_GROUPING = `${CORE}paletteGrouping`;
/** The abstractness flag actually published in the Linked.Archi ontologies. */
const ARCH_IS_ABSTRACT_CLASS = `${CORE}isAbstractClass`;
const CORE_ELEMENT = `${CORE}Element`;
const CORE_MODEL_CONCEPT = `${CORE}ModelConcept`;
const CORE_QUALIFIED_RELATIONSHIP = `${CORE}QualifiedRelationship`;

/**
 * Namespace consulted only by the OWL-only fallback grouping heuristic, which has no taxonomy
 * to work from and therefore has to guess from the ArchiMate superclass hierarchy.
 */
const ARCHIMATE_ONTO = 'https://meta.linked.archi/archimate4/onto#';

/** Local names that denote relationship classes rather than palette elements. */
const RELATIONSHIP_FRAGMENTS = new Set([
  'Access',
  'Aggregation',
  'Assignment',
  'Association',
  'Composition',
  'DirectedAssociation',
  'Flow',
  'Influence',
  'ReadAccess',
  'ReadWriteAccess',
  'Realization',
  'Serving',
  'Specialization',
  'Triggering',
  'WriteAccess',
]);

/** Local names that denote abstract scaffolding classes rather than palette elements. */
const ABSTRACT_FRAGMENTS = new Set([
  'Element',
  'ActiveStructureElement',
  'BehaviorElement',
  'PassiveStructureElement',
  'CompositeElement',
  'CommonDomainElement',
  'BusinessDomainElement',
  'ApplicationDomainElement',
  'TechnologyDomainElement',
  'StrategyElement',
  'MotivationElement',
  'ImplementationAndMigrationDomainElement',
  'InternalActiveStructureElement',
  'ExternalActiveStructureElement',
]);

/** A classification axis together with its member-to-group mapping. */
export interface TaxonomyAxis {
  /** IRI of the axis concept (or of the scheme, for a synthesised single axis). */
  iri: string;
  /** Human-readable axis label, e.g. "Layer". */
  label: string;
  /**
   * A group under no axis — ArchiMate's Junction, a top concept of its own — kept as an axis of its one
   * group so that its members are classified. It is no way of grouping: a palette does not offer it, and
   * gives its members a section of that group's name.
   */
  standalone?: boolean;
  /**
   * Taxonomy member IRI to its position, 0 first, in the thesaurus array under the group that lists it —
   * ArchiMate's :StructuralStrength under Structural Relationship. Absent for a member no such array lists.
   */
  memberRanks?: Map<string, number>;
  /**
   * Taxonomy member IRI to group label under this axis.
   *
   * The label is the *nearest* group that lists the member. When the axis nests its groups
   * (`Structure` → `Active Structure` → `Internal Active Structure` → members) that is the
   * innermost concept, so the label a member carries is always the label of the concept that
   * actually names it. See {@link topGroups} for the coarse, axis-level bucket.
   */
  groups: Map<string, string>;
  /**
   * Taxonomy member IRI to the label of the axis's *direct* child group the member descends
   * from — the coarse bucket, identical to {@link groups} for a flat axis.
   *
   * Kept alongside `groups` so a UI can render a two-level palette (section = `topGroups`
   * entry, subsection = `groups` entry) without walking the taxonomy again.
   */
  topGroups: Map<string, string>;
  /**
   * Taxonomy member IRI to the position, 0 first, of the axis's direct child group it descends from,
   * in the axis's thesaurus array; empty for an axis without one, and no entry for a group it does not list.
   */
  ranks: Map<string, number>;
}

/** An instantiable palette class resolved from the taxonomy and the OWL ontology. */
export interface SemanticClass {
  /** IRI of the OWL class that gets instantiated. */
  iri: string;
  label: string;
  definition?: string;
  /** Direct `rdfs:subClassOf` parents. */
  superClasses: string[];
  /** Transitive `rdfs:subClassOf` closure (excluding the class itself). */
  transitiveSuperClasses: string[];
  /** Group label under the default (first) classification axis. */
  group: string;
  /** Group label per classification axis IRI — the dual-classification result. */
  groupsByAxis: Record<string, string>;
  /** Position of the class's group per ordered axis IRI ({@link TaxonomyAxis.ranks}). */
  ranksByAxis: Record<string, number>;
  isAbstract: boolean;
}

/** An RDF list's named items, in order (cycle-safe). */
function listItems(store: Store, head: Term): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (let cell: Term | undefined = head; cell && !seen.has(cell.value) && cell.value !== `${NAMESPACES.rdf}nil`; ) {
    seen.add(cell.value);
    const first = store.getObjects(cell, namedNode(RDF_FIRST), null)[0];
    if (first && isNamedNode(first)) items.push(first.value);
    cell = store.getObjects(cell, namedNode(RDF_REST), null)[0];
  }
  return items;
}

/** A collection's members: its `skos:memberList` in order, then any `skos:member` not in it. */
function collectionMembers(store: Store, collection: Term): { members: string[]; ordered: boolean } {
  const head = store.getObjects(collection, namedNode(SKOS_MEMBER_LIST), null)[0];
  const listed = head ? listItems(store, head) : [];
  const unlisted = store
    .getObjects(collection, namedNode(SKOS_MEMBER), null)
    .filter(isNamedNode)
    .map((term) => term.value)
    .filter((iri) => !listed.includes(iri));
  return { members: unique([...listed, ...unlisted]), ordered: listed.length > 0 };
}

/**
 * The axes a loaded metamodel's palette groups by, main one first (`arch:paletteGrouping`): the first
 * metamodel's, in load order, that names any; without `metamodelIris`, any metamodel's. Empty when none does.
 */
export function paletteGroupingOf(store: Store, metamodelIris: readonly string[] = []): string[] {
  const subjects = metamodelIris.length > 0
    ? metamodelIris.map((iri) => namedNode(iri))
    : store.getSubjects(namedNode(ARCH_PALETTE_GROUPING), null, null);
  for (const subject of subjects) {
    for (const grouping of store.getObjects(subject, namedNode(ARCH_PALETTE_GROUPING), null)) {
      const { members } = collectionMembers(store, grouping);
      if (members.length > 0) return members;
    }
  }
  return [];
}

/**
 * Builds the classification axes present in a SKOS taxonomy.
 *
 * The taxonomy is walked using both `skos:narrower` and the inverse of `skos:broader`, so the
 * result is independent of which direction the source data chose to model the hierarchy.
 *
 * Axis detection requires every concept-child of a candidate to classify at least one member
 * (transitively) *and* at least one of them to list members directly. The first condition keeps a
 * half-empty branch from being called an axis; the second is what keeps a mixed root — the top
 * concept that parents several axes — from being reported as an axis itself, since an axis's own
 * children are wrappers that list nothing. A candidate nested inside another candidate is
 * discarded, so a sub-group of an axis is never mistaken for an axis of its own.
 *
 * When the taxonomy is flat (groups but no axis wrapper) a single axis labelled "Classification"
 * is synthesised from every group in the scheme.
 *
 * A concept the palette grouping names (`arch:paletteGrouping`) is an axis whatever its shape;
 * one inferred beneath it is not. Each axis's groups are ranked by its thesaurus array (`ranks`).
 *
 * Axes are ordered by the metamodel whose classification they belong to, in load order — so a
 * language added beside another (Basic beside ArchiMate) never becomes the default grouping of
 * the first one's palette — then by that metamodel's `arch:paletteGrouping`, then by label; the
 * first axis becomes the default classification.
 *
 * @param store n3 store holding the taxonomy (and, optionally, the metamodel manifest).
 * @param metamodelIris The loaded `arch:Metamodel` subjects, in load order. Without them,
 *   any metamodel's palette grouping orders the axes, then their labels.
 * @returns The discovered axes, ordered by preference. Empty when no concept scheme is present.
 */
export function buildClassificationAxes(store: Store, metamodelIris: readonly string[] = []): TaxonomyAxis[] {
  // Prefer the scheme(s) the metamodel manifest points at; otherwise take every declared scheme.
  const schemes = new Set<string>();
  for (const quad of store.getQuads(null, namedNode(ARCH_CONCEPT_CLASSIFICATION), null, null)) {
    if (quad.object.termType === 'NamedNode') schemes.add(quad.object.value);
  }
  const named = schemes.size > 0;
  if (!named) {
    for (const quad of store.getQuads(null, namedNode(RDF_TYPE), namedNode(SKOS_CONCEPT_SCHEME), null)) {
      if (quad.subject.termType === 'NamedNode') schemes.add(quad.subject.value);
    }
  }
  if (schemes.size === 0) return [];

  const schemeConcepts = new Set<string>();
  for (const schemeIri of schemes) {
    for (const term of store.getSubjects(namedNode(SKOS_IN_SCHEME), namedNode(schemeIri), null)) {
      addNamed(schemeConcepts, term);
    }
    for (const term of store.getSubjects(namedNode(SKOS_TOP_CONCEPT_OF), namedNode(schemeIri), null)) {
      addNamed(schemeConcepts, term);
    }
    for (const term of store.getObjects(namedNode(schemeIri), namedNode(SKOS_HAS_TOP_CONCEPT), null)) {
      addNamed(schemeConcepts, term);
    }
  }
  // Anything typed skos:Concept counts too — some data omits inScheme on intermediate nodes.
  // When the manifest names its classification schemes, only a concept beneath one of theirs:
  // a concept of another scheme (a viewpoint catalogue, a scope scheme) is no axis of the palette.
  const typedConcepts = new Set<string>();
  for (const term of store.getSubjects(namedNode(RDF_TYPE), namedNode(SKOS_CONCEPT), null)) {
    addNamed(typedConcepts, term);
  }
  if (!named) {
    for (const iri of typedConcepts) schemeConcepts.add(iri);
  } else {
    const queue = [...schemeConcepts];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const below = [
        ...store.getObjects(namedNode(current), namedNode(SKOS_NARROWER), null),
        ...store.getSubjects(namedNode(SKOS_BROADER), namedNode(current), null),
      ];
      for (const term of below) {
        if (term.termType !== 'NamedNode' || !typedConcepts.has(term.value) || schemeConcepts.has(term.value)) continue;
        schemeConcepts.add(term.value);
        queue.push(term.value);
      }
    }
  }

  const isConcept = (iri: string): boolean => schemeConcepts.has(iri);

  const childrenOf = (conceptIri: string): string[] => {
    const narrower = store
      .getObjects(namedNode(conceptIri), namedNode(SKOS_NARROWER), null)
      .filter(isNamedNode)
      .map((term) => term.value);
    const broaderInverse = store
      .getSubjects(namedNode(SKOS_BROADER), namedNode(conceptIri), null)
      .filter(isNamedNode)
      .map((term) => term.value);
    return unique([...narrower, ...broaderInverse]);
  };

  const conceptChildrenOf = (conceptIri: string): string[] => childrenOf(conceptIri).filter(isConcept);

  /** Broader direction: `skos:broader` plus the inverse of `skos:narrower`. */
  const parentsOf = (conceptIri: string): string[] => {
    const broader = store
      .getObjects(namedNode(conceptIri), namedNode(SKOS_BROADER), null)
      .filter(isNamedNode)
      .map((term) => term.value);
    const narrowerInverse = store
      .getSubjects(namedNode(SKOS_NARROWER), namedNode(conceptIri), null)
      .filter(isNamedNode)
      .map((term) => term.value);
    return unique([...broader, ...narrowerInverse]);
  };

  const isOwlClassIri = (iri: string): boolean =>
    store.getQuads(namedNode(iri), namedNode(RDF_TYPE), namedNode(OWL_CLASS), null).length > 0;

  let classFragments: Set<string> | undefined;
  /**
   * A concept that stands for an ontology class, as `buildClasses` resolves it: `rdfs:seeAlso` from the
   * concept to the class or back, or a class of the same local name.
   */
  const standsForClass = (iri: string): boolean => {
    if (store.getObjects(namedNode(iri), namedNode(RDFS_SEE_ALSO), null).some((term) => isOwlClassIri(term.value))) return true;
    if (store.getSubjects(namedNode(RDFS_SEE_ALSO), namedNode(iri), null).some((term) => isOwlClassIri(term.value))) return true;
    classFragments ??= new Set(
      store.getSubjects(namedNode(RDF_TYPE), namedNode(OWL_CLASS), null).filter(isNamedNode).map((term) => iriFragment(term.value)),
    );
    const fragment = iriFragment(iri);
    return fragment !== '' && classFragments.has(fragment);
  };

  // A member is an element type, which the ontology declares. Two modelling styles list one:
  //   - skos:narrower points straight at the OWL class (a non-concept node) — meta's taxonomies;
  //   - skos:narrower points at a terminal SKOS concept that stands for the class (rdfs:seeAlso, or
  //     the same local name).
  // A concept with nothing under it and no class behind it is an empty concept: a concept, not an
  // element type (ArchiMate 3.2's ArchiMate Element once its dimensions moved out from under it).
  const isMemberLeaf = (iri: string): boolean =>
    !isConcept(iri) || (childrenOf(iri).length === 0 && standsForClass(iri));
  /** A concept with nothing under it that stands for no class: it classifies nothing, yet. */
  const isEmptyConcept = (iri: string): boolean => isConcept(iri) && childrenOf(iri).length === 0 && !isMemberLeaf(iri);
  const membersOf = (conceptIri: string): string[] => childrenOf(conceptIri).filter(isMemberLeaf);

  const labelOf = (iri: string): string => labelFor(store, iri) || fragmentToLabel(iriFragment(iri));

  /** A concept that lists at least one member itself. */
  const isGroup = (iri: string): boolean => isConcept(iri) && membersOf(iri).length > 0;

  /**
   * Every leaf member beneath `rootIri`, paired with the label of the nearest group listing it.
   *
   * Breadth-first so a member listed by the root itself wins over the same member reappearing
   * deeper down, and cycle-safe: published SKOS should be a tree, but a `broader`/`narrower` loop
   * must not spin here. `blocked` seeds the visited set — the caller passes the axis so a back
   * edge out of the sub-tree is not followed.
   */
  const collectMembers = (rootIri: string, blocked: Iterable<string>): Array<[string, string]> => {
    const found: Array<[string, string]> = [];
    const seen = new Set<string>(blocked);
    const queue: string[] = [];
    if (!seen.has(rootIri)) {
      seen.add(rootIri);
      queue.push(rootIri);
    }
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const currentLabel = labelOf(current);
      for (const child of childrenOf(current)) {
        if (isMemberLeaf(child)) {
          found.push([child, currentLabel]);
        } else if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      }
    }
    return found;
  };

  /** True when a concept classifies at least one member, directly or through a sub-group. */
  const holdsMembersCache = new Map<string, boolean>();
  const holdsMembers = (conceptIri: string): boolean => {
    const cached = holdsMembersCache.get(conceptIri);
    if (cached !== undefined) return cached;
    const result = collectMembers(conceptIri, []).length > 0;
    holdsMembersCache.set(conceptIri, result);
    return result;
  };

  /**
   * Candidate axes: a concept that lists no member of its own, whose concept-children all
   * classify something, at least one of them directly.
   *
   * The "at least one directly" clause is what separates an axis from the root above it. An
   * axis's children are groups and a group lists members; a root's children are axes and an axis
   * lists nothing.
   */
  const axisCandidates = new Set<string>();
  // Named by the palette grouping: an axis as published, whatever its shape, if any group is under it.
  const namedAxes = new Set(
    paletteGroupingOf(store, metamodelIris).filter(
      (iri) => isConcept(iri) && conceptChildrenOf(iri).some((child) => holdsMembers(child)),
    ),
  );
  for (const concept of namedAxes) axisCandidates.add(concept);
  for (const concept of schemeConcepts) {
    if (isGroup(concept)) continue;
    // An empty concept beside the groups says nothing either way, so it does not stop its parent being an axis.
    const conceptChildren = conceptChildrenOf(concept).filter((child) => !isEmptyConcept(child));
    if (conceptChildren.length === 0) continue;
    if (!conceptChildren.every((child) => holdsMembers(child))) continue;
    if (!conceptChildren.some((child) => isGroup(child))) continue;
    axisCandidates.add(concept);
  }

  /** True when `conceptIri` sits below another candidate — then that outer one is the axis. */
  const hasCandidateAncestor = (conceptIri: string): boolean => {
    const seen = new Set<string>([conceptIri]);
    const queue = [...parentsOf(conceptIri)];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      if (seen.has(current)) continue;
      seen.add(current);
      if (axisCandidates.has(current)) return true;
      queue.push(...parentsOf(current));
    }
    return false;
  };

  const axisConcepts = [...axisCandidates].filter((concept) => namedAxes.has(concept) || !hasCandidateAncestor(concept));

  /** A concept's narrower concepts in order: the first thesaurus array under it (`iso-thes:superOrdinate`) that lists any. */
  const orderOf = (axisIri: string): string[] => {
    for (const array of store.getSubjects(namedNode(ISO_THES_SUPER_ORDINATE), namedNode(axisIri), null)) {
      const { members, ordered } = collectionMembers(store, array);
      if (ordered && members.length > 0) return members;
    }
    return [];
  };

  const buildAxis = (axisIri: string): TaxonomyAxis => {
    const groups = new Map<string, string>();
    const topGroups = new Map<string, string>();
    const ranks = new Map<string, number>();
    const order = orderOf(axisIri);
    for (const groupIri of conceptChildrenOf(axisIri)) {
      if (!holdsMembers(groupIri)) continue;
      const topLabel = labelOf(groupIri);
      const rank = order.indexOf(groupIri);
      // Transitive: a member nested any number of sub-groups down still belongs to this branch.
      for (const [member, groupLabel] of collectMembers(groupIri, [axisIri])) {
        if (groups.has(member)) continue;
        groups.set(member, groupLabel);
        topGroups.set(member, topLabel);
        if (rank >= 0) ranks.set(member, rank);
      }
    }
    // Within a group, its members' order: the thesaurus array under the group itself (iso-thes:superOrdinate),
    // where it has one — the nearest group's, as a member nested deeper is listed by its own group's array.
    const memberRanks = new Map<string, number>();
    const seen = new Set<string>([axisIri]);
    const queue = [...conceptChildrenOf(axisIri)];
    while (queue.length > 0) {
      const concept = queue.shift() as string;
      if (seen.has(concept)) continue;
      seen.add(concept);
      orderOf(concept).forEach((member, index) => {
        if (groups.has(member) && !memberRanks.has(member)) memberRanks.set(member, index);
      });
      queue.push(...conceptChildrenOf(concept));
    }
    return { iri: axisIri, label: labelOf(axisIri), groups, topGroups, ranks, memberRanks };
  };

  let axes = axisConcepts.map(buildAxis).filter((axis) => axis.groups.size > 0);

  // A group under no axis and no other group — ArchiMate's Junction, a top concept of its own — classifies
  // its members all the same: an element type the taxonomy lists is one, wherever it lists it.
  if (axes.length > 0) {
    const axisSet = new Set(axisConcepts);
    const underAxisOrGroup = (conceptIri: string): boolean => {
      const seen = new Set<string>([conceptIri]);
      const queue = [...parentsOf(conceptIri)];
      while (queue.length > 0) {
        const current = queue.shift() as string;
        if (seen.has(current)) continue;
        seen.add(current);
        if (axisSet.has(current) || isGroup(current)) return true;
        queue.push(...parentsOf(current));
      }
      return false;
    };
    for (const concept of schemeConcepts) {
      if (!isGroup(concept) || axisSet.has(concept) || underAxisOrGroup(concept)) continue;
      const label = labelOf(concept);
      const groups = new Map<string, string>();
      for (const [member, groupLabel] of collectMembers(concept, [])) if (!groups.has(member)) groups.set(member, groupLabel);
      if (groups.size === 0) continue;
      const topGroups = new Map([...groups.keys()].map((member) => [member, label] as [string, string]));
      axes.push({ iri: concept, label, groups, topGroups, ranks: new Map(), standalone: true });
    }
  }

  // Flat taxonomy: groups but no axis wrapper — synthesise one axis over every group.
  if (axes.length === 0) {
    const groups = new Map<string, string>();
    for (const concept of schemeConcepts) {
      if (!isGroup(concept)) continue;
      const groupLabel = labelOf(concept);
      for (const member of membersOf(concept)) {
        if (!groups.has(member)) groups.set(member, groupLabel);
      }
    }
    if (groups.size > 0) {
      const [firstScheme] = [...schemes];
      // Nothing nests here, so every group is its own top-level group.
      axes = [{ iri: firstScheme ?? '', label: 'Classification', groups, topGroups: new Map(groups), ranks: new Map() }];
    }
  }

  // The first-loaded language's axes first: a language added beside it must not
  // become the default grouping of its palette. An axis ranks by the first
  // loaded metamodel whose arch:conceptClassification is the axis's scheme, or
  // whose arch:paletteGrouping names it.
  const schemeRank = new Map<string, number>();
  const groupingRank = new Map<string, number>();
  metamodelIris.forEach((metamodelIri, index) => {
    for (const scheme of store.getObjects(namedNode(metamodelIri), namedNode(ARCH_CONCEPT_CLASSIFICATION), null)) {
      if (!schemeRank.has(scheme.value)) schemeRank.set(scheme.value, index);
    }
    for (const axisIri of paletteGroupingOf(store, [metamodelIri])) {
      if (!groupingRank.has(axisIri)) groupingRank.set(axisIri, index);
    }
  });
  // Within a language, the palette grouping's order: the axes it names first, the main one first.
  const grouping = paletteGroupingOf(store, metamodelIris);
  const groupingPosition = (axisIri: string): number => {
    const position = grouping.indexOf(axisIri);
    return position < 0 ? Number.MAX_SAFE_INTEGER : position;
  };
  const rankOf = (axisIri: string): number => {
    let rank = groupingRank.get(axisIri) ?? Number.MAX_SAFE_INTEGER;
    for (const scheme of [
      ...store.getObjects(namedNode(axisIri), namedNode(SKOS_IN_SCHEME), null),
      ...store.getObjects(namedNode(axisIri), namedNode(SKOS_TOP_CONCEPT_OF), null),
      ...store.getSubjects(namedNode(SKOS_HAS_TOP_CONCEPT), namedNode(axisIri), null),
    ]) {
      rank = Math.min(rank, schemeRank.get(scheme.value) ?? Number.MAX_SAFE_INTEGER);
    }
    return rank;
  };
  axes.sort(
    (a, b) =>
      rankOf(a.iri) - rankOf(b.iri) ||
      Number(a.standalone ?? false) - Number(b.standalone ?? false) ||
      groupingPosition(a.iri) - groupingPosition(b.iri) ||
      a.label.localeCompare(b.label),
  );

  return axes;
}

/**
 * Builds the instantiable palette classes for a set of classification axes.
 *
 * The taxonomy decides which concepts appear and how they are grouped; the OWL ontology supplies
 * the class that is actually instantiated. The two are joined by {@link resolveOwlClass}-style
 * resolution: same IRI, forward `rdfs:seeAlso`, reverse `rdfs:seeAlso`, then local-name match.
 *
 * Excluded from the result: classes in the `arch:` core namespace, classes flagged
 * `arch:isAbstractClass true`, and relationship classes (transitive-closure hit on
 * `arch:QualifiedRelationship`, or a well-known relationship local name).
 *
 * When `axes` is empty there is no taxonomy to drive grouping, so the function falls back to an
 * OWL-only walk over the non-abstract subclasses of `arch:Element` / `arch:ModelConcept`.
 *
 * @param store n3 store holding the taxonomy and the OWL ontology.
 * @param axes Axes from {@link buildClassificationAxes}; the first supplies the default group.
 * @returns Palette classes sorted by group then label.
 */
export function buildClasses(store: Store, axes: TaxonomyAxis[]): SemanticClass[] {
  const allClassIris = new Set<string>();
  for (const term of store.getSubjects(namedNode(RDF_TYPE), namedNode(OWL_CLASS), null)) {
    addNamed(allClassIris, term);
  }
  for (const term of store.getSubjects(null, namedNode(RDFS_SUBCLASS), null)) {
    addNamed(allClassIris, term);
  }

  const superClassMap = new Map<string, string[]>();
  for (const iri of allClassIris) {
    const supers = store
      .getObjects(namedNode(iri), namedNode(RDFS_SUBCLASS), null)
      .filter(isNamedNode)
      .map((term) => term.value);
    superClassMap.set(iri, unique(supers));
  }

  const isOwlClass = (iri: string): boolean =>
    store.getQuads(namedNode(iri), namedNode(RDF_TYPE), namedNode(OWL_CLASS), null).length > 0;

  /** Resolves a taxonomy member IRI to the instantiable OWL class it stands for. */
  const resolveOwlClass = (memberIri: string): string | null => {
    // 1. The member is itself an owl:Class.
    if (isOwlClass(memberIri)) return memberIri;
    // 2. Forward rdfs:seeAlso from the SKOS concept to the OWL class.
    const forward = store
      .getObjects(namedNode(memberIri), namedNode(RDFS_SEE_ALSO), null)
      .filter(isNamedNode)
      .find((term) => isOwlClass(term.value));
    if (forward) return forward.value;
    // 3. Reverse rdfs:seeAlso from the OWL class back to the SKOS concept.
    const reverse = store
      .getSubjects(namedNode(RDFS_SEE_ALSO), namedNode(memberIri), null)
      .filter(isNamedNode)
      .find((term) => isOwlClass(term.value));
    if (reverse) return reverse.value;
    // 4. Last resort: same local name in a different namespace.
    const fragment = iriFragment(memberIri);
    if (fragment) {
      const candidate = [...allClassIris].find((cls) => iriFragment(cls) === fragment);
      if (candidate) return candidate;
    }
    return null;
  };

  if (axes.length > 0) {
    // The union of leaf members across every axis is the set of palette element concepts.
    const memberIris = new Set<string>();
    for (const axis of axes) {
      for (const member of axis.groups.keys()) memberIris.add(member);
    }

    const seenOwl = new Set<string>();
    const taxonomyResult: SemanticClass[] = [];
    for (const memberIri of memberIris) {
      const owlClassIri = resolveOwlClass(memberIri);
      if (!owlClassIri || seenOwl.has(owlClassIri)) continue;
      // A core class (arch:Element, arch:QualifiedRelationship) is never a palette
      // type: languages specialise it — Basic's Node and Connection are the
      // generic ones — and a taxonomy listing one does not make it one.
      if (owlClassIri.startsWith(CORE)) continue;

      if (isAbstractClass(store, owlClassIri)) continue;

      const closure = computeClosure(owlClassIri, superClassMap);
      const isRelationship =
        owlClassIri === CORE_QUALIFIED_RELATIONSHIP ||
        closure.includes(CORE_QUALIFIED_RELATIONSHIP) ||
        RELATIONSHIP_FRAGMENTS.has(iriFragment(owlClassIri));
      if (isRelationship) continue;

      seenOwl.add(owlClassIri);

      // Record the group under each axis; the first axis provides the default group.
      const groupsByAxis: Record<string, string> = {};
      const ranksByAxis: Record<string, number> = {};
      for (const axis of axes) {
        const group = axis.groups.get(memberIri);
        if (group) groupsByAxis[axis.iri] = group;
        const rank = axis.ranks.get(memberIri);
        if (rank !== undefined) ranksByAxis[axis.iri] = rank;
      }
      const primaryAxis = axes[0];
      const defaultGroup =
        (primaryAxis ? groupsByAxis[primaryAxis.iri] : undefined) ?? Object.values(groupsByAxis)[0] ?? 'Other';

      taxonomyResult.push({
        iri: owlClassIri,
        label: labelFor(store, memberIri) || labelFor(store, owlClassIri),
        definition: definitionFor(store, memberIri) || definitionFor(store, owlClassIri),
        superClasses: superClassMap.get(owlClassIri) ?? [],
        transitiveSuperClasses: closure,
        group: defaultGroup,
        groupsByAxis,
        ranksByAxis,
        isAbstract: false,
      });
    }

    return taxonomyResult.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }

  // Fallback: no taxonomy — OWL-only walk over the non-abstract subclasses of arch:Element.
  const owlOnlyResult: SemanticClass[] = [];
  for (const iri of allClassIris) {
    const closure = computeClosure(iri, superClassMap);
    const isSubOfElement = closure.includes(CORE_ELEMENT) || closure.includes(CORE_MODEL_CONCEPT);
    if (!isSubOfElement) continue;
    if (iri === CORE_ELEMENT || iri === CORE_MODEL_CONCEPT) continue;
    if (iri.startsWith(CORE)) continue;

    const fragment = iriFragment(iri);
    const isRelationship = closure.includes(CORE_QUALIFIED_RELATIONSHIP) || RELATIONSHIP_FRAGMENTS.has(fragment);
    if (isRelationship) continue;

    if (isAbstractClass(store, iri) || ABSTRACT_FRAGMENTS.has(fragment)) continue;

    owlOnlyResult.push({
      iri,
      label: labelFor(store, iri),
      definition: definitionFor(store, iri),
      superClasses: superClassMap.get(iri) ?? [],
      transitiveSuperClasses: closure,
      group: groupFor(iri, closure),
      groupsByAxis: {},
      ranksByAxis: {},
      isAbstract: false,
    });
  }

  return owlOnlyResult.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

/**
 * Tests whether a class closure satisfies a domain/range constraint.
 * `arch:Element` and `arch:ModelConcept` are treated as universally permissive.
 *
 * @param closure The class IRI plus its transitive superclasses.
 * @param allowedIri The constraint IRI to check against.
 */
export function matchesClass(closure: string[], allowedIri: string): boolean {
  if (allowedIri === CORE_ELEMENT || allowedIri === CORE_MODEL_CONCEPT) return true;
  return closure.includes(allowedIri);
}

/** True when the class carries `arch:isAbstractClass true`. */
function isAbstractClass(store: Store, iri: string): boolean {
  return store
    .getObjects(namedNode(iri), namedNode(ARCH_IS_ABSTRACT_CLASS), null)
    .some((term) => term.value === 'true');
}

/** Transitive `rdfs:subClassOf` closure of `iri`, excluding `iri` itself. */
function computeClosure(iri: string, superClassMap: Map<string, string[]>): string[] {
  const seen = new Set<string>();
  const stack = [...(superClassMap.get(iri) ?? [])];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const parent of superClassMap.get(current) ?? []) stack.push(parent);
  }
  return [...seen];
}

/** Group heuristic used only by the OWL-only fallback, where no taxonomy exists. */
function groupFor(iri: string, closure: string[]): string {
  const has = (fragment: string): boolean => closure.includes(`${ARCHIMATE_ONTO}${fragment}`) || iri.endsWith(fragment);
  if (has('BusinessDomainElement')) return 'Business';
  if (has('ApplicationDomainElement')) return 'Application';
  if (has('TechnologyDomainElement')) return 'Technology';
  if (has('StrategyElement')) return 'Strategy';
  if (has('MotivationElement')) return 'Motivation';
  if (has('ImplementationAndMigrationDomainElement')) return 'Implementation & Migration';
  if (has('CommonDomainElement')) return 'Common';

  // Last fallback: derive the group from the class's namespace.
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx > 0) {
    const ns = iri.slice(0, hashIdx);
    const lastSegment = ns.split('/').pop() ?? '';
    if (lastSegment && lastSegment !== 'onto') return fragmentToLabel(lastSegment);
  }
  return 'Other';
}

/** Preferred label: `skos:prefLabel`, then `rdfs:label`, then a humanised IRI fragment. */
function labelFor(store: Store, iri: string): string {
  return literalFor(store, iri, SKOS_PREF_LABEL) ?? literalFor(store, iri, RDFS_LABEL) ?? fragmentToLabel(iriFragment(iri));
}

/** Definition: `skos:definition`, then `rdfs:comment`. */
function definitionFor(store: Store, iri: string): string | undefined {
  return literalFor(store, iri, SKOS_DEFINITION) ?? literalFor(store, iri, RDFS_COMMENT);
}

/** First literal value for subject+predicate, preferring the English one. */
function literalFor(store: Store, subject: string, predicate: string): string | undefined {
  const values = store.getObjects(namedNode(subject), namedNode(predicate), null).filter(isLiteral);
  const en = values.find((term) => term.language === 'en');
  return (en ?? values[0])?.value;
}

/** Local name of an IRI: the part after the last `#`, or after the last `/`. */
function iriFragment(iri: string): string {
  return iri.includes('#') ? iri.slice(iri.lastIndexOf('#') + 1) : iri.slice(iri.lastIndexOf('/') + 1);
}

/** Humanises a local name: `BusinessActor` becomes `Business Actor`. */
function fragmentToLabel(fragment: string): string {
  return fragment
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Adds `term.value` to `set` when the term is a named node. */
function addNamed(set: Set<string>, term: Term): void {
  if (isNamedNode(term)) set.add(term.value);
}

function isNamedNode<T extends Term>(term: T): term is Extract<T, NamedNode> {
  return term.termType === 'NamedNode';
}

function isLiteral<T extends Term>(term: T): term is Extract<T, Literal> {
  return term.termType === 'Literal';
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
