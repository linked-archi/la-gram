/**
 * The relationship graph around an element — what the Graph tab draws.
 *
 * Two ways to get the same triples:
 *
 * - {@link buildGraphQuery} writes the "query behind the graph" the tab exports,
 *   as a `CONSTRUCT` (the triples: RDF, to save or query again) or a `SELECT`
 *   (the same `WHERE`, one row per relationship: a table). It is standard SPARQL
 *   1.1, so it runs on any store holding the model.
 * - {@link traverseGraph} walks the store with indexed lookups, breadth first.
 *   This is what the tab draws from.
 *
 * The walk is what is drawn because it touches only what it reaches: a few
 * milliseconds where the query, even in the shape chosen for Oxigraph, takes
 * tens to hundreds (seconds around a hub of a large model). Tests run both on
 * the same models and require the same triples, so the exported query stays
 * honest: run on the same model, it returns exactly the exported Turtle, which
 * is exactly what is drawn.
 *
 * ## What is in the graph
 *
 * Every qualified relationship (a resource with `arch:source` and
 * `arch:target`) within `depth` hops of the root, in either direction:
 *
 * 1. The elements within `depth − 1` hops are found level by level.
 * 2. One more hop from them gives the relationships, and their ends.
 *
 * Filters prune the traversal, not only the drawing: a relationship type left
 * out is not followed, and an element type left out is not stepped onto. The
 * ends of a relationship are elements — an association to a relationship is not
 * followed.
 *
 * Both read the model as the default graph, which is how la-gram holds it;
 * against a store holding the DD-15 graphs, run the query with a union default
 * graph.
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

/** The query, the triples it returns, and the graph read from them. */
export interface RelationshipGraph {
  /** The `CONSTRUCT`: returns {@link quads}. */
  query: string;
  /** The same `WHERE` as a `SELECT`: one row per relationship. */
  selectQuery: string;
  quads: Quad[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Of a concept's types, the one to draw it by. A converted model types each
 * concept with the core classes too (`a arch:Element, arch:ModelConcept,
 * am:ValueStream`); drawn by the first, a node lost its icon and a line read
 * "Model Concept".
 */
export type TypeChooser = (types: readonly string[]) => string | undefined;

/** Without the class hierarchy: the first type that is not a core class, else the first. */
export const notCoreType: TypeChooser = (types) => types.find((t) => !t.startsWith(NAMESPACES.arch)) ?? types[0];

/** With the class hierarchy: the most specific type — the one with the most superclasses — as the model tree takes it. */
export function mostSpecificType(closure: (typeIri: string) => readonly string[]): TypeChooser {
  return (types) => [...types].sort((a, b) => closure(b).length - closure(a).length || notCoreFirst(a, b))[0];
}

function notCoreFirst(a: string, b: string): number {
  return Number(a.startsWith(NAMESPACES.arch)) - Number(b.startsWith(NAMESPACES.arch));
}

/** Deepest the graph goes: each level of the query is a nested subquery. */
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

/** The form of the graph query: triples, or a table of relationships. */
export type GraphQueryForm = 'construct' | 'select';

/**
 * The SPARQL query for the graph — readable, commented, and returning what
 * {@link traverseGraph} returns: as triples (`CONSTRUCT`), or as a table of
 * relationships, one row each (`SELECT`), from the same `WHERE`.
 *
 * Its shape is chosen for Oxigraph, where the obvious shapes took seconds to
 * minutes from a few hundred elements (measured 2026-09-27; see the design's
 * *Relationship graph*). Oxigraph joins a bound variable into plain triple
 * patterns, property paths and filters one lookup at a time, but evaluates a
 * `UNION` or `BIND` on the right of a join over the whole model, and it reorders
 * a join so that a subquery (a level) is re-run for every relationship in the
 * model. So: the two directions of a hop are one property path; the other end
 * is picked by a filter, not a `BIND`; and every hop is written
 * `OPTIONAL { … } FILTER(BOUND(?r))` — the same rows as a join, in an order the
 * optimizer keeps: the elements first, then their relationships.
 *
 * @param prefixes Prefixes to declare and to write type IRIs with (the model's
 *   and the vocabularies'); `rdf:`, `skos:` and `arch:` are always declared.
 */
export function buildGraphQuery(options: GraphQueryOptions, prefixes: PrefixMap = {}, form: GraphQueryForm = 'construct'): string {
  const depth = Math.max(1, Math.min(MAX_GRAPH_DEPTH, Math.floor(options.depth)));
  const declared: PrefixMap = {};
  for (const name of PREFIX_NAMES) declared[name] = NAMESPACES[name];
  const used = [...(options.elementTypes ?? []), ...(options.relationshipTypes ?? [])];
  for (const [prefix, ns] of Object.entries(prefixes)) {
    if (prefix in declared) continue;
    if (used.some((iri) => iri.startsWith(ns))) declared[prefix] = ns;
  }

  const root = iriRef(options.rootIri);
  const relFilter = options.relationshipTypes ? ` FILTER(?rt IN (${inList(options.relationshipTypes, declared)}))` : '';
  const elemFilter = options.elementTypes ? ` FILTER(?nt IN (${inList(options.elementTypes, declared)}))` : '';
  const indented = (indent: string, lines: string[]) => lines.map((line) => indent + line).join('\n');
  const plural = (n: number) => `${n} hop${n === 1 ? '' : 's'}`;

  /**
   * One hop from ?p over ?r, to ?n: a join the optimizer does not reorder (see
   * above). The group it is in must end with it: a group's FILTER applies after
   * all of its OPTIONALs, and a later OPTIONAL would bind ?r where this one did not.
   */
  const hop = (indent: string, lines: string[]): string =>
    indented(indent, ['OPTIONAL {   # joined, elements first', ...lines.map((line) => '  ' + line), '}', 'FILTER(BOUND(?r))']);

  /** Elements within `k` hops of the root (k ≥ 1), projected as ?n; the root only when it passes the filters. */
  const within = (k: number, indent: string): string => {
    const from = k === 1 ? [`VALUES ?p { ${root} }`] : [`{ SELECT (?n AS ?p) WHERE {`, within(k - 1, '    '), `} }`];
    return [
      indented(indent, [`# within ${plural(k)}: the level before, and its neighbours`, `{ SELECT DISTINCT ?n WHERE {`]),
      indented(indent + '  ', from),
      hop(indent + '  ', [
        `?p ^(arch:source|arch:target) ?r .   # a relationship at ?p …`,
        `?r a ?rt .${relFilter}`,
        `?r arch:source|arch:target ?n .      # … and its ends, ?p among them`,
        `?n a ?nt .${elemFilter}`,
        `FILTER NOT EXISTS { ?n arch:source ?nSource }   # an element, not a relationship`,
      ]),
      indented(indent, [`} }`]),
    ].join('\n');
  };

  const title = options.rootLabel ? `"${options.rootLabel.replace(/\s+/g, ' ')}"` : root;
  const header = [
    `# Relationships within ${plural(depth)} of ${title} — la-gram`,
    `# Root: ${options.rootIri}`,
    `# Relationship types: ${options.relationshipTypes ? options.relationshipTypes.length : 'all'}; element types: ${options.elementTypes ? options.elementTypes.length : 'all'}.`,
    `# Reads the model as the default graph.`,
  ];
  const result =
    form === 'select'
      ? [
          'SELECT DISTINCT (?s AS ?source) (?sLabel AS ?sourceName)',
          '                (?r AS ?relationship) (?rt AS ?relationshipType) (?rLabel AS ?relationshipName)',
          '                (?t AS ?target) (?tLabel AS ?targetName)',
        ]
      : [
          'CONSTRUCT {',
          '  ?r a ?rt ; arch:source ?s ; arch:target ?t ; skos:prefLabel ?rLabel .',
          '  ?s a ?st ; skos:prefLabel ?sLabel .',
          '  ?t a ?tt ; skos:prefLabel ?tLabel .',
          '}',
        ];

  return [
    ...header,
    ...Object.entries(declared).map(([p, ns]) => `PREFIX ${p}: <${ns}>`),
    '',
    ...result,
    'WHERE {',
    '  {',
    depth === 1 ? '    # ?p: the root' : `    # ?p: the root, and the elements within ${plural(depth - 1)} of it`,
    `    { VALUES ?p { ${root} } }`,
    ...(depth === 1 ? [] : ['    UNION', '    { SELECT (?n AS ?p) WHERE {', within(depth - 1, '      '), '    } }']),
    '    # One more hop: the relationships at ?p, and their other ends',
    hop('    ', [
      '?p ^(arch:source|arch:target) ?r .',
      `?r a ?rt .${relFilter}`,
      '?r arch:source ?s ; arch:target ?t .',
      '?s a ?st . ?t a ?tt .',
      '?r arch:source|arch:target ?n .',
      'FILTER(!sameTerm(?n, ?p) || sameTerm(?s, ?t))   # the other end (?p itself on a loop)',
      `?n a ?nt .${elemFilter}`,
      'FILTER NOT EXISTS { ?n arch:source ?nSource }   # an element, not a relationship',
    ]),
    '  }',
    '  OPTIONAL { ?r skos:prefLabel ?rLabel }',
    '  OPTIONAL { ?s skos:prefLabel ?sLabel }',
    '  OPTIONAL { ?t skos:prefLabel ?tLabel }',
    '}',
    ...(form === 'select' ? ['ORDER BY ?sLabel ?rt ?tLabel'] : []),
    '',
  ].join('\n');
}

/** The graph for the Graph tab: walked, with the queries that return the same. */
export function relationshipGraph(
  store: RdfStore,
  options: GraphQueryOptions,
  prefixes: PrefixMap = {},
  typeOf: TypeChooser = notCoreType,
): RelationshipGraph {
  const quads = traverseGraph(store, options);
  return { ...queries(options, prefixes), quads, ...readGraph(quads, options.rootIri, store, typeOf) };
}

function queries(options: GraphQueryOptions, prefixes: PrefixMap): { query: string; selectQuery: string } {
  return { query: buildGraphQuery(options, prefixes), selectQuery: buildGraphQuery(options, prefixes, 'select') };
}

/**
 * Run the graph query on the store and read the graph from what it returns.
 * Slow on large models (see the module comment); {@link relationshipGraph} is
 * what the tab uses. The root is always a node, related to anything or not.
 */
export function runGraphQuery(
  store: RdfStore,
  options: GraphQueryOptions,
  prefixes: PrefixMap = {},
  typeOf: TypeChooser = notCoreType,
): RelationshipGraph {
  const both = queries(options, prefixes);
  const result = store.query(both.query);
  const quads = result.type === 'quads' ? result.quads : [];
  return { ...both, quads, ...readGraph(quads, options.rootIri, store, typeOf) };
}

/**
 * The triples {@link buildGraphQuery}'s `CONSTRUCT` returns, found by walking
 * the store breadth first with indexed lookups, in the model (default) graph.
 * Each step mirrors a part of the query; keep them in step.
 */
export function traverseGraph(store: Pick<RdfStore, 'getQuads'>, options: GraphQueryOptions): Quad[] {
  const depth = Math.max(1, Math.min(MAX_GRAPH_DEPTH, Math.floor(options.depth)));
  const relTypes = options.relationshipTypes && new Set(options.relationshipTypes);
  const elemTypes = options.elementTypes && new Set(options.elementTypes);

  const node = (iri: string) => ({ termType: 'NamedNode', value: iri }) as never;
  const DEFAULT_GRAPH = { termType: 'DefaultGraph', value: '' } as never;
  const lookups = new Map<string, Quad[]>();
  /** Model quads with this subject and predicate, or this predicate and object. */
  const match = (subject: string | null, predicate: string, object: string | null = null): Quad[] => {
    const key = `${subject ?? ''}\n${predicate}\n${object ?? ''}`;
    let found = lookups.get(key);
    if (!found) {
      found = store.getQuads(subject ? node(subject) : null, node(predicate), object ? node(object) : null, DEFAULT_GRAPH);
      lookups.set(key, found);
    }
    return found;
  };
  const typed = (iri: string, allowed?: Set<string>) =>
    match(iri, IRI.rdfType).filter((q) => !allowed || allowed.has(q.object.value));

  /** `?r` from `?p` to `?n`, either direction, with the query's hop checks: the quads for `?r a ?rt`. */
  const hops = (p: string): Array<{ r: string; n: string; rTypes: Quad[] }> => {
    const out: Array<{ r: string; n: string; rTypes: Quad[] }> = [];
    const step = (from: string, to: string) => {
      for (const q of match(null, from, p)) {
        const r = q.subject.value;
        const rTypes = typed(r, relTypes); // ?r a ?rt, FILTER(?rt IN …)
        if (rTypes.length === 0) continue;
        for (const end of match(r, to)) {
          if (end.object.termType !== 'NamedNode') continue;
          const n = end.object.value;
          if (typed(n, elemTypes).length === 0) continue; // ?n a ?nt, FILTER(?nt IN …)
          if (match(n, IRI.source).length > 0) continue; // an element, not a relationship
          out.push({ r, n, rTypes });
        }
      }
    };
    step(IRI.source, IRI.target);
    step(IRI.target, IRI.source);
    return out;
  };

  // The elements within depth − 1 hops.
  const reached = new Set([options.rootIri]);
  let frontier = [options.rootIri];
  for (let level = 1; level < depth; level++) {
    const next: string[] = [];
    for (const p of frontier) {
      for (const { n } of hops(p)) {
        if (!reached.has(n)) {
          reached.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }

  // One more hop, and what the template writes for each relationship and its ends.
  const out = new Map<string, Quad>();
  const emit = (quads: Quad[]) => {
    for (const q of quads) out.set(`${q.subject.value} ${q.predicate.value} ${termKey(q.object)}`, q);
  };
  const described = new Set<string>();
  const describe = (iri: string) => {
    if (described.has(iri)) return;
    described.add(iri);
    emit(typed(iri));
    emit(match(iri, IRI.prefLabel));
  };
  const drawn = new Set<string>();
  for (const p of reached) {
    for (const { r, rTypes } of hops(p)) {
      if (drawn.has(r)) continue;
      drawn.add(r);
      // ?r arch:source ?s ; arch:target ?t . ?s a ?st . ?t a ?tt — every typed
      // pair; no pair (an untyped root), no row.
      const sources = match(r, IRI.source).filter((q) => typed(q.object.value).length > 0);
      const targets = match(r, IRI.target).filter((q) => typed(q.object.value).length > 0);
      if (sources.length === 0 || targets.length === 0) continue;
      emit(rTypes);
      emit(sources);
      emit(targets);
      emit(match(r, IRI.prefLabel));
      for (const q of [...sources, ...targets]) describe(q.object.value);
    }
  }
  return [...out.values()];
}

function termKey(term: Quad['object']): string {
  if (term.termType !== 'Literal') return `${term.termType}:${term.value}`;
  return `"${term.value}"@${term.language}^^${term.datatype.value}`;
}

/** Nodes and edges from the constructed triples; depths by breadth-first search from the root. */
export function readGraph(
  quads: readonly Quad[],
  rootIri: string,
  store?: Pick<RdfStore, 'getQuads'>,
  typeOf: TypeChooser = notCoreType,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const bySubject = new Map<string, Quad[]>();
  for (const q of quads) {
    const list = bySubject.get(q.subject.value);
    if (list) list.push(q);
    else bySubject.set(q.subject.value, [q]);
  }
  const value = (subject: string, predicate: string) =>
    bySubject.get(subject)?.find((q) => q.predicate.value === predicate)?.object.value;
  /** The type to draw a concept by, of those given (else the store's). */
  const typeOfSubject = (subject: string): string | undefined => {
    const given = (bySubject.get(subject) ?? []).filter((q) => q.predicate.value === IRI.rdfType).map((q) => q.object.value);
    return typeOf(given.length > 0 ? given : storeValues(store, subject, IRI.rdfType));
  };

  const edges: GraphEdge[] = [];
  for (const [subject] of bySubject) {
    const source = value(subject, IRI.source);
    const target = value(subject, IRI.target);
    if (!source || !target) continue;
    const typeIri = typeOfSubject(subject);
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
    const typeIri = typeOfSubject(iri);
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
  return storeValues(store, subject, predicate)[0];
}

function storeValues(store: Pick<RdfStore, 'getQuads'> | undefined, subject: string, predicate: string): string[] {
  if (!store) return [];
  const nn = (v: string) => ({ termType: 'NamedNode', value: v }) as never;
  return store
    .getQuads(nn(subject), nn(predicate))
    .filter((q) => q.graph.termType === 'DefaultGraph')
    .map((q) => q.object.value);
}

function localPart(iri: string): string {
  return iri.replace(/^.*[/#:]/, '') || iri;
}
