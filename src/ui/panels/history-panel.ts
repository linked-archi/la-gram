/**
 * History Panel — the model's versions (Req 9.10, 9.14, Task 21): its
 * checkpoints, and — for a model bound to a file in Git — that file's commits.
 *
 * Save a checkpoint of the working state with a message; list the checkpoints
 * and the Git commits together, newest first; see what one changed — against
 * the version before it, or against the model now — by element (`model-diff.ts`)
 * or as triples added and removed; restore a checkpoint, or open the file as a
 * Git commit had it. For a model bound to a branch other than the default, the
 * first entry is the branch against the default: what a merge request would
 * bring.
 *
 * The panel holds no history itself: it is given the checkpoints, the working
 * state and — from the Git module — a {@link HistoryGitSource}, and asks for a
 * new checkpoint or a restore with an event (`mount-ui.ts` does the work). Git
 * is read when the tab opens (`reloadGit`) and on demand, never polled.
 *
 * The user sees *checkpoints*: kept on this machine, they are not Git commits —
 * "commit" means Save to Git (Req 18). The code keeps its older names
 * (`Commit`, `history-commit`, the `commit` classes, the `la-gram-history`
 * store), which nobody sees.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Parser } from 'n3';
import type { Term } from '@rdfjs/types';
import { diffSnapshots, type Commit, type SnapshotDiff } from '../../model-manager/version-history.js';
import { diffByElement, type DiffOptions, type ModelDiff } from '../../model-manager/model-diff.js';
import type { DiffWords } from '../../model-manager/model-diff-text.js';
import { curieOf } from './sparql-editor.js';
import './model-diff-view.js';

/** Detail of `history-commit`. */
export interface HistoryCommitDetail {
  message: string;
}

/** Detail of `history-restore`. */
export interface HistoryRestoreDetail {
  id: string;
}

/** What a version is compared with: the one before it (for the branch, where it started), or the model now. */
export type HistoryComparison = 'parent' | 'working';

/** A Git commit of the bound file. */
export interface HistoryGitCommit {
  commit: string;
  parents: string[];
  author: string;
  /** ISO 8601. */
  date: string;
  message: string;
  /** Its page on the host. */
  webUrl: string;
}

/** The bound file's Git history, as the Git module reads it. */
export interface HistoryGitSource {
  /** Changes when what is listed would: another file or branch, a new commit saved. */
  readonly key: string;
  /** `acme/arch · main · models/shop.ttl` */
  readonly where: string;
  /** The branch the model is bound to. */
  readonly branch: string;
  /** A page of the file's commits (from 1), newest first; `ask`: a token may be asked for. */
  commits(page: number, ask: boolean): Promise<{ commits: HistoryGitCommit[]; more: boolean }>;
  /** The repository's default branch. */
  defaultBranch(ask: boolean): Promise<string>;
  /** Where the branch left `target` (their merge base), and its head. */
  branchRange(target: string): Promise<{ base: string; head: string }>;
  /** The model as the file was at a commit; nothing where it was not there. */
  snapshotAt(commit: string): Promise<string[]>;
  /** Make the model the file at a commit — asking first, undoably. */
  openVersion(commit: HistoryGitCommit): Promise<void>;
}

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
    if (t.termType === 'Quad') {
      // An RDF 1.2 triple term: what a relationship rdf:reifies.
      return `<<( ${term(t.subject as Term)} ${term(t.predicate as Term)} ${term(t.object as Term)} )>>`;
    }
    return t.value;
  };
  return `${term(parsed.subject as Term)} ${term(parsed.predicate as Term)} ${term(parsed.object as Term)}`;
}

/** What is selected: a checkpoint, a Git commit, or the branch against the default. */
type Selection = { kind: 'checkpoint'; id: string } | { kind: 'git'; commit: string } | { kind: 'branch' };

/** The Git commits read, and how reading went. */
interface GitState {
  key: string;
  status: 'loading' | 'ready' | 'error';
  message?: string;
  commits: HistoryGitCommit[];
  more: boolean;
  pages: number;
  /** The default branch, when it is not the bound one: the branch entry compares with it. */
  target?: string;
}

