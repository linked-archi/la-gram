/**
 * Catalog View — tabular rendering of architecture elements.
 *
 * Opened on a catalog view (`viewIri`), it lists the elements the view presents
 * — its `arch:inView` members, the core's "a Catalog that lists it" — one table
 * per type, with a column for each property they have (skos:prefLabel and
 * skos:definition first; structural links such as `arch:inModel` left out). An
 * "Add" picker adds the model's elements of a type; a row's ✕ removes the
 * element from the catalog (its membership, not the element). Given only a
 * `typeFilter`, it lists every element of that type in the store, as before.
 *
 * Supports inline editing: double-clicking a cell makes it editable; on
 * blur/enter the change is propagated via ElementManager.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Quad, NamedNode } from '@rdfjs/types';
import type { RdfStore } from '@linked-archi/kernel/rdf-engine/interfaces.js';
import { DataFactory } from 'n3';
import type { ElementManager, ViewManager } from '@linked-archi/kernel/model-manager/interfaces.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import { addableTypes, elementsOfType, renderAddPicker, viewMembers, type AddableType, type ViewMember } from './view-members.js';

// ── Well-known predicate IRIs ───────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const SKOS_DEFINITION = NAMESPACES.skos + 'definition';
/** Structural links, not properties a catalog shows: membership, geometry, reification. */
const NOT_COLUMNS = new Set([
  RDF_TYPE,
  NAMESPACES.arch + 'inModel',
  NAMESPACES.arch + 'inView',
  NAMESPACES.rdf + 'reifies',
]);

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
export function discoverColumns(quads: Quad[], typeFilter: string, members?: ReadonlySet<string>): CatalogColumn[] {
  // Find all element IRIs of the given type (of the members, when given)
  const elementIris = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE && q.object.value === typeFilter && (!members || members.has(q.subject.value))) {
      elementIris.add(q.subject.value);
    }
  }

  // Collect unique predicates from those elements (excluding rdf:type and the structural links)
  const predicateSet = new Set<string>();
  for (const q of quads) {
    if (elementIris.has(q.subject.value) && !NOT_COLUMNS.has(q.predicate.value) && q.object.termType !== 'Quad') {
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
  members?: ReadonlySet<string>,
): CatalogRow[] {
  // Find all element IRIs of the given type (of the members, when given)
  const elementIris = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE && q.object.value === typeFilter && (!members || members.has(q.subject.value))) {
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

    .catalog-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 12px;
      border-bottom: 1px solid #eee;
      font-size: 12px;
      color: #444;
    }

    .type-header {
      padding: 10px 12px 4px;
      font-weight: 600;
      font-size: 12px;
      color: #333;
    }

    td.row-actions {
      width: 1%;
      white-space: nowrap;
    }

    td.row-actions button {
      border: none;
      background: none;
      color: #888;
      cursor: pointer;
    }

    td.row-actions button:hover {
      color: #c5221f;
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

  /** The catalog view shown: its members are the rows. Without one, `typeFilter` decides. */
  @property({ type: String })
  viewIri = '';

  /** Changes the catalog's membership (`arch:inView`). */
  @property({ attribute: false })
  viewManager?: ViewManager;

  /** A type's label, as the palette shows it. */
  @property({ attribute: false })
  typeLabelOf: (typeIri: string) => string = iriLabel;

  /** The members, grouped by type, each with its columns and rows. */
  @state()
  private _groups: Array<{ typeIri: string; columns: CatalogColumn[]; rows: CatalogRow[] }> = [];

  @state()
  private _addable: AddableType[] = [];

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
      changedProperties.has('typeFilter') ||
      changedProperties.has('viewIri')
    ) {
      this._rebuildTable();
    }
  }

  /** Re-read the store: after a change to the model. */
  refresh(): void {
    this._rebuildTable();
  }

  private _rebuildTable(): void {
    if (this.rdfStore && this.viewIri) {
      const quads = this.rdfStore.getQuads();
      const members: ViewMember[] = viewMembers(quads, this.viewIri);
      const memberIris = new Set(members.map((m) => m.iri));
      const types = [...new Set(members.map((m) => m.typeIri))].sort((a, b) =>
        this.typeLabelOf(a).localeCompare(this.typeLabelOf(b)),
      );
      this._groups = types.map((typeIri) => {
        const columns = discoverColumns(quads, typeIri, memberIris);
        return { typeIri, columns, rows: buildCatalogRows(quads, typeIri, columns, memberIris) };
      });
      this._addable = addableTypes(quads, this.viewIri);
      return;
    }
    this._groups = [];

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
      // Names and definitions are language-tagged (the Linked.Archi shapes require it).
      const tagged = predicate === SKOS_PREF_LABEL || predicate === SKOS_DEFINITION;
      const valueTerm = (tagged ? DataFactory.literal(newValue, 'en') : DataFactory.literal(newValue)) as unknown as import('@rdfjs/types').Term;
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

  /** Add the model's elements of a type to the catalog. */
  private _addType(typeIri: string): void {
    if (!this.rdfStore || !this.viewManager?.addMember) return;
    for (const iri of elementsOfType(this.rdfStore.getQuads(), typeIri)) this.viewManager.addMember(this.viewIri, iri);
    this._membersChanged();
  }

  /** Take an element out of the catalog (its membership; the element stays in the model). */
  private _remove(iri: string): void {
    this.viewManager?.removeMember?.(this.viewIri, iri);
    this._membersChanged();
  }

  private _membersChanged(): void {
    this._rebuildTable();
    this.dispatchEvent(
      new CustomEvent('view-members-change', { detail: { viewIri: this.viewIri }, bubbles: true, composed: true }),
    );
  }

  private _renderMembers() {
    const picker = this.viewManager?.addMember
      ? renderAddPicker(this._addable, this.typeLabelOf, (typeIri) => this._addType(typeIri))
      : nothing;
    return html`
      <div class="catalog-header">Catalog</div>
      <div class="catalog-toolbar">${picker}</div>
      ${this._groups.length === 0
        ? html`<div class="empty-message">This catalog lists no elements yet. Add the elements of a type.</div>`
        : this._groups.map(
            (group) => html`
              <div class="type-header">${this.typeLabelOf(group.typeIri)} (${group.rows.length})</div>
              <table>
                <thead>
                  <tr>
                    ${group.columns.map((col) => html`<th>${col.label}</th>`)}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${group.rows.map(
                    (row) => html`
                      <tr class=${this.selectedIri === row.iri ? 'selected' : ''} @click=${() => this._onRowClick(row.iri)}>
                        ${group.columns.map((col) => this._renderCell(row, col))}
                        <td class="row-actions">
                          ${this.viewManager?.removeMember
                            ? html`<button
                                title="Remove from this catalog (the element stays in the model)"
                                aria-label="Remove from catalog"
                                @click=${(e: Event) => {
                                  e.stopPropagation();
                                  this._remove(row.iri);
                                }}
                              >
                                ✕
                              </button>`
                            : nothing}
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `,
          )}
    `;
  }

  override render() {
    if (this.viewIri) return this._renderMembers();
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
