/**
 * The shape a finding points to: its source shape when that is named, else
 * the named shape it is written in (`withinShape`). A shape with neither — a
 * blank node's id is no IRI — has none to point to.
 */
import type { ValidationResult } from './interfaces.js';

/** Whether a term's value is an IRI (`scheme:…`), not a blank node's id (`e7c5f6…`, `n3-4`, `_:b0`). */
export function isIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !value.startsWith('_:');
}

/** The IRI of the shape a finding comes from, or of the named shape it is written in; none when neither has one. */
export function shapeIriOf(result: Pick<ValidationResult, 'sourceShape' | 'withinShape'>): string | undefined {
  const named = (term: { termType?: string; value: string } | undefined) =>
    term && term.termType !== 'BlankNode' && isIri(term.value) ? term.value : undefined;
  return named(result.sourceShape) ?? named(result.withinShape);
}

/** Whether an IRI can be opened as a link (`http:`, `https:`). */
export function isLink(iri: string): boolean {
  return /^https?:\/\//i.test(iri);
}
