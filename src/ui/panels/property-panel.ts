/**
 * Property Panel — shows and edits the selected concept (element, relationship,
 * view or model); the bottom panel's Properties tab.
 *
 * Vertical tabs on the left: *‹Kind› information* (ID, type, model, name,
 * definition — always in that order, the name and the definition even when
 * empty), *Properties* (everything else, and the add field, `property-picker.ts`),
 * *Analysis* (relationships) and *Appears in views*. The open tab is remembered.
 *
 * Read without knowing RDF: fields are named in words, a link to another
 * resource shows that resource's name, and the ID its short identifier.
 * Clicking a field's name, or a link, shows the IRIs behind it. An element's
 * type, and the value of a link being added, are picked by name
 * (`named-picker.ts`), their IRIs a switch away.
 *
 * Reads the store directly; SHACL shapes give field types and cardinality.
 * Edits are emitted as events (`property-edit`, `property-add`,
 * `property-remove`) for the host to apply — or written through an
 * ElementManager when one is given.
 */

import { LitElement, html, css, nothing, svg } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import { DataFactory } from 'n3';
import type { RdfStore } from '../../rdf-engine/interfaces.js';
import type { ElementManager, FigureColours, FigureKind, ViewKind } from '../../model-manager/interfaces.js';
import {
  colourAlpha,
  fontStyleOf,
  hasFontStyle,
  hexColour,
  withAlpha,
  type Appearance,
  type AppearanceChanges,
  type AppearanceKey,
  type FigureMode,
  type ImagePosition,
  imageUri,
} from '../../model-manager/appearance.js';
import type { AppearanceSelection, FigureChoices, ImageChoices, ImageScope, LabelChoices } from '../appearance-selection.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import type { PropertySuggestion, ResolvedProperty } from '../../model-manager/property-catalog.js';
import type { ElementGroup } from '../../metamodel-manager/interfaces.js';
import { localName } from '../../model-manager/vocabulary.js';
import { contextNamesOf } from '../../model-manager/context-names.js';
import { picturesOf } from '../../model-manager/element-pictures.js';
import { fieldName, type NameOf } from '../../model-manager/field-names.js';
import { isQualifiedPredicate } from '../../model-manager/cascade.js';
import { provenanceOf, type ConceptProvenance } from '../../model-manager/provenance.js';
import './named-picker.js';
import './property-picker.js';
import type { NamedOption, NamedPicker, TypedOption } from './named-picker.js';
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
const SH_IN = NAMESPACES.sh + 'in';
const SH_CLASS = NAMESPACES.sh + 'class';
const SH_NODE_KIND = NAMESPACES.sh + 'nodeKind';
/** Node kinds that admit an IRI: a property so constrained takes links. */
const LINK_NODE_KINDS = new Set(['IRI', 'BlankNodeOrIRI', 'IRIOrLiteral'].map((k) => NAMESPACES.sh + k));
const RDF_FIRST = NAMESPACES.rdf + 'first';
const RDF_REST = NAMESPACES.rdf + 'rest';
const RDF_NIL = NAMESPACES.rdf + 'nil';
const XSD_BOOLEAN = NAMESPACES.xsd + 'boolean';

/** A single property row displayed in the panel. */
export interface PropertyEntry {
  /** Full predicate IRI. */
  predicate: string;
  /** The field's name, in words ({@link fieldName}). */
  label: string;
  /** Current value (literal string or IRI). */
  value: string;
  /** An IRI value's name: what the loaded data calls it, else its local name in words. */
  valueLabel?: string;
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
  /**
   * A relationship's direct statement (`am4:serves` to the element served): its
   * predicate is a relationship type's `arch:unqualifiedForm`. Not listed on the
   * Properties tab — the relationship is drawn, and the Analysis tab lists it.
   */
  drawn?: boolean;
  /** The values the SHACL shape allows (`sh:in`): shown as a choice. */
  choices?: PropertyChoice[];
  /** Shown greyed in the field while it is empty, in place of its default prompt. */
  placeholder?: string;
  /**
   * What emptying the field does, where a name cannot be emptied: `removed`, the value goes — a figure's text, drawn
   * as nothing then; `blank`, it is written empty — a view reference's, drawn as nothing where none of its own would
   * show its view's name.
   */
  emptied?: 'removed' | 'blank';
  /**
   * The value shown is not its own but what it shows without one, greyed — a view reference's view's name.
   * Unchanged, no edit; typed over or emptied, one of its own.
   */
  inherited?: boolean;
  /** A × that takes its own value away, titled so: a view reference's text, back to its view's name. */
  reset?: string;
}

/** `reference-view-change`: the view reference `nodeIri`, in the open view, opens `viewIri` now (Req 3.23). */
export interface ReferenceViewChangeDetail {
  nodeIri: string;
  viewIri: string;
}

/** One allowed value of a property (`sh:in`). */
export interface PropertyChoice {
  value: string;
  label: string;
  isIri: boolean;
}

/** Detail emitted when a property value is edited. */
export interface PropertyEditDetail {
  elementIri: string;
  predicate: string;
  value: string;
  /** Language tag to keep on the new value. */
  language?: string;
  /** The new value is an IRI (chosen from the shape's `sh:in`), not text. */
  isIri?: boolean;
  /** The new literal's datatype, from the property's SHACL shape. */
  datatype?: string;
  /** The value it replaces, as shown; absent or empty when there was none. */
  previous?: string;
  /** That value's language tag, so a name in another language stays. */
  previousLanguage?: string;
}

/** Detail of `property-add` and `property-remove`. */
export interface PropertyChangeDetail {
  elementIri: string;
  predicate: string;
  value: string;
  /** An added value is an IRI (chosen from the shape's `sh:in`), not text. */
  isIri?: boolean;
  /** An added literal's datatype, from the property's SHACL shape. */
  datatype?: string;
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
  /** "Element", "Relationship", "View", "Model"; "Derived relationship", "Potential relationship"; "Group", "Note", "Shape". */
  kind: string;
  /** A figure — drawing, no model element: its text and its colours are all there is to it. */
  figure?: FigureColours & { kind: FigureKind };
  /** A line drawn from a figure — a note's to what it is about: no relationship, nothing to edit. */
  line?: { from: string; to: string };
  /**
   * A reference to another view (Req 3.23): the view it opens — its name when the model has it — and the model's
   * views it can be pointed at instead, every one but the view it is drawn in.
   */
  reference?: {
    viewIri?: string;
    viewLabel?: string;
    views: Array<{ iri: string; label: string; kind: ViewKind }>;
  };
  /** A view: the views holding a reference to it, by name (*Referenced from*); absent with none. */
  referencedFrom?: Array<{ iri: string; label: string }>;
  typeLabel?: string;
  typeIri?: string;
  /** For a relationship a rule derived: how surely, by which rule, from what, and whether it is confirmed. */
  derivation?: {
    certainty: 'valid' | 'potential';
    confirmed: boolean;
    /** The rule, by local name (`DR3`). */
    rule?: string;
    premises: Array<{ iri: string; label: string }>;
  };
}

/**
 * The look of what is selected on the canvas changed in the Appearance tab:
 * `appearance-change`, for the host to write to every one selected as one
 * undoable step. `null` takes a value back to the default.
 */
export interface AppearanceChangeDetail {
  changes: AppearanceChanges;
  /** The presentation context they are for — the style for it (core-vis 0.7) — else the style for every one. */
  context?: string;
  /** And these keys taken away from the style for this context, so the one for every context shows there. */
  clearContext?: { context: string; keys: AppearanceKey[] };
}

/** The Image tab's keys: what a picture, where it is and how it is drawn are in a style. */
const IMAGE_SCOPE_KEYS: AppearanceKey[] = ['image', 'imagePosition', 'iconSymbol', 'useElementPicture', 'renderingMode', 'shapeType'];

/** An element's picture for one presentation context, or — `context` null — for every one (`context-picture-change`); `null` takes it away. */
export interface ContextPictureChangeDetail {
  elementIri: string;
  context: string | null;
  url: string | null;
}

/** A name typed for one presentation context (`context-name-change`); `null` takes it away. */
export interface ContextNameChangeDetail {
  elementIri: string;
  context: string;
  name: string | null;
}

/**
 * The Label tab's change (`label-expression-change`): what the selected say,
 * in the presentation context chosen — or, `everyContext`, in every context,
 * the one for the context chosen taken away so it shows there too; `null`
 * takes it away. `all` takes both away: the notation's or the context's again.
 */
export interface LabelExpressionChangeDetail {
  expression: string | null;
  everyContext: boolean;
  all?: boolean;
}

/** The line widths offered. */
const LINE_WIDTHS: ReadonlyArray<[number, string]> = [
  [1, 'Normal'],
  [2, 'Medium'],
  [3, 'Heavy'],
];

/** The gradients offered: none, or the side the fill shades from. */
const GRADIENTS: ReadonlyArray<[string, string]> = [
  ['', 'None'],
  ['top', 'Top'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['bottom', 'Bottom'],
];

/** What a line from a note may be drawn with at an end. */
const DECORATIONS: ReadonlyArray<[NonNullable<Appearance['targetDecor']>, string]> = [
  ['NoDecoration', 'None'],
  ['OpenArrowhead', 'Open arrow'],
  ['ClosedArrowhead', 'Filled arrow'],
  ['HollowArrowhead', 'Hollow arrow'],
  ['HalfArrowhead', 'Half arrow'],
  ['HollowDiamond', 'Hollow diamond'],
  ['FilledDiamond', 'Filled diamond'],
  ['CircleDot', 'Dot'],
];

/** The Appearance tab's rows, left and right; a line's style beside its opacity, its ends under them. */
const APPEARANCE_ROWS: ReadonlyArray<[string, string | undefined]> = [
  ['fillColor', 'gradient'],
  ['fillOpacity', undefined],
  ['lineColor', 'lineWidth'],
  ['lineOpacity', 'borderStyle'],
  ['sourceDecor', 'targetDecor'],
  ['labelAnchor', undefined],
  ['iconColor', undefined],
  ['textAlignment', 'textPosition'],
  ['font', 'fontColor'],
];

const BORDER_STYLES: ReadonlyArray<[NonNullable<Appearance['borderStyle']>, string]> = [
  ['SolidLine', 'Solid'],
  ['DashedLine', 'Dashed'],
  ['DottedLine', 'Dotted'],
];

/** Fonts offered by name; any other may be typed. */
const FONT_NAMES = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Segoe UI',
  'Lucida Grande',
  'Georgia',
  'Times New Roman',
  'Courier New',
];

