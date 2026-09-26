/**
 * Property picker — the "add a property" field of the property panel.
 *
 * A search field over the properties that apply to the selected concept
 * (`model-manager/property-catalog.ts`), listed in groups: for the concept's
 * type, used in this model, documentation, and — collapsed until asked for or
 * searched — the rest. Each entry shows the property's name first and its
 * prefixed IRI underneath, smaller: the name is what one looks for, the IRI is
 * there for when it matters.
 *
 * Anything can be typed: when the text is not one of the entries, the last row
 * offers it as a new property — a plain name in the model's namespace
 * (`owner` → `m:owner`), a CURIE, or a full IRI.
 *
 * The list floats over the page (`position: fixed`), under the field or — when
 * there is more room there, as in the bottom panel — above it, so no
 * scrolling container clips it.
 *
 * A native `<datalist>` would be less code, but it cannot group, cannot be
 * styled, and shows the IRI more prominently than the name.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { PropertySuggestion, ResolvedProperty } from '../../model-manager/property-catalog.js';

/** Detail of `property-picked`. */
export interface PropertyPickedDetail {
  iri: string;
  label: string;
  curie: string;
}

/** A row of the list: a suggestion, or the typed text as a new property. */
type Row = (PropertySuggestion & { isNew?: false }) | (ResolvedProperty & { isNew: true });

