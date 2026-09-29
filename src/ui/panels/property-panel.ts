/**
 * Property Panel — shows and edits the selected concept (element, relationship,
 * view or model); the bottom panel's Properties tab.
 *
 * Vertical tabs on the left: *‹Kind› information* (ID, type, `inModel`, name,
 * definition — always in that order, the name and the definition even when
 * empty), *Properties* (everything else, and the add field, `property-picker.ts`),
 * *Analysis* (relationships) and *Appears in views*. The open tab is remembered.
 *
 * Reads the store directly; SHACL shapes give field types and cardinality.
 * Edits are emitted as events (`property-edit`, `property-add`,
 * `property-remove`) for the host to apply — or written through an
 * ElementManager when one is given.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import { DataFactory } from 'n3';
import type { RdfStore } from '../../rdf-engine/interfaces.js';
import type { ElementManager } from '../../model-manager/interfaces.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import type { PropertySuggestion, ResolvedProperty } from '../../model-manager/property-catalog.js';
import type { ElementGroup } from '../../metamodel-manager/interfaces.js';
import './property-picker.js';
import type { PropertyPicker } from './property-picker.js';

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
 * is, which model it belongs to, its name and its definition. Everything else
 * follows.
 */
const LEADING_FIELDS = [RDF_TYPE, NAMESPACES.arch + 'inModel', SKOS_PREF_LABEL, SKOS_DEFINITION];

/**
 * Shown even without a value, ready to fill in: the name and the definition.
 * They are not removed with ×; emptying the definition removes it.
 */
const DEFAULT_FIELDS = [SKOS_PREF_LABEL, SKOS_DEFINITION];

/** Placeholder of an empty default field. */
const DEFAULT_FIELD_PLACEHOLDER: Record<string, string> = {
  [SKOS_PREF_LABEL]: 'Add a name…',
  [SKOS_DEFINITION]: 'Add a definition…',
};

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
 * Order: type, inModel, prefLabel, definition ({@link LEADING_FIELDS}), then
 * every other property by label — so a property the modeller adds appears under
 * them. The name and the definition are listed even without a value
 * ({@link DEFAULT_FIELDS}), empty, so they can be filled in.
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

  if (quads.length > 0) {
    for (const predicate of DEFAULT_FIELDS) {
      if (entries.some((e) => e.predicate === predicate)) continue;
      const shape = shapeMap.get(predicate);
      entries.push({
        predicate,
        label: shape?.name ?? iriLabel(predicate),
        value: '',
        readonly: false,
        datatype: shape?.datatype,
        minCount: shape?.minCount,
        maxCount: shape?.maxCount,
      });
    }
  }

  const rank = (entry: PropertyEntry): number =>
    entry.custom ? LEADING_FIELDS.length : LEADING_FIELDS.indexOf(entry.predicate);
  entries.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label) || a.value.localeCompare(b.value));

  return entries;
}

/** The panel's vertical tabs, top to bottom. */
export type PanelSection = 'info' | 'properties' | 'analysis' | 'views';

/** localStorage key of the open tab (kept across selections and reloads). */
const TAB_KEY = 'la-gram:property-panel-tab';

const PANEL_SECTIONS: PanelSection[] = ['info', 'properties', 'analysis', 'views'];

