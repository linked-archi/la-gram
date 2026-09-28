/**
 * Graph panel — the bottom panel's Graph tab: the relationships around the
 * selected element, drawn as a graph.
 *
 * Controls on the left: the root (the selected element; double-click a node to
 * move it), the depth (1–5 hops), the layout, and filters on element and
 * relationship types — which prune the traversal, not only the drawing. On the
 * right, the graph (`graph-view.ts`, Cytoscape.js).
 *
 * Below them, what to do with the graph: its SPARQL query — as a `SELECT` (a
 * table, one row per relationship) or a `CONSTRUCT` (the triples) — run in the
 * SPARQL Query tab or downloaded; the graph as a new view, laid out as drawn;
 * the drawn triples as Turtle. The graph is drawn by walking the store
 * (`model-manager/relationship-graph.ts`); tests hold the query to the same
 * result, so run the query and you get what is drawn.
 *
 * The panel does no work while its tab is hidden; while shown it follows the
 * selection and refreshes, debounced, on model changes.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { Quad } from '@rdfjs/types';
import type { Decoration, LineStyle } from '../../metamodel-manager/notation.js';
import {
  MAX_GRAPH_DEPTH,
  type GraphQueryForm,
  type GraphQueryOptions,
  type RelationshipGraph,
} from '../../model-manager/relationship-graph.js';
import { createCytoscapeView, type GraphLayout, type GraphView, type GraphViewFactory } from './graph-view.js';

/** A type offered in a filter. */
export interface GraphTypeOption {
  iri: string;
  label: string;
  /** How many of the model's concepts have it. */
  count: number;
  color?: string;
}

/** How a type is drawn. */
export interface GraphTypeLook {
  label: string;
  color?: string;
  icon?: string;
  lineStyle?: LineStyle;
  sourceDecor?: Decoration;
  targetDecor?: Decoration;
}

/** What the panel reads from the app. */
export interface GraphSource {
  /** Run the graph query (the store holds the model). */
  graph(options: GraphQueryOptions): RelationshipGraph;
  /** Element and relationship types the model uses — the filters' choices. */
  types(): { elements: GraphTypeOption[]; relationships: GraphTypeOption[] };
  /** How to draw a type. */
  look(typeIri: string | undefined): GraphTypeLook;
  /** The graph's triples as Turtle, with the model's prefixes. */
  turtle(quads: Quad[]): string;
  /** A concept's name. */
  label(iri: string): string;
}

/** Detail of `graph-download`. */
export interface GraphDownloadDetail {
  text: string;
  fileName: string;
  mediaType: string;
}

/** Detail of `graph-open-sparql`: run this query in the SPARQL Query tab. */
export interface GraphOpenSparqlDetail {
  query: string;
  form: GraphQueryForm;
}

/** Detail of `graph-new-view`: a view of the graph, laid out as drawn. */
export interface GraphNewViewDetail {
  /** The drawn elements and relationships. */
  iris: string[];
  /** Each element's centre in the drawing. */
  centres: Map<string, { x: number; y: number }>;
  /** A name to offer. */
  label: string;
}

const DEPTH_KEY = 'la-gram:graph-depth';
const LAYOUT_KEY = 'la-gram:graph-layout';
const FORM_KEY = 'la-gram:graph-query-form';
const REFRESH_DELAY_MS = 300;

function stored(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* not remembered: fine */
  }
}

function slug(text: string): string {
  return text.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'graph';
}

