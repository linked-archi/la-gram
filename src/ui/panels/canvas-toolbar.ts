import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { CANVAS_TOOLS, type CanvasTool } from '../canvas/canvas-tools.js';

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
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'canvas-toolbar': CanvasToolbar;
  }
}
