import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser, Store } from 'n3';
import {
  buildVisualNotations,
  effectiveRenderingMode,
  listNotationSets,
  resolveNotationSetForContext,
  type VisualStyle,
} from '../notation.js';

function storeFromTurtle(...parts: string[]): Store {
  const parser = new Parser();
  const store = new Store();
  for (const ttl of parts) store.addQuads(parser.parse(ttl));
  return store;
}

const PREFIXES = `
@prefix owl:      <http://www.w3.org/2002/07/owl#> .
@prefix rdf:      <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:     <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:      <http://www.w3.org/2001/XMLSchema#> .
@prefix skos:     <http://www.w3.org/2004/02/skos/core#> .
@prefix arch:     <https://meta.linked.archi/core#> .
@prefix arch-vis: <https://meta.linked.archi/core-vis#> .
@prefix am4:      <https://meta.linked.archi/archimate4/onto#> .
@prefix am4pc:    <https://meta.linked.archi/archimate4/presentation-contexts#> .
@prefix :         <https://meta.linked.archi/archimate4/notation#> .
`;

const NOTATION_SET = 'https://meta.linked.archi/archimate4/notation#ArchiMate40StandardNotation';
const SIMPLE_SET = 'https://meta.linked.archi/archimate4/notation#ArchiMate40SimplifiedNotation';
const BUSINESS_ACTOR = 'https://meta.linked.archi/archimate4/onto#BusinessActor';
const SERVING = 'https://meta.linked.archi/archimate4/onto#Serving';

/** Standard set with one fully-populated element notation (style as a blank node). */
const ELEMENT_NOTATION = `${PREFIXES}
:ArchiMate40StandardNotation
    a               arch-vis:NotationSet ;
    skos:prefLabel  "ArchiMate 4.0 Standard Notation"@en .

:BusinessActorNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:BusinessActor ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch:prefVisNotation  <https://meta.linked.archi/archimate4/icons/business-actor.svg> ;
    arch-vis:defaultStyle [
        a                      arch-vis:Style ;
        arch-vis:shapeType     arch-vis:RoundedRectangle ;
        arch-vis:fillColor     "#FFFFB5" ;
        arch-vis:lineColor     "#000000" ;
        arch-vis:renderingMode arch-vis:ShapeWithBadge ;
        arch-vis:iconSymbol    "https://meta.linked.archi/archimate4/icons/glyphs/person.svg"^^xsd:anyURI ;
        arch-vis:iconPlacement arch-vis:TopRight ;
        arch-vis:defaultWidth  120.0 ;
        arch-vis:defaultHeight 55.0 ;
    ] .
`;

