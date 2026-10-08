/**
 * The five-step notation lookup (Req 2.16), one case per step and per boundary
 * between steps, the two helpers that order the fallback layers, and the order
 * applied to the Basic asset set beside the bundled ArchiMate 4.0.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Parser, Store } from 'n3';
import type { Quad as N3Quad } from 'n3';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3MetamodelLoader } from '../metamodel-loader.js';
import { buildVisualNotations, resolveNotationSetForContext, type NotationSet } from '../notation.js';
import { buildSuperClassMap, superClassesNearestFirst } from '../class-hierarchy.js';
import {
  NotationResolver,
  orderedFallbackSets,
  storeDefaultNotationSetIris,
} from '../notation-resolver.js';
import {
  ARCH_ELEMENT,
  BASIC,
  BASIC_METAMODEL,
  BUBBLE_ELEMENT_STYLE,
  BUBBLE_SET,
  MODELLER_CONTEXT,
  RECTANGLE_ELEMENT_STYLE,
  RECTANGLE_SET,
  WORKSHOP_CONTEXT,
  basicAssetSource,
} from './basic-fixture.js';

function storeFromTurtle(...parts: string[]): Store {
  const parser = new Parser();
  const store = new Store();
  for (const ttl of parts) store.addQuads(parser.parse(ttl));
  return store;
}

const ARCH = 'https://meta.linked.archi/core#';
const EX = 'https://example.org/r#';
const IMG = 'https://example.org/img/';
const SET_A = 'https://example.org/set-a#SetA';
const SET_B = 'https://example.org/set-b#SetB';
const SET_F1 = 'https://example.org/set-f1#SetF1';
const SET_F2 = 'https://example.org/set-f2#SetF2';
const EMPTY_SET = 'https://example.org/set-empty#EmptySet';

const PREFIXES = `
  @prefix owl:      <http://www.w3.org/2002/07/owl#> .
  @prefix rdf:      <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
  @prefix rdfs:     <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix skos:     <http://www.w3.org/2004/02/skos/core#> .
  @prefix arch:     <${ARCH}> .
  @prefix arch-vis: <https://meta.linked.archi/core-vis#> .
  @prefix ex:       <${EX}> .
  @prefix img:      <${IMG}> .
  @prefix sa:       <https://example.org/set-a#> .
  @prefix sb:       <https://example.org/set-b#> .
  @prefix f1:       <https://example.org/set-f1#> .
  @prefix f2:       <https://example.org/set-f2#> .
  @prefix dx:       <https://example.org/set-default#> .
  @prefix ax:       <https://example.org/set-alt#> .
`;

/** The set each descriptor prefix belongs to. */
const SET_OF: Record<string, string> = {
  sa: 'sa:SetA',
  sb: 'sb:SetB',
  f1: 'f1:SetF1',
  f2: 'f2:SetF2',
  // The own-default-set case below: one language's default set and its alternative.
  dx: 'ex:DefaultSet',
  ax: 'ex:AltSet',
};

/** One element descriptor `prefix:name` for `concept`, filled `fill`, optionally with an image. */
function element(prefix: string, name: string, concept: string, shape: string, fill: string, image?: string): string {
  return `
    ${prefix}:${name} rdf:type arch-vis:VisualNotation ;
      arch-vis:notationFor ${concept} ;
      arch-vis:inNotationSet ${SET_OF[prefix]} ;
      ${image ? `arch:prefVisNotation img:${image} ;` : ''}
      arch-vis:defaultStyle [ arch-vis:shapeType arch-vis:${shape} ; arch-vis:fillColor "${fill}" ] .`;
}

