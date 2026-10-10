/**
 * Visual notation extraction.
 *
 * Reads the `arch-vis:` visual-notation layer out of a loaded metamodel graph:
 *
 * ```
 * PresentationContext --arch:usesNotationSet--> NotationSet
 * NotationSet <--arch-vis:inNotationSet-- VisualNotation
 * VisualNotation --arch-vis:notationFor--> element/relationship class
 * VisualNotation --arch-vis:defaultStyle--> Style
 * VisualNotation --arch:prefVisNotation--> pre-rendered composite image
 * ```
 *
 * This module deliberately works on a plain n3 `Store` rather than the
 * `RdfStore` abstraction so it stays synchronous and directly unit-testable.
 *
 * `Style` nodes are usually Turtle blank nodes (`[ ... ]`). All lookups pass the
 * n3 `Term` straight through to `Store.getObjects()`, which accepts any term as
 * subject — never reconstruct a subject from its string value.
 */

import { DataFactory } from 'n3';
import type { Store, Term } from 'n3';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const { namedNode } = DataFactory;

const ARCH = NAMESPACES.arch;
const ARCH_VIS = NAMESPACES['arch-vis'];
const SKOS = NAMESPACES.skos;
const RDFS = NAMESPACES.rdfs;
const RDF_TYPE = `${NAMESPACES.rdf}type`;

/** `arch:` and `arch-vis:` terms used by the notation layer. */
const T = {
  metamodel: `${ARCH}Metamodel`,
  notationSet: `${ARCH}notationSet`,
  usesNotationSet: `${ARCH}usesNotationSet`,
  prefVisNotation: `${ARCH}prefVisNotation`,
  notationSetClass: `${ARCH_VIS}NotationSet`,
  visualNotationClass: `${ARCH_VIS}VisualNotation`,
  inNotationSet: `${ARCH_VIS}inNotationSet`,
  notationFor: `${ARCH_VIS}notationFor`,
  defaultStyle: `${ARCH_VIS}defaultStyle`,
  shapeType: `${ARCH_VIS}shapeType`,
  fillColor: `${ARCH_VIS}fillColor`,
  lineColor: `${ARCH_VIS}lineColor`,
  fontColor: `${ARCH_VIS}fontColor`,
  iconSymbol: `${ARCH_VIS}iconSymbol`,
  iconPlacement: `${ARCH_VIS}iconPlacement`,
  renderingMode: `${ARCH_VIS}renderingMode`,
  defaultWidth: `${ARCH_VIS}defaultWidth`,
  defaultHeight: `${ARCH_VIS}defaultHeight`,
  borderStyle: `${ARCH_VIS}borderStyle`,
  fallbackShape: `${ARCH_VIS}fallbackShape`,
  shapeVariables: `${ARCH_VIS}shapeVariables`,
  outlinePath: `${ARCH_VIS}outlinePath`,
  detailPath: `${ARCH_VIS}detailPath`,
  contentBox: `${ARCH_VIS}contentBox`,
  labelBox: `${ARCH_VIS}labelBox`,
  lineStyle: `${ARCH_VIS}lineStyle`,
  sourceDecor: `${ARCH_VIS}sourceDecor`,
  targetDecor: `${ARCH_VIS}targetDecor`,
  prefLabel: `${SKOS}prefLabel`,
  rdfsLabel: `${RDFS}label`,
} as const;

// ---------------------------------------------------------------------------
// Type vocabulary
// ---------------------------------------------------------------------------

/** How shape and icon are composed when rendering an element. */
export type RenderingMode = 'ShapeWithBadge' | 'IconCentric' | 'ShapeOnly';

/**
 * The core shapes (`core-vis`), which every renderer draws natively. A
 * notation's own shapes are {@link CustomShape}s: declared in its namespace with
 * a core fallback and their geometry as path templates.
 */
export type ShapeType =
  | 'RoundedRectangle'
  | 'Rectangle'
  | 'Octagon'
  | 'Ellipse'
  | 'Circle'
  | 'Hexagon'
  | 'Diamond'
  | 'Parallelogram';

/**
 * A shape a notation declares itself (an `arch-vis:ShapeType` outside core-vis),
 * read from its data: the core shape to fall back to and its geometry as path
 * templates — SVG path data whose numbers may be `{expressions}` over `w`, `h`
 * and the variables. `notation-shapes.ts` evaluates them.
 */
