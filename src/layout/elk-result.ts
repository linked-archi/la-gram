/**
 * ELK's result as la-gram's geometry (ELK task, R1, R2, R6): each node's top-left bounds and each edge's
 * route — its start, its bends, its end, as la-gram's routes hold them; the docking re-crops the ends
 * against the notation's outline. Rounded to whole units, and moved so the drawing's top-left is at
 * `origin`. ELK was asked for root-relative coordinates, so nested nodes need no adding up.
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { Bounds, Point } from '@linked-archi/kernel/model-manager/interfaces.js';
import type { LayoutResult } from './layout-types.js';

export function fromElkGraph(laidOut: ElkNode, origin: Point): Pick<LayoutResult, 'bounds' | 'routes'> {
  const raw = new Map<string, Bounds>();
  const walk = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      raw.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 });
      walk(child);
    }
  };
  walk(laidOut);
  const edges: ElkExtendedEdge[] = [];
  const collect = (node: ElkNode) => {
    edges.push(...((node.edges ?? []) as ElkExtendedEdge[]));
    for (const child of node.children ?? []) collect(child);
  };
  collect(laidOut);

  const left = raw.size > 0 ? Math.min(...[...raw.values()].map((b) => b.x)) : 0;
  const topmost = raw.size > 0 ? Math.min(...[...raw.values()].map((b) => b.y)) : 0;
  const dx = origin.x - left;
  const dy = origin.y - topmost;
  const at = (p: { x: number; y: number }): Point => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) });

  const bounds = new Map<string, Bounds>();
  for (const [id, b] of raw) bounds.set(id, { ...at(b), width: Math.round(b.width), height: Math.round(b.height) });
  const routes = new Map<string, Point[]>();
  for (const edge of edges) {
    const section = edge.sections?.[0];
    if (!section) continue;
    routes.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(at));
  }
  return { bounds, routes };
}
