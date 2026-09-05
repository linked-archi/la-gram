/**
 * SPARQL Query Editor — Lit component wrapping CodeMirror 6.
 *
 * Provides syntax highlighting for SPARQL keywords, variables, and prefixes,
 * auto-completion for namespace prefixes from the loaded metamodel,
 * query execution against an RdfStore, and result display (table for SELECT,
 * boolean for ASK, quads for CONSTRUCT/DESCRIBE with option to create a new view).
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import type { RdfStore, SparqlResult } from '../../rdf-engine/interfaces.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

// ── SPARQL syntax highlighting via StreamParser ─────────────────────────

/** SPARQL keywords for syntax highlighting. */
const SPARQL_KEYWORDS = new Set([
  'select', 'construct', 'describe', 'ask', 'where', 'filter',
  'optional', 'union', 'graph', 'order', 'by', 'limit', 'offset',
  'distinct', 'reduced', 'from', 'named', 'prefix', 'base',
  'bind', 'as', 'values', 'group', 'having', 'asc', 'desc',
  'insert', 'delete', 'data', 'load', 'clear', 'drop', 'create',
  'not', 'exists', 'in', 'minus', 'service', 'silent', 'true', 'false',
  'a',
]);

/**
 * Minimal SPARQL stream parser for CodeMirror 6 syntax highlighting.
 * Recognises keywords, variables (?var), prefixed names, URIs, strings,
 * and comments.
 */
export const sparqlStreamParser: StreamParser<null> = {
  startState() { return null; },
  token(stream) {
    // Skip whitespace
    if (stream.eatSpace()) return null;

    // Comments
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }

    // Strings (single or double quoted)
    if (stream.match('"')) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === '"') break;
      }
      return 'string';
    }
    if (stream.match("'")) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === "'") break;
      }
      return 'string';
    }

    // URI <...>
    if (stream.match('<')) {
      while (!stream.eol()) {
        if (stream.next() === '>') break;
      }
      return 'url';
    }

    // Variables ?var or $var
    if (stream.match(/^\?[\w]+/) || stream.match(/^\$[\w]+/)) {
      return 'variableName';
    }

    // Prefixed names or keywords
    if (stream.match(/^[\w][\w.-]*/)) {
      const word = stream.current();
      // Check for prefix:local pattern
      if (stream.eat(':')) {
        stream.match(/^[\w.-]*/);
        return 'namespace';
      }
      if (SPARQL_KEYWORDS.has(word.toLowerCase())) {
        return 'keyword';
      }
      return null;
    }

    // Bare colon (default prefix)
    if (stream.eat(':')) {
      stream.match(/^[\w.-]*/);
      return 'namespace';
    }

    // Consume any other character
    stream.next();
    return null;
  },
};

/**
 * Creates a CodeMirror LanguageSupport for SPARQL using the stream parser.
 */
export function sparqlLanguage(): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(sparqlStreamParser));
}

// ── Auto-completion ─────────────────────────────────────────────────────

/**
 * Builds a list of prefix completion entries from the NAMESPACES map
 * and any additional prefixes provided.
 */
export function buildPrefixCompletions(
  extraPrefixes?: Record<string, string>,
): { label: string; detail: string }[] {
  const all: Record<string, string> = { ...NAMESPACES, ...extraPrefixes };
  return Object.entries(all).map(([prefix, uri]) => ({
    label: `${prefix}:`,
    detail: uri,
  }));
}

// ── Event detail types ──────────────────────────────────────────────────

/** Detail emitted when the user requests rendering CONSTRUCT results as a view. */
export interface ConstructViewRequestDetail {
  quads: import('@rdfjs/types').Quad[];
}

/** Detail emitted when a query is executed. */
export interface QueryExecuteDetail {
  sparql: string;
}

// ── Result display helpers ──────────────────────────────────────────────

/** Extracts column names from SELECT binding results. */
export function extractColumns(results: Record<string, any>[]): string[] {
  const cols = new Set<string>();
  for (const row of results) {
    for (const key of Object.keys(row)) {
      cols.add(key);
    }
  }
  return [...cols];
}

/** Extracts a display value from an RDF term. */
export function termValue(term: any): string {
  if (!term) return '';
  if (typeof term === 'string') return term;
  return term.value ?? String(term);
}

// ── Lit Component ───────────────────────────────────────────────────────

