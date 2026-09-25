/**
 * App toolbar — the bar across the top.
 *
 * ```
 * la-gram │ Order Platform ● │ File ▾  Metamodels ▾ │ View: [Main ▾] [+] Viewpoint: [— ▾] │ Presentation: [Architect ▾] │ ◉ room · 2
 * ```
 *
 * Purely presentational: every pick is a `toolbar-command` event
 * (`{ command, value? }`) that `mount-ui` executes. The state it shows is set
 * as properties by `mount-ui` whenever the model, the views or the loaded
 * metamodels change.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ViewInfo } from '../../model-manager/interfaces.js';
import {
  CATALOGUE_KIND_LABELS,
  type CatalogueEntry,
} from '../../metamodel-manager/catalogue.js';
import { MODEL_FORMATS } from '../../import-export/model-io.js';

/** Commands the toolbar can issue. */
export type ToolbarCommand =
  | 'new-model'
  | 'open-model'
  | 'save'
  | 'save-as'
  | 'save-no-geometry'
  | 'import-archimate'
  | 'export-svg'
  | 'export-png'
  | 'rename-model'
  | 'model-settings'
  | 'open-view'
  | 'new-view'
  | 'set-viewpoint'
  | 'add-metamodel'
  | 'switch-metamodel'
  | 'unload-metamodel'
  | 'load-metamodel-iri'
  | 'upload-asset'
  | 'show-assets'
  | 'set-context'
  | 'share'
  | 'undo'
  | 'redo'
  | 'toggle-properties'
  | 'toggle-rdf';

/** Detail of `toolbar-command`. */
export interface ToolbarCommandDetail {
  command: ToolbarCommand;
  value?: string;
}

/** A labelled IRI for a selector. */
export interface LabelledIri {
  iri: string;
  label: string;
}

/** Collaboration state as the toolbar shows it. */
export interface CollabIndicator {
  status: 'off' | 'connecting' | 'connected' | 'disconnected';
  room?: string;
  peers: Array<{ name: string; color: string }>;
}

