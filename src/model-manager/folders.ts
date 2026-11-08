/**
 * The model's folders: how they are laid out under the tree's three groups —
 * Views, Elements, Relationships (Req 10.10) — and changed (Req 10.13–10.15): a
 * folder made, renamed or deleted, concepts or a folder moved into another.
 *
 * **Layout.** Each kind has its own folders, as the converters keep them. A
 * top folder named as a group — *Elements*, *Relationships*, *Views*:
 * what la-gram writes, and the converters inside their folder for the model —
 * stands for that group; what it holds directly is in no folder of the group.
 * Any other folder is shown under the groups of what it holds, at any depth —
 * an Archi model's layer folders under Elements, its relations folder under
 * Relationships — and an empty one under its parent's, or under Elements at the
 * top. Nothing depends on a tool's own folder names.
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
import { SCHEMA_ITEM, SCHEMA_ITEM_LIST_ELEMENT, SCHEMA_NAME, readFolders, type FolderSummary, type ModelContents } from './model-queries.js';
import { T, dedupe, langLiteral, localName, nn, triple } from './vocabulary.js';

const MODEL_GRAPH = DataFactory.defaultGraph() as unknown as NamedNode;

/** What a folder holds: one of the tree's three groups. */
export type FolderKind = 'view' | 'element' | 'relationship';

/** The groups, in the tree's order. */
export const FOLDER_KINDS: readonly FolderKind[] = ['view', 'element', 'relationship'];

/** The name of the top folder that stands for each group — la-gram's and the converters'. */
export const KIND_FOLDER_NAMES: Readonly<Record<FolderKind, string>> = {
  view: 'Views',
  element: 'Elements',
  relationship: 'Relationships',
};

/** The model's folders as the tree lays them out under its groups. */
export interface FolderLayout {
  /** A converter's folder for the model itself, shown as the model ({@link modelFolderOf}). */
  modelFolder?: FolderSummary;
  /** The top folder standing for each group, where there is one. */
  roots: Partial<Record<FolderKind, FolderSummary>>;
  /** The groups each folder is shown under; a folder in none — a group's own, or one in a cycle — is not shown. */
  kinds: Map<string, ReadonlySet<FolderKind>>;
  /** The folders at the top of each group. */
  top: Record<FolderKind, FolderSummary[]>;
  /** The folders inside each folder. */
  inside: Map<string, FolderSummary[]>;
  /** Each concept's group: an unclassified concept is filed as an element. */
  kindOf: Map<string, FolderKind>;
  byIri: Map<string, FolderSummary>;
}

/**
 * A converter's folder for the model itself: the one folder at the top, named
 * as the model is — its name, or its IRI's last segment, the model id the
 * converters name it by — holding folders and none of the model's concepts.
 * The tree shows its folders in its place. A folder of the user's own holding
 * only folders is not one: it is not named after the model.
 */
export function modelFolderOf(contents: ModelContents | undefined): FolderSummary | undefined {
  const folders = contents?.folders ?? [];
  const known = new Set(folders.map((f) => f.iri));
  const top = folders.filter((f) => !f.parentIri || !known.has(f.parentIri));
  if (!contents || top.length !== 1) return undefined;
  const [folder] = top;
  const names = [contents.model?.label, contents.model ? localName(contents.model.iri) : undefined]
    .filter((n): n is string => Boolean(n))
    .map((n) => n.toLowerCase());
  if (!names.includes(folder.label.toLowerCase())) return undefined;
  if (!folders.some((f) => f.parentIri === folder.iri)) return undefined;
  const listed = new Set(
    [...contents.views, ...contents.elements, ...contents.relationships, ...contents.unclassified].map((c) => c.iri),
  );
  return folder.members.some((m) => listed.has(m)) ? undefined : folder;
}

