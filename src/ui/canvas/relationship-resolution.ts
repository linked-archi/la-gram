/**
 * Closure-aware relationship resolution for the canvas.
 *
 * ## Why this exists
 *
 * `arch:domainIncludes` / `arch:rangeIncludes` are declared against *abstract
 * superclasses*. ArchiMate 4.0's `Serving` says
 * `arch:domainIncludes am4:ActiveStructureElement`, never
 * `am4:BusinessActor`. Any code that answers "may this type be the source of a
 * relationship?" with an exact `domainTypes.includes(typeIri)` therefore
 * answers `false` for every concrete type in the language.
 *
 * Matching has to run against the `rdfs:subClassOf*` closure of the type, which
 * is what {@link matchesClass} expects. This module supplies that closure from
 * the RDF store and reuses `matchesClass` so the UI decides validity the same
 * way `OxigraphRelationshipManager` does.
 *
 * ## What answers the candidate question
 *
 * `OxigraphRelationshipManager.getValidRelationships` — the sole authority,
 * consulted directly. It used to answer `[]` for every pair against the real
 * bundled metamodel, because its SPARQL was unscoped while `N3MetamodelLoader`
 * loads each document into a named graph; a `withPaletteFallback` wrapper here
 * covered for that. The manager now scopes its queries across every graph, so
 * the wrapper is gone and a manager regression surfaces on the canvas instead of
 * being papered over.
 *
 * {@link hasOutgoingRelationshipTypes} still reads the palette rather than the
 * manager: the context pad only needs to know whether *any* relationship type
 * could start at a type, which is a question about the palette the user is
 * looking at, and it is asked on every render.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { matchesClass } from '../../metamodel-manager/taxonomy.js';
import type {
  ElementTypeInfo,
  PaletteDefinition,
  RelationshipPreference,
  RelationshipTypeInfo,
} from '../../metamodel-manager/interfaces.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

/** The groups a pair's relationships rank in, best first (`RelationshipPreference`). */
const PREFERENCE_RANK: Record<RelationshipPreference, number> = { first: 0, drawn: 1, direct: 2, derived: 3, fallback: 4 };

/** Resolves a type IRI to its `rdfs:subClassOf*` closure, the type included. */
export type ClassClosure = (typeIri: string) => string[];

/** The bit of `RdfStore` this module reads. Structural, so a stub works. */
export interface ClosureSource {
  getQuads(
    subject?: NamedNode | null,
    predicate?: NamedNode | null,
    object?: NamedNode | null,
    graph?: NamedNode | null,
  ): Quad[];
}

const { namedNode } = DataFactory;

const RDFS_SUBCLASS_OF = namedNode(NAMESPACES.rdfs + 'subClassOf') as unknown as NamedNode;

/**
 * Build a closure resolver over every `rdfs:subClassOf` triple in the store.
 *
 * Read with a `null` graph so it spans the default graph *and* every named
 * graph — the metamodel lives in the latter. The hierarchy is walked in memory
 * because a class taxonomy is small and the walk happens on every hover during
 * a connect drag.
 */
export function buildClassClosure(store: ClosureSource): ClassClosure {
  const parents = new Map<string, string[]>();
  for (const q of store.getQuads(null, RDFS_SUBCLASS_OF, null, null)) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
    const existing = parents.get(q.subject.value);
    if (existing) existing.push(q.object.value);
    else parents.set(q.subject.value, [q.object.value]);
  }

  const cache = new Map<string, string[]>();

  return (typeIri: string): string[] => {
    const cached = cache.get(typeIri);
    if (cached) return cached;

    const seen = new Set<string>([typeIri]);
    const stack = [...(parents.get(typeIri) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      stack.push(...(parents.get(current) ?? []));
    }

    const closure = [...seen];
    cache.set(typeIri, closure);
    return closure;
  };
}

/** Closure resolver for callers that have no store: the type stands alone. */
export const identityClosure: ClassClosure = (typeIri) => [typeIri];

/**
 * Whether a relationship type's `arch:domainIncludes` admits `closure`.
 *
 * An empty constraint list is permissive: `arch:domainIncludes` is a modelling
 * hint, so an absent hint restricts nothing.
 */
