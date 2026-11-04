/**
 * The model's folders, changed (Req 10.13–10.15): made, renamed, moved into and
 * deleted — each a change of quads that undoes by its inverse, and read back by
 * the folder reader as the tree reads them.
 */
import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { createApp } from '../../app.js';
import type { RdfStore } from '../../rdf-engine/interfaces.js';
import { applyFolderChange, deleteFolder, moveToFolder, newFolder, renameFolder, type FolderChange } from '../folders.js';
import { modelQuads, readFolders } from '../model-queries.js';

const { namedNode, literal, quad, blankNode } = DataFactory;
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const FOLDER = 'https://meta.linked.archi/core#Folder';
const IS_PART_OF = 'http://purl.org/dc/terms/isPartOf';
const SCHEMA = 'https://schema.org/';
const q = (s: string, p: string, o: string) => quad(namedNode(s), namedNode(p), namedNode(o)) as unknown as Quad;

async function model() {
  const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
  const { modelIri } = app.newModel('Folders');
  const store = app.components.store as RdfStore;
  const element = (label: string) => app.components.elementManager.createElement(AM4 + 'BusinessActor', modelIri, { label }).value;
  /** The folders as the tree reads them: name, the folder it is in, and what it holds, by name. */
  const folders = () => {
    const all = readFolders(store);
    const name = (iri: string | undefined) => all.find((f) => f.iri === iri)?.label ?? iri;
    return all.map((f) => ({ name: f.label, in: f.parentIri ? name(f.parentIri) : undefined, holds: f.members.slice().sort() })).sort((a, b) => a.name.localeCompare(b.name));
  };
  /** Make a change, and give back what undoes it. */
  const apply = (change: FolderChange): FolderChange => {
    applyFolderChange(store, change);
    return { remove: change.add, add: change.remove };
  };
  const snapshot = () => modelQuads(store).map((x) => `${x.subject.value} ${x.predicate.value} ${x.object.value}`).sort();
  return { app, modelIri, store, element, folders, apply, snapshot };
}

