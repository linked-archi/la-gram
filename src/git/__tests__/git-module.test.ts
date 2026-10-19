// @vitest-environment jsdom

/**
 * The Git module in the mounted UI (Req 18.1, 18.6, 18.8): its File-menu
 * entries, a save through them to a GitHub repository (the network stubbed),
 * the model clean after, File → Modules…, and stopping.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp, type App } from '../../app.js';
import { mountUi, type MountedUi } from '../../ui/mount-ui.js';
import type { Dialogs, FormField, FormOptions, FormValues } from '../../ui/dialogs.js';
import { installJsdomSvgSupport } from '../../ui/__tests__/jsdom-svg-support.js';
import { startGitStorage, type GitStorage } from '../module.js';
import { fromBase64 } from '../providers/provider.js';
import { fakeHost } from './fake-host.js';
import { MemoryStorage } from './memory-storage.js';

installJsdomSvgSupport();

const TOKEN = 'github_pat_TEST_0123456789';
const GH = 'https://api.github.com/repos/acme/arch';

let app: App;
let ui: MountedUi;
let git: GitStorage;
const forms: Array<FormValues | null> = [];
const prompts: Array<string | null> = [];
const host = fakeHost([
  { method: 'GET', url: GH, body: { default_branch: 'main' } },
  { method: 'GET', url: /\/contents\/models\/.*\?ref=main$/, status: 404, body: { message: 'Not Found' } },
  { method: 'PUT', url: /\/contents\/models\//, status: 201, body: { content: { sha: 'blob1' }, commit: { sha: 'abc1234def', html_url: 'https://github.com/acme/arch/commit/abc1234def' } } },
]);

/** The host, and the file as last committed — read back by Open from Git. */
const fetchFn: typeof host.fetch = async (url, init) => {
  if (url === `${GH}/branches/main`) return new Response(JSON.stringify({ commit: { sha: 'abc1234def' } }), { status: 200 });
  if (url === `${GH}/contents/models/shop-floor.ttl?ref=abc1234def`) {
    const put = host.calls.filter((c) => c.method === 'PUT').at(-1);
    return new Response(JSON.stringify({ type: 'file', sha: 'blob1', size: 1, encoding: 'base64', content: put?.body?.['content'] }), { status: 200 });
  }
  return host.fetch(url, init);
};

// Node's own `localStorage` shadows jsdom's here; a store in memory stands in.
const storage = new MemoryStorage();

beforeAll(async () => {
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', fetchFn);
  app = await createApp({ assetMode: 'offline', validationDelayMs: 0 });
  const dialogs: Dialogs = {
    prompt: vi.fn(async () => (prompts.length ? prompts.shift()! : null)),
    form: vi.fn(async (_title: string, fields: FormField[], options?: FormOptions) => {
      const answer = forms.length ? forms.shift()! : {};
      if (answer === null) return null;
      const values: FormValues = { ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...answer };
      const problem = options?.validate?.(values);
      if (problem) throw new Error(`form rejected: ${problem}`);
      return values;
    }),
    confirm: vi.fn(async () => true),
    choose: vi.fn(async () => null),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  const root = document.createElement('div');
  document.body.append(root);
  ui = mountUi(app, root, { dialogs });
  app.announceLoadedMetamodel();
  app.newModel('Shop Floor');
  git = await startGitStorage(app, ui);
}, 60_000);

afterAll(() => {
  ui?.dispose();
  vi.unstubAllGlobals();
});

const entries = () => ui.appToolbar.fileMenuItems().map((i) => `${i.command} ${i.label}${i.hint ? ` [${i.hint}]` : ''}`);

describe('the Git module in the File menu', () => {
  it('offers Open from Git… beside Open, Save to Git… beside Save', () => {
    expect(entries()).toEqual([
      'git:open Open from Git… [GitHub, GitLab]',
      'git:save Save to Git… [GitHub, GitLab]',
      'git:forget-token Forget a Git token…',
    ]);
    expect(ui.appToolbar.fileMenuItems().map((i) => i.section)).toEqual(['open', 'save', 'save']);
  });

  it('commits the model to GitHub, and the model is clean after', async () => {
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    expect(app.isDirty()).toBe(true);
    forms.push({ repository: 'https://github.com/acme/arch' }, { token: TOKEN });
    await ui.runCommand({ command: 'module', value: 'git:save' });

    const put = host.calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe(`${GH}/contents/models/shop-floor.ttl`);
    expect(put.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    const text = fromBase64(String(put.body?.['content']));
    expect(text).toContain('Shop Floor');
    expect(text).not.toContain(TOKEN);
    expect(app.isDirty()).toBe(false);
  });

  it('bound now: Save to Git names where, and Save to Git as… is offered', () => {
    expect(entries()).toEqual([
      'git:open Open from Git… [GitHub, GitLab]',
      'git:save Save to Git [acme/arch · main]',
      'git:save-as Save to Git as… [another branch or file]',
      'git:forget-token Forget a Git token…',
    ]);
  });

  it('Open from Git… opens the file it committed, and the model is bound at that commit', async () => {
    app.newModel('Something else');
    expect(app.session.modelLabel()).toBe('Something else');
    forms.push({ repository: 'https://github.com/acme/arch/blob/main/models/shop-floor.ttl' });
    await ui.runCommand({ command: 'module', value: 'git:open' });
    expect(app.session.modelLabel()).toBe('Shop Floor');
    expect(app.isDirty()).toBe(false);
    expect(entries()).toContain('git:save Save to Git [acme/arch · main]');
  });

  it('the token is not in the page’s storage (not remembered), nor in the address', () => {
    expect(storage.dump()).toContain('acme/arch'); // the binding is kept…
    expect(storage.dump()).not.toContain(TOKEN); // …the token is not
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('File → Modules… switches it', async () => {
    const toggle = vi.fn(async () => undefined);
    ui.setModuleSwitches(() => [{ id: 'git', label: 'Git storage', detail: 'commits', enabled: true }], toggle);
    expect(ui.appToolbar.modulesMenu).toBe(true);
    forms.push({ git: false });
    await ui.runCommand({ command: 'modules' });
    expect(toggle).toHaveBeenCalledWith('git', false);
  });

  it('stopped: its entries are gone', () => {
    git.stop();
    expect(entries()).toEqual([]);
  });
});
