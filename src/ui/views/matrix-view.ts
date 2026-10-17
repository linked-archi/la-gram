/**
 * Matrix View — grid showing relationships between two sets of elements.
 *
 * Opened on a matrix view (`viewIri`), its rows and columns are the elements
 * the view presents — its `arch:inView` members, the core's "a Matrix that
 * indexes it" — of a row type and a column type chosen above the grid (or all
 * of them); each cell shows the relationship between the two, if the model has
 * one. An "Add" picker adds the model's elements of a type. The axis choice is
 * kept per view in this browser. Given only `rowTypeFilter` and
 * `columnTypeFilter`, it shows every element of those types in the store, as
 * before.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Quad, NamedNode } from '@rdfjs/types';
import type { RdfStore } from '../../rdf-engine/interfaces.js';
import type { ViewManager } from '../../model-manager/interfaces.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { addableTypes, elementsOfType, renderAddPicker, viewMembers, type AddableType, type ViewMember } from './view-members.js';

/** The axis value meaning "every member". */
export const ALL_MEMBERS = '*';

// ── Well-known predicate IRIs ───────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
/** Endpoints of a qualified relationship (core 0.4). */
const ARCH_SOURCE = NAMESPACES.arch + 'source';
const ARCH_TARGET = NAMESPACES.arch + 'target';
const ARCH_QUALIFIED_RELATIONSHIP = NAMESPACES.arch + 'QualifiedRelationship';
/** Retired endpoint vocabulary, still read for models that predate it. */
const ARCH_REL_SOURCE = NAMESPACES.arch + 'relSource';
const ARCH_REL_TARGET = NAMESPACES.arch + 'relTarget';
const ARCH_REL_PREDICATE = NAMESPACES.arch + 'relPredicate';

// ── Exported interfaces ─────────────────────────────────────────────────

/** A header entry (row or column) in the matrix. */
export interface MatrixHeader {
  /** IRI of the element. */
  iri: string;
  /** Human-readable label. */
  label: string;
}

/** A cell in the matrix grid. */
export interface MatrixCell {
  /** IRI of the row element. */
  rowIri: string;
  /** IRI of the column element. */
  colIri: string;
  /** Relationship type IRI, or empty string if no relationship. */
  relationshipType: string;
  /** Human-readable label of the relationship type, or empty. */
  relationshipLabel: string;
}

/** Detail emitted when a matrix cell is clicked. */
export interface MatrixCellClickDetail {
  /** IRI of the row element. */
  rowIri: string;
  /** IRI of the column element. */
  colIri: string;
  /** Relationship type IRI (empty if no relationship). */
  relationshipType: string;
}

/** Complete matrix data structure. */
export interface MatrixData {
  rows: MatrixHeader[];
  columns: MatrixHeader[];
  /** Map keyed by `${rowIri}|${colIri}` → MatrixCell. */
  cells: Map<string, MatrixCell>;
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
 * Collects all elements of a given rdf:type from quads, returning
 * MatrixHeader entries sorted by label.
 */
export function collectHeaders(quads: Quad[], typeIri: string, members?: ReadonlySet<string>): MatrixHeader[] {
  const elementIris = new Set<string>();
  if (typeIri === ALL_MEMBERS && members) {
    for (const iri of members) elementIris.add(iri);
  }
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE && q.object.value === typeIri && (!members || members.has(q.subject.value))) {
      elementIris.add(q.subject.value);
    }
  }

  // Build label map
  const labelMap = new Map<string, string>();
  for (const q of quads) {
    if (elementIris.has(q.subject.value) && q.predicate.value === SKOS_PREF_LABEL) {
      labelMap.set(q.subject.value, q.object.value);
    }
  }

  const headers: MatrixHeader[] = [];
  for (const iri of elementIris) {
    headers.push({ iri, label: labelMap.get(iri) ?? iriLabel(iri) });
  }

  headers.sort((a, b) => a.label.localeCompare(b.label));
  return headers;
}

/**
 * Builds the complete matrix data from RDF quads.
 *
 * Finds all elements of the row type and column type, then checks for
 * relationships between each pair. Relationships are detected via:
 * 1. Direct triples: rowElement → predicate → colElement
 * 2. Qualified relationships: a resource with arch:source / arch:target, whose
 *    kind is its relationship-class type (the retired arch:relSource /
 *    arch:relTarget / arch:relPredicate are read too)
 *
 * @param quads - All quads from the RDF store
 * @param rowTypeIri - The rdf:type IRI for row elements
 * @param colTypeIri - The rdf:type IRI for column elements
 * @returns MatrixData with rows, columns, and cells
 */
