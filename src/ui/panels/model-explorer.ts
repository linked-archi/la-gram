/**
 * Model Explorer — the model tree.
 *
 * Shows the model the way the store holds it, independent of what the open
 * view draws:
 *
 * ```
 * ▾ Order Platform                      (the arch:Model)
 *   ▾ Views                             every arch:View, the open one bold
 *   ▾ Elements                          grouped by type, labelled by the metamodel
 *     ▾ Application Component (3)
 *         Order Service        ●        ● = placed in the open view
 *   ▾ Relationships                     grouped by type: "Source → Target"
 *   ▸ Derived relationships             what derivation rules concluded and the model
 *     ▸ Valid                           does not state, by certainty, then type
 *     ▸ Potential                       (a potential one confirmed is a relationship)
 *   ▸ Unclassified                      types no loaded metamodel defines
 * ```
 *
 * A model with folders of its own (`arch:Folder` — made here, or the
 * organisation a converter brings over from Archi and the like) has them in
 * those groups, each kind its own, each folder starting folded:
 *
 * ```
 * ▾ ArchiSurance
 *   ▾ Views
 *     ▸ Phase A                         a group's folders first, then its
 *       Main                            concepts in none of them, as above
 *   ▾ Elements
 *     ▸ Business                        a folder is under the groups of what it
 *     ▸ Strategy                        holds; an empty one with its parent's
 *     ▸ Application Component (3)
 *   ▸ Relationships
 *   ▸ Derived relationships
 * ```
 *
 * The header's Folders | Types switch picks either, remembered per browser; on
 * a model without folders, Folders is greyed out and the tree is by type.
 * Folders are made from the right-click menu — a group's *New folder…*, a
 * folder's *New folder…*, *Rename…*, *Move to folder…* and *Delete folder* —
 * and concepts filed by their *Move to folder…*, or dragged onto a folder of
 * their group (onto the group: out of their folders). How the folders fall into
 * the groups, and the changes, are `model-manager/folders.ts`'s.

 * ## Interactions
 *
 * - click selects (`explorer-select`); Ctrl/Cmd-click adds or takes a concept,
 *   Shift-click the rows shown from the last one clicked; double-click opens a
 *   view or reveals an element on the canvas (`explorer-activate`);
 * - right-click opens a context menu whose picks are `explorer-action` events —
 *   the component does no model work itself, `mount-ui` does; on one of several
 *   selected, the menu moves those of its group to a folder;
 * - pressing on a row and dragging past a small threshold drags it — with those
 *   selected of its group — onto a folder of the group (`explorer-move`); a
 *   folder rested on unfolds. An element dragged also starts placing it on the
 *   canvas, and a view making a reference to it there (`explorer-drag-start`,
 *   carrying the row's kind and the pointer event for diagram-js's `create`
 *   gesture), which takes it if let go there. The threshold is what keeps a
 *   click a click.
 *
 * The tree is rebuilt from a {@link ModelContents} snapshot the host supplies
 * (`contentsProvider`), once after the events that can change it; another
 * active view rebuilds it from the snapshot it has.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ModelContents, ConceptSummary, FolderSummary, RelationshipSummary } from '../../model-manager/model-queries.js';
import { FOLDER_KINDS, folderLayout, folderWithin, type FolderKind } from '../../model-manager/folders.js';
import type { ViewInfo } from '../../model-manager/interfaces.js';
import type { EventBus, ModelEventHandler, ModelEventType } from '../event-bus.js';

/** Kinds of row in the tree. */
export type TreeNodeKind = 'model' | 'folder' | 'view' | 'element' | 'relationship' | 'unclassified';

/** One row of the tree. */
export interface TreeNode {
  /** Unique key: the IRI for concepts, a synthetic id for folders. */
  id: string;
  /** IRI of the concept, absent for folders. */
  iri?: string;
  /** The model's own folder (`arch:Folder`) a folder row shows. */
  folderIri?: string;
  /** The group a group row is, or a folder row is shown in: what goes in it. */
  folderKind?: FolderKind;
  kind: TreeNodeKind;
  label: string;
  /** Secondary text: a type, a count, a view kind. */
  detail?: string;
  typeIri?: string;
  /** Element or relationship drawn in the open view. */
  placed?: boolean;
  /** The view on the canvas. */
  active?: boolean;
  /** A derivation the model does not state, by its certainty. */
  derivation?: 'valid' | 'potential';
  /** Starts folded — until unfolded, or a filter is typed. */
  folded?: boolean;
  children: TreeNode[];
}

/** How the tree groups the model: in its own folders, or by kind and type. */
export type TreeGrouping = 'folders' | 'types';

/** Whether the model has folders of its own to show. */
export function hasFolders(contents: ModelContents | undefined): boolean {
  return (contents?.folders?.length ?? 0) > 0;
}

/** localStorage key of the grouping. */
const GROUPING_KEY = 'la-gram:explorer-grouping';

/** The grouping last picked in this browser; by folder when nothing is remembered. */
export function storedGrouping(): TreeGrouping {
  try {
    return globalThis.localStorage?.getItem(GROUPING_KEY) === 'types' ? 'types' : 'folders';
  } catch {
    return 'folders';
  }
}

function rememberGrouping(grouping: TreeGrouping): void {
  try {
    globalThis.localStorage?.setItem(GROUPING_KEY, grouping);
  } catch {
    /* not remembered: fine */
  }
}

/** Detail of `explorer-select`. */
export interface ExplorerSelectDetail {
  iri: string;
  kind?: TreeNodeKind;
}

/** Detail of `explorer-activate` (double-click). */
export type ExplorerActivateDetail = ExplorerSelectDetail;

