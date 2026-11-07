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
import { IRI, T, humanize, localName, nn, relationshipClassAmong } from './vocabulary.js';
import { certaintyNamed, isCertaintyPredicate, isLedTo, ruleOf, type DerivationCertainty } from './derivations.js';

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
  /**
   * Set for a derivation the model does not state: a valid one, or a potential
   * one not confirmed (`derivations.ts`) — with the rule's local name.
   */
  derivation?: { certainty: DerivationCertainty; rule?: string };
}

/**
 * One folder of the model's own organisation (`arch:Folder`): where the tool a
 * model came from kept its concepts — Archi's folders, as the converters carry
 * them over. Navigation only: a folder is not a model concept.
 */
export interface FolderSummary {
  iri: string;
  label: string;
  /** The folder it is in; absent for a top-level folder. */
  parentIri?: string;
  /**
   * What it holds besides folders — by the member's `dcterms:isPartOf` or the
   * folder's `schema:itemListElement` — by IRI.
   */
  members: string[];
}

/** Everything the explorer shows. */
export interface ModelContents {
  model?: { iri: string; label: string };
  views: ViewInfo[];
  elements: ConceptSummary[];
  relationships: RelationshipSummary[];
  unclassified: ConceptSummary[];
  /** The model's folders, when it has any ({@link readFolders}). */
  folders?: FolderSummary[];
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

/**
 * The name the model gives `iri` — `skos:prefLabel`, then `rdfs:label`, then
 * `dcterms:title`, in the preferred language — or `undefined` when it gives
 * none. Read from the model graph alone, which the application's store answers
 * from its copy in JavaScript: a relationship's name, read for every line each
 * time a view is drawn, is never in a metamodel's graph (Task 22).
 */
export function modelNameOf(store: RdfStore, iri: string, preferredLanguage = 'en'): string | undefined {
  const subject = nn(iri);
  for (const predicate of NAMING_PREDICATES) {
    const literals = store.getQuads(subject, predicate, null, MODEL_GRAPH).map((q) => q.object);
    if (literals.length > 0) return preferredLiteral(literals, preferredLanguage).value;
  }
  return undefined;
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

/** schema.org, as converters write it, and its older `http:` form. */
const SCHEMA_NAMESPACES = ['https://schema.org/', 'http://schema.org/'];
const schemaTerms = (local: string): NamedNode[] => SCHEMA_NAMESPACES.map((ns) => nn(ns + local));
/** A folder's name, its list entries and an entry's item — the `https:` form first, the one la-gram writes. */
export const SCHEMA_NAME = schemaTerms('name');
export const SCHEMA_ITEM_LIST_ELEMENT = schemaTerms('itemListElement');
export const SCHEMA_ITEM = schemaTerms('item');

/** The predicates a folder is read from: a change to one of them may change the folders. */
const FOLDER_PREDICATES = new Set([IRI.dctermsIsPartOf, ...[SCHEMA_NAME, SCHEMA_ITEM_LIST_ELEMENT, SCHEMA_ITEM].flat().map((p) => p.value)]);

/**
 * The model's folders (`arch:Folder`), each with the folder it is in and what
 * it holds.
 *
 * A converter states a folder's contents from both ends — the member's
 * `dcterms:isPartOf` and the folder's `schema:itemListElement` — and either is
 * enough here: their union is read. The list's `schema:position` is not: it is
 * the order the source file happened to hold (an Archi model's, say), not an
 * order anybody arranged. A folder with several parent
 * folders is placed under one of them, the same one every time.
 */
export function readFolders(store: RdfStore): FolderSummary[] {
  const iris = store
    .getQuads(null, T.rdfType, T.Folder, MODEL_GRAPH)
    .filter((q) => q.subject.termType === 'NamedNode')
    .map((q) => q.subject.value);
  if (iris.length === 0) return [];
  const isFolder = new Set(iris);
  const folders: FolderSummary[] = [...isFolder].sort().map((iri) => ({ iri, label: folderLabel(store, iri), members: [] }));
  const parents = new Map<string, string>();
  for (const folder of folders) {
    const held = new Set<string>();
    for (const q of store.getQuads(null, T.dctermsIsPartOf, nn(folder.iri), MODEL_GRAPH)) {
      if (q.subject.termType === 'NamedNode') held.add(q.subject.value);
    }
    for (const listed of SCHEMA_ITEM_LIST_ELEMENT.flatMap((p) => store.getQuads(nn(folder.iri), p, null, MODEL_GRAPH))) {
      // The list entry is a blank node, which the store takes back as a subject.
      const entry = listed.object as NamedNode;
      const item = SCHEMA_ITEM.flatMap((p) => store.getQuads(entry, p, null, MODEL_GRAPH))[0]?.object;
      if (item?.termType === 'NamedNode') held.add(item.value);
    }
    held.delete(folder.iri);
    for (const member of held) {
      if (!isFolder.has(member)) folder.members.push(member);
      // Folders are visited in IRI order: a folder's parent is the first that holds it.
      else if (!parents.has(member)) parents.set(member, folder.iri);
    }
  }
  for (const folder of folders) {
    const parentIri = parents.get(folder.iri);
    if (parentIri) folder.parentIri = parentIri;
  }
  return folders;
}

/** A folder's name: `schema:name`, then the names a concept has, then its IRI's local name. */
function folderLabel(store: RdfStore, iri: string): string {
  const names = SCHEMA_NAME.flatMap((p) => store.getQuads(nn(iri), p, null, MODEL_GRAPH))
    .map((q) => q.object)
    .filter((o) => o.termType === 'Literal');
  return names.length > 0 ? preferredLiteral(names, 'en').value : labelOf(store, iri);
}

/** The model's `arch:Model` resource, if the data declares one. */
export function findModelIri(store: RdfStore): string | undefined {
  const models = modelQuads(store)
    .filter((q) => q.predicate.value === IRI.rdfType && q.object.value === IRI.Model)
    .map((q) => q.subject.value)
    .sort();
  return models[0];
}

/** What the tree shows of a concept is read from: its types, membership, names and ends. */
interface ConceptFacts {
  types: string[];
  inModel: boolean;
  /** Its names by naming predicate (literals only). */
  names: Map<string, Term[]>;
  /** Its first end by end predicate. */
  ends: Map<string, string>;
  /** Its derivation certainty, when it is a derivation. */
  certainty?: DerivationCertainty;
}

const NAMING = new Set(NAMING_PREDICATES.map((p) => p.value));
const ENDS = new Set([IRI.source, IRI.legacyRelSource, IRI.target, IRI.legacyRelTarget]);

/** The facts of each named subject of these quads, in one pass. */
function collectFacts(quads: Iterable<Quad>): Map<string, ConceptFacts> {
  const facts = new Map<string, ConceptFacts>();
  const of = (iri: string) => {
    let f = facts.get(iri);
    if (!f) facts.set(iri, (f = { types: [], inModel: false, names: new Map(), ends: new Map() }));
    return f;
  };
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode') continue;
    const p = q.predicate.value;
    if (p === IRI.rdfType) of(q.subject.value).types.push(q.object.value);
    else if (p === IRI.inModel || p === IRI.legacyPartOfModel) of(q.subject.value).inModel = true;
    else if (NAMING.has(p) && q.object.termType === 'Literal') {
      const names = of(q.subject.value).names;
      const list = names.get(p);
      if (list) list.push(q.object);
      else names.set(p, [q.object]);
    } else if (ENDS.has(p)) {
      const ends = of(q.subject.value).ends;
      if (!ends.has(p)) ends.set(p, q.object.value);
    } else if (isCertaintyPredicate(p) && q.object.termType === 'NamedNode') {
      const certainty = certaintyNamed(q.object.value);
      if (certainty) of(q.subject.value).certainty = certainty;
    }
  }
  return facts;
}

/** A concept as the tree lists it, or `undefined` when it is not one (geometry, a view). */
export type Summarised =
  | { kind: 'model'; summary: { iri: string; label: string } }
  | { kind: 'element' | 'unclassified'; summary: ConceptSummary }
  | { kind: 'relationship'; summary: RelationshipSummary };

/**
 * How a derivation is listed, from the store: `undefined` when the model states
 * it — a potential derivation a modeller confirmed.
 */
function derivationOf(store: RdfStore, iri: string, certainty: DerivationCertainty): RelationshipSummary['derivation'] {
  if (certainty === 'potential' && isLedTo(store, iri)) return undefined;
  const rule = ruleOf(store, iri);
  return { certainty, ...(rule ? { rule: localName(rule) } : {}) };
}

/** What the tree lists of a concept, from its facts. */
function summarize(
  iri: string,
  facts: ConceptFacts,
  closure: TypeClosure,
  nameOf: (iri: string) => string,
  typeLabel: (typeIri: string) => string,
  store?: RdfStore,
): Summarised | undefined {
  const { types } = facts;
  if (types.length === 0) return undefined;
  const kind = classify(types, closure, facts.inModel);
  // The most specific type is the one whose closure is largest.
  const typeIri = [...types].sort((a, b) => closure(b).length - closure(a).length)[0] ?? IRI.ModelConcept;
  switch (kind) {
    case 'model':
      return { kind, summary: { iri, label: nameOf(iri) } };
    case 'element':
    case 'unclassified':
      return { kind, summary: { iri, typeIri, typeLabel: typeLabel(typeIri), label: nameOf(iri) } };
    case 'relationship': {
      const relType = relationshipClassAmong(types, closure) ?? typeIri;
      const sourceIri = facts.ends.get(IRI.source) ?? facts.ends.get(IRI.legacyRelSource);
      const targetIri = facts.ends.get(IRI.target) ?? facts.ends.get(IRI.legacyRelTarget);
      const explicit = facts.names.get(T.prefLabel.value)?.[0]?.value;
      const label = explicit ?? `${sourceIri ? nameOf(sourceIri) : '?'} → ${targetIri ? nameOf(targetIri) : '?'}`;
      const derivation = facts.certainty && store ? derivationOf(store, iri, facts.certainty) : undefined;
      return {
        kind,
        summary: {
          iri,
          typeIri: relType,
          typeLabel: typeLabel(relType),
          label,
          ...(sourceIri ? { sourceIri } : {}),
          ...(targetIri ? { targetIri } : {}),
          ...(derivation ? { derivation } : {}),
        },
      };
    }
    default:
      return undefined;
  }
}

/** The order of the tree's lists: by type, name, IRI — a concept's place unique. */
function byLabel(a: ConceptSummary, b: ConceptSummary): number {
  return a.typeLabel.localeCompare(b.typeLabel) || a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri);
}

