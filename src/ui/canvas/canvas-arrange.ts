/**
 * The arrange options on the canvas (Req 22; `.agents/tasks/arrange-options/`): align, distribute, align to a
 * grid, match sizes, default sizes, arrange relationships only, and the selected lines' shape
 * (`.agents/tasks/line-shape/`). The geometry is `layout/arrange-geometry.ts`, the router
 * `layout/orthogonal-router.ts` and the elbows `layout/line-shapes.ts`; this collects the shapes, asks them, and runs the answer as one
 * command, {@link ARRANGE_APPLY_COMMAND}, whose nested `shape.move` / `shape.resize` /
 * `connection.updateWaypoints` the canvas writes to the store as a drag's — so it is one undo step, and an
 * element's lines keep their bends and re-dock their ends as after a drag.
 */

import {
  alignDeltas,
  boundingBox,
  defaultBounds,
  distributeDeltas,
  gridDeltas,
  matchedBounds,
  outermost,
  type Alignment,
  type ArrangeBox,
  type Bounds,
  type Delta,
  type DistributeAxis,
  type GridAxis,
  type SizeDimension,
  type SizeReference,
} from '../../layout/arrange-geometry.js';
import { routeOrthogonal, ROUTER_DEFAULTS, type KeptLine, type RouterEdge, type RouterNode } from '../../layout/orthogonal-router.js';
import { elbowRoute, type LineShape } from '../../layout/line-shapes.js';
import { CONTAINER_PADDING } from './rdf-auto-resize.js';
import type { RdfBusinessObject } from './rdf-renderer.js';

/** Moves, resizes and routes run as one step. */
export const ARRANGE_APPLY_COMMAND = 'la.arrange.apply';

interface Point {
  x: number;
  y: number;
}

/** What the canvas's shapes carry that this reads. */
export interface ArrangeShape {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  businessObject?: RdfBusinessObject;
  waypoints?: Point[];
  parent?: unknown;
  children?: ArrangeShape[];
  source?: ArrangeShape;
  target?: ArrangeShape;
  labelTarget?: unknown;
}

export interface ArrangeApplyContext {
  moves?: Array<{ shape: ArrangeShape; delta: Point }>;
  resizes?: Array<{ shape: ArrangeShape; bounds: Bounds }>;
  routes?: Array<{ connection: ArrangeShape; waypoints: Point[] }>;
}

interface ModelingLike {
  moveShape(shape: unknown, delta: Point): void;
  resizeShape(shape: unknown, bounds: Bounds): void;
  updateWaypoints(connection: unknown, waypoints: Point[]): void;
}

/** {@link ARRANGE_APPLY_COMMAND}: the moves, then the resizes, then the routes, each a nested command. */
export class ArrangeApplyHandler {
  static $inject = ['modeling'];

  constructor(private readonly modeling: ModelingLike) {}

  preExecute(context: ArrangeApplyContext): void {
    for (const { shape, delta } of context.moves ?? []) this.modeling.moveShape(shape, delta);
    for (const { shape, bounds } of context.resizes ?? []) this.modeling.resizeShape(shape, bounds);
    for (const { connection, waypoints } of context.routes ?? []) this.modeling.updateWaypoints(connection, waypoints);
  }

  execute(): unknown[] {
    return [];
  }

  revert(): unknown[] {
    return [];
  }
}

/** What {@link CanvasArrange} needs of the canvas. */
export interface ArrangeHost {
  /** Every shape and line on the canvas, the root aside. */
  all(): ArrangeShape[];
  /** The selected ones. */
  selected(): ArrangeShape[];
  /** Whether another collaborator holds it. */
  locked(shape: ArrangeShape): boolean;
  /** Its default size: its type's for an element, its kind's for a figure. */
  defaultSizeOf(shape: ArrangeShape): { width: number; height: number };
  /** A line with no bends, as a new one is drawn: centre to centre, cropped at the outlines. */
  straightRoute(line: ArrangeShape): Point[] | undefined;
  /** Run the command; false when there is no diagram to run it on. */
  execute(command: string, context: ArrangeApplyContext): boolean;
}

/** What the quick actions may do with the selection as it is (the toolbar's buttons). */
export interface ArrangeAvailability {
  /** Selected placements, less those in a selected container. */
  selected: number;
  align: boolean;
  distribute: boolean;
  match: boolean;
  /** Selected lines a shape may be given: between two placements, not held by a collaborator. */
  lines: number;
}

/** What *Line shape* did with the selected lines (LS-6). */
export interface ShapedLines {
  /** Given the shape. */
  shaped: number;
  /** Shaped so already. */
  unchanged: number;
  /** Left as they are: a line ending on a line or on its own element, between placements that overlap or hold one
   * another (all but *Straight*), or held by a collaborator. */
  kept: number;
}

