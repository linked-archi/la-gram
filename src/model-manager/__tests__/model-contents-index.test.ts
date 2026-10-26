/**
 * The model's contents kept up to date by its changes (Task 22) are the
 * contents read whole, edit after edit — and are not read whole to be so.
 */
import { describe, it, expect, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { createApp } from '../../app.js';
import { ModelContentsIndex, readModelContents, typeClosure } from '../model-queries.js';
import type { ObservableRdfStore } from '../../rdf-engine/observable-store.js';

const { namedNode, literal, quad } = DataFactory;
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

describe('the model contents index', () => {
  it('lists what reading the whole model lists, after each edit', async () => {
    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
    const { modelIri } = app.newModel('Contents');
    const { elementManager: e, relationshipManager: r, viewManager: v } = app.components;
    const store = app.components.store as unknown as ObservableRdfStore;
    const closure = () => typeClosure(store);
    const index = new ModelContentsIndex(store, closure);
    store.subscribe((change) => index.note(change));
    const same = () => expect(index.contents(v.getViews())).toEqual(readModelContents(store, v.getViews(), closure()));

    const actor = e.createElement(AM4 + 'BusinessActor', modelIri, { label: 'Clerk' }).value;
    const role = e.createElement(AM4 + 'Role', modelIri, { label: 'Agent' }).value;
    same();
    const assigned = r.createQualifiedRelationship({ typeIri: AM4 + 'Assignment', sourceIri: actor, targetIri: role }).iri;
    same();
    // One concept as the tree lists it: its kind, name and type; a view is none.
    expect(index.concept(actor)).toMatchObject({ kind: 'element', summary: { label: 'Clerk', typeIri: AM4 + 'BusinessActor' } });
    expect(index.concept(assigned)).toMatchObject({ kind: 'relationship', summary: { label: 'Clerk → Agent' } });
    expect(index.concept(v.getViews()[0]!.iri)).toBeUndefined();

    // Renamed: the relationship labelled with its ends' names follows — and
    // only the concepts touched are read, not the whole model.
    e.updateProperty(actor, PREF_LABEL, literal('Teller', 'en') as never);
    const read = vi.spyOn(store, 'getQuads');
    const contents = index.contents(v.getViews());
    expect(read.mock.calls.some(([s, p, o]) => !s && !p && !o)).toBe(false);
    read.mockRestore();
    expect(contents.relationships.find((x) => x.iri === assigned)?.label).toBe('Teller → Agent');
    same();

    // Retyped, given a name of its own, unnamed, deleted.
    store.removeQuads([quad(namedNode(role), namedNode(RDF_TYPE), namedNode(AM4 + 'Role')) as unknown as Quad]);
    store.addQuads([quad(namedNode(role), namedNode(RDF_TYPE), namedNode(AM4 + 'BusinessActor')) as unknown as Quad]);
    same();
    store.addQuads([quad(namedNode(assigned), namedNode(PREF_LABEL), literal('Works as', 'en')) as unknown as Quad]);
    same();
    store.removeQuads(store.getQuads(namedNode(role) as never, namedNode(PREF_LABEL) as never, null));
    same();
    e.deleteElement(actor);
    same();

    // A type no longer: gone from the lists. The model renamed.
    store.removeQuads(store.getQuads(namedNode(role) as never, namedNode(RDF_TYPE) as never, null));
    same();
    store.removeQuads(store.getQuads(namedNode(modelIri) as never, namedNode(PREF_LABEL) as never, null));
    store.addQuads([quad(namedNode(modelIri), namedNode(PREF_LABEL), literal('Renamed', 'en')) as unknown as Quad]);
    same();

    // The class hierarchy changed: read whole.
    store.addQuads([quad(namedNode('https://example.org/MyActor'), namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'), namedNode(AM4 + 'BusinessActor')) as unknown as Quad]);
    e.createElement('https://example.org/MyActor', modelIri, { label: 'Special' });
    same();
  }, 120_000);
});
