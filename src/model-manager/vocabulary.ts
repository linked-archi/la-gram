/**
 * The terms the model layer reads and writes, and small helpers for building
 * quads with them.
 *
 * Everything here is taken from the published core ontologies, not invented:
 *
 * - Membership (`core` 0.4.0, DD-30): a member names its container.
 *   `arch:inModel` on elements, relationships and views; `arch:inView` on each
 *   concept a view presents. Both are emitted alongside the geometry, never
 *   inferred from it, because geometry is droppable.
 * - Conformance: `arch:modelConformsToMetamodel`, `arch:viewConformsToViewpoint`.
 * - Relationships: an `arch:QualifiedRelationship` subclass instance with
 *   `arch:source` / `arch:target`, *and* the unqualified triple its class maps to
 *   through `arch:unqualifiedForm` (DD-10) — so SPARQL can traverse either.
 * - Geometry (`core-vis`): an `arch-vis:ArchNode` per placement, naming its
 *   element with `arch-vis:archElement`; an `arch-vis:Link` per drawn
 *   relationship, naming it with `arch-vis:archRelationship` and its end nodes
 *   with `arch-vis:source` / `arch-vis:target`. Both carry `arch-vis:view`.
 *
 * The typing casts (`as unknown as NamedNode`) exist because n3's DataFactory
 * terms and `@rdfjs/types` differ nominally while being the same objects; they
 * are concentrated here so the managers read as plain RDF.
 */

import { DataFactory } from 'n3';
import type { Literal, NamedNode, Quad, Term } from '@rdfjs/types';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const factory = DataFactory;

/** A NamedNode typed for `@rdfjs/types`. */
export function nn(iri: string): NamedNode {
  return factory.namedNode(iri) as unknown as NamedNode;
}

/** A quad in the default graph. */
export function triple(subject: Term, predicate: Term, object: Term): Quad {
  return factory.quad(
    subject as never,
    predicate as never,
    object as never,
  ) as unknown as Quad;
}

/**
 * An RDF 1.2 triple term, `<<( s p o )>>` — what a qualified relationship
 * `rdf:reifies`: the unqualified triple it stands for (the core's pattern).
 */
export function tripleTerm(subject: Term, predicate: Term, object: Term): Term {
  return factory.quad(subject as never, predicate as never, object as never) as unknown as Term;
}

/** A language-tagged literal — the form the Linked.Archi shapes require for labels. */
export function langLiteral(value: string, language = 'en'): Literal {
  return factory.literal(value, language) as unknown as Literal;
}

/** An `xsd:double` literal, as `arch-vis` bounds and points are typed. */
export function doubleLiteral(value: number): Literal {
  return factory.literal(String(value), factory.namedNode(NAMESPACES.xsd + 'double')) as unknown as Literal;
}

/** A plain `xsd:string` literal. */
export function stringLiteral(value: string): Literal {
  return factory.literal(value) as unknown as Literal;
}

/** An `xsd:dateTime` literal. */
export function dateTimeLiteral(date: Date = new Date()): Literal {
  return factory.literal(
    date.toISOString(),
    factory.namedNode(NAMESPACES.xsd + 'dateTime'),
  ) as unknown as Literal;
}

const ARCH = NAMESPACES.arch;
const VIS = NAMESPACES['arch-vis'];
const SKOS = NAMESPACES.skos;
const SKOSXL = 'http://www.w3.org/2008/05/skos-xl#';
const SCHEMA = 'http://schema.org/';

