/**
 * Property Panel — displays and edits RDF properties of a selected element or relationship.
 *
 * Queries the RDF store for the element's properties (skos:prefLabel, skos:definition,
 * rdf:type, and any custom properties). Optionally uses SHACL shapes to determine
 * field types and cardinality. Propagates edits through ElementManager.updateProperty().
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import { DataFactory } from 'n3';
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
  /** Language tag of the current value, when it is a tagged literal. */
  language?: string;
  /** The value is an IRI (a link to another resource), not a literal. */
  isIri?: boolean;
  /** Listed after the leading fields (type, inModel, prefLabel): a property the modeller added. */
  custom?: boolean;
}

/** Detail emitted when a property value is edited. */
export interface PropertyEditDetail {
  elementIri: string;
  predicate: string;
  value: string;
  /** Language tag to keep on the new value. */
  language?: string;
}

/** Detail of `property-add` and `property-remove`. */
export interface PropertyChangeDetail {
  elementIri: string;
  predicate: string;
  value: string;
}

/** What the analysis section lists about the selected concept. */
export interface PropertyAnalysis {
  /** Relationships with the concept at one end. */
  relationships: Array<{
    iri: string;
    direction: 'out' | 'in';
    typeLabel: string;
    otherIri: string;
    otherLabel: string;
  }>;
  /** Views presenting the concept. */
  views: Array<{ iri: string; label: string }>;
  /** For a relationship: its ends. */
  ends?: { sourceIri: string; sourceLabel: string; targetIri: string; targetLabel: string };
}

/** What the header says about the selected concept. */
export interface PropertyHeading {
  /** "Element", "Relationship", "View", "Model". */
  kind: string;
  typeLabel?: string;
  typeIri?: string;
}

/** Predicates whose values are human text: edited with a language tag. */
const TEXT_PREDICATES = new Set([
  SKOS_PREF_LABEL,
  SKOS_DEFINITION,
  NAMESPACES.skos + 'altLabel',
  NAMESPACES.skos + 'note',
  NAMESPACES.rdfs + 'label',
  NAMESPACES.rdfs + 'comment',
  NAMESPACES.dcterms + 'title',
  NAMESPACES.dcterms + 'description',
]);

/**
 * The fields listed first, in this order, under the ID row: what the concept
 * is, which model it belongs to, and its name. Everything else follows.
 */
const LEADING_FIELDS = [RDF_TYPE, NAMESPACES.arch + 'inModel', SKOS_PREF_LABEL];

/**
 * Not listed: the views a concept is in are in the toolbar and under
 * "Appears in views", so an `arch:inView` row per view repeats them.
 */
const HIDDEN_FIELDS = new Set([NAMESPACES.arch + 'inView']);

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
 *
 * Order: type, inModel, prefLabel ({@link LEADING_FIELDS}), then every other
 * property by label — so a property the modeller adds appears under the name.
 * `arch:inView` is left out ({@link HIDDEN_FIELDS}). The panel shows the ID
 * (the IRI) above them all.
 */
export function buildPropertyEntries(quads: Quad[], shaclShapes: ShaclPropertyShape[]): PropertyEntry[] {
  const shapeMap = new Map<string, ShaclPropertyShape>();
  for (const s of shaclShapes) shapeMap.set(s.path, s);

  const entries: PropertyEntry[] = [];

  for (const q of quads) {
    const predicate = q.predicate.value;
    if (HIDDEN_FIELDS.has(predicate)) continue;
    const value = q.object.value;
    const isType = predicate === RDF_TYPE;
    const shape = shapeMap.get(predicate);

    const isIri = q.object.termType === 'NamedNode';
    const language = (q.object as { language?: string }).language || undefined;
    const custom = !LEADING_FIELDS.includes(predicate);
    entries.push({
      predicate,
      label: shape?.name ?? iriLabel(predicate),
      value,
      // Types and links to other resources are shown, not typed over: editing
      // an IRI as free text is how dangling references get made.
      readonly: isType || isIri,
      datatype: shape?.datatype,
      minCount: shape?.minCount,
      maxCount: shape?.maxCount,
      ...(language ? { language } : {}),
      ...(isIri ? { isIri } : {}),
      ...(custom ? { custom } : {}),
    });
  }

  const rank = (entry: PropertyEntry): number =>
    entry.custom ? LEADING_FIELDS.length : LEADING_FIELDS.indexOf(entry.predicate);
  entries.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label) || a.value.localeCompare(b.value));

  return entries;
}