const FIXTURE = `${PREFIXES}
  # ── Classes ─────────────────────────────────────────────────────────
  ex:Parent rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:Exact rdf:type owl:Class ; rdfs:subClassOf ex:Parent ; arch:prefVisNotation img:exact-own.svg .
  ex:Child rdf:type owl:Class ; rdfs:subClassOf ex:Parent .
  ex:Pictured rdf:type owl:Class ; rdfs:subClassOf ex:Parent ; arch:prefVisNotation img:pictured-own.svg .
  # ParentB first, so store order (first mention) and IRI order disagree.
  ex:ParentB rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:ParentA rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:Twin rdf:type owl:Class ; rdfs:subClassOf ex:ParentB , ex:ParentA .
  ex:Layered rdf:type owl:Class ; rdfs:subClassOf ex:Parent .
  ex:FallbackParent rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:Fallback rdf:type owl:Class ; rdfs:subClassOf ex:FallbackParent ; arch:prefVisNotation img:fallback-own.svg .
  ex:Both rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:OwnImage rdf:type owl:Class ; rdfs:subClassOf ex:FallbackParent ; arch:prefVisNotation img:own-image.svg .
  ex:Inherits rdf:type owl:Class ; rdfs:subClassOf ex:FallbackParent .
  ex:Mid rdf:type owl:Class ; rdfs:subClassOf ex:FallbackParent .
  ex:Deep rdf:type owl:Class ; rdfs:subClassOf ex:Mid .
  ex:Nothing rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:Link rdf:type owl:Class ; rdfs:subClassOf arch:QualifiedRelationship .
  # One superclass that A, F1 and F2 all describe.
  ex:SharedParent rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  ex:SharedChild rdf:type owl:Class ; rdfs:subClassOf ex:SharedParent .
  # Two parents one step up: FallbackParent (F1 only) sorts before ParentA (A only).
  ex:Cousin rdf:type owl:Class ; rdfs:subClassOf ex:ParentA , ex:FallbackParent .

  # ── A: the superclass-rich active set ───────────────────────────────
  sa:SetA rdf:type arch-vis:NotationSet .
  ${element('sa', 'Exact', 'ex:Exact', 'Octagon', '#A00001')}
  ${element('sa', 'Parent', 'ex:Parent', 'Hexagon', '#A00002', 'a-parent.svg')}
  ${element('sa', 'ParentA', 'ex:ParentA', 'Diamond', '#A0000A')}
  ${element('sa', 'ParentB', 'ex:ParentB', 'Ellipse', '#A0000B')}
  ${element('sa', 'Element', 'arch:Element', 'Rectangle', '#A000EE')}
  ${element('sa', 'SharedParent', 'ex:SharedParent', 'Hexagon', '#A000CC')}
  sa:Relationship rdf:type arch-vis:VisualNotation ;
    arch-vis:notationFor arch:QualifiedRelationship ;
    arch-vis:inNotationSet sa:SetA ;
    arch-vis:lineStyle arch-vis:DashedLine ;
    arch-vis:targetDecor arch-vis:OpenArrowhead .

  # ── B: a narrow active set, describing nothing the fallback cases use ─
  sb:SetB rdf:type arch-vis:NotationSet .
  ${element('sb', 'Exact', 'ex:Exact', 'RoundedRectangle', '#B00001', 'b-exact.svg')}

  # ── F1 and F2: other metamodels' default sets ───────────────────────
  f1:SetF1 rdf:type arch-vis:NotationSet .
  ${element('f1', 'Layered', 'ex:Layered', 'Circle', '#F10001')}
  ${element('f1', 'Fallback', 'ex:Fallback', 'Parallelogram', '#F10002', 'f1-fallback.svg')}
  ${element('f1', 'FallbackParent', 'ex:FallbackParent', 'Octagon', '#F100FF', 'f1-fallback-parent.svg')}
  ${element('f1', 'Both', 'ex:Both', 'Rectangle', '#F10003')}
  ${element('f1', 'SharedParent', 'ex:SharedParent', 'Circle', '#F100CC')}

  f2:SetF2 rdf:type arch-vis:NotationSet .
  ${element('f2', 'Both', 'ex:Both', 'Rectangle', '#F20003')}
  ${element('f2', 'Mid', 'ex:Mid', 'Hexagon', '#F200AA')}
  ${element('f2', 'SharedParent', 'ex:SharedParent', 'Circle', '#F200CC')}

  <${EMPTY_SET}> rdf:type arch-vis:NotationSet .
`;

const graph = storeFromTurtle(FIXTURE);
const superClassMap = buildSuperClassMap(graph);

function set(iri: string): NotationSet {
  const built = buildVisualNotations(graph, iri);
  if (!built) throw new Error(`fixture set <${iri}> has no descriptors`);
  return built;
}

