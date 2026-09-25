import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Literal } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphViewManager } from '../view-manager.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { ModelSession, DEFAULT_VIEW_LABEL } from '../model-session.js';
import { readModelContents, modelQuads } from '../model-queries.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;
const ARCH = NAMESPACES.arch;
const VIS = NAMESPACES['arch-vis'];
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const RDF_TYPE = NAMESPACES.rdf + 'type';

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
    expect(modelIri).toMatch(/^urn:la-gram:archimate\/[0-9a-f-]{36}$/);
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

  it('renames the model with a language-tagged label', () => {
    const { modelIri } = session.newModel({ label: 'A' });
    session.renameModel('B');
    const labels = store.getQuads(nn(modelIri), nn(NAMESPACES.skos + 'prefLabel')).map((q) => q.object as Literal);
    expect(labels.map((l) => [l.value, l.language])).toEqual([['B', 'en']]);
  });
});
