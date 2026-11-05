/**
 * Two la-gram clients saving the same bound file (the Git collaboration plan,
 * Phase 1): the second save is refused, *Merge with the newer version* combines
 * the two, and the commit lands on the same branch — no new branch. Then a real
 * conflict, chosen in the Conflicts tab and saved.
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

/** GitHub's contents API for one repository and one file, in memory. */
class FakeGitHub {
  readonly commits = new Map<string, string>();
  head = '';
  refusals = 0;
  branchesMade = 0;
  private n = 0;

  blob(text: string): string {
    let h = 7;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `blob${text.length}x${h}`;
  }

  file(): string {
    return this.commits.get(this.head) ?? '';
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
    const at = url.pathname.replace(/^\/repos\/acme\/arch/, '');
    if (method === 'GET' && at === '') return reply(200, { default_branch: 'main' });
    if (method === 'GET' && at === '/branches/main') {
      return this.head ? reply(200, { commit: { sha: this.head } }) : reply(404, { message: 'Branch not found' });
    }
    if (at === `/contents/${PATH}` && method === 'GET') {
      const ref = url.searchParams.get('ref');
      const text = this.commits.get(ref === 'main' ? this.head : (ref ?? ''));
      if (text === undefined) return reply(404, { message: 'Not Found' });
      return reply(200, { type: 'file', sha: this.blob(text), size: text.length, encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    if (at === `/contents/${PATH}` && method === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}') as { sha?: string; content: string; branch: string };
      if (body.branch !== 'main') this.branchesMade++;
      const current = this.head ? this.blob(this.file()) : undefined;
      if (body.sha !== current) {
        this.refusals++;
        return reply(409, { message: `${PATH} does not match ${body.sha}` });
      }
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      const sha = `c${++this.n}`.padEnd(40, '0');
      this.commits.set(sha, text);
      this.head = sha;
      return reply(body.sha ? 200 : 201, { content: { sha: this.blob(text) }, commit: { sha, html_url: `https://github.com/acme/arch/commit/${sha}` } });
    }
    if (at.startsWith('/git/refs')) this.branchesMade++;
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
});
