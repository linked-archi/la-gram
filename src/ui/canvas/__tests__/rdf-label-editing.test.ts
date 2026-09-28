import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../../rdf-engine/observable-store.js';
import { RelabelElementHandler, normalizeLabel, type RelabelContext } from '../rdf-label-editing.js';
import type { RdfChangeContext } from '../rdf-modeling.js';

const { namedNode, literal, quad } = DataFactory;
const IRI = 'https://example.org/m/element-1';
const PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';

function names(store: ObservableRdfStore): string[] {
  return store.getQuads(namedNode(IRI) as never, namedNode(PREF_LABEL) as never).map((q) => (q.object as { value: string }).value);
}

describe('normalizeLabel', () => {
  it('keeps one line, spaces collapsed', () => {
    expect(normalizeLabel('  Front\n desk\t clerk ')).toBe('Front desk clerk');
    expect(normalizeLabel(' \n ')).toBe('');
  });
});

describe('RelabelElementHandler', () => {
  it('renames in the model and on the shape; undo restores both exactly, redo re-applies', () => {
    const store = new ObservableRdfStore(new OxigraphRdfStore());
    store.addQuads([quad(namedNode(IRI), namedNode(PREF_LABEL), literal('Business Actor', 'en')) as unknown as Quad]);
    const writer = (iri: string, label: string) => {
      const old = store.getQuads(namedNode(iri) as never, namedNode(PREF_LABEL) as never);
      store.removeQuads(old);
      store.addQuads([quad(namedNode(iri), namedNode(PREF_LABEL), literal(label, 'en')) as unknown as Quad]);
    };
    const handler = new RelabelElementHandler(store, writer);
    const shape = { id: IRI, businessObject: { iri: IRI, typeIri: 'x', kind: 'element' as const, label: 'Business Actor' } };
    const context = { element: shape, label: 'Front desk clerk' } as RelabelContext & RdfChangeContext;

    expect(handler.execute(context)).toEqual([shape]);
    expect(names(store)).toEqual(['Front desk clerk']);
    expect(shape.businessObject.label).toBe('Front desk clerk');

    handler.revert(context);
    expect(names(store)).toEqual(['Business Actor']);
    expect(shape.businessObject.label).toBe('Business Actor');

    // Redo replays the recorded change rather than writing again.
    handler.execute(context);
    expect(names(store)).toEqual(['Front desk clerk']);
    expect(shape.businessObject.label).toBe('Front desk clerk');
  });
});
