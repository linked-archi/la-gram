/**
 * Which relationship types are offered between elements of different languages (DD-40): a language's own types
 * relate its own elements, the core's are offered between two languages, an extension's type that names any concept
 * at one end still relates any, and an abstract type is never offered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { BundledAssetSource, ChainedAssetSource, UploadedAssetSource } from '../../metamodel-manager/asset-sources.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const ARCH = NAMESPACES.arch;
const A = 'https://example.org/a#';
const B = 'https://example.org/b#';
const C = 'https://example.org/c#';
const CD = 'https://example.org/c/deploy#';
const X = 'https://example.org/ext#';
const CORE_TYPES = [`${ARCH}Association`, `${ARCH}DependsOn`, `${ARCH}HasPart`, `${ARCH}Refines`];

const PREFIXES = `
  @prefix owl:  <${NAMESPACES.owl}> .
  @prefix rdf:  <${NAMESPACES.rdf}> .
  @prefix rdfs: <${NAMESPACES.rdfs}> .
  @prefix skos: <${NAMESPACES.skos}> .
  @prefix arch: <${ARCH}> .
`;

/** A relationship type: its predicate, with these hints, and its class. */
const relationship = (ns: string, name: string, predicate: string, domain: string[], range: string[], extra = '') => `
  <${ns}${predicate}> rdf:type owl:ObjectProperty
    ${domain.map((d) => `; arch:domainIncludes <${d}>`).join(' ')}
    ${range.map((r) => `; arch:rangeIncludes <${r}>`).join(' ')} .
  <${ns}${name}> rdf:type owl:Class ; rdfs:subClassOf ${extra || 'arch:QualifiedRelationship'} ;
    arch:unqualifiedForm <${ns}${predicate}> ; skos:prefLabel "${name}"@en .
`;

/** An ontology document of element classes and relationship types. */
const ontology = (ns: string, body: string, imports: string[] = []) => `${PREFIXES}
  <${ns}> rdf:type owl:Ontology ;
    owl:imports <https://meta.linked.archi/core#> ${imports.map((i) => `, <${i}>`).join('')} .
  ${body}
`;

const element = (iri: string, superclass = `${ARCH}Element`) =>
  `<${iri}> rdf:type owl:Class ; rdfs:subClassOf <${superclass}> ; skos:prefLabel "${iri.slice(iri.indexOf('#') + 1)}"@en .`;

/** A manifest naming its concept documents: `https://example.org/a/metamodel#Language` for language A. */
const manifest = (ns: string, ...concepts: string[]) => {
  const document = `${ns.slice(0, -1)}/metamodel#`;
  return `${PREFIXES}
  <${document}> rdf:type owl:Ontology ; owl:imports <https://meta.linked.archi/core#> .
  <${document}Language> rdf:type arch:Metamodel ; skos:prefLabel "Language ${ns}" ;
    arch:modelConcepts ${concepts.map((c) => `<${c}>`).join(', ')} .
`;
};

/** Language A: a box and a crate, a link whose hints name only core classes, an abstract edge and its flow. */
const A_ONTO = ontology(
  A,
  `${element(`${A}Box`)}
   ${element(`${A}Crate`, `${A}Box`)}
   ${relationship(A, 'Link', 'links', [`${ARCH}Element`], [`${ARCH}Element`])}
   <${A}Edge> rdf:type owl:Class ; rdfs:subClassOf arch:QualifiedRelationship ; arch:isAbstractClass true ;
     skos:prefLabel "Edge"@en .
   ${relationship(A, 'Flow', 'flowsTo', [`${A}Box`], [`${A}Box`], `<${A}Edge>`)}`,
);
/** Language B: a thing, and a tie with no hints at all. */
const B_ONTO = ontology(B, `${element(`${B}Thing`)} ${relationship(B, 'Tie', 'ties', [], [])}`);
/** An extension: a note annotates any concept. */
const X_ONTO = ontology(X, `${element(`${X}Note`)} ${relationship(X, 'Annotates', 'annotates', [`${X}Note`], [`${ARCH}ModelConcept`])}`);
/** Language C in two documents: people and their Uses, and the nodes a second document adds. */
const C_ONTO = ontology(C, `${element(`${C}Person`)} ${relationship(C, 'Using', 'uses', [`${ARCH}Element`], [`${ARCH}Element`])}`);
const CD_ONTO = ontology(CD, element(`${CD}Node`), [C]);

