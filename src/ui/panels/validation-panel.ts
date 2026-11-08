/**
 * Validation Panel — Lit component displaying SHACL validation results.
 *
 * Shows validation results grouped by severity (Violation, Warning, Info),
 * with click-to-navigate to focus node on Canvas and visual highlighting
 * of elements/relationships with violations. Supports real-time incremental
 * validation feedback via EventBus integration.
 *
 * Of a scope, remembered per browser: the **open view** (the default) — the
 * findings on the view, the concepts it presents and the nodes and links of
 * its diagram, with how many more the rest of the model has — or the whole
 * **model**. The host says what the open view covers (`viewIris`); with no view
 * open, the panel shows the model. While another model's first findings are
 * awaited (`validating`), it says so rather than conform.
 *
 * Beside the SHACL results, the **model checks** (`checks`): the findings of
 * the loaded languages' finding questions, asked on request
 * (`model-checks-request`), shown, scoped and counted as the SHACL results
 * are; the panel says how many ran, which stopped at their limit, which could
 * not run and why, and when the model has changed since.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  ValidationResult,
  ValidationReport,
  ShaclValidator,
} from '../../rdf-engine/interfaces.js';
import type { Quad, NamedNode } from '@rdfjs/types';
import { isIri as isIriValue, isLink, shapeIriOf } from '../../rdf-engine/finding-shape.js';

// ── Types ───────────────────────────────────────────────────────────────

/** Detail emitted when the user clicks a validation result to navigate. */
export interface ValidationNavigateDetail {
  focusNodeIri: string;
}

/** Detail emitted to highlight violated elements on the canvas. */
export interface ValidationHighlightDetail {
  iris: string[];
}

/** What the panel shows the findings of: the open view, or the whole model. */
export type ValidationScope = 'view' | 'model';

/** The scopes, in the order offered. */
export const VALIDATION_SCOPES: ReadonlyArray<{ id: ValidationScope; label: string; title: string }> = [
  { id: 'view', label: 'View', title: 'Findings on the open view: the view, the concepts it presents, and its diagram' },
  { id: 'model', label: 'Model', title: 'Findings across the whole model' },
];

/** Detail of `validation-scope-change`: the scope now shown. */
export interface ValidationScopeDetail {
  scope: ValidationScope;
}

/** localStorage key of the scope shown. */
const SCOPE_KEY = 'la-gram:validation-scope';

function storedScope(): ValidationScope {
  try {
    const value = globalThis.localStorage?.getItem(SCOPE_KEY);
    return VALIDATION_SCOPES.find((s) => s.id === value)?.id ?? 'view';
  } catch {
    return 'view';
  }
}

/** A finding's concept, in words: its name — or its ends', or none — and its type. */
export interface FocusDescription {
  name: string;
  /** The type, in words (`Business Actor`); none for the model. */
  type?: string;
  /** It has no name of its own: `name` says so ("Unnamed"). */
  unnamed?: boolean;
}

/** The model checks' last run, as the panel reports it. */
export interface ModelChecksState {
  /** Their findings, as validation results: the question as the message, its IRI as the source shape. */
  results: ValidationResult[];
  /** How many checks ran. */
  ran: number;
  /** The checks that could not run, and why. */
  failed: Array<{ label: string; reason: string }>;
  /** The checks that stopped at their limit: there may be more findings. */
  capped: Array<{ label: string; limit: number }>;
  /** The model has changed since they ran. */
  stale?: boolean;
}

/** Groups validation results by severity. */
export interface GroupedResults {
  violations: ValidationResult[];
  warnings: ValidationResult[];
  infos: ValidationResult[];
}

// ── Helper functions ────────────────────────────────────────────────────

/** Extracts the local/fragment part of an IRI for display. */
export function iriLabel(iri: string): string {
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx >= 0) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx >= 0) return iri.slice(slashIdx + 1);
  return iri;
}

