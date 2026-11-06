/**
 * The Metamodels menu's list: meta.linked.archi's DCAT catalogue, bundled and
 * published.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CATALOGUE_IRI,
  CATALOGUE_KIND_LABELS,
  loadCatalogue,
  readCatalogue,
  type CatalogueEntry,
} from '../catalogue.js';
import { BundledAssetSource, parseRdf, type AssetSource } from '../asset-sources.js';
import { getBundledMetamodel } from '../bundled-assets.js';
import { createApp } from '../../app.js';

const PREFIXES = `
@prefix dcat:    <http://www.w3.org/ns/dcat#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix foaf:    <http://xmlns.com/foaf/0.1/> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .
@prefix arch:    <https://meta.linked.archi/core#> .
@prefix cat:     <https://meta.linked.archi/catalog#> .
`;

/** A catalogue holding one metamodel manifest per (theme, label) given. */
function catalogue(...metamodels: Array<[theme: string, iri: string, label: string]>): string {
  const themes = ['languages', 'frameworks', 'extensions', 'core', 'examples']
    .map((t) => `cat:${t} a skos:Concept ; skos:notation "${t}" ; skos:prefLabel "${t}"@en .`)
    .join('\n');
  const datasets = metamodels
    .map(
      ([theme, iri, label], i) => `
<https://meta.linked.archi/m${i}/metamodel> a dcat:Dataset ;
    dcterms:conformsTo arch:Metamodel ;
    dcat:theme cat:${theme} ;
    foaf:primaryTopic <${iri}> .
<${iri}> a arch:Metamodel ; skos:prefLabel "${label}"@en .`,
    )
    .join('\n');
  return PREFIXES + themes + datasets;
}

const read = (ttl: string) => readCatalogue(parseRdf(ttl, 'text/turtle', CATALOGUE_IRI));

/** A source that answers the catalogue IRI only. */
const source = (fetch: AssetSource['fetch']): AssetSource => ({ kind: 'remote', fetch });
const answering = (ttl: string) =>
  source(async (iri) =>
    iri === CATALOGUE_IRI ? { documentIri: iri, text: ttl, format: 'text/turtle', origin: 'remote' } : null,
  );

afterEach(() => vi.restoreAllMocks());

