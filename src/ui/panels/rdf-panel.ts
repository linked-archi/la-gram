/**
 * RDF panel — the model as the store holds it, live.
 *
 * Shows the serialized model (Turtle by default; TriG, JSON-LD, N-Quads,
 * N-Triples, RDF/XML on request), with or without diagram geometry, highlighted,
 * with counts, Copy and Download. It is exactly what "Save" would write: the
 * text comes from the same serializer (`ModelIO`), so what you read here is
 * what goes into Git.
 *
 * The panel is hidden by default. While hidden it does no work at all — the
 * host calls {@link RdfPanel.scheduleRefresh} on every model change and the
 * panel ignores it unless {@link active}. While shown, refreshes are debounced
 * so dragging a shape does not re-serialize the model on every frame.
 *
 * The selected concept's statements are highlighted and scrolled into view;
 * clicking a subject's statements selects that concept (`rdf-select`).
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { MODEL_FORMATS, type ModelFormat, type SerializationProfile } from '../../import-export/model-io.js';
import { highlightRdf } from './rdf-highlight.js';

/** Counts shown above the text. */
export interface RdfPanelStats {
  elements: number;
  relationships: number;
  views: number;
  triples: number;
}

/** Detail of `rdf-download`. */
export interface RdfDownloadDetail {
  format: ModelFormat;
  profile: SerializationProfile;
}

/** Detail of `rdf-select`. */
export interface RdfSelectDetail {
  iri: string;
}

/** Debounce for refreshes while shown. */
const REFRESH_DELAY_MS = 250;

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
    button.close {
      border: 0;
      font-size: 16px;
      line-height: 1;
      padding: 2px 6px;
      color: #5f6368;
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
      gap: 12px;
      padding: 4px 12px;
      font-size: 11px;
      color: #5f6368;
      border-bottom: 1px solid #f0f0f0;
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
    .error {
      padding: 12px;
      color: #c5221f;
    }
  `;

  /** Whether the panel is shown; while `false` nothing is serialized. */
  @property({ type: Boolean, reflect: true }) active = false;

  /** Serializes the model; supplied by the host (`App.saveModel`). */
  @property({ attribute: false }) source?: (format: ModelFormat, profile: SerializationProfile) => string;

  /** Counts for the stats bar. */
  @property({ attribute: false }) statsProvider?: () => RdfPanelStats;

  /** The concept selected elsewhere: its statements are highlighted. */
  @property({ type: String }) selectedIri = '';

  @state() private _format: ModelFormat = 'turtle';
  @state() private _geometry = true;
  @state() private _text = '';
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

  /** Re-serialize now (when shown). */
  refresh(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this.active || !this.source) return;
    try {
      this._text = this.source(this._format, this._geometry ? 'full' : 'no-geometry');
      this._stats = this.statsProvider?.();
      this._error = '';
    } catch (err: unknown) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Re-serialize soon (when shown); called on every model change. */
  scheduleRefresh(): void {
    if (!this.active) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer) clearTimeout(this._timer);
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Opening the panel (or getting a source while open) shows current text at once.
    if ((changed.has('active') || changed.has('source')) && this.active) this.refresh();
  }

  override updated(changed: Map<string, unknown>): void {
    const code = this._code;
    if (!code) return;
    // The highlighted text is assigned as one HTML string: an order of
    // magnitude cheaper than a template per token for a model of any size.
    // Only when the text or format changed — a selection change only moves the
    // highlight.
    if (this._text !== this._renderedText || this._format !== this._renderedFormat) {
      code.innerHTML = highlightRdf(this._text, this._format);
      this._renderedText = this._text;
      this._renderedFormat = this._format;
      this._markSelected(changed.has('selectedIri'));
    } else if (changed.has('selectedIri')) {
      this._markSelected(true);
    }
  }

  /** Highlight the selected subject's block; scroll to it when asked. */
  private _markSelected(scroll: boolean): void {
    const code = this._code;
    if (!code) return;
    for (const block of code.querySelectorAll('.rdf-block.selected')) block.classList.remove('selected');
    if (!this.selectedIri) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(this.selectedIri) : this.selectedIri.replace(/"/g, '\\"');
    const blocks = code.querySelectorAll<HTMLElement>(`.rdf-block[data-subject="${escaped}"]`);
    for (const block of blocks) block.classList.add('selected');
    if (scroll && blocks[0] && typeof blocks[0].scrollIntoView === 'function') {
      blocks[0].scrollIntoView({ block: 'nearest' });
    }
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
      await navigator.clipboard.writeText(this._text);
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
          @click=${() =>
            this._emit<RdfDownloadDetail>('rdf-download', {
              format: this._format,
              profile: this._geometry ? 'full' : 'no-geometry',
            })}
        >
          Download
        </button>
        <button class="close" title="Hide the RDF panel" @click=${() => this._emit('rdf-close', {})}>×</button>
      </div>
      ${s
        ? html`<div class="stats">
            <span><b>${s.elements}</b> elements</span>
            <span><b>${s.relationships}</b> relationships</span>
            <span><b>${s.views}</b> views</span>
            <span><b>${s.triples}</b> triples</span>
          </div>`
        : nothing}
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      ${!this._text && !this._error ? html`<div class="empty">Nothing to show.</div>` : nothing}
      <pre class="code" @click=${(e: MouseEvent) => this._onCodeClick(e)}></pre>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rdf-panel': RdfPanel;
  }
}