/** Groups an array of ValidationResult by severity. */
export function groupBySeverity(results: ValidationResult[]): GroupedResults {
  const violations: ValidationResult[] = [];
  const warnings: ValidationResult[] = [];
  const infos: ValidationResult[] = [];
  for (const r of results) {
    switch (r.severity) {
      case 'Violation': violations.push(r); break;
      case 'Warning': warnings.push(r); break;
      case 'Info': infos.push(r); break;
    }
  }
  return { violations, warnings, infos };
}

/** Builds the summary header text from a ValidationReport; `subject` says what conforms. */
export function buildSummary(conforms: boolean, results: ValidationResult[], subject = 'Model'): string {
  if (conforms) return `✓ ${subject} conforms`;
  const grouped = groupBySeverity(results);
  const parts: string[] = [];
  if (grouped.violations.length > 0) {
    parts.push(`${grouped.violations.length} violation(s)`);
  }
  if (grouped.warnings.length > 0) {
    parts.push(`${grouped.warnings.length} warning(s)`);
  }
  if (grouped.infos.length > 0) {
    parts.push(`${grouped.infos.length} info(s)`);
  }
  return `✗ ${parts.join(', ')}`;
}

/** Whether a term's value is an IRI (`scheme:…`), not a blank node's id (`e7c5f6…`, `_:b0`). */
export const isIri = isIriValue;

/** The findings whose focus node is one of `iris`: a view's. */
export function resultsWithin(results: ValidationResult[], iris: ReadonlySet<string>): ValidationResult[] {
  return results.filter((r) => iris.has(r.focusNode?.value));
}

/** Extracts unique focus node IRIs from validation results. */
export function extractViolatedIris(results: ValidationResult[]): string[] {
  const set = new Set<string>();
  for (const r of results) {
    if (r.focusNode?.value) set.add(r.focusNode.value);
  }
  return [...set];
}

/**
 * A shape, or a check, by name: a link to its IRI — the metamodel's page for it
 * — when the IRI is a web address; the IRI itself shown on hover. Opening it does
 * not also show the finding's concept.
 */
function shapeLink(iri: string): unknown {
  if (!isLink(iri)) return html`<span title=${iri}>${iriLabel(iri)}</span>`;
  const keep = (e: Event) => e.stopPropagation();
  return html`<a class="shape" href=${iri} target="_blank" rel="noopener noreferrer" title=${iri} @click=${keep} @keydown=${keep}
    >${iriLabel(iri)}</a
  >`;
}

// ── Lit Component ───────────────────────────────────────────────────────