/** Context-menu actions, by row kind. */
export type ExplorerAction =
  | 'rename-model'
  | 'model-settings'
  | 'new-diagram'
  | 'new-catalog'
  | 'new-matrix'
  | 'new-element'
  | 'open-view'
  | 'reference-in-view'
  | 'rename-view'
  | 'duplicate-view'
  | 'delete-view'
  | 'set-viewpoint'
  | 'add-to-view'
  | 'reveal'
  | 'rename'
  | 'delete-from-model'
  | 'show-source'
  | 'show-target'
  | 'confirm-derivation'
  | 'new-folder'
  | 'rename-folder'
  | 'move-to-folder'
  | 'delete-folder'
  | 'copy';

/**
 * Detail of `explorer-action`: the row's concept — for a folder row, the
 * model's folder it shows; for the model, the model; for a group (*New
 * folder…*), none.
 */
export interface ExplorerActionDetail {
  action: ExplorerAction;
  iri: string;
  kind: TreeNodeKind;
  /** The group the row's concept or folder goes in, for the folder actions. */
  folderKind?: FolderKind;
  /** *Move to folder…* and *Copy* on several selected: all of them of the row's group, the row's first. */
  iris?: string[];
  /** *New ‹type›…* on a type's row: the element type to make one of. */
  typeIri?: string;
}

/**
 * Detail of `explorer-move`: rows dropped on a folder — or on their group, out
 * of their folders (a folder: to the top of its group).
 */
export interface ExplorerMoveDetail {
  iris: string[];
  kind: FolderKind;
  /** The folder dropped on; none for the group. */
  folderIri?: string;
}

/** The group a row's concept is filed in: an unclassified concept with the elements. */
export function folderKindOf(node: TreeNode): FolderKind | undefined {
  if (node.kind === 'folder') return node.folderIri ? node.folderKind : undefined;
  if (node.kind === 'view') return 'view';
  if (node.kind === 'element' || node.kind === 'unclassified') return 'element';
  if (node.kind === 'relationship' && !node.derivation) return 'relationship';
  return undefined;
}

/** What a group's concepts are called, one or several. */
const KIND_WORDS: Record<FolderKind, [string, string]> = {
  view: ['view', 'views'],
  element: ['element', 'elements'],
  relationship: ['relationship', 'relationships'],
};

/** Detail of `explorer-drag-start`. */
export interface ExplorerDragDetail {
  iri: string;
  /** The row's kind: an element's places it; a view's makes a reference to that view (Req 3.23). */
  kind: TreeNodeKind;
  /** The pointer event to hand to diagram-js's `create.start`. */
  sourceEvent: MouseEvent;
}

/** Pixels the pointer must travel with the button down before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

/** How long a drag rests on a folded folder before it unfolds. */
const HOVER_UNFOLD_MS = 600;

/** The actions that take the folder's group along. */
const FOLDER_ACTIONS: ReadonlySet<ExplorerAction> = new Set(['new-folder', 'rename-folder', 'move-to-folder', 'delete-folder']);

/** What a folder of a group, or the group itself, offers to make in it (Req 10.16): views in Views, elements in Elements. */
const NEW_IN_GROUP: Partial<Record<FolderKind, Array<{ action: ExplorerAction; label: string }>>> = {
  view: [
    { action: 'new-diagram', label: 'New diagram view' },
    { action: 'new-catalog', label: 'New catalog view' },
    { action: 'new-matrix', label: 'New matrix view' },
  ],
  element: [{ action: 'new-element', label: 'New element…' }],
};

/** Actions that make something in a folder or a group: allowed on a row with no concept of its own. */
const NEW_ACTIONS: ReadonlySet<ExplorerAction> = new Set(['new-diagram', 'new-catalog', 'new-matrix', 'new-element']);

/** Local name of an IRI, for fallbacks. */
export function iriFragment(iri: string): string {
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx !== -1) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx !== -1) return iri.slice(slashIdx + 1);
  return iri;
}

/** Group concepts by type label into folder nodes. */
function groupByType(
  items: ReadonlyArray<ConceptSummary & Pick<RelationshipSummary, 'derivation'>>,
  kind: 'element' | 'relationship' | 'unclassified',
  idPrefix: string,
  placed: ReadonlySet<string>,
): TreeNode[] {
  const groups = new Map<string, TreeNode>();
  for (const item of items) {
    let group = groups.get(item.typeIri);
    if (!group) {
      group = { id: `${idPrefix}:${item.typeIri}`, kind: 'folder', label: item.typeLabel, typeIri: item.typeIri, children: [] };
      groups.set(item.typeIri, group);
    }
    group.children.push({
      id: item.iri,
      iri: item.iri,
      kind,
      label: item.label,
      typeIri: item.typeIri,
      placed: placed.has(item.iri),
      ...(item.derivation ? { derivation: item.derivation.certainty, ...(item.derivation.rule ? { detail: item.derivation.rule } : {}) } : {}),
      children: [],
    });
  }
  const list = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const g of list) g.detail = String(g.children.length);
  return list;
}

/** A short marker for a view's kind. */
function viewKindDetail(view: ViewInfo): string {
  return view.type === 'Diagram' ? 'diagram' : view.type === 'Catalog' ? 'catalog' : 'matrix';
}

/** A view's row — marked placed while the open diagram holds a reference to it, its placement there (VC-1). */
function viewNode(v: ModelContents['views'][number], activeViewIri: string | undefined, placed: ReadonlySet<string>): TreeNode {
  return {
    id: v.iri,
    iri: v.iri,
    kind: 'view',
    label: v.label || iriFragment(v.iri),
    detail: viewKindDetail(v),
    active: v.iri === activeViewIri,
    ...(placed.has(v.iri) ? { placed: true } : {}),
    children: [],
  };
}

/** What the by-type groups are made of: the views, and the concepts the model states. */
interface Stated {
  views: ModelContents['views'];
  elements: ConceptSummary[];
  relationships: RelationshipSummary[];
  unclassified: ConceptSummary[];
}

/**
 * Views, Elements, Relationships — by type — and Unclassified, when there is
 * any. `folders` puts each group's folders first ({@link folderGroups}), and
 * its count is then of everything in it.
 */
