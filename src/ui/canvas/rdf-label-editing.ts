/**
 * Editing an element's name on the canvas.
 *
 * Double-click an element — or select it and press F2 — and its name becomes an
 * editable text box over the shape; Enter or a click elsewhere keeps the new
 * name, Esc drops it. The name is the element's `skos:prefLabel`: the same
 * value the property panel and the model tree show and edit.
 *
 * The text box is `diagram-js-direct-editing`, the editor bpmn-js uses for its
 * labels. Its package entry imports a diagram-js folder without `/index.js`,
 * which Node's ESM loader rejects, so the module is declared here around its
 * `DirectEditing` class.
 *
 * The rename is a canvas command, `rdf.element.relabel`: a recorded store change
 * (so undo restores the previous name exactly, and redo re-applies it) that
 * also relabels the shape — canvas commands are not followed by a re-read of the
 * store, so the drawing must follow the command itself, on undo too.
 */

import DirectEditing, { type DirectEditingContext } from 'diagram-js-direct-editing/lib/DirectEditing.js';
import InteractionEventsModule from 'diagram-js/lib/features/interaction-events/index.js';
import { NOTATION_DEFAULTS, labelFitsInside } from './notation-shapes.js';
import { RdfChangeHandler, type RdfChangeContext } from './rdf-modeling.js';
import type { RdfBusinessObject } from './rdf-renderer.js';
import type { ObservableRdfStore } from '../../rdf-engine/observable-store.js';

/** Command id of a rename on the canvas. */
export const RELABEL_ELEMENT_COMMAND = 'rdf.element.relabel';

/** Writes an element's name to the model. */
export type LabelWriter = (elementIri: string, label: string) => void;

/** A shape, as far as a rename reads it. */
interface LabelledShape {
  id: string;
  width?: number;
  height?: number;
  businessObject?: RdfBusinessObject;
  waypoints?: unknown;
  labelTarget?: unknown;
  parent?: unknown;
}

/** Context of {@link RELABEL_ELEMENT_COMMAND}. */
export interface RelabelContext extends Partial<RdfChangeContext> {
  element: LabelledShape;
  label: string;
  /** Filled in on first execute: the name before. */
  previous?: string;
  /** Filled in on first execute: whether that was the element's own name. */
  previousNamed?: boolean;
}

/**
 * A name as the model keeps it: one line, spaces collapsed. Line breaks typed
 * in the box (Shift+Enter) would only show as spaces in every other view.
 */
export function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Whether a diagram element is an element's shape — not a relationship, the root or a label. */
function isElementShape(element: LabelledShape | undefined): element is LabelledShape {
  return (
    !!element &&
    !element.waypoints &&
    !element.labelTarget &&
    !!element.parent &&
    element.businessObject?.kind === 'element' &&
    !!element.businessObject.iri
  );
}

/** Renames as one undoable step; the shape shows the name in force. */
export class RelabelElementHandler extends RdfChangeHandler {
  static override $inject = ['rdfChangeStore', 'rdfLabelWriter'];

  constructor(
    store: ObservableRdfStore | null,
    private readonly writer: LabelWriter,
  ) {
    super(store);
  }

  override execute(context: RdfChangeContext): unknown[] {
    const relabel = context as RdfChangeContext & RelabelContext;
    const businessObject = relabel.element.businessObject!;
    relabel.previous ??= businessObject.label;
    relabel.previousNamed ??= businessObject.named;
    relabel.apply ??= () => this.writer(businessObject.iri, relabel.label);
    super.execute(relabel);
    businessObject.label = relabel.label;
    businessObject.named = true;
    return [relabel.element];
  }

  override revert(context: RdfChangeContext): unknown[] {
    const relabel = context as RdfChangeContext & RelabelContext;
    super.revert(relabel);
    if (relabel.element.businessObject) {
      relabel.element.businessObject.label = relabel.previous;
      relabel.element.businessObject.named = relabel.previousNamed;
    }
    return [relabel.element];
  }
}

/** What a diagram-js event carries, as far as renaming reads it. */
interface CanvasEvent {
  element?: LabelledShape;
  keyEvent?: KeyboardEvent;
  active?: { element?: LabelledShape };
}

interface EventBusLike {
  on(events: string | string[], callback: (event: CanvasEvent) => unknown): void;
  on(events: string | string[], priority: number, callback: (event: CanvasEvent) => unknown): void;
}

interface CanvasLike {
  getAbsoluteBBox(element: unknown): { x: number; y: number; width: number; height: number };
  zoom(): number;
  getContainer(): HTMLElement;
  addMarker(element: unknown, marker: string): void;
  removeMarker(element: unknown, marker: string): void;
}

/** Marker on the shape being renamed: its drawn name is hidden under the text box. */
export const EDITING_MARKER = 'la-label-editing';

interface CommandStackLike {
  registerHandler(command: string, handler: unknown): void;
  execute(command: string, context: RelabelContext): void;
}

interface SelectionLike {
  get(): LabelledShape[];
}

/**
 * The provider: which shapes can be renamed, how the text box sits over them,
 * and what completing an edit does.
 */
export class RdfLabelEditingProvider {
  static $inject = ['eventBus', 'canvas', 'directEditing', 'commandStack', 'selection'];

