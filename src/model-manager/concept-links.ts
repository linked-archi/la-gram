/**
 * The links between model concepts that are not relationships — and the test of what a model concept is.
 *
 * The property panel splits what a concept says by what it says it about: a link to another concept of the
 * model belongs with its relationships, on the *Analysis* tab; a data property, or a link to anything else
 * — a value of the metamodel's reference data, a document, an address outside the model — is a property, on
 * the *Properties* tab. A relationship is listed by its resource; this lists the rest: a triple between two
 * concepts that no relationship stands for (`ad:relatedDecision`, `ap:responsibleFor`), either way round.
 *
 * Left out, because something else lists them: the triple a relationship reifies, and the declared inverse
 * of one (`ap:taskOfActivity` beside a drawn *Has Task*); the qualified predicate leading to a relationship;
 * a relationship's ends, its model and its views; derivations' provenance. A triple stated both ways round,
 * through a declared inverse, is listed once, from the side the selected concept states it.
 */

import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { isQualifiedPredicate } from './cascade.js';
import { isCertaintyPredicate } from './derivations.js';
import { classify, typeClosure, type TypeClosure } from './model-queries.js';
import { IRI, T, nn } from './vocabulary.js';

/** The default graph: the model. */
const MODEL_GRAPH = { termType: 'DefaultGraph', value: '' } as unknown as NamedNode;

/** A link between the selected concept and another, which no relationship stands for. */
export interface ConceptLink {
  predicateIri: string;
  /** `out`: the selected concept is the subject; `in`: the object. */
  direction: 'out' | 'in';
  otherIri: string;
}

/** Predicates that say where a concept is or what it joins, not what it is linked to. */
const STRUCTURAL = new Set([IRI.rdfType, IRI.source, IRI.target, IRI.inModel, IRI.inView, IRI.reifies]);

/**
 * A test of whether an IRI is a concept of the model: typed in the model's data as an element, a
 * relationship, or with a type no loaded metamodel classifies (shown as a concept too). Not a view, the model,
 * drawing, a folder; not a resource the model does not type — a reference data value, an address outside.
 * Built once over the store's types; call it for as many IRIs as needed.
 */
export function modelConceptTest(store: RdfStore, closure: TypeClosure = typeClosure(store)): (iri: string) => boolean {
  const typesOf = new Map<string, string[]>();
  for (const q of store.getQuads(null, T.rdfType, null, MODEL_GRAPH)) {
    if (q.subject.termType !== 'NamedNode') continue;
    const list = typesOf.get(q.subject.value) ?? [];
    list.push(q.object.value);
    typesOf.set(q.subject.value, list);
  }
  const known = new Map<string, boolean>();
  return (iri) => {
    let answer = known.get(iri);
    if (answer === undefined) {
      const types = typesOf.get(iri);
      const kind = types ? classify(types, closure, true) : undefined;
      answer = kind === 'element' || kind === 'relationship' || kind === 'unclassified';
      known.set(iri, answer);
    }
    return answer;
  };
}

/** The links between `iri` and other concepts of the model that no relationship stands for (see the module doc). */
export function conceptLinks(store: RdfStore, iri: string, isConcept: (iri: string) => boolean = modelConceptTest(store)): ConceptLink[] {
  const reified = new Set<string>();
  for (const q of store.getQuads(null, T.reifies, null, MODEL_GRAPH)) {
    if (q.object.termType !== 'Quad') continue;
    const term = q.object as unknown as Quad;
    if (term.subject.value === iri || term.object.value === iri) {
      reified.add(`${term.subject.value} ${term.predicate.value} ${term.object.value}`);
    }
  }
  const inverses = new Map<string, string[]>();
  const pair = (a: string, b: string) => inverses.set(a, [...(inverses.get(a) ?? []), b]);
  for (const q of store.getQuads(null, T.inverseOf, null)) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
    pair(q.subject.value, q.object.value);
    pair(q.object.value, q.subject.value);
  }
  const stated = (s: string, p: string, o: string) => store.getQuads(nn(s), nn(p), nn(o), MODEL_GRAPH).length > 0;
  const qualified = new Map<string, boolean>();
  const listed = (p: string): boolean => {
    if (STRUCTURAL.has(p) || p.startsWith(NAMESPACES.prov) || isCertaintyPredicate(p)) return false;
    if (!qualified.has(p)) qualified.set(p, isQualifiedPredicate(store, p));
    return !qualified.get(p);
  };
  // The triple, or its inverse read the other way, is a relationship's.
  const drawn = (s: string, p: string, o: string): boolean =>
    reified.has(`${s} ${p} ${o}`) || (inverses.get(p) ?? []).some((inverse) => reified.has(`${o} ${inverse} ${s}`));

  const links: ConceptLink[] = [];
  for (const q of store.getQuads(nn(iri), null, null, MODEL_GRAPH)) {
    const p = q.predicate.value;
    if (q.object.termType !== 'NamedNode' || !listed(p) || !isConcept(q.object.value)) continue;
    if (drawn(iri, p, q.object.value)) continue;
    links.push({ predicateIri: p, direction: 'out', otherIri: q.object.value });
  }
  for (const q of store.getQuads(null, null, nn(iri), MODEL_GRAPH)) {
    const p = q.predicate.value;
    if (q.subject.termType !== 'NamedNode' || q.subject.value === iri || !listed(p) || !isConcept(q.subject.value)) continue;
    if (drawn(q.subject.value, p, iri)) continue;
    // Stated the other way round as well: listed once, as this concept states it.
    if ((inverses.get(p) ?? []).some((inverse) => stated(iri, inverse, q.subject.value))) continue;
    links.push({ predicateIri: p, direction: 'in', otherIri: q.subject.value });
  }
  return links;
}
