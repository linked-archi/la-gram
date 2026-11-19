/**
 * Copy and paste, store-side (copy-paste task, `.agents/tasks/copy-paste/`): what is copied, how it is held
 * on the clipboard, and what a paste writes. No canvas here — the canvas says what is selected and where the
 * pointer is, and runs a paste as one recorded change (`recordChange`), then draws what the store holds.
 *
 * ## The copy
 *
 * RDF, not canvas state: each copied concept's own triples — its types, name, definition and other
 * properties, with its folder — each copied relationship's resource and its triple, and each copied
 * placement's triples and what hangs off it (its route, its moved name's label node, its styles, looks and
 * label expressions), as the source view holds them; with where it came from. A placement's nested
 * placements go with it; a link goes when both its ends do.
 *
 * ## The paste
 *
 * Into another view of the model it came from, the same concepts are placed again; into the same view, or
 * another model, new copies are made — unless the mode is forced. A copy keeps its type, name and
 * definition only; in the same model it goes into the original's folder. The placements are read back
 * through a view manager over the copy and placed by the code *Duplicate view* uses (`placement-copy.ts`).
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore, PrefixMap } from '../rdf-engine/interfaces.js';
import { OxigraphRdfStore } from '../rdf-engine/rdf-store.js';
import { N3TtlSerializer } from '../rdf-engine/ttl-serializer.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { OxigraphViewManager } from './view-manager.js';
import { copyPlacements } from './placement-copy.js';
import { isFolder, membershipQuads } from './folders.js';
import { AUTO_LAYOUT } from './grid.js';
import { quadsOf, snapshotOf } from './version-history.js';
import { IRI, T, dedupe, nn, relationshipClassAmong, triple, tripleTerm } from './vocabulary.js';
import type { ElementManager, Point, RelationshipManager, ViewManager } from './interfaces.js';

/** The default graph: the model. */
const MODEL_GRAPH = DataFactory.defaultGraph() as unknown as NamedNode;

/**
 * The type la-gram's copies are put on the clipboard as, beside `text/plain` Turtle — through the
 * browser's copy and paste events, which need no permission and carry it to another la-gram window.
 */
export const CLIPBOARD_MIME = 'application/x-la-gram-clipboard+json';

/** The envelope's own name and version, so an older or newer la-gram knows what it reads. */
const ENVELOPE = 'la-gram-clipboard/1';

/** Where a copy came from. */
export interface ClipboardSource {
  modelIri: string;
  namespace?: string;
  /** The view it was copied from; none for a copy from the model tree. */
  viewIri?: string;
  metamodelIris: string[];
  /** la-gram's version, as About says it. */
  version?: string;
}

/** What is copied: concepts, placements, and their triples. */
export interface ClipboardFragment {
  source: ClipboardSource;
  /** The elements and relationships copied. */
  concepts: string[];
  /** The source view's nodes copied; none from the model tree. */
  nodes: string[];
  /** The source view's links copied. */
  links: string[];
  quads: Quad[];
}

/** What a paste does with the concepts: places them again, or makes new ones; `auto` by the context. */
export type PasteMode = 'auto' | 'copies' | 'references';

export interface PasteTarget {
  modelIri: string;
  viewIri: string;
}

export interface PasteOptions {
  mode?: PasteMode;
  /** Where the copy's top-left goes, in the view's coordinates — the pointer. */
  at?: Point;
  /** Otherwise, how far from where it was copied. */
  offset?: Point;
  /** Into another model, an element whose type no loaded metamodel defines: pasted as it is (`keep`), or left out. */
  unknownTypes?: 'keep' | 'skip';
  /** From the model tree: the size an element of a type is placed at; the default size otherwise. */
  sizeOf?: (typeIri: string) => { width: number; height: number } | undefined;
}

