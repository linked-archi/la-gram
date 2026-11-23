import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { contextNameChange, contextNameIri, contextNameOf, contextNamesOf } from '../context-names.js';

const { namedNode, literal } = DataFactory;
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const SKOSXL = 'http://www.w3.org/2008/05/skos-xl#';
const ARCH = 'https://meta.linked.archi/core#';
const GATEWAY = 'https://example.org/model/gateway';
const DEVELOPER = 'https://example.org/contexts#Developer';
const EXECUTIVE = 'https://example.org/contexts#Executive';

function setName(store: OxigraphRdfStore, context: string, name: string | null, language?: string): void {
  const { remove, add } = contextNameChange(store, GATEWAY, context, name, language);
  if (remove.length > 0) store.removeQuads(remove);
  if (add.length > 0) store.addQuads(add);
}

const values = (store: OxigraphRdfStore, s: string, p: string) =>
  store.getQuads(namedNode(s) as never, namedNode(p) as never).map((q) => (q.object.termType === 'Literal' ? `${q.object.value}@${(q.object as { language?: string }).language}` : q.object.value));

describe('names for a presentation context (SKOS-XL)', () => {
  it('a skosxl:altLabel named after the element and the context, its plain form a skos:altLabel too', () => {
    const store = new OxigraphRdfStore();
    store.addQuads([DataFactory.quad(namedNode(GATEWAY), namedNode(SKOS + 'prefLabel'), literal('Payment gateway', 'en')) as unknown as Quad]);
    setName(store, DEVELOPER, 'pgw-svc');
    const label = contextNameIri(GATEWAY, DEVELOPER, 'en');
    expect(label).toMatch(/^https:\/\/example\.org\/model\/gateway\/name\/[0-9a-f]{8}$/);
    expect(values(store, GATEWAY, SKOSXL + 'altLabel')).toEqual([label]);
    expect(values(store, label, SKOSXL + 'literalForm')).toEqual(['pgw-svc@en']);
    expect(values(store, label, ARCH + 'inPresentationContext')).toEqual([DEVELOPER]);
    expect(values(store, label, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toEqual([SKOSXL + 'Label']);
    expect(values(store, GATEWAY, SKOS + 'altLabel')).toEqual(['pgw-svc@en']);
    // The canonical name is untouched — never a skosxl:prefLabel.
    expect(values(store, GATEWAY, SKOS + 'prefLabel')).toEqual(['Payment gateway@en']);
    expect(values(store, GATEWAY, SKOSXL + 'prefLabel')).toEqual([]);
    expect(contextNamesOf(store, GATEWAY)).toEqual([{ context: DEVELOPER, name: 'pgw-svc', language: 'en', label }]);
  });

  it('one per context and language: renamed, taken away — its plain form with it, unless another name says the same', () => {
    const store = new OxigraphRdfStore();
    setName(store, DEVELOPER, 'pgw-svc');
    setName(store, EXECUTIVE, 'Card payments');
    setName(store, DEVELOPER, 'pgw');
    expect(contextNameOf(store, GATEWAY, DEVELOPER)).toBe('pgw');
    expect(contextNameOf(store, GATEWAY, EXECUTIVE)).toBe('Card payments');
    expect(values(store, GATEWAY, SKOS + 'altLabel').sort()).toEqual(['Card payments@en', 'pgw@en']);
    // The same text for two audiences: taking one away keeps the plain form the other still has.
    setName(store, DEVELOPER, 'Card payments');
    setName(store, DEVELOPER, null);
    expect(contextNameOf(store, GATEWAY, DEVELOPER)).toBeUndefined();
    expect(values(store, GATEWAY, SKOS + 'altLabel')).toEqual(['Card payments@en']);
    setName(store, EXECUTIVE, '');
    expect(store.getQuads(namedNode(GATEWAY) as never, null)).toEqual([]);
  });

  it('in the language shown, else one with none, else any; none for no context', () => {
    const store = new OxigraphRdfStore();
    setName(store, DEVELOPER, 'Zahlungen', 'de');
    expect(contextNameOf(store, GATEWAY, DEVELOPER)).toBe('Zahlungen');
    setName(store, DEVELOPER, 'pgw-svc', 'en');
    expect(contextNameOf(store, GATEWAY, DEVELOPER)).toBe('pgw-svc');
    expect(contextNameOf(store, GATEWAY, DEVELOPER, 'de')).toBe('Zahlungen');
    expect(contextNameOf(store, GATEWAY, undefined)).toBeUndefined();
    expect(contextNameIri(GATEWAY, DEVELOPER, 'de')).toBe(`${contextNameIri(GATEWAY, DEVELOPER, 'en')}/de`);
  });
});
