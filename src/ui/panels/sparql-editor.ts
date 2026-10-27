/**
 * SPARQL Query Editor — Lit component wrapping CodeMirror 6.
 *
 * Provides syntax highlighting for SPARQL keywords, variables, and prefixes,
 * auto-completion for namespace prefixes from the loaded metamodel,
 * query execution against an RdfStore, and result display: a table for SELECT,
 * the triples as a table for CONSTRUCT/DESCRIBE, a boolean for ASK. IRIs show as
 * prefixed names and select the concept when clicked; the elements and
 * relationships a SELECT or CONSTRUCT result mentions can become a new view.
 *
 * The Questions menu offers the model questions of the loaded languages
 * (`questionSource`), by stage, those fitting the open view's viewpoint first,
 * filterable by concern; picking one puts its query — prefixes, the
 * workbench's bindings (`bindingSource`) as `VALUES`, a `LIMIT` — in the
 * editor and runs it, and the result says what a row means and what it does
 * not prove. One that needs what is not selected is shown disabled, saying
 * what to select.
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
import {
  buildQuery,
  stageOf,
  viewpointOfAnswer,
  whatToSelect,
  QUESTION_STAGES,
  type ModelQuestion,
  type QuestionBindings,
} from '../../model-manager/questions.js';

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

/** Detail of `results-view-request`: make a view of what the result mentions. */
export interface ResultsViewRequestDetail {
  /** The IRIs in the result, in order, once each. */
  iris: string[];
  /** The view's name to propose: the question the result answers. */
  label?: string;
  /** The viewpoint the view follows: the question's ({@link viewpointOfAnswer}). */
  viewpoint?: string;
}

/** Detail of `sparql-select`: an IRI in the results was clicked. */
export interface SparqlSelectDetail {
  iri: string;
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
  // An RDF 1.2 triple term (what a relationship rdf:reifies), as Turtle writes it.
  if (term.termType === 'Quad') {
    return `<<( ${termValue(term.subject)} ${termValue(term.predicate)} ${termValue(term.object)} )>>`;
  }
  return term.value ?? String(term);
}

/**
 * The variables a SELECT projects, in order — the table's columns even where
 * no row binds them. `undefined` for `SELECT *` or what cannot be read.
 */
