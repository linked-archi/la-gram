/**
 * Closure-aware relationship resolution.
 *
 * The point of these tests is the *closure*: metamodels declare
 * `arch:domainIncludes` against abstract superclasses, so any exact-IRI match
 * answers "no relationship is possible" for every concrete type in the language.
 *
 * The final block used to cover `withPaletteFallback`, a wrapper that answered
 * from the palette whenever `OxigraphRelationshipManager` came back empty —
 * which, before the manager scoped its queries, was always. The manager now
 * spans the named graphs itself, so those cases are asserted against the real
 * manager instead: same questions, no wrapper, and a failure here is a genuine
 * regression rather than a silently-absorbed one.
 */

import { describe, it, expect } from 'vitest';
import { DataFactory, Store } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import {
  buildClassClosure,
  hasOutgoingRelationshipTypes,
  identityClosure,
  type ClosureSource,
} from '../relationship-resolution.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { OxigraphRelationshipManager } from '../../../model-manager/relationship-manager.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';

const { namedNode, quad } = DataFactory;

const MM = 'https://example.org/mm#';
const ACTIVE_STRUCTURE = `${MM}ActiveStructureElement`;
const BUSINESS_ACTOR = `${MM}BusinessActor`;
const BUSINESS_ROLE = `${MM}BusinessRole`;
const DATA_OBJECT = `${MM}DataObject`;
const PASSIVE_STRUCTURE = `${MM}PassiveStructureElement`;
const SERVING = `${MM}Serving`;
const ACCESS = `${MM}Access`;
const ASSOCIATION = `${MM}Association`;

/**
 * A store whose class hierarchy lives in a *named* graph, exactly as
 * `N3MetamodelLoader` loads it. Reading with a null graph has to span it.
 */
function hierarchyStore(): ClosureSource {
  const store = new Store();
  const graph = namedNode('urn:test:metamodel');
  const sub = namedNode(NAMESPACES.rdfs + 'subClassOf');
  store.addQuads([
    quad(namedNode(BUSINESS_ACTOR), sub, namedNode(`${MM}BusinessInternalActiveStructure`), graph),
    quad(
      namedNode(`${MM}BusinessInternalActiveStructure`),
      sub,
      namedNode(ACTIVE_STRUCTURE),
      graph,
    ),
    quad(namedNode(BUSINESS_ROLE), sub, namedNode(ACTIVE_STRUCTURE), graph),
    quad(namedNode(DATA_OBJECT), sub, namedNode(PASSIVE_STRUCTURE), graph),
  ]);
  return {
    getQuads: (s, p, o, g) =>
      store.getQuads(
        (s ?? null) as never,
        (p ?? null) as never,
        (o ?? null) as never,
        (g ?? null) as never,
      ) as unknown as Quad[],
  };
}

/** Domains and ranges declared only against abstract superclasses. */
function abstractDomainPalette(): PaletteDefinition {
  return {
    elementGroups: [],
    relationshipTypes: [
      {
        iri: SERVING,
        label: 'Serving',
        domainTypes: [ACTIVE_STRUCTURE],
        rangeTypes: [ACTIVE_STRUCTURE],
      },
      {
        iri: ACCESS,
        label: 'Access',
        domainTypes: [ACTIVE_STRUCTURE],
        rangeTypes: [PASSIVE_STRUCTURE],
      },
      {
        iri: ASSOCIATION,
        label: 'Association',
        domainTypes: [],
        rangeTypes: [],
      },
    ],
  };
}

describe('buildClassClosure', () => {
  it('includes the type itself and every transitive superclass', () => {
    const closure = buildClassClosure(hierarchyStore());

    expect(closure(BUSINESS_ACTOR).sort()).toEqual(
      [BUSINESS_ACTOR, `${MM}BusinessInternalActiveStructure`, ACTIVE_STRUCTURE].sort(),
    );
  });

  it('spans named graphs, which is where the metamodel is loaded', () => {
    // The hierarchy fixture puts every triple in urn:test:metamodel; a
    // default-graph-only read would produce a bare closure.
    const closure = buildClassClosure(hierarchyStore());
    expect(closure(BUSINESS_ACTOR)).toContain(ACTIVE_STRUCTURE);
  });

  it('returns the bare type when the store knows no hierarchy for it', () => {
    const closure = buildClassClosure(hierarchyStore());
    expect(closure(`${MM}Unknown`)).toEqual([`${MM}Unknown`]);
  });
});

