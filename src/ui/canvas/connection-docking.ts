/**
 * Connection docking — lines stop at the shape's edge, not at its centre.
 *
 * ## What diagram-js leaves out
 *
 * `diagram-js/lib/features/modeling/index.js` binds two things only:
 *
 * ```js
 * modeling: [ 'type', Modeling ],
 * layouter: [ 'type', BaseLayouter ]
 * ```
 *
 * `connectionDocking` is *not* among them, and `BaseLayouter.layoutConnection`
 * returns `[ getMid(source), getMid(target) ]` — the two shape centres. So out of
 * the box a connection's waypoints run to the middle of each shape and the line
 * is painted underneath them.
 *
 * bpmn-js supplies the missing binding itself, in **its own**
 * `lib/features/modeling/index.js`, right next to its layouter:
 *
 * ```js
 * modeling: [ 'type', Modeling ],
 * layouter: [ 'type', BpmnLayouter ],
 * connectionDocking: [ 'type', CroppingConnectionDocking ]
 * ```
 *
 * (Not in `lib/draw/index.js` — the renderer only contributes `getShapePath`,
 * which is the *input* to cropping.)
 *
 * ## Why the binding alone is not enough
 *
 * In diagram-js 14 the `connectionDocking` service is consulted in exactly three
 * places: `ConnectionPreview` (the line that follows the pointer mid-drag) and
 * `BendpointMove` / `ConnectionSegmentMove` (after a bendpoint drag). Nothing
 * crops the waypoints that `connection.create` and `connection.layout` produce —
 * in bpmn-js those come out docked because `BpmnLayouter` runs a Manhattan
 * layout that computes points on the shapes' *rectangular* borders, not because
 * of `CroppingConnectionDocking`.
 *
 * That Manhattan route is no help here: la-gram draws octagons, hexagons,
 * diamonds, parallelograms, ellipses and circles, whose borders are not
 * rectangles. {@link CroppingLayouter} therefore takes the other route — keep the
 * connection's route (centre to centre when it has none yet), then crop both
 * ends against the real outlines through the same `connectionDocking` service
 * the preview and the bendpoint tools use. One notion of "where does this line
 * meet this shape", shared by every gesture.
 *
 * The cropped endpoints keep an `original` pointing at the uncropped reference —
 * the centre, unless the user dropped the end somewhere else on the element —
 * which is what `CroppingConnectionDocking` puts there and what diagram-js's
 * `AnchorsHelper` reads (`oldAnchor.original || oldAnchor`) when a shape moves or
 * resizes. Docking is therefore recomputed from the reference each time rather
 * than drifting off an already-cropped point. The docking service
 * (`straight-docking.ts`) keeps that reference inside the element: a point
 * outside it would leave the end hanging off the outline.
 *
 * ## An end on a relationship
 *
 * A relationship can end on another relationship. A line has no outline to crop
 * against, so the docking service puts such an end on the nearest point of the
 * line, and {@link AttachedConnectionBehavior} lays the attached relationship out
 * again whenever the line it ends on is re-routed — which diagram-js does for
 * connections attached to shapes only.
 */

import BaseLayouter from 'diagram-js/lib/layout/BaseLayouter.js';
import CroppingConnectionDocking from 'diagram-js/lib/layout/CroppingConnectionDocking.js';
import { getMid } from 'diagram-js/lib/layout/LayoutUtil.js';
import { connectRectangles, withoutRedundantPoints } from 'diagram-js/lib/layout/ManhattanLayout.js';

/** A point on the diagram, optionally remembering where it was cropped from. */
export interface DockingPoint {
  x: number;
  y: number;
  /** The uncropped point this was derived from. */
  original?: { x: number; y: number };
}

/** The bit of a diagram-js connection this module reads. */
interface DjsConnection {
  waypoints?: DockingPoint[];
  source?: unknown;
  target?: unknown;
}

/** Layout hints diagram-js passes through `modeling.layoutConnection`. */
interface LayoutHints {
  connectionStart?: DockingPoint | false;
  connectionEnd?: DockingPoint | false;
  source?: unknown;
  target?: unknown;
  /** The route to lay out instead of the connection's own (a reversing reconnect). */
  waypoints?: DockingPoint[];
}