@customElement('graph-panel')
export class GraphPanel extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      background: #fff;
    }
    .layout {
      display: flex;
      height: 100%;
      min-height: 0;
    }
    .controls {
      flex: 0 0 250px;
      overflow: auto;
      border-right: 1px solid #e8eaed;
      background: #f8f9fa;
      padding: 8px 10px;
      box-sizing: border-box;
    }
    .root {
      font-weight: 600;
      margin-bottom: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .root .type {
      font-weight: 400;
      color: #5f6368;
      font-size: 12px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .caption {
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      width: 52px;
    }
    .depth button,
    .tool {
      font: inherit;
      font-size: 12px;
      border: 1px solid #dadce0;
      background: #fff;
      cursor: pointer;
      padding: 2px 8px;
    }
    .depth {
      display: flex;
    }
    .depth button {
      border-radius: 0;
      margin-left: -1px;
      min-width: 26px;
    }
    .depth button:first-child {
      border-radius: 4px 0 0 4px;
      margin-left: 0;
    }
    .depth button:last-child {
      border-radius: 0 4px 4px 0;
    }
    .depth button[aria-pressed='true'] {
      background: #e8f0fe;
      border-color: #1a73e8;
      color: #1a73e8;
      position: relative;
      z-index: 1;
    }
    .tool {
      border-radius: 4px;
    }
    .tool:hover,
    .depth button:hover {
      background: #f1f3f4;
    }
    select {
      font: inherit;
      font-size: 12px;
      padding: 1px 4px;
      border: 1px solid #dadce0;
      border-radius: 4px;
    }
    details {
      margin-bottom: 8px;
    }
    summary {
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    summary .shown {
      font-weight: 400;
      text-transform: none;
    }
    summary .all {
      margin-left: auto;
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      color: #1a73e8;
      cursor: pointer;
    }
    ul.types {
      list-style: none;
      margin: 4px 0 0;
      padding: 0;
    }
    ul.types li label {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 1px 0;
      cursor: pointer;
    }
    .swatch {
      width: 10px;
      height: 10px;
      border: 1px solid #9aa0a6;
      border-radius: 2px;
      flex: 0 0 auto;
    }
    .count {
      margin-left: auto;
      color: #80868b;
      font-size: 11px;
    }
    .stats {
      color: #5f6368;
      font-size: 12px;
      margin: 8px 0;
    }
    .exports {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .row .exports {
      margin-bottom: 0;
    }
    .canvas {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
    }
    .cy {
      position: absolute;
      inset: 0;
    }
    .message {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #80868b;
      font-style: italic;
      pointer-events: none;
    }
    .error {
      color: #c5221f;
      font-size: 12px;
    }
  `;

  /** Whether the tab is shown; nothing is queried or drawn while not. */
  @property({ type: Boolean, reflect: true }) active = false;

  /** The element in the middle. */
  @property({ type: String }) rootIri = '';

  /** The concept selected elsewhere, highlighted when drawn. */
  @property({ type: String }) selectedIri = '';

  @property({ attribute: false }) source?: GraphSource;

  /** Makes the drawing; Cytoscape.js unless replaced (tests). */
  @property({ attribute: false }) viewFactory: GraphViewFactory = createCytoscapeView;

  @state() private _depth = Math.min(MAX_GRAPH_DEPTH, Math.max(1, Number(stored(DEPTH_KEY)) || 2));
  @state() private _layout: GraphLayout = (['rings', 'tree', 'force'] as const).find((l) => l === stored(LAYOUT_KEY)) ?? 'rings';
  @state() private _form: GraphQueryForm = stored(FORM_KEY) === 'construct' ? 'construct' : 'select';
  @state() private _hiddenElements = new Set<string>();
  @state() private _hiddenRelationships = new Set<string>();
  @state() private _graph: RelationshipGraph | undefined;
  @state() private _types: { elements: GraphTypeOption[]; relationships: GraphTypeOption[] } = { elements: [], relationships: [] };
  @state() private _error = '';

  @query('.cy') private _container?: HTMLElement;

  private _view: GraphView | undefined;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** Follows the drawing area's size (the panel dragged, maximized, restored). */
  private _sizeWatcher: ResizeObserver | undefined;
  private _resizeFrame = 0;

  /** The depth drawn. */
  get depth(): number {
    return this._depth;
  }

  /** The graph drawn, and the query it came from. */
  get graph(): RelationshipGraph | undefined {
    return this._graph;
  }

  /** What the query is asked, from the controls. */
  queryOptions(): GraphQueryOptions | undefined {
    if (!this.rootIri) return undefined;
    const pick = (all: GraphTypeOption[], hidden: Set<string>) =>
      hidden.size === 0 ? undefined : all.filter((t) => !hidden.has(t.iri)).map((t) => t.iri);
    const elementTypes = pick(this._types.elements, this._hiddenElements);
    const relationshipTypes = pick(this._types.relationships, this._hiddenRelationships);
    return {
      rootIri: this.rootIri,
      depth: this._depth,
      rootLabel: this.source?.label(this.rootIri) ?? '',
      ...(elementTypes ? { elementTypes } : {}),
      ...(relationshipTypes ? { relationshipTypes } : {}),
    };
  }

  /** Query and draw now (when shown). */
  refresh(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this.active || !this.source) return;
    this._types = this.source.types();
    const options = this.queryOptions();
    if (!options) {
      this._graph = undefined;
      this._view?.show([], [], '', this._layout);
      return;
    }
    try {
      this._graph = this.source.graph(options);
      this._error = '';
    } catch (err: unknown) {
      this._graph = undefined;
      this._error = err instanceof Error ? err.message : String(err);
    }
    this._draw();
  }

  /** Query and draw soon (when shown) — on every model change. */
  scheduleRefresh(): void {
    if (!this.active) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
  }

  setDepth(depth: number): void {
    this._depth = Math.max(1, Math.min(MAX_GRAPH_DEPTH, depth));
    remember(DEPTH_KEY, String(this._depth));
    this.refresh();
  }

  /** Show or hide a type; hidden types are not traversed. */
  toggleType(kind: 'element' | 'relationship', iri: string, shown: boolean): void {
    const next = new Set(kind === 'element' ? this._hiddenElements : this._hiddenRelationships);
    if (shown) next.delete(iri);
    else next.add(iri);
    if (kind === 'element') this._hiddenElements = next;
    else this._hiddenRelationships = next;
    this.refresh();
  }

  private _showAll(kind: 'element' | 'relationship', shown: boolean): void {
    const all = (kind === 'element' ? this._types.elements : this._types.relationships).map((t) => t.iri);
    const next = new Set(shown ? [] : all);
    if (kind === 'element') this._hiddenElements = next;
    else this._hiddenRelationships = next;
    this.refresh();
  }

  private _draw(): void {
    const view = this._view;
    const graph = this._graph;
    const source = this.source;
    if (!view || !source) return;
    if (!graph) {
      view.show([], [], '', this._layout);
      return;
    }
    view.show(
      graph.nodes.map((n) => {
        const look = source.look(n.typeIri);
        return {
          id: n.iri,
          label: n.label,
          typeLabel: look.label,
          depth: n.depth,
          ...(look.color ? { color: look.color } : {}),
          ...(look.icon ? { icon: look.icon } : {}),
        };
      }),
      graph.edges.map((e) => {
        const look = source.look(e.typeIri);
        return {
          id: e.iri,
          source: e.source,
          target: e.target,
          label: e.label ? `${look.label}: ${e.label}` : look.label,
          ...(look.lineStyle ? { lineStyle: look.lineStyle } : {}),
          ...(look.sourceDecor ? { sourceDecor: look.sourceDecor } : {}),
          ...(look.targetDecor ? { targetDecor: look.targetDecor } : {}),
        };
      }),
      this.rootIri,
      this._layout,
    );
    view.highlight(this.selectedIri || undefined);
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('active') && this.active) {
      // Created on first showing: the container has no size while its tab is hidden.
      if (!this._view && this._container) {
        this._view = this.viewFactory(this._container, {
          select: (iri) => this._emit('graph-select', { iri }),
          root: (iri) => this._emit('graph-root', { iri }),
        });
        if (typeof ResizeObserver !== 'undefined') {
          // Cytoscape notices window resizes only; refit when the area changes.
          this._sizeWatcher = new ResizeObserver(() => {
            cancelAnimationFrame(this._resizeFrame);
            this._resizeFrame = requestAnimationFrame(() => {
              if (this.active && this._container && this._container.clientWidth > 0) this._view?.resize();
            });
          });
          this._sizeWatcher.observe(this._container);
        }
      } else {
        this._view?.resize();
      }
    }
    if ((changed.has('active') || changed.has('rootIri') || changed.has('source')) && this.active) this.refresh();
    else if (changed.has('selectedIri')) this._view?.highlight(this.selectedIri || undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer) clearTimeout(this._timer);
    this._sizeWatcher?.disconnect();
    this._sizeWatcher = undefined;
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._resizeFrame);
    this._view?.destroy();
    this._view = undefined;
  }

  private _emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  /** The query form offered: `SELECT` (a table) or `CONSTRUCT` (triples). */
  get queryForm(): GraphQueryForm {
    return this._form;
  }

  setQueryForm(form: GraphQueryForm): void {
    this._form = form;
    remember(FORM_KEY, form);
  }

  private _query(graph: RelationshipGraph): string {
    return this._form === 'select' ? graph.selectQuery : graph.query;
  }

  private _download(kind: 'sparql' | 'turtle'): void {
    const graph = this._graph;
    if (!graph || !this.source) return;
    const base = `${slug(this.source.label(this.rootIri))}-graph`;
    this._emit<GraphDownloadDetail>(
      'graph-download',
      kind === 'sparql'
        ? { text: this._query(graph), fileName: `${base}-${this._form}.rq`, mediaType: 'application/sparql-query' }
        : { text: this.source.turtle(graph.quads), fileName: `${base}.ttl`, mediaType: 'text/turtle' },
    );
  }

  private _openSparql(): void {
    const graph = this._graph;
    if (graph) this._emit<GraphOpenSparqlDetail>('graph-open-sparql', { query: this._query(graph), form: this._form });
  }

  private _newView(): void {
    const graph = this._graph;
    if (!graph || !this.source) return;
    const hops = `${this._depth} hop${this._depth === 1 ? '' : 's'}`;
    this._emit<GraphNewViewDetail>('graph-new-view', {
      iris: [...graph.nodes.map((n) => n.iri), ...graph.edges.map((e) => e.iri)],
      centres: this._view?.positions() ?? new Map(),
      label: `${this.source.label(this.rootIri)} — ${hops}`,
    });
  }

  private _renderTypes(kind: 'element' | 'relationship', title: string, options: GraphTypeOption[], hidden: Set<string>) {
    const shown = options.filter((t) => !hidden.has(t.iri)).length;
    return html`<details open class="filter" data-kind=${kind}>
      <summary>
        ${title} <span class="shown">${shown}/${options.length}</span>
        <span
          class="all"
          @click=${(e: Event) => {
            e.preventDefault();
            this._showAll(kind, shown < options.length);
          }}
          >${shown < options.length ? 'all' : 'none'}</span
        >
      </summary>
      <ul class="types">
        ${options.map(
          (t) => html`<li>
            <label title=${t.iri}>
              <input
                type="checkbox"
                .checked=${!hidden.has(t.iri)}
                @change=${(e: Event) => this.toggleType(kind, t.iri, (e.target as HTMLInputElement).checked)}
              />
              ${t.color ? html`<span class="swatch" style="background:${t.color}"></span>` : nothing}
              <span class="name">${t.label}</span>
              <span class="count">${t.count}</span>
            </label>
          </li>`,
        )}
      </ul>
    </details>`;
  }

  override render() {
    const graph = this._graph;
    const rootLook = this.rootIri ? this.source?.look(this._graph?.nodes.find((n) => n.iri === this.rootIri)?.typeIri) : undefined;
    const message = !this.rootIri
      ? 'Select an element to see its relationships.'
      : this._error
        ? ''
        : graph && graph.edges.length === 0
          ? 'No relationships within this depth and these filters.'
          : '';
    return html`
      <div class="layout">
        <aside class="controls">
          <div class="root" title=${this.rootIri}>
            ${this.rootIri ? this.source?.label(this.rootIri) : 'No element selected'}
            ${rootLook ? html`<span class="type">· ${rootLook.label}</span>` : nothing}
          </div>
          <div class="row">
            <span class="caption">Depth</span>
            <div class="depth" role="group" aria-label="Depth">
              ${Array.from({ length: MAX_GRAPH_DEPTH }, (_, i) => i + 1).map(
                (d) => html`<button
                  data-depth=${d}
                  aria-pressed=${d === this._depth ? 'true' : 'false'}
                  title="${d} hop${d === 1 ? '' : 's'} from the element"
                  @click=${() => this.setDepth(d)}
                >
                  ${d}
                </button>`,
              )}
            </div>
          </div>
          <div class="row">
            <span class="caption">Layout</span>
            <select
              aria-label="Layout"
              @change=${(e: Event) => {
                this._layout = (e.target as HTMLSelectElement).value as GraphLayout;
                remember(LAYOUT_KEY, this._layout);
                this._view?.relayout(this._layout);
              }}
            >
              <option value="rings" ?selected=${this._layout === 'rings'}>Rings</option>
              <option value="tree" ?selected=${this._layout === 'tree'}>Tree</option>
              <option value="force" ?selected=${this._layout === 'force'}>Force</option>
            </select>
            <button class="tool" title="Fit the graph to the panel" @click=${() => this._view?.fit()}>Fit</button>
          </div>
          <div class="stats">
            ${graph ? html`${graph.nodes.length} elements · ${graph.edges.length} relationships` : nothing}
          </div>
          ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
          <div class="row">
            <span class="caption">Query</span>
            <div class="depth form" role="group" aria-label="Query form">
              <button
                data-form="select"
                aria-pressed=${this._form === 'select' ? 'true' : 'false'}
                title="SELECT: a table, one row per relationship"
                @click=${() => this.setQueryForm('select')}
              >
                SELECT
              </button>
              <button
                data-form="construct"
                aria-pressed=${this._form === 'construct' ? 'true' : 'false'}
                title="CONSTRUCT: the graph's triples"
                @click=${() => this.setQueryForm('construct')}
              >
                CONSTRUCT
              </button>
            </div>
          </div>
          <div class="exports">
            <button
              class="tool"
              data-export="open-sparql"
              ?disabled=${!graph}
              title="Run the ${this._form.toUpperCase()} query behind this graph in the SPARQL Query tab"
              @click=${() => this._openSparql()}
            >
              Run in SPARQL tab
            </button>
            <button class="tool" data-export="sparql" ?disabled=${!graph} title="Download the ${this._form.toUpperCase()} query (.rq)" @click=${() => this._download('sparql')}>
              .rq ⬇
            </button>
          </div>
          <div class="row">
            <span class="caption">Graph</span>
            <div class="exports">
              <button
                class="tool"
                data-export="view"
                ?disabled=${!graph || graph.nodes.length === 0}
                title="A new view with these elements and relationships, laid out as drawn"
                @click=${() => this._newView()}
              >
                ＋ New view
              </button>
              <button class="tool" data-export="turtle" ?disabled=${!graph} title="The graph's triples as Turtle (.ttl)" @click=${() => this._download('turtle')}>
                .ttl ⬇
              </button>
            </div>
          </div>
          ${this._renderTypes('element', 'Elements', this._types.elements, this._hiddenElements)}
          ${this._renderTypes('relationship', 'Relationships', this._types.relationships, this._hiddenRelationships)}
        </aside>
        <div class="canvas">
          <div class="cy"></div>
          ${message ? html`<div class="message">${message}</div>` : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'graph-panel': GraphPanel;
  }
}
