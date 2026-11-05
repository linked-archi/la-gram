/**
 * The Conflicts tab: what a merge with another version left to choose
 * (`git-merge.ts`). One row per conflict, as the Validation tab has one per
 * finding: what it is about — named as the model tree names it, a click shows
 * it — then each side's version and a button for each.
 *
 * | Kind | Choices |
 * |---|---|
 * | a value, a relationship's ends, a type | *Keep mine* · *Take theirs* |
 * | a node's bounds, a line's route | *Keep mine* · *Take theirs* |
 * | placed twice on a diagram | *Keep mine* · *Take theirs* |
 * | a count limit broken | *Keep mine* · *Take theirs* (each side's values) |
 * | deleted on one side, changed on the other | *Keep it* · *Delete it* |
 *
 * "Mine" is the model here; "theirs" the version merged with — the branch's
 * newer one, or the branch updated from. Until a choice is made the model holds
 * the version before either change (a deleted concept: kept). A choice can be
 * changed; the host applies it (`conflict-pick`) as one undoable step.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Quad } from '@rdfjs/types';
import { quadsOfSnapshot, type MergeConflict, type MergeSide } from '../model-manager/model-merge.js';
import type { FocusDescription } from '../ui/panels/validation-panel.js';

/** A conflict, and which side was chosen. */
export interface ConflictEntry {
  conflict: MergeConflict;
  picked?: MergeSide;
}

/** Detail of `conflict-pick`: the conflict, by its place in the list, and the side chosen. */
export interface ConflictPickDetail {
  index: number;
  side: MergeSide;
}

const VIS = 'https://meta.linked.archi/core-vis#';
const ARCH = 'https://meta.linked.archi/core#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