@customElement('validation-panel')
export class ValidationPanel extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
    }

    .panel-header select.scope {
      margin-left: auto;
      font-size: 11px;
      font-weight: normal;
      padding: 1px 2px;
    }

    .summary .rest {
      margin-left: 6px;
      padding: 0;
      border: none;
      background: none;
      color: #1a73e8;
      font: inherit;
      font-weight: normal;
      cursor: pointer;
    }

    .summary .rest:hover {
      text-decoration: underline;
    }

    .summary {
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 500;
    }

    .summary.conforms {
      color: #2e7d32;
    }

    .summary.non-conforms {
      color: #c62828;
    }

    .summary.validating {
      color: #5f6368;
      font-style: italic;
    }

    .severity-group {
      margin: 4px 0 8px;
    }

    .severity-header {
      padding: 4px 12px;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      cursor: pointer;
      user-select: none;
      background: #f8f9fa;
      border-top: 1px solid #e8eaed;
      border-bottom: 1px solid #e8eaed;
    }

    .severity-header.violation { color: #c62828; }
    .severity-header.warning { color: #e65100; }
    .severity-header.info { color: #1565c0; }

    .severity-items.hidden {
      display: none;
    }

    /* One finding a row: a bar in its severity's colour, a line under it. */
    .result-item {
      --severity: #c62828;
      padding: 6px 12px 7px 10px;
      border-left: 3px solid var(--severity);
      border-bottom: 1px solid #eceff1;
      cursor: pointer;
      line-height: 1.35;
    }

    .result-item.warning { --severity: #e65100; }
    .result-item.info { --severity: #1565c0; }

    .result-item:hover {
      background: #f5f8fc;
    }

    .result-item:focus-visible {
      outline: 2px solid #1a73e8;
      outline-offset: -2px;
    }

    .result-focus {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 6px;
      font-weight: 600;
      color: #202124;
      overflow-wrap: anywhere;
    }

    .result-focus .unnamed {
      font-style: italic;
      font-weight: 500;
      color: #5f6368;
    }

    .result-focus .type {
      font-size: 11px;
      font-weight: normal;
      color: #5f6368;
    }

    .result-message {
      margin-top: 1px;
      color: #3c4043;
      overflow-wrap: anywhere;
    }

    .result-details {
      margin-top: 3px;
      font-size: 11px;
      color: #5f6368;
    }

    .result-details .field {
      color: #3c4043;
      font-weight: 500;
    }

    .result-details a.shape {
      color: #1a73e8;
      text-decoration: none;
    }

    .result-details a.shape:hover,
    .result-details a.shape:focus-visible {
      text-decoration: underline;
    }

    .panel-header .checks-btn {
      font-size: 11px;
      font-weight: normal;
      padding: 1px 8px;
      border: 1px solid #bbb;
      border-radius: 3px;
      background: #fff;
      cursor: pointer;
    }

    .panel-header .checks-btn:hover:not(:disabled) {
      background: #f1f3f4;
    }

    .panel-header .checks-btn:disabled {
      color: #9aa0a6;
      cursor: default;
    }

    .checks-status {
      padding: 0 12px 6px;
      font-size: 11px;
      color: #5f6368;
    }

    .checks-status .stale {
      color: #b05a00;
    }

    .checks-status ul {
      margin: 2px 0 0;
      padding-left: 16px;
    }
  `;

  /** Validation results to display. */
  @property({ attribute: false })
  results: ValidationResult[] = [];

  /** Whether the model conforms to all SHACL shapes. */
  @property({ type: Boolean })
  conforms = true;

  /** Optional SHACL validator for running validation. */
  @property({ attribute: false })
  validator?: ShaclValidator;

  /** Data graph quads for validation. */
  @property({ attribute: false })
  dataGraph?: Quad[];

  /** Shapes graph quads for validation. */
  @property({ attribute: false })
  shapesGraph?: Quad[];

  /** Names concepts (their `skos:prefLabel`) instead of showing IRI tails. */
  @property({ attribute: false })
  labelFor?: (iri: string) => string;

  /** Describes a finding's concept — name and type — as the model tree does; else `labelFor` names it. */
  @property({ attribute: false })
  describe?: (iri: string) => FocusDescription;

  /** Names a finding's property as the Properties tab does (`Name` for `skos:prefLabel`). */
  @property({ attribute: false })
  fieldNameFor?: (predicate: string) => string;

  /** Whether the findings are being awaited: another model was opened, and none of its have come yet. */
  @property({ type: Boolean })
  validating = false;

  /** What the open view covers, by IRI (`viewMembers`); none when no view is open. */
  @property({ attribute: false })
  viewIris?: ReadonlySet<string>;

  /** The model checks' last run; none until they are asked for, or after another model is opened. */
  @property({ attribute: false })
  checks?: ModelChecksState;

  /** How many model checks the loaded languages offer; the action is shown when there are any. */
  @property({ type: Number })
  checksAvailable = 0;

  /** Whether the model checks are running. */
  @property({ type: Boolean })
  checking = false;

  /** The model checks' results, told from the SHACL results when a row is drawn. */
  private _checkResults: ReadonlySet<ValidationResult> = new Set();

  @state()
  private _collapsedSeverities = new Set<string>();

  @state()
  private _scope: ValidationScope = storedScope();

  /** The scope chosen; remembered per browser. */
  get scope(): ValidationScope {
    return this._scope;
  }

  /** Show another scope; remembered per browser, and announced (`validation-scope-change`). */
  set scope(scope: ValidationScope) {
    if (scope === this._scope) return;
    this._scope = scope;
    try {
      globalThis.localStorage?.setItem(SCOPE_KEY, scope);
    } catch {
      // Not remembered: private browsing or storage blocked.
    }
    this.dispatchEvent(
      new CustomEvent<ValidationScopeDetail>('validation-scope-change', { detail: { scope }, bubbles: true, composed: true }),
    );
  }

  /** The scope shown: the model when no view is open. */
  get shownScope(): ValidationScope {
    return this._scope === 'view' && this.viewIris ? 'view' : 'model';
  }

  /** Every finding: the SHACL results, then the model checks'. */
  get allResults(): ValidationResult[] {
    return this.checks?.results.length ? [...this.results, ...this.checks.results] : this.results;
  }

  /** The findings shown, of the scope shown. */
  get shownResults(): ValidationResult[] {
    const all = this.allResults;
    return this.shownScope === 'view' ? resultsWithin(all, this.viewIris!) : all;
  }

  /** Ask for the model checks to run (`model-checks-request`). */
  requestChecks(): void {
    this.dispatchEvent(new CustomEvent('model-checks-request', { bubbles: true, composed: true }));
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('checks')) this._checkResults = new Set(this.checks?.results ?? []);
  }

  /**
   * Runs SHACL validation using the configured validator and graphs.
   * Updates `results` and `conforms` properties and dispatches
   * a `validation-highlight` event with violated IRIs.
   */
  runValidation(): ValidationReport | null {
    if (!this.validator || !this.dataGraph || !this.shapesGraph) {
      return null;
    }
    const report = this.validator.validate(this.dataGraph, this.shapesGraph);
    this.conforms = report.conforms;
    this.results = report.results;

    this._emitHighlight();
    return report;
  }

  /**
   * Runs incremental validation for a single changed resource.
   */
  runIncrementalValidation(changedResource: NamedNode): ValidationReport | null {
    if (!this.validator || !this.dataGraph || !this.shapesGraph) {
      return null;
    }
    const report = this.validator.validateIncremental(
      changedResource,
      this.dataGraph,
      this.shapesGraph,
    );
    this.conforms = report.conforms;
    this.results = report.results;

    this._emitHighlight();
    return report;
  }

  private _emitHighlight(): void {
    const iris = extractViolatedIris(this.results);
    this.dispatchEvent(
      new CustomEvent<ValidationHighlightDetail>('validation-highlight', {
        detail: { iris },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onResultClick(result: ValidationResult): void {
    this.dispatchEvent(
      new CustomEvent<ValidationNavigateDetail>('validation-navigate', {
        detail: { focusNodeIri: result.focusNode.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _toggleSeverity(severity: string): void {
    if (this._collapsedSeverities.has(severity)) {
      this._collapsedSeverities.delete(severity);
    } else {
      this._collapsedSeverities.add(severity);
    }
    this.requestUpdate();
  }

  _renderResultItem(result: ValidationResult): unknown {
    const focus = result.focusNode.value;
    const about = this.describe?.(focus) ?? { name: this.labelFor?.(focus) ?? iriLabel(focus) };
    // A path or shape written inline in the shapes is a blank node: its id says
    // nothing. The validator hands every term on as a named node, so it is told by its value.
    const named = (term: { termType?: string; value: string } | undefined) =>
      term && term.termType !== 'BlankNode' && isIri(term.value) ? term.value : undefined;
    const path = named(result.resultPath);
    // A shape written inline points to the named shape it is written in.
    const shape = shapeIriOf(result);
    const check = this._checkResults.has(result);
    return html`
      <div
        class="result-item ${result.severity.toLowerCase()}"
        role="button"
        tabindex="0"
        title="Show the concept"
        @click=${() => this._onResultClick(result)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          this._onResultClick(result);
        }}
      >
        <div class="result-focus">
          <span class=${about.unnamed ? 'unnamed' : 'name'} title=${focus}>${about.name}</span>
          ${about.type ? html`<span class="type">${about.type}</span>` : nothing}
        </div>
        <div class="result-message">${result.message}</div>
        <div class="result-details">
          ${path
            ? html`Property: <span class="field" title=${path}>${this.fieldNameFor?.(path) ?? iriLabel(path)}</span>`
            : nothing}
          ${path && shape ? html` · ` : nothing}
          ${shape ? html`${check ? 'Check' : 'Shape'}: ${shapeLink(shape)}` : nothing}
        </div>
      </div>
    `;
  }

  _renderSeverityGroup(
    label: string,
    severity: string,
    items: ValidationResult[],
  ): unknown {
    if (items.length === 0) return nothing;
    const collapsed = this._collapsedSeverities.has(severity);
    return html`
      <div class="severity-group">
        <div
          class="severity-header ${severity.toLowerCase()}"
          @click=${() => this._toggleSeverity(severity)}
        >
          ${collapsed ? '▸' : '▾'} ${label} (${items.length})
        </div>
        <div class="severity-items ${collapsed ? 'hidden' : ''}">
          ${items.map((r) => this._renderResultItem(r))}
        </div>
      </div>
    `;
  }

  override render() {
    const inView = this.shownScope === 'view';
    const shown = this.shownResults;
    // A view conforms when none of the findings are on it; the model, when no shape and no check finds anything.
    const conforms = inView ? shown.length === 0 : this.conforms && !this.checks?.results.length;
    const grouped = groupBySeverity(shown);
    const summary = buildSummary(conforms, shown, inView ? 'View' : 'Model');
    const rest = inView ? this.allResults.length - shown.length : 0;
    return html`
      <div class="panel-header">
        Validation
        ${this.checksAvailable > 0
          ? html`<button
              class="checks-btn"
              title=${`Ask the ${this.checksAvailable} finding questions of the loaded languages — orphans, unrealised services, unrealised requirements… — and list their findings here`}
              ?disabled=${this.checking}
              @click=${() => this.requestChecks()}
            >
              ${this.checking ? 'Checking…' : this.checks ? 'Run checks again' : 'Model checks'}
            </button>`
          : nothing}
        <select
          class="scope"
          aria-label="Findings of"
          title=${VALIDATION_SCOPES.find((o) => o.id === this.shownScope)?.title ?? ''}
          @change=${(e: Event) => (this.scope = (e.target as HTMLSelectElement).value as ValidationScope)}
        >
          ${VALIDATION_SCOPES.map(
            (o) => html`<option
              value=${o.id}
              title=${o.id === 'view' && !this.viewIris ? 'No view is open' : o.title}
              ?disabled=${o.id === 'view' && !this.viewIris}
              ?selected=${o.id === this.shownScope}
            >${o.label}</option>`,
          )}
        </select>
      </div>
      ${this.validating && this.results.length === 0
        ? html`<div class="summary validating">Validating…</div>`
        : this._renderSummary(conforms, summary, rest)}
      ${this._renderChecksStatus()}
      ${this._renderSeverityGroup('Violations', 'Violation', grouped.violations)}
      ${this._renderSeverityGroup('Warnings', 'Warning', grouped.warnings)}
      ${this._renderSeverityGroup('Info', 'Info', grouped.infos)}
    `;
  }

  /** How the model checks went: how many ran and found, which stopped at their limit, which could not run. */
  private _renderChecksStatus(): unknown {
    const checks = this.checks;
    if (!checks) return nothing;
    const found = checks.results.length;
    return html`
      <div class="checks-status">
        Model checks: ${checks.ran} run, ${found} finding${found === 1 ? '' : 's'}${checks.stale
          ? html` — <span class="stale">the model has changed since they ran</span>`
          : nothing}
        ${checks.capped.length > 0 || checks.failed.length > 0
          ? html`<ul>
              ${checks.capped.map((c) => html`<li>“${c.label}” stopped at ${c.limit}: there may be more.</li>`)}
              ${checks.failed.map((f) => html`<li>“${f.label}” could not run: ${f.reason}</li>`)}
            </ul>`
          : nothing}
      </div>
    `;
  }

  private _renderSummary(conforms: boolean, summary: string, rest: number): unknown {
    return html`
      <div class="summary ${conforms ? 'conforms' : 'non-conforms'}">
        ${summary}
        ${rest > 0
          ? html`<button class="rest" title="Show the whole model's findings" @click=${() => (this.scope = 'model')}>
              ${rest} more in the model
            </button>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'validation-panel': ValidationPanel;
  }
}
