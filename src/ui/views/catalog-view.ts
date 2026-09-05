/**
 * Catalog View — tabular rendering of architecture elements filtered by type.
 *
 * Queries the RDF store for all elements of a given type and displays them
 * in a table with columns for each property (skos:prefLabel, skos:definition,
 * custom properties). Supports inline editing: clicking a cell makes it
 * editable; on blur/enter the change is propagated via ElementManager.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Quad, NamedNode } from '@rdfjs/types';
import type { RdfStore } from '../../rdf-engine/interfaces.js';
import type { ElementManager } from '../../model-manager/interfaces.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

// ── Well-known predicate IRIs ───────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const SKOS_DEFINITION = NAMESPACES.skos + 'definition';

/** A single row in the catalog table. */
export interface CatalogRow {
  /** IRI of the element. */
  iri: string;
  /** Map of predicate IRI → value string. */
  properties: Map<string, string>;
}

/** Detail emitted when a property is edited inline. */
export interface CatalogEditDetail {
  elementIri: string;
  predicate: string;
  value: string;
}

/** Detail emitted when a row is clicked/selected. */
export interface CatalogSelectDetail {
  iri: string;
}

/** Column definition for the catalog table. */
export interface CatalogColumn {
  /** Full predicate IRI. */
  predicate: string;
  /** Human-readable header label. */
  label: string;
}

// ── Pure functions (exported for unit testing) ──────────────────────────

/**
 * Derives a short human-readable label from a full IRI.
 * Uses the fragment after `#` or the last path segment.
 */
export function iriLabel(iri: string): string {
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx !== -1) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx !== -1) return iri.slice(slashIdx + 1);
  return iri;
}

/**
 * Discovers the set of columns (predicates) used by elements of the given type.
 *
 * Queries all quads for elements matching the type filter, collects unique predicates
 * (excluding rdf:type), and returns them as CatalogColumn entries.
 * skos:prefLabel and skos:definition are placed first if present.
 *
 * @param quads - All quads from the RDF store
 * @param typeFilter - The rdf:type IRI to filter elements by
 * @returns Ordered array of column definitions
 */
export function discoverColumns(quads: Quad[], typeFilter: string): CatalogColumn[] {
  // Find all element IRIs of the given type
  const elementIris = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE && q.object.value === typeFilter) {
      elementIris.add(q.subject.value);
    }
  }

  // Collect unique predicates from those elements (excluding rdf:type)
  const predicateSet = new Set<string>();
  for (const q of quads) {
    if (elementIris.has(q.subject.value) && q.predicate.value !== RDF_TYPE) {
      predicateSet.add(q.predicate.value);
    }
  }

  // Build columns with well-known ones first
  const wellKnownOrder = [SKOS_PREF_LABEL, SKOS_DEFINITION];
  const columns: CatalogColumn[] = [];

  for (const wk of wellKnownOrder) {
    if (predicateSet.has(wk)) {
      columns.push({ predicate: wk, label: iriLabel(wk) });
      predicateSet.delete(wk);
    }
  }

  // Remaining predicates sorted alphabetically by label
  const remaining = [...predicateSet].sort((a, b) => iriLabel(a).localeCompare(iriLabel(b)));
  for (const pred of remaining) {
    columns.push({ predicate: pred, label: iriLabel(pred) });
  }

  return columns;
}

/**
 * Builds catalog rows from RDF quads for elements matching the type filter.
 *
 * @param quads - All quads from the RDF store
 * @param typeFilter - The rdf:type IRI to filter elements by
 * @param columns - Column definitions (predicates to include)
 * @returns Array of CatalogRow objects
 */
export function buildCatalogRows(
  quads: Quad[],
  typeFilter: string,
  columns: CatalogColumn[],
): CatalogRow[] {
  // Find all element IRIs of the given type
  const elementIris = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE && q.object.value === typeFilter) {
      elementIris.add(q.subject.value);
    }
  }

  // Build a map of element IRI → property map
  const rowMap = new Map<string, Map<string, string>>();
  for (const iri of elementIris) {
    rowMap.set(iri, new Map());
  }

  const columnPredicates = new Set(columns.map((c) => c.predicate));
  for (const q of quads) {
    if (elementIris.has(q.subject.value) && columnPredicates.has(q.predicate.value)) {
      rowMap.get(q.subject.value)!.set(q.predicate.value, q.object.value);
    }
  }

  // Convert to CatalogRow array, sorted by prefLabel then IRI
  const rows: CatalogRow[] = [];
  for (const [iri, properties] of rowMap) {
    rows.push({ iri, properties });
  }

  rows.sort((a, b) => {
    const labelA = a.properties.get(SKOS_PREF_LABEL) ?? a.iri;
    const labelB = b.properties.get(SKOS_PREF_LABEL) ?? b.iri;
    return labelA.localeCompare(labelB);
  });

  return rows;
}

// ── Lit Component ───────────────────────────────────────────────────────

