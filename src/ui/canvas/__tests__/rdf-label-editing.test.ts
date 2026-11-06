// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../../rdf-engine/observable-store.js';
import { RdfLabelEditingProvider, RelabelElementHandler, isRenamable, normalizeLabel, type RelabelContext } from '../rdf-label-editing.js';
import { NOTATION_DEFAULTS } from '../notation-shapes.js';
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

describe('naming a relationship on its line', () => {
  const REL = 'https://example.org/m/relationship-1';
  const line = (extra: Record<string, unknown> = {}) => ({
    id: REL,
    parent: {},
    waypoints: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
    businessObject: { iri: REL, typeIri: 'x', kind: 'relationship' as const, ...extra },
  });

  it('is offered on a stated relationship’s line, not on a derivation, a bare triple or the root', () => {
    expect(isRenamable(line())).toBe(true);
    expect(isRenamable({ ...line(), parent: undefined })).toBe(false);
    expect(isRenamable(line({ derivation: 'valid' }))).toBe(false);
    expect(isRenamable(line({ iri: 'https://example.org/m/a--https://example.org/mm#Serving-->https://example.org/m/b' }))).toBe(false);
    expect(isRenamable({ id: IRI, parent: {}, businessObject: { iri: IRI, typeIri: 'x', kind: 'element' } })).toBe(true);
  });

  it('opens the box where the name is drawn, holding the name — or nothing for an unnamed one', () => {
    const { provider } = providerWith();
    const named = provider.activate(line({ label: 'Serves orders', named: true }))!;
    expect(named.text).toBe('Serves orders');
    // Centred on the middle of the route (100, 0), at least an element wide, on white.
    expect(named.bounds.x + named.bounds.width / 2).toBeCloseTo(100);
    expect(named.bounds.y).toBeLessThan(0);
    expect(named.bounds.y + named.bounds.height).toBeGreaterThan(0);
    expect(named.bounds.width).toBeGreaterThanOrEqual(NOTATION_DEFAULTS.width);
    expect(named.style?.backgroundColor).toBe('#ffffff');
    // Unnamed: its type is not offered as a name.
    expect(provider.activate(line({ label: 'Serving' }))!.text).toBe('');
    expect(provider.activate(line({ derivation: 'potential' }))).toBeNull();
  });

  it('names, renames and — emptied — removes the name; an unchanged one is no edit; an element’s is never emptied', () => {
    const { provider, executed } = providerWith();
    provider.update(line(), '  Serves\n orders ');
    provider.update(line({ label: 'Serves orders', named: true }), 'Serves orders');
    provider.update(line({ label: 'Serves orders', named: true }), '');
    provider.update(line(), '');
    provider.update({ id: IRI, parent: {}, businessObject: { iri: IRI, typeIri: 'x', kind: 'element', label: 'Clerk' } }, '');
    expect(executed.map((c) => c.label)).toEqual(['Serves orders', '']);
  });

  it('removing the name is one undoable step: the line has no name, then has it back', () => {
    const store = new ObservableRdfStore(new OxigraphRdfStore());
    store.addQuads([quad(namedNode(REL), namedNode(PREF_LABEL), literal('Serves orders', 'en')) as unknown as Quad]);
    const writer = (iri: string, label: string) => {
      store.removeQuads(store.getQuads(namedNode(iri) as never, namedNode(PREF_LABEL) as never));
      if (label) store.addQuads([quad(namedNode(iri), namedNode(PREF_LABEL), literal(label, 'en')) as unknown as Quad]);
    };
    const handler = new RelabelElementHandler(store, writer);
    const drawn = line({ label: 'Serves orders', named: true });
    const context = { element: drawn, label: '' } as RelabelContext & RdfChangeContext;

    handler.execute(context);
    expect(store.getQuads(namedNode(REL) as never, namedNode(PREF_LABEL) as never)).toHaveLength(0);
    expect(drawn.businessObject).toMatchObject({ label: undefined, named: false });

    handler.revert(context);
    expect(store.getQuads(namedNode(REL) as never, namedNode(PREF_LABEL) as never).map((q) => q.object.value)).toEqual(['Serves orders']);
    expect(drawn.businessObject).toMatchObject({ label: 'Serves orders', named: true });
  });
});

/** The provider over stand-ins for diagram-js's services; the canvas at zoom 1, unscrolled. */
function providerWith() {
  const executed: RelabelContext[] = [];
  const provider = new RdfLabelEditingProvider(
    { on: () => undefined },
    {
      getAbsoluteBBox: (box) => box as { x: number; y: number; width: number; height: number },
      zoom: () => 1,
      getContainer: () => document.createElement('div'),
      addMarker: () => undefined,
      removeMarker: () => undefined,
    },
    { registerProvider: () => undefined } as never,
    { registerHandler: () => undefined, execute: (_command, context) => void executed.push(context) },
    { get: () => [] },
  );
  return { provider, executed };
}
