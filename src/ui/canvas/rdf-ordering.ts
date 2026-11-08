/**
 * What is drawn above what: every relationship's line above every shape, as
 * ArchiMate tools draw them — so no element covers a line, or the name drawn
 * on it.
 *
 * diagram-js draws the children of a parent in their order, and on its own
 * puts a created or moved shape last: above the lines drawn before it. A
 * shape moved over a line, a container moved after a relationship was drawn
 * across it, an element nested in another or taken out of it, all covered the
 * line. And a line drawn from a nested element was given that element's
 * container as its parent, so the container's later children covered it.
 *
 * So lines belong to the root, after the shapes — nested shapes are drawn
 * inside their container, so they come before every line too — and a shape
 * goes after its parent's other shapes, before the first line among them:
 * still above the shapes it is moved over, as before. diagram-js's
 * `OrderingProvider` applies this to the commands that create and move; the
 * canvas's store-led drawing, which adds without commands, asks
 * {@link shapeIndex} itself.
 */

import OrderingProvider from 'diagram-js/lib/features/ordering/OrderingProvider.js';

/** A diagram element, as far as ordering reads it. */
interface Ordered {
  waypoints?: unknown;
  children?: Ordered[];
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

/**
 * Where a shape goes among a parent's children: after its other shapes, before
 * the first line — `undefined`, last, when there is no line among them.
 * The shape itself, when it is there already, is not counted.
 */
export function shapeIndex(parent: Ordered, shape?: Ordered): number | undefined {
  const others = (parent.children ?? []).filter((child) => child !== shape);
  const first = others.findIndex(isLine);
  return first < 0 ? undefined : first;
}

/** {@link OrderingProvider} keeping lines at the root, above the shapes. */
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
