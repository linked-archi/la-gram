import { describe, it, expect, vi } from 'vitest';
import { DataFactory } from 'n3';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../metamodel-loader.js';
import {
  BundledAssetSource,
  ChainedAssetSource,
  RemoteAssetSource,
  UploadedAssetSource,
  createAssetSource,
  dereferenceUrl,
  detectFormat,
  parseRdf,
  type FetchLike,
} from '../asset-sources.js';

const { namedNode } = DataFactory;

/** A fetch stub answering from a map of URL → Turtle, 404 otherwise. */
function fakeFetch(documents: Record<string, string>): FetchLike & { calls: Array<{ url: string; accept?: string }> } {
  const calls: Array<{ url: string; accept?: string }> = [];
  const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, accept: init?.headers?.Accept });
    const body = documents[url];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      statusText: body !== undefined ? 'OK' : 'Not Found',
      url,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/turtle' : null) },
      text: async () => body ?? '<html>not found</html>',
    };
  }) as FetchLike & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

describe('asset source helpers', () => {
  it('dereferences a document IRI without its fragment', () => {
    expect(dereferenceUrl('https://meta.linked.archi/archimate4/onto#')).toBe(
      'https://meta.linked.archi/archimate4/onto',
    );
    expect(dereferenceUrl('https://example.org/doc')).toBe('https://example.org/doc');
  });

  it('detects formats from media types and file names', () => {
    expect(detectFormat('text/turtle; charset=utf-8')).toBe('text/turtle');
    expect(detectFormat('application/ld+json')).toBe('application/ld+json');
    expect(detectFormat(null, 'model.trig')).toBe('application/trig');
    expect(detectFormat(null, 'onto.owl')).toBe('application/rdf+xml');
    expect(detectFormat(undefined, 'x.nq')).toBe('application/n-quads');
    expect(detectFormat(undefined, 'x')).toBe('text/turtle');
  });

  it('parses JSON-LD and RDF/XML through Oxigraph into n3 terms', () => {
    const jsonld = JSON.stringify({
      '@id': 'https://example.org/a',
      'http://www.w3.org/2004/02/skos/core#prefLabel': { '@value': 'A', '@language': 'en' },
    });
    const quads = parseRdf(jsonld, 'application/ld+json');
    expect(quads).toHaveLength(1);
    expect(quads[0].subject.value).toBe('https://example.org/a');
    expect((quads[0].object as { language?: string }).language).toBe('en');

    const rdfxml = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns:skos="http://www.w3.org/2004/02/skos/core#">
        <rdf:Description rdf:about="https://example.org/b"><skos:prefLabel>B</skos:prefLabel></rdf:Description>
      </rdf:RDF>`;
    expect(parseRdf(rdfxml, 'application/rdf+xml')[0].object.value).toBe('B');
  });
});

describe('RemoteAssetSource', () => {
  it('sends exactly one Accept type — the server 404s on q-valued lists', async () => {
    const fetchImpl = fakeFetch({ 'https://meta.linked.archi/x/onto': '<https://e/s> <https://e/p> "o" .' });
    const source = new RemoteAssetSource({ fetchImpl });
    const doc = await source.fetch('https://meta.linked.archi/x/onto#');
    expect(doc?.origin).toBe('remote');
    expect(fetchImpl.calls[0]).toEqual({ url: 'https://meta.linked.archi/x/onto', accept: 'text/turtle' });
  });

  it('treats a 404 or an HTML error page as absent, not broken', async () => {
    const source = new RemoteAssetSource({ fetchImpl: fakeFetch({}) });
    await expect(source.fetch('https://meta.linked.archi/missing#')).resolves.toBeNull();
  });

  it('refuses IRIs outside the allowed prefixes and non-http IRIs', async () => {
    const fetchImpl = fakeFetch({});
    const source = new RemoteAssetSource({ fetchImpl, allowedPrefixes: ['https://meta.linked.archi/'] });
    await expect(source.fetch('https://evil.example/doc#')).resolves.toBeNull();
    await expect(source.fetch('urn:x:y')).resolves.toBeNull();
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('ChainedAssetSource', () => {
  it('prefers an uploaded document over the bundle', async () => {
    const uploaded = new UploadedAssetSource();
    uploaded.add('https://meta.linked.archi/core#', '<https://e/s> <https://e/p> "local" .');
    const chain = new ChainedAssetSource([uploaded, new BundledAssetSource()]);
    const doc = await chain.fetch('https://meta.linked.archi/core#');
    expect(doc?.origin).toBe('uploaded');
  });

  it('falls back to the bundle when the network throws', async () => {
    const failing = { kind: 'remote' as const, fetch: vi.fn().mockRejectedValue(new Error('offline')) };
    const chain = new ChainedAssetSource([failing, new BundledAssetSource()]);
    const doc = await chain.fetch('https://meta.linked.archi/archimate4/onto#');
    expect(doc?.origin).toBe('bundled');
    expect(failing.fetch).toHaveBeenCalledOnce();
  });

  it('orders the sources by mode', () => {
    expect(createAssetSource('offline').sources.map((s) => s.kind)).toEqual(['uploaded', 'bundled']);
    expect(createAssetSource('remote-first').sources.map((s) => s.kind)).toEqual([
      'uploaded',
      'remote',
      'bundled',
    ]);
    expect(createAssetSource('bundled-first').sources.map((s) => s.kind)).toEqual([
      'uploaded',
      'bundled',
      'remote',
    ]);
  });
});

describe('N3MetamodelLoader with sources', () => {
  it('loads the bundled ArchiMate 3.2 metamodel by id', async () => {
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store);
    const loaded = await loader.loadBundledMetamodel('archimate3');
    expect(loaded.metamodelIri).toBe('https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2');
    expect(loaded.assets.filter((a) => a.outcome === 'error')).toEqual([]);
    expect(loaded.graphsByRole.ontology).toEqual(['https://meta.linked.archi/archimate3/onto#']);
    expect(loaded.presentationContextSchemeIri).toBe(
      'https://meta.linked.archi/archimate3/presentation-contexts#ArchiMatePresentationContexts',
    );
  });

  it('loads a remote-only metamodel by IRI and reports unreachable parts as unavailable', async () => {
    const manifest = `
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix arch: <https://meta.linked.archi/core#> .
      <https://meta.linked.archi/toy/metamodel#> a owl:Ontology ; owl:imports <https://meta.linked.archi/core#> .
      <https://meta.linked.archi/toy/metamodel#Toy> a arch:Metamodel ;
        arch:modelConcepts <https://meta.linked.archi/toy/onto#> ;
        arch:conceptClassification <https://meta.linked.archi/toy/tax#> .`;
    const onto = `
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      <https://meta.linked.archi/toy/onto#> a owl:Ontology .
      <https://meta.linked.archi/toy/onto#Thing> a owl:Class .`;
    const fetchImpl = fakeFetch({
      'https://meta.linked.archi/toy/metamodel': manifest,
      'https://meta.linked.archi/toy/onto': onto,
    });
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(
      new N3TtlParser(),
      store,
      createAssetSource('remote-first', new UploadedAssetSource(), { fetchImpl }),
    );

    const loaded = await loader.loadMetamodelByIri('https://meta.linked.archi/toy/metamodel#Toy');

    expect(loaded.metamodelIri).toBe('https://meta.linked.archi/toy/metamodel#Toy');
    const onto_ = loaded.assets.find((a) => a.documentIri === 'https://meta.linked.archi/toy/onto#');
    expect(onto_).toMatchObject({ outcome: 'loaded', origin: 'remote', role: 'ontology' });
    // Not on the (fake) network, not bundled: honestly reported.
    const tax = loaded.assets.find((a) => a.documentIri === 'https://meta.linked.archi/toy/tax#');
    expect(tax?.outcome).toBe('unavailable');
    // The core import is not on the fake network either, so the bundle answers.
    const core = loaded.assets.find((a) => a.documentIri === 'https://meta.linked.archi/core#');
    expect(core).toMatchObject({ outcome: 'loaded', origin: 'bundled' });
    expect(
      store.getQuads(null, null, null, namedNode('https://meta.linked.archi/toy/onto#')).length,
    ).toBeGreaterThan(0);
  });

  it('unloads a metamodel but keeps the shared core graphs and any graph another metamodel uses', async () => {
    const store = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), store);
    const am4 = await loader.loadBundledMetamodel('archimate4');
    const am3 = await loader.loadBundledMetamodel('archimate3');

    const dropped = loader.unloadMetamodel(am3, [am4]);

    expect(dropped).toContain('https://meta.linked.archi/archimate3/onto#');
    expect(store.getQuads(null, null, null, namedNode('https://meta.linked.archi/archimate3/onto#'))).toHaveLength(0);
    expect(store.getQuads(null, null, null, namedNode('https://meta.linked.archi/core#')).length).toBeGreaterThan(0);
    expect(store.getQuads(null, null, null, namedNode('https://meta.linked.archi/archimate4/onto#')).length).toBeGreaterThan(0);
    // Reloadable after an unload: the dedup set forgot it.
    const again = await loader.loadBundledMetamodel('archimate3');
    expect(again.assets.find((a) => a.role === 'ontology')?.outcome).toBe('loaded');
  });

  it('loads the core shapes on request', async () => {
    const loader = new N3MetamodelLoader(new N3TtlParser(), new OxigraphRdfStore());
    const graphs = await loader.loadCoreAssets();
    expect(graphs.coreShapes?.sort()).toEqual([
      'https://meta.linked.archi/core-shapes#',
      'https://meta.linked.archi/core-vis-shapes#',
    ]);
  });

  it('loads an uploaded standalone document and infers its role', async () => {
    const loader = new N3MetamodelLoader(new N3TtlParser(), new OxigraphRdfStore());
    const status = await loader.loadDocument(`
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      <https://example.org/ext-shapes#> a owl:Ontology .
      <https://example.org/ext-shapes#S> a sh:NodeShape .`);
    expect(status).toMatchObject({
      documentIri: 'https://example.org/ext-shapes#',
      role: 'shapes',
      outcome: 'loaded',
      origin: 'uploaded',
    });
  });
});
