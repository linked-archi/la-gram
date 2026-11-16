import { describe, it, expect, beforeAll } from 'vitest';
import { Parser, Store } from 'n3';
import { buildClassificationAxes, buildClasses, type TaxonomyAxis } from '../taxonomy.js';
import { fetchAssetText } from '../bundled-assets.js';

function storeFromTurtle(...parts: string[]): Store {
  const parser = new Parser();
  const store = new Store();
  for (const ttl of parts) store.addQuads(parser.parse(ttl));
  return store;
}

const PREFIXES = `
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix arch: <https://meta.linked.archi/core#> .
@prefix am:   <https://meta.linked.archi/archimate3/onto#> .
@prefix :     <https://meta.linked.archi/archimate3/tax#> .
`;

const TAX = 'https://meta.linked.archi/archimate3/tax#';
const ONTO = 'https://meta.linked.archi/archimate3/onto#';

/** A metamodel's palette grouping (arch:paletteGrouping): the axes it groups by, main one first. */
const GROUPING = (axes: string) => `${PREFIXES}
<https://example.org/mm#M> a arch:Metamodel ; arch:paletteGrouping :PaletteGrouping .
:PaletteGrouping a skos:OrderedCollection ; skos:memberList ( ${axes} ) .
`;

/**
 * Minimal ArchiMate-3.2-shaped taxonomy: one scheme, two axes (by Layer, by Aspect),
 * with a couple of leaf OWL classes that appear in BOTH axes under different groups.
 * This reproduces the multi-axis overwrite bug: BusinessActor is in "Business Layer"
 * (Layer axis) and "Active Structure" (Aspect axis).
 */
const AM32_TAX = `${PREFIXES}
<${TAX}>
    a skos:ConceptScheme ;
    skos:hasTopConcept :ArchiMateConcept .

# metamodel manifest references the scheme as its classification
<https://meta.linked.archi/archimate3/metamodel#> arch:conceptClassification <${TAX}> .

:ArchiMateConcept a skos:Concept ; skos:prefLabel "ArchiMate Concept"@en ;
    skos:inScheme <${TAX}> .
:ArchiMateElement a skos:Concept ; skos:prefLabel "ArchiMate Element"@en ;
    skos:broader :ArchiMateConcept ; skos:inScheme <${TAX}> .

# --- Axis 1: by Layer ---
:Layer a skos:Concept ; skos:prefLabel "Layer"@en ;
    skos:broader :ArchiMateElement ; skos:inScheme <${TAX}> .
:BusinessLayer a skos:Concept ; skos:prefLabel "Business Layer"@en ;
    skos:broader :Layer ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor, am:BusinessProcess .
:ApplicationLayer a skos:Concept ; skos:prefLabel "Application Layer"@en ;
    skos:broader :Layer ; skos:inScheme <${TAX}> ;
    skos:narrower am:ApplicationComponent .

# --- Axis 2: by Aspect ---
:Aspect a skos:Concept ; skos:prefLabel "Aspect"@en ;
    skos:broader :ArchiMateElement ; skos:inScheme <${TAX}> .
:ActiveStructure a skos:Concept ; skos:prefLabel "Active Structure"@en ;
    skos:broader :Aspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor, am:ApplicationComponent .
:Behavior a skos:Concept ; skos:prefLabel "Behavior"@en ;
    skos:broader :Aspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessProcess .

# --- OWL classes (instantiable elements) ---
am:BusinessActor a owl:Class ; rdfs:label "Business Actor"@en .
am:BusinessProcess a owl:Class ; rdfs:label "Business Process"@en .
am:ApplicationComponent a owl:Class ; rdfs:label "Application Component"@en .
`;

/** A third, structural axis layered on top of {@link AM32_TAX}. */
const AM32_DOMAIN_AXIS = `${PREFIXES}
:Domain a skos:Concept ; skos:prefLabel "Domain"@en ;
    skos:broader :ArchiMateElement ; skos:inScheme <${TAX}> .
:BusinessDomain a skos:Concept ; skos:prefLabel "Business Domain"@en ;
    skos:broader :Domain ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor, am:BusinessProcess .
:ApplicationDomain a skos:Concept ; skos:prefLabel "Application Domain"@en ;
    skos:broader :Domain ; skos:inScheme <${TAX}> ;
    skos:narrower am:ApplicationComponent .
`;

/**
 * ArchiMate-4-shaped taxonomy: the leaf members are SKOS concepts linked to their OWL class
 * via rdfs:seeAlso rather than being the OWL class directly. Verifies the resolver handles
 * both linking styles the same way (metamodel-agnostic).
 */
const AM4_TAX = `${PREFIXES}
<${TAX}> a skos:ConceptScheme ; skos:hasTopConcept :Concept .
<https://meta.linked.archi/archimate3/metamodel#> arch:conceptClassification <${TAX}> .

:Concept a skos:Concept ; skos:prefLabel "Concept"@en ; skos:inScheme <${TAX}> .
:Domain a skos:Concept ; skos:prefLabel "Domain"@en ;
    skos:broader :Concept ; skos:inScheme <${TAX}> .
:BusinessDomain a skos:Concept ; skos:prefLabel "Business Domain"@en ;
    skos:broader :Domain ; skos:inScheme <${TAX}> ;
    skos:narrower :BusinessActorConcept .
:BusinessActorConcept a skos:Concept ; skos:prefLabel "Business Actor"@en ;
    skos:inScheme <${TAX}> ;
    rdfs:seeAlso am:BusinessActor .
am:BusinessActor a owl:Class ; rdfs:label "Business Actor"@en .
`;

/**
 * Two-level nesting, shaped like the published aspect axis: the axis's own child group holds a
 * member directly *and* a sub-group that holds the rest.
 */
const NESTED_TWO_LEVEL = `${PREFIXES}
<${TAX}> a skos:ConceptScheme .
:Aspect a skos:Concept ; skos:prefLabel "Aspect"@en ;
    skos:inScheme <${TAX}> .
:ActiveStructure a skos:Concept ; skos:prefLabel "Active Structure"@en ;
    skos:broader :Aspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:Path .
:InternalActiveStructure a skos:Concept ; skos:prefLabel "Internal Active Structure"@en ;
    skos:broader :ActiveStructure ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor, am:ApplicationComponent .

am:Path a owl:Class ; rdfs:label "Path"@en .
am:BusinessActor a owl:Class ; rdfs:label "Business Actor"@en .
am:ApplicationComponent a owl:Class ; rdfs:label "Application Component"@en .
`;