describe('readCatalogue', () => {
  it('offers the metamodels of the languages, frameworks, extensions and core sections, by section', () => {
    const entries = read(
      catalogue(
        ['frameworks', 'https://meta.linked.archi/togaf/metamodel#TOGAF10', 'TOGAF Metamodel'],
        ['languages', 'https://meta.linked.archi/c4/metamodel#C4Model', 'C4 Model Metamodel'],
        ['extensions', 'https://meta.linked.archi/ml-systems/metamodel#MLEnabledSystems', 'ML-Enabled Systems Metamodel'],
        ['examples', 'https://meta.linked.archi/examples/cloudplatform/metamodel#CloudPlatformMetamodel', 'Cloud Platform Metamodel'],
      ),
    );
    expect(entries).toEqual<CatalogueEntry[]>([
      { iri: 'https://meta.linked.archi/c4/metamodel#C4Model', label: 'C4 Model', kind: 'language' },
      { iri: 'https://meta.linked.archi/togaf/metamodel#TOGAF10', label: 'TOGAF', kind: 'framework' },
      { iri: 'https://meta.linked.archi/ml-systems/metamodel#MLEnabledSystems', label: 'ML-Enabled Systems', kind: 'extension' },
    ]);
  });

  it('orders a section by label, numbers by value', () => {
    const labels = read(
      catalogue(
        ['languages', 'https://meta.linked.archi/uml/metamodel#UML2', 'UML 2.5.1 Metamodel'],
        ['languages', 'https://meta.linked.archi/archimate4/metamodel#ArchiMate4', 'ArchiMate 4.0 Metamodel'],
        ['languages', 'https://meta.linked.archi/leanix/v3/metamodel#LeanIXv3', 'LeanIX Meta Model v3 Metamodel'],
        ['languages', 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2', 'ArchiMate 3.2 Metamodel'],
        ['languages', 'https://meta.linked.archi/leanix/metamodel#LeanIXv4', 'LeanIX Meta Model v4 Metamodel'],
      ),
    ).map((e) => e.label);
    expect(labels).toEqual(['ArchiMate 3.2', 'ArchiMate 4.0', 'LeanIX Meta Model v3', 'LeanIX Meta Model v4', 'UML 2.5.1']);
  });

  it('skips datasets that are not metamodel manifests, and lists a metamodel once', () => {
    const ttl =
      catalogue(['languages', 'https://meta.linked.archi/c4/metamodel#C4Model', 'C4 Model Metamodel']) +
      `
<https://meta.linked.archi/c4/onto> a dcat:Dataset ; dcterms:conformsTo <http://www.w3.org/2002/07/owl#Ontology> ;
    dcat:theme cat:languages ; foaf:primaryTopic <https://meta.linked.archi/c4/onto#> .
<https://meta.linked.archi/c4/metamodel-copy> a dcat:Dataset ; dcterms:conformsTo arch:Metamodel ;
    dcat:theme cat:languages ; foaf:primaryTopic <https://meta.linked.archi/c4/metamodel#C4Model> .`;
    expect(read(ttl).map((e) => e.iri)).toEqual(['https://meta.linked.archi/c4/metamodel#C4Model']);
  });

  it('takes the section from the theme IRI when the theme has no notation, and names an unlabelled metamodel by its IRI', () => {
    const ttl = `${PREFIXES}
<https://meta.linked.archi/x/metamodel> a dcat:Dataset ; dcterms:conformsTo arch:Metamodel ;
    dcat:theme cat:frameworks ; foaf:primaryTopic <https://meta.linked.archi/x/metamodel#X> .`;
    expect(read(ttl)[0]).toEqual({ iri: 'https://meta.linked.archi/x/metamodel#X', label: 'X', kind: 'framework' });
  });

  it('puts a metamodel of the Core section first', () => {
    const entries = read(
      catalogue(
        ['languages', 'https://meta.linked.archi/c4/metamodel#C4Model', 'C4 Model Metamodel'],
        ['core', 'https://meta.linked.archi/x/metamodel#X', 'X Metamodel'],
      ),
    );
    expect(entries.map((e) => [e.label, e.kind])).toEqual([['X', 'core'], ['C4 Model', 'language']]);
  });
});

describe('the bundled catalogue', () => {
  it('is read through the bundled source, by the catalogue IRI', async () => {
    const doc = await new BundledAssetSource().fetch(CATALOGUE_IRI);
    expect(doc).toMatchObject({ origin: 'bundled', location: 'catalog.ttl' });
  });

  it('lists the published metamodels — the bundled languages among them — once each, with a section title for every kind', async () => {
    const entries = (await loadCatalogue(new BundledAssetSource()))!;
    const iris = entries.map((e) => e.iri);
    expect(new Set(iris).size).toBe(iris.length);
    for (const entry of entries) expect(CATALOGUE_KIND_LABELS[entry.kind], entry.iri).toBeTruthy();
    for (const id of ['archimate4', 'archimate3', 'basic']) {
      const bundled = entries.find((e) => getBundledMetamodel(e.iri)?.id === id);
      expect(bundled?.kind, id).toBe('language');
    }
    expect(entries).toContainEqual({ iri: 'https://meta.linked.archi/basic/metamodel#Basic', label: 'Basic', kind: 'language' });
    expect(entries).toContainEqual({ iri: 'https://meta.linked.archi/4plus1/metamodel#FourPlusOneMetamodel', label: '4+1 View Model', kind: 'framework' });
    expect(entries).toContainEqual({
      iri: 'https://meta.linked.archi/ai-governance/metamodel#AIEthicsAndGovernance',
      label: 'AI Ethics & Governance',
      kind: 'extension',
    });
    // The examples' metamodels are not offered.
    expect(iris.some((iri) => iri.includes('/examples/'))).toBe(false);
  });
});

describe('App.loadCatalogue', () => {
  const published = catalogue(['languages', 'https://meta.linked.archi/new/metamodel#New', 'New Language Metamodel']);

  async function lists(catalogueSource?: AssetSource): Promise<CatalogueEntry[][]> {
    const app = await createApp({ assetMode: 'offline', ...(catalogueSource ? { catalogueSource } : {}) });
    const calls: CatalogueEntry[][] = [];
    await app.loadCatalogue((entries) => calls.push(entries));
    return calls;
  }

  it('hands over the bundled catalogue, then the published one', async () => {
    const calls = await lists(answering(published));
    expect(calls).toHaveLength(2);
    expect(calls[0].length).toBeGreaterThan(20);
    expect(calls[1].map((e) => e.label)).toEqual(['New Language']);
  });

  it('keeps the bundled catalogue offline, when the published one is not there, and when it cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await lists()).toHaveLength(1);
    expect(await lists(source(async () => null))).toHaveLength(1);
    expect(
      await lists(
        source(async () => {
          throw new Error('503 Service Unavailable');
        }),
      ),
    ).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('published catalogue'), expect.any(Error));
  });

  it('does not take a published catalogue with no metamodels', async () => {
    expect(await lists(answering(PREFIXES))).toHaveLength(1);
  });
}, 60_000);
