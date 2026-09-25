import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { OxigraphRelationshipManager, resetQrCounter } from '../relationship-manager.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = NAMESPACES.rdf + 'type';
const RDFS_SUBCLASS_OF = NAMESPACES.rdfs + 'subClassOf';
const ARCH = NAMESPACES.arch;
const SKOS = NAMESPACES.skos;
const OWL_CLASS = NAMESPACES.owl + 'Class';

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

/**
 * Helper: seed the store with a relationship type definition including domain/range.
 *
 * Uses the pattern the published ontologies actually use: an `owl:Class`
 * subclassing `arch:QualifiedRelationship`. (An earlier version of this helper
 * typed relationship types as `arch:Relationship`, a class that has since been
 * removed from the core ontology.)
 */
function addRelationshipType(
  store: OxigraphRdfStore,
  iri: string,
  label: string,
  domains: string[],
  ranges: string[],
): void {
  const quads: Quad[] = [
    quad(nn(iri) as any, nn(RDF_TYPE) as any, nn(OWL_CLASS) as any) as unknown as Quad,
    quad(
      nn(iri) as any,
      nn(RDFS_SUBCLASS_OF) as any,
      nn(ARCH + 'QualifiedRelationship') as any,
    ) as unknown as Quad,
    quad(nn(iri) as any, nn(SKOS + 'prefLabel') as any, literal(label) as any) as unknown as Quad,
  ];
  for (const d of domains) {
    quads.push(
      quad(nn(iri) as any, nn(ARCH + 'domainIncludes') as any, nn(d) as any) as unknown as Quad,
    );
  }
  for (const r of ranges) {
    quads.push(
      quad(nn(iri) as any, nn(ARCH + 'rangeIncludes') as any, nn(r) as any) as unknown as Quad,
    );
  }
  store.addQuads(quads);
}

/** Helper: declare `sub rdfs:subClassOf super` so closure matching can walk it. */
function addSubClassOf(store: OxigraphRdfStore, sub: string, superClass: string): void {
  store.addQuads([
    quad(nn(sub) as any, nn(RDFS_SUBCLASS_OF) as any, nn(superClass) as any) as unknown as Quad,
  ]);
}

