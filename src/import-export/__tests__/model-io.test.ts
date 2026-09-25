import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Parser as N3Parser } from 'n3';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphElementManager } from '../../model-manager/element-manager.js';
import { OxigraphRelationshipManager } from '../../model-manager/relationship-manager.js';
import { OxigraphViewManager } from '../../model-manager/view-manager.js';
import { ModelSession } from '../../model-manager/model-session.js';
import { modelQuads } from '../../model-manager/model-queries.js';
import { ModelIO, MODEL_FORMATS, partitionGraphs, partitionModel } from '../model-io.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';

/**
 * One store with the metamodel for the whole file; each test replaces only the
 * model data (the default graph). Copying 40 000 metamodel quads per test would
 * dominate the run.
 */
let shared: OxigraphRdfStore;
beforeAll(async () => {
  shared = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), shared).loadBundledMetamodel('archimate4');
}, 30_000);
afterAll(() => shared.dispose());

/** A small model: two components, a serving relationship, one view with a routed link. */
function buildModel() {
  const store = shared;
  const elements = new OxigraphElementManager(store);
  const rels = new OxigraphRelationshipManager(store);
  const views = new OxigraphViewManager(store);
  const session = new ModelSession(store, elements, views);
  const { modelIri, viewIri } = session.newModel({
    label: 'Shop',
    metamodelIris: ['https://meta.linked.archi/archimate4/metamodel#ArchiMate4'],
  });
  const a = elements.createElement(AM4 + 'ApplicationComponent', modelIri, { label: 'Web' }).value;
  const b = elements.createElement(AM4 + 'ApplicationComponent', modelIri, { label: 'API' }).value;
  const rel = rels.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: b, targetIri: a, modelIri });
  views.addElementToView(viewIri, a, { x: 0, y: 0, width: 120, height: 55 });
  views.addElementToView(viewIri, b, { x: 200, y: 0, width: 120, height: 55 });
  views.addRelationshipToView(viewIri, rel.iri, [{ x: 200, y: 27 }, { x: 120, y: 27 }]);
  return { store, modelIri, viewIri, io: new ModelIO(store), views };
}

describe('ModelIO', () => {
  let ctx: ReturnType<typeof buildModel>;
  beforeEach(() => {
    ctx = buildModel();
  });

  it('writes only the model, never the metamodel', () => {
    const ttl = ctx.io.serialize(ctx.modelIri, { format: 'turtle' });
    const quads = new N3Parser().parse(ttl);
    expect(quads.length).toBe(modelQuads(ctx.store).length);
    expect(ttl).not.toContain('owl:Ontology');
  });

  it('uses prefixes the loaded vocabularies declare via vann, and only those it needs', () => {
    const ttl = ctx.io.serialize(ctx.modelIri, { format: 'turtle' });
    expect(ttl).toContain('@prefix am4: <https://meta.linked.archi/archimate4/onto#>');
    expect(ttl).toContain('am4:ApplicationComponent');
    expect(ttl).not.toContain('@prefix sh:');
  });

  it('partitions TriG into the DD-15 model / semantic / views graphs', () => {
    const trig = ctx.io.serialize(ctx.modelIri, { format: 'trig' });
    const quads = new N3Parser({ format: 'application/trig' }).parse(trig);
    const graphs = partitionGraphs(ctx.modelIri);
    const byGraph = (g: string) => quads.filter((q) => q.graph.value === g);
    expect(byGraph(graphs.model).every((q) => q.subject.value === ctx.modelIri)).toBe(true);
    expect(byGraph(graphs.views).length).toBeGreaterThan(0);
    expect(
      byGraph(graphs.views).every(
        (q) => q.subject.value.startsWith(ctx.viewIri + '/'),
      ),
    ).toBe(true);
    // The arch:View resource is a model concept: semantic, not views.
    expect(byGraph(graphs.semantic).some((q) => q.subject.value === ctx.viewIri)).toBe(true);
    expect(byGraph(graphs.model).length + byGraph(graphs.semantic).length + byGraph(graphs.views).length).toBe(
      quads.length,
    );
  });

  it('drops the geometry in the no-geometry profile and keeps the views and membership', () => {
    const ttl = ctx.io.serialize(ctx.modelIri, { format: 'turtle', profile: 'no-geometry' });
    expect(ttl).not.toContain('arch-vis:');
    expect(ttl).toContain('arch:inView');
    expect(ttl).toContain('arch:Diagram');
  });

  it.each(MODEL_FORMATS.map((f) => f.id))('round-trips through %s', (format) => {
    const before = modelQuads(ctx.store).length;
    const text = ctx.io.serialize(ctx.modelIri, { format });
    const info = MODEL_FORMATS.find((f) => f.id === format)!;
    const result = ctx.io.load(text, `model.${info.extension}`);
    expect(result.quadCount).toBe(before);
    // Everything lands back in the default graph, and the view is intact.
    expect(modelQuads(ctx.store).length).toBe(before);
    expect(ctx.views.getLinks(ctx.viewIri)[0].waypoints).toHaveLength(2);
  });

  it('is deterministic: the same model serializes to the same text', () => {
    expect(ctx.io.serialize(ctx.modelIri, { format: 'trig' })).toBe(ctx.io.serialize(ctx.modelIri, { format: 'trig' }));
  });

  it('partitions point-list cells with the geometry they belong to', () => {
    const partition = partitionModel(modelQuads(ctx.store), ctx.modelIri);
    const rdfFirst = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
    expect(partition.semantic.some((q) => q.predicate.value === rdfFirst)).toBe(false);
    expect(partition.views.some((q) => q.predicate.value === rdfFirst)).toBe(true);
  });
});