@customElement('app-toolbar')
export class AppToolbar extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 40px;
      padding: 0 10px;
      background: #fff;
      border-bottom: 1px solid #dadce0;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      box-sizing: border-box;
      position: relative;
      z-index: 20;
    }
    .brand {
      font-weight: 700;
      color: #1a73e8;
      letter-spacing: 0.02em;
    }
    .sep {
      width: 1px;
      height: 22px;
      background: #e0e0e0;
      margin: 0 4px;
    }
    .model-name {
      border: 0;
      background: none;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .model-name:hover {
      background: #f1f3f4;
    }
    .dirty {
      color: #e37400;
      margin-left: 2px;
    }
    .menu-wrap {
      position: relative;
    }
    button.menu-button,
    button.icon {
      border: 1px solid transparent;
      background: none;
      font: inherit;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      color: #3c4043;
    }
    button.menu-button:hover,
    button.icon:hover,
    button.menu-button.open {
      background: #f1f3f4;
    }
    .dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 2px;
      background: #fff;
      border: 1px solid #dadce0;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
      padding: 4px 0;
      min-width: 240px;
      max-height: 70vh;
      overflow: auto;
    }
    .dropdown button {
      display: flex;
      justify-content: space-between;
      width: 100%;
      text-align: left;
      border: 0;
      background: none;
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
      gap: 12px;
    }
    .dropdown button:hover {
      background: #eef3fd;
    }
    .dropdown button:disabled {
      color: #9aa0a6;
      cursor: default;
      background: none;
    }
    .dropdown .group {
      padding: 6px 14px 2px;
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .dropdown hr {
      border: 0;
      border-top: 1px solid #eee;
      margin: 4px 0;
    }
    .hint {
      color: #80868b;
      font-size: 11px;
    }
    label.field {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #5f6368;
    }
    select {
      font: inherit;
      padding: 2px 4px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      max-width: 200px;
      background: #fff;
    }
    .spacer {
      flex: 1 1 auto;
    }
    button.toggle {
      border: 1px solid #dadce0;
      background: #fff;
      font: inherit;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 4px;
      cursor: pointer;
      color: #3c4043;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    button.toggle:hover {
      background: #f1f3f4;
    }
    button.toggle[aria-pressed='true'] {
      background: #e8f0fe;
      border-color: #1a73e8;
      color: #1a73e8;
    }
    .collab {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #5f6368;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
    }
    .collab:hover {
      background: #f1f3f4;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9aa0a6;
    }
    .dot.connected {
      background: #188038;
    }
    .dot.connecting {
      background: #f9ab00;
    }
    .dot.disconnected {
      background: #d93025;
    }
    .peer {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: -4px;
      border: 2px solid #fff;
    }
  `;

  @property({ type: String }) modelLabel = 'Untitled model';
  @property({ type: Boolean }) dirty = false;
  @property({ attribute: false }) views: ViewInfo[] = [];
  @property({ type: String }) activeViewIri = '';
  @property({ attribute: false }) viewpoints: LabelledIri[] = [];
  @property({ type: String }) activeViewpointIri = '';
  @property({ attribute: false }) loadedMetamodels: LabelledIri[] = [];
  @property({ attribute: false }) catalogue: readonly CatalogueEntry[] = [];
  @property({ attribute: false }) presentationContexts: LabelledIri[] = [];
  @property({ type: String }) activeContextIri = '';
  @property({ attribute: false }) collab: CollabIndicator = { status: 'off', peers: [] };
  /** Whether the RDF panel is shown (the toggle's pressed state). */
  @property({ type: Boolean }) rdfOpen = false;
  /** Whether the property panel is shown (the "Properties" toggle is pressed). */
  @property({ type: Boolean }) propertyOpen = true;

  @state() private _open: 'file' | 'metamodels' | 'new-view' | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('mousedown', this._onOutside, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('mousedown', this._onOutside, true);
  }

  /**
   * Set each select's value after the options exist. A `.value` binding is
   * evaluated before Lit renders a select's new options, so switching to a view
   * that was not an option a moment ago would leave the select blank.
   */
  override updated(): void {
    const set = (label: string, value: string) => {
      const select = this.renderRoot.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
      if (select && select.value !== value) select.value = value;
    };
    set('Open view', this.activeViewIri);
    set('Viewpoint of the open view', this.activeViewpointIri);
    set('Presentation context', this.activeContextIri);
  }

  private _onOutside = (e: MouseEvent): void => {
    if (!this._open) return;
    if (e.composedPath().includes(this)) return;
    this._open = null;
  };

  private _cmd(command: ToolbarCommand, value?: string): void {
    this._open = null;
    this.dispatchEvent(
      new CustomEvent<ToolbarCommandDetail>('toolbar-command', {
        detail: { command, ...(value !== undefined ? { value } : {}) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _toggle(menu: 'file' | 'metamodels' | 'new-view'): void {
    this._open = this._open === menu ? null : menu;
  }

  private _fileMenu() {
    return html`<div class="dropdown" role="menu">
      <button data-command="new-model" @click=${() => this._cmd('new-model')}>New model</button>
      <button data-command="open-model" @click=${() => this._cmd('open-model')}>
        Open… <span class="hint">.ttl .trig .jsonld .nq .nt .rdf</span>
      </button>
      <button data-command="import-archimate" @click=${() => this._cmd('import-archimate')}>
        Import ArchiMate exchange… <span class="hint">.xml</span>
      </button>
      <button data-command="model-settings" @click=${() => this._cmd('model-settings')}>
        Model settings… <span class="hint">name, namespace</span>
      </button>
      <hr />
      <button data-command="save" @click=${() => this._cmd('save')}>Save <span class="hint">Turtle</span></button>
      ${MODEL_FORMATS.filter((f) => f.id !== 'turtle').map(
        (f) => html`<button data-command="save-as" data-value=${f.id} @click=${() => this._cmd('save-as', f.id)}>
          Save as ${f.label} <span class="hint">.${f.extension}</span>
        </button>`,
      )}
      <button data-command="save-no-geometry" @click=${() => this._cmd('save-no-geometry')}>
        Save without diagram geometry <span class="hint">.ttl</span>
      </button>
      <hr />
      <button data-command="export-svg" @click=${() => this._cmd('export-svg')}>Export view as SVG</button>
      <button data-command="export-png" @click=${() => this._cmd('export-png')}>Export view as PNG</button>
    </div>`;
  }

  private _metamodelMenu() {
    const loaded = new Set(this.loadedMetamodels.map((m) => m.iri));
    const kinds = ['language', 'framework', 'extension'] as const;
    return html`<div class="dropdown" role="menu">
      <div class="group">Loaded</div>
      ${this.loadedMetamodels.length === 0
        ? html`<button disabled>None</button>`
        : this.loadedMetamodels.map(
            (m) => html`<button
              data-command="unload-metamodel"
              data-value=${m.iri}
              title="Unload ${m.label} (the model is kept)"
              @click=${() => this._cmd('unload-metamodel', m.iri)}
            >
              ✓ ${m.label} <span class="hint">unload</span>
            </button>`,
          )}
      ${kinds.map(
        (kind) => html`<div class="group">${CATALOGUE_KIND_LABELS[kind]}</div>
          ${this.catalogue
            .filter((e) => e.kind === kind)
            .map(
              (e) => html`<button
                data-command="add-metamodel"
                data-value=${e.iri}
                ?disabled=${loaded.has(e.iri)}
                title=${e.iri}
                @click=${() => this._cmd('add-metamodel', e.iri)}
              >
                ${e.label}
                <span class="hint"
                  >${loaded.has(e.iri)
                    ? 'loaded'
                    : html`<span
                        @click=${(ev: Event) => {
                          ev.stopPropagation();
                          this._cmd('switch-metamodel', e.iri);
                        }}
                        title="Replace the loaded metamodels with this one"
                        >switch to</span
                      > · add`}</span
                >
              </button>`,
            )}`,
      )}
      <hr />
      <button data-command="load-metamodel-iri" @click=${() => this._cmd('load-metamodel-iri')}>Load by IRI…</button>
      <button data-command="upload-asset" @click=${() => this._cmd('upload-asset')}>
        Upload metamodel or asset file…
      </button>
      <button data-command="show-assets" @click=${() => this._cmd('show-assets')}>Show loaded assets…</button>
    </div>`;
  }

  private _newViewMenu() {
    return html`<div class="dropdown" role="menu">
      <button data-command="new-view" data-value="Diagram" @click=${() => this._cmd('new-view', 'Diagram')}>New diagram</button>
      <button data-command="new-view" data-value="Catalog" @click=${() => this._cmd('new-view', 'Catalog')}>New catalog</button>
      <button data-command="new-view" data-value="Matrix" @click=${() => this._cmd('new-view', 'Matrix')}>New matrix</button>
    </div>`;
  }

  private _collab() {
    const c = this.collab;
    const title =
      c.status === 'off'
        ? 'Not shared — click to collaborate'
        : `Room "${c.room}" — ${c.status}, ${c.peers.length} other(s)`;
    return html`<div class="collab" title=${title} @click=${() => this._cmd('share')}>
      <span class="dot ${c.status}"></span>
      <span>${c.status === 'off' ? 'Share' : c.room}</span>
      ${c.peers.map(
        (p) => html`<span class="peer" style="background:${p.color}" title=${p.name}
          >${p.name.slice(0, 1).toUpperCase()}</span
        >`,
      )}
    </div>`;
  }

  override render() {
    return html`
      <span class="brand">la-gram</span>
      <span class="sep"></span>
      <button class="model-name" title="Model settings: name, namespace" @click=${() => this._cmd('model-settings')}>
        ${this.modelLabel}${this.dirty ? html`<span class="dirty" title="Unsaved changes">●</span>` : nothing}
      </button>
      <div class="menu-wrap">
        <button class="menu-button ${this._open === 'file' ? 'open' : ''}" data-menu="file" @click=${() => this._toggle('file')}>
          File ▾
        </button>
        ${this._open === 'file' ? this._fileMenu() : nothing}
      </div>
      <div class="menu-wrap">
        <button
          class="menu-button ${this._open === 'metamodels' ? 'open' : ''}"
          data-menu="metamodels"
          @click=${() => this._toggle('metamodels')}
        >
          Metamodels ▾
        </button>
        ${this._open === 'metamodels' ? this._metamodelMenu() : nothing}
      </div>
      <button class="icon" title="Undo (Ctrl+Z)" @click=${() => this._cmd('undo')}>↶</button>
      <button class="icon" title="Redo (Ctrl+Y)" @click=${() => this._cmd('redo')}>↷</button>
      <span class="sep"></span>
      <label class="field"
        >View
        <select
          aria-label="Open view"
          @change=${(e: Event) => this._cmd('open-view', (e.target as HTMLSelectElement).value)}
        >
          ${this.views.map(
            (v) => html`<option value=${v.iri} ?selected=${v.iri === this.activeViewIri}>
              ${v.label || 'Untitled'}${v.type !== 'Diagram' ? ` (${v.type.toLowerCase()})` : ''}
            </option>`,
          )}
        </select>
      </label>
      <div class="menu-wrap">
        <button class="icon" title="New view" data-menu="new-view" @click=${() => this._toggle('new-view')}>＋</button>
        ${this._open === 'new-view' ? this._newViewMenu() : nothing}
      </div>
      <label class="field"
        >Viewpoint
        <select
          aria-label="Viewpoint of the open view"
          @change=${(e: Event) => this._cmd('set-viewpoint', (e.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${!this.activeViewpointIri}>— none —</option>
          ${this.viewpoints.map(
            (v) => html`<option value=${v.iri} ?selected=${v.iri === this.activeViewpointIri}>${v.label}</option>`,
          )}
        </select>
      </label>
      ${this.presentationContexts.length > 0
        ? html`<label class="field"
            >Presentation
            <select
              aria-label="Presentation context"
              @change=${(e: Event) => this._cmd('set-context', (e.target as HTMLSelectElement).value)}
            >
              <option value="" ?selected=${!this.activeContextIri}>Default notation</option>
              ${this.presentationContexts.map(
                (c) => html`<option value=${c.iri} ?selected=${c.iri === this.activeContextIri}>${c.label}</option>`,
              )}
            </select>
          </label>`
        : nothing}
      <span class="spacer"></span>
      <button
        class="toggle"
        data-command="toggle-properties"
        aria-pressed=${this.propertyOpen ? 'true' : 'false'}
        title=${this.propertyOpen ? 'Hide the property panel' : 'Show the selected element or view on the right'}
        @click=${() => this._cmd('toggle-properties')}
      >
        ⓘ Properties
      </button>
      <button
        class="toggle"
        data-command="toggle-rdf"
        aria-pressed=${this.rdfOpen ? 'true' : 'false'}
        title=${this.rdfOpen ? 'Hide the RDF panel' : 'Show the model as RDF (Turtle) on the right'}
        @click=${() => this._cmd('toggle-rdf')}
      >
        { } RDF
      </button>
      ${this._collab()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-toolbar': AppToolbar;
  }
}
