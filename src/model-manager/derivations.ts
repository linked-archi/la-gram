/**
 * Derived relationships: what a derivation rule concluded, not what a modeller
 * stated (D29–D32; meta's DD-27 and DD-28).
 *
 * A rule writes a resource with the relationship's class and ends, its
 * certainty (`…/derivation#derivationCertainty`: `Valid` or `Potential`), its
 * premises (`prov:wasDerivedFrom`) and the derivation activity that generated
 * it, whose association names the rule as its plan. A valid derivation also
 * asserts the direct triple and the qualified predicate leading to it: it holds,
 * though nobody stated it. A potential one asserts neither — a proposition —
 * until a modeller confirms it by asserting both ({@link confirmationQuads});
 * it then is a relationship of the model, its certainty kept as the record of
 * the rule that proposed it.
 *
 * la-gram does not run the rules (they need a server-side engine); it shows
 * what a model's file brings, and confirms.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { isQualifiedPredicate, qualifiedFormOf, relationshipClassOf, unqualifiedFormOf } from './cascade.js';
import { IRI, T, localName, nn, triple } from './vocabulary.js';

/** The default graph: the model. */
const MODEL_GRAPH = DataFactory.defaultGraph() as unknown as NamedNode;

const PROV = NAMESPACES.prov;

/** How sure a rule is of what it derived (Appendix B of ArchiMate: valid or potential). */
export type DerivationCertainty = 'valid' | 'potential';

/** Whether a resource is derived, how surely, and whether a modeller has confirmed it. */
export interface DerivationStatus {
  certainty: DerivationCertainty;
  /**
   * A potential derivation a qualified predicate leads to. Its triple alone does
   * not say so: another derivation of the same triple, confirmed, asserts it too.
   */
  confirmed: boolean;
}

/** A derivation, with the rule that made it and what it was derived from. */
export interface DerivationDetails extends DerivationStatus {
  /** The rule: the plan of the activity that generated the derivation. */
  rule?: string;
  /** The relationships it was derived from. */
  premises: string[];
}

/**
 * Whether a predicate is a notation's derivation certainty. Each notation's
 * rules declare their own (`am4deriv:derivationCertainty`,
 * `amderiv:derivationCertainty`), so it is recognised by its local name.
 */
export function isCertaintyPredicate(predicateIri: string): boolean {
  return predicateIri.endsWith('#derivationCertainty') || predicateIri.endsWith('/derivationCertainty');
}

/** The certainty a value of it names: its local name, `Valid` or `Potential`. */
export function certaintyNamed(valueIri: string): DerivationCertainty | undefined {
  const name = localName(valueIri);
  return name === 'Valid' ? 'valid' : name === 'Potential' ? 'potential' : undefined;
}

/** A resource's derivation certainty, when it is a derivation. */
export function certaintyOf(store: RdfStore, iri: string): DerivationCertainty | undefined {
  for (const q of store.getQuads(nn(iri), null, null, MODEL_GRAPH)) {
    if (isCertaintyPredicate(q.predicate.value) && q.object.termType === 'NamedNode') {
      const certainty = certaintyNamed(q.object.value);
      if (certainty) return certainty;
    }
  }
  return undefined;
}

/**
 * Whether a resource is a proposition, not a relationship of the model (core's
 * `arch:QualifiedRelationship`): it reifies a triple the model does not assert,
 * and no qualified predicate leads to it — a potential derivation, until a
 * modeller confirms it.
 */
export function isProposition(store: RdfStore, iri: string): boolean {
  const reified = store.getQuads(nn(iri), T.reifies, null, MODEL_GRAPH).map((q) => q.object);
  if (!reified.some((term) => term.termType === 'Quad')) return false;
  for (const term of reified) {
    if (term.termType !== 'Quad') continue;
    const { subject, predicate, object } = term as unknown as Quad;
    if (store.getQuads(subject as NamedNode, predicate as NamedNode, object as NamedNode, MODEL_GRAPH).length > 0) return false;
  }
  return !store.getQuads(null, null, nn(iri), MODEL_GRAPH).some((q) => isQualifiedPredicate(store, q.predicate.value));
}