/** Three grouping levels below the axis — the real depth of the published Structure branch. */
const NESTED_THREE_LEVEL = `${PREFIXES}
<${TAX}> a skos:ConceptScheme .
:Aspect a skos:Concept ; skos:prefLabel "Aspect"@en ;
    skos:inScheme <${TAX}> .
:Structure a skos:Concept ; skos:prefLabel "Structure"@en ;
    skos:broader :Aspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:Resource .
:ActiveStructure a skos:Concept ; skos:prefLabel "Active Structure"@en ;
    skos:broader :Structure ; skos:inScheme <${TAX}> ;
    skos:narrower am:Path .
:InternalActiveStructure a skos:Concept ; skos:prefLabel "Internal Active Structure"@en ;
    skos:broader :ActiveStructure ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor .

am:Resource a owl:Class ; rdfs:label "Resource"@en .
am:Path a owl:Class ; rdfs:label "Path"@en .
am:BusinessActor a owl:Class ; rdfs:label "Business Actor"@en .
`;

/**
 * One axis, two sibling groups of different shape: `:Behavior` lists its member directly, while
 * `:Structure` lists nothing itself and delegates entirely to a sub-group.
 *
 * `:Structure` is the shape that could be mistaken for an axis — it holds no member of its own
 * and its only concept-child is a group — so this fixture pins both halves of the rule.
 */
const NESTED_MIXED = `${PREFIXES}
<${TAX}> a skos:ConceptScheme .
:Aspect a skos:Concept ; skos:prefLabel "Aspect"@en ;
    skos:inScheme <${TAX}> .
:Behavior a skos:Concept ; skos:prefLabel "Behavior"@en ;
    skos:broader :Aspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessProcess .
:Structure a skos:Concept ; skos:prefLabel "Structure"@en ;
    skos:broader :Aspect ; skos:inScheme <${TAX}> .
:ActiveStructure a skos:Concept ; skos:prefLabel "Active Structure"@en ;
    skos:broader :Structure ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor .

am:BusinessProcess a owl:Class ; rdfs:label "Business Process"@en .
am:BusinessActor a owl:Class ; rdfs:label "Business Actor"@en .
`;

/**
 * A `skos:narrower` cycle between two sibling groups. Published SKOS should be a tree; this
 * pins that malformed data terminates instead of spinning.
 */
const CYCLIC_TAX = `${PREFIXES}
<${TAX}> a skos:ConceptScheme .
:Axis a skos:Concept ; skos:prefLabel "Cyclic Axis"@en ; skos:inScheme <${TAX}> ;
    skos:narrower :GroupA .
:GroupA a skos:Concept ; skos:prefLabel "Group A"@en ; skos:inScheme <${TAX}> ;
    skos:narrower am:One, :GroupB .
:GroupB a skos:Concept ; skos:prefLabel "Group B"@en ; skos:inScheme <${TAX}> ;
    skos:narrower am:Two, :GroupA .

am:One a owl:Class ; rdfs:label "One"@en .
am:Two a owl:Class ; rdfs:label "Two"@en .
`;

/** The same cycle expressed purely through `skos:broader`, which is traversed in inverse. */
const CYCLIC_BROADER_TAX = `${PREFIXES}
<${TAX}> a skos:ConceptScheme .
:Axis a skos:Concept ; skos:prefLabel "Cyclic Axis"@en ; skos:inScheme <${TAX}> .
:GroupA a skos:Concept ; skos:prefLabel "Group A"@en ; skos:inScheme <${TAX}> ;
    skos:broader :Axis, :GroupB ; skos:narrower am:One .
:GroupB a skos:Concept ; skos:prefLabel "Group B"@en ; skos:inScheme <${TAX}> ;
    skos:broader :GroupA ; skos:narrower am:Two .

am:One a owl:Class ; rdfs:label "One"@en .
am:Two a owl:Class ; rdfs:label "Two"@en .
`;

describe('buildClassificationAxes', () => {
  it('discovers each classification axis separately instead of collapsing them', () => {
    const axes = buildClassificationAxes(storeFromTurtle(AM32_TAX));
    const labels = axes.map((a) => a.label);
    expect(labels).toContain('Layer');
    expect(labels).toContain('Aspect');
    expect(axes).toHaveLength(2);
  });

  it("orders the axes by the metamodel's palette grouping — its first the default — and by label without one", () => {
    const grouped = buildClassificationAxes(storeFromTurtle(AM32_TAX, GROUPING(':Layer :Aspect')));
    expect(grouped.map((a) => a.label)).toEqual(['Layer', 'Aspect']);
    // No guess from a label: without the data, the axes come by label.
    const plain = buildClassificationAxes(storeFromTurtle(AM32_TAX));
    expect(plain.map((a) => a.label)).toEqual(['Aspect', 'Layer']);
  });

  it('groups the same element differently under each axis (dual classification)', () => {
    const axes = buildClassificationAxes(storeFromTurtle(AM32_TAX));
    const byLayer = axes.find((a) => a.label === 'Layer')!;
    const byAspect = axes.find((a) => a.label === 'Aspect')!;
    const actor = `${ONTO}BusinessActor`;
    expect(byLayer.groups.get(actor)).toBe('Business Layer');
    expect(byAspect.groups.get(actor)).toBe('Active Structure');
  });

  it('returns no axes when the store has no classification scheme', () => {
    const axes = buildClassificationAxes(storeFromTurtle(`${PREFIXES} am:Foo a owl:Class .`));
    expect(axes).toEqual([]);
  });

  it('discovers three axes, in the order the palette grouping gives', () => {
    const axes = buildClassificationAxes(
      storeFromTurtle(AM32_TAX, AM32_DOMAIN_AXIS, GROUPING(':Domain :Layer :Aspect')),
    );
    expect(axes.map((a) => a.label)).toEqual(['Domain', 'Layer', 'Aspect']);
    const actor = `${ONTO}BusinessActor`;
    expect(axes.map((a) => a.groups.get(actor))).toEqual(['Business Domain', 'Business Layer', 'Active Structure']);
  });

  it('does not mistake the scheme root for an axis when its children are not all groups', () => {
    const axes = buildClassificationAxes(storeFromTurtle(AM32_TAX));
    expect(axes.map((a) => a.iri)).not.toContain(`${TAX}ArchiMateElement`);
    expect(axes.map((a) => a.iri)).not.toContain(`${TAX}ArchiMateConcept`);
  });

  it('synthesises a single axis for a flat taxonomy that has groups but no axis wrapper', () => {
    const axes = buildClassificationAxes(
      storeFromTurtle(`${PREFIXES}
        <${TAX}> a skos:ConceptScheme .
        :BusinessLayer a skos:Concept ; skos:prefLabel "Business Layer"@en ;
            skos:inScheme <${TAX}> ; skos:narrower am:BusinessActor .
        :ApplicationLayer a skos:Concept ; skos:prefLabel "Application Layer"@en ;
            skos:inScheme <${TAX}> ; skos:narrower am:ApplicationComponent .
        am:BusinessActor a owl:Class .
        am:ApplicationComponent a owl:Class .
      `),
    );
    expect(axes).toHaveLength(1);
    expect(axes[0]!.label).toBe('Classification');
    expect(axes[0]!.iri).toBe(TAX);
    expect(axes[0]!.groups.get(`${ONTO}BusinessActor`)).toBe('Business Layer');
    expect(axes[0]!.groups.get(`${ONTO}ApplicationComponent`)).toBe('Application Layer');
  });

  it('returns no axes for an empty store', () => {
    expect(buildClassificationAxes(new Store())).toEqual([]);
  });

  it('returns no axes for a scheme that declares concepts but no groups', () => {
    const axes = buildClassificationAxes(
      storeFromTurtle(`${PREFIXES}
        <${TAX}> a skos:ConceptScheme ; skos:hasTopConcept :Solo .
        :Solo a skos:Concept ; skos:prefLabel "Solo"@en ; skos:inScheme <${TAX}> .
      `),
    );
    expect(axes).toEqual([]);
  });
});

