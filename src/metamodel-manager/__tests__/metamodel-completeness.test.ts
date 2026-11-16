/**
 * What a loaded metamodel leaves out of the palette (Req 2.24): nothing to draw, no classification named, part of
 * its types classified — each said with its numbers and its types.
 */

import { describe, it, expect } from 'vitest';
import { Parser, Store } from 'n3';
import { buildClassificationAxes, buildClasses } from '../taxonomy.js';
import { declaredOutside, documentsWithoutTypes, metamodelCompleteness, typeSources, type CheckedMetamodel } from '../metamodel-completeness.js';
import type { RelationshipTypeInfo } from '../interfaces.js';

const PREFIXES = `
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix arch: <https://meta.linked.archi/core#> .
`;

/** A store of documents, each in the graph of its name. */
function storeOf(documents: Record<string, string>): Store {
  const store = new Store();
  for (const [graph, ttl] of Object.entries(documents)) {
    for (const q of new Parser().parse(PREFIXES + ttl)) store.addQuad(q.subject, q.predicate, q.object, { termType: 'NamedNode', value: graph } as never);
  }
  return store;
}

const rel = (iri: string, label: string): RelationshipTypeInfo => ({ iri, label, domainTypes: [], rangeTypes: [] }) as RelationshipTypeInfo;

function check(store: Store, metamodels: CheckedMetamodel[], relationships: RelationshipTypeInfo[] = []) {
  const axes = buildClassificationAxes(store, metamodels.map((m) => m.iri));
  const classes = buildClasses(store, axes);
  const groupedByName = !classes.some((c) => Object.keys(c.groupsByAxis).length > 0);
  return metamodelCompleteness(store, metamodels, classes, relationships, axes, groupedByName);
}

/** A language whose taxonomy names every one of its two element types. */
const COMPLETE = {
  'https://example.org/lang/metamodel#': `<https://example.org/lang/metamodel#Lang> a arch:Metamodel ; arch:conceptClassification <https://example.org/lang/tax#> .`,
  'https://example.org/lang/onto#': `
<https://example.org/lang/onto#Actor> a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Actor"@en .
<https://example.org/lang/onto#Service> a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Service"@en .`,
  'https://example.org/lang/tax#': `
<https://example.org/lang/tax#> a skos:ConceptScheme ; skos:hasTopConcept <https://example.org/lang/tax#Kind> .
<https://example.org/lang/tax#Kind> a skos:Concept ; skos:prefLabel "Kind"@en ; skos:narrower <https://example.org/lang/tax#Active>, <https://example.org/lang/tax#Behaviour> .
<https://example.org/lang/tax#Active> a skos:Concept ; skos:prefLabel "Active"@en ; skos:narrower <https://example.org/lang/onto#Actor> .
<https://example.org/lang/tax#Behaviour> a skos:Concept ; skos:prefLabel "Behaviour"@en ; skos:narrower <https://example.org/lang/onto#Service> .`,
};
const LANG: CheckedMetamodel = { iri: 'https://example.org/lang/metamodel#Lang', label: 'Lang', documents: Object.keys(COMPLETE) };