/** The `connectionDocking` service, as far as the layouter uses it. */
export interface ConnectionDocking {
  getCroppedWaypoints(connection: unknown, source?: unknown, target?: unknown): DockingPoint[];
}

/**
 * `BaseLayouter` typed structurally.
 *
 * diagram-js ships it as a constructor function with a prototype method; the
 * generated `.d.ts` types `layoutConnection`'s hints loosely, so naming the one
 * member this subclass builds on keeps the casts to this one place.
 */
const BaseLayouterBase = BaseLayouter as unknown as {
  new (): { layoutConnection(connection: unknown, hints?: unknown): DockingPoint[] };
};

/** How far outside its element's bounds an end's reference may sit and still be its own. */
const ANCHOR_SLACK = 2;

/**
 * The layouter: a connection's route kept, its ends re-docked to the outlines.
 *
 * Registered as `layouter`, so it runs for every `connection.create` and
 * `connection.layout` — which is what makes moving, resizing or reattaching an
 * element re-dock the lines attached to it: `MoveShapeHandler`, `MoveHelper`,
 * `ResizeShapeHandler` and `ReconnectConnectionHandler` all call
 * `modeling.layoutConnection` on postExecute, passing the moved end as
 * `connectionStart` / `connectionEnd`.
 *
 * Those handlers expect the layouter to *keep* the route — bpmn-js's
 * `BpmnLayouter` repairs it — while diagram-js's `BaseLayouter` returns two
 * points and so drops every bend the user placed. Here a connection that has a
 * route keeps its bends as they are; only its ends move:
 *
 * - an end with a hint goes where the hint says (the moved anchor, the drop
 *   point of a reattach);
 * - an end without one keeps its reference — the uncropped point its last
 *   docking recorded as `original`, or the end itself for a route read back
 *   from the store — unless that lies off its element, as it does once the end
 *   has been reattached elsewhere, when it is the element's centre;
 *
 * and both are then cropped by the `connectionDocking` service the preview and
 * the bendpoint tools use. The one bend dropped is one an element was resized
 * over, which diagram-js then hands over as the end itself; everything between
 * it and the element goes with it. A connection with no route yet — one being drawn,
 * or added by the canvas — is laid out centre to centre, as before.
 */
export class CroppingLayouter extends BaseLayouterBase {
  static $inject = ['connectionDocking'];

  private docking: ConnectionDocking;

  constructor(connectionDocking: ConnectionDocking) {
    super();
    this.docking = connectionDocking;
  }

  layoutConnection(connection: unknown, hints?: unknown): DockingPoint[] {
    const layoutHints = (hints ?? {}) as LayoutHints;
    const link = (connection ?? {}) as DjsConnection;
    const source = layoutHints.source ?? link.source;
    const target = layoutHints.target ?? link.target;
    const route = layoutHints.waypoints ?? link.waypoints ?? [];

    let waypoints: DockingPoint[];
    if (route.length >= 2 && source && target) {
      const start = layoutHints.connectionStart || anchorOf(route[0], source);
      const end = layoutHints.connectionEnd || anchorOf(route[route.length - 1], target);
      let bends = route.slice(1, -1).map(({ x, y }) => ({ x, y }));
      // A resize that grows an element over bends makes the last of them the
      // start, or the first the end (`getResizedSourceAnchor` /
      // `getResizedTargetAnchor`): the bends from there on are inside it now.
      const at = (point: DockingPoint) => bends.findIndex((bend) => bend.x === point.x && bend.y === point.y);
      if (layoutHints.connectionStart && at(start) >= 0) bends = bends.slice(at(start) + 1);
      if (layoutHints.connectionEnd && at(end) >= 0) bends = bends.slice(0, at(end));
      const moved = Boolean(layoutHints.connectionStart || layoutHints.connectionEnd);
      waypoints =
        moved && bends.length === route.length - 2 && rightAngled(route)
          ? squared(route, start, end, bends, source, target, layoutHints)
          : moved && route.length === 2 && arrangedStraight(route, start, end, source, target)
            ? squaredStraight(route, start, end, source, target)
            : [start, ...bends, end];
    } else {
      // A new line between two elements runs centre to centre, wherever the gesture pressed and let go, so
      // the first line drawn already looks as an arranged one does; docking then crops it at the outlines.
      // An end on a relationship keeps its point — where on the line it was dropped is the choice — and so
      // does a line from an element to itself, which centre to centre would not show.
      const centred: LayoutHints = { ...layoutHints };
      const isShape = (end: unknown) => {
        const shape = end as { x?: number; y?: number; width?: number; height?: number; waypoints?: unknown };
        return !shape.waypoints && [shape.x, shape.y, shape.width, shape.height].every(Number.isFinite);
      };
      if (source && target && source !== target) {
        // During a connect drag, empty canvas is the diagram root: it has no
        // bounds. Keep the pointer hint there instead of taking an invalid centre.
        if (isShape(source)) delete centred.connectionStart;
        if (isShape(target)) delete centred.connectionEnd;
      }
      waypoints = super.layoutConnection(connection, centred);
      // Nothing to crop against while an end is still unattached — which is the
      // state `Connect` is in until it hovers a valid target.
      if (!source || !target || waypoints.length < 2) return waypoints;
    }

    // Crop against the *new* waypoints, not the ones still on the connection.
    // `getCroppedWaypoints` only reads `waypoints` off what it is given (it asks
    // the graphics factory, and so the renderer, for the paths), so a shallow
    // stand-in is enough and the connection stays untouched until the command
    // handler assigns to it.
    return this.docking.getCroppedWaypoints({ ...link, waypoints }, source, target);
  }
}