export interface CustomShape {
  iri: string;
  /** `arch-vis:fallbackShape`: drawn when the templates cannot be. */
  fallback?: ShapeType;
  /** `arch-vis:shapeVariables`: `name = expression` assignments, `;`-separated. */
  variables?: string;
  /** `arch-vis:outlinePath`: filled, stroked, docked against. */
  outline: string;
  /** `arch-vis:detailPath`: inner lines, stroked only. */
  details?: string;
  /** `arch-vis:contentBox`: `x y width height` for the badge and label. */
  contentBox?: string;
  /** `arch-vis:labelBox`: `x y width height` for the label, when elsewhere. */
  labelBox?: string;
}

/** Icon position within (or relative to) the shape. */
export type IconPlacement = 'TopRight' | 'TopLeft' | 'TopCenter' | 'Center' | 'BottomCenter';

/** Line rendering for relationship notation. */
export type LineStyle = 'SolidLine' | 'DashedLine' | 'DottedLine';

/** Endpoint decoration for relationship arrows. */
export type Decoration =
  | 'NoDecoration'
  | 'OpenArrowhead'
  | 'ClosedArrowhead'
  | 'HollowArrowhead'
  | 'HollowDiamond'
  | 'FilledDiamond'
  | 'HalfArrowhead'
  | 'CircleDot';

/** Visual style for an element type — the construction recipe. */
export interface VisualStyle {
  /** A core shape — for a notation's own shape, its fallback. */
  shapeType?: ShapeType;
  /** A notation's own shape, drawn from its templates in place of {@link shapeType}. */
  customShape?: CustomShape;
  fillColor?: string;
  lineColor?: string;
  /** Colour of the label (`arch-vis:fontColor`); the line colour when absent. */
  fontColor?: string;
  /** URI of the icon (SVG) to draw. */
  iconSymbol?: string;
  iconPlacement?: IconPlacement;
  renderingMode?: RenderingMode;
  defaultWidth?: number;
  defaultHeight?: number;
  /** Line style of the shape's outline (`arch-vis:borderStyle`); solid when absent. */
  borderStyle?: LineStyle;
}

/** Visual style for a relationship type. */
export interface RelationshipVisualStyle {
  lineStyle?: LineStyle;
  sourceDecor?: Decoration;
  targetDecor?: Decoration;
  lineColor?: string;
}

/** Visual notation for a single concept (element or relationship class). */
export interface VisualNotation {
  /** The element/relationship class this notation describes. */
  conceptIri: string;
  /** The notation set this notation belongs to. */
  notationSetIri: string;
  /** URI of a pre-rendered composite image, when published. */
  prefVisNotation?: string;
  /** Element style (present for element notations). */
  style?: VisualStyle;
  /** Relationship style (present for relationship notations). */
  relationshipStyle?: RelationshipVisualStyle;
}

/** A named collection of visual notation descriptors. */
export interface NotationSet {
  iri: string;
  label: string;
  /** conceptIri → notation. */
  notations: Map<string, VisualNotation>;
}

const SHAPE_TYPES: ReadonlySet<string> = new Set<ShapeType>([
  'RoundedRectangle',
  'Rectangle',
  'Octagon',
  'Ellipse',
  'Circle',
  'Hexagon',
  'Diamond',
  'Parallelogram',
]);

/** A core shape by IRI: only core-vis's own names count, not a namesake in another namespace. */
function coreShape(iri: string | undefined): ShapeType | undefined {
  if (!iri?.startsWith(ARCH_VIS)) return undefined;
  const name = iri.slice(ARCH_VIS.length);
  return SHAPE_TYPES.has(name) ? (name as ShapeType) : undefined;
}

/**
 * A style's shape: a core shape, or a notation's own with its templates (and
 * its fallback as the core shape). An own shape without an outline draws as its
 * fallback; one without either, as the default.
 */
function readShape(store: Store, styleTerm: Term): { shapeType?: ShapeType; customShape?: CustomShape } {
  const term = store.getObjects(styleTerm, namedNode(T.shapeType), null).find((o) => o.termType === 'NamedNode');
  if (!term) return {};
  const core = coreShape(term.value);
  if (core) return { shapeType: core };
  const customShape = readCustomShape(store, term.value);
  const fallback = customShape?.fallback ?? coreShape(objectValue(store, term, T.fallbackShape) ?? undefined);
  return { ...(fallback ? { shapeType: fallback } : {}), ...(customShape ? { customShape } : {}) };
}

