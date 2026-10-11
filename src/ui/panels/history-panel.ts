/**
 * History Panel — the model's commits (Req 9.10, 9.14).
 *
 * Commit the working state with a message; list the commits, newest first,
 * with what each changed; see a commit's changes, or how it differs from the
 * model now, as triples added and removed; restore one. The panel holds no
 * history itself: it is given the commits and the working state, and asks for
 * a commit or a restore with an event (`mount-ui.ts` does the work).
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Parser } from 'n3';
import type { Term } from '@rdfjs/types';
import { diffSnapshots, type Commit, type SnapshotDiff } from '../../model-manager/version-history.js';
import { curieOf } from './sparql-editor.js';

/** Detail of `history-commit`. */
export interface HistoryCommitDetail {
  message: string;
}

/** Detail of `history-restore`. */
export interface HistoryRestoreDetail {
  id: string;
}

/** What a commit is compared with. */
export type HistoryComparison = 'parent' | 'working';

/** Triples shown at most per list; the count says how many there are. */
export const MAX_HISTORY_LINES = 500;

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/** One N-Triples line with prefixed names: `m:clerk skos:prefLabel "Clerk"@en`. */
export function formatTriple(line: string, prefixes: Record<string, string>): string {
  let parsed;
  try {
    [parsed] = new Parser({ format: 'N-Triples' }).parse(line);
  } catch {
    return line;
  }
  if (!parsed) return line;
  const term = (t: Term): string => {
    if (t.termType === 'NamedNode') return curieOf(t.value, prefixes);
    if (t.termType === 'BlankNode') return `_:${t.value}`;
    if (t.termType === 'Literal') {
      const text = JSON.stringify(t.value);
      if (t.language) return `${text}@${t.language}`;
      return t.datatype && t.datatype.value !== XSD_STRING ? `${text}^^${curieOf(t.datatype.value, prefixes)}` : text;
    }
    return t.value;
  };
  return `${term(parsed.subject as Term)} ${term(parsed.predicate as Term)} ${term(parsed.object as Term)}`;
}

