/**
 * Matrix View — grid showing relationships between two sets of element types.
 *
 * Queries the RDF store for all elements of a row type and a column type,
 * then checks for relationships between each pair. Displays a grid with
 * row headers (element labels), column headers (element labels), and cells
 * showing relationship type labels or empty.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Quad, NamedNode } from '@rdfjs/types';
import type { RdfStore } from '../../rdf-engine/interfaces.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

// ── Well-known predicate IRIs ───────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
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
export function collectHeaders(quads: Quad[], typeIri: string): MatrixHeader[] {
  const elementIris = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE && q.object.value === typeIri) {
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
 * 2. Qualified relationships: a resource with arch:relSource, arch:relTarget, arch:relPredicate
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
): MatrixData {
  const rows = collectHeaders(quads, rowTypeIri);
  const columns = collectHeaders(quads, colTypeIri);

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
    if (q.predicate.value === ARCH_REL_SOURCE) {
      qrSources.set(q.subject.value, q.object.value);
    } else if (q.predicate.value === ARCH_REL_TARGET) {
      qrTargets.set(q.subject.value, q.object.value);
    } else if (q.predicate.value === ARCH_REL_PREDICATE) {
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

  @state()
  private _matrixData: MatrixData = { rows: [], columns: [], cells: new Map() };

  override willUpdate(changedProperties: Map<string, unknown>): void {
    if (
      changedProperties.has('rdfStore') ||
      changedProperties.has('rowTypeFilter') ||
      changedProperties.has('columnTypeFilter')
    ) {
      this._rebuildMatrix();
    }
  }

  private _rebuildMatrix(): void {
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

  override render() {
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