@customElement('sparql-editor')
export class SparqlEditor extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
    }

    .panel-header {
      padding: 8px 12px;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
    }

    .editor-container {
      border: 1px solid #ccc;
      margin: 8px;
      min-height: 120px;
    }

    .editor-container .cm-editor {
      min-height: 120px;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      padding: 4px 8px;
      align-items: center;
    }

    .run-btn {
      padding: 4px 16px;
      background: #1a73e8;
      color: #fff;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
    }

    .run-btn:hover {
      background: #1557b0;
    }

    .run-btn:disabled {
      background: #ccc;
      cursor: default;
    }

    .error-display {
      margin: 8px;
      padding: 8px 12px;
      background: #fdecea;
      color: #c62828;
      border: 1px solid #f5c6cb;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
    }

    .result-section {
      margin: 8px;
    }

    .result-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .result-table th {
      background: #f5f5f5;
      padding: 4px 8px;
      border: 1px solid #ddd;
      text-align: left;
      font-weight: 600;
    }

    .result-table td {
      padding: 4px 8px;
      border: 1px solid #eee;
      word-break: break-all;
    }

    .result-table tr:hover td {
      background: #f9f9f9;
    }

    .boolean-result {
      padding: 8px 12px;
      font-weight: 600;
      font-size: 14px;
    }

    .boolean-result.true {
      color: #2e7d32;
    }

    .boolean-result.false {
      color: #c62828;
    }

    .construct-result {
      padding: 8px 12px;
    }

    .construct-count {
      margin-bottom: 8px;
      color: #555;
    }

    .view-btn {
      padding: 4px 12px;
      background: #fff;
      border: 1px solid #1a73e8;
      color: #1a73e8;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }

    .view-btn:hover {
      background: #e8f0fe;
    }

    .result-info {
      padding: 4px 8px;
      color: #666;
      font-size: 11px;
    }
  `;

  /** Reference to the RDF store for executing queries. */
  @property({ attribute: false })
  rdfStore?: RdfStore;

  /** Additional namespace prefixes for auto-completion (beyond defaults). */
  @property({ attribute: false })
  extraPrefixes?: Record<string, string>;

  @state()
  private _result: SparqlResult | null = null;

  @state()
  private _error: string = '';

  @state()
  private _editorView: EditorView | null = null;

  private _editorContainer: HTMLDivElement | null = null;

  /**
   * Returns the current SPARQL query text from the editor.
   */
  getQuery(): string {
    return this._editorView?.state.doc.toString() ?? '';
  }

  /**
   * Sets the SPARQL query text in the editor.
   */
  setQuery(sparql: string): void {
    if (this._editorView) {
      this._editorView.dispatch({
        changes: {
          from: 0,
          to: this._editorView.state.doc.length,
          insert: sparql,
        },
      });
    }
  }

  /**
   * Executes the current query against the RDF store.
   * Returns the SparqlResult or null if an error occurred.
   */
  executeQuery(): SparqlResult | null {
    const sparql = this.getQuery().trim();
    if (!sparql) {
      this._error = 'Query is empty';
      this._result = null;
      return null;
    }

    if (!this.rdfStore) {
      this._error = 'No RDF store available';
      this._result = null;
      return null;
    }

    this._error = '';
    this._result = null;

    try {
      const result = this.rdfStore.query(sparql);
      this._result = result;

      this.dispatchEvent(
        new CustomEvent<QueryExecuteDetail>('query-execute', {
          detail: { sparql },
          bubbles: true,
          composed: true,
        }),
      );

      return result;
    } catch (err: any) {
      this._error = err?.message ?? String(err);
      this._result = null;
      return null;
    }
  }

  private _onRunClick(): void {
    this.executeQuery();
  }

  private _onConstructViewClick(): void {
    if (this._result?.type === 'quads') {
      this.dispatchEvent(
        new CustomEvent<ConstructViewRequestDetail>('construct-view-request', {
          detail: { quads: this._result.quads },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  override firstUpdated(): void {
    this._editorContainer = this.renderRoot.querySelector('.editor-container');
    if (this._editorContainer) {
      this._initEditor(this._editorContainer);
    }
  }

  private _initEditor(container: HTMLElement): void {
    const extensions = [
      sparqlLanguage(),
      keymap.of([
        {
          key: 'Ctrl-Enter',
          run: () => { this.executeQuery(); return true; },
        },
        {
          key: 'Cmd-Enter',
          run: () => { this.executeQuery(); return true; },
        },
      ]),
      EditorView.lineWrapping,
    ];

    const state = EditorState.create({
      doc: defaultQuery(),
      extensions,
    });

    this._editorView = new EditorView({
      state,
      parent: container,
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._editorView?.destroy();
    this._editorView = null;
  }

  // ── Result rendering ────────────────────────────────────────────────

  _renderBindingsResult(results: Record<string, any>[]): unknown {
    const columns = extractColumns(results);
    if (columns.length === 0) {
      return html`<div class="result-info">No results</div>`;
    }
    return html`
      <div class="result-section">
        <div class="result-info">${results.length} result(s)</div>
        <table class="result-table">
          <thead>
            <tr>${columns.map((c) => html`<th>${c}</th>`)}</tr>
          </thead>
          <tbody>
            ${results.map(
              (row) => html`
                <tr>${columns.map((c) => html`<td>${termValue(row[c])}</td>`)}</tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderBooleanResult(value: boolean): unknown {
    return html`
      <div class="result-section">
        <div class="boolean-result ${value ? 'true' : 'false'}">
          ${value ? 'TRUE' : 'FALSE'}
        </div>
      </div>
    `;
  }

  _renderQuadsResult(quads: import('@rdfjs/types').Quad[]): unknown {
    return html`
      <div class="result-section construct-result">
        <div class="construct-count">${quads.length} quad(s) returned</div>
        ${quads.length > 0
          ? html`<button class="view-btn" @click=${this._onConstructViewClick}>
              Render as new view
            </button>`
          : nothing}
      </div>
    `;
  }

  _renderResult(): unknown {
    if (!this._result) return nothing;

    switch (this._result.type) {
      case 'bindings':
        return this._renderBindingsResult(this._result.results);
      case 'boolean':
        return this._renderBooleanResult(this._result.value);
      case 'quads':
        return this._renderQuadsResult(this._result.quads);
      default:
        return nothing;
    }
  }

  override render() {
    return html`
      <div class="panel-header">SPARQL Query</div>
      <div class="editor-container"></div>
      <div class="toolbar">
        <button
          class="run-btn"
          ?disabled=${!this.rdfStore}
          @click=${this._onRunClick}
        >
          ▶ Run
        </button>
      </div>
      ${this._error
        ? html`<div class="error-display">${this._error}</div>`
        : nothing}
      ${this._renderResult()}
    `;
  }
}

/** Default query shown when the editor opens. */
function defaultQuery(): string {
  return `SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
LIMIT 10`;
}

declare global {
  interface HTMLElementTagNameMap {
    'sparql-editor': SparqlEditor;
  }
}