export function buildMatrixData(
  quads: Quad[],
  rowTypeIri: string,
  colTypeIri: string,
  members?: ReadonlySet<string>,
): MatrixData {
  const rows = collectHeaders(quads, rowTypeIri, members);
  const columns = collectHeaders(quads, colTypeIri, members);

  const rowIris = new Set(rows.map((r) => r.iri));
  const colIris = new Set(columns.map((c) => c.iri));

  // Build a label lookup for predicate IRIs
  const labelLookup = new Map<string, string>();
  for (const q of quads) {
    if (q.predicate.value === SKOS_PREF_LABEL) {
      labelLookup.set(q.subject.value, q.object.value);
    }
  }

  const cells = new Map<string, MatrixCell>();

  // Initialize all cells as empty
  for (const row of rows) {
    for (const col of columns) {
      const key = `${row.iri}|${col.iri}`;
      cells.set(key, {
        rowIri: row.iri,
        colIri: col.iri,
        relationshipType: '',
        relationshipLabel: '',
      });
    }
  }

  // 1. Detect direct triples: rowElement → predicate → colElement
  for (const q of quads) {
    if (
      rowIris.has(q.subject.value) &&
      colIris.has(q.object.value) &&
      q.predicate.value !== RDF_TYPE
    ) {
      const key = `${q.subject.value}|${q.object.value}`;
      if (cells.has(key)) {
        cells.set(key, {
          rowIri: q.subject.value,
          colIri: q.object.value,
          relationshipType: q.predicate.value,
          relationshipLabel: labelLookup.get(q.predicate.value) ?? iriLabel(q.predicate.value),
        });
      }
    }
  }

  // 2. Detect qualified relationships (arch:QualifiedRelationship)
  // Build a map of qualified relationship resources
  const qrSources = new Map<string, string>();
  const qrTargets = new Map<string, string>();
  const qrPredicates = new Map<string, string>();

  for (const q of quads) {
    if (q.predicate.value === ARCH_SOURCE || q.predicate.value === ARCH_REL_SOURCE) {
      qrSources.set(q.subject.value, q.object.value);
    } else if (q.predicate.value === ARCH_TARGET || q.predicate.value === ARCH_REL_TARGET) {
      qrTargets.set(q.subject.value, q.object.value);
    } else if (q.predicate.value === ARCH_REL_PREDICATE) {
      qrPredicates.set(q.subject.value, q.object.value);
    }
  }
  // The kind of a current-vocabulary relationship is its class type.
  for (const q of quads) {
    if (
      q.predicate.value === RDF_TYPE &&
      qrSources.has(q.subject.value) &&
      q.object.value !== ARCH_QUALIFIED_RELATIONSHIP &&
      !qrPredicates.has(q.subject.value)
    ) {
      qrPredicates.set(q.subject.value, q.object.value);
    }
  }

  // Match qualified relationships where source is a row element and target is a column element
  for (const [qrIri, source] of qrSources) {
    const target = qrTargets.get(qrIri);
    const predicate = qrPredicates.get(qrIri);
    if (target && predicate && rowIris.has(source) && colIris.has(target)) {
      const key = `${source}|${target}`;
      if (cells.has(key)) {
        cells.set(key, {
          rowIri: source,
          colIri: target,
          relationshipType: predicate,
          relationshipLabel: labelLookup.get(predicate) ?? iriLabel(predicate),
        });
      }
    }
  }

  return { rows, columns, cells };
}

/**
 * Returns the cell key for a row/column pair.
 */
export function cellKey(rowIri: string, colIri: string): string {
  return `${rowIri}|${colIri}`;
}

// ── Lit Component ───────────────────────────────────────────────────────