/** The alignment buttons: lines set left, centred, right — and high, middle, low in a box. */
const ALIGNMENTS: ReadonlyArray<[NonNullable<Appearance['textAlignment']>, string, string]> = [
  ['left', 'Left', 'M2 3h12M2 7h8M2 11h10'],
  ['center', 'Centre', 'M2 3h12M4 7h8M3 11h10'],
  ['right', 'Right', 'M2 3h12M6 7h8M4 11h10'],
];
const POSITIONS: ReadonlyArray<[NonNullable<Appearance['textPosition']>, string, string]> = [
  ['top', 'Top', 'M1.5 1.5h13v11h-13zM4 4h8M4 6.5h8'],
  ['middle', 'Middle', 'M1.5 1.5h13v11h-13zM4 6h8M4 8.5h8'],
  ['bottom', 'Bottom', 'M1.5 1.5h13v11h-13zM4 9h8M4 11.5h8'],
];
/** Where along a line its text sits: a box on the line near its start, at its middle, near its end. */
const ANCHORS: ReadonlyArray<[NonNullable<Appearance['labelAnchor']>, string, string]> = [
  ['source', 'Near its source', 'M1 7h14M2 4.5h5v5h-5z'],
  ['middle', 'At its middle', 'M1 7h14M5.5 4.5h5v5h-5z'],
  ['target', 'Near its target', 'M1 7h14M9 4.5h5v5h-5z'],
];

/** The largest file "Choose file…" keeps in the model as a `data:` URI; a larger picture is linked by its address. */
export const KEPT_PICTURE_LIMIT = 200 * 1024;

/** Where a picture may be drawn in a node. */
const IMAGE_POSITIONS: ReadonlyArray<[ImagePosition, string]> = [
  ['TopLeft', 'Top left'],
  ['TopCenter', 'Top centre'],
  ['TopRight', 'Top right'],
  ['MiddleLeft', 'Middle left'],
  ['Center', 'Centre'],
  ['MiddleRight', 'Middle right'],
  ['BottomLeft', 'Bottom left'],
  ['BottomCenter', 'Bottom centre'],
  ['BottomRight', 'Bottom right'],
  ['Fill', 'Fill'],
];

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
// A SKOS-XL name's link and a picture's: the names and pictures for each presentation are shown as such
// (Names by presentation, Pictures by presentation).
const HIDDEN_FIELDS = new Set([
  NAMESPACES.arch + 'inView',
  NAMESPACES.rdf + 'reifies',
  'http://www.w3.org/2008/05/skos-xl#altLabel',
  NAMESPACES.arch + 'prefVisNotation',
  NAMESPACES.arch + 'altVisNotation',
]);

/** SHACL property constraint extracted from a shapes graph. */
export interface ShaclPropertyShape {
  path: string;
  name?: string;
  datatype?: string;
  minCount?: number;
  maxCount?: number;
  /** The allowed values (`sh:in`), in list order. */
  in?: Array<{ value: string; isIri: boolean }>;
  /** Its values are resources (`sh:class`, or a `sh:nodeKind` that admits IRIs). */
  links?: boolean;
}

/** The members of an RDF list, from its head node. */
function listMembers(quads: Quad[], head: string): Quad['object'][] {
  const members: Quad['object'][] = [];
  const seen = new Set<string>();
  let node = head;
  while (node !== RDF_NIL && !seen.has(node)) {
    seen.add(node);
    const first = quads.find((q) => q.subject.value === node && q.predicate.value === RDF_FIRST);
    if (!first) break;
    members.push(first.object);
    node = quads.find((q) => q.subject.value === node && q.predicate.value === RDF_REST)?.object.value ?? RDF_NIL;
  }
  return members;
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

      const inQ = propQuads.find((q) => q.predicate.value === SH_IN);
      if (inQ) {
        shape.in = listMembers(shapesQuads, inQ.object.value).map((term) => ({
          value: term.value,
          isIri: term.termType === 'NamedNode',
        }));
      }

      if (propQuads.some((q) => q.predicate.value === SH_CLASS || (q.predicate.value === SH_NODE_KIND && LINK_NODE_KINDS.has(q.object.value)))) {
        shape.links = true;
      }

      if (shape.path) shapes.push(shape);
    }
  }

  return shapes;
}

export type { NameOf } from '../../model-manager/field-names.js';

/**
 * An allowed value's label: its name in the loaded data — reference data names
 * its values — else its local name in words (`SinglePageApp` → `Single Page App`).
 */
