// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../../rdf-engine/observable-store.js';
import { RdfLabelEditingProvider, RelabelElementHandler, isRenamable, isViewReference, normalizeLabel, type RelabelContext } from '../rdf-label-editing.js';
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

describe('what a line from a note says, typed on it', () => {
  const LINK = 'https://example.org/m/view-1-link-1';
  const line = (extra: Record<string, unknown> = {}) => ({
    id: LINK,
    parent: {},
    waypoints: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
    businessObject: { iri: LINK, linkIri: LINK, typeIri: '', kind: 'connector' as const, ...extra },
  });

  it('is offered on a drawn line, its box at the middle holding its text; written, rewritten and emptied', () => {
    expect(isRenamable(line())).toBe(true);
    expect(isRenamable({ ...line(), parent: undefined })).toBe(false);
    expect(isRenamable(line({ iri: '' }))).toBe(false);
    const { provider, executed } = providerWith();
    const said = provider.activate(line({ label: 'asks', named: true }))!;
    expect(said.text).toBe('asks');
    expect(said.bounds.x + said.bounds.width / 2).toBeCloseTo(100);
    expect(provider.activate(line())!.text).toBe('');
    provider.update(line(), ' asks\n first ');
    provider.update(line({ label: 'asks first', named: true }), 'asks first');
    provider.update(line({ label: 'asks first', named: true }), '');
    expect(executed.map((c) => c.label)).toEqual(['asks first', '']);
  });
});

describe('a reference to another view: double-clicked it opens, F2 edits its text (Req 3.23)', () => {
  const REF = 'https://example.org/m/view/1#node-1';
  const reference = (extra: Record<string, unknown> = {}) => ({
    id: REF,
    parent: {},
    x: 0,
    y: 0,
    width: 120,
    height: 55,
    // No text of its own: the view's name, drawn, not `named`.
    businessObject: { iri: REF, typeIri: '', kind: 'figure' as const, figure: { kind: 'reference' as const, view: 'https://example.org/m/view/2' }, label: 'Payments', named: false, ...extra },
  });

  it('is left out of double-click editing — the canvas opens its view — and edited on F2, as a note is on both', () => {
    const handlers = new Map<string, Array<(event: unknown) => unknown>>();
    const on = (events: string | string[], priorityOrCallback: number | ((event: unknown) => unknown), callback?: (event: unknown) => unknown) => {
      const handler = typeof priorityOrCallback === 'function' ? priorityOrCallback : callback!;
      for (const event of [events].flat()) handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    };
    const fire = (event: string, payload: unknown) => handlers.get(event)?.forEach((handler) => handler(payload));
    const activated: unknown[] = [];
    let selected: unknown[] = [];
    new RdfLabelEditingProvider(
      { on } as never,
      { getAbsoluteBBox: (box) => box as never, zoom: () => 1, getContainer: () => document.createElement('div'), addMarker: () => undefined, removeMarker: () => undefined },
      { registerProvider: () => undefined, activate: (element: unknown) => void activated.push(element), isActive: () => false, complete: () => undefined } as never,
      { registerHandler: () => undefined, execute: () => undefined },
      { get: () => selected as never },
    );
    const ref = reference();
    const note = { ...reference(), businessObject: { ...reference().businessObject, figure: { kind: 'note' as const }, named: true } };
    fire('element.dblclick', { element: ref });
    expect(activated).toEqual([]);
    fire('element.dblclick', { element: note });
    expect(activated).toEqual([note]);
    selected = [ref];
    fire('keyboard.keydown', { keyEvent: { key: 'F2', preventDefault: () => undefined } });
    expect(activated).toEqual([note, ref]);
    expect(isViewReference(ref)).toBe(true);
    expect(isViewReference(note)).toBe(false);
  });

  it('gets text of its own, changed, emptied — drawn as nothing; what it shows unchanged is no edit; a note’s is emptied too', () => {
    const { provider, executed } = providerWith();
    // The box holds what is drawn: the view's name.
    expect(provider.activate(reference())!.text).toBe('Payments');
    provider.update(reference(), 'Payments');
    provider.update(reference(), '');
    provider.update(reference(), ' See  also ');
    provider.update(reference({ label: 'See also', named: true }), 'See also');
    provider.update(reference({ label: 'See also', named: true }), 'Read next');
    provider.update(reference({ label: 'See also', named: true }), '');
    provider.update(reference({ label: '', named: true }), '');
    expect(executed.map((c) => c.label)).toEqual(['', 'See also', 'Read next', '']);
    // A note's text, emptied: an edit, where an element's name is never emptied.
    const note = { ...reference(), businessObject: { ...reference().businessObject, figure: { kind: 'note' as const }, label: 'Draft', named: true } };
    provider.update(note, '');
    provider.update({ ...note, businessObject: { ...note.businessObject, label: undefined, named: false } }, '');
    expect(executed.map((c) => c.label)).toEqual(['', 'See also', 'Read next', '', '']);
  });
});

