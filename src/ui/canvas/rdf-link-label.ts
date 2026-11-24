/**
 * Moving a relationship's name on the canvas.
 *
 * Press on a name drawn on its line (the *Relationship names* switch on) and
 * drag: the name follows the pointer, and where it is let go is kept in the
 * open view — an `arch-vis:LabelNode` hung on the relationship's
 * `arch-vis:Link` with `arch-vis:label` (`ViewManager.setLinkLabel`). Esc drops
 * the move. The name keeps its offset from the middle of the route
 * (`RdfBusinessObject.labelOffset`), so it follows the line when the line is
 * re-routed or its ends move; the canvas writes its bounds again with the
 * route, in the same undoable step.
 *
 * A press anywhere else on the line does what it did: diagram-js's bendpoints
 * take it (a new bend, a segment moved). Over the name, this listener answers
 * first — above `Bendpoints`' own — whatever node the press landed on: the
 * name's box, or the segment handle diagram-js draws over the line's middle,
 * on top of it.
 *
 * The move is a canvas command, `rdf.link.label.move`: a recorded store change
 * (undo restores the label node exactly, redo re-applies it) that also places
 * the name on the line — canvas commands are not followed by a re-read of the
 * store, so the drawing must follow the command itself, on undo too. Moved to
 * nowhere (`offset` absent), the label node goes and the name is back at the
 * middle — or the end its look anchors it at: the right-click menu's *Move name back to its place*.
 */

import { RdfChangeHandler, type RdfChangeContext } from './rdf-modeling.js';
import {
  drawnConnectionLabel,
  labelOffsetOf,
  type LabelOffset,
  type RdfBusinessObject,
  type RenderOptions,
} from './rdf-renderer.js';
import type { ObservableRdfStore } from '@linked-archi/kernel/rdf-engine/observable-store.js';

/** Command id of moving a relationship's name. */
export const MOVE_LINK_LABEL_COMMAND = 'rdf.link.label.move';

/** Prefix of the drag's events (`rdf.linkLabel.move`, `.end`, `.cancel`). */
const DRAG_PREFIX = 'rdf.linkLabel';

/** A relationship's line, as far as moving its name reads it. */
export interface LabelledLine {
  id: string;
  waypoints?: Array<{ x: number; y: number }>;
  businessObject?: RdfBusinessObject;
}

/** Keeps a name's place in the open view — or, with no offset, drops it. */
export type LinkLabelWriter = (line: LabelledLine, offset: LabelOffset | undefined) => void;

/** Whether a line's name can be moved here: a view is open, and no collaborator holds the line. */
export type LinkLabelMovable = (line: LabelledLine) => boolean;

/** Context of {@link MOVE_LINK_LABEL_COMMAND}. */
export interface MoveLinkLabelContext extends Partial<RdfChangeContext> {
  connection: LabelledLine;
  /** Where to: the name's centre from the middle of the route; absent, back to the middle. */
  offset: LabelOffset | undefined;
  /** Filled in on first execute: where it was. */
  previous?: { offset: LabelOffset | undefined };
}

/** Moves a name as one undoable step; the line shows it where it now is. */
export class MoveLinkLabelHandler extends RdfChangeHandler {
  static override $inject = ['rdfChangeStore', 'rdfLinkLabelWriter'];

  constructor(
    store: ObservableRdfStore | null,
    private readonly writer: LinkLabelWriter,
  ) {
    super(store);
  }

  override execute(context: RdfChangeContext): unknown[] {
    const move = context as RdfChangeContext & MoveLinkLabelContext;
    move.previous ??= { offset: move.connection.businessObject?.labelOffset };
    move.apply ??= () => this.writer(move.connection, move.offset);
    super.execute(move);
    placeName(move.connection, move.offset);
    return [move.connection];
  }

  override revert(context: RdfChangeContext): unknown[] {
    const move = context as RdfChangeContext & MoveLinkLabelContext;
    super.revert(move);
    placeName(move.connection, move.previous?.offset);
    return [move.connection];
  }
}

/** Put a line's name at `offset` from the middle of its route, or back at the middle. */
function placeName(line: LabelledLine, offset: LabelOffset | undefined): void {
  if (!line.businessObject) return;
  if (offset) line.businessObject.labelOffset = { ...offset };
  else delete line.businessObject.labelOffset;
}

/** What a diagram-js event carries, as far as moving a name reads it. */
interface CanvasEvent {
  element?: LabelledLine;
  originalEvent?: MouseEvent;
  dx?: number;
  dy?: number;
  context?: DragContext;
}

/** What a drag of a name carries from its start to its end. */
interface DragContext {
  connection: LabelledLine;
  /** Where the name was when the press started. */
  start: LabelOffset;
  /** The line's offset before the drag — absent at the middle. */
  before: LabelOffset | undefined;
}

interface EventBusLike {
  on(events: string | string[], callback: (event: CanvasEvent) => unknown): void;
  on(events: string | string[], priority: number, callback: (event: CanvasEvent) => unknown): void;
}

