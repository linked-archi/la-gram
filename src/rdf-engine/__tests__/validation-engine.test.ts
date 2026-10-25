/**
 * Validation off the UI thread (Task 22): quads as plain data and back; the
 * engine's findings — the same as validating the store's data graph — kept up
 * to date by changes; the worker service coalescing requests.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { decodeQuads, encodeQuads } from '../term-codec.js';
import { ValidationEngine } from '../validation-engine.js';
import { WorkerValidationService, type WorkerLike } from '../validation-service.js';
import { RdfShaclValidator } from '../shacl-validator.js';
import { createApp, type App } from '../../app.js';
import { checkRelationshipsByTables } from '../../model-manager/relationship-validity.js';

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;
const AM4 = 'https://meta.linked.archi/archimate4/onto#';

describe('quads as plain data', () => {
  it('round-trip: IRIs, blank nodes, literals with a language or a datatype, triple terms, named graphs', () => {
    const quads = [
      quad(namedNode('https://ex.org/a'), namedNode('https://ex.org/p'), literal('say "hi"\nthere', 'en')),
      quad(blankNode('b1'), namedNode('https://ex.org/x'), literal('1.5', namedNode('http://www.w3.org/2001/XMLSchema#double'))),
      quad(
        namedNode('https://ex.org/r'),
        namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies'),
        quad(namedNode('https://ex.org/a'), namedNode('https://ex.org/p'), namedNode('https://ex.org/b'), defaultGraph()) as never,
      ),
      quad(namedNode('https://ex.org/a'), namedNode('https://ex.org/p'), namedNode('https://ex.org/b'), namedNode('https://ex.org/g')),
    ] as unknown as Quad[];
    const back = decodeQuads(JSON.parse(JSON.stringify(encodeQuads(quads))));
    back.forEach((q, i) => expect(q.equals(quads[i])).toBe(true));
  });
});

describe('the engine', () => {
  let app: App;
  let engine: ValidationEngine;
  const iri: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
    const { modelIri } = app.newModel('Engine');
    const { elementManager: e, relationshipManager: r } = app.components;
    iri.actor = e.createElement(AM4 + 'BusinessActor', modelIri, { label: 'Clerk' }).value;
    iri.role = e.createElement(AM4 + 'Role', modelIri, { label: 'Agent' }).value;
    iri.data = e.createElement(AM4 + 'DataObject', modelIri, { label: 'Order' }).value;
    iri.unnamed = e.createElement(AM4 + 'BusinessActor', modelIri).value; // a violation of the element shapes
    iri.assigned = r.createQualifiedRelationship({ typeIri: AM4 + 'Assignment', sourceIri: iri.actor, targetIri: iri.role }).iri;
    iri.bad = r.createQualifiedRelationship({ typeIri: AM4 + 'Serving', sourceIri: iri.data, targetIri: iri.actor }).iri;
    engine = new ValidationEngine();
    engine.setup((app as unknown as { validationSetup(s: Quad[]): never }).validationSetup(app.shapesGraph()));
    engine.load(encodeQuads(app.components.store.getQuads(null, null, null, defaultGraph() as never)));
  }, 120_000);

  const keys = (results: Array<{ focusNode: string | { value: string }; resultPath: string | { value: string } }>) =>
    new Set(results.map((r) => `${typeof r.focusNode === 'string' ? r.focusNode : r.focusNode.value} ${typeof r.resultPath === 'string' ? r.resultPath : r.resultPath.value}`));

  it('finds what validating the store’s data graph finds', () => {
    const data = app.validationDataGraph();
    const { split, tables, closure } = app.relationshipCheck();
    const expected = [...new RdfShaclValidator().validate(data, split.kept).results, ...checkRelationshipsByTables(data, split, tables, closure)];
    const report = engine.validate();
    expect(keys(report.results)).toEqual(keys(expected));
    expect(report.conforms).toBe(false);
    expect([...keys(report.results)].some((k) => k.startsWith(iri.bad))).toBe(true);
    expect([...keys(report.results)].some((k) => k.startsWith(iri.unnamed))).toBe(true);
  });

  it('follows changes: a relationship removed takes its findings with it', () => {
    const removed = app.components.store.getQuads(namedNode(iri.bad) as never, null, null, defaultGraph() as never);
    const direct = app.components.store.getQuads(namedNode(iri.data) as never, namedNode(AM4 + 'serves') as never, null);
    engine.apply([], encodeQuads([...removed, ...direct]));
    expect([...keys(engine.validate().results)].some((k) => k.startsWith(iri.bad) || k.startsWith(`${iri.data} `))).toBe(false);
    engine.apply(encodeQuads([...removed, ...direct]), []);
    expect([...keys(engine.validate().results)].some((k) => k.startsWith(iri.bad))).toBe(true);
  });

  it('an empty model, or no setup yet, conforms', () => {
    expect(new ValidationEngine().validate()).toMatchObject({ conforms: true, results: [] });
  });
});

describe('what the engine validates besides the model', () => {
  const ex = (s: string) => namedNode(`https://ex.org/${s}`);
  const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
  const SUB = namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf');
  const meta = namedNode('https://ex.org/metamodel');
  const holds = (engine: ValidationEngine, q: Quad) => (engine as unknown as { data: { has(q: Quad): boolean } }).data.has(q);
  const sub = quad(ex('Actor'), SUB, ex('Element')) as unknown as Quad;
  const viewpointType = quad(ex('vp'), RDF_TYPE, ex('Viewpoint')) as unknown as Quad;
  const view = quad(ex('v1'), ex('viewpoint'), ex('vp')) as unknown as Quad;
  const otherView = quad(ex('v2'), ex('viewpoint'), ex('vp')) as unknown as Quad;

  function engineWith(model: Quad[]): ValidationEngine {
    const engine = new ValidationEngine();
    engine.load(encodeQuads(model));
    engine.setup({
      shapes: [],
      hierarchy: encodeQuads([quad(ex('Actor'), SUB, ex('Element'), meta) as unknown as Quad]),
      outsideTypes: encodeQuads([quad(ex('vp'), RDF_TYPE, ex('Viewpoint'), meta) as unknown as Quad]),
      unqualifiedForms: [],
      tables: null,
    });
    return engine;
  }

  it('the class hierarchy, in the default graph; the model is counted alone', () => {
    const engine = engineWith([quad(ex('a'), RDF_TYPE, ex('Actor')) as unknown as Quad]);
    expect(holds(engine, sub)).toBe(true);
    expect(engine.size).toBe(1);
  });

  it('a quad the model and the hierarchy both hold stays until neither does', () => {
    const engine = engineWith([sub]);
    expect(engine.size).toBe(1);
    engine.apply([], encodeQuads([sub]));
    expect(holds(engine, sub)).toBe(true);
    expect(engine.size).toBe(0);
    engine.apply(encodeQuads([sub]), []);
    engine.setup({ shapes: [], hierarchy: [], outsideTypes: [], unqualifiedForms: [], tables: null });
    expect(holds(engine, sub)).toBe(true);
    engine.apply([], encodeQuads([sub]));
    expect(holds(engine, sub)).toBe(false);
  });

  it('an outside resource’s types, while the model refers to it', () => {
    const engine = engineWith([view]);
    expect(holds(engine, viewpointType)).toBe(true);
    engine.apply(encodeQuads([otherView]), encodeQuads([view]));
    expect(holds(engine, viewpointType)).toBe(true);
    engine.apply([], encodeQuads([otherView]));
    expect(holds(engine, viewpointType)).toBe(false);
    engine.apply(encodeQuads([view]), []);
    expect(holds(engine, viewpointType)).toBe(true);
    expect(engine.size).toBe(1);
  });

  it('a type in the model is not a reference', () => {
    const engine = engineWith([quad(ex('x'), RDF_TYPE, ex('vp')) as unknown as Quad]);
    expect(holds(engine, viewpointType)).toBe(false);
  });
});

/** A worker the test answers by hand. */
function fakeWorker() {
  const posted: Array<{ type: string; id?: number }> = [];
  const worker: WorkerLike = {
    postMessage: (m) => void posted.push(m as never),
    onmessage: null,
    onerror: null,
    terminate: vi.fn(),
  };
  const report = (id: number, focus: string) =>
    worker.onmessage?.({
      data: {
        type: 'report',
        id,
        report: {
          conforms: false,
          results: [{ focusNode: focus, resultPath: '', sourceShape: 'https://ex.org/S', message: 'm', severity: 'Violation' }],
          timing: { shacl: 2, tables: 3 },
        },
      },
    });
  return { worker, posted, report };
}