@customElement('catalog-view')
export class CatalogView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
      overflow: auto;
    }

    .catalog-header {
      padding: 8px 12px;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
    }

    .empty-message {
      padding: 16px 12px;
      color: #888;
      font-style: italic;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }

    th {
      text-align: left;
      padding: 6px 10px;
      background: #f5f5f5;
      border-bottom: 2px solid #ddd;
      font-weight: 600;
      font-size: 12px;
      color: #555;
      white-space: nowrap;
    }

    td {
      padding: 4px 10px;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;
    }

    tr:hover td {
      background: #e8f0fe;
    }

    tr.selected td {
      background: #d2e3fc;
    }

    .cell-editing {
      padding: 2px 6px;
    }

    .cell-input {
      width: 100%;
      box-sizing: border-box;
      padding: 3px 6px;
      border: 1px solid #1a73e8;
      border-radius: 3px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      box-shadow: 0 0 0 1px #1a73e8;
    }
  `;

  /** Reference to the RDF store for querying elements. */
  @property({ attribute: false })
  rdfStore?: RdfStore;

  /** The rdf:type IRI to filter elements by. */
  @property({ type: String })
  typeFilter = '';

  /** Optional ElementManager for propagating inline edits. */
  @property({ attribute: false })
  elementManager?: ElementManager;

  /** IRI of the currently selected row. */
  @property({ type: String })
  selectedIri = '';

  @state()
  private _columns: CatalogColumn[] = [];

  @state()
  private _rows: CatalogRow[] = [];

  /** Tracks which cell is being edited: `${iri}|${predicate}` or empty. */
  @state()
  private _editingCell = '';

  @state()
  private _editValue = '';

  override willUpdate(changedProperties: Map<string, unknown>): void {
    if (
      changedProperties.has('rdfStore') ||
      changedProperties.has('typeFilter')
    ) {
      this._rebuildTable();
    }
  }

  private _rebuildTable(): void {
    if (!this.rdfStore || !this.typeFilter) {
      this._columns = [];
      this._rows = [];
      return;
    }
    const quads = this.rdfStore.getQuads();
    this._columns = discoverColumns(quads, this.typeFilter);
    this._rows = buildCatalogRows(quads, this.typeFilter, this._columns);
  }

  private _onRowClick(iri: string): void {
    this.selectedIri = iri;
    this.dispatchEvent(
      new CustomEvent<CatalogSelectDetail>('catalog-select', {
        detail: { iri },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _startEdit(iri: string, predicate: string, currentValue: string): void {
    this._editingCell = `${iri}|${predicate}`;
    this._editValue = currentValue;
  }

  private _commitEdit(iri: string, predicate: string): void {
    const newValue = this._editValue;
    this._editingCell = '';

    if (this.elementManager) {
      const valueTerm = { value: newValue, termType: 'Literal' } as unknown as import('@rdfjs/types').Term;
      this.elementManager.updateProperty(iri, predicate, valueTerm);
    }

    this.dispatchEvent(
      new CustomEvent<CatalogEditDetail>('catalog-edit', {
        detail: { elementIri: iri, predicate, value: newValue },
        bubbles: true,
        composed: true,
      }),
    );

    this._rebuildTable();
  }

  private _onCellKeydown(e: KeyboardEvent, iri: string, predicate: string): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._commitEdit(iri, predicate);
    } else if (e.key === 'Escape') {
      this._editingCell = '';
    }
  }

  private _renderCell(row: CatalogRow, col: CatalogColumn) {
    const cellKey = `${row.iri}|${col.predicate}`;
    const value = row.properties.get(col.predicate) ?? '';

    if (this._editingCell === cellKey) {
      return html`
        <td class="cell-editing">
          <input
            class="cell-input"
            .value=${this._editValue}
            @input=${(e: Event) => { this._editValue = (e.target as HTMLInputElement).value; }}
            @blur=${() => this._commitEdit(row.iri, col.predicate)}
            @keydown=${(e: KeyboardEvent) => this._onCellKeydown(e, row.iri, col.predicate)}
          />
        </td>
      `;
    }

    return html`
      <td @dblclick=${() => this._startEdit(row.iri, col.predicate, value)}>
        ${value}
      </td>
    `;
  }

  override render() {
    if (!this.typeFilter) {
      return html`
        <div class="catalog-header">Catalog</div>
        <div class="empty-message">No type filter set</div>
      `;
    }

    if (this._rows.length === 0) {
      return html`
        <div class="catalog-header">Catalog — ${iriLabel(this.typeFilter)}</div>
        <div class="empty-message">No elements of this type</div>
      `;
    }

    return html`
      <div class="catalog-header">Catalog — ${iriLabel(this.typeFilter)}</div>
      <table>
        <thead>
          <tr>
            ${this._columns.map((col) => html`<th>${col.label}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${this._rows.map(
            (row) => html`
              <tr
                class=${this.selectedIri === row.iri ? 'selected' : ''}
                @click=${() => this._onRowClick(row.iri)}
              >
                ${this._columns.map((col) => this._renderCell(row, col))}
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'catalog-view': CatalogView;
  }
}
