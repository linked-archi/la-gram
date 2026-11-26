/**
 * NotationStyleRegistry — the renderer's view of the notation lookup.
 *
 * A shape on the canvas knows its RDF type IRI. Everything a renderer needs in
 * order to draw it — shape, colours, badge glyph, rendering mode, default size —
 * lives on the {@link ElementTypeInfo} that `PaletteGenerator` produced from the
 * metamodel's `arch-vis:` layer. This class is the index between the two, and it
 * is the only place that reads a {@link PaletteDefinition} on the render path.
 *
 * Palette entries come first. A type the palette does not list — a class no
 * taxonomy names, say — is looked up in the palette's `notationIndex`, which the
 * generator fills from the same resolver (Req 2.16: the five-step lookup in
 * `notation-resolver.ts`, where anything published for the class itself beats
 * anything inherited and the nearest ancestor wins among inherited
 * descriptors). Palette and canvas therefore give the same answer for every
 * class. Labels and element records stay palette-only.
 *
 * It is registered as a diagram-js service (`notationStyles`) so the renderer
 * receives it by injection, and it is replaced wholesale — not rebuilt — when
 * the palette changes (viewpoint switch, notation-set switch, metamodel load).
 */

import type {
  ElementTypeInfo,
  PaletteDefinition,
  RelationshipTypeInfo,
} from '@linked-archi/kernel/metamodel-manager/interfaces.js';
import type { NotationIndexEntry } from '@linked-archi/kernel/metamodel-manager/notation-resolver.js';
import {
  effectiveRenderingMode,
  labelExpressionIn,
  type Decoration,
  type RenderingMode,
  type RelationshipVisualStyle,
  type VisualStyle,
} from '@linked-archi/kernel/metamodel-manager/notation.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import { SHAPE_TYPES } from './notation-shapes.js';

/** Where core-vis's own shapes are named: `arch-vis:Rectangle`. */
const CORE_SHAPE_NS = NAMESPACES['arch-vis'];

/** Empty palette, used before a metamodel is loaded. */
export function emptyPaletteDefinition(): PaletteDefinition {
  return { elementGroups: [], relationshipTypes: [] };
}

export class NotationStyleRegistry {
  private elements = new Map<string, ElementTypeInfo>();
  private relationships = new Map<string, RelationshipTypeInfo>();
  /** `notationIndex` as a map: IRIs are keys, and a plain object would answer for `toString`. */
  private index = new Map<string, NotationIndexEntry>();
  /** Where each decoration's published symbol is: the bundled copy, else the published URI. */
  private decorationSymbols: Partial<Record<Decoration, string>> = {};

  constructor(paletteDefinition: PaletteDefinition = emptyPaletteDefinition()) {
    this.update(paletteDefinition);
  }

  /** Re-index from a freshly generated palette. */
  /** How many times the styles were replaced: what was drawn from older ones is stale. */
  version = 0;
  /** The presentation context chosen — the audience — and its name; none when none is. */
  activePresentationContext: string | undefined;
  activePresentationContextLabel: string | undefined;
  /** What that context says every label says, where nothing else does. */
  private contextLabelExpression: string | undefined;

  update(paletteDefinition: PaletteDefinition): void {
    this.version++;
    this.activePresentationContext = paletteDefinition.presentationContextIri;
    this.activePresentationContextLabel = paletteDefinition.presentationContextLabel;
    this.contextLabelExpression = paletteDefinition.presentationContextLabelExpression;
    this.elements = new Map();
    this.relationships = new Map();
    this.index = new Map(Object.entries(paletteDefinition.notationIndex ?? {}));
    this.decorationSymbols = Object.fromEntries(
      Object.entries(paletteDefinition.decorationSymbols ?? {}).map(([decoration, symbol]) => [decoration, symbol?.url]),
    );

    for (const group of paletteDefinition.elementGroups) {
      for (const element of group.elements) {
        this.elements.set(element.iri, element);
      }
    }
    for (const relationship of paletteDefinition.relationshipTypes) {
      this.relationships.set(relationship.iri, relationship);
      // Relationships are addressable by their direct predicate too, because a
      // model triple uses the unqualified form (am4:serves) while the notation
      // is published against the qualified class (am4:Serving).
      if (relationship.unqualifiedPredicateIri) {
        this.relationships.set(relationship.unqualifiedPredicateIri, relationship);
      }
    }
  }

