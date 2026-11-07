/**
 * Editing an element's or a relationship's name on the canvas.
 *
 * Double-click an element — or select it and press F2 — and its name becomes an
 * editable text box over the shape; Enter or a click elsewhere keeps the new
 * name, Esc drops it. The name is the element's `skos:prefLabel`: the same
 * value the property panel and the model tree show and edit.
 *
 * A relationship is named the same way, on its line or on its name: the box
 * opens where the name is drawn, at the middle of the route
 * ({@link connectionLabelLayout}), whether names are shown or not. Emptied, a
 * relationship's name is removed — most relationships have none — where an
 * element's cannot be. A derivation the model does not state is not named
 * (confirm it first, as the model tree has it), nor a bare triple with no
 * relationship resource to carry the name.
 *
 * The text box is `diagram-js-direct-editing`, the editor bpmn-js uses for its
 * labels. Its package entry imports a diagram-js folder without `/index.js`,
 * which Node's ESM loader rejects, so the module is declared here around its
 * `DirectEditing` class.
 *
 * The box is set as the name is drawn (`RdfRenderer.drawnLook`): in the
 * placement's own font, size and style over its notation's, aligned and placed
 * down the shape as its text is — under an element drawn as its icon, in a
 * group's tab, from a note's top left.
 *
 * The rename is a canvas command, `rdf.element.relabel`: a recorded store change
 * (so undo restores the previous name exactly, and redo re-applies it) that
 * also relabels the shape — canvas commands are not followed by a re-read of the
 * store, so the drawing must follow the command itself, on undo too.
 */

import DirectEditing, { type DirectEditingContext } from 'diagram-js-direct-editing/lib/DirectEditing.js';
import InteractionEventsModule from 'diagram-js/lib/features/interaction-events/index.js';
import { NOTATION_DEFAULTS, labelFitsInside, textWidth, wrapLabel } from './notation-shapes.js';
import { RdfChangeHandler, type RdfChangeContext } from './rdf-modeling.js';
import { connectionLabelLayout, fontFamilyOf, type RdfBusinessObject } from './rdf-renderer.js';
import { hasFontStyle, type Appearance } from '../../model-manager/appearance.js';
import { isRelationshipKey } from './relationship-resolution.js';
import type { ObservableRdfStore } from '../../rdf-engine/observable-store.js';

/** Command id of a rename on the canvas — an element's or a relationship's. */
export const RELABEL_ELEMENT_COMMAND = 'rdf.element.relabel';

/** Writes a concept's name to the model; an empty one removes it (a relationship's — an element's is never emptied). */
export type LabelWriter = (elementIri: string, label: string) => void;

/** A shape or a line, as far as a rename reads it. */
interface LabelledShape {
  id: string;
  width?: number;
  height?: number;
  businessObject?: RdfBusinessObject;
  waypoints?: ReadonlyArray<{ x: number; y: number }>;
  labelTarget?: unknown;
  parent?: unknown;
}

/** Context of {@link RELABEL_ELEMENT_COMMAND}. */
export interface RelabelContext extends Partial<RdfChangeContext> {
  element: LabelledShape;
  label: string;
  /** Filled in on first execute: the element's other placements, renamed with it. */
  others?: LabelledShape[];
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

/** Whether a diagram element is an element's shape, or a figure's — not a relationship, the root or a label. */
function isElementShape(element: LabelledShape | undefined): element is LabelledShape {
  return (
    !!element &&
    !element.waypoints &&
    !element.labelTarget &&
    !!element.parent &&
    (element.businessObject?.kind === 'element' || element.businessObject?.kind === 'figure') &&
    !!element.businessObject.iri
  );
}

/**
 * Whether a diagram element is a relationship's line that can be named: one with
 * a relationship resource of its own (not a bare triple), stated by the model
 * (not a derivation it does not state).
 */
function isNameableLine(element: LabelledShape | undefined): boolean {
  const businessObject = element?.businessObject;
  // A line from a note: what it says, its own text.
  if (businessObject?.kind === 'connector') return !!element?.waypoints && !!element.parent && !!businessObject.iri;
  return (
    !!element?.waypoints &&
    !!element.parent &&
    businessObject?.kind === 'relationship' &&
    !!businessObject.iri &&
    !isRelationshipKey(businessObject.iri) &&
    !businessObject.derivation
  );
}

/** Whether the canvas renames this: an element's shape or a relationship's line. */
export function isRenamable(element: unknown): boolean {
  const shape = element as LabelledShape | undefined;
  return isElementShape(shape) || isNameableLine(shape);
}

/** Renames as one undoable step; the shape or line shows the name in force. */
export class RelabelElementHandler extends RdfChangeHandler {
  static override $inject = ['rdfChangeStore', 'rdfLabelWriter', 'elementRegistry'];

