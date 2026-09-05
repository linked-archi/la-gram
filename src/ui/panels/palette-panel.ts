import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  PaletteDefinition,
  ElementGroup,
  ElementTypeInfo,
  RelationshipTypeInfo,
  ViewpointInfo,
} from '../../metamodel-manager/interfaces.js';

/**
 * Custom event detail for palette drag operations.
 * Emitted when a user drags an element or relationship type from the palette.
 */
export interface PaletteDragDetail {
  /** IRI of the type being dragged. */
  iri: string;
  /** Display label. */
  label: string;
  /** Whether this is an element or relationship type. */
  kind: 'element' | 'relationship';
}

/**
 * Palette panel Lit component.
 *
 * Displays element types grouped by category and relationship types
 * from a PaletteDefinition. Supports collapsible category groups and
 * drag-to-canvas for element/relationship creation.
 *
 * Viewpoint filtering can be handled in two ways:
 * 1. Externally — the parent passes an already-filtered PaletteDefinition.
 * 2. Internally — set the `activeViewpoint` property and the component
 *    filters the palette to only show permitted types.
 */
@customElement('palette-panel')
export class PalettePanel extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
      user-select: none;
    }

    .palette-header {
      padding: 8px 12px;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
    }

    .group-header {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      cursor: pointer;
      background: #f5f5f5;
      border-bottom: 1px solid #eee;
      font-weight: 500;
    }

    .group-header:hover {
      background: #eaeaea;
    }

    .group-toggle {
      margin-right: 6px;
      transition: transform 0.15s;
    }

    .group-toggle.collapsed {
      transform: rotate(-90deg);
    }

    .group-items {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .group-items.hidden {
      display: none;
    }

    .palette-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px 4px 24px;
      cursor: grab;
      border-bottom: 1px solid #f0f0f0;
    }

    .palette-item:hover {
      background: #e8f0fe;
    }

    .palette-item:active {
      cursor: grabbing;
    }

    .palette-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    .palette-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .section-divider {
      padding: 8px 12px 4px;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      border-top: 1px solid #ddd;
    }
  `;

  @property({ attribute: false })
  palette: PaletteDefinition = { elementGroups: [], relationshipTypes: [] };

  /**
   * Optional active viewpoint. When set, the palette is filtered to only
   * show element and relationship types permitted by this viewpoint.
   */
  @property({ attribute: false })
  activeViewpoint?: ViewpointInfo;

  @state()
  private _collapsedGroups: Set<string> = new Set();

  /**
   * Returns the effective palette after applying viewpoint filtering.
   * If no viewpoint is active, returns the full palette unchanged.
   */
  private get _effectivePalette(): PaletteDefinition {
    if (!this.activeViewpoint) return this.palette;

    const permittedElements = new Set(this.activeViewpoint.permittedElements);
    const permittedRelationships = new Set(this.activeViewpoint.permittedRelationships);

    const filteredGroups: ElementGroup[] = this.palette.elementGroups
      .map((group) => ({
        category: group.category,
        elements: group.elements.filter((e) => permittedElements.has(e.iri)),
      }))
      .filter((group) => group.elements.length > 0);

    const filteredRelationships = this.palette.relationshipTypes.filter((r) =>
      permittedRelationships.has(r.iri),
    );

    return { elementGroups: filteredGroups, relationshipTypes: filteredRelationships };
  }

  private _toggleGroup(category: string): void {
    const next = new Set(this._collapsedGroups);
    if (next.has(category)) {
      next.delete(category);
    } else {
      next.add(category);
    }
    this._collapsedGroups = next;
  }

  private _onDragStart(e: DragEvent, detail: PaletteDragDetail): void {
    e.dataTransfer?.setData('application/json', JSON.stringify(detail));
    this.dispatchEvent(
      new CustomEvent<PaletteDragDetail>('palette-drag-start', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderElementItem(el: ElementTypeInfo): unknown {
    if (el.isAbstract) return nothing;
    const detail: PaletteDragDetail = { iri: el.iri, label: el.label, kind: 'element' };
    return html`
      <li
        class="palette-item"
        draggable="true"
        @dragstart=${(e: DragEvent) => this._onDragStart(e, detail)}
      >
        ${el.iconUrl
          ? html`<img class="palette-icon" src=${el.iconUrl} alt="" />`
          : html`<span class="palette-icon"></span>`}
        <span class="palette-label">${el.label}</span>
      </li>
    `;
  }

  private _renderGroup(group: ElementGroup): unknown {
    const concreteElements = group.elements.filter((el) => !el.isAbstract);
    if (concreteElements.length === 0) return nothing;

    const collapsed = this._collapsedGroups.has(group.category);
    return html`
      <div class="group">
        <div class="group-header" @click=${() => this._toggleGroup(group.category)}>
          <span class="group-toggle ${collapsed ? 'collapsed' : ''}">▾</span>
          ${group.category}
        </div>
        <ul class="group-items ${collapsed ? 'hidden' : ''}">
          ${group.elements.map((el) => this._renderElementItem(el))}
        </ul>
      </div>
    `;
  }

  private _renderRelationship(rel: RelationshipTypeInfo): unknown {
    const detail: PaletteDragDetail = { iri: rel.iri, label: rel.label, kind: 'relationship' };
    return html`
      <li
        class="palette-item"
        draggable="true"
        @dragstart=${(e: DragEvent) => this._onDragStart(e, detail)}
      >
        ${rel.iconUrl
          ? html`<img class="palette-icon" src=${rel.iconUrl} alt="" />`
          : html`<span class="palette-icon"></span>`}
        <span class="palette-label">${rel.label}</span>
      </li>
    `;
  }

  override render() {
    const { elementGroups, relationshipTypes } = this._effectivePalette;
    return html`
      <div class="palette-header">Palette</div>
      ${elementGroups.map((g) => this._renderGroup(g))}
      ${relationshipTypes.length > 0
        ? html`
            <div class="section-divider">Relationships</div>
            <ul class="group-items">
              ${relationshipTypes.map((r) => this._renderRelationship(r))}
            </ul>
          `
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'palette-panel': PalettePanel;
  }
}