describe("buildClassificationAxes (thesaurus arrays: the order of an axis's groups)", () => {
  /**
   * ArchiMate 3.x's shape: two axis concepts under one element concept, the layers in order in an
   * ISO 25964 thesaurus array under their axis; the Technology Layer not in it. A diagram's group
   * order lists groups too, but names no axis as its superordinate.
   */
  const ARRAYS = `${PREFIXES}
@prefix iso-thes: <http://purl.org/iso25964/skos-thes#> .
<${TAX}> a skos:ConceptScheme .
:ArchiMateElement a skos:Concept ; skos:prefLabel "ArchiMate Element"@en ; skos:topConceptOf <${TAX}> .
:Layer a skos:Concept ; skos:prefLabel "Layer"@en ; skos:broader :ArchiMateElement .
:Aspect a skos:Concept ; skos:prefLabel "Aspect"@en ; skos:broader :ArchiMateElement .
:LayerOrder a skos:OrderedCollection, iso-thes:ThesaurusArray ; iso-thes:superOrdinate :Layer ;
    skos:memberList ( :ApplicationLayer :BusinessLayer ) .
:BusinessLayer a skos:Concept ; skos:prefLabel "Business Layer"@en ; skos:broader :Layer ;
    skos:narrower am:BusinessActor, am:BusinessProcess .
:ApplicationLayer a skos:Concept ; skos:prefLabel "Application Layer"@en ; skos:broader :Layer ;
    skos:narrower am:ApplicationComponent .
:TechnologyLayer a skos:Concept ; skos:prefLabel "Technology Layer"@en ; skos:broader :Layer ;
    skos:narrower am:Node .
:ActiveStructure a skos:Concept ; skos:prefLabel "Active Structure"@en ; skos:broader :Aspect ;
    skos:narrower am:BusinessActor, am:ApplicationComponent, am:Node .
:Behavior a skos:Concept ; skos:prefLabel "Behavior"@en ; skos:broader :Aspect ;
    skos:narrower am:BusinessProcess .
:DiagramGroupOrder a skos:OrderedCollection ; skos:memberList ( :Behavior :BusinessLayer ) .
<https://example.org/mm#M> a arch:Metamodel ; arch:conceptClassification <${TAX}> ;
    arch:diagramGroupOrder :DiagramGroupOrder .
am:BusinessActor a owl:Class . am:BusinessProcess a owl:Class . am:ApplicationComponent a owl:Class . am:Node a owl:Class .
`;

  it('keeps each dimension a concept axis; neither the element concept above them nor a list is an axis', () => {
    const axes = buildClassificationAxes(storeFromTurtle(ARRAYS));
    expect(axes.map((a) => a.iri).sort()).toEqual([`${TAX}Aspect`, `${TAX}Layer`]);
    const layer = axes.find((a) => a.iri === `${TAX}Layer`)!;
    expect(layer.groups.get(`${ONTO}BusinessActor`)).toBe('Business Layer');
    expect(layer.groups.get(`${ONTO}Node`)).toBe('Technology Layer');
  });

  it("ranks an axis's members by their group's place in its array; a group it does not list, and an axis without one, rank none", () => {
    const store = storeFromTurtle(ARRAYS);
    const axes = buildClassificationAxes(store);
    const layer = axes.find((a) => a.iri === `${TAX}Layer`)!;
    expect(layer.ranks.get(`${ONTO}ApplicationComponent`)).toBe(0);
    expect(layer.ranks.get(`${ONTO}BusinessActor`)).toBe(1);
    expect(layer.ranks.has(`${ONTO}Node`)).toBe(false);
    expect(axes.find((a) => a.iri === `${TAX}Aspect`)!.ranks.size).toBe(0);
    const actor = buildClasses(store, axes).find((c) => c.iri === `${ONTO}BusinessActor`)!;
    expect(actor.ranksByAxis).toEqual({ [`${TAX}Layer`]: 1 });
  });

  it('takes no order from a list that names no superordinate — a diagram\'s group order', () => {
    const axes = buildClassificationAxes(storeFromTurtle(ARRAYS.replace('iso-thes:superOrdinate :Layer ;', '')));
    expect(axes.find((a) => a.iri === `${TAX}Layer`)!.ranks.size).toBe(0);
  });

  it('takes a concept the palette grouping names as an axis, where the shape alone finds one beneath it', () => {
    const NESTED = `${PREFIXES}
<${TAX}> a skos:ConceptScheme .
:Place a skos:Concept ; skos:prefLabel "Place"@en ; skos:topConceptOf <${TAX}> .
:Region a skos:Concept ; skos:prefLabel "Region"@en ; skos:broader :Place .
:Indoor a skos:Concept ; skos:prefLabel "Indoor"@en ; skos:broader :Region ; skos:narrower am:Facility .
:Outdoor a skos:Concept ; skos:prefLabel "Outdoor"@en ; skos:broader :Region ; skos:narrower am:Equipment .
<https://example.org/mm#M> a arch:Metamodel ; arch:conceptClassification <${TAX}> .
`;
    expect(buildClassificationAxes(storeFromTurtle(NESTED)).map((a) => a.label)).toEqual(['Region']);
    const named = buildClassificationAxes(storeFromTurtle(NESTED, GROUPING(':Place')), ['https://example.org/mm#M']);
    expect(named.map((a) => a.label)).toEqual(['Place']);
    expect(named[0]!.groups.get(`${ONTO}Facility`)).toBe('Indoor');
    expect(named[0]!.topGroups.get(`${ONTO}Facility`)).toBe('Region');
  });
});