function choiceLabel(value: string, isIri: boolean, nameOf?: NameOf): string {
  if (!isIri) return value;
  const named = nameOf?.(value);
  if (named) return named;
  return iriLabel(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** The choice a shape's `sh:in` gives, labelled. */
function choicesOf(shape: ShaclPropertyShape | undefined, nameOf?: NameOf): PropertyChoice[] | undefined {
  if (!shape?.in || shape.in.length === 0) return undefined;
  return shape.in.map((member) => ({ ...member, label: choiceLabel(member.value, member.isIri, nameOf) }));
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

export { fieldName };

/**
 * Builds the list of PropertyEntry objects for a given element IRI
 * by querying the RDF store and optionally enriching with SHACL shape info.
 *
 * Order: type, inModel, prefLabel, definition ({@link LEADING_FIELDS}), then
 * every other property by label — so a property the modeller adds appears under
 * them. The name and the definition are listed even without a value
 * ({@link DEFAULT_FIELDS}), empty, so they can be filled in.
 * `arch:inView` and a relationship's `rdf:reifies` — which la-gram keeps in step
 * with its ends and type — are left out ({@link HIDDEN_FIELDS}), as is the
 * qualified predicate to each relationship (`PropertyPanel._loadProperties`). The panel shows the ID
 * above them all.
 */
export function buildPropertyEntries(
  quads: Quad[],
  shaclShapes: ShaclPropertyShape[],
  nameOf?: NameOf,
): PropertyEntry[] {
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
    const choices = isType ? undefined : choicesOf(shape, nameOf);
    entries.push({
      predicate,
      label: fieldName(predicate, shape, nameOf),
      value,
      ...(isIri ? { valueLabel: choiceLabel(value, true, nameOf) } : {}),
      // Types and links to other resources are shown, not typed over: editing
      // an IRI as free text is how dangling references get made. A link the
      // shape lists its values for (`sh:in`) is a choice among them instead.
      readonly: isType || (isIri && !choices),
      ...(choices ? { choices } : {}),
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
        label: fieldName(predicate, shape, nameOf),
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

/** The language la-gram reads names in (`labelOf`): a value in it is not marked. */
const NAMES_LANGUAGE = 'en';

/** A language's name (`de` → `German`), else its tag. */
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Text typed as a link's value: an address (`https:`, `urn:`, `mailto:`) links, anything else is text. */
function typedValue(text: string): TypedOption | undefined {
  const value = text.trim();
  if (!value) return undefined;
  return /^(https?|urn|mailto):/i.test(value)
    ? { iri: value, label: value, prefix: 'Link to: ' }
    : { iri: value, label: value, text: true, prefix: 'Text: ' };
}

/** A row, for showing its IRIs: its property and its value. */
function rowKey(entry: PropertyEntry): string {
  return `${entry.predicate} ${entry.value}`;
}

/** The ID row's key; no property row's, which all have a space. */
const ID_ROW = 'id';

/** The panel's vertical tabs, top to bottom. */
export type PanelSection = 'info' | 'properties' | 'analysis' | 'views' | 'appearance' | 'label' | 'figure' | 'image';

/** localStorage key of the open tab (kept across selections and reloads). */
const TAB_KEY = 'la-gram:property-panel-tab';

const PANEL_SECTIONS: PanelSection[] = ['info', 'properties', 'analysis', 'views', 'appearance', 'label', 'figure', 'image'];

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

    .property-value.provenance {
      color: #5f6368;
      white-space: normal;
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

    .type-field {
      display: flex;
      gap: 4px;
    }

    .type-field named-picker {
      flex: 1;
      min-width: 0;
    }

    .type-iri {
      border: 1px solid #dadce0;
      border-radius: 3px;
      padding: 0 6px;
      background: #fff;
      color: #5f6368;
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }

    .type-iri:hover,
    .type-iri[aria-expanded='true'] {
      border-color: #aecbfa;
      color: #1a73e8;
      background: #e8f0fe;
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

    .property-label {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* A field's name: clicked, it shows the IRIs behind the row. */
    .field-name {
      border: 0;
      padding: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }

    .field-name:hover,
    .field-name[aria-expanded='true'] {
      color: #1a73e8;
    }

    /* A link to another resource, by its name; clicked, it shows the IRI. */
    .property-value.named {
      display: block;
      line-height: normal;
      text-align: left;
      background: #f5f5f5;
      border-color: #e0e0e0;
      color: #3c4043;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .property-value.named:hover,
    .property-value.named[aria-expanded='true'] {
      border-color: #aecbfa;
    }

    /* The IRIs behind a row; a click selects one whole, to copy. */
    .iris {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 2px 8px;
      margin: 4px 0 0;
      font-size: 11px;
    }

    .iris dt {
      color: #80868b;
    }

    .iris dd {
      margin: 0;
      min-width: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #3c4043;
      overflow-wrap: anywhere;
      user-select: all;
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

    .derivation {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }
    .derivation .confirm-derivation {
      align-self: flex-start;
      margin-top: 2px;
    }
    .line-note {
      margin: 8px 0;
      font-size: 12px;
      color: var(--la-text-muted, #5f6368);
    }

    /* A view reference's *Opens*: the view's name, then Open and Change…; the list of views under them. */
    .opens {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .opens-view {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .opens-view.muted {
      padding: 0;
    }
    .opens-row named-picker {
      margin-top: 4px;
    }
    /* What it shows without a value of its own — a view reference's view's name — greyed until one is typed. */
    .property-value.inherited {
      color: #80868b;
    }
    .referenced-from .analysis-list {
      padding: 0;
    }

    /* The Appearance tab: two columns of fields; one when narrow. */
    .appearance {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      max-width: 760px;
      gap: 4px 24px;
      padding: 8px 12px;
    }

    .appearance-field {
      display: grid;
      grid-template-columns: 90px 1fr;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      font-size: 12px;
    }

    .appearance-field .controls {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
    }

    .appearance-field .controls .remove {
      margin-left: 0;
    }

    .appearance-field input[type='color'] {
      width: 40px;
      height: 22px;
      padding: 0;
      border: 1px solid #dadce0;
      border-radius: 3px;
      background: none;
    }

    .appearance-field input[type='number'] {
      width: 48px;
      font: inherit;
    }

    .appearance-field select,
    .appearance-field .font-name {
      font: inherit;
    }

    .appearance-field .font-name {
      width: 96px;
    }

    .segmented {
      display: inline-flex;
      border: 1px solid #dadce0;
      border-radius: 3px;
      overflow: hidden;
    }

    .segmented button {
      border: 0;
      border-right: 1px solid #dadce0;
      background: #fff;
      padding: 3px 6px;
      cursor: pointer;
      font: inherit;
      line-height: 1;
      min-width: 24px;
    }

    .segmented button:last-child {
      border-right: 0;
    }

    .segmented button[aria-pressed='true'] {
      background: #e8f0fe;
    }

    .segmented svg {
      width: 16px;
      height: 14px;
      fill: none;
      stroke: #3c4043;
      stroke-width: 1.4;
      display: block;
    }

    .appearance-field .mixed {
      display: block;
      font-size: 10px;
      color: #b06000;
    }

    .figure-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding: 10px 12px;
    }

    .figure-choice {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      width: 112px;
      padding: 8px 6px 6px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      background: #fff;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    .figure-choice[aria-checked='true'] {
      border-color: #1a73e8;
      background: #e8f0fe;
    }

    .figure-choice svg {
      width: 80px;
      height: 48px;
    }

    .figure-choice .muted-note {
      color: #80868b;
    }

    .figure-footer {
      padding: 0 12px;
    }

    .figure-own-picture {
      margin: 10px 12px 0;
      color: #5f6368;
      font-size: 12px;
    }

    /* Names by presentation: one field a context. */
    .context-name-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
    }

    .context-name {
      display: grid;
      grid-template-columns: minmax(120px, 200px) minmax(0, 1fr);
      gap: 8px;
      align-items: center;
    }

    .context-name[data-active='true'] .context-label,
    .context-picture[data-active='true'] .context-label {
      font-weight: 600;
    }

    .context-picture {
      display: grid;
      grid-template-columns: minmax(120px, 200px) minmax(0, 1fr);
      gap: 8px;
      align-items: center;
    }

    .context-picture-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .context-picture-controls .property-value {
      flex: 1;
      min-width: 0;
    }

    .context-picture-thumb {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }

    .context-label .muted {
      color: #80868b;
      font-weight: normal;
    }

    /* The Label tab: the expression, what it shows, and what it can say. */
    .label-tab {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      max-width: 736px;
    }

    .label-scope {
      margin: 0;
      font-size: 12px;
      color: #3c4043;
    }

    .label-every {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }

    .label-expression {
      width: 100%;
      box-sizing: border-box;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }

    .label-inherited {
      margin: 0;
      font-size: 12px;
      color: #80868b;
    }

    .label-errors {
      margin: 0;
      padding-left: 18px;
      color: #c5221f;
      font-size: 12px;
    }

    .label-preview {
      display: flex;
      gap: 8px;
      align-items: baseline;
    }

    .label-shown {
      margin: 0;
      font: inherit;
      white-space: pre-wrap;
    }

    .label-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .label-help {
      font-size: 12px;
      color: #3c4043;
    }

    .label-help ul {
      margin: 4px 0 0;
      padding-left: 18px;
    }

    /* The Image tab: the picture beside its address and position, then the model's pictures. */
    .image-tab {
      display: grid;
      grid-template-columns: 128px minmax(0, 1fr);
      gap: 8px 16px;
      padding: 10px 12px;
      max-width: 736px;
    }

    .image-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 128px;
      height: 96px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      background: #fff;
      color: #80868b;
      font-size: 12px;
      overflow: hidden;
    }

    .image-preview img {
      max-width: 100%;
      max-height: 100%;
    }

    .image-fields {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }

    .image-address {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }

    .image-error {
      color: #c5221f;
      font-size: 12px;
    }

    .remove-image {
      align-self: flex-start;
    }

    /* The scope bar of the Appearance, Figure and Image tabs: for the presentation chosen, or every one. */
    .look-scope-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 16px;
      padding: 10px 12px 0;
      max-width: 736px;
      font-size: 12px;
    }

    .look-scope {
      margin: 0;
      color: #3c4043;
    }

    .look-every {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .image-element-picture {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }

    .image-element-picture img {
      width: 32px;
      height: 32px;
      object-fit: contain;
      border: 1px solid #dadce0;
      border-radius: 4px;
    }

    .image-draw-as .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
    }

    .image-draw-as label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
    }

    .image-file-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .image-file-row .muted,
    .image-used-empty .muted {
      color: #80868b;
      font-size: 12px;
    }

    .image-used-empty p {
      margin: 4px 0 0;
    }

    .image-used {
      grid-column: 1 / -1;
    }

    .image-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }

    .image-choice {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      padding: 2px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
    }

    .image-choice[aria-pressed='true'] {
      border-color: #1a73e8;
      background: #e8f0fe;
    }

    .image-choice img {
      max-width: 100%;
      max-height: 100%;
    }

    @media (max-width: 480px) {
      .image-tab {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .appearance-notice {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 8px 12px 0;
      padding: 6px 10px;
      max-width: 736px;
      border-radius: 4px;
      background: #fef7e0;
      color: #3c4043;
      font-size: 12px;
    }

    .appearance-notice button {
      flex: none;
      font: inherit;
      border: 1px solid #dadce0;
      background: #fff;
      border-radius: 3px;
      cursor: pointer;
      padding: 2px 8px;
    }

    .appearance-footer {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 12px;
      padding-top: 6px;
      font-size: 12px;
      color: #5f6368;
    }

    .appearance-footer button {
      font: inherit;
      border: 1px solid #dadce0;
      background: #fff;
      border-radius: 3px;
      cursor: pointer;
      padding: 2px 8px;
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
    /** Whether a property's values are resources: its value is then picked from {@link concepts}. */
    takesLinks?(iri: string): boolean;
  };

  /** The model's concepts, by name, for the value of a link added; supplied by the host. */
  @property({ attribute: false })
  concepts?: () => NamedOption[];

  /**
   * The element types an element can be changed to — the loaded metamodels',
   * grouped as in the palette. Set for elements only; the type field is then a
   * choice rather than read-only.
   */
  @property({ attribute: false })
  typeChoices?: readonly ElementGroup[];

  /** Names values in the loaded data, for labelling choices; absent, choices are labelled by their IRIs. */
  @property({ attribute: false })
  nameOf?: NameOf;

  /**
   * What is selected on the canvas, for the Appearance tab: set by the host
   * for a selection made there — a placement, a line, a figure — and not for a
   * concept picked in the tree, which is the model's, not a diagram's.
   */
  @property({ attribute: false })
  appearance?: AppearanceSelection;

  /** The loaded metamodels' presentation contexts — the audiences — and the one chosen: for *Names by presentation*. */
  @property({ attribute: false })
  presentationContexts: Array<{ iri: string; label: string }> = [];

  @property({ attribute: false })
  activeContextIri = '';

  /** Whether the canvas draws the notation alone (its toolbar's *Notation only*): the Appearance tab then says so. */
  @property({ type: Boolean, attribute: false })
  notationOnly = false;

  @state() private _newValue = '';

  /** The open vertical tab; remembered per browser. */
  @state() private _tab: PanelSection = storedTab();

  /** The property chosen in the add row, so its value field can follow its shape. */
  @state() private _pickedPredicate = '';


  /** The rows whose IRIs are showing ({@link rowKey}); none, for another selection. */
  @state() private _shownIris: ReadonlySet<string> = new Set();

  /** Whether a view reference's *Change…* lists the views it can open; closed for another selection. */
  @state() private _changingReference = false;

  /** The selected concept's SHACL property shapes, by path. */
  private _shapes = new Map<string, ShaclPropertyShape>();

  @query('property-picker') private _picker?: PropertyPicker;
  @query('.add-row .new-value') private _valueInput?: HTMLInputElement;
  @query('.add-row named-picker.new-value') private _linkPicker?: NamedPicker;

  /** Computed property entries for the selected element. */
  @state()
  private _entries: PropertyEntry[] = [];

  /** Its provenance, shown read-only on the information tab (Req 9.16). */
  @state()
  private _provenance: ConceptProvenance = { other: [] };

  override willUpdate(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('selectedIri')) {
      this._shownIris = new Set();
      this._changingReference = false;
    }
    // Another selection, or another presentation: the Label and Image tabs edit what is in force for it, not the last
    // one's choice.
    if (changedProperties.has('appearance')) {
      const previous = changedProperties.get('appearance') as AppearanceSelection | undefined;
      const before = `${previous?.targets.map((t) => t.iri).join(' ')}|${previous?.context ?? ''}`;
      if (before !== `${this.appearance?.targets.map((t) => t.iri).join(' ')}|${this.appearance?.context ?? ''}`) {
        this._labelEveryContext = undefined;
      }
    }
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
      this._provenance = { other: [] };
      return;
    }

    // Query all triples where the selected IRI is the subject — but the way in
    // to each relationship it is the source of (`am4:qualifiedServing`, core's
    // `arch:hasQualifiedRelationship`): la-gram keeps it in step with the
    // relationship, as it does `rdf:reifies`, and Analysis lists the relationships.
    // Known by what it links — a relationship whose `arch:source` the concept is —
    // as well as by name, so a converter's or a mapping's own name for it is
    // left out too.
    const store = this.rdfStore;
    const subjectNode = { value: this.selectedIri, termType: 'NamedNode' } as NamedNode;
    const qualified = new Map<string, boolean>();
    const sourceOf = { value: NAMESPACES.arch + 'source', termType: 'NamedNode' } as NamedNode;
    const isPointer = (q: Quad): boolean => {
      if (q.object.termType !== 'NamedNode') return false;
      const predicate = q.predicate.value;
      if (!qualified.has(predicate)) qualified.set(predicate, isQualifiedPredicate(store, predicate));
      return qualified.get(predicate)! || store.getQuads(q.object as NamedNode, sourceOf, subjectNode).length > 0;
    };
    // Provenance is recorded, not edited: shown apart, read-only (Req 9.16).
    const quads = store.getQuads(subjectNode).filter((q) => !isPointer(q) && !q.predicate.value.startsWith(NAMESPACES.prov));
    this._provenance = provenanceOf(store, this.selectedIri);

    // Determine the element's rdf:type for SHACL shape lookup
    const typeQuad = quads.find((q) => q.predicate.value === RDF_TYPE);
    const typeIri = typeQuad?.object.value ?? '';

    // Extract SHACL shapes if a shapes graph is provided
    const shaclShapes = this.shapesGraph && typeIri
      ? extractShaclShapes(this.shapesGraph, typeIri)
      : [];
    this._shapes = new Map(shaclShapes.map((s) => [s.path, s]));

    // A relationship's direct statement: its predicate is a relationship type's unqualified form.
    const unqualified = { value: NAMESPACES.arch + 'unqualifiedForm', termType: 'NamedNode' } as NamedNode;
    const relationshipPredicates = new Map<string, boolean>();
    const isRelationship = (predicate: string): boolean => {
      if (!relationshipPredicates.has(predicate)) {
        const term = { value: predicate, termType: 'NamedNode' } as NamedNode;
        relationshipPredicates.set(predicate, store.getQuads(null, unqualified, term).length > 0);
      }
      return relationshipPredicates.get(predicate)!;
    };
    this._entries = buildPropertyEntries(quads, shaclShapes, this.nameOf).map((entry) =>
      entry.custom && entry.isIri && isRelationship(entry.predicate) ? { ...entry, drawn: true } : entry,
    );
  }

  /** Handle input change and propagate to ElementManager. */
  private _onPropertyChange(entry: PropertyEntry, newValue: string): void {
    if (entry.readonly || !this.selectedIri) return;

    // What it shows without a value of its own — a view reference's view's name — unchanged: no edit.
    if (entry.inherited && newValue === entry.value) return;
    const emptied = newValue.trim() === '';
    if (emptied && DEFAULT_FIELDS.includes(entry.predicate) && entry.emptied !== 'blank') {
      // Emptying the definition removes it, and a figure's text, which then draws nothing; a name cannot be emptied,
      // and the field shows the name again (the value bindings are `live`).
      if ((entry.predicate === SKOS_DEFINITION || entry.emptied === 'removed') && entry.value !== '') this._remove(entry);
      else this.requestUpdate();
      return;
    }
    // A view reference's text emptied is written empty: drawn as nothing.
    if (emptied && entry.emptied === 'blank') newValue = '';
    // What is replaced: its own value — an empty one too, as a reference's is — not what it shows without one.
    const own = !entry.inherited && (entry.value !== '' || entry.language !== undefined);

    // Keep the value's language; text without one gets `en`, which is what the
    // Linked.Archi shapes expect of labels and definitions.
    const language = entry.language ?? (TEXT_PREDICATES.has(entry.predicate) ? 'en' : undefined);

    const chosen = entry.choices?.find((c) => c.value === newValue);
    // Propagate through ElementManager if available
    if (this.elementManager) {
      const valueTerm = (
        chosen?.isIri
          ? DataFactory.namedNode(newValue)
          : language
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
          ...(chosen?.isIri ? { isIri: true } : !language && entry.datatype ? { datatype: entry.datatype } : {}),
          ...(own ? { previous: entry.value } : {}),
          ...(own && entry.language ? { previousLanguage: entry.language } : {}),
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
    if (!this.selectedIri) return;
    if (!predicate) {
      this._picker?.focus();
      return;
    }
    // A link's value: the concept picked, or what was typed — an address, or text.
    const link = this._linkPicker?.choice;
    const value = this._linkPicker ? (link?.iri ?? '') : this._newValue;
    if (value === '') {
      this._valueInput?.focus();
      return;
    }
    // The value takes the property's shape: a chosen IRI, or a literal of its datatype.
    const shape = this._shapes.get(predicate);
    const chosen = choicesOf(shape, this.nameOf)?.find((c) => c.value === value);
    const isIri = chosen?.isIri || (link !== undefined && !link.text);
    this._emit<PropertyChangeDetail>('property-add', {
      elementIri: this.selectedIri,
      predicate,
      value,
      ...(isIri ? { isIri: true } : shape?.datatype ? { datatype: shape.datatype } : {}),
    });
    this._picker?.clear();
    this._linkPicker?.clear();
    this._newValue = '';
    this._pickedPredicate = '';
  }

  /** Whether a property's values are resources: its shape or its vocabulary says so. */
  private _takesLinks(predicate: string): boolean {
    if (!predicate) return false;
    const shape = this._shapes.get(predicate);
    if (shape?.datatype) return false;
    return Boolean(shape?.links || this.catalog?.takesLinks?.(predicate));
  }

  private _renderRemove(entry: PropertyEntry) {
    // A value that falls back to another when taken away says to what: a view reference's text, to its view's name.
    if (entry.reset && !entry.readonly) {
      return html`<button class="remove reset" title=${entry.reset} @click=${() => this._remove(entry)}>×</button>`;
    }
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
          @property-picked=${(e: CustomEvent<{ iri: string }>) => {
            this._pickedPredicate = e.detail?.iri ?? '';
            this._newValue = '';
            void this.updateComplete.then(() => this._valueInput?.focus());
          }}
        ></property-picker>
        ${this._renderNewValue()}
        <button class="add" @click=${() => this._add()}>Add</button>
      </div>
    `;
  }

  /**
   * The add row's value field, following the picked property's shape: a
   * choice of its `sh:in` values, true/false for a boolean; for a link, the
   * model's concepts by name (or an address or text typed); else text.
   */
  private _renderNewValue() {
    const shape = this._shapes.get(this._pickedPredicate);
    const choices =
      choicesOf(shape, this.nameOf) ??
      (shape?.datatype === XSD_BOOLEAN
        ? [
            { value: 'true', label: 'true', isIri: false },
            { value: 'false', label: 'false', isIri: false },
          ]
        : undefined);
    if (choices) {
      return html`<select
        class="property-value new-value"
        .value=${live(this._newValue)}
        @change=${(e: Event) => (this._newValue = (e.target as HTMLSelectElement).value)}
      >
        <option value="" ?selected=${this._newValue === ''}>Choose…</option>
        ${choices.map((c) => html`<option value=${c.value} ?selected=${c.value === this._newValue}>${c.label}</option>`)}
      </select>`;
    }
    if (this._takesLinks(this._pickedPredicate)) {
      return html`<named-picker
        class="new-value link-value"
        label="Value"
        group-filter
        placeholder="Search the model, or type an address or text"
        iris="toggle"
        limit="100"
        .options=${() => (this.concepts?.() ?? []).filter((c) => c.iri !== this.selectedIri)}
        .typed=${typedValue}
        @named-submit=${() => this._add()}
      ></named-picker>`;
    }
    return html`<input
      class="property-value new-value"
      placeholder="Value"
      .value=${this._newValue}
      @input=${(e: Event) => (this._newValue = (e.target as HTMLInputElement).value)}
      @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._add()}
    />`;
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
   * The element's type as a choice of the loaded types, searched by name and
   * grouped as in the palette; types that share a name show their IRIs, and
   * the list's "Show IRIs" shows every one. Picking one asks the host
   * (`property-retype`); the host answers whether the type changed, and the
   * choice goes back to the current type when it did not (a cancelled warning,
   * say).
   */
  private _renderTypeChoice(entry: PropertyEntry, groups: readonly ElementGroup[]) {
    const options: NamedOption[] = groups.flatMap((group) =>
      group.elements.map((type) => ({ iri: type.iri, label: type.label, groupLabel: group.category || 'Other' })),
    );
    const current = options.find((o) => o.iri === entry.value) ?? {
      iri: entry.value,
      label: this.heading?.typeLabel ?? entry.valueLabel ?? entry.value,
    };
    const onPicked = (e: CustomEvent<NamedOption>) => {
      const picker = e.target as NamedPicker;
      const typeIri = e.detail.iri;
      if (typeIri === entry.value) return;
      this._emit('property-retype', {
        elementIri: this.selectedIri,
        typeIri,
        reply: (changed: boolean) => {
          if (!changed) picker.revert();
        },
      });
    };
    return html`
      <li class="property-row">
        ${this._renderLabel(entry)}
        <div class="type-field">
          <named-picker
            class="type-picker"
            label="Type"
            iris="toggle"
            .options=${() => options}
            .selected=${current}
            @named-picked=${onPicked}
          ></named-picker>
          <button
            type="button"
            class="type-iri"
            title="Show the type IRI"
            aria-label="Show the type IRI"
            aria-expanded=${this._irisShown(rowKey(entry)) ? 'true' : 'false'}
            @click=${() => this._toggleIris(rowKey(entry))}
          >IRI</button>
        </div>
        ${this._renderIris(entry)}
      </li>
    `;
  }

  private _irisShown(key: string): boolean {
    return this._shownIris?.has(key) ?? false;
  }

  /** Show a row's IRIs, or hide them again. */
  private _toggleIris(key: string): void {
    const shown = new Set(this._shownIris ?? []);
    if (!shown.delete(key)) shown.add(key);
    this._shownIris = shown;
  }

  /**
   * A row's name — clicked, it shows the IRIs behind the row — then whether it
   * is required, the value's language when asked for, and ×.
   */
  private _renderLabel(entry: PropertyEntry, withLanguage = false) {
    const isRequired = entry.minCount !== undefined && entry.minCount > 0;
    const key = rowKey(entry);
    return html`
      <div class="property-label">
        <button
          class="field-name"
          title="Show the IRIs"
          aria-expanded=${this._irisShown(key) ? 'true' : 'false'}
          @click=${() => this._toggleIris(key)}
        >${entry.label}</button>${isRequired ? html`<span class="required">*</span>` : nothing}
        ${withLanguage && entry.language && entry.language !== NAMES_LANGUAGE
          ? html`<span class="lang" title=${entry.language}>${languageName(entry.language)}</span>`
          : nothing}
        ${this._renderRemove(entry)}
      </div>
    `;
  }

  /** A row's IRIs, once shown: the property's, and the value's when it is a link. */
  private _renderIris(entry: PropertyEntry) {
    if (!this._irisShown(rowKey(entry))) return nothing;
    return html`<dl class="iris">
      <dt>Property IRI</dt>
      <dd>${entry.predicate}</dd>
      ${entry.isIri ? html`<dt>Value IRI</dt><dd>${entry.value}</dd>` : nothing}
    </dl>`;
  }

  /** A resource by its name, read-only; clicked, it shows the IRIs of its row (`key`). */
  private _renderNamed(key: string, name: string) {
    return html`<button
      class="property-value named"
      title="Show the IRI"
      aria-expanded=${this._irisShown(key) ? 'true' : 'false'}
      @click=${() => this._toggleIris(key)}
    >${name}</button>`;
  }

  /** The ID row: the concept's short identifier; clicked, its IRI. */
  /** What derived the relationship, from what — and, for a potential one not confirmed, the way to confirm it. */
  private _renderDerivation() {
    const d = this.heading?.derivation;
    if (!d) return nothing;
    const what =
      d.certainty === 'valid'
        ? 'Derived, valid: it holds, though the model does not state it'
        : d.confirmed
          ? 'Confirmed: proposed as a potential derivation, now stated in the model'
          : 'Potential: may hold, for the modeller to confirm';
    return html`
      <li class="property-row derivation-row" data-derivation=${d.certainty}>
        <div class="property-label"><span class="field-name">Derivation</span></div>
        <div class="derivation">
          <div>${what}${d.rule ? html` — <strong>${d.rule}</strong>` : nothing}</div>
          ${d.premises.length > 0
            ? html`<div class="muted">
                From
                ${d.premises.map(
                  (p, i) => html`${i > 0 ? ', ' : ''}<a
                      href="#"
                      class="premise"
                      title=${p.iri}
                      @click=${(e: Event) => {
                        e.preventDefault();
                        this._emit('panel-navigate', { iri: p.iri });
                      }}
                      >${p.label}</a
                    >`,
                )}
              </div>`
            : nothing}
          ${d.certainty === 'potential' && !d.confirmed
            ? html`<button class="confirm-derivation" @click=${() => this._emit('confirm-derivation', { iri: this.selectedIri })}>
                Confirm — state it in the model
              </button>`
            : nothing}
        </div>
      </li>
    `;
  }

  /**
   * A figure's information, or a line's from one: its text — its name, labelled
   * so. No type, definition, properties or analysis: it is drawing, not a model
   * element.
   */
  private _renderFigureText() {
    const reference = this.heading?.reference;
    // Its own text: one read from the store — an empty one too — not the empty field every concept is given.
    const own = this._entries.find((e) => e.predicate === SKOS_PREF_LABEL && (e.value !== '' || e.language !== undefined));
    // Emptied, a figure's text goes and a reference's is written empty: drawn as nothing either way. A reference with
    // none of its own shows its view's name, greyed, and × takes its own away to show that name again.
    const text: PropertyEntry = {
      ...(own ?? { predicate: SKOS_PREF_LABEL, value: '', readonly: false }),
      label: 'Text',
      ...(!reference
        ? { emptied: 'removed' as const }
        : own
          ? { emptied: 'blank' as const, placeholder: 'No text', reset: "Show the view's name" }
          : { emptied: 'blank' as const, value: reference.viewLabel ?? '', inherited: true }),
    } as PropertyEntry;
    return html`<ul class="property-list">${this._renderEntry(text)}${reference ? this._renderOpens(reference) : nothing}</ul>`;
  }

  /**
   * A view reference's *Opens* (Req 3.23): the view's name, *Open* — which says
   * so when the view is not in the model — and *Change…*, a filterable list of
   * the model's other views; the one picked is the view it opens.
   */
  private _renderOpens(reference: NonNullable<PropertyHeading['reference']>) {
    const groups: Record<ViewKind, string> = { Diagram: 'Diagrams', Catalog: 'Catalogs', Matrix: 'Matrices' };
    const options: NamedOption[] = reference.views.map((view) => ({ iri: view.iri, label: view.label, groupLabel: groups[view.kind] }));
    const onPicked = (e: CustomEvent<NamedOption>) => {
      this._changingReference = false;
      const viewIri = e.detail.iri;
      if (viewIri === reference.viewIri) return;
      this._emit<ReferenceViewChangeDetail>('reference-view-change', { nodeIri: this.selectedIri, viewIri });
    };
    return html`
      <li class="property-row opens-row">
        <div class="property-label"><span class="field-name">Opens</span></div>
        <div class="opens">
          <span class="opens-view ${reference.viewLabel === undefined ? 'muted' : ''}" title=${reference.viewIri ?? ''}
            >${reference.viewLabel ?? 'A view not in the model'}</span
          >
          <button type="button" class="open-view" @click=${() => this._emit('reference-open', { viewIri: reference.viewIri })}>Open</button>
          <button
            type="button"
            class="change-view"
            aria-expanded=${this._changingReference ? 'true' : 'false'}
            @click=${() => {
              this._changingReference = !this._changingReference;
              if (this._changingReference) void this.updateComplete.then(() => this.renderRoot.querySelector<NamedPicker>('named-picker.reference-view')?.focus());
            }}
          >Change…</button>
        </div>
        ${this._changingReference
          ? html`<named-picker
              class="reference-view"
              label="The view it opens"
              placeholder="Search the model's views…"
              group-filter
              .options=${() => options}
              @named-picked=${onPicked}
            ></named-picker>`
          : nothing}
      </li>
    `;
  }

  /** A view's *Referenced from* (Req 3.23): the views holding a reference to it, each opening that view; none, nothing. */
  private _renderReferencedFrom() {
    const holders = this.heading?.referencedFrom;
    if (!holders || holders.length === 0) return nothing;
    return html`
      <li class="property-row wide referenced-from">
        <div class="property-label"><span class="field-name">Referenced from</span></div>
        <ul class="analysis-list">
          ${holders.map(
            (view) => html`<li>
              <a
                href="#"
                title=${view.iri}
                @click=${(e: Event) => {
                  e.preventDefault();
                  this._emit('panel-open-view', { viewIri: view.iri });
                }}
                >${view.label}</a
              >
            </li>`,
          )}
        </ul>
      </li>
    `;
  }

  /**
   * The Appearance tab, row by row: fill colour and
   * gradient, fill opacity, line colour and width, line opacity and style,
   * icon colour, text alignment and position, font and font colour — the
   * fields every one selected has, each showing the first one's own value, or
   * what it is drawn with where it sets none; a value of its own can be taken
   * back to the default. With the canvas drawing the notation alone, it says
   * so, and offers to draw the look set here.
   */
  private _renderAppearance(selection: AppearanceSelection) {
    const { own, defaults, fields } = selection;
    const has = (key: AppearanceKey) => fields.includes(key);
    const shown = <K extends AppearanceKey>(key: K): Appearance[K] => own[key] ?? defaults[key];
    const reset = (key: AppearanceKey) =>
      own[key] !== undefined
        ? html`<button class="remove" title="Back to the default" @click=${() => this._appearanceChange({ [key]: null })}>×</button>`
        : nothing;
    // A field whose value differs among the selected says so: what it shows is the first one's.
    const mixed = new Set<string>(selection.mixed ?? []);
    const MIXED_BY: Record<string, string[]> = {
      fillOpacity: ['fillColor'],
      lineOpacity: ['lineColor'],
      font: ['fontName', 'fontSize', 'fontStyle'],
    };
    const isMixed = (key: string) => (MIXED_BY[key] ?? [key]).some((k) => mixed.has(k));
    const field = (key: string, label: string, controls: unknown) =>
      html`<div class="appearance-field" data-field=${key} data-mixed=${isMixed(key) ? 'true' : nothing}>
        <span class="field-label"
          >${label}${isMixed(key)
            ? html`<span class="mixed" title="The selected differ here: this is the first one's">mixed</span>`
            : nothing}</span
        ><span class="controls">${controls}</span>
      </div>`;
    const colour = (key: 'fillColor' | 'lineColor' | 'fontColor' | 'iconColor', label: string) =>
      field(
        key,
        label,
        html`<input
            type="color"
            aria-label=${label}
            .value=${live(hexColour(shown(key)) ?? '#000000')}
            @change=${(e: Event) =>
              this._appearanceChange({ [key]: withAlpha((e.target as HTMLInputElement).value, colourAlpha(shown(key))) })}
          />${reset(key)}`,
      );
    const opacity = (key: 'fillColor' | 'lineColor', label: string) =>
      field(
        key === 'fillColor' ? 'fillOpacity' : 'lineOpacity',
        label,
        html`<input
            type="number"
            min="0"
            max="100"
            step="5"
            aria-label=${label}
            .value=${live(String(Math.round(colourAlpha(shown(key)) * 100)))}
            @change=${(e: Event) => {
              const percent = Math.min(100, Math.max(0, Number((e.target as HTMLInputElement).value) || 0));
              this._appearanceChange({ [key]: withAlpha(hexColour(shown(key)) ?? '#000000', percent / 100) });
            }}
          />%`,
      );
    const segmented = <V extends string>(
      key: 'textAlignment' | 'textPosition' | 'labelAnchor',
      label: string,
      choices: ReadonlyArray<[V, string, string]>,
    ) =>
      field(
        key,
        label,
        html`<span class="segmented" role="group" aria-label=${label}>
            ${choices.map(
              ([value, name, path]) => html`<button
                type="button"
                title=${name}
                aria-label=${name}
                data-value=${value}
                aria-pressed=${shown(key) === value ? 'true' : 'false'}
                @click=${() => this._appearanceChange({ [key]: value })}
              >
                <svg viewBox="0 0 16 14" aria-hidden="true"><path d=${path}></path></svg>
              </button>`,
            )} </span
          >${reset(key)}`,
      );
    const fontStyle = shown('fontStyle');
    const toggleStyle = (word: 'bold' | 'italic' | 'underline') => {
      const words = new Set((fontStyle ?? '').split(/\s+/));
      if (words.has(word)) words.delete(word);
      else words.add(word);
      this._appearanceChange({ fontStyle: fontStyleOf([...words].join(' ')) ?? null });
    };
    const decoration = (key: 'sourceDecor' | 'targetDecor', label: string) =>
      field(
        key,
        label,
        html`<select
            aria-label=${label}
            @change=${(e: Event) => this._appearanceChange({ [key]: (e.target as HTMLSelectElement).value })}
          >
            ${DECORATIONS.map(([value, name]) => html`<option value=${value} ?selected=${(shown(key) ?? 'NoDecoration') === value}>${name}</option>`)}
          </select>${reset(key)}`,
      );
    const lineWidth = shown('lineWidth') ?? 1;
    const count = selection.targets.length;
    const ownSet = fields.filter((key) => own[key] !== undefined);
    const cells: Record<string, unknown> = {
      fillColor: has('fillColor') ? colour('fillColor', 'Fill colour') : nothing,
      gradient: has('gradient')
        ? field(
            'gradient',
            'Gradient',
            html`<select
                aria-label="Gradient"
                @change=${(e: Event) =>
                  this._appearanceChange({ gradient: ((e.target as HTMLSelectElement).value || null) as Appearance['gradient'] | null })}
              >
                ${GRADIENTS.map(([value, name]) => html`<option value=${value} ?selected=${(shown('gradient') ?? '') === value}>${name}</option>`)}
              </select>${reset('gradient')}`,
          )
        : nothing,
      fillOpacity: has('fillColor') ? opacity('fillColor', 'Fill opacity') : nothing,
      lineColor: has('lineColor') ? colour('lineColor', 'Line colour') : nothing,
      lineWidth: has('lineWidth')
        ? field(
            'lineWidth',
            'Line width',
            html`<select
                aria-label="Line width"
                @change=${(e: Event) => this._appearanceChange({ lineWidth: Number((e.target as HTMLSelectElement).value) })}
              >
                ${LINE_WIDTHS.some(([n]) => n === lineWidth) ? nothing : html`<option value=${lineWidth} selected>${lineWidth}</option>`}
                ${LINE_WIDTHS.map(([n, name]) => html`<option value=${n} ?selected=${n === lineWidth}>${name}</option>`)}
              </select>${reset('lineWidth')}`,
          )
        : nothing,
      lineOpacity: has('lineColor') ? opacity('lineColor', 'Line opacity') : nothing,
      // A shape's outline, or a line from a note's own line, in the same place.
      borderStyle: has('lineStyle')
        ? field(
            'lineStyle',
            'Line style',
            html`<select
                aria-label="Line style"
                @change=${(e: Event) =>
                  this._appearanceChange({ lineStyle: (e.target as HTMLSelectElement).value as Appearance['lineStyle'] })}
              >
                ${BORDER_STYLES.map(([value, name]) => html`<option value=${value} ?selected=${shown('lineStyle') === value}>${name}</option>`)}
              </select>${reset('lineStyle')}`,
          )
        : has('borderStyle')
        ? field(
            'borderStyle',
            'Line style',
            html`<select
                aria-label="Line style"
                @change=${(e: Event) =>
                  this._appearanceChange({ borderStyle: (e.target as HTMLSelectElement).value as Appearance['borderStyle'] })}
              >
                ${BORDER_STYLES.map(([value, name]) => html`<option value=${value} ?selected=${shown('borderStyle') === value}>${name}</option>`)}
              </select>${reset('borderStyle')}`,
          )
        : nothing,
      iconColor: has('iconColor') ? colour('iconColor', 'Icon colour') : nothing,
      sourceDecor: has('sourceDecor') ? decoration('sourceDecor', 'Start arrowhead') : nothing,
      targetDecor: has('targetDecor') ? decoration('targetDecor', 'End arrowhead') : nothing,
      textAlignment: has('textAlignment') ? segmented('textAlignment', 'Text alignment', ALIGNMENTS) : nothing,
      textPosition: has('textPosition') ? segmented('textPosition', 'Text position', POSITIONS) : nothing,
      labelAnchor: has('labelAnchor') ? segmented('labelAnchor', 'Text position', ANCHORS) : nothing,
      font: has('fontName')
        ? field(
            'font',
            'Font',
            html`<input
                class="font-name"
                list="font-names"
                aria-label="Font"
                placeholder="Default"
                .value=${live(own.fontName ?? '')}
                @change=${(e: Event) => this._appearanceChange({ fontName: (e.target as HTMLInputElement).value.trim() || null })}
              /><datalist id="font-names">${FONT_NAMES.map((name) => html`<option value=${name}></option>`)}</datalist>
              <input
                type="number"
                min="4"
                max="96"
                aria-label="Font size"
                .value=${live(String(shown('fontSize') ?? ''))}
                @change=${(e: Event) => {
                  const size = Math.round(Number((e.target as HTMLInputElement).value));
                  this._appearanceChange({ fontSize: size >= 1 ? size : null });
                }}
              />
              <span class="segmented" role="group" aria-label="Font style">
                ${(['bold', 'italic', 'underline'] as const).map(
                  (word) => html`<button
                    type="button"
                    title=${word[0]!.toUpperCase() + word.slice(1)}
                    aria-label=${word}
                    data-value=${word}
                    aria-pressed=${hasFontStyle(fontStyle, word) ? 'true' : 'false'}
                    style=${word === 'bold' ? 'font-weight:bold' : word === 'italic' ? 'font-style:italic' : 'text-decoration:underline'}
                    @click=${() => toggleStyle(word)}
                  >
                    ${word[0]!.toUpperCase()}
                  </button>`,
                )}
              </span>
              ${own.fontName !== undefined || own.fontSize !== undefined || own.fontStyle !== undefined
                ? html`<button
                    class="remove"
                    title="Back to the default font"
                    @click=${() => this._appearanceChange({ fontName: null, fontSize: null, fontStyle: null })}
                  >
                    ×
                  </button>`
                : nothing}`,
          )
        : nothing,
      fontColor: has('fontColor') ? colour('fontColor', 'Font colour') : nothing,
    };
    // The rows; one with neither field is left out, a missing one leaves its place empty.
    const rows = APPEARANCE_ROWS.filter((row) => row.some((key) => key && cells[key] !== nothing));
    const notationOnly = this.notationOnly && selection.targets.some((t) => t.kind === 'element' || t.kind === 'relationship');
    return html`
      ${this._renderLookScope()}
      ${notationOnly
        ? html`<div class="appearance-notice" role="status">
            <span
              ><strong>Notation only</strong> is on: elements and relationships are drawn as their notation has them, without the
              look set here.</span
            >
            <button class="show-own" @click=${() => this._notationOnly(false)}>Draw the look set here</button>
          </div>`
        : nothing}
      <div class="appearance">
        ${rows.map(
          ([left, right]) =>
            html`${cells[left!] === nothing ? html`<div class="appearance-gap"></div>` : cells[left!]}${right && cells[right] !== nothing
              ? cells[right]
              : html`<div class="appearance-gap"></div>`}`,
        )}
        <div class="appearance-footer">
          ${count > 1 ? html`<span>Changes apply to the ${count} selected.</span>` : nothing}
          ${ownSet.length > 0
            ? html`<button
                class="reset-appearance"
                title="Take every value back to the default"
                @click=${() => this._appearanceChange(Object.fromEntries(ownSet.map((key) => [key, null])) as AppearanceChanges)}
              >
                Reset all
              </button>`
            : nothing}
        </div>
      </div>
    `;
  }

  /**
   * The Figure tab: what an element is drawn as — its notation's
   * own figure, the notation's other figures (a banded box, a 3D box, …), its
   * glyph with its name under it, its shape alone — each a preview to pick. The
   * notation's is marked, and picked takes the placement's own figure away.
   */
  private _renderFigureChoices(choices: FigureChoices, count: number) {
    // Inside an <svg>, fragments in SVG's namespace.
    const preview = (option: FigureChoices['options'][number]) => {
      const drawn = option.preview;
      if ('icon' in drawn) {
        return html`<svg viewBox="0 0 80 48" aria-hidden="true">
          <image href=${choices.iconHref} x="24" y="2" width="32" height="34"></image>
          <rect x="22" y="40" width="36" height="4" rx="1" fill="#9aa0a6"></rect>
        </svg>`;
      }
      return html`<svg viewBox="0 0 80 48" aria-hidden="true">
        <g transform="translate(4,4)">
          <path d=${drawn.outline} fill=${choices.fillColor} stroke=${choices.lineColor} stroke-dasharray=${drawn.dashed ? '4 2' : nothing}></path>
          ${drawn.details ? svg`<path d=${drawn.details} fill="none" stroke=${choices.lineColor}></path>` : nothing}
        </g>
        ${drawn.badge ? svg`<image href=${choices.iconHref} x="58" y="7" width="14" height="14"></image>` : nothing}
        <rect x="20" y="24" width="40" height="4" rx="1" fill="#9aa0a6"></rect>
      </svg>`;
    };
    return html`
      ${this._renderLookScope()}
      ${choices.selected < 0
        ? html`<p class="figure-own-picture muted">
            Drawn with its own picture or its element's in place of the notation's glyph (the Image tab). A figure
            picked here puts the glyph back.
          </p>`
        : nothing}
      <div class="figure-choices" role="radiogroup" aria-label="Figure">
        ${choices.options.map(
          (option, index) => html`<button
            type="button"
            class="figure-choice"
            role="radio"
            data-mode=${option.shapeIri ? 'alternative' : option.mode}
            data-shape=${option.shapeIri ? option.shapeIri.split(/[#/]/).pop()! : nothing}
            aria-checked=${index === choices.selected ? 'true' : 'false'}
            title=${option.label}
            @click=${() =>
              this.appearance?.scope === 'context'
                ? // For the presentation chosen: its own figure.
                  this._appearanceChange(option.changes)
                : // For every presentation — and the one chosen, its own figure and icon taken away.
                  this._appearanceChange(
                    option.changes,
                    this.appearance?.context
                      ? { clearContext: { context: this.appearance.context, keys: ['renderingMode', 'shapeType', 'iconSymbol', 'useElementPicture'] } }
                      : {},
                  )}
          >
            ${preview(option)}
            <span>${option.label}${option.notation ? html`<span class="muted-note"> (notation)</span>` : nothing}</span>
          </button>`,
        )}
      </div>
      ${count > 1 ? html`<div class="appearance-footer figure-footer"><span>Changes apply to the ${count} selected.</span></div>` : nothing}
    `;
  }

  /** Whether the Label tab edits the expression for every presentation (else the one chosen); `undefined` until toggled. */
  @state() private _labelEveryContext: boolean | undefined;

  /**
   * The Label tab: what the selected elements' labels say — text with
   * placeholders — in the presentation in use, or the same in every one; the
   * notation's shown where they say nothing of their own; what the first shows
   * now, and what cannot be read.
   */
  private _renderLabelTab(choices: LabelChoices, count: number) {
    // With no presentation chosen, the one for every presentation is all there is to edit.
    const chosen = choices.context !== undefined;
    // Editing the one for every context when it is the one in force here, or when asked to.
    const everyContext = !chosen || (this._labelEveryContext ?? (choices.forContext === undefined && choices.forEvery !== undefined));
    const text = everyContext ? choices.forEvery : choices.forContext;
    const own = choices.forContext !== undefined || choices.forEvery !== undefined;
    const change = (detail: LabelExpressionChangeDetail) =>
      this.dispatchEvent(new CustomEvent<LabelExpressionChangeDetail>('label-expression-change', { detail, bubbles: true, composed: true }));
    const contextName = choices.contextLabel ?? 'the presentation chosen';
    return html`
      <div class="label-tab">
        <p class="label-scope">
          ${!chosen
            ? html`No presentation is chosen: what the label says in <strong>every presentation</strong>. Choose one above the
                canvas to say what it says there.`
            : everyContext
              ? html`What the label says in <strong>every presentation</strong>.`
              : html`What the label says for <strong>${contextName}</strong> — the presentation chosen now.`}
        </p>
        ${chosen
          ? html`<label class="label-every">
              <input
                type="checkbox"
                .checked=${live(everyContext)}
                @change=${(e: Event) => {
                  const every = (e.target as HTMLInputElement).checked;
                  this._labelEveryContext = every;
                  // What is written moves with it: for every context, or for this one.
                  const current = (every ? choices.forContext : choices.forEvery) ?? text;
                  if (current !== undefined) change({ expression: current, everyContext: every });
                }}
              />
              The same in every presentation
            </label>`
          : nothing}
        <textarea
          class="label-expression"
          rows="4"
          aria-label="Label expression"
          placeholder=${choices.inherited ?? '{name}'}
          .value=${live(text ?? '')}
          @change=${(e: Event) => change({ expression: (e.target as HTMLTextAreaElement).value || null, everyContext })}
        ></textarea>
        ${choices.inherited !== undefined && !own
          ? html`<p class="muted label-inherited">Its notation's or the presentation's, shown above until it says its own.</p>`
          : nothing}
        ${choices.errors.length > 0
          ? html`<ul class="label-errors" role="alert">${choices.errors.map((error) => html`<li>${error}</li>`)}</ul>`
          : nothing}
        <div class="label-preview">
          <span class="field-label">Shows</span>
          <pre class="label-shown">${choices.shown}</pre>
        </div>
        <div class="label-actions">
          ${own
            ? html`<button class="label-reset" @click=${() => change({ expression: null, everyContext: true, all: true })}>
                Back to the notation's
              </button>`
            : nothing}
          ${count > 1 ? html`<span class="muted">Changes apply to the ${count} selected.</span>` : nothing}
        </div>
        <details class="label-help">
          <summary>What it can say</summary>
          <ul>
            <li><code>{name}</code> — its name for the presentation chosen; <code>{type}</code> — its type;
              <code>{skos:prefLabel}</code> — its own name, whatever the presentation</li>
            <li><code>{dcterms:creator}</code>, <code>{&lt;https://…&gt;}</code> — a property's values; a resource by its name, several joined by commas</li>
            <li><code>{am4:assignedTo/skos:prefLabel}</code> — a path; <code>{^arch:target}</code> — a property followed backwards</li>
            <li><code>{{</code> and <code>}}</code> — a brace</li>
            <li>A line whose placeholders all come to nothing is left out.</li>
          </ul>
        </details>
      </div>
    `;
  }

  /**
   * *Names by presentation*: what an element or a relationship is called for
   * each presentation context (core 0.5.0's SKOS-XL names), each typed in its
   * own field — empty, it is called by its own name there; the context chosen
   * now marked. A change is `context-name-change`, for the host to write.
   */
  private _renderContextNames() {
    const kind = this.heading?.kind;
    const contexts = this.presentationContexts ?? [];
    if ((kind !== 'Element' && kind !== 'Relationship') || contexts.length === 0 || !this.rdfStore || !this.selectedIri) {
      return nothing;
    }
    const iri = this.selectedIri;
    const names = contextNamesOf(this.rdfStore, iri);
    const nameFor = (context: string) => (names.find((n) => n.context === context && n.language === 'en') ?? names.find((n) => n.context === context))?.name ?? '';
    return html`<li class="property-row wide context-names">
      <div class="property-label"><span class="field-name" title="What it is called for each audience">Names by presentation</span></div>
      <ul class="context-name-list">
        ${contexts.map(
          (context) => html`<li class="context-name" data-context=${context.iri} data-active=${context.iri === this.activeContextIri ? 'true' : nothing}>
            <span class="context-label">${context.label}${context.iri === this.activeContextIri ? html` <span class="muted">(chosen)</span>` : nothing}</span>
            <input
              class="property-value"
              aria-label=${`Name for ${context.label}`}
              placeholder="Its own name"
              .value=${live(nameFor(context.iri))}
              @change=${(e: Event) =>
                this.dispatchEvent(
                  new CustomEvent<ContextNameChangeDetail>('context-name-change', {
                    detail: { elementIri: iri, context: context.iri, name: (e.target as HTMLInputElement).value.trim() || null },
                    bubbles: true,
                    composed: true,
                  }),
                )}
            />
          </li>`,
        )}
      </ul>
    </li>`;
  }

  /**
   * *Pictures by presentation*: an element's own picture for every presentation
   * (`arch:prefVisNotation`) and one for each (`arch:altVisNotation`, core
   * 0.5.0), each an address typed or a picture file kept in the model —
   * empty, none. Drawn where a placement of it is drawn as its icon. A change
   * is `context-picture-change`, for the host to write.
   */
  private _renderContextPictures() {
    const contexts = this.presentationContexts ?? [];
    if (this.heading?.kind !== 'Element' || contexts.length === 0 || !this.rdfStore || !this.selectedIri) return nothing;
    const iri = this.selectedIri;
    const pictures = picturesOf(this.rdfStore, iri);
    const send = (context: string | null, url: string | null) =>
      this.dispatchEvent(
        new CustomEvent<ContextPictureChangeDetail>('context-picture-change', { detail: { elementIri: iri, context, url }, bubbles: true, composed: true }),
      );
    const row = (context: string | null, label: string) => {
      const current = pictures.find((p) => (p.context ?? null) === context)?.url;
      const key = context ?? 'every';
      return html`<li class="context-picture" data-context=${key} data-active=${context && context === this.activeContextIri ? 'true' : nothing}>
        <span class="context-label">${label}${context && context === this.activeContextIri ? html` <span class="muted">(chosen)</span>` : nothing}</span>
        <span class="context-picture-controls">
          ${current ? html`<img class="context-picture-thumb" src=${current} alt="" />` : nothing}
          <input
            class="property-value"
            type="url"
            aria-label=${`Picture for ${label}`}
            placeholder=${context ? 'Its picture for every presentation' : 'https://… or data:image/…'}
            .value=${live(current ?? '')}
            @change=${(e: Event) => {
              const typed = (e.target as HTMLInputElement).value.trim();
              if (typed && !imageUri(typed)) {
                this._imageError = 'An https:// address, or a data:image/… URI.';
                return;
              }
              this._imageError = '';
              send(context, typed || null);
            }}
          />
          <button type="button" class="choose-picture" title="Keep a picture file in the model, up to ${KEPT_PICTURE_LIMIT / 1024} KB"
            @click=${(e: Event) => (e.target as HTMLElement).parentElement?.querySelector<HTMLInputElement>('.context-picture-file')?.click()}>
            Choose file…
          </button>
          <input class="context-picture-file" type="file" accept="image/*" hidden
            @change=${(e: Event) => this._keepPictureFile(e.target as HTMLInputElement, current, (uri) => send(context, uri))} />
        </span>
      </li>`;
    };
    return html`<li class="property-row wide context-pictures">
      <div class="property-label"><span class="field-name" title="Its own picture for each audience">Pictures by presentation</span></div>
      <ul class="context-name-list">
        ${row(null, 'Every presentation')} ${contexts.map((context) => row(context.iri, context.label))}
      </ul>
      ${this._imageError ? html`<div class="image-error" role="alert">${this._imageError}</div>` : nothing}
    </li>`;
  }

  /** What was typed as a picture's address and is not one: said under the field, nothing written. */
  @state() private _imageError = '';

  /**
   * The scope the Appearance, Figure and Image tabs share — they write the same
   * style (core-vis 0.7: one for every presentation, one for each): with a
   * presentation chosen, which one a change is for, and *The same in every
   * presentation* to switch — a `look-scope-change`, for the host to read the
   * selection's look again in the other scope.
   */
  private _renderLookScope() {
    const selection = this.appearance;
    if (!selection) return nothing;
    const chosen = selection.context !== undefined;
    const every = !chosen || selection.scope !== 'context';
    const name = selection.contextLabel ?? 'the presentation chosen';
    return html`<div class="look-scope-bar">
      <p class="look-scope">
        ${!chosen
          ? html`For <strong>every presentation</strong>. Choose a presentation above the canvas to set a look for it alone.`
          : every
            ? html`For <strong>every presentation</strong>.`
            : html`For <strong>${name}</strong> — the presentation chosen now.`}
      </p>
      ${chosen
        ? html`<label class="look-every">
            <input
              type="checkbox"
              .checked=${live(every)}
              @change=${(e: Event) =>
                this.dispatchEvent(
                  new CustomEvent<{ everyContext: boolean }>('look-scope-change', {
                    detail: { everyContext: (e.target as HTMLInputElement).checked },
                    bubbles: true,
                    composed: true,
                  }),
                )}
            />
            The same in every presentation
          </label>`
        : nothing}
    </div>`;
  }

  /**
   * A picture file chosen with "Choose file…": kept in the model as a
   * `data:` URI — an image, no larger than {@link KEPT_PICTURE_LIMIT} — or
   * refused, the tab saying why.
   */
  private _keepPictureFile(input: HTMLInputElement, current: string | undefined, give: (uri: string) => void): void {
    const file = input.files?.[0];
    // Cleared, so choosing the same file again is a change.
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this._imageError = `${file.name} is not a picture.`;
      return;
    }
    if (file.size > KEPT_PICTURE_LIMIT) {
      this._imageError = `${file.name} is over ${KEPT_PICTURE_LIMIT / 1024} KB, too large to keep in the model: put it where it can be linked, and type its address.`;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const uri = imageUri(typeof reader.result === 'string' ? reader.result : undefined);
      if (!uri) {
        this._imageError = `${file.name} could not be read as a picture.`;
        return;
      }
      this._imageError = '';
      if (uri !== current) give(uri);
    };
    reader.onerror = () => {
      this._imageError = `${file.name} could not be read.`;
    };
    reader.readAsDataURL(file);
  }

  /**
   * The Image tab: the picture drawn in the selected — its address typed, a
   * file kept in the model, or one of the pictures the model already uses —
   * and where: inside the figure, at a position, or — an element — as the
   * figure itself, its name under it (its own `arch-vis:iconSymbol`, drawn
   * `IconCentric`); removed, none. An address that is not an http(s) URL or a
   * `data:image/…` URI is refused where it is typed.
   */
  private _renderImage(choices: ImageChoices, count: number) {
    // For the presentation chosen, or for every one — with none chosen, or for figures, for every one only.
    const chosen = choices.context !== undefined;
    // The scope the Appearance, Figure and Image tabs share (the scope bar above them).
    const everyContext = !chosen || this.appearance?.scope !== 'context';
    const scope: ImageScope = everyContext ? choices : (choices.forContext ?? { position: 'TopLeft' });
    const change = (changes: AppearanceChanges) =>
      this._appearanceChange(
        changes,
        !chosen
          ? {}
          : everyContext
            ? // So that it shows in the presentation chosen too.
              { clearContext: { context: choices.context!, keys: IMAGE_SCOPE_KEYS } }
            : { context: choices.context! },
      );
    const current = scope.image;
    // The picture *Draw it* is about: the placement's own, else its element's own (Pictures by presentation),
    // which core-vis 0.8 draws inside a box, as the figure in icon mode, or as the badge where asked.
    const elementPicture = choices.canBeFigure && !current ? choices.elementPicture : undefined;
    // Where it is drawn: inside the figure, as the figure, or as its badge.
    const drawnAs: 'inside' | 'figure' | 'badge' = current
      ? scope.asFigure
        ? 'figure'
        : scope.asBadge
          ? 'badge'
          : 'inside'
      : scope.elementAsFigure && elementPicture
        ? 'figure'
        : scope.elementAsBadge
          ? 'badge'
          : 'inside';
    // A picture given: in the figure, as it, or as its badge — its own, in place of its element's.
    const give = (uri: string) => change(drawnAs === 'inside' ? { image: uri } : { iconSymbol: uri, useElementPicture: null });
    const remove: AppearanceChanges = drawnAs === 'inside' ? { image: null, imagePosition: null } : { iconSymbol: null, renderingMode: null };
    const drawAs = (as: 'inside' | 'figure' | 'badge') => {
      if (as === drawnAs) return;
      if (current) {
        change(
          as === 'figure'
            ? { iconSymbol: current, renderingMode: 'IconCentric', shapeType: null, image: null, imagePosition: null, useElementPicture: null }
            : as === 'badge'
              ? // Its figure kept; the picture in place of its type's glyph.
                { iconSymbol: current, renderingMode: 'ShapeWithBadge', image: null, imagePosition: null, useElementPicture: null }
              : { image: current, iconSymbol: null, renderingMode: null, useElementPicture: null },
        );
        return;
      }
      if (!elementPicture) return;
      // Its element's picture: as its icon (core-vis 0.7), as its badge (0.8, followed as it changes), or inside the box.
      change(
        as === 'figure'
          ? { renderingMode: 'IconCentric', useElementPicture: null, iconSymbol: null, image: null, imagePosition: null, shapeType: null }
          : as === 'badge'
            ? { renderingMode: 'ShapeWithBadge', useElementPicture: true, iconSymbol: null }
            : { renderingMode: null, useElementPicture: null },
      );
    };
    // A picture of its own given up for its element's, drawn where its own was.
    const useElementPicture = () =>
      change(drawnAs === 'inside' ? { image: null } : drawnAs === 'badge' ? { iconSymbol: null, useElementPicture: true } : { iconSymbol: null });
    const setAddress = (input: HTMLInputElement) => {
      const typed = input.value.trim();
      if (!typed) {
        this._imageError = '';
        if (current) change(remove);
        return;
      }
      const uri = imageUri(typed);
      if (!uri) {
        this._imageError = 'An https:// address, or a data:image/… URI.';
        return;
      }
      this._imageError = '';
      if (uri !== current) give(uri);
    };
    const shown = current ?? elementPicture;
    return html`
      ${this._renderLookScope()}
      <div class="image-tab">
        <div class="image-preview" data-empty=${shown ? nothing : 'true'} data-element-picture=${!current && shown ? 'true' : nothing}>
          ${shown ? html`<img src=${shown} alt="The picture drawn" />` : html`<span>No image</span>`}
          ${!current && shown ? html`<span class="muted image-whose">Its element's own picture</span>` : nothing}
        </div>
        <div class="image-fields">
          <label class="appearance-field" data-field="image">
            <span class="field-label">Address</span>
            <span class="controls">
              <input
                class="image-address"
                type="url"
                placeholder="https://… or data:image/…"
                aria-label="Picture address"
                .value=${live(current ?? '')}
                @change=${(e: Event) => setAddress(e.target as HTMLInputElement)}
              />
            </span>
          </label>
          <div class="image-file-row">
            <button
              type="button"
              class="choose-image"
              title="Keep a picture file in the model, up to ${KEPT_PICTURE_LIMIT / 1024} KB"
              @click=${() => this.renderRoot.querySelector<HTMLInputElement>('.image-file')?.click()}
            >
              Choose file…
            </button>
            <span class="muted">kept in the model, up to ${KEPT_PICTURE_LIMIT / 1024} KB</span>
            <input
              class="image-file"
              type="file"
              accept="image/*"
              hidden
              @change=${(e: Event) => this._keepPictureFile(e.target as HTMLInputElement, current, give)}
            />
          </div>
          ${this._imageError ? html`<div class="image-error" role="alert">${this._imageError}</div>` : nothing}
          ${choices.canBeFigure && choices.elementPicture && current
            ? html`<div class="image-element-picture">
                <img src=${choices.elementPicture} alt="" />
                <button type="button" class="use-element-picture" @click=${useElementPicture}>Use its element's own picture</button>
              </div>`
            : nothing}
          ${choices.canBeFigure
            ? html`<div class="appearance-field image-draw-as" data-field="drawAs" role="radiogroup" aria-label="Draw the picture">
                <span class="field-label">Draw it</span>
                <span class="controls">
                  <label
                    ><input type="radio" name="image-draw-as" value="inside" ?disabled=${!shown} .checked=${live(drawnAs === 'inside')} @change=${() => drawAs('inside')} />
                    inside the figure</label
                  >
                  <label
                    ><input type="radio" name="image-draw-as" value="figure" ?disabled=${!shown} .checked=${live(drawnAs === 'figure')} @change=${() => drawAs('figure')} />
                    as the figure, its name under it</label
                  >
                  <label
                    ><input type="radio" name="image-draw-as" value="badge" ?disabled=${!shown} .checked=${live(drawnAs === 'badge')} @change=${() => drawAs('badge')} />
                    in the badge, in place of its type's glyph</label
                  >
                </span>
              </div>`
            : nothing}
          <label class="appearance-field" data-field="imagePosition">
            <span class="field-label">Position</span>
            <span class="controls">
              <select
                aria-label="Picture position"
                ?disabled=${!shown || drawnAs !== 'inside'}
                @change=${(e: Event) => change({ imagePosition: (e.target as HTMLSelectElement).value as ImagePosition })}
              >
                ${IMAGE_POSITIONS.map(([value, name]) => html`<option value=${value} ?selected=${scope.position === value}>${name}</option>`)}
              </select>
            </span>
          </label>
          ${current ? html`<button class="remove-image" @click=${() => change(remove)}>Remove image</button>` : nothing}
        </div>
        ${choices.used.length === 0
          ? html`<div class="image-used image-used-empty">
              <span class="field-label">Pictures in this model</span>
              <p class="muted">None yet. Once an element or a figure has a picture, it is listed here, to give to others with a click.</p>
            </div>`
          : html`<div class="image-used">
              <span class="field-label">Pictures in this model</span>
              <div class="image-grid">
                ${choices.used.map(
                  (uri) => html`<button
                    type="button"
                    class="image-choice"
                    title=${uri.startsWith('data:') ? 'A picture kept in the model' : uri}
                    aria-pressed=${uri === current ? 'true' : 'false'}
                    @click=${() => {
                      this._imageError = '';
                      if (uri !== current) give(uri);
                    }}
                  >
                    <img src=${uri} alt="" />
                  </button>`,
                )}
              </div>
            </div>`}
        ${count > 1 ? html`<div class="appearance-footer"><span>Changes apply to the ${count} selected.</span></div>` : nothing}
      </div>
    `;
  }

  /** Draw the notation alone, or the look set in the view: `notation-only`, as the canvas toolbar's switch. */
  private _notationOnly(on: boolean): void {
    this.dispatchEvent(new CustomEvent<{ on: boolean }>('notation-only', { detail: { on }, bubbles: true, composed: true }));
  }

  /**
   * A value changed in the Appearance, Figure or Image tab: `appearance-change`,
   * for the host to write undoably — for the presentation chosen when the tabs
   * show its look (the scope bar), unless `scope` says otherwise.
   */
  private _appearanceChange(changes: AppearanceChanges, scope?: Omit<AppearanceChangeDetail, 'changes'>): void {
    const inScope = scope ?? (this.appearance?.scope === 'context' && this.appearance.context ? { context: this.appearance.context } : {});
    this.dispatchEvent(
      new CustomEvent<AppearanceChangeDetail>('appearance-change', { detail: { changes, ...inScope }, bubbles: true, composed: true }),
    );
  }

  private _renderId() {
    const shown = this._irisShown(ID_ROW);
    return html`
      <li class="property-row id-row">
        <div class="property-label">
          <button class="field-name" title="Show the IRI" aria-expanded=${shown ? 'true' : 'false'} @click=${() => this._toggleIris(ID_ROW)}>ID</button>
        </div>
        ${this._renderNamed(ID_ROW, localName(this.selectedIri))}
        ${shown ? html`<dl class="iris"><dt>IRI</dt><dd>${this.selectedIri}</dd></dl>` : nothing}
      </li>
    `;
  }

  /**
   * The provenance, read-only: when the concept was last changed, by whom and with which tool; and its other
   * PROV statements, as a converter's source. Recorded by la-gram and the converters, never edited here.
   */
  private _renderProvenance() {
    const { changed, other } = this._provenance ?? { other: [] };
    if (!changed && other.length === 0) return nothing;
    const when = (at: string) => {
      const date = new Date(at);
      return Number.isNaN(date.getTime()) ? at : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    };
    return html`${changed
      ? html`<li class="property-row provenance-row">
          <div class="property-label"><span class="field-name" title="Recorded by la-gram as it is edited">Last changed</span></div>
          <span class="property-value provenance" data-provenance="changed"
            >${[when(changed.at), changed.by ? `by ${changed.by}` : '', changed.tool ? `with ${changed.tool}` : '']
              .filter(Boolean)
              .join(' · ')}</span
          >
        </li>`
      : nothing}
    ${other.map(
      (o) => html`<li class="property-row provenance-row">
        <div class="property-label"><span class="field-name">${fieldName(o.predicate)}</span></div>
        <span class="property-value provenance" data-provenance=${o.predicate}>${this.nameOf?.(o.value) ?? o.value}</span>
      </li>`,
    )}`;
  }

  private _renderEntry(entry: PropertyEntry) {
    const rowClass = 'property-row';

    // An element's own type: a choice of the loaded types.
    if (entry.predicate === RDF_TYPE && this.typeChoices && this.typeChoices.length > 0 && entry.value === this.heading?.typeIri) {
      return this._renderTypeChoice(entry, this.typeChoices);
    }

    // A value from the shape's list (`sh:in`).
    if (entry.choices && !entry.readonly) {
      const listed = entry.choices.some((c) => c.value === entry.value);
      return html`
        <li class=${rowClass}>
          ${this._renderLabel(entry)}
          <select
            class="property-value choice"
            @change=${(e: Event) => this._onPropertyChange(entry, (e.target as HTMLSelectElement).value)}
          >
            ${listed ? nothing : html`<option value=${entry.value} selected>${entry.valueLabel ?? entry.value}</option>`}
            ${entry.choices.map((c) => html`<option value=${c.value} ?selected=${c.value === entry.value}>${c.label}</option>`)}
          </select>
          ${this._renderIris(entry)}
        </li>
      `;
    }

    // A link to another resource, read-only: its name.
    if (entry.isIri && entry.readonly) {
      return html`
        <li class=${rowClass}>
          ${this._renderLabel(entry)}
          ${this._renderNamed(rowKey(entry), entry.valueLabel ?? entry.value)}
          ${this._renderIris(entry)}
        </li>
      `;
    }

    // A boolean: ticked or not, saved as true/false.
    if (entry.datatype === XSD_BOOLEAN && !entry.readonly) {
      return html`
        <li class=${rowClass}>
          ${this._renderLabel(entry)}
          <input
            class="property-value"
            type="checkbox"
            .checked=${live(entry.value === 'true' || entry.value === '1')}
            @change=${(e: Event) => this._onPropertyChange(entry, String((e.target as HTMLInputElement).checked))}
          />
          ${this._renderIris(entry)}
        </li>
      `;
    }

    if (this._isTextArea(entry)) {
      return html`
        <li class="${rowClass} wide">
          ${this._renderLabel(entry)}
          <textarea
            class="property-value"
            .value=${live(entry.value)}
            placeholder=${entry.value ? '' : (entry.placeholder ?? DEFAULT_FIELD_PLACEHOLDER[entry.predicate] ?? '')}
            ?readonly=${entry.readonly}
            @change=${(e: Event) =>
              this._onPropertyChange(entry, (e.target as HTMLTextAreaElement).value)}
          ></textarea>
          ${this._renderIris(entry)}
        </li>
      `;
    }

    return html`
      <li class=${rowClass}>
        ${this._renderLabel(entry, true)}
        <input
          class="property-value ${entry.inherited ? 'inherited' : ''}"
          type=${this._inputType(entry)}
          .value=${live(entry.value)}
          placeholder=${entry.value ? '' : (entry.placeholder ?? DEFAULT_FIELD_PLACEHOLDER[entry.predicate] ?? '')}
          ?readonly=${entry.readonly}
          @change=${(e: Event) =>
            this._onPropertyChange(entry, (e.target as HTMLInputElement).value)}
        />
        ${this._renderIris(entry)}
      </li>
    `;
  }

  override render() {
    if (!this.selectedIri) {
      return html`<div class="no-selection">No element selected — select an element, a relationship or a view.</div>`;
    }
    const entries = this._entries ?? [];
    const leading = entries.filter((e) => !e.custom);
    const added = entries.filter((e) => e.custom && !e.drawn);
    const a = this.analysis;
    const kind = this.heading?.kind ?? 'Element';
    // A figure, or a line from one, is drawing: its information and its look — nothing of the model's.
    const drawing = this.heading?.figure ? 'figure' : this.heading?.line ? 'line' : undefined;
    const appearance = this.appearance;
    const tabs: Array<{ id: PanelSection; title: string; count?: number }> = [
      { id: 'info', title: `${kind} information` },
      ...(drawing
        ? []
        : [
            { id: 'properties' as const, title: 'Properties', count: added.length },
            ...(a
              ? [
                  { id: 'analysis' as const, title: 'Analysis', count: a.relationships.length },
                  { id: 'views' as const, title: 'Appears in views', count: a.views.length },
                ]
              : []),
          ]),
      ...(appearance ? [{ id: 'appearance' as const, title: 'Appearance' }] : []),
      ...(appearance?.label ? [{ id: 'label' as const, title: 'Label' }] : []),
      ...(appearance?.figure ? [{ id: 'figure' as const, title: 'Figure' }] : []),
      ...(appearance?.image ? [{ id: 'image' as const, title: 'Image' }] : []),
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
          ${active === 'appearance' && appearance
            ? this._renderAppearance(appearance)
            : active === 'figure' && appearance?.figure
              ? this._renderFigureChoices(appearance.figure, appearance.targets.length)
            : active === 'image' && appearance?.image
              ? this._renderImage(appearance.image, appearance.targets.length)
            : active === 'label' && appearance?.label
              ? this._renderLabelTab(appearance.label, appearance.targets.length)
            : active === 'info' && drawing === 'figure'
              ? this._renderFigureText()
              : active === 'info' && drawing === 'line' && this.heading?.line
                ? html`<p class="line-note">
                      From <strong>${this.heading.line.from}</strong> to <strong>${this.heading.line.to}</strong> — drawn
                      in this view only; no relationship in the model.
                    </p>
                    ${this._renderFigureText()}`
                : active === 'info'
            ? html`<ul class="property-list">
                ${this._renderDerivation()} ${this._renderId()} ${leading.map((entry) => this._renderEntry(entry))}
                ${this._renderReferencedFrom()} ${this._renderContextNames()} ${this._renderContextPictures()} ${this._renderProvenance()}
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
