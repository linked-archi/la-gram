/**
 * Type guide — the left panel's section under the model tree: what the loaded
 * metamodels say about the selected concept's type (for a view, its
 * viewpoint), read by `metamodel-manager/type-guide.ts`.
 *
 * From the ontology: definition, other names, guidance, a relationship's
 * typical ends or a viewpoint's concepts and stakeholders, the classes it
 * specializes, changes, the specification section. From the taxonomy: where it
 * is classified, the group's notes and its other types.
 *
 * The section's header folds it; the shell sizes it (`app-shell`: the guide's
 * top edge is dragged, its height and folding remembered). Inside, each part
 * folds too, remembered per browser. Any type the guide names opens its own
 * page in place, with a way back; a new selection shows its own type again.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GuideRef, TypeGuide } from '../../metamodel-manager/type-guide.js';

/** The guide's collapsible parts, and which are open until the user says otherwise. */
export type GuideSection = 'guidance' | 'facts' | 'classification' | 'ontology' | 'changes';

const OPEN_BY_DEFAULT: Record<GuideSection, boolean> = {
  guidance: true,
  facts: true,
  classification: true,
  ontology: false,
  changes: false,
};

const SECTIONS_KEY = 'la-gram:about-sections';

function storedOpen(): Partial<Record<GuideSection, boolean>> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(SECTIONS_KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** A short name for a source link: its host and the section it points at. */
export function sourceName(href: string): string {
  try {
    const url = new URL(href);
    const section = decodeURIComponent(url.hash.replace(/^#(sec-)?/, '')).replace(/-/g, ' ');
    const page = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
    return [url.hostname, section || page].filter(Boolean).join(' · ');
  } catch {
    return href;
  }
}

@customElement('type-guide-panel')
export class TypeGuidePanel extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      background: #fff;
      border-top: 1px solid #dadce0;
      box-sizing: border-box;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 8px 12px;
      border: 0;
      border-bottom: 1px solid #e0e0e0;
      background: #f8f9fa;
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      color: #202124;
    }
    :host([folded]) .header {
      border-bottom: 0;
    }
    .header:hover {
      background: #f1f3f4;
    }
    .chevron {
      color: #3c4043;
      width: 12px;
      font-size: 12px;
      text-align: center;
    }
    .title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 6px 12px 12px;
      line-height: 1.45;
    }
    .body[hidden] {
      display: none;
    }
    a {
      color: #1a73e8;
      text-decoration: none;
      cursor: pointer;
    }
    a:hover {
      text-decoration: underline;
    }
    .back {
      font-size: 12px;
      margin-bottom: 4px;
    }
    .type {
      display: flex;
      align-items: baseline;
      gap: 6px;
      flex-wrap: wrap;
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .abstract {
      font-size: 11px;
      font-weight: 500;
      color: #b06000;
      background: #fef7e0;
      border-radius: 3px;
      padding: 0 5px;
    }
    .aka {
      color: #5f6368;
      font-size: 12px;
    }
    .definition {
      margin: 6px 0 8px;
    }
    details {
      border-top: 1px solid #eee;
      padding: 3px 0;
    }
    summary {
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 3px 0;
    }
    summary .count {
      text-transform: none;
      font-weight: 400;
      color: #80868b;
      margin-left: 4px;
    }
    p {
      margin: 4px 0 6px;
    }
    .facts,
    .refs {
      margin: 2px 0 6px;
      padding: 0;
      list-style: none;
    }
    .facts li,
    .refs li {
      padding: 2px 0;
    }
    .fact-label {
      display: block;
      color: #5f6368;
      font-size: 12px;
    }
    .note {
      color: #5f6368;
      font-size: 12px;
    }
    .axis {
      margin: 4px 0 8px;
    }
    .axis-name {
      color: #5f6368;
      font-size: 12px;
    }
    .path {
      font-weight: 500;
    }
    .members {
      font-size: 12px;
      color: #5f6368;
      margin-top: 2px;
    }
    .sources {
      border-top: 1px solid #eee;
      padding-top: 6px;
      font-size: 12px;
      color: #5f6368;
      overflow-wrap: anywhere;
    }
    .muted {
      color: #80868b;
      font-style: italic;
    }
  `;

  /** What the loaded metamodels say about a type; supplied by the host. */
  @property({ attribute: false })
  guideSource?: (iri: string) => TypeGuide | undefined;

  /** The type to describe: the selection's — for a view, its viewpoint. Empty for nothing. */
  @property({ type: String })
  guideIri = '';

  /** Folded to its header; the shell owns the choice (`guide-fold-toggle` asks for it). */
  @property({ type: Boolean, reflect: true })
  folded = false;

  /** Types opened from the guide's own links, the one shown last; empty for {@link guideIri}. */
  @state() private _trail: string[] = [];

  /** Which parts are open, where the user chose. */
  @state() private _open: Partial<Record<GuideSection, boolean>> = storedOpen();

  override willUpdate(changed: Map<string, unknown>): void {
    // Another type selected: its own page again. The host re-sends the same one after any change.
    if (changed.has('guideIri') && changed.get('guideIri') !== this.guideIri) this._trail = [];
  }

  /** The type shown: one opened from the guide's links, else {@link guideIri}. */
  get shownIri(): string {
    return this._trail.at(-1) ?? this.guideIri;
  }

  /** Open another type's page, with a way back. */
  openGuide(iri: string): void {
    this._trail = [...this._trail, iri];
  }

  private _guide(iri = this.shownIri): TypeGuide | undefined {
    return iri ? this.guideSource?.(iri) : undefined;
  }

  private _setOpen(id: GuideSection, open: boolean): void {
    if ((this._open[id] ?? OPEN_BY_DEFAULT[id]) === open) return;
    this._open = { ...this._open, [id]: open };
    try {
      globalThis.localStorage?.setItem(SECTIONS_KEY, JSON.stringify(this._open));
    } catch {
      /* not remembered: fine */
    }
  }

  private _section(id: GuideSection, title: string, body: unknown, count?: number) {
    const open = this._open[id] ?? OPEN_BY_DEFAULT[id];
    return html`<details
      data-section=${id}
      .open=${open}
      @toggle=${(e: Event) => this._setOpen(id, (e.target as HTMLDetailsElement).open)}
    >
      <summary>${title}${count !== undefined ? html`<span class="count">${count}</span>` : nothing}</summary>
      ${body}
    </details>`;
  }

  /** A type or concept the guide names: a link to its own page. */
  private _ref(ref: GuideRef) {
    return html`<a
      data-iri=${ref.iri}
      title=${ref.definition ? `${ref.definition}\n${ref.iri}` : ref.iri}
      @click=${(e: Event) => {
        e.preventDefault();
        this.openGuide(ref.iri);
      }}
      >${ref.label}</a
    >`;
  }

  private _refs(refs: readonly GuideRef[]) {
    return refs.map((r, i) => html`${i > 0 ? ', ' : ''}${this._ref(r)}`);
  }

  private _toggleFold(): void {
    this.dispatchEvent(new CustomEvent('guide-fold-toggle', { bubbles: true, composed: true }));
  }

  private _renderGuide(g: TypeGuide) {
    const back = this._trail.length > 0;
    const previous = this._guide(this._trail.length > 1 ? this._trail.at(-2)! : this.guideIri)?.label ?? 'back';
    return html`
      ${back
        ? html`<div class="back">
            <a
              @click=${(e: Event) => {
                e.preventDefault();
                this._trail = this._trail.slice(0, -1);
              }}
              >← ${previous}</a
            >
          </div>`
        : nothing}
      <h3 class="type" title=${g.iri}>
        <span>${g.label}</span>
        ${g.abstract ? html`<span class="abstract" title="Not instantiated itself; its specializations are">abstract</span>` : nothing}
      </h3>
      ${g.altLabels.length > 0 ? html`<div class="aka">Also: ${g.altLabels.join(', ')}</div>` : nothing}
      ${g.definition ? html`<p class="definition">${g.definition}</p>` : html`<p class="muted">No definition.</p>`}
      ${g.notes.length > 0 ? this._section('guidance', 'Guidance', g.notes.map((n) => html`<p>${n}</p>`)) : nothing}
      ${g.facts.length > 0
        ? this._section(
            'facts',
            'In models',
            html`<ul class="facts">
              ${g.facts.map((f) => html`<li><span class="fact-label">${f.label}</span>${this._refs(f.values)}</li>`)}
            </ul>`,
          )
        : nothing}
      ${g.classifications.length > 0
        ? this._section(
            'classification',
            'Classification',
            g.classifications.map(
              (c) => html`<div class="axis">
                <div class="axis-name">${this._ref(c.axis)}</div>
                ${c.path.length > 0
                  ? html`<div class="path">${c.path.map((p, i) => html`${i > 0 ? ' › ' : ''}${this._ref(p)}`)}</div>`
                  : nothing}
                ${c.group.definition && c.group.iri !== c.axis.iri ? html`<div class="note">${c.group.definition}</div>` : nothing}
                ${c.group.notes.map((n) => html`<p class="note">${n}</p>`)}
                ${c.group.changes.map((n) => html`<p class="note"><em>Change:</em> ${n}</p>`)}
                ${c.members.length > 0 ? html`<div class="members">Also in ${c.group.label}: ${this._refs(c.members)}</div>` : nothing}
              </div>`,
            ),
          )
        : nothing}
      ${g.superclasses.length > 0
        ? this._section(
            'ontology',
            'Specializes',
            html`<ul class="refs">
              ${g.superclasses.map(
                (c) => html`<li>${this._ref(c)}${c.definition ? html`<div class="note">${c.definition}</div>` : nothing}</li>`,
              )}
            </ul>`,
            g.superclasses.length,
          )
        : nothing}
      ${g.changes.length > 0 ? this._section('changes', 'Changes', g.changes.map((c) => html`<p>${c}</p>`)) : nothing}
      ${g.sources.length > 0
        ? html`<div class="sources">
            Source:
            ${g.sources.map(
              (href, i) => html`${i > 0 ? ' · ' : ''}<a href=${href} target="_blank" rel="noopener noreferrer" title=${href}
                  >${sourceName(href)}</a
                >`,
            )}
          </div>`
        : nothing}
    `;
  }

  override render() {
    const g = this._guide();
    const title = g ? `About ${g.label}` : 'About';
    return html`
      <button
        class="header"
        aria-expanded=${this.folded ? 'false' : 'true'}
        title=${this.folded ? 'Show what the metamodel says about the selected type' : 'Fold'}
        @click=${() => this._toggleFold()}
      >
        <span class="chevron">${this.folded ? '▸' : '▾'}</span>
        <span class="title">${title}</span>
      </button>
      <div class="body" ?hidden=${this.folded}>
        ${g
          ? this._renderGuide(g)
          : html`<div class="muted">
              ${this.guideIri
                ? 'The loaded metamodels say nothing about this type.'
                : 'Select an element, a relationship or a view to see what the metamodel says about its type.'}
            </div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'type-guide-panel': TypeGuidePanel;
  }
}
