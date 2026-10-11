/**
 * Read-side queries over the model data: what is in the model, and what kind
 * of thing each resource is.
 *
 * ## Where model data lives
 *
 * At runtime the model is the store's *default graph*; every metamodel document
 * sits in a named graph of its own (see `N3MetamodelLoader`). That split is what
 * lets a metamodel be swapped without touching anybody's work, and what the
 * serializer relies on to write only the model. Files are laid out differently
 * — DD-15's `graph/model`, `graph/semantic`, `graph/views` — and `model-io.ts`
 * maps between the two.
 *
 * ## Classifying a resource
 *
 * By the `rdfs:subClassOf*` closure of its types over *all* graphs, so an
 * `am4:ApplicationComponent` is recognised as an element through ArchiMate's
 * own hierarchy up to `arch:Element`. A resource whose type the loaded
 * metamodels do not know is still shown (as "unclassified") when it declares
 * `arch:inModel`: a model opened before its metamodel is loaded must not look
 * empty.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { ViewInfo } from './interfaces.js';
import { IRI, T, humanize, localName, nn } from './vocabulary.js';

/** What names a concept, in the order {@link labelOf} prefers them. */
const NAMING_PREDICATES = [T.prefLabel, T.rdfsLabel, nn(IRI.dctermsTitle)];

/** `rdfs:subClassOf*` closure of a type, the type included. */
export type TypeClosure = (typeIri: string) => string[];

/** Kinds of model resource the explorer distinguishes. */
export type ConceptKind = 'model' | 'view' | 'element' | 'relationship' | 'geometry' | 'unclassified';

/** One element or unclassified concept. */
export interface ConceptSummary {
  iri: string;
  typeIri: string;
  typeLabel: string;
  label: string;
}

/** One relationship, with its ends. */
export interface RelationshipSummary extends ConceptSummary {
  sourceIri?: string;
  targetIri?: string;
}

/** Everything the explorer shows. */
export interface ModelContents {
  model?: { iri: string; label: string };
  views: ViewInfo[];
  elements: ConceptSummary[];
  relationships: RelationshipSummary[];
  unclassified: ConceptSummary[];
}

/** Namespaces whose types are never model concepts. */
const NON_MODEL_NAMESPACES = [
  NAMESPACES['arch-vis'],
  NAMESPACES.rdf,
  NAMESPACES.rdfs,
  NAMESPACES.owl,
  NAMESPACES.sh,
  NAMESPACES.skos,
];

/** Every quad in the default graph — the model data. */
export function modelQuads(store: RdfStore): Quad[] {
  return store.getQuads(null, null, null, DataFactory.defaultGraph() as unknown as NamedNode);
}

/** Build a closure function over the store's current class hierarchy. */
export function typeClosure(store: RdfStore): TypeClosure {
  const parents = new Map<string, string[]>();
  for (const q of store.getQuads(null, T.subClassOf, null)) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
    const list = parents.get(q.subject.value);
    if (list) list.push(q.object.value);
    else parents.set(q.subject.value, [q.object.value]);
  }
  const cache = new Map<string, string[]>();
  return (typeIri: string) => {
    const cached = cache.get(typeIri);
    if (cached) return cached;
    const seen = new Set<string>([typeIri]);
    const stack = [...(parents.get(typeIri) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(parents.get(current) ?? []));
    }
    const closure = [...seen];
    cache.set(typeIri, closure);
    return closure;
  };
}

/** Classify a resource from its types. */
export function classify(types: readonly string[], closure: TypeClosure, hasInModel: boolean): ConceptKind {
  if (types.includes(IRI.Model)) return 'model';
  const all = new Set(types.flatMap((t) => closure(t)));
  if (all.has(IRI.View)) return 'view';
  if (all.has(IRI.QualifiedRelationship)) return 'relationship';
  if (types.some((t) => t.startsWith(NAMESPACES['arch-vis']))) return 'geometry';
  // Folders are presentation (DD-15): navigation structure, not model content.
  if (types.includes(NAMESPACES.arch + 'Folder')) return 'geometry';
  if (all.has(IRI.Element)) return 'element';
  if (types.every((t) => NON_MODEL_NAMESPACES.some((ns) => t.startsWith(ns)))) return 'geometry';
  // A type no loaded metamodel classifies. Shown, not hidden: a model opened
  // before its metamodel is loaded must not look empty. `hasInModel` is kept in
  // the signature for callers that want to tell members from strays.
  void hasInModel;
  return 'unclassified';
}

