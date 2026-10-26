/**
 * Named picker — a search field over named things, for the property panel:
 * properties (`property-picker.ts`), an element's type, the value of a link.
 *
 * The list is in groups. Each entry shows its name first and under it, smaller,
 * what it is (`Business Actor`) and its IRI: the name is what one looks for,
 * the IRI is there for when it matters. Where IRIs are shown on demand
 * (`iris="toggle"`), a "Show IRIs" switch heads the list, remembered per
 * browser; entries that share a name show theirs anyway, so they can be told
 * apart (ArchiMate 3's Business Actor and ArchiMate 4's).
 *
 * Typed text can be offered as an entry of its own (`typed`), listed last after
 * what it is (`＋ New property: `, `Link to: `). An entry marked `more` is
 * folded under "More" until asked for or searched. A long list shows its first
 * `limit` entries, and says how many more typing narrows down to.
 *
 * With a `selected` entry the field is a choice of one: it shows that entry's
 * name, and goes back to it when left without a pick.
 *
 * The list floats over the page (`position: fixed`), under the field or — when
 * there is more room there, as in the bottom panel — above it, so no
 * scrolling container clips it.
 *
 * A native `<select>` or `<datalist>` would be less code, but cannot search
 * (select), group (datalist), be styled, or show an IRI under a name.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

/** An entry of the list. */
export interface NamedOption {
  /** The IRI the entry stands for — or, for plain text, the text. */
  iri: string;
  /** What one reads and searches for. */
  label: string;
  /** What it is, in words, under the name (`Business Actor`). */
  detail?: string;
  /** The IRI as shown: prefixed (`dcterms:source`) or whole; the IRI itself when absent. */
  iriText?: string;
  /** The heading it is listed under. */
  groupLabel?: string;
  /** Folded under "More" until asked for or searched. */
  more?: boolean;
  /** Shown on hovering, after the IRI. */
  description?: string;
  /** Plain text, as typed: no IRI. */
  text?: boolean;
}

/** Typed text as an entry: listed last, after what it is (`prefix`). */
export interface TypedOption extends NamedOption {
  prefix: string;
}

/** localStorage key of the "Show IRIs" switch, shared by every picker with one. */
const SHOW_IRIS_KEY = 'la-gram:picker-show-iris';

function storedShowIris(): boolean {
  try {
    return globalThis.localStorage?.getItem(SHOW_IRIS_KEY) === 'true';
  } catch {
    return false;
  }
}

