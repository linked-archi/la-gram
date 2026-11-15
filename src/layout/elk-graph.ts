/**
 * A layout input as ELK's JSON graph (ELK task, R1–R7): nodes nested under their parents, in a fixed order;
 * edges at the root, coordinates asked for relative to the root — so the result is the diagram's
 * coordinates, nested nodes included.
 */

import type { ElkExtendedEdge, ElkNode, LayoutOptions as ElkOptions } from 'elkjs/lib/elk-api.js';
import type { LayoutEdge, LayoutInput, LayoutNode, LayoutOptions, LayoutSpacing } from './layout-types.js';

/** Between nodes, and between the layered layout's layers (R7). */
const SPACING: Record<LayoutSpacing, { node: number; layer: number }> = {
  compact: { node: 30, layer: 50 },
  normal: { node: 50, layer: 80 },
  roomy: { node: 80, layer: 120 },
};

/**
 * ELK's effort by the diagram's size (ELK task, R13; the benchmark, `npm run bench -- --layout`). Keeping the
 * given order inside each layer (`considerModelOrder`) costs most, and more with bands: on a diagram of
 * random relationships, 0.3 s at 100 elements, 1.1 s at 200, 4.8 s at 300, 14.5 s at 500 (Node, Apple M4
 * Pro). So it is kept up to {@link MODEL_ORDER_MAX_NODES} elements, where the layout is read most closely;
 * above, banded layers are made by longest path (network simplex costs several times more within bands), and
 * above {@link THOROUGH_MAX_NODES} crossings are minimised with less effort — 500 elements 0.9 s, 2 000
 * elements 4.4 s. The same diagram still gets the same options, so the same geometry (R6).
 */
export const MODEL_ORDER_MAX_NODES = 150;
export const THOROUGH_MAX_NODES = 500;

function effortOptions(nodeCount: number, bands: boolean): ElkOptions {
  if (nodeCount <= MODEL_ORDER_MAX_NODES) return { 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' };
  return {
    ...(bands ? { 'elk.layered.layering.strategy': 'LONGEST_PATH' } : {}),
    ...(nodeCount > THOROUGH_MAX_NODES ? { 'elk.layered.thoroughness': '1' } : {}),
  };
}

/** The order nodes are given in: their key, else their band and IRI. */
function compareNodes(a: LayoutNode, b: LayoutNode): number {
  const key = (n: LayoutNode) => n.key ?? `${String(n.band ?? 999).padStart(4, '0')}|${n.id}`;
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Each node's ancestors, nearest first. */
function ancestorsOf(nodes: ReadonlyMap<string, LayoutNode>, id: string): string[] {
  const out: string[] = [];
  for (let parent = nodes.get(id)?.parent; parent && nodes.has(parent) && !out.includes(parent); parent = nodes.get(parent)?.parent) {
    out.push(parent);
  }
  return out;
}

/** The edges ELK is given: between two laid-out nodes, neither inside the other; by IRI. */
export function laidOutEdges(input: LayoutInput): LayoutEdge[] {
  const nodes = new Map(input.nodes.map((n) => [n.id, n]));
  return input.edges
    .filter((e) => nodes.has(e.source) && nodes.has(e.target) && e.source !== e.target)
    .filter((e) => !ancestorsOf(nodes, e.source).includes(e.target) && !ancestorsOf(nodes, e.target).includes(e.source))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function toElkGraph(input: LayoutInput, options: LayoutOptions): ElkNode {
  const spacing = SPACING[options.spacing];
  const nodes = new Map(input.nodes.map((n) => [n.id, n]));
  const children = new Map<string | undefined, LayoutNode[]>();
  for (const node of [...input.nodes].sort(compareNodes)) {
    // A parent not laid out: laid out at the top.
    const parent = node.parent && nodes.has(node.parent) && node.parent !== node.id ? node.parent : undefined;
    const list = children.get(parent) ?? [];
    list.push(node);
    children.set(parent, list);
  }
  const bands = options.bands && input.nodes.some((n) => n.band !== undefined);
  const elkNode = (node: LayoutNode, seen: Set<string>): ElkNode => {
    seen.add(node.id);
    const layoutOptions: ElkOptions = {};
    const inside = (children.get(node.id) ?? []).filter((c) => !seen.has(c.id));
    if (inside.length > 0) {
      const p = node.padding ?? { top: 12, right: 12, bottom: 12, left: 12 };
      layoutOptions['elk.padding'] = `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`;
    }
    if (bands && node.band !== undefined) layoutOptions['elk.partitioning.partition'] = String(node.band);
    return {
      id: node.id,
      width: node.width,
      height: node.height,
      ...(Object.keys(layoutOptions).length > 0 ? { layoutOptions } : {}),
      ...(inside.length > 0 ? { children: inside.map((c) => elkNode(c, seen)) } : {}),
    };
  };
  const seen = new Set<string>();
  const top = (children.get(undefined) ?? []).map((n) => elkNode(n, seen));
  const edges: ElkExtendedEdge[] = laidOutEdges(input).map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
    ...(e.kind === 'association' ? { layoutOptions: { 'elk.layered.priority.direction': '0' } } : {}),
  }));
  return {
    id: 'la-gram-layout-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': options.direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      ...effortOptions(input.nodes.length, bands),
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': String(spacing.node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.layer),
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT',
      ...(bands ? { 'elk.partitioning.activate': 'true' } : {}),
    },
    children: top,
    edges,
  };
}
