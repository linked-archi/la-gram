// @vitest-environment jsdom
/**
 * The History tab with a Git history (Task 21): Git commits and checkpoints
 * listed together, newest first, told apart; the branch against the default
 * first; a commit's changes by element, against the one before it or the model
 * now; Open this version; a failure said in the tab, with Read again; older
 * commits on demand.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '../history-panel.js';
import type { HistoryGitCommit, HistoryGitSource, HistoryPanel } from '../history-panel.js';
import type { Commit } from '../../../model-manager/version-history.js';

const LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const COMPONENT = 'https://meta.linked.archi/archimate4/onto#ApplicationComponent';
const M = 'https://example.org/m/';
const element = (id: string, name: string) => [`<${M}${id}> <${LABEL}> "${name}"@en .`, `<${M}${id}> <${TYPE}> <${COMPONENT}> .`];
const V1 = [...element('e1', 'One')].sort();
const V2 = [...element('e1', 'One'), ...element('e2', 'Two')].sort();
const V3 = [...element('e1', 'Uno'), ...element('e2', 'Two')].sort();

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 5, 9, 0, seconds)).toISOString();
const gitCommit = (commit: string, parent: string | undefined, seconds: number, message: string): HistoryGitCommit => ({
  commit,
  parents: parent ? [parent] : [],
  author: 'Ada',
  date: at(seconds),
  message,
  webUrl: `https://host/commit/${commit}`,
});
const G1 = gitCommit('g1aaaaaaaaaa', undefined, 0, 'First');
const G2 = gitCommit('g2bbbbbbbbbb', 'g1aaaaaaaaaa', 60, 'Add Two\n\nAnd more words.');
const G3 = gitCommit('g3cccccccccc', 'g2bbbbbbbbbb', 120, 'Rename One');
const SNAPSHOTS: Record<string, string[]> = { g1aaaaaaaaaa: V1, g2bbbbbbbbbb: V2, g3cccccccccc: V3, base0: V1 };

const CHECKPOINT: Commit = { id: 'cp1', modelIri: `${M}model`, timestamp: at(30), message: 'Checkpoint between', triples: V1 };

function fakeSource(options: { branch?: string; pages?: HistoryGitCommit[][]; fail?: boolean } = {}) {
  const pages = options.pages ?? [[G2, G1]];
  const source: HistoryGitSource & { asks: boolean[]; opened: HistoryGitCommit[] } = {
    key: 'k1',
    where: `acme/arch · ${options.branch ?? 'main'} · models/shop.nt`,
    branch: options.branch ?? 'main',
    asks: [],
    opened: [],
    commits: vi.fn(async (page: number, ask: boolean) => {
      source.asks.push(ask);
      if (options.fail && !ask) throw new Error('The repository acme/arch was not found. A token may be needed to read it.');
      return { commits: pages[page - 1] ?? [], more: page < pages.length };
    }),
    defaultBranch: vi.fn(async () => 'main'),
    branchRange: vi.fn(async () => ({ base: 'base0', head: 'g3cccccccccc' })),
    snapshotAt: vi.fn(async (commit: string) => SNAPSHOTS[commit] ?? []),
    openVersion: vi.fn(async (commit: HistoryGitCommit) => {
      source.opened.push(commit);
    }),
  };
  return source;
}

async function panel(source: HistoryGitSource, working: string[] = V3): Promise<HistoryPanel> {
  const element = document.createElement('history-panel');
  element.canCommit = true;
  element.commits = [CHECKPOINT];
  element.working = working;
  element.words = { typeName: (iri) => (iri === COMPONENT ? 'Application Component' : iri), propertyName: (iri) => (iri === LABEL ? 'Name' : iri) };
  document.body.append(element);
  element.git = source;
  await vi.waitFor(() => expect(root(element).querySelector('.git-status')?.textContent).not.toMatch(/reading/));
  return element;
}

const root = (element: HistoryPanel) => element.shadowRoot!;
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const entries = (element: HistoryPanel) => [...root(element).querySelectorAll('ul.commits li[role="option"]')].map((li) => text(li.querySelector('.message')));

/** The rows of the diff shown, as `sign name: details`. */
async function shownDiff(element: HistoryPanel): Promise<string[]> {
  let view: HTMLElement & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot | null } | null = null;
  await vi.waitFor(() => {
    view = root(element).querySelector('model-diff-view');
    expect(view?.shadowRoot?.querySelector('li.change')).toBeTruthy();
  });
  await view!.updateComplete;
  return [...view!.shadowRoot!.querySelectorAll('li.change')].map(
    (li) => `${text(li.querySelector('.sign'))} ${text(li.querySelector('.name'))}: ${[...li.querySelectorAll('ul.details li')].map(text).join('; ')}`,
  );
}