describe('buildClassificationAxes (nested groups)', () => {
  const soleAxis = (...ttl: string[]): TaxonomyAxis => {
    const axes = buildClassificationAxes(storeFromTurtle(...ttl));
    expect(axes).toHaveLength(1);
    return axes[0]!;
  };

  it('attributes members sitting under a sub-group two levels down', () => {
    const axis = soleAxis(NESTED_TWO_LEVEL);
    expect(axis.iri).toBe(`${TAX}Aspect`);
    expect([...axis.groups.entries()].sort()).toEqual([
      [`${ONTO}ApplicationComponent`, 'Internal Active Structure'],
      [`${ONTO}BusinessActor`, 'Internal Active Structure'],
      [`${ONTO}Path`, 'Active Structure'],
    ]);
  });

  it('rolls nested members up to the axis-level group in topGroups', () => {
    const axis = soleAxis(NESTED_TWO_LEVEL);
    expect([...new Set(axis.topGroups.values())]).toEqual(['Active Structure']);
    expect(axis.topGroups.size).toBe(3);
  });

  it('attributes members three grouping levels below the axis', () => {
    const axis = soleAxis(NESTED_THREE_LEVEL);
    expect([...axis.groups.entries()].sort()).toEqual([
      [`${ONTO}BusinessActor`, 'Internal Active Structure'],
      [`${ONTO}Path`, 'Active Structure'],
      [`${ONTO}Resource`, 'Structure'],
    ]);
    // All three descend from the axis's single direct child group.
    expect([...new Set(axis.topGroups.values())]).toEqual(['Structure']);
  });

  it('handles a direct-member group and a nested-member sibling on the same axis', () => {
    const axis = soleAxis(NESTED_MIXED);
    expect(axis.iri).toBe(`${TAX}Aspect`);
    expect([...axis.groups.entries()].sort()).toEqual([
      [`${ONTO}BusinessActor`, 'Active Structure'],
      [`${ONTO}BusinessProcess`, 'Behavior'],
    ]);
    expect([...axis.topGroups.entries()].sort()).toEqual([
      [`${ONTO}BusinessActor`, 'Structure'],
      [`${ONTO}BusinessProcess`, 'Behavior'],
    ]);
  });

  it('does not report a nested sub-group as an axis of its own', () => {
    const axes = buildClassificationAxes(storeFromTurtle(NESTED_MIXED));
    const iris = axes.map((a) => a.iri);
    // :Structure holds no member itself and its only concept-child is a group — the shape that
    // would otherwise read as an axis. The axis above it must win.
    expect(iris).not.toContain(`${TAX}Structure`);
    expect(iris).not.toContain(`${TAX}ActiveStructure`);
    expect(iris).toEqual([`${TAX}Aspect`]);
  });

  it('does not report a nested sub-group that has direct members as an axis either', () => {
    const iris = buildClassificationAxes(storeFromTurtle(NESTED_THREE_LEVEL)).map((a) => a.iri);
    expect(iris).toEqual([`${TAX}Aspect`]);
  });

  it(
    'terminates on a skos:narrower cycle instead of hanging',
    () => {
      const axis = soleAxis(CYCLIC_TAX);
      expect(axis.iri).toBe(`${TAX}Axis`);
      expect([...axis.groups.entries()].sort()).toEqual([
        [`${ONTO}One`, 'Group A'],
        [`${ONTO}Two`, 'Group B'],
      ]);
      expect([...new Set(axis.topGroups.values())]).toEqual(['Group A']);
    },
    2000,
  );

  it(
    'terminates on a skos:broader cycle instead of hanging',
    () => {
      const axis = soleAxis(CYCLIC_BROADER_TAX);
      expect(axis.iri).toBe(`${TAX}Axis`);
      expect([...axis.groups.entries()].sort()).toEqual([
        [`${ONTO}One`, 'Group A'],
        [`${ONTO}Two`, 'Group B'],
      ]);
    },
    2000,
  );

  it(
    'terminates when buildClasses walks a cyclic taxonomy',
    () => {
      const store = storeFromTurtle(CYCLIC_TAX);
      const classes = buildClasses(store, buildClassificationAxes(store));
      expect(classes.map((c) => c.group).sort()).toEqual(['Group A', 'Group B']);
    },
    2000,
  );

  it('keeps the nested member out of "Other" when buildClasses resolves it', () => {
    const store = storeFromTurtle(NESTED_THREE_LEVEL);
    const axes = buildClassificationAxes(store);
    const classes = buildClasses(store, axes);
    expect(classes.map((c) => c.group).sort()).toEqual([
      'Active Structure',
      'Internal Active Structure',
      'Structure',
    ]);
    expect(classes.some((c) => c.group === 'Other')).toBe(false);
  });
});