/**
 * A notation's own shape as the store describes it: its fallback and its
 * templates. `undefined` for a core shape, or one with no outline to draw.
 */
export function readCustomShape(store: Store, iri: string): CustomShape | undefined {
  if (coreShape(iri)) return undefined;
  const subject = namedNode(iri);
  const outline = objectValue(store, subject, T.outlinePath);
  if (!outline) return undefined;
  const fallback = coreShape(objectValue(store, subject, T.fallbackShape) ?? undefined);
  const optional = (predicate: string) => objectValue(store, subject, predicate) ?? undefined;
  return {
    iri,
    outline,
    ...(fallback ? { fallback } : {}),
    ...(optional(T.shapeVariables) ? { variables: optional(T.shapeVariables) } : {}),
    ...(optional(T.detailPath) ? { details: optional(T.detailPath) } : {}),
    ...(optional(T.contentBox) ? { contentBox: optional(T.contentBox) } : {}),
    ...(optional(T.labelBox) ? { labelBox: optional(T.labelBox) } : {}),
  };
}

const ICON_PLACEMENTS: ReadonlySet<string> = new Set<IconPlacement>([
  'TopRight',
  'TopLeft',
  'TopCenter',
  'Center',
  'BottomCenter',
]);

const RENDERING_MODES: ReadonlySet<string> = new Set<RenderingMode>([
  'ShapeWithBadge',
  'IconCentric',
  'ShapeOnly',
]);

const LINE_STYLES: ReadonlySet<string> = new Set<LineStyle>(['SolidLine', 'DashedLine', 'DottedLine']);

const DECORATIONS: ReadonlySet<string> = new Set<Decoration>([
  'NoDecoration',
  'OpenArrowhead',
  'ClosedArrowhead',
  'HollowArrowhead',
  'HollowDiamond',
  'FilledDiamond',
  'HalfArrowhead',
  'CircleDot',
]);

// ---------------------------------------------------------------------------
// Term helpers
// ---------------------------------------------------------------------------

/**
 * First object value for a subject term + predicate, whatever the term type.
 *
 * The subject is passed through as a term so blank-node `Style` nodes resolve
 * exactly like named ones.
 */
/**
 * The marker symbol published for each decoration: `arch-vis:decorSymbol` on
 * the `arch-vis:Decoration` individuals of the core-vis ontology.
 *
 * A renderer draws a decoration from its symbol — anchored and oriented as the
 * vocabulary's description of `arch-vis:decorSymbol` says — and from built-in
 * geometry only where nothing is published. Only the core-vis individuals are
 * read: the decoration names are that vocabulary's.
 */
export function buildDecorationSymbols(store: Store): Partial<Record<Decoration, string>> {
  const symbols: Partial<Record<Decoration, string>> = {};
  for (const subject of store.getSubjects(namedNode(RDF_TYPE), namedNode(`${ARCH_VIS}Decoration`), null)) {
    if (subject.termType !== 'NamedNode' || !subject.value.startsWith(ARCH_VIS)) continue;
    const decoration = parseEnum<Decoration>(subject.value, DECORATIONS);
    if (!decoration || decoration === 'NoDecoration') continue;
    const symbol = objectValue(store, subject, `${ARCH_VIS}decorSymbol`);
    if (symbol) symbols[decoration] = symbol;
  }
  return symbols;
}

function objectValue(store: Store, subject: Term, predicate: string): string | null {
  for (const object of store.getObjects(subject, namedNode(predicate), null)) {
    return object.value;
  }
  return null;
}

/** First object value, preferring IRIs over literals (for image/concept links). */
function iriOrLiteralValue(store: Store, subject: Term, predicate: string): string | null {
  const objects = store.getObjects(subject, namedNode(predicate), null);
  const named = objects.find((object) => object.termType === 'NamedNode');
  if (named) return named.value;
  const literal = objects.find((object) => object.termType === 'Literal');
  return literal ? literal.value : null;
}

/** Reduce an enumeration IRI to its local fragment (`arch-vis:TopRight` → `TopRight`). */
function parseEnumFragment(iri: string | null): string | undefined {
  if (!iri) return undefined;
  const fragment = iri.includes('#')
    ? iri.slice(iri.lastIndexOf('#') + 1)
    : iri.includes('/')
      ? iri.slice(iri.lastIndexOf('/') + 1)
      : iri;
  return fragment || undefined;
}

