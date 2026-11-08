import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Parser, Store } from 'n3';
import { SingleValued, type QuadSource } from '../single-valued.js';
import { NAMESPACES } from '../namespaces.js';

const EX = 'https://example.org/vocab#';
const VIS = NAMESPACES['arch-vis'];
const ARCH = NAMESPACES.arch;
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const SKOS = NAMESPACES.skos;

const PREFIXES = `
@prefix ex:   <${EX}> .
@prefix sh:   <http://www.w3.org/ns/shacl#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
`;

const sourceOf = (...texts: string[]) => new Store(texts.flatMap((t) => new Parser().parse(t))) as unknown as QuadSource;
const rulesOf = (turtle: string) => SingleValued.from(sourceOf(PREFIXES + turtle));
const types = (...iris: string[]) => () => iris;

describe('the built-in rules', () => {
  it('hold geometry, a link’s ends and list cells to one value, a name to one per language', () => {
    const rules = SingleValued.builtIn();
    expect(rules.limitOf(VIS + 'bounds-x', types())).toBe('one');
    expect(rules.limitOf(VIS + 'points', types())).toBe('one');
    expect(rules.limitOf(NAMESPACES.rdf + 'first', types())).toBe('one');
    expect(rules.limitOf(ARCH + 'target', types())).toBe('one');
    expect(rules.limitOf(SKOS + 'prefLabel', types())).toBe('one-per-language');
    expect(rules.limitOf(NAMESPACES.dcterms + 'modified', types())).toBe('latest');
    expect(rules.limitOf(VIS + 'fillColor', types())).toBeUndefined();
    expect(rules.mayLimit(ARCH + 'inView')).toBe(false);
  });
});

describe('rules from a metamodel', () => {
  it('owl:FunctionalProperty: one value, for every subject', () => {
    const rules = rulesOf('ex:colour a owl:FunctionalProperty .');
    expect(rules.limitOf(EX + 'colour', types())).toBe('one');
  });

  it('sh:maxCount 1: one value for the shape’s target class and its subclasses only', () => {
    const rules = rulesOf(`
      ex:Component rdfs:subClassOf ex:Element .
      ex:ElementShape a sh:NodeShape ; sh:targetClass ex:Element ;
        sh:property [ sh:path ex:owner ; sh:maxCount 1 ] .`);
    expect(rules.limitOf(EX + 'owner', types(EX + 'Element'))).toBe('one');
    expect(rules.limitOf(EX + 'owner', types(EX + 'Component'))).toBe('one');
    expect(rules.limitOf(EX + 'owner', types(EX + 'Team'))).toBeUndefined();
    expect(rules.limitOf(EX + 'owner', types())).toBeUndefined();
  });

  it('reads a shape that is its own class, and a property shape with a target of its own', () => {
    const rules = rulesOf(`
      ex:Element a rdfs:Class , sh:NodeShape ; sh:property [ sh:path ex:owner ; sh:maxCount 1 ] .
      ex:SizeShape a sh:PropertyShape ; sh:targetClass ex:Box ; sh:path ex:size ; sh:maxCount 1 .`);
    expect(rules.limitOf(EX + 'owner', types(EX + 'Element'))).toBe('one');
    expect(rules.limitOf(EX + 'size', types(EX + 'Box'))).toBe('one');
  });

  it('sh:targetSubjectsOf the property itself: one value for every subject', () => {
    const rules = rulesOf(`
      ex:InShape a sh:NodeShape ; sh:targetSubjectsOf ex:in ;
        sh:property [ sh:path ex:in ; sh:maxCount 1 ] .`);
    expect(rules.limitOf(EX + 'in', types())).toBe('one');
  });

  it('sh:uniqueLang: one value per language; with sh:maxCount 1 too, one value', () => {
    const rules = rulesOf(`
      ex:ElementShape a sh:NodeShape ; sh:targetClass ex:Element ;
        sh:property [ sh:path ex:note ; sh:uniqueLang true ] ,
                    [ sh:path ex:title ; sh:uniqueLang true ] ,
                    [ sh:path ex:title ; sh:maxCount 1 ] .`);
    expect(rules.limitOf(EX + 'note', types(EX + 'Element'))).toBe('one-per-language');
    expect(rules.limitOf(EX + 'title', types(EX + 'Element'))).toBe('one');
  });

  it('ignores limits inside sh:xone and the like, and sh:maxCount 0', () => {
    const rules = rulesOf(`
      ex:QuestionShape a sh:NodeShape ; sh:targetClass ex:Question ;
        sh:property [ sh:path ex:never ; sh:maxCount 0 ] ;
        sh:xone ( [ sh:property [ sh:path ex:select ; sh:maxCount 1 ] ]
                  [ sh:property [ sh:path ex:ask ; sh:maxCount 1 ] ] ) .`);
    expect(rules.mayLimit(EX + 'select')).toBe(false);
    expect(rules.mayLimit(EX + 'ask')).toBe(false);
    expect(rules.mayLimit(EX + 'never')).toBe(false);
  });

  it('asks for the subject’s types only when a class-scoped rule names the property', () => {
    const rules = rulesOf('ex:colour a owl:FunctionalProperty .');
    const never = () => {
      throw new Error('types asked for');
    };
    expect(rules.limitOf(EX + 'colour', never)).toBe('one');
    expect(rules.limitOf(VIS + 'bounds-x', never)).toBe('one');
    expect(rules.limitOf(EX + 'other', never)).toBeUndefined();
  });
});

describe('the bundled metamodels', () => {
  const asset = (path: string) => readFileSync(new URL(`../../../assets/${path}`, import.meta.url), 'utf8');
  const rules = SingleValued.from(
    sourceOf(
      ...[
        'core/core-onto.ttl',
        'core/core-shapes.ttl',
        'core/core-vis-onto.ttl',
        'core/core-vis-shapes.ttl',
        'archimate4/archimate4-onto.ttl',
        'archimate4/archimate4-element-shapes.ttl',
      ].map(asset),
    ),
  );

  it('give styling and membership one value', () => {
    expect(rules.limitOf(VIS + 'fillColor', types())).toBe('one');
    expect(rules.limitOf(ARCH + 'inModel', types(AM4 + 'ApplicationComponent'))).toBe('one');
  });

  it('give a model question’s query one value, but not the alternatives its sh:xone weighs', () => {
    expect(rules.limitOf(NAMESPACES.sh + 'select', types(ARCH + 'ModelQuestion'))).toBe('one');
    expect(rules.limitOf(NAMESPACES.sh + 'select', types(AM4 + 'ApplicationComponent'))).toBeUndefined();
  });

  it('leave a concept’s views many', () => {
    expect(rules.limitOf(ARCH + 'inView', types(AM4 + 'ApplicationComponent'))).toBeUndefined();
  });
});