function admits(constraints: string[], closure: string[]): boolean {
  return constraints.length === 0 || constraints.some((iri) => matchesClass(closure, iri));
}

/**
 * What the metamodel's relationship shapes say (`model-manager/relationship-table.ts`),
 * for the prefilters below. Where the shapes cover a relationship type they
 * decide, as they do in the manager; the `domainIncludes`/`rangeIncludes`
 * hints are consulted only for types no shape covers. Asking the hints about a
 * shaped type could discard a pair the shapes permit — ArchiMate 4.0's Flow is
 * hinted from behaviour and strategy elements, yet the matrix lets a Business
 * Actor have Flow.
 */
export interface RelationshipShapes {
  covers(relationshipClosure: readonly string[]): boolean;
  allowsSource(relationshipClosure: readonly string[], sourceClosure: readonly string[]): boolean;
  allowsTarget(relationshipClosure: readonly string[], targetClosure: readonly string[]): boolean;
}

/** The shapes a relationship manager has read, when it reads any (`OxigraphRelationshipManager`). */
export function shapesOf(manager: unknown): RelationshipShapes | undefined {
  return (manager as { relationshipTable?(): RelationshipShapes } | undefined)?.relationshipTable?.();
}

/** Whether a relationship type may start at a source: its shapes, else its hints. */
function mayStart(rel: RelationshipTypeInfo, sourceClosure: string[], closure: ClassClosure, shapes?: RelationshipShapes): boolean {
  const relationshipClosure = closure(rel.iri);
  return shapes?.covers(relationshipClosure)
    ? shapes.allowsSource(relationshipClosure, sourceClosure)
    : admits(rel.domainTypes, sourceClosure);
}

/** Whether a relationship type may end at a target: its shapes, else its hints. */
function mayEnd(rel: RelationshipTypeInfo, targetClosure: string[], closure: ClassClosure, shapes?: RelationshipShapes): boolean {
  const relationshipClosure = closure(rel.iri);
  return shapes?.covers(relationshipClosure)
    ? shapes.allowsTarget(relationshipClosure, targetClosure)
    : admits(rel.rangeTypes, targetClosure);
}

/**
 * Whether any relationship type in the palette can start at `typeIri`.
 *
 * This is the gate on the context pad's Connect entry.
 */
export function hasOutgoingRelationshipTypes(
  palette: PaletteDefinition,
  closure: ClassClosure,
  typeIri: string,
  shapes?: RelationshipShapes,
): boolean {
  if (!typeIri) return false;
  const sourceClosure = closure(typeIri);
  return palette.relationshipTypes.some((rel) => mayStart(rel, sourceClosure, closure, shapes));
}

/**
 * An element type the metamodel allows a relationship *to*, from some source.
 *
 * Carries the ranked relationship types that make it reachable, so the append
 * menu can say *why* a target is offered — and which relationship the append
 * will actually create — without asking again.
 */
export interface AppendTarget {
  /** The appendable element type, as the palette publishes it. */
  type: ElementTypeInfo;
  /** Palette group the type sits in, so a menu can bucket the way the palette does. */
  category: string;
  /** Relationship types allowed from the source to it, best-ranked first. */
  relationships: RelationshipTypeInfo[];
}

/** The authority on validity for a pair — `RelationshipManager`'s method. */
export type ValidRelationshipLookup = (
  sourceTypeIri: string,
  targetTypeIri: string,
) => RelationshipTypeInfo[];