  constructor(
    store: ObservableRdfStore | null,
    private readonly writer: LabelWriter,
    private readonly registry: { filter(fn: (element: LabelledShape) => boolean): LabelledShape[] } | null = null,
  ) {
    super(store);
  }

  override execute(context: RdfChangeContext): unknown[] {
    const relabel = context as RdfChangeContext & RelabelContext;
    const businessObject = relabel.element.businessObject!;
    relabel.previous ??= businessObject.label;
    relabel.previousNamed ??= businessObject.named;
    relabel.apply ??= () => this.writer(businessObject.iri, relabel.label);
    // An element placed more than once is renamed on every placement; a relationship drawn more than once, on every line.
    const line = businessObject.kind === 'relationship';
    relabel.others ??=
      businessObject.kind === 'element' || line
        ? (this.registry?.filter(
            (e) => e !== relabel.element && Boolean(e.waypoints) === line && e.businessObject?.iri === businessObject.iri,
          ) ?? [])
        : [];
    super.execute(relabel);
    for (const shape of [relabel.element, ...relabel.others]) {
      if (!shape.businessObject) continue;
      // Emptied (a relationship's): no name left to draw.
      shape.businessObject.label = relabel.label || undefined;
      shape.businessObject.named = relabel.label !== '';
    }
    return [relabel.element, ...relabel.others];
  }

