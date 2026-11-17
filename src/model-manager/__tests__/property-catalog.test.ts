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

  it('offers a relationship its own properties: influenceStrength for an Influence', () => {
    const store = app.components.store;
    const influence = `${app.session.namespace()!.namespace}relationship-test-influence`;
    store.addQuads([
      DataFactory.quad(DataFactory.namedNode(influence), DataFactory.namedNode(NAMESPACES.rdf + 'type'), DataFactory.namedNode(AM4 + 'Influence')) as unknown as Quad,
    ]);
    const suggestions = catalog.suggest(influence);
    expect(suggestions.find((s) => s.iri === AM4 + 'influenceStrength')).toMatchObject({
      group: 'type',
      groupLabel: 'For Influence',
      label: 'Influence Strength', // the vocabulary's own label
    });
    store.removeQuads(store.getQuads(DataFactory.namedNode(influence) as never));
  });

  it('does not offer a deprecated property: accessType, replaced by the kinds of access', () => {
    const store = app.components.store;
    for (const kind of ['Access', 'ReadAccess']) {
      const access = `${app.session.namespace()!.namespace}relationship-test-${kind}`;
      store.addQuads([
        DataFactory.quad(DataFactory.namedNode(access), DataFactory.namedNode(NAMESPACES.rdf + 'type'), DataFactory.namedNode(AM4 + kind)) as unknown as Quad,
      ]);
      expect(catalog.suggest(access).map((s) => s.iri)).not.toContain(AM4 + 'accessType');
      store.removeQuads(store.getQuads(DataFactory.namedNode(access) as never));
    }
    // It can still be typed.
    expect(catalog.resolve('am4:accessType')?.iri).toBe(AM4 + 'accessType');
  });

  it('offers a link whose shape lists its values (sh:in) as an attribute, but not a relationship predicate', () => {
    const store = app.components.store;
    const g = DataFactory.namedNode('https://example.org/test-shapes#');
    const nn = DataFactory.namedNode;
    const EX = 'https://example.org/test#';
    const SH = NAMESPACES.sh;
    const q = (s: string, p: string, o: string) => DataFactory.quad(nn(s), nn(p), nn(o), g) as unknown as Quad;
    const added = [
      // Both links are object properties; only the first has its values listed.
      q(`${EX}kind`, NAMESPACES.rdf + 'type', NAMESPACES.owl + 'ObjectProperty'),
      q(`${EX}servedBy`, NAMESPACES.rdf + 'type', NAMESPACES.owl + 'ObjectProperty'),
      q(`${EX}Shape`, SH + 'targetClass', `${AM4}BusinessActor`),
      q(`${EX}Shape`, SH + 'property', `${EX}kindShape`),
      q(`${EX}kindShape`, SH + 'path', `${EX}kind`),
      q(`${EX}kindShape`, SH + 'in', `${EX}list`),
      q(`${EX}list`, NAMESPACES.rdf + 'first', `${EX}Internal`),
      q(`${EX}list`, NAMESPACES.rdf + 'rest', NAMESPACES.rdf + 'nil'),
      q(`${EX}Shape`, SH + 'property', `${EX}servedShape`),
      q(`${EX}servedShape`, SH + 'path', `${EX}servedBy`),
    ];
    store.addQuads(added);
    const suggestions = catalog.suggest(actor);
    expect(suggestions.find((s) => s.iri === `${EX}kind`)?.group).toBe('type');
    expect(suggestions.find((s) => s.iri === `${EX}servedBy`)).toBeUndefined();
    store.removeQuads(added);
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

describe('PropertyCatalog.takesLinks', () => {
  it('says which properties take a resource rather than text: the vocabulary’s object properties and class ranges, and the documentation links', () => {
    expect(catalog.takesLinks(ARCH + 'inModel')).toBe(true); // an object property
    expect(catalog.takesLinks(NAMESPACES.rdfs + 'seeAlso')).toBe(true);
    expect(catalog.takesLinks(NAMESPACES.prov + 'wasDerivedFrom')).toBe(true);
    expect(catalog.takesLinks(ARCH + 'isAbstract')).toBe(false); // a boolean
    expect(catalog.takesLinks(NAMESPACES.skos + 'altLabel')).toBe(false);
    expect(catalog.takesLinks('https://example.org/m/owner')).toBe(false); // unknown: text
  });
});

describe('curieOf', () => {
  it('uses the longest prefix whose local name Turtle can write', () => {
    const prefixes = { ex: 'https://ex.org/', exv: 'https://ex.org/v#' };
    expect(curieOf('https://ex.org/v#size', prefixes)).toBe('exv:size');
    expect(curieOf('https://ex.org/a/b', prefixes)).toBe('https://ex.org/a/b');
  });
});

describe('PropertyCatalog.suggest — links', () => {
  const AD = 'https://meta.linked.archi/arch-decision#';
  let decisionApp: App;
  let decisionCatalog: PropertyCatalog;
  let decision: string;
  let issue: string;

  beforeAll(async () => {
    decisionApp = await createApp({ assetMode: 'offline' });
    await decisionApp.loadMetamodel('https://meta.linked.archi/arch-decision/metamodel#ArchitectureDecisions');
    const store = decisionApp.components.store;
    const closure = typeClosure(store);
    decisionCatalog = new PropertyCatalog(store, {
      closure: () => closure,
      prefixes: () => decisionApp.modelIO.collectPrefixes(decisionApp.session.modelIri),
      modelNamespace: () => decisionApp.session.namespace()!.namespace,
    });
    const make = (type: string, label: string) =>
      decisionApp.components.elementManager.createElement(AD + type, decisionApp.session.modelIri!, { label }).value;
    decision = make('Decision', 'Payment routing');
    issue = make('Issue', 'How to route payments');
  }, 60_000);
  afterAll(() => (decisionApp.components.store as { dispose?: () => void }).dispose?.());

  it('offers a link its vocabulary gives the type, and none a relationship class draws', () => {
    const offered = new Map(decisionCatalog.suggest(decision).map((s) => [s.iri, s.group]));
    // Links for a decision, typed rather than drawn.
    expect(offered.get(AD + 'hasDecisionGoal')).toBe('type');
    expect(offered.get(AD + 'pertainsTo')).toBe('type');
    // To another decision: drawn, as Related Decision, so not a property.
    expect(offered.has(AD + 'relatedDecision')).toBe(false);
    expect(offered.has(AD + 'supersededBy')).toBe(false);
    // Drawn: the form of a relationship class, and its qualified predicate.
    expect(offered.has(AD + 'hasSelectedOption')).toBe(false);
    expect(offered.has(AD + 'qualifiedHasSelectedOption')).toBe(false);
    expect(offered.has(AD + 'hasIssue')).toBe(false);
    // A link of another type is not offered at all.
    expect(offered.has(AD + 'hasRisk')).toBe(false);
  });

  it('nor the declared inverse of a drawn link', () => {
    // ad:hasDecision is owl:inverseOf the drawn ad:hasIssue, from the issue's side.
    const offered = decisionCatalog.suggest(issue).map((s) => s.iri);
    expect(offered).not.toContain(AD + 'hasDecision');
  });
});
