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
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { ViewInfo } from './interfaces.js';
import { IRI, T, humanize, localName, nn } from './vocabulary.js';

/** What names a concept, in the order {@link labelOf} prefers them. */
const NAMING_PREDICATES = [T.prefLabel, T.rdfsLabel, nn(IRI.dctermsTitle)];

/** The default graph: the model. */
const MODEL_GRAPH = DataFactory.defaultGraph() as unknown as NamedNode;

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

/**
 * Namespaces whose types are never model concepts: geometry and the RDF
 * vocabularies, and the provenance and schema.org metadata a converter records
 * about a conversion — its run, its agent, its source file, its named graphs.
 * A resource typed with nothing else is not a member of the model.
 */
const NON_MODEL_NAMESPACES = [
  NAMESPACES['arch-vis'],
  NAMESPACES.rdf,
  NAMESPACES.rdfs,
  NAMESPACES.owl,
  NAMESPACES.sh,
  NAMESPACES.skos,
  NAMESPACES.prov,
  'https://schema.org/',
  'http://schema.org/',
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
  // The model's names first — which the application's store answers from its
  // copy in JavaScript — then every graph's (a class's, in its metamodel).
  for (const graph of [MODEL_GRAPH, null]) {
    for (const predicate of NAMING_PREDICATES) {
      const literals = store.getQuads(subject, predicate, null, graph).map((q) => q.object);
      if (literals.length === 0) continue;
      return preferredLiteral(literals, preferredLanguage).value;
    }
  }
  return humanize(localName(iri));
}

/** Of a name's literals, the one in the preferred language, else one without a language, else the first. */
function preferredLiteral<T extends { value: string }>(literals: readonly T[], preferredLanguage: string): T {
  return (
    literals.find((l) => (l as { language?: string }).language === preferredLanguage) ??
    literals.find((l) => !(l as { language?: string }).language) ??
    literals[0]
  );
}

/** Whether `iri` has a name of its own, rather than one {@link labelOf} makes from its IRI. */
export function hasLabel(store: RdfStore, iri: string): boolean {
  const subject = nn(iri);
  return [MODEL_GRAPH, null].some((graph) => NAMING_PREDICATES.some((predicate) => store.getQuads(subject, predicate, null, graph).length > 0));
}

/**
 * A resource's statements with a predicate: the model's, when it has any —
 * which the application's store answers from its copy in JavaScript — else
 * those of every graph (a class's name, in its metamodel). Task 22.
 */
export function statementsOf(store: RdfStore, subject: NamedNode, predicate: NamedNode): Quad[] {
  const own = store.getQuads(subject, predicate, null, MODEL_GRAPH);
  return own.length > 0 ? own : store.getQuads(subject, predicate);
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
  // One pass over the model for what the tree shows of each concept — its
  // types, names and ends — rather than a query a concept (Task 22).
  const quads = modelQuads(store);
  const typesOf = new Map<string, string[]>();
  const inModel = new Set<string>();
  const NAMING = new Set(NAMING_PREDICATES.map((p) => p.value));
  const ENDS = new Set([IRI.source, IRI.legacyRelSource, IRI.target, IRI.legacyRelTarget]);
  const names = new Map<string, Map<string, Term[]>>();
  const ends = new Map<string, Map<string, string>>();
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode') continue;
    const p = q.predicate.value;
    if (p === IRI.rdfType) {
      const list = typesOf.get(q.subject.value);
      if (list) list.push(q.object.value);
      else typesOf.set(q.subject.value, [q.object.value]);
    } else if (p === IRI.inModel || p === IRI.legacyPartOfModel) {
      inModel.add(q.subject.value);
    } else if (NAMING.has(p) && q.object.termType === 'Literal') {
      let byPredicate = names.get(q.subject.value);
      if (!byPredicate) names.set(q.subject.value, (byPredicate = new Map()));
      const list = byPredicate.get(p);
      if (list) list.push(q.object);
      else byPredicate.set(p, [q.object]);
    } else if (ENDS.has(p)) {
      let byPredicate = ends.get(q.subject.value);
      if (!byPredicate) ends.set(q.subject.value, (byPredicate = new Map()));
      if (!byPredicate.has(p)) byPredicate.set(p, q.object.value);
    }
  }
  /** A concept's name from the model; one the model does not name is looked up as before. */
  const nameOf = (iri: string): string => {
    const byPredicate = names.get(iri);
    for (const predicate of NAMING_PREDICATES) {
      const literals = byPredicate?.get(predicate.value);
      if (literals && literals.length > 0) return preferredLiteral(literals, 'en').value;
    }
    return labelOf(store, iri);
  };

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
  const first = (subject: string, predicate: string) => ends.get(subject)?.get(predicate);

  for (const [iri, types] of typesOf) {
    const kind = classify(types, closure, inModel.has(iri));
    // The most specific type is the one whose closure is largest.
    const typeIri =
      [...types].sort((a, b) => closure(b).length - closure(a).length)[0] ?? IRI.ModelConcept;
    switch (kind) {
      case 'model':
        contents.model = { iri, label: nameOf(iri) };
        break;
      case 'element':
        contents.elements.push({ iri, typeIri, typeLabel: typeLabel(typeIri), label: nameOf(iri) });
        break;
      case 'unclassified':
        contents.unclassified.push({ iri, typeIri, typeLabel: typeLabel(typeIri), label: nameOf(iri) });
        break;
      case 'relationship': {
        const relType = types.find((t) => t !== IRI.QualifiedRelationship) ?? typeIri;
        const sourceIri = first(iri, IRI.source) ?? first(iri, IRI.legacyRelSource);
        const targetIri = first(iri, IRI.target) ?? first(iri, IRI.legacyRelTarget);
        const explicit = names.get(iri)?.get(T.prefLabel.value)?.[0]?.value;
        const label =
          explicit ??
          `${sourceIri ? nameOf(sourceIri) : '?'} → ${targetIri ? nameOf(targetIri) : '?'}`;
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