afterEach(() => document.body.replaceChildren());

describe('the History tab with the bound file’s Git history', () => {
  it('Git commits and checkpoints together, newest first; a Git commit with its badge, author and short id linked', async () => {
    const element = await panel(fakeSource());
    expect(entries(element)).toEqual(['Git Add Two', 'Checkpoint between', 'Git First']);
    const git = root(element).querySelector('li[data-git="g2bbbbbbbbbb"]')!;
    expect(text(git.querySelector('.meta'))).toContain('Ada');
    expect(git.querySelector('a')?.getAttribute('href')).toBe('https://host/commit/g2bbbbbbbbbb');
    expect(text(git.querySelector('a'))).toBe('g2bbbbbb');
    expect(text(root(element).querySelector('.git-status'))).toBe('Git: acme/arch · main · models/shop.nt — 2 commits Read again');
  });

  it('a Git commit’s changes by element: against the commit before it, or the model now', async () => {
    const element = await panel(fakeSource());
    (root(element).querySelector('li[data-git="g2bbbbbbbbbb"]') as HTMLElement).click();
    expect(await shownDiff(element)).toEqual(['+ Two: Name (en): “Two”']);
    (root(element).querySelector('input[name="comparison"][value="working"]') as HTMLInputElement).click();
    await vi.waitFor(async () => expect(await shownDiff(element)).toEqual(['~ Uno: Name (en): “One” → “Uno”']));
  });

  it('Open this version asks the Git module for that commit', async () => {
    const source = fakeSource();
    const element = await panel(source);
    (root(element).querySelector('li[data-git="g1aaaaaaaaaa"]') as HTMLElement).click();
    await element.updateComplete;
    (root(element).querySelector('button.open-version') as HTMLButtonElement).click();
    expect(source.opened.map((c) => c.commit)).toEqual(['g1aaaaaaaaaa']);
  });

  it('bound to another branch than the default: first, the branch against it — what a merge request would bring', async () => {
    const source = fakeSource({ branch: 'la-gram/shop' });
    const element = await panel(source);
    expect(entries(element)[0]).toBe('Branch la-gram/shop against main');
    (root(element).querySelector('li[data-branch]') as HTMLElement).click();
    expect(await shownDiff(element)).toEqual(['+ Two: Name (en): “Two”', '~ Uno: Name (en): “One” → “Uno”']);
    expect(source.branchRange).toHaveBeenCalledWith('main');
  });

  it('a failure is said in the tab, the checkpoints still shown; Read again may ask for a token', async () => {
    const source = fakeSource({ fail: true });
    const element = await panel(source);
    expect(text(root(element).querySelector('.git-status.error'))).toMatch(/could not be read: .*A token may be needed to read it\. Read again$/);
    expect(entries(element)).toEqual(['Checkpoint between']);
    (root(element).querySelector('button.git-reload') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(entries(element)).toEqual(['Git Add Two', 'Checkpoint between', 'Git First']));
    expect(source.asks).toEqual([false, true]);
  });

  it('older commits on demand', async () => {
    const element = await panel(fakeSource({ pages: [[G3, G2], [G1]] }));
    expect(text(root(element).querySelector('.git-status'))).toMatch(/2\+ commits/);
    (root(element).querySelector('button.older-commits') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(entries(element)).toEqual(['Git Rename One', 'Git Add Two', 'Checkpoint between', 'Git First']));
    expect(root(element).querySelector('button.older-commits')).toBeNull();
  });

  it('a checkpoint’s changes by element too — and as triples', async () => {
    const element = await panel(fakeSource());
    (root(element).querySelector('li[data-commit="cp1"]') as HTMLElement).click();
    expect(await shownDiff(element)).toEqual(['+ One: Name (en): “One”']);
    (root(element).querySelector('input[name="view"][value="triples"]') as HTMLInputElement).click();
    await element.updateComplete;
    expect(text(root(element).querySelector('pre.added'))).toContain('"One"@en');
  });

  it('not bound: no Git line, the checkpoints as before', async () => {
    const element = document.createElement('history-panel');
    element.canCommit = true;
    element.commits = [CHECKPOINT];
    document.body.append(element);
    await element.updateComplete;
    expect(root(element).querySelector('.git-status')).toBeNull();
    expect(entries(element)).toEqual(['Checkpoint between']);
  });
});