function typeGroups(
  stated: Stated,
  activeViewIri: string | undefined,
  placed: ReadonlySet<string>,
  folders?: { nodes: Record<FolderKind, TreeNode[]>; counts: Record<FolderKind, number> },
): TreeNode[] {
  const group = (folderKind: FolderKind, label: string, own: TreeNode[], count: number): TreeNode => ({
    id: `folder:${folderKind === 'view' ? 'views' : folderKind === 'element' ? 'elements' : 'relationships'}`,
    kind: 'folder',
    folderKind,
    label,
    detail: String(count + (folders?.counts[folderKind] ?? 0)),
    children: [...(folders?.nodes[folderKind] ?? []), ...own],
  });
  const groups: TreeNode[] = [
    group('view', 'Views', stated.views.map((v) => viewNode(v, activeViewIri, placed)), stated.views.length),
    group('element', 'Elements', groupByType(stated.elements, 'element', 'elements', placed), stated.elements.length),
    group('relationship', 'Relationships', groupByType(stated.relationships, 'relationship', 'relationships', placed), stated.relationships.length),
  ];
  if (stated.unclassified.length > 0) {
    groups.push({
      id: 'folder:unclassified',
      kind: 'folder',
      label: 'Unclassified',
      detail: String(stated.unclassified.length),
      children: groupByType(stated.unclassified, 'unclassified', 'unclassified', placed),
    });
  }
  return groups;
}

/** What derivation rules concluded and the model does not state, by certainty — when there is any. */
function derivedGroup(contents: ModelContents, placed: ReadonlySet<string>): TreeNode[] {
  const derived = (certainty: 'valid' | 'potential', label: string): TreeNode[] => {
    const list = contents.relationships.filter((r) => r.derivation?.certainty === certainty);
    if (list.length === 0) return [];
    const id = `derived-${certainty}`;
    return [{ id: `folder:${id}`, kind: 'folder', label, detail: String(list.length), children: groupByType(list, 'relationship', id, placed) }];
  };
  const byCertainty = [...derived('valid', 'Valid'), ...derived('potential', 'Potential')];
  if (byCertainty.length === 0) return [];
  const count = contents.relationships.filter((r) => r.derivation).length;
  return [{ id: 'folder:derived', kind: 'folder', label: 'Derived relationships', detail: String(count), children: byCertainty }];
}

/** The model's stated contents: what derivation rules concluded left out. */
function statedOf(contents: ModelContents): Stated {
  return {
    views: contents.views,
    elements: contents.elements,
    relationships: contents.relationships.filter((r) => !r.derivation),
    unclassified: contents.unclassified,
  };
}

/** Order within a folder: by name; by `key` between namesakes. */
function byName<T extends { label: string }>(key: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => a.label.localeCompare(b.label) || key(a).localeCompare(key(b));
}

/**
 * The groups with the model's own folders in them ({@link folderLayout}): in
 * each, its folders first — each starting folded, its folders then its concepts
 * of the group's kind, by name — then what none of them holds, by type.
 */
function folderGroups(contents: ModelContents, activeViewIri: string | undefined, placed: ReadonlySet<string>): TreeNode[] {
  const stated = statedOf(contents);
  const layout = folderLayout(contents);
  // A concept's row, made afresh where it is listed: a concept may be in two folders.
  const rows = new Map<string, () => TreeNode>();
  for (const v of stated.views) rows.set(v.iri, () => viewNode(v, activeViewIri, placed));
  const concept = (kind: 'element' | 'relationship' | 'unclassified') => (item: ConceptSummary) =>
    rows.set(item.iri, () => ({ id: item.iri, iri: item.iri, kind, label: item.label, typeIri: item.typeIri, placed: placed.has(item.iri), children: [] }));
  stated.elements.forEach(concept('element'));
  stated.relationships.forEach(concept('relationship'));
  stated.unclassified.forEach(concept('unclassified'));

  const filed = new Set<string>();
  /** A folder's row in a group and how many of the group's concepts it holds, in it and below. */
  const build = (f: FolderSummary, kind: FolderKind, trail: ReadonlySet<string>): { node: TreeNode; count: number } => {
    const within = new Set([...trail, f.iri]);
    const subfolders = (layout.inside.get(f.iri) ?? [])
      .filter((s) => layout.kinds.get(s.iri)?.has(kind) && !within.has(s.iri))
      .sort(byName((s) => s.iri))
      .map((s) => build(s, kind, within));
    const members = f.members
      .filter((iri) => layout.kindOf.get(iri) === kind && rows.has(iri))
      .map((iri) => {
        filed.add(iri);
        return rows.get(iri)!();
      })
      .sort(byName((n) => n.id));
    const count = members.length + subfolders.reduce((n, b) => n + b.count, 0);
    return {
      node: {
        id: `folder-iri:${kind}:${f.iri}`,
        folderIri: f.iri,
        folderKind: kind,
        kind: 'folder',
        label: f.label,
        detail: String(count),
        folded: true,
        children: [...subfolders.map((b) => b.node), ...members],
      },
      count,
    };
  };
  const nodes = {} as Record<FolderKind, TreeNode[]>;
  const counts = {} as Record<FolderKind, number>;
  for (const kind of FOLDER_KINDS) {
    const built = layout.top[kind].slice().sort(byName((f) => f.iri)).map((f) => build(f, kind, new Set()));
    nodes[kind] = built.map((b) => b.node);
    counts[kind] = built.reduce((n, b) => n + b.count, 0);
  }
  const unfiled: Stated = {
    views: stated.views.filter((v) => !filed.has(v.iri)),
    elements: stated.elements.filter((e) => !filed.has(e.iri)),
    relationships: stated.relationships.filter((r) => !filed.has(r.iri)),
    unclassified: stated.unclassified.filter((u) => !filed.has(u.iri)),
  };
  return typeGroups(unfiled, activeViewIri, placed, { nodes, counts });
}