describe('hasOutgoingRelationshipTypes', () => {
  it('is true for a concrete type whose domain is an abstract superclass', () => {
    const closure = buildClassClosure(hierarchyStore());
    const palette: PaletteDefinition = {
      elementGroups: [],
      // Only Serving, so there is no unconstrained type to make this pass by
      // accident.
      relationshipTypes: [abstractDomainPalette().relationshipTypes[0]],
    };

    expect(hasOutgoingRelationshipTypes(palette, closure, BUSINESS_ACTOR)).toBe(true);
    // This is the exact case the old exact-IRI check got wrong.
    expect(palette.relationshipTypes.some((r) => r.domainTypes.includes(BUSINESS_ACTOR))).toBe(
      false,
    );
  });

  it('is false when no relationship type admits the type as a source', () => {
    const closure = buildClassClosure(hierarchyStore());
    const palette: PaletteDefinition = {
      elementGroups: [],
      relationshipTypes: [abstractDomainPalette().relationshipTypes[0]],
    };

    expect(hasOutgoingRelationshipTypes(palette, closure, DATA_OBJECT)).toBe(false);
  });

  it('treats an unconstrained relationship type as permissive', () => {
    const palette: PaletteDefinition = {
      elementGroups: [],
      relationshipTypes: [abstractDomainPalette().relationshipTypes[2]],
    };

    expect(hasOutgoingRelationshipTypes(palette, identityClosure, DATA_OBJECT)).toBe(true);
  });
});

/**
 * The questions the retired `withPaletteFallback` wrapper used to answer,
 * asked of `OxigraphRelationshipManager` directly.
 *
 * The metamodel goes into a **named graph**, exactly as `N3MetamodelLoader`
 * loads it — that placement is the whole reason these cases used to need a
 * wrapper, so a fixture in the default graph would prove nothing.
 */
