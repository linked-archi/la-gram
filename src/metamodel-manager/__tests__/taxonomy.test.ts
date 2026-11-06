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
:ElementByLayer a skos:Concept ; skos:prefLabel "Element by Layer"@en ;
    skos:broader :ArchiMateElement ; skos:inScheme <${TAX}> .
:BusinessLayer a skos:Concept ; skos:prefLabel "Business Layer"@en ;
    skos:broader :ElementByLayer ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor, am:BusinessProcess .
:ApplicationLayer a skos:Concept ; skos:prefLabel "Application Layer"@en ;
    skos:broader :ElementByLayer ; skos:inScheme <${TAX}> ;
    skos:narrower am:ApplicationComponent .

# --- Axis 2: by Aspect ---
:ElementByAspect a skos:Concept ; skos:prefLabel "Element by Aspect"@en ;
    skos:broader :ArchiMateElement ; skos:inScheme <${TAX}> .
:ActiveStructure a skos:Concept ; skos:prefLabel "Active Structure"@en ;
    skos:broader :ElementByAspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor, am:ApplicationComponent .
:Behavior a skos:Concept ; skos:prefLabel "Behavior"@en ;
    skos:broader :ElementByAspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessProcess .

# --- OWL classes (instantiable elements) ---
am:BusinessActor a owl:Class ; rdfs:label "Business Actor"@en .
am:BusinessProcess a owl:Class ; rdfs:label "Business Process"@en .
am:ApplicationComponent a owl:Class ; rdfs:label "Application Component"@en .
`;

/** A third, structural axis layered on top of {@link AM32_TAX}. */
const AM32_DOMAIN_AXIS = `${PREFIXES}
:ElementByDomain a skos:Concept ; skos:prefLabel "Element by Domain"@en ;
    skos:broader :ArchiMateElement ; skos:inScheme <${TAX}> .
:BusinessDomain a skos:Concept ; skos:prefLabel "Business Domain"@en ;
    skos:broader :ElementByDomain ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessActor, am:BusinessProcess .
:ApplicationDomain a skos:Concept ; skos:prefLabel "Application Domain"@en ;
    skos:broader :ElementByDomain ; skos:inScheme <${TAX}> ;
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
:ElementByDomain a skos:Concept ; skos:prefLabel "Element by Domain"@en ;
    skos:broader :Concept ; skos:inScheme <${TAX}> .
:BusinessDomain a skos:Concept ; skos:prefLabel "Business Domain"@en ;
    skos:broader :ElementByDomain ; skos:inScheme <${TAX}> ;
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
:ElementByAspect a skos:Concept ; skos:prefLabel "Element by Aspect"@en ;
    skos:inScheme <${TAX}> .
:ActiveStructure a skos:Concept ; skos:prefLabel "Active Structure"@en ;
    skos:broader :ElementByAspect ; skos:inScheme <${TAX}> ;
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
:ElementByAspect a skos:Concept ; skos:prefLabel "Element by Aspect"@en ;
    skos:inScheme <${TAX}> .
:Structure a skos:Concept ; skos:prefLabel "Structure"@en ;
    skos:broader :ElementByAspect ; skos:inScheme <${TAX}> ;
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
:ElementByAspect a skos:Concept ; skos:prefLabel "Element by Aspect"@en ;
    skos:inScheme <${TAX}> .
:Behavior a skos:Concept ; skos:prefLabel "Behavior"@en ;
    skos:broader :ElementByAspect ; skos:inScheme <${TAX}> ;
    skos:narrower am:BusinessProcess .