function resolverFor(active: string | null, fallbacks: string[] = []): NotationResolver {
  return new NotationResolver(graph, active ? set(active) : null, fallbacks.map(set), superClassMap);
}

describe('NotationResolver — the five steps in order', () => {
  it("1. takes the active set's descriptor for the class itself", () => {
    const resolved = resolverFor(SET_A, [SET_F1]).resolve(`${EX}Exact`);
    expect(resolved).toMatchObject({
      source: 'active',
      notationSetIri: SET_A,
      matchedClassIri: `${EX}Exact`,
      // The descriptor has no image of its own, so the class's applies.
      prefVisNotation: `${IMG}exact-own.svg`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#A00001');

    // A descriptor image wins over the class's own.
    expect(resolverFor(SET_B).resolve(`${EX}Exact`)).toMatchObject({
      source: 'active',
      notationSetIri: SET_B,
      prefVisNotation: `${IMG}b-exact.svg`,
    });
  });

  it("2. takes a fallback set's exact descriptor over the class's own image and its superclass one", () => {
    const resolved = resolverFor(SET_B, [SET_F1, SET_F2]).resolve(`${EX}Fallback`);
    expect(resolved).toMatchObject({
      source: 'fallback',
      notationSetIri: SET_F1,
      matchedClassIri: `${EX}Fallback`,
      prefVisNotation: `${IMG}f1-fallback.svg`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#F10002');
  });

  it('2. consults the fallback sets in load order', () => {
    expect(resolverFor(SET_B, [SET_F1, SET_F2]).resolve(`${EX}Both`)).toMatchObject({
      source: 'fallback',
      notationSetIri: SET_F1,
    });
    expect(resolverFor(SET_B, [SET_F2, SET_F1]).resolve(`${EX}Both`)).toMatchObject({
      source: 'fallback',
      notationSetIri: SET_F2,
    });
  });

  it("2 before 4: an exact fallback descriptor beats the active set's superclass descriptor", () => {
    // A describes Layered's parent; F1 describes Layered itself.
    const resolved = resolverFor(SET_A, [SET_F1]).resolve(`${EX}Layered`);
    expect(resolved).toMatchObject({
      source: 'fallback',
      notationSetIri: SET_F1,
      matchedClassIri: `${EX}Layered`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#F10001');
  });

  it("3. uses the class's own arch:prefVisNotation before any superclass descriptor", () => {
    // The active set describes the class's parent: the own image still wins (3 before 4).
    expect(resolverFor(SET_A).resolve(`${EX}Pictured`)).toEqual({
      source: 'pref-vis-notation',
      prefVisNotation: `${IMG}pictured-own.svg`,
    });
    // A fallback set describes the parent, and the active set at most arch:Element (3 before 4).
    for (const resolver of [resolverFor(SET_B, [SET_F1, SET_F2]), resolverFor(SET_A, [SET_F1])]) {
      expect(resolver.resolve(`${EX}OwnImage`)).toEqual({
        source: 'pref-vis-notation',
        prefVisNotation: `${IMG}own-image.svg`,
      });
    }
  });

  it("4. takes the active set's nearest superclass: the parent, not arch:Element", () => {
    const resolved = resolverFor(SET_A).resolve(`${EX}Child`);
    expect(resolved).toMatchObject({
      source: 'active-superclass',
      notationSetIri: SET_A,
      matchedClassIri: `${EX}Parent`,
      // The inherited look includes the superclass descriptor's image.
      prefVisNotation: `${IMG}a-parent.svg`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#A00002');
  });

  it('4. breaks a tie between equally near superclasses by IRI, not by declaration order', () => {
    const resolved = resolverFor(SET_A).resolve(`${EX}Twin`);
    expect(resolved).toMatchObject({ source: 'active-superclass', matchedClassIri: `${EX}ParentA` });
    expect(resolved.notation?.style?.fillColor).toBe('#A0000A');
    // No image on that descriptor, and the class has none of its own.
    expect(resolved.prefVisNotation).toBeUndefined();
  });

  it("4. the nearer superclass wins: a fallback layer's parent descriptor beats the active set's arch:Element", () => {
    // F1 describes the direct parent (FallbackParent); A only arch:Element, two steps up.
    const resolved = resolverFor(SET_A, [SET_F1]).resolve(`${EX}Inherits`);
    expect(resolved).toMatchObject({
      source: 'fallback-superclass',
      notationSetIri: SET_F1,
      matchedClassIri: `${EX}FallbackParent`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#F100FF');
  });

  it('4. the same superclass in A and F: the active set breaks the tie', () => {
    const resolved = resolverFor(SET_A, [SET_F1, SET_F2]).resolve(`${EX}SharedChild`);
    expect(resolved).toMatchObject({
      source: 'active-superclass',
      notationSetIri: SET_A,
      matchedClassIri: `${EX}SharedParent`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#A000CC');

    // With no descriptor in the active set, the fallback layers' load order decides.
    const f2First = resolverFor(SET_B, [SET_F2, SET_F1]).resolve(`${EX}SharedChild`);
    expect(f2First).toMatchObject({
      source: 'fallback-superclass',
      notationSetIri: SET_F2,
      matchedClassIri: `${EX}SharedParent`,
    });
    expect(f2First.notation?.style?.fillColor).toBe('#F200CC');

    const f1First = resolverFor(SET_B, [SET_F1, SET_F2]).resolve(`${EX}SharedChild`);
    expect(f1First).toMatchObject({
      source: 'fallback-superclass',
      notationSetIri: SET_F1,
      matchedClassIri: `${EX}SharedParent`,
    });
    expect(f1First.notation?.style?.fillColor).toBe('#F100CC');
  });

  it('4. equally near superclasses: IRI order decides before the set does', () => {
    // Cousin's two parents are both one step up. …#FallbackParent (described in F1)
    // sorts before …#ParentA (described in A), so F1's descriptor applies.
    const resolved = resolverFor(SET_A, [SET_F1]).resolve(`${EX}Cousin`);
    expect(resolved).toMatchObject({
      source: 'fallback-superclass',
      notationSetIri: SET_F1,
      matchedClassIri: `${EX}FallbackParent`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#F100FF');
  });

  it("4. falls back to a fallback set's nearest superclass when the class has no image", () => {
    const resolved = resolverFor(SET_B, [SET_F1, SET_F2]).resolve(`${EX}Inherits`);
    expect(resolved).toMatchObject({
      source: 'fallback-superclass',
      notationSetIri: SET_F1,
      matchedClassIri: `${EX}FallbackParent`,
      prefVisNotation: `${IMG}f1-fallback-parent.svg`,
    });
    expect(resolved.notation?.style?.fillColor).toBe('#F100FF');
  });

  it('4. distance before load order: the nearer superclass wins whichever fallback set describes it', () => {
    // F2 describes the nearer superclass (Mid), F1 a farther one (FallbackParent):
    // Mid wins in either load order.
    for (const fallbacks of [
      [SET_F1, SET_F2],
      [SET_F2, SET_F1],
    ]) {
      expect(resolverFor(SET_B, fallbacks).resolve(`${EX}Deep`)).toMatchObject({
        source: 'fallback-superclass',
        notationSetIri: SET_F2,
        matchedClassIri: `${EX}Mid`,
      });
    }
  });

  it('5. reports default when nothing applies', () => {
    expect(resolverFor(SET_B, [SET_F1, SET_F2]).resolve(`${EX}Nothing`)).toEqual({ source: 'default' });
    expect(resolverFor(null).resolve(`${EX}Unknown`)).toEqual({ source: 'default' });
  });

  it('works with no active set at all', () => {
    expect(resolverFor(null, [SET_F1]).resolve(`${EX}Inherits`)).toMatchObject({
      source: 'fallback-superclass',
      notationSetIri: SET_F1,
    });
  });

  it('styles a relationship class from the arch:QualifiedRelationship descriptor, with no colour', () => {
    const resolved = resolverFor(SET_A).resolve(`${EX}Link`);
    expect(resolved).toMatchObject({
      source: 'active-superclass',
      matchedClassIri: `${ARCH}QualifiedRelationship`,
    });
    expect(resolved.notation?.relationshipStyle).toEqual({
      lineStyle: 'DashedLine',
      sourceDecor: undefined,
      targetDecor: 'OpenArrowhead',
      lineColor: undefined,
    });
    expect(resolved.notation?.relationshipStyle?.lineColor).toBeUndefined();
  });

  it('answers each class once', () => {
    const resolver = resolverFor(SET_A);
    expect(resolver.resolve(`${EX}Child`)).toBe(resolver.resolve(`${EX}Child`));
  });
});

describe('orderedFallbackSets', () => {
  it('keeps the given order and drops the active set, repeats, empty and unknown sets', () => {
    const sets = orderedFallbackSets(graph, SET_A, [
      SET_A,
      SET_F2,
      SET_F1,
      SET_F2,
      EMPTY_SET,
      'https://example.org/set-unknown#Nope',
    ]);
    expect(sets.map((s) => s.iri)).toEqual([SET_F2, SET_F1]);
  });

  it('keeps every set when none is active', () => {
    expect(orderedFallbackSets(graph, undefined, [SET_F1, SET_A]).map((s) => s.iri)).toEqual([SET_F1, SET_A]);
  });
});

describe('storeDefaultNotationSetIris', () => {
  const ZETA = `${PREFIXES}
    ex:Zeta rdf:type arch:Metamodel ; arch:notationSet ex:ZSet .`;
  const ALPHA = `${PREFIXES}
    ex:Alpha rdf:type arch:Metamodel ; arch:notationSet ex:A2Set , ex:A1Set .`;
  const NOISE = `${PREFIXES}
    ex:NotAMetamodel arch:notationSet ex:Ignored .
    ex:Beta rdf:type arch:Metamodel ; arch:notationSet "not an IRI" .`;

  it('orders by metamodel IRI, then set IRI, whatever the insertion order', () => {
    const expected = [`${EX}A1Set`, `${EX}A2Set`, `${EX}ZSet`];
    expect(storeDefaultNotationSetIris(storeFromTurtle(ZETA, ALPHA, NOISE))).toEqual(expected);
    expect(storeDefaultNotationSetIris(storeFromTurtle(NOISE, ALPHA, ZETA))).toEqual(expected);
  });

  it('is empty when no metamodel names a set', () => {
    expect(storeDefaultNotationSetIris(storeFromTurtle(NOISE))).toEqual([]);
  });
});

describe('NotationResolver — fallback layers include the own default set', () => {
  // Shaped like EDGY's Overview map context: the context picks an alternative set
  // that lacks a class its own metamodel's default set describes.
  const own = storeFromTurtle(`${PREFIXES}
    ex:Lang rdf:type arch:Metamodel ; arch:notationSet ex:DefaultSet .
    ex:MapContext arch:usesNotationSet ex:AltSet .
    ex:Purpose rdf:type owl:Class ; rdfs:subClassOf arch:Element .
    ex:Metrics rdf:type owl:Class ; rdfs:subClassOf arch:Element .
    ex:DefaultSet rdf:type arch-vis:NotationSet .
    ex:AltSet rdf:type arch-vis:NotationSet .
    ${element('dx', 'Purpose', 'ex:Purpose', 'RoundedRectangle', '#D00001')}
    ${element('dx', 'Metrics', 'ex:Metrics', 'Ellipse', '#D00002')}
    ${element('ax', 'Purpose', 'ex:Purpose', 'Circle', '#E00001')}
  `);

  it("2. a class the context's alternative set lacks keeps its own metamodel default's descriptor", () => {
    // Built the way the palette builds it.
    const activeIri = resolveNotationSetForContext(own, `${EX}MapContext`);
    expect(activeIri).toBe(`${EX}AltSet`);
    const active = activeIri ? buildVisualNotations(own, activeIri) : null;
    const fallbacks = orderedFallbackSets(own, active?.iri, storeDefaultNotationSetIris(own));
    expect(fallbacks.map((s) => s.iri)).toEqual([`${EX}DefaultSet`]);

    const resolver = new NotationResolver(own, active, fallbacks, buildSuperClassMap(own));

    const metrics = resolver.resolve(`${EX}Metrics`);
    expect(metrics).toMatchObject({
      source: 'fallback',
      notationSetIri: `${EX}DefaultSet`,
      matchedClassIri: `${EX}Metrics`,
    });
    expect(metrics.notation?.style?.fillColor).toBe('#D00002');

    const purpose = resolver.resolve(`${EX}Purpose`);
    expect(purpose).toMatchObject({
      source: 'active',
      notationSetIri: `${EX}AltSet`,
      matchedClassIri: `${EX}Purpose`,
    });
    expect(purpose.notation?.style?.fillColor).toBe('#E00001');
  });
});

// ---------------------------------------------------------------------------
// The order on real data: Basic's set active, the bundled ArchiMate 4.0 beside it.
// ---------------------------------------------------------------------------

describe('NotationResolver — Basic active beside ArchiMate 4.0', () => {
  const AM4 = 'https://meta.linked.archi/archimate4/onto#';
  const AM4_SET = 'https://meta.linked.archi/archimate4/notation#ArchiMate40StandardNotation';
  /** An extension class under am4:BusinessActor, with no descriptor and no image of its own. */
  const EXTENSION = 'https://example.org/ext#KeyAccountManager';
  const EXTENSION_TTL = `
    @prefix owl:  <http://www.w3.org/2002/07/owl#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
    @prefix am4:  <${AM4}> .
    <${EXTENSION}> a owl:Class ;
      rdfs:subClassOf am4:BusinessActor ; skos:prefLabel "Key account manager"@en .
  `;
  /** Each Basic context with the set it selects. */
  const CONTEXTS: Array<[name: string, contextIri: string, setIri: string]> = [
    ['Modeller', MODELLER_CONTEXT, RECTANGLE_SET],
    ['Workshop', WORKSHOP_CONTEXT, BUBBLE_SET],
  ];

  let basicGraph: Store;
  let basicSuperClasses: Map<string, string[]>;
  let defaultSets: string[];

  beforeAll(async () => {
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store, basicAssetSource());
    // Basic first, as when it is the primary metamodel: its rectangle set is then
    // active without a context too, which is the Modeller case below.
    const basic = await loader.loadMetamodelByIri(BASIC_METAMODEL);
    const archimate = await loader.loadBundledMetamodel();
    defaultSets = [basic.notationSetIri, archimate.notationSetIri].filter((iri): iri is string => !!iri);
    basicGraph = snapshot(store);
    basicGraph.addQuads(new Parser().parse(EXTENSION_TTL));
    basicSuperClasses = buildSuperClassMap(basicGraph);
  }, 60_000);

  /** The store's quads in an n3 Store, as the palette generator snapshots them. */
  function snapshot(store: OxigraphRdfStore): Store {
    const snap = new Store();
    for (const q of store.getQuads()) {
      snap.addQuad(
        q.subject as unknown as N3Quad['subject'],
        q.predicate as unknown as N3Quad['predicate'],
        q.object as unknown as N3Quad['object'],
        q.graph as unknown as N3Quad['graph'],
      );
    }
    return snap;
  }

  /** What a palette builds for a context: the context's set active, the loaded default sets behind it. */
  function inContext(contextIri: string): NotationResolver {
    const setIri = resolveNotationSetForContext(basicGraph, contextIri);
    const active = setIri ? buildVisualNotations(basicGraph, setIri) : null;
    return new NotationResolver(
      basicGraph,
      active,
      orderedFallbackSets(basicGraph, active?.iri, defaultSets),
      basicSuperClasses,
    );
  }

  it('loads both default sets, Basic first', () => {
    expect(defaultSets).toEqual([RECTANGLE_SET, AM4_SET]);
  });

  it.each(CONTEXTS)("keeps ArchiMate's filled diamond on am4:Composition (%s context)", (_name, context) => {
    const resolved = inContext(context).resolve(`${AM4}Composition`);
    expect(resolved).toMatchObject({
      source: 'fallback',
      notationSetIri: AM4_SET,
      matchedClassIri: `${AM4}Composition`,
    });
    expect(resolved.notation?.relationshipStyle).toEqual({
      lineStyle: 'SolidLine',
      sourceDecor: 'FilledDiamond',
      targetDecor: 'NoDecoration',
    });
    expect(resolved.notation?.relationshipStyle?.lineColor).toBeUndefined();
  });

  it.each(CONTEXTS)("keeps ArchiMate's own style on am4:BusinessActor (%s context)", (_name, context) => {
    const resolved = inContext(context).resolve(`${AM4}BusinessActor`);
    expect(resolved).toMatchObject({
      source: 'fallback',
      notationSetIri: AM4_SET,
      matchedClassIri: `${AM4}BusinessActor`,
      prefVisNotation: 'https://meta.linked.archi/archimate4/icons/business-actor.svg',
    });
    expect(resolved.notation?.style).toMatchObject({
      shapeType: 'Rectangle',
      fillColor: '#FFFFB5',
      renderingMode: 'ShapeWithBadge',
      iconSymbol: 'https://meta.linked.archi/archimate4/icons/glyphs/actor.svg',
      defaultHeight: 55,
    });
  });

  it.each(CONTEXTS)(
    "styles an extension subclass of am4:BusinessActor as a Business Actor, not as Basic's arch:Element (%s context)",
    (_name, context) => {
      // ArchiMate's descriptor is one step up; Basic's arch:Element one at least two.
      const superClasses = superClassesNearestFirst(EXTENSION, basicSuperClasses);
      expect(superClasses[0]).toBe(`${AM4}BusinessActor`);
      expect(superClasses.indexOf(ARCH_ELEMENT)).toBeGreaterThanOrEqual(1);

      const resolved = inContext(context).resolve(EXTENSION);
      expect(resolved).toMatchObject({
        source: 'fallback-superclass',
        notationSetIri: AM4_SET,
        matchedClassIri: `${AM4}BusinessActor`,
        prefVisNotation: 'https://meta.linked.archi/archimate4/icons/business-actor.svg',
      });
      expect(resolved.notation?.style).toMatchObject({
        shapeType: 'Rectangle',
        fillColor: '#FFFFB5',
        renderingMode: 'ShapeWithBadge',
      });
    },
  );

  it("styles basic:Node by the active Basic set's arch:Element descriptor: rectangle for modellers, circle in workshops", () => {
    const modeller = inContext(MODELLER_CONTEXT).resolve(`${BASIC}Node`);
    expect(modeller).toMatchObject({
      source: 'active-superclass',
      notationSetIri: RECTANGLE_SET,
      matchedClassIri: ARCH_ELEMENT,
    });
    expect(modeller.notation?.style).toEqual(RECTANGLE_ELEMENT_STYLE);

    const workshop = inContext(WORKSHOP_CONTEXT).resolve(`${BASIC}Node`);
    expect(workshop).toMatchObject({
      source: 'active-superclass',
      notationSetIri: BUBBLE_SET,
      matchedClassIri: ARCH_ELEMENT,
    });
    expect(workshop.notation?.style).toEqual(BUBBLE_ELEMENT_STYLE);
    expect(workshop.notation?.style?.shapeType).toBe('Circle');
  });

  it.each(CONTEXTS)(
    'resolves basic:Association and basic:Aggregation to their own descriptors, with no colour (%s context)',
    (_name, context, setIri) => {
      const resolver = inContext(context);

      const association = resolver.resolve(`${BASIC}Association`);
      expect(association).toMatchObject({
        source: 'active',
        notationSetIri: setIri,
        matchedClassIri: `${BASIC}Association`,
      });
      expect(association.notation?.relationshipStyle).toEqual({
        lineStyle: 'SolidLine',
        sourceDecor: 'NoDecoration',
        targetDecor: 'NoDecoration',
      });

      const aggregation = resolver.resolve(`${BASIC}Aggregation`);
      expect(aggregation).toMatchObject({
        source: 'active',
        notationSetIri: setIri,
        matchedClassIri: `${BASIC}Aggregation`,
      });
      expect(aggregation.notation?.relationshipStyle).toEqual({
        lineStyle: 'SolidLine',
        sourceDecor: 'HollowDiamond',
        targetDecor: 'NoDecoration',
      });

      for (const resolved of [association, aggregation]) {
        expect(resolved.notation?.relationshipStyle?.lineColor).toBeUndefined();
      }
    },
  );
});
