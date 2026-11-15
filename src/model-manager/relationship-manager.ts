/**
 * Relationship Manager — CRUD operations for architecture relationships.
 *
 * Creates, queries, and deletes relationships in the RDF store,
 * supporting both direct triples and `arch:QualifiedRelationship` resources.
 *
 * ## How relationship validity is decided
 *
 * **The relationship shapes first.** Where the metamodel publishes them —
 * ArchiMate 4.0 and 3.2 encode the specification's relationship matrix as SHACL
 * — they decide what {@link OxigraphRelationshipManager.getValidRelationships}
 * answers, exactly as validation would (`relationship-table.ts`, read once per
 * set of loaded graphs; a shape on a relationship superclass applies to its
 * subclasses). The hints below decide only for relationship types no shape
 * covers — metamodels without relationship shapes.
 *
 * **What is proposed first.** In three groups (core's `arch:relationshipProposalOrder`):
 * what the relationship tables let a modeller draw directly, or say nothing
 * about; then what they permit only as the conclusion of a derivation (`direct:
 * false`); then the fallbacks — Association and a generic relationship (Basic's
 * Connection), which every pair admits and which say least — unless an order
 * scoped to the pair lists one, as ArchiMate's does association to a meaning or
 * a value. Within a group, a candidate takes the place the most specific order
 * of proposal that lists it gives it (`proposal-order.ts`): between two
 * behaviour elements triggering and flow first, from a service serving, the
 * strongest first elsewhere. What no order lists — every candidate, in a
 * language that publishes none — comes after what an order lists: one whose
 * `arch:domainIncludes` / `arch:rangeIncludes` hints describe the pair before one
 * they do not, then the score's small nudges, then the label. Whether the
 * language's metamodel figures draw a relationship does not move it; it is
 * said (`drawn`).
 *
 * `arch:domainIncludes` / `arch:rangeIncludes` are `owl:AnnotationProperty`
 * *hints*, not `rdfs:domain` / `rdfs:range` axioms. The core ontology is
 * explicit: they are "used for guiding modelling but not restricting
 * relationships … not to be used for validation". Two consequences drive the
 * matching logic here:
 *
 * 1. **Constraints are declared broadly.** ArchiMate's `serves` declares
 *    `arch:domainIncludes am4:ActiveStructureElement`, not each of the ~60
 *    concrete leaf classes. Matching therefore runs against the transitive
 *    `rdfs:subClassOf*` closure of the source and target types, not their exact
 *    IRIs.
 * 2. **Absent means unconstrained.** A relationship type that declares no
 *    domain (or no range) is permitted between anything, rather than forbidden
 *    everywhere.
 *
 * ## Where the constraints live
 *
 * Metamodels split a relationship type across two resources — an
 * `owl:ObjectProperty` for the direct predicate and an `owl:Class` subclassing
 * `arch:QualifiedRelationship` for the palette concept, linked by
 * `arch:unqualifiedForm` — and they do not agree on which of the two carries the
 * constraints:
 *
 * - ArchiMate 4.0 declares `am4:Serving a owl:Class ; rdfs:subClassOf
 *   arch:QualifiedRelationship ; arch:unqualifiedForm am4:serves` with no
 *   constraints on the class at all, hanging `arch:domainIncludes` /
 *   `arch:rangeIncludes` off the *property* `am4:serves`.
 * - C4 declares `c4:Using` the same way but repeats the constraints on *both*
 *   the class and the property `c4:uses`.
 *
 * Constraints are consequently gathered from the class and from whatever
 * `arch:unqualifiedForm` points at, de-duplicated, so no metamodel-specific
 * fallback table is needed.
 *
 * ## Which graphs the metamodel queries read
 *
 * `N3MetamodelLoader` puts each metamodel document in its own named graph, so
 * an unscoped pattern — which in SPARQL means the default graph alone — finds
 * none of it. Every read below therefore goes through {@link GraphScope}, which
 * spans the default graph *and* every named graph; see `graph-scope.ts` for why
 * that is expressed as two runs of the same query rather than a `GRAPH ?g`
 * union. The relationship *writes* stay in the default graph, alongside the
 * rest of the model data.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import type { RelationshipTypeInfo } from '../metamodel-manager/interfaces.js';
import { matchesClass } from '../metamodel-manager/taxonomy.js';
import { isGenericRelationshipType } from '../metamodel-manager/class-hierarchy.js';
import type {
  CreateRelationshipRequest,
  RelationshipInfo,
  RelationshipManager,
} from './interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { graphScope, isSafeIri, type GraphScope } from '../rdf-engine/graph-scope.js';
import { mintIri, namespaceOfIri } from '../rdf-engine/iri.js';
import { modelNamespace } from './model-namespace.js';
import { readRelationshipTable, type RelationshipTable } from './relationship-table.js';
import { readDirectPermissions, readDrawnPermissions, type TablePermissions } from './direct-permissions.js';
import { compareProposals, isProposed, readProposalOrders, type ProposalOrders, type Proposal } from './proposal-order.js';
import {
  collectRelationshipQuads,
  qualifiedFormOf,
  qualifiedPointerQuads,
  relationshipClassOf,
  relationshipsTouching,
  unqualifiedFormOf,
} from './cascade.js';
import { IRI, T, langLiteral, nn, triple, tripleTerm } from './vocabulary.js';

const { namedNode, quad } = DataFactory;

const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const ARCH_QUALIFIED_RELATIONSHIP = namedNode(NAMESPACES.arch + 'QualifiedRelationship');
const ARCH_SOURCE = namedNode(NAMESPACES.arch + 'source');
const ARCH_TARGET = namedNode(NAMESPACES.arch + 'target');

/**
 * `arch:Element` — the universal element superclass. Treated as a wildcard by
 * {@link matchesClass}: a constraint naming it says "anything".
 */
