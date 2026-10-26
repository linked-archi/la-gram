/**
 * RDF panel — the model as the store holds it, live.
 *
 * Shows the serialized model (Turtle by default; TriG, JSON-LD, N-Quads,
 * N-Triples, RDF/XML on request), with or without diagram geometry, highlighted,
 * with counts, Copy and Download. The text comes from the same serializer
 * (`ModelIO`) as "Save", so what you read here is what goes into Git.
 *
 * Of a scope, remembered per browser: the **open view** (the default) — the
 * view, the concepts it presents and its diagram — the **selection**, or the
 * **whole model**, exactly what Save writes. A view or a concept is small
 * enough to read and to highlight on any model; a large model is not. A whole
 * model past the highlighting limit is not shown at all — its size is, with
 * Copy and Download — and is not serialized again on every change.
 *
 * The panel is hidden by default. While hidden it does no work at all — the
 * host calls {@link RdfPanel.scheduleRefresh} on every model change and the
 * panel ignores it unless {@link active}. While shown, refreshes are debounced
 * so dragging a shape does not re-serialize the model on every frame.
 *
 * The selected concepts' statements are highlighted and the first's scrolled
 * into view; clicking a subject's statements selects that concept
 * (`rdf-select`). The selection scope shows every selected concept.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { MODEL_FORMATS, type ModelFormat, type SerializationProfile } from '../../import-export/model-io.js';
import { HIGHLIGHT_LIMIT, highlightRdf } from './rdf-highlight.js';

/** Counts shown above the text. */
export interface RdfPanelStats {
  elements: number;
  relationships: number;
  views: number;
  triples: number;
}

/** What the panel shows: the open view, the selected concept, or the whole model. */
export type RdfScope = 'view' | 'selection' | 'model';

/** The scopes, in the order offered. */
export const RDF_SCOPES: ReadonlyArray<{ id: RdfScope; label: string; title: string }> = [
  { id: 'view', label: 'View', title: 'The open view: the view, the concepts it shows, and its diagram' },
  { id: 'selection', label: 'Selection', title: 'The selected concepts, and how they are drawn in the open view' },
  { id: 'model', label: 'Model', title: 'The whole model, as Save writes it' },
];

/** What the panel asks its source for. */
export interface RdfPanelRequest {
  format: ModelFormat;
  profile: SerializationProfile;
  scope: RdfScope;
  /** The selected concepts, for the selection scope; none when nothing is selected. */
  selectedIris: string[];
}

/** What the source answers: the text, its counts, and what it is about (the view's name). */
export interface RdfPanelContent {
  text: string;
  stats?: RdfPanelStats;
  caption?: string;
}

/** Detail of `rdf-download`. */
export interface RdfDownloadDetail {
  format: ModelFormat;
  profile: SerializationProfile;
  scope: RdfScope;
  /** The selected concepts, for the selection scope. */
  selectedIris: string[];
}

/** Detail of `rdf-select`. */
export interface RdfSelectDetail {
  iri: string;
}

/** Debounce for refreshes while shown. */
const REFRESH_DELAY_MS = 250;

/** localStorage key of the scope shown. */
const SCOPE_KEY = 'la-gram:rdf-scope';

function storedScope(): RdfScope {
  try {
    const value = globalThis.localStorage?.getItem(SCOPE_KEY);
    return RDF_SCOPES.find((s) => s.id === value)?.id ?? 'view';
  } catch {
    return 'view';
  }
}

/** What the panel says when a scope has nothing to show. */
const EMPTY: Record<RdfScope, string> = {
  view: 'No view is open.',
  selection: 'Select an element, a relationship or a view to see its statements.',
  model: 'Nothing to show.',
};