/**
 * Build the tree from a model snapshot.
 *
 * @param placed IRIs drawn in the open view: elements, relationships, and the views it holds a reference to.
 * @param grouping `folders` shows the model's own folders when it has any
 *   ({@link hasFolders}); otherwise, and with `types`, concepts are grouped by
 *   kind and type.
 */
export function buildModelTree(
  contents: ModelContents,
  activeViewIri: string | undefined,
  placed: ReadonlySet<string> = new Set(),
  grouping: TreeGrouping = 'types',
): TreeNode[] {
  const groups =
    grouping === 'folders' && hasFolders(contents)
      ? folderGroups(contents, activeViewIri, placed)
      : typeGroups(statedOf(contents), activeViewIri, placed);
  // Derived relationships before Unclassified.
  const unclassified = groups.findIndex((g) => g.id === 'folder:unclassified');
  const derived = derivedGroup(contents, placed);
  if (unclassified >= 0) groups.splice(unclassified, 0, ...derived);
  else groups.push(...derived);
  const root: TreeNode = {
    id: contents.model?.iri ?? 'model',
    ...(contents.model ? { iri: contents.model.iri } : {}),
    kind: 'model',
    label: contents.model?.label ?? 'Model',
    children: groups,
  };
  return [root];
}

/**
 * Keep rows whose label or detail matches the query, with their ancestors.
 * Folders match by label too, keeping their whole subtree.
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const visit = (node: TreeNode): TreeNode | null => {
    const self = node.label.toLowerCase().includes(q) || (node.detail ?? '').toLowerCase().includes(q);
    if (self && node.kind === 'folder') return node;
    const children = node.children.map(visit).filter((c): c is TreeNode => c !== null);
    if (self || children.length > 0) return { ...node, children };
    return null;
  };
  return nodes.map(visit).filter((n): n is TreeNode => n !== null);
}

/**
 * Context menu entries for a row.
 *
 * @param options.folders Whether the model has folders: a concept is offered
 *   *Move to folder…* only then.
 * @param options.many How many rows of the row's group are selected, it among
 *   them: more than one, and moving them is all there is.
 * @param options.openDiagram The diagram open on the canvas, when one is: every
 *   other view's row offers *Reference in the open view* (Req 3.23).
 */
export function actionsFor(
  node: TreeNode,
  options: { folders?: boolean; many?: number; openDiagram?: string } = {},
): Array<{ action: ExplorerAction; label: string; danger?: boolean }> {
  const move = options.folders ? [{ action: 'move-to-folder' as const, label: 'Move to folder…' }] : [];
  const kind = folderKindOf(node);
  // Elements and relationships are copied, to paste into a diagram — not views, nor a derivation the model does not state.
  const copy = (kind === 'element' || kind === 'relationship') && !node.derivation ? [{ action: 'copy' as const, label: 'Copy' }] : [];
  if (options.many && options.many > 1 && kind && (options.folders || copy.length > 0)) {
    return [
      ...(copy.length > 0 ? [{ action: 'copy' as const, label: `Copy ${options.many} ${KIND_WORDS[kind][1]}` }] : []),
      ...(options.folders ? [{ action: 'move-to-folder' as const, label: `Move ${options.many} ${KIND_WORDS[kind][1]} to folder…` }] : []),
    ];
  }
  switch (node.kind) {
    case 'model':
      return [
        { action: 'rename-model', label: 'Rename model…' },
        { action: 'model-settings', label: 'Model settings…' },
        { action: 'new-diagram', label: 'New diagram view' },
        { action: 'new-catalog', label: 'New catalog view' },
        { action: 'new-matrix', label: 'New matrix view' },
      ];
    case 'folder': {
      // The model's own folders, and the groups (Views, Elements, Relationships) folders are made in:
      // first what can be made there (Req 10.16).
      const make = node.folderKind ? (NEW_IN_GROUP[node.folderKind] ?? []) : [];
      if (node.folderIri) {
        return [
          ...make,
          { action: 'new-folder', label: 'New folder…' },
          { action: 'rename-folder', label: 'Rename…' },
          { action: 'move-to-folder', label: 'Move to folder…' },
          { action: 'delete-folder', label: 'Delete folder (keeps its contents)', danger: true },
        ];
      }
      if (node.folderKind) return [...make, { action: 'new-folder', label: 'New folder…' }];
      // An element type's row: one more of it. Other groupings have no menu.
      return node.typeIri && node.children.some((child) => child.kind === 'element')
        ? [{ action: 'new-element', label: `New ${node.label}…` }]
        : [];
    }
    case 'view':
      return [
        { action: 'open-view', label: 'Open' },
        // Referenced in the open diagram: its references selected there, as an element's boxes are.
        ...(node.placed ? [{ action: 'reveal' as const, label: 'Select on canvas' }] : []),
        ...(options.openDiagram && node.iri !== options.openDiagram
          ? [{ action: 'reference-in-view' as const, label: 'Reference in the open view' }]
          : []),
        { action: 'rename-view', label: 'Rename…' },
        { action: 'set-viewpoint', label: 'Set viewpoint…' },
        { action: 'duplicate-view', label: 'Duplicate' },
        ...move,
        { action: 'delete-view', label: 'Delete view (keeps its elements)', danger: true },
      ];
    case 'element':
    case 'unclassified':
      return [
        node.placed
          ? { action: 'reveal', label: 'Select on canvas' }
          : { action: 'add-to-view', label: 'Add to current view' },
        { action: 'rename', label: 'Rename…' },
        ...copy,
        ...move,
        { action: 'delete-from-model', label: 'Delete from model…', danger: true },
      ];
    case 'relationship':
      return [
        node.placed
          ? { action: 'reveal', label: 'Select on canvas' }
          : { action: 'add-to-view', label: 'Add to current view' },
        ...(node.derivation === 'potential'
          ? [{ action: 'confirm-derivation' as const, label: 'Confirm — state it in the model' }]
          : []),
        { action: 'show-source', label: 'Show source' },
        { action: 'show-target', label: 'Show target' },
        ...(node.derivation ? [] : [{ action: 'rename' as const, label: 'Rename…' }, ...copy, ...move]),
        { action: 'delete-from-model', label: 'Delete from model…', danger: true },
      ];
    default:
      return [];
  }
}

