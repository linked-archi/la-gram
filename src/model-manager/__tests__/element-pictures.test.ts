import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { pictureChange, pictureIri, pictureOf, picturesOf } from '../element-pictures.js';

const { namedNode } = DataFactory;
const ARCH = 'https://meta.linked.archi/core#';
const SCHEMA = 'http://schema.org/';
const GATEWAY = 'https://example.org/model/gateway';
const EXECUTIVE = 'https://example.org/contexts#Executive';
const DEVELOPER = 'https://example.org/contexts#Developer';
const LOGO = 'https://example.org/pictures/gateway.svg';
const CARD = 'https://example.org/pictures/card-payments.png';

function setPicture(store: OxigraphRdfStore, context: string | undefined, url: string | null): void {
  const { remove, add } = pictureChange(store, GATEWAY, context, url);
  if (remove.length > 0) store.removeQuads(remove);
  if (add.length > 0) store.addQuads(add);
}

const values = (store: OxigraphRdfStore, s: string, p: string) =>
  store.getQuads(namedNode(s) as never, namedNode(p) as never).map((q) => q.object.value);

describe('an element’s pictures (core 0.5.0)', () => {
  it('for every audience its prefVisNotation, for one an altVisNotation: ImageObjects named after it, an address each', () => {
    const store = new OxigraphRdfStore();
    setPicture(store, undefined, LOGO);
    setPicture(store, EXECUTIVE, CARD);
    const every = pictureIri(GATEWAY, undefined);
    const forExecutives = pictureIri(GATEWAY, EXECUTIVE);
    expect(every).toBe(`${GATEWAY}/picture`);
    expect(forExecutives).toMatch(/\/picture\/[0-9a-f]{8}$/);
    expect(values(store, GATEWAY, ARCH + 'prefVisNotation')).toEqual([every]);
    expect(values(store, GATEWAY, ARCH + 'altVisNotation')).toEqual([forExecutives]);
    expect(values(store, forExecutives, ARCH + 'inPresentationContext')).toEqual([EXECUTIVE]);
    expect(values(store, forExecutives, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toEqual([SCHEMA + 'ImageObject']);
    const url = store.getQuads(namedNode(forExecutives) as never, namedNode(SCHEMA + 'contentUrl') as never)[0]!.object;
    expect([url.value, (url as { datatype?: { value: string } }).datatype?.value]).toEqual([CARD, 'http://www.w3.org/2001/XMLSchema#anyURI']);
    expect(picturesOf(store, GATEWAY)).toEqual([
      { url: LOGO, node: every },
      { url: CARD, node: forExecutives, context: EXECUTIVE },
    ]);
  });

  it('for a context: its own, else the one for every audience; none without either', () => {
    const store = new OxigraphRdfStore();
    expect(pictureOf(store, GATEWAY, EXECUTIVE)).toBeUndefined();
    setPicture(store, undefined, LOGO);
    setPicture(store, EXECUTIVE, CARD);
    expect(pictureOf(store, GATEWAY, EXECUTIVE)).toBe(CARD);
    expect(pictureOf(store, GATEWAY, DEVELOPER)).toBe(LOGO);
    expect(pictureOf(store, GATEWAY, undefined)).toBe(LOGO);
  });

  it('a published picture — the image’s own IRI — read as its address', () => {
    const store = new OxigraphRdfStore();
    store.addQuads([DataFactory.quad(namedNode(GATEWAY), namedNode(ARCH + 'prefVisNotation'), namedNode(LOGO)) as unknown as Quad]);
    expect(pictureOf(store, GATEWAY, EXECUTIVE)).toBe(LOGO);
    // Replaced: the IRI's link goes, nothing is said of the image itself.
    setPicture(store, undefined, CARD);
    expect(values(store, GATEWAY, ARCH + 'prefVisNotation')).toEqual([pictureIri(GATEWAY, undefined)]);
  });

  it('replaced, taken away; an address that is none changes nothing', () => {
    const store = new OxigraphRdfStore();
    setPicture(store, EXECUTIVE, CARD);
    setPicture(store, EXECUTIVE, LOGO);
    expect(pictureOf(store, GATEWAY, EXECUTIVE)).toBe(LOGO);
    setPicture(store, EXECUTIVE, 'javascript:alert(1)');
    expect(pictureOf(store, GATEWAY, EXECUTIVE)).toBe(LOGO);
    setPicture(store, EXECUTIVE, null);
    expect(store.getQuads(null, null, null)).toEqual([]);
    // A data: URI kept in the model.
    setPicture(store, undefined, 'data:image/png;base64,iVBORw0KGgo=');
    expect(pictureOf(store, GATEWAY, undefined)).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});
