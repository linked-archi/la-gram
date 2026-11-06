/**
 * References to something the model does not have: a relationship's end, a
 * view node's element, a link's relationship or end shapes, a shape's view, a
 * route's cells, `arch:inView`, `arch:inModel`, a folder entry. la-gram never
 * leaves one — deleting a concept deletes what hangs on it — but a file merged
 * as text on a Git host, edited by hand or written by another tool can: one
 * branch deletes CRM, another relates something to it, and both merge cleanly
 * line by line. Phase 3 of the Git collaboration plan: found by the validation
 * engine, so the editor's Validation tab and CI report them alike.
 *
 * "Not in the model" is "nothing is said about it": no triple has it as its
 * subject. Each finding is a violation about the node that refers, its path the
 * property; it has no shape — no vocabulary is made up for it — so the
 * Validation tab shows no shape line.
 */

import type { Quad, Term } from '@rdfjs/types';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import { IRI } from './vocabulary.js';

/** What a reference by each property must name, in words. */
const MUST_NAME: ReadonlyMap<string, string> = new Map([
  [IRI.source, 'Its source'],
  [IRI.target, 'Its target'],
  [IRI.legacyRelSource, 'Its source'],
  [IRI.legacyRelTarget, 'Its target'],
  [IRI.archElement, 'The element it shows'],
  [IRI.archRelationship, 'The relationship it shows'],
  [IRI.visSource, 'The shape it starts at'],
  [IRI.visTarget, 'The shape it ends at'],
  [IRI.visView, 'Its view'],
  [IRI.inNode, 'The shape it is inside'],
  [IRI.visLabel, 'Its label'],
  [IRI.points, 'Its route'],
  [IRI.rdfFirst, 'A point of its route'],
  [IRI.rdfRest, 'The rest of its route'],
  [IRI.inView, 'A view it is in'],
  [IRI.inModel, 'Its model'],
  [IRI.dctermsIsPartOf, 'The folder it is in'],
  ['https://schema.org/itemListElement', 'An entry of the folder'],
  ['http://schema.org/itemListElement', 'An entry of the folder'],
  ['https://schema.org/item', 'What the folder entry holds'],
  ['http://schema.org/item', 'What the folder entry holds'],
]);

/** The store the check reads: the model's triples by pattern. */
export interface ReferenceSource {
  getQuads(subject: Term | null, predicate: Term | null, object: Term | null, graph: Term | null): Quad[];
}

/**
 * The references in `data` to what it does not have — of every node, or of the
 * `focus` nodes only (their own triples).
 */
export function missingReferences(data: ReferenceSource, focus?: readonly Term[]): ValidationResult[] {
  const quads = focus ? focus.flatMap((node) => data.getQuads(node, null, null, null)) : data.getQuads(null, null, null, null);
  const known = new Map<string, boolean>();
  const exists = (node: Term): boolean => {
    const key = `${node.termType}:${node.value}`;
    let found = known.get(key);
    if (found === undefined) {
      found = data.getQuads(node, null, null, null).length > 0;
      known.set(key, found);
    }
    return found;
  };
  const results: ValidationResult[] = [];
  for (const q of quads) {
    const what = MUST_NAME.get(q.predicate.value);
    const o = q.object as Term;
    if (!what || (o.termType !== 'NamedNode' && o.termType !== 'BlankNode')) continue;
    if (o.termType === 'NamedNode' && o.value === IRI.rdfNil) continue;
    if (exists(o)) continue;
    results.push({
      focusNode: q.subject as ValidationResult['focusNode'],
      resultPath: q.predicate as ValidationResult['resultPath'],
      sourceShape: { termType: 'NamedNode', value: '' } as ValidationResult['sourceShape'],
      message: `${what} is not in the model: ${o.termType === 'BlankNode' ? `_:${o.value}` : o.value}`,
      severity: 'Violation',
    });
  }
  return results;
}