/** Why a concept was not pasted, or not as asked. */
export type PasteNoteReason =
  /** Into another model: its type is in no loaded metamodel, and the modeller chose to leave such out. */
  | 'unknown-type'
  /** Into another model: the target's rules do not permit it between its ends. */
  | 'not-permitted'
  /** An end of it was left out. */
  | 'end-left-out'
  /** Asked as a reference, it is no longer in the model: pasted as a copy. */
  | 'no-longer-in-model';

export interface PasteResult {
  /** What the paste did with the concepts. */
  mode: 'copies' | 'references';
  /** References asked for into another model: copies were made. */
  referencesImpossible: boolean;
  /** Elements and relationships made, by the original each copies. */
  copied: Map<string, string>;
  elementsCopied: number;
  relationshipsCopied: number;
  elementsPlaced: number;
  relationshipsPlaced: number;
  /** The placements made — the new selection. */
  nodes: string[];
  links: string[];
  /** Properties of the originals a copy does not keep. */
  propertiesLeftOut: number;
  notes: Array<{ iri: string; reason: PasteNoteReason }>;
}

/** What a copy of a concept keeps of it besides its types: its names and definitions. */
const KEPT_BY_A_COPY = new Set([IRI.prefLabel, IRI.definition]);

/** What places or files a concept: written by the paste itself, never copied as a property. */
const PLACING = new Set([IRI.inView, IRI.inModel, IRI.dctermsIsPartOf]);

/** What a relationship's resource holds as a relationship, rather than as a property. */
const RELATIONSHIP_STRUCTURE = new Set([IRI.rdfType, IRI.source, IRI.target, IRI.reifies]);

/** Types every element or relationship may carry besides its own. */
const GENERIC_TYPES = new Set([IRI.Element, IRI.ModelConcept, IRI.QualifiedRelationship]);

// ── Copying ─────────────────────────────────────────────────────────────

/** Whether a resource is a relationship: it has ends. */
function isRelationship(store: RdfStore, iri: string): boolean {
  return store.getQuads(nn(iri), T.source, null, MODEL_GRAPH).length > 0;
}

/**
 * Whether a concept's triple is a relationship statement — the triple of a relationship (its predicate a
 * relationship type's unqualified form, or a relationship reifying it) or the qualified predicate leading to
 * a relationship — rather than a property of the concept.
 */
function isRelationshipStatement(store: RdfStore, q: Quad): boolean {
  if (q.object.termType === 'NamedNode' && store.getQuads(q.object, T.source, q.subject as NamedNode, MODEL_GRAPH).length > 0) return true;
  if (store.getQuads(null, T.unqualifiedForm, q.predicate as NamedNode).length > 0) return true;
  return store.getQuads(null, T.reifies, tripleTerm(q.subject, q.predicate, q.object) as NamedNode, MODEL_GRAPH).length > 0;
}

/** The folder a concept is in, either way a folder holds a member. */
function folderOf(store: RdfStore, iri: string, modelIri: string): string | undefined {
  for (const q of membershipQuads(store, iri, modelIri)) {
    if (q.subject.value === iri && q.predicate.value === IRI.dctermsIsPartOf) return q.object.value;
    if (q.subject.value !== iri && q.subject.termType === 'NamedNode' && isFolder(store, q.subject.value)) return q.subject.value;
  }
  return undefined;
}

/** A concept's triples as a copy holds them: its own, without what places it or relates it, its folder, a relationship's triple. */
function conceptQuads(store: RdfStore, iri: string, modelIri: string): Quad[] {
  const subject = nn(iri);
  const relationship = isRelationship(store, iri);
  const quads = store
    .getQuads(subject, null, null, MODEL_GRAPH)
    .filter((q) => !PLACING.has(q.predicate.value) && (relationship || !isRelationshipStatement(store, q)));
  const folder = folderOf(store, iri, modelIri);
  if (folder) quads.push(triple(subject, T.dctermsIsPartOf, nn(folder)));
  if (relationship) {
    // Its triple, as it reifies it.
    for (const q of store.getQuads(subject, T.reifies, null, MODEL_GRAPH)) {
      if (q.object.termType !== 'Quad') continue;
      const stated = q.object as unknown as Quad;
      quads.push(triple(stated.subject as NamedNode, stated.predicate as NamedNode, stated.object as NamedNode));
    }
  }
  return quads;
}