describe('OxigraphRelationshipManager over a named-graph metamodel', () => {
  const METAMODEL_GRAPH = 'urn:test:metamodel';

  /**
   * The `abstractDomainPalette` fixture expressed as RDF: Serving and Access
   * constrained against abstract superclasses, Association unconstrained.
   */
  function metamodelQuads(graphIri: string | null, include: string[]): Quad[] {
    const graph = graphIri === null ? undefined : namedNode(graphIri);
    const t = (s: string, p: string, o: string): Quad =>
      quad(namedNode(s), namedNode(p), namedNode(o), graph) as unknown as Quad;
    const lit = (s: string, p: string, value: string): Quad =>
      quad(namedNode(s), namedNode(p), DataFactory.literal(value), graph) as unknown as Quad;

    const RDFS_SUB = NAMESPACES.rdfs + 'subClassOf';
    const QUALIFIED = NAMESPACES.arch + 'QualifiedRelationship';
    const DOMAIN = NAMESPACES.arch + 'domainIncludes';
    const RANGE = NAMESPACES.arch + 'rangeIncludes';
    const LABEL = NAMESPACES.skos + 'prefLabel';

    const quads: Quad[] = [
      // Element hierarchy — the closure the constraints are reached through.
      t(BUSINESS_ACTOR, RDFS_SUB, `${MM}BusinessInternalActiveStructure`),
      t(`${MM}BusinessInternalActiveStructure`, RDFS_SUB, ACTIVE_STRUCTURE),
      t(BUSINESS_ROLE, RDFS_SUB, ACTIVE_STRUCTURE),
      t(DATA_OBJECT, RDFS_SUB, PASSIVE_STRUCTURE),
    ];

    if (include.includes('Serving')) {
      quads.push(
        t(SERVING, RDFS_SUB, QUALIFIED),
        lit(SERVING, LABEL, 'Serving'),
        t(SERVING, DOMAIN, ACTIVE_STRUCTURE),
        t(SERVING, RANGE, ACTIVE_STRUCTURE),
      );
    }
    if (include.includes('Access')) {
      quads.push(
        t(ACCESS, RDFS_SUB, QUALIFIED),
        lit(ACCESS, LABEL, 'Access'),
        t(ACCESS, DOMAIN, ACTIVE_STRUCTURE),
        t(ACCESS, RANGE, PASSIVE_STRUCTURE),
      );
    }
    if (include.includes('Association')) {
      quads.push(t(ASSOCIATION, RDFS_SUB, QUALIFIED), lit(ASSOCIATION, LABEL, 'Association'));
    }
    return quads;
  }

  function managerOver(
    include = ['Serving', 'Access', 'Association'],
    graphs: Array<string | null> = [METAMODEL_GRAPH],
  ): { manager: OxigraphRelationshipManager; store: OxigraphRdfStore } {
    const store = new OxigraphRdfStore();
    for (const graph of graphs) store.addQuads(metamodelQuads(graph, include));
    return { manager: new OxigraphRelationshipManager(store), store };
  }

  it('reads a metamodel that lives entirely in a named graph', () => {
    const { store } = managerOver();

    // The premise: nothing at all in the default graph.
    expect(store.getQuads().length).toBeGreaterThan(0);
    expect(
      store.getQuads(null, null, null, DataFactory.defaultGraph() as unknown as NamedNode),
    ).toHaveLength(0);
  });

  it('matches domain and range through the superclass closure', () => {
    const { manager } = managerOver();

    expect(
      manager.getValidRelationships(BUSINESS_ACTOR, BUSINESS_ROLE).map((c) => c.label),
    ).toEqual(['Serving', 'Association']);
  });

  it('excludes a type whose range the target does not satisfy', () => {
    const { manager } = managerOver();

    expect(manager.getValidRelationships(BUSINESS_ACTOR, DATA_OBJECT).map((c) => c.label)).toEqual([
      'Access',
      'Association',
    ]);
  });

  it('ranks Association below a semantically specific type', () => {
    const { manager } = managerOver();
    const [first, second] = manager.getValidRelationships(BUSINESS_ACTOR, BUSINESS_ROLE);

    expect(first.score!).toBeGreaterThan(second.score!);
    expect(second.label).toBe('Association');
  });

  it('carries a reason naming the matched constraints', () => {
    const { manager } = managerOver();
    const [serving] = manager.getValidRelationships(BUSINESS_ACTOR, BUSINESS_ROLE);

    expect(serving.reason).toContain('Business Actor');
    expect(serving.reason).toContain('Active Structure Element');
  });

  it('still reports zero candidates for a pair the metamodel forbids', () => {
    // Access alone: it wants a passive target, and DataObject cannot be the source.
    const { manager } = managerOver(['Access']);

    expect(manager.getValidRelationships(DATA_OBJECT, DATA_OBJECT)).toEqual([]);
  });

  it('does not duplicate a candidate whose triples sit in both the default and a named graph', () => {
    // The scope runs each query twice — once bare, once with the named graphs
    // merged in — so overlapping triples produce duplicate *rows*. Those must
    // collapse back into one candidate per relationship type.
    const overlapping = managerOver(['Serving', 'Access', 'Association'], [METAMODEL_GRAPH, null]);
    const namedOnly = managerOver();

    const labels = overlapping.manager
      .getValidRelationships(BUSINESS_ACTOR, BUSINESS_ROLE)
      .map((c) => c.label);

    expect(labels).toEqual(['Serving', 'Association']);
    expect(labels).toEqual(
      namedOnly.manager.getValidRelationships(BUSINESS_ACTOR, BUSINESS_ROLE).map((c) => c.label),
    );
    // Constraints must not be doubled up either.
    const [serving] = overlapping.manager.getValidRelationships(BUSINESS_ACTOR, BUSINESS_ROLE);
    expect(serving.domainTypes).toEqual([ACTIVE_STRUCTURE]);
    expect(serving.rangeTypes).toEqual([ACTIVE_STRUCTURE]);
  });

  it('resolves the relationship class for a qualified write across graph boundaries', () => {
    // findRelationshipClass reads arch:unqualifiedForm, which is metamodel
    // content in a named graph, while the write itself lands in the default one.
    const { manager, store } = managerOver();
    const serves = `${MM}serves`;
    store.addQuads([
      quad(
        namedNode(SERVING),
        namedNode(NAMESPACES.arch + 'unqualifiedForm'),
        namedNode(serves),
        namedNode(METAMODEL_GRAPH),
      ) as unknown as Quad,
    ]);

    const qr = manager.createRelationship(serves, 'https://example.org/a', 'https://example.org/b', true);

    expect(qr).not.toBeNull();
    const types = store.getQuads(qr!, namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode);
    expect(types.map((q) => q.object.value)).toContain(SERVING);
  });
});
