import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Literal, Term } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphViewManager } from '../view-manager.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { ModelSession, DEFAULT_VIEW_LABEL } from '../model-session.js';
import { readModelContents, modelQuads } from '../model-queries.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { tripleTerm } from '../vocabulary.js';
import { confirmationQuads, derivationDetails, derivationStatus } from '../derivations.js';
import { createHash } from 'node:crypto';

const { namedNode, literal, quad } = DataFactory;
const ARCH = NAMESPACES.arch;
const VIS = NAMESPACES['arch-vis'];
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const RDF_TYPE = NAMESPACES.rdf + 'type';

const RDF_REIFIES = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies';

function nn(value: string): NamedNode {
  return namedNode(value) as unknown as NamedNode;
}

/**
 * One store with the bundled ArchiMate 4.0 metamodel for the whole file; each
 * test starts from an empty *model* (default graph) on top of it.
 */
let shared: OxigraphRdfStore;
let metamodelCount = 0;
beforeAll(async () => {
  shared = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), shared).loadBundledMetamodel('archimate4');
  metamodelCount = shared.getQuads().length;
}, 30_000);
afterAll(() => shared.dispose());

function freshStore(): OxigraphRdfStore {
  const data = modelQuads(shared);
  if (data.length > 0) shared.removeQuads(data);
  return shared;
}

describe('qualified relationships against the real ArchiMate 4.0 ontology', () => {
  let store: OxigraphRdfStore;
  let rels: OxigraphRelationshipManager;
  let elements: OxigraphElementManager;
  const model = 'urn:test:model';

  beforeEach(() => {
    store = freshStore();
    rels = new OxigraphRelationshipManager(store);
    elements = new OxigraphElementManager(store);
  });

  it('writes the qualified resource typed with its class, and the unqualified triple', () => {
    const a = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const b = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const rel = rels.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: a, targetIri: b, modelIri: model });

    expect(rel.classIri).toBe(AM4 + 'Serving');
    expect(rel.predicateIri).toBe(AM4 + 'serves');
    expect(store.getQuads(nn(rel.iri), nn(RDF_TYPE)).map((q) => q.object.value)).toEqual([AM4 + 'Serving']);
    expect(store.getQuads(nn(a), nn(AM4 + 'serves'), nn(b))).toHaveLength(1);
    expect(store.getQuads(nn(rel.iri), nn(ARCH + 'inModel')).map((q) => q.object.value)).toEqual([model]);
    expect(rels.getRelationship(rel.iri)).toMatchObject({ sourceIri: a, targetIri: b, classIri: AM4 + 'Serving' });
    expect(rels.getRelationshipsOf(a).map((r) => r.iri)).toEqual([rel.iri]);
  });

  it('accepts the predicate and resolves the class', () => {
    const a = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const b = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const rel = rels.createQualifiedRelationship({ typeIri: AM4 + 'serves', sourceIri: a, targetIri: b });
    expect(rel.classIri).toBe(AM4 + 'Serving');
  });

  it('keeps the unqualified triple while a sibling occurrence still justifies it', () => {
    const a = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const b = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const r1 = rels.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: a, targetIri: b });
    const r2 = rels.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: a, targetIri: b });
    rels.deleteRelationship(r1.iri);
    expect(store.getQuads(nn(a), nn(AM4 + 'serves'), nn(b))).toHaveLength(1);
    rels.deleteRelationship(r2.iri);
    expect(store.getQuads(nn(a), nn(AM4 + 'serves'), nn(b))).toHaveLength(0);
  });

  /** What a relationship rdf:reifies, as [subject, predicate, object] — RDF 1.2's <<( s p o )>>. */
  const reified = (iri: string) =>
    store.getQuads(nn(iri), nn(RDF_REIFIES)).map((q) => {
      const t = q.object as unknown as { termType: string; subject: Term; predicate: Term; object: Term };
      return t.termType === 'Quad' ? [t.subject.value, t.predicate.value, t.object.value] : t.termType;
    });

  it('reifies the unqualified triple, and keeps it in step through retype, reconnect and delete', () => {
    const a = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const b = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const c = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const rel = rels.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: a, targetIri: b, modelIri: model });
    expect(reified(rel.iri)).toEqual([[a, AM4 + 'serves', b]]);

    rels.retypeRelationship(rel.iri, AM4 + 'Flow');
    expect(reified(rel.iri)).toEqual([[a, AM4 + 'flowsTo', b]]);

    rels.reconnectRelationship(rel.iri, a, c);
    expect(reified(rel.iri)).toEqual([[a, AM4 + 'flowsTo', c]]);

    rels.deleteRelationship(rel.iri);
    expect(store.getQuads(nn(rel.iri))).toHaveLength(0);
  });

  /** The predicates leading to a relationship, as [subject, predicate]. */
  const pointers = (iri: string) => store.getQuads(null, null, nn(iri)).map((q) => [q.subject.value, q.predicate.value]);

  it('leads from the source to the relationship by its type’s qualified predicate, kept in step through retype, reconnect and delete', () => {
    const a = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const b = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const c = elements.createElement(AM4 + 'ApplicationComponent', model).value;
    const rel = rels.createQualifiedRelationship({ typeIri: AM4 + 'Realization', sourceIri: a, targetIri: b, modelIri: model });
    expect(pointers(rel.iri)).toEqual([[a, AM4 + 'qualifiedRealization']]);

    rels.retypeRelationship(rel.iri, AM4 + 'Serving');
    expect(pointers(rel.iri)).toEqual([[a, AM4 + 'qualifiedServing']]);

    // A new source: the way in moves, by the predicate the data used — here, core's fallback.
    store.removeQuads(store.getQuads(nn(a), null, nn(rel.iri)));
    store.addQuads([quad(namedNode(a), namedNode(ARCH + 'hasQualifiedRelationship'), namedNode(rel.iri))] as never);
    rels.reconnectRelationship(rel.iri, c, b);
    expect(pointers(rel.iri)).toEqual([[c, ARCH + 'hasQualifiedRelationship']]);

    rels.deleteRelationship(rel.iri);
    expect(pointers(rel.iri)).toEqual([]);
  });
});

