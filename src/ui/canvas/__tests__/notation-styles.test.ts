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

describe('NotationStyleRegistry — notationIndex', () => {
  const UNLISTED = 'https://example.org/mm#Unlisted';
  const UNLISTED_REL = 'https://example.org/mm#Linking';
  const UNLISTED_PREDICATE = 'https://example.org/mm#links';

  function withIndex(): PaletteDefinition {
    const relationshipStyle = { lineStyle: 'DashedLine' as const, targetDecor: 'HollowDiamond' as const };
    return {
      ...palette(),
      notationIndex: {
        [UNLISTED]: {
          source: 'active-superclass',
          matchedClassIri: 'https://meta.linked.archi/core#Element',
          style: { shapeType: 'Hexagon', fillColor: '#E8F0EA', lineColor: '#424242', renderingMode: 'ShapeOnly' },
          renderingMode: 'ShapeOnly',
        },
        // Same IRI as a palette entry, styled differently: the palette entry must win.
        [TYPE_A]: { source: 'fallback', style: { shapeType: 'Circle', fillColor: '#000001' }, renderingMode: 'ShapeOnly' },
        [REL_CLASS]: { source: 'fallback', relationshipStyle: { lineStyle: 'DottedLine' } },
        [UNLISTED_REL]: { source: 'active-superclass', relationshipStyle },
        [UNLISTED_PREDICATE]: { source: 'active-superclass', relationshipStyle },
      },
    };
  }

  it('styles a type the palette does not list', () => {
    const registry = new NotationStyleRegistry(withIndex());
    expect(registry.styleFor(UNLISTED)?.shapeType).toBe('Hexagon');
    expect(registry.renderingModeFor(UNLISTED)).toBe('ShapeOnly');
    // Labels and element records stay palette-only.
    expect(registry.labelFor(UNLISTED)).toBeUndefined();
    expect(registry.elementType(UNLISTED)).toBeUndefined();
    expect(registry.elementTypeCount).toBe(1);
  });

  it('lets a palette entry win over an index entry for the same IRI', () => {
    const registry = new NotationStyleRegistry(withIndex());
    expect(registry.styleFor(TYPE_A)?.shapeType).toBe('Octagon');
    expect(registry.renderingModeFor(TYPE_A)).toBe('ShapeWithBadge');
    expect(registry.relationshipStyleFor(REL_CLASS)?.lineStyle).toBe('SolidLine');
  });

  it('styles a connection by class or by its direct predicate through the index', () => {
    const registry = new NotationStyleRegistry(withIndex());
    expect(registry.relationshipStyleFor(UNLISTED_REL)?.targetDecor).toBe('HollowDiamond');
    expect(registry.relationshipStyleFor(UNLISTED_PREDICATE)?.lineStyle).toBe('DashedLine');
    expect(registry.relationshipStyleFor(UNLISTED_PREDICATE)?.lineColor).toBeUndefined();
  });

  it('derives the rendering mode when an index entry carries none', () => {
    const definition = withIndex();
    definition.notationIndex![UNLISTED] = { source: 'active', style: { shapeType: 'Rectangle' } };
    expect(new NotationStyleRegistry(definition).renderingModeFor(UNLISTED)).toBe('ShapeOnly');
  });

  it('changes nothing when the index is empty or absent', () => {
    for (const definition of [{ ...palette(), notationIndex: {} }, palette()]) {
      const registry = new NotationStyleRegistry(definition);
      expect(registry.styleFor(TYPE_A)?.shapeType).toBe('Octagon');
      expect(registry.relationshipStyleFor(REL_PREDICATE)?.targetDecor).toBe('OpenArrowhead');
      expect(registry.styleFor(UNLISTED)).toBeUndefined();
      expect(registry.renderingModeFor(UNLISTED)).toBe('ShapeOnly');
      expect(registry.relationshipStyleFor(UNLISTED_REL)).toBeUndefined();
    }
  });

  it('never answers for an inherited object property name', () => {
    const registry = new NotationStyleRegistry(withIndex());
    expect(registry.styleFor('toString')).toBeUndefined();
    expect(registry.relationshipStyleFor('constructor')).toBeUndefined();
  });

  it('forgets the index on update', () => {
    const registry = new NotationStyleRegistry(withIndex());
    registry.update(emptyPaletteDefinition());
    expect(registry.styleFor(UNLISTED)).toBeUndefined();
    expect(registry.relationshipStyleFor(UNLISTED_PREDICATE)).toBeUndefined();
  });
});