describe('the box a name is typed in, set as the name is drawn', () => {
  const shape = (extra: Record<string, unknown> = {}, size = { width: 160, height: 80 }) => ({
    id: IRI,
    parent: {},
    x: 0,
    y: 0,
    ...size,
    businessObject: { iri: IRI, typeIri: 'x', kind: 'element' as const, label: 'Payment API', named: true, ...extra },
  });

  it('in the placement’s font, size and style, aligned as its text is', () => {
    const { provider } = providerWith({ look: { fontName: 'Georgia', fontSize: 14, fontStyle: 'bold italic', textAlignment: 'left', fontColor: '#1a73e8' } });
    const context = provider.activate(shape())!;
    expect(context.style).toMatchObject({ fontFamily: `"Georgia", ${NOTATION_DEFAULTS.fontFamily}`, fontSize: '14px', fontWeight: 'bold', textAlign: 'left' });
    expect(context.options?.centerVertically).toBe(true);
  });

  it('from the top, or with its last line at the bottom; under an element drawn as its icon', () => {
    expect(providerWith({ look: { textPosition: 'top' } }).provider.activate(shape())!.options?.centerVertically).toBe(false);
    const bottom = providerWith({ look: { textPosition: 'bottom' } }).provider.activate(shape())!;
    expect(parseFloat(bottom.style!.paddingTop!)).toBeGreaterThan(40);
    const icon = providerWith({ mode: 'IconCentric' }).provider.activate(shape())!;
    expect(icon.bounds.y).toBeGreaterThan(40);
    expect(icon.bounds.y + icon.bounds.height).toBe(80);
  });

  it('a group’s in its tab, a note’s from its top left', () => {
    const group = providerWith({ look: { textAlignment: 'left', textPosition: 'top' } }).provider.activate(
      shape({ kind: 'figure', figure: { kind: 'group' } }, { width: 400, height: 300 }),
    )!;
    expect([group.bounds.y, group.bounds.height, group.style?.textAlign]).toEqual([0, 20, 'left']);
    const note = providerWith({ look: { textAlignment: 'left', textPosition: 'top' } }).provider.activate(
      shape({ kind: 'figure', figure: { kind: 'note' } }, { width: 185, height: 80 }),
    )!;
    expect([note.style?.textAlign, note.style?.paddingLeft, note.options?.centerVertically]).toEqual(['left', '6px', false]);
  });
});

/** The provider over stand-ins for diagram-js's services; the canvas at zoom 1, unscrolled. */
function providerWith(drawn?: { look?: Record<string, unknown>; mode?: string }) {
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
    // How la-gram's renderer draws the name, when the test says.
    drawn
      ? { get: (name: string) => (name === 'rdfRenderer' ? { drawnLook: () => drawn.look ?? {}, drawnMode: () => drawn.mode ?? 'ShapeWithBadge' } : null) }
      : null,
  );
  return { provider, executed };
}