/** A cache of type labels, from the store. */
function typeLabels(store: RdfStore): (typeIri: string) => string {
  const labels = new Map<string, string>();
  return (typeIri) => {
    let label = labels.get(typeIri);
    if (label === undefined) labels.set(typeIri, (label = labelOf(store, typeIri)));
    return label;
  };
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
  const facts = collectFacts(modelQuads(store));
  /** A concept's name from the model; one the model does not name is looked up as before. */
  const nameOf = (iri: string): string => {
    const names = facts.get(iri)?.names;
    for (const predicate of NAMING_PREDICATES) {
      const literals = names?.get(predicate.value);
      if (literals && literals.length > 0) return preferredLiteral(literals, 'en').value;
    }
    return labelOf(store, iri);
  };
  const typeLabel = typeLabels(store);
  const contents: ModelContents = { views, elements: [], relationships: [], unclassified: [] };
  for (const [iri, f] of facts) {
    const concept = summarize(iri, f, closure, nameOf, typeLabel, store);
    if (!concept) continue;
    if (concept.kind === 'model') contents.model = concept.summary;
    else if (concept.kind === 'relationship') contents.relationships.push(concept.summary);
    else contents[concept.kind === 'element' ? 'elements' : 'unclassified'].push(concept.summary);
  }
  contents.elements.sort(byLabel);
  contents.relationships.sort(byLabel);
  contents.unclassified.sort(byLabel);
  contents.folders = readFolders(store);
  return contents;
}

