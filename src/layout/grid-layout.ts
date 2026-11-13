/**
 * The grid (ELK task, R8): where elements go when ELK is not used — too many, failed or too slow. The top
 * level in rows of six; what is inside a node in rows of three inside it, below its padding, the node grown
 * to hold them. Routes are left straight.
 */

import type { Bounds } from '../model-manager/interfaces.js';
import { AUTO_LAYOUT } from '../model-manager/grid.js';
import type { LayoutInput, LayoutNode, LayoutOptions, LayoutResult } from './layout-types.js';

const GAP = AUTO_LAYOUT.dx - AUTO_LAYOUT.width;

export function gridLayout(input: LayoutInput, options: Pick<LayoutOptions, 'origin'>): Pick<LayoutResult, 'bounds' | 'routes'> {
  const ids = new Set(input.nodes.map((n) => n.id));
  const children = new Map<string | undefined, LayoutNode[]>();
  const order = [...input.nodes].sort((a, b) => ((a.key ?? a.id) < (b.key ?? b.id) ? -1 : (a.key ?? a.id) > (b.key ?? b.id) ? 1 : 0));
  for (const node of order) {
    const parent = node.parent && ids.has(node.parent) && node.parent !== node.id ? node.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  // Sizes first, inside out: a node holding others grows to hold them.
  const size = new Map<string, { width: number; height: number }>();
  const measure = (node: LayoutNode, seen: Set<string>): { width: number; height: number } => {
    seen.add(node.id);
    const inside = (children.get(node.id) ?? []).filter((c) => !seen.has(c.id));
    let { width, height } = node;
    if (inside.length > 0) {
      const p = node.padding ?? { top: 12, right: 12, bottom: 12, left: 12 };
      const sizes = inside.map((c) => measure(c, seen));
      const extent = arrange(sizes, 3);
      width = Math.max(width, p.left + extent.width + p.right);
      height = Math.max(height, p.top + extent.height + p.bottom);
    }
    size.set(node.id, { width, height });
    return { width, height };
  };
  const seen = new Set<string>();
  for (const node of children.get(undefined) ?? []) measure(node, seen);

  const bounds = new Map<string, Bounds>();
  const place = (list: LayoutNode[], x0: number, y0: number, columns: number) => {
    const sizes = list.map((n) => size.get(n.id) ?? { width: n.width, height: n.height });
    const cell = { width: Math.max(...sizes.map((s) => s.width)) + GAP, height: Math.max(...sizes.map((s) => s.height)) + GAP };
    list.forEach((node, i) => {
      const b = { x: x0 + (i % columns) * cell.width, y: y0 + Math.floor(i / columns) * cell.height, ...sizes[i]! };
      bounds.set(node.id, b);
      const inside = children.get(node.id) ?? [];
      if (inside.length > 0) {
        const p = node.padding ?? { top: 12, right: 12, bottom: 12, left: 12 };
        place(inside, b.x + p.left, b.y + p.top, 3);
      }
    });
  };
  const top = children.get(undefined) ?? [];
  if (top.length > 0) place(top, options.origin.x, options.origin.y, AUTO_LAYOUT.columns);
  return { bounds, routes: new Map() };
}

/** The extent of boxes in rows of `columns`, each cell as large as the largest box. */
function arrange(sizes: Array<{ width: number; height: number }>, columns: number): { width: number; height: number } {
  const cell = { width: Math.max(...sizes.map((s) => s.width)) + GAP, height: Math.max(...sizes.map((s) => s.height)) + GAP };
  const cols = Math.min(columns, sizes.length);
  const rows = Math.ceil(sizes.length / columns);
  return { width: cols * cell.width - GAP, height: rows * cell.height - GAP };
}
