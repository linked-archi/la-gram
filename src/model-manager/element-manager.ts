/**
 * Element Manager — CRUD operations for architecture model elements.
 *
 * An element is a model concept, not a shape: creating one writes its type, its
 * model membership and its label, and nothing about where it is drawn. Placing
 * it on a diagram is {@link ViewManager.addElementToView}'s job, so the same
 * element can appear in any number of views — or in none — and still be one
 * RDF resource.
 *
 * ```turtle
 * <model>/element/3f2c…  a am4:ApplicationComponent ;
 *     arch:inModel <model> ;
 *     skos:prefLabel "Order Service"@en .
 * ```
 *
 * Labels are language-tagged: the Linked.Archi element shapes reject a plain
 * string `skos:prefLabel`.
 *
 * Deletion here is deletion from the *model* — every view, every relationship.
 * See `cascade.ts` for exactly what goes.
 */

import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { mintIri } from '../rdf-engine/iri.js';
import { collectElementQuads } from './cascade.js';
import type { CreateElementOptions, ElementManager } from './interfaces.js';
import { T, langLiteral, nn, triple } from './vocabulary.js';

/**
 * Kept for source compatibility with callers that reset the old counter in
 * test setup. IRIs are UUID-based now, so there is nothing to reset.
 */
export function resetElementCounter(): void {
  /* no-op: IRIs are random, not counted */
}

/** Concrete {@link ElementManager} over an {@link RdfStore}. */
export class OxigraphElementManager implements ElementManager {
  constructor(private readonly store: RdfStore) {}

  createElement(typeIri: string, modelIri: string, options: CreateElementOptions = {}): NamedNode {
    const element = nn(options.iri ?? mintIri(modelIri, 'element'));
    const quads: Quad[] = [triple(element, T.rdfType, nn(typeIri))];
    if (modelIri) quads.push(triple(element, T.inModel, nn(modelIri)));
    const label = options.label?.trim();
    if (label) quads.push(triple(element, T.prefLabel, langLiteral(label, options.language)));
    this.store.addQuads(quads);
    return element;
  }

  updateProperty(elementIri: string, property: string, value: Term): void {
    const subject = nn(elementIri);
    const predicate = nn(property);
    const existing = this.store.getQuads(subject, predicate);
    if (existing.length > 0) this.store.removeQuads(existing);
    this.store.addQuads([triple(subject, predicate, value)]);
  }

  deleteElement(elementIri: string): void {
    const quads = this.collectElementQuads(elementIri);
    if (quads.length > 0) this.store.removeQuads(quads);
  }

  collectElementQuads(elementIri: string): Quad[] {
    return collectElementQuads(this.store, elementIri);
  }
}