/** The header's ×: asks the host to hide the panel (`property-close`). */
function closeButton(onClose: () => void) {
  return html`<button class="close" title="Hide the property panel" @click=${onClose}>×</button>`;
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

    /* Sets the properties a modeller added off from the fields above. */
    .property-row.first-added {
      border-top: 1px solid #dadce0;
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

    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    button.close {
      margin-left: auto;
      border: 0;
      background: none;
      font: inherit;
      font-size: 16px;
      line-height: 1;
      padding: 0 2px;
      color: #5f6368;
      cursor: pointer;
    }

    button.close:hover {
      color: #202124;
    }

    .type-chip {
      font-size: 11px;
      font-weight: 500;
      background: #e8f0fe;
      color: #1a73e8;
      border-radius: 10px;
      padding: 1px 8px;
    }

    .property-value.iri {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
    }

    .property-label {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .lang {
      color: #80868b;
      font-weight: 400;
    }

    .remove {
      margin-left: auto;
      border: 0;
      background: none;
      color: #80868b;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
    }

    .remove:hover {
      color: #c5221f;
    }

    .add-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .add {
      border: 1px solid #dadce0;
      background: #fff;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
    }

    .section-title {
      padding: 8px 12px 2px;
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .analysis-list {
      list-style: none;
      margin: 0;
      padding: 2px 12px 6px;
    }

    .analysis-list li,
    .analysis-row {
      display: flex;
      gap: 6px;
      padding: 2px 0;
    }

    .analysis-row {
      padding: 2px 12px;
    }

    .analysis-list a,
    .analysis-row a {
      color: #1a73e8;
      text-decoration: none;
    }

    .dir {
      color: #80868b;
      width: 12px;
    }

    .muted {
      padding: 2px 12px 6px;
      color: #80868b;
      font-style: italic;
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

  /** Kind and type shown above the properties. */
  @property({ attribute: false })
  heading?: PropertyHeading;

  /** Relationships and views of the selected concept. */
  @property({ attribute: false })
  analysis?: PropertyAnalysis;

  /** Predicates offered when adding a property (from the loaded ontologies). */
  @property({ attribute: false })
  predicateSuggestions: Array<{ iri: string; label: string }> = [];

  @state() private _newPredicate = '';
  @state() private _newValue = '';

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

  /** Re-read the selected concept after the model changed elsewhere. */
  reload(): void {
    this._loadProperties();
    this.requestUpdate();
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

    // Keep the value's language; text without one gets `en`, which is what the
    // Linked.Archi shapes expect of labels and definitions.
    const language = entry.language ?? (TEXT_PREDICATES.has(entry.predicate) ? 'en' : undefined);

    // Propagate through ElementManager if available
    if (this.elementManager) {
      const valueTerm = (
        language
          ? DataFactory.literal(newValue, language)
          : entry.datatype
            ? DataFactory.literal(newValue, DataFactory.namedNode(entry.datatype))
            : DataFactory.literal(newValue)
      ) as unknown as Term;
      this.elementManager.updateProperty(this.selectedIri, entry.predicate, valueTerm);
    }

    // Dispatch a custom event for external listeners
    this.dispatchEvent(
      new CustomEvent<PropertyEditDetail>('property-edit', {
        detail: {
          elementIri: this.selectedIri,
          predicate: entry.predicate,
          value: newValue,
          ...(language ? { language } : {}),
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

  private _emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  private _remove(entry: PropertyEntry): void {
    if (!this.selectedIri) return;
    this._emit<PropertyChangeDetail>('property-remove', {
      elementIri: this.selectedIri,
      predicate: entry.predicate,
      value: entry.value,
    });
  }

  private _add(): void {
    const predicate = this._newPredicate.trim();
    const value = this._newValue;
    if (!this.selectedIri || !/^[a-z][a-z0-9+.-]*:\S+$/i.test(predicate) || value === '') return;
    this._emit<PropertyChangeDetail>('property-add', { elementIri: this.selectedIri, predicate, value });
    this._newPredicate = '';
    this._newValue = '';
  }

  private _renderRemove(entry: PropertyEntry) {
    // The type and the name are what make the concept what it is; the rest can go.
    if (entry.readonly || entry.predicate === SKOS_PREF_LABEL) return nothing;
    return html`<button class="remove" title="Remove this value" @click=${() => this._remove(entry)}>×</button>`;
  }

  private _renderHeading() {
    const h = this.heading;
    return html`
      <div class="panel-header">
        <span>${h?.kind ?? 'Properties'}</span>
        ${h?.typeLabel ? html`<span class="type-chip" title=${h.typeIri ?? ''}>${h.typeLabel}</span>` : nothing}
        ${closeButton(() => this._emit('property-close', {}))}
      </div>
    `;
  }

  private _renderAdd() {
    return html`
      <div class="add-row">
        <input
          class="property-value"
          list="la-predicates"
          placeholder="Property IRI"
          .value=${this._newPredicate}
          @input=${(e: Event) => (this._newPredicate = (e.target as HTMLInputElement).value)}
        />
        <datalist id="la-predicates">
          ${this.predicateSuggestions.map((p) => html`<option value=${p.iri}>${p.label}</option>`)}
        </datalist>
        <input
          class="property-value"
          placeholder="Value"
          .value=${this._newValue}
          @input=${(e: Event) => (this._newValue = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._add()}
        />
        <button class="add" @click=${() => this._add()}>Add</button>
      </div>
    `;
  }

  private _renderAnalysis() {
    const a = this.analysis;
    if (!a) return nothing;
    const go = (iri: string) => this._emit('panel-navigate', { iri });
    return html`
      <div class="section-title">Analysis</div>
      ${a.ends
        ? html`<div class="analysis-row">
            <a href="#" @click=${(e: Event) => { e.preventDefault(); go(a.ends!.sourceIri); }}>${a.ends.sourceLabel}</a>
            →
            <a href="#" @click=${(e: Event) => { e.preventDefault(); go(a.ends!.targetIri); }}>${a.ends.targetLabel}</a>
          </div>`
        : nothing}
      ${a.relationships.length > 0
        ? html`<ul class="analysis-list">
            ${a.relationships.map(
              (r) => html`<li>
                <span class="dir">${r.direction === 'out' ? '→' : '←'}</span>
                <a href="#" title=${r.iri} @click=${(e: Event) => { e.preventDefault(); go(r.iri); }}>${r.typeLabel}</a>
                <a href="#" title=${r.otherIri} @click=${(e: Event) => { e.preventDefault(); go(r.otherIri); }}>${r.otherLabel}</a>
              </li>`,
            )}
          </ul>`
        : a.ends
          ? nothing
          : html`<div class="muted">No relationships.</div>`}
      <div class="section-title">Appears in views</div>
      ${a.views.length > 0
        ? html`<ul class="analysis-list">
            ${a.views.map(
              (v) => html`<li>
                <a href="#" @click=${(e: Event) => { e.preventDefault(); this._emit('panel-open-view', { viewIri: v.iri, iri: this.selectedIri }); }}
                  >${v.label || v.iri}</a
                >
              </li>`,
            )}
          </ul>`
        : html`<div class="muted">In no view.</div>`}
    `;
  }

  /** @param firstAdded The first of the added properties: a divider sets them off. */
  private _renderEntry(entry: PropertyEntry, firstAdded = false) {
    const isRequired = entry.minCount !== undefined && entry.minCount > 0;
    const rowClass = `property-row${firstAdded ? ' first-added' : ''}`;

    if (this._isTextArea(entry)) {
      return html`
        <li class=${rowClass}>
          <label class="property-label">
            ${entry.label}${isRequired ? html`<span class="required">*</span>` : nothing}
            ${this._renderRemove(entry)}
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
      <li class=${rowClass}>
        <label class="property-label">
          ${entry.label}${isRequired ? html`<span class="required">*</span>` : nothing}
          ${entry.language ? html`<span class="lang">@${entry.language}</span>` : nothing}
          ${this._renderRemove(entry)}
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
        <div class="panel-header"><span>Properties</span>${closeButton(() => this._emit('property-close', {}))}</div>
        <div class="no-selection">No element selected</div>
      `;
    }

    return html`
      ${this._renderHeading()}
      <ul class="property-list">
        <li class="property-row id-row">
          <label class="property-label">ID</label>
          <input class="property-value iri" readonly title=${this.selectedIri} .value=${this.selectedIri} />
        </li>
        ${this._entries.map((entry, i) =>
          this._renderEntry(entry, Boolean(entry.custom && (i === 0 || !this._entries[i - 1].custom))),
        )}
      </ul>
      ${this._renderAdd()}
      ${this._renderAnalysis()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'property-panel': PropertyPanel;
  }
}
