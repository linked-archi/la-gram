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
 * - property-panel (right sidebar)
 * - validation (bottom bar)
 */
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
      grid-template-columns: 250px 1fr 300px;
      grid-template-rows: auto 1fr 1fr 190px;
      grid-template-areas:
        "toolbar   toolbar toolbar"
        "palette   canvas  property"
        "explorer  canvas  property"
        "explorer  validation validation";
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .panel-toolbar   { grid-area: toolbar; }
    .panel-palette   { grid-area: palette; overflow: auto; }
    .panel-canvas    { grid-area: canvas; overflow: hidden; }
    .panel-property  { grid-area: property; overflow: auto; }
    .panel-explorer  { grid-area: explorer; overflow: auto; }
    .panel-validation { grid-area: validation; overflow: auto; }
  `;

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
    return html`
      <div class="shell">
        <div class="panel-toolbar">
          <slot name="toolbar"></slot>
        </div>
        <div class="panel-palette">
          <slot name="palette"></slot>
        </div>
        <div class="panel-canvas">
          <slot name="canvas"></slot>
        </div>
        <div class="panel-property">
          <slot name="property-panel"></slot>
        </div>
        <div class="panel-explorer">
          <slot name="explorer"></slot>
        </div>
        <div class="panel-validation">
          <slot name="validation"></slot>
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
