/**
 * Property Panel — displays and edits RDF properties of a selected element or relationship.
 *
 * Queries the RDF store for the element's properties (skos:prefLabel, skos:definition,
 * rdf:type, and any custom properties). Optionally uses SHACL shapes to determine
 * field types and cardinality. Propagates edits through ElementManager.updateProperty().
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

// SHACL namespace constants for shape-driven form generation
const SH_TARGET_CLASS = NAMESPACES.sh + 'targetClass';
const SH_PROPERTY = NAMESPACES.sh + 'property';
const SH_PATH = NAMESPACES.sh + 'path';
const SH_DATATYPE = NAMESPACES.sh + 'datatype';
const SH_MIN_COUNT = NAMESPACES.sh + 'minCount';
const SH_MAX_COUNT = NAMESPACES.sh + 'maxCount';
const SH_NAME = NAMESPACES.sh + 'name';

/** A single property row displayed in the panel. */
export interface PropertyEntry {
  /** Full predicate IRI. */
  predicate: string;
  /** Human-readable label for the predicate. */
  label: string;
  /** Current value (literal string or IRI). */
  value: string;
  /** Whether this is a read-only field (e.g. rdf:type). */
  readonly: boolean;
  /** XSD datatype IRI when known from SHACL shape. */
  datatype?: string;
  /** Minimum cardinality from SHACL shape. */
  minCount?: number;
  /** Maximum cardinality from SHACL shape. */
  maxCount?: number;
}

/** Detail emitted when a property value is edited. */
export interface PropertyEditDetail {
  elementIri: string;
  predicate: string;
  value: string;
}

/** SHACL property constraint extracted from a shapes graph. */
export interface ShaclPropertyShape {
  path: string;
  name?: string;
  datatype?: string;
  minCount?: number;
  maxCount?: number;
}

/**
 * Extracts SHACL property shapes relevant to a given RDF type from a shapes graph.
 * Looks for sh:NodeShape with sh:targetClass matching the type, then reads sh:property entries.
 */
export function extractShaclShapes(
  shapesQuads: Quad[],
  typeIri: string,
): ShaclPropertyShape[] {
  const shapes: ShaclPropertyShape[] = [];

  // Find node shapes targeting this class
  const targetClassQuads = shapesQuads.filter(
    (q) => q.predicate.value === SH_TARGET_CLASS && q.object.value === typeIri,
  );

  for (const tcQuad of targetClassQuads) {
    const shapeNode = tcQuad.subject.value;

    // Find sh:property links from this shape
    const propLinks = shapesQuads.filter(
      (q) => q.subject.value === shapeNode && q.predicate.value === SH_PROPERTY,
    );

    for (const propLink of propLinks) {
      const propNode = propLink.object.value;
      const propQuads = shapesQuads.filter((q) => q.subject.value === propNode);

      const shape: ShaclPropertyShape = {
        path: propQuads.find((q) => q.predicate.value === SH_PATH)?.object.value ?? '',
      };

      const nameQ = propQuads.find((q) => q.predicate.value === SH_NAME);
      if (nameQ) shape.name = nameQ.object.value;

      const dtQ = propQuads.find((q) => q.predicate.value === SH_DATATYPE);
      if (dtQ) shape.datatype = dtQ.object.value;

      const minQ = propQuads.find((q) => q.predicate.value === SH_MIN_COUNT);
      if (minQ) shape.minCount = parseInt(minQ.object.value, 10);

      const maxQ = propQuads.find((q) => q.predicate.value === SH_MAX_COUNT);
      if (maxQ) shape.maxCount = parseInt(maxQ.object.value, 10);

      if (shape.path) shapes.push(shape);
    }
  }

  return shapes;
}

/**
 * Derives a short human-readable label from a full IRI.
 * Uses the fragment after `#` or the last path segment.
 */
function iriLabel(iri: string): string {
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx !== -1) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx !== -1) return iri.slice(slashIdx + 1);
  return iri;
}

/**
 * Builds the list of PropertyEntry objects for a given element IRI
 * by querying the RDF store and optionally enriching with SHACL shape info.
 */
export function buildPropertyEntries(
  quads: Quad[],
  shaclShapes: ShaclPropertyShape[],
): PropertyEntry[] {
  const shapeMap = new Map<string, ShaclPropertyShape>();
  for (const s of shaclShapes) shapeMap.set(s.path, s);

  const entries: PropertyEntry[] = [];

  for (const q of quads) {
    const predicate = q.predicate.value;
    const value = q.object.value;
    const isType = predicate === RDF_TYPE;
    const shape = shapeMap.get(predicate);

    entries.push({
      predicate,
      label: shape?.name ?? iriLabel(predicate),
      value,
      readonly: isType,
      datatype: shape?.datatype,
      minCount: shape?.minCount,
      maxCount: shape?.maxCount,
    });
  }

  // Sort: rdf:type first, then skos:prefLabel, skos:definition, then alphabetical
  const order = [RDF_TYPE, SKOS_PREF_LABEL, SKOS_DEFINITION];
  entries.sort((a, b) => {
    const ai = order.indexOf(a.predicate);
    const bi = order.indexOf(b.predicate);
    const aw = ai >= 0 ? ai : order.length;
    const bw = bi >= 0 ? bi : order.length;
    if (aw !== bw) return aw - bw;
    return a.label.localeCompare(b.label);
  });

  return entries;
}

@customElement('property-panel')
export class PropertyPanel extends LitElement {
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

    .no-selection {
      padding: 16px 12px;
      color: #888;
      font-style: italic;
    }

