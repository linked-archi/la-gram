/**
 * Model Explorer Panel — tree view of architecture model contents.
 *
 * Displays a hierarchical tree organized by `arch:Folder` containment.
 * Each node shows an icon (from type), label (skos:prefLabel), and type name.
 * Supports filtering by type, name, or property values.
 * Subscribes to EventBus for reactive updates on model changes.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Quad, NamedNode } from '@rdfjs/types';
import type { RdfStore } from '../../rdf-engine/interfaces.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import type { EventBus, ModelEventHandler } from '../event-bus.js';

// ── Well-known predicate IRIs ───────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const ARCH_FOLDER = NAMESPACES.arch + 'Folder';
const ARCH_CONTAINS = NAMESPACES.arch + 'contains';

// ── Tree data structures ────────────────────────────────────────────────

/** A single node in the model explorer tree. */
export interface TreeNode {
  /** IRI of the model element or folder. */
  iri: string;
  /** Display label (from skos:prefLabel). */
  label: string;
  /** Short type name (fragment of rdf:type IRI). */
  typeName: string;
  /** Full type IRI. */
  typeIri: string;
  /** Whether this node is a folder. */
  isFolder: boolean;
  /** Child nodes (elements contained in this folder). */
  children: TreeNode[];
}

/** Detail emitted when a tree node is selected. */
export interface ExplorerSelectDetail {
  /** IRI of the selected element. */
  iri: string;
}

// ── Pure functions (exported for unit testing) ──────────────────────────

/**
 * Derives a short human-readable label from a full IRI.
 * Uses the fragment after `#` or the last path segment.
 */
export function iriFragment(iri: string): string {
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx !== -1) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx !== -1) return iri.slice(slashIdx + 1);
  return iri;
}

/**
 * Builds a tree structure from RDF quads representing the model.
 *
 * Extracts all elements and folders, then organizes them by `arch:contains`
 * containment hierarchy. Elements not contained in any folder appear at root level.
 *
 * @param quads - All quads from the RDF store
 * @returns Array of root-level tree nodes
 */
export function buildTree(quads: Quad[]): TreeNode[] {
  // Collect element info: IRI → { label, typeIri, typeName, isFolder }
  const elementMap = new Map<string, { label: string; typeIri: string; typeName: string; isFolder: boolean }>();

  // Pass 1: collect types
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE) {
      const iri = q.subject.value;
      const typeIri = q.object.value;
      if (!elementMap.has(iri)) {
        elementMap.set(iri, { label: '', typeIri, typeName: iriFragment(typeIri), isFolder: typeIri === ARCH_FOLDER });
      } else {
        const entry = elementMap.get(iri)!;
        entry.typeIri = typeIri;
        entry.typeName = iriFragment(typeIri);
        entry.isFolder = typeIri === ARCH_FOLDER;
      }
    }
  }

  // Pass 2: collect labels
  for (const q of quads) {
    if (q.predicate.value === SKOS_PREF_LABEL) {
      const iri = q.subject.value;
      if (elementMap.has(iri)) {
        elementMap.get(iri)!.label = q.object.value;
      }
    }
  }

  // Pass 3: collect containment (arch:contains)
  const parentOf = new Map<string, string>(); // child → parent
  const childrenOf = new Map<string, string[]>(); // parent → children

  for (const q of quads) {
    if (q.predicate.value === ARCH_CONTAINS) {
      const parent = q.subject.value;
      const child = q.object.value;
      parentOf.set(child, parent);
      if (!childrenOf.has(parent)) {
        childrenOf.set(parent, []);
      }
      childrenOf.get(parent)!.push(child);
    }
  }

  // Build tree nodes recursively
  function buildNode(iri: string): TreeNode {
    const info = elementMap.get(iri);
    const label = info?.label || iriFragment(iri);
    const typeIri = info?.typeIri ?? '';
    const typeName = info?.typeName ?? '';
    const isFolder = info?.isFolder ?? false;

    const childIris = childrenOf.get(iri) ?? [];
    const children = childIris
      .filter((c) => elementMap.has(c))
      .map((c) => buildNode(c))
      .sort((a, b) => {
        // Folders first, then alphabetical by label
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.label.localeCompare(b.label);
      });

    return { iri, label, typeName, typeIri, isFolder, children };
  }

  // Root nodes: elements that have a type but are not contained in any folder
  const rootIris = [...elementMap.keys()].filter((iri) => !parentOf.has(iri));

  return rootIris
    .map((iri) => buildNode(iri))
    .sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

