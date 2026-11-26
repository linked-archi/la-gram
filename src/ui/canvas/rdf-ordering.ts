/**
 * What is drawn above what.
 *
 * **Lines above shapes.** Every relationship's line above every shape, as ArchiMate tools draw them — so no element
 * covers a line, or the name drawn on it. diagram-js draws the children of a parent in their order, and on its own
 * puts a created or moved shape last: above the lines drawn before it. A shape moved over a line, a container moved
 * after a relationship was drawn across it, an element nested in another or taken out of it, all covered the line.
 * And a line drawn from a nested element was given that element's container as its parent, so the container's later
 * children covered it. So lines belong to the root, after the shapes — nested shapes are drawn inside their
 * container, so they come before every line too.
 *
 * **Shapes in their drawing order** (core-vis 0.10, `arch-vis:zOrder`; `.agents/tasks/drawing-order/`). Among the
 * shapes of one parent — the view's top level, or one container — the higher zOrder above, the same by node IRI
 * (`compareDrawingOrder`, the kernel's), wherever a shape is added or moved to: a move keeps a shape's place in the
 * order (DO-DD-3). diagram-js's `OrderingProvider` applies this to the commands that create and move; the canvas's
 * store-led drawing, which adds without commands, asks {@link shapeIndex} itself, and puts a parent's shapes back in
 * order when their zOrders change ({@link sortShapes}).
 */

import OrderingProvider from 'diagram-js/lib/features/ordering/OrderingProvider.js';
import { compareDrawingOrder, reorder } from '@linked-archi/kernel/model-manager';
import type { Bounds } from '@linked-archi/kernel/model-manager/interfaces.js';

/** A diagram element, as far as ordering reads it. */
interface Ordered {
  id?: string;
  waypoints?: unknown;
  labelTarget?: unknown;
  children?: Ordered[];
  businessObject?: { iri?: string; nodeIri?: string; zOrder?: number; kind?: string };
}

/**
 * Whether a diagram element is a line. A connection being created has no
 * waypoints yet — they are laid out when the command runs — but diagram-js
 * gives every connection its `source` reference from the start, and no shape
 * one.
 */
function isLine(element: Ordered): boolean {
  return Array.isArray(element.waypoints) || 'source' in element;
}

/** A placement or a figure: what has a drawing order. */
export function isOrderedShape(element: Ordered): boolean {
  const kind = element.businessObject?.kind;
  return !isLine(element) && !element.labelTarget && (kind === 'element' || kind === 'figure');
}

/** Its node, for the order: the node's IRI — a figure's is its own — and its zOrder. */
function orderKey(element: Ordered): { nodeIri: string; zOrder?: number } {
  const object = element.businessObject;
  return { nodeIri: object?.nodeIri ?? object?.iri ?? element.id ?? '', ...(object?.zOrder ? { zOrder: object.zOrder } : {}) };
}

/** Negative when `a` is drawn below `b`. */
export function compareShapes(a: Ordered, b: Ordered): number {
  return compareDrawingOrder(orderKey(a), orderKey(b));
}

/**
 * Where a shape goes among a parent's children: among its shapes in drawing order, before the first line —
 * `undefined`, last, when it goes after everything. The shape itself, when it is there already, is not counted.
 */
export function shapeIndex(parent: Ordered, shape?: Ordered): number | undefined {
  const others = (parent.children ?? []).filter((child) => child !== shape);
  const first = others.findIndex(isLine);
  const end = first < 0 ? others.length : first;
  if (shape && isOrderedShape(shape)) {
    for (let i = 0; i < end; i++) {
      if (isOrderedShape(others[i]) && compareShapes(shape, others[i]) < 0) return i;
    }
  }
  return end === others.length ? undefined : end;
}

/**
 * A parent's shapes put back in drawing order, in the places shapes held among its children — lines and labels
 * where they were. Returns the shapes that moved, to re-stack; none when they were in order.
 */
export function sortShapes(parent: Ordered): Ordered[] {
  const children = parent.children ?? [];
  const slots: number[] = [];
  const shapes: Ordered[] = [];
  children.forEach((child, i) => {
    if (isOrderedShape(child)) {
      slots.push(i);
      shapes.push(child);
    }
  });
  const sorted = [...shapes].sort(compareShapes);
  if (sorted.every((shape, i) => shape === shapes[i])) return [];
  slots.forEach((slot, i) => (children[slot] = sorted[i]));
  return sorted.filter((shape, i) => shape !== shapes[i]);
}

/** A view's node as {@link inFront} reads it. */
export interface PlacedNode {
  nodeIri: string;
  parentNodeIri?: string;
  zOrder?: number;
  bounds: Bounds;
}

const overlaps = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The zOrders that put placements just added — or taken into another container — in front of the placements they
 * overlap in their place (DO-4): to the front of their parent, keeping their order among themselves, where any of them
 * is drawn below one it overlaps; none where none is, so that most placements never get a zOrder (DO-DD-1).
 */
export function inFront(nodes: readonly PlacedNode[], fresh: ReadonlySet<string>): Map<string, number> {
  const groups = new Map<string, PlacedNode[]>();
  for (const node of nodes) {
    const key = node.parentNodeIri ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(node);
  }
  const changes = new Map<string, number>();
  for (const group of groups.values()) {
    const mine = group.filter((n) => fresh.has(n.nodeIri));
    if (mine.length === 0) continue;
    const covered = mine.some((f) => group.some((o) => !fresh.has(o.nodeIri) && overlaps(o.bounds, f.bounds) && compareDrawingOrder(o, f) > 0));
    if (!covered) continue;
    for (const [iri, zOrder] of reorder(group, new Set(mine.map((n) => n.nodeIri)), 'front')) changes.set(iri, zOrder);
  }
  return changes;
}

/** {@link OrderingProvider} keeping lines at the root, above the shapes, and shapes in their drawing order. */
export class RdfOrdering extends OrderingProvider {
  static $inject = ['eventBus', 'canvas'];

  private readonly canvas: { getRootElement(): Ordered };

  constructor(eventBus: unknown, canvas: { getRootElement(): Ordered }) {
    super(eventBus as never);
    this.canvas = canvas;
  }

  override getOrdering(element: never, newParent: never): never {
    const ordered = element as Ordered;
    if (isLine(ordered)) return { parent: this.canvas.getRootElement(), index: undefined } as never;
    const parent = newParent as Ordered | undefined;
    if (!parent) return undefined as never;
    return { parent, index: shapeIndex(parent, ordered) } as never;
  }
}

/** diagram-js module: {@link RdfOrdering}. */
export const rdfOrderingModule = {
  __init__: ['rdfOrdering'],
  rdfOrdering: ['type', RdfOrdering],
};