/**
 * Where an end of a kept route re-docks from: its recorded reference, while
 * that is still on (or by) its element — any point, for an end on a
 * relationship, where docking finds the nearest point of the line — else the
 * element's centre.
 */
function anchorOf(end: DockingPoint, element: unknown): DockingPoint {
  const reference = { x: (end.original ?? end).x, y: (end.original ?? end).y };
  const bounds = element as { x?: number; y?: number; width?: number; height?: number; waypoints?: unknown };
  if (bounds.waypoints) return reference;
  const { x = 0, y = 0, width = 0, height = 0 } = bounds;
  const near =
    reference.x >= x - ANCHOR_SLACK &&
    reference.x <= x + width + ANCHOR_SLACK &&
    reference.y >= y - ANCHOR_SLACK &&
    reference.y <= y + height + ANCHOR_SLACK;
  return near ? reference : getMid(element as never);
}

/** How far off an axis a segment may be and still run along it: the docking's rounding. */
const AXIS_SLACK = 1;
/** Two points closer than this have collapsed into one. */
const COLLAPSED = 3;

type Axis = 'h' | 'v' | undefined;

/** Whether a segment runs horizontally ('h') or vertically ('v'), or neither. */
function axisOf(a: DockingPoint, b: DockingPoint): Axis {
  if (Math.abs(a.y - b.y) <= AXIS_SLACK) return 'h';
  if (Math.abs(a.x - b.x) <= AXIS_SLACK) return 'v';
  return undefined;
}

/** A route with bends whose every segment runs along an axis — as Arrange view draws them. */
function rightAngled(route: readonly DockingPoint[]): boolean {
  return route.length >= 3 && route.every((point, i) => i === 0 || axisOf(route[i - 1], point) !== undefined);
}

/** The bounds diagram-js gives a shape. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const inside = (point: DockingPoint, box: Box) =>
  point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height;

const atCentre = (point: DockingPoint, box: Box) =>
  Math.abs(point.x - (box.x + box.width / 2)) <= AXIS_SLACK && Math.abs(point.y - (box.y + box.height / 2)) <= AXIS_SLACK;

/**
 * A straight line as Arrange view draws one: along an axis, its ends on the outlines rather than aimed at the
 * centres, as a drawn line's are. Its two references — the moved end where the move put it — say which.
 */
function arrangedStraight(route: readonly DockingPoint[], start: DockingPoint, end: DockingPoint, source: unknown, target: unknown): boolean {
  return axisOf(route[0]!, route[1]!) !== undefined && !atCentre(start, source as Box) && !atCentre(end, target as Box);
}