/**
 * Filters a tree by a search query, matching against node label, type name,
 * or any property value in the quads.
 *
 * A node is included if it matches the filter OR if any of its descendants match.
 * Folders are always included if they contain matching descendants.
 *
 * @param nodes - Root tree nodes
 * @param query - Search string (case-insensitive)
 * @param quads - All quads for property value matching
 * @returns Filtered tree nodes
 */
export function filterTree(nodes: TreeNode[], query: string, quads: Quad[]): TreeNode[] {
  if (!query.trim()) return nodes;

  const lowerQuery = query.toLowerCase();

  // Build a set of IRIs that match by property value
  const matchingByProperty = new Set<string>();
  for (const q of quads) {
    if (q.object.value.toLowerCase().includes(lowerQuery)) {
      matchingByProperty.add(q.subject.value);
    }
  }

  function nodeMatches(node: TreeNode): boolean {
    return (
      node.label.toLowerCase().includes(lowerQuery) ||
      node.typeName.toLowerCase().includes(lowerQuery) ||
      matchingByProperty.has(node.iri)
    );
  }

  function filterNode(node: TreeNode): TreeNode | null {
    const filteredChildren = node.children
      .map((child) => filterNode(child))
      .filter((child): child is TreeNode => child !== null);

    if (nodeMatches(node) || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  }

  return nodes
    .map((node) => filterNode(node))
    .filter((node): node is TreeNode => node !== null);
}

// ── Lit Component ───────────────────────────────────────────────────────

@customElement('model-explorer')
export class ModelExplorer extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
      user-select: none;
    }

    .explorer-header {
      padding: 8px 12px;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
    }

    .filter-input {
      display: block;
      width: calc(100% - 24px);
      margin: 8px 12px;
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 3px;
      font-size: 13px;
      font-family: inherit;
      box-sizing: border-box;
    }

    .filter-input:focus {
      outline: none;
      border-color: #1a73e8;
      box-shadow: 0 0 0 1px #1a73e8;
    }

    .tree {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .tree-node {
      cursor: pointer;
    }

    .node-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-bottom: 1px solid #f0f0f0;
    }

    .node-row:hover {
      background: #e8f0fe;
    }

    .node-row.selected {
      background: #d2e3fc;
    }

    .node-toggle {
      width: 16px;
      flex-shrink: 0;
      text-align: center;
      font-size: 10px;
      transition: transform 0.15s;
    }

    .node-toggle.collapsed {
      transform: rotate(-90deg);
    }

    .node-toggle.leaf {
      visibility: hidden;
    }

    .node-icon {
      flex-shrink: 0;
      font-size: 14px;
    }

    .node-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }

    .node-type {
      font-size: 11px;
      color: #888;
      white-space: nowrap;
    }

    .children {
      list-style: none;
      margin: 0;
      padding: 0 0 0 16px;
    }

    .children.hidden {
      display: none;
    }

    .empty-message {
      padding: 16px 12px;
      color: #888;
      font-style: italic;
    }
  `;

  /** Reference to the RDF store for querying model elements. */
  @property({ attribute: false })
  rdfStore?: RdfStore;

  /** Optional EventBus for subscribing to model change events. */
  @property({ attribute: false })
  eventBus?: EventBus;

  /** IRI of the currently selected element (for highlighting). */
  @property({ type: String })
  selectedIri = '';

  @state()
  private _tree: TreeNode[] = [];

  @state()
  private _filterQuery = '';

  @state()
  private _collapsedNodes: Set<string> = new Set();

  @state()
  private _allQuads: Quad[] = [];

  private _eventHandler: ModelEventHandler = () => this._rebuildTree();

  override connectedCallback(): void {
    super.connectedCallback();
    this._subscribeEvents();
    this._rebuildTree();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribeEvents();
  }

  override willUpdate(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('rdfStore')) {
      this._rebuildTree();
    }
    if (changedProperties.has('eventBus')) {
      // Re-subscribe if eventBus changes
      this._unsubscribeEvents();
      this._subscribeEvents();
    }
  }

  private _subscribeEvents(): void {
    if (!this.eventBus) return;
    this.eventBus.on('element-created', this._eventHandler);
    this.eventBus.on('element-deleted', this._eventHandler);
    this.eventBus.on('model-loaded', this._eventHandler);
  }

  private _unsubscribeEvents(): void {
    if (!this.eventBus) return;
    this.eventBus.off('element-created', this._eventHandler);
    this.eventBus.off('element-deleted', this._eventHandler);
    this.eventBus.off('model-loaded', this._eventHandler);
  }

  private _rebuildTree(): void {
    if (!this.rdfStore) {
      this._tree = [];
      this._allQuads = [];
      return;
    }
    this._allQuads = this.rdfStore.getQuads();
    this._tree = buildTree(this._allQuads);
  }

  private _onFilterInput(e: Event): void {
    this._filterQuery = (e.target as HTMLInputElement).value;
  }

  private _toggleNode(iri: string): void {
    const next = new Set(this._collapsedNodes);
    if (next.has(iri)) {
      next.delete(iri);
    } else {
      next.add(iri);
    }
    this._collapsedNodes = next;
  }

  private _selectNode(iri: string): void {
    this.selectedIri = iri;
    this.dispatchEvent(
      new CustomEvent<ExplorerSelectDetail>('explorer-select', {
        detail: { iri },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderNode(node: TreeNode): unknown {
    const hasChildren = node.children.length > 0;
    const collapsed = this._collapsedNodes.has(node.iri);
    const isSelected = this.selectedIri === node.iri;
    const icon = node.isFolder ? '📁' : '📄';
    const indent = hasChildren ? '' : ' leaf';

    return html`
      <li class="tree-node">
        <div
          class="node-row ${isSelected ? 'selected' : ''}"
          @click=${() => this._selectNode(node.iri)}
        >
          <span
            class="node-toggle${collapsed ? ' collapsed' : ''}${indent}"
            @click=${(e: Event) => {
              e.stopPropagation();
              if (hasChildren) this._toggleNode(node.iri);
            }}
          >▾</span>
          <span class="node-icon">${icon}</span>
          <span class="node-label">${node.label}</span>
          <span class="node-type">${node.typeName}</span>
        </div>
        ${hasChildren
          ? html`
              <ul class="children ${collapsed ? 'hidden' : ''}">
                ${node.children.map((child) => this._renderNode(child))}
              </ul>
            `
          : nothing}
      </li>
    `;
  }

  override render() {
    const displayTree = this._filterQuery
      ? filterTree(this._tree, this._filterQuery, this._allQuads)
      : this._tree;

    return html`
      <div class="explorer-header">Model Explorer</div>
      <input
        class="filter-input"
        type="text"
        placeholder="Filter by name, type, or property…"
        .value=${this._filterQuery}
        @input=${this._onFilterInput}
      />
      ${displayTree.length > 0
        ? html`<ul class="tree">${displayTree.map((node) => this._renderNode(node))}</ul>`
        : html`<div class="empty-message">No elements found</div>`}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'model-explorer': ModelExplorer;
  }
}
