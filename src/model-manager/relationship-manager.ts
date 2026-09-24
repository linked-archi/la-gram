/**
 * Relationship Manager — CRUD operations for architecture relationships.
 *
 * Creates, queries, and deletes relationships in the RDF store,
 * supporting both direct triples and `arch:QualifiedRelationship` resources.
 *
 * ## How relationship validity is decided
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
import type { RelationshipManager } from './interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { graphScope, isSafeIri, type GraphScope } from '../rdf-engine/graph-scope.js';

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
  constructor(private readonly store: RdfStore) {}

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
    const scope = graphScope(this.store);

    const candidates = this.readRelationshipTypes(scope);
    if (candidates.length === 0) return [];

    const sourceClosure = this.classClosure(sourceTypeIri, scope);
    const targetClosure = this.classClosure(targetTypeIri, scope);

    const matches: RelationshipTypeInfo[] = [];

    for (const candidate of candidates) {
      const { domainTypes, rangeTypes } = candidate;

      // Empty constraints are permissive: arch:domainIncludes is a hint, so an
      // absent hint restricts nothing.
      const sourceOk =
        domainTypes.length === 0 || domainTypes.some((iri) => matchesClass(sourceClosure, iri));
      const targetOk =
        rangeTypes.length === 0 || rangeTypes.some((iri) => matchesClass(targetClosure, iri));
      if (!sourceOk || !targetOk) continue;

      const label = candidate.label ?? fragmentToLabel(iriFragment(candidate.iri));

      let score = BASE_SCORE;
      if (domainTypes.includes(sourceTypeIri)) score += EXACT_SOURCE_BONUS;
      if (rangeTypes.includes(targetTypeIri)) score += EXACT_TARGET_BONUS;
      if (label === 'Association') score -= ASSOCIATION_PENALTY;
      if (label === 'Composition' || label === 'Aggregation') score -= CONTAINMENT_PENALTY;

      const constrained = domainTypes.length > 0 || rangeTypes.length > 0;
      const reason = constrained
        ? `Allowed because ${shortLabel(sourceTypeIri)} matches ${shortList(domainTypes)} ` +
          `and ${shortLabel(targetTypeIri)} matches ${shortList(rangeTypes)}.`
        : 'Allowed because the metamodel declares no arch:domainIncludes or ' +
          'arch:rangeIncludes for this type, and an absent constraint hint is permissive.';

      matches.push({
        iri: candidate.iri,
        label,
        iconUrl: candidate.iconUrl,
        domainTypes,
        rangeTypes,
        unqualifiedPredicateIri: candidate.unqualifiedPredicateIri,
        score,
        reason,
      });
    }

    return matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.label.localeCompare(b.label));
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
   * `arch:QualifiedRelationship` itself is not a relationship type.
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

    // Qualified relationship resource
    qrCounter += 1;
    const qrIri = `${sourceIri}/qr-${qrCounter}`;
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
   * Delete a QualifiedRelationship resource by its IRI.
   *
   * Removes all triples where the QR IRI is the subject.
   * Source and target elements remain intact.
   *
   * Note: For direct triples, the caller should remove the triple directly
   * via the RDF store, since direct triples have no dedicated IRI.
   */
  deleteRelationship(relationshipIri: string): void {
    const qrNode = namedNode(relationshipIri) as unknown as NamedNode;

    // Remove all triples where the QR is the subject
    const qrQuads = this.store.getQuads(qrNode);
    if (qrQuads.length > 0) {
      this.store.removeQuads(qrQuads);
    }
  }
}