describe('what a loaded metamodel leaves out', () => {
  it('nothing, for one whose classification names every element type', () => {
    expect(check(storeOf(COMPLETE), [LANG])).toEqual([]);
  });

  it('a classification that names part of its element types: how many, and which are under "Other"', () => {
    const store = storeOf({
      ...COMPLETE,
      'https://example.org/lang/onto#': `${COMPLETE['https://example.org/lang/onto#']}
<https://example.org/lang/onto#Risk> a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Risk"@en .`,
    });
    expect(check(store, [LANG])).toEqual([
      {
        metamodelIri: LANG.iri,
        label: 'Lang',
        findings: [{ kind: 'unclassified-elements', message: 'its classification names 2 of its 3 element types: the other 1 is listed under “Other”', types: ['Risk'] }],
      },
    ]);
  });

  it('no classification named, beside a language that has one: its types are under "Other"', () => {
    const extension = {
      'https://example.org/ext/metamodel#': `<https://example.org/ext/metamodel#Ext> a arch:Metamodel .`,
      'https://example.org/ext/onto#': `<https://example.org/ext/onto#Decision> a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Decision"@en .`,
    };
    const EXT: CheckedMetamodel = { iri: 'https://example.org/ext/metamodel#Ext', label: 'Ext', documents: Object.keys(extension) };
    expect(check(storeOf({ ...COMPLETE, ...extension }), [LANG, EXT])).toEqual([
      {
        metamodelIri: EXT.iri,
        label: 'Ext',
        findings: [{ kind: 'no-classification', message: 'it names no classification (arch:conceptClassification): its 1 element type is listed under “Other”', types: ['Decision'] }],
      },
    ]);
    // Alone, the palette groups them by name.
    expect(check(storeOf(extension), [EXT])[0]?.findings[0]?.message).toBe(
      'it names no classification (arch:conceptClassification): its 1 element type is grouped by a guess from their names',
    );
  });

  it('a classification named that names none of its element types', () => {
    const store = storeOf({
      'https://example.org/radar/metamodel#': `<https://example.org/radar/metamodel#Radar> a arch:Metamodel ; arch:conceptClassification <https://example.org/radar/tax#> .`,
      'https://example.org/radar/onto#': `<https://example.org/radar/onto#Blip> a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Blip"@en .`,
      'https://example.org/radar/tax#': `<https://example.org/radar/tax#> a skos:ConceptScheme . <https://example.org/radar/tax#Ring> a skos:Concept ; skos:inScheme <https://example.org/radar/tax#> .`,
    });
    const radar = { iri: 'https://example.org/radar/metamodel#Radar', label: 'Radar', documents: ['https://example.org/radar/metamodel#', 'https://example.org/radar/onto#', 'https://example.org/radar/tax#'] };
    expect(check(store, [radar])[0]?.findings).toEqual([
      { kind: 'unclassified-elements', message: 'its classification names none of its 1 element type: it is grouped by a guess from its name', types: ['Blip'] },
    ]);
  });

  it('types come from the documents a manifest names as its concepts and what they import, not from what its shapes import', () => {
    const documents = {
      ...COMPLETE,
      'https://example.org/lang/shapes#': `<https://example.org/lang/shapes#> owl:imports <https://example.org/lang/onto#>, <https://example.org/old/onto#> .`,
      'https://example.org/old/onto#': `<https://example.org/old/onto#Legacy> a owl:Class ; rdfs:subClassOf arch:Element ; skos:prefLabel "Legacy"@en .`,
    };
    const store = storeOf(documents);
    const lang = { ...LANG, documents: Object.keys(documents), conceptDocuments: ['https://example.org/lang/onto#'] };
    expect([...typeSources(store, lang)]).toEqual(['https://example.org/lang/onto#']);
    const without = documentsWithoutTypes(store, [lang]);
    expect(without.has('https://example.org/old/onto#')).toBe(true);
    expect(declaredOutside(store, 'https://example.org/old/onto#Legacy', without)).toBe(false);
    expect(declaredOutside(store, 'https://example.org/lang/onto#Actor', without)).toBe(true);
    // And the old version's type is not held against the metamodel.
    expect(check(store, [lang])).toEqual([]);
  });

  it('nothing to draw: concepts and no classes, or classes that are no element types', () => {
    const concepts = { 'https://example.org/canvas#': `<https://example.org/canvas#A> a skos:Concept . <https://example.org/canvas#B> a skos:Concept .` };
    expect(check(storeOf(concepts), [{ iri: 'https://example.org/canvas#M', label: 'Canvas', documents: Object.keys(concepts) }])[0]?.findings).toEqual([
      { kind: 'nothing-to-draw', message: 'it defines no element or relationship types: its documents hold 2 concepts and no classes, so nothing of it can be drawn' },
    ]);
    const classes = { 'https://example.org/time#': `<https://example.org/time#Tolerate> a owl:Class ; rdfs:subClassOf skos:Concept .` };
    expect(check(storeOf(classes), [{ iri: 'https://example.org/time#M', label: 'Time', documents: Object.keys(classes) }])[0]?.findings).toEqual([
      { kind: 'nothing-to-draw', message: 'it defines no element or relationship types: none of its 1 class is a subclass of arch:Element or arch:QualifiedRelationship, so nothing of it can be drawn' },
    ]);
  });

  it('relationship types in no category, where a scheme categorises others', () => {
    const store = storeOf({
      ...COMPLETE,
      'https://example.org/lang/onto#': `${COMPLETE['https://example.org/lang/onto#']}
<https://example.org/lang/onto#Serving> a owl:Class ; rdfs:subClassOf arch:QualifiedRelationship .
<https://example.org/lang/onto#Flow> a owl:Class ; rdfs:subClassOf arch:QualifiedRelationship .`,
      'https://example.org/lang/tax#': `${COMPLETE['https://example.org/lang/tax#']}
<https://example.org/lang/tax#Kind> skos:narrower <https://example.org/lang/tax#Dependency> .
<https://example.org/lang/tax#Dependency> a skos:Concept ; skos:prefLabel "Dependency"@en ; skos:narrower <https://example.org/lang/onto#Serving> .`,
    });
    const findings = check(store, [LANG], [rel('https://example.org/lang/onto#Serving', 'Serving'), rel('https://example.org/lang/onto#Flow', 'Flow')])[0]?.findings;
    expect(findings).toEqual([
      { kind: 'unclassified-relationships', message: '1 of its 2 relationship types is in no category, and listed under “Other”', types: ['Flow'] },
    ]);
  });

  it('a core document is nobody\'s: its classes are not counted', () => {
    const store = storeOf({ ...COMPLETE, 'https://meta.linked.archi/core#': `arch:Thing a owl:Class ; rdfs:subClassOf arch:Element .` });
    expect(check(store, [{ ...LANG, documents: [...LANG.documents, 'https://meta.linked.archi/core#'] }])).toEqual([]);
  });
});
