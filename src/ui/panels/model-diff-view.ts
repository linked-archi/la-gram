/**
 * Two versions of the model, compared by element (`model-diff.ts`): a row per
 * concept added, removed or changed — its name, type and, for a relationship,
 * its ends — and under it what changed: values old → new, values added and
 * removed, a view's shapes placed, moved, rerouted — and who made the change and
 * when, where the later version records it. A click on a concept's name asks the
 * host to show it (`diff-select`).
 *
 * The words are `model-diff-text.ts`'s, as a merge request's description has
 * them.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ModelDiff } from '../../model-manager/model-diff.js';
import { conceptName, countsText, detailLines, editText, endsText, shownType, type DiffWords } from '../../model-manager/model-diff-text.js';

/** Concepts shown at most; the rest are counted. */
export const MAX_DIFF_CONCEPTS = 300;

const PLAIN_WORDS: DiffWords = {
  typeName: (iri) => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1),
  propertyName: (iri) => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1),
};

@customElement('model-diff-view')
export class ModelDiffView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-size: 13px;
    }
    .summary {
      color: #5f6368;
      margin-bottom: 6px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li.change {
      padding: 4px 0;
      border-bottom: 1px solid #f1f3f4;
    }
    .head {
      display: flex;
      gap: 6px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .sign {
      width: 1em;
      flex: none;
      text-align: center;
      font-weight: 600;
    }
    .added > .head .sign,
    li.added {
      color: #2e7d32;
    }
    .removed > .head .sign,
    li.removed {
      color: #c62828;
    }
    .changed > .head .sign {
      color: #b06000;
    }
    button.name {
      all: unset;
      cursor: pointer;
      font-weight: 500;
      color: #202124;
    }
    button.name:hover,
    button.name:focus-visible {
      text-decoration: underline;
    }
    .removed > .head button.name {
      text-decoration: line-through;
      cursor: default;
    }
    .type,
    .ends,
    .edit {
      color: #5f6368;
    }
    .edit {
      margin-left: auto;
      font-size: 12px;
    }
    ul.details {
      margin-left: 1.6em;
    }
    ul.details li {
      padding: 1px 0;
      color: #3c4043;
    }
    ul.details li.added::before {
      content: '+ ';
    }
    ul.details li.removed::before {
      content: '− ';
    }
    .more {
      color: #5f6368;
      padding-top: 6px;
    }
  `;

  @property({ attribute: false })
  diff?: ModelDiff;

  /** Names of types and properties, from the metamodels; their IRIs' last parts without. */
  @property({ attribute: false })
  words?: DiffWords;

  override render() {
    const diff = this.diff;
    if (!diff) return nothing;
    if (diff.changes.length === 0) return html`<div class="summary">No changes to the model.</div>`;
    const words = this.words ?? PLAIN_WORDS;
    const shown = diff.changes.slice(0, MAX_DIFF_CONCEPTS);
    const more = diff.changes.length - shown.length;
    return html`
      <div class="summary">${countsText(diff)}</div>
      <ul class="changes">
        ${shown.map((change) => {
          const type = shownType(diff, change.subject);
          const named = Boolean(diff.about[change.subject]?.name);
          const ends = endsText(diff, change, words);
          const details = detailLines(diff, change, words);
          const edit = editText(change, (iso) => new Date(iso).toLocaleString());
          const recorded = change.edit;
          return html`<li class="change ${change.status}" data-subject=${change.subject} data-kind=${change.kind}>
            <div class="head">
              <span class="sign" aria-label=${change.status}>${change.status === 'added' ? '+' : change.status === 'removed' ? '−' : '~'}</span>
              <button class="name" ?disabled=${change.status === 'removed'} @click=${() => this._select(change.subject)}>
                ${conceptName(diff, change.subject, words)}
              </button>
              ${type && named ? html`<span class="type">${words.typeName(type)}</span>` : nothing}
              ${ends ? html`<span class="ends">${ends}</span>` : nothing}
              ${edit
                ? html`<span class="edit" data-edit title=${[recorded?.account, recorded?.tool && `with ${recorded.tool}`].filter(Boolean).join(' · ')}>${edit}</span>`
                : nothing}
            </div>
            ${details.length > 0
              ? html`<ul class="details">
                  ${details.map((d) => html`<li class=${d.kind}>${d.text}</li>`)}
                </ul>`
              : nothing}
          </li>`;
        })}
      </ul>
      ${more > 0 ? html`<div class="more">… and ${more} more.</div>` : nothing}
    `;
  }

  private _select(iri: string): void {
    this.dispatchEvent(new CustomEvent<{ iri: string }>('diff-select', { detail: { iri }, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'model-diff-view': ModelDiffView;
  }
}