interface CanvasLike {
  viewbox(): { x: number; y: number; scale: number };
  getContainer(): HTMLElement;
}

interface DraggingLike {
  init(event: MouseEvent, prefix: string, options: Record<string, unknown>): void;
}

interface CommandStackLike {
  registerHandler(command: string, handler: unknown): void;
  execute(command: string, context: MoveLinkLabelContext): void;
}

interface GraphicsLike {
  update(type: 'connection', element: unknown, gfx: unknown): void;
}

interface RegistryLike {
  getGraphics(element: unknown): unknown;
}

/** Above diagram-js's `Bendpoints`, which takes a press on a line at the default 1000. */
const PRESS_PRIORITY = 1500;

/** The drag: a press on a drawn name starts it; letting go moves the name, undoably. */
export class RdfLinkLabelMove {
  static $inject = [
    'eventBus',
    'canvas',
    'dragging',
    'commandStack',
    'graphicsFactory',
    'elementRegistry',
    'rdfRenderOptions',
    'rdfLinkLabelMovable',
    'notationStyles',
  ];

  constructor(
    eventBus: EventBusLike,
    private readonly canvas: CanvasLike,
    dragging: DraggingLike,
    commandStack: CommandStackLike,
    graphicsFactory: GraphicsLike,
    elementRegistry: RegistryLike,
    renderOptions: RenderOptions,
    movable: LinkLabelMovable,
    notationStyles: {
      relationshipStyleFor(typeIri: string | undefined): { fontSize?: number; labelAnchor?: 'source' | 'middle' | 'target' } | undefined;
    } | null = null,
  ) {
    commandStack.registerHandler(MOVE_LINK_LABEL_COMMAND, MoveLinkLabelHandler);
    // The name drawn where it is now, without a command: while dragging, and when a drag is dropped.
    const redraw = (line: LabelledLine) => graphicsFactory.update('connection', line, elementRegistry.getGraphics(line));

    eventBus.on('element.mousedown', PRESS_PRIORITY, (event) => {
      const line = event.element;
      const press = event.originalEvent;
      if (!line?.waypoints || !press || press.button !== 0) return undefined;
      const drawn = drawnConnectionLabel(line, renderOptions, notationStyles?.relationshipStyleFor(line.businessObject?.typeIri));
      if (!drawn || !movable(line)) return undefined;
      const at = this.diagramPoint(press);
      const box = drawn.box;
      if (at.x < box.x || at.x > box.x + box.width || at.y < box.y || at.y > box.y + box.height) return undefined;
      const start = labelOffsetOf(line.waypoints, box);
      if (!start) return undefined;
      const context: DragContext = { connection: line, start, before: line.businessObject?.labelOffset };
      dragging.init(press, DRAG_PREFIX, { cursor: 'grabbing', keepSelection: true, data: { context } });
      // Handled: the line's bendpoints do not take this press.
      return true;
    });

    eventBus.on(`${DRAG_PREFIX}.move`, (event) => {
      const context = event.context;
      if (!context?.connection.businessObject) return;
      context.connection.businessObject.labelOffset = {
        x: context.start.x + (event.dx ?? 0),
        y: context.start.y + (event.dy ?? 0),
      };
      redraw(context.connection);
    });

    eventBus.on(`${DRAG_PREFIX}.end`, (event) => {
      const context = event.context;
      const businessObject = context?.connection.businessObject;
      if (!context || !businessObject) return;
      const offset = businessObject.labelOffset;
      // As it was, so the command records where the name was before.
      placeName(context.connection, context.before);
      if (offset) commandStack.execute(MOVE_LINK_LABEL_COMMAND, { connection: context.connection, offset });
    });

    eventBus.on(`${DRAG_PREFIX}.cancel`, (event) => {
      const context = event.context;
      if (!context) return;
      placeName(context.connection, context.before);
      redraw(context.connection);
    });
  }

  /** A pointer event's position in the diagram's coordinates. */
  private diagramPoint(event: MouseEvent): { x: number; y: number } {
    const viewbox = this.canvas.viewbox();
    const rect = this.canvas.getContainer().getBoundingClientRect();
    return {
      x: viewbox.x + (event.clientX - rect.left) / viewbox.scale,
      y: viewbox.y + (event.clientY - rect.top) / viewbox.scale,
    };
  }
}

/**
 * The didi module: the drag, the command, the writer that keeps a name's place
 * in the open view, and what says whether a line's name may move.
 */
export function rdfLinkLabelModule(writer: LinkLabelWriter, movable: LinkLabelMovable): Record<string, unknown> {
  return {
    __init__: ['rdfLinkLabelMove'],
    rdfLinkLabelWriter: ['value', writer],
    rdfLinkLabelMovable: ['value', movable],
    rdfLinkLabelMove: ['type', RdfLinkLabelMove],
  };
}
