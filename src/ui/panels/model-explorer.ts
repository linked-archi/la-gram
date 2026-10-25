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
 *   ▸ Unclassified                      types no loaded metamodel defines
 * ```
 *
 * ## Interactions
 *
 * - click selects (`explorer-select`); double-click opens a view or reveals an
 *   element on the canvas (`explorer-activate`);
 * - right-click opens a context menu whose picks are `explorer-action` events —
 *   the component does no model work itself, `mount-ui` does;
 * - pressing on an element and dragging past a small threshold starts placing
 *   it on the canvas (`explorer-drag-start`, carrying the pointer event for
 *   diagram-js's `create` gesture). The threshold is what keeps a click a click.
 *
 * The tree is rebuilt from a {@link ModelContents} snapshot the host supplies
 * (`contentsProvider`), once after the events that can change it; another
 * active view rebuilds it from the snapshot it has.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ModelContents, ConceptSummary } from '../../model-manager/model-queries.js';
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
  kind: TreeNodeKind;
  label: string;
  /** Secondary text: a type, a count, a view kind. */
  detail?: string;
  typeIri?: string;
  /** Element or relationship drawn in the open view. */
  placed?: boolean;
  /** The view on the canvas. */
  active?: boolean;
  children: TreeNode[];
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
  | 'open-view'
  | 'rename-view'
  | 'duplicate-view'
  | 'delete-view'
  | 'set-viewpoint'
  | 'add-to-view'
  | 'reveal'
  | 'rename'
  | 'delete-from-model'
  | 'show-source'
  | 'show-target';

/** Detail of `explorer-action`. */
export interface ExplorerActionDetail {
  action: ExplorerAction;
  iri: string;
  kind: TreeNodeKind;
}

/** Detail of `explorer-drag-start`. */
export interface ExplorerDragDetail {
  iri: string;
  /** The pointer event to hand to diagram-js's `create.start`. */
  sourceEvent: MouseEvent;
}

/** Pixels the pointer must travel with the button down before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

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
  items: ConceptSummary[],
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

/**
 * Build the tree from a model snapshot.
 *
 * @param placed IRIs drawn in the open view (elements and relationships).
 */
export function buildModelTree(
  contents: ModelContents,
  activeViewIri: string | undefined,
  placed: ReadonlySet<string> = new Set(),
): TreeNode[] {
  const views: TreeNode = {
    id: 'folder:views',
    kind: 'folder',
    label: 'Views',
    detail: String(contents.views.length),
    children: contents.views.map((v) => ({
      id: v.iri,
      iri: v.iri,
      kind: 'view' as const,
      label: v.label || iriFragment(v.iri),
      detail: viewKindDetail(v),
      active: v.iri === activeViewIri,
      children: [],
    })),
  };
  const elements: TreeNode = {
    id: 'folder:elements',
    kind: 'folder',
    label: 'Elements',
    detail: String(contents.elements.length),
    children: groupByType(contents.elements, 'element', 'elements', placed),
  };
  const relationships: TreeNode = {
    id: 'folder:relationships',
    kind: 'folder',
    label: 'Relationships',
    detail: String(contents.relationships.length),
    children: groupByType(contents.relationships, 'relationship', 'relationships', placed),
  };
  const folders = [views, elements, relationships];
  if (contents.unclassified.length > 0) {
    folders.push({
      id: 'folder:unclassified',
      kind: 'folder',
      label: 'Unclassified',
      detail: String(contents.unclassified.length),
      children: groupByType(contents.unclassified, 'unclassified', 'unclassified', placed),
    });
  }
  const root: TreeNode = {
    id: contents.model?.iri ?? 'model',
    ...(contents.model ? { iri: contents.model.iri } : {}),
    kind: 'model',
    label: contents.model?.label ?? 'Model',
    children: folders,
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

/** Context menu entries for a row. */
export function actionsFor(node: TreeNode): Array<{ action: ExplorerAction; label: string; danger?: boolean }> {
  switch (node.kind) {
    case 'model':
      return [
        { action: 'rename-model', label: 'Rename model…' },
        { action: 'model-settings', label: 'Model settings…' },
        { action: 'new-diagram', label: 'New diagram view' },
        { action: 'new-catalog', label: 'New catalog view' },
        { action: 'new-matrix', label: 'New matrix view' },
      ];
    case 'view':
      return [
        { action: 'open-view', label: 'Open' },
        { action: 'rename-view', label: 'Rename…' },
        { action: 'set-viewpoint', label: 'Set viewpoint…' },
        { action: 'duplicate-view', label: 'Duplicate' },
        { action: 'delete-view', label: 'Delete view (keeps its elements)', danger: true },
      ];
    case 'element':
    case 'unclassified':
      return [
        node.placed
          ? { action: 'reveal', label: 'Select on canvas' }
          : { action: 'add-to-view', label: 'Add to current view' },
        { action: 'rename', label: 'Rename…' },
        { action: 'delete-from-model', label: 'Delete from model…', danger: true },
      ];
    case 'relationship':
      return [
        node.placed
          ? { action: 'reveal', label: 'Select on canvas' }
          : { action: 'add-to-view', label: 'Add to current view' },
        { action: 'show-source', label: 'Show source' },
        { action: 'show-target', label: 'Show target' },
        { action: 'rename', label: 'Rename…' },
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

  /** The view on the canvas. */
  @property({ attribute: false })
  activeViewIri?: string;

  @property({ attribute: false })
  eventBus?: EventBus;

  @property({ type: String })
  selectedIri = '';

  @state() private _tree: TreeNode[] = [];
  @state() private _filterQuery = '';
  @state() private _collapsed: Set<string> = new Set(['folder:relationships']);
  @state() private _menu: { x: number; y: number; node: TreeNode } | null = null;

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
  private _press: { iri: string; x: number; y: number } | null = null;
  private _subscribed?: EventBus;

  override connectedCallback(): void {
    super.connectedCallback();
    this._subscribe();
    this.refresh();
    document.addEventListener('mousemove', this._onDocumentMove);
    document.addEventListener('mouseup', this._onDocumentUp);
    document.addEventListener('mousedown', this._onDocumentDown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe();
    document.removeEventListener('mousemove', this._onDocumentMove);
    document.removeEventListener('mouseup', this._onDocumentUp);
    document.removeEventListener('mousedown', this._onDocumentDown, true);
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
      return;
    }
    const placed = this.placedProvider?.() ?? new Set<string>();
    this._tree = buildModelTree(this._contents, this.activeViewIri, placed);
  }

  /** Expand the ancestors of a concept and scroll it into view. */
  revealIri(iri: string): void {
    const path: string[] = [];
    const find = (nodes: TreeNode[], trail: string[]): boolean => {
      for (const n of nodes) {
        if (n.iri === iri) {
          path.push(...trail);
          return true;
        }
        if (find(n.children, [...trail, n.id])) return true;
      }
      return false;
    };
    if (!find(this._tree, [])) return;
    const collapsed = new Set(this._collapsed);
    for (const id of path) collapsed.delete(id);
    this._collapsed = collapsed;
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

  private _toggle(id: string): void {
    const next = new Set(this._collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._collapsed = next;
  }

  private _select(node: TreeNode): void {
    if (!node.iri) return;
    this.selectedIri = node.iri;
    this._emit<ExplorerSelectDetail>('explorer-select', { iri: node.iri, kind: node.kind });
  }

  private _activate(node: TreeNode): void {
    if (node.kind === 'folder') {
      this._toggle(node.id);
      return;
    }
    if (!node.iri) return;
    this._emit<ExplorerActivateDetail>('explorer-activate', { iri: node.iri, kind: node.kind });
  }

  private _openMenu(e: MouseEvent, node: TreeNode): void {
    e.preventDefault();
    if (actionsFor(node).length === 0) return;
    this._select(node);
    this._menu = { x: e.clientX, y: e.clientY, node };
  }

  private _pick(action: ExplorerAction): void {
    const node = this._menu?.node;
    this._menu = null;
    if (!node?.iri && node?.kind !== 'model') return;
    this._emit<ExplorerActionDetail>('explorer-action', { action, iri: node.iri ?? '', kind: node.kind });
  }

  private _onRowDown(e: MouseEvent, node: TreeNode): void {
    if (e.button !== 0 || !node.iri) return;
    if (node.kind === 'element' || node.kind === 'unclassified') {
      this._press = { iri: node.iri, x: e.clientX, y: e.clientY };
    }
  }

  private _onDocumentMove = (e: MouseEvent): void => {
    const press = this._press;
    if (!press) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
    this._press = null;
    this._emit<ExplorerDragDetail>('explorer-drag-start', { iri: press.iri, sourceEvent: e });
  };

  private _onDocumentUp = (): void => {
    this._press = null;
  };

  /** Close the menu on any press outside it. */
  private _onDocumentDown = (e: MouseEvent): void => {
    if (!this._menu) return;
    const menu = this.renderRoot.querySelector('.menu');
    if (menu && e.composedPath().includes(menu)) return;
    this._menu = null;
  };

  private _icon(node: TreeNode): string {
    switch (node.kind) {
      case 'model':
        return '◆';
      case 'view':
        return node.detail === 'diagram' ? '▦' : node.detail === 'catalog' ? '☰' : '▤';
      case 'element':
        return '■';
      case 'relationship':
        return '→';
      case 'unclassified':
        return '?';
      default:
        return '';
    }
  }

  private _renderNode(node: TreeNode): unknown {
    const collapsed = this._collapsed.has(node.id);
    const hasChildren = node.children.length > 0;
    const selected = node.iri !== undefined && node.iri === this.selectedIri;
    return html`
      <li>
        <div
          class="row ${node.kind} ${selected ? 'selected' : ''} ${node.active ? 'active' : ''}"
          data-iri=${node.iri ?? nothing}
          data-kind=${node.kind}
          title=${node.iri ?? node.label}
          @click=${() => (node.kind === 'folder' ? this._toggle(node.id) : this._select(node))}
          @dblclick=${() => this._activate(node)}
          @contextmenu=${(e: MouseEvent) => this._openMenu(e, node)}
          @mousedown=${(e: MouseEvent) => this._onRowDown(e, node)}
        >
          <span
            class="toggle"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggle(node.id);
            }}
            >${hasChildren ? (collapsed ? '▶' : '▼') : ''}</span
          >
          <span class="icon">${this._icon(node)}</span>
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
    return html`
      <div class="explorer-header">Model</div>
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
            ${actionsFor(this._menu.node).map(
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
