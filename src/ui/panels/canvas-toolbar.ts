import { LitElement, html, css, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { CANVAS_TOOLS, type CanvasTool } from '../canvas/canvas-tools.js';
import { FIGURE_CHOICES, type FigureChoice } from '../figure-bar.js';
import type { SizeReference } from '../../layout/arrange-geometry.js';
import { GRID_DEFAULTS, type GridSettings } from '../arrange-settings.js';
import { LINE_SHAPES, type LineShape } from '../../layout/line-shapes.js';

/**
 * Emitted when a figure's button is pressed or clicked: the start of a gesture
 * that draws it on the canvas, as the palette's entries start an element's.
 */
export interface ToolbarFigureDetail {
  kind: FigureChoice['kind'];
  shapeType?: string;
  sourceEvent: MouseEvent;
}

/**
 * Emitted when the user picks a tool.
 *
 * `sourceEvent` is the raw `click` that triggered it, and it is not optional
 * decoration: diagram-js's global tools are drag-driven, so
 * `GlobalConnect.start(event, autoActivate)` and
 * `LassoTool.activateSelection(event, autoActivate)` seed `Dragging` from that
 * event. Handed `null`, the tool activates with no anchor point and the first
 * gesture is measured from the origin.
 */
export interface ToolbarToolDetail {
  tool: CanvasTool;
  sourceEvent: MouseEvent;
}

/** Arrange view's icon: three boxes in two layers, joined by right-angled lines — what the arrangement draws. */
const ARRANGE_GLYPH = html`<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
  <rect x="5.5" y="1.5" width="5" height="3.5" rx="0.6"></rect>
  <rect x="1" y="11" width="5" height="3.5" rx="0.6"></rect>
  <rect x="10" y="11" width="5" height="3.5" rx="0.6"></rect>
  <path d="M8 5v3M3.5 11V8h9v3"></path>
</svg>`;

/** A quick action's glyph, 16 × 16: a line where things align, boxes for what moves or resizes. */
const glyph = (body: ReturnType<typeof svg>) => html`<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">${body}</svg>`;

/** The arrange options a button does at once, with the settings its dialog last kept (Req 22). */
export type ArrangeQuickAction =
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-top'
  | 'align-middle'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical'
  | 'match-width'
  | 'match-height'
  | 'match-size'
  | 'default-size'
  | 'align-to-grid'
  | 'arrange-relationships';

/** The dialogs the arrange menu opens. */
export type ArrangeDialog = 'view' | 'relationships' | 'grid' | 'sizes';

/** Each line shape's picture (Req 22.9): the line as it runs, a dot at each end. */
const LINE_SHAPE_PATHS: Record<LineShape, string> = {
  straight: 'M2.5 13.5L13.5 2.5',
  'right-angles': 'M2.5 13.5h5v-11h6',
  'horizontal-first': 'M2.5 2.5h11v11',
  'vertical-first': 'M2.5 2.5v11h11',
};
const ENDS: Record<LineShape, [number, number, number, number]> = {
  straight: [2.5, 13.5, 13.5, 2.5],
  'right-angles': [2.5, 13.5, 13.5, 2.5],
  'horizontal-first': [2.5, 2.5, 13.5, 13.5],
  'vertical-first': [2.5, 2.5, 13.5, 13.5],
};
const lineShapeGlyph = (shape: LineShape) => {
  const [x1, y1, x2, y2] = ENDS[shape];
  return glyph(svg`<path d=${LINE_SHAPE_PATHS[shape]}/><circle cx=${x1} cy=${y1} r="1.4" fill="currentColor"/><circle cx=${x2} cy=${y2} r="1.4" fill="currentColor"/>`);
};

interface QuickButton {
  action: ArrangeQuickAction;
  title: string;
  /** How many placements must be selected; 0 acts on the whole view when none are. */
  needs: 0 | 2 | 3;
  glyph: ReturnType<typeof html>;
}

const REFERENCE_WORDS: Record<SizeReference, string> = { largest: 'the largest', smallest: 'the smallest', median: 'the median' };

/** The quick actions, in groups separated on the toolbar. */
function quickButtons(reference: SizeReference, grid: GridSettings): QuickButton[][] {
  const to = REFERENCE_WORDS[reference];
  const axis = grid.axis === 'both' ? '' : grid.axis === 'x' ? ', across' : ', down';
  return [
    [
      { action: 'align-left', title: 'Align left', needs: 2, glyph: glyph(svg`<path d="M1.5 1v14"/><rect x="3.5" y="3" width="10" height="3.5"/><rect x="3.5" y="9.5" width="6" height="3.5"/>`) },
      { action: 'align-center', title: 'Align centre', needs: 2, glyph: glyph(svg`<path d="M8 1v14"/><rect x="3" y="3" width="10" height="3.5"/><rect x="5" y="9.5" width="6" height="3.5"/>`) },
      { action: 'align-right', title: 'Align right', needs: 2, glyph: glyph(svg`<path d="M14.5 1v14"/><rect x="2.5" y="3" width="10" height="3.5"/><rect x="6.5" y="9.5" width="6" height="3.5"/>`) },
      { action: 'align-top', title: 'Align top', needs: 2, glyph: glyph(svg`<path d="M1 1.5h14"/><rect x="3" y="3.5" width="3.5" height="10"/><rect x="9.5" y="3.5" width="3.5" height="6"/>`) },
      { action: 'align-middle', title: 'Align middle', needs: 2, glyph: glyph(svg`<path d="M1 8h14"/><rect x="3" y="3" width="3.5" height="10"/><rect x="9.5" y="5" width="3.5" height="6"/>`) },
      { action: 'align-bottom', title: 'Align bottom', needs: 2, glyph: glyph(svg`<path d="M1 14.5h14"/><rect x="3" y="2.5" width="3.5" height="10"/><rect x="9.5" y="6.5" width="3.5" height="6"/>`) },
    ],
    [
      { action: 'distribute-horizontal', title: 'Distribute horizontally — equal gaps', needs: 3, glyph: glyph(svg`<rect x="1" y="5" width="3" height="6"/><rect x="6.5" y="5" width="3" height="6"/><rect x="12" y="5" width="3" height="6"/><path d="M1 2.5h14" stroke-dasharray="1.5 1.5"/>`) },
      { action: 'distribute-vertical', title: 'Distribute vertically — equal gaps', needs: 3, glyph: glyph(svg`<rect x="5" y="1" width="6" height="3"/><rect x="5" y="6.5" width="6" height="3"/><rect x="5" y="12" width="6" height="3"/><path d="M2.5 1v14" stroke-dasharray="1.5 1.5"/>`) },
    ],
    [
      { action: 'match-width', title: `Match width — to ${to} (Sizes… sets which)`, needs: 2, glyph: glyph(svg`<rect x="2" y="2" width="12" height="4"/><rect x="2" y="10" width="12" height="4"/><path d="M4 8h8M4 8l1.5-1.2M4 8l1.5 1.2M12 8l-1.5-1.2M12 8l-1.5 1.2"/>`) },
      { action: 'match-height', title: `Match height — to ${to} (Sizes… sets which)`, needs: 2, glyph: glyph(svg`<rect x="2" y="2" width="4" height="12"/><rect x="10" y="2" width="4" height="12"/><path d="M8 4v8M8 4l-1.2 1.5M8 4l1.2 1.5M8 12l-1.2-1.5M8 12l1.2-1.5"/>`) },
      { action: 'match-size', title: `Match size — to ${to} (Sizes… sets which)`, needs: 2, glyph: glyph(svg`<rect x="1.5" y="1.5" width="6.5" height="6.5"/><rect x="8" y="8" width="6.5" height="6.5"/>`) },
      { action: 'default-size', title: 'Default size — the selected, or every element of the view', needs: 0, glyph: glyph(svg`<rect x="2" y="4" width="9" height="7"/><path d="M13.5 2.5v4h-4" /><path d="M13.5 6.5l-3 -3" />`) },
    ],
    [
      { action: 'align-to-grid', title: `Align to grid — ${grid.grid} px${axis}; the selected, or the whole view (Align to grid… sets it)`, needs: 0, glyph: glyph(svg`<path d="M1 1h.01M8 1h.01M15 1h.01M1 8h.01M15 8h.01M1 15h.01M8 15h.01M15 15h.01" stroke-width="2" stroke-linecap="round"/><rect x="4" y="4" width="8" height="8"/>`) },
      { action: 'arrange-relationships', title: 'Arrange relationships — route the lines again around the elements, which stay; the selected’s, or the whole view’s', needs: 0, glyph: glyph(svg`<rect x="1" y="1" width="4.5" height="3.5"/><rect x="10.5" y="11.5" width="4.5" height="3.5"/><rect x="5.5" y="6.5" width="4.5" height="3"/><path d="M3.2 4.5v8.7h7.3" stroke-dasharray="none"/>`) },
    ],
  ];
}

/**
 * Toolbar strip above the diagram, holding the canvas's global tools.
 *
 * These three used to live in diagram-js's own in-canvas palette, alongside all
 * 42 element types — which duplicated the sidebar's element list and left two
 * palettes on screen offering the same thing. The element types now belong to the
 * sidebar `palette-panel` (which has the room to group and label them) and the
 * tools belong here, so nothing appears twice and diagram-js's `palette` feature
 * is not registered at all.
 *
 * The buttons are `<button>`s rather than styled `<div>`s so they are reachable
 * and operable from the keyboard for free, and `aria-pressed` reports which tool
 * is armed.
 *
 * After the tools, the format painter and *Arrange view…* (an icon, opening its
 * dialog), with ▾ beside it for the other arrange dialogs — *Arrange relationships…*,
 * *Align to grid…*, *Sizes…* — and then the quick actions (Req 22): align, distribute,
 * match sizes, default size, align to grid, arrange relationships, each acting at
 * once with what its dialog last chose, disabled until the selection
 * (`arrangeSelected`) is big enough. Then *Line shape* (Req 22.9): a button whose menu gives the
 * selected lines a shape — straight, right angles, horizontal or vertical first — disabled until a line
 * is selected (`linesSelected`). Then one switch: *Relationship names*, which shows relationships'
 * names on their lines (off by default; the host remembers it). Pressed is on.
 *
 * Then *Shapes*, which opens a second row: figures drawn with no model element
 * behind them — a group, a sticky note, the core-vis shapes. A figure is pressed
 * and dragged onto the canvas, or clicked and then placed, as a palette entry
 * is. Closed by default; the host remembers it.
 */
@customElement('canvas-toolbar')
export class CanvasToolbar extends LitElement {
  static override styles = css`
    :host {
      display: block;
      flex: 0 0 auto;
      border-bottom: 1px solid #dadce0;
      background: #fafafa;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
    }

    button:disabled {
      opacity: 0.4;
      cursor: default;
      background: #fff;
      border-color: #dadce0;
    }

    /* The arrange menu: a narrow button beside Arrange view, and the dialogs under it. */
    .arrange {
      position: relative;
      display: inline-flex;
    }

    button.menu-toggle {
      width: 14px;
      margin-left: -3px;
      font-size: 9px;
    }

    .menu {
      position: absolute;
      top: 28px;
      left: 0;
      z-index: 10;
      display: flex;
      flex-direction: column;
      min-width: 180px;
      padding: 4px 0;
      background: #fff;
      border: 1px solid #dadce0;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    }

    .menu button {
      justify-content: flex-start;
      gap: 8px;
      width: auto;
      height: 26px;
      padding: 0 12px;
      border: none;
      border-radius: 0;
      font-size: 12px;
      white-space: nowrap;
    }

    /* Line shape: its picture and a caret, a little wider than a tool. */
    button.line-shape {
      width: 36px;
      gap: 2px;
    }

    button.line-shape .caret {
      font-size: 9px;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      background: #fff;
      border: 1px solid #dadce0;
      border-radius: 3px;
      color: #202124;
    }

    button:hover {
      background: #e8f0fe;
      border-color: #1a73e8;
    }

    button[aria-pressed='true'] {
      background: #1a73e8;
      border-color: #1a73e8;
      color: #fff;
    }

    button:focus-visible {
      outline: 2px solid #1a73e8;
      outline-offset: 1px;
    }

    .separator {
      width: 1px;
      height: 18px;
      margin: 0 4px;
      background: #dadce0;
    }

    /* A switch, not a tool: labelled in words, as wide as its label. */
    button.switch {
      width: auto;
      padding: 0 8px;
      font-size: 12px;
    }

    .figures {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 0 6px 4px;
    }

    .figures button {
      width: 30px;
      cursor: grab;
    }

    .figures svg {
      width: 20px;
      height: 16px;
      overflow: visible;
    }
  `;

  /**
   * The tool diagram-js currently has armed, or `undefined` for none.
   *
   * Reported by `ToolManager` rather than inferred from the last click: the tool
   * also deactivates on its own (its gesture completes, or `Escape` cancels it),
   * and a toolbar that tracked its own clicks would keep claiming a tool was
   * active after diagram-js had dropped it.
   */
  @property({ attribute: false })
  activeTool?: CanvasTool;

  /** Whether relationships' names are shown on their lines (the switch's state). */
  @property({ type: Boolean, attribute: false })
  relationshipNames = false;

  /** The format painter: off, picking a look, or giving the picked one (the button's state). */
  @property({ attribute: false })
  formatPainter: 'off' | 'pick' | 'paint' = 'off';

  /** Whether the canvas draws the notation alone, without the look set in the view (the switch's state). */
  @property({ type: Boolean, attribute: false })
  notationOnly = false;

  /** Whether the row of figures is open. */
  @property({ type: Boolean, attribute: false })
  figuresOpen = false;

  /** How many placements are selected, less those in a selected container: what the quick actions may act on. */
  @property({ type: Number, attribute: false })
  arrangeSelected = 0;

  /** What the match buttons match to: *Sizes…*'s last choice. */
  @property({ attribute: false })
  sizeReference: SizeReference = 'largest';

  /** The grid the grid button aligns to: *Align to grid…*'s last choice. */
  @property({ attribute: false })
  grid: GridSettings = GRID_DEFAULTS;

  /** Whether the arrange menu is open. */
  @property({ type: Boolean, attribute: false })
  arrangeMenuOpen = false;

  /** How many selected lines a shape may be given: what *Line shape* acts on. */
  @property({ type: Number, attribute: false })
  linesSelected = 0;

  /** Whether the *Line shape* menu is open. */
  @property({ type: Boolean, attribute: false })
  lineShapeMenuOpen = false;

  private readonly closeMenu = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
    if (!(event instanceof KeyboardEvent) && event.composedPath().includes(this)) return;
    this.arrangeMenuOpen = false;
    this.lineShapeMenuOpen = false;
  };

  /** No line selected any more: its menu closes, in the same update. */
  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('linesSelected') && this.linesSelected === 0) this.lineShapeMenuOpen = false;
  }

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has('arrangeMenuOpen') && !changed.has('lineShapeMenuOpen')) return;
    if (this.arrangeMenuOpen || this.lineShapeMenuOpen) {
      document.addEventListener('pointerdown', this.closeMenu, true);
      document.addEventListener('keydown', this.closeMenu, true);
    } else {
      document.removeEventListener('pointerdown', this.closeMenu, true);
      document.removeEventListener('keydown', this.closeMenu, true);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.closeMenu, true);
    document.removeEventListener('keydown', this.closeMenu, true);
  }

  /** A dialog picked from the arrange menu: `arrange-view`, or `arrange-dialog` with `{ dialog }`. */
  private _onArrangeDialog(dialog: ArrangeDialog): void {
    this.arrangeMenuOpen = false;
    if (dialog === 'view') {
      this.dispatchEvent(new CustomEvent('arrange-view', { bubbles: true, composed: true }));
      return;
    }
    this.dispatchEvent(new CustomEvent<{ dialog: ArrangeDialog }>('arrange-dialog', { detail: { dialog }, bubbles: true, composed: true }));
  }

  /** A shape picked from the *Line shape* menu: `line-shape` with `{ shape }`. */
  private _onLineShape(shape: LineShape): void {
    this.lineShapeMenuOpen = false;
    this.dispatchEvent(new CustomEvent<{ shape: LineShape }>('line-shape', { detail: { shape }, bubbles: true, composed: true }));
  }

  /** A quick action: `arrange-quick` with `{ action }`. */
  private _onQuick(action: ArrangeQuickAction): void {
    this.dispatchEvent(new CustomEvent<{ action: ArrangeQuickAction }>('arrange-quick', { detail: { action }, bubbles: true, composed: true }));
  }

  /** The *Shapes* switch flipped: `figures-open` with `{ open }`. */
  private _onFiguresClick(): void {
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>('figures-open', { detail: { open: !this.figuresOpen }, bubbles: true, composed: true }),
    );
  }

  /** A figure pressed or clicked — the primary button only, as the palette's entries. */
  private _onFigure(choice: FigureChoice, event: MouseEvent): void {
    if (event.button !== 0) return;
    this.dispatchEvent(
      new CustomEvent<ToolbarFigureDetail>('figure-drag-start', {
        detail: { kind: choice.kind, ...(choice.shapeType ? { shapeType: choice.shapeType } : {}), sourceEvent: event },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** The "Notation only" switch flipped: `notation-only` with `{ on }`. */
  private _onNotationOnlyClick(): void {
    this.dispatchEvent(
      new CustomEvent<{ on: boolean }>('notation-only', {
        detail: { on: !this.notationOnly },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** The "Relationship names" switch flipped: `relationship-names` with `{ shown }`. */
  private _onNamesClick(): void {
    this.dispatchEvent(
      new CustomEvent<{ shown: boolean }>('relationship-names', {
        detail: { shown: !this.relationshipNames },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onClick(tool: CanvasTool, event: MouseEvent): void {
    this.dispatchEvent(
      new CustomEvent<ToolbarToolDetail>('toolbar-tool', {
        detail: { tool, sourceEvent: event },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="toolbar" role="toolbar" aria-label="Diagram tools">
        ${CANVAS_TOOLS.map(
          (info) => html`
            <button
              type="button"
              title=${info.title}
              aria-label=${info.title}
              aria-pressed=${this.activeTool === info.tool ? 'true' : 'false'}
              data-tool=${info.tool}
              @click=${(event: MouseEvent) => this._onClick(info.tool, event)}
            >
              ${info.glyph}
            </button>
          `,
        )}
        <button
          type="button"
          data-action="format-painter"
          title=${this.formatPainter === 'off'
            ? 'Format painter — click what to copy the look of, then what to give it to; Esc to stop'
            : this.formatPainter === 'pick'
              ? 'Format painter: click what to copy the look of (Esc or here to stop)'
              : 'Format painter: click what to give the look to (Esc or here to stop)'}
          aria-label="Format painter"
          aria-pressed=${this.formatPainter === 'off' ? 'false' : 'true'}
          data-state=${this.formatPainter}
          @click=${() => this.dispatchEvent(new CustomEvent('format-painter', { bubbles: true, composed: true }))}
        >
          \u{1F58C}
        </button>
        <button
          type="button"
          data-action="arrange-view"
          title="Arrange view… — lay out the diagram's elements, or the selected ones, in layers with right-angled lines"
          aria-label="Arrange view…"
          @click=${() => this.dispatchEvent(new CustomEvent('arrange-view', { bubbles: true, composed: true }))}
        >
          ${ARRANGE_GLYPH}
        </button>
        <span class="arrange">
          <button
            type="button"
            class="menu-toggle"
            data-action="arrange-menu"
            title="More ways to arrange: relationships only, to a grid, sizes"
            aria-label="Arrange"
            aria-haspopup="menu"
            aria-expanded=${this.arrangeMenuOpen ? 'true' : 'false'}
            @click=${() => {
              this.arrangeMenuOpen = !this.arrangeMenuOpen;
              this.lineShapeMenuOpen = false;
            }}
          >
            ▾
          </button>
          ${this.arrangeMenuOpen
            ? html`<div class="menu" role="menu" aria-label="Arrange">
                ${(
                  [
                    ['view', 'arrange-view', 'Arrange view…'],
                    ['relationships', 'arrange-relationships', 'Arrange relationships…'],
                    ['grid', 'align-to-grid', 'Align to grid…'],
                    ['sizes', 'sizes', 'Sizes…'],
                  ] as const
                ).map(
                  ([dialog, action, label]) => html`<button type="button" role="menuitem" data-menu=${action} @click=${() => this._onArrangeDialog(dialog)}>
                    ${label}
                  </button>`,
                )}
              </div>`
            : nothing}
        </span>
        ${quickButtons(this.sizeReference, this.grid).map(
          (group) => html`<span class="separator" aria-hidden="true"></span>
            ${group.map(
              (quick) => html`<button
                type="button"
                data-quick=${quick.action}
                title=${quick.title}
                aria-label=${quick.title.split(' — ')[0]}
                ?disabled=${quick.needs > 0 && this.arrangeSelected < quick.needs}
                @click=${() => this._onQuick(quick.action)}
              >
                ${quick.glyph}
              </button>`,
            )}`,
        )}
        <span class="arrange">
          <button
            type="button"
            class="line-shape"
            data-action="line-shape-menu"
            title="Line shape — give the selected lines a shape: straight, right angles, horizontal or vertical first"
            aria-label="Line shape"
            aria-haspopup="menu"
            aria-expanded=${this.lineShapeMenuOpen ? 'true' : 'false'}
            ?disabled=${this.linesSelected === 0}
            @click=${() => {
              this.lineShapeMenuOpen = !this.lineShapeMenuOpen;
              this.arrangeMenuOpen = false;
            }}
          >
            ${lineShapeGlyph('horizontal-first')}<span class="caret" aria-hidden="true">▾</span>
          </button>
          ${this.lineShapeMenuOpen && this.linesSelected > 0
            ? html`<div class="menu" role="menu" aria-label="Line shape">
                ${LINE_SHAPES.map(
                  ({ shape, label, title }) => html`<button
                    type="button"
                    role="menuitem"
                    data-line-shape=${shape}
                    title=${title}
                    @click=${() => this._onLineShape(shape)}
                  >
                    ${lineShapeGlyph(shape)}<span>${label}</span>
                  </button>`,
                )}
              </div>`
            : nothing}
        </span>
        <span class="separator" aria-hidden="true"></span>
        <button
          type="button"
          class="switch"
          data-switch="relationship-names"
          title="Show relationships’ names on their lines"
          aria-pressed=${this.relationshipNames ? 'true' : 'false'}
          @click=${() => this._onNamesClick()}
        >
          Relationship names
        </button>
        <button
          type="button"
          class="switch"
          data-switch="notation-only"
          title="Draw every element and relationship as its notation does, leaving out the colours, fonts and lines set on it in the view"
          aria-pressed=${this.notationOnly ? 'true' : 'false'}
          @click=${() => this._onNotationOnlyClick()}
        >
          Notation only
        </button>
        <button
          type="button"
          class="switch"
          data-switch="figures"
          title="Groups, notes and shapes: drawing with no model element behind it"
          aria-expanded=${this.figuresOpen ? 'true' : 'false'}
          @click=${() => this._onFiguresClick()}
        >
          Shapes ${this.figuresOpen ? '▾' : '▸'}
        </button>
      </div>
      ${this.figuresOpen
        ? html`<div class="figures" role="toolbar" aria-label="Shapes and notes">
            ${FIGURE_CHOICES.map(
              (choice) => html`
                <button
                  type="button"
                  title=${`${choice.label} — drag onto the diagram, or click and place it`}
                  aria-label=${choice.label}
                  data-figure=${choice.shapeType ? choice.shapeType.split('#').pop()! : choice.kind}
                  @mousedown=${(event: MouseEvent) => this._onFigure(choice, event)}
                  @click=${(event: MouseEvent) => this._onFigure(choice, event)}
                >
                  ${figureGlyph(choice)}
                </button>
              `,
            )}
          </div>`
        : nothing}
    `;
  }
}

/** A small drawing of a figure, for its button. */
function figureGlyph(choice: FigureChoice) {
  const stroke = 'currentColor';
  const body = (() => {
    if (choice.kind === 'group') {
      return svg`<rect x="1" y="1" width="9" height="4" fill="none" stroke=${stroke} /><rect x="1" y="5" width="18" height="10" fill="none" stroke=${stroke} />`;
    }
    if (choice.kind === 'note') {
      return svg`<path d="M1,1 H14 L19,6 V15 H1 Z" fill="#fff7b3" stroke=${stroke} /><path d="M14,1 V6 H19" fill="none" stroke=${stroke} />`;
    }
    switch (choice.shapeType?.split('#').pop()) {
      case 'RoundedRectangle':
        return svg`<rect x="1" y="2" width="18" height="12" rx="4" fill="none" stroke=${stroke} />`;
      case 'Ellipse':
        return svg`<ellipse cx="10" cy="8" rx="9" ry="6" fill="none" stroke=${stroke} />`;
      case 'Circle':
        return svg`<circle cx="10" cy="8" r="7" fill="none" stroke=${stroke} />`;
      case 'Diamond':
        return svg`<path d="M10,1 L19,8 L10,15 L1,8 Z" fill="none" stroke=${stroke} />`;
      case 'Hexagon':
        return svg`<path d="M5,1 H15 L19,8 L15,15 H5 L1,8 Z" fill="none" stroke=${stroke} />`;
      case 'Octagon':
        return svg`<path d="M6,1 H14 L19,5 V11 L14,15 H6 L1,11 V5 Z" fill="none" stroke=${stroke} />`;
      case 'Parallelogram':
        return svg`<path d="M5,1 H19 L15,15 H1 Z" fill="none" stroke=${stroke} />`;
      default:
        return svg`<rect x="1" y="2" width="18" height="12" fill="none" stroke=${stroke} />`;
    }
  })();
  return html`<svg viewBox="0 0 20 16" aria-hidden="true">${body}</svg>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'canvas-toolbar': CanvasToolbar;
  }
}