  override revert(context: RdfChangeContext): unknown[] {
    const relabel = context as RdfChangeContext & RelabelContext;
    super.revert(relabel);
    for (const shape of [relabel.element, ...(relabel.others ?? [])]) {
      if (!shape.businessObject) continue;
      shape.businessObject.label = relabel.previous;
      shape.businessObject.named = relabel.previousNamed;
    }
    return [relabel.element, ...(relabel.others ?? [])];
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
  static $inject = ['eventBus', 'canvas', 'directEditing', 'commandStack', 'selection', 'injector'];

  private readonly canvas: CanvasLike;
  /** How names are drawn, when the diagram draws with la-gram's renderer. */
  private readonly renderer: DrawnLook | null;
  /** What the text box does not take from its style: set on its content once open. */
  private extraStyle: { fontStyle: string; textDecoration: string; color: string } = { fontStyle: '', textDecoration: '', color: '' };
  /** Text kept at the bottom of its box as it is typed: the box's height and padding, in pixels. */
  private bottomAligned: { height: number; pad: number } | undefined;
  /** Stops keeping it there, once the box closes. */
  private stopBottomAligning: (() => void) | undefined;

  constructor(
    eventBus: EventBusLike,
    canvas: CanvasLike,
    private readonly directEditing: DirectEditing,
    private readonly commandStack: CommandStackLike,
    selection: SelectionLike,
    injector: { get(name: string, strict?: boolean): unknown } | null = null,
  ) {
    this.canvas = canvas;
    this.renderer = (injector?.get('rdfRenderer', false) as DrawnLook | null | undefined) ?? null;
    commandStack.registerHandler(RELABEL_ELEMENT_COMMAND, RelabelElementHandler);
    directEditing.registerProvider(this);

    eventBus.on('element.dblclick', (event) => {
      if (isRenamable(event.element)) directEditing.activate(event.element);
    });

    // F2 renames the one selected element or relationship, as in most tools.
    eventBus.on('keyboard.keydown', 1500, (event) => {
      if (event.keyEvent?.key !== 'F2') return;
      const [only, ...more] = selection.get();
      if (more.length > 0 || !only || !isRenamable(only)) return;
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
      this.stopBottomAligning?.();
      this.stopBottomAligning = undefined;
    });

    // The whole name selected, so typing replaces it (a new element is named after its type).
    eventBus.on('directEditing.activate', () => {
      const content = canvas.getContainer().querySelector<HTMLElement>('.djs-direct-editing-content');
      const document = content?.ownerDocument;
      if (!content || !document) return;
      // Italic, underlined, in its colour — what the text box's own style leaves out.
      Object.assign(content.style, this.extraStyle);
      // At the bottom: the last line kept there as lines are typed or taken away.
      const bottom = this.bottomAligned;
      if (bottom) {
        const keep = () => {
          content.style.paddingTop = `${bottom.pad}px`;
          const lines = content.scrollHeight - 2 * bottom.pad;
          content.style.paddingTop = `${Math.max(bottom.pad, bottom.height - bottom.pad - lines)}px`;
        };
        keep();
        content.addEventListener('input', keep);
        this.stopBottomAligning = () => content.removeEventListener('input', keep);
      }
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
    this.bottomAligned = undefined;
    if (isNameableLine(shape)) return this.lineContext(shape);
    if (!isElementShape(shape)) return null;
    const zoom = this.canvas.zoom();
    const box = this.canvas.getAbsoluteBBox(shape);
    const px = (n: number) => `${Math.round(n * zoom * 100) / 100}px`;
    const look = this.renderer?.drawnLook(shape) ?? {};
    const fontSize = look.fontSize ?? NOTATION_DEFAULTS.fontSize;
    const font = this.fontOf(look, px);
    const width = shape.width ?? box.width / zoom;
    const height = shape.height ?? box.height / zoom;
    if (!labelFitsInside(width, height)) {
      // A junction: its name is typed where it is drawn, under it.
      const wide = Math.max(box.width, NOTATION_DEFAULTS.width * zoom);
      return {
        text: shape.businessObject?.named ? (shape.businessObject.label ?? '') : '',
        bounds: {
          x: box.x + box.width / 2 - wide / 2,
          y: box.y + box.height + NOTATION_DEFAULTS.badgePadding * zoom,
          width: wide,
          height: (fontSize * 1.2 + 8) * zoom,
        },
        style: { ...font, paddingTop: px(4), paddingBottom: px(4), textAlign: 'center', backgroundColor: 'transparent' },
        options: { centerVertically: true, autoResize: false, resizable: false },
      };
    }
    const text = shape.businessObject?.label ?? '';
    const figure = shape.businessObject?.kind === 'figure' ? shape.businessObject.figure : undefined;
    if (figure?.kind === 'group') {
      // In its tab, at its top left, as it is drawn.
      const tab = Math.min(width, Math.max(60, textWidth(text, fontSize) + 16, NOTATION_DEFAULTS.width));
      return {
        text,
        bounds: { x: box.x, y: box.y, width: tab * zoom, height: Math.min(height, 20) * zoom },
        style: { ...font, paddingLeft: px(6), paddingRight: px(2), textAlign: 'left', backgroundColor: 'transparent' },
        options: { centerVertically: true, autoResize: false, resizable: false },
      };
    }
    if (this.renderer?.drawnMode(shape) === 'IconCentric') {
      // Drawn as its icon: its name under it.
      const band = Math.min(height, NOTATION_DEFAULTS.iconCentricLabelBand);
      return {
        text,
        bounds: { x: box.x, y: box.y + box.height - band * zoom, width: box.width, height: band * zoom },
        style: { ...font, textAlign: 'center', backgroundColor: 'transparent' },
        options: { centerVertically: true, autoResize: false, resizable: false },
      };
    }
    // A note's text from its left; an element's clear of the badge glyph in its corner — aligned, from the other side.
    const badge = NOTATION_DEFAULTS.badgeSize + NOTATION_DEFAULTS.badgePadding;
    const pad = NOTATION_DEFAULTS.badgePadding;
    const side =
      figure?.kind === 'note'
        ? { left: 6, right: 12 }
        : look.textAlignment === 'left'
          ? { left: pad, right: badge + pad }
          : look.textAlignment === 'right'
            ? { left: pad, right: badge + pad }
            : { left: badge, right: badge };
    const position = look.textPosition ?? 'middle';
    // At the bottom: its lines as they wrap now, their last at the bottom.
    const lines = Math.max(1, wrapLabel(text, Math.max(1, width - side.left - side.right), fontSize).length);
    const top = position === 'bottom' ? Math.max(pad, height - pad - lines * Math.round(fontSize * 1.2)) : pad;
    this.bottomAligned = position === 'bottom' ? { height: box.height, pad: pad * zoom } : undefined;
    return {
      text,
      bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
      style: {
        ...font,
        paddingTop: px(top),
        paddingBottom: px(pad),
        paddingLeft: px(side.left),
        paddingRight: px(side.right),
        textAlign: look.textAlignment ?? 'center',
        backgroundColor: 'transparent',
      },
      options: { centerVertically: position === 'middle', autoResize: false, resizable: false },
    };
  }

  /** The text box's font as the name is drawn; italic, underline and colour kept for its content. */
  private fontOf(look: Appearance, px: (n: number) => string): { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string } {
    this.extraStyle = {
      fontStyle: hasFontStyle(look.fontStyle, 'italic') ? 'italic' : '',
      textDecoration: hasFontStyle(look.fontStyle, 'underline') ? 'underline' : '',
      color: look.fontColor ?? '',
    };
    return {
      fontFamily: fontFamilyOf(look.fontName),
      fontSize: px(look.fontSize ?? NOTATION_DEFAULTS.fontSize),
      fontWeight: hasFontStyle(look.fontStyle, 'bold') ? 'bold' : 'normal',
      lineHeight: '1.2',
    };
  }

  /**
   * A relationship's name is typed where it is drawn — at the middle of the
   * route, under a derivation badge — on white, over the line, at least an
   * element's width wide and growing downwards as the name does.
   */
  private lineContext(line: LabelledShape): DirectEditingContext | null {
    const businessObject = line.businessObject;
    const text = businessObject?.named ? (businessObject.label ?? '') : '';
    const look = this.renderer?.drawnLook(line) ?? {};
    const layout = connectionLabelLayout(line.waypoints ?? [], text, {
      badge: !!businessObject?.derivation,
      offset: businessObject?.labelOffset,
      ...(look.fontSize ? { fontSize: look.fontSize } : {}),
      ...(look.labelAnchor ? { anchor: look.labelAnchor } : {}),
    });
    if (!layout) return null;
    const zoom = this.canvas.zoom();
    const px = (n: number) => `${Math.round(n * zoom * 100) / 100}px`;
    const pad = 4;
    const width = Math.max(layout.box.width, NOTATION_DEFAULTS.width);
    // `getAbsoluteBBox` maps a diagram box onto the page; a line's own box is the whole route's.
    const bounds = this.canvas.getAbsoluteBBox({
      x: layout.x - width / 2,
      y: layout.box.y - pad,
      width,
      height: layout.box.height + 2 * pad,
    });
    return {
      text,
      bounds,
      style: {
        ...this.fontOf(look, px),
        paddingTop: px(pad),
        paddingBottom: px(pad),
        textAlign: 'center',
        backgroundColor: '#ffffff',
      },
      options: { centerVertically: false, autoResize: true, resizable: false },
    };
  }

  update(element: unknown, newText: string): void {
    const shape = element as LabelledShape;
    const label = normalizeLabel(newText);
    if (isNameableLine(shape)) {
      // Emptied, a relationship's name is removed; an unchanged one is no edit.
      const current = shape.businessObject?.named ? (shape.businessObject.label ?? '') : '';
      if (label === current) return;
      this.commandStack.execute(RELABEL_ELEMENT_COMMAND, { element: shape, label });
      return;
    }
    // A name cannot be emptied (as in the property panel), and an unchanged one is no edit.
    if (!label || label === shape.businessObject?.label) return;
    this.commandStack.execute(RELABEL_ELEMENT_COMMAND, { element: shape, label });
  }
}

/**
 * The didi module: the direct-editing text box, the provider, and the writer
 * the relabel command writes the name with.
 */
/** What the editor asks of la-gram's renderer: how a name is drawn now. */
interface DrawnLook {
  drawnLook(element: unknown): Appearance;
  drawnMode(element: unknown): string;
}

export function rdfLabelEditingModule(writer: LabelWriter): Record<string, unknown> {
  return {
    __depends__: [InteractionEventsModule],
    __init__: ['directEditing', 'rdfLabelEditingProvider'],
    directEditing: ['type', DirectEditing],
    rdfLabelWriter: ['value', writer],
    rdfLabelEditingProvider: ['type', RdfLabelEditingProvider],
  };
}
