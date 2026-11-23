/**
 * TTL Serializer implementation using N3.js.
 *
 * Serializes RDF quads to pretty-printed Turtle with namespace prefix
 * declarations at the top, triples grouped by subject, and consistent
 * indentation. Uses the shortest matching prefix for each IRI, and for the
 * model the quads are about, the layout's own prefixes (`turtle-writer.ts`).
 */

import type { Quad } from '@rdfjs/types';
import type { TtlSerializer, PrefixMap } from './interfaces.js';
import { writeTurtle, type TurtleModel } from './turtle-writer.js';

/**
 * Select the shortest matching prefix for each namespace IRI.
 *
 * When multiple prefixes map to IRIs where one is a prefix of another
 * (e.g. `arch: → …/core#` and `arch-vis: → …/core-vis#`), N3.js may
 * pick the wrong one. We deduplicate by keeping only the longest
 * namespace URI per prefix so that the Writer's regex-based matching
 * naturally selects the most specific (and therefore shortest-label)
 * prefix for any given IRI.
 */
function buildPrefixMap(prefixes: PrefixMap): PrefixMap {
  // Sort entries so that longer namespace URIs come first.
  // N3.js Writer builds a regex from the prefixes and matches the first
  // one that fits, so ordering matters for "shortest prefix" selection.
  const entries = Object.entries(prefixes).filter(
    ([, uri]) => uri.length > 0,
  );

  // Deduplicate: if two prefixes point to the exact same URI, keep the
  // shorter prefix label (that's the "shortest matching prefix" rule).
  const uriToPrefix = new Map<string, string>();
  for (const [prefix, uri] of entries) {
    const existing = uriToPrefix.get(uri);
    if (!existing || prefix.length < existing.length) {
      uriToPrefix.set(uri, prefix);
    }
  }

  // Rebuild the map keeping only the winning prefixes, preserving all
  // unique namespace URIs.
  const result: PrefixMap = {};
  for (const [prefix, uri] of entries) {
    if (uriToPrefix.get(uri) === prefix) {
      result[prefix] = uri;
    }
  }
  return result;
}

/**
 * Concrete implementation of TtlSerializer backed by N3.js Writer.
 *
 * The Writer natively handles:
 * - `@prefix` declarations at the top of the output
 * - Grouping triples by subject (using `;` for predicate lists)
 * - Consistent indentation
 */
export class N3TtlSerializer implements TtlSerializer {
  serialize(quads: Quad[], prefixes: PrefixMap, model?: TurtleModel): string {
    const cleanPrefixes = buildPrefixMap(prefixes);

    // Sort quads by subject IRI so the output is deterministic and
    // logically grouped.
    const sorted = [...quads].sort((a, b) => {
      const sa = a.subject.value;
      const sb = b.subject.value;
      if (sa !== sb) return sa < sb ? -1 : 1;
      const pa = a.predicate.value;
      const pb = b.predicate.value;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a.object.value < b.object.value ? -1 : a.object.value > b.object.value ? 1 : 0;
    });

    return writeTurtle(sorted, { prefixes: cleanPrefixes, ...(model ? { model } : {}) });
  }
}
