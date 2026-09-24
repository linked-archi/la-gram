import { describe, it, expect } from 'vitest';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import { NotationStyleRegistry, emptyPaletteDefinition } from '../notation-styles.js';

const TYPE_A = 'https://example.org/mm#TypeA';
const REL_CLASS = 'https://example.org/mm#Serving';
const REL_PREDICATE = 'https://example.org/mm#serves';

function palette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Test',
        elements: [
          {
            iri: TYPE_A,
            label: 'Type A',
            isAbstract: false,
            style: {
              shapeType: 'Octagon',
              fillColor: '#FFFFB5',
              renderingMode: 'ShapeWithBadge',
              iconSymbol: 'archimate4/icons/glyphs/actor.svg',
            },
            renderingMode: 'ShapeWithBadge',
          },
        ],
      },
    ],
    relationshipTypes: [
      {
        iri: REL_CLASS,
        label: 'Serving',
        domainTypes: [],
        rangeTypes: [],
        unqualifiedPredicateIri: REL_PREDICATE,
        relationshipStyle: { lineStyle: 'SolidLine', targetDecor: 'OpenArrowhead' },
      },
    ],
  };
}

describe('NotationStyleRegistry', () => {
  it('indexes element styles by type IRI', () => {
    const registry = new NotationStyleRegistry(palette());

    expect(registry.styleFor(TYPE_A)?.shapeType).toBe('Octagon');
    expect(registry.styleFor(TYPE_A)?.fillColor).toBe('#FFFFB5');
    expect(registry.labelFor(TYPE_A)).toBe('Type A');
    expect(registry.elementTypeCount).toBe(1);
  });

  it('returns nothing for an unknown or absent type IRI', () => {
    const registry = new NotationStyleRegistry(palette());

    expect(registry.styleFor('urn:unknown')).toBeUndefined();
    expect(registry.styleFor(undefined)).toBeUndefined();
    expect(registry.labelFor('urn:unknown')).toBeUndefined();
  });

  it('reports the rendering mode the palette computed', () => {
    expect(new NotationStyleRegistry(palette()).renderingModeFor(TYPE_A)).toBe('ShapeWithBadge');
  });

  it('applies the guide fallbacks when the palette computed no mode', () => {
    const definition = palette();
    definition.elementGroups[0].elements[0].renderingMode = undefined;
    definition.elementGroups[0].elements[0].style = {
      shapeType: 'Rectangle',
      renderingMode: 'ShapeWithBadge',
      // No iconSymbol: the guide degrades to ShapeOnly.
    };

    expect(new NotationStyleRegistry(definition).renderingModeFor(TYPE_A)).toBe('ShapeOnly');
  });

  it('reports ShapeOnly for a type with no style at all', () => {
    const registry = new NotationStyleRegistry(
      { elementGroups: [{ category: 'x', elements: [{ iri: TYPE_A, label: 'A', isAbstract: false }] }], relationshipTypes: [] },
    );
    expect(registry.renderingModeFor(TYPE_A)).toBe('ShapeOnly');
    expect(registry.renderingModeFor('urn:unknown')).toBe('ShapeOnly');
  });

  it('finds a relationship style by its qualified class IRI', () => {
    const registry = new NotationStyleRegistry(palette());
    expect(registry.relationshipStyleFor(REL_CLASS)?.targetDecor).toBe('OpenArrowhead');
  });

  it('finds the same style by the unqualified predicate IRI', () => {
    // Model triples use the direct predicate (am4:serves) while the notation is
    // published against the qualified class (am4:Serving).
    const registry = new NotationStyleRegistry(palette());
    expect(registry.relationshipStyleFor(REL_PREDICATE)?.targetDecor).toBe('OpenArrowhead');
  });

  it('re-indexes on update and forgets the previous palette', () => {
    const registry = new NotationStyleRegistry(palette());
    registry.update(emptyPaletteDefinition());

    expect(registry.styleFor(TYPE_A)).toBeUndefined();
    expect(registry.relationshipStyleFor(REL_CLASS)).toBeUndefined();
    expect(registry.elementTypeCount).toBe(0);
  });

  it('starts empty when constructed with no palette', () => {
    expect(new NotationStyleRegistry().elementTypeCount).toBe(0);
  });
});
