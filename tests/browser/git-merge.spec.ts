/**
 * Two la-gram clients saving the same bound file (the Git collaboration plan,
 * Phase 1): the second save is refused, *Merge with the newer version* combines
 * the two, and the commit lands on the same branch — no new branch. Then a real
 * conflict, chosen in the Conflicts tab and saved. Then review (Phase 2): a
 * save to a new branch, the pull request it offers, described by element, and
 * the History tab's Git commits and the branch against main.
 *
 * Each client is a browser context of its own (its own storage, its own token).
 * GitHub's API is played by a repository in this process, answered through
 * Playwright's routes: no real host, no real token.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page, Route } from 'playwright';
import { startStaticServer, type StaticServer } from './static-server.js';
import { openSession, waitForAppReady, WEB_DIST, type BrowserSession } from './harness.js';

const COMPONENT = 'https://meta.linked.archi/archimate4/onto#ApplicationComponent';
const PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const PATH = 'models/shop.ttl';
const TOKEN = 'github_pat_FAKE_for_tests_only';

/** GitHub's API for one repository and one file, in memory: branches, commits with their parents, pull requests. */
class FakeGitHub {
  readonly commits = new Map<string, { text: string; parent?: string; message: string; date: string }>();
  readonly branches = new Map<string, string>();
  readonly pulls: Array<{ number: number; title: string; body: string; head: string; base: string }> = [];
  refusals = 0;
  branchesMade = 0;
  private n = 0;

  /** main's head. */
  get head(): string {
    return this.branches.get('main') ?? '';
  }

  blob(text: string): string {
    let h = 7;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `blob${text.length}x${h}`;
  }

  /** A colleague pushes on main while an editor is open. */
  push(text: string): string {
    const commit = `remote${++this.n}`.padEnd(40, '0');
    this.commits.set(commit, { text, parent: this.head, message: 'Colleague update', date: new Date(Date.UTC(2026, 10, 17, 9, this.n)).toISOString() });
    this.branches.set('main', commit);
    return commit;
  }

  /** The file on a branch (main when none is named), or at a commit. */
  file(ref = 'main'): string {
    return this.commits.get(this.branches.get(ref) ?? ref)?.text ?? '';
  }

  private ancestors(ref: string): string[] {
    const out: string[] = [];
    for (let c: string | undefined = this.branches.get(ref) ?? ref; c && this.commits.has(c); c = this.commits.get(c)!.parent) out.push(c);
    return out;
  }