@customElement('history-panel')
export class HistoryPanel extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      font-size: 13px;
    }
    .commit-row {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid #ddd;
    }
    .commit-row input {
      flex: 1;
      min-width: 0;
      font: inherit;
      padding: 4px 6px;
    }
    .status {
      padding: 6px 12px;
      color: #5f6368;
    }
    .body {
      display: flex;
      min-height: 0;
    }
    ul.commits {
      list-style: none;
      margin: 0;
      padding: 0;
      width: 280px;
      flex: none;
      border-right: 1px solid #ddd;
    }
    ul.commits li {
      padding: 6px 12px;
      cursor: pointer;
      border-bottom: 1px solid #f1f3f4;
    }
    ul.commits li:hover {
      background: #f1f3f4;
    }
    ul.commits li[aria-selected='true'] {
      background: #e8f0fe;
    }
    .message {
      font-weight: 500;
    }
    .meta {
      font-size: 11px;
      color: #5f6368;
    }
    .added {
      color: #2e7d32;
    }
    .removed {
      color: #c62828;
    }
    .detail {
      flex: 1;
      min-width: 0;
      padding: 8px 12px;
    }
    .detail-header {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .detail-header label {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    .detail-header button {
      margin-left: auto;
    }
    pre {
      margin: 0 0 8px;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `;

  /** The model's commits, newest first. */
  @property({ attribute: false })
  commits: readonly Commit[] = [];

  /** The working state as a snapshot; absent while not computed (the tab hidden). */
  @property({ attribute: false })
  working?: readonly string[];

  /** Prefixes for showing triples. */
  @property({ attribute: false })
  prefixes: Record<string, string> = {};

  /** A model is open, so there is something to commit. */
  @property({ type: Boolean })
  canCommit = false;

  @state() private _selected?: string;
  @state() private _comparison: HistoryComparison = 'parent';
  @state() private _message = '';

  override render() {
    const latest = this.commits[0];
    const pending = latest && this.working ? diffSnapshots(latest.triples, this.working) : undefined;
    const unchanged = pending !== undefined && pending.added.length + pending.removed.length === 0;
    const selected = this.commits.find((c) => c.id === this._selected);
    return html`
      <div class="commit-row">
        <input
          class="commit-message"
          placeholder="What changed"
          .value=${this._message}
          ?disabled=${!this.canCommit}
          @input=${(e: Event) => (this._message = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._commit()}
        />
        <button class="commit" ?disabled=${!this.canCommit || unchanged} @click=${() => this._commit()}>Commit</button>
      </div>
      <div class="status">${this._status(pending)}</div>
      ${this.commits.length === 0
        ? nothing
        : html`<div class="body">
            <ul class="commits" role="listbox">
              ${this.commits.map((commit) => this._renderCommit(commit))}
            </ul>
            ${selected ? this._renderDetail(selected) : nothing}
          </div>`}
    `;
  }

  private _status(pending: SnapshotDiff | undefined) {
    if (!this.canCommit) return 'Open a model to commit its versions.';
    if (this.commits.length === 0) return 'No commits yet: commit the model to start its history.';
    if (!pending) return '';
    const changes = pending.added.length + pending.removed.length;
    return changes === 0
      ? 'No changes since the last commit.'
      : html`Since the last commit: <span class="added">+${pending.added.length}</span>
          <span class="removed">−${pending.removed.length}</span> triples.`;
  }

  private _renderCommit(commit: Commit) {
    const parent = this.commits.find((c) => c.id === commit.parent);
    const diff = diffSnapshots(parent?.triples ?? [], commit.triples);
    return html`<li
      role="option"
      data-commit=${commit.id}
      aria-selected=${String(commit.id === this._selected)}
      @click=${() => (this._selected = commit.id)}
    >
      <div class="message">${commit.message || '(no message)'}</div>
      <div class="meta">
        ${new Date(commit.timestamp).toLocaleString()}${commit.author ? html` · ${commit.author}` : nothing} ·
        <span class="added">+${diff.added.length}</span> <span class="removed">−${diff.removed.length}</span>
      </div>
    </li>`;
  }

  private _renderDetail(commit: Commit) {
    const parent = this.commits.find((c) => c.id === commit.parent);
    const diff =
      this._comparison === 'working'
        ? diffSnapshots(commit.triples, this.working ?? commit.triples)
        : diffSnapshots(parent?.triples ?? [], commit.triples);
    const lines = (list: string[], sign: string) => {
      const shown = list.slice(0, MAX_HISTORY_LINES).map((line) => `${sign} ${formatTriple(line, this.prefixes)}`);
      const more = list.length - shown.length;
      return shown.join('\n') + (more > 0 ? `\n… and ${more} more` : '');
    };
    return html`<div class="detail">
      <div class="detail-header">
        <label><input type="radio" name="comparison" value="parent" .checked=${this._comparison === 'parent'}
          @change=${() => (this._comparison = 'parent')} />Changes in this commit</label>
        <label><input type="radio" name="comparison" value="working" .checked=${this._comparison === 'working'}
          @change=${() => (this._comparison = 'working')} />Since then, to now</label>
        <button class="restore" @click=${() => this._emit<HistoryRestoreDetail>('history-restore', { id: commit.id })}>
          Restore this version
        </button>
      </div>
      ${diff.added.length + diff.removed.length === 0
        ? html`<div class="status">No differences.</div>`
        : html`${diff.added.length ? html`<pre class="added">${lines(diff.added, '+')}</pre>` : nothing}
          ${diff.removed.length ? html`<pre class="removed">${lines(diff.removed, '−')}</pre>` : nothing}`}
    </div>`;
  }

  private _commit(): void {
    if (!this.canCommit) return;
    this._emit<HistoryCommitDetail>('history-commit', { message: this._message.trim() });
    this._message = '';
  }

  private _emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'history-panel': HistoryPanel;
  }
}
