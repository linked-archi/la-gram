/**
 * Bands (ELK task, R4): the groups a loaded metamodel's diagrams keep in bands, top band first — the
 * `skos:OrderedCollection` its manifest names with `arch:diagramGroupOrder` (meta's DD-36), in its taxonomy.
 * The groups may come from different classification axes: ArchiMate 3.2's lists the Motivation aspect above
 * the layers. An element type takes the band of the first listed group that classifies it, at any depth. A
 * group not listed — 4.0's Common Domain — gives no band: its elements take the band of what they are
 * related to (`withNeighbourBands`).
 */

import type { NamedNode, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { IRI, nn } from '../model-manager/vocabulary.js';
import type { LayoutInput } from './layout-types.js';

/** A metamodel's diagram group order (core): the list of groups its diagrams keep in bands. */
export const DIAGRAM_GROUP_ORDER = NAMESPACES.arch + 'diagramGroupOrder';

const SKOS = NAMESPACES.skos;

/** An RDF list's items, in order, in the graph it is in. */
function listItems(store: RdfStore, head: Term, graph: Term): Term[] {
  const items: Term[] = [];
  const seen = new Set<string>();
  for (let cell: Term | undefined = head; cell && cell.value !== IRI.rdfNil && !seen.has(cell.value); ) {
    seen.add(cell.value);
    const first = store.getQuads(cell as NamedNode, nn(IRI.rdfFirst), null, graph as NamedNode)[0]?.object;
    if (first) items.push(first);
    cell = store.getQuads(cell as NamedNode, nn(IRI.rdfRest), null, graph as NamedNode)[0]?.object;
  }
  return items;
}

/** What a group classifies, at any depth: the members of its narrower groups too. */
function membersOf(store: RdfStore, group: Term): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const queue: Term[] = [group];
  while (queue.length > 0) {
    const concept = queue.shift()!;
    if (seen.has(concept.value)) continue;
    seen.add(concept.value);
    const narrower = [
      ...store.getQuads(concept as NamedNode, nn(SKOS + 'narrower'), null).map((q) => q.object),
      ...store.getQuads(null, nn(SKOS + 'broader'), concept as NamedNode).map((q) => q.subject),
    ];
    for (const term of narrower) {
      if (term.termType !== 'NamedNode') continue;
      const isConcept = store.getQuads(term, nn(IRI.rdfType), nn(SKOS + 'Concept')).length > 0;
      if (isConcept) queue.push(term);
      else out.add(term.value);
    }
  }
  return [...out];
}

/** Each element type a loaded metamodel's diagram group order classifies, and its band (0 first). */
export function bandsOf(store: RdfStore): Map<string, number> {
  const bands = new Map<string, number>();
  for (const pointer of store.getQuads(null, nn(DIAGRAM_GROUP_ORDER), null)) {
    if (pointer.object.termType !== 'NamedNode') continue;
    // The list is in the taxonomy's graph, not the manifest's that points to it.
    const memberList = store.getQuads(pointer.object, nn(SKOS + 'memberList'), null)[0];
    if (!memberList) continue;
    listItems(store, memberList.object, memberList.graph).forEach((group, band) => {
      for (const type of membersOf(store, group)) if (!bands.has(type)) bands.set(type, band);
    });
  }
  return bands;
}

/**
 * A node with no band takes the band most of what it holds is in, else the band most of what it is related to
 * is in — the upper on a tie; one with neither keeps none. Repeated until nothing changes, so a chain of
 * unbanded nodes takes the band at its end.
 */
export function withNeighbourBands(input: LayoutInput): LayoutInput {
  const band = new Map(input.nodes.filter((n) => n.band !== undefined).map((n) => [n.id, n.band!]));
  if (band.size === 0) return input;
  const neighbours = new Map<string, string[]>();
  const add = (a: string, b: string) => neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
  for (const e of input.edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }
  const children = new Map<string, string[]>();
  for (const n of input.nodes) if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  const mostCommon = (ids: string[]): number | undefined => {
    const counts = new Map<number, number>();
    for (const id of ids) {
      const b = band.get(id);
      if (b !== undefined) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    let best: [number, number] | undefined;
    for (const [b, c] of counts) if (!best || c > best[1] || (c === best[1] && b < best[0])) best = [b, c];
    return best?.[0];
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const node of input.nodes) {
      if (band.has(node.id)) continue;
      const found = mostCommon(children.get(node.id) ?? []) ?? mostCommon(neighbours.get(node.id) ?? []);
      if (found !== undefined) {
        band.set(node.id, found);
        changed = true;
      }
    }
  }
  return { ...input, nodes: input.nodes.map((n) => (band.has(n.id) ? { ...n, band: band.get(n.id)! } : n)) };
}