@customElement('property-picker')
export class PropertyPicker extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: relative;
      font-size: 13px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 3px;
      font: inherit;
    }
    input:focus {
      outline: none;
      border-color: #1a73e8;
      box-shadow: 0 0 0 1px #1a73e8;
    }
    .chosen {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #80868b;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .list {
      position: fixed;
      z-index: 1000;
      overflow: auto;
      background: #fff;
      border: 1px solid #dadce0;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }
    .group {
      padding: 6px 10px 2px;
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .group.toggle {
      cursor: pointer;
      color: #1a73e8;
    }
    .option {
      padding: 4px 10px;
      cursor: pointer;
    }
    .option.active {
      background: #e8f0fe;
    }
    .name {
      color: #202124;
      font-size: 13px;
    }
    .curie {
      color: #80868b;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .option.new .name::before {
      content: '＋ New property: ';
      color: #1a73e8;
    }
    .hint {
      padding: 8px 10px;
      color: #80868b;
      font-size: 12px;
    }
  `;

  /** The properties to offer; asked each time the list opens, so it is current. */
  @property({ attribute: false }) suggest?: () => PropertySuggestion[];

  /** What typed text means as a property, or `undefined`. */
  @property({ attribute: false }) resolve?: (text: string) => ResolvedProperty | undefined;

  @property({ type: String }) placeholder = 'Add a property…';

  @state() private _text = '';
  @state() private _open = false;
  @state() private _active = 0;
  @state() private _showMore = false;
  @state() private _picked: PropertyPickedDetail | undefined;
  /** Where the list floats: its inline style, from the field's position. */
  @state() private _listStyle = '';

  @query('input') private _input?: HTMLInputElement;

  /** The suggestions of the current opening. */
  private _options: PropertySuggestion[] = [];

  /** The chosen property: the one picked from the list, else what the typed text resolves to. */
  get value(): PropertyPickedDetail | undefined {
    if (this._picked) return this._picked;
    const resolved = this.resolve?.(this._text);
    return resolved ? { iri: resolved.iri, label: resolved.label, curie: resolved.curie } : undefined;
  }

  /** Empty the field. */
  clear(): void {
    this._text = '';
    this._picked = undefined;
    this._open = false;
  }

  override focus(): void {
    this._input?.focus();
  }

  private _query(): string {
    // After a pick the field shows the picked name: reopening lists everything.
    return this._picked && this._text === this._picked.label ? '' : this._text.trim().toLowerCase();
  }

  /** The rows shown, and which of them can be chosen, in order. */
  private _rows(): { rows: Row[]; moreCount: number } {
    const q = this._query();
    const matches = (s: PropertySuggestion) =>
      !q || s.label.toLowerCase().includes(q) || s.curie.toLowerCase().includes(q) || s.iri.toLowerCase().includes(q);
    const found = this._options.filter(matches);
    // "More" stays folded until asked for — or searched, when everything is fair game.
    const showMore = this._showMore || q !== '';
    const rows: Row[] = found.filter((s) => s.group !== 'more' || showMore);
    const moreCount = showMore ? 0 : found.filter((s) => s.group === 'more').length;
    if (q) {
      const resolved = this.resolve?.(this._text);
      if (resolved && !this._options.some((s) => s.iri === resolved.iri)) rows.push({ ...resolved, isNew: true });
    }
    return { rows, moreCount };
  }

  private _openList(): void {
    this._options = this.suggest?.() ?? [];
    this._open = true;
    this._active = 0;
    this._place();
  }

  /** Put the list under the field, or above it when there is more room there. */
  private _place = (): void => {
    const input = this._input;
    if (!input || typeof input.getBoundingClientRect !== 'function') return;
    const r = input.getBoundingClientRect();
    const viewport = globalThis.innerHeight ?? 800;
    const below = viewport - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 240 && above > below;
    const maxHeight = Math.max(120, Math.min(360, up ? above : below));
    this._listStyle =
      `left:${r.left}px;width:${r.width}px;max-height:${maxHeight}px;` +
      (up ? `bottom:${viewport - r.top + 2}px;` : `top:${r.bottom + 2}px;`);
  };

  override updated(changed: Map<string, unknown>): void {
    // While open, follow the field when anything scrolls or the window resizes.
    if (!changed.has('_open')) return;
    if (this._open) {
      globalThis.addEventListener?.('scroll', this._place, true);
      globalThis.addEventListener?.('resize', this._place);
    } else {
      this._unfollow();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unfollow();
  }

  private _unfollow(): void {
    globalThis.removeEventListener?.('scroll', this._place, true);
    globalThis.removeEventListener?.('resize', this._place);
  }

  private _pick(row: Row): void {
    this._picked = { iri: row.iri, label: row.label, curie: row.curie };
    this._text = row.label;
    this._open = false;
    this.dispatchEvent(
      new CustomEvent<PropertyPickedDetail>('property-picked', { detail: this._picked, bubbles: true, composed: true }),
    );
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this._open) e.stopPropagation();
      this._open = false;
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this._open) this._openList();
      const count = this._rows().rows.length;
      if (count === 0) return;
      this._active = (this._active + (e.key === 'ArrowDown' ? 1 : count - 1)) % count;
      this.updateComplete.then(() =>
        this.renderRoot.querySelector('.option.active')?.scrollIntoView?.({ block: 'nearest' }),
      );
      return;
    }
    if (e.key === 'Enter' && this._open) {
      const row = this._rows().rows[this._active];
      if (row) {
        e.preventDefault();
        this._pick(row);
      }
    }
  }

  override render() {
    const { rows, moreCount } = this._open ? this._rows() : { rows: [], moreCount: 0 };
    const chosen = this.value;
    let lastGroup: string | undefined;
    return html`
      <input
        type="text"
        aria-label="Property to add"
        role="combobox"
        aria-expanded=${this._open ? 'true' : 'false'}
        autocomplete="off"
        placeholder=${this.placeholder}
        .value=${this._text}
        @focus=${() => this._openList()}
        @click=${() => !this._open && this._openList()}
        @blur=${() => (this._open = false)}
        @input=${(e: Event) => {
          this._text = (e.target as HTMLInputElement).value;
          this._picked = undefined;
          if (!this._open) this._openList();
          this._active = 0;
        }}
        @keydown=${(e: KeyboardEvent) => this._onKeyDown(e)}
      />
      ${chosen && !this._open ? html`<div class="chosen" title=${chosen.iri}>${chosen.curie}</div>` : nothing}
      ${this._open
        ? html`<div class="list" role="listbox" style=${this._listStyle} @mousedown=${(e: Event) => e.preventDefault()}>
            ${rows.map((row, i) => {
              const group = row.isNew ? 'new' : row.groupLabel;
              const heading = group !== lastGroup && !row.isNew ? html`<div class="group">${row.groupLabel}</div>` : nothing;
              lastGroup = group;
              return html`${heading}
                <div
                  class="option ${i === this._active ? 'active' : ''} ${row.isNew ? 'new' : ''}"
                  role="option"
                  data-iri=${row.iri}
                  title=${row.isNew ? row.iri : [row.iri, row.description].filter(Boolean).join('\n\n')}
                  @mouseenter=${() => (this._active = i)}
                  @click=${() => this._pick(row)}
                >
                  <div class="name">${row.label}</div>
                  <div class="curie">${row.curie}</div>
                </div>`;
            })}
            ${moreCount > 0
              ? html`<div class="group toggle" @click=${() => (this._showMore = true)}>More (${moreCount}) ▸</div>`
              : nothing}
            ${rows.length === 0 && moreCount === 0
              ? html`<div class="hint">Type a name (a new property in this model), a prefixed name such as dcterms:source, or an IRI.</div>`
              : nothing}
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'property-picker': PropertyPicker;
  }
}
