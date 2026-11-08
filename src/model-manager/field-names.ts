/**
 * A property's name in words, as the Properties tab shows it — and the History
 * tab's changes by element, and la-gram-git's (`src/cli/`), which run without
 * the UI.
 */

import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { humanize, sentenceCase } from './vocabulary.js';

/** The name an IRI has in the loaded data, if it has one (reference data's `skos:prefLabel`). */
export type NameOf = (iri: string) => string | undefined;

/** The fields every concept has, by the names a modeller knows them by. */
const FIELD_NAMES: Record<string, string> = {
  [NAMESPACES.rdf + 'type']: 'Type',
  [NAMESPACES.arch + 'inModel']: 'Model',
  [NAMESPACES.skos + 'prefLabel']: 'Name',
  [NAMESPACES.skos + 'definition']: 'Definition',
  [NAMESPACES.skos + 'altLabel']: 'Other name',
};

/** The fragment after `#`, or the last path segment. */
function lastPart(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash !== -1) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  return slash !== -1 ? iri.slice(slash + 1) : iri;
}

/**
 * A field's name: a familiar one for the fields every concept has
 * ({@link FIELD_NAMES}); else the shape's (`sh:name`) or the vocabulary's,
 * when it is more than the property's local name again (`source`); else that
 * local name in words (`modelRepresentsSystem` → `Model represents system`).
 */
export function fieldName(predicate: string, shape?: { name?: string }, nameOf?: NameOf): string {
  const familiar = FIELD_NAMES[predicate];
  if (familiar) return familiar;
  const local = lastPart(predicate);
  const named = [shape?.name, nameOf?.(predicate)].find((name) => name && name !== local);
  return named ? named.charAt(0).toUpperCase() + named.slice(1) : sentenceCase(humanize(local));
}
