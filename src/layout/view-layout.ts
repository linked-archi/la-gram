/**
 * A diagram view as a layout's input, and a layout's result written back to it (ELK task, R1–R3, R6, R11).
 *
 * Each placement is a node — an element placed twice is two — at its current size, inside the placement it
 * is nested in; figures too. Each line between two laid-out placements is an edge; a line ending on a line,
 * and a nesting relationship, are not. The result is written by placement and by line: bounds by node IRI,
 * a route by link IRI. A line the layout did not route whose end moved is made straight again, so no bend
 * is left where it no longer belongs.
 */

import type { NodeInfo, Point, ViewManager } from '@linked-archi/kernel/model-manager/interfaces.js';
import type { LayoutEdge, LayoutInput, LayoutNode, LayoutResult } from './layout-types.js';

export interface ViewLayoutContext {
  views: ViewManager;
  /** An element's type: its place in the order, and its band. */
  typeOf(elementIri: string): string | undefined;
  /** A name: its place in the order. */
  labelOf(iri: string): string;
  /** Whether a relationship is an association (it does not decide which end comes first). */
  isAssociation(relationshipIri: string): boolean;
  /** The room a placement keeps above what is nested in it: its name band. */
  nameBand: number;
  /** An element type's band, when bands are kept. */
  bandOf?(typeIri: string): number | undefined;
}

/** Margin kept inside a placement around what is nested in it, besides its name band. */
const INSIDE = 12;

/** The placements `only` names and those nested in them, at any depth; every placement without it. */
function included(nodes: NodeInfo[], only?: ReadonlySet<string>): Set<string> {
  if (!only) return new Set(nodes.map((n) => n.nodeIri));
  const set = new Set([...only].filter((iri) => nodes.some((n) => n.nodeIri === iri)));
  for (let grown = true; grown; ) {
    grown = false;
    for (const node of nodes) {
      if (!set.has(node.nodeIri) && node.parentNodeIri && set.has(node.parentNodeIri)) {
        set.add(node.nodeIri);
        grown = true;
      }
    }
  }
  return set;
}

/**
 * A view — or the placements `only` names, with what is nested in them — as a layout's input, and where its
 * drawing's top-left is now, for the result to keep it there.
 */
export function viewLayoutInput(context: ViewLayoutContext, viewIri: string, only?: ReadonlySet<string>): { input: LayoutInput; origin: Point } {
  const all = context.views.getNodes(viewIri);
  const ids = included(all, only);
  const nodes = all.filter((n) => ids.has(n.nodeIri));
  const holding = new Set(nodes.map((n) => n.parentNodeIri).filter((p): p is string => Boolean(p && ids.has(p))));

  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const type = node.figure ? '' : (context.typeOf(node.elementIri) ?? '');
    const band = !node.figure && type ? context.bandOf?.(type) : undefined;
    const label = node.figure ? (node.figure.text ?? '') : context.labelOf(node.elementIri);
    return {
      id: node.nodeIri,
      width: node.bounds.width,
      height: node.bounds.height,
      ...(node.parentNodeIri && ids.has(node.parentNodeIri) ? { parent: node.parentNodeIri } : {}),
      ...(holding.has(node.nodeIri) ? { padding: { top: context.nameBand + INSIDE, right: INSIDE, bottom: INSIDE, left: INSIDE } } : {}),
      ...(band !== undefined ? { band } : {}),
      key: [String(band ?? 999).padStart(4, '0'), type, label.toLowerCase(), node.nodeIri].join('|'),
    };
  });

  const edges: LayoutEdge[] = context.views
    .getLinks(viewIri)
    .filter((link) => ids.has(link.sourceNodeIri) && ids.has(link.targetNodeIri))
    .map((link) => ({
      id: link.linkIri,
      source: link.sourceNodeIri,
      target: link.targetNodeIri,
      kind: !link.connector && context.isAssociation(link.relationshipIri) ? 'association' : 'other',
    }));

  const top = nodes.filter((n) => !n.parentNodeIri || !ids.has(n.parentNodeIri));
  const origin = top.length > 0 ? { x: Math.min(...top.map((n) => n.bounds.x)), y: Math.min(...top.map((n) => n.bounds.y)) } : { x: 40, y: 40 };
  return { input: { nodes: layoutNodes, edges }, origin };
}

/** Write a layout's result to the view: bounds by placement, routes by line; lines it left whose ends moved, straight. */
export function applyViewLayout(views: ViewManager, viewIri: string, result: Pick<LayoutResult, 'bounds' | 'routes'>): { nodes: number; links: number } {
  for (const [nodeIri, bounds] of result.bounds) views.updateNodeBounds(viewIri, nodeIri, bounds);
  const moved = new Set<string>([...result.bounds.keys(), ...result.routes.keys()]);
  const links = views.getLinks(viewIri);
  for (const link of links) {
    const route = result.routes.get(link.linkIri);
    if (route) views.updateLinkWaypoints(viewIri, link.linkIri, route);
  }
  // A line ending on a moved placement — or on a line made straight — that the layout did not route.
  for (let changed = true; changed; ) {
    changed = false;
    for (const link of links) {
      if (moved.has(link.linkIri) || (!moved.has(link.sourceNodeIri) && !moved.has(link.targetNodeIri))) continue;
      views.updateLinkWaypoints(viewIri, link.linkIri, []);
      moved.add(link.linkIri);
      changed = true;
    }
  }
  return { nodes: result.bounds.size, links: result.routes.size };
}