/**
 * The model's contents, kept up to date by its changes (Task 22): the tree,
 * refreshed after every edit, read the whole model each time. Told each change
 * ({@link note}), it reads again, when next asked, only the concepts a change
 * touched — and the relationships whose label is made of their ends' names —
 * each from its own triples, and moves it in its sorted list. It reads the
 * whole model at first, when the metamodels change ({@link invalidate}), when
 * the class hierarchy changes, and when a change touches too many concepts.
 * The folders are read again, all of them, after a change that touches one.
 */
export class ModelContentsIndex {
  private concepts = new Map<string, Summarised>();
  private lists: Pick<ModelContents, 'model' | 'elements' | 'relationships' | 'unclassified'> = { elements: [], relationships: [], unclassified: [] };
  private changed = new Set<string>();
  private whole = true;
  private typeLabel: (typeIri: string) => string;
  private folders: FolderSummary[] = [];
  private folderIris = new Set<string>();
  private foldersStale = true;

  /** More concepts touched than this: the whole model is read again. */
  static readonly WHOLE_AFTER = 2000;

  constructor(
    private readonly store: RdfStore,
    private readonly closure: () => TypeClosure,
  ) {
    this.typeLabel = typeLabels(store);
  }

  /** A change to the model: the concepts it touches are read again when next asked. */
  note(change: { added: readonly Quad[]; removed: readonly Quad[] }): void {
    if (this.whole) return;
    for (const list of [change.added, change.removed]) {
      for (const q of list) {
        if (q.predicate.value === NAMESPACES.rdfs + 'subClassOf') {
          this.whole = true;
          return;
        }
        if (q.subject.termType === 'NamedNode') this.changed.add(q.subject.value);
        // A qualified predicate leading to a relationship decides whether a potential derivation is confirmed.
        if (q.object.termType === 'NamedNode' && isQualifiedPointer(q.predicate.value)) this.changed.add(q.object.value);
        if (!this.foldersStale && this.touchesFolders(q)) this.foldersStale = true;
      }
    }
    if (this.changed.size > ModelContentsIndex.WHOLE_AFTER) this.whole = true;
  }