/**
 * A placement's triples and everything that hangs off it: followed through objects that are blank nodes or
 * named under the placement — `{node}-style`, `{link}-points-0`, `{link}-label` (DD-41, and as la-gram named
 * them before), or `{node}/style`, `{link}/points/0`, `{link}/label` — and through its style, its label
 * expressions, its moved name and its route's cells and points, which may be named otherwise (another
 * tool's, or shared).
 */
function placementQuads(store: RdfStore, placementIri: string): Quad[] {
  const FOLLOWED = new Set([IRI.visStyle, IRI.labelExpression, IRI.visLabel, IRI.points, IRI.rdfFirst, IRI.rdfRest]);
  const quads: Quad[] = [];
  const seen = new Set<string>();
  const queue: Term[] = [nn(placementIri)];
  while (queue.length > 0) {
    const subject = queue.shift()!;
    const key = `${subject.termType}:${subject.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const q of store.getQuads(subject as NamedNode, null, null, MODEL_GRAPH)) {
      quads.push(q);
      const o = q.object;
      const owned =
        o.termType === 'BlankNode' ||
        (o.termType === 'NamedNode' &&
          o.value !== IRI.rdfNil &&
          (o.value.startsWith(`${placementIri}/`) || o.value.startsWith(`${placementIri}-`) || FOLLOWED.has(q.predicate.value)));
      if (owned) queue.push(o);
    }
  }
  return quads;
}

/** Placements nested in these, at any depth, with them. */
function withNested(views: ViewManager, viewIri: string, nodeIris: Iterable<string>): Set<string> {
  const nodes = views.getNodes(viewIri);
  const selected = new Set(nodeIris);
  for (let grown = true; grown; ) {
    grown = false;
    for (const node of nodes) {
      if (!selected.has(node.nodeIri) && node.parentNodeIri && selected.has(node.parentNodeIri)) {
        selected.add(node.nodeIri);
        grown = true;
      }
    }
  }
  return selected;
}

/**
 * Copy what is selected in a view (R1, R3): the nodes, with what is nested in them; every link whose two
 * ends are copied — a node, or a link copied — the concepts they draw, and the triples of all of it.
 */
export function copyFromView(
  store: RdfStore,
  views: ViewManager,
  source: ClipboardSource & { viewIri: string },
  selectedNodes: Iterable<string>,
): ClipboardFragment {
  const viewIri = source.viewIri;
  const nodeSet = withNested(views, viewIri, selectedNodes);
  const nodes = views.getNodes(viewIri).filter((n) => nodeSet.has(n.nodeIri));
  const allLinks = views.getLinks(viewIri);
  const linkSet = new Set<string>();
  for (let grown = true; grown; ) {
    grown = false;
    for (const link of allLinks) {
      if (linkSet.has(link.linkIri)) continue;
      const kept = (end: string) => nodeSet.has(end) || linkSet.has(end);
      if (kept(link.sourceNodeIri) && kept(link.targetNodeIri)) {
        linkSet.add(link.linkIri);
        grown = true;
      }
    }
  }
  const links = allLinks.filter((l) => linkSet.has(l.linkIri));
  const concepts = [
    ...new Set([...nodes.filter((n) => !n.figure).map((n) => n.elementIri), ...links.filter((l) => !l.connector).map((l) => l.relationshipIri)]),
  ];
  const quads: Quad[] = [];
  for (const concept of concepts) quads.push(...conceptQuads(store, concept, source.modelIri));
  for (const placement of [...nodes.map((n) => n.nodeIri), ...links.map((l) => l.linkIri)]) quads.push(...placementQuads(store, placement));
  // The view's own types, so that a view manager over the copy reads its placements back.
  quads.push(...store.getQuads(nn(viewIri), T.rdfType, null, MODEL_GRAPH));
  return { source, concepts, nodes: nodes.map((n) => n.nodeIri), links: links.map((l) => l.linkIri), quads: dedupe(quads) };
}

/**
 * Copy concepts chosen in the model tree (R14), without placements: the elements and relationships chosen,
 * and every relationship between two of the elements.
 */
export function copyConcepts(store: RdfStore, source: ClipboardSource, conceptIris: Iterable<string>): ClipboardFragment {
  const chosen = new Set(conceptIris);
  const elements = [...chosen].filter((iri) => !isRelationship(store, iri));
  const elementSet = new Set(elements);
  const between = store
    .getQuads(null, T.source, null, MODEL_GRAPH)
    .filter((q) => elementSet.has(q.object.value) && store.getQuads(q.subject as NamedNode, T.target, null, MODEL_GRAPH).some((t) => elementSet.has(t.object.value)))
    .map((q) => q.subject.value);
  const concepts = [...new Set([...chosen, ...between])];
  const quads = concepts.flatMap((iri) => conceptQuads(store, iri, source.modelIri));
  return { source: { ...source, viewIri: undefined } as ClipboardSource, concepts, nodes: [], links: [], quads: dedupe(quads) };
}

// ── On the clipboard ────────────────────────────────────────────────────

/** A copy in la-gram's clipboard format: a JSON envelope holding its triples as canonical N-Triples. */
export function writeFragment(fragment: ClipboardFragment): string {
  const { quads, ...rest } = fragment;
  return JSON.stringify({ format: ENVELOPE, ...rest, ntriples: snapshotOf(quads).join('\n') });
}

/** A copy back from la-gram's clipboard format; `undefined` for anything else. */
export function readFragment(text: string): ClipboardFragment | undefined {
  try {
    const data = JSON.parse(text) as Partial<ClipboardFragment> & { format?: string; ntriples?: string };
    if (data.format !== ENVELOPE || !data.source?.modelIri || typeof data.ntriples !== 'string') return undefined;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
    return {
      source: { ...data.source, metamodelIris: strings(data.source.metamodelIris) },
      concepts: strings(data.concepts),
      nodes: strings(data.nodes),
      links: strings(data.links),
      quads: data.ntriples ? quadsOf(data.ntriples.split('\n')) : [],
    };
  } catch {
    return undefined;
  }
}

/**
 * A copy as Turtle, for pasting into a text editor (R4): the model it was copied from written as a saved
 * model is, with the prefixes per kind and per view (DD-41), when `prefixes` names its namespace.
 */
export function fragmentTurtle(fragment: ClipboardFragment, prefixes: PrefixMap): string {
  const namespace = fragment.source.namespace;
  const prefix = namespace ? Object.keys(prefixes).find((label) => prefixes[label] === namespace) : undefined;
  return new N3TtlSerializer().serialize(fragment.quads, prefixes, namespace && prefix ? { namespace, prefix } : undefined);
}

// ── Pasting ─────────────────────────────────────────────────────────────

export interface PasteDeps {
  store: RdfStore;
  elements: ElementManager;
  relationships: RelationshipManager;
  views: ViewManager;
}

/** Whether a type is a class some loaded metamodel defines. */
function isKnownClass(store: RdfStore, typeIri: string): boolean {
  const type = nn(typeIri);
  return (
    store.getQuads(type, T.rdfType, nn(NAMESPACES.owl + 'Class')).length > 0 ||
    store.getQuads(type, T.rdfType, nn(NAMESPACES.rdfs + 'Class')).length > 0 ||
    store.getQuads(type, nn(NAMESPACES.rdfs + 'subClassOf'), null).length > 0
  );
}

/**
 * The types of the elements a paste into another model would bring that no loaded metamodel defines —
 * what to ask the modeller about (R9). None into the model the copy came from.
 */
export function unknownTypesIn(store: RdfStore, fragment: ClipboardFragment, targetModelIri: string): string[] {
  if (fragment.source.modelIri === targetModelIri) return [];
  const types = new Set<string>();
  const relationships = new Set(fragment.quads.filter((q) => q.predicate.value === IRI.source).map((q) => q.subject.value));
  for (const iri of fragment.concepts) {
    if (relationships.has(iri)) continue;
    const type = elementTypeAmong(fragment.quads.filter((q) => q.subject.value === iri && q.predicate.value === IRI.rdfType).map((q) => q.object.value));
    if (type && !isKnownClass(store, type)) types.add(type);
  }
  return [...types];
}

/** An element's own type: the first that is not one every element may carry. */
function elementTypeAmong(types: string[]): string | undefined {
  return types.find((t) => !GENERIC_TYPES.has(t)) ?? types[0];
}

/**
 * Paste a copy into a view (R5–R10, R14): the concepts placed again or copied, as the mode and the context
 * say, then their placements. Every change goes through the managers; the caller runs it as one recorded
 * change and draws the view again.
 */
export function pasteFragment(deps: PasteDeps, fragment: ClipboardFragment, target: PasteTarget, options: PasteOptions = {}): PasteResult {
  const { store, elements, relationships, views } = deps;
  const sameModel = fragment.source.modelIri === target.modelIri;
  const asked = options.mode ?? 'auto';
  const referencesWanted = asked === 'references' || (asked === 'auto' && sameModel && fragment.source.viewIri !== target.viewIri);
  const mode: PasteResult['mode'] = referencesWanted && sameModel ? 'references' : 'copies';
  const result: PasteResult = {
    mode,
    referencesImpossible: asked === 'references' && !sameModel,
    copied: new Map(),
    elementsCopied: 0,
    relationshipsCopied: 0,
    elementsPlaced: 0,
    relationshipsPlaced: 0,
    nodes: [],
    links: [],
    propertiesLeftOut: 0,
    notes: [],
  };

  const scratch = new OxigraphRdfStore();
  try {
    scratch.addQuads(fragment.quads);
    const own = (iri: string) => scratch.getQuads(nn(iri), null, null, MODEL_GRAPH);
    const typesOf = (iri: string) => scratch.getQuads(nn(iri), T.rdfType, null, MODEL_GRAPH).map((q) => q.object.value);
    const endOf = (iri: string, end: NamedNode) => scratch.getQuads(nn(iri), end, null, MODEL_GRAPH)[0]?.object.value;
    const relationshipSet = new Set(fragment.concepts.filter((iri) => endOf(iri, T.source) !== undefined));
    const elementList = fragment.concepts.filter((iri) => !relationshipSet.has(iri));

    // What is left out, across models: elements of types no metamodel defines (when so chosen), relationships
    // the target does not permit, and whatever ends on something left out.
    const leftOut = new Set<string>();
    const leave = (iri: string, reason: PasteNoteReason) => {
      if (leftOut.has(iri)) return;
      leftOut.add(iri);
      result.notes.push({ iri, reason });
    };
    if (!sameModel) {
      for (const iri of elementList) {
        const type = elementTypeAmong(typesOf(iri));
        if (options.unknownTypes === 'skip' && (!type || !isKnownClass(store, type))) leave(iri, 'unknown-type');
      }
    }
    // A concept asked as a reference that is no longer in the model is copied.
    const existing = (iri: string) => store.getQuads(nn(iri), T.inModel, nn(target.modelIri), MODEL_GRAPH).length > 0;
    const copyIt = (iri: string) => mode === 'copies' || !existing(iri);
    for (let changed = true; changed; ) {
      changed = false;
      for (const iri of relationshipSet) {
        if (leftOut.has(iri)) continue;
        const [s, t] = [endOf(iri, T.source)!, endOf(iri, T.target)!];
        const endMissing = (end: string) => leftOut.has(end) || (!fragment.concepts.includes(end) && (!sameModel || !existing(end)));
        if (endMissing(s) || endMissing(t)) {
          leave(iri, 'end-left-out');
          changed = true;
          continue;
        }
        if (!sameModel && !relationshipSet.has(s) && !relationshipSet.has(t)) {
          const typeIri = relationshipClassAmong(typesOf(iri));
          const [sourceType, targetType] = [elementTypeAmong(typesOf(s)), elementTypeAmong(typesOf(t))];
          if (typeIri && sourceType && targetType && isKnownClass(store, sourceType) && isKnownClass(store, targetType)) {
            const permitted = relationships.getValidRelationships(sourceType, targetType).some((r) => r.iri === typeIri);
            if (!permitted) {
              leave(iri, 'not-permitted');
              changed = true;
            }
          }
        }
      }
    }

    // The elements: copied, or the same.
    const conceptIn = (iri: string) => result.copied.get(iri) ?? iri;
    // The copied relationships' triples, held on their source elements: relationships, not properties.
    const statements = new Set<string>();
    for (const iri of relationshipSet) {
      for (const q of scratch.getQuads(nn(iri), T.reifies, null, MODEL_GRAPH)) {
        if (q.object.termType !== 'Quad') continue;
        const t = q.object as unknown as Quad;
        statements.add(`${t.subject.value} ${t.predicate.value} ${t.object.value}`);
      }
    }
    const keep = (from: string, to: NamedNode, structure: Set<string>) => {
      const add: Quad[] = [];
      for (const q of own(from)) {
        const p = q.predicate.value;
        if (structure.has(p) || PLACING.has(p)) continue;
        if (statements.has(`${q.subject.value} ${p} ${q.object.value}`)) continue;
        if (KEPT_BY_A_COPY.has(p)) add.push(triple(to, q.predicate as NamedNode, q.object as NamedNode));
        else result.propertiesLeftOut++;
      }
      return add;
    };
    for (const iri of elementList) {
      if (leftOut.has(iri)) continue;
      if (!copyIt(iri)) continue;
      if (mode === 'references') result.notes.push({ iri, reason: 'no-longer-in-model' });
      const types = typesOf(iri);
      const copy = elements.createElement(elementTypeAmong(types) ?? IRI.Element, target.modelIri);
      result.copied.set(iri, copy.value);
      result.elementsCopied++;
      const add = types.map((t) => triple(copy, T.rdfType, nn(t)));
      add.push(...keep(iri, copy, new Set([IRI.rdfType])));
      const folder = sameModel ? scratch.getQuads(nn(iri), T.dctermsIsPartOf, null, MODEL_GRAPH)[0]?.object : undefined;
      if (folder && isFolder(store, folder.value)) add.push(triple(copy, T.dctermsIsPartOf, folder as NamedNode));
      store.addQuads(dedupe(add));
    }

    // The relationships: copied between their ends' copies (or the ends themselves), a relationship ending
    // on a relationship after that one.
    let pending = [...relationshipSet].filter((iri) => !leftOut.has(iri) && copyIt(iri));
    for (;;) {
      const waiting = pending.filter((iri) => {
        const [s, t] = [endOf(iri, T.source)!, endOf(iri, T.target)!];
        const ready = (end: string) => !relationshipSet.has(end) || leftOut.has(end) || result.copied.has(end) || !copyIt(end);
        if (!ready(s) || !ready(t)) return true;
        if (mode === 'references') result.notes.push({ iri, reason: 'no-longer-in-model' });
        const types = typesOf(iri);
        const typeIri = relationshipClassAmong(types) ?? IRI.QualifiedRelationship;
        const stated = scratch.getQuads(nn(iri), T.reifies, null, MODEL_GRAPH).map((q) => q.object).find((o) => o.termType === 'Quad') as Quad | undefined;
        const made = relationships.createQualifiedRelationship!({
          typeIri,
          ...(stated ? { predicateIri: stated.predicate.value } : {}),
          sourceIri: conceptIn(s),
          targetIri: conceptIn(t),
          modelIri: target.modelIri,
        });
        const copy = nn(made.iri);
        result.copied.set(iri, made.iri);
        result.relationshipsCopied++;
        const add = types.filter((t2) => t2 !== typeIri).map((t2) => triple(copy, T.rdfType, nn(t2)));
        add.push(...keep(iri, copy, RELATIONSHIP_STRUCTURE));
        const folder = sameModel ? scratch.getQuads(nn(iri), T.dctermsIsPartOf, null, MODEL_GRAPH)[0]?.object : undefined;
        if (folder && isFolder(store, folder.value)) add.push(triple(copy, T.dctermsIsPartOf, folder as NamedNode));
        store.addQuads(dedupe(add));
        return false;
      });
      if (waiting.length === 0 || waiting.length === pending.length) break;
      pending = waiting;
    }

    // The placements.
    const leftOutPlacement = (concept: string) => leftOut.has(concept);
    if (fragment.nodes.length > 0 && fragment.source.viewIri) {
      const source = new OxigraphViewManager(scratch);
      const sourceView = fragment.source.viewIri;
      const nodes = source.getNodes(sourceView).filter((n) => fragment.nodes.includes(n.nodeIri) && (n.figure || !leftOutPlacement(n.elementIri)));
      const links = source.getLinks(sourceView).filter((l) => fragment.links.includes(l.linkIri) && (l.connector || !leftOutPlacement(l.relationshipIri)));
      let offset = options.offset ?? { x: 0, y: 0 };
      if (options.at && nodes.length > 0) {
        const x = Math.min(...nodes.map((n) => n.bounds.x));
        const y = Math.min(...nodes.map((n) => n.bounds.y));
        offset = { x: options.at.x - x, y: options.at.y - y };
      }
      const placed = copyPlacements(source, sourceView, views, target.viewIri, {
        nodes: new Set(nodes.map((n) => n.nodeIri)),
        links: new Set(links.map((l) => l.linkIri)),
        concept: conceptIn,
        offset,
      });
      result.nodes = [...placed.nodes.values()];
      result.links = [...placed.links.values()];
      result.elementsPlaced = nodes.filter((n) => !n.figure && placed.nodes.has(n.nodeIri)).length;
      result.relationshipsPlaced = links.filter((l) => !l.connector && placed.links.has(l.linkIri)).length;
    } else {
      // From the model tree: the elements in rows of six from where the copy goes, then the relationships
      // whose two ends were placed.
      const at = options.at ?? { x: AUTO_LAYOUT.x0, y: AUTO_LAYOUT.y0 };
      const placedNodes = new Map<string, string>();
      elementList
        .filter((iri) => !leftOut.has(iri))
        .forEach((iri, i) => {
          const size = options.sizeOf?.(elementTypeAmong(typesOf(iri)) ?? IRI.Element) ?? { width: AUTO_LAYOUT.width, height: AUTO_LAYOUT.height };
          const bounds = {
            x: at.x + (i % AUTO_LAYOUT.columns) * AUTO_LAYOUT.dx,
            y: at.y + Math.floor(i / AUTO_LAYOUT.columns) * AUTO_LAYOUT.dy,
            ...size,
          };
          placedNodes.set(iri, views.addElementToView(target.viewIri, conceptIn(iri), bounds, { another: true }));
        });
      const placedLinks = new Map<string, string>();
      let waiting = [...relationshipSet].filter((iri) => !leftOut.has(iri));
      for (;;) {
        const still = waiting.filter((iri) => {
          const end = (e: string) => placedNodes.get(e) ?? placedLinks.get(e);
          const [sourceNodeIri, targetNodeIri] = [end(endOf(iri, T.source)!), end(endOf(iri, T.target)!)];
          if (!sourceNodeIri || !targetNodeIri) return true;
          const link = views.addRelationshipToView(target.viewIri, conceptIn(iri), undefined, { sourceNodeIri, targetNodeIri }, { another: true });
          if (link) placedLinks.set(iri, link);
          return false;
        });
        if (still.length === 0 || still.length === waiting.length) break;
        waiting = still;
      }
      result.nodes = [...placedNodes.values()];
      result.links = [...placedLinks.values()];
      result.elementsPlaced = placedNodes.size;
      result.relationshipsPlaced = placedLinks.size;
    }
    return result;
  } finally {
    scratch.dispose();
  }
}