    .property-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .property-row {
      display: flex;
      flex-direction: column;
      padding: 6px 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .property-label {
      font-weight: 500;
      font-size: 11px;
      color: #555;
      margin-bottom: 2px;
    }

    .property-label .required {
      color: #d32f2f;
      margin-left: 2px;
    }

    .property-value {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 3px;
      font-size: 13px;
      font-family: inherit;
    }

    .property-value:focus {
      outline: none;
      border-color: #1a73e8;
      box-shadow: 0 0 0 1px #1a73e8;
    }

    .property-value[readonly] {
      background: #f5f5f5;
      color: #666;
      border-color: #e0e0e0;
      cursor: default;
    }

    textarea.property-value {
      resize: vertical;
      min-height: 48px;
    }
  `;

  /** IRI of the currently selected element or relationship. */
  @property({ type: String })
  selectedIri = '';

  /** Reference to the ElementManager for propagating edits. */
  @property({ attribute: false })
  elementManager?: ElementManager;

  /** Reference to the RDF store for querying element properties. */
  @property({ attribute: false })
  rdfStore?: RdfStore;

  /** Optional SHACL shapes quads for form field generation. */
  @property({ attribute: false })
  shapesGraph?: Quad[];

  /** Computed property entries for the selected element. */
  @state()
  private _entries: PropertyEntry[] = [];

  override willUpdate(changedProperties: Map<string, unknown>): void {
    if (
      changedProperties.has('selectedIri') ||
      changedProperties.has('rdfStore') ||
      changedProperties.has('shapesGraph')
    ) {
      this._loadProperties();
    }
  }

  /** Query the RDF store for the selected element's properties. */
  private _loadProperties(): void {
    if (!this.selectedIri || !this.rdfStore) {
      this._entries = [];
      return;
    }

    // Query all triples where the selected IRI is the subject
    const subjectNode = { value: this.selectedIri, termType: 'NamedNode' } as NamedNode;
    const quads = this.rdfStore.getQuads(subjectNode);

    // Determine the element's rdf:type for SHACL shape lookup
    const typeQuad = quads.find((q) => q.predicate.value === RDF_TYPE);
    const typeIri = typeQuad?.object.value ?? '';

    // Extract SHACL shapes if a shapes graph is provided
    const shaclShapes = this.shapesGraph && typeIri
      ? extractShaclShapes(this.shapesGraph, typeIri)
      : [];

    this._entries = buildPropertyEntries(quads, shaclShapes);
  }

  /** Handle input change and propagate to ElementManager. */
  private _onPropertyChange(entry: PropertyEntry, newValue: string): void {
    if (entry.readonly || !this.selectedIri) return;

    // Propagate through ElementManager if available
    if (this.elementManager) {
      // Create a simple literal term for the value
      const valueTerm = { value: newValue, termType: 'Literal' } as unknown as import('@rdfjs/types').Term;
      this.elementManager.updateProperty(this.selectedIri, entry.predicate, valueTerm);
    }

    // Dispatch a custom event for external listeners
    this.dispatchEvent(
      new CustomEvent<PropertyEditDetail>('property-edit', {
        detail: {
          elementIri: this.selectedIri,
          predicate: entry.predicate,
          value: newValue,
        },
        bubbles: true,
        composed: true,
      }),
    );

    // Reload properties to reflect the change
    this._loadProperties();
  }

  /** Determine if a field should use a textarea (definition fields, long text). */
  private _isTextArea(entry: PropertyEntry): boolean {
    return entry.predicate === SKOS_DEFINITION;
  }

  /** Determine the HTML input type from SHACL datatype. */
  private _inputType(entry: PropertyEntry): string {
    if (!entry.datatype) return 'text';
    const dt = entry.datatype;
    if (dt.endsWith('integer') || dt.endsWith('int') || dt.endsWith('double') || dt.endsWith('decimal') || dt.endsWith('float')) {
      return 'number';
    }
    if (dt.endsWith('boolean')) return 'checkbox';
    if (dt.endsWith('date')) return 'date';
    if (dt.endsWith('dateTime')) return 'datetime-local';
    return 'text';
  }

  private _renderEntry(entry: PropertyEntry) {
    const isRequired = entry.minCount !== undefined && entry.minCount > 0;

    if (this._isTextArea(entry)) {
      return html`
        <li class="property-row">
          <label class="property-label">
            ${entry.label}${isRequired ? html`<span class="required">*</span>` : nothing}
          </label>
          <textarea
            class="property-value"
            .value=${entry.value}
            ?readonly=${entry.readonly}
            @change=${(e: Event) =>
              this._onPropertyChange(entry, (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </li>
      `;
    }

    return html`
      <li class="property-row">
        <label class="property-label">
          ${entry.label}${isRequired ? html`<span class="required">*</span>` : nothing}
        </label>
        <input
          class="property-value"
          type=${this._inputType(entry)}
          .value=${entry.value}
          ?readonly=${entry.readonly}
          @change=${(e: Event) =>
            this._onPropertyChange(entry, (e.target as HTMLInputElement).value)}
        />
      </li>
    `;
  }

  override render() {
    if (!this.selectedIri) {
      return html`
        <div class="panel-header">Properties</div>
        <div class="no-selection">No element selected</div>
      `;
    }

    return html`
      <div class="panel-header">Properties</div>
      <ul class="property-list">
        ${this._entries.map((entry) => this._renderEntry(entry))}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'property-panel': PropertyPanel;
  }
}
