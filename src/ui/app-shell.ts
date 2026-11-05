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
 * │  tree)   │ [Properties|Validation|SPARQL|Graph]  │  until │
 * │          │ bottom panel                │         │ opened)│
 * └──────────┴─────────────────────────────┴─────────┴────────┘
 * ```
 *
 * - toolbar (top bar: file, metamodels, views, collaboration)
 * - explorer (left, full height: the model tree) over the `guide` slot — what
 *   the metamodel says about the selected type — which folds to its header and
 *   is resized by its top edge
 * - canvas (centre)
 * - bottom panel under the canvas: tabs over the `properties`, `validation`,
 *   `sparql` and `graph` slots; resizable by its top edge, folded to its tabs by clicking
 *   the open tab, and maximized over the whole workspace (⤢; Esc or ⤡ restores)
 * - palette (right) — shown by default, can be hidden
 * - rdf (far right, full height: the model as RDF) — hidden until opened, and
 *   maximized over the whole workspace from its header (`rdf-maximize-toggle`;
 *   Esc or ⤡ restores); one panel is maximized at a time
 *
 * The model tree and the two right-hand panels are *side panels*: each can be
 * shown or hidden, and resized by dragging its inner edge (the tree's right,
 * the others' left). Sizes, the open tab and whether the bottom panel is
 * folded are remembered per browser.
 *
 * Maximizing lays the bottom panel over the other panels rather than removing
 * them, so the canvas keeps its size and state underneath; the covered panels
 * are inert meanwhile.
 */

/** A resizable, hideable panel beside the canvas. */
export type SidePanel = 'explorer' | 'palette' | 'rdf';

/** A tab of the bottom panel: la-gram's own, or one a module added (by its id). */
export type BottomTab = 'properties' | 'validation' | 'sparql' | 'graph' | 'history' | (string & {});

/** The bottom panel's tabs, in order. */
export const BOTTOM_TABS: ReadonlyArray<{ id: BottomTab; label: string }> = [
  { id: 'properties', label: 'Properties' },
  { id: 'validation', label: 'Validation' },
  { id: 'sparql', label: 'SPARQL Query' },
  { id: 'graph', label: 'Graph' },
  { id: 'history', label: 'History' },
];

/** Width limits, the localStorage key and the side of each side panel. */
const SIDE_PANELS: Record<SidePanel, { key: string; initial: number; min: number; side: 'left' | 'right' }> = {
  explorer: { key: 'la-gram:explorer-panel-width', initial: 260, min: 160, side: 'left' },
  palette: { key: 'la-gram:palette-panel-width', initial: 250, min: 180, side: 'right' },
  rdf: { key: 'la-gram:rdf-panel-width', initial: 440, min: 280, side: 'right' },
};

/** Height limits and localStorage keys of the bottom panel. */
const BOTTOM = {
  heightKey: 'la-gram:bottom-panel-height',
  tabKey: 'la-gram:bottom-panel-tab',
  foldedKey: 'la-gram:bottom-panel-folded',
  initial: 280,
  min: 120,
};

/** Height limits and localStorage keys of the guide under the model tree. */
const GUIDE = {
  heightKey: 'la-gram:guide-height',
  foldedKey: 'la-gram:guide-folded',
  initial: 300,
  min: 90,
  /** Room kept for the tree above it. */
  treeMin: 120,
};

/** What a drag handle resizes. */
type Resizable = SidePanel | 'bottom' | 'guide';

/** Resized by a horizontal edge (height), not a vertical one (width). */
function isVertical(panel: Resizable): panel is 'bottom' | 'guide' {
  return panel === 'bottom' || panel === 'guide';
}

/** Room kept for the canvas when a side panel is dragged wide. */
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

/** A drag handle: on a side panel's inner edge, or the bottom panel's or the guide's top edge. */
function resizeHandle(panel: Resizable, on: ResizeHandlers = {}) {
  const edge = isVertical(panel) ? 'horizontal' : SIDE_PANELS[panel].side === 'left' ? 'vertical at-right' : 'vertical';
  return html`<div
    class="resizer ${edge}"
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
      /* Side panel columns are 0 wide while hidden; see explorerOpen / paletteOpen / rdfOpen. */
      grid-template-columns: var(--la-explorer-column, 260px) minmax(0, 1fr) var(--la-palette-column, 250px) var(--la-rdf-column, 0px);
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
    .panel-explorer  { grid-area: explorer; }
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
    .panel-explorer.side {
      border-left: 0;
      border-right: 1px solid #dadce0;
    }
    /* The tree over the guide; the tree takes what the guide leaves. */
    .explorer-column {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .explorer-tree {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }
    .explorer-guide {
      flex: 0 0 auto;
      position: relative;
      min-height: 0;
    }
    .explorer-guide ::slotted(*) {
      height: 100%;
    }
    .shell.explorer-open .panel-explorer,
    .shell.palette-open .panel-palette,
    .shell.rdf-open .panel-rdf { display: block; }
    /* The tree and the palette scroll inside, so their resize handles stay put. */
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
    .fold[data-action='maximize'] {
      font-size: 16px;
      padding: 0 8px;
    }
    .fold[data-action='maximize'][aria-pressed='true'] {
      color: #1a73e8;
    }

    /* ── Maximized: the bottom panel, or the RDF panel, over the workspace ── */
    .shell.bottom-maximized .panel-bottom {
      grid-row: 2 / 4;
      grid-column: 1 / -1;
      z-index: 10;
      border-top: 0;
    }
    .shell.rdf-maximized .panel-rdf {
      grid-row: 2 / 4;
      grid-column: 1 / -1;
      z-index: 10;
      border-left: 0;
      background: #fff;
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
    .resizer.vertical.at-right {
      left: auto;
      right: 0;
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

  /** Whether the model tree (left) is shown. Shown by default. */
  @property({ type: Boolean, reflect: true }) explorerOpen = true;

  /** Width of the model tree in pixels; dragged with its right edge. */
  @property({ type: Number }) explorerWidth = storedSize(
    SIDE_PANELS.explorer.key,
    SIDE_PANELS.explorer.initial,
    SIDE_PANELS.explorer.min,
  );

  /** Whether the guide under the tree is folded to its header; remembered. */
  @property({ type: Boolean, reflect: true }) guideFolded = stored(GUIDE.foldedKey) === 'true';

  /** Height of the guide under the tree, unfolded; dragged with its top edge. */
  @property({ type: Number }) guideHeight = storedSize(GUIDE.heightKey, GUIDE.initial, GUIDE.min);

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

  /** Whether the RDF panel covers the workspace (not remembered: a reload starts restored). */
  @property({ type: Boolean, reflect: true }) rdfMaximized = false;

  /** Width of the RDF panel in pixels; dragged with its left edge. */
  @property({ type: Number }) rdfWidth = storedSize(SIDE_PANELS.rdf.key, SIDE_PANELS.rdf.initial, SIDE_PANELS.rdf.min);

  /** The bottom panel's open tab; the last one opened, per browser. */
  @property({ type: String, reflect: true }) bottomTab: BottomTab =
    BOTTOM_TABS.find((t) => t.id === stored(BOTTOM.tabKey))?.id ?? 'properties';

  /** Whether the bottom panel is folded down to its tabs. */
  @property({ type: Boolean, reflect: true }) bottomFolded = stored(BOTTOM.foldedKey) === 'true';

  /** Height of the bottom panel in pixels (unfolded); dragged with its top edge. */
  @property({ type: Number }) bottomHeight = storedSize(BOTTOM.heightKey, BOTTOM.initial, BOTTOM.min);

  /** Whether the bottom panel covers the workspace (not remembered: a reload starts restored). */
  @property({ type: Boolean, reflect: true }) bottomMaximized = false;

  /** A small count on a tab (the violations on Validation); none when absent. */
  @property({ attribute: false }) tabBadges: Partial<Record<BottomTab, string>> = {};

  /** Tabs modules added, after la-gram's own (`MountedUi.addBottomTab`); each fills the slot named by its id. */
  @property({ attribute: false }) moduleTabs: ReadonlyArray<{ id: string; label: string }> = [];

  private _drag: { panel: Resizable; start: number; startSize: number } | null = null;

  /** Open a tab of the bottom panel, unfolding it; the choice is remembered. */
  showTab(tab: BottomTab): void {
    this.bottomTab = tab;
    this.bottomFolded = false;
    remember(BOTTOM.tabKey, tab);
    remember(BOTTOM.foldedKey, 'false');
    this.dispatchEvent(new CustomEvent('bottom-tab-changed', { detail: { tab }, bubbles: true, composed: true }));
    this._panelChanged();
  }

  /** Fold the bottom panel down to its tabs, or unfold it; remembered. Folding also restores it. */
  setBottomFolded(folded: boolean): void {
    this.bottomFolded = folded;
    if (folded) this.bottomMaximized = false;
    remember(BOTTOM.foldedKey, String(folded));
    this._panelChanged();
  }

  /** Fold the guide under the tree to its header, or unfold it; remembered. */
  setGuideFolded(folded: boolean): void {
    this.guideFolded = folded;
    remember(GUIDE.foldedKey, String(folded));
    this.dispatchEvent(new CustomEvent('guide-panel-changed', { detail: { folded }, bubbles: true, composed: true }));
  }

  /** Lay the bottom panel over the whole workspace, or put it back; maximizing unfolds it. */
  setBottomMaximized(maximized: boolean): void {
    if (maximized === this.bottomMaximized && (!maximized || !this.bottomFolded)) return;
    if (maximized) this.setRdfMaximized(false);
    this.bottomMaximized = maximized;
    if (maximized && this.bottomFolded) {
      this.bottomFolded = false;
      remember(BOTTOM.foldedKey, 'false');
    }
    this._panelChanged();
  }

  /** Lay the RDF panel over the whole workspace, or put it back; only while it is shown. */
  setRdfMaximized(maximized: boolean): void {
    const next = maximized && this.rdfOpen;
    if (next === this.rdfMaximized) return;
    if (next) this.setBottomMaximized(false);
    this.rdfMaximized = next;
    this.dispatchEvent(new CustomEvent('rdf-panel-changed', { detail: { maximized: next }, bubbles: true, composed: true }));
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Hiding the RDF panel puts it back too.
    if (changed.has('rdfOpen') && !this.rdfOpen && this.rdfMaximized) this.setRdfMaximized(false);
  }

  /** Esc restores a maximized panel — unless a dialog or a menu took the key first. */
  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !(this.bottomMaximized || this.rdfMaximized) || e.defaultPrevented) return;
    if (document.querySelector('.la-dialog, .djs-popup')) return;
    if (this.rdfMaximized) this.setRdfMaximized(false);
    else this.setBottomMaximized(false);
  };

  /** Which bottom tab is showing, if any — for panels that work only while seen. */
  get visibleBottomTab(): BottomTab | undefined {
    return this.bottomFolded ? undefined : this.bottomTab;
  }

  /** Tell the host the bottom panel's visible tab, or its size, may have changed. */
  private _panelChanged(): void {
    this.dispatchEvent(
      new CustomEvent('bottom-panel-changed', {
        detail: { tab: this.visibleBottomTab, maximized: this.bottomMaximized },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** A click on a tab: the open one folds or unfolds the panel, another opens. */
  private _onTab(tab: BottomTab): void {
    if (tab === this.bottomTab) this.setBottomFolded(!this.bottomFolded);
    else this.showTab(tab);
  }

  private _size(panel: Resizable): number {
    switch (panel) {
      case 'guide':
        return this.guideHeight;
      case 'explorer':
        return this.explorerWidth;
      case 'palette':
        return this.paletteWidth;
      case 'rdf':
        return this.rdfWidth;
      default:
        return this.bottomHeight;
    }
  }

  private _setSize(panel: Resizable, size: number): void {
    if (panel === 'guide') this.guideHeight = size;
    else if (panel === 'explorer') this.explorerWidth = size;
    else if (panel === 'palette') this.paletteWidth = size;
    else if (panel === 'rdf') this.rdfWidth = size;
    else this.bottomHeight = size;
  }

  private _isOpen(panel: SidePanel): boolean {
    return panel === 'explorer' ? this.explorerOpen : panel === 'palette' ? this.paletteOpen : this.rdfOpen;
  }

  /** How small and how large a panel may be dragged; the canvas keeps some room. */
  private _limits(panel: Resizable): { min: number; max: number } {
    if (panel === 'guide') {
      const column = this.renderRoot.querySelector<HTMLElement>('.explorer-column')?.clientHeight || (globalThis.innerHeight ?? 900) - TOOLBAR;
      return { min: GUIDE.min, max: Math.max(GUIDE.min, column - GUIDE.treeMin) };
    }
    if (panel === 'bottom') {
      const room = (globalThis.innerHeight ?? 900) - TOOLBAR - MIN_CANVAS_HEIGHT;
      return { min: BOTTOM.min, max: Math.max(BOTTOM.min, room) };
    }
    const others = (Object.keys(SIDE_PANELS) as SidePanel[]).filter((p) => p !== panel && this._isOpen(p));
    const room = (globalThis.innerWidth ?? 1600) - MIN_CANVAS - others.reduce((sum, p) => sum + this._size(p), 0);
    return { min: SIDE_PANELS[panel].min, max: Math.max(SIDE_PANELS[panel].min, room) };
  }

  private _onResizeStart = (e: PointerEvent): void => {
    const handle = e.currentTarget as HTMLElement;
    const panel = handle.dataset['panel'] as Resizable;
    e.preventDefault();
    this._drag = { panel, start: isVertical(panel) ? e.clientY : e.clientX, startSize: this._size(panel) };
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('dragging');
  };

  private _onResizeMove = (e: PointerEvent): void => {
    if (!this._drag) return;
    const { panel, start, startSize } = this._drag;
    // Dragging the left (top) edge left (up) makes the panel wider (taller);
    // the tree's edge is on its right, so dragging it right does.
    const moved = (isVertical(panel) ? e.clientY : e.clientX) - start;
    const wanted = startSize + (!isVertical(panel) && SIDE_PANELS[panel].side === 'left' ? moved : -moved);
    const { min, max } = this._limits(panel);
    this._setSize(panel, Math.min(max, Math.max(min, wanted)));
  };

  private _onResizeEnd = (e: PointerEvent): void => {
    if (!this._drag) return;
    const { panel } = this._drag;
    this._drag = null;
    (e.currentTarget as Element).classList.remove('dragging');
    const key = panel === 'bottom' ? BOTTOM.heightKey : panel === 'guide' ? GUIDE.heightKey : SIDE_PANELS[panel].key;
    remember(key, String(this._size(panel)));
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
    globalThis.addEventListener?.('keydown', this._onKeyDown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const evt of AppShell.WATCHED_EVENTS) {
      this.eventBus.off(evt, this._onModelChange);
    }
    globalThis.removeEventListener?.('keydown', this._onKeyDown);
  }

  private _onModelChange = (_event: ModelEvent): void => {
    this.requestUpdate();
  };

  override render() {
    // Defaults also for a bare render (tests): tree and palette shown, Properties open.
    const explorerOpen = this.explorerOpen !== false;
    const paletteOpen = this.paletteOpen !== false;
    const tab = this.bottomTab ?? 'properties';
    const folded = this.bottomFolded === true;
    const maximized = this.bottomMaximized === true && !folded;
    const rdfMaximized = this.rdfMaximized === true && this.rdfOpen;
    // Whatever a maximized panel covers is out of reach until it is restored.
    const covered = maximized || rdfMaximized;
    const guideFolded = this.guideFolded === true;
    const badges = this.tabBadges ?? {};
    const sizes =
      `--la-explorer-column: ${explorerOpen ? `${this.explorerWidth ?? SIDE_PANELS.explorer.initial}px` : '0px'}; ` +
      `--la-palette-column: ${paletteOpen ? `${this.paletteWidth ?? SIDE_PANELS.palette.initial}px` : '0px'}; ` +
      `--la-rdf-column: ${this.rdfOpen ? `${this.rdfWidth}px` : '0px'}; ` +
      `--la-bottom-row: ${folded ? 'auto' : `${this.bottomHeight ?? BOTTOM.initial}px`}`;
    return html`
      <div
        class="shell ${explorerOpen ? 'explorer-open' : ''} ${paletteOpen ? 'palette-open' : ''} ${this.rdfOpen ? 'rdf-open' : ''} ${maximized ? 'bottom-maximized' : ''} ${rdfMaximized ? 'rdf-maximized' : ''}"
        style=${sizes}
      >
        <div class="panel-toolbar">
          <slot name="toolbar"></slot>
        </div>
        <div class="panel-explorer side" ?inert=${covered}>
          ${resizeHandle('explorer', this._resize)}
          <div class="explorer-column">
            <div class="explorer-tree"><slot name="explorer"></slot></div>
            <div
              class="explorer-guide"
              style=${guideFolded ? 'height: auto' : `height: ${this.guideHeight ?? GUIDE.initial}px`}
              @guide-fold-toggle=${() => this.setGuideFolded(!guideFolded)}
            >
              ${guideFolded ? nothing : resizeHandle('guide', this._resize)}
              <slot name="guide"></slot>
            </div>
          </div>
        </div>
        <div class="panel-canvas" ?inert=${covered}>
          <slot name="canvas"></slot>
        </div>
        <div class="panel-bottom" ?inert=${rdfMaximized}>
          ${folded || maximized ? nothing : resizeHandle('bottom', this._resize)}
          <div class="tabs" role="tablist">
            ${[...BOTTOM_TABS, ...(this.moduleTabs ?? [])].map(
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
            <span class="spacer" title="Double-click to maximize or restore" @dblclick=${() => this.setBottomMaximized(!maximized)}></span>
            <button
              class="fold"
              data-action="maximize"
              title=${maximized ? 'Restore the panel (Esc)' : 'Maximize the panel over the workspace'}
              aria-label=${maximized ? 'Restore the panel' : 'Maximize the panel'}
              aria-pressed=${maximized ? 'true' : 'false'}
              @click=${() => this.setBottomMaximized(!maximized)}
            >
              ${maximized ? '⤡' : '⤢'}
            </button>
            <button
              class="fold"
              data-action="fold"
              title=${folded ? 'Unfold the panel' : 'Fold the panel'}
              aria-label=${folded ? 'Unfold the panel' : 'Fold the panel'}
              @click=${() => this.setBottomFolded(!folded)}
            >
              ${folded ? '▴' : '▾'}
            </button>
          </div>
          <div class="tab-body" ?hidden=${folded}>
            ${[...BOTTOM_TABS, ...(this.moduleTabs ?? [])].map(
              (t) => html`<div class="tab-pane" role="tabpanel" data-tab=${t.id} ?hidden=${t.id !== tab}>
                <slot name=${t.id}></slot>
              </div>`,
            )}
          </div>
        </div>
        <div class="panel-palette side" ?inert=${covered}>
          ${resizeHandle('palette', this._resize)}
          <div class="side-body"><slot name="palette"></slot></div>
        </div>
        <div class="panel-rdf side" ?inert=${maximized} @rdf-maximize-toggle=${() => this.setRdfMaximized(!rdfMaximized)}>
          ${rdfMaximized ? nothing : resizeHandle('rdf', this._resize)}
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