describe('buildClasses (taxonomy-driven)', () => {
  it('produces one palette class per instantiable element across all axes', () => {
    const store = storeFromTurtle(AM32_TAX);
    const classes = buildClasses(store, buildClassificationAxes(store));
    const iris = classes.map((c) => c.iri).sort();
    expect(iris).toEqual([`${ONTO}ApplicationComponent`, `${ONTO}BusinessActor`, `${ONTO}BusinessProcess`]);
  });

  it('records the group for every axis in groupsByAxis and defaults to the first axis', () => {
    const store = storeFromTurtle(AM32_TAX, GROUPING(':Layer :Aspect'));
    const axes = buildClassificationAxes(store);
    const classes = buildClasses(store, axes);
    const actor = classes.find((c) => c.iri.endsWith('#BusinessActor'))!;
    const layerAxis = axes.find((a) => a.label === 'Layer')!;
    const aspectAxis = axes.find((a) => a.label === 'Aspect')!;
    expect(actor.groupsByAxis[layerAxis.iri]).toBe('Business Layer');
    expect(actor.groupsByAxis[aspectAxis.iri]).toBe('Active Structure');
    // default group follows the first axis — the palette grouping's first
    expect(actor.group).toBe('Business Layer');
  });

  it('excludes abstract classes flagged with arch:isAbstractClass', () => {
    const store = storeFromTurtle(
      AM32_TAX,
      `${PREFIXES}
      :BusinessLayer skos:narrower am:BusinessInternalActiveStructureElement .
      am:BusinessInternalActiveStructureElement a owl:Class ;
        arch:isAbstractClass true ; rdfs:label "Business Internal Active Structure"@en .
    `,
    );
    const classes = buildClasses(store, buildClassificationAxes(store));
    expect(classes.some((c) => c.iri.endsWith('#BusinessInternalActiveStructureElement'))).toBe(false);
  });

  it('records a group per axis when three axes classify the same class', () => {
    const store = storeFromTurtle(AM32_TAX, AM32_DOMAIN_AXIS, GROUPING(':Domain :Layer :Aspect'));
    const axes = buildClassificationAxes(store);
    const classes = buildClasses(store, axes);
    const actor = classes.find((c) => c.iri === `${ONTO}BusinessActor`)!;
    expect(Object.keys(actor.groupsByAxis)).toHaveLength(3);
    expect(actor.groupsByAxis[`${TAX}Domain`]).toBe('Business Domain');
    expect(actor.groupsByAxis[`${TAX}Layer`]).toBe('Business Layer');
    expect(actor.groupsByAxis[`${TAX}Aspect`]).toBe('Active Structure');
    // Domain comes first in the palette grouping, so it supplies the default group.
    expect(actor.group).toBe('Business Domain');
  });

  it('resolves a member to an OWL class by local name when no seeAlso link exists', () => {
    const store = storeFromTurtle(
      AM32_TAX,
      `${PREFIXES}
      :BusinessRole a skos:Concept ; skos:prefLabel "Business Role"@en ;
          skos:inScheme <${TAX}> ; skos:broader :BusinessLayer .
      am:BusinessRole a owl:Class ; rdfs:label "Business Role"@en .
    `,
    );
    const classes = buildClasses(store, buildClassificationAxes(store));
    const role = classes.find((c) => c.label === 'Business Role');
    expect(role).toBeDefined();
    // the taxonomy concept lives in tax#, the resolved class in onto#
    expect(role!.iri).toBe(`${ONTO}BusinessRole`);
    expect(role!.group).toBe('Business Layer');
  });

  it('excludes classes in the arch: core namespace', () => {
    const store = storeFromTurtle(
      AM32_TAX,
      `${PREFIXES}
      :BusinessLayer skos:narrower arch:Junction .
      arch:Junction a owl:Class ; rdfs:label "Junction"@en .
    `,
    );
    const classes = buildClasses(store, buildClassificationAxes(store));
    expect(classes.some((c) => c.iri === 'https://meta.linked.archi/core#Junction')).toBe(false);
  });

  it('excludes relationship classes reached through the subclass closure', () => {
    const store = storeFromTurtle(
      AM32_TAX,
      `${PREFIXES}
      :BusinessLayer skos:narrower am:BusinessServing .
      am:BusinessServing a owl:Class ; rdfs:subClassOf am:AbstractServing ; rdfs:label "Business Serving"@en .
      am:AbstractServing a owl:Class ; rdfs:subClassOf arch:QualifiedRelationship .
    `,
    );
    const classes = buildClasses(store, buildClassificationAxes(store));
    expect(classes.some((c) => c.iri.endsWith('#BusinessServing'))).toBe(false);
  });
});

describe('buildClasses (rdfs:seeAlso linking)', () => {
  it('resolves the OWL class through rdfs:seeAlso when the member is a SKOS concept', () => {
    const store = storeFromTurtle(AM4_TAX);
    const axes = buildClassificationAxes(store);
    const classes = buildClasses(store, axes);
    expect(classes).toHaveLength(1);
    expect(classes[0]!.iri).toBe(`${ONTO}BusinessActor`);
    expect(classes[0]!.group).toBe('Business Domain');
  });

  it('honours arch:isAbstractClass on the OWL class behind a seeAlso-linked member', () => {
    const store = storeFromTurtle(
      AM4_TAX,
      `${PREFIXES}
      :BusinessInterfaceConcept a skos:Concept ; skos:prefLabel "Business Interface"@en ;
          skos:inScheme <${TAX}> ; skos:broader :BusinessDomain ;
          rdfs:seeAlso am:BusinessInterface .
      am:BusinessInterface a owl:Class ; arch:isAbstractClass true ; rdfs:label "Business Interface"@en .
    `,
    );
    const classes = buildClasses(store, buildClassificationAxes(store));
    expect(classes.map((c) => c.iri)).toEqual([`${ONTO}BusinessActor`]);
  });
});

/**
 * A concept with nothing under it and no class behind it is an empty concept, not an element type:
 * the element types are the ontology's classes. A root over an "ArchiMate Element" that classifies
 * nothing, the relationship categories, and the connectors with the junctions; and a Layer axis.
 */
const EMPTY_CONCEPT = `${PREFIXES}
<${TAX}> a skos:ConceptScheme ; skos:hasTopConcept :ArchiMateConcept, :Layer .
:ArchiMateConcept a skos:Concept ; skos:prefLabel "ArchiMate Concept"@en ; skos:topConceptOf <${TAX}> .
:ArchiMateElement a skos:Concept ; skos:prefLabel "ArchiMate Element"@en ;
    skos:broader :ArchiMateConcept ; skos:inScheme <${TAX}> .
:ArchiMateRelationship a skos:Concept ; skos:prefLabel "ArchiMate Relationship"@en ;
    skos:broader :ArchiMateConcept ; skos:inScheme <${TAX}> .
:StructuralRelationship a skos:Concept ; skos:prefLabel "Structural Relationship"@en ;
    skos:broader :ArchiMateRelationship ; skos:inScheme <${TAX}> ; skos:narrower am:Composition .
:ArchiMateConnector a skos:Concept ; skos:prefLabel "ArchiMate Connector"@en ;
    skos:broader :ArchiMateConcept ; skos:inScheme <${TAX}> ; skos:narrower am:Junction_And .
:Layer a skos:Concept ; skos:prefLabel "Layer"@en ; skos:topConceptOf <${TAX}> .
:BusinessLayer a skos:Concept ; skos:prefLabel "Business Layer"@en ;
    skos:broader :Layer ; skos:inScheme <${TAX}> ; skos:narrower am:BusinessActor .
:Placeholder a skos:Concept ; skos:prefLabel "Placeholder"@en ;
    skos:broader :BusinessLayer ; skos:inScheme <${TAX}> .
am:BusinessActor a owl:Class ; rdfs:subClassOf arch:Element ; rdfs:label "Business Actor"@en .
am:Junction_And a owl:Class ; rdfs:subClassOf arch:Element ; rdfs:label "And Junction"@en .
am:Composition a owl:Class ; rdfs:subClassOf arch:QualifiedRelationship ; rdfs:label "Composition"@en .
`;