/** A store with these documents: each listed one by a manifest of its own, the rest as raw documents. */
async function load(manifests: Array<[string, string[]]>, raw: string[] = []) {
  const store = new OxigraphRdfStore();
  const uploaded = new UploadedAssetSource();
  for (const [iri, text] of [[A, A_ONTO], [B, B_ONTO], [X, X_ONTO], [C, C_ONTO], [CD, CD_ONTO]] as const) {
    uploaded.add(iri, text);
  }
  const loader = new N3MetamodelLoader(new N3TtlParser(), store, new ChainedAssetSource([uploaded, new BundledAssetSource()]));
  for (const [ns, concepts] of manifests) await loader.loadMetamodelFromManifest(manifest(ns, ...concepts));
  for (const text of raw) await loader.loadMetamodel(text);
  return { store, manager: new OxigraphRelationshipManager(store) };
}

const iris = (manager: OxigraphRelationshipManager, source: string, target: string) =>
  manager.getValidRelationships(source, target).map((r) => r.iri);

describe('relationship types between languages (DD-40)', () => {
  let store: OxigraphRdfStore;
  let manager: OxigraphRelationshipManager;
  beforeAll(async () => {
    ({ store, manager } = await load([[A, [A]], [B, [B]], [X, [X]]]));
  }, 60_000);
  afterAll(() => store.dispose());

  it('never offers an abstract relationship type, only its subclasses', () => {
    const offered = iris(manager, `${A}Box`, `${A}Crate`);
    expect(offered).toContain(`${A}Flow`);
    expect(offered).not.toContain(`${A}Edge`);
  });

  it('offers a type whose hints name only core classes between its own metamodel’s elements', () => {
    expect(iris(manager, `${A}Crate`, `${A}Box`)).toContain(`${A}Link`);
    const link = manager.getValidRelationships(`${A}Box`, `${A}Box`).find((r) => r.iri === `${A}Link`)!;
    expect(link.reason).toContain('both of the metamodel that defines Link');
  });

  it('offers a type with no hints at all between its own metamodel’s elements', () => {
    expect(iris(manager, `${B}Thing`, `${B}Thing`)).toEqual([`${B}Tie`]);
  });

  it('offers the core’s types, and no language’s, between elements of two languages', () => {
    expect(iris(manager, `${A}Box`, `${B}Thing`)).toEqual(CORE_TYPES);
    expect(iris(manager, `${B}Thing`, `${A}Crate`)).toEqual(CORE_TYPES);
  });

  it('still offers an extension’s type that names any concept at one end, and then not the core’s', () => {
    expect(iris(manager, `${X}Note`, `${A}Box`)).toEqual([`${X}Annotates`]);
    expect(iris(manager, `${X}Note`, `${B}Thing`)).toEqual([`${X}Annotates`]);
    // The other way round no type of the extension's starts at a box.
    expect(iris(manager, `${A}Box`, `${X}Note`)).toEqual(CORE_TYPES);
  });

  it('offers the core’s types to change a relationship drawn between two languages before', () => {
    const model = 'https://example.org/model/';
    const relationship = manager.createQualifiedRelationship!({
      typeIri: `${A}Link`,
      sourceIri: `${model}box-1`,
      targetIri: `${model}thing-1`,
      modelIri: model,
    });
    expect(relationship.classIri).toBe(`${A}Link`);
    // What "change type" lists for the pair: the core's types, of which the line can take any.
    expect(iris(manager, `${A}Box`, `${B}Thing`)).toEqual(CORE_TYPES);
  });
});

describe('a relationship type’s metamodel', () => {
  it('is every document its manifest names as its concepts, and what they import', async () => {
    const { store, manager } = await load([[C, [C, CD]]]);
    expect(iris(manager, `${CD}Node`, `${C}Person`)).toEqual([`${C}Using`]);
    expect(iris(manager, `${CD}Node`, `${CD}Node`)).toEqual([`${C}Using`]);
    store.dispose();
  }, 60_000);

  it('is the document that declares it, and what that imports, when no manifest names it', async () => {
    const { store, manager } = await load([[A, [A]]], [C_ONTO, CD_ONTO]);
    expect(iris(manager, `${C}Person`, `${C}Person`)).toEqual([`${C}Using`]);
    // The deployment document imports C's ontology; C's ontology does not import it.
    expect(iris(manager, `${CD}Node`, `${C}Person`)).toEqual(CORE_TYPES);
    store.dispose();
  }, 60_000);
});