:Structure a skos:Concept ; skos:prefLabel "Structure"@en ;
    skos:broader :ElementByAspect ; skos:inScheme <${TAX}> .
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
    expect(labels).toContain('Element by Layer');
    expect(labels).toContain('Element by Aspect');
    expect(axes).toHaveLength(2);
  });

  it('orders structural axes (Layer/Domain) before the Aspect axis so Layer is the default', () => {
    const axes = buildClassificationAxes(storeFromTurtle(AM32_TAX));
    expect(axes[0]!.label).toBe('Element by Layer');
    expect(axes[axes.length - 1]!.label).toBe('Element by Aspect');
  });

  it('groups the same element differently under each axis (dual classification)', () => {
    const axes = buildClassificationAxes(storeFromTurtle(AM32_TAX));
    const byLayer = axes.find((a) => a.label === 'Element by Layer')!;
    const byAspect = axes.find((a) => a.label === 'Element by Aspect')!;
    const actor = `${ONTO}BusinessActor`;
    expect(byLayer.groups.get(actor)).toBe('Business Layer');
    expect(byAspect.groups.get(actor)).toBe('Active Structure');
  });

  it('returns no axes when the store has no classification scheme', () => {
    const axes = buildClassificationAxes(storeFromTurtle(`${PREFIXES} am:Foo a owl:Class .`));
    expect(axes).toEqual([]);
  });

  it('discovers three axes and keeps the Aspect axis last', () => {
    const axes = buildClassificationAxes(storeFromTurtle(AM32_TAX, AM32_DOMAIN_AXIS));
    expect(axes.map((a) => a.label)).toEqual(['Element by Domain', 'Element by Layer', 'Element by Aspect']);
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

describe('buildClassificationAxes (nested groups)', () => {
  const soleAxis = (...ttl: string[]): TaxonomyAxis => {
    const axes = buildClassificationAxes(storeFromTurtle(...ttl));
    expect(axes).toHaveLength(1);
    return axes[0]!;
  };

  it('attributes members sitting under a sub-group two levels down', () => {
    const axis = soleAxis(NESTED_TWO_LEVEL);
    expect(axis.iri).toBe(`${TAX}ElementByAspect`);
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
    expect(axis.iri).toBe(`${TAX}ElementByAspect`);
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
    expect(iris).toEqual([`${TAX}ElementByAspect`]);
  });

  it('does not report a nested sub-group that has direct members as an axis either', () => {
    const iris = buildClassificationAxes(storeFromTurtle(NESTED_THREE_LEVEL)).map((a) => a.iri);
    expect(iris).toEqual([`${TAX}ElementByAspect`]);
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
    const store = storeFromTurtle(AM32_TAX);
    const axes = buildClassificationAxes(store);
    const classes = buildClasses(store, axes);
    const actor = classes.find((c) => c.iri.endsWith('#BusinessActor'))!;
    const layerAxis = axes.find((a) => a.label === 'Element by Layer')!;
    const aspectAxis = axes.find((a) => a.label === 'Element by Aspect')!;
    expect(actor.groupsByAxis[layerAxis.iri]).toBe('Business Layer');
    expect(actor.groupsByAxis[aspectAxis.iri]).toBe('Active Structure');
    // default group follows the first (structural) axis
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
    const store = storeFromTurtle(AM32_TAX, AM32_DOMAIN_AXIS);
    const axes = buildClassificationAxes(store);
    const classes = buildClasses(store, axes);
    const actor = classes.find((c) => c.iri === `${ONTO}BusinessActor`)!;
    expect(Object.keys(actor.groupsByAxis)).toHaveLength(3);
    expect(actor.groupsByAxis[`${TAX}ElementByDomain`]).toBe('Business Domain');
    expect(actor.groupsByAxis[`${TAX}ElementByLayer`]).toBe('Business Layer');
    expect(actor.groupsByAxis[`${TAX}ElementByAspect`]).toBe('Active Structure');
    // Domain sorts first among the structural axes, so it supplies the default group.
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
   * Relationship by Category scheme, whose leaves are the relationship classes.
   */
  let publishedMembers: string[];
  /** The relationship classes the Relationship by Category scheme names. */
  let relationshipMembers: string[];

  beforeAll(async () => {
    store = storeFromTurtle(await fetchAssetText('archimate4/archimate4-tax.ttl'));
    axes = buildClassificationAxes(store);

    const members = new Set<string>();
    for (const quad of store.getQuads(null, SKOS_NARROWER, null, null)) {
      if (quad.object.termType !== 'NamedNode') continue;
      const isConcept = store.getQuads(quad.object, RDF_TYPE, SKOS_CONCEPT, null).length > 0;
      if (!isConcept) members.add(quad.object.value);
    }
    const relationships = axes.find((a) => a.iri === `${AM4_TAX_IRI}RelationshipByCategory`)!;
    relationshipMembers = [...members].filter((iri) => relationships.groups.has(iri)).sort();
    publishedMembers = [...members].filter((iri) => !relationships.groups.has(iri)).sort();
  });

  it('names 42 element classes across its two element axes, and the 11 relationship types by category', () => {
    expect(publishedMembers).toHaveLength(42);
    expect(publishedMembers.every((iri) => iri.startsWith(AM4_ONTO))).toBe(true);
    expect(relationshipMembers.map((iri) => iri.slice(AM4_ONTO.length))).toEqual([
      'Access', 'Aggregation', 'Assignment', 'Association', 'Composition',
      'Flow', 'Influence', 'Realization', 'Serving', 'Specialization', 'Triggering',
    ]);
  });

  it('discovers the published axes and keeps Aspect last', () => {
    // Relationship by Category is an axis of the taxonomy; the palette does not offer it, since it groups
    // no element type (palette-generator.test.ts).
    expect(axes.map((a) => a.label)).toEqual(['Element by Domain', 'Relationship by Category', 'Element by Aspect']);
    expect(axes.map((a) => a.iri)).toEqual([
      `${AM4_TAX_IRI}ElementByDomain`,
      `${AM4_TAX_IRI}RelationshipByCategory`,
      `${AM4_TAX_IRI}ElementByAspect`,
    ]);
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
    const aspect = axes.find((a) => a.label === 'Element by Aspect')!;
    const unattributed = publishedMembers.filter((iri) => !aspect.groups.has(iri));
    expect(unattributed).toEqual([]);
    expect(aspect.groups.size).toBe(42);
    expect(aspect.topGroups.size).toBe(42);
  });

  it('groups the Aspect axis by the nearest sub-group that lists each member', () => {
    const aspect = axes.find((a) => a.label === 'Element by Aspect')!;
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
    const aspect = axes.find((a) => a.label === 'Element by Aspect')!;
    expect(countByGroup(aspect.topGroups)).toEqual({
      Behavior: 8,
      Composite: 4,
      Motivation: 9,
      Structure: 21,
    });
  });

  it('leaves the flat Domain axis exactly as before', () => {
    const domain = axes.find((a) => a.label === 'Element by Domain')!;
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
    const aspectIri = `${AM4_TAX_IRI}ElementByAspect`;
    const classes = buildClasses(withOntology, loadedAxes);

    expect(classes).toHaveLength(42);
    expect(classes.filter((c) => c.groupsByAxis[aspectIri] === undefined)).toEqual([]);
    expect(classes.some((c) => c.group === 'Other')).toBe(false);
  });
});
