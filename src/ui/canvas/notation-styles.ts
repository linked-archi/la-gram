/**
 * NotationStyleRegistry — the renderer's view of the active notation set.
 *
 * A shape on the canvas knows its RDF type IRI. Everything a renderer needs in
 * order to draw it — shape, colours, badge glyph, rendering mode, default size —
 * lives on the {@link ElementTypeInfo} that `PaletteGenerator` produced from the
 * metamodel's `arch-vis:` layer. This class is the index between the two, and it
 * is the only place that reads a {@link PaletteDefinition} on the render path.
 *
 * It is registered as a diagram-js service (`notationStyles`) so the renderer
 * receives it by injection, and it is replaced wholesale — not rebuilt — when
 * the palette changes (viewpoint switch, notation-set switch, metamodel load).
 */

import type {
  ElementTypeInfo,
  PaletteDefinition,
  RelationshipTypeInfo,
} from '../../metamodel-manager/interfaces.js';
import {
  effectiveRenderingMode,
  type RenderingMode,
  type RelationshipVisualStyle,
  type VisualStyle,
} from '../../metamodel-manager/notation.js';

/** Empty palette, used before a metamodel is loaded. */
export function emptyPaletteDefinition(): PaletteDefinition {
  return { elementGroups: [], relationshipTypes: [] };
}

export class NotationStyleRegistry {
  private elements = new Map<string, ElementTypeInfo>();
  private relationships = new Map<string, RelationshipTypeInfo>();

  constructor(paletteDefinition: PaletteDefinition = emptyPaletteDefinition()) {
    this.update(paletteDefinition);
  }

  /** Re-index from a freshly generated palette. */
  update(paletteDefinition: PaletteDefinition): void {
    this.elements = new Map();
    this.relationships = new Map();

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

  /** Visual style for an element type, or `undefined` when unstyled. */
  styleFor(typeIri: string | undefined): VisualStyle | undefined {
    return this.elementType(typeIri)?.style;
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
    if (info?.renderingMode) return info.renderingMode;
    return effectiveRenderingMode(info?.style);
  }

  /** Display label for an element type, when the palette knows it. */
  labelFor(typeIri: string | undefined): string | undefined {
    return this.elementType(typeIri)?.label;
  }

  /** The relationship type record, by qualified class IRI or direct predicate. */
  relationshipType(typeIri: string | undefined): RelationshipTypeInfo | undefined {
    return typeIri ? this.relationships.get(typeIri) : undefined;
  }

  /** Line style and endpoint decorations for a relationship type. */
  relationshipStyleFor(typeIri: string | undefined): RelationshipVisualStyle | undefined {
    return this.relationshipType(typeIri)?.relationshipStyle;
  }

  /** How many element types are indexed. Useful for diagnostics and tests. */
  get elementTypeCount(): number {
    return this.elements.size;
  }
}