/** Events after which the tree is re-read. */
const REFRESH_EVENTS: ModelEventType[] = [
  'element-created',
  'element-deleted',
  'element-updated',
  'relationship-created',
  'relationship-deleted',
  'model-loaded',
  'model-changed',
  'views-changed',
  'view-opened',
  'metamodel-loaded',
];

@customElement('model-explorer')
export class ModelExplorer extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      user-select: none;
      min-height: 0;
    }
    .explorer-header {
      padding: 8px 12px;
      font-weight: 600;
      font-size: 13px;
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .grouping {
      margin-left: auto;
      display: inline-flex;
      border: 1px solid #dadce0;
      border-radius: 4px;
      overflow: hidden;
    }
    .grouping button {
      border: 0;
      background: #fff;
      color: #3c4043;
      font: inherit;
      font-size: 11px;
      font-weight: 400;
      padding: 1px 8px;
      cursor: pointer;
    }
    .grouping button + button {
      border-left: 1px solid #dadce0;
    }
    .grouping button:hover:not(:disabled) {
      background: #f1f3f4;
    }
    .grouping button:disabled {
      color: #9aa0a6;
      cursor: default;
    }
    .grouping button[aria-pressed='true'] {
      background: #e8f0fe;
      color: #1a73e8;
    }
    .filter-input {
      display: block;
      margin: 6px 8px;
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font: inherit;
    }
    .filter-input:focus {
      outline: none;
      border-color: #1a73e8;
      box-shadow: 0 0 0 1px #1a73e8;
    }
    .tree-scroll {
      overflow: auto;
      flex: 1 1 auto;
      min-height: 0;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ul ul {
      padding-left: 14px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      cursor: pointer;
      white-space: nowrap;
    }
    .row:hover {
      background: #eef3fd;
    }
    .row.selected {
      background: #d2e3fc;
    }
    .row.drop-target {
      background: #e8f0fe;
      box-shadow: inset 0 0 0 2px #1a73e8;
    }
    .toggle {
      width: 12px;
      flex: none;
      text-align: center;
      font-size: 9px;
      color: #666;
    }
    .icon {
      width: 14px;
      flex: none;
      text-align: center;
      font-size: 11px;
      color: #5f6368;
    }

    .icon-picture {
      width: 14px;
      height: 14px;
      object-fit: contain;
      vertical-align: middle;
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1 1 auto;
    }
    .row.active .label {
      font-weight: 600;
      color: #1a73e8;
    }
    .row.folder > .label {
      color: #3c4043;
    }
    /* A derivation the model does not state: italic; a potential one, fainter still. */
    .row.derived .label {
      font-style: italic;
      color: #5f6368;
    }
    .row.derived.potential .label,
    .row.derived.potential .icon {
      color: #80868b;
    }
    .detail {
      font-size: 11px;
      color: #80868b;
      flex: none;
    }
    .placed {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #1a73e8;
      flex: none;
    }
    .empty {
      padding: 12px;
      color: #80868b;
      font-style: italic;
    }
    .menu {
      position: fixed;
      z-index: 1000;
      background: #fff;
      border: 1px solid #dadce0;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
      padding: 4px 0;
      min-width: 190px;
    }
    .menu button {
      display: block;
      width: 100%;
      text-align: left;
      border: 0;
      background: none;
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
    }
    .menu button:hover {
      background: #eef3fd;
    }
    .menu button.danger {
      color: #c5221f;
    }
  `;

  /** Supplies the model snapshot; called on every refresh. */
  @property({ attribute: false })
  contentsProvider?: () => ModelContents;

  /** IRIs drawn in the open view, for the placed marker and the menus. */
  @property({ attribute: false })
  placedProvider?: () => ReadonlySet<string>;

  /**
   * An element's own picture for the presentation chosen, else for every one
   * (core 0.5.0: `arch:altVisNotation`, `arch:prefVisNotation`): its row's icon,
   * in place of the type's mark. The host sets it again — or asks for an update
   * — when the presentation changes.
   */
  @property({ attribute: false })
  pictureProvider?: (iri: string) => string | undefined;

  /** The view on the canvas. */
  @property({ attribute: false })
  activeViewIri?: string;

  @property({ attribute: false })
  eventBus?: EventBus;

  @property({ type: String })
  selectedIri = '';

  @state() private _tree: TreeNode[] = [];
  @state() private _filterQuery = '';
  @state() private _collapsed: Set<string> = new Set(['folder:relationships', 'folder:derived']);
  /** Rows that start folded ({@link TreeNode.folded}) and were unfolded. */
  @state() private _expanded: Set<string> = new Set();
  @state() private _grouping: TreeGrouping = storedGrouping();
  @state() private _menu: { x: number; y: number; node: TreeNode; iris?: string[] } | null = null;
  /** Concepts selected together — Ctrl/Cmd-click adds or takes one, Shift-click a range. */
  @state() private _selection: Set<string> = new Set();
  /** Rows being dragged to a folder, of one group; a folder's own IRI when it is one. */
  @state() private _drag: { iris: string[]; kind: FolderKind; folderIri?: string } | null = null;
  /** The row a drag would drop on: a folder of the group, or the group. */
  @state() private _dropTarget: string | null = null;
  /** Where a Shift-click's range starts. */
  private _anchor?: string;
  private _hoverTimer?: ReturnType<typeof setTimeout>;
  /** Rows by id, as last rendered: what the pointer is over in a drag. */
  private _rowNodes = new Map<string, TreeNode>();
  /** The model's folders as last laid out. */
  private _layout?: ReturnType<typeof folderLayout>;

  /**
   * A model event re-reads the model once, at the end of the task that changed
   * it: opening a model fires several, and reading a large one takes a while
   * (Task 22). A {@link refresh} meanwhile makes it unneeded.
   */
  private _refresh: ModelEventHandler = () => {
    if (this._stale) return;
    this._stale = true;
    setTimeout(() => {
      if (this._stale) this.refresh();
    }, 0);
  };
  /** Whether the model changed since it was read. */
  private _stale = false;
  /** The model as last read. */
  private _contents?: ModelContents;
  private _press: { node: TreeNode; x: number; y: number } | null = null;
  private _subscribed?: EventBus;

  override connectedCallback(): void {
    super.connectedCallback();
    this._subscribe();
    this.refresh();
    document.addEventListener('mousemove', this._onDocumentMove);
    document.addEventListener('mouseup', this._onDocumentUp);
    document.addEventListener('mousedown', this._onDocumentDown, true);
    document.addEventListener('keydown', this._onDocumentKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe();
    document.removeEventListener('mousemove', this._onDocumentMove);
    document.removeEventListener('mouseup', this._onDocumentUp);
    document.removeEventListener('mousedown', this._onDocumentDown, true);
    document.removeEventListener('keydown', this._onDocumentKey);
    clearTimeout(this._hoverTimer);
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('eventBus')) {
      this._unsubscribe();
      this._subscribe();
    }
    if (changed.has('contentsProvider') || !this._contents || this._stale) {
      if (changed.has('contentsProvider') || changed.has('activeViewIri') || changed.has('placedProvider')) this.refresh();
    } else if (changed.has('activeViewIri') || changed.has('placedProvider')) {
      // Another view: the same model, marked for it.
      this._build();
    }
    // Selected from outside — the canvas, a reveal: that one alone.
    if (changed.has('selectedIri') && !this._selection.has(this.selectedIri)) {
      this._selection = new Set(this.selectedIri ? [this.selectedIri] : []);
    }
  }

  /** Re-read the model and rebuild the tree. */
  refresh(): void {
    this._stale = false;
    this._contents = this.contentsProvider?.();
    this._build();
  }

  /** Build the tree from the model as last read. */
  private _build(): void {
    if (!this._contents) {
      this._tree = [];
      this._layout = undefined;
      return;
    }
    const placed = this.placedProvider?.() ?? new Set<string>();
    this._layout = folderLayout(this._contents);
    this._tree = buildModelTree(this._contents, this.activeViewIri, placed, this._grouping);
  }

  /** Show the model in its own folders or by type, and remember it. */
  private _setGrouping(grouping: TreeGrouping): void {
    if (grouping === this._grouping) return;
    this._grouping = grouping;
    rememberGrouping(grouping);
    this._build();
  }

  /**
   * Expand the ancestors of a concept — or of one of the model's folders — and
   * scroll it into view. A folder is shown only in the folders: the tree
   * switches to them for one.
   */
  revealIri(iri: string): void {
    const path: string[] = [];
    const find = (nodes: TreeNode[], trail: string[]): boolean => {
      for (const n of nodes) {
        if (n.iri === iri || (n.kind === 'folder' && n.folderIri === iri)) {
          path.push(...trail);
          return true;
        }
        if (find(n.children, [...trail, n.id])) return true;
      }
      return false;
    };
    let found = find(this._tree, []);
    if (!found && this._grouping === 'types' && this._contents?.folders?.some((f) => f.iri === iri)) {
      this._setGrouping('folders');
      found = find(this._tree, []);
    }
    if (!found) return;
    const collapsed = new Set(this._collapsed);
    const expanded = new Set(this._expanded);
    for (const id of path) {
      collapsed.delete(id);
      expanded.add(id);
    }
    this._collapsed = collapsed;
    this._expanded = expanded;
    this.selectedIri = iri;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>(`[data-iri="${CSS.escape(iri)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  private _subscribe(): void {
    if (!this.eventBus) return;
    for (const type of REFRESH_EVENTS) this.eventBus.on(type, this._refresh);
    this._subscribed = this.eventBus;
  }

  private _unsubscribe(): void {
    if (!this._subscribed) return;
    for (const type of REFRESH_EVENTS) this._subscribed.off(type, this._refresh);
    this._subscribed = undefined;
  }

  private _emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  /** Whether a row's children are hidden: folded by hand, or folded from the start and not unfolded — unless filtering. */
  private _isFolded(node: TreeNode): boolean {
    if (this._collapsed.has(node.id)) return true;
    if (this._expanded.has(node.id)) return false;
    return node.folded === true && this._filterQuery.trim() === '';
  }

  private _toggle(node: TreeNode): void {
    const collapsed = new Set(this._collapsed);
    const expanded = new Set(this._expanded);
    if (this._isFolded(node)) {
      collapsed.delete(node.id);
      expanded.add(node.id);
    } else {
      collapsed.add(node.id);
      expanded.delete(node.id);
    }
    this._collapsed = collapsed;
    this._expanded = expanded;
  }

  private _select(node: TreeNode): void {
    if (!node.iri) return;
    this._selection = new Set([node.iri]);
    this._anchor = node.iri;
    this.selectedIri = node.iri;
    this._emit<ExplorerSelectDetail>('explorer-select', { iri: node.iri, kind: node.kind });
  }

  /** A click on a concept: selects it — or, with Ctrl/Cmd, adds or takes it; with Shift, the rows from the last one clicked. */
  private _click(e: MouseEvent, node: TreeNode): void {
    if (!node.iri) return;
    const together = folderKindOf(node) !== undefined;
    if (together && (e.metaKey || e.ctrlKey)) {
      const next = new Set(this._selection);
      if (next.has(node.iri)) next.delete(node.iri);
      else next.add(node.iri);
      this._selection = next;
      this._anchor = node.iri;
      return;
    }
    if (together && e.shiftKey && this._anchor) {
      const order = this._shownConcepts();
      const from = order.indexOf(this._anchor);
      const to = order.indexOf(node.iri);
      if (from >= 0 && to >= 0) {
        this._selection = new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1));
        return;
      }
    }
    this._select(node);
  }

  /** The concepts shown — in unfolded rows, through the filter — in order: what a Shift-click's range runs over. */
  private _shownConcepts(): string[] {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.iri && folderKindOf(n)) out.push(n.iri);
        if (!this._isFolded(n)) walk(n.children);
      }
    };
    walk(filterTree(this._tree, this._filterQuery));
    return out;
  }

  /** The elements and relationships selected in the tree — what Ctrl/⌘+C there copies. */
  selectedConcepts(): string[] {
    const kindOf = this._layout?.kindOf;
    return [...this._selection].filter((iri) => {
      const kind = kindOf?.get(iri);
      return kind === 'element' || kind === 'relationship';
    });
  }

  /** A row's concept with the others selected of its group — the row's first — or the row's alone. */
  private _selectedWith(node: TreeNode): string[] {
    const kind = folderKindOf(node);
    if (!node.iri || !kind || !this._selection.has(node.iri) || this._selection.size < 2) return node.iri ? [node.iri] : [];
    const kindOf = this._layout?.kindOf;
    return [node.iri, ...[...this._selection].filter((iri) => iri !== node.iri && kindOf?.get(iri) === kind)];
  }

  private _activate(node: TreeNode): void {
    if (node.kind === 'folder') {
      this._toggle(node);
      return;
    }
    if (!node.iri) return;
    this._emit<ExplorerActivateDetail>('explorer-activate', { iri: node.iri, kind: node.kind });
  }

  /** The view on the canvas when it is a diagram: what a view's row can be referenced in. */
  private _openDiagram(): string | undefined {
    const open = this.activeViewIri;
    return open && this._contents?.views.some((view) => view.iri === open && view.type === 'Diagram') ? open : undefined;
  }

  private _openMenu(e: MouseEvent, node: TreeNode): void {
    e.preventDefault();
    // Right-clicked among several selected: the menu is for all of them, and they stay selected.
    const iris = this._selectedWith(node);
    const options = { folders: hasFolders(this._contents), many: iris.length, openDiagram: this._openDiagram() };
    if (actionsFor(node, options).length === 0) return;
    if (iris.length < 2) this._select(node);
    this._menu = { x: e.clientX, y: e.clientY, node, ...(iris.length > 1 ? { iris } : {}) };
  }

  private _pick(action: ExplorerAction): void {
    const menu = this._menu;
    this._menu = null;
    if (!menu) return;
    const { node, iris } = menu;
    const iri = node.iri ?? node.folderIri;
    const folderKind = FOLDER_ACTIONS.has(action) || NEW_ACTIONS.has(action) ? (node.folderKind ?? folderKindOf(node)) : undefined;
    // A type's row makes one of its type, in no folder.
    const typeIri = action === 'new-element' && node.kind === 'folder' && !node.folderKind ? node.typeIri : undefined;
    if (!iri && node.kind !== 'model' && !folderKind && !typeIri) return;
    this._emit<ExplorerActionDetail>('explorer-action', {
      action,
      iri: iri ?? '',
      kind: node.kind,
      ...(folderKind ? { folderKind } : {}),
      ...(iris && (action === 'move-to-folder' || action === 'copy') ? { iris } : {}),
      ...(typeIri ? { typeIri } : {}),
    });
  }

  /** Whether the tree shows the model's folders: rows can then be dropped on them. */
  private _showsFolders(): boolean {
    return this._grouping === 'folders' && hasFolders(this._contents);
  }

  private _onRowDown(e: MouseEvent, node: TreeNode): void {
    if (e.button !== 0) return;
    if (folderKindOf(node) || (node.iri && (node.kind === 'element' || node.kind === 'unclassified'))) {
      this._press = { node, x: e.clientX, y: e.clientY };
    }
  }

  private _onDocumentMove = (e: MouseEvent): void => {
    if (this._drag) {
      this._dragOver(e);
      return;
    }
    const press = this._press;
    if (!press) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
    this._press = null;
    const { node } = press;
    const kind = folderKindOf(node);
    // Into a folder of the tree: what is selected with it, of its group.
    if (kind && this._showsFolders()) {
      this._drag = node.folderIri
        ? { iris: [node.folderIri], kind, folderIri: node.folderIri }
        : { iris: this._selectedWith(node), kind };
    }
    // An element onto the canvas, as before, and a view — a reference to it: the canvas takes it if it is let go there.
    if (node.iri && (node.kind === 'element' || node.kind === 'unclassified' || node.kind === 'view')) {
      this._emit<ExplorerDragDetail>('explorer-drag-start', { iri: node.iri, kind: node.kind, sourceEvent: e });
    }
  };

  /** Whether the dragged rows go in a row: a folder of their group — not one inside a folder dragged — or the group, out of their folders. */
  private _accepts(target: TreeNode): boolean {
    const drag = this._drag;
    if (!drag || target.kind !== 'folder' || target.folderKind !== drag.kind) return false;
    if (!target.folderIri) return true;
    return !(drag.folderIri && this._layout && folderWithin(this._layout, target.folderIri, drag.folderIri));
  }

  private _dragOver(e: MouseEvent): void {
    const row = e
      .composedPath()
      .find((t): t is HTMLElement => t instanceof HTMLElement && t.classList.contains('row'));
    const target = row?.dataset.id ? this._rowNodes.get(row.dataset.id) : undefined;
    const id = target && this._accepts(target) ? target.id : null;
    if (id === this._dropTarget) return;
    this._dropTarget = id;
    clearTimeout(this._hoverTimer);
    // Resting on a folded folder unfolds it, to go further in.
    if (target && id && target.folderIri && this._isFolded(target)) {
      this._hoverTimer = setTimeout(() => {
        if (this._dropTarget === id && this._isFolded(target)) this._toggle(target);
      }, HOVER_UNFOLD_MS);
    }
  }

  private _endDrag(): void {
    this._drag = null;
    this._dropTarget = null;
    clearTimeout(this._hoverTimer);
  }

  private _onDocumentUp = (): void => {
    this._press = null;
    const drag = this._drag;
    if (!drag) return;
    const target = this._dropTarget ? this._rowNodes.get(this._dropTarget) : undefined;
    this._endDrag();
    if (!target) return;
    this._emit<ExplorerMoveDetail>('explorer-move', {
      iris: drag.iris,
      kind: drag.kind,
      ...(target.folderIri ? { folderIri: target.folderIri } : {}),
    });
  };

  private _onDocumentKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this._drag) this._endDrag();
  };

  /** Close the menu on any press outside it. */
  private _onDocumentDown = (e: MouseEvent): void => {
    if (!this._menu) return;
    const menu = this.renderRoot.querySelector('.menu');
    if (menu && e.composedPath().includes(menu)) return;
    this._menu = null;
  };

  /** A row's icon: an element's own picture when it has one, else its kind's mark. */
  private _renderIcon(node: TreeNode) {
    const picture = node.kind === 'element' && node.iri ? this.pictureProvider?.(node.iri) : undefined;
    if (picture) return html`<span class="icon"><img class="icon-picture" src=${picture} alt="" /></span>`;
    return html`<span class="icon">${this._icon(node)}</span>`;
  }

  private _icon(node: TreeNode): string {
    switch (node.kind) {
      case 'model':
        return '◆';
      case 'view':
        return node.detail === 'diagram' ? '▦' : node.detail === 'catalog' ? '☰' : '▤';
      case 'element':
        return '■';
      case 'relationship':
        return node.derivation ? '⇢' : '→';
      case 'unclassified':
        return '?';
      default:
        return '';
    }
  }

  private _renderNode(node: TreeNode): unknown {
    const collapsed = this._isFolded(node);
    const hasChildren = node.children.length > 0;
    const shown = node.iri ?? (node.kind === 'folder' ? node.folderIri : undefined);
    const selected = shown !== undefined && (this._selection.size > 0 ? this._selection.has(shown) : shown === this.selectedIri);
    this._rowNodes.set(node.id, node);
    return html`
      <li>
        <div
          class="row ${node.kind} ${selected ? 'selected' : ''} ${node.active ? 'active' : ''} ${node.derivation ? `derived ${node.derivation}` : ''} ${this._dropTarget === node.id ? 'drop-target' : ''}"
          data-id=${node.id}
          data-iri=${node.iri ?? node.folderIri ?? nothing}
          data-kind=${node.kind}
          title=${node.derivation
            ? `${node.derivation === 'valid' ? 'Derived (valid)' : 'Potential derivation, not confirmed'}${node.detail ? ` by ${node.detail}` : ''} — ${node.iri ?? node.label}`
            : (node.iri ?? node.label)}
          @click=${(e: MouseEvent) => (node.kind === 'folder' ? this._toggle(node) : this._click(e, node))}
          @dblclick=${() => this._activate(node)}
          @contextmenu=${(e: MouseEvent) => this._openMenu(e, node)}
          @mousedown=${(e: MouseEvent) => this._onRowDown(e, node)}
        >
          <span
            class="toggle"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggle(node);
            }}
            >${hasChildren ? (collapsed ? '▶' : '▼') : ''}</span
          >
          ${this._renderIcon(node)}
          <span class="label">${node.label}</span>
          ${node.placed ? html`<span class="placed" title="In the open view"></span>` : nothing}
          ${node.detail ? html`<span class="detail">${node.detail}</span>` : nothing}
        </div>
        ${hasChildren && !collapsed ? html`<ul>${node.children.map((c) => this._renderNode(c))}</ul>` : nothing}
      </li>
    `;
  }

  override render() {
    const tree = filterTree(this._tree, this._filterQuery);
    this._rowNodes.clear();
    // What the tree shows: by type when the model has no folders, whatever was picked.
    const folders = hasFolders(this._contents);
    const shown: TreeGrouping = folders ? this._grouping : 'types';
    const grouping = (value: TreeGrouping, label: string, title: string, disabled = false) => html`<button
      type="button"
      data-grouping=${value}
      aria-pressed=${shown === value ? 'true' : 'false'}
      title=${title}
      ?disabled=${disabled}
      @click=${() => this._setGrouping(value)}
    >
      ${label}
    </button>`;
    return html`
      <div class="explorer-header">
        <span>Model</span>
        <span class="grouping" role="group" aria-label="Group the model">
          ${folders
            ? grouping('folders', 'Folders', "In the model's own folders")
            : grouping('folders', 'Folders', 'This model has no folders', true)}${grouping('types', 'Types', 'By kind and type')}
        </span>
      </div>
      <input
        class="filter-input"
        type="search"
        placeholder="Filter by name or type…"
        .value=${this._filterQuery}
        @input=${(e: Event) => (this._filterQuery = (e.target as HTMLInputElement).value)}
      />
      <div class="tree-scroll">
        ${tree.length === 0
          ? html`<div class="empty">${this._filterQuery ? 'Nothing matches.' : 'No model loaded.'}</div>`
          : html`<ul class="tree">${tree.map((n) => this._renderNode(n))}</ul>`}
      </div>
      ${this._menu
        ? html`<div class="menu" style="left:${this._menu.x}px;top:${this._menu.y}px" role="menu">
            ${actionsFor(this._menu.node, {
              folders: hasFolders(this._contents),
              many: this._menu.iris?.length,
              openDiagram: this._openDiagram(),
            }).map(
              (entry) => html`<button
                role="menuitem"
                class=${entry.danger ? 'danger' : ''}
                data-action=${entry.action}
                @click=${() => this._pick(entry.action)}
              >
                ${entry.label}
              </button>`,
            )}
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'model-explorer': ModelExplorer;
  }
}