describe('buildClassificationAxes (a group under no axis: standalone)', () => {
  const STANDALONE = `${PREFIXES}
<${TAX}> a skos:ConceptScheme ; skos:hasTopConcept :Layer, :Junction .
:Layer a skos:Concept ; skos:prefLabel "Layer"@en ; skos:topConceptOf <${TAX}> .
:BusinessLayer a skos:Concept ; skos:prefLabel "Business Layer"@en ;
    skos:broader :Layer ; skos:inScheme <${TAX}> ; skos:narrower am:BusinessActor .
:Junction a skos:Concept ; skos:prefLabel "Junction"@en ; skos:topConceptOf <${TAX}> ;
    skos:narrower am:Junction_And .
:SpecialJunction a skos:Concept ; skos:prefLabel "Special Junction"@en ;
    skos:broader :Junction ; skos:inScheme <${TAX}> ; skos:narrower am:Junction_Or .
am:BusinessActor a owl:Class ; rdfs:subClassOf arch:Element ; rdfs:label "Business Actor"@en .
am:Junction_And a owl:Class ; rdfs:subClassOf arch:Element ; rdfs:label "And Junction"@en .
am:Junction_Or a owl:Class ; rdfs:subClassOf arch:Element ; rdfs:label "Or Junction"@en .
`;

  it('classifies the members of a top group under no axis, as a standalone axis after the others', () => {
    const store = storeFromTurtle(STANDALONE);
    const axes = buildClassificationAxes(store);
    expect(axes.map((a) => [a.label, a.standalone ?? false])).toEqual([
      ['Layer', false],
      ['Junction', true],
    ]);
    // A group nested in the standalone one is part of it, not a second standalone axis.
    const junction = axes[1]!;
    expect(Object.fromEntries(junction.groups)).toEqual({
      [`${ONTO}Junction_And`]: 'Junction',
      [`${ONTO}Junction_Or`]: 'Special Junction',
    });
    expect(buildClasses(store, axes).map((c) => c.label).sort()).toEqual(['And Junction', 'Business Actor', 'Or Junction']);
  });

  it('leaves a flat taxonomy, groups and no axis, to its one synthesised axis', () => {
    const flat = STANDALONE.replace('skos:hasTopConcept :Layer, :Junction', 'skos:hasTopConcept :Junction')
      .replace(':Layer a skos:Concept ; skos:prefLabel "Layer"@en ; skos:topConceptOf <' + TAX + '> .', '')
      .replace('skos:broader :Layer ; ', '');
    const axes = buildClassificationAxes(storeFromTurtle(flat));
    expect(axes).toHaveLength(1);
    expect(axes[0]!.standalone).toBeUndefined();
  });
});

describe('buildClassificationAxes (an empty concept is no element type)', () => {
  it('does not take a concept with nothing under it for an element type', () => {
    const store = storeFromTurtle(EMPTY_CONCEPT);
    const axes = buildClassificationAxes(store);
    const layer = axes.find((a) => a.iri === `${TAX}Layer`)!;
    expect([...layer.groups.keys()]).toEqual([`${ONTO}BusinessActor`]);
    expect(axes.some((a) => a.groups.has(`${TAX}Placeholder`) || a.groups.has(`${TAX}ArchiMateElement`))).toBe(false);
    expect(buildClasses(store, axes).map((c) => c.iri).sort()).toEqual([`${ONTO}BusinessActor`, `${ONTO}Junction_And`]);
  });

  it('keeps the parent of an empty concept an axis, so what its other children classify is found', () => {
    const axes = buildClassificationAxes(storeFromTurtle(EMPTY_CONCEPT));
    expect(axes.map((a) => a.iri).sort()).toEqual([`${TAX}ArchiMateConcept`, `${TAX}Layer`]);
    const concept = axes.find((a) => a.iri === `${TAX}ArchiMateConcept`)!;
    expect(concept.groups.get(`${ONTO}Junction_And`)).toBe('ArchiMate Connector');
  });

  it('still takes a terminal concept that stands for a class (rdfs:seeAlso) for that element type', () => {
    const store = storeFromTurtle(AM4_TAX);
    const domain = buildClassificationAxes(store).find((a) => a.iri === `${TAX}Domain`)!;
    expect([...domain.groups.keys()]).toEqual([`${TAX}BusinessActorConcept`]);
  });
});

