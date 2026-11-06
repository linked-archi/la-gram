/**
 * Quads as plain data, to post to a worker and back (Task 22): structured
 * cloning keeps no class, so a term becomes its n3 id — `<iri>` as the IRI,
 * `_:b1`, `"text"@en`, `"1"^^<…#double>` — and an RDF 1.2 triple term (what a
 * relationship `rdf:reifies`) a nested array of three.
 */
import { DataFactory, termFromId, termToId } from 'n3';
import type { Quad, Term } from '@rdfjs/types';

/** A term: its n3 id, or a triple term's three. */
export type EncodedTerm = string | [EncodedTerm, EncodedTerm, EncodedTerm];

/** A quad: subject, predicate, object — and a graph when not the default one. */
export type EncodedQuad = [EncodedTerm, EncodedTerm, EncodedTerm] | [EncodedTerm, EncodedTerm, EncodedTerm, string];

function encodeTerm(term: Term): EncodedTerm {
  if (term.termType === 'Quad') {
    const q = term as unknown as Quad;
    return [encodeTerm(q.subject), encodeTerm(q.predicate), encodeTerm(q.object)];
  }
  return termToId(term as never);
}

function decodeTerm(encoded: EncodedTerm): Term {
  if (Array.isArray(encoded)) {
    return DataFactory.quad(decodeTerm(encoded[0]) as never, decodeTerm(encoded[1]) as never, decodeTerm(encoded[2]) as never) as unknown as Term;
  }
  return termFromId(encoded, DataFactory as never) as unknown as Term;
}

export function encodeQuad(q: Quad): EncodedQuad {
  const triple: [EncodedTerm, EncodedTerm, EncodedTerm] = [encodeTerm(q.subject), encodeTerm(q.predicate), encodeTerm(q.object)];
  return q.graph.termType === 'DefaultGraph' ? triple : [...triple, termToId(q.graph as never)];
}

export function decodeQuad(e: EncodedQuad): Quad {
  return DataFactory.quad(
    decodeTerm(e[0]) as never,
    decodeTerm(e[1]) as never,
    decodeTerm(e[2]) as never,
    e.length === 4 ? (termFromId(e[3], DataFactory as never) as never) : DataFactory.defaultGraph(),
  ) as unknown as Quad;
}

export function encodeQuads(quads: readonly Quad[]): EncodedQuad[] {
  return quads.map(encodeQuad);
}

export function decodeQuads(encoded: readonly EncodedQuad[]): Quad[] {
  return encoded.map(decodeQuad);
}
