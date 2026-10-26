/**
 * Part of the model, as statements: what the RDF panel shows when it shows a
 * view or a concept rather than the whole model (`ui/panels/rdf-panel.ts`), and
 * what it writes when that is copied or downloaded.
 *
 * - A view: the view's own statements, those of every concept it presents
 *   (`arch:inView`), and its diagram — the nodes and links drawn in it
 *   (`arch-vis:view`), with their routes.
 * - Concepts — a selection of one or several: their own statements and, given
 *   the open view, how they are drawn there.
 *
 * Read from the model graph only, so a vocabulary's statements about a type
 * never appear. Each subject comes with what only it reaches — blank nodes and
 * the cells and points of a route list — as a saved file has them.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { IRI, T, nn } from './vocabulary.js';

/** The default graph: the model. */
const MODEL_GRAPH = DataFactory.defaultGraph() as unknown as NamedNode;

/** Predicates whose objects are part of their subject: a route's list and its points. */
const LIST_PREDICATES = new Set([IRI.points, IRI.rdfFirst, IRI.rdfRest]);

const key = (term: Term): string => `${term.termType}:${term.value}`;

/** The statements of `subjects`, with the blank nodes and route lists they reach. */
export function statementsOf(store: RdfStore, subjects: Iterable<Term>): Quad[] {
  const quads: Quad[] = [];
  const seen = new Set<string>();
  const queue = [...subjects];
  while (queue.length > 0) {
    const subject = queue.pop() as Term;
    if (seen.has(key(subject))) continue;
    seen.add(key(subject));
    for (const q of store.getQuads(subject as NamedNode, null, null, MODEL_GRAPH)) {
      quads.push(q);
      const object = q.object;
      const reached =
        object.termType === 'BlankNode' ||
        (object.termType === 'NamedNode' && LIST_PREDICATES.has(q.predicate.value) && object.value !== IRI.rdfNil);
      if (reached && !seen.has(key(object))) queue.push(object);
    }
  }
  return quads;
}

/** A view's statements: its own, its concepts', and its diagram's. */
export function viewStatements(store: RdfStore, viewIri: string): Quad[] {
  const view = nn(viewIri);
  return statementsOf(store, [
    view,
    ...store.getQuads(null, T.inView, view, MODEL_GRAPH).map((q) => q.subject),
    ...store.getQuads(null, T.visView, view, MODEL_GRAPH).map((q) => q.subject),
  ]);
}

/** Concepts' statements — one IRI or a selection of several — and how they are drawn in the open view. */
export function conceptStatements(store: RdfStore, iris: string | readonly string[], viewIri?: string): Quad[] {
  const concepts = (typeof iris === 'string' ? [iris] : [...iris]).map(nn);
  const drawnHere = (q: Quad) =>
    viewIri !== undefined && store.getQuads(q.subject as NamedNode, T.visView, nn(viewIri), MODEL_GRAPH).length > 0;
  const drawings = concepts.flatMap((concept) =>
    [
      ...store.getQuads(null, T.archElement, concept, MODEL_GRAPH),
      ...store.getQuads(null, T.archRelationship, concept, MODEL_GRAPH),
    ].filter(drawnHere),
  );
  return statementsOf(store, [...concepts, ...drawings.map((q) => q.subject)]);
}
