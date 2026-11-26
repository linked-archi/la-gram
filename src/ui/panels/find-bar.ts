/**
 * The find bar (Req 23.1; `.agents/tasks/search/`): a field, what matches ("3 of 7"), ↑ and ↓ through the matches, ×
 * to close — and what its host offers besides: *Aa* to match case (the RDF panel), *Select all* and a link to what is
 * elsewhere in the model (the canvas). It searches nothing itself: it says what is typed and pressed, and shows the
 * count its host gives it.
 *
 * Enter goes to the next match, Shift+Enter to the previous; Esc closes it — and goes no further, so that the RDF
 * panel, maximized, is not restored by the same key.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

/** What is searched for: `find-query`. */
export interface FindQueryDetail {
  query: string;
  matchCase: boolean;
}

/** To the next match (1) or the previous (−1): `find-step`. */
export interface FindStepDetail {
  direction: 1 | -1;
}

@customElement('find-bar')
export class FindBar extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 12px;
      background: #fff;
      color: #202124;
    }
    :host([floating]) {
      border: 1px solid #dadce0;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    }
    input {
      flex: 1 1 auto;
      min-width: 80px;
      width: 180px;
      font: inherit;
      padding: 3px 6px;
      border: 1px solid #dadce0;
      border-radius: 4px;
    }
    input:focus {
      outline: 2px solid #1a73e8;
      outline-offset: -1px;
    }
    .count {
      flex: none;
      min-width: 64px;
      color: #5f6368;
      text-align: center;
      white-space: nowrap;
    }
    .count.none {
      color: #c5221f;
    }
    button {
      flex: none;
      font: inherit;
      min-width: 24px;
      height: 24px;
      padding: 0 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: #3c4043;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: #f1f3f4;
      border-color: #dadce0;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button[aria-pressed='true'] {
      background: #e8f0fe;
      border-color: #1a73e8;
      color: #1a73e8;
    }
    button.text {
      border-color: #dadce0;
    }
    a.elsewhere {
      flex: none;
      color: #1a73e8;
      cursor: pointer;
      white-space: nowrap;
      text-decoration: underline;
    }
  `;

  /** The field's name, read out and shown when it is empty. */
  @property() label = 'Find';
  /** What is searched for. */
  @property() query = '';
  /** How many match. */
  @property({ type: Number }) count = 0;
  /** Which is current, from 0; −1 for none. */
  @property({ type: Number }) current = -1;
  /** Said in place of the count: why nothing is searched. */
  @property() status = '';
  /** Whether *Aa* is offered, and whether it is pressed. */
  @property({ type: Boolean }) caseOption = false;
  @property({ type: Boolean }) matchCase = false;
  /** Whether *Select all* is offered. */
  @property({ type: Boolean }) selectAllOption = false;
  /** A link to what matches elsewhere ("4 more in other views"); none when empty. */
  @property() elsewhere = '';
  /** Drawn over something, with a border and a shadow. */
  @property({ type: Boolean, reflect: true }) floating = false;

  @query('input') private _input?: HTMLInputElement;

  /** Focus the field, its text selected. */
  async focusField(): Promise<void> {
    await this.updateComplete;
    this._input?.focus();
    this._input?.select();
  }

  private _emit<T>(name: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T | undefined>(name, { detail, bubbles: true, composed: true }));
  }

  private _search(query: string, matchCase = this.matchCase): void {
    this.query = query;
    this.matchCase = matchCase;
    this._emit<FindQueryDetail>('find-query', { query, matchCase });
  }

  private _step(direction: 1 | -1): void {
    if (this.count > 0) this._emit<FindStepDetail>('find-step', { direction });
  }

  private _onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this._emit('find-close');
    }
  }

  private _countText(): string {
    if (this.status) return this.status;
    if (!this.query.trim()) return '';
    return this.count === 0 ? 'No matches' : `${this.current + 1} of ${this.count}`;
  }

  override render() {
    const none = !this.status && this.query.trim() !== '' && this.count === 0;
    return html`
      <input
        type="search"
        aria-label=${this.label}
        placeholder=${`${this.label}…`}
        .value=${this.query}
        @input=${(e: Event) => this._search((e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => this._onKey(e)}
      />
      ${this.caseOption
        ? html`<button
            type="button"
            data-action="match-case"
            title="Match case"
            aria-label="Match case"
            aria-pressed=${this.matchCase ? 'true' : 'false'}
            @click=${() => this._search(this.query, !this.matchCase)}
          >
            Aa
          </button>`
        : nothing}
      <span class="count ${none ? 'none' : ''}" role="status" aria-live="polite">${this._countText()}</span>
      <button type="button" data-action="previous" title="Previous match (Shift+Enter)" aria-label="Previous match" ?disabled=${this.count === 0} @click=${() => this._step(-1)}>↑</button>
      <button type="button" data-action="next" title="Next match (Enter)" aria-label="Next match" ?disabled=${this.count === 0} @click=${() => this._step(1)}>↓</button>
      ${this.selectAllOption
        ? html`<button type="button" class="text" data-action="select-all" title="Select every match" ?disabled=${this.count === 0} @click=${() => this._emit('find-select-all')}>
            Select all
          </button>`
        : nothing}
      ${this.elsewhere
        ? html`<a class="elsewhere" role="button" tabindex="0" data-action="elsewhere" title="Show them in the model tree"
            @click=${() => this._emit('find-elsewhere')}
            @keydown=${(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && this._emit('find-elsewhere')}>${this.elsewhere}</a>`
        : nothing}
      <button type="button" data-action="close" title="Close (Esc)" aria-label="Close the search" @click=${() => this._emit('find-close')}>×</button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'find-bar': FindBar;
  }
}