/** IRIs, as strings, for comparisons. */
export const IRI = {
  rdfType: NAMESPACES.rdf + 'type',
  reifies: NAMESPACES.rdf + 'reifies',
  rdfFirst: NAMESPACES.rdf + 'first',
  rdfRest: NAMESPACES.rdf + 'rest',
  rdfNil: NAMESPACES.rdf + 'nil',
  subClassOf: NAMESPACES.rdfs + 'subClassOf',
  inverseOf: NAMESPACES.owl + 'inverseOf',
  rdfsLabel: NAMESPACES.rdfs + 'label',
  prefLabel: NAMESPACES.skos + 'prefLabel',
  definition: NAMESPACES.skos + 'definition',
  dctermsTitle: NAMESPACES.dcterms + 'title',
  dctermsDescription: NAMESPACES.dcterms + 'description',
  dctermsCreated: NAMESPACES.dcterms + 'created',
  dctermsModified: NAMESPACES.dcterms + 'modified',
  dctermsIsPartOf: NAMESPACES.dcterms + 'isPartOf',

  Model: ARCH + 'Model',
  Folder: ARCH + 'Folder',
  View: ARCH + 'View',
  Diagram: ARCH + 'Diagram',
  Catalog: ARCH + 'Catalog',
  Matrix: ARCH + 'Matrix',
  Element: ARCH + 'Element',
  ModelConcept: ARCH + 'ModelConcept',
  QualifiedRelationship: ARCH + 'QualifiedRelationship',
  inModel: ARCH + 'inModel',
  inView: ARCH + 'inView',
  modelConformsToMetamodel: ARCH + 'modelConformsToMetamodel',
  viewConformsToViewpoint: ARCH + 'viewConformsToViewpoint',
  source: ARCH + 'source',
  target: ARCH + 'target',
  unqualifiedForm: ARCH + 'unqualifiedForm',
  hasQualifiedRelationship: ARCH + 'hasQualifiedRelationship',

  ArchNode: VIS + 'ArchNode',
  Link: VIS + 'Link',
  Point: VIS + 'Point',
  LabelNode: VIS + 'LabelNode',
  /** A node standing for no model element: a group, or a figure of a core-vis shape type. */
  ContainerNode: VIS + 'ContainerNode',
  visStyle: VIS + 'style',
  Style: VIS + 'Style',
  /** What a label says (core-vis 0.7): an `arch-vis:LabelExpression`, its text, the notation set it is for. */
  labelExpression: VIS + 'labelExpression',
  LabelExpression: VIS + 'LabelExpression',
  expression: VIS + 'expression',
  /** The presentation context a name or a label expression is for (core 0.5.0). */
  inPresentationContext: ARCH + 'inPresentationContext',
  /** A name as a resource (SKOS-XL), its text, an element's alternative names. */
  skosxlLabel: SKOSXL + 'Label',
  skosxlAltLabel: SKOSXL + 'altLabel',
  skosxlLiteralForm: SKOSXL + 'literalForm',
  altLabel: SKOS + 'altLabel',
  /** An element's pictures (core 0.5.0): for every audience, and its others — one per audience an ImageObject. */
  prefVisNotation: ARCH + 'prefVisNotation',
  altVisNotation: ARCH + 'altVisNotation',
  ImageObject: SCHEMA + 'ImageObject',
  contentUrl: SCHEMA + 'contentUrl',
  shapeType: VIS + 'shapeType',
  fillColor: VIS + 'fillColor',
  lineColor: VIS + 'lineColor',
  fontColor: VIS + 'fontColor',
  fontName: VIS + 'fontName',
  fontSize: VIS + 'fontSize',
  /** `bold`, `italic`, `underline`, separated by spaces (core-vis 0.7). */
  fontStyle: VIS + 'fontStyle',
  /** Width of a node's outline or a link's line (core-vis 0.7). */
  lineWidth: VIS + 'lineWidth',
  /** A node's outline: an `arch-vis:LineStyle`. */
  borderStyle: VIS + 'borderStyle',
  /** Where a node's text sits across it: an `arch-vis:TextAlignment` (core-vis 0.7). */
  textAlignment: VIS + 'textAlignment',
  /** Where a node's text sits down it: an `arch-vis:TextPosition` (core-vis 0.7). */
  textPosition: VIS + 'textPosition',
  visView: VIS + 'view',
  /** A diagram element's `arch-vis:LabelNode`: where its text is drawn. */
  visLabel: VIS + 'label',
  archElement: VIS + 'archElement',
  inNode: VIS + 'inNode',
  archRelationship: VIS + 'archRelationship',
  visSource: VIS + 'source',
  visTarget: VIS + 'target',
  points: VIS + 'points',
  pointX: VIS + 'point-x',
  pointY: VIS + 'point-y',
  boundsX: VIS + 'bounds-x',
  boundsY: VIS + 'bounds-y',
  boundsW: VIS + 'bounds-w',
  boundsH: VIS + 'bounds-h',

  // Vocabulary retired from the core ontology; read (and migrated) on load only.
  legacyRelSource: ARCH + 'relSource',
  legacyRelTarget: ARCH + 'relTarget',
  legacyRelPredicate: ARCH + 'relPredicate',
  legacyPartOfModel: ARCH + 'partOfModel',
  legacyExposedInView: ARCH + 'exposedInView',
  legacyContains: ARCH + 'contains',
  legacyConformsToMetamodel: ARCH + 'conformsToMetamodel',
  legacyViewpoint: ARCH + 'viewpoint',
} as const;