describe('ModelSession', () => {
  let store: OxigraphRdfStore;
  let views: OxigraphViewManager;
  let elements: OxigraphElementManager;
  let session: ModelSession;
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = freshStore();
    views = new OxigraphViewManager(store);
    elements = new OxigraphElementManager(store);
    emit = vi.fn();
    session = new ModelSession(store, elements, views, { emit });
  });

  it('starts a new model with conformance, a label and one open diagram view', () => {
    const { modelIri, viewIri } = session.newModel({
      label: 'Order Platform',
      metamodelIris: ['https://meta.linked.archi/archimate4/metamodel#ArchiMate4'],
    });
    expect(modelIri).toMatch(/^https:\/\/example\.org\/archimate\/[0-9a-f-]{36}\/model$/);
    expect(session.namespace()).toEqual({ namespace: modelIri.replace(/model$/, ''), prefix: 'm', declared: true });
    expect(session.modelLabel()).toBe('Order Platform');
    expect(session.metamodelIris()).toEqual(['https://meta.linked.archi/archimate4/metamodel#ArchiMate4']);
    expect(session.activeViewIri).toBe(viewIri);
    expect(views.getView(viewIri)).toMatchObject({ label: DEFAULT_VIEW_LABEL, type: 'Diagram', modelIri });
    expect(emit).toHaveBeenCalledWith('view-opened', { viewIri });
  });

  it('never touches the metamodel graphs when clearing the model', () => {
    session.newModel();
    session.clearModelData();
    expect(modelQuads(store)).toHaveLength(0);
    expect(store.getQuads().length).toBe(metamodelCount);
  });

  it('adopts foreign data: model resource, membership, a view, and a grid layout when there is no geometry', () => {
    store.addQuads([
      quad(namedNode('urn:x:a'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:x:a'), namedNode(NAMESPACES.skos + 'prefLabel'), literal('A', 'en')),
      quad(namedNode('urn:x:b'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:x:r'), namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(namedNode('urn:x:r'), namedNode(ARCH + 'source'), namedNode('urn:x:a')),
      quad(namedNode('urn:x:r'), namedNode(ARCH + 'target'), namedNode('urn:x:b')),
    ] as never);

    const result = session.adopt({ fallbackLabel: 'Imported' });

    expect(session.modelLabel()).toBe('Imported');
    expect(result.autoPlaced).toBe(2);
    expect(views.getNodes(result.viewIri)).toHaveLength(2);
    expect(views.getLinks(result.viewIri).map((l) => l.relationshipIri)).toEqual(['urn:x:r']);
    for (const s of ['urn:x:a', 'urn:x:b', 'urn:x:r']) {
      expect(store.getQuads(nn(s), nn(ARCH + 'inModel')).map((q) => q.object.value)).toEqual([result.modelIri]);
    }

    const contents = readModelContents(store, views.getViews());
    expect(contents.model?.label).toBe('Imported');
    // `b` has no label: the fallback is its IRI's local name.
    expect(contents.elements.map((e) => e.label).sort()).toEqual(['A', 'b']);
    expect(contents.elements[0].typeLabel).toBe('Application Component');
    expect(contents.relationships.map((r) => r.typeLabel)).toEqual(['Serving']);
  });

  it('gives a relationship of an older model the rdf:reifies of its triple on adopt', () => {
    store.addQuads([
      quad(namedNode('urn:y:a'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:y:b'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:y:r'), namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(namedNode('urn:y:r'), namedNode(ARCH + 'source'), namedNode('urn:y:a')),
      quad(namedNode('urn:y:r'), namedNode(ARCH + 'target'), namedNode('urn:y:b')),
    ] as never);

    session.adopt({ fallbackLabel: 'Older' });

    const objects = store.getQuads(nn('urn:y:r'), nn(RDF_REIFIES)).map((q) => q.object as unknown as { termType: string; subject: Term; predicate: Term; object: Term });
    expect(objects).toHaveLength(1);
    expect(objects[0].termType).toBe('Quad');
    expect([objects[0].subject.value, objects[0].predicate.value, objects[0].object.value]).toEqual(['urn:y:a', AM4 + 'serves', 'urn:y:b']);
    // Adopting again adds nothing.
    session.adopt();
    expect(store.getQuads(nn('urn:y:r'), nn(RDF_REIFIES))).toHaveLength(1);
  });

  it('makes a relationship reify its own ends again on adopt, when an earlier namespace change left old IRIs in its triple term', () => {
    // Moved from urn:old: to urn:new: before triple terms moved too: everything but the reified triple names the new IRIs.
    store.addQuads([
      quad(namedNode('urn:new:a'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:new:b'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:new:r'), namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(namedNode('urn:new:r'), namedNode(ARCH + 'source'), namedNode('urn:new:a')),
      quad(namedNode('urn:new:r'), namedNode(ARCH + 'target'), namedNode('urn:new:b')),
      quad(namedNode('urn:new:a'), namedNode(AM4 + 'serves'), namedNode('urn:new:b')),
      quad(namedNode('urn:new:a'), namedNode(AM4 + 'qualifiedServing'), namedNode('urn:new:r')),
      quad(
        namedNode('urn:new:r'),
        namedNode(RDF_REIFIES),
        tripleTerm(namedNode('urn:old:a') as never, namedNode(AM4 + 'serves') as never, namedNode('urn:old:b') as never) as never,
      ),
    ] as never);

    session.adopt({ fallbackLabel: 'Moved' });

    const reified = () =>
      store.getQuads(nn('urn:new:r'), nn(RDF_REIFIES)).map((q) => {
        const t = q.object as unknown as { subject: Term; predicate: Term; object: Term };
        return [t.subject.value, t.predicate.value, t.object.value];
      });
    expect(reified()).toEqual([['urn:new:a', AM4 + 'serves', 'urn:new:b']]);
    // A relationship, not a proposition about one, and adopting again changes nothing.
    expect(readModelContents(store, views.getViews()).relationships.map((r) => r.iri)).toContain('urn:new:r');
    session.adopt();
    expect(reified()).toEqual([['urn:new:a', AM4 + 'serves', 'urn:new:b']]);
  });

  it('gives a relationship without one the qualified predicate leading to it on adopt, and keeps one it has', () => {
    store.addQuads([
      quad(namedNode('urn:z:a'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:z:b'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:z:r1'), namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(namedNode('urn:z:r1'), namedNode(ARCH + 'source'), namedNode('urn:z:a')),
      quad(namedNode('urn:z:r1'), namedNode(ARCH + 'target'), namedNode('urn:z:b')),
      quad(namedNode('urn:z:r2'), namedNode(RDF_TYPE), namedNode(AM4 + 'Flow')),
      quad(namedNode('urn:z:r2'), namedNode(ARCH + 'source'), namedNode('urn:z:a')),
      quad(namedNode('urn:z:r2'), namedNode(ARCH + 'target'), namedNode('urn:z:b')),
      quad(namedNode('urn:z:a'), namedNode(ARCH + 'hasQualifiedRelationship'), namedNode('urn:z:r2')),
    ] as never);

    session.adopt({ fallbackLabel: 'Converted' });

    const into = (rel: string) => store.getQuads(nn('urn:z:a'), null, nn(rel)).map((q) => [q.subject.value, q.predicate.value]);
    expect(into('urn:z:r1')).toEqual([['urn:z:a', AM4 + 'qualifiedServing']]);
    expect(into('urn:z:r2')).toEqual([['urn:z:a', ARCH + 'hasQualifiedRelationship']]);
    session.adopt();
    expect(into('urn:z:r1')).toHaveLength(1);
  });

  it('makes a relationship resource on adopt for each bare triple a loaded class names, as meta\u2019s rules make it', () => {
    const a = namedNode('urn:bare:a');
    const b = namedNode('urn:bare:b');
    const data = namedNode('urn:bare:data');
    const stray = namedNode('urn:bare:not-in-the-model');
    store.addQuads([
      quad(a, namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(b, namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(data, namedNode(RDF_TYPE), namedNode(AM4 + 'DataObject')),
      quad(a, namedNode(AM4 + 'serves'), b),
      // A kind's form is its superclass's: a bare triple says no more than the most general class.
      quad(a, namedNode(AM4 + 'accesses'), data),
      // An end that is no concept of the model: left a triple.
      quad(a, namedNode(AM4 + 'serves'), stray),
    ] as never);

    const { qualified } = session.adopt({ fallbackLabel: 'Bare' });
    expect(qualified).toBe(2);

    const namespace = session.namespace()!.namespace;
    // DD-41's digest of "s p o": what meta's :QualifyRelationships names the same triple, run with RDF4J (2026-11-19).
    expect(createHash('sha256').update(`urn:bare:a ${AM4}serves urn:bare:b`).digest('hex').slice(0, 20)).toBe('2fcfd79e430870899c4e');
    const serving = `${namespace}relationship/2fcfd79e430870899c4e`;
    const of = (rel: string, p: string) => store.getQuads(nn(rel), nn(p)).map((q) => q.object.value);
    expect(of(serving, RDF_TYPE)).toEqual([AM4 + 'Serving']);
    expect([of(serving, ARCH + 'source'), of(serving, ARCH + 'target')]).toEqual([['urn:bare:a'], ['urn:bare:b']]);
    expect(of(serving, ARCH + 'inModel')).toEqual([session.modelIri]);
    const term = store.getQuads(nn(serving), nn(RDF_REIFIES))[0]!.object as unknown as { subject: Term; predicate: Term; object: Term };
    expect([term.subject.value, term.predicate.value, term.object.value]).toEqual(['urn:bare:a', AM4 + 'serves', 'urn:bare:b']);
    expect(store.getQuads(nn('urn:bare:a'), nn(AM4 + 'qualifiedServing')).map((q) => q.object.value)).toEqual([serving]);

    const accessClasses = store
      .getQuads(null, nn(ARCH + 'target'), nn('urn:bare:data'))
      .flatMap((q) => store.getQuads(q.subject as NamedNode, nn(RDF_TYPE)).map((t) => t.object.value));
    expect(accessClasses).toEqual([AM4 + 'Access']);
    expect(store.getQuads(null, nn(ARCH + 'target'), nn('urn:bare:not-in-the-model'))).toHaveLength(0);

    // Opening again — or a second window in the same room — makes nothing more.
    expect(session.adopt().qualified).toBe(0);
    expect(store.getQuads(null, nn(ARCH + 'target'), nn('urn:bare:b'))).toHaveLength(1);
  });

  it('leaves a bare triple alone on adopt when a relationship already stands for it', () => {
    const a = namedNode('urn:kept:a');
    const b = namedNode('urn:kept:b');
    const rel = namedNode('urn:kept:r');
    store.addQuads([
      quad(a, namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(b, namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(a, namedNode(AM4 + 'serves'), b),
      quad(rel, namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(rel, namedNode(ARCH + 'source'), a),
      quad(rel, namedNode(ARCH + 'target'), b),
    ] as never);
    expect(session.adopt().qualified).toBe(0);
    expect(store.getQuads(null, nn(ARCH + 'target'), nn('urn:kept:b'))).toHaveLength(1);
  });

  it('leaves a proposition as it is on adopt, until its triple and qualified predicate confirm it', () => {
    const a = namedNode('urn:p:a');
    const b = namedNode('urn:p:b');
    const proposed = namedNode('urn:p:proposed');
    const stated = namedNode('urn:p:stated');
    const trimmed = namedNode('urn:p:trimmed');
    store.addQuads([
      quad(a, namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(b, namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      // A potential derivation: the resource alone, reifying a triple nothing asserts.
      quad(proposed, namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(proposed, namedNode(ARCH + 'source'), a),
      quad(proposed, namedNode(ARCH + 'target'), b),
      quad(proposed, namedNode(RDF_REIFIES), tripleTerm(a as never, namedNode(AM4 + 'serves') as never, b as never) as never),
      // Another tool's relationship: its triple is asserted, without the rest.
      quad(stated, namedNode(RDF_TYPE), namedNode(AM4 + 'Flow')),
      quad(stated, namedNode(ARCH + 'source'), a),
      quad(stated, namedNode(ARCH + 'target'), b),
      quad(stated, namedNode(RDF_REIFIES), tripleTerm(a as never, namedNode(AM4 + 'flowsTo') as never, b as never) as never),
      quad(a, namedNode(AM4 + 'flowsTo'), b),
      // A converter's, trimmed of its direct triple: the qualified predicate says it is the model's.
      quad(trimmed, namedNode(RDF_TYPE), namedNode(AM4 + 'Access')),
      quad(trimmed, namedNode(ARCH + 'source'), a),
      quad(trimmed, namedNode(ARCH + 'target'), b),
      quad(trimmed, namedNode(RDF_REIFIES), tripleTerm(a as never, namedNode(AM4 + 'accesses') as never, b as never) as never),
      quad(a, namedNode(AM4 + 'qualifiedAccess'), trimmed),
    ] as never);

    session.adopt({ fallbackLabel: 'Derived' });

    const into = (rel: string) => store.getQuads(nn('urn:p:a'), null, nn(rel)).map((q) => q.predicate.value);
    const members = (rel: string) => store.getQuads(nn(rel), nn(ARCH + 'inModel'));
    const links = (rel: string) => store.getQuads(null, nn(VIS + 'archRelationship'), nn(rel));
    const triples = () => store.getQuads(nn('urn:p:a'), nn(AM4 + 'serves'), nn('urn:p:b'));

    expect(into('urn:p:proposed')).toEqual([]);
    expect(members('urn:p:proposed')).toEqual([]);
    expect(links('urn:p:proposed')).toEqual([]);
    expect(triples()).toEqual([]);
    expect(into('urn:p:stated')).toEqual([AM4 + 'qualifiedFlow']);
    expect(members('urn:p:stated')).toHaveLength(1);
    expect(links('urn:p:stated')).toHaveLength(1);
    expect(members('urn:p:trimmed')).toHaveLength(1);
    expect(links('urn:p:trimmed')).toHaveLength(1);

    session.adopt();
    expect(into('urn:p:proposed')).toEqual([]);
    expect(members('urn:p:proposed')).toEqual([]);

    // Confirmed, it is a relationship of the model.
    store.addQuads([
      quad(a, namedNode(AM4 + 'serves'), b),
      quad(a, namedNode(AM4 + 'qualifiedServing'), proposed),
    ] as never);
    session.adopt();
    expect(members('urn:p:proposed')).toHaveLength(1);
  });

  it('keeps derivations out of what the model states, lists them apart, and confirms a potential one', () => {
    const DERIV = 'https://meta.linked.archi/archimate4/derivation#';
    const PROV = NAMESPACES.prov;
    const a = namedNode('urn:d:a');
    const b = namedNode('urn:d:b');
    const c = namedNode('urn:d:c');
    const derivation = (iri: string, certainty: 'Valid' | 'Potential', rule: string, premise: string) => [
      quad(namedNode(iri), namedNode(DERIV + 'derivationCertainty'), namedNode(DERIV + certainty)),
      quad(namedNode(iri), namedNode(PROV + 'wasDerivedFrom'), namedNode(premise)),
      quad(namedNode(iri), namedNode(PROV + 'wasGeneratedBy'), namedNode(iri + '-activity')),
      quad(namedNode(iri + '-activity'), namedNode(PROV + 'qualifiedAssociation'), namedNode(iri + '-association')),
      quad(namedNode(iri + '-association'), namedNode(PROV + 'hadPlan'), namedNode(DERIV + rule)),
    ];
    store.addQuads([
      ...[a, b, c].map((e) => quad(e, namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent'))),
      // Stated: a serves b.
      quad(namedNode('urn:d:stated'), namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(namedNode('urn:d:stated'), namedNode(ARCH + 'source'), a),
      quad(namedNode('urn:d:stated'), namedNode(ARCH + 'target'), b),
      quad(a, namedNode(AM4 + 'serves'), b),
      quad(a, namedNode(AM4 + 'qualifiedServing'), namedNode('urn:d:stated')),
      // Valid: its triple and qualified predicate asserted, nobody stating it.
      quad(namedNode('urn:d:valid'), namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(namedNode('urn:d:valid'), namedNode(ARCH + 'source'), a),
      quad(namedNode('urn:d:valid'), namedNode(ARCH + 'target'), c),
      quad(namedNode('urn:d:valid'), namedNode(RDF_REIFIES), tripleTerm(a as never, namedNode(AM4 + 'serves') as never, c as never) as never),
      quad(a, namedNode(AM4 + 'serves'), c),
      quad(a, namedNode(AM4 + 'qualifiedServing'), namedNode('urn:d:valid')),
      ...derivation('urn:d:valid', 'Valid', 'DR3', 'urn:d:stated'),
      // Potential: the resource alone.
      quad(namedNode('urn:d:potential'), namedNode(RDF_TYPE), namedNode(AM4 + 'Flow')),
      quad(namedNode('urn:d:potential'), namedNode(ARCH + 'source'), b),
      quad(namedNode('urn:d:potential'), namedNode(ARCH + 'target'), c),
      quad(namedNode('urn:d:potential'), namedNode(RDF_REIFIES), tripleTerm(b as never, namedNode(AM4 + 'flowsTo') as never, c as never) as never),
      ...derivation('urn:d:potential', 'Potential', 'PDR8', 'urn:d:stated'),
    ] as never);

    session.adopt({ fallbackLabel: 'Derived' });

    const members = (rel: string) => store.getQuads(nn(rel), nn(ARCH + 'inModel'));
    const links = (rel: string) => store.getQuads(null, nn(VIS + 'archRelationship'), nn(rel));
    expect(members('urn:d:stated')).toHaveLength(1);
    expect(links('urn:d:stated')).toHaveLength(1);
    for (const derived of ['urn:d:valid', 'urn:d:potential']) {
      expect(members(derived)).toEqual([]);
      expect(links(derived)).toEqual([]);
    }

    const listed = () => new Map(readModelContents(store, []).relationships.map((r) => [r.iri, r.derivation]));
    expect(listed().get('urn:d:stated')).toBeUndefined();
    expect(listed().get('urn:d:valid')).toEqual({ certainty: 'valid', rule: 'DR3' });
    expect(listed().get('urn:d:potential')).toEqual({ certainty: 'potential', rule: 'PDR8' });
    expect(derivationDetails(store, 'urn:d:valid')).toEqual({ certainty: 'valid', confirmed: false, rule: DERIV + 'DR3', premises: ['urn:d:stated'] });
    expect(confirmationQuads(store, 'urn:d:valid', 'urn:d:model')).toEqual([]);

    // Confirmed: its triple, its qualified predicate and its membership — then a relationship of the model.
    const model = session.modelIri!;
    const confirming = confirmationQuads(store, 'urn:d:potential', model);
    expect(confirming.map((q) => [q.subject.value, q.predicate.value, q.object.value])).toEqual([
      ['urn:d:b', AM4 + 'flowsTo', 'urn:d:c'],
      ['urn:d:b', AM4 + 'qualifiedFlow', 'urn:d:potential'],
      ['urn:d:potential', ARCH + 'inModel', model],
    ]);
    store.addQuads(confirming);
    expect(derivationStatus(store, 'urn:d:potential')).toEqual({ certainty: 'potential', confirmed: true });
    expect(listed().get('urn:d:potential')).toBeUndefined();
    expect(confirmationQuads(store, 'urn:d:potential', model)).toEqual([]);
    session.linkAllPlaced(session.activeViewIri!);
    expect(links('urn:d:potential')).toHaveLength(1);
    expect(links('urn:d:valid')).toEqual([]);

    // Another rule's derivation of the same triple: its triple now asserted, it is still only proposed —
    // nothing leads to it — and opening the model again does not half-confirm it.
    store.addQuads([
      quad(namedNode('urn:d:sibling'), namedNode(RDF_TYPE), namedNode(AM4 + 'Flow')),
      quad(namedNode('urn:d:sibling'), namedNode(ARCH + 'source'), b),
      quad(namedNode('urn:d:sibling'), namedNode(ARCH + 'target'), c),
      quad(namedNode('urn:d:sibling'), namedNode(RDF_REIFIES), tripleTerm(b as never, namedNode(AM4 + 'flowsTo') as never, c as never) as never),
      ...derivation('urn:d:sibling', 'Potential', 'PDR9', 'urn:d:stated'),
    ] as never);
    session.adopt();
    expect(derivationStatus(store, 'urn:d:sibling')).toEqual({ certainty: 'potential', confirmed: false });
    expect(listed().get('urn:d:sibling')).toEqual({ certainty: 'potential', rule: 'PDR9' });
    expect(members('urn:d:sibling')).toEqual([]);
    expect(store.getQuads(null, null, nn('urn:d:sibling')).map((q) => q.predicate.value)).toEqual([]);
    // Confirming it adds what it lacks: the triple is there already.
    expect(confirmationQuads(store, 'urn:d:sibling', model).map((q) => q.predicate.value)).toEqual([AM4 + 'qualifiedFlow', ARCH + 'inModel']);
  });

  it('migrates retired vocabulary and element-level geometry on adopt', () => {
    const m = 'urn:old:model';
    store.addQuads([
      quad(namedNode(m), namedNode(RDF_TYPE), namedNode(ARCH + 'Model')),
      quad(namedNode(m), namedNode(ARCH + 'conformsToMetamodel'), namedNode('https://meta.linked.archi/archimate4/metamodel#ArchiMate4')),
      quad(namedNode('urn:old:e1'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:old:e1'), namedNode(ARCH + 'partOfModel'), namedNode(m)),
      quad(namedNode('urn:old:e1'), namedNode(VIS + 'bounds-x'), literal('100', namedNode(NAMESPACES.xsd + 'double'))),
      quad(namedNode('urn:old:e1'), namedNode(VIS + 'bounds-y'), literal('50', namedNode(NAMESPACES.xsd + 'double'))),
      quad(namedNode('urn:old:e2'), namedNode(RDF_TYPE), namedNode(AM4 + 'ApplicationComponent')),
      quad(namedNode('urn:old:qr'), namedNode(RDF_TYPE), namedNode(ARCH + 'QualifiedRelationship')),
      quad(namedNode('urn:old:qr'), namedNode(ARCH + 'relSource'), namedNode('urn:old:e1')),
      quad(namedNode('urn:old:qr'), namedNode(ARCH + 'relTarget'), namedNode('urn:old:e2')),
      quad(namedNode('urn:old:qr'), namedNode(ARCH + 'relPredicate'), namedNode(AM4 + 'serves')),
    ] as never);

    const result = session.adopt();

    expect(result.modelIri).toBe(m);
    expect(result.migration.renamed).toBeGreaterThanOrEqual(3);
    expect(result.migration.relationships).toBe(1);
    expect(result.migration.placements).toBe(1);
    expect(session.metamodelIris()).toEqual(['https://meta.linked.archi/archimate4/metamodel#ArchiMate4']);
    // Endpoint vocabulary and class type.
    expect(store.getQuads(nn('urn:old:qr'), nn(ARCH + 'source')).map((q) => q.object.value)).toEqual(['urn:old:e1']);
    expect(store.getQuads(nn('urn:old:qr'), nn(RDF_TYPE)).map((q) => q.object.value)).toContain(AM4 + 'Serving');
    expect(store.getQuads(nn('urn:old:e1'), nn(AM4 + 'serves'), nn('urn:old:e2'))).toHaveLength(1);
    // Geometry moved to a node; the element itself carries no bounds any more.
    expect(views.getNode(result.viewIri, 'urn:old:e1')?.bounds).toMatchObject({ x: 100, y: 50 });
    expect(store.getQuads(nn('urn:old:e1'), nn(VIS + 'bounds-x'))).toHaveLength(0);
    // No retired predicates survive.
    for (const old of ['partOfModel', 'conformsToMetamodel', 'relSource', 'relTarget', 'relPredicate']) {
      expect(store.getQuads(null, nn(ARCH + old)), old).toHaveLength(0);
    }
  });

  it('opens, creates, renames and deletes views, always leaving one open', () => {
    const { viewIri } = session.newModel();
    const second = session.createView('Diagram', { label: 'Second' });
    expect(session.activeViewIri).toBe(second);
    session.renameView(second, 'Renamed');
    expect(views.getView(second)?.label).toBe('Renamed');
    session.deleteView(second);
    expect(session.activeViewIri).toBe(viewIri);
    session.deleteView(viewIri);
    expect(session.activeViewIri).toBeDefined();
    expect(views.getView(session.activeViewIri as string)).toBeDefined();
  });

  it('creates a view with elements where given and the relationships among them, and opens it', () => {
    const { modelIri } = session.newModel();
    const a = elements.createElement(AM4 + 'ApplicationComponent', modelIri, { label: 'A' }).value;
    const b = elements.createElement(AM4 + 'ApplicationComponent', modelIri, { label: 'B' }).value;
    store.addQuads([
      quad(namedNode('urn:x:r'), namedNode(RDF_TYPE), namedNode(AM4 + 'Serving')),
      quad(namedNode('urn:x:r'), namedNode(ARCH + 'source'), namedNode(a)),
      quad(namedNode('urn:x:r'), namedNode(ARCH + 'target'), namedNode(b)),
    ]);
    emit.mockClear();
    const viewIri = session.createViewWith(
      'From a query',
      [
        { iri: a, bounds: { x: 40, y: 40, width: 120, height: 55 } },
        { iri: b, bounds: { x: 240, y: 40, width: 120, height: 55 } },
      ],
      ['urn:x:r'],
    );
    expect(views.getView(viewIri)).toMatchObject({ label: 'From a query', type: 'Diagram', modelIri });
    expect(views.getNode(viewIri, b)?.bounds).toEqual({ x: 240, y: 40, width: 120, height: 55 });
    expect(views.getLinks(viewIri).map((l) => l.relationshipIri)).toEqual(['urn:x:r']);
    expect(session.activeViewIri).toBe(viewIri);
    expect(emit).toHaveBeenCalledWith('views-changed', { viewIri });
    expect(emit).toHaveBeenCalledWith('view-opened', { viewIri });
  });

  it('renames the model with a language-tagged label', () => {
    const { modelIri } = session.newModel({ label: 'A' });
    session.renameModel('B');
    const labels = store.getQuads(nn(modelIri), nn(NAMESPACES.skos + 'prefLabel')).map((q) => q.object as Literal);
    expect(labels.map((l) => [l.value, l.language])).toEqual([['B', 'en']]);
  });
});