describe('buildVisualNotations — element notation', () => {
  it('extracts all nine style properties from a blank-node style, enums reduced to fragments', () => {
    const set = buildVisualNotations(storeFromTurtle(ELEMENT_NOTATION));

    expect(set).not.toBeNull();
    expect(set!.iri).toBe(NOTATION_SET);
    expect(set!.label).toBe('ArchiMate 4.0 Standard Notation');
    expect(set!.notations.size).toBe(1);

    const notation = set!.notations.get(BUSINESS_ACTOR)!;
    expect(notation.conceptIri).toBe(BUSINESS_ACTOR);
    expect(notation.notationSetIri).toBe(NOTATION_SET);
    expect(notation.style).toEqual({
      shapeType: 'RoundedRectangle',
      fillColor: '#FFFFB5',
      lineColor: '#000000',
      iconSymbol: 'https://meta.linked.archi/archimate4/icons/glyphs/person.svg',
      iconPlacement: 'TopRight',
      renderingMode: 'ShapeWithBadge',
      defaultWidth: 120,
      defaultHeight: 55,
    });
    expect(notation.relationshipStyle).toBeUndefined();
  });

  it('captures prefVisNotation when present', () => {
    const set = buildVisualNotations(storeFromTurtle(ELEMENT_NOTATION));
    expect(set!.notations.get(BUSINESS_ACTOR)!.prefVisNotation).toBe(
      'https://meta.linked.archi/archimate4/icons/business-actor.svg',
    );
  });

  it('leaves prefVisNotation undefined when absent', () => {
    const set = buildVisualNotations(
      storeFromTurtle(`${PREFIXES}
:ArchiMate40StandardNotation a arch-vis:NotationSet .
:NodeNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:Node ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:defaultStyle [ arch-vis:shapeType arch-vis:Rectangle ; arch-vis:fillColor "#C9E7B7" ] .
`),
    );
    const notation = set!.notations.get('https://meta.linked.archi/archimate4/onto#Node')!;
    expect(notation.prefVisNotation).toBeUndefined();
    expect(notation.style?.shapeType).toBe('Rectangle');
  });

  it('defaults iconPlacement to TopRight when iconSymbol is present but placement is not', () => {
    const set = buildVisualNotations(
      storeFromTurtle(`${PREFIXES}
:ArchiMate40StandardNotation a arch-vis:NotationSet .
:RoleNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:Role ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:defaultStyle [
        arch-vis:shapeType  arch-vis:Rectangle ;
        arch-vis:iconSymbol "https://meta.linked.archi/archimate4/icons/glyphs/role.svg"^^xsd:anyURI ;
    ] .
`),
    );
    expect(set!.notations.get('https://meta.linked.archi/archimate4/onto#Role')!.style?.iconPlacement).toBe(
      'TopRight',
    );
  });

  it('reads a notation\'s own shape — its fallback and its templates — and a dashed borderStyle', () => {
    const set = buildVisualNotations(
      storeFromTurtle(`${PREFIXES}
:ArchiMate40StandardNotation a arch-vis:NotationSet .
:Folder
    a                       arch-vis:ShapeType ;
    arch-vis:fallbackShape  arch-vis:Rectangle ;
    arch-vis:shapeVariables "th = min(h * 0.35, 21); tw = min(w * 0.8, max(200, w / 2))" ;
    arch-vis:outlinePath    "M0,0 L{tw},0 L{tw},{th} L{w},{th} L{w},{h} L0,{h} Z" ;
    arch-vis:detailPath     "M0,{th} L{tw},{th}" ;
    arch-vis:contentBox     "0 {th} {w} {h - th}" ;
    arch-vis:labelBox       "0 0 {tw} {th}" .
:Sketchy a arch-vis:ShapeType ; arch-vis:fallbackShape arch-vis:Hexagon .
:GroupingNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:Grouping ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:defaultStyle [ arch-vis:shapeType :Folder ; arch-vis:borderStyle arch-vis:DashedLine ] .
:NodeNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:Node ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:defaultStyle [ arch-vis:shapeType :Sketchy ] .
:OtherNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:Other ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:defaultStyle [ arch-vis:shapeType <https://example.org/notation#Rectangle> ; arch-vis:fillColor "#FFFFFF" ] .
`),
    );
    const style = (local: string) => set!.notations.get(`https://meta.linked.archi/archimate4/onto#${local}`)!.style;
    // The shape's own templates, and its fallback as the core shape.
    expect(style('Grouping')).toMatchObject({
      shapeType: 'Rectangle',
      borderStyle: 'DashedLine',
      customShape: {
        iri: 'https://meta.linked.archi/archimate4/notation#Folder',
        fallback: 'Rectangle',
        outline: 'M0,0 L{tw},0 L{tw},{th} L{w},{th} L{w},{h} L0,{h} Z',
        details: 'M0,{th} L{tw},{th}',
        contentBox: '0 {th} {w} {h - th}',
        labelBox: '0 0 {tw} {th}',
      },
    });
    // A shape with a fallback but no outline draws as its fallback.
    expect(style('Node')).toMatchObject({ shapeType: 'Hexagon' });
    expect(style('Node')!.customShape).toBeUndefined();
    // Only core-vis's own names are core shapes: a namesake elsewhere is not.
    expect(style('Other')!.shapeType).toBeUndefined();
  });

  it('reads the label colour (arch-vis:fontColor)', () => {
    const set = buildVisualNotations(
      storeFromTurtle(`${PREFIXES}
@prefix edgy: <https://meta.linked.archi/edgy/onto#> .
:ArchiMate40StandardNotation a arch-vis:NotationSet .
:StoryNotation a arch-vis:VisualNotation ; arch-vis:notationFor edgy:Story ; arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:defaultStyle [ arch-vis:shapeType arch-vis:Rectangle ; arch-vis:fillColor "#75F0A5" ; arch-vis:lineColor "#FFFFFF" ; arch-vis:fontColor "#000000" ] .
`),
    );
    const style = set!.notations.get('https://meta.linked.archi/edgy/onto#Story')!.style;
    expect(style).toMatchObject({ shapeType: 'Rectangle', lineColor: '#FFFFFF', fontColor: '#000000' });
  });
});