/** Lay the model's folders out under the tree's groups (see the module's comment). */
export function folderLayout(contents: ModelContents): FolderLayout {
  const folders = contents.folders ?? [];
  const byIri = new Map(folders.map((f) => [f.iri, f]));
  const inside = new Map<string, FolderSummary[]>();
  const topLevel: FolderSummary[] = [];
  for (const f of folders) {
    if (f.parentIri && byIri.has(f.parentIri)) {
      const list = inside.get(f.parentIri);
      if (list) list.push(f);
      else inside.set(f.parentIri, [f]);
    } else topLevel.push(f);
  }
  const kindOf = new Map<string, FolderKind>();
  for (const v of contents.views) kindOf.set(v.iri, 'view');
  for (const e of contents.elements) kindOf.set(e.iri, 'element');
  for (const u of contents.unclassified) kindOf.set(u.iri, 'element');
  for (const r of contents.relationships) if (!r.derivation) kindOf.set(r.iri, 'relationship');

  const modelFolder = modelFolderOf(contents);
  const level = (modelFolder ? (inside.get(modelFolder.iri) ?? []) : topLevel).slice().sort((a, b) => a.iri.localeCompare(b.iri));
  const roots: Partial<Record<FolderKind, FolderSummary>> = {};
  for (const kind of FOLDER_KINDS) {
    const root = level.find((f) => f.label.trim().toLowerCase() === KIND_FOLDER_NAMES[kind].toLowerCase());
    if (root) roots[kind] = root;
  }
  const rootIris = new Set(Object.values(roots).map((f) => f.iri));

  /** The groups of what a folder holds, at any depth. */
  const held = new Map<string, Set<FolderKind>>();
  const holds = (f: FolderSummary, trail: Set<string>): Set<FolderKind> => {
    const known = held.get(f.iri);
    if (known) return known;
    const out = new Set<FolderKind>();
    for (const m of f.members) {
      const kind = kindOf.get(m);
      if (kind) out.add(kind);
    }
    trail.add(f.iri);
    for (const s of inside.get(f.iri) ?? []) if (!trail.has(s.iri)) for (const kind of holds(s, trail)) out.add(kind);
    held.set(f.iri, out);
    return out;
  };
  const kinds = new Map<string, ReadonlySet<FolderKind>>();
  const place = (f: FolderSummary, around: ReadonlySet<FolderKind>, fixed: boolean): void => {
    if (kinds.has(f.iri) || rootIris.has(f.iri)) return;
    const own = holds(f, new Set());
    const shown = fixed || own.size === 0 ? around : own;
    kinds.set(f.iri, shown);
    for (const s of inside.get(f.iri) ?? []) place(s, shown, fixed);
  };
  for (const kind of FOLDER_KINDS) {
    const root = roots[kind];
    if (root) for (const s of inside.get(root.iri) ?? []) place(s, new Set([kind]), true);
  }
  for (const f of level) place(f, new Set<FolderKind>(['element']), false);

  const top = {} as Record<FolderKind, FolderSummary[]>;
  for (const kind of FOLDER_KINDS) {
    const root = roots[kind];
    top[kind] = [...(root ? (inside.get(root.iri) ?? []) : []), ...level.filter((f) => !rootIris.has(f.iri))].filter((f) =>
      kinds.get(f.iri)?.has(kind),
    );
  }
  return { ...(modelFolder ? { modelFolder } : {}), roots, kinds, top, inside, kindOf, byIri };
}

/** The folders a folder is in, outermost first, up to its group — the names, for a path. */
export function folderPath(layout: FolderLayout, folderIri: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const stop = new Set([...Object.values(layout.roots).map((f) => f.iri), ...(layout.modelFolder ? [layout.modelFolder.iri] : [])]);
  for (let at = layout.byIri.get(folderIri)?.parentIri; at && layout.byIri.has(at) && !stop.has(at) && !seen.has(at); at = layout.byIri.get(at)!.parentIri) {
    seen.add(at);
    names.unshift(layout.byIri.get(at)!.label);
  }
  return names;
}

/** Whether a folder is `iri` or inside it, by the layout's folders. */
export function folderWithin(layout: FolderLayout, folderIri: string, iri: string): boolean {
  const seen = new Set<string>();
  for (let at: string | undefined = folderIri; at && !seen.has(at); at = layout.byIri.get(at)?.parentIri) {
    if (at === iri) return true;
    seen.add(at);
  }
  return false;
}

/**
 * The top folder standing for a group, made when the model has none — at the
 * top of the model, or in a converter's folder for the model.
 */
export function groupFolder(
  store: RdfStore,
  modelIri: string,
  layout: FolderLayout,
  kind: FolderKind,
): { iri: string; change: FolderChange } {
  const root = layout.roots[kind];
  if (root) return { iri: root.iri, change: { remove: [], add: [] } };
  return newFolder(store, modelIri, KIND_FOLDER_NAMES[kind], layout.modelFolder?.iri);
}

/** Several changes as one. */
export function combine(...changes: FolderChange[]): FolderChange {
  return net({ remove: changes.flatMap((c) => c.remove), add: changes.flatMap((c) => c.add) });
}

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