  private readonly canvas: CanvasLike;

  constructor(
    eventBus: EventBusLike,
    canvas: CanvasLike,
    private readonly directEditing: DirectEditing,
    private readonly commandStack: CommandStackLike,
    selection: SelectionLike,
  ) {
    this.canvas = canvas;
    commandStack.registerHandler(RELABEL_ELEMENT_COMMAND, RelabelElementHandler);
    directEditing.registerProvider(this);

    eventBus.on('element.dblclick', (event) => {
      if (isElementShape(event.element)) directEditing.activate(event.element);
    });

    // F2 renames the one selected element, as in most tools.
    eventBus.on('keyboard.keydown', 1500, (event) => {
      if (event.keyEvent?.key !== 'F2') return;
      const [only, ...more] = selection.get();
      if (more.length > 0 || !isElementShape(only)) return;
      event.keyEvent.preventDefault();
      directEditing.activate(only);
      return true;
    });

    // While editing, the drawn name gives way to the text box.
    let editing: LabelledShape | undefined;
    eventBus.on('directEditing.activate', (event) => {
      editing = event.active?.element;
      if (editing) canvas.addMarker(editing, EDITING_MARKER);
    });
    eventBus.on('directEditing.deactivate', () => {
      if (editing) canvas.removeMarker(editing, EDITING_MARKER);
      editing = undefined;
    });

    // The whole name selected, so typing replaces it (a new element is named after its type).
    eventBus.on('directEditing.activate', () => {
      const content = canvas.getContainer().querySelector<HTMLElement>('.djs-direct-editing-content');
      const document = content?.ownerDocument;
      if (!content || !document) return;
      const range = document.createRange();
      range.selectNodeContents(content);
      const selected = document.defaultView?.getSelection();
      selected?.removeAllRanges();
      selected?.addRange(range);
    });

    // Whatever takes the pointer or moves the canvas keeps what was typed so far.
    eventBus.on(
      ['canvas.viewbox.changing', 'drag.init', 'element.mousedown', 'popupMenu.open', 'root.set', 'contextPad.close'],
      () => {
        if (directEditing.isActive()) directEditing.complete();
      },
    );
  }

  activate(element: unknown): DirectEditingContext | null {
    const shape = element as LabelledShape;
    if (!isElementShape(shape)) return null;
    const zoom = this.canvas.zoom();
    const box = this.canvas.getAbsoluteBBox(shape);
    const px = (n: number) => `${Math.round(n * zoom * 100) / 100}px`;
    if (!labelFitsInside(shape.width ?? box.width, shape.height ?? box.height)) {
      // A junction: its name is typed where it is drawn, under it.
      const width = Math.max(box.width, NOTATION_DEFAULTS.width * zoom);
      return {
        text: shape.businessObject?.named ? (shape.businessObject.label ?? '') : '',
        bounds: {
          x: box.x + box.width / 2 - width / 2,
          y: box.y + box.height + NOTATION_DEFAULTS.badgePadding * zoom,
          width,
          height: (NOTATION_DEFAULTS.fontSize * 1.2 + 8) * zoom,
        },
        style: {
          fontFamily: NOTATION_DEFAULTS.fontFamily,
          fontSize: px(NOTATION_DEFAULTS.fontSize),
          lineHeight: '1.2',
          paddingTop: px(4),
          paddingBottom: px(4),
          textAlign: 'center',
          backgroundColor: 'transparent',
        },
        options: { centerVertically: true, autoResize: false, resizable: false },
      };
    }
    return {
      text: shape.businessObject?.label ?? '',
      bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
      style: {
        fontFamily: NOTATION_DEFAULTS.fontFamily,
        fontSize: px(NOTATION_DEFAULTS.fontSize),
        lineHeight: '1.2',
        paddingTop: px(4),
        paddingBottom: px(4),
        // Clear of the badge glyph in the top-right corner.
        paddingLeft: px(NOTATION_DEFAULTS.badgeSize + NOTATION_DEFAULTS.badgePadding),
        paddingRight: px(NOTATION_DEFAULTS.badgeSize + NOTATION_DEFAULTS.badgePadding),
        textAlign: 'center',
        backgroundColor: 'transparent',
      },
      options: { centerVertically: true, autoResize: false, resizable: false },
    };
  }

  update(element: unknown, newText: string): void {
    const shape = element as LabelledShape;
    const label = normalizeLabel(newText);
    // A name cannot be emptied (as in the property panel), and an unchanged one is no edit.
    if (!label || label === shape.businessObject?.label) return;
    this.commandStack.execute(RELABEL_ELEMENT_COMMAND, { element: shape, label });
  }
}

/**
 * The didi module: the direct-editing text box, the provider, and the writer
 * the relabel command writes the name with.
 */
export function rdfLabelEditingModule(writer: LabelWriter): Record<string, unknown> {
  return {
    __depends__: [InteractionEventsModule],
    __init__: ['directEditing', 'rdfLabelEditingProvider'],
    directEditing: ['type', DirectEditing],
    rdfLabelWriter: ['value', writer],
    rdfLabelEditingProvider: ['type', RdfLabelEditingProvider],
  };
}