/** Human label for a class or concept: `skos:prefLabel`, then `rdfs:label`, then the local name. */
export function labelOf(store: RdfStore, iri: string, preferredLanguage = 'en'): string {
  const subject = nn(iri);
  for (const predicate of NAMING_PREDICATES) {
    const literals = store.getQuads(subject, predicate).map((q) => q.object);
    if (literals.length === 0) continue;
    const preferred =
      literals.find((l) => (l as { language?: string }).language === preferredLanguage) ??
      literals.find((l) => !(l as { language?: string }).language) ??
      literals[0];
    return preferred.value;
  }
  return humanize(localName(iri));
}

/** Whether `iri` has a name of its own, rather than one {@link labelOf} makes from its IRI. */
export function hasLabel(store: RdfStore, iri: string): boolean {
  const subject = nn(iri);
  return NAMING_PREDICATES.some((predicate) => store.getQuads(subject, predicate).length > 0);
}

/** The model's `arch:Model` resource, if the data declares one. */
export function findModelIri(store: RdfStore): string | undefined {
  const models = modelQuads(store)
    .filter((q) => q.predicate.value === IRI.rdfType && q.object.value === IRI.Model)
    .map((q) => q.subject.value)
    .sort();
  return models[0];
}

/**
 * Everything in the model, classified.
 *
 * @param views The view list, from the view manager, so this module does not
 *   duplicate view reading.
 */
export function readModelContents(store: RdfStore, views: ViewInfo[], closure: TypeClosure = typeClosure(store)): ModelContents {
  const quads = modelQuads(store);
  const typesOf = new Map<string, string[]>();
  const inModel = new Set<string>();
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode') continue;
    if (q.predicate.value === IRI.rdfType) {
      const list = typesOf.get(q.subject.value);
      if (list) list.push(q.object.value);
      else typesOf.set(q.subject.value, [q.object.value]);
    } else if (q.predicate.value === IRI.inModel || q.predicate.value === IRI.legacyPartOfModel) {
      inModel.add(q.subject.value);
    }
  }

  const typeLabels = new Map<string, string>();
  const typeLabel = (typeIri: string) => {
    let label = typeLabels.get(typeIri);
    if (label === undefined) {
      label = labelOf(store, typeIri);
      typeLabels.set(typeIri, label);
    }
    return label;
  };

  const contents: ModelContents = { views, elements: [], relationships: [], unclassified: [] };
  const first = (subject: string, predicate: string) =>
    store.getQuads(nn(subject), nn(predicate))[0]?.object.value;

  for (const [iri, types] of typesOf) {
    const kind = classify(types, closure, inModel.has(iri));
    // The most specific type is the one whose closure is largest.
    const typeIri =
      [...types].sort((a, b) => closure(b).length - closure(a).length)[0] ?? IRI.ModelConcept;
    switch (kind) {
      case 'model':
        contents.model = { iri, label: labelOf(store, iri) };
        break;
      case 'element':
        contents.elements.push({ iri, typeIri, typeLabel: typeLabel(typeIri), label: labelOf(store, iri) });
        break;
      case 'unclassified':
        contents.unclassified.push({ iri, typeIri, typeLabel: typeLabel(typeIri), label: labelOf(store, iri) });
        break;
      case 'relationship': {
        const relType = types.find((t) => t !== IRI.QualifiedRelationship) ?? typeIri;
        const sourceIri = first(iri, IRI.source) ?? first(iri, IRI.legacyRelSource);
        const targetIri = first(iri, IRI.target) ?? first(iri, IRI.legacyRelTarget);
        const explicit = store.getQuads(nn(iri), T.prefLabel)[0]?.object.value;
        const label =
          explicit ??
          `${sourceIri ? labelOf(store, sourceIri) : '?'} → ${targetIri ? labelOf(store, targetIri) : '?'}`;
        contents.relationships.push({
          iri,
          typeIri: relType,
          typeLabel: typeLabel(relType),
          label,
          ...(sourceIri ? { sourceIri } : {}),
          ...(targetIri ? { targetIri } : {}),
        });
        break;
      }
      default:
        break;
    }
  }

  const byLabel = (a: ConceptSummary, b: ConceptSummary) =>
    a.typeLabel.localeCompare(b.typeLabel) || a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri);
  contents.elements.sort(byLabel);
  contents.relationships.sort(byLabel);
  contents.unclassified.sort(byLabel);
  return contents;
}