  /** Whether a statement may change the folders: what they hold, where they sit, their names. */
  private touchesFolders(q: Quad): boolean {
    if (FOLDER_PREDICATES.has(q.predicate.value)) return true;
    if (q.predicate.value === IRI.rdfType && q.object.value === IRI.Folder) return true;
    return this.folderIris.has(q.subject.value);
  }

  /** The metamodels changed — classes, their labels: everything is read again. */
  invalidate(): void {
    this.whole = true;
    this.typeLabel = typeLabels(this.store);
  }

  /** The model's contents now. The lists are the caller's to keep or change. */
  contents(views: ViewInfo[]): ModelContents {
    this.catchUp();
    if (this.foldersStale) this.keepFolders(readFolders(this.store));
    return {
      ...(this.lists.model ? { model: this.lists.model } : {}),
      views,
      elements: this.lists.elements.slice(),
      relationships: this.lists.relationships.slice(),
      unclassified: this.lists.unclassified.slice(),
      folders: this.folders.slice(),
    };
  }

  private keepFolders(folders: FolderSummary[]): void {
    this.folders = folders;
    this.folderIris = new Set(folders.map((f) => f.iri));
    this.foldersStale = false;
  }

  /** One concept as the tree lists it — its kind, name and type — or `undefined` when it is none (a view, a diagram node). */
  concept(iri: string): Summarised | undefined {
    this.catchUp();
    return this.concepts.get(iri);
  }

  private catchUp(): void {
    if (this.whole) this.readWhole();
    else if (this.changed.size > 0) this.readChanged();
  }

  private readWhole(): void {
    const all = readModelContents(this.store, [], this.closure());
    this.lists = { ...(all.model ? { model: all.model } : {}), elements: all.elements, relationships: all.relationships, unclassified: all.unclassified };
    this.keepFolders(all.folders ?? []);
    this.concepts = new Map();
    if (all.model) this.concepts.set(all.model.iri, { kind: 'model', summary: all.model });
    for (const summary of all.elements) this.concepts.set(summary.iri, { kind: 'element', summary });
    for (const summary of all.unclassified) this.concepts.set(summary.iri, { kind: 'unclassified', summary });
    for (const summary of all.relationships) this.concepts.set(summary.iri, { kind: 'relationship', summary });
    this.changed.clear();
    this.whole = false;
  }

  private readChanged(): void {
    const affected = new Set(this.changed);
    this.changed.clear();
    // A relationship without a name of its own is labelled with its ends' names.
    for (const iri of [...affected]) {
      for (const predicate of ENDS) {
        for (const q of this.store.getQuads(null, nn(predicate), nn(iri), MODEL_GRAPH)) {
          if (q.subject.termType === 'NamedNode') affected.add(q.subject.value);
        }
      }
    }
    const closure = this.closure();
    const nameOf = (iri: string) => labelOf(this.store, iri);
    for (const iri of affected) {
      const facts = collectFacts(this.store.getQuads(nn(iri), null, null, MODEL_GRAPH)).get(iri);
      this.place(iri, facts ? summarize(iri, facts, closure, nameOf, this.typeLabel, this.store) : undefined);
    }
  }

  /** Put a concept's new summary in place of its old one. */
  private place(iri: string, next: Summarised | undefined): void {
    const previous = this.concepts.get(iri);
    if (previous) {
      if (previous.kind === 'model') delete this.lists.model;
      else remove(this.listOf(previous.kind), previous.summary);
    }
    if (!next) {
      this.concepts.delete(iri);
      return;
    }
    this.concepts.set(iri, next);
    if (next.kind === 'model') this.lists.model = next.summary;
    else insert(this.listOf(next.kind), next.summary);
  }

  private listOf(kind: 'element' | 'unclassified' | 'relationship'): ConceptSummary[] {
    return kind === 'element' ? this.lists.elements : kind === 'unclassified' ? this.lists.unclassified : this.lists.relationships;
  }
}

/**
 * Whether a predicate leads to a relationship's resource: a notation's
 * `qualified…` property (named after the class it leads to), or core's fallback.
 */
function isQualifiedPointer(predicateIri: string): boolean {
  return predicateIri === IRI.hasQualifiedRelationship || localName(predicateIri).startsWith('qualified');
}

/** Where a summary goes in a sorted list: the index of the first not before it. */
function position(list: readonly ConceptSummary[], summary: ConceptSummary): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (byLabel(list[mid], summary) < 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

function insert(list: ConceptSummary[], summary: ConceptSummary): void {
  list.splice(position(list, summary), 0, summary);
}

function remove(list: ConceptSummary[], summary: ConceptSummary): void {
  const at = position(list, summary);
  if (list[at] === summary) list.splice(at, 1);
  else {
    const found = list.indexOf(summary);
    if (found >= 0) list.splice(found, 1);
  }
}