const ARCH_ELEMENT = NAMESPACES.arch + 'Element';
/** `arch:ModelConcept` — superclass of both elements and relationships; also a wildcard. */
const ARCH_MODEL_CONCEPT = NAMESPACES.arch + 'ModelConcept';

// ── Ranking weights ────────────────────────────────────────────────────

/** Every candidate that passes domain/range matching starts here. */
const BASE_SCORE = 10;
/** Added when the source type is named directly in `arch:domainIncludes`. */
const EXACT_SOURCE_BONUS = 5;
/** Added when the target type is named directly in `arch:rangeIncludes`. */
const EXACT_TARGET_BONUS = 5;
/** Association carries almost no semantics, so it sinks below everything else. */
const ASSOCIATION_PENALTY = 4;
/** Composition and aggregation are valid nearly everywhere; nudge them down. */
const CONTAINMENT_PENALTY = 1;
/** Specialization is valid between any two elements of one type; nudge it down too. */
const SPECIALIZATION_PENALTY = 1;
/** A generic relationship (relates any elements) says less than any language's: below Association. */
const GENERIC_PENALTY = 5;

/** Counter for generating unique QualifiedRelationship IRIs. */
let qrCounter = 0;

/** Reset the counter (useful for testing). */
export function resetQrCounter(): void {
  qrCounter = 0;
}

// ── IRI helpers ────────────────────────────────────────────────────────
//
// `isSafeIri` — the guard that keeps an IRI from breaking the query or
// injecting syntax when interpolated into a `<...>` term — comes from
// `graph-scope.ts`, which needs the same check for graph names.

/** Local name of an IRI (after the last `#` or `/`). */
function iriFragment(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash !== -1) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  return slash !== -1 ? iri.slice(slash + 1) : iri;
}

