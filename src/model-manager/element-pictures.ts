/**
 * An element's pictures (core 0.5.0): its picture for every audience,
 * `arch:prefVisNotation`, and one for an audience, an `arch:altVisNotation`
 * whose value is a `schema:ImageObject` with its `schema:contentUrl` and
 * `arch:inPresentationContext` — as a name for an audience is a SKOS-XL label
 * (`context-names.ts`).
 *
 * A value may also be the image's own IRI, as published notations write
 * `arch:prefVisNotation`: read as its own address. la-gram writes an
 * ImageObject named after the element — `{element}-picture` for every
 * audience, `{element}-picture-{hash}` for one — its address an `xsd:anyURI`
 * literal (an http(s) URL, or a `data:image/…` URI for a picture kept in the
 * model), so that a merge can match it. One per audience.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { imageUri } from './appearance.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { shortHash } from './short-hash.js';
import { T } from './vocabulary.js';

const { namedNode, literal, quad } = DataFactory;

/** One picture an element has: for every audience (no `context`), or for one. */
export interface ElementPicture {
  context?: string;
  /** Its address, as drawn. */
  url: string;
  /** What holds it: an ImageObject, or the image's own IRI. */
  node: string;
}

/** The address a picture value gives: its `schema:contentUrl`, else — an image's own IRI — itself. */
function urlOf(store: RdfStore, value: Term): string | undefined {
  if (value.termType === 'Literal') return imageUri(value.value);
  const content = store.getQuads(value as never, T.contentUrl as never)[0]?.object;
  if (content) return imageUri(content.value);
  return value.termType === 'NamedNode' ? imageUri(value.value) : undefined;
}

/** Every picture `iri` has: its `arch:prefVisNotation`, and each `arch:altVisNotation` (with its context, if it has one). */
export function picturesOf(store: RdfStore, iri: string): ElementPicture[] {
  const pictures: ElementPicture[] = [];
  for (const [predicate, scoped] of [
    [T.prefVisNotation, false],
    [T.altVisNotation, true],
  ] as const) {
    for (const q of store.getQuads(namedNode(iri) as never, predicate as never)) {
      const url = urlOf(store, q.object);
      if (!url) continue;
      const context = scoped && q.object.termType !== 'Literal' ? store.getQuads(q.object as never, T.inPresentationContext as never)[0]?.object.value : undefined;
      pictures.push({ url, node: q.object.value, ...(context ? { context } : {}) });
    }
  }
  return pictures;
}

/** `iri`'s picture for `context`: its picture for that audience, else the one for every audience — `undefined` with neither. */
export function pictureOf(store: RdfStore, iri: string, context: string | undefined): string | undefined {
  const pictures = picturesOf(store, iri);
  return (
    (context ? pictures.find((p) => p.context === context)?.url : undefined) ??
    store
      .getQuads(namedNode(iri) as never, T.prefVisNotation as never)
      .map((q) => urlOf(store, q.object))
      .find((url) => url !== undefined)
  );
}

/** The IRI of `iri`'s picture for `context` — for every audience when absent. */
export function pictureIri(iri: string, context: string | undefined): string {
  return context ? `${iri}-picture-${shortHash(context)}` : `${iri}-picture`;
}

/**
 * What changes to give `iri` the picture at `url` for `context` — for every
 * audience when `context` is absent — or, `null` or empty, to take it away:
 * the one it has for that scope goes, with what holds it when nothing else
 * points at it.
 */
export function pictureChange(
  store: RdfStore,
  iri: string,
  context: string | undefined,
  url: string | null,
): { remove: Quad[]; add: Quad[] } {
  const element = namedNode(iri);
  const predicate = (context ? T.altVisNotation : T.prefVisNotation) as NamedNode;
  const address = imageUri(url ?? undefined);
  // An address that is none changes nothing — it does not take the picture away either.
  if (url?.trim() && !address) return { remove: [], add: [] };
  const remove: Quad[] = [];
  for (const q of store.getQuads(element as never, predicate as never) as Quad[]) {
    const scope = q.object.termType === 'Literal' ? undefined : store.getQuads(q.object as never, T.inPresentationContext as never)[0]?.object.value;
    if (scope !== context) continue;
    remove.push(q);
    const shared = store.getQuads(null, null, q.object as never).length > 1;
    if (!shared && q.object.termType !== 'Literal') remove.push(...(store.getQuads(q.object as never) as Quad[]));
  }
  if (!address) return { remove, add: [] };
  const picture = namedNode(pictureIri(iri, context));
  const add: Quad[] = [
    quad(element, predicate, picture) as Quad,
    quad(picture, T.rdfType as NamedNode, T.ImageObject as NamedNode) as Quad,
    quad(picture, T.contentUrl as NamedNode, literal(address, namedNode(NAMESPACES.xsd + 'anyURI'))) as Quad,
    ...(context ? [quad(picture, T.inPresentationContext as NamedNode, namedNode(context)) as Quad] : []),
  ];
  return { remove, add };
}
