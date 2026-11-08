/**
 * The presentation contexts the loaded metamodels name — the audiences the
 * toolbar's *Presentation* and the property panel's *Names by presentation*
 * offer — each by its name; where two share a name (ArchiMate 3.2's and 4.0's
 * contexts do), each with its scheme's, so that a name typed for one is not
 * typed for the other.
 */
export function contextChoices(
  contexts: ReadonlyArray<{ iri: string; label: string; schemeLabel: string }>,
): Array<{ iri: string; label: string }> {
  return contexts.map(({ iri, label, schemeLabel }) =>
    contexts.filter((c) => c.label === label).length > 1 ? { iri, label: `${label} (${schemeLabel})` } : { iri, label },
  );
}
