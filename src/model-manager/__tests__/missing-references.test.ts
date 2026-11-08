/**
 * References to what the model does not have: what two branches merged as text
 * can leave — a node of a deleted element, a link without its relationship or
 * end shapes, a route cut short, a folder entry, `arch:inView` — and nothing
 * for a model that is whole, the end of a route (`rdf:nil`) included.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Parser, Store } from 'n3';
import type { Quad } from '@rdfjs/types';
import { missingReferences } from '../missing-references.js';

const read = (name: string) => readFileSync(new URL(`../../__tests__/fixtures/merge/${name}`, import.meta.url), 'utf8');
const MODEL = (new Parser({ format: 'TriG' }).parse(read('model.trig')) as unknown as Quad[]).filter((q) => q.graph.termType === 'DefaultGraph');
const M = 'https://example.org/m/';

const found = (quads: Quad[]) =>
  missingReferences(new Store(quads as never) as never).map((r) => `${r.focusNode.value.slice(M.length)} ${r.resultPath.value.split(/[#/]/).pop()}: ${r.message.replace(M, 'm:')}`);

describe('references to what the model does not have', () => {
  it('a whole model has none — the end of a route is not one', () => {
    expect(found(MODEL)).toEqual([]);
  });

  it('Portal deleted as text on one branch, while the other still points at it', () => {
    const withoutPortal = MODEL.filter((q) => q.subject.value !== `${M}portal`);
    expect(found(withoutPortal).sort()).toEqual([
      'folder itemListElement: An entry of the folder is not in the model: m:portal',
      'node-portal archElement: The element it shows is not in the model: m:portal',
      'serving target: Its target is not in the model: m:portal',
    ]);
  });

  it('a link whose end shape and route cells went', () => {
    const cut = MODEL.filter((q) => ![`${M}node-billing`, `${M}link-serving-points-1`].includes(q.subject.value));
    expect(found(cut).sort()).toEqual([
      'link-serving source: The shape it starts at is not in the model: m:node-billing',
      'link-serving-points-0 rest: The rest of its route is not in the model: m:link-serving-points-1',
    ]);
  });

  it('only about the nodes asked about', () => {
    const withoutView = MODEL.filter((q) => q.subject.value !== `${M}view`);
    const store = new Store(withoutView as never);
    const about = (iri: string) => missingReferences(store as never, [{ termType: 'NamedNode', value: iri } as never]).map((r) => r.resultPath.value.split('#').pop());
    expect(about(`${M}billing`)).toEqual(['inView']);
    expect(about(`${M}node-portal`)).toEqual(['view']);
    expect(about(`${M}crm`)).toEqual([]);
  });
});