describe('buildClasses (OWL-only fallback)', () => {
  const OWL_ONLY = `
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix arch: <https://meta.linked.archi/core#> .
@prefix am4:  <https://meta.linked.archi/archimate4/onto#> .

am4:BusinessDomainElement a owl:Class ; rdfs:subClassOf arch:Element .
am4:BusinessActor a owl:Class ; rdfs:subClassOf am4:BusinessDomainElement ; rdfs:label "Business Actor"@en .
am4:Serving a owl:Class ; rdfs:subClassOf arch:QualifiedRelationship, arch:Element ; rdfs:label "Serving"@en .
am4:Hidden a owl:Class ; rdfs:subClassOf arch:Element ; arch:isAbstractClass true .
am4:Unrelated a owl:Class ; rdfs:label "Unrelated"@en .
`;

  it('falls back to the OWL subclass hierarchy when no taxonomy is present', () => {
    const store = storeFromTurtle(OWL_ONLY);
    expect(buildClassificationAxes(store)).toEqual([]);
    const classes = buildClasses(store, []);
    expect(classes.map((c) => c.iri)).toEqual(['https://meta.linked.archi/archimate4/onto#BusinessActor']);
    expect(classes[0]!.group).toBe('Business');
    expect(classes[0]!.groupsByAxis).toEqual({});
    expect(classes[0]!.transitiveSuperClasses).toContain('https://meta.linked.archi/core#Element');
  });

  it('returns nothing for an empty store', () => {
    expect(buildClasses(new Store(), [])).toEqual([]);
  });

  it('lists an element class no scheme names under "Other", where a scheme names others', () => {
    // ArchiMate's taxonomy beside an ontology with no classification: its types are still ones to draw.
    const store = storeFromTurtle(AM4_TAX, `${PREFIXES}
@prefix ex:  <https://example.org/onto#> .
am:BusinessActor rdfs:subClassOf arch:Element .
ex:Risk a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Risk"@en .
ex:Kind a owl:Class ; rdfs:subClassOf arch:Element ; arch:isAbstractClass true .
ex:Causes a owl:Class ; rdfs:subClassOf arch:QualifiedRelationship .
`);
    const classes = buildClasses(store, buildClassificationAxes(store));
    const risk = classes.find((c) => c.iri === 'https://example.org/onto#Risk');
    expect(risk).toMatchObject({ group: 'Other', unclassified: true, groupsByAxis: {} });
    expect(classes.find((c) => c.iri === `${ONTO}BusinessActor`)).toMatchObject({ group: 'Business Domain' });
    expect(classes.find((c) => c.iri === `${ONTO}BusinessActor`)?.unclassified).toBeUndefined();
    // Neither an abstract class nor a relationship type is an element type to list.
    expect(classes.map((c) => c.iri).filter((iri) => iri.startsWith('https://example.org/'))).toEqual(['https://example.org/onto#Risk']);
  });

  it('reads a concept naming several classes with rdfs:seeAlso as their group, and its siblings written so with it', () => {
    // DoDAF's, UAF's and the ML extension's style: the viewpoint names the classes it groups.
    const store = storeFromTurtle(`${PREFIXES}
@prefix ex: <https://example.org/onto#> .
<https://example.org/tax#> a skos:ConceptScheme ; skos:hasTopConcept :ByViewpoint .
<https://example.org/metamodel#M> arch:conceptClassification <https://example.org/tax#> .
:ByViewpoint a skos:Concept ; skos:prefLabel "By Viewpoint"@en ; skos:inScheme <https://example.org/tax#> .
:CapabilityViewpoint a skos:Concept ; skos:broader :ByViewpoint ; skos:prefLabel "Capability Viewpoint"@en ;
    skos:inScheme <https://example.org/tax#> ; rdfs:seeAlso ex:Capability, ex:DesiredEffect .
:StandardsViewpoint a skos:Concept ; skos:broader :ByViewpoint ; skos:prefLabel "Standards Viewpoint"@en ;
    skos:inScheme <https://example.org/tax#> ; rdfs:seeAlso ex:Standard .
ex:Capability a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Capability"@en .
ex:DesiredEffect a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Desired Effect"@en .
ex:Standard a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Standard"@en .
`);
    const axes = buildClassificationAxes(store);
    expect(axes.map((a) => a.label)).toEqual(['By Viewpoint']);
    const classes = buildClasses(store, axes);
    expect(Object.fromEntries(classes.map((c) => [c.label, c.group]))).toEqual({
      Capability: 'Capability Viewpoint',
      'Desired Effect': 'Capability Viewpoint',
      Standard: 'Standards Viewpoint',
    });
    expect(classes.some((c) => c.unclassified)).toBe(false);
  });

  it('takes a class named like a relationship for an element type where its superclasses say it is one', () => {
    // EA on a Page's Realization is a phase of a process — an element type — not ArchiMate's relationship.
    const store = storeFromTurtle(`${PREFIXES}
@prefix ex: <https://example.org/onto#> .
<https://example.org/tax#> a skos:ConceptScheme ; skos:hasTopConcept :Kind .
:Kind a skos:Concept ; skos:prefLabel "Kind"@en ; skos:inScheme <https://example.org/tax#> .
:Phases a skos:Concept ; skos:broader :Kind ; skos:prefLabel "Phases"@en ; skos:inScheme <https://example.org/tax#> ;
    skos:narrower ex:Initiation, ex:Realization .
ex:Phase a owl:Class ; rdfs:subClassOf arch:Element ; arch:isAbstractClass true .
ex:Initiation a owl:Class ; rdfs:subClassOf ex:Phase ; skos:prefLabel "Initiation"@en .
ex:Realization a owl:Class ; rdfs:subClassOf ex:Phase ; skos:prefLabel "Realization"@en .
ex:Serving a owl:Class ; skos:prefLabel "Serving"@en .
ex:Flow a owl:Class ; rdfs:subClassOf arch:QualifiedRelationship ; skos:prefLabel "Flow"@en .
`);
    const classes = buildClasses(store, buildClassificationAxes(store));
    expect(classes.map((c) => c.label).sort()).toEqual(['Initiation', 'Realization']);
    // With no taxonomy: the same, by the walk over the classes.
    expect(buildClasses(store, []).map((c) => c.label).sort()).toEqual(['Initiation', 'Realization']);
  });

  it('walks the classes too when the only schemes classify none of them', async () => {
    // A metamodel with an ontology and no classification of its own: the one scheme in the store is core's question
    // stages, which classify no class. Its element types are still the palette's.
    const store = storeFromTurtle(
      await fetchAssetText('core/core-onto.ttl'),
      `${PREFIXES}
@prefix ex: <https://example.org/onto#> .
ex:Risk a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Risk"@en .
ex:Tradeoff a owl:Class ; rdfs:subClassOf ex:Risk ; skos:prefLabel "Tradeoff"@en .
`,
    );
    const axes = buildClassificationAxes(store);
    expect(axes.length).toBeGreaterThan(0);
    expect(buildClasses(store, axes).map((c) => c.label).sort()).toEqual(['Risk', 'Tradeoff']);
  });
});

// ---------------------------------------------------------------------------
// The real thing: the bundled ArchiMate 4.0 taxonomy, whose aspect axis nests
// three grouping levels deep (Structure → Active Structure → Internal Active
// Structure → members). Before transitive collection, 24 of its 42 members were
// unreachable and fell through to "Other".
// ---------------------------------------------------------------------------

