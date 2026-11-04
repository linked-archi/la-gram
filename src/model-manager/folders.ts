/**
 * The model's folders, changed (Req 10.13–10.15): a folder made, renamed or
 * deleted, a concept or a folder moved into another.
 *
 * Each operation works out a {@link FolderChange} — the quads to remove and to
 * add — from the store, and {@link applyFolderChange} makes it, so the host runs
 * it as one recorded step: undo replays the diff.
 *
 * A folder made here is `arch:Folder` with a `schema:name` and the
 * `dcterms:isPartOf` of the folder it is in, or of the model at the top — as
 * the converters write one. A membership is stated from the member's end only,
 * its `dcterms:isPartOf`: the folders are read from either end, and the other
 * one, the folder's `schema:itemListElement`, takes a list entry — a blank node,
 * which la-gram does not write into a model — and a position, which the tree
 * does not use (design, key decision 13). Moving or deleting takes both ends
 * away, so a concept a converter filed leaves its folder entirely.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { mintIri } from '../rdf-engine/iri.js';
import { modelNamespace } from './model-namespace.js';
import { SCHEMA_ITEM, SCHEMA_ITEM_LIST_ELEMENT, SCHEMA_NAME, readFolders } from './model-queries.js';
import { T, dedupe, langLiteral, nn, triple } from './vocabulary.js';

const MODEL_GRAPH = DataFactory.defaultGraph() as unknown as NamedNode;

/** What a folder operation removes and adds. */
export interface FolderChange {
  remove: Quad[];
  add: Quad[];
}

/** Make a folder change in the store. */
export function applyFolderChange(store: RdfStore, change: FolderChange): void {
  if (change.remove.length > 0) store.removeQuads(change.remove);
  if (change.add.length > 0) store.addQuads(change.add);
}

/** Whether a resource is an `arch:Folder` of the model. */
export function isFolder(store: RdfStore, iri: string): boolean {
  return store.getQuads(nn(iri), T.rdfType, T.Folder, MODEL_GRAPH).length > 0;
}

/** A new folder named `name`, in the folder `parentIri` or, without one, at the top of the model. */
export function newFolder(store: RdfStore, modelIri: string, name: string, parentIri?: string): { iri: string; change: FolderChange } {
  const iri = mintIri(modelNamespace(store, modelIri), 'folder');
  const folder = nn(iri);
  return {
    iri,
    change: {
      remove: [],
      add: [
        triple(folder, T.rdfType, T.Folder),
        triple(folder, SCHEMA_NAME[0], langLiteral(name)),
        triple(folder, T.dctermsIsPartOf, nn(parentIri ?? modelIri)),
      ],
    },
  };
}

/** A folder's name, `schema:name`, replaced. */
export function renameFolder(store: RdfStore, folderIri: string, name: string): FolderChange {
  const folder = nn(folderIri);
  return net({
    remove: SCHEMA_NAME.flatMap((p) => store.getQuads(folder, p, null, MODEL_GRAPH)),
    add: [triple(folder, SCHEMA_NAME[0], langLiteral(name))],
  });
}

/**
 * What puts `memberIri` in a folder: its `dcterms:isPartOf` a folder — a
 * folder's, of the model too, which puts it at the top — and the folders' list
 * entries that name it, with everything they say.
 */
export function membershipQuads(store: RdfStore, memberIri: string, modelIri: string): Quad[] {
  const member = nn(memberIri);
  const memberIsFolder = isFolder(store, memberIri);
  const quads = store
    .getQuads(member, T.dctermsIsPartOf, null, MODEL_GRAPH)
    .filter((q) => q.object.termType === 'NamedNode' && (isFolder(store, q.object.value) || (memberIsFolder && q.object.value === modelIri)));
  for (const named of SCHEMA_ITEM.flatMap((p) => store.getQuads(null, p, member, MODEL_GRAPH))) {
    // The list entry is a blank node, which the store takes as a term like any other.
    const entry = named.subject as NamedNode;
    const listing = SCHEMA_ITEM_LIST_ELEMENT.flatMap((p) => store.getQuads(null, p, entry, MODEL_GRAPH)).filter((q) =>
      isFolder(store, q.subject.value),
    );
    if (listing.length === 0) continue;
    quads.push(...listing, ...store.getQuads(entry, null, null, MODEL_GRAPH));
  }
  return dedupe(quads);
}