describe('buildVisualNotations — relationship notation', () => {
  const RELATIONSHIP_NOTATION = `${PREFIXES}
:ArchiMate40StandardNotation a arch-vis:NotationSet ; skos:prefLabel "Standard"@en .

:ServingNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:Serving ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:lineStyle    arch-vis:SolidLine ;
    arch-vis:sourceDecor  arch-vis:NoDecoration ;
    arch-vis:targetDecor  arch-vis:OpenArrowhead .

:RealizationNotation
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:Realization ;
    arch-vis:inNotationSet :ArchiMate40StandardNotation ;
    arch-vis:defaultStyle [
        a                    arch-vis:Style ;
        arch-vis:lineStyle   arch-vis:DashedLine ;
        arch-vis:sourceDecor arch-vis:NoDecoration ;
        arch-vis:targetDecor arch-vis:HollowArrowhead ;
        arch-vis:lineColor   "#000000" ;
    ] .
`;

  it('reads lineStyle, sourceDecor and targetDecor stated on the notation itself', () => {
    const set = buildVisualNotations(storeFromTurtle(RELATIONSHIP_NOTATION));
    const notation = set!.notations.get(SERVING)!;

    expect(notation.relationshipStyle).toEqual({
      lineStyle: 'SolidLine',
      sourceDecor: 'NoDecoration',
      targetDecor: 'OpenArrowhead',
      lineColor: undefined,
    });
    expect(notation.style).toBeUndefined();
  });

  it('reads relationship properties from a defaultStyle blank node too', () => {
    const set = buildVisualNotations(storeFromTurtle(RELATIONSHIP_NOTATION));
    const notation = set!.notations.get('https://meta.linked.archi/archimate4/onto#Realization')!;

    expect(notation.relationshipStyle).toEqual({
      lineStyle: 'DashedLine',
      sourceDecor: 'NoDecoration',
      targetDecor: 'HollowArrowhead',
      lineColor: '#000000',
    });
  });
});

describe('notation set resolution', () => {
  it('uses arch:notationSet declared on the Metamodel', () => {
    const store = storeFromTurtle(
      `${PREFIXES}
<https://meta.linked.archi/archimate4/metamodel#ArchiMate4>
    a arch:Metamodel ;
    arch:notationSet :ArchiMate40SimplifiedNotation .

:ArchiMate40StandardNotation a arch-vis:NotationSet ; skos:prefLabel "Standard"@en .
:ArchiMate40SimplifiedNotation a arch-vis:NotationSet ; skos:prefLabel "Simplified"@en .

:BusinessActorSimplified
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:BusinessActor ;
    arch-vis:inNotationSet :ArchiMate40SimplifiedNotation ;
    arch-vis:defaultStyle [ arch-vis:shapeType arch-vis:RoundedRectangle ; arch-vis:fillColor "#FFFFB5" ] .
`,
      ELEMENT_NOTATION,
    );

    const set = buildVisualNotations(store);
    expect(set!.iri).toBe(SIMPLE_SET);
    expect(set!.label).toBe('Simplified');
    expect(set!.notations.get(BUSINESS_ACTOR)!.style?.iconSymbol).toBeUndefined();
  });

  it('follows arch:usesNotationSet on a PresentationContext', () => {
    const store = storeFromTurtle(
      `${PREFIXES}
am4pc:ExecutiveContext a skos:Concept ; arch:usesNotationSet :ArchiMate40SimplifiedNotation .
am4pc:ArchitectContext a skos:Concept ; arch:usesNotationSet :ArchiMate40StandardNotation .
am4pc:AuditorContext   a skos:Concept .
:ArchiMate40SimplifiedNotation a arch-vis:NotationSet ; skos:prefLabel "Simplified"@en .
`,
      ELEMENT_NOTATION,
    );

    expect(
      resolveNotationSetForContext(
        store,
        'https://meta.linked.archi/archimate4/presentation-contexts#ExecutiveContext',
      ),
    ).toBe(SIMPLE_SET);
    expect(
      resolveNotationSetForContext(
        store,
        'https://meta.linked.archi/archimate4/presentation-contexts#ArchitectContext',
      ),
    ).toBe(NOTATION_SET);
    // No usesNotationSet → null, so callers fall back to the metamodel default.
    expect(
      resolveNotationSetForContext(
        store,
        'https://meta.linked.archi/archimate4/presentation-contexts#AuditorContext',
      ),
    ).toBeNull();
  });

  it('selects the requested set when two sets are present', () => {
    const store = storeFromTurtle(
      `${PREFIXES}
:ArchiMate40SimplifiedNotation a arch-vis:NotationSet ; skos:prefLabel "Simplified"@en .
:BusinessActorSimplified
    a                    arch-vis:VisualNotation ;
    arch-vis:notationFor am4:BusinessActor ;
    arch-vis:inNotationSet :ArchiMate40SimplifiedNotation ;
    arch-vis:defaultStyle [ arch-vis:shapeType arch-vis:Rectangle ; arch-vis:fillColor "#EEEEEE" ] .
`,
      ELEMENT_NOTATION,
    );

    const standard = buildVisualNotations(store, NOTATION_SET);
    const simplified = buildVisualNotations(store, SIMPLE_SET);

    expect(standard!.iri).toBe(NOTATION_SET);
    expect(standard!.notations.get(BUSINESS_ACTOR)!.style?.fillColor).toBe('#FFFFB5');
    expect(simplified!.iri).toBe(SIMPLE_SET);
    expect(simplified!.notations.get(BUSINESS_ACTOR)!.style?.fillColor).toBe('#EEEEEE');

    expect(listNotationSets(store).map((s) => s.iri).sort()).toEqual([SIMPLE_SET, NOTATION_SET].sort());
  });

  it('returns null when no notation set exists', () => {
    const store = storeFromTurtle(`${PREFIXES}
am4:BusinessActor a owl:Class ; skos:prefLabel "Business Actor"@en .
`);
    expect(buildVisualNotations(store)).toBeNull();
    expect(listNotationSets(store)).toEqual([]);
  });

  it('returns null when the notation set has no members', () => {
    const store = storeFromTurtle(`${PREFIXES}
:EmptySet a arch-vis:NotationSet ; skos:prefLabel "Empty"@en .
`);
    expect(buildVisualNotations(store)).toBeNull();
  });
});

