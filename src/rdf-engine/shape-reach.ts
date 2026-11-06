/**
 * How far from its focus node a shapes graph reads (Task 22): which nodes an
 * edit can change the findings of, so that only those are validated again.
 *
 * Validating a focus node against a shape reads the focus node's own triples,
 * those along each `sh:path` — a path of length L reaches value nodes L hops
 * away, whose types `sh:class` reads — and, for a shape nested on the values
 * (`sh:node`, `sh:property`, `sh:qualifiedValueShape`, `sh:not`, the members of
 * `sh:and`, `sh:or`, `sh:xone`), what that shape reads from there. The reach is
 * the most hops from a focus node to the subject of a triple it reads; a triple
 * whose subject changed matters to the nodes that many hops before it.
 */
import type { Quad, Term } from '@rdfjs/types';
import { NAMESPACES } from './namespaces.js';

const SH = NAMESPACES.sh;
const RDF = NAMESPACES.rdf;

/** Shapes nested on the value nodes (or, on a node shape, on the focus node). */
const NESTED = [SH + 'node', SH + 'property', SH + 'qualifiedValueShape', SH + 'not'];
/** Lists of shapes, likewise. */
const NESTED_LISTS = [SH + 'and', SH + 'or', SH + 'xone'];

export interface ShapesReach {
  /**
   * The most hops from a focus node to the subject of a triple its validation
   * reads; `Infinity` when unbounded — a `sh:zeroOrMorePath` or
   * `sh:oneOrMorePath`, or a shape nested in itself.
   */
  hops: number;
  /** Whether a path goes backwards (`sh:inversePath`): a triple then matters on both its sides. */
  inverse: boolean;
  /** Whether a shape is nested in itself — the only case where checking a node against a shape can recurse. */
  recursive: boolean;
  /**
   * Whether a property shape has a `sh:property` of its own: rdf-validate-shacl
   * then reports what that finds with the value node as the focus node, so a
   * node's validation reports findings of another.
   */
  valuesAsFocus: boolean;
}

/** The reach of a shapes graph: the most of any shape in it. */
export function shapesReach(shapes: readonly Quad[]): ShapesReach {
  const bySubject = new Map<string, Quad[]>();
  for (const q of shapes) {
    const key = id(q.subject);
    const list = bySubject.get(key);
    if (list) list.push(q);
    else bySubject.set(key, [q]);
  }
  const objects = (node: Term, predicate: string) => (bySubject.get(id(node)) ?? []).filter((q) => q.predicate.value === predicate).map((q) => q.object);
  const list = (head: Term): Term[] => {
    const items: Term[] = [];
    const seen = new Set<string>();
    let cell: Term | undefined = head;
    while (cell && cell.value !== RDF + 'nil' && !seen.has(id(cell))) {
      seen.add(id(cell));
      items.push(...objects(cell, RDF + 'first'));
      cell = objects(cell, RDF + 'rest')[0];
    }
    return items;
  };

  let inverse = false;
  let recursive = false;
  let valuesAsFocus = false;
  /** How many hops a path goes. */
  const pathLength = (path: Term): number => {
    if (path.termType === 'NamedNode') return 1;
    const inner = (predicate: string) => objects(path, predicate)[0];
    const inv = inner(SH + 'inversePath');
    if (inv) {
      inverse = true;
      return pathLength(inv);
    }
    const alternatives = inner(SH + 'alternativePath');
    if (alternatives) return Math.max(0, ...list(alternatives).map(pathLength));
    if (inner(SH + 'zeroOrMorePath') || inner(SH + 'oneOrMorePath')) return Infinity;
    const optional = inner(SH + 'zeroOrOnePath');
    if (optional) return pathLength(optional);
    // A sequence: an RDF list of paths.
    return list(path).reduce((sum, step) => sum + pathLength(step), 0);
  };

  const memo = new Map<string, number>();
  const reach = (shape: Term, visiting: Set<string>): number => {
    const key = id(shape);
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (visiting.has(key)) {
      recursive = true;
      return Infinity;
    }
    visiting.add(key);
    const path = objects(shape, SH + 'path')[0];
    const length = path ? pathLength(path) : 0;
    if (path && objects(shape, SH + 'property').length > 0) valuesAsFocus = true;
    let nested = 0;
    for (const predicate of NESTED) for (const inner of objects(shape, predicate)) nested = Math.max(nested, reach(inner, visiting));
    for (const predicate of NESTED_LISTS) {
      for (const head of objects(shape, predicate)) for (const inner of list(head)) nested = Math.max(nested, reach(inner, visiting));
    }
    visiting.delete(key);
    const result = length + nested;
    memo.set(key, result);
    return result;
  };

  let hops = 0;
  for (const quads of bySubject.values()) {
    const isShape = quads.some(
      (q) =>
        q.predicate.value === SH + 'path' ||
        q.predicate.value === SH + 'property' ||
        (q.predicate.value === RDF + 'type' && (q.object.value === SH + 'NodeShape' || q.object.value === SH + 'PropertyShape')),
    );
    if (isShape) hops = Math.max(hops, reach(quads[0].subject, new Set()));
  }
  return { hops, inverse, recursive, valuesAsFocus };
}

function id(term: Term): string {
  return term.termType === 'BlankNode' ? `_:${term.value}` : term.value;
}
