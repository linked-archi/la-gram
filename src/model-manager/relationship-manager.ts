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
import type {
  CreateRelationshipRequest,
  RelationshipInfo,
  RelationshipManager,
} from './interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { graphScope, isSafeIri, type GraphScope } from '../rdf-engine/graph-scope.js';
import { mintIri, uuid } from '../rdf-engine/iri.js';
import {
  collectRelationshipQuads,
  relationshipClassOf,
  relationshipsTouching,
  unqualifiedFormOf,
} from './cascade.js';
import { IRI, T, langLiteral, nn, triple } from './vocabulary.js';

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

    // Qualified relationship resource. Random, not counted: a counter restarts
    // with the process and would reuse an IRI already in a loaded model.
    qrCounter += 1;
    const qrIri = `${sourceIri}/qr-${uuid()}`;
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
   * Create a relationship the Linked.Archi way: a qualified resource typed
   * with its relationship class, carrying `arch:source` / `arch:target` and
   * `arch:inModel`, *plus* the unqualified triple the class maps to through
   * `arch:unqualifiedForm` (DD-10). The resource is what views draw, what
   * properties hang off, and what has a stable IRI; the triple is what makes
   * `?a am4:serves ?b` work in SPARQL.
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

    const iri = request.iri ?? mintIri(request.modelIri ?? sourceIri, 'relationship');
    const rel = nn(iri);
    const quads: Quad[] = [
      triple(rel, T.rdfType, nn(classIri)),
      triple(rel, T.source, nn(sourceIri)),
      triple(rel, T.target, nn(targetIri)),
    ];
    if (request.modelIri) quads.push(triple(rel, T.inModel, nn(request.modelIri)));
    if (request.label?.trim()) quads.push(triple(rel, T.prefLabel, langLiteral(request.label.trim())));
    if (predicateIri) quads.push(triple(nn(sourceIri), nn(predicateIri), nn(targetIri)));
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
   * and every other property stay; the class type and the unqualified triple
   * are swapped (the old triple only when no sibling still justifies it).
   */
  retypeRelationship(relationshipIri: string, typeIri: string): RelationshipInfo | undefined {
    const current = this.getRelationship(relationshipIri);
    if (!current) return undefined;
    const rel = nn(relationshipIri);
    const newClass = this.isRelationshipClass(typeIri) ? typeIri : (this.findRelationshipClass(typeIri) ?? typeIri);
    if (newClass === current.classIri) return current;
    const newPredicate = unqualifiedFormOf(this.store, newClass) ?? (newClass === typeIri ? undefined : typeIri);

    const remove: Quad[] = [...this.store.getQuads(rel, T.rdfType, nn(current.classIri))];
    if (current.predicateIri) {
      const siblings = this.getRelationshipsOf(current.sourceIri).filter(
        (r) => r.iri !== relationshipIri && r.targetIri === current.targetIri && r.classIri === current.classIri,
      );
      if (siblings.length === 0) {
        remove.push(...this.store.getQuads(nn(current.sourceIri), nn(current.predicateIri), nn(current.targetIri)));
      }
    }
    if (remove.length > 0) this.store.removeQuads(remove);
    const add: Quad[] = [triple(rel, T.rdfType, nn(newClass))];
    if (newPredicate) add.push(triple(nn(current.sourceIri), nn(newPredicate), nn(current.targetIri)));
    this.store.addQuads(add);
    return this.getRelationship(relationshipIri);
  }

  /**
   * Reattach a relationship to other elements. Its IRI, type and properties
   * stay; the ends and the unqualified triple move.
   */
  reconnectRelationship(relationshipIri: string, sourceIri: string, targetIri: string): RelationshipInfo | undefined {
    const current = this.getRelationship(relationshipIri);
    if (!current) return undefined;
    if (current.sourceIri === sourceIri && current.targetIri === targetIri) return current;
    const rel = nn(relationshipIri);
    const remove: Quad[] = [
      ...this.store.getQuads(rel, T.source),
      ...this.store.getQuads(rel, T.target),
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
    const add: Quad[] = [triple(rel, T.source, nn(sourceIri)), triple(rel, T.target, nn(targetIri))];
    if (current.predicateIri) add.push(triple(nn(sourceIri), nn(current.predicateIri), nn(targetIri)));
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