/**
 * The element types that can be appended to a source type, ranked.
 *
 * ## Why this is derived and not listed
 *
 * bpmn-js hardcodes a handful of `append.*` context pad entries per source type,
 * which is tenable because BPMN's vocabulary is small, fixed and known at build
 * time. Here the metamodel is *data*: ArchiMate 4.0 alone publishes 42 concrete
 * element types, and a different notation set publishes different ones. A fixed
 * list would be wrong the moment anyone loaded their own metamodel.
 *
 * ## The two stages, and the cost
 *
 * `getValidRelationships` takes a *pair*, so "what can I append?" means testing
 * candidate targets — and each call re-reads the relationship types and both
 * class closures out of the store. Running it 42 times per menu open is the
 * naive cost, so it is only ever run on candidates that survive a free
 * prefilter:
 *
 * 1. **Palette prefilter.** Relationship types that may start at the source,
 *    then element types some such type may end at — judged by the relationship
 *    shapes where they cover the type ({@link RelationshipShapes}) and by
 *    `arch:domainIncludes`/`arch:rangeIncludes` otherwise, exactly as the
 *    manager judges. Array and set work over data already in memory; it asks
 *    only "any row with this source / target", a superset of the manager's
 *    pairwise answer, so it can only discard a candidate the manager would
 *    also have discarded.
 * 2. **Manager confirmation.** `getValidRelationships(source, survivor)` for
 *    each survivor. This is the authority: the ranking, the wildcard handling
 *    and the scoring all live there, and a survivor it answers `[]` for is
 *    dropped.
 *
 * The caller is expected to memoize the result per source type — see
 * `DiagramCanvas.appendTargets` — so the manager calls happen once per source
 * type per palette, not once per context pad render.
 *
 * Order is by the best relationship score the target admits, then by label, so
 * the menu leads with the most meaningful append rather than with whatever the
 * palette happened to list first.
 */
export function appendableTargetTypes(
  palette: PaletteDefinition,
  closure: ClassClosure,
  getValidRelationships: ValidRelationshipLookup,
  sourceTypeIri: string,
  shapes?: RelationshipShapes,
): AppendTarget[] {
  if (!sourceTypeIri) return [];

  const sourceClosure = closure(sourceTypeIri);
  const outgoing = palette.relationshipTypes.filter((rel) => mayStart(rel, sourceClosure, closure, shapes));
  if (outgoing.length === 0) return [];

  const targets: AppendTarget[] = [];

  for (const group of palette.elementGroups) {
    for (const element of group.elements) {
      if (element.isAbstract) continue;

      // (1) free prefilter — can any outgoing type's range admit this element?
      const targetClosure = closure(element.iri);
      if (!outgoing.some((rel) => mayEnd(rel, targetClosure, closure, shapes))) continue;

      // (2) the manager decides, and supplies the ranking.
      const relationships = getValidRelationships(sourceTypeIri, element.iri);
      if (relationships.length === 0) continue;

      targets.push({ type: element, category: group.category, relationships });
    }
  }

  // By the group of the best relationship that reaches the target — one proposed first or drawn in
  // the metamodel before one only permitted, before one reached only by derivation — then by score.
  const group = (t: AppendTarget) => PREFERENCE_RANK[t.relationships[0]?.preference ?? 'direct'];
  targets.sort((a, b) => {
    const byGroup = group(a) - group(b);
    const byScore = (b.relationships[0]?.score ?? 0) - (a.relationships[0]?.score ?? 0);
    return byGroup || byScore || a.type.label.localeCompare(b.type.label);
  });

  return targets;
}

/**
 * Stable identity for the relationship `source --type--> target`.
 *
 * A relationship written as a direct triple has no IRI of its own, yet the
 * canvas needs something to key its registry by and to put on the connection's
 * business object. The triple's three terms determine it exactly — RDF cannot
 * hold the same triple twice — so this is a genuine identity rather than a
 * counter.
 *
 * Shared so the two directions agree: {@link import('./diagram-canvas.js')}
 * draws store-side relationships under this id, and connections drawn on the
 * canvas carry it as their business object's `iri` until a qualified
 * relationship resource supplies a real one.
 */
export function relationshipKey(sourceIri: string, targetIri: string, typeIri: string): string {
  return `${sourceIri}--${typeIri}-->${targetIri}`;
}

/**
 * Whether a connection's `iri` is a {@link relationshipKey} — a bare triple with
 * no relationship resource to name — rather than a relationship's IRI. An IRI
 * cannot hold `>` (RFC 3987), so the key's `-->` never occurs in one.
 */
export function isRelationshipKey(iri: string): boolean {
  return iri.includes('-->');
}