/** The same, as NamedNodes, for writing. */
export const T = Object.fromEntries(
  Object.entries(IRI).map(([key, value]) => [key, nn(value)]),
) as { readonly [K in keyof typeof IRI]: NamedNode };

/** The four `arch-vis` bounds predicates, in x/y/w/h order. */
export const BOUNDS_PREDICATES = [IRI.boundsX, IRI.boundsY, IRI.boundsW, IRI.boundsH] as const;

/** Read a numeric literal, or `undefined`. */
export function numberOf(term: Term | undefined): number | undefined {
  if (!term) return undefined;
  const n = Number(term.value);
  return Number.isFinite(n) ? n : undefined;
}

/** Local name of an IRI (after the last `#`, `/` or — for URNs — `:`). */
export function localName(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash !== -1 && hash < iri.length - 1) return iri.slice(hash + 1);
  const trimmed = iri.replace(/[/#:]+$/, '');
  const match = /[^#/:]+$/.exec(trimmed);
  return match ? match[0] : trimmed;
}

/** Turn a CamelCase / kebab local name into words: `BusinessActor` → `Business Actor`. */
export function humanize(fragment: string): string {
  return fragment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `influence Strength` → `Influence strength`. */
export function sentenceCase(words: string): string {
  const lowered = words.replace(/ ([A-Z])(?=[a-z])/g, (_, c: string) => ` ${c.toLowerCase()}`);
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

/** Drop duplicate quads (a quad reachable along two paths is removed once). */
export function dedupe(quads: Quad[]): Quad[] {
  const seen = new Set<string>();
  const out: Quad[] = [];
  for (const q of quads) {
    const key = `${q.subject.value}\u0000${q.predicate.value}\u0000${q.object.termType}:${q.object.value}\u0000${
      (q.object as { language?: string }).language ?? ''
    }\u0000${(q.object as { datatype?: { value: string } }).datatype?.value ?? ''}\u0000${q.graph.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/** The core's generic types, which a qualified relationship carries beside its class (the converters emit both). */
const GENERIC_RELATIONSHIP_TYPES = new Set<string>([IRI.QualifiedRelationship, IRI.ModelConcept]);

/**
 * A relationship's class among its types: never a generic core type — a
 * converter types a relationship `arch:QualifiedRelationship` and
 * `arch:ModelConcept` besides its class, in any order — and, given the class
 * hierarchy, the most specific of the rest. Only generic types: the qualified
 * relationship class.
 */
export function relationshipClassAmong(types: readonly string[], closure?: (typeIri: string) => readonly string[]): string | undefined {
  const own = types.filter((t) => !GENERIC_RELATIONSHIP_TYPES.has(t));
  if (own.length === 0) return types.includes(IRI.QualifiedRelationship) ? IRI.QualifiedRelationship : types[0];
  if (!closure || own.length === 1) return own[0];
  return [...own].sort((a, b) => closure(b).length - closure(a).length)[0];
}
