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
 * - its unqualified triple `source predicate target` — unless another qualified
 *   resource of the same kind still connects the same pair, in which case the
 *   triple is still true and stays;
 * - every `arch-vis:Link` drawing it, in any view, with its route;
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
import { IRI, T, dedupe, nn } from './vocabulary.js';

/** Endpoint predicates on a qualified relationship, current first. */
const ENDPOINTS = [IRI.source, IRI.target, IRI.legacyRelSource, IRI.legacyRelTarget].map(nn);

function objects(store: RdfStore, subject: Term, predicate: NamedNode): string[] {
  return store.getQuads(subject as NamedNode, predicate).map((q) => q.object.value);
}

/** The unqualified predicate a relationship class maps to, from any graph. */
export function unqualifiedFormOf(store: RdfStore, classIri: string): string | undefined {
  return store.getQuads(nn(classIri), T.unqualifiedForm)[0]?.object.value;
}

/** The relationship class of a qualified resource: its type other than the generic one. */
export function relationshipClassOf(store: RdfStore, relationshipIri: string): string | undefined {
  const types = objects(store, nn(relationshipIri), T.rdfType);
  return types.find((t) => t !== IRI.QualifiedRelationship) ?? types[0];
}

/** The quads of a link: its own, its point list cells and points. */
function linkQuads(store: RdfStore, link: Term): Quad[] {
  const quads = [...store.getQuads(link as NamedNode, null, null)];
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

/** Everything that goes when a qualified relationship is deleted from the model. */
export function collectRelationshipQuads(store: RdfStore, relationshipIri: string): Quad[] {
  const rel = nn(relationshipIri);
  const quads: Quad[] = [...store.getQuads(rel, null, null)];

  // The unqualified triple, unless a sibling occurrence keeps it true.
  const sourceIri = objects(store, rel, T.source)[0] ?? objects(store, rel, nn(IRI.legacyRelSource))[0];
  const targetIri = objects(store, rel, T.target)[0] ?? objects(store, rel, nn(IRI.legacyRelTarget))[0];
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
    quads.push(...store.getQuads(node as NamedNode, null, null));
    for (const end of [T.visSource, T.visTarget]) {
      for (const link of store.getQuads(null, end, node as NamedNode)) {
        quads.push(...linkQuads(store, link.subject));
      }
    }
  }

  quads.push(...store.getQuads(element, null, null));
  quads.push(...store.getQuads(null, null, element).filter((q) => q.graph.termType === 'DefaultGraph'));
  return dedupe(quads);
}
