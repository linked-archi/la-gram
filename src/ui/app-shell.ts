import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { EventBus, ModelEventType, ModelEvent } from './event-bus.js';

/**
 * Main application shell providing the layout for the RDF Architecture Modeler.
 * Uses CSS Grid with named slots for each panel area:
 * - toolbar (top bar: file, metamodels, views, collaboration)
 * - palette (left sidebar, top)
 * - explorer (left sidebar, bottom)
 * - canvas (center)
 * - property-panel (right sidebar) — shown by default, can be hidden
 * - validation (bottom bar)
 * - rdf (far right, full height: the model as RDF) — hidden until opened
 *
 * The two right-hand panels are *side panels*: each can be shown or hidden,
 * and resized by dragging its left edge. Widths are remembered per browser.
 */

/** A resizable, hideable panel on the right. */
export type SidePanel = 'property' | 'rdf';

/** Width limits and the localStorage key of each side panel. */
const SIDE_PANELS: Record<SidePanel, { key: string; initial: number; min: number }> = {
  property: { key: 'la-gram:property-panel-width', initial: 300, min: 220 },
  rdf: { key: 'la-gram:rdf-panel-width', initial: 440, min: 280 },
};

/** Room kept for the left sidebar and the canvas when a side panel is dragged wide. */
const LEFT_SIDEBAR = 250;
const MIN_CANVAS = 240;

/** The last width the user dragged a side panel to, per browser. */
function storedWidth(panel: SidePanel): number {
  const { key, initial, min } = SIDE_PANELS[panel];
  try {
    const stored = Number(globalThis.localStorage?.getItem(key));
    if (Number.isFinite(stored) && stored >= min) return stored;
  } catch {
    /* storage unavailable (private mode, sandbox): use the default */
  }
  return initial;
}

/** Pointer handlers of a resize handle. */
interface ResizeHandlers {
  start?: (e: PointerEvent) => void;
  move?: (e: PointerEvent) => void;
  end?: (e: PointerEvent) => void;
}

/** The drag handle on a side panel's left edge. */
function resizeHandle(panel: SidePanel, on: ResizeHandlers = {}) {
  return html`<div
    class="resizer"
    data-panel=${panel}
    title="Drag to resize"
    @pointerdown=${on.start}
    @pointermove=${on.move}
    @pointerup=${on.end}
    @pointercancel=${on.end}
  ></div>`;
}