/** Reduce to fragment and keep it only if it is a member of the enumeration. */
function parseEnum<T extends string>(iri: string | null, allowed: ReadonlySet<string>): T | undefined {
  const fragment = parseEnumFragment(iri);
  if (fragment === undefined) return undefined;
  return allowed.has(fragment) ? (fragment as T) : undefined;
}

function parseNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number.parseFloat(raw);
  return Number.isNaN(value) ? undefined : value;
}

/** Human label: English `skos:prefLabel`, any `skos:prefLabel`, `rdfs:label`, else the IRI fragment. */
function labelFor(store: Store, iri: string): string {
  const subject = namedNode(iri);
  for (const predicate of [T.prefLabel, T.rdfsLabel]) {
    const literals = store
      .getObjects(subject, namedNode(predicate), null)
      .filter((object) => object.termType === 'Literal');
    const english = literals.find((object) => 'language' in object && object.language === 'en');
    const chosen = english ?? literals[0];
    if (chosen) return chosen.value;
  }
  return parseEnumFragment(iri) ?? iri;
}

// ---------------------------------------------------------------------------
// Notation set discovery
// ---------------------------------------------------------------------------

/** All notation sets declared in the graph, sorted by label. */
export function listNotationSets(store: Store): Array<{ iri: string; label: string }> {
  const iris = new Set<string>();
  for (const subject of store.getSubjects(namedNode(RDF_TYPE), namedNode(T.notationSetClass), null)) {
    if (subject.termType === 'NamedNode') iris.add(subject.value);
  }
  // Sets referenced but not typed locally (e.g. the notation file was not loaded).
  for (const predicate of [T.notationSet, T.usesNotationSet]) {
    for (const quad of store.getQuads(null, namedNode(predicate), null, null)) {
      if (quad.object.termType === 'NamedNode') iris.add(quad.object.value);
    }
  }
  return [...iris]
    .map((iri) => ({ iri, label: labelFor(store, iri) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Resolve the notation set a PresentationContext asks for via
 * `arch:usesNotationSet`. Returns `null` when the context declares none —
 * callers then fall back to the metamodel default (see `buildVisualNotations`).
 */
export function resolveNotationSetForContext(store: Store, presentationContextIri: string): string | null {
  const objects = store.getObjects(
    namedNode(presentationContextIri),
    namedNode(T.usesNotationSet),
    null,
  );
  const named = objects.find((object) => object.termType === 'NamedNode');
  return named ? named.value : null;
}

/**
 * Default notation set: `arch:notationSet` on an `arch:Metamodel`, then any
 * `arch:notationSet` statement, then any declared `arch-vis:NotationSet`.
 */
function resolveDefaultNotationSet(store: Store): string | null {
  for (const metamodel of store.getSubjects(namedNode(RDF_TYPE), namedNode(T.metamodel), null)) {
    for (const object of store.getObjects(metamodel, namedNode(T.notationSet), null)) {
      if (object.termType === 'NamedNode') return object.value;
    }
  }
  for (const quad of store.getQuads(null, namedNode(T.notationSet), null, null)) {
    if (quad.object.termType === 'NamedNode') return quad.object.value;
  }
  for (const subject of store.getSubjects(namedNode(RDF_TYPE), namedNode(T.notationSetClass), null)) {
    if (subject.termType === 'NamedNode') return subject.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractElementStyle(store: Store, styleTerm: Term): VisualStyle | undefined {
  const { shapeType, customShape } = readShape(store, styleTerm);
  const fillColor = objectValue(store, styleTerm, T.fillColor) ?? undefined;
  const lineColor = objectValue(store, styleTerm, T.lineColor) ?? undefined;
  const fontColor = objectValue(store, styleTerm, T.fontColor) ?? undefined;
  const iconSymbol = objectValue(store, styleTerm, T.iconSymbol) ?? undefined;
  const renderingMode = parseEnum<RenderingMode>(
    objectValue(store, styleTerm, T.renderingMode),
    RENDERING_MODES,
  );
  const defaultWidth = parseNumber(objectValue(store, styleTerm, T.defaultWidth));
  const defaultHeight = parseNumber(objectValue(store, styleTerm, T.defaultHeight));
  const borderStyle = parseEnum<LineStyle>(objectValue(store, styleTerm, T.borderStyle), LINE_STYLES);

  const declaredPlacement = parseEnum<IconPlacement>(
    objectValue(store, styleTerm, T.iconPlacement),
    ICON_PLACEMENTS,
  );
  // Fallback rule: iconPlacement absent but iconSymbol present → TopRight.
  const iconPlacement = declaredPlacement ?? (iconSymbol ? 'TopRight' : undefined);

  const hasAny =
    shapeType !== undefined ||
    fillColor !== undefined ||
    lineColor !== undefined ||
    iconSymbol !== undefined ||
    renderingMode !== undefined ||
    defaultWidth !== undefined ||
    defaultHeight !== undefined ||
    borderStyle !== undefined ||
    fontColor !== undefined ||
    customShape !== undefined;
  if (!hasAny) return undefined;

  const style: VisualStyle = { shapeType, fillColor, lineColor, iconSymbol, iconPlacement, renderingMode, defaultWidth, defaultHeight };
  if (customShape) style.customShape = customShape;
  if (borderStyle) style.borderStyle = borderStyle;
  if (fontColor) style.fontColor = fontColor;
  return style;
}

function extractRelationshipStyle(store: Store, subject: Term): RelationshipVisualStyle | undefined {
  const lineStyle = parseEnum<LineStyle>(objectValue(store, subject, T.lineStyle), LINE_STYLES);
  const sourceDecor = parseEnum<Decoration>(objectValue(store, subject, T.sourceDecor), DECORATIONS);
  const targetDecor = parseEnum<Decoration>(objectValue(store, subject, T.targetDecor), DECORATIONS);
  if (lineStyle === undefined && sourceDecor === undefined && targetDecor === undefined) return undefined;
  const lineColor = objectValue(store, subject, T.lineColor) ?? undefined;
  return { lineStyle, sourceDecor, targetDecor, lineColor };
}

/**
 * Build the notation set with the given IRI (or the graph default when omitted).
 *
 * Relationship properties (`lineStyle`, `sourceDecor`, `targetDecor`) are read
 * from the `VisualNotation` node itself as well as from its `defaultStyle`,
 * because published notation files put them directly on the notation.
 *
 * Returns `null` when no notation set can be resolved or the resolved set has
 * no `VisualNotation` members.
 */
export function buildVisualNotations(store: Store, notationSetIri?: string): NotationSet | null {
  const setIri = notationSetIri ?? resolveDefaultNotationSet(store);
  if (!setIri) return null;

  const notations = new Map<string, VisualNotation>();

  for (const quad of store.getQuads(null, namedNode(T.inNotationSet), namedNode(setIri), null)) {
    const notationTerm = quad.subject;
    if (notationTerm.termType !== 'NamedNode') continue;

    const conceptIri = iriOrLiteralValue(store, notationTerm, T.notationFor);
    if (!conceptIri) continue;

    const prefVisNotation = iriOrLiteralValue(store, notationTerm, T.prefVisNotation) ?? undefined;

    let style: VisualStyle | undefined;
    let relationshipStyle = extractRelationshipStyle(store, notationTerm);

    for (const styleTerm of store.getObjects(notationTerm, namedNode(T.defaultStyle), null)) {
      style = extractElementStyle(store, styleTerm) ?? style;
      relationshipStyle = extractRelationshipStyle(store, styleTerm) ?? relationshipStyle;
    }

    notations.set(conceptIri, {
      conceptIri,
      notationSetIri: setIri,
      prefVisNotation,
      style,
      relationshipStyle,
    });
  }

  if (notations.size === 0) return null;

  return { iri: setIri, label: labelFor(store, setIri), notations };
}

/**
 * The rendering mode a tool should actually use, after the guide's fallbacks:
 *
 * - `renderingMode` absent → `ShapeWithBadge`
 * - `ShapeWithBadge` without `iconSymbol` → `ShapeOnly` (graceful degradation)
 * - `IconCentric` without `iconSymbol` → warn, `ShapeOnly`
 *
 * This is the single place that decision is made.
 */
export function effectiveRenderingMode(style: VisualStyle | undefined): RenderingMode {
  const declared = style?.renderingMode ?? 'ShapeWithBadge';
  const hasIcon = Boolean(style?.iconSymbol);

  if (declared === 'ShapeOnly') return 'ShapeOnly';

  if (declared === 'IconCentric') {
    if (hasIcon) return 'IconCentric';
    console.warn('[notation] IconCentric rendering requires arch-vis:iconSymbol — falling back to ShapeOnly');
    return 'ShapeOnly';
  }

  return hasIcon ? 'ShapeWithBadge' : 'ShapeOnly';
}