/**
 * An arranged straight line with an end moved: still straight where its ends are still on one axis, else
 * right-angled — out of the source and into the target where it did, along the axis it ran on, with a
 * crossing between (diagonal lines are no part of an arranged view).
 */
function squaredStraight(route: readonly DockingPoint[], start: DockingPoint, end: DockingPoint, source: unknown, target: unknown): DockingPoint[] {
  const along = axisOf(route[0]!, route[1]!);
  if (axisOf(start, end) === along) return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
  return withoutRedundantPoints(
    connectRectangles(source as Box, target as Box, start, end, { preferredLayouts: [along === 'v' ? 'v:v' : 'h:h'] }),
  );
}

/**
 * A right-angled route with an end moved, kept right-angled: the bend next to the moved end follows it along
 * the axis their segment ran on, so that segment stays horizontal or vertical and the bends beyond stay put —
 * where the route leaves its other element too. Where that would put a bend inside one of the elements, or
 * fold two points into one, the line is routed again at right angles between the two centres, leaving the
 * way the old route left the source (diagram-js's Manhattan layout, which bpmn-js repairs its lines with).
 */
function squared(
  route: readonly DockingPoint[],
  start: DockingPoint,
  end: DockingPoint,
  bends: readonly DockingPoint[],
  source: unknown,
  target: unknown,
  hints: LayoutHints,
): DockingPoint[] {
  const points: DockingPoint[] = [{ x: start.x, y: start.y }, ...bends.map(({ x, y }) => ({ x, y })), { x: end.x, y: end.y }];
  const follow = (bend: number, moved: DockingPoint, along: Axis) => {
    const point = points[bend]!;
    points[bend] = along === 'h' ? { x: point.x, y: moved.y } : { x: moved.x, y: point.y };
  };
  if (hints.connectionStart) follow(1, start, axisOf(route[0]!, route[1]!));
  if (hints.connectionEnd) follow(points.length - 2, end, axisOf(route[route.length - 1]!, route[route.length - 2]!));

  const from = source as Box;
  const to = target as Box;
  const sound =
    points.slice(1, -1).every((bend) => !inside(bend, from) && !inside(bend, to)) &&
    points.every((point, i) => i === 0 || Math.hypot(point.x - points[i - 1]!.x, point.y - points[i - 1]!.y) >= COLLAPSED);
  if (sound) return withoutRedundantPoints(points);

  const leaves = axisOf(route[0]!, route[1]!) === 'v' ? 'v:v' : 'h:h';
  const centre = (box: Box) => ({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
  return withoutRedundantPoints(connectRectangles(from, to, centre(from), centre(to), { preferredLayouts: [leaves] }));
}

// ── Relationships attached to relationships ──────────────────────────────

/** The bits of a diagram-js connection the behaviour below reads. */
interface DjsLine {
  waypoints?: DockingPoint[];
  source?: unknown;
  target?: unknown;
  incoming?: DjsLine[];
  outgoing?: DjsLine[];
}

/** The bits of diagram-js's event bus and modeling the behaviour below uses. */
interface AttachedEventBus {
  on(events: string[], callback: (event: { context?: { connection?: DjsLine } }) => void): void;
}
interface AttachedModeling {
  layoutConnection(connection: unknown, hints?: unknown): void;
}

/** One end of a connection that lies on another connection, and how far along it. */
interface AttachedEnd {
  connection: DjsLine;
  end: 'start' | 'end';
  along: number;
}

/** The commands that change a connection's route. */
const ROUTE_COMMANDS = ['connection.layout', 'connection.updateWaypoints', 'connection.move', 'connection.reconnect'];

/**
 * Keeps a relationship that ends on another relationship docked to it.
 *
 * diagram-js re-lays out the connections attached to a *shape* when the shape
 * moves or resizes, but nothing in it reacts to a connection's own route
 * changing, so a line attached to another line was left where that line used
 * to be. This records, before any command that re-routes a connection, how far
 * along it each attached end lies (as a fraction of its length), and once the
 * command is done lays each attached connection out again with that end at the
 * same fraction of the new route — nested, so one undo takes back both.
 *
 * Laying out an attached connection is itself a `connection.layout`, so lines
 * attached to *it* follow in turn; a line already being followed is skipped,
 * which is what ends a cycle.
 */
export class AttachedConnectionBehavior {
  static $inject = ['eventBus', 'modeling'];

  constructor(eventBus: AttachedEventBus, modeling: AttachedModeling) {
    const recorded = new WeakMap<object, AttachedEnd[]>();
    const following = new Set<DjsLine>();

    eventBus.on(
      ROUTE_COMMANDS.map((command) => `commandStack.${command}.preExecute`),
      ({ context }) => {
        const line = context?.connection;
        const points = line?.waypoints;
        if (!context || !line || !points || points.length < 2) return;
        const ends: AttachedEnd[] = [];
        for (const connection of line.incoming ?? []) {
          const at = connection.waypoints?.[connection.waypoints.length - 1];
          if (connection.target === line && at) ends.push({ connection, end: 'end', along: positionAlong(points, at) });
        }
        for (const connection of line.outgoing ?? []) {
          const at = connection.waypoints?.[0];
          if (connection.source === line && at) ends.push({ connection, end: 'start', along: positionAlong(points, at) });
        }
        if (ends.length > 0) recorded.set(context, ends);
      },
    );

    // `postExecuted`: after the handler's own postExecute, which for a reconnect
    // is where the route is laid out.
    eventBus.on(
      ROUTE_COMMANDS.map((command) => `commandStack.${command}.postExecuted`),
      ({ context }) => {
        const line = context?.connection;
        const ends = context ? recorded.get(context) : undefined;
        if (!line || !ends || following.has(line)) return;
        following.add(line);
        try {
          for (const { connection, end, along } of ends) {
            const point = pointAlong(line.waypoints ?? [], along);
            modeling.layoutConnection(connection, end === 'start' ? { connectionStart: point } : { connectionEnd: point });
          }
        } finally {
          following.delete(line);
        }
      },
    );
  }
}

// ── Polylines ────────────────────────────────────────────────────────────

/** Each segment of the polyline, with where along the whole it starts. */
function segments(points: readonly DockingPoint[]): Array<{ a: DockingPoint; b: DockingPoint; from: number; length: number }> {
  const result = [];
  let from = 0;
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    result.push({ a: points[i - 1], b: points[i], from, length });
    from += length;
  }
  return result;
}

/** The point of the polyline nearest `point`, and how far along the polyline it is. */
function nearestOnPolyline(points: readonly DockingPoint[], point: DockingPoint): { x: number; y: number; distance: number } {
  let best = { x: points[0]?.x ?? point.x, y: points[0]?.y ?? point.y, distance: 0 };
  let bestGap = Infinity;
  for (const { a, b, from, length } of segments(points)) {
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length * length)));
    const x = a.x + t * (b.x - a.x);
    const y = a.y + t * (b.y - a.y);
    const gap = Math.hypot(point.x - x, point.y - y);
    if (gap < bestGap) {
      bestGap = gap;
      best = { x, y, distance: from + t * length };
    }
  }
  return best;
}

/** The point of the polyline through `points` nearest `point`. */
export function closestPointOnPolyline(points: readonly DockingPoint[], point: DockingPoint): DockingPoint {
  const { x, y } = nearestOnPolyline(points, point);
  return { x, y };
}

/** How far along the polyline (0 at its start, 1 at its end) the point of it nearest `point` lies. */
export function positionAlong(points: readonly DockingPoint[], point: DockingPoint): number {
  const total = segments(points).reduce((sum, s) => sum + s.length, 0);
  return total === 0 ? 0 : nearestOnPolyline(points, point).distance / total;
}

/** The point a fraction `along` of the way along the polyline. */
export function pointAlong(points: readonly DockingPoint[], along: number): DockingPoint {
  const all = segments(points);
  const total = all.reduce((sum, s) => sum + s.length, 0);
  const wanted = Math.max(0, Math.min(1, along)) * total;
  for (const { a, b, from, length } of all) {
    if (wanted <= from + length && length > 0) {
      const t = (wanted - from) / length;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
  }
  const last = points[points.length - 1];
  return { x: last?.x ?? 0, y: last?.y ?? 0 };
}

export { CroppingConnectionDocking };