/** A selection's comparison, worked out. */
interface Detail {
  key: string;
  status: 'loading' | 'ready' | 'error';
  diff?: ModelDiff;
  message?: string;
}

/** One entry of the list. */
type Entry = { kind: 'checkpoint'; time: number; commit: Commit } | { kind: 'git'; time: number; commit: HistoryGitCommit };

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
    .status,
    .git-status {
      padding: 6px 12px;
      color: #5f6368;
    }
    .git-status {
      display: flex;
      gap: 8px;
      align-items: center;
      padding-top: 0;
    }
    .git-status.error {
      color: #c62828;
    }
    .git-status button {
      margin-left: auto;
    }
    .body {
      display: flex;
      min-height: 0;
    }
    ul.commits {
      list-style: none;
      margin: 0;
      padding: 0;
      width: 300px;
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
    ul.commits li.older {
      cursor: default;
      background: none;
    }
    .message {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      font-size: 11px;
      color: #5f6368;
    }
    .badge {
      display: inline-block;
      padding: 0 4px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      color: #fff;
      background: #5f6368;
      vertical-align: 1px;
    }
    .badge.git {
      background: #f05133;
    }
    .badge.branch {
      background: #1a73e8;
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
    .detail-header .actions {
      margin-left: auto;
      display: inline-flex;
      gap: 8px;
      align-items: center;
    }
    .views {
      display: flex;
      gap: 12px;
      margin-bottom: 6px;
      color: #5f6368;
    }
    .views label {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    pre {
      margin: 0 0 8px;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `;

  /** The model's checkpoints, newest first. */
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

  /** The bound file's Git history; absent for a model not bound, or with Git storage off. */
  @property({ attribute: false })
  git?: HistoryGitSource;

  /** Which properties take one value, and the language names are preferred in. */
  @property({ attribute: false })
  diffOptions?: () => DiffOptions;

  /** Names of types and properties, for the diff by element. */
  @property({ attribute: false })
  words?: DiffWords;

  @state() private _selected?: Selection;
  @state() private _comparison: HistoryComparison = 'parent';
  @state() private _view: 'elements' | 'triples' = 'elements';
  @state() private _message = '';
  @state() private _git?: GitState;
  @state() private _detail?: Detail;
  private _gitRead = 0;
  private _detailRun = 0;
  /** The version read for a comparison with the model now. */
  private _detailFrom?: readonly string[];
  /** The last checkpoint comparison, kept while neither side changes. */
  private _memo?: { from: readonly string[]; to: readonly string[]; diff: ModelDiff };

  /** Read the Git history again: when the tab opens, and on Read again (`ask`: a token may be asked for). */
  reloadGit(ask = false): void {
    const source = this.git;
    if (!source) {
      this._git = undefined;
      return;
    }
    const run = ++this._gitRead;
    this._git = { key: source.key, status: 'loading', commits: [], more: false, pages: 0 };
    void (async () => {
      try {
        const [page, target] = await Promise.all([source.commits(1, ask), source.defaultBranch(ask).catch(() => undefined)]);
        if (run !== this._gitRead) return;
        this._git = {
          key: source.key,
          status: 'ready',
          commits: page.commits,
          more: page.more,
          pages: 1,
          ...(target && target !== source.branch ? { target } : {}),
        };
        if (this._selected?.kind !== 'checkpoint') this._detail = undefined;
      } catch (err: unknown) {
        if (run !== this._gitRead) return;
        this._git = { key: source.key, status: 'error', message: err instanceof Error ? err.message : String(err), commits: [], more: false, pages: 0 };
      }
    })();
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    // Another file, branch or commit bound while the tab is open: read it.
    if (changed.has('git') && this.git?.key !== this._git?.key) {
      if (this._selected && this._selected.kind !== 'checkpoint') this._selected = undefined;
      this.reloadGit();
    }
    // A Git commit or the branch selected: read the versions it compares.
    const selection = this._selected;
    if (selection && selection.kind !== 'checkpoint' && this._git?.status === 'ready') {
      const key = this._detailKey(selection);
      if (this._detail?.key !== key) this._startDetail(key, selection);
    }
  }

  private _detailKey(selection: Selection): string {
    return `${this._git?.key}|${JSON.stringify(selection)}|${this._comparison}`;
  }

  override render() {
    const latest = this.commits[0];
    const pending = latest && this.working ? diffSnapshots(latest.triples, this.working) : undefined;
    const unchanged = pending !== undefined && pending.added.length + pending.removed.length === 0;
    const entries = this._entries();
    const branchEntry = this._git?.target ? this._git : undefined;
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
        <button
          class="commit"
          title="Kept on this machine only — not a Git commit (File › Save to Git commits to a repository)"
          ?disabled=${!this.canCommit || unchanged}
          @click=${() => this._commit()}
        >
          Save checkpoint
        </button>
      </div>
      <div class="status">${this._status(pending)}</div>
      ${this._gitStatus()}
      ${entries.length === 0 && !branchEntry
        ? nothing
        : html`<div class="body">
            <ul class="commits" role="listbox">
              ${branchEntry ? this._renderBranch(branchEntry.target!) : nothing}
              ${entries.map((entry) => (entry.kind === 'checkpoint' ? this._renderCommit(entry.commit) : this._renderGit(entry.commit)))}
              ${this._git?.status === 'ready' && this._git.more
                ? html`<li class="older"><button class="older-commits" @click=${() => this._older()}>Older commits…</button></li>`
                : nothing}
            </ul>
            ${this._renderDetail()}
          </div>`}
    `;
  }

  /** Checkpoints and Git commits together, newest first. */
  private _entries(): Entry[] {
    const entries: Entry[] = [
      ...this.commits.map((commit) => ({ kind: 'checkpoint' as const, time: Date.parse(commit.timestamp), commit })),
      ...(this._git?.commits ?? []).map((commit) => ({ kind: 'git' as const, time: Date.parse(commit.date), commit })),
    ];
    return entries.sort((a, b) => (b.time || 0) - (a.time || 0));
  }

  private _status(pending: SnapshotDiff | undefined) {
    if (!this.canCommit) return 'Open a model to keep checkpoints of it.';
    if (this.commits.length === 0) return 'No checkpoints yet: save one to start the model’s history on this machine.';
    if (!pending) return '';
    const changes = pending.added.length + pending.removed.length;
    return changes === 0
      ? 'No changes since the last checkpoint.'
      : html`Since the last checkpoint: <span class="added">+${pending.added.length}</span>
          <span class="removed">−${pending.removed.length}</span> triples.`;
  }

  private _gitStatus() {
    const source = this.git;
    if (!source) return nothing;
    const git = this._git;
    const read = html`<button class="git-reload" ?disabled=${git?.status === 'loading'} @click=${() => this.reloadGit(true)}>Read again</button>`;
    if (!git || git.status === 'loading') return html`<div class="git-status">Git: ${source.where} — reading its commits…</div>`;
    if (git.status === 'error') {
      return html`<div class="git-status error">The Git history of ${source.where} could not be read: ${git.message} ${read}</div>`;
    }
    const n = git.commits.length;
    return html`<div class="git-status">
      Git: ${source.where} — ${n === 0 ? 'no commits of the file' : `${n}${git.more ? '+' : ''} commit${n === 1 ? '' : 's'}`} ${read}
    </div>`;
  }

  private _renderCommit(commit: Commit) {
    const parent = this.commits.find((c) => c.id === commit.parent);
    const diff = diffSnapshots(parent?.triples ?? [], commit.triples);
    const selected = this._selected?.kind === 'checkpoint' && this._selected.id === commit.id;
    return html`<li role="option" data-commit=${commit.id} aria-selected=${String(selected)} @click=${() => this._select({ kind: 'checkpoint', id: commit.id })}>
      <div class="message">${commit.message || '(no message)'}</div>
      <div class="meta">
        ${new Date(commit.timestamp).toLocaleString()}${commit.author ? html` · ${commit.author}` : nothing} ·
        <span class="added">+${diff.added.length}</span> <span class="removed">−${diff.removed.length}</span>
      </div>
    </li>`;
  }

  private _renderGit(commit: HistoryGitCommit) {
    const selected = this._selected?.kind === 'git' && this._selected.commit === commit.commit;
    return html`<li role="option" class="git" data-git=${commit.commit} aria-selected=${String(selected)} @click=${() => this._select({ kind: 'git', commit: commit.commit })}>
      <div class="message"><span class="badge git">Git</span> ${firstLine(commit.message) || '(no message)'}</div>
      <div class="meta">
        ${commit.date ? new Date(commit.date).toLocaleString() : ''}${commit.author ? html` · ${commit.author}` : nothing} ·
        <a href=${commit.webUrl} target="_blank" rel="noopener" @click=${(e: Event) => e.stopPropagation()}>${commit.commit.slice(0, 8)}</a>
      </div>
    </li>`;
  }

  private _renderBranch(target: string) {
    const selected = this._selected?.kind === 'branch';
    return html`<li role="option" class="branch" data-branch=${this.git!.branch} aria-selected=${String(selected)} @click=${() => this._select({ kind: 'branch' })}>
      <div class="message"><span class="badge branch">Branch</span> ${this.git!.branch} against ${target}</div>
      <div class="meta">What merging it into ${target} would bring</div>
    </li>`;
  }

  private _renderDetail() {
    const selection = this._selected;
    if (!selection) return nothing;
    const comparisons = (parent: string, working: string) => html`
      <label><input type="radio" name="comparison" value="parent" .checked=${this._comparison === 'parent'}
        @change=${() => this._compare('parent')} />${parent}</label>
      <label><input type="radio" name="comparison" value="working" .checked=${this._comparison === 'working'}
        @change=${() => this._compare('working')} />${working}</label>`;
    let header;
    if (selection.kind === 'checkpoint') {
      const commit = this.commits.find((c) => c.id === selection.id);
      if (!commit) return nothing;
      header = html`${comparisons('Changes in this checkpoint', 'Since then, to now')}
        <span class="actions">
          <button class="restore" @click=${() => this._emit<HistoryRestoreDetail>('history-restore', { id: commit.id })}>Restore this checkpoint</button>
        </span>`;
    } else if (selection.kind === 'git') {
      const commit = this._git?.commits.find((c) => c.commit === selection.commit);
      if (!commit) return nothing;
      header = html`${comparisons('Changes in this commit', 'Since then, to now')}
        <span class="actions">
          <button class="open-version" @click=${() => void this.git?.openVersion(commit)}>Open this version</button>
        </span>`;
    } else {
      const target = this._git?.target;
      if (!target || !this.git) return nothing;
      header = comparisons(`Committed on ${this.git.branch}`, 'With the model now');
    }
    return html`<div class="detail">
      <div class="detail-header">${header}</div>
      <div class="views">
        <label><input type="radio" name="view" value="elements" .checked=${this._view === 'elements'}
          @change=${() => (this._view = 'elements')} />By element</label>
        <label><input type="radio" name="view" value="triples" .checked=${this._view === 'triples'}
          @change=${() => (this._view = 'triples')} />As triples</label>
      </div>
      ${this._renderComparison()}
    </div>`;
  }

  private _renderComparison() {
    const detail = this._currentDetail();
    if (!detail || detail.status === 'loading') return html`<div class="status">Reading the versions…</div>`;
    if (detail.status === 'error' || !detail.diff) return html`<div class="status removed">${detail.message ?? 'The versions could not be read.'}</div>`;
    const diff = detail.diff;
    if (this._view === 'elements') {
      return html`<model-diff-view .diff=${diff} .words=${this.words}></model-diff-view>`;
    }
    const lines = (list: string[], sign: string) => {
      const shown = list.slice(0, MAX_HISTORY_LINES).map((line) => `${sign} ${formatTriple(line, this.prefixes)}`);
      const more = list.length - shown.length;
      return shown.join('\n') + (more > 0 ? `\n… and ${more} more` : '');
    };
    return diff.lines.added.length + diff.lines.removed.length === 0
      ? html`<div class="status">No differences.</div>`
      : html`${diff.lines.added.length ? html`<pre class="added">${lines(diff.lines.added, '+')}</pre>` : nothing}
          ${diff.lines.removed.length ? html`<pre class="removed">${lines(diff.lines.removed, '−')}</pre>` : nothing}`;
  }

  /**
   * The selection's comparison: a checkpoint's at once, from the snapshots it
   * holds; a Git commit's or the branch's once their files are read.
   */
  private _currentDetail(): Detail | undefined {
    const selection = this._selected;
    if (!selection) return undefined;
    const working = this._comparison === 'working';
    if (selection.kind === 'checkpoint') {
      const commit = this.commits.find((c) => c.id === selection.id);
      if (!commit) return undefined;
      const parent = this.commits.find((c) => c.id === commit.parent);
      const from = working ? commit.triples : parent?.triples ?? [];
      const to = working ? this.working ?? commit.triples : commit.triples;
      return { key: '', status: 'ready', diff: this._diff(from, to) };
    }
    const key = this._detailKey(selection);
    if (this._detail?.key !== key) return { key, status: 'loading' };
    // Against the model now: compared again as it changes, from the version read.
    if (working && this._detail.status === 'ready' && this._detailFrom && this.working) {
      return { ...this._detail, diff: this._diff(this._detailFrom, this.working) };
    }
    return this._detail;
  }

  private _startDetail(key: string, selection: Selection): void {
    const source = this.git;
    if (!source) return;
    const run = ++this._detailRun;
    const working = this._comparison === 'working';
    const read = async (): Promise<{ from: readonly string[]; to: readonly string[] }> => {
      if (selection.kind === 'git') {
        const commit = this._git?.commits.find((c) => c.commit === selection.commit);
        if (!commit) throw new Error('The commit is no longer listed.');
        if (working) return { from: await source.snapshotAt(commit.commit), to: this.working ?? [] };
        const parent = commit.parents[0];
        const [from, to] = await Promise.all([parent ? source.snapshotAt(parent) : Promise.resolve([]), source.snapshotAt(commit.commit)]);
        return { from, to };
      }
      const target = this._git?.target;
      if (!target) throw new Error('The default branch is not known.');
      const { base, head } = await source.branchRange(target);
      const from = await source.snapshotAt(base);
      return { from, to: working ? this.working ?? [] : await source.snapshotAt(head) };
    };
    this._detail = { key, status: 'loading' };
    void read().then(
      ({ from, to }) => {
        if (run !== this._detailRun) return;
        this._detailFrom = working ? from : undefined;
        this._detail = { key, status: 'ready', diff: this._diff(from, to) };
      },
      (err: unknown) => {
        if (run !== this._detailRun) return;
        this._detail = { key, status: 'error', message: `The versions could not be read: ${err instanceof Error ? err.message : String(err)}` };
      },
    );
  }

  private _diff(from: readonly string[], to: readonly string[]): ModelDiff {
    if (this._memo && this._memo.from === from && this._memo.to === to) return this._memo.diff;
    const diff = diffByElement(from, to, this.diffOptions?.() ?? {});
    this._memo = { from, to, diff };
    return diff;
  }

  private _select(selection: Selection): void {
    this._selected = selection;
  }

  private _compare(comparison: HistoryComparison): void {
    this._comparison = comparison;
  }

  private _older(): void {
    const source = this.git;
    const git = this._git;
    if (!source || !git || git.status !== 'ready') return;
    const run = this._gitRead;
    void source.commits(git.pages + 1, true).then(
      (page) => {
        if (run !== this._gitRead || this._git !== git) return;
        this._git = { ...git, commits: [...git.commits, ...page.commits], more: page.more, pages: git.pages + 1 };
      },
      (err: unknown) => {
        if (run !== this._gitRead) return;
        this._git = { ...git, status: 'error', message: err instanceof Error ? err.message : String(err) };
      },
    );
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

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

declare global {
  interface HTMLElementTagNameMap {
    'history-panel': HistoryPanel;
  }
}