@customElement('named-picker')
export class NamedPicker extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: relative;
      font-size: 13px;
    }
    input[type='text'] {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 3px;
      font: inherit;
    }
    input[type='text']:focus {
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
    .iri-switch {
      position: sticky;
      top: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: #f8f9fa;
      border-bottom: 1px solid #e8eaed;
      font-size: 11px;
      color: #5f6368;
      cursor: pointer;
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
    .detail {
      color: #5f6368;
      font-size: 11px;
    }
    .iri {
      color: #80868b;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .option.new .name::before {
      content: attr(data-prefix);
      color: #1a73e8;
    }
    .hint {
      padding: 8px 10px;
      color: #80868b;
      font-size: 12px;
    }
  `;

  /** The entries; asked each time the list opens, so they are current. */
  @property({ attribute: false }) options?: () => NamedOption[];

  /** What typed text is as an entry, or `undefined` when it is none. */
  @property({ attribute: false }) typed?: (text: string) => TypedOption | undefined;

  @property({ type: String }) placeholder = '';

  /** The field's accessible name. */
  @property({ type: String }) label = 'Search';

  /** Shown when nothing matches. */
  @property({ type: String }) hint = '';

  /** `shown`: every entry's IRI under its name; `toggle`: behind the list's "Show IRIs" switch. */
  @property({ type: String }) iris: 'shown' | 'toggle' = 'shown';

  /** Under the field, once something is chosen: its IRI as shown. */
  @property({ type: Boolean }) showChosen = false;

  /** The most entries listed at once; typing narrows the rest down. */
  @property({ type: Number }) limit = Number.POSITIVE_INFINITY;

  /** The entry the field is a choice of: shown, and gone back to when the field is left without a pick. */
  @property({ attribute: false }) selected?: NamedOption;

  @state() private _text = '';
  @state() private _open = false;
  @state() private _active = 0;
  @state() private _showMore = false;
  @state() private _showIris = storedShowIris();
  @state() private _picked: NamedOption | undefined;
  /** Where the list floats: its inline style, from the field's position. */
  @state() private _listStyle = '';

  @query('input[type="text"]') private _input?: HTMLInputElement;

  /** The entries of the current opening. */
  private _options: NamedOption[] = [];

  /** Names more than one entry has: those entries show their IRIs. */
  private _shared = new Set<string>();

  /** The chosen entry: the one picked from the list, else what the typed text is. */
  get choice(): NamedOption | undefined {
    if (this._picked) return this._picked;
    return this.typed?.(this._text);
  }

  /** Empty the field. */
  clear(): void {
    this._text = '';
    this._picked = undefined;
    this._open = false;
  }

  /** Show the `selected` entry again (a choice the host did not make after all). */
  revert(): void {
    this._picked = this.selected;
    this._text = this.selected?.label ?? '';
  }

  override focus(): void {
    this._input?.focus();
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('selected') && !this._open) this.revert();
  }

  /** Reports a pick; a subclass reports it its own way. */
  protected announce(option: NamedOption): void {
    this.dispatchEvent(new CustomEvent<NamedOption>('named-picked', { detail: option, bubbles: true, composed: true }));
  }

  private _query(): string {
    // After a pick the field shows the picked name: reopening lists everything.
    return this._picked && this._text === this._picked.label ? '' : this._text.trim().toLowerCase();
  }

  /** The rows shown, in order; how many "More" folds and how many the limit leaves out. */
  private _rows(): { rows: Array<NamedOption | TypedOption>; moreCount: number; beyond: number } {
    const q = this._query();
    const matches = (o: NamedOption) => !q || [o.label, o.detail, o.iriText, o.iri].some((s) => s?.toLowerCase().includes(q));
    const found = this._options.filter(matches);
    // "More" stays folded until asked for — or searched, when everything is fair game.
    const showMore = this._showMore || q !== '';
    const listed = found.filter((o) => !o.more || showMore);
    const rows: Array<NamedOption | TypedOption> = listed.slice(0, this.limit);
    const moreCount = showMore ? 0 : found.filter((o) => o.more).length;
    if (q) {
      const typed = this.typed?.(this._text);
      if (typed && !this._options.some((o) => o.iri === typed.iri)) rows.push(typed);
    }
    return { rows, moreCount, beyond: listed.length - Math.min(listed.length, this.limit) };
  }

  private _openList(): void {
    this._options = this.options?.() ?? [];
    const seen = new Set<string>();
    this._shared = new Set();
    for (const o of this._options) {
      const name = o.label.toLowerCase();
      if (seen.has(name)) this._shared.add(name);
      seen.add(name);
    }
    this._open = true;
    this._active = 0;
    this._place();
  }

  /** Put the list under the field, or above it when there is more room there; at least wide enough to read an IRI. */
  private _place = (): void => {
    const input = this._input;
    if (!input || typeof input.getBoundingClientRect !== 'function') return;
    const r = input.getBoundingClientRect();
    const viewport = globalThis.innerHeight ?? 800;
    const viewportWidth = globalThis.innerWidth ?? 1200;
    const below = viewport - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 240 && above > below;
    const maxHeight = Math.max(120, Math.min(360, up ? above : below));
    const width = Math.max(r.width, 320);
    const left = Math.max(8, Math.min(r.left, viewportWidth - width - 8));
    this._listStyle =
      `left:${left}px;width:${width}px;max-height:${maxHeight}px;` +
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

  private _pick(row: NamedOption | TypedOption): void {
    const { prefix: _prefix, ...option } = row as TypedOption;
    this._picked = option;
    this._text = option.label;
    this._open = false;
    this.announce(option);
  }

  private _setShowIris(shown: boolean): void {
    this._showIris = shown;
    try {
      globalThis.localStorage?.setItem(SHOW_IRIS_KEY, String(shown));
    } catch {
      /* not remembered: fine */
    }
  }

  private _onBlur(): void {
    this._open = false;
    // A choice left without a pick shows what it is again.
    if (this.selected && !(this._picked && this._text === this._picked.label)) this.revert();
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
    if (e.key === 'Enter') {
      const row = this._open ? this._rows().rows[this._active] : undefined;
      if (row) {
        e.preventDefault();
        this._pick(row);
      } else if (!this._open) {
        // Enter on a closed list: done — the host may act on what is chosen.
        this.dispatchEvent(new CustomEvent('named-submit', { bubbles: true, composed: true }));
      }
    }
  }

  private _renderRow(row: NamedOption | TypedOption, i: number) {
    const prefix = (row as TypedOption).prefix;
    const showIri =
      !row.text && (this.iris === 'shown' || this._showIris || this._shared.has(row.label.toLowerCase()));
    return html`<div
      class="option ${i === this._active ? 'active' : ''} ${prefix ? 'new' : ''}"
      role="option"
      data-iri=${row.iri}
      title=${row.text ? '' : prefix ? row.iri : [row.iri, row.description].filter(Boolean).join('\n\n')}
      @mouseenter=${() => (this._active = i)}
      @click=${() => this._pick(row)}
    >
      <div class="name" data-prefix=${prefix ?? ''}>${row.label}</div>
      ${row.detail ? html`<div class="detail">${row.detail}</div>` : nothing}
      ${showIri ? html`<div class="iri">${row.iriText ?? row.iri}</div>` : nothing}
    </div>`;
  }

  override render() {
    const { rows, moreCount, beyond } = this._open ? this._rows() : { rows: [], moreCount: 0, beyond: 0 };
    const chosen = this.showChosen ? this.choice : undefined;
    let lastGroup: string | undefined;
    return html`
      <input
        type="text"
        aria-label=${this.label}
        role="combobox"
        aria-expanded=${this._open ? 'true' : 'false'}
        autocomplete="off"
        placeholder=${this.placeholder}
        .value=${this._text}
        @focus=${() => this._openList()}
        @click=${() => !this._open && this._openList()}
        @blur=${() => this._onBlur()}
        @input=${(e: Event) => {
          this._text = (e.target as HTMLInputElement).value;
          this._picked = undefined;
          if (!this._open) this._openList();
          this._active = 0;
        }}
        @keydown=${(e: KeyboardEvent) => this._onKeyDown(e)}
      />
      ${chosen && !this._open ? html`<div class="chosen" title=${chosen.iri}>${chosen.iriText ?? chosen.iri}</div>` : nothing}
      ${this._open
        ? html`<div class="list" role="listbox" style=${this._listStyle} @mousedown=${(e: Event) => e.preventDefault()}>
            ${this.iris === 'toggle'
              ? html`<label class="iri-switch"
                  ><input
                    type="checkbox"
                    .checked=${this._showIris}
                    @change=${(e: Event) => this._setShowIris((e.target as HTMLInputElement).checked)}
                  />Show IRIs</label
                >`
              : nothing}
            ${rows.map((row, i) => {
              const typed = Boolean((row as TypedOption).prefix);
              const group = typed ? undefined : row.groupLabel;
              const heading = group && group !== lastGroup ? html`<div class="group">${group}</div>` : nothing;
              lastGroup = typed ? lastGroup : group;
              return html`${heading}${this._renderRow(row, i)}`;
            })}
            ${moreCount > 0
              ? html`<div class="group toggle" @click=${() => (this._showMore = true)}>More (${moreCount}) ▸</div>`
              : nothing}
            ${beyond > 0 ? html`<div class="hint">${beyond} more — type to narrow down.</div>` : nothing}
            ${rows.length === 0 && moreCount === 0 && this.hint ? html`<div class="hint">${this.hint}</div>` : nothing}
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'named-picker': NamedPicker;
  }
}