const isNode = (s: ArrangeShape) => {
  const kind = s.businessObject?.kind;
  return (kind === 'element' || kind === 'figure') && !s.waypoints && !s.labelTarget;
};
const isLine = (s: ArrangeShape) => !!s.waypoints && !!s.source && !!s.target && !s.labelTarget;

export class CanvasArrange {
  constructor(private readonly host: ArrangeHost) {}

  /** The selected placements a move or a resize may take: unlocked, none in a selected container. */
  private selectedBoxes(): ArrangeShape[] {
    const nodes = this.host.selected().filter((s) => isNode(s) && !this.host.locked(s));
    const ids = outermost(nodes.map((s) => this.box(s))).map((b) => b.id);
    return nodes.filter((s) => ids.includes(s.id));
  }

  /** The selected placements, or every placement of the view where nothing is selected or `wholeView` asks. */
  private scope(wholeView = false): ArrangeShape[] {
    const selected = wholeView ? [] : this.host.selected().filter((s) => isNode(s) && !this.host.locked(s));
    return selected.length > 0 ? selected : this.host.all().filter((s) => isNode(s) && !this.host.locked(s));
  }

  private box(s: ArrangeShape): ArrangeBox {
    const parent = s.parent as ArrangeShape | undefined;
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      ...(parent && isNode(parent) ? { parentId: parent.id } : {}),
    };
  }

  availability(): ArrangeAvailability {
    const n = this.selectedBoxes().length;
    const lines = this.host.selected().filter((l) => this.shapeable(l)).length;
    return { selected: n, align: n >= 2, distribute: n >= 3, match: n >= 2, lines };
  }

  /** A line a shape may be given (LS-1): between two placements, two different ones, not held by a collaborator. */
  shapeable(line: ArrangeShape): boolean {
    return isLine(line) && isNode(line.source!) && isNode(line.target!) && line.source !== line.target && !this.host.locked(line);
  }

  /** The moves as one step: how many placements moved. */
  private moveAll(shapes: ArrangeShape[], deltas: Map<string, Delta>): number {
    if (deltas.size === 0) return 0;
    const byId = new Map(shapes.map((s) => [s.id, s]));
    const moves = [...deltas].map(([id, d]) => ({ shape: byId.get(id)!, delta: { x: d.dx, y: d.dy } }));
    return this.host.execute(ARRANGE_APPLY_COMMAND, { moves }) ? moves.length : 0;
  }

  /** The resizes as one step: how many placements were resized. */
  private resizeAll(shapes: ArrangeShape[], bounds: Map<string, Bounds>): number {
    if (bounds.size === 0) return 0;
    const byId = new Map(shapes.map((s) => [s.id, s]));
    const resizes = [...bounds].map(([id, b]) => ({ shape: byId.get(id)!, bounds: b }));
    return this.host.execute(ARRANGE_APPLY_COMMAND, { resizes }) ? resizes.length : 0;
  }

  /** Align the selection: how many moved — none when it is too small or aligned already. */
  align(alignment: Alignment): number {
    const shapes = this.selectedBoxes();
    return this.moveAll(shapes, alignDeltas(shapes.map((s) => this.box(s)), alignment));
  }

  distribute(axis: DistributeAxis): number {
    const shapes = this.selectedBoxes();
    return this.moveAll(shapes, distributeDeltas(shapes.map((s) => this.box(s)), axis));
  }

  /** Each placement selected, or each of the view, its top-left corner to the grid. */
  alignToGrid(axis: GridAxis, grid: number, wholeView = false): number {
    const shapes = this.scope(wholeView);
    return this.moveAll(shapes, gridDeltas(shapes.map((s) => this.box(s)), axis, grid));
  }

  /** What a container holds, with its padding: the least it may be resized to. */
  private contents(shapes: ArrangeShape[]): Map<string, Bounds> {
    const contents = new Map<string, Bounds>();
    for (const s of shapes) {
      const inner = (s.children ?? []).filter(isNode);
      if (inner.length === 0) continue;
      const b = boundingBox(inner);
      contents.set(s.id, {
        x: b.x - CONTAINER_PADDING.left,
        y: b.y - CONTAINER_PADDING.top,
        width: b.width + CONTAINER_PADDING.left + CONTAINER_PADDING.right,
        height: b.height + CONTAINER_PADDING.top + CONTAINER_PADDING.bottom,
      });
    }
    return contents;
  }

  matchSize(reference: SizeReference, dimension: SizeDimension): number {
    const shapes = this.selectedBoxes();
    return this.resizeAll(shapes, matchedBounds(shapes.map((s) => this.box(s)), reference, dimension, this.contents(shapes)));
  }

  /** Each placement selected, or each of the view, to its default size. */
  defaultSize(wholeView = false): number {
    const shapes = this.scope(wholeView);
    const byId = new Map(shapes.map((s) => [s.id, s]));
    return this.resizeAll(
      shapes,
      defaultBounds(shapes.map((s) => this.box(s)), (b) => this.host.defaultSizeOf(byId.get(b.id)!), this.contents(shapes)),
    );
  }

  /**
   * The selected lines and those touching the selected placements, or every line of the view, routed again around
   * the placements; the placements stay. A connector — a line from a figure — is routed as a relationship's line is.
   * Routing some of them, the view's other lines stay where they are, and are avoided (LS-9, LS-DD-4).
   */
  arrangeRelationships(wholeView = false): number {
    const all = this.host.all();
    const selection = wholeView ? [] : this.host.selected();
    const placements = new Set(selection.filter(isNode).map((s) => s.id));
    const chosen = new Set(selection.filter(isLine).map((l) => l.id));
    const everything = placements.size === 0 && chosen.size === 0;
    const lines = all
      .filter(isLine)
      .filter((l) => isNode(l.source!) && isNode(l.target!) && !this.host.locked(l))
      .filter((l) => everything || chosen.has(l.id) || placements.has(l.source!.id) || placements.has(l.target!.id));
    if (lines.length === 0) return 0;
    return this.applyRoutes(lines, this.atRightAngles(all, lines, !everything)).changed;
  }

  /**
   * *Line shape* (Req 22.9): each selected line given the shape, as its route — one step. Which were shaped, which
   * were so already, which were left as they are.
   */
  shapeLines(shape: LineShape): ShapedLines {
    const all = this.host.all();
    const selected = this.host.selected().filter(isLine);
    const lines = selected.filter((l) => this.shapeable(l));
    let routes: Map<string, Point[]>;
    if (shape === 'straight') {
      routes = new Map(lines.flatMap((l) => this.routed(l.id, this.host.straightRoute(l))));
    } else if (shape === 'right-angles') {
      routes = this.atRightAngles(all, lines, true);
    } else {
      const first = shape === 'horizontal-first' ? 'horizontal' : 'vertical';
      routes = new Map(lines.flatMap((l) => this.routed(l.id, elbowRoute(this.box(l.source!), this.box(l.target!), first))));
    }
    const { changed, unchanged } = this.applyRoutes(lines, routes);
    return { shaped: changed, unchanged, kept: selected.length - changed - unchanged };
  }

  private routed(id: string, route: Point[] | undefined): Array<[string, Point[]]> {
    return route && route.length >= 2 ? [[id, route]] : [];
  }

  /** The lines' routes from la-gram's router; with `keepOthers`, the view's other lines kept where they are. */
  private atRightAngles(all: ArrangeShape[], lines: ArrangeShape[], keepOthers: boolean): Map<string, Point[]> {
    const routerNodes: RouterNode[] = all.filter(isNode).map((s) => {
      const b = this.box(s);
      return { id: b.id, x: b.x, y: b.y, width: b.width, height: b.height, ...(b.parentId ? { parentId: b.parentId } : {}) };
    });
    const edges: RouterEdge[] = lines.map((l) => ({ id: l.id, source: l.source!.id, target: l.target!.id }));
    const routing = new Set(edges.map((e) => e.id));
    const kept: KeptLine[] = keepOthers
      ? all
          .filter((l) => isLine(l) && !routing.has(l.id) && (l.waypoints?.length ?? 0) >= 2)
          .map((l) => ({
            id: l.id,
            points: l.waypoints!.map(({ x, y }) => ({ x, y })),
            ...(isNode(l.source!) ? { source: l.source!.id } : {}),
            ...(isNode(l.target!) ? { target: l.target!.id } : {}),
          }))
      : [];
    return routeOrthogonal(routerNodes, edges, ROUTER_DEFAULTS, kept);
  }

  /** The routes that change a line, as one step: how many changed, and how many were routed so already. */
  private applyRoutes(lines: ArrangeShape[], routes: Map<string, Point[]>): { changed: number; unchanged: number } {
    const byId = new Map(lines.map((l) => [l.id, l]));
    const all = [...routes].filter(([id]) => byId.has(id));
    const changed = all
      .filter(([id, points]) => !samePoints(byId.get(id)!.waypoints ?? [], points))
      .map(([id, waypoints]) => ({ connection: byId.get(id)!, waypoints }));
    const unchanged = all.length - changed.length;
    if (changed.length === 0) return { changed: 0, unchanged };
    return this.host.execute(ARRANGE_APPLY_COMMAND, { routes: changed }) ? { changed: changed.length, unchanged } : { changed: 0, unchanged: 0 };
  }
}

function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => Math.round(p.x) === Math.round(b[i].x) && Math.round(p.y) === Math.round(b[i].y));
}
