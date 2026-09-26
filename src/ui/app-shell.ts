import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { EventBus, ModelEventType, ModelEvent } from './event-bus.js';

/**
 * Main application shell providing the layout for the RDF Architecture Modeler.
 * Uses CSS Grid with named slots for each panel area:
 *
 * ```
 * ┌──────────────────────── toolbar ─────────────────────────┐
 * │ explorer │ canvas                      │ palette │ rdf    │
 * │ (model   │─────────────────────────────│         │ (hidden│
 * │  tree)   │ [Properties|Validation|SPARQL]│       │  until │
 * │          │ bottom panel                │         │ opened)│
 * └──────────┴─────────────────────────────┴─────────┴────────┘
 * ```
 *
 * - toolbar (top bar: file, metamodels, views, collaboration)
 * - explorer (left, full height: the model tree)
 * - canvas (centre)
 * - bottom panel under the canvas: tabs over the `properties`, `validation` and
 *   `sparql` slots; resizable by its top edge, folded to its tabs by clicking
 *   the open tab
 * - palette (right) — shown by default, can be hidden
 * - rdf (far right, full height: the model as RDF) — hidden until opened
 *
 * The two right-hand panels are *side panels*: each can be shown or hidden,
 * and resized by dragging its left edge. Sizes, the open tab and whether the
 * bottom panel is folded are remembered per browser.
 */

/** A resizable, hideable panel on the right. */
export type SidePanel = 'palette' | 'rdf';

/** A tab of the bottom panel. */
export type BottomTab = 'properties' | 'validation' | 'sparql';

/** The bottom panel's tabs, in order. */
export const BOTTOM_TABS: ReadonlyArray<{ id: BottomTab; label: string }> = [
  { id: 'properties', label: 'Properties' },
  { id: 'validation', label: 'Validation' },
  { id: 'sparql', label: 'SPARQL Query' },
];

/** Width limits and the localStorage key of each side panel. */
const SIDE_PANELS: Record<SidePanel, { key: string; initial: number; min: number }> = {
  palette: { key: 'la-gram:palette-panel-width', initial: 250, min: 180 },
  rdf: { key: 'la-gram:rdf-panel-width', initial: 440, min: 280 },
};

/** Height limits and localStorage keys of the bottom panel. */
const BOTTOM = {
  heightKey: 'la-gram:bottom-panel-height',
  tabKey: 'la-gram:bottom-panel-tab',
  foldedKey: 'la-gram:bottom-panel-folded',
  initial: 280,
  min: 120,
};

/** Room kept for the model tree and the canvas when a side panel is dragged wide. */
const LEFT_SIDEBAR = 260;
const MIN_CANVAS = 240;
/** Room kept for the toolbar and the canvas when the bottom panel is dragged tall. */
const TOOLBAR = 44;
const MIN_CANVAS_HEIGHT = 160;

/** Read a remembered value; `undefined` when absent or storage is unavailable. */
function stored(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined; /* storage unavailable (private mode, sandbox) */
  }
}

/** Remember a value; not remembering is fine. */
function remember(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* not persisted: fine */
  }
}

/** A remembered size, when it is a number at least `min`. */
function storedSize(key: string, initial: number, min: number): number {
  const value = Number(stored(key));
  return Number.isFinite(value) && value >= min ? value : initial;
}

/** Pointer handlers of a resize handle. */
interface ResizeHandlers {
  start?: (e: PointerEvent) => void;
  move?: (e: PointerEvent) => void;
  end?: (e: PointerEvent) => void;
}