@customElement('git-conflicts')
export class ConflictsPanel extends LitElement {
  /** The conflicts, in the merge's order. */
  @property({ attribute: false }) entries: ConflictEntry[] = [];
  /** What the model was merged with. */
  @property({ attribute: false }) against?: { branch: string; commit: string };
  /** A concept as the model tree names it. */
  describe: (iri: string) => FocusDescription = (iri) => ({ name: iri });
  /** A property as the Properties tab names it. */
  propertyName: (predicate: string) => string = (predicate) => predicate;

  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
    }
    .panel-header {
      padding: 8px 12px;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
    }
    .panel-header .against {
      font-weight: normal;
      color: #5f6368;
    }
    .summary {
      padding: 8px 12px;
      font-weight: 500;
      color: #e65100;
    }
    .summary.done {
      color: #2e7d32;
    }
    .conflict {
      padding: 6px 12px 8px 10px;
      border-left: 3px solid #e65100;
      border-bottom: 1px solid #eceff1;
      line-height: 1.35;
    }
    .conflict.chosen {
      border-left-color: #2e7d32;
    }
    .what {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 6px;
      cursor: pointer;
    }
    .what:hover .name {
      text-decoration: underline;
    }
    .name {
      font-weight: 600;
      color: #202124;
      overflow-wrap: anywhere;
    }
    .name.unnamed {
      font-style: italic;
      font-weight: 500;
      color: #5f6368;
    }
    .type,
    .aspect {
      font-size: 11px;
      color: #5f6368;
    }
    .sides {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 3px 8px;
      align-items: baseline;
      margin-top: 4px;
    }
    .who {
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
    }
    .value {
      color: #3c4043;
      overflow-wrap: anywhere;
    }
    button {
      font: inherit;
      font-size: 12px;
      padding: 1px 8px;
      border: 1px solid #c4c7c5;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: #f1f3f4;
    }
    button[aria-pressed='true'] {
      border-color: #2e7d32;
      background: #e8f5e9;
      color: #1b5e20;
      font-weight: 600;
    }
    button:focus-visible,
    .what:focus-visible {
      outline: 2px solid #1a73e8;
      outline-offset: 1px;
    }
  `;

  /** How many are not chosen yet. */
  get open(): number {
    return this.entries.filter((e) => !e.picked).length;
  }

  override render() {
    if (this.entries.length === 0) {
      return html`<div class="panel-header">Conflicts</div>
        <div class="summary done">No conflicts.</div>`;
    }
    const open = this.open;
    return html`
      <div class="panel-header">
        Conflicts
        ${this.against
          ? html`<span class="against">with ${this.against.branch} at ${this.against.commit.slice(0, 8)}</span>`
          : nothing}
      </div>
      <div class="summary ${open === 0 ? 'done' : ''}">
        ${open === 0
          ? 'All chosen. Save to Git commits the merged model.'
          : `${open === 1 ? 'One change' : `${open} changes`} made on both sides to choose between. Until then the model holds the version before either.`}
      </div>
      ${this.entries.map((entry, index) => this.row(entry, index))}
    `;
  }

  private row(entry: ConflictEntry, index: number) {
    const c = entry.conflict;
    const subject = c.subjects[0] ?? '';
    const described = this.describe(subject);
    const choices: Array<{ side: MergeSide; label: string; value: string }> =
      c.kind === 'deleted'
        ? [
            { side: other(c.deletedBy ?? 'ours'), label: 'Keep it', value: `Changed ${c.deletedBy === 'ours' ? 'in theirs' : 'here'}` },
            { side: c.deletedBy ?? 'ours', label: 'Delete it', value: `Deleted ${c.deletedBy === 'ours' ? 'here' : 'in theirs'}` },
          ]
        : [
            { side: 'ours', label: 'Keep mine', value: this.versionText(c, c.options.ours) },
            { side: 'theirs', label: 'Take theirs', value: this.versionText(c, c.options.theirs) },
          ];
    return html`
      <div class="conflict ${entry.picked ? 'chosen' : ''}" data-kind=${c.kind}>
        <div
          class="what"
          tabindex="0"
          role="button"
          title="Show it"
          @click=${() => this.select(subject)}
          @keydown=${(e: KeyboardEvent) => (e.key === 'Enter' ? this.select(subject) : undefined)}
        >
          <span class="name ${described.unnamed ? 'unnamed' : ''}">${described.name}</span>
          ${described.type ? html`<span class="type">${described.type}</span>` : nothing}
          <span class="aspect">${this.aspectOf(c)}</span>
        </div>
        <div class="sides">
          ${choices.map(
            (choice) => html`
              <span class="who">${choice.side === 'ours' ? 'Mine' : 'Theirs'}</span>
              <span class="value">${choice.value}</span>
              <button
                data-side=${choice.side}
                aria-pressed=${entry.picked === choice.side ? 'true' : 'false'}
                @click=${() => this.pick(index, choice.side)}
              >
                ${choice.label}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  /** What about it conflicts, in words. */
  private aspectOf(c: MergeConflict): string {
    switch (c.kind) {
      case 'deleted':
        return c.subjects.length > 1 ? `deleted on one side, with ${c.subjects.length - 1} more; changed on the other` : 'deleted on one side, changed on the other';
      case 'bounds':
        return 'position and size on the diagram';
      case 'route':
        return 'the line’s route';
      case 'placement':
        return 'placed on the diagram on both sides';
      case 'count':
        return c.message ?? 'a count limit';
      case 'value': {
        if (c.predicate === RDF_TYPE) return 'type';
        const name = c.predicate ? this.propertyName(c.predicate) : 'value';
        return c.language ? `${name} (${c.language})` : name;
      }
    }
  }

  /** One side's version, in words. */
  private versionText(c: MergeConflict, lines: readonly string[]): string {
    const quads = quadsOfSnapshot(lines);
    const of = (predicate: string) => quads.filter((q) => q.predicate.value === predicate);
    switch (c.kind) {
      case 'bounds':
      case 'placement': {
        const n = (p: string) => Number(of(VIS + p)[0]?.object.value);
        const [x, y, w, h] = ['bounds-x', 'bounds-y', 'bounds-w', 'bounds-h'].map(n);
        return Number.isFinite(x) ? `at ${x}, ${y} · ${w} × ${h}` : 'none';
      }
      case 'route': {
        const points = of(VIS + 'point-x').length;
        return points === 0 ? 'straight' : points === 1 ? 'one bend' : `${points} bends`;
      }
      case 'count':
      case 'value': {
        // A relationship's connection: its ends.
        const source = of(ARCH + 'source')[0];
        const target = of(ARCH + 'target')[0];
        if (c.kind === 'value' && (c.predicate === ARCH + 'source' || c.predicate === ARCH + 'target') && source && target) {
          return `${this.termText(source.object)} → ${this.termText(target.object)}`;
        }
        const values = (c.predicate ? of(c.predicate) : quads).map((q) => this.termText(q.object));
        return values.length === 0 ? 'none' : values.join(', ');
      }
      default:
        return '';
    }
  }

  private termText(term: Quad['object']): string {
    if (term.termType === 'Literal') {
      const language = (term as { language?: string }).language;
      return `“${term.value}”${language ? ` (${language})` : ''}`;
    }
    if (term.termType === 'NamedNode') return this.describe(term.value).name;
    return 'a blank node';
  }

  private pick(index: number, side: MergeSide): void {
    this.dispatchEvent(new CustomEvent<ConflictPickDetail>('conflict-pick', { detail: { index, side }, bubbles: true, composed: true }));
  }

  private select(iri: string): void {
    this.dispatchEvent(new CustomEvent('conflict-select', { detail: { iri }, bubbles: true, composed: true }));
  }
}

function other(side: MergeSide): MergeSide {
  return side === 'ours' ? 'theirs' : 'ours';
}

declare global {
  interface HTMLElementTagNameMap {
    'git-conflicts': ConflictsPanel;
  }
}
