import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { ObservableRdfStore, quadKey } from '../../rdf-engine/observable-store.js';
import { OxigraphElementManager } from '../../model-manager/element-manager.js';
import { OxigraphViewManager } from '../../model-manager/view-manager.js';
import { modelQuads } from '../../model-manager/model-queries.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { RdfYjsBinding, keysToQuads, TRIPLES_MAP } from '../rdf-yjs-binding.js';

const nn = (v: string) => DataFactory.namedNode(v) as unknown as NamedNode;
const MODEL = 'urn:la-gram:model/test';
const TYPE = 'https://meta.linked.archi/archimate4/onto#ApplicationComponent';

/** Two Y.Docs wired to each other, as a server would relay them. */
function linkedDocs(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(b, update, 'relay');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(a, update, 'relay');
  });
  return [a, b];
}

/** A client: store + managers + binding. */
function client(doc: Y.Doc) {
  const base = new OxigraphRdfStore();
  const store = new ObservableRdfStore(base);
  const remoteEvents: number[] = [];
  const binding = new RdfYjsBinding(store, doc, { onRemoteChange: (c) => remoteEvents.push(c.added.length + c.removed.length) });
  return {
    base,
    store,
    binding,
    remoteEvents,
    elements: new OxigraphElementManager(store),
    views: new OxigraphViewManager(store),
    keys: () => modelQuads(store).map(quadKey).sort(),
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function pair() {
  const [da, db] = linkedDocs();
  const a = client(da);
  const b = client(db);
  cleanups.push(() => {
    a.binding.stop();
    b.binding.stop();
    a.base.dispose();
    b.base.dispose();
  });
  return { a, b };
}

describe('keysToQuads', () => {
  it('round-trips quads through their N-Triples keys, literals and blank nodes included', () => {
    const quads = [
      DataFactory.quad(DataFactory.namedNode('urn:s'), DataFactory.namedNode('urn:p'), DataFactory.literal('Ünïcode "quoted"\nline', 'en')),
      DataFactory.quad(DataFactory.namedNode('urn:s'), DataFactory.namedNode('urn:p'), DataFactory.literal('12.5', DataFactory.namedNode(NAMESPACES.xsd + 'double'))),
      DataFactory.quad(DataFactory.blankNode('b1'), DataFactory.namedNode('urn:p'), DataFactory.namedNode('urn:o')),
    ];
    const keys = quads.map((q) => quadKey(q as never));
    expect(keys.map((k) => keysToQuads([k])).map((qs) => quadKey(qs[0]))).toEqual(keys);
  });

  it('round-trips an RDF 1.2 triple term (a relationship’s rdf:reifies), nested ones too', () => {
    const { namedNode, quad } = DataFactory;
    const triple = quad(namedNode('urn:a'), namedNode('urn:p'), namedNode('urn:b'));
    const quads = [
      quad(namedNode('urn:r'), namedNode(NAMESPACES.rdf + 'reifies'), triple),
      quad(namedNode('urn:q'), namedNode(NAMESPACES.rdf + 'reifies'), quad(namedNode('urn:r'), namedNode('urn:says'), triple)),
    ];
    const keys = quads.map((q) => quadKey(q as never));
    expect(keys[0]).toBe('<urn:r> <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<( <urn:a> <urn:p> <urn:b> )>>');
    const back = keysToQuads(keys);
    expect(back.map((q) => quadKey(q))).toEqual(keys);
    expect(back[0].object.termType).toBe('Quad');
  });
});

describe('RdfYjsBinding', () => {
  it('an edit on one client appears on the other, and nothing echoes back', () => {
    const { a, b } = pair();
    a.binding.start();
    b.binding.start();

    const el = a.elements.createElement(TYPE, MODEL, { label: 'Order Service' }).value;

    expect(b.keys()).toEqual(a.keys());
    expect(b.store.getQuads(nn(el)).length).toBeGreaterThan(0);
    expect(b.remoteEvents.length).toBe(1);
    // A's own change came back to A as nothing.
    expect(a.remoteEvents.length).toBe(0);

    b.elements.deleteElement(el);
    expect(a.store.getQuads(nn(el))).toHaveLength(0);
  });

  it('a new room receives the local model; a joining client takes the room model', () => {
    const { a, b } = pair();
    a.elements.createElement(TYPE, MODEL, { label: 'Local on A' });
    b.elements.createElement(TYPE, MODEL, { label: 'Local on B (discarded)' });

    a.binding.start('prefer-room'); // room empty → A's model goes in
    b.binding.start('prefer-room'); // room has A's model → B takes it

    expect(b.keys()).toEqual(a.keys());
    expect(b.keys().join('\n')).toContain('Local on A');
    expect(b.keys().join('\n')).not.toContain('Local on B');
  });

  it('push-local replaces what the room holds', () => {
    const { a, b } = pair();
    a.elements.createElement(TYPE, MODEL, { label: 'Old room content' });
    a.binding.start();
    b.elements.createElement(TYPE, MODEL, { label: 'Shared by B' });
    b.binding.start('push-local');
    expect(a.keys().join('\n')).toContain('Shared by B');
    expect(a.keys().join('\n')).not.toContain('Old room content');
  });

  it('concurrent moves of the same node converge to one set of bounds on both clients', () => {
    const [da, db] = [new Y.Doc(), new Y.Doc()];
    const a = client(da);
    const b = client(db);
    cleanups.push(() => {
      a.binding.stop();
      b.binding.stop();
      a.base.dispose();
      b.base.dispose();
    });
    // Same starting state on both, then offline.
    a.binding.start();
    const el = a.elements.createElement(TYPE, MODEL).value;
    const view = a.views.createView('Diagram', undefined, { modelIri: MODEL }).value;
    a.views.addElementToView(view, el, { x: 0, y: 0, width: 120, height: 55 });
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
    b.binding.start();

    // Both move the node while disconnected.
    a.views.updateNodeBounds(view, el, { x: 100, y: 0, width: 120, height: 55 });
    b.views.updateNodeBounds(view, el, { x: 300, y: 50, width: 120, height: 55 });

    // Reconnect: exchange everything.
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da, Y.encodeStateVector(db)));
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)));
    // Normalisation retracts losers as local changes; relay those too.
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da, Y.encodeStateVector(db)));
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)));

    const boundsX = (c: typeof a) =>
      c.store.getQuads(null, nn(NAMESPACES['arch-vis'] + 'bounds-x')).filter((q) => q.graph.termType === 'DefaultGraph');
    expect(boundsX(a)).toHaveLength(1);
    expect(boundsX(b)).toHaveLength(1);
    expect(a.keys()).toEqual(b.keys());
    expect(da.getMap(TRIPLES_MAP).size).toBe(a.keys().length);
  });
});
