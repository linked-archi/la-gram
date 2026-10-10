/**
 * `rdfs:subClassOf` helpers shared by the palette and the notation lookup.
 *
 * Two walks over the same map, for two different questions:
 *
 * - {@link closureOf} — *is* `arch:QualifiedRelationship` an ancestor? Order is
 *   irrelevant, so it is a plain depth-first set.
 * - {@link superClassesNearestFirst} — *which* ancestor is nearest? The notation
 *   fallback (Req 2.16) styles a class by the closest superclass that has a
 *   descriptor, so the walk is breadth-first, each distance level sorted by IRI.
 *   Graphs are unordered; the sort is what makes the answer the same on every
 *   load.
 *
 * Like `taxonomy.ts` and `notation.ts`, this works on an n3 `Store` snapshot so
 * it stays synchronous and testable against hand-written Turtle.
 */

import { DataFactory } from 'n3';
import type { Store } from 'n3';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const { namedNode } = DataFactory;

const RDF_TYPE = `${NAMESPACES.rdf}type`;
const RDFS_SUBCLASS_OF = `${NAMESPACES.rdfs}subClassOf`;
const OWL_CLASS = `${NAMESPACES.owl}Class`;

/**
 * Where the notation walk ends: the two core classes every element and
 * relationship type specialises.
 *
 * A root is a valid answer (a generic notation set describes exactly these two),
 * but it is never expanded. `arch:Element ⊑ arch:ModelConcept` is real data, and
 * walking past it would let a descriptor for the shared parent style elements
 * and relationships alike.
 */
export const NOTATION_ROOTS: ReadonlySet<string> = new Set([
  `${NAMESPACES.arch}Element`,
  `${NAMESPACES.arch}QualifiedRelationship`,
]);

/**
 * Plain code-unit order for IRIs.
 *
 * Not `localeCompare`: its result depends on the runtime's locale data, and a
 * tie-break has to come out the same everywhere.
 */
export function compareIris(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Map every class IRI in the graph to its direct `rdfs:subClassOf` parents. */
export function buildSuperClassMap(graph: Store): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const record = (iri: string): void => {
    if (map.has(iri)) return;
    map.set(
      iri,
      uniqueInOrder(
        graph
          .getObjects(namedNode(iri), namedNode(RDFS_SUBCLASS_OF), null)
          .filter((term) => term.termType === 'NamedNode')
          .map((term) => term.value),
      ),
    );
  };

  for (const subject of graph.getSubjects(namedNode(RDF_TYPE), namedNode(OWL_CLASS), null)) {
    if (subject.termType === 'NamedNode') record(subject.value);
  }
  for (const subject of graph.getSubjects(namedNode(RDFS_SUBCLASS_OF), null, null)) {
    if (subject.termType === 'NamedNode') record(subject.value);
  }
  return map;
}

/** Transitive `rdfs:subClassOf` closure of `iri`, excluding `iri` itself. */
export function closureOf(iri: string, superClassMap: ReadonlyMap<string, readonly string[]>): string[] {
  const seen = new Set<string>();
  const stack = [...(superClassMap.get(iri) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const parent of superClassMap.get(current) ?? []) stack.push(parent);
  }
  return [...seen];
}

/**
 * The superclasses of `classIri`, nearest first.
 *
 * Breadth-first: every class at shortest distance *k* comes before any class at
 * distance *k + 1*, and each distance level is sorted by {@link compareIris}, so
 * of two equally near superclasses the lower IRI comes first. A class reachable
 * along several paths is listed once, at its shortest distance, which also makes
 * the walk terminate on a `rdfs:subClassOf` cycle.
 *
 * A class in `stopAt` is included when it is reached and never expanded. When
 * `classIri` is itself in `stopAt` the result is empty.
 *
 * @returns Superclass IRIs, `classIri` excluded.
 */
export function superClassesNearestFirst(
  classIri: string,
  superClassMap: ReadonlyMap<string, readonly string[]>,
  stopAt: ReadonlySet<string> = NOTATION_ROOTS,
): string[] {
  if (stopAt.has(classIri)) return [];

  const visited = new Set<string>([classIri]);
  const ordered: string[] = [];
  let frontier: string[] = [classIri];

  while (frontier.length > 0) {
    const level: string[] = [];
    for (const current of frontier) {
      // A root reached at the previous level is part of the answer, not a way up.
      if (current !== classIri && stopAt.has(current)) continue;
      for (const parent of superClassMap.get(current) ?? []) {
        if (visited.has(parent)) continue;
        visited.add(parent);
        level.push(parent);
      }
    }
    level.sort(compareIris);
    ordered.push(...level);
    frontier = level;
  }

  return ordered;
}

function uniqueInOrder(items: string[]): string[] {
  return [...new Set(items)];
}