/** Turn a CamelCase / kebab / snake local name into a spaced label. */
function fragmentToLabel(fragment: string): string {
  return fragment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short, human-friendly name for an IRI, used when building reason strings. */
function shortLabel(iri: string): string {
  if (iri === ARCH_ELEMENT) return 'Element';
  if (iri === ARCH_MODEL_CONCEPT) return 'ModelConcept';
  return fragmentToLabel(iriFragment(iri));
}

/** Render a constraint list for a reason string. */
function shortList(items: string[]): string {
  if (items.length === 0) return 'unconstrained concept';
  return items.map(shortLabel).join(' / ');
}

/** A relationship type as read out of the metamodel, before pair matching. */
interface RelationshipTypeRecord {
  iri: string;
  label?: string;
  iconUrl?: string;
  unqualifiedPredicateIri?: string;
  domainTypes: string[];
  rangeTypes: string[];
}

/**
 * Concrete implementation of the `RelationshipManager` interface.
 *
 * Queries the RDF store for relationship type metadata (domain/range)
 * and creates/deletes relationship triples or QualifiedRelationship resources.
 */
export class OxigraphRelationshipManager implements RelationshipManager {
  constructor(private readonly store: RdfStore) {
    const observed = store as RdfStore & { onEveryWrite?(listener: () => void): unknown };
    if (typeof observed.onEveryWrite === 'function') {
      this.memoOn = true;
      observed.onEveryWrite(() => {
        this.memo = null;
      });
    }
  }

  /**
   * What one task reads of the metamodels for {@link getValidRelationships} —
   * the scope, the relationship types, class closures — kept until the task
   * ends or the store is written to: a context pad asks for forty pairs at once,
   * each reading them again by SPARQL (Task 22). Only over a store that tells
   * of every write.
   */
  private memo: { scope: GraphScope; candidates?: RelationshipTypeRecord[]; closures: Map<string, string[]> } | null = null;
  private memoOn = false;

  private taskMemo(): { scope: GraphScope; candidates?: RelationshipTypeRecord[]; closures: Map<string, string[]> } | null {
    if (!this.memoOn) return null;
    if (!this.memo) {
      const memo = { scope: graphScope(this.store), closures: new Map<string, string[]>() };
      this.memo = memo;
      queueMicrotask(() => {
        if (this.memo === memo) this.memo = null;
      });
    }
    return this.memo;
  }

  /**
   * Return the relationship types that may connect `sourceTypeIri` to
   * `targetTypeIri`, best fit first.
   *
   * A type qualifies when its `arch:domainIncludes` matches somewhere in the
   * source type's superclass closure (or declares nothing at all) and its
   * `arch:rangeIncludes` does the same for the target. Each result carries a
   * `score` and a `reason` explaining the decision.
   */
  getValidRelationships(sourceTypeIri: string, targetTypeIri: string): RelationshipTypeInfo[] {
    // One scope for all three reads below: enumerating the named graphs costs a
    // scan, and nothing here mutates the store.
    const memo = this.taskMemo();
    const scope = memo?.scope ?? graphScope(this.store);

    const candidates = memo ? (memo.candidates ??= this.readRelationshipTypes(scope)) : this.readRelationshipTypes(scope);
    if (candidates.length === 0) return [];

    const closureOf = (typeIri: string) => {
      if (!memo) return this.classClosure(typeIri, scope);
      let closure = memo.closures.get(typeIri);
      if (!closure) memo.closures.set(typeIri, (closure = this.classClosure(typeIri, scope)));
      return closure;
    };
    const sourceClosure = closureOf(sourceTypeIri);
    const targetClosure = closureOf(targetTypeIri);
    const table = this.relationshipTable(scope);
    const directPermissions = this.directPermissions(scope);
    const drawnPermissions = this.drawnPermissions(scope);
    const proposalOrders = this.proposalOrders(scope);

    const matches: RelationshipTypeInfo[] = [];
    /** Each candidate's place in the proposal orders, and whether its hints describe the pair. */
    const ranking = new Map<RelationshipTypeInfo, { proposal: Proposal; hintFit: boolean }>();

    for (const candidate of candidates) {
      const { domainTypes, rangeTypes } = candidate;
      const relationshipClosure = this.relationshipClosure(candidate.iri, scope);
      const shaped = table.covers(relationshipClosure);

      if (shaped) {
        // The relationship shapes are normative (the language's relationship
        // table); the domain/range hints are not consulted where they exist.
        if (!table.allows(relationshipClosure, sourceClosure, targetClosure)) continue;
      } else {
        // Empty constraints are permissive: arch:domainIncludes is a hint, so an
        // absent hint restricts nothing.
        const sourceOk =
          domainTypes.length === 0 || domainTypes.some((iri) => matchesClass(sourceClosure, iri));
        const targetOk =
          rangeTypes.length === 0 || rangeTypes.some((iri) => matchesClass(targetClosure, iri));
        if (!sourceOk || !targetOk) continue;
      }

      const label = candidate.label ?? fragmentToLabel(iriFragment(candidate.iri));

      let score = BASE_SCORE;
      if (domainTypes.includes(sourceTypeIri)) score += EXACT_SOURCE_BONUS;
      if (rangeTypes.includes(targetTypeIri)) score += EXACT_TARGET_BONUS;
      // Association, and a kind of it (a directed association), is the fallback.
      const association = label === 'Association' || relationshipClosure.some((c) => iriFragment(c) === 'Association');
      // Generic: it relates any elements, and no relationship table restricts it
      // (ArchiMate's Specialization also names arch:Element, but its table governs it).
      const generic = !shaped && isGenericRelationshipType(domainTypes, rangeTypes);
      if (association) score -= ASSOCIATION_PENALTY;
      if (generic) score -= GENERIC_PENALTY;
      if (label === 'Composition' || label === 'Aggregation') score -= CONTAINMENT_PENALTY;
      if (label === 'Specialization') score -= SPECIALIZATION_PENALTY;

      const predicate = candidate.unqualifiedPredicateIri;
      const direct = predicate ? directPermissions.holds(predicate, sourceClosure, targetClosure) : undefined;
      const drawn = predicate ? drawnPermissions.holds(predicate, sourceClosure, targetClosure) === true : false;
      const proposal = proposalOrders.proposal(candidate.iri, relationshipClosure, sourceClosure, targetClosure);
      const fallback = association || generic;
      const hintFit =
        (domainTypes.length === 0 || domainTypes.some((iri) => matchesClass(sourceClosure, iri))) &&
        (rangeTypes.length === 0 || rangeTypes.some((iri) => matchesClass(targetClosure, iri)));

      const constrained = domainTypes.length > 0 || rangeTypes.length > 0;
      const allowed = shaped
        ? `Allowed by the metamodel's relationship shapes: a ${shortLabel(sourceTypeIri)} may have ` +
          `${label} to a ${shortLabel(targetTypeIri)}.`
        : constrained
        ? `Allowed because ${shortLabel(sourceTypeIri)} matches ${shortList(domainTypes)} ` +
          `and ${shortLabel(targetTypeIri)} matches ${shortList(rangeTypes)}.`
        : 'Allowed because the metamodel declares no arch:domainIncludes or ' +
          'arch:rangeIncludes for this type, and an absent constraint hint is permissive.';
      const why = drawn ? ' The language\'s metamodel figures draw it between these element types.' : '';
      const reason =
        direct === false
          ? `${allowed}${why} Only by derivation: the relationship tables permit it as the conclusion of a ` +
            'derivation, not drawn directly.'
          : `${allowed}${why}`;

      const match: RelationshipTypeInfo = {
        iri: candidate.iri,
        label,
        iconUrl: candidate.iconUrl,
        domainTypes,
        rangeTypes,
        unqualifiedPredicateIri: candidate.unqualifiedPredicateIri,
        score,
        reason,
        ...(direct === undefined ? {} : { direct }),
        ...(generic ? { generic } : {}),
        ...(drawn ? { drawn } : {}),
        ...(fallback ? { fallback } : {}),
      };
      matches.push(match);
      ranking.set(match, { proposal, hintFit });
    }

    // Three groups, in core's rule: what a modeller may draw directly, what only a derivation gives, and the
    // fallbacks — Association, a generic relationship — unless an order scoped to the pair lists one.
    const group = (match: RelationshipTypeInfo, proposal: Proposal) =>
      match.fallback && !(isProposed(proposal) && proposal.ends > 0) ? 2 : match.direct === false ? 1 : 0;
    return matches.sort((a, b) => {
      const ra = ranking.get(a)!;
      const rb = ranking.get(b)!;
      const byGroup = group(a, ra.proposal) - group(b, rb.proposal);
      if (byGroup !== 0) return byGroup;
      const listedA = isProposed(ra.proposal);
      const listedB = isProposed(rb.proposal);
      if (listedA !== listedB) return listedA ? -1 : 1;
      return (
        // The place the most specific order that lists each gives it.
        (listedA ? compareProposals(ra.proposal, rb.proposal) : 0) ||
        // Where no order decides — a language that publishes none — the hints' fit, the score, the label.
        Number(rb.hintFit) - Number(ra.hintFit) ||
        (b.score ?? 0) - (a.score ?? 0) ||
        a.label.localeCompare(b.label)
      );
    });
  }

  /** The relationships the loaded metamodel figures draw (`drawnBy`), read once per set of loaded graphs. */
  private drawnCache: { key: string; permissions: TablePermissions } | undefined;
  /** The loaded proposal orders, read likewise. */
  private proposalCache: { key: string; orders: ProposalOrders } | undefined;

  /** Which relationships the language's metamodel figures draw, per pair (`direct-permissions.ts`). */
  drawnPermissions(scope: GraphScope = graphScope(this.store)): TablePermissions {
    const key = scope.namedGraphs.join('\n');
    if (this.drawnCache?.key !== key) {
      this.drawnCache = { key, permissions: readDrawnPermissions(this.store) };
    }
    return this.drawnCache.permissions;
  }

  /** The loaded languages' orders of proposal (`proposal-order.ts`). */
  proposalOrders(scope: GraphScope = graphScope(this.store)): ProposalOrders {
    const key = scope.namedGraphs.join('\n');
    if (this.proposalCache?.key !== key) {
      this.proposalCache = { key, orders: readProposalOrders(this.store) };
    }
    return this.proposalCache.orders;
  }

  /** The relationship table of the loaded shapes, read once per set of loaded graphs. */
  private tableCache: { key: string; table: RelationshipTable } | undefined;
  /** The direct permissions of the loaded relationship tables, read likewise. */
  private directCache: { key: string; permissions: TablePermissions } | undefined;

  /**
   * Which relationships the loaded relationship tables let a modeller draw
   * directly (`direct-permissions.ts`), read once per set of loaded graphs.
   */
  directPermissions(scope: GraphScope = graphScope(this.store)): TablePermissions {
    const key = scope.namedGraphs.join('\n');
    if (this.directCache?.key !== key) {
      this.directCache = { key, permissions: readDirectPermissions(this.store) };
    }
    return this.directCache.permissions;
  }

  /**
   * The relationship table the loaded relationship shapes encode
   * (`relationship-table.ts`). Loading or unloading a metamodel changes the
   * store's named graphs, which is what the cache is keyed on.
   */
  relationshipTable(scope: GraphScope = graphScope(this.store)): RelationshipTable {
    const key = scope.namedGraphs.join('\n');
    if (this.tableCache?.key !== key) {
      this.tableCache = { key, table: readRelationshipTable(this.store) };
      this.relationshipClosures.clear();
    }
    return this.tableCache.table;
  }

  /** `rdfs:subClassOf*` closures of relationship classes; they change only with the metamodels. */
  private readonly relationshipClosures = new Map<string, string[]>();

  private relationshipClosure(relationshipClassIri: string, scope: GraphScope): string[] {
    let closure = this.relationshipClosures.get(relationshipClassIri);
    if (!closure) {
      closure = this.classClosure(relationshipClassIri, scope);
      this.relationshipClosures.set(relationshipClassIri, closure);
    }
    return closure;
  }

  /**
   * The transitive `rdfs:subClassOf*` closure of a type, including the type
   * itself.
   *
   * Computed by SPARQL property path so the store does the graph walk. Falls
   * back to the bare type when the IRI cannot be safely interpolated or the
   * store has no hierarchy for it.
   *
   * The walk has to cross document boundaries — ArchiMate declares
   * `am4:StructureElement rdfs:subClassOf arch:Element` in its own document but
   * `arch:Element rdfs:subClassOf arch:ModelConcept` in the core one — which is
   * why the scope merges the named graphs rather than visiting them one at a
   * time.
   */
  private classClosure(typeIri: string, scope: GraphScope): string[] {
    if (!isSafeIri(typeIri)) return [typeIri];

    const rows = scope.select(
      (from) => `
      PREFIX rdfs: <${NAMESPACES.rdfs}>

      SELECT DISTINCT ?super
      ${from}
      WHERE {
        <${typeIri}> rdfs:subClassOf* ?super .
        FILTER(isIRI(?super))
      }
    `,
    );

    const closure = new Set<string>([typeIri]);
    for (const row of rows) {
      const value = row['super']?.value;
      if (value) closure.add(value);
    }
    return Array.from(closure);
  }

  /**
   * Read every relationship type in the store together with its constraints.
   *
   * A relationship type is any resource whose `rdfs:subClassOf+` closure
   * reaches `arch:QualifiedRelationship` — `+` rather than `*` because
   * intermediate steps are real (ArchiMate's `Composition` subclasses
   * `Aggregation`, which subclasses `arch:QualifiedRelationship`) and because
   * `arch:QualifiedRelationship` itself is not a relationship type. A generic
   * relationship — one that relates any elements — is a language's own type
   * whose domain and range name only core classes (Basic's Connection).
   *
   * A legacy `?rel a arch:Relationship` typing is also accepted. That class was
   * removed from the core ontology, but recognising it costs one UNION branch
   * and keeps older or hand-written metamodels working.
   */
  private readRelationshipTypes(scope: GraphScope): RelationshipTypeRecord[] {
    const rows = scope.select(
      (from) => `
      PREFIX rdf:  <${NAMESPACES.rdf}>
      PREFIX rdfs: <${NAMESPACES.rdfs}>
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX skos: <${NAMESPACES.skos}>

      SELECT DISTINCT ?rel ?label ?icon ?pred ?domain ?range
      ${from}
      WHERE {
        {
          ?rel rdfs:subClassOf+ arch:QualifiedRelationship .
        } UNION {
          ?rel rdf:type arch:Relationship .
        }
        OPTIONAL { ?rel skos:prefLabel ?label }
        OPTIONAL { ?rel arch:prefVisNotation ?icon }
        OPTIONAL { ?rel arch:unqualifiedForm ?pred }
        OPTIONAL {
          { ?rel arch:domainIncludes ?domain }
          UNION
          { ?rel arch:unqualifiedForm ?domainSource . ?domainSource arch:domainIncludes ?domain }
        }
        OPTIONAL {
          { ?rel arch:rangeIncludes ?range }
          UNION
          { ?rel arch:unqualifiedForm ?rangeSource . ?rangeSource arch:rangeIncludes ?range }
        }
      }
    `,
    );

    // One relationship type spans several rows — the domain × range cross
    // product, doubled again when the same triples sit in both the default graph
    // and a named graph. Keying by IRI collapses all of it into one record.
    const byIri = new Map<string, RelationshipTypeRecord>();

    for (const row of rows) {
      const iri = row['rel']?.value;
      if (!iri) continue;

      let record = byIri.get(iri);
      if (!record) {
        record = {
          iri,
          label: row['label']?.value,
          iconUrl: row['icon']?.value,
          unqualifiedPredicateIri: row['pred']?.value,
          domainTypes: [],
          rangeTypes: [],
        };
        byIri.set(iri, record);
      } else {
        // A later row may carry an OPTIONAL the first one lacked — the two
        // passes are independent, so neither is guaranteed to be the richer.
        record.label ??= row['label']?.value;
        record.iconUrl ??= row['icon']?.value;
        record.unqualifiedPredicateIri ??= row['pred']?.value;
      }

      const domain = row['domain']?.value;
      if (domain && !record.domainTypes.includes(domain)) record.domainTypes.push(domain);

      const range = row['range']?.value;
      if (range && !record.rangeTypes.includes(range)) record.rangeTypes.push(range);
    }

    return Array.from(byIri.values());
  }

  /**
   * Create a relationship between source and target.
   *
   * - If `qualified` is false/undefined: creates a direct triple
   *   `<sourceIri> <typeIri> <targetIri>` and returns `null`.
   * - If `qualified` is true: creates an `arch:QualifiedRelationship`
   *   resource with `arch:source` / `arch:target` and returns the QR resource
   *   NamedNode. When the metamodel maps `typeIri` back to a relationship class
   *   via `arch:unqualifiedForm`, the resource is also typed with that class —
   *   that class type is what identifies the relationship kind on a qualified
   *   resource.
   *
   * The core ontology declares exactly two properties on a
   * `arch:QualifiedRelationship`: `arch:source` and `arch:target`, both with
   * `rdfs:domain arch:QualifiedRelationship`. The older
   * `arch:relSource` / `arch:relTarget` / `arch:relPredicate` triple — sub-properties
   * of `rdf:subject` / `rdf:object` / `rdf:predicate` under the `rdf:Statement`
   * reification pattern — was removed from the core ontology (see the
   * `skos:historyNote` on `arch:QualifiedRelationship`), so nothing here emits it.
   * There is consequently no predicate property on the resource: the relationship
   * kind is carried by the `rdf:type` of the relationship class.
   */
  createRelationship(
    typeIri: string,
    sourceIri: string,
    targetIri: string,
    qualified?: boolean,
  ): NamedNode | null {
    const source = namedNode(sourceIri) as unknown as NamedNode;
    const target = namedNode(targetIri) as unknown as NamedNode;
    const predicate = namedNode(typeIri) as unknown as NamedNode;

    if (!qualified) {
      // Direct triple: source --predicate--> target
      const directQuad = quad(
        source as any,
        predicate as any,
        target as any,
      ) as unknown as Quad;
      this.store.addQuads([directQuad]);
      return null;
    }

    // Qualified relationship resource. Random, not counted: a counter restarts
    // with the process and would reuse an IRI already in a loaded model.
    qrCounter += 1;
    const qrIri = mintIri(namespaceOfIri(sourceIri), 'relationship');
    const qrNode = namedNode(qrIri) as unknown as NamedNode;

    const quads: Quad[] = [
      quad(qrNode as any, RDF_TYPE as any, ARCH_QUALIFIED_RELATIONSHIP as any) as unknown as Quad,
      quad(qrNode as any, ARCH_SOURCE as any, source as any) as unknown as Quad,
      quad(qrNode as any, ARCH_TARGET as any, target as any) as unknown as Quad,
    ];

    const relationshipClassIri = this.findRelationshipClass(typeIri);
    if (relationshipClassIri) {
      quads.push(
        quad(
          qrNode as any,
          RDF_TYPE as any,
          namedNode(relationshipClassIri) as any,
        ) as unknown as Quad,
      );
    }

    this.store.addQuads(quads);
    return qrNode;
  }

  /**
   * Resolve the relationship class whose `arch:unqualifiedForm` is `predicateIri`.
   * Subclasses share their class's predicate — `am4:ReadAccess` is an
   * `am4:Access` and also `am4:accesses` — so the most general one is meant: a
   * bare triple says no more than that.
   *
   * Returns `null` when the metamodel is not loaded or declares no such
   * mapping.
   */
  private findRelationshipClass(predicateIri: string): string | null {
    if (!isSafeIri(predicateIri)) return null;

    // `LIMIT 1` applies per pass, so this yields at most one row from the
    // default graph and one from the named-graph merge; the first wins.
    const rows = graphScope(this.store).select(
      (from) => `
      PREFIX rdfs: <${NAMESPACES.rdfs}>
      PREFIX arch: <${NAMESPACES.arch}>

      SELECT ?cls
      ${from}
      WHERE {
        ?cls arch:unqualifiedForm <${predicateIri}> .
        ?cls rdfs:subClassOf+ arch:QualifiedRelationship .
        FILTER NOT EXISTS {
          ?cls rdfs:subClassOf+ ?general .
          ?general arch:unqualifiedForm <${predicateIri}> .
          FILTER(?general != ?cls)
        }
      }
      LIMIT 1
    `,
    );

    for (const row of rows) {
      const cls = row['cls']?.value;
      if (cls) return cls;
    }
    return null;
  }

  /**
   * Create a relationship the Linked.Archi way: a qualified resource typed
   * with its relationship class, carrying `arch:source` / `arch:target` and
   * `arch:inModel`, *plus* the unqualified triple the class maps to through
   * `arch:unqualifiedForm` (DD-10), which the resource `rdf:reifies` (RDF 1.2,
   * `<<( s p o )>>`), and the qualified predicate leading from the source to the
   * resource (`am4:qualifiedServing`; core's `arch:hasQualifiedRelationship` for
   * a class the metamodel gives none). The resource is what views draw, what
   * properties hang off, and what has a stable IRI; the triple is what makes
   * `?a am4:serves ?b` work in SPARQL; `rdf:reifies` says which triple the
   * resource is about; the qualified predicate is the way in from the source.
   *
   * `typeIri` may name either the class (`am4:Serving`, what the palette
   * offers) or the predicate (`am4:serves`); the other is resolved from the
   * metamodel. When the metamodel names neither mapping the resource is typed
   * with `typeIri` alone and no unqualified triple is written.
   */
  createQualifiedRelationship(request: CreateRelationshipRequest): RelationshipInfo {
    const { sourceIri, targetIri } = request;
    let classIri = request.typeIri;
    let predicateIri = request.predicateIri;

    if (this.isRelationshipClass(request.typeIri)) {
      predicateIri ??= unqualifiedFormOf(this.store, request.typeIri);
    } else {
      // Given a predicate: find the class that maps to it.
      predicateIri ??= request.typeIri;
      classIri = this.findRelationshipClass(request.typeIri) ?? request.typeIri;
    }
    if (predicateIri === classIri && !this.isProperty(predicateIri)) predicateIri = undefined;

    const iri =
      request.iri ??
      mintIri(request.modelIri ? modelNamespace(this.store, request.modelIri) : namespaceOfIri(sourceIri), 'relationship');
    const rel = nn(iri);
    const quads: Quad[] = [
      triple(rel, T.rdfType, nn(classIri)),
      triple(rel, T.source, nn(sourceIri)),
      triple(rel, T.target, nn(targetIri)),
      triple(nn(sourceIri), nn(qualifiedFormOf(this.store, classIri)), rel),
    ];
    if (request.modelIri) quads.push(triple(rel, T.inModel, nn(request.modelIri)));
    if (request.label?.trim()) quads.push(triple(rel, T.prefLabel, langLiteral(request.label.trim())));
    if (predicateIri) {
      quads.push(
        triple(nn(sourceIri), nn(predicateIri), nn(targetIri)),
        triple(rel, T.reifies, tripleTerm(nn(sourceIri), nn(predicateIri), nn(targetIri))),
      );
    }
    this.store.addQuads(quads);

    return {
      iri,
      classIri,
      ...(predicateIri ? { predicateIri } : {}),
      sourceIri,
      targetIri,
      ...(request.label?.trim() ? { label: request.label.trim() } : {}),
    };
  }

  /**
   * Change a relationship's kind in place. The IRI, the endpoints, the label
   * and every other property stay; the class type, the qualified predicate
   * from the source and the unqualified triple are swapped (the old triple only
   * when no sibling still justifies it).
   */
  retypeRelationship(relationshipIri: string, typeIri: string): RelationshipInfo | undefined {
    const current = this.getRelationship(relationshipIri);
    if (!current) return undefined;
    const rel = nn(relationshipIri);
    const newClass = this.isRelationshipClass(typeIri) ? typeIri : (this.findRelationshipClass(typeIri) ?? typeIri);
    if (newClass === current.classIri) return current;
    const newPredicate = unqualifiedFormOf(this.store, newClass) ?? (newClass === typeIri ? undefined : typeIri);

    const remove: Quad[] = [
      ...this.store.getQuads(rel, T.rdfType, nn(current.classIri)),
      ...this.store.getQuads(rel, T.reifies),
      ...qualifiedPointerQuads(this.store, relationshipIri, current.sourceIri),
    ];
    if (current.predicateIri) {
      const siblings = this.getRelationshipsOf(current.sourceIri).filter(
        (r) => r.iri !== relationshipIri && r.targetIri === current.targetIri && r.classIri === current.classIri,
      );
      if (siblings.length === 0) {
        remove.push(...this.store.getQuads(nn(current.sourceIri), nn(current.predicateIri), nn(current.targetIri)));
      }
    }
    if (remove.length > 0) this.store.removeQuads(remove);
    const add: Quad[] = [
      triple(rel, T.rdfType, nn(newClass)),
      triple(nn(current.sourceIri), nn(qualifiedFormOf(this.store, newClass)), rel),
    ];
    if (newPredicate) {
      add.push(
        triple(nn(current.sourceIri), nn(newPredicate), nn(current.targetIri)),
        triple(rel, T.reifies, tripleTerm(nn(current.sourceIri), nn(newPredicate), nn(current.targetIri))),
      );
    }
    this.store.addQuads(add);
    return this.getRelationship(relationshipIri);
  }

  /**
   * Reattach a relationship to other elements. Its IRI, type and properties
   * stay; the ends, the qualified predicate from the source and the
   * unqualified triple move.
   */
  reconnectRelationship(relationshipIri: string, sourceIri: string, targetIri: string): RelationshipInfo | undefined {
    const current = this.getRelationship(relationshipIri);
    if (!current) return undefined;
    if (current.sourceIri === sourceIri && current.targetIri === targetIri) return current;
    const rel = nn(relationshipIri);
    // The way in from the source moves with it, by whichever predicate the data uses.
    const pointers = qualifiedPointerQuads(this.store, relationshipIri, current.sourceIri);
    const pointerPredicates = pointers.length > 0 ? [...new Set(pointers.map((q) => q.predicate.value))] : [qualifiedFormOf(this.store, current.classIri)];
    const remove: Quad[] = [
      ...this.store.getQuads(rel, T.source),
      ...this.store.getQuads(rel, T.target),
      ...this.store.getQuads(rel, T.reifies),
      ...pointers,
    ];
    if (current.predicateIri) {
      const siblings = this.getRelationshipsOf(current.sourceIri).filter(
        (r) => r.iri !== relationshipIri && r.targetIri === current.targetIri && r.classIri === current.classIri,
      );
      if (siblings.length === 0) {
        remove.push(...this.store.getQuads(nn(current.sourceIri), nn(current.predicateIri), nn(current.targetIri)));
      }
    }
    this.store.removeQuads(remove);
    const add: Quad[] = [
      triple(rel, T.source, nn(sourceIri)),
      triple(rel, T.target, nn(targetIri)),
      ...pointerPredicates.map((p) => triple(nn(sourceIri), nn(p), rel)),
    ];
    if (current.predicateIri) {
      add.push(
        triple(nn(sourceIri), nn(current.predicateIri), nn(targetIri)),
        triple(rel, T.reifies, tripleTerm(nn(sourceIri), nn(current.predicateIri), nn(targetIri))),
      );
    }
    this.store.addQuads(add);
    return this.getRelationship(relationshipIri);
  }

  /** Read one qualified relationship, current or legacy vocabulary. */
  getRelationship(relationshipIri: string): RelationshipInfo | undefined {
    const rel = nn(relationshipIri);
    const first = (predicate: string) => this.store.getQuads(rel, nn(predicate))[0]?.object.value;
    const sourceIri = first(IRI.source) ?? first(IRI.legacyRelSource);
    const targetIri = first(IRI.target) ?? first(IRI.legacyRelTarget);
    if (!sourceIri || !targetIri) return undefined;
    const classIri = relationshipClassOf(this.store, relationshipIri) ?? IRI.QualifiedRelationship;
    const predicateIri = unqualifiedFormOf(this.store, classIri) ?? first(IRI.legacyRelPredicate);
    const label = first(IRI.prefLabel);
    return {
      iri: relationshipIri,
      classIri,
      ...(predicateIri ? { predicateIri } : {}),
      sourceIri,
      targetIri,
      ...(label ? { label } : {}),
    };
  }

  /** Every qualified relationship with the element at either end. */
  getRelationshipsOf(elementIri: string): RelationshipInfo[] {
    return relationshipsTouching(this.store, elementIri)
      .map((iri) => this.getRelationship(iri))
      .filter((info): info is RelationshipInfo => info !== undefined);
  }

  /** The quads {@link deleteRelationship} removes. */
  collectRelationshipQuads(relationshipIri: string): Quad[] {
    return collectRelationshipQuads(this.store, relationshipIri);
  }

  /** Whether an IRI is a relationship class (reaches `arch:QualifiedRelationship`). */
  private isRelationshipClass(iri: string): boolean {
    if (!isSafeIri(iri)) return false;
    const rows = graphScope(this.store).select(
      (from) => `
      PREFIX rdfs: <${NAMESPACES.rdfs}>
      PREFIX arch: <${NAMESPACES.arch}>
      SELECT ?x ${from} WHERE { <${iri}> rdfs:subClassOf+ arch:QualifiedRelationship . BIND(1 AS ?x) } LIMIT 1
    `,
    );
    return rows.length > 0;
  }

  /** Whether an IRI is declared as a property anywhere in the store. */
  private isProperty(iri: string): boolean {
    const types = this.store.getQuads(nn(iri), T.rdfType).map((q) => q.object.value);
    return types.some((t) => t.endsWith('ObjectProperty') || t.endsWith('#Property'));
  }

  /**
   * Delete a QualifiedRelationship from the model by its IRI.
   *
   * Removes the resource, its unqualified triple when no sibling occurrence
   * keeps that triple true, and every diagram link drawing it. Source and
   * target elements remain intact.
   *
   * A relationship that exists *only* as a direct triple has no IRI; the
   * caller retracts that triple directly via the RDF store.
   */
  deleteRelationship(relationshipIri: string): void {
    // The resource, its unqualified triple (unless a sibling keeps it true),
    // and every link drawing it — see `cascade.ts`.
    const quads = this.collectRelationshipQuads(relationshipIri);
    if (quads.length > 0) this.store.removeQuads(quads);
  }
}