export function projectedVariables(sparql: string): string[] | undefined {
  const code = sparql
    .replace(/<[^<>"{}|^`\\\s]*>/g, '<>')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .replace(/#[^\n]*/g, '');
  const clause = /\bSELECT\b([\s\S]*?)(?:\bWHERE\b|\{)/i.exec(code)?.[1];
  if (clause === undefined || clause.includes('*')) return undefined;
  const columns: string[] = [];
  let depth = 0;
  let alias = false;
  for (const token of clause.match(/\(|\)|[?$]\w+|\bAS\b/gi) ?? []) {
    if (token === '(') depth += 1;
    else if (token === ')') depth -= 1;
    else if (/^AS$/i.test(token)) alias = true;
    else if (depth === 0 || alias) {
      // `?x`, or the `?x` of `(… AS ?x)`; a variable inside an expression is not a column.
      columns.push(token.slice(1));
      alias = false;
    }
  }
  return columns.length > 0 ? columns : undefined;
}

/** Rows shown at most; the count says how many there are. */
export const MAX_RESULT_ROWS = 500;

// ── The Questions menu ──────────────────────────────────────────────────

/** A heading of the Questions menu and the questions under it. */
export interface QuestionGroup {
  title: string;
  questions: ModelQuestion[];
}

/**
 * The Questions menu's groups: those fitting `viewpoint` (the open view's)
 * first, then each stage in the order an investigation moves through, then
 * any without one — only those addressing `concern`, when given.
 */
export function questionGroups(
  questions: readonly ModelQuestion[],
  options: { viewpoint?: string; concern?: string } = {},
): QuestionGroup[] {
  const { viewpoint, concern } = options;
  const shown = concern ? questions.filter((q) => q.concerns.includes(concern)) : [...questions];
  const groups: QuestionGroup[] = [];
  const fitting = viewpoint ? shown.filter((q) => q.viewpoints.includes(viewpoint)) : [];
  if (fitting.length > 0) groups.push({ title: 'Fits this view', questions: fitting });
  const rest = shown.filter((q) => !fitting.includes(q));
  for (const stage of [...QUESTION_STAGES, undefined]) {
    const inStage = rest.filter((q) => stageOf(q) === stage);
    if (inStage.length > 0) {
      groups.push({ title: stage ? stage.charAt(0).toUpperCase() + stage.slice(1) : 'Other', questions: inStage });
    }
  }
  return groups;
}

/** How the menu names each parameter it shows bound. */
const PARAMETER_TITLES: ReadonlyArray<[name: string, title: string]> = [
  ['focus', 'Element'],
  ['from', 'From'],
  ['to', 'To'],
  ['conceptType', 'Type'],
  ['view', 'View'],
  ['viewpoint', 'Viewpoint'],
];

/** The parameters `bindings` binds to one IRI, as the menu lists them: title and IRI. */
export function boundParameters(bindings: QuestionBindings): Array<[title: string, iri: string]> {
  return PARAMETER_TITLES.flatMap(([name, title]) => {
    const value = bindings[name];
    return typeof value === 'string' && value ? [[title, value] as [string, string]] : [];
  });
}

/** `prefix:local` when a prefix covers the IRI (the longest namespace wins), else the IRI. */
export function curieOf(iri: string, prefixes: Record<string, string>): string {
  let best: [string, string] | undefined;
  for (const [prefix, ns] of Object.entries(prefixes)) {
    if (!ns || !iri.startsWith(ns) || (best && best[1].length >= ns.length)) continue;
    if (/^[\w.-]*$/.test(iri.slice(ns.length))) best = [prefix, ns];
  }
  return best ? `${best[0]}:${iri.slice(best[1].length)}` : iri;
}

function isIri(term: any): boolean {
  return !!term && typeof term === 'object' && term.termType === 'NamedNode';
}

/** The IRIs a result mentions, in order, once each. */
export function resultIris(result: SparqlResult | null): string[] {
  const seen = new Set<string>();
  const add = (term: any) => {
    if (isIri(term)) seen.add(term.value);
  };
  if (result?.type === 'bindings') {
    for (const row of result.results) for (const value of Object.values(row)) add(value);
  } else if (result?.type === 'quads') {
    for (const q of result.quads) {
      add(q.subject);
      add(q.object);
    }
  }
  return [...seen];
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
      /* A long query (the Graph tab's) scrolls here, leaving room for its
         results; drag the corner for more. */
      height: 180px;
      min-height: 80px;
      overflow: auto;
      resize: vertical;
    }

    .editor-container .cm-editor {
      min-height: 100%;
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
      /* Names wrap at spaces; long IRIs wherever they must. */
      overflow-wrap: anywhere;
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

    .result-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    a.iri {
      color: #1a73e8;
      text-decoration: none;
    }

    a.iri:hover {
      text-decoration: underline;
    }

    .result-info {
      padding: 4px 8px;
      color: #666;
      font-size: 11px;
    }

    .questions-btn {
      padding: 4px 12px;
      background: #fff;
      border: 1px solid #bbb;
      color: #333;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
    }

    .questions-btn:hover,
    .questions-btn[aria-expanded='true'] {
      background: #f1f3f4;
    }

    .questions-btn:disabled {
      color: #aaa;
      cursor: default;
    }

    .questions-menu {
      margin: 4px 8px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #fff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
      max-height: 340px;
      overflow: auto;
    }

    .menu-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-bottom: 1px solid #eee;
      position: sticky;
      top: 0;
      background: #fff;
    }

    .menu-title {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .menu-head select {
      font-size: 12px;
      max-width: 45%;
    }

    .menu-close {
      border: none;
      background: none;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      color: #555;
      padding: 0 4px;
    }

    .bound {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      padding: 4px 8px;
      font-size: 11px;
      color: #444;
      border-bottom: 1px solid #eee;
    }

    .bound-name {
      color: #777;
    }

    .group-title {
      padding: 6px 8px 2px;
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    button.question {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
      width: 100%;
      padding: 4px 8px 4px 16px;
      border: none;
      background: none;
      text-align: left;
      font: inherit;
      color: #202124;
      cursor: pointer;
    }

    button.question:hover:not([disabled]),
    button.question:focus-visible {
      background: #e8f0fe;
      outline: none;
    }

    button.question[disabled] {
      color: #9aa0a6;
      cursor: default;
    }

    .q-finding {
      font-size: 10px;
      padding: 0 5px;
      border-radius: 8px;
      background: #fff3e0;
      color: #b05a00;
    }

    .q-finding.violation {
      background: #fdecea;
      color: #c62828;
    }

    .q-finding.info {
      background: #e8f0fe;
      color: #1a5fb4;
    }

    .q-missing {
      font-size: 11px;
      font-style: italic;
    }

    .menu-empty {
      padding: 8px;
      color: #666;
    }

    .asked {
      margin-bottom: 6px;
      padding: 6px 8px;
      border-left: 3px solid #1a73e8;
      background: #f8f9fa;
      font-size: 12px;
      color: #3c4043;
    }

    .asked-label {
      font-weight: 600;
      margin-bottom: 2px;
    }

    .asked-key {
      color: #5f6368;
    }

    .none-found {
      font-weight: 400;
      color: #2e7d32;
    }
  `;

  /** Reference to the RDF store for executing queries. */
  @property({ attribute: false })
  rdfStore?: RdfStore;

  /** Additional namespace prefixes for auto-completion (beyond defaults). */
  @property({ attribute: false })
  extraPrefixes?: Record<string, string>;

  /** The model's prefixes, read when a query runs, to show IRIs by. */
  @property({ attribute: false })
  prefixSource?: () => Record<string, string>;

  /** The questions to offer, read when the Questions menu opens: the loaded languages', in order. */
  @property({ attribute: false })
  questionSource?: () => ModelQuestion[];

  /** The workbench's bindings — selection, open model, view and viewpoint, palette pick — read when the menu opens. */
  @property({ attribute: false })
  bindingSource?: () => QuestionBindings;

  /** Names a bound concept, a viewpoint or a concern (its `skos:prefLabel`). */
  @property({ attribute: false })
  labelFor?: (iri: string) => string;

  /** The Questions menu, as opened: what it offers, with which bindings, and the element it is about. */
  @state()
  private _menu: { questions: ModelQuestion[]; bindings: QuestionBindings; about?: string } | null = null;

  /** The concern the menu is filtered by; none for all. */
  @state()
  private _concern = '';

  /** The question the shown result answers, with the query asked; another query clears it. */
  @state()
  private _asked: { question: ModelQuestion; bindings: QuestionBindings; query: string } | null = null;

  /** Prefixes the shown result is written with. */
  private _prefixes: Record<string, string> = { ...NAMESPACES };

  /** The shown SELECT's columns, from its projection. */
  private _columns: string[] | undefined;

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
    // An edited question is another query: what a row means may no longer hold.
    if (this._asked && this._asked.query.trim() !== sparql) this._asked = null;
    this._prefixes = { ...NAMESPACES, ...this.extraPrefixes, ...this.prefixSource?.() };
    this._columns = projectedVariables(sparql);

    try {
      const result = this.rdfStore.query(sparql);
      this._result = result;

      // Bring the results into sight under a long query.
      void this.updateComplete?.then(() =>
        this.renderRoot?.querySelector('.result-section')?.scrollIntoView?.({ block: 'nearest' }),
      );

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

  /** Put a query in the editor and run it. */
  run(sparql: string): SparqlResult | null {
    this.setQuery(sparql);
    return this.executeQuery();
  }

  /**
   * Open the Questions menu with the workbench's bindings; `focus` asks about
   * that element — only the questions taking `?focus`, bound to it.
   */
  openQuestions(options: { focus?: string } = {}): void {
    const { focus } = options;
    const all = this.questionSource?.() ?? [];
    this._menu = {
      questions: focus ? all.filter((q) => q.parameters.some((p) => p.name === 'focus')) : all,
      bindings: { ...this.bindingSource?.(), ...(focus ? { focus } : {}) },
      ...(focus ? { about: focus } : {}),
    };
    void this.updateComplete.then(() => this._menuButtons()[0]?.focus());
  }

  /** Close the Questions menu. */
  closeQuestions(): void {
    this._menu = null;
  }

  /** Whether the Questions menu is open. */
  get questionsOpen(): boolean {
    return this._menu !== null;
  }

  /**
   * Ask a question: its query — prefixes, `bindings` (the workbench's, by
   * default) as `VALUES`, its `LIMIT` — in the editor, run, and shown with
   * what a row means and what it does not prove.
   */
  ask(question: ModelQuestion, bindings: QuestionBindings = this.bindingSource?.() ?? {}): SparqlResult | null {
    this._menu = null;
    let query: string;
    try {
      query = buildQuery(question, bindings);
    } catch (err: unknown) {
      this._asked = null;
      this._result = null;
      this._error = err instanceof Error ? err.message : String(err);
      return null;
    }
    this.setQuery(query);
    this._asked = { question, bindings, query };
    return this.executeQuery();
  }

  private _onViewClick(): void {
    const iris = resultIris(this._result);
    if (iris.length === 0) return;
    const asked = this._asked;
    const viewpoint = asked ? viewpointOfAnswer(asked.question, asked.bindings) : undefined;
    this.dispatchEvent(
      new CustomEvent<ResultsViewRequestDetail>('results-view-request', {
        detail: { iris, ...(asked ? { label: asked.question.label } : {}), ...(viewpoint ? { viewpoint } : {}) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _name(iri: string): string {
    return this.labelFor?.(iri) || curieOf(iri, this._prefixes ?? NAMESPACES);
  }

  /** The menu's questions that can be asked, in order. */
  private _menuButtons(): HTMLButtonElement[] {
    return [...(this.renderRoot?.querySelectorAll<HTMLButtonElement>('.questions-menu button.question:not([disabled])') ?? [])];
  }

  /** Escape closes the menu; the arrow keys move between the questions that can be asked. */
  private _onMenuKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeQuestions();
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLButtonElement>('.questions-btn')?.focus());
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = this._menuButtons();
    const at = buttons.indexOf((this.renderRoot as ShadowRoot).activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, buttons.length - 1) : Math.max(at - 1, 0);
    buttons[next]?.focus();
  }

  private _onIriClick(e: Event, iri: string): void {
    e.preventDefault();
    this.dispatchEvent(
      new CustomEvent<SparqlSelectDetail>('sparql-select', { detail: { iri }, bubbles: true, composed: true }),
    );
  }

  /** A value in a table: an IRI as a prefixed name that selects it, else its text. */
  _renderTerm(term: any): unknown {
    if (!isIri(term)) return termValue(term);
    const iri = term.value as string;
    return html`<a class="iri" href="#" title=${iri} @click=${(e: Event) => this._onIriClick(e, iri)}
      >${curieOf(iri, this._prefixes ?? NAMESPACES)}</a
    >`;
  }

  _renderViewButton(): unknown {
    if (resultIris(this._result).length === 0) return nothing;
    const viewpoint = this._asked ? viewpointOfAnswer(this._asked.question, this._asked.bindings) : undefined;
    const title = `A new view with the elements and relationships in these results${viewpoint ? `, following the ${this._name(viewpoint)}` : ''}`;
    return html`<button class="view-btn" title=${title} @click=${this._onViewClick}>Render as new view</button>`;
  }

  /** The question the result answers: what a row means, what it does not prove — and, for a finding, when there is none. */
  _renderAsked(rows?: number): unknown {
    const question = this._asked?.question;
    if (!question) return nothing;
    return html`<div class="asked">
      <div class="asked-label">
        ${question.label}
        ${question.isFinding && rows === 0 ? html`<span class="none-found">None found.</span>` : nothing}
      </div>
      ${question.answers ? html`<div><span class="asked-key">A row:</span> ${question.answers}</div>` : nothing}
      ${question.doesNotProve ? html`<div><span class="asked-key">Does not prove:</span> ${question.doesNotProve}</div>` : nothing}
    </div>`;
  }

  _renderQuestionsMenu(): unknown {
    const menu = this._menu;
    if (!menu) return nothing;
    const viewpoint = typeof menu.bindings.viewpoint === 'string' ? menu.bindings.viewpoint : undefined;
    const concerns = [...new Set(menu.questions.flatMap((q) => q.concerns))]
      .map((iri) => ({ iri, label: this._name(iri) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const concern = concerns.some((c) => c.iri === this._concern) ? this._concern : '';
    // Asked about an element, the view's fit is beside the point.
    const groups = questionGroups(menu.questions, { ...(menu.about ? {} : { viewpoint }), concern });
    const bound = boundParameters(menu.bindings).filter(([title]) => !(menu.about && title === 'Element'));
    return html`
      <div class="questions-menu" role="menu" aria-label="Questions" @keydown=${this._onMenuKey}>
        <div class="menu-head">
          <span class="menu-title">${menu.about ? html`About <strong>${this._name(menu.about)}</strong>` : 'Questions'}</span>
          ${concerns.length > 0
            ? html`<select
                class="concern"
                aria-label="Concern"
                title="Only the questions addressing a concern"
                @change=${(e: Event) => (this._concern = (e.target as HTMLSelectElement).value)}
              >
                <option value="" ?selected=${!concern}>All concerns</option>
                ${concerns.map((c) => html`<option value=${c.iri} ?selected=${c.iri === concern}>${c.label}</option>`)}
              </select>`
            : nothing}
          <button class="menu-close" title="Close" aria-label="Close" @click=${() => this.closeQuestions()}>×</button>
        </div>
        ${bound.length > 0
          ? html`<div class="bound" title="What the questions are asked about">
              ${bound.map(([title, iri]) => html`<span title=${iri}><span class="bound-name">${title}:</span> ${this._name(iri)}</span>`)}
            </div>`
          : nothing}
        ${groups.length === 0
          ? html`<div class="menu-empty">
              ${menu.questions.length > 0 ? 'No question addresses this concern.' : 'No questions: the loaded languages publish none.'}
            </div>`
          : groups.map(
              (group) => html`<div class="menu-group" role="group" aria-label=${group.title}>
                <div class="group-title">${group.title}</div>
                ${group.questions.map((q) => this._renderQuestion(q, menu.bindings))}
              </div>`,
            )}
      </div>
    `;
  }

  private _renderQuestion(question: ModelQuestion, bindings: QuestionBindings): unknown {
    const missing = whatToSelect(question, bindings);
    const severity = question.severity ? question.severity.slice(question.severity.lastIndexOf('#') + 1).toLowerCase() : '';
    return html`<button
      class="question"
      role="menuitem"
      data-iri=${question.iri}
      title=${question.description ?? question.label}
      ?disabled=${!!missing}
      @click=${() => this.ask(question, bindings)}
    >
      <span class="q-label">${question.label}</span>
      ${question.isFinding ? html`<span class="q-finding ${severity}" title="Its rows are problems">finding</span>` : nothing}
      ${missing ? html`<span class="q-missing">${missing}</span>` : nothing}
    </button>`;
  }

  _renderCount(count: number, noun: string): string {
    return `${count} ${noun}${count > MAX_RESULT_ROWS ? ` — the first ${MAX_RESULT_ROWS} shown` : ''}`;
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
    const found = extractColumns(results);
    const columns = this._columns ? [...this._columns, ...found.filter((c) => !this._columns!.includes(c))] : found;
    if (columns.length === 0) {
      return html`<div class="result-info">No results</div>`;
    }
    return html`
      <div class="result-section">
        <div class="result-bar">
          <span class="result-info">${this._renderCount(results.length, 'result(s)')}</span>
          ${this._renderViewButton()}
        </div>
        <table class="result-table">
          <thead>
            <tr>${columns.map((c) => html`<th>${c}</th>`)}</tr>
          </thead>
          <tbody>
            ${results.slice(0, MAX_RESULT_ROWS).map(
              (row) => html`
                <tr>${columns.map((c) => html`<td>${this._renderTerm(row[c])}</td>`)}</tr>
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
        <div class="result-bar">
          <span class="construct-count">${this._renderCount(quads.length, 'triple(s)')}</span>
          ${this._renderViewButton()}
        </div>
        ${quads.length > 0
          ? html`<table class="result-table">
              <thead>
                <tr><th>subject</th><th>predicate</th><th>object</th></tr>
              </thead>
              <tbody>
                ${quads.slice(0, MAX_RESULT_ROWS).map(
                  (q) => html`<tr>
                    <td>${this._renderTerm(q.subject)}</td>
                    <td>${this._renderTerm(q.predicate)}</td>
                    <td>${this._renderTerm(q.object)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`
          : nothing}
      </div>
    `;
  }

  _renderResult(): unknown {
    if (!this._result) return nothing;

    switch (this._result.type) {
      case 'bindings':
        return html`${this._renderAsked(this._result.results.length)}${this._renderBindingsResult(this._result.results)}`;
      case 'boolean':
        return html`${this._renderAsked()}${this._renderBooleanResult(this._result.value)}`;
      case 'quads':
        return html`${this._renderAsked(this._result.quads.length)}${this._renderQuadsResult(this._result.quads)}`;
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
        ${this.questionSource
          ? html`<button
              class="questions-btn"
              aria-haspopup="menu"
              aria-expanded=${this._menu ? 'true' : 'false'}
              title="Questions the loaded languages ask of a model: pick one to run its query"
              ?disabled=${!this.rdfStore}
              @click=${() => (this._menu ? this.closeQuestions() : this.openQuestions())}
            >
              Questions ▾
            </button>`
          : nothing}
      </div>
      ${this._renderQuestionsMenu()}
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