@customElement('app-shell')
export class AppShell extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .shell {
      display: grid;
      /* Side panel columns are 0 wide while hidden; see propertyOpen / rdfOpen. */
      grid-template-columns: 250px minmax(0, 1fr) var(--la-property-column, 300px) var(--la-rdf-column, 0px);
      grid-template-rows: auto 1fr 1fr 190px;
      grid-template-areas:
        "toolbar   toolbar    toolbar    toolbar"
        "palette   canvas     property   rdf"
        "explorer  canvas     property   rdf"
        "explorer  validation validation rdf";
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .panel-toolbar   { grid-area: toolbar; }
    .panel-palette   { grid-area: palette; overflow: auto; }
    .panel-canvas    { grid-area: canvas; overflow: hidden; }
    .panel-property  { grid-area: property; }
    .panel-explorer  { grid-area: explorer; overflow: auto; }
    .panel-validation { grid-area: validation; overflow: auto; }
    .panel-rdf { grid-area: rdf; }
    .side {
      display: none;
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      border-left: 1px solid #dadce0;
    }
    .shell.property-open .panel-property,
    .shell.rdf-open .panel-rdf { display: block; }
    /* The property panel scrolls inside, so its resize handle stays put. */
    .side-body {
      height: 100%;
      overflow: auto;
    }
    .resizer {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 6px;
      cursor: col-resize;
      z-index: 5;
    }
    .resizer:hover,
    .resizer.dragging {
      background: rgba(26, 115, 232, 0.25);
    }
  `;

  /** Whether the property panel (element / view info) is shown. Shown by default. */
  @property({ type: Boolean, reflect: true }) propertyOpen = true;

  /** Width of the property panel in pixels; dragged with its left edge. */
  @property({ type: Number }) propertyWidth = storedWidth('property');

  /** Whether the RDF panel (far right) is shown. Hidden by default. */
  @property({ type: Boolean, reflect: true }) rdfOpen = false;

  /** Width of the RDF panel in pixels; dragged with its left edge. */
  @property({ type: Number }) rdfWidth = storedWidth('rdf');

  private _drag: { panel: SidePanel; startX: number; startWidth: number } | null = null;

  private _width(panel: SidePanel): number {
    return panel === 'property' ? this.propertyWidth : this.rdfWidth;
  }

  private _setWidth(panel: SidePanel, width: number): void {
    if (panel === 'property') this.propertyWidth = width;
    else this.rdfWidth = width;
  }

  /** The widest a side panel may get: the canvas keeps some room. */
  private _maxWidth(panel: SidePanel): number {
    const other: SidePanel = panel === 'property' ? 'rdf' : 'property';
    const otherOpen = other === 'property' ? this.propertyOpen : this.rdfOpen;
    const room = (globalThis.innerWidth ?? 1600) - LEFT_SIDEBAR - MIN_CANVAS - (otherOpen ? this._width(other) : 0);
    return Math.max(SIDE_PANELS[panel].min, room);
  }

  private _onResizeStart = (e: PointerEvent): void => {
    const handle = e.currentTarget as HTMLElement;
    const panel = handle.dataset['panel'] as SidePanel;
    e.preventDefault();
    this._drag = { panel, startX: e.clientX, startWidth: this._width(panel) };
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('dragging');
  };

  private _onResizeMove = (e: PointerEvent): void => {
    if (!this._drag) return;
    const { panel, startX, startWidth } = this._drag;
    // Dragging the left edge left makes the panel wider.
    const wanted = startWidth + (startX - e.clientX);
    this._setWidth(panel, Math.min(this._maxWidth(panel), Math.max(SIDE_PANELS[panel].min, wanted)));
  };

  private _onResizeEnd = (e: PointerEvent): void => {
    if (!this._drag) return;
    const { panel } = this._drag;
    this._drag = null;
    (e.currentTarget as Element).classList.remove('dragging');
    try {
      globalThis.localStorage?.setItem(SIDE_PANELS[panel].key, String(this._width(panel)));
    } catch {
      /* not persisted: fine */
    }
  };

  private readonly _resize: ResizeHandlers = {
    start: this._onResizeStart,
    move: this._onResizeMove,
    end: this._onResizeEnd,
  };

  @property({ attribute: false })
  eventBus: EventBus = new EventBus();

  /** All event types the shell listens to for reactive re-renders. */
  private static readonly WATCHED_EVENTS: ModelEventType[] = [
    'element-created',
    'element-deleted',
    'element-updated',
    'relationship-created',
    'relationship-deleted',
    'selection-changed',
    'model-loaded',
    'model-saved',
    'metamodel-loaded',
    'validation-updated',
    'view-opened',
    'views-changed',
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    for (const evt of AppShell.WATCHED_EVENTS) {
      this.eventBus.on(evt, this._onModelChange);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const evt of AppShell.WATCHED_EVENTS) {
      this.eventBus.off(evt, this._onModelChange);
    }
  }

  private _onModelChange = (_event: ModelEvent): void => {
    this.requestUpdate();
  };

  override render() {
    // `!== false`: shown unless hidden, also for a bare render (tests).
    const propertyOpen = this.propertyOpen !== false;
    return html`
      <div
        class="shell ${propertyOpen ? 'property-open' : ''} ${this.rdfOpen ? 'rdf-open' : ''}"
        style="--la-property-column: ${propertyOpen ? `${this.propertyWidth ?? SIDE_PANELS.property.initial}px` : '0px'}; --la-rdf-column: ${this.rdfOpen ? `${this.rdfWidth}px` : '0px'}"
      >
        <div class="panel-toolbar">
          <slot name="toolbar"></slot>
        </div>
        <div class="panel-palette">
          <slot name="palette"></slot>
        </div>
        <div class="panel-canvas">
          <slot name="canvas"></slot>
        </div>
        <div class="panel-property side">
          ${resizeHandle('property', this._resize)}
          <div class="side-body"><slot name="property-panel"></slot></div>
        </div>
        <div class="panel-explorer">
          <slot name="explorer"></slot>
        </div>
        <div class="panel-validation">
          <slot name="validation"></slot>
        </div>
        <div class="panel-rdf side">
          ${resizeHandle('rdf', this._resize)}
          <slot name="rdf"></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