/** Whether a qualified predicate leads to a resource: a relationship of the model, not a proposition about one. */
export function isLedTo(store: RdfStore, iri: string): boolean {
  return store.getQuads(null, null, nn(iri), MODEL_GRAPH).some((q) => isQualifiedPredicate(store, q.predicate.value));
}

/** Whether a resource is derived, how surely, and whether it was confirmed; `undefined` when it is not derived. */
export function derivationStatus(store: RdfStore, iri: string): DerivationStatus | undefined {
  const certainty = certaintyOf(store, iri);
  if (!certainty) return undefined;
  return { certainty, confirmed: certainty === 'potential' && isLedTo(store, iri) };
}

/**
 * A derivation that is not a relationship the model states: a valid one, or a
 * potential one not confirmed. What the model's membership, its auto-layout and
 * the explorer's Relationships leave out.
 */
export function isUnstatedDerivation(store: RdfStore, iri: string): boolean {
  const status = derivationStatus(store, iri);
  return status !== undefined && !status.confirmed;
}

/** The rule that derived a resource: the plan of the activity that generated it (D30). */
export function ruleOf(store: RdfStore, iri: string): string | undefined {
  for (const generated of store.getQuads(nn(iri), nn(PROV + 'wasGeneratedBy'), null, MODEL_GRAPH)) {
    if (generated.object.termType !== 'NamedNode') continue;
    for (const association of store.getQuads(generated.object, nn(PROV + 'qualifiedAssociation'), null, MODEL_GRAPH)) {
      if (association.object.termType !== 'NamedNode') continue;
      const plan = store.getQuads(association.object, nn(PROV + 'hadPlan'), null, MODEL_GRAPH)[0]?.object.value;
      if (plan) return plan;
    }
  }
  return undefined;
}

/** A derivation with its rule and premises; `undefined` when the resource is not derived. */
export function derivationDetails(store: RdfStore, iri: string): DerivationDetails | undefined {
  const status = derivationStatus(store, iri);
  if (!status) return undefined;
  const rule = ruleOf(store, iri);
  const premises = store
    .getQuads(nn(iri), nn(PROV + 'wasDerivedFrom'), null, MODEL_GRAPH)
    .map((q) => q.object.value)
    .sort();
  return { ...status, ...(rule ? { rule } : {}), premises };
}

/**
 * What confirming a potential derivation asserts: its direct triple, the
 * qualified predicate leading to it from its source, and its membership of the
 * model — each only where the model does not have it yet. Nothing for a
 * resource that is not an unconfirmed potential derivation.
 */
export function confirmationQuads(store: RdfStore, iri: string, modelIri?: string): Quad[] {
  const status = derivationStatus(store, iri);
  if (status?.certainty !== 'potential' || status.confirmed) return [];
  const rel = nn(iri);
  const source = store.getQuads(rel, T.source, null, MODEL_GRAPH)[0]?.object;
  const target = store.getQuads(rel, T.target, null, MODEL_GRAPH)[0]?.object;
  if (source?.termType !== 'NamedNode' || target?.termType !== 'NamedNode') return [];
  const classIri = relationshipClassOf(store, iri) ?? IRI.QualifiedRelationship;
  // The triple it reifies, else the one its class stands for.
  const reified = store.getQuads(rel, T.reifies, null, MODEL_GRAPH).map((q) => q.object).find((t) => t.termType === 'Quad') as
    | Quad
    | undefined;
  const predicate = reified?.predicate.value ?? unqualifiedFormOf(store, classIri);
  const add: Quad[] = [];
  if (predicate && store.getQuads(source, nn(predicate), target, MODEL_GRAPH).length === 0) add.push(triple(source, nn(predicate), target));
  add.push(triple(source, nn(qualifiedFormOf(store, classIri)), rel));
  if (modelIri && store.getQuads(rel, T.inModel, null, MODEL_GRAPH).length === 0) add.push(triple(rel, T.inModel, nn(modelIri)));
  return add;
}