describe('folders made in la-gram', () => {
  it('are made at the top of the model or in another, named in English, minted in the model namespace', async () => {
    const { modelIri, store, folders, apply } = await model();
    const business = newFolder(store, modelIri, 'Business');
    apply(business.change);
    const actors = newFolder(store, modelIri, 'Actors', business.iri);
    apply(actors.change);

    expect(business.iri).toMatch(/\/folder-[0-9a-f-]{36}$/);
    expect(folders()).toEqual([
      { name: 'Actors', in: 'Business', holds: [] },
      { name: 'Business', in: undefined, holds: [] },
    ]);
    // At the top: part of the model. A name in English, as every label la-gram writes.
    expect(store.getQuads(namedNode(business.iri) as NamedNode, namedNode(IS_PART_OF) as NamedNode, null).map((x) => x.object.value)).toEqual([modelIri]);
    const [name] = store.getQuads(namedNode(business.iri) as NamedNode, namedNode(SCHEMA + 'name') as NamedNode, null);
    expect(name.object).toMatchObject({ value: 'Business', language: 'en' });
  }, 60_000);

  it('are renamed, and what is moved into one leaves every folder it was in — undone by the inverse', async () => {
    const { modelIri, store, element, folders, apply, snapshot } = await model();
    const clerk = element('Clerk');
    const people = newFolder(store, modelIri, 'People');
    const desk = newFolder(store, modelIri, 'Desk');
    apply(people.change);
    apply(desk.change);
    apply(renameFolder(store, people.iri, 'Staff'));
    expect(folders().map((f) => f.name)).toEqual(['Desk', 'Staff']);

    apply(moveToFolder(store, clerk, people.iri, modelIri));
    expect(folders().find((f) => f.name === 'Staff')?.holds).toEqual([clerk]);
    const before = snapshot();
    const undo = apply(moveToFolder(store, clerk, desk.iri, modelIri));
    expect(folders().map((f) => [f.name, f.holds])).toEqual([
      ['Desk', [clerk]],
      ['Staff', []],
    ]);
    apply(undo);
    expect(snapshot()).toEqual(before);

    // Into no folder; into the folder it is already in, nothing.
    apply(moveToFolder(store, clerk, undefined, modelIri));
    expect(folders().every((f) => f.holds.length === 0)).toBe(true);
    apply(moveToFolder(store, clerk, desk.iri, modelIri));
    expect(moveToFolder(store, clerk, desk.iri, modelIri)).toEqual({ remove: [], add: [] });
  }, 60_000);

  it("take a concept a converter filed out of its list entry too, and keep a folder out of itself", async () => {
    const { modelIri, store, element, folders, apply } = await model();
    const clerk = element('Clerk');
    // As a converter files it: the member's end and the folder's list entry, a blank node.
    const imported = 'https://example.org/folder/imported';
    const entry = blankNode();
    store.addQuads([
      q(imported, RDF_TYPE, FOLDER),
      quad(namedNode(imported), namedNode(SCHEMA + 'name'), literal('Imported')) as unknown as Quad,
      q(imported, IS_PART_OF, modelIri),
      q(clerk, IS_PART_OF, imported),
      quad(namedNode(imported), namedNode(SCHEMA + 'itemListElement'), entry) as unknown as Quad,
      quad(entry, namedNode(RDF_TYPE), namedNode(SCHEMA + 'ListItem')) as unknown as Quad,
      quad(entry, namedNode(SCHEMA + 'position'), literal('1')) as unknown as Quad,
      quad(entry, namedNode(SCHEMA + 'item'), namedNode(clerk)) as unknown as Quad,
    ]);
    const mine = newFolder(store, modelIri, 'Mine');
    apply(mine.change);
    apply(moveToFolder(store, clerk, mine.iri, modelIri));
    expect(folders().map((f) => [f.name, f.holds])).toEqual([
      ['Imported', []],
      ['Mine', [clerk]],
    ]);
    // The entry is gone, all of it.
    expect(store.getQuads(namedNode(imported) as NamedNode, namedNode(SCHEMA + 'itemListElement') as NamedNode, null)).toEqual([]);
    expect(store.getQuads(null, namedNode(SCHEMA + 'item') as NamedNode, namedNode(clerk) as NamedNode)).toEqual([]);

    // A folder goes into another, not into itself or one inside it.
    apply(moveToFolder(store, imported, mine.iri, modelIri));
    expect(folders().find((f) => f.name === 'Imported')?.in).toBe('Mine');
    expect(() => moveToFolder(store, mine.iri, imported, modelIri)).toThrow(/inside itself/);
    expect(() => moveToFolder(store, mine.iri, mine.iri, modelIri)).toThrow(/inside itself/);
    // Back to the top: part of the model again.
    apply(moveToFolder(store, imported, undefined, modelIri));
    expect(folders().find((f) => f.name === 'Imported')?.in).toBeUndefined();
    expect(store.getQuads(namedNode(imported) as NamedNode, namedNode(IS_PART_OF) as NamedNode, null).map((x) => x.object.value)).toEqual([modelIri]);
  }, 60_000);

  it('are deleted with what they hold kept: in the folder around, or at the top and in no folder', async () => {
    const { modelIri, store, element, folders, apply, snapshot } = await model();
    const clerk = element('Clerk');
    const teller = element('Teller');
    const business = newFolder(store, modelIri, 'Business');
    apply(business.change);
    const actors = newFolder(store, modelIri, 'Actors', business.iri);
    apply(actors.change);
    const roles = newFolder(store, modelIri, 'Roles', actors.iri);
    apply(roles.change);
    apply(moveToFolder(store, clerk, actors.iri, modelIri));
    apply(moveToFolder(store, teller, roles.iri, modelIri));

    const before = snapshot();
    const undo = apply(deleteFolder(store, actors.iri, modelIri));
    expect(folders()).toEqual([
      { name: 'Business', in: undefined, holds: [clerk] },
      { name: 'Roles', in: 'Business', holds: [teller] },
    ]);
    apply(undo);
    expect(snapshot()).toEqual(before);

    apply(deleteFolder(store, business.iri, modelIri));
    expect(folders()).toEqual([
      { name: 'Actors', in: undefined, holds: [clerk] },
      { name: 'Roles', in: 'Actors', holds: [teller] },
    ]);
    apply(deleteFolder(store, actors.iri, modelIri));
    expect(folders()).toEqual([{ name: 'Roles', in: undefined, holds: [teller] }]);
    // The clerk is in no folder, and nothing is left of the folders deleted.
    expect(store.getQuads(namedNode(clerk) as NamedNode, namedNode(IS_PART_OF) as NamedNode, null)).toEqual([]);
    expect(store.getQuads(namedNode(actors.iri) as NamedNode, null, null)).toEqual([]);
    expect(store.getQuads(null, null, namedNode(business.iri) as NamedNode)).toEqual([]);
  }, 60_000);
});