  readonly handle = async (route: Route): Promise<void> => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, PUT, POST, PATCH, OPTIONS',
      'content-type': 'application/json',
    };
    const reply = (status: number, body?: unknown) =>
      route.fulfill({ status, headers, body: body === undefined ? '' : JSON.stringify(body) });
    if (method === 'OPTIONS') return reply(204);
    const at = decodeURIComponent(url.pathname.replace(/^\/repos\/acme\/arch/, ''));
    const body = () => JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
    if (method === 'GET' && at === '') return reply(200, { default_branch: 'main' });
    if (method === 'GET' && at.startsWith('/branches/')) {
      const head = this.branches.get(at.slice('/branches/'.length));
      return head ? reply(200, { commit: { sha: head } }) : reply(404, { message: 'Branch not found' });
    }
    if (at === `/contents/${PATH}` && method === 'GET') {
      const ref = url.searchParams.get('ref') ?? 'main';
      const text = this.commits.get(this.branches.get(ref) ?? ref)?.text;
      if (text === undefined) return reply(404, { message: 'Not Found' });
      return reply(200, { type: 'file', sha: this.blob(text), size: text.length, encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    if (at === `/contents/${PATH}` && method === 'PUT') {
      const { sha, content, branch, message } = body() as { sha?: string; content: string; branch: string; message: string };
      const head = this.branches.get(branch);
      const current = head ? this.blob(this.commits.get(head)!.text) : undefined;
      if (sha !== current) {
        this.refusals++;
        return reply(409, { message: `${PATH} does not match ${sha}` });
      }
      const text = Buffer.from(content, 'base64').toString('utf8');
      const commit = `c${++this.n}`.padEnd(40, '0');
      this.commits.set(commit, { text, ...(head ? { parent: head } : {}), message, date: new Date(Date.UTC(2026, 10, 5, 9, this.n)).toISOString() });
      this.branches.set(branch, commit);
      return reply(sha ? 200 : 201, { content: { sha: this.blob(text) }, commit: { sha: commit, html_url: `https://github.com/acme/arch/commit/${commit}` } });
    }
    if (at === '/git/refs' && method === 'POST') {
      const { ref, sha } = body() as { ref: string; sha: string };
      this.branchesMade++;
      this.branches.set(ref.replace(/^refs\/heads\//, ''), sha);
      return reply(201, { ref, object: { sha } });
    }
    if (at === '/commits' && method === 'GET') {
      const changed = this.ancestors(url.searchParams.get('sha') ?? 'main').filter((c) => {
        const { text, parent } = this.commits.get(c)!;
        return !parent || this.commits.get(parent)!.text !== text;
      });
      return reply(
        200,
        changed.map((c) => {
          const { parent, message, date } = this.commits.get(c)!;
          return { sha: c, html_url: `https://github.com/acme/arch/commit/${c}`, parents: parent ? [{ sha: parent }] : [], commit: { message, author: { name: 'Tester', date } } };
        }),
      );
    }
    if (at.startsWith('/compare/') && method === 'GET') {
      const [a, b] = at.slice('/compare/'.length).split('...');
      const ofA = new Set(this.ancestors(a!));
      return reply(200, { merge_base_commit: { sha: this.ancestors(b!).find((c) => ofA.has(c)) } });
    }
    if (at === '/pulls' && method === 'GET') {
      const head = (url.searchParams.get('head') ?? '').replace(/^acme:/, '');
      const base = url.searchParams.get('base');
      const open = this.pulls.filter((p) => p.head === head && p.base === base);
      return reply(200, open.map((p) => ({ number: p.number, title: p.title, html_url: `https://github.com/acme/arch/pull/${p.number}`, head: { ref: p.head }, base: { ref: p.base } })));
    }
    if (at === '/pulls' && method === 'POST') {
      const { title, head, base, body: text } = body() as { title: string; head: string; base: string; body: string };
      const pull = { number: this.pulls.length + 1, title, body: text, head, base };
      this.pulls.push(pull);
      return reply(201, { number: pull.number, title, html_url: `https://github.com/acme/arch/pull/${pull.number}`, head: { ref: head }, base: { ref: base } });
    }
    return reply(404, { message: `Not Found: ${method} ${at}` });
  };
}

let server: StaticServer;
const sessions: BrowserSession[] = [];
const github = new FakeGitHub();

async function until(fn: () => Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A client: a browser context of its own, the fake GitHub behind it. */
async function client(query = ''): Promise<Page> {
  const session = await openSession();
  sessions.push(session);
  await session.context.route('https://api.github.com/**', github.handle);
  await session.page.goto(`${server.baseUrl}/index.html${query}`, { waitUntil: 'load' });
  await waitForAppReady(session.page);
  return session.page;
}

/** Run a File-menu entry of the Git module without waiting: its dialogs are answered after. */
async function run(page: Page, entry: string): Promise<void> {
  await page.evaluate((value) => {
    void (window as any).__LA_GRAM_UI__.runCommand({ command: 'module', value });
  }, `git:${entry}`);
}

/** Accept the open dialog as it stands (its primary button), after filling `fields`. */
async function answer(page: Page, fields: Record<string, string> = {}): Promise<void> {
  const open = page.locator('.la-dialog').last();
  await open.waitFor({ state: 'visible' });
  // That dialog, by its title: the next may open as soon as it closes.
  const dialog = page.locator(`.la-dialog[aria-label="${await open.getAttribute('aria-label')}"]`);
  for (const [name, value] of Object.entries(fields)) await dialog.locator(`[name="${name}"]`).fill(value);
  await dialog.locator('.la-button.primary').click();
  await dialog.waitFor({ state: 'detached' });
}

async function rename(page: Page, iri: string, name: string): Promise<void> {
  await page.evaluate(
    ([iri, name]) => {
      (window as any).__LA_GRAM_APP__.components.eventBus.emit('property-edited', {
        elementIri: iri,
        property: 'http://www.w3.org/2004/02/skos/core#prefLabel',
        value: name,
      });
    },
    [iri, name],
  );
}

async function nameOf(page: Page, iri: string): Promise<string[]> {
  return page.evaluate(
    ([iri, label]) =>
      (window as any).__LA_GRAM_APP__.components.store
        .getQuads({ termType: 'NamedNode', value: iri }, { termType: 'NamedNode', value: label })
        .map((q: any) => q.object.value),
    [iri, PREF_LABEL],
  );
}

beforeAll(async () => {
  server = await startStaticServer(WEB_DIST);
}, 60_000);

afterAll(async () => {
  for (const s of sessions) await s.close();
  if (server) await server.close();
}, 60_000);

describe('two clients saving the same bound file (Phase 1 of the Git collaboration plan)', () => {
  let a: Page;
  let b: Page;
  let c: Page;
  let billing: string;
  let portal: string;

  it('A makes a model and saves it to Git; B opens it from Git', async () => {
    a = await client();
    [billing, portal] = await a.evaluate((type) => {
      const app = (window as any).__LA_GRAM_APP__;
      app.newModel('Shop');
      const model = app.session.modelIri;
      const elements = app.components.elementManager;
      return [elements.createElement(type, model, { label: 'Billing' }).value, elements.createElement(type, model, { label: 'Portal' }).value];
    }, COMPONENT);
    await run(a, 'save');
    await answer(a, { repository: 'https://github.com/acme/arch' });
    await answer(a, { token: TOKEN });
    await until(async () => github.head !== '', 'the first commit');
    expect(github.file()).toContain('Billing');

    b = await client(`?git=${encodeURIComponent(`https://github.com/acme/arch/blob/main/${PATH}`)}`);
    await until(async () => (await nameOf(b, billing)).includes('Billing'), 'B to open the model');
  }, 120_000);

  it('both change different things; B’s save is refused, merged with A’s, and committed on main', async () => {
    await rename(a, billing, 'Billing (A)');
    await run(a, 'save');
    await answer(a); // the commit message
    await until(async () => github.file().includes('Billing (A)'), 'A’s commit');
    const afterA = github.head;

    await rename(b, portal, 'Portal (B)');
    await run(b, 'save');
    await answer(b); // the commit message
    await answer(b, { token: TOKEN });
    // Refused: the file moved on. The first choice is the merge.
    const chooser = b.locator('.la-dialog .la-choice-list');
    await chooser.waitFor({ state: 'visible' });
    expect(await chooser.locator('.la-choice').first().getAttribute('data-value')).toBe('merge');
    await chooser.locator('.la-choice[data-value="merge"]').click();
    await b.locator('.la-dialog .la-button.primary').click();

    await until(async () => github.head !== afterA, 'B’s merged commit');
    expect(github.refusals).toBe(1);
    expect(github.branchesMade).toBe(0);
    expect(github.file()).toContain('Billing (A)');
    expect(github.file()).toContain('Portal (B)');
    expect(await nameOf(b, billing)).toEqual(['Billing (A)']);
  }, 60_000);

  it('both rename the same element: a conflict, chosen in the Conflicts tab, then saved', async () => {
    await rename(b, billing, 'Billing (B2)');
    await run(b, 'save');
    await answer(b);
    await until(async () => github.file().includes('Billing (B2)'), 'B’s commit');

    await rename(a, billing, 'Billing (A2)');
    await run(a, 'save');
    await answer(a);
    const chooser = a.locator('.la-dialog .la-choice-list');
    await chooser.waitFor({ state: 'visible' });
    await chooser.locator('.la-choice[data-value="merge"]').click();
    await a.locator('.la-dialog .la-button.primary').click();

    const tab = a.locator('app-shell .tab[data-tab="conflicts"]');
    await tab.waitFor({ state: 'visible' });
    expect((await tab.innerText()).replace(/\s+/g, ' ')).toBe('Conflicts 1');
    const panel = a.locator('git-conflicts');
    // Until chosen, the model holds the version before either change — and the row names it so.
    expect(await nameOf(a, billing)).toEqual(['Billing (A)']);
    expect(await panel.locator('.conflict .name').first().innerText()).toBe('Billing (A)');
    expect(await panel.locator('.conflict .value').allInnerTexts()).toEqual(['“Billing (A2)” (en)', '“Billing (B2)” (en)']);

    await panel.locator('.conflict button[data-side="ours"]').click();
    expect(await nameOf(a, billing)).toEqual(['Billing (A2)']);
    expect(await panel.locator('.summary').innerText()).toBe('All chosen. Save to Git commits the merged model.');

    const before = github.head;
    await run(a, 'save');
    await answer(a);
    await until(async () => github.head !== before, 'A’s commit after choosing');
    expect(github.file()).toContain('Billing (A2)');
    expect(github.file()).not.toContain('Billing (B2)');
    expect(github.branchesMade).toBe(0);
    // Committed: the tab is gone.
    await tab.waitFor({ state: 'detached' });
  }, 60_000);

  it('review: a save to a new branch offers a pull request, described by element; the History tab shows the branch against main', async () => {
    await rename(a, portal, 'Portal (A3)');
    await run(a, 'save-as');
    await answer(a, { newBranch: 'la-gram/review', message: 'Rename Portal' });
    await until(async () => github.file('la-gram/review').includes('Portal (A3)'), 'the commit to the new branch');
    expect(github.file('main')).not.toContain('Portal (A3)');

    // Offered at once; its dialog titled by the branch's last commit, described by element.
    await answer(a); // Open pull request?
    const dialog = a.locator('.la-dialog[aria-label="Open pull request"]');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('[name="title"]').inputValue()).toBe('Rename Portal');
    const description = await dialog.locator('[name="description"]').inputValue();
    expect(description).toContain('**Changes by element:** 1 changed');
    expect(description).toContain('Name (en): “Portal (B)” → “Portal (A3)”');
    await answer(a);
    await until(async () => github.pulls.length === 1, 'the pull request');
    expect(github.pulls[0]).toMatchObject({ number: 1, title: 'Rename Portal', head: 'la-gram/review', base: 'main', body: description });
    // The fake host has written it; wait for the editor to receive that reply too.
    await a.locator('.la-toast', { hasText: 'Opened pull request #1 from la-gram/review into main' }).waitFor({ state: 'visible' });

    // Asked again: the one open is named, none opened.
    await run(a, 'review');
    await a.locator('.la-toast', { hasText: 'A pull request from la-gram/review into main is open already: #1 Rename Portal' }).waitFor({ state: 'visible' });
    expect(github.pulls).toHaveLength(1);

    // The History tab: the branch against main first, then the file's commits.
    await a.locator('app-shell .tab[data-tab="history"]').click();
    const history = a.locator('history-panel');
    const branch = history.locator('li[data-branch]');
    await branch.waitFor({ state: 'visible' });
    expect((await branch.locator('.message').innerText()).replace(/\s+/g, ' ')).toBe('Branch la-gram/review against main');
    expect(await history.locator('li[data-git] .message').first().innerText()).toContain('Rename Portal');
    await branch.click();
    const row = history.locator('model-diff-view li.change');
    await row.first().waitFor({ state: 'visible' });
    expect((await row.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(['~ Portal (A3) Application Component Name (en): “Portal (B)” → “Portal (A3)”']);
    await sessions[0]!.screenshot('git-history-branch');
  }, 60_000);

  it('Pull from Git works from the keyboard, creates no commit, and is one undoable change; a no-op adds no undo step', async () => {
    c = await client(`?git=${encodeURIComponent(`https://github.com/acme/arch/blob/main/${PATH}`)}`);
    await until(async () => (await nameOf(c, billing)).includes('Billing (A2)'), 'C to open main');
    const head = github.push(github.file().replace('Billing (A2)', 'Billing (pulled)'));
    const commits = github.commits.size;
    await c.locator('app-toolbar button[data-menu="file"]').click();
    const pull = c.locator('app-toolbar button[data-value="git:pull"]');
    expect(await pull.innerText()).toContain('Pull from Git');
    await pull.focus();
    await pull.press('Enter');
    await until(async () => (await nameOf(c, billing)).includes('Billing (pulled)'), 'the pulled label');
    expect(await c.evaluate(() => (window as any).__LA_GRAM_APP__.isDirty())).toBe(false);
    expect(github.head).toBe(head);
    expect(github.commits.size).toBe(commits);
    // Await the complete command here, so undo runs after the no-op has settled.
    await c.evaluate(() => (window as any).__LA_GRAM_UI__.runCommand({ command: 'module', value: 'git:pull' }));
    await c.evaluate(() => (window as any).__LA_GRAM_UI__.runCommand({ command: 'undo' }));
    expect(await nameOf(c, billing)).toEqual(['Billing (A2)']);
    expect(await c.evaluate(() => (window as any).__LA_GRAM_APP__.isDirty())).toBe(true);
    await c.evaluate(() => (window as any).__LA_GRAM_UI__.runCommand({ command: 'redo' }));
    expect(await nameOf(c, billing)).toEqual(['Billing (pulled)']);
    expect(await c.locator('.la-dialog').count()).toBe(0); // public pull needed no token
  }, 60_000);

  it('pull preserves disjoint local changes, even after saving to disk, and refreshes the Git history source', async () => {
    await rename(c, portal, 'Portal (local pull)');
    await c.evaluate(() => (window as any).__LA_GRAM_APP__.components.eventBus.emit('model-saved', { fileName: 'local.ttl' }));
    expect(await c.evaluate(() => (window as any).__LA_GRAM_APP__.isDirty())).toBe(false);
    await c.locator('app-shell .tab[data-tab="history"]').click();
    const head = github.push(github.file().replace('Billing (pulled)', 'Billing (pulled again)'));
    const commits = github.commits.size;
    await c.evaluate(() => (window as any).__LA_GRAM_UI__.runCommand({ command: 'module', value: 'git:pull' }));
    expect(await nameOf(c, billing)).toEqual(['Billing (pulled again)']);
    expect(await nameOf(c, portal)).toEqual(['Portal (local pull)']);
    expect(await c.evaluate(() => (window as any).__LA_GRAM_APP__.isDirty())).toBe(true);
    expect(github.head).toBe(head);
    expect(github.commits.size).toBe(commits);
    await c.locator(`history-panel li[data-git="${head}"]`).waitFor({ state: 'visible' });
  }, 60_000);

  it('pull conflicts can be chosen without committing; a later Save to Git commits those choices on the same branch', async () => {
    const head = github.push(github.file().replace('Portal (B)', 'Portal (remote pull)'));
    const commits = github.commits.size;
    const branches = github.branchesMade;
    await c.evaluate(() => (window as any).__LA_GRAM_UI__.runCommand({ command: 'module', value: 'git:pull' }));
    const panel = c.locator('git-conflicts');
    await panel.waitFor({ state: 'visible' });
    expect(await nameOf(c, portal)).toEqual(['Portal (B)']);
    expect(await panel.locator('.conflict .value').allInnerTexts()).toEqual(['“Portal (local pull)” (en)', '“Portal (remote pull)” (en)']);
    await sessions.at(-1)!.screenshot('git-pull-conflicts');
    await panel.locator('.conflict button[data-side="ours"]').click();
    expect(await nameOf(c, portal)).toEqual(['Portal (local pull)']);
    expect(github.head).toBe(head);
    expect(github.commits.size).toBe(commits);
    await run(c, 'save');
    await answer(c);
    await answer(c, { token: TOKEN });
    await until(async () => github.head !== head, 'explicit save after pull');
    expect(github.file()).toContain('Portal (local pull)');
    expect(github.branchesMade).toBe(branches);
    await panel.waitFor({ state: 'detached' });
  }, 60_000);
});
