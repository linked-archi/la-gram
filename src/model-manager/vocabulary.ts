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

/** IRIs, as strings, for comparisons. */
export const IRI = {
  rdfType: NAMESPACES.rdf + 'type',
  rdfFirst: NAMESPACES.rdf + 'first',
  rdfRest: NAMESPACES.rdf + 'rest',
  rdfNil: NAMESPACES.rdf + 'nil',
  subClassOf: NAMESPACES.rdfs + 'subClassOf',
  rdfsLabel: NAMESPACES.rdfs + 'label',
  prefLabel: NAMESPACES.skos + 'prefLabel',
  definition: NAMESPACES.skos + 'definition',
  dctermsTitle: NAMESPACES.dcterms + 'title',
  dctermsDescription: NAMESPACES.dcterms + 'description',
  dctermsCreated: NAMESPACES.dcterms + 'created',
  dctermsModified: NAMESPACES.dcterms + 'modified',

  Model: ARCH + 'Model',
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

  ArchNode: VIS + 'ArchNode',
  Link: VIS + 'Link',
  Point: VIS + 'Point',
  visView: VIS + 'view',
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