const AM4_TAX_IRI = 'https://meta.linked.archi/archimate4/tax#';
const AM4_ONTO = 'https://meta.linked.archi/archimate4/onto#';
const SKOS_NARROWER = 'http://www.w3.org/2004/02/skos/core#narrower';
const SKOS_CONCEPT = 'http://www.w3.org/2004/02/skos/core#Concept';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/** Counts members per group label, for readable expectations. */
function countByGroup(groups: Map<string, string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of groups.values()) counts[label] = (counts[label] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('buildClassificationAxes (bundled ArchiMate 4.0 taxonomy)', () => {
  let store: Store;
  let axes: TaxonomyAxis[];
  /**
   * Every element class the taxonomy names — a skos:narrower leaf, not itself a concept, outside the
   * Relationship axis, whose leaves are the relationship classes, and outside Junction.
   */
  let publishedMembers: string[];
  /** The relationship classes the Relationship axis names. */
  let relationshipMembers: string[];
  /** The junction classes Junction names: a top concept of its own, in no domain or aspect. */
  let junctionMembers: string[];

  beforeAll(async () => {
    store = storeFromTurtle(
      await fetchAssetText('archimate4/archimate4-tax.ttl'),
      await fetchAssetText('archimate4/archimate4-metamodel.ttl'),
    );
    axes = buildClassificationAxes(store, ['https://meta.linked.archi/archimate4/metamodel#ArchiMate4']);

    const members = new Set<string>();
    for (const quad of store.getQuads(null, SKOS_NARROWER, null, null)) {
      if (quad.object.termType !== 'NamedNode') continue;
      const isConcept = store.getQuads(quad.object, RDF_TYPE, SKOS_CONCEPT, null).length > 0;
      if (!isConcept) members.add(quad.object.value);
    }
    const relationships = axes.find((a) => a.iri === `${AM4_TAX_IRI}Relationship`)!;
    const junctions = axes.find((a) => a.iri === `${AM4_TAX_IRI}Junction`)!;
    relationshipMembers = [...members].filter((iri) => relationships.groups.has(iri)).sort();
    junctionMembers = [...members].filter((iri) => junctions.groups.has(iri)).sort();
    publishedMembers = [...members].filter((iri) => !relationships.groups.has(iri) && !junctions.groups.has(iri)).sort();
  });

  it('names 42 element classes across its two element axes, the 11 relationship types by category, and the 2 junctions', () => {
    expect(junctionMembers.map((iri) => iri.slice(AM4_ONTO.length))).toEqual(['AndJunction', 'OrJunction']);
    expect(publishedMembers).toHaveLength(42);
    expect(publishedMembers.every((iri) => iri.startsWith(AM4_ONTO))).toBe(true);
    expect(relationshipMembers.map((iri) => iri.slice(AM4_ONTO.length))).toEqual([
      'Access', 'Aggregation', 'Assignment', 'Association', 'Composition',
      'Flow', 'Influence', 'Realization', 'Serving', 'Specialization', 'Triggering',
    ]);
  });

  it("discovers the published axes, the palette grouping's first: domain, then aspect", () => {
    // Relationship is an axis of the taxonomy, after the two the palette grouping names; the palette
    // does not offer it, since it groups no element type (palette-generator.test.ts). Junction, a group
    // under no axis, comes last, standalone: it classifies the junctions but is no way of grouping.
    expect(axes.map((a) => a.label)).toEqual(['Domain', 'Aspect', 'Relationship', 'Junction']);
    expect(axes.map((a) => a.iri)).toEqual([
      `${AM4_TAX_IRI}Domain`,
      `${AM4_TAX_IRI}Aspect`,
      `${AM4_TAX_IRI}Relationship`,
      `${AM4_TAX_IRI}Junction`,
    ]);
    expect(axes.map((a) => a.standalone ?? false)).toEqual([false, false, false, true]);
  });

  it("ranks the domains by the taxonomy's thesaurus array (am4tax:DomainOrder), not by the diagram's group order", () => {
    const domain = axes[0]!;
    expect(domain.ranks.get(`${AM4_ONTO}Process`)).toBe(0);
    expect(domain.ranks.get(`${AM4_ONTO}BusinessActor`)).toBe(1);
    expect(domain.ranks.get(`${AM4_ONTO}Goal`)).toBe(5);
    expect(axes.map((a) => a.iri)).not.toContain(`${AM4_TAX_IRI}PaletteGrouping`);
    expect(axes.map((a) => a.iri)).not.toContain(`${AM4_TAX_IRI}DiagramGroupOrder`);
  });

  it("orders a category's relationship types by the array under it, strongest first", () => {
    const relationship = axes.find((a) => a.iri === `${AM4_TAX_IRI}Relationship`)!;
    expect(relationship.ranks.get(`${AM4_ONTO}Triggering`)).toBe(2);
    expect(['Composition', 'Aggregation', 'Assignment', 'Realization', 'Serving', 'Association', 'Triggering', 'Flow', 'Specialization'].map((t) =>
      relationship.memberRanks?.get(`${AM4_ONTO}${t}`),
    )).toEqual([0, 1, 2, 3, 0, 3, 0, 1, undefined]);
  });

  it('does not report the nested aspect sub-groups as axes', () => {
    const iris = axes.map((a) => a.iri);
    for (const nested of [
      'StructureAspect',
      'ActiveStructureAspect',
      'InternalActiveStructure',
      'ExternalActiveStructure',
      'PassiveStructureAspect',
      'BehaviorAspect',
      'InternalBehavior',
      'ExternalBehavior',
      'EventAspect',
    ]) {
      expect(iris).not.toContain(`${AM4_TAX_IRI}${nested}`);
    }
  });

  it('leaves ZERO members unattributed on the Aspect axis', () => {
    const aspect = axes.find((a) => a.label === 'Aspect')!;
    const unattributed = publishedMembers.filter((iri) => !aspect.groups.has(iri));
    expect(unattributed).toEqual([]);
    expect(aspect.groups.size).toBe(42);
    expect(aspect.topGroups.size).toBe(42);
  });

  it('groups the Aspect axis by the nearest sub-group that lists each member', () => {
    const aspect = axes.find((a) => a.label === 'Aspect')!;
    expect(countByGroup(aspect.groups)).toEqual({
      'Active Structure': 3,
      Behavior: 4,
      Composite: 4,
      Event: 1,
      'External Active Structure': 3,
      'External Behavior': 1,
      'Internal Active Structure': 9,
      'Internal Behavior': 2,
      Motivation: 9,
      'Passive Structure': 5,
      Structure: 1,
    });
  });

  it('rolls the Aspect axis up to its four top-level groups', () => {
    const aspect = axes.find((a) => a.label === 'Aspect')!;
    expect(countByGroup(aspect.topGroups)).toEqual({
      Behavior: 8,
      Composite: 4,
      Motivation: 9,
      Structure: 21,
    });
  });

  it('leaves the flat Domain axis exactly as before', () => {
    const domain = axes.find((a) => a.label === 'Domain')!;
    expect(publishedMembers.filter((iri) => !domain.groups.has(iri))).toEqual([]);
    expect(countByGroup(domain.groups)).toEqual({
      'Application Domain': 3,
      'Business Domain': 4,
      'Common Domain': 9,
      'Implementation and Migration Domain': 3,
      'Motivation Domain': 9,
      'Strategy Domain': 4,
      'Technology Domain': 10,
    });
    // Flat axis: every group is its own top-level group.
    expect([...domain.topGroups.entries()].sort()).toEqual([...domain.groups.entries()].sort());
  });

  it('resolves an aspect group for every palette class', async () => {
    const withOntology = storeFromTurtle(
      await fetchAssetText('archimate4/archimate4-tax.ttl'),
      await fetchAssetText('archimate4/archimate4-onto.ttl'),
    );
    const loadedAxes = buildClassificationAxes(withOntology);
    const aspectIri = `${AM4_TAX_IRI}Aspect`;
    const classes = buildClasses(withOntology, loadedAxes);

    expect(classes).toHaveLength(44);
    // The junctions are in no aspect: they are classified by Junction, a top concept of their own.
    expect(classes.filter((c) => c.groupsByAxis[aspectIri] === undefined).map((c) => c.label).sort()).toEqual([
      'And Junction',
      'Or Junction',
    ]);
    expect(classes.some((c) => c.group === 'Other')).toBe(false);
  });
});
