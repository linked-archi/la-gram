/**
 * What "delete from the model" removes.
 *
 * Both deletions are computed as a set of quads first and removed second. The
 * set doubles as the undo snapshot — putting exactly those quads back restores
 * the model, every view that showed the concept, and every route — which is
 * why the managers expose `collect…` twins of their deletes.
 *
 * ## A relationship
 *
 * - the qualified resource (every triple with it as subject);
 * - the qualified predicate leading to it from its source (`am4:qualifiedServing`,
 *   or core's `arch:hasQualifiedRelationship`), which would otherwise point at
 *   nothing;
 * - its unqualified triple `source predicate target` — unless another qualified
 *   resource of the same kind still connects the same pair, in which case the
 *   triple is still true and stays;
 * - every `arch-vis:Link` drawing it, in any view, with its route and its label node;
 * - its `arch:inView` statements (they are its own triples, covered above).
 *
 * ## An element
 *
 * - every relationship with it at either end, as above;
 * - every `arch-vis:ArchNode` placing it, in any view, and every link ending at
 *   those nodes;
 * - every triple with it as subject, and every triple pointing at it.
 *
 * Retired endpoint vocabulary (`arch:relSource` / `arch:relTarget`) is matched
 * as well, so relationships in a model that predates the migration still
 * cascade.
 */

import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { IRI, T, dedupe, nn, relationshipClassAmong } from './vocabulary.js';

const RDFS_RANGE = nn(NAMESPACES.rdfs + 'range');

/** Endpoint predicates on a qualified relationship, current first. */
const ENDPOINTS = [IRI.source, IRI.target, IRI.legacyRelSource, IRI.legacyRelTarget].map(nn);

function objects(store: RdfStore, subject: Term, predicate: NamedNode): string[] {
  return store.getQuads(subject as NamedNode, predicate).map((q) => q.object.value);
}

/** The unqualified predicate a relationship class maps to, from any graph. */
export function unqualifiedFormOf(store: RdfStore, classIri: string): string | undefined {
  return store.getQuads(nn(classIri), T.unqualifiedForm)[0]?.object.value;
}

/**
 * A relationship class's qualified predicate — the property from a source to
 * its relationship resource, which a metamodel declares with the class as its
 * `rdfs:range` and an `arch:unqualifiedForm` (`am4:qualifiedRealization` for
 * `am4:Realization`) — else core's fallback, `arch:hasQualifiedRelationship`.
 */
export function qualifiedFormOf(store: RdfStore, classIri: string): string {
  const declared = store
    .getQuads(null, RDFS_RANGE, nn(classIri))
    .map((q) => q.subject)
    .find((p) => p.termType === 'NamedNode' && store.getQuads(p as NamedNode, T.unqualifiedForm).length > 0);
  return declared?.value ?? IRI.hasQualifiedRelationship;
}

/**
 * Whether a predicate leads from a relationship's source to its resource:
 * core's fallback, or a property a metamodel declares an `arch:unqualifiedForm`
 * for (only qualified predicates and relationship classes have one, and a
 * class is never a predicate).
 */
export function isQualifiedPredicate(store: RdfStore, predicateIri: string): boolean {
  return predicateIri === IRI.hasQualifiedRelationship || store.getQuads(nn(predicateIri), T.unqualifiedForm).length > 0;
}

/** The quads leading from a relationship's source to it by a qualified predicate — whichever one the data uses. */
export function qualifiedPointerQuads(store: RdfStore, relationshipIri: string, sourceIri: string): Quad[] {
  return store
    .getQuads(nn(sourceIri), null, nn(relationshipIri))
    .filter((q) => isQualifiedPredicate(store, q.predicate.value));
}

/** The relationship class of a qualified resource: its type other than the core's generic ones. */
export function relationshipClassOf(store: RdfStore, relationshipIri: string): string | undefined {
  return relationshipClassAmong(objects(store, nn(relationshipIri), T.rdfType));
}

/**
 * The quads of a link: its own, its point list cells and points — and those of
 * every link ending on it (core-vis 0.6), which cannot outlive it.
 */
/**
 * What goes with a diagram element or a concept that nothing else uses: a
 * node's or a link's own styles (`arch-vis:style`, each context's too) and the label expressions they
 * gives (core-vis 0.7), and a concept's SKOS-XL names and pictures (core 0.5.0)
 * — each only when no other subject points at it.
 */
function ownedQuads(store: RdfStore, subject: Term): Quad[] {
  const quads: Quad[] = [];
  const alone = (predicate: NamedNode, object: Term) => store.getQuads(null, predicate, object as NamedNode).length <= 1;
  for (const style of store.getQuads(subject as NamedNode, T.visStyle)) {
    if (style.object.termType === 'Literal' || !alone(T.visStyle, style.object)) continue;
    quads.push(...store.getQuads(style.object as NamedNode, null, null));
    for (const label of store.getQuads(style.object as NamedNode, T.labelExpression)) {
      if (label.object.termType !== 'Literal' && alone(T.labelExpression, label.object)) quads.push(...store.getQuads(label.object as NamedNode, null, null));
    }
  }
  for (const name of store.getQuads(subject as NamedNode, T.skosxlAltLabel)) {
    if (name.object.termType !== 'Literal' && alone(T.skosxlAltLabel, name.object)) quads.push(...store.getQuads(name.object as NamedNode, null, null));
  }
  // Its pictures (core 0.5.0): an ImageObject nothing else points at — not a published image's own IRI.
  for (const predicate of [T.prefVisNotation, T.altVisNotation]) {
    for (const picture of store.getQuads(subject as NamedNode, predicate)) {
      if (picture.object.termType === 'Literal' || store.getQuads(null, null, picture.object as NamedNode).length > 1) continue;
      quads.push(...store.getQuads(picture.object as NamedNode, null, null));
    }
  }
  return quads;
}

