/**
 * A laid-out diagram's lines routed by la-gram's router in place of the layout's own (Req 21.1, 22.2). ELK places
 * the elements well, but its routes dock anywhere along a side — to a corner, beside a large element — and bend
 * close to the elements; the router's dock at the middle of a side, bend clear of the elements in the middle of the
 * gap, and cross fewer lines. So *Arrange view*, a model opened with no geometry and *Render as new view* draw their
 * lines as *Arrange relationships* does — up to `ROUTE_AFTER_LAYOUT_MAX` placements.
 */

import type { LayoutResult } from './layout-types.js';
import type { ViewManager } from '../model-manager/interfaces.js';
import { routeOrthogonal, type RouterEdge, type RouterNode } from './orthogonal-router.js';

/**
 * The most placements a layout's lines are routed again for. The router runs on the main thread, and a layout spreads
 * a large diagram wide, its lines long: 500 placements add about a second, 2 000 add nine or more — ELK's own routes
 * stay above it, and *Arrange relationships* routes them when asked.
 */
export const ROUTE_AFTER_LAYOUT_MAX = 500;

/**
 * The result with the router's routes for `edges`, among `nodes` — every placement of the diagram where it is
 * after the layout. A line the router does not route (its ends overlap, or one holds the other) keeps the layout's
 * route. The grid's result is left as it is: its lines are drawn straight.
 */
export function withRouterRoutes(result: LayoutResult, nodes: readonly RouterNode[], edges: readonly RouterEdge[]): LayoutResult {
  if (result.engine !== 'elk' || edges.length === 0 || nodes.length > ROUTE_AFTER_LAYOUT_MAX) return result;
  const routes = new Map(result.routes);
  for (const [id, points] of routeOrthogonal(nodes, edges)) routes.set(id, points);
  return { ...result, routes };
}

/**
 * A view's layout with the router's routes: the view's placements at their new bounds — those not laid out where
 * they are, as obstacles — and the lines between two placements that the layout routed or that touch a placement it
 * moved. A line ending on a line keeps docking to it.
 */
export function withViewRouterRoutes(views: ViewManager, viewIri: string, result: LayoutResult): LayoutResult {
  if (result.engine !== 'elk') return result;
  const placed = views.getNodes(viewIri);
  if (placed.length > ROUTE_AFTER_LAYOUT_MAX) return result;
  const nodeIris = new Set(placed.map((n) => n.nodeIri));
  const nodes: RouterNode[] = placed.map((n) => {
    const b = result.bounds.get(n.nodeIri) ?? n.bounds;
    return {
      id: n.nodeIri,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      ...(n.parentNodeIri && nodeIris.has(n.parentNodeIri) ? { parentId: n.parentNodeIri } : {}),
    };
  });
  const edges: RouterEdge[] = views
    .getLinks(viewIri)
    .filter((l) => nodeIris.has(l.sourceNodeIri) && nodeIris.has(l.targetNodeIri))
    .filter((l) => result.routes.has(l.linkIri) || result.bounds.has(l.sourceNodeIri) || result.bounds.has(l.targetNodeIri))
    .map((l) => ({ id: l.linkIri, source: l.sourceNodeIri, target: l.targetNodeIri }));
  return withRouterRoutes(result, nodes, edges);
}
