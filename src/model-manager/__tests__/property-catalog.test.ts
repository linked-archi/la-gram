import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { createApp, type App } from '../../app.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { typeClosure } from '../model-queries.js';
import { PropertyCatalog, curieOf } from '../property-catalog.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const ARCH = NAMESPACES.arch;

let app: App;
let catalog: PropertyCatalog;
let actor: string;

beforeAll(async () => {
  app = await createApp({ assetMode: 'offline' });
  const store = app.components.store;
  const closure = typeClosure(store);
  catalog = new PropertyCatalog(store, {
    closure: () => closure,
    prefixes: () => app.modelIO.collectPrefixes(app.session.modelIri),
    modelNamespace: () => app.session.namespace()!.namespace,
  });
  actor = app.components.elementManager.createElement(`${AM4}BusinessActor`, app.session.modelIri!, { label: 'Clerk' }).value;
}, 60_000);
afterAll(() => (app.components.store as { dispose?: () => void }).dispose?.());

describe('PropertyCatalog.suggest', () => {
  it('offers what applies to the type first, then documentation, then the rest', () => {
    const suggestions = catalog.suggest(actor);
    const groups = [...new Set(suggestions.map((s) => s.groupLabel))];
    expect(groups).toEqual(['For Business Actor', 'Documentation', 'More']);
    // arch:isAbstract has domain arch:Element, a superclass of Business Actor.
    expect(suggestions.find((s) => s.iri === ARCH + 'isAbstract')).toMatchObject({ group: 'type', curie: 'arch:isAbstract' });
    expect(suggestions.find((s) => s.iri === NAMESPACES.skos + 'altLabel')).toMatchObject({
      group: 'documentation',
      label: 'Alt label',
      curie: 'skos:altLabel',
    });
    expect(suggestions.find((s) => s.iri === ARCH + 'rationale')?.group).toBe('more');
  });

  it('never offers geometry, notation styling, metamodel authoring, or properties of other classes', () => {
    const iris = catalog.suggest(actor).map((s) => s.iri);
    expect(iris.some((i) => i.startsWith(NAMESPACES['arch-vis']))).toBe(false);
    for (const excluded of [
      ARCH + 'unqualifiedForm',
      ARCH + 'domainIncludes',
      ARCH + 'isAbstractClass',
      ARCH + 'sectionQuery', // a deliverable template's
      AM4 + 'accessType', // an Access relationship's
      NAMESPACES.rdf + 'type',
      ARCH + 'inModel',
      NAMESPACES.skos + 'prefLabel',
      NAMESPACES.skos + 'definition', // always listed in the panel, under the name
      NAMESPACES.dcterms + 'description', // says what the definition says
    ]) {
      expect(iris).not.toContain(excluded);
    }
  });

  it('offers a relationship its own properties: accessType for an Access', () => {
    const store = app.components.store;
    const access = `${app.session.namespace()!.namespace}relationship-test-access`;
    store.addQuads([
      DataFactory.quad(DataFactory.namedNode(access), DataFactory.namedNode(NAMESPACES.rdf + 'type'), DataFactory.namedNode(AM4 + 'Access')) as unknown as Quad,
    ]);
    const suggestions = catalog.suggest(access);
    expect(suggestions.find((s) => s.iri === AM4 + 'accessType')).toMatchObject({
      group: 'type',
      groupLabel: 'For Access',
      label: 'Access Type', // the vocabulary's own label
    });
    store.removeQuads(store.getQuads(DataFactory.namedNode(access) as never));
  });

  it('offers the properties the model already uses, custom ones included', () => {
    const store = app.components.store;
    const owner = `${app.session.namespace()!.namespace}owner`;
    const other = app.components.elementManager.createElement(`${AM4}BusinessRole`, app.session.modelIri!).value;
    store.addQuads([
      DataFactory.quad(DataFactory.namedNode(other), DataFactory.namedNode(owner), DataFactory.literal('Team A')) as unknown as Quad,
    ]);
    expect(catalog.suggest(actor).find((s) => s.iri === owner)).toMatchObject({
      group: 'model',
      groupLabel: 'Used in this model',
      label: 'Owner',
      curie: 'm:owner',
    });
    app.components.elementManager.deleteElement(other);
  });
});

describe('PropertyCatalog.resolve', () => {
  it('makes a plain name a property in the model namespace', () => {
    const ns = app.session.namespace()!.namespace;
    expect(catalog.resolve('owner')).toEqual({ iri: `${ns}owner`, curie: 'm:owner', label: 'Owner' });
    expect(catalog.resolve('cost center')).toMatchObject({ iri: `${ns}costCenter`, curie: 'm:costCenter' });
  });

  it('expands a known prefix and takes a full IRI as it is', () => {
    expect(catalog.resolve('dcterms:source')?.iri).toBe(NAMESPACES.dcterms + 'source');
    expect(catalog.resolve('am4:accessType')).toMatchObject({ iri: AM4 + 'accessType', curie: 'am4:accessType' });
    expect(catalog.resolve('https://example.com/vocab#budget')).toMatchObject({
      iri: 'https://example.com/vocab#budget',
      label: 'Budget',
    });
    expect(catalog.resolve('urn:acme:budget')?.iri).toBe('urn:acme:budget');
  });

  it('refuses what is none of those', () => {
    expect(catalog.resolve('')).toBeUndefined();
    expect(catalog.resolve('zz:unknownPrefix')).toBeUndefined();
    expect(catalog.resolve('cost (EUR)')).toBeUndefined();
  });
});

describe('curieOf', () => {
  it('uses the longest prefix whose local name Turtle can write', () => {
    const prefixes = { ex: 'https://ex.org/', exv: 'https://ex.org/v#' };
    expect(curieOf('https://ex.org/v#size', prefixes)).toBe('exv:size');
    expect(curieOf('https://ex.org/a/b', prefixes)).toBe('https://ex.org/a/b');
  });
});