describe('effectiveRenderingMode', () => {
  const withIcon = (mode?: string): VisualStyle => ({
    iconSymbol: 'https://example.org/icon.svg',
    ...(mode ? { renderingMode: mode as VisualStyle['renderingMode'] } : {}),
  });

  it('defaults to ShapeWithBadge when renderingMode is absent and an icon exists', () => {
    expect(effectiveRenderingMode(withIcon())).toBe('ShapeWithBadge');
  });

  it('degrades ShapeWithBadge to ShapeOnly when iconSymbol is absent', () => {
    expect(effectiveRenderingMode({ renderingMode: 'ShapeWithBadge', fillColor: '#FFF' })).toBe('ShapeOnly');
  });

  it('degrades an absent renderingMode to ShapeOnly when iconSymbol is absent', () => {
    expect(effectiveRenderingMode({ fillColor: '#FFF' })).toBe('ShapeOnly');
  });

  it('keeps IconCentric when iconSymbol is present', () => {
    expect(effectiveRenderingMode(withIcon('IconCentric'))).toBe('IconCentric');
  });

  it('warns and falls back to ShapeOnly for IconCentric without iconSymbol', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(effectiveRenderingMode({ renderingMode: 'IconCentric' })).toBe('ShapeOnly');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('keeps ShapeOnly as declared, icon or not', () => {
    expect(effectiveRenderingMode({ renderingMode: 'ShapeOnly' })).toBe('ShapeOnly');
    expect(effectiveRenderingMode(withIcon('ShapeOnly'))).toBe('ShapeOnly');
  });

  it('returns ShapeOnly for a missing style', () => {
    expect(effectiveRenderingMode(undefined)).toBe('ShapeOnly');
  });
});

describe('real published ArchiMate 4.0 notation file', () => {
  /** The bundled copy of the published file (`assets/` mirrors meta.linked.archi). Read only. */
  const REAL_NOTATION = fileURLToPath(
    new URL('../../../assets/archimate4/archimate4-notation.ttl', import.meta.url),
  );

  it('yields a fully populated notation set', () => {
    const store = storeFromTurtle(readFileSync(REAL_NOTATION, 'utf8'));
    const set = buildVisualNotations(store);

    expect(set).not.toBeNull();
    expect(set!.iri).toBe(NOTATION_SET);
    expect(set!.label).toBe('ArchiMate 4.0 Standard Notation');
    expect(set!.notations.size).toBe(57);

    const elementStyles = [...set!.notations.values()].filter((n) => n.style !== undefined);
    const relationshipStyles = [...set!.notations.values()].filter((n) => n.relationshipStyle !== undefined);
    expect(elementStyles.length).toBe(42);
    expect(relationshipStyles.length).toBe(15);

    // At least one style has every property populated, with icons present.
    const complete = elementStyles.filter(
      (n) =>
        n.style!.shapeType !== undefined &&
        n.style!.fillColor !== undefined &&
        n.style!.lineColor !== undefined &&
        n.style!.iconSymbol !== undefined &&
        n.style!.iconPlacement !== undefined &&
        n.style!.renderingMode !== undefined &&
        n.style!.defaultWidth !== undefined &&
        n.style!.defaultHeight !== undefined,
    );
    expect(complete.length).toBeGreaterThan(0);

    const actor = set!.notations.get(BUSINESS_ACTOR);
    expect(actor?.style?.iconSymbol).toMatch(/^https:\/\/meta\.linked\.archi\//);
    expect(actor?.prefVisNotation).toMatch(/\.svg$/);
    expect(effectiveRenderingMode(actor?.style)).toBe('ShapeWithBadge');

    const serving = set!.notations.get(SERVING);
    expect(serving?.relationshipStyle?.lineStyle).toBe('SolidLine');
    expect(serving?.relationshipStyle?.targetDecor).toBe('OpenArrowhead');
  });

  it('gives each element the shape its published picture shows', () => {
    const shapes = (path: string, ns: string) => {
      const set = buildVisualNotations(
        storeFromTurtle(readFileSync(fileURLToPath(new URL(`../../../assets/${path}`, import.meta.url)), 'utf8')),
      )!;
      return (local: string) => set.notations.get(`${ns}${local}`)?.style;
    };
    const am4 = shapes('archimate4/archimate4-notation.ttl', 'https://meta.linked.archi/archimate4/onto#');
    const am3 = shapes('archimate3/archimate3.2-notation.ttl', 'https://meta.linked.archi/archimate3/onto#');
    const expected: Array<[typeof am4, string, string]> = [
      [am4, 'BusinessObject', 'BandedRectangle'],
      [am4, 'DataObject', 'BandedRectangle'],
      [am4, 'Product', 'TabbedRectangle'],
      [am4, 'Device', 'Box3D'],
      [am4, 'Equipment', 'Box3D'],
      [am4, 'Facility', 'Box3D'],
      [am4, 'Plateau', 'Box3D'],
      [am4, 'Deliverable', 'WavyRectangle'],
      [am4, 'Meaning', 'Cloud'],
      [am4, 'Grouping', 'Folder'],
      [am4, 'Location', 'Rectangle'],
      [am4, 'Resource', 'Rectangle'],
      [am4, 'Node', 'Rectangle'],
      [am4, 'Process', 'RoundedRectangle'],
      [am3, 'Contract', 'DoubleBandedRectangle'],
      [am3, 'Representation', 'WavyBandedRectangle'],
      [am3, 'Gap', 'WavyRectangle'],
      [am3, 'Meaning', 'Cloud'],
      [am3, 'Grouping', 'Folder'],
    ];
    // ArchiMate's own shapes are declared in its notation file, with a core fallback.
    const core = new Set(['Rectangle', 'RoundedRectangle']);
    for (const [shapesOf, local, shape] of expected) {
      const style = shapesOf(local)!;
      if (core.has(shape)) {
        expect(style.shapeType, local).toBe(shape);
        expect(style.customShape, local).toBeUndefined();
      } else {
        expect(style.customShape?.iri.split('#')[1], local).toBe(shape);
        expect(style.customShape?.iri, local).toMatch(/^https:\/\/meta\.linked\.archi\/archimate[34]\/notation#/);
        expect(style.shapeType, local).toBe(shape === 'Cloud' ? 'Ellipse' : 'Rectangle');
      }
    }
    expect(am4('Grouping')?.borderStyle).toBe('DashedLine');
    expect(am3('Grouping')?.borderStyle).toBe('DashedLine');
  });
});
