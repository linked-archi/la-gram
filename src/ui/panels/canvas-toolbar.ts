import { LitElement, html, css, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { CANVAS_TOOLS, type CanvasTool } from '../canvas/canvas-tools.js';
import { FIGURE_CHOICES, type FigureChoice } from '../figure-bar.js';

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
 * After the tools, one switch: *Relationship names*, which shows relationships'
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
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
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
