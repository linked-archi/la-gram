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
 * rectangles. {@link CroppingLayouter} therefore takes the other route — lay the
 * connection out centre-to-centre as before, then crop both ends against the
 * real outlines through the same `connectionDocking` service the preview and the
 * bendpoint tools use. One notion of "where does this line meet this shape",
 * shared by every gesture.
 *
 * The cropped endpoints keep an `original` pointing at the uncropped centre,
 * which is what `CroppingConnectionDocking` puts there and what diagram-js's
 * `AnchorsHelper` reads (`oldAnchor.original || oldAnchor`) when a shape moves or
 * resizes. Docking is therefore recomputed from the centres each time rather
 * than drifting off an already-cropped point.
 */

import BaseLayouter from 'diagram-js/lib/layout/BaseLayouter.js';
import CroppingConnectionDocking from 'diagram-js/lib/layout/CroppingConnectionDocking.js';

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
  connectionStart?: DockingPoint;
  connectionEnd?: DockingPoint;
  source?: unknown;
  target?: unknown;
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

/**
 * `BaseLayouter`, with both ends cropped to the shapes' outlines.
 *
 * Registered as `layouter`, so it runs for every `connection.create`,
 * `connection.layout` and `connection.updateWaypoints` — which is what makes
 * moving or resizing a shape re-dock the lines attached to it, since
 * `MoveShapeHandler` and `ResizeShapeHandler` both call
 * `modeling.layoutConnection` on postExecute.
 *
 * A layout pass is by definition a re-route, so `BaseLayouter` discards any
 * bendpoints the user had placed — that is diagram-js's behaviour and this
 * subclass does not change it. Cropping itself keeps them: `getCroppedWaypoints`
 * replaces the first and last point only, which is what the bendpoint tools rely
 * on when they call the docking service directly.
 */
export class CroppingLayouter extends BaseLayouterBase {
  static $inject = ['connectionDocking'];

  private docking: ConnectionDocking;

  constructor(connectionDocking: ConnectionDocking) {
    super();
    this.docking = connectionDocking;
  }

  layoutConnection(connection: unknown, hints?: unknown): DockingPoint[] {
    const waypoints = super.layoutConnection(connection, hints);

    const layoutHints = (hints ?? {}) as LayoutHints;
    const link = (connection ?? {}) as DjsConnection;
    const source = layoutHints.source ?? link.source;
    const target = layoutHints.target ?? link.target;

    // Nothing to crop against while an end is still unattached — which is the
    // state `Connect` is in until it hovers a valid target.
    if (!source || !target || waypoints.length < 2) return waypoints;

    // Crop against the *new* waypoints, not the ones still on the connection.
    // `getCroppedWaypoints` only reads `waypoints` off what it is given (it asks
    // the graphics factory, and so the renderer, for the paths), so a shallow
    // stand-in is enough and the connection stays untouched until the command
    // handler assigns to it.
    return this.docking.getCroppedWaypoints({ ...link, waypoints }, source, target);
  }
}

export { CroppingConnectionDocking };