/** Whether `iri` is the folder `folderIri` or inside it, at any depth. */
export function isWithin(store: RdfStore, iri: string, folderIri: string): boolean {
  const parents = new Map(readFolders(store).map((f) => [f.iri, f.parentIri]));
  const seen = new Set<string>();
  for (let at: string | undefined = iri; at && !seen.has(at); at = parents.get(at)) {
    if (at === folderIri) return true;
    seen.add(at);
  }
  return false;
}

/**
 * Move a concept or a folder into the folder `targetIri` — out of every folder
 * it was in. Without a target, a concept is in no folder and a folder is at the
 * top of the model, or in `topIri` when the model's top is a folder (a
 * converter's folder for the model itself, which the tree shows as the model).
 *
 * @throws when a folder would go inside itself.
 */
export function moveToFolder(
  store: RdfStore,
  memberIri: string,
  targetIri: string | undefined,
  modelIri: string,
  topIri?: string,
): FolderChange {
  if (targetIri && isWithin(store, targetIri, memberIri)) throw new Error('A folder cannot go inside itself.');
  const into = targetIri ?? (isFolder(store, memberIri) ? (topIri ?? modelIri) : undefined);
  return net({
    remove: membershipQuads(store, memberIri, modelIri),
    add: into ? [triple(nn(memberIri), T.dctermsIsPartOf, nn(into))] : [],
  });
}

/**
 * Delete a folder and keep what it holds: its concepts and folders go to the
 * folder it was in — at the top, its folders to the top of the model (or
 * `topIri`) and its concepts in no folder.
 */
export function deleteFolder(store: RdfStore, folderIri: string, modelIri: string, topIri?: string): FolderChange {
  const folder = nn(folderIri);
  const parentIri = readFolders(store).find((f) => f.iri === folderIri)?.parentIri;
  const entries = SCHEMA_ITEM_LIST_ELEMENT.flatMap((p) => store.getQuads(folder, p, null, MODEL_GRAPH)).map((q) => q.object as NamedNode);
  const held = new Set<string>();
  for (const q of store.getQuads(null, T.dctermsIsPartOf, folder, MODEL_GRAPH)) if (q.subject.termType === 'NamedNode') held.add(q.subject.value);
  for (const entry of entries) {
    const item = SCHEMA_ITEM.flatMap((p) => store.getQuads(entry, p, null, MODEL_GRAPH))[0]?.object;
    if (item?.termType === 'NamedNode') held.add(item.value);
  }
  held.delete(folderIri);

  const remove: Quad[] = [
    ...store.getQuads(folder, null, null, MODEL_GRAPH),
    ...entries.flatMap((entry) => store.getQuads(entry, null, null, MODEL_GRAPH)),
    ...membershipQuads(store, folderIri, modelIri),
  ];
  const add: Quad[] = [];
  for (const iri of held) {
    remove.push(...store.getQuads(nn(iri), T.dctermsIsPartOf, folder, MODEL_GRAPH));
    const into = parentIri ?? (isFolder(store, iri) ? (topIri ?? modelIri) : undefined);
    if (into) add.push(triple(nn(iri), T.dctermsIsPartOf, nn(into)));
  }
  return net({ remove, add });
}

/** A change without duplicates, and without what it would remove only to add back. */
function net(change: FolderChange): FolderChange {
  const key = (q: Quad) => `${q.subject.termType}:${q.subject.value} ${q.predicate.value} ${q.object.termType}:${q.object.value}@${(q.object as { language?: string }).language ?? ''}`;
  const remove = dedupe(change.remove);
  const add = dedupe(change.add);
  const removed = new Set(remove.map(key));
  const added = new Set(add.map(key));
  return { remove: remove.filter((q) => !added.has(key(q))), add: add.filter((q) => !removed.has(key(q))) };
}