@customElement('matrix-view')
export class MatrixView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
      overflow: auto;
    }

    .matrix-header {
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
      border-collapse: collapse;
      table-layout: auto;
    }

    th {
      padding: 6px 10px;
      background: #f5f5f5;
      border: 1px solid #ddd;
      font-weight: 600;
      font-size: 12px;
      color: #555;
      white-space: nowrap;
    }

    th.corner {
      background: #eee;
    }

    th.col-header {
      text-align: center;
    }

    th.row-header {
      text-align: left;
    }

    td {
      padding: 4px 10px;
      border: 1px solid #e0e0e0;
      text-align: center;
      cursor: pointer;
      min-width: 40px;
    }

    td:hover {
      background: #e8f0fe;
    }

    td.has-relationship {
      background: #e6f4ea;
      color: #1e7e34;
      font-weight: 500;
    }

    td.has-relationship:hover {
      background: #c8e6c9;
    }

    .matrix-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      padding: 6px 12px;
      border-bottom: 1px solid #eee;
      font-size: 12px;
      color: #444;
    }
  `;

  /** Reference to the RDF store for querying elements. */
  @property({ attribute: false })
  rdfStore?: RdfStore;

  /** The rdf:type IRI for row elements. */
  @property({ type: String })
  rowTypeFilter = '';

  /** The rdf:type IRI for column elements. */
  @property({ type: String })
  columnTypeFilter = '';

  /** The matrix view shown: its members are the rows and columns. Without one, the type filters decide. */
  @property({ type: String })
  viewIri = '';

  /** Changes the matrix's membership (`arch:inView`). */
  @property({ attribute: false })
  viewManager?: ViewManager;

  /** A type's label, as the palette shows it. */
  @property({ attribute: false })
  typeLabelOf: (typeIri: string) => string = iriLabel;

  @state()
  private _matrixData: MatrixData = { rows: [], columns: [], cells: new Map() };

  /** The member types, most common first, and the chosen axes. */
  @state()
  private _memberTypes: string[] = [];
  @state()
  private _rowType = ALL_MEMBERS;
  @state()
  private _colType = ALL_MEMBERS;
  @state()
  private _addable: AddableType[] = [];

  override willUpdate(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('viewIri')) this._readAxes();
    if (
      changedProperties.has('rdfStore') ||
      changedProperties.has('rowTypeFilter') ||
      changedProperties.has('columnTypeFilter') ||
      changedProperties.has('viewIri')
    ) {
      this._rebuildMatrix();
    }
  }

  /** Re-read the store: after a change to the model. */
  refresh(): void {
    this._rebuildMatrix();
  }

  private _axesKey(): string {
    return `la-gram:matrix-axes:${this.viewIri}`;
  }

  /** The axes chosen for this view before, in this browser (absent, private mode: the defaults). */
  private _readAxes(): void {
    this._rowType = '';
    this._colType = '';
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(this._axesKey()) ?? 'null') as { rows?: string; columns?: string } | null;
      if (saved?.rows) this._rowType = saved.rows;
      if (saved?.columns) this._colType = saved.columns;
    } catch {
      // Storage unavailable or unreadable: the defaults.
    }
  }

  private _setAxes(rows: string, columns: string): void {
    this._rowType = rows;
    this._colType = columns;
    try {
      globalThis.localStorage?.setItem(this._axesKey(), JSON.stringify({ rows, columns }));
    } catch {
      // Not kept: the choice still applies now.
    }
    this._rebuildMatrix();
  }

  private _rebuildMatrix(): void {
    if (this.rdfStore && this.viewIri) {
      const quads = this.rdfStore.getQuads();
      const members: ViewMember[] = viewMembers(quads, this.viewIri);
      const counts = new Map<string, number>();
      for (const m of members) counts.set(m.typeIri, (counts.get(m.typeIri) ?? 0) + 1);
      this._memberTypes = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
      // Defaults, or a remembered type the view no longer holds: the two most common types.
      const valid = (t: string) => t === ALL_MEMBERS || counts.has(t);
      if (!this._rowType || !valid(this._rowType)) this._rowType = this._memberTypes[0] ?? ALL_MEMBERS;
      if (!this._colType || !valid(this._colType)) this._colType = this._memberTypes[1] ?? this._memberTypes[0] ?? ALL_MEMBERS;
      this._matrixData = buildMatrixData(quads, this._rowType, this._colType, new Set(members.map((m) => m.iri)));
      this._addable = addableTypes(quads, this.viewIri);
      return;
    }
    if (!this.rdfStore || !this.rowTypeFilter || !this.columnTypeFilter) {
      this._matrixData = { rows: [], columns: [], cells: new Map() };
      return;
    }
    const quads = this.rdfStore.getQuads();
    this._matrixData = buildMatrixData(quads, this.rowTypeFilter, this.columnTypeFilter);
  }

  private _onCellClick(cell: MatrixCell): void {
    this.dispatchEvent(
      new CustomEvent<MatrixCellClickDetail>('matrix-cell-click', {
        detail: {
          rowIri: cell.rowIri,
          colIri: cell.colIri,
          relationshipType: cell.relationshipType,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Add the model's elements of a type to the matrix. */
  private _addType(typeIri: string): void {
    if (!this.rdfStore || !this.viewManager?.addMember) return;
    for (const iri of elementsOfType(this.rdfStore.getQuads(), typeIri)) this.viewManager.addMember(this.viewIri, iri);
    this._rebuildMatrix();
    this.dispatchEvent(
      new CustomEvent('view-members-change', { detail: { viewIri: this.viewIri }, bubbles: true, composed: true }),
    );
  }

  private _axisSelect(label: string, value: string, onChange: (value: string) => void) {
    return html`<label
      >${label}
      <select @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}>
        <option value=${ALL_MEMBERS} ?selected=${value === ALL_MEMBERS}>All elements</option>
        ${this._memberTypes.map(
          (t) => html`<option value=${t} ?selected=${value === t}>${this.typeLabelOf(t)}</option>`,
        )}
      </select></label
    >`;
  }

  private _renderGrid(rows: MatrixHeader[], columns: MatrixHeader[], cells: Map<string, MatrixCell>) {
    return html`
      <table>
        <thead>
          <tr>
            <th class="corner"></th>
            ${columns.map((col) => html`<th class="col-header" title=${col.iri}>${col.label}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) => html`
              <tr>
                <th class="row-header" title=${row.iri}>${row.label}</th>
                ${columns.map((col) => {
                  const cell = cells.get(cellKey(row.iri, col.iri));
                  const hasRel = cell ? cell.relationshipType !== '' : false;
                  return html`
                    <td
                      class=${hasRel ? 'has-relationship' : ''}
                      title=${hasRel && cell ? cell.relationshipLabel : ''}
                      @click=${() => cell && this._onCellClick(cell)}
                    >
                      ${hasRel && cell ? cell.relationshipLabel : ''}
                    </td>
                  `;
                })}
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }

  private _renderMembers() {
    const { rows, columns, cells } = this._matrixData;
    const picker = this.viewManager?.addMember
      ? renderAddPicker(this._addable, this.typeLabelOf, (typeIri) => this._addType(typeIri))
      : nothing;
    return html`
      <div class="matrix-header">Matrix</div>
      <div class="matrix-toolbar">
        ${this._memberTypes.length > 0
          ? html`${this._axisSelect('Rows', this._rowType, (v) => this._setAxes(v, this._colType))}
            ${this._axisSelect('Columns', this._colType, (v) => this._setAxes(this._rowType, v))}`
          : nothing}
        ${picker}
      </div>
      ${rows.length === 0 && columns.length === 0
        ? html`<div class="empty-message">This matrix indexes no elements yet. Add the elements of a type.</div>`
        : this._renderGrid(rows, columns, cells)}
    `;
  }

  override render() {
    if (this.viewIri) return this._renderMembers();
    if (!this.rowTypeFilter || !this.columnTypeFilter) {
      return html`
        <div class="matrix-header">Matrix</div>
        <div class="empty-message">No row or column type filter set</div>
      `;
    }

    const { rows, columns, cells } = this._matrixData;

    if (rows.length === 0 && columns.length === 0) {
      return html`
        <div class="matrix-header">
          Matrix — ${iriLabel(this.rowTypeFilter)} × ${iriLabel(this.columnTypeFilter)}
        </div>
        <div class="empty-message">No elements found</div>
      `;
    }

    return html`
      <div class="matrix-header">
        Matrix — ${iriLabel(this.rowTypeFilter)} × ${iriLabel(this.columnTypeFilter)}
      </div>
      <table>
        <thead>
          <tr>
            <th class="corner"></th>
            ${columns.map((col) => html`<th class="col-header" title=${col.iri}>${col.label}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) => html`
              <tr>
                <th class="row-header" title=${row.iri}>${row.label}</th>
                ${columns.map((col) => {
                  const cell = cells.get(cellKey(row.iri, col.iri));
                  const hasRel = cell ? cell.relationshipType !== '' : false;
                  return html`
                    <td
                      class=${hasRel ? 'has-relationship' : ''}
                      title=${hasRel && cell ? cell.relationshipLabel : ''}
                      @click=${() => cell && this._onCellClick(cell)}
                    >
                      ${hasRel && cell ? cell.relationshipLabel : ''}
                    </td>
                  `;
                })}
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
    'matrix-view': MatrixView;
  }
}
