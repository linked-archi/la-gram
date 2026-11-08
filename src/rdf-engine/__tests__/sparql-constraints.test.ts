/**
 * SHACL's SPARQL-based constraints run with Oxigraph: what is read of a shape
 * (targets, prefixes, message, severity, a property shape's path, what is not
 * supported), where the targets go in a query, results for every target or for
 * the nodes asked about, and every rule the bundled shapes have accepted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Parser } from 'n3';
import * as oxigraph from 'oxigraph';
import type { Quad, Term } from '@rdfjs/types';
import { predicatesNamedBy, sparqlConstraintsOf, SparqlRunner, withTargets } from '../sparql-constraints.js';
import { toOxQuad } from '../rdf-store.js';

const SHAPES = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix ex: <https://example.org/ex#> .
@prefix s: <https://example.org/shapes#> .

<https://example.org/shapes> sh:declare [ sh:prefix "ex" ; sh:namespace "https://example.org/ex#"^^xsd:anyURI ] .

s:NoSelfPart a sh:NodeShape ;
  sh:targetSubjectsOf ex:partOf ;
  sh:sparql [
    sh:prefixes <https://example.org/shapes> ;
    sh:message "{$this} is part of itself." ;
    sh:select """
      SELECT $this WHERE {
        # a comment with { a brace } and an IRI-like <https://x#y>
        $this ex:partOf $this .
      }""" ;
  ] .

s:NamedThing a sh:NodeShape ;
  sh:targetClass ex:Thing ;
  sh:severity sh:Warning ;
  sh:message "A thing needs a name." ;
  sh:sparql [ sh:prefixes <https://example.org/shapes> ; sh:select "SELECT $this { FILTER NOT EXISTS { $this ex:name ?n } }" ] .

s:Off a sh:NodeShape ; sh:targetClass ex:Thing ; sh:deactivated true ;
  sh:sparql [ sh:select "SELECT $this WHERE { }" ] .

s:Asks a sh:NodeShape ; sh:targetClass ex:Thing ; sh:sparql [ sh:ask "ASK { }" ] .

s:Sized a sh:PropertyShape ; sh:path ex:size ; sh:targetClass ex:Thing ;
  sh:sparql [ sh:prefixes <https://example.org/shapes> ; sh:message "Size {?value} is negative." ;
    sh:select "SELECT $this ?value WHERE { $this $PATH ?value . FILTER(?value < 0) }" ] .

s:Twisted a sh:PropertyShape ; sh:path [ sh:inversePath ex:size ] ; sh:targetClass ex:Thing ;
  sh:sparql [ sh:select "SELECT $this WHERE { }" ] .

s:Broken a sh:NodeShape ; sh:targetClass ex:Thing ; sh:sparql [ sh:select "SELECT $this WHERE { $this ex:nope " ] .
`;

const EX = 'https://example.org/ex#';
const DATA = `
@prefix ex: <https://example.org/ex#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Gadget rdfs:subClassOf ex:Thing .
ex:a a ex:Gadget ; ex:name "A" ; ex:partOf ex:a ; ex:size -2 .
ex:b a ex:Thing ; ex:partOf ex:a .
ex:c a ex:Gadget .
`;

const parse = (text: string) => new Parser({ format: 'Turtle' }).parse(text) as unknown as Quad[];
const store = (quads: Quad[]) => {
  const s = new oxigraph.Store();
  for (const q of quads) s.add(toOxQuad(q));
  return s;
};

describe('SPARQL-based constraints', () => {
  const { constraints, skipped } = sparqlConstraintsOf(parse(SHAPES));
  const shape = (local: string) => constraints.find((c) => c.shape === `https://example.org/shapes#${local}`)!;

  it('reads a shape’s targets, its prefixes, message and severity; leaves out the deactivated and the unsupported', () => {
    expect(constraints.map((c) => c.shape.split('#')[1]).sort()).toEqual(['Broken', 'NamedThing', 'NoSelfPart', 'Sized']);
    expect(shape('NoSelfPart')).toMatchObject({ message: '{$this} is part of itself.', severity: 'Violation', targets: { subjectsOf: [EX + 'partOf'] } });
    expect(shape('NoSelfPart').select).toMatch(/^PREFIX ex: <https:\/\/example\.org\/ex#>\n/);
    expect(shape('NamedThing')).toMatchObject({ message: 'A thing needs a name.', severity: 'Warning', targets: { classes: [EX + 'Thing'] } });
    expect(shape('Sized')).toMatchObject({ path: EX + 'size' });
    expect(shape('Sized').select).toContain(`$this <${EX}size> ?value`);
    expect(skipped.map((s) => [s.shape.split('#')[1], s.reason])).toEqual([
      ['Asks', 'only sh:select is supported'],
      ['Twisted', 'a path that is not one property'],
    ]);
  });

  it('puts the targets first in the outer WHERE — not in a comment, an IRI, or a query without WHERE', () => {
    const q = withTargets(shape('NoSelfPart').select, 'TARGETS ');
    expect(q).toMatch(/WHERE \{\nTARGETS \s+# a comment with \{ a brace \}/);
    expect(withTargets('SELECT $this { ?x ?y ?z }', 'T ')).toBe('SELECT $this {\nT  ?x ?y ?z }');
  });

  it('finds what each rule finds of its targets: messages filled in, a property shape’s path; a query Oxigraph refuses is kept out, once', () => {
    const data = store(parse(DATA));
    let asked = 0;
    const runner = new SparqlRunner(constraints, {
      select: (query) => {
        asked++;
        return data.query(query) as Array<Map<string, Term>>;
      },
    });
    const results = runner.run().map((r) => [r.focusNode.value.split('#')[1], r.sourceShape.value.split('#')[1], r.resultPath.value.split('#')[1] ?? '', r.message, r.severity]);
    expect(results.sort()).toEqual([
      ['a', 'NoSelfPart', '', `${EX}a is part of itself.`, 'Violation'],
      ['a', 'Sized', 'size', 'Size -2 is negative.', 'Violation'],
      ['b', 'NamedThing', '', 'A thing needs a name.', 'Warning'],
      ['c', 'NamedThing', '', 'A thing needs a name.', 'Warning'],
    ]);
    expect([...runner.failures.keys()].map((k) => k.split('\u0000')[0]?.split('#')[1])).toEqual(['Broken']);
    const before = asked;
    runner.run();
    expect(asked - before).toBe(3); // the broken one is not asked again
  });

  it('only for the nodes asked about', () => {
    const data = store(parse(DATA));
    const runner = new SparqlRunner(constraints, { select: (query) => data.query(query) as Array<Map<string, Term>> });
    const node = { termType: 'NamedNode', value: EX + 'c' } as Term;
    expect(runner.run([node]).map((r) => r.focusNode.value)).toEqual([EX + 'c']);
    expect(runner.run([])).toEqual([]);
  });

  it('names what each query reads, prefixed names expanded', () => {
    expect(predicatesNamedBy(shape('NoSelfPart'))).toEqual([EX + 'partOf']);
    expect(predicatesNamedBy(shape('Sized'))).toEqual([EX + 'size']);
  });

  it('every rule of the bundled shapes is read, and Oxigraph takes every query', () => {
    const files = ['archimate4', 'archimate3', 'core'].flatMap((dir) =>
      readdirSync(new URL(`../../../assets/${dir}/`, import.meta.url))
        .filter((f) => f.endsWith('-shapes.ttl'))
        .map((f) => new URL(`../../../assets/${dir}/${f}`, import.meta.url)),
    );
    const all = sparqlConstraintsOf(files.flatMap((f) => parse(readFileSync(f, 'utf8'))));
    expect(all.skipped).toEqual([]);
    // 71 since 2026-11-06: meta took out the rules that restated its relationship tables, and
    // stated the viewpoint conformance rules once, in core, where each ArchiMate version had a copy.
    expect(all.constraints.length).toBeGreaterThanOrEqual(70);
    const empty = new oxigraph.Store();
    const runner = new SparqlRunner(all.constraints, { select: (query) => empty.query(query) as Array<Map<string, Term>> });
    expect(runner.run()).toEqual([]);
    expect([...runner.failures.values()]).toEqual([]);
  });
});