function linkQuads(store: RdfStore, link: Term, seen: Set<string> = new Set()): Quad[] {
  if (seen.has(link.value)) return [];
  seen.add(link.value);
  // Its own style goes with it.
  const quads = [...store.getQuads(link as NamedNode, null, null), ...ownedQuads(store, link)];
  // Its label node — where its name was moved to — goes with it.
  for (const label of store.getQuads(link as NamedNode, T.visLabel)) quads.push(...store.getQuads(label.object as NamedNode, null, null));
  for (const end of [T.visSource, T.visTarget]) {
    for (const attached of store.getQuads(null, end, link as NamedNode)) quads.push(...linkQuads(store, attached.subject, seen));
  }
  let cell = objects(store, link, T.points)[0];
  const guard = new Set<string>();
  while (cell && cell !== IRI.rdfNil && !guard.has(cell)) {
    guard.add(cell);
    for (const point of objects(store, nn(cell), T.rdfFirst)) {
      quads.push(...store.getQuads(nn(point), null, null));
    }
    quads.push(...store.getQuads(nn(cell), null, null));
    cell = objects(store, nn(cell), T.rdfRest)[0];
  }
  return quads;
}

/**
 * Everything that goes when a qualified relationship is deleted from the model —
 * with every relationship whose source or target it is, as an element takes the
 * relationships at its ends.
 */
export function collectRelationshipQuads(store: RdfStore, relationshipIri: string, seen: Set<string> = new Set()): Quad[] {
  if (seen.has(relationshipIri)) return [];
  seen.add(relationshipIri);
  const rel = nn(relationshipIri);
  // Its names for each audience go with it.
  const quads: Quad[] = [...store.getQuads(rel, null, null), ...ownedQuads(store, rel)];

  // The unqualified triple, unless a sibling occurrence keeps it true.
  const sourceIri = objects(store, rel, T.source)[0] ?? objects(store, rel, nn(IRI.legacyRelSource))[0];
  const targetIri = objects(store, rel, T.target)[0] ?? objects(store, rel, nn(IRI.legacyRelTarget))[0];
  if (sourceIri) quads.push(...qualifiedPointerQuads(store, relationshipIri, sourceIri));
  const classIri = relationshipClassOf(store, relationshipIri);
  const predicateIri =
    (classIri && unqualifiedFormOf(store, classIri)) ??
    objects(store, rel, nn(IRI.legacyRelPredicate))[0];
  if (sourceIri && targetIri && predicateIri) {
    const siblings = store
      .getQuads(null, T.source, nn(sourceIri))
      .map((q) => q.subject.value)
      .filter(
        (other) =>
          other !== relationshipIri &&
          objects(store, nn(other), T.target).includes(targetIri) &&
          relationshipClassOf(store, other) === classIri,
      );
    if (siblings.length === 0) {
      quads.push(...store.getQuads(nn(sourceIri), nn(predicateIri), nn(targetIri)));
    }
  }

  // Every link drawing it, in every view.
  for (const q of store.getQuads(null, T.archRelationship, rel)) {
    quads.push(...linkQuads(store, q.subject));
  }

  // A relationship ending on this one cannot outlive it.
  for (const other of relationshipsTouching(store, relationshipIri)) {
    quads.push(...collectRelationshipQuads(store, other, seen));
  }
  return dedupe(quads);
}

/** Qualified relationships with the element at either end. */
export function relationshipsTouching(store: RdfStore, elementIri: string): string[] {
  const element = nn(elementIri);
  const rels = new Set<string>();
  for (const predicate of ENDPOINTS) {
    for (const q of store.getQuads(null, predicate, element)) rels.add(q.subject.value);
  }
  return [...rels];
}

/** Everything that goes when an element is deleted from the model. */
export function collectElementQuads(store: RdfStore, elementIri: string): Quad[] {
  const element = nn(elementIri);
  const quads: Quad[] = [];

  for (const rel of relationshipsTouching(store, elementIri)) {
    quads.push(...collectRelationshipQuads(store, rel));
  }

  for (const q of store.getQuads(null, T.archElement, element)) {
    const node = q.subject;
    // A placement's own style — its look, what its label says — goes with it.
    quads.push(...store.getQuads(node as NamedNode, null, null), ...ownedQuads(store, node));
    for (const end of [T.visSource, T.visTarget]) {
      for (const link of store.getQuads(null, end, node as NamedNode)) {
        quads.push(...linkQuads(store, link.subject));
      }
    }
  }

  quads.push(...store.getQuads(element, null, null));
  // Its names for each audience.
  quads.push(...ownedQuads(store, element));
  quads.push(...store.getQuads(null, null, element).filter((q) => q.graph.termType === 'DefaultGraph'));
  return dedupe(quads);
}