/** A drag handle: on a side panel's left edge, or the bottom panel's top edge. */
function resizeHandle(panel: SidePanel | 'bottom', on: ResizeHandlers = {}) {
  return html`<div
    class="resizer ${panel === 'bottom' ? 'horizontal' : 'vertical'}"
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
      /* Side panel columns are 0 wide while hidden; see paletteOpen / rdfOpen. */
      grid-template-columns: ${LEFT_SIDEBAR}px minmax(0, 1fr) var(--la-palette-column, 250px) var(--la-rdf-column, 0px);
      grid-template-rows: auto minmax(0, 1fr) var(--la-bottom-row, 280px);
      grid-template-areas:
        "toolbar   toolbar  toolbar  toolbar"
        "explorer  canvas   palette  rdf"
        "explorer  bottom   palette  rdf";
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .panel-toolbar   { grid-area: toolbar; }
    .panel-explorer  { grid-area: explorer; overflow: auto; }
    .panel-canvas    { grid-area: canvas; overflow: hidden; }
    .panel-palette   { grid-area: palette; }
    .panel-rdf       { grid-area: rdf; }

    .side {
      display: none;
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      border-left: 1px solid #dadce0;
    }
    .shell.palette-open .panel-palette,
    .shell.rdf-open .panel-rdf { display: block; }
    /* The palette scrolls inside, so its resize handle stays put. */
    .side-body {
      height: 100%;
      overflow: auto;
    }

    /* ── Bottom panel: tabs ── */
    .panel-bottom {
      grid-area: bottom;
      position: relative;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      border-top: 1px solid #dadce0;
      background: #fff;
    }
    .tabs {
      display: flex;
      align-items: stretch;
      flex: 0 0 auto;
      border-bottom: 1px solid #dadce0;
      background: #f8f9fa;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    .tab {
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      font: inherit;
      font-size: 13px;
      padding: 7px 14px 6px;
      color: #5f6368;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tab:hover {
      color: #202124;
      background: #f1f3f4;
    }
    .tab[aria-selected='true'] {
      color: #1a73e8;
      border-bottom-color: #1a73e8;
      font-weight: 500;
    }
    .badge {
      font-size: 11px;
      line-height: 16px;
      min-width: 16px;
      padding: 0 5px;
      border-radius: 8px;
      background: #d93025;
      color: #fff;
      text-align: center;
    }
    .tabs .spacer {
      flex: 1 1 auto;
    }
    .fold {
      border: 0;
      background: none;
      color: #5f6368;
      cursor: pointer;
      padding: 0 12px;
      font-size: 12px;
    }
    .fold:hover {
      color: #202124;
    }
    .tab-body {
      flex: 1 1 auto;
      min-height: 0;
      position: relative;
    }
    .tab-body[hidden],
    .tab-pane[hidden] {
      display: none;
    }
    .tab-pane {
      position: absolute;
      inset: 0;
    }
    /* Each tab's panel fills it and scrolls inside. */
    .tab-pane ::slotted(*) {
      height: 100%;
      box-sizing: border-box;
    }

    .resizer {
      position: absolute;
      z-index: 5;
    }
    .resizer.vertical {
      left: 0;
      top: 0;
      bottom: 0;
      width: 6px;
      cursor: col-resize;
    }
    .resizer.horizontal {
      left: 0;
      right: 0;
      top: 0;
      height: 5px;
      cursor: row-resize;
    }
    .resizer:hover,
    .resizer.dragging {
      background: rgba(26, 115, 232, 0.25);
    }
  `;

  /** Whether the palette (right) is shown. Shown by default. */
  @property({ type: Boolean, reflect: true }) paletteOpen = true;

  /** Width of the palette in pixels; dragged with its left edge. */
  @property({ type: Number }) paletteWidth = storedSize(
    SIDE_PANELS.palette.key,
    SIDE_PANELS.palette.initial,
    SIDE_PANELS.palette.min,
  );

  /** Whether the RDF panel (far right) is shown. Hidden by default. */
  @property({ type: Boolean, reflect: true }) rdfOpen = false;

  /** Width of the RDF panel in pixels; dragged with its left edge. */
  @property({ type: Number }) rdfWidth = storedSize(SIDE_PANELS.rdf.key, SIDE_PANELS.rdf.initial, SIDE_PANELS.rdf.min);

  /** The bottom panel's open tab; the last one opened, per browser. */
  @property({ type: String, reflect: true }) bottomTab: BottomTab =
    BOTTOM_TABS.find((t) => t.id === stored(BOTTOM.tabKey))?.id ?? 'properties';

  /** Whether the bottom panel is folded down to its tabs. */
  @property({ type: Boolean, reflect: true }) bottomFolded = stored(BOTTOM.foldedKey) === 'true';

  /** Height of the bottom panel in pixels (unfolded); dragged with its top edge. */
  @property({ type: Number }) bottomHeight = storedSize(BOTTOM.heightKey, BOTTOM.initial, BOTTOM.min);

  /** A small count on a tab (the violations on Validation); none when absent. */
  @property({ attribute: false }) tabBadges: Partial<Record<BottomTab, string>> = {};

  private _drag: { panel: SidePanel | 'bottom'; start: number; startSize: number } | null = null;

  /** Open a tab of the bottom panel, unfolding it; the choice is remembered. */
  showTab(tab: BottomTab): void {
    this.bottomTab = tab;
    this.bottomFolded = false;
    remember(BOTTOM.tabKey, tab);
    remember(BOTTOM.foldedKey, 'false');
    this.dispatchEvent(new CustomEvent('bottom-tab-changed', { detail: { tab }, bubbles: true, composed: true }));
  }

  /** Fold the bottom panel down to its tabs, or unfold it; remembered. */
  setBottomFolded(folded: boolean): void {
    this.bottomFolded = folded;
    remember(BOTTOM.foldedKey, String(folded));
  }

  /** A click on a tab: the open one folds or unfolds the panel, another opens. */
  private _onTab(tab: BottomTab): void {
    if (tab === this.bottomTab) this.setBottomFolded(!this.bottomFolded);
    else this.showTab(tab);
  }

  private _size(panel: SidePanel | 'bottom'): number {
    return panel === 'palette' ? this.paletteWidth : panel === 'rdf' ? this.rdfWidth : this.bottomHeight;
  }

  private _setSize(panel: SidePanel | 'bottom', size: number): void {
    if (panel === 'palette') this.paletteWidth = size;
    else if (panel === 'rdf') this.rdfWidth = size;
    else this.bottomHeight = size;
  }

  /** How small and how large a panel may be dragged; the canvas keeps some room. */
  private _limits(panel: SidePanel | 'bottom'): { min: number; max: number } {
    if (panel === 'bottom') {
      const room = (globalThis.innerHeight ?? 900) - TOOLBAR - MIN_CANVAS_HEIGHT;
      return { min: BOTTOM.min, max: Math.max(BOTTOM.min, room) };
    }
    const other: SidePanel = panel === 'palette' ? 'rdf' : 'palette';
    const otherOpen = other === 'palette' ? this.paletteOpen : this.rdfOpen;
    const room = (globalThis.innerWidth ?? 1600) - LEFT_SIDEBAR - MIN_CANVAS - (otherOpen ? this._size(other) : 0);
    return { min: SIDE_PANELS[panel].min, max: Math.max(SIDE_PANELS[panel].min, room) };
  }

  private _onResizeStart = (e: PointerEvent): void => {
    const handle = e.currentTarget as HTMLElement;
    const panel = handle.dataset['panel'] as SidePanel | 'bottom';
    e.preventDefault();
    this._drag = { panel, start: panel === 'bottom' ? e.clientY : e.clientX, startSize: this._size(panel) };
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('dragging');
  };

  private _onResizeMove = (e: PointerEvent): void => {
    if (!this._drag) return;
    const { panel, start, startSize } = this._drag;
    // Dragging the left (top) edge left (up) makes the panel wider (taller).
    const wanted = startSize + (start - (panel === 'bottom' ? e.clientY : e.clientX));
    const { min, max } = this._limits(panel);
    this._setSize(panel, Math.min(max, Math.max(min, wanted)));
  };

  private _onResizeEnd = (e: PointerEvent): void => {
    if (!this._drag) return;
    const { panel } = this._drag;
    this._drag = null;
    (e.currentTarget as Element).classList.remove('dragging');
    remember(panel === 'bottom' ? BOTTOM.heightKey : SIDE_PANELS[panel].key, String(this._size(panel)));
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
    // Defaults also for a bare render (tests): palette shown, Properties open.
    const paletteOpen = this.paletteOpen !== false;
    const tab = this.bottomTab ?? 'properties';
    const folded = this.bottomFolded === true;
    const badges = this.tabBadges ?? {};
    const sizes =
      `--la-palette-column: ${paletteOpen ? `${this.paletteWidth ?? SIDE_PANELS.palette.initial}px` : '0px'}; ` +
      `--la-rdf-column: ${this.rdfOpen ? `${this.rdfWidth}px` : '0px'}; ` +
      `--la-bottom-row: ${folded ? 'auto' : `${this.bottomHeight ?? BOTTOM.initial}px`}`;
    return html`
      <div class="shell ${paletteOpen ? 'palette-open' : ''} ${this.rdfOpen ? 'rdf-open' : ''}" style=${sizes}>
        <div class="panel-toolbar">
          <slot name="toolbar"></slot>
        </div>
        <div class="panel-explorer">
          <slot name="explorer"></slot>
        </div>
        <div class="panel-canvas">
          <slot name="canvas"></slot>
        </div>
        <div class="panel-bottom">
          ${folded ? nothing : resizeHandle('bottom', this._resize)}
          <div class="tabs" role="tablist">
            ${BOTTOM_TABS.map(
              (t) => html`<button
                class="tab"
                role="tab"
                data-tab=${t.id}
                aria-selected=${t.id === tab ? 'true' : 'false'}
                title=${t.id === tab ? (folded ? 'Unfold the panel' : 'Fold the panel') : `Show ${t.label}`}
                @click=${() => this._onTab(t.id)}
              >
                ${t.label}${badges[t.id] ? html`<span class="badge">${badges[t.id]}</span>` : nothing}
              </button>`,
            )}
            <span class="spacer"></span>
            <button
              class="fold"
              title=${folded ? 'Unfold the panel' : 'Fold the panel'}
              aria-label=${folded ? 'Unfold the panel' : 'Fold the panel'}
              @click=${() => this.setBottomFolded(!folded)}
            >
              ${folded ? '▴' : '▾'}
            </button>
          </div>
          <div class="tab-body" ?hidden=${folded}>
            ${BOTTOM_TABS.map(
              (t) => html`<div class="tab-pane" role="tabpanel" data-tab=${t.id} ?hidden=${t.id !== tab}>
                <slot name=${t.id}></slot>
              </div>`,
            )}
          </div>
        </div>
        <div class="panel-palette side">
          ${resizeHandle('palette', this._resize)}
          <div class="side-body"><slot name="palette"></slot></div>
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