/** The tab the user last opened, per browser; the information tab otherwise. */
function storedTab(): PanelSection {
  try {
    const value = globalThis.localStorage?.getItem(TAB_KEY);
    return PANEL_SECTIONS.find((t) => t === value) ?? 'info';
  } catch {
    return 'info';
  }
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

    /* Vertical tabs on the left, the open tab's pane on the right. */
    .layout {
      display: flex;
      height: 100%;
      min-height: 0;
    }

    .side {
      flex: 0 0 190px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: auto;
      background: #f8f9fa;
      border-right: 1px solid #e8eaed;
    }

    .side .panel-header {
      flex-wrap: wrap;
      border-bottom: 1px solid #e8eaed;
    }

    .vtabs {
      display: flex;
      flex-direction: column;
      padding: 4px 0;
    }

    .vtab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px 7px 9px;
      border: 0;
      border-left: 3px solid transparent;
      background: none;
      font: inherit;
      font-size: 13px;
      color: #3c4043;
      text-align: left;
      cursor: pointer;
    }

    .vtab:hover {
      background: #f1f3f4;
    }

    .vtab[aria-selected='true'] {
      border-left-color: #1a73e8;
      background: #e8f0fe;
      color: #1a73e8;
      font-weight: 500;
    }

    .count {
      margin-left: auto;
      font-size: 11px;
      font-weight: 500;
      color: #5f6368;
      background: #e8eaed;
      border-radius: 8px;
      padding: 0 6px;
    }

    .vtab[aria-selected='true'] .count {
      background: #d2e3fc;
      color: #1a73e8;
    }

    .pane {
      flex: 1 1 auto;
      min-width: 0;
      overflow: auto;
    }

    /* Fields side by side where there is room; text areas take the whole row. */
    .pane .property-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    }

    .pane .property-list .property-row.wide {
      grid-column: 1 / -1;
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

    select.type-select {
      background: #fff;
      cursor: pointer;
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
      grid-template-columns: 1fr auto;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    /* The picker gets the whole width: its list needs the room. */
    .add-row property-picker {
      grid-column: 1 / -1;
    }

    .add {
      border: 1px solid #dadce0;
      background: #fff;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
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

  /**
   * The properties offered when adding one, and what typed text means as a
   * property — `model-manager/property-catalog.ts`, supplied by the host.
   */
  @property({ attribute: false })
  catalog?: {
    suggest(subjectIri: string): PropertySuggestion[];
    resolve(text: string): ResolvedProperty | undefined;
  };

  /**
   * The element types an element can be changed to — the loaded metamodels',
   * grouped as in the palette. Set for elements only; the type field is then a
   * choice rather than read-only.
   */
  @property({ attribute: false })
  typeChoices?: readonly ElementGroup[];

  @state() private _newValue = '';

  /** The open vertical tab; remembered per browser. */
  @state() private _tab: PanelSection = storedTab();

  @query('property-picker') private _picker?: PropertyPicker;
  @query('.add-row .new-value') private _valueInput?: HTMLInputElement;

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

    if (newValue.trim() === '' && DEFAULT_FIELDS.includes(entry.predicate)) {
      // Emptying the definition removes it; a name cannot be emptied, and the
      // field shows the name again (the value bindings are `live`).
      if (entry.predicate === SKOS_DEFINITION && entry.value !== '') this._remove(entry);
      else this.requestUpdate();
      return;
    }

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
    const predicate = this._picker?.value?.iri;
    const value = this._newValue;
    if (!this.selectedIri) return;
    if (!predicate) {
      this._picker?.focus();
      return;
    }
    if (value === '') {
      this._valueInput?.focus();
      return;
    }
    this._emit<PropertyChangeDetail>('property-add', { elementIri: this.selectedIri, predicate, value });
    this._picker?.clear();
    this._newValue = '';
  }

  private _renderRemove(entry: PropertyEntry) {
    // The type and the name are what make the concept what it is; the rest can
    // go — the definition by emptying it, as it stays listed anyway.
    if (entry.readonly || DEFAULT_FIELDS.includes(entry.predicate)) return nothing;
    return html`<button class="remove" title="Remove this value" @click=${() => this._remove(entry)}>×</button>`;
  }

  private _renderHeading() {
    const h = this.heading;
    return html`
      <div class="panel-header">
        <span>${h?.kind ?? 'Properties'}</span>
        ${h?.typeLabel ? html`<span class="type-chip" title=${h.typeIri ?? ''}>${h.typeLabel}</span>` : nothing}
      </div>
    `;
  }

  private _renderAdd() {
    return html`
      <div class="add-row">
        <property-picker
          .suggest=${() => (this.selectedIri && this.catalog ? this.catalog.suggest(this.selectedIri) : [])}
          .resolve=${(text: string) => this.catalog?.resolve(text)}
          @property-picked=${() => this._valueInput?.focus()}
        ></property-picker>
        <input
          class="property-value new-value"
          placeholder="Value"
          .value=${this._newValue}
          @input=${(e: Event) => (this._newValue = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._add()}
        />
        <button class="add" @click=${() => this._add()}>Add</button>
      </div>
    `;
  }

  /** The open vertical tab. */
  get activeTab(): PanelSection {
    return this._tab ?? 'info';
  }

  /** Open a vertical tab; the choice is kept for other selections and reloads. */
  selectTab(id: PanelSection): void {
    this._tab = id;
    try {
      globalThis.localStorage?.setItem(TAB_KEY, id);
    } catch {
      /* not remembered: fine */
    }
  }

  /** Up/Down move between the vertical tabs, as in any tab list. */
  private _onTabKey(e: KeyboardEvent, tabs: PanelSection[]): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = tabs.indexOf(this.activeTab);
    const next = tabs[(at + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
    this.selectTab(next);
    this.updateComplete.then(() =>
      (this.renderRoot.querySelector(`.vtab[data-tab="${next}"]`) as HTMLElement | null)?.focus(),
    );
  }

  /** The relationships (or, for a relationship, its ends). */
  private _renderRelationships() {
    const a = this.analysis;
    if (!a) return nothing;
    const go = (iri: string) => this._emit('panel-navigate', { iri });
    return html`
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
    `;
  }

  /** The views the concept is drawn in. */
  private _renderViews() {
    const a = this.analysis;
    if (!a) return nothing;
    return html`
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

  /**
   * The element's type as a choice of the loaded types. Picking one asks the
   * host (`property-retype`); the host answers whether the type changed, and
   * the choice goes back to the current type when it did not (a cancelled
   * warning, say).
   */
  private _renderTypeChoice(entry: PropertyEntry, groups: readonly ElementGroup[]) {
    const known = groups.some((g) => g.elements.some((t) => t.iri === entry.value));
    const onChange = (e: Event) => {
      const select = e.target as HTMLSelectElement;
      const typeIri = select.value;
      this._emit('property-retype', {
        elementIri: this.selectedIri,
        typeIri,
        reply: (changed: boolean) => {
          if (!changed) select.value = entry.value;
        },
      });
    };
    return html`
      <li class="property-row">
        <label class="property-label">type</label>
        <select class="property-value type-select" title=${entry.value} aria-label="Type" @change=${onChange}>
          ${known ? nothing : html`<option value=${entry.value} selected>${this.heading?.typeLabel ?? entry.value}</option>`}
          ${groups.map(
            (group) => html`<optgroup label=${group.category || 'Other'}>
              ${group.elements.map((type) => html`<option value=${type.iri} ?selected=${type.iri === entry.value}>${type.label}</option>`)}
            </optgroup>`,
          )}
        </select>
      </li>
    `;
  }

  private _renderEntry(entry: PropertyEntry) {
    const isRequired = entry.minCount !== undefined && entry.minCount > 0;
    const rowClass = 'property-row';

    // An element's own type: a choice of the loaded types.
    if (entry.predicate === RDF_TYPE && this.typeChoices && this.typeChoices.length > 0 && entry.value === this.heading?.typeIri) {
      return this._renderTypeChoice(entry, this.typeChoices);
    }

    if (this._isTextArea(entry)) {
      return html`
        <li class="${rowClass} wide">
          <label class="property-label">
            ${entry.label}${isRequired ? html`<span class="required">*</span>` : nothing}
            ${this._renderRemove(entry)}
          </label>
          <textarea
            class="property-value"
            .value=${live(entry.value)}
            placeholder=${entry.value ? '' : (DEFAULT_FIELD_PLACEHOLDER[entry.predicate] ?? '')}
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
          .value=${live(entry.value)}
          placeholder=${entry.value ? '' : (DEFAULT_FIELD_PLACEHOLDER[entry.predicate] ?? '')}
          ?readonly=${entry.readonly}
          @change=${(e: Event) =>
            this._onPropertyChange(entry, (e.target as HTMLInputElement).value)}
        />
      </li>
    `;
  }

  override render() {
    if (!this.selectedIri) {
      return html`<div class="no-selection">No element selected — select an element, a relationship or a view.</div>`;
    }

    const entries = this._entries ?? [];
    const leading = entries.filter((e) => !e.custom);
    const added = entries.filter((e) => e.custom);
    const a = this.analysis;
    const kind = this.heading?.kind ?? 'Element';
    const tabs: Array<{ id: PanelSection; title: string; count?: number }> = [
      { id: 'info', title: `${kind} information` },
      { id: 'properties', title: 'Properties', count: added.length },
      ...(a
        ? [
            { id: 'analysis' as const, title: 'Analysis', count: a.relationships.length },
            { id: 'views' as const, title: 'Appears in views', count: a.views.length },
          ]
        : []),
    ];
    // A remembered tab this concept does not have (a model has no analysis) falls back.
    const remembered = this._tab ?? 'info';
    const active = tabs.some((t) => t.id === remembered) ? remembered : 'info';
    const ids = tabs.map((t) => t.id);
    return html`
      <div class="layout">
        <nav class="side">
          ${this._renderHeading()}
          <div class="vtabs" role="tablist" aria-orientation="vertical">
            ${tabs.map(
              (t) => html`<button
                class="vtab"
                role="tab"
                data-tab=${t.id}
                aria-selected=${t.id === active ? 'true' : 'false'}
                tabindex=${t.id === active ? '0' : '-1'}
                @click=${() => this.selectTab(t.id)}
                @keydown=${(e: KeyboardEvent) => this._onTabKey(e, ids)}
              >
                <span class="vtab-name">${t.title}</span>
                ${t.count !== undefined ? html`<span class="count">${t.count}</span>` : nothing}
              </button>`,
            )}
          </div>
        </nav>
        <div class="pane" role="tabpanel" data-tab=${active}>
          ${active === 'info'
            ? html`<ul class="property-list">
                <li class="property-row id-row">
                  <label class="property-label">ID</label>
                  <input class="property-value iri" readonly title=${this.selectedIri} .value=${this.selectedIri} />
                </li>
                ${leading.map((entry) => this._renderEntry(entry))}
              </ul>`
            : active === 'properties'
              ? html`${added.length > 0
                  ? html`<ul class="property-list">${added.map((entry) => this._renderEntry(entry))}</ul>`
                  : html`<div class="muted">No properties yet — add one below.</div>`}
                ${this._renderAdd()}`
              : active === 'analysis'
                ? this._renderRelationships()
                : this._renderViews()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'property-panel': PropertyPanel;
  }
}