@customElement('rdf-panel')
export class RdfPanel extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      background: #fff;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px 6px 12px;
      border-bottom: 1px solid #e0e0e0;
      white-space: nowrap;
      min-width: 0;
    }
    .title {
      font-weight: 600;
      margin-right: auto;
    }
    select,
    button {
      font: inherit;
      font-size: 12px;
    }
    select {
      padding: 2px 4px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      background: #fff;
      /* Shrinks first when the panel is narrow, so the buttons never wrap. */
      min-width: 70px;
      max-width: 120px;
      flex: 0 1 auto;
    }
    button {
      border: 1px solid #dadce0;
      background: #fff;
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
    }
    button:hover {
      background: #f1f3f4;
    }
    button.close,
    button.maximize {
      border: 0;
      font-size: 16px;
      line-height: 1;
      padding: 2px 6px;
      color: #5f6368;
    }
    button.maximize[aria-pressed='true'] {
      color: #1a73e8;
    }
    label.geometry {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      color: #5f6368;
    }
    .stats {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      font-size: 11px;
      color: #5f6368;
      border-bottom: 1px solid #f0f0f0;
      white-space: nowrap;
      min-width: 0;
      /* A long name or a whole model's counts take a second line rather than be cut. */
      flex-wrap: wrap;
      row-gap: 2px;
    }
    /* What to show, leading the line that says what is shown. */
    .stats select.scope {
      flex: none;
      min-width: 0;
      max-width: none;
      font-size: 11px;
      padding: 1px 2px;
    }
    .stats b {
      color: #202124;
      font-weight: 600;
    }
    .code {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      margin: 0;
      /* Lines outside a subject block (prefixes, blank lines, TriG braces) are
         bare text nodes, so the horizontal padding lives here and the blocks
         pull themselves back out to span the full width. */
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      color: #202124;
      tab-size: 4;
    }
    .code .rdf-block {
      margin: 0 -12px;
      padding: 0 12px 0 9px;
      cursor: pointer;
      border-left: 3px solid transparent;
    }
    .code .rdf-block:hover {
      background: #f8f9fa;
    }
    .code .rdf-block.selected {
      background: #e8f0fe;
      border-left-color: #1a73e8;
    }
    .rdf-comment { color: #80868b; font-style: italic; }
    .rdf-directive, .rdf-keyword { color: #a142f4; }
    .rdf-iri { color: #1967d2; }
    .rdf-pname { color: #188038; }
    .rdf-bnode { color: #b06000; }
    .rdf-string { color: #c5221f; }
    .rdf-lang, .rdf-datatype { color: #e37400; }
    .rdf-number { color: #098591; }
    .rdf-punct { color: #5f6368; }
    .empty {
      padding: 16px 12px;
      color: #80868b;
      font-style: italic;
    }
    .caption {
      font-weight: 600;
      color: #3c4043;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .notice {
      padding: 12px;
      color: #5f6368;
      line-height: 1.5;
    }
    .error {
      padding: 12px;
      color: #c5221f;
    }
  `;

  /** Whether the panel is shown; while `false` nothing is serialized. */
  @property({ type: Boolean, reflect: true }) active = false;

  /** Serializes the scope asked for, with its counts; supplied by the host (`ModelIO`, as Save). */
  @property({ attribute: false }) source?: (request: RdfPanelRequest) => RdfPanelContent;

  /** The concept selected elsewhere — the first, when several are: its statements are scrolled to. */
  @property({ type: String }) selectedIri = '';

  /** Every concept selected (on the canvas, several may be): their statements are highlighted; the selection scope shows them. */
  @property({ attribute: false }) selectedIris: readonly string[] = [];

  /** Whether the panel covers the workspace; the shell owns the choice (`rdf-maximize-toggle` asks for it). */
  @property({ type: Boolean, reflect: true }) maximized = false;

  @state() private _format: ModelFormat = 'turtle';
  @state() private _geometry = true;
  @state() private _scope: RdfScope = storedScope();
  @state() private _text = '';
  @state() private _caption = '';
  /** The whole model is past the highlighting limit: its size is shown, not its text. */
  @state() private _tooLarge = false;
  @state() private _stats: RdfPanelStats | undefined;
  @state() private _error = '';
  @state() private _copied = false;

  @query('.code') private _code?: HTMLElement;

  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** What the code element currently shows, to re-render only on change. */
  private _renderedText: string | null = null;
  private _renderedFormat: ModelFormat | null = null;

  /** The format being shown. */
  get format(): ModelFormat {
    return this._format;
  }

  /** The text being shown (for tests and for Copy). */
  get text(): string {
    return this._text;
  }

  /** The scope shown. */
  get scope(): RdfScope {
    return this._scope;
  }

  /** Show another scope; remembered per browser. */
  set scope(scope: RdfScope) {
    if (scope === this._scope) return;
    this._scope = scope;
    try {
      globalThis.localStorage?.setItem(SCOPE_KEY, scope);
    } catch {
      /* not remembered: fine */
    }
    this.refresh();
  }

  private _request(): RdfPanelRequest {
    return {
      format: this._format,
      profile: this._geometry ? 'full' : 'no-geometry',
      scope: this._scope,
      selectedIris: this._selected(),
    };
  }

  /** The selection: every concept selected, else the one. */
  private _selected(): string[] {
    if (this.selectedIris.length > 0) return [...this.selectedIris];
    return this.selectedIri ? [this.selectedIri] : [];
  }

  /** Re-serialize now (when shown). */
  refresh(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this.active || !this.source) return;
    try {
      const content = this.source(this._request());
      this._text = content.text;
      this._stats = content.stats;
      this._caption = content.caption ?? '';
      this._tooLarge = this._scope === 'model' && content.text.length > HIGHLIGHT_LIMIT;
      this._error = '';
    } catch (err: unknown) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Re-serialize soon (when shown); called on every model change. Not for a
   * whole model too large to show: it is measured again when the scope, the
   * format or geometry is chosen, and Copy and Download write it afresh.
   */
  scheduleRefresh(): void {
    if (!this.active || (this._scope === 'model' && this._tooLarge)) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer) clearTimeout(this._timer);
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Opening the panel (or getting a source while open) shows current text at once;
    // so does another selection, when the selection is what is shown.
    if ((changed.has('active') || changed.has('source')) && this.active) this.refresh();
    else if ((changed.has('selectedIri') || changed.has('selectedIris')) && this._scope === 'selection' && this.active) this.refresh();
  }

  override updated(changed: Map<string, unknown>): void {
    const code = this._code;
    if (!code) return;
    if (this._tooLarge) {
      code.innerHTML = '';
      this._renderedText = null;
      return;
    }
    // The highlighted text is assigned as one HTML string: an order of
    // magnitude cheaper than a template per token for a model of any size.
    // Only when the text or format changed — a selection change only moves the
    // highlight.
    if (this._text !== this._renderedText || this._format !== this._renderedFormat) {
      code.innerHTML = highlightRdf(this._text, this._format);
      this._renderedText = this._text;
      this._renderedFormat = this._format;
      this._markSelected(changed.has('selectedIri') || changed.has('selectedIris'));
    } else if (changed.has('selectedIri') || changed.has('selectedIris')) {
      this._markSelected(true);
    }
  }

  /** Highlight the selected subjects' blocks; scroll to the first when asked. */
  private _markSelected(scroll: boolean): void {
    const code = this._code;
    if (!code) return;
    for (const block of code.querySelectorAll('.rdf-block.selected')) block.classList.remove('selected');
    const escape = (iri: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(iri) : iri.replace(/"/g, '\\"'));
    let first: HTMLElement | undefined;
    for (const iri of this._selected()) {
      for (const block of code.querySelectorAll<HTMLElement>(`.rdf-block[data-subject="${escape(iri)}"]`)) {
        block.classList.add('selected');
        first ??= block;
      }
    }
    if (scroll && first && typeof first.scrollIntoView === 'function') first.scrollIntoView({ block: 'nearest' });
  }

  private _emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  private _onCodeClick(e: MouseEvent): void {
    // A text selection being made is not a click on a concept.
    if (typeof window !== 'undefined' && window.getSelection?.()?.toString()) return;
    const block = (e.target as Element | null)?.closest?.('.rdf-block') as HTMLElement | null;
    const iri = block?.dataset['subject'];
    if (iri) this._emit<RdfSelectDetail>('rdf-select', { iri });
  }

  private async _copy(): Promise<void> {
    try {
      // A whole model too large to show was measured, perhaps a while ago: copy it as it is now.
      const text = this._tooLarge && this.source ? this.source(this._request()).text : this._text;
      await navigator.clipboard.writeText(text);
      this._copied = true;
      setTimeout(() => (this._copied = false), 1500);
    } catch {
      // Clipboard denied (insecure context): select the text so Cmd/Ctrl+C works.
      const range = document.createRange();
      if (this._code) {
        range.selectNodeContents(this._code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  override render() {
    const s = this._stats;
    return html`
      <div class="header">
        <span class="title">RDF</span>
        <select
          class="format"
          aria-label="RDF format"
          @change=${(e: Event) => {
            this._format = (e.target as HTMLSelectElement).value as ModelFormat;
            this.refresh();
          }}
        >
          ${MODEL_FORMATS.map(
            (f) => html`<option value=${f.id} ?selected=${f.id === this._format}>${f.label}</option>`,
          )}
        </select>
        <label class="geometry" title="Include diagram geometry (arch-vis nodes, links, routes)">
          <input
            type="checkbox"
            .checked=${this._geometry}
            @change=${(e: Event) => {
              this._geometry = (e.target as HTMLInputElement).checked;
              this.refresh();
            }}
          />
          geometry
        </label>
        <button title="Copy to the clipboard" @click=${() => this._copy()}>${this._copied ? 'Copied' : 'Copy'}</button>
        <button
          title="Download this file"
          @click=${() => {
            const { format, profile, scope, selectedIris } = this._request();
            this._emit<RdfDownloadDetail>('rdf-download', { format, profile, scope, selectedIris });
          }}
        >
          Download
        </button>
        <button
          class="maximize"
          title=${this.maximized ? 'Restore the panel (Esc)' : 'Maximize the panel over the workspace'}
          aria-label=${this.maximized ? 'Restore the panel' : 'Maximize the panel'}
          aria-pressed=${this.maximized ? 'true' : 'false'}
          @click=${() => this._emit('rdf-maximize-toggle', {})}
        >
          ${this.maximized ? '⤡' : '⤢'}
        </button>
        <button class="close" title="Hide the RDF panel" @click=${() => this._emit('rdf-close', {})}>×</button>
      </div>
      <div class="stats">
            <select
              class="scope"
              aria-label="What to show"
              title="What to show: the open view, the selection, or the whole model as Save writes it"
              @change=${(e: Event) => (this.scope = (e.target as HTMLSelectElement).value as RdfScope)}
            >
              ${RDF_SCOPES.map((o) => html`<option value=${o.id} title=${o.title} ?selected=${o.id === this._scope}>${o.label}</option>`)}
            </select>
            ${this._caption ? html`<span class="caption" title=${this._caption}>${this._caption}</span>` : nothing}
            ${s && (this._scope === 'model' || s.elements) ? html`<span><b>${s.elements}</b> elements</span>` : nothing}
            ${s && (this._scope === 'model' || s.relationships) ? html`<span><b>${s.relationships}</b> relationships</span>` : nothing}
            ${s && this._scope === 'model' ? html`<span><b>${s.views}</b> views</span>` : nothing}
            ${s ? html`<span><b>${s.triples}</b> triples</span>` : nothing}
          </div>
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      ${this._tooLarge
        ? html`<div class="notice">
            The whole model is ${(this._text.length / 1e6).toFixed(1)} MB of
            ${MODEL_FORMATS.find((f) => f.id === this._format)?.label ?? this._format} — too large to show here. Copy or
            download it, or show the open view or the selection.
          </div>`
        : nothing}
      ${!this._text && !this._error ? html`<div class="empty">${EMPTY[this._scope]}</div>` : nothing}
      <pre class="code" @click=${(e: MouseEvent) => this._onCodeClick(e)}></pre>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rdf-panel': RdfPanel;
  }
}
