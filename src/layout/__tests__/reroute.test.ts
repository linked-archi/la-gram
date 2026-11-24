/**
 * A laid-out view's lines routed by la-gram's router in place of ELK's (Req 21.1, 22.2): docked at the middle of a
 * side, not where ELK put them; only the lines the layout routed or whose placements it moved; the grid left alone.
 */

import { describe, it, expect } from 'vitest';
import type { LayoutResult } from '../layout-types.js';
import type { LinkInfo, NodeInfo, ViewManager } from '@linked-archi/kernel/model-manager/interfaces.js';
import { withRouterRoutes, withViewRouterRoutes } from '../reroute.js';

const node = (nodeIri: string, x: number, y: number, parentNodeIri?: string): NodeInfo =>
  ({ nodeIri, elementIri: nodeIri, bounds: { x, y, width: 120, height: 55 }, ...(parentNodeIri ? { parentNodeIri } : {}) }) as NodeInfo;
const link = (linkIri: string, sourceNodeIri: string, targetNodeIri: string): LinkInfo =>
  ({ linkIri, relationshipIri: linkIri, sourceNodeIri, targetNodeIri, sourceElementIri: sourceNodeIri, targetElementIri: targetNodeIri, waypoints: [] }) as LinkInfo;
const viewOf = (nodes: NodeInfo[], links: LinkInfo[]) => ({ getNodes: () => nodes, getLinks: () => links }) as unknown as ViewManager;

describe('routing a laid-out view', () => {
  it('replaces ELK\'s route, docked at a corner, by one from the middle of a side', () => {
    const views = viewOf([node('a', 0, 0), node('b', 0, 200)], [link('l', 'a', 'b')]);
    const elk: LayoutResult = {
      engine: 'elk',
      bounds: new Map([['a', { x: 0, y: 0, width: 120, height: 55 }], ['b', { x: 0, y: 200, width: 120, height: 55 }]]),
      routes: new Map([['l', [{ x: 110, y: 55 }, { x: 110, y: 80 }, { x: 10, y: 80 }, { x: 10, y: 200 }]]]),
    };
    expect(withViewRouterRoutes(views, 'v', elk).routes.get('l')).toEqual([{ x: 60, y: 55 }, { x: 60, y: 200 }]);
  });

  it('leaves a line between placements the layout neither moved nor routed', () => {
    const views = viewOf([node('a', 0, 0), node('b', 300, 0), node('c', 0, 200)], [link('moved', 'a', 'c'), link('still', 'b', 'c')]);
    const elk: LayoutResult = {
      engine: 'elk',
      bounds: new Map([['a', { x: 0, y: 0, width: 120, height: 55 }]]),
      routes: new Map(),
    };
    const routes = withViewRouterRoutes(views, 'v', elk).routes;
    expect(routes.has('moved')).toBe(true);
    expect(routes.has('still')).toBe(false);
  });

  it('keeps ELK\'s routes above 500 placements, where routing again would hold the canvas too long', () => {
    const nodes = Array.from({ length: 501 }, (_, i) => node(`n${i}`, (i % 30) * 200, Math.floor(i / 30) * 120));
    const elk: LayoutResult = { engine: 'elk', bounds: new Map(), routes: new Map([['l', [{ x: 110, y: 55 }, { x: 110, y: 120 }]]]) };
    expect(withViewRouterRoutes(viewOf(nodes, [link('l', 'n0', 'n30')]), 'v', elk)).toBe(elk);
  });

  it('keeps the grid\'s result as it is', () => {
    const grid: LayoutResult = { engine: 'grid', bounds: new Map([['a', { x: 0, y: 0, width: 120, height: 55 }]]), routes: new Map() };
    expect(withRouterRoutes(grid, [{ id: 'a', x: 0, y: 0, width: 120, height: 55 }], [{ id: 'l', source: 'a', target: 'a' }])).toBe(grid);
  });
});
