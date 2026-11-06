/**
 * A new view from query results — the SPARQL tab's and the Graph tab's
 * "Render as new view".
 *
 * A result mentions IRIs: as subjects and objects of constructed triples, or as
 * values in a table. Those that are elements of the model become nodes; those
 * that are relationships between elements become links, and bring their ends
 * along — a link needs both. Anything else (views, types, literals, a
 * relationship to a relationship) is left out.
 */

import type { Bounds } from './interfaces.js';

/** What a new view will show. */
export interface ViewPlan {
  /** Elements, in the order the result first mentions them (or their relationships). */
  elements: string[];
  relationships: string[];
}

/** What the model says an IRI is. */
export interface ConceptKinds {
  isElement(iri: string): boolean;
  /** A relationship's ends; `undefined` for anything that is not a relationship. */
  endsOf(iri: string): { source: string; target: string } | undefined;
}

/** The elements and relationships among `iris`. */
export function planView(iris: Iterable<string>, kinds: ConceptKinds): ViewPlan {
  const elements = new Set<string>();
  const relationships = new Set<string>();
  for (const iri of iris) {
    if (elements.has(iri) || relationships.has(iri)) continue;
    const ends = kinds.endsOf(iri);
    if (ends) {
      if (!kinds.isElement(ends.source) || !kinds.isElement(ends.target)) continue;
      relationships.add(iri);
      elements.add(ends.source);
      elements.add(ends.target);
    } else if (kinds.isElement(iri)) {
      elements.add(iri);
    }
  }
  return { elements: [...elements], relationships: [...relationships] };
}

/**
 * Node bounds from layout centres: each node at its own size, the centres
 * spread apart by `spread` (a drawing made for smaller nodes needs room), and
 * the whole moved so its top-left corner is at `origin`.
 */
export function placeNodes(
  elements: readonly string[],
  centres: ReadonlyMap<string, { x: number; y: number }>,
  sizeOf: (iri: string) => { width: number; height: number },
  options: { spread?: number; origin?: { x: number; y: number } } = {},
): Map<string, Bounds> {
  const spread = options.spread ?? 1;
  const origin = options.origin ?? { x: 40, y: 40 };
  const placed = elements.map((iri, i) => {
    const size = sizeOf(iri);
    // A node the layout did not place goes in a row under the rest.
    const centre = centres.get(iri) ?? { x: i * (size.width + 40), y: Number.NaN };
    return { iri, size, x: centre.x * spread - size.width / 2, y: centre.y * spread - size.height / 2 };
  });
  const laidOut = placed.filter((p) => !Number.isNaN(p.y));
  const left = Math.min(...placed.map((p) => p.x));
  const top = laidOut.length > 0 ? Math.min(...laidOut.map((p) => p.y)) : 0;
  const bottom = laidOut.length > 0 ? Math.max(...laidOut.map((p) => p.y + p.size.height)) - top + 60 : 0;
  const bounds = new Map<string, Bounds>();
  for (const p of placed) {
    const y = Number.isNaN(p.y) ? bottom : p.y - top;
    bounds.set(p.iri, {
      x: Math.round(p.x - left + origin.x),
      y: Math.round(y + origin.y),
      width: p.size.width,
      height: p.size.height,
    });
  }
  return bounds;
}