describe('OxigraphRelationshipManager', () => {
  let store: OxigraphRdfStore;
  let manager: OxigraphRelationshipManager;

  const appComp = 'https://example.org/archimate#ApplicationComponent';
  const appService = 'https://example.org/archimate#ApplicationService';
  const busProcess = 'https://example.org/archimate#BusinessProcess';
  const servesRel = 'https://example.org/archimate#serves';
  const composesRel = 'https://example.org/archimate#composedOf';

  const sourceIri = 'https://example.org/model/elem-1';
  const targetIri = 'https://example.org/model/elem-2';

  beforeEach(() => {
    store = new OxigraphRdfStore();
    manager = new OxigraphRelationshipManager(store);
    resetQrCounter();
  });

  describe('getValidRelationships', () => {
    it('returns relationship types matching source domain and target range', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);

      const valid = manager.getValidRelationships(appComp, appService);
      expect(valid).toHaveLength(1);
      expect(valid[0].iri).toBe(servesRel);
      expect(valid[0].label).toBe('Serves');
    });

    it('returns empty array when no relationship matches', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);

      const valid = manager.getValidRelationships(busProcess, appService);
      expect(valid).toHaveLength(0);
    });

    it('returns multiple matching relationship types', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);
      addRelationshipType(store, composesRel, 'Composed Of', [appComp], [appService]);

      const valid = manager.getValidRelationships(appComp, appService);
      expect(valid).toHaveLength(2);
      const iris = valid.map((r) => r.iri).sort();
      expect(iris).toEqual([composesRel, servesRel].sort());
    });

    it('includes all domain and range types in the returned info', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp, busProcess], [appService]);

      const valid = manager.getValidRelationships(appComp, appService);
      expect(valid).toHaveLength(1);
      expect(valid[0].domainTypes).toContain(appComp);
      expect(valid[0].domainTypes).toContain(busProcess);
      expect(valid[0].rangeTypes).toContain(appService);
    });

    it('does not match when source matches domain but target does not match range', () => {
      addRelationshipType(store, servesRel, 'Serves', [appComp], [appService]);

      const valid = manager.getValidRelationships(appComp, busProcess);
      expect(valid).toHaveLength(0);
    });
  });

  describe('getValidRelationships — superclass closure matching', () => {
    // Real metamodels declare constraints against abstract intermediate classes, never
    // against every concrete leaf. These are the cases exact-IRI matching got wrong.
    const activeStructure = 'https://example.org/archimate#ActiveStructureElement';
    const internalActiveStructure = 'https://example.org/archimate#InternalActiveStructureElement';
    const behaviour = 'https://example.org/archimate#BehaviorElement';
    const internalBehaviour = 'https://example.org/archimate#InternalBehaviorElement';

    /** ApplicationComponent → InternalActiveStructureElement → ActiveStructureElement. */
    function seedHierarchy(): void {
      addSubClassOf(store, appComp, internalActiveStructure);
      addSubClassOf(store, internalActiveStructure, activeStructure);
      addSubClassOf(store, activeStructure, ARCH + 'Element');

      addSubClassOf(store, busProcess, internalBehaviour);
      addSubClassOf(store, internalBehaviour, behaviour);
      addSubClassOf(store, behaviour, ARCH + 'Element');
    }

    it('matches source and target through an intermediate superclass, not the leaf class', () => {
      seedHierarchy();
      // Constraints name the abstract classes two hops above the leaves.
      addRelationshipType(store, servesRel, 'Serving', [activeStructure], [behaviour]);

      const valid = manager.getValidRelationships(appComp, busProcess);

      expect(valid).toHaveLength(1);
      expect(valid[0].iri).toBe(servesRel);
    });

    it('matches through the immediate superclass as well as a distant one', () => {
      seedHierarchy();
      addRelationshipType(store, servesRel, 'Serving', [internalActiveStructure], [internalBehaviour]);

      const valid = manager.getValidRelationships(appComp, busProcess);

      expect(valid.map((r) => r.iri)).toEqual([servesRel]);
    });

    it('still rejects a pair outside the declared closure', () => {
      seedHierarchy();
      // Domain is behaviour-only, so an active-structure source must not match.
      addRelationshipType(store, servesRel, 'Serving', [behaviour], [behaviour]);

      expect(manager.getValidRelationships(appComp, busProcess)).toHaveLength(0);
    });

    it('treats a relationship type with no domain or range as valid between anything', () => {
      // arch:domainIncludes is a modelling hint, not rdfs:domain: absent means unconstrained.
      addRelationshipType(store, composesRel, 'Composed Of', [], []);

      const forward = manager.getValidRelationships(appComp, busProcess);
      const reverse = manager.getValidRelationships(busProcess, appComp);
      const unknownTypes = manager.getValidRelationships(
        'https://example.org/other#Widget',
        'https://example.org/other#Gadget',
      );

      expect(forward.map((r) => r.iri)).toEqual([composesRel]);
      expect(reverse.map((r) => r.iri)).toEqual([composesRel]);
      expect(unknownTypes.map((r) => r.iri)).toEqual([composesRel]);
    });

    it('treats a declared domain with an undeclared range as constrained on the source only', () => {
      seedHierarchy();
      addRelationshipType(store, servesRel, 'Serving', [activeStructure], []);

      expect(manager.getValidRelationships(appComp, busProcess).map((r) => r.iri)).toEqual([
        servesRel,
      ]);
      // Source outside the domain is still rejected.
      expect(manager.getValidRelationships(busProcess, appComp)).toHaveLength(0);
    });

    it('treats arch:Element as a wildcard constraint', () => {
      // No rdfs:subClassOf triples at all — arch:Element must match structurally-unknown types.
      addRelationshipType(
        store,
        composesRel,
        'Composed Of',
        [ARCH + 'Element'],
        [ARCH + 'Element'],
      );

      const valid = manager.getValidRelationships(appComp, busProcess);
      expect(valid.map((r) => r.iri)).toEqual([composesRel]);
    });

    it('treats arch:ModelConcept as a wildcard constraint', () => {
      addRelationshipType(
        store,
        composesRel,
        'Composed Of',
        [ARCH + 'ModelConcept'],
        [ARCH + 'ModelConcept'],
      );

      expect(manager.getValidRelationships(appComp, busProcess).map((r) => r.iri)).toEqual([
        composesRel,
      ]);
    });

    it('finds a relationship class that reaches arch:QualifiedRelationship transitively', () => {
      // ArchiMate 4.0 declares Composition rdfs:subClassOf Aggregation, so only the
      // transitive closure reaches arch:QualifiedRelationship.
      const aggregation = 'https://example.org/archimate#Aggregation';
      const composition = 'https://example.org/archimate#Composition';
      addRelationshipType(store, aggregation, 'Aggregation', [appComp], [appService]);
      store.addQuads([
        quad(
          nn(composition) as any,
          nn(RDF_TYPE) as any,
          nn(OWL_CLASS) as any,
        ) as unknown as Quad,
        quad(
          nn(composition) as any,
          nn(RDFS_SUBCLASS_OF) as any,
          nn(aggregation) as any,
        ) as unknown as Quad,
        quad(
          nn(composition) as any,
          nn(SKOS + 'prefLabel') as any,
          literal('Composition') as any,
        ) as unknown as Quad,
        quad(
          nn(composition) as any,
          nn(ARCH + 'domainIncludes') as any,
          nn(appComp) as any,
        ) as unknown as Quad,
        quad(
          nn(composition) as any,
          nn(ARCH + 'rangeIncludes') as any,
          nn(appService) as any,
        ) as unknown as Quad,
      ]);

      const iris = manager.getValidRelationships(appComp, appService).map((r) => r.iri);
      expect(iris).toContain(aggregation);
      expect(iris).toContain(composition);
    });

    it('reads constraints hung off the unqualified property rather than the class', () => {
      // ArchiMate 4.0 puts arch:domainIncludes on the owl:ObjectProperty (:serves)
      // and leaves the owl:Class (:Serving) carrying only arch:unqualifiedForm.
      seedHierarchy();
      const servingClass = 'https://example.org/archimate#Serving';
      addRelationshipType(store, servingClass, 'Serving', [], []);
      store.addQuads([
        quad(
          nn(servingClass) as any,
          nn(ARCH + 'unqualifiedForm') as any,
          nn(servesRel) as any,
        ) as unknown as Quad,
        quad(
          nn(servesRel) as any,
          nn(ARCH + 'domainIncludes') as any,
          nn(activeStructure) as any,
        ) as unknown as Quad,
        quad(
          nn(servesRel) as any,
          nn(ARCH + 'rangeIncludes') as any,
          nn(behaviour) as any,
        ) as unknown as Quad,
      ]);

      const valid = manager.getValidRelationships(appComp, busProcess);
      expect(valid).toHaveLength(1);
      expect(valid[0].iri).toBe(servingClass);
      expect(valid[0].unqualifiedPredicateIri).toBe(servesRel);
      expect(valid[0].domainTypes).toEqual([activeStructure]);
      // Constraints on the property are real constraints: the reverse pair is rejected.
      expect(manager.getValidRelationships(busProcess, appComp)).toHaveLength(0);
    });
  });

  describe('getValidRelationships — ranking', () => {
    const activeStructure = 'https://example.org/archimate#ActiveStructureElement';
    const associationRel = 'https://example.org/archimate#associatedWith';

    it('ranks an exact source/target match above a closure match', () => {
      addSubClassOf(store, appComp, activeStructure);
      addRelationshipType(store, servesRel, 'Serving', [appComp], [appService]);
      addRelationshipType(store, composesRel, 'Composed Of', [activeStructure], [appService]);

      const valid = manager.getValidRelationships(appComp, appService);

      expect(valid).toHaveLength(2);
      expect(valid[0].iri).toBe(servesRel);
      expect(valid[1].iri).toBe(composesRel);
      expect(valid[0].score!).toBeGreaterThan(valid[1].score!);
    });

    it('ranks Association below a specific relationship type', () => {
      addRelationshipType(store, servesRel, 'Serving', [appComp], [appService]);
      addRelationshipType(
        store,
        associationRel,
        'Association',
        [ARCH + 'Element'],
        [ARCH + 'Element'],
      );

      const valid = manager.getValidRelationships(appComp, appService);

      expect(valid).toHaveLength(2);
      expect(valid[0].label).toBe('Serving');
      expect(valid[valid.length - 1].label).toBe('Association');
      expect(valid[0].score!).toBeGreaterThan(valid[1].score!);
    });

    it('nudges Composition and Aggregation below an equally-matched specific type', () => {
      addRelationshipType(store, servesRel, 'Serving', [ARCH + 'Element'], [ARCH + 'Element']);
      addRelationshipType(store, composesRel, 'Composition', [ARCH + 'Element'], [ARCH + 'Element']);

      const valid = manager.getValidRelationships(appComp, appService);

      expect(valid.map((r) => r.label)).toEqual(['Serving', 'Composition']);
    });

    it('returns results sorted by descending score', () => {
      addSubClassOf(store, appComp, activeStructure);
      addRelationshipType(store, servesRel, 'Serving', [appComp], [appService]);
      addRelationshipType(store, composesRel, 'Composed Of', [activeStructure], [appService]);
      addRelationshipType(
        store,
        associationRel,
        'Association',
        [ARCH + 'Element'],
        [ARCH + 'Element'],
      );

      const scores = manager.getValidRelationships(appComp, appService).map((r) => r.score!);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });
  });

  describe('getValidRelationships — reasons', () => {
    it('gives a non-empty reason naming the matched constraints for a constrained type', () => {
      addRelationshipType(store, servesRel, 'Serving', [appComp], [appService]);

      const [candidate] = manager.getValidRelationships(appComp, appService);

      expect(candidate.reason).toBeTruthy();
      expect(candidate.reason!.length).toBeGreaterThan(0);
      expect(candidate.reason).toContain('Application Component');
      expect(candidate.reason).toContain('Application Service');
    });

    it('gives a non-empty reason explaining permissiveness for an unconstrained type', () => {
      addRelationshipType(store, composesRel, 'Composed Of', [], []);

      const [candidate] = manager.getValidRelationships(appComp, busProcess);

      expect(candidate.reason).toBeTruthy();
      expect(candidate.reason!.length).toBeGreaterThan(0);
      expect(candidate.reason).toMatch(/domainIncludes/);
    });

    it('reports a wildcard constraint by its short label rather than its full IRI', () => {
      addRelationshipType(store, servesRel, 'Serving', [ARCH + 'Element'], [ARCH + 'Element']);

      const [candidate] = manager.getValidRelationships(appComp, appService);

      expect(candidate.reason).toContain('Element');
      expect(candidate.reason).not.toContain(ARCH);
    });
  });

  describe('getValidRelationships — real ArchiMate 4.0 ontology', () => {
    /**
     * The regression this whole change exists for. ArchiMate 4.0 declares
     * `arch:domainIncludes :ActiveStructureElement` on `:serves`, never
     * `:ApplicationComponent`, so exact-IRI matching returns nothing here.
     */
    const ONTO_PATH = fileURLToPath(
      new URL('../../../assets/archimate4/archimate4-onto.ttl', import.meta.url),
    );
    const AM4 = 'https://meta.linked.archi/archimate4/onto#';

    let realStore: OxigraphRdfStore;
    let realManager: OxigraphRelationshipManager;

    beforeEach(() => {
      const ttl = readFileSync(ONTO_PATH, 'utf-8');
      const parsed = new N3TtlParser().parse(ttl);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      realStore = new OxigraphRdfStore();
      realStore.addQuads(parsed.quads);
      realManager = new OxigraphRelationshipManager(realStore);
    });

    it('parses the published ontology and finds its relationship types', () => {
      // arch:Relationship does not appear anywhere in the 4.0 ontology; relationship
      // types are owl:Class subclasses of arch:QualifiedRelationship.
      expect(
        realStore.getQuads(null, nn(RDF_TYPE), nn(ARCH + 'Relationship')),
      ).toHaveLength(0);
      expect(
        realStore.getQuads(null, nn(RDFS_SUBCLASS_OF), nn(ARCH + 'QualifiedRelationship')).length,
      ).toBeGreaterThan(0);
    });

    it('returns a non-empty ranked list for ApplicationComponent → Process', () => {
      const candidates = realManager.getValidRelationships(
        AM4 + 'ApplicationComponent',
        AM4 + 'Process',
      );

      expect(candidates.length).toBeGreaterThan(0);

      // Serving is the semantically expected answer, and it must actually be found
      // via the ActiveStructureElement / BehaviorElement closure.
      const labels = candidates.map((c) => c.label);
      expect(labels).toContain('Serving');
      expect(labels).toContain('Assignment');

      // Every candidate is explained and scored, and the list is ordered.
      for (const candidate of candidates) {
        expect(candidate.reason).toBeTruthy();
        expect(typeof candidate.score).toBe('number');
      }
      const scores = candidates.map((c) => c.score!);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));

      // Association is the least informative option, so it must sink to the bottom,
      // and the containment relationships must sit below the specific ones.
      expect(candidates[candidates.length - 1].label).toBe('Association');
      const scoreOf = (label: string): number =>
        candidates.find((c) => c.label === label)!.score!;
      expect(scoreOf('Serving')).toBeGreaterThan(scoreOf('Composition'));
      expect(scoreOf('Composition')).toBeGreaterThan(scoreOf('Association'));
    });

    it('offers Access to a passive target but not to a behaviour target', () => {
      // The two halves of the same constraint: :accesses has range
      // :PassiveStructureElement, so it appears for DataObject and not for Process.
      const toDataObject = realManager
        .getValidRelationships(AM4 + 'ApplicationComponent', AM4 + 'DataObject')
        .map((c) => c.label);
      const toProcess = realManager
        .getValidRelationships(AM4 + 'ApplicationComponent', AM4 + 'Process')
        .map((c) => c.label);

      expect(toDataObject).toContain('Access');
      expect(toProcess).not.toContain('Access');
    });

    it('resolves the Serving candidate to its unqualified predicate :serves', () => {
      const candidates = realManager.getValidRelationships(
        AM4 + 'ApplicationComponent',
        AM4 + 'Process',
      );
      const serving = candidates.find((c) => c.label === 'Serving');

      expect(serving).toBeDefined();
      expect(serving!.iri).toBe(AM4 + 'Serving');
      expect(serving!.unqualifiedPredicateIri).toBe(AM4 + 'serves');
      // Constraints were declared on the property, against the abstract superclasses.
      expect(serving!.domainTypes).toContain(AM4 + 'ActiveStructureElement');
      expect(serving!.rangeTypes).toContain(AM4 + 'BehaviorElement');
    });

    it('rejects a pair that the ontology genuinely does not allow', () => {
      // :accesses has range :PassiveStructureElement only, so it must not appear for
      // a behaviour target — proving closure matching did not become a blanket yes.
      const candidates = realManager.getValidRelationships(
        AM4 + 'ApplicationComponent',
        AM4 + 'Process',
      );
      expect(candidates.map((c) => c.label)).not.toContain('Access');
    });
  });

  describe('createRelationship (direct)', () => {
    it('returns null for a direct (non-qualified) relationship', () => {
      const result = manager.createRelationship(servesRel, sourceIri, targetIri);
      expect(result).toBeNull();
    });

    it('creates a direct triple in the store', () => {
      manager.createRelationship(servesRel, sourceIri, targetIri);

      const quads = store.getQuads(nn(sourceIri), nn(servesRel), nn(targetIri));
      expect(quads).toHaveLength(1);
    });

    it('creates a direct triple when qualified is explicitly false', () => {
      manager.createRelationship(servesRel, sourceIri, targetIri, false);

      const quads = store.getQuads(nn(sourceIri), nn(servesRel), nn(targetIri));
      expect(quads).toHaveLength(1);
    });
  });

  describe('createRelationship (qualified)', () => {
    it('returns a NamedNode for a qualified relationship', () => {
      const result = manager.createRelationship(servesRel, sourceIri, targetIri, true);
      expect(result).not.toBeNull();
      expect(result!.termType).toBe('NamedNode');
    });

    it('creates a QualifiedRelationship with correct type triple', () => {
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;

      const typeQuads = store.getQuads(qr, nn(RDF_TYPE));
      expect(typeQuads).toHaveLength(1);
      expect(typeQuads[0].object.value).toBe(ARCH + 'QualifiedRelationship');
    });

    it('creates arch:source and arch:target triples', () => {
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;

      const srcQuads = store.getQuads(qr, nn(ARCH + 'source'));
      expect(srcQuads).toHaveLength(1);
      expect(srcQuads[0].object.value).toBe(sourceIri);

      const tgtQuads = store.getQuads(qr, nn(ARCH + 'target'));
      expect(tgtQuads).toHaveLength(1);
      expect(tgtQuads[0].object.value).toBe(targetIri);
    });

    it('does not emit the removed rdf:Statement-style reification properties', () => {
      // arch:relSource / arch:relTarget / arch:relPredicate were sub-properties of
      // rdf:subject / rdf:object / rdf:predicate and have been removed from the core
      // ontology; arch:source / arch:target replace them and there is no predicate
      // property at all.
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;

      expect(store.getQuads(qr, nn(ARCH + 'relSource'))).toHaveLength(0);
      expect(store.getQuads(qr, nn(ARCH + 'relTarget'))).toHaveLength(0);
      expect(store.getQuads(qr, nn(ARCH + 'relPredicate'))).toHaveLength(0);
    });

    it('creates exactly 3 triples when no metamodel maps the predicate to a class', () => {
      // rdf:type arch:QualifiedRelationship, arch:source, arch:target.
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      const allQuads = store.getQuads(qr);
      expect(allQuads).toHaveLength(3);
    });

    it('also types the resource with the relationship class when the metamodel maps it', () => {
      // arch:unqualifiedForm is what carries the relationship kind onto the resource,
      // now that there is no arch:relPredicate.
      const servingClass = 'https://example.org/archimate#Serving';
      addRelationshipType(store, servingClass, 'Serving', [appComp], [appService]);
      store.addQuads([
        quad(
          nn(servingClass) as any,
          nn(ARCH + 'unqualifiedForm') as any,
          nn(servesRel) as any,
        ) as unknown as Quad,
      ]);

      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;

      const typeIris = store.getQuads(qr, nn(RDF_TYPE)).map((q) => q.object.value);
      expect(typeIris).toContain(ARCH + 'QualifiedRelationship');
      expect(typeIris).toContain(servingClass);
      expect(store.getQuads(qr)).toHaveLength(4);
    });

    it('generates unique IRIs for successive qualified relationships', () => {
      const qr1 = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      const qr2 = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      expect(qr1.value).not.toBe(qr2.value);
    });
  });

  describe('deleteRelationship', () => {
    it('removes all triples of a QualifiedRelationship', () => {
      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      expect(store.getQuads(qr)).toHaveLength(3);

      manager.deleteRelationship(qr.value);
      expect(store.getQuads(qr)).toHaveLength(0);
    });

    it('leaves source and target elements intact after deleting a QR', () => {
      // Add some triples for source and target elements
      store.addQuads([
        quad(nn(sourceIri) as any, nn(RDF_TYPE) as any, nn(appComp) as any) as unknown as Quad,
        quad(nn(targetIri) as any, nn(RDF_TYPE) as any, nn(appService) as any) as unknown as Quad,
      ]);

      const qr = manager.createRelationship(servesRel, sourceIri, targetIri, true)!;
      manager.deleteRelationship(qr.value);

      // Source and target still have their type triples
      expect(store.getQuads(nn(sourceIri), nn(RDF_TYPE))).toHaveLength(1);
      expect(store.getQuads(nn(targetIri), nn(RDF_TYPE))).toHaveLength(1);
    });

    it('is a no-op when the IRI does not exist', () => {
      // Should not throw
      manager.deleteRelationship('https://example.org/nonexistent');
    });
  });
});