describe('the worker service', () => {
  it('posts the setup, the model and its changes, in order, before a validation', () => {
    const { worker, posted } = fakeWorker();
    const service = new WorkerValidationService(worker);
    service.setup({ shapes: [], hierarchy: [], outsideTypes: [], unqualifiedForms: [], tables: null });
    service.load([]);
    service.apply([['https://ex.org/a', 'https://ex.org/p', 'https://ex.org/b']], []);
    void service.validate();
    expect(posted.map((m) => m.type)).toEqual(['setup', 'load', 'apply', 'validate']);
  });

  it('a validation runs to its end; asked again meanwhile, it runs once more and earlier callers are superseded', async () => {
    const { worker, posted, report } = fakeWorker();
    const service = new WorkerValidationService(worker);
    const first = service.validate();
    const second = service.validate();
    const third = service.validate();
    expect(posted.filter((m) => m.type === 'validate')).toHaveLength(1);
    report(1, 'https://ex.org/stale');
    expect(posted.filter((m) => m.type === 'validate').map((m) => m.id)).toEqual([1, 2]);
    report(2, 'https://ex.org/fresh');
    expect(await first).toBeUndefined();
    expect(await second).toBeUndefined();
    expect((await third)?.results[0].focusNode.value).toBe('https://ex.org/fresh');
  });

  it('an answer to an old request is ignored; a failure resolves nothing and the next one runs', async () => {
    const { worker, posted, report } = fakeWorker();
    const service = new WorkerValidationService(worker);
    const failed = service.validate();
    worker.onmessage?.({ data: { type: 'error', id: 1, message: 'boom' } });
    expect(await failed).toBeUndefined();
    const next = service.validate();
    report(1, 'https://ex.org/old');
    report(2, 'https://ex.org/now');
    expect((await next)?.results[0].focusNode.value).toBe('https://ex.org/now');
    expect(posted.filter((m) => m.type === 'validate')).toHaveLength(2);
  });
});
