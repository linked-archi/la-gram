// @vitest-environment jsdom

/**
 * The Git module in the mounted UI (Req 18.1, 18.6, 18.8): its File-menu
 * entries, a save through them to a GitHub repository (the network stubbed),
 * the model clean after, File → Modules…, and stopping.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataFactory } from 'n3';
import { createApp, type App } from '../../app.js';
import { mountUi, type MountedUi } from '../../ui/mount-ui.js';
import type { Dialogs, FormField, FormOptions, FormValues } from '../../ui/dialogs.js';
import { installJsdomSvgSupport } from '../../ui/__tests__/jsdom-svg-support.js';
import { startGitStorage, type GitStorage } from '../module.js';
import { fromBase64, type RestProvider } from '../providers/provider.js';
import { parseRepositoryLink } from '../link.js';
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
  { method: 'GET', url: 'https://api.github.com/user', body: { html_url: 'https://github.com/ada', login: 'ada', name: 'Ada', email: null } },
  { method: 'GET', url: GH, body: { default_branch: 'main' } },
  { method: 'GET', url: /\/contents\/models\/.*\?ref=main$/, status: 404, body: { message: 'Not Found' } },
  { method: 'PUT', url: /\/contents\/models\//, status: 201, body: { content: { sha: 'blob1' }, commit: { sha: 'abc1234def', html_url: 'https://github.com/acme/arch/commit/abc1234def' } } },
  {
    method: 'GET',
    url: `${GH}/commits?sha=main&path=models%2Fshop-floor.ttl&per_page=100&page=1`,
    body: [
      {
        sha: 'abc1234def',
        html_url: 'https://github.com/acme/arch/commit/abc1234def',
        parents: [],
        commit: { message: 'Add Shop Floor', author: { name: 'Ada', date: '2026-11-05T10:00:00Z' } },
      },
    ],
  },
]);
let beforeHeadRead: (() => Promise<void>) | undefined;

/** The host, and the file as last committed — read back by Open from Git. */
const fetchFn: typeof host.fetch = async (url, init) => {
  if (url === `${GH}/branches/main`) {
    await beforeHeadRead?.();
    return new Response(JSON.stringify({ commit: { sha: 'abc1234def' } }), { status: 200 });
  }
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
    expect(entries()).toEqual(['git:open Open from Git… [GitHub, GitLab]', 'git:save Save to Git… [GitHub, GitLab]']);
    expect(ui.appToolbar.fileMenuItems().map((i) => i.section)).toEqual(['open', 'save']);
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

  it('the account the token acts for: read once, the one edits name; commits written by You (Req 9.16, 18.29)', async () => {
    await vi.waitFor(() => expect(app.gitAccount).toEqual({ url: 'https://github.com/ada', username: 'ada', name: 'Ada' }));
    expect(host.calls.filter((c) => c.url === 'https://api.github.com/user')).toHaveLength(1);
    expect(app.currentEditor()?.account).toEqual({ url: 'https://github.com/ada', username: 'ada' });
    // Nobody in You: the commit is the token owner's.
    expect(host.calls.find((c) => c.method === 'PUT')!.body).not.toHaveProperty('author');
    const before = app.editor;
    try {
      app.editor = { name: 'Ada Lovelace', email: 'ada@example.org' };
      const provider = git.context.provider(parseRepositoryLink('https://github.com/acme/arch'), TOKEN) as RestProvider;
      expect(provider.commitAuthor?.()).toEqual({ name: 'Ada Lovelace', email: 'ada@example.org' });
      expect(host.calls.filter((c) => c.url === 'https://api.github.com/user')).toHaveLength(1);
    } finally {
      app.editor = before;
    }
  });

  it('Model settings shows where the model is kept in Git, and the account its edits name, to copy (Req 18.30)', async () => {
    forms.push(null);
    await ui.runCommand({ command: 'model-settings' });
    const [title, fields] = vi.mocked(ui.dialogs.form).mock.calls.at(-1)!;
    expect(title).toBe('Model settings');
    const git = fields.slice(fields.findIndex((f) => f.name === 'git'));
    expect(git.map((f) => [f.label, f.value ?? null, f.readOnly ?? false])).toEqual([
      ['Git', null, false],
      ['Address', 'https://github.com/acme/arch/blob/main/models/shop-floor.ttl', true],
      ['Your Git account', 'ada · https://github.com/ada', true],
    ]);
    expect(git.map((f) => f.hint)).toEqual([
      'Kept in acme/arch, on branch main.',
      'The file models/shop-floor.ttl, last read or written at commit abc1234d. File › Open from Git… opens it from this address.',
      'Recorded with your edits, beside your name from File › Settings… › You.',
    ]);
    // The address is what Open from Git… reads back as the same file.
    expect(parseRepositoryLink(String(git[1].value))).toMatchObject({ repository: 'acme/arch', branch: 'main', path: 'models/shop-floor.ttl' });
  });

  it('bound now: Save to Git names where, and Save to Git as…, Update from main… and Open merge request… are offered', () => {
    expect(entries()).toEqual([
      'git:open Open from Git… [GitHub, GitLab]',
      'git:save Save to Git [acme/arch · main]',
      'git:save-as Save to Git as… [another branch or file]',
      'git:pull Pull from Git [acme/arch · main]',
      'git:check Check for remote changes [read without changing the model]',
      'git:update Update from main… [merge another branch into main]',
      'git:review Open merge request… [a pull request from main]',
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

  it('the History tab: the bound file’s Git commits beside the checkpoints, read when the tab opens', async () => {
    ui.shell.showTab('history');
    const history = ui.historyPanel;
    await vi.waitFor(() => expect(history.shadowRoot!.querySelector('li[data-git="abc1234def"]')).not.toBeNull());
    expect(history.git?.where).toBe('acme/arch · main · models/shop-floor.ttl');
    expect(history.shadowRoot!.querySelector('li[data-git="abc1234def"] .message')!.textContent).toContain('Add Shop Floor');
    ui.shell.showTab('properties');
  });

  it('pulls through the menu without a write, and is not offered in a shared room', async () => {
    const puts = host.calls.filter((c) => c.method === 'PUT').length;
    await ui.runCommand({ command: 'module', value: 'git:pull' });
    expect(app.session.modelLabel()).toBe('Shop Floor');
    expect(app.isDirty()).toBe(false);
    expect(host.calls.filter((c) => c.method === 'PUT')).toHaveLength(puts);
    app.collaborationRoom = 'shared';
    expect(entries().some((entry) => entry.startsWith('git:pull'))).toBe(false);
    app.collaborationRoom = undefined;
  });

  it('Check opens the Git status tab, leaves the model and binding intact, and does not read history', async () => {
    const binding = git.context.bindings.get(app.session.modelIri!);
    const before = git.context.serialize('turtle');
    const historyReads = host.calls.filter((call) => call.url.includes('/commits?')).length;
    await ui.runCommand({ command: 'module', value: 'git:check' });
    expect(ui.shell.bottomTab).toBe('git-sync');
    const panel = ui.shell.querySelector('git-sync-status')!;
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain('No local or incoming model changes.');
    expect(panel.shadowRoot?.textContent).toContain('acme/arch · main · models/shop-floor.ttl');
    expect(git.context.serialize('turtle')).toBe(before);
    expect(git.context.bindings.get(app.session.modelIri!)).toEqual(binding);
    expect(host.calls.filter((call) => call.url.includes('/commits?'))).toHaveLength(historyReads);
    expect(panel.status?.lastChecked).toBeTypeOf('number');
    expect(panel.status?.intervalMinutes).toBe(0);
    ui.shell.showTab('properties');
  });

  it('Model settings asks before moving a model saved to Git; moved, the model stays bound to its file', async () => {
    const model = app.session.modelIri!;
    const binding = git.context.bindings.get(model)!;
    const confirm = vi.mocked(ui.dialogs.confirm);
    const target = 'https://acme.com/ea/shop-floor/';

    // Asked, naming the file; answered no, nothing moves.
    confirm.mockResolvedValueOnce(false);
    forms.push({ namespace: target });
    await ui.runCommand({ command: 'model-settings' });
    const [title, message, options] = confirm.mock.calls.at(-1)!;
    expect([title, options]).toEqual(['Model saved to Git', { confirmLabel: 'Move' }]);
    expect(message).toContain('This model is saved to Git: acme/arch · main · models/shop-floor.ttl. Moving it to https://acme.com/ea/shop-floor/ renames every IRI in it');
    expect(app.session.modelIri).toBe(model);

    // Moved: bound to the same file, which still has the model under its old IRI.
    forms.push({ namespace: target });
    await ui.runCommand({ command: 'model-settings' });
    expect(app.session.modelIri).toBe(`${target}model`);
    expect(git.context.bindings.get(model)).toBeUndefined();
    expect(git.context.bindings.get(`${target}model`)).toEqual({ ...binding, movedFrom: model });
    expect(entries()).toContain('git:save Save to Git [acme/arch · main]');

    // Moved back, as it was: what the file has.
    const namespace = model.slice(0, -'model'.length);
    forms.push({ namespace });
    await ui.runCommand({ command: 'model-settings' });
    expect(app.session.modelIri).toBe(model);
    expect(git.context.bindings.get(model)).toEqual(binding);
  });

  it('rejects overlapping Git actions and discards a pull after reloading the same model', async () => {
    const snapshot = git.context.serialize('turtle');
    const model = app.session.modelIri;
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const reading = new Promise<void>((resolve) => { started = resolve; });
    beforeHeadRead = async () => { started(); await waiting; };
    const pull = ui.runCommand({ command: 'module', value: 'git:pull' });
    try {
      await reading;
      const promptsBefore = vi.mocked(ui.dialogs.prompt).mock.calls.length;
      await ui.runCommand({ command: 'module', value: 'git:save' });
      expect(ui.dialogs.prompt).toHaveBeenCalledTimes(promptsBefore);
      await ui.openModelText(snapshot, 'shop-floor.ttl');
      expect(app.session.modelIri).toBe(model);
    } finally {
      beforeHeadRead = undefined;
      release();
    }
    await pull;
    expect(ui.dialogs.toast).toHaveBeenCalledWith(expect.stringContaining('Pull discarded'), 'info');
    expect(app.isDirty()).toBe(false);
  });

  it('the token is not in the page’s storage (not remembered), nor in the address', () => {
    expect(storage.dump()).toContain('acme/arch'); // the binding is kept…
    expect(storage.dump()).not.toContain(TOKEN); // …the token is not
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('File › Settings…: the Git section, its tokens kept; applied at once, to the next Save dialog', async () => {
    expect(ui.appToolbar.settingsMenu).toBe(true);
    forms.push({ 'git.folder': 'architecture', 'git.message': 'arch: {action} {model}', [`git.forget:github.com`]: true });
    await ui.runCommand({ command: 'settings' });
    const [title, fields] = vi.mocked(ui.dialogs.form).mock.calls.at(-1)!;
    expect(title).toBe('Settings');
    expect(fields.filter((f) => f.type === 'section').map((f) => f.label)).toEqual(['Metamodels', 'You', 'Git storage']);
    expect(fields.map((f) => f.name)).toContain('git.forget:github.com');
    expect(JSON.parse(storage.getItem('la-gram:settings')!)).toEqual({
      git: { folder: 'architecture', message: 'arch: {action} {model}', rememberByDefault: false },
      // The account the host reported: not a secret, kept with the settings, not with the tokens.
      'git-accounts': { accounts: { 'github.com': { url: 'https://github.com/ada', username: 'ada', name: 'Ada' } }, last: 'github.com' },
    });
    expect(await git.context.tokens.get('github.com')).toBeUndefined();

    forms.push(null);
    await ui.runCommand({ command: 'module', value: 'git:save-as' });
    const save = vi.mocked(ui.dialogs.form).mock.calls.at(-1)![1];
    expect(save.find((f) => f.name === 'message')?.value).toBe('arch: Update Shop Floor');
  });

  it('File › Settings… switches modules too, in a section of their own', async () => {
    const toggle = vi.fn(async () => undefined);
    ui.setModuleSwitches(() => [{ id: 'git', label: 'Git storage', detail: 'commits', enabled: true }], toggle);
    forms.push({ 'modules.git': false });
    await ui.runCommand({ command: 'settings' });
    const fields = vi.mocked(ui.dialogs.form).mock.calls.at(-1)![1];
    expect(fields.filter((f) => f.type === 'section').map((f) => f.label)).toEqual(['Metamodels', 'You', 'Git storage', 'Modules']);
    expect(toggle).toHaveBeenCalledWith('git', false);
  });

  it('a merge’s conflicts: the Conflicts tab, with how many are left; a choice changes the model; done, the tab goes', async () => {
    const merge = git.context.merge!;
    const model = app.session.modelIri!;
    const name = (label: string) => `<${model}> <http://www.w3.org/2004/02/skos/core#prefLabel> "${label}"@en .`;
    const held = [name('Shop Floor')];
    merge.conflicts(
      [{ kind: 'value', subjects: [model], predicate: 'http://www.w3.org/2004/02/skos/core#prefLabel', language: 'en', held, options: { ours: held, theirs: [name('Shop Floor (theirs)')] } }],
      { branch: 'main', commit: 'abc1234def' },
    );
    expect(ui.shell.moduleTabs).toEqual([{ id: 'git-sync', label: 'Git' }, { id: 'conflicts', label: 'Conflicts' }]);
    expect(ui.shell.bottomTab).toBe('conflicts');
    expect(ui.shell.tabBadges['conflicts']).toBe('1');
    expect(merge.unresolved()).toBe(1);

    const panel = ui.shell.querySelector('git-conflicts')!;
    await panel.updateComplete;
    (panel.shadowRoot!.querySelector('button[data-side="theirs"]') as HTMLButtonElement).click();
    expect(app.session.modelLabel()).toBe('Shop Floor (theirs)');
    expect(merge.unresolved()).toBe(0);
    expect(ui.shell.tabBadges['conflicts']).toBeUndefined();
    // Changed back to mine.
    await panel.updateComplete;
    (panel.shadowRoot!.querySelector('button[data-side="ours"]') as HTMLButtonElement).click();
    expect(app.session.modelLabel()).toBe('Shop Floor');

    merge.clear();
    expect(ui.shell.moduleTabs).toEqual([{ id: 'git-sync', label: 'Git' }]);
    expect(ui.shell.querySelector('git-conflicts')).toBeNull();
    expect(ui.shell.bottomTab).toBe('properties');
  });

  it('another model opened: its conflicts are not shown', () => {
    const merge = git.context.merge!;
    merge.conflicts([{ kind: 'route', subjects: ['urn:x'], held: [], options: { ours: [], theirs: [] } }], { branch: 'main', commit: 'abc' });
    expect(merge.unresolved()).toBe(1);
    app.newModel('Another');
    expect(merge.unresolved()).toBe(0);
    expect(ui.shell.moduleTabs).toEqual([]);
  });

  it('counts the triples with a blank node, for the warning before a save', () => {
    expect(git.context.merge!.blankNodes()).toBe(0);
    app.components.store.addQuads([
      DataFactory.quad(DataFactory.namedNode('urn:a'), DataFactory.namedNode('urn:p'), DataFactory.blankNode('b1')) as never,
    ]);
    expect(git.context.merge!.blankNodes()).toBe(1);
  });

  it('stopped: its entries and History source are gone, and an in-flight pull cannot mark the model saved', async () => {
    const put = host.calls.filter((c) => c.method === 'PUT').at(-1)!;
    await ui.openModelText(fromBase64(String(put.body?.['content'])), 'shop-floor.ttl');
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const reading = new Promise<void>((resolve) => { started = resolve; });
    beforeHeadRead = async () => { started(); await waiting; };
    const pull = ui.runCommand({ command: 'module', value: 'git:pull' });
    await reading;
    git.stop();
    app.components.eventBus.emit('model-changed', { origin: 'test' });
    beforeHeadRead = undefined;
    release();
    await pull;
    expect(app.isDirty()).toBe(true);
    expect(entries()).toEqual([]);
    expect(ui.historyPanel.git).toBeUndefined();
    // Nor does Model settings show a Git part.
    forms.push(null);
    await ui.runCommand({ command: 'model-settings' });
    expect(vi.mocked(ui.dialogs.form).mock.calls.at(-1)![1].map((f) => f.name)).toEqual(['label', 'namespace', 'prefix', 'rename']);
  });
});