  /** The element type record for a type IRI, when the palette knows it. */
  elementType(typeIri: string | undefined): ElementTypeInfo | undefined {
    return typeIri ? this.elements.get(typeIri) : undefined;
  }

  /**
   * Visual style for an element type, or `undefined` when unstyled.
   *
   * A palette entry answers for its IRI, styled or not; the index answers only
   * for types the palette does not list.
   */
  styleFor(typeIri: string | undefined): VisualStyle | undefined {
    const info = this.elementType(typeIri);
    if (info) return info.style;
    return this.indexEntry(typeIri)?.style;
  }

  /**
   * The shape a placement of `typeIri` is drawn as when its own style names
   * `shapeIri`: its notation's default shape, one of its alternatives
   * (`arch-vis:alternativeStyle`), or a core shape. `undefined` for a shape the
   * type's notation does not offer, which is then drawn as its default.
   */
  shapeFor(typeIri: string | undefined, shapeIri: string): Pick<VisualStyle, 'shapeType' | 'customShape'> | undefined {
    const style = this.styleFor(typeIri);
    for (const candidate of [style, ...(style?.alternatives ?? [])]) {
      if (!candidate) continue;
      if (candidate.customShape?.iri === shapeIri) return { shapeType: candidate.shapeType, customShape: candidate.customShape };
      if (!candidate.customShape && candidate.shapeType && shapeIri === CORE_SHAPE_NS + candidate.shapeType) {
        return { shapeType: candidate.shapeType };
      }
    }
    const local = shapeIri.startsWith(CORE_SHAPE_NS) ? shapeIri.slice(CORE_SHAPE_NS.length) : undefined;
    return local && (SHAPE_TYPES as readonly string[]).includes(local) ? { shapeType: local as VisualStyle['shapeType'] } : undefined;
  }

  /**
   * Rendering mode for an element type, after the notation guide's fallbacks.
   *
   * Delegates to {@link effectiveRenderingMode} rather than re-deriving the
   * rules, and reports `ShapeOnly` for a type with no style at all — there is no
   * icon in that case, which is exactly the condition the guide degrades on.
   */
  renderingModeFor(typeIri: string | undefined): RenderingMode {
    const info = this.elementType(typeIri);
    if (info) {
      if (info.renderingMode) return info.renderingMode;
      return effectiveRenderingMode(info.style);
    }
    const entry = this.indexEntry(typeIri);
    return entry?.renderingMode ?? effectiveRenderingMode(entry?.style);
  }

  /**
   * What the label of an element of `typeIri` says without one of its own: its
   * type's notation's for the context chosen, else its notation's for every
   * context (inherited as its style is), else the context's — `undefined` for
   * its name alone.
   */
  labelExpressionFor(typeIri: string | undefined): string | undefined {
    return labelExpressionIn(this.styleFor(typeIri)?.labelExpressions, this.activePresentationContext) ?? this.contextLabelExpression;
  }

  /** Display label for an element type, when the palette knows it. */
  labelFor(typeIri: string | undefined): string | undefined {
    return this.elementType(typeIri)?.label;
  }

  /** The relationship type record, by qualified class IRI or direct predicate. */
  relationshipType(typeIri: string | undefined): RelationshipTypeInfo | undefined {
    return typeIri ? this.relationships.get(typeIri) : undefined;
  }

  /**
   * Line style and endpoint decorations for a relationship type, by qualified
   * class IRI or direct predicate. Palette entry first, then the index.
   */
  relationshipStyleFor(typeIri: string | undefined): RelationshipVisualStyle | undefined {
    const info = this.relationshipType(typeIri);
    if (info) return info.relationshipStyle;
    return this.indexEntry(typeIri)?.relationshipStyle;
  }

  /** Where a decoration's published marker symbol is (`arch-vis:decorSymbol`), when one is. */
  decorationSymbolFor(decoration: Decoration): string | undefined {
    return this.decorationSymbols[decoration];
  }

  /** How many element types are indexed. Useful for diagnostics and tests. */
  get elementTypeCount(): number {
    return this.elements.size;
  }

  /** The resolved notation for a type the palette may not list. */
  private indexEntry(typeIri: string | undefined): NotationIndexEntry | undefined {
    return typeIri ? this.index.get(typeIri) : undefined;
  }
}
