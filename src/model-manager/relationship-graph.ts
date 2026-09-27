/**
 * The relationship graph around an element — what the Graph tab draws.
 *
 * The graph **is** the result of one SPARQL `CONSTRUCT` ({@link buildGraphQuery}),
 * run on the store: that is what makes "export the query behind the graph" and
 * "export the graph as Turtle" honest — the exported query, run on the same
 * model, returns exactly the exported triples, and they are exactly what is
 * drawn.
 *
 * ## What the query asks
 *
 * Every qualified relationship (a resource with `arch:source` and
 * `arch:target`) within `depth` hops of the root, in either direction:
 *
 * 1. The elements within `depth − 1` hops are computed level by level, each
 *    level a `SELECT DISTINCT` subquery over the previous one, so the work grows
 *    with the number of elements reached rather than the number of paths.
 * 2. One more hop from them gives the relationships, and their ends.
 *
 * Filters prune the traversal, not only the drawing: a relationship type left
 * out is not followed, and an element type left out is not stepped onto. The
 * ends of a relationship are elements — an association to a relationship is not
 * followed.
 *
 * The query reads the model as the default graph, which is how la-gram holds it;
 * against a store holding the DD-15 graphs, run it with a union default graph.
 */

import type { Quad } from '@rdfjs/types';
import type { PrefixMap, RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { IRI } from './vocabulary.js';

/** What to draw. */
export interface GraphQueryOptions {
  /** The element in the middle. */
  rootIri: string;
  /** Hops from the root, 1 or more. */
  depth: number;
  /** Element types stepped onto; `undefined` for all. */
  elementTypes?: readonly string[];
  /** Relationship types followed; `undefined` for all. */
  relationshipTypes?: readonly string[];
  /** A name for the root, for the query's header comment. */
  rootLabel?: string;
}

/** An element in the graph. */
export interface GraphNode {
  iri: string;
  typeIri?: string;
  label: string;
  /** Hops from the root (0 for the root). */
  depth: number;
}

/** A relationship in the graph. */
export interface GraphEdge {
  iri: string;
  typeIri?: string;
  /** The relationship's own name, when it has one. */
  label?: string;
  source: string;
  target: string;
}

/** The query, what it returned, and the graph read from it. */
export interface RelationshipGraph {
  query: string;
  quads: Quad[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Deepest the query builder goes: each level is a nested subquery. */
export const MAX_GRAPH_DEPTH = 5;

const PREFIX_NAMES = ['rdf', 'skos', 'arch'] as const;

/** `<iri>` for a SPARQL query, refusing what cannot be written as one. */
function iriRef(iri: string): string {
  if (/[<>"{}|\\^`\s]/.test(iri)) throw new Error(`Not an IRI that can be queried: ${iri}`);
  return `<${iri}>`;
}

/** An `IN (…)` list; the prefixed form where a prefix covers the IRI. */
function inList(iris: readonly string[], prefixes: PrefixMap): string {
  return iris.map((iri) => curieOr(iri, prefixes)).join(', ');
}

function curieOr(iri: string, prefixes: PrefixMap): string {
  for (const [prefix, ns] of Object.entries(prefixes)) {
    const local = iri.slice(ns.length);
    if (iri.startsWith(ns) && /^[A-Za-z_][\w-]*$/.test(local)) return `${prefix}:${local}`;
  }
  return iriRef(iri);
}

/**
 * The SPARQL `CONSTRUCT` for the graph — readable, commented, and exactly what
 * {@link runGraphQuery} runs.
 *
 * @param prefixes Prefixes to declare and to write type IRIs with (the model's
 *   and the vocabularies'); `rdf:`, `skos:` and `arch:` are always declared.
 */
export function buildGraphQuery(options: GraphQueryOptions, prefixes: PrefixMap = {}): string {
  const depth = Math.max(1, Math.min(MAX_GRAPH_DEPTH, Math.floor(options.depth)));
  const declared: PrefixMap = {};
  for (const name of PREFIX_NAMES) declared[name] = NAMESPACES[name];
  const used = [...(options.elementTypes ?? []), ...(options.relationshipTypes ?? [])];
  for (const [prefix, ns] of Object.entries(prefixes)) {
    if (prefix in declared) continue;
    if (used.some((iri) => iri.startsWith(ns))) declared[prefix] = ns;
  }

  const root = iriRef(options.rootIri);
  const relFilter = options.relationshipTypes ? `FILTER(?rt IN (${inList(options.relationshipTypes, declared)}))` : '';
  const elemFilter = options.elementTypes ? `FILTER(?nt IN (${inList(options.elementTypes, declared)}))` : '';

  /** One hop from ?p to ?n over ?r, filtered — the pattern every level repeats. */
  const hop = (indent: string): string =>
    [
      `{ ?r arch:source ?p ; arch:target ?n } UNION { ?r arch:target ?p ; arch:source ?n }`,
      `?r a ?rt .${relFilter ? ` ${relFilter}` : ''}`,
      `?n a ?nt .${elemFilter ? ` ${elemFilter}` : ''}`,
      `FILTER NOT EXISTS { ?n arch:source ?nSource }   # an element, not a relationship`,
    ]
      .map((line) => indent + line)
      .join('\n');

  /** Elements within `k` hops of the root, projected as ?n. */
  const reach = (k: number, indent: string): string => {
    if (k === 0) return `${indent}{ BIND(${root} AS ?n) }`;
    const inner = indent + '  ';
    return [
      `${indent}{`,
      `${inner}SELECT DISTINCT ?n WHERE {`,
      `${inner}  # within ${k - 1} hop${k - 1 === 1 ? '' : 's'}, as ?p`,
      `${inner}  { SELECT (?n AS ?p) WHERE {`,
      reach(k - 1, `${inner}    `),
      `${inner}  } }`,
      `${inner}  # … and ${k === 1 ? 'itself' : 'themselves'}, or one hop further`,
      `${inner}  { ?p a ?pt . BIND(?p AS ?n) }`,
      `${inner}  UNION`,
      `${inner}  {`,
      hop(`${inner}    `),
      `${inner}  }`,
      `${inner}}`,
      `${indent}}`,
    ].join('\n');
  };

  const title = options.rootLabel ? `"${options.rootLabel.replace(/\s+/g, ' ')}"` : root;
  const header = [
    `# Relationships within ${depth} hop${depth === 1 ? '' : 's'} of ${title} — la-gram`,
    `# Root: ${options.rootIri}`,
    `# Relationship types: ${options.relationshipTypes ? options.relationshipTypes.length : 'all'}; element types: ${options.elementTypes ? options.elementTypes.length : 'all'}.`,
    `# Reads the model as the default graph.`,
  ];

  return [
    ...header,
    ...Object.entries(declared).map(([p, ns]) => `PREFIX ${p}: <${ns}>`),
    '',
    'CONSTRUCT {',
    '  ?r a ?rt ; arch:source ?s ; arch:target ?t ; skos:prefLabel ?rLabel .',
    '  ?s a ?st ; skos:prefLabel ?sLabel .',
    '  ?t a ?tt ; skos:prefLabel ?tLabel .',
    '}',
    'WHERE {',
    `  # The elements a relationship may start from: within ${depth - 1} hop${depth - 1 === 1 ? '' : 's'} of the root`,
    '  { SELECT (?n AS ?p) WHERE {',
    reach(depth - 1, '    '),
    '  } }',
    '  # One more hop: the relationships, and their other ends',
    '  {',
    hop('    '),
    '  }',
    '  ?r arch:source ?s ; arch:target ?t .',
    '  ?s a ?st . ?t a ?tt .',
    '  OPTIONAL { ?r skos:prefLabel ?rLabel }',
    '  OPTIONAL { ?s skos:prefLabel ?sLabel }',
    '  OPTIONAL { ?t skos:prefLabel ?tLabel }',
    '}',
    '',
  ].join('\n');
}

/**
 * Run the graph query on the store and read the graph from what it returns.
 * The root is always a node, related to anything or not.
 */
export function runGraphQuery(store: RdfStore, options: GraphQueryOptions, prefixes: PrefixMap = {}): RelationshipGraph {
  const query = buildGraphQuery(options, prefixes);
  const result = store.query(query);
  const quads = result.type === 'quads' ? result.quads : [];
  return { query, quads, ...readGraph(quads, options.rootIri, store) };
}

/** Nodes and edges from the constructed triples; depths by breadth-first search from the root. */
export function readGraph(
  quads: readonly Quad[],
  rootIri: string,
  store?: Pick<RdfStore, 'getQuads'>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const bySubject = new Map<string, Quad[]>();
  for (const q of quads) {
    const list = bySubject.get(q.subject.value);
    if (list) list.push(q);
    else bySubject.set(q.subject.value, [q]);
  }
  const value = (subject: string, predicate: string) =>
    bySubject.get(subject)?.find((q) => q.predicate.value === predicate)?.object.value;

  const edges: GraphEdge[] = [];
  for (const [subject] of bySubject) {
    const source = value(subject, IRI.source);
    const target = value(subject, IRI.target);
    if (!source || !target) continue;
    const typeIri = value(subject, IRI.rdfType);
    const label = value(subject, IRI.prefLabel);
    edges.push({ iri: subject, source, target, ...(typeIri ? { typeIri } : {}), ...(label ? { label } : {}) });
  }
  edges.sort((a, b) => a.iri.localeCompare(b.iri));

  // Depth: hops from the root over the edges, either direction.
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const depth = new Map<string, number>([[rootIri, 0]]);
  const queue = [rootIri];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const next of neighbours.get(at) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, depth.get(at)! + 1);
        queue.push(next);
      }
    }
  }

  const describe = (iri: string): { typeIri?: string; label?: string } => {
    const typeIri = value(iri, IRI.rdfType) ?? storeValue(store, iri, IRI.rdfType);
    const label = value(iri, IRI.prefLabel) ?? storeValue(store, iri, IRI.prefLabel);
    return { ...(typeIri ? { typeIri } : {}), ...(label ? { label } : {}) };
  };
  const nodes: GraphNode[] = [...depth.keys()].map((iri) => {
    const d = describe(iri);
    return { iri, label: d.label ?? localPart(iri), depth: depth.get(iri)!, ...(d.typeIri ? { typeIri: d.typeIri } : {}) };
  });
  nodes.sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label));
  return { nodes, edges };
}

function storeValue(store: Pick<RdfStore, 'getQuads'> | undefined, subject: string, predicate: string): string | undefined {
  if (!store) return undefined;
  const nn = (v: string) => ({ termType: 'NamedNode', value: v }) as never;
  return store.getQuads(nn(subject), nn(predicate)).find((q) => q.graph.termType === 'DefaultGraph')?.object.value;
}

function localPart(iri: string): string {
  return iri.replace(/^.*[/#:]/, '') || iri;
}
