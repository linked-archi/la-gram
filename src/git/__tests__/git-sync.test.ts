import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IRI } from '../../model-manager/vocabulary.js';
import { GitBindings, type GitBinding } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import { GitLocks } from '../git-locks.js';
import { destinationKey } from '../git-observation.js';
import type { GitPullContext } from '../git-pull.js';
import type { PersonalGitSettings } from '../git-save.js';
import { GitSync, type GitSyncStatus } from '../git-sync.js';
import { MemoryLocks } from './memory-locks.js';
import { MemoryStorage } from './memory-storage.js';
import { Repository } from './memory-repository.js';

const MODEL = 'https://example.org/model';
const PATH = 'models/shop.nt';
const label = (s: string, value: string) => `<https://example.org/${s}> <${IRI.prefLabel}> "${value}"@en .`;
const BASE = [`<${MODEL}> <${IRI.rdfType}> <${IRI.Model}> .`, label('a', 'A'), label('b', 'B')].sort();
const change = (s: string, value: string, lines = BASE) => lines.map((l) => l.startsWith(`<https://example.org/${s}> `) ? label(s, value) : l).sort();
const text = (lines: string[]) => lines.join('\n') + '\n';
const fixtures: Array<Awaited<ReturnType<typeof setup>>> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function setup(kind: 'github' | 'gitlab' = 'github', locks = new MemoryLocks().client()) {
  const storage = new MemoryStorage();
  const repo = new Repository(kind, PATH, text(BASE));
  const binding: GitBinding = { host: `${kind}.com`, provider: kind, apiBase: `https://${kind}.com/api`, repository: 'acme/arch',
    webUrl: `https://${kind}.com/acme/arch`, branch: 'main', path: PATH, commit: 'root', version: (await repo.readFile('root', PATH))!.version };
  const state = { model: [...BASE], modelIri: MODEL, visible: true, online: true, room: undefined as string | undefined,
    dirty: false, conflicts: 0, current: true, settings: {} as PersonalGitSettings, status: undefined as GitSyncStatus | undefined };
  const undo: string[][] = [];
  const ctx: GitPullContext = {
    modelIri: () => state.modelIri, modelLabel: () => 'Shop', serialize: vi.fn(() => text(state.model)),
    current: () => state.current, room: () => state.room,
    saved: vi.fn(() => { state.dirty = false; }), changed: vi.fn(() => { state.dirty = true; }), isDirty: () => state.dirty,
    tokens: new WebTokenStore(storage), bindings: new GitBindings(storage), provider: () => repo, report: vi.fn(),
    dialogs: { prompt: vi.fn(async () => null), form: vi.fn(async () => null), confirm: vi.fn(async () => false),
      choose: vi.fn(async () => null), info: vi.fn(async () => undefined), toast: vi.fn() },
    merge: { options: () => ({}), unresolved: () => state.conflicts, blankNodes: () => 0,
      replace: vi.fn((snapshot) => { undo.push(state.model); state.model = snapshot; }), clear: vi.fn(), conflicts: vi.fn() },
  };
  ctx.bindings.set(MODEL, binding);
  let busy = false;
  const sync = new GitSync({ context: ctx, settings: () => state.settings, visible: () => state.visible, online: () => state.online,
    locks, busy: () => busy, publish: (value) => { state.status = value; },
    run: async (operation, automatic) => {
      if (busy) return { ran: false, reason: 'busy' };
      busy = true;
      try { return await locks.run(destinationKey(ctx.bindings.get(state.modelIri)!), automatic, operation); }
      finally { busy = false; }
    } });
  const fixture = { repo, binding, ctx, state, sync, undo, locks };
  fixtures.push(fixture);
  sync.refresh();
  return fixture;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-18T12:00:00Z')); });
afterEach(async () => {
  for (const f of fixtures.splice(0)) f.sync.stop();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});

describe.each(['github', 'gitlab'] as const)('remote checks on %s', (kind) => {
  it('is off by default; a manual check observes only, even with auto-pull configured', async () => {
    const f = await setup(kind);
    const head = vi.spyOn(f.repo, 'branchHead');
    f.repo.push('main', change('a', 'Remote'));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(head).not.toHaveBeenCalled();
    f.state.settings = { checkIntervalMinutes: 1, autoPull: true };
    f.sync.refresh();
    await f.sync.check();
    expect(f.state.status).toMatchObject({ phase: 'incoming', incoming: true, local: false, lastChecked: Date.now() });
    expect(f.state.model).toEqual(BASE);
    expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
    expect(f.ctx.saved).not.toHaveBeenCalled();
    expect(f.ctx.changed).not.toHaveBeenCalled();
    expect(f.repo.made).toEqual([]);
    expect(f.ctx.dialogs.form).not.toHaveBeenCalled();
  });

  it('scheduled check-only mode retains the base, even for unrelated commits and serialization differences', async () => {
    const f = await setup(kind);
    f.repo.push('main', [...BASE].reverse());
    f.state.settings = { checkIntervalMinutes: 1 };
    f.sync.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.state.status).toMatchObject({ phase: 'current', incoming: false });
    expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
    f.repo.push('main', change('b', 'Remote'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.state.status?.incoming).toBe(true);
    expect(f.state.model).toEqual(BASE);
    expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
  });

  it('automatic pull applies a clean model once, advances its base and supports undo as a local change', async () => {
    const f = await setup(kind);
    const remote = change('a', 'Remote');
    const head = f.repo.push('main', remote);
    f.state.settings = { checkIntervalMinutes: 1, autoPull: true };
    f.sync.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.state.model).toEqual(remote);
    expect(f.undo).toEqual([BASE]);
    expect(f.ctx.bindings.get(MODEL)?.commit).toBe(head);
    expect(f.state.status).toMatchObject({ phase: 'current', incoming: false, local: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.undo).toHaveLength(1);
    f.state.model = f.undo.pop()!;
    f.sync.modelChanged();
    await vi.advanceTimersByTimeAsync(150);
    expect(f.state.status?.local).toBe(true);
    expect(f.ctx.bindings.get(MODEL)?.commit).toBe(head);
    expect(f.repo.made).toEqual([]);
  });

  it('does not auto-pull local changes, including ones saved only to disk', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Local');
    f.repo.push('main', change('b', 'Remote'));
    f.state.settings = { checkIntervalMinutes: 1, autoPull: true };
    f.sync.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.state.status).toMatchObject({ phase: 'incoming', incoming: true, local: true });
    expect(f.state.model).toEqual(change('a', 'Local'));
    expect(f.state.dirty).toBe(false); // checking must not change the app's local-file marker
    expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
    expect(f.undo).toEqual([]);
  });
});

it('waits until a check completes before scheduling another, and caches immutable files', async () => {
  const f = await setup();
  const gate = deferred<string>();
  const head = vi.spyOn(f.repo, 'branchHead').mockImplementationOnce(() => gate.promise);
  const files = vi.spyOn(f.repo, 'readFile');
  f.state.settings = { checkIntervalMinutes: 1 };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.state.status?.phase).toBe('checking');
  await vi.advanceTimersByTimeAsync(180_000);
  expect(head).toHaveBeenCalledTimes(1);
  gate.resolve('root');
  await vi.advanceTimersByTimeAsync(0);
  expect(f.state.status?.nextCheck).toBe(Date.now() + 60_000);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(head).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(head).toHaveBeenCalledTimes(2);
  expect(files).toHaveBeenCalledTimes(1);
});

it('keeps edits made during reads, and checks again at the final application boundary', async () => {
  const f = await setup();
  const head = f.repo.push('main', change('b', 'Remote'));
  const gate = deferred<string>();
  vi.spyOn(f.repo, 'branchHead').mockImplementationOnce(() => gate.promise);
  f.state.settings = { checkIntervalMinutes: 1, autoPull: true };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  f.state.model = change('a', 'Typed while reading');
  gate.resolve(head);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.state.model).toEqual(change('a', 'Typed while reading'));
  expect(f.state.status?.local).toBe(true);
  // A model event listener can also edit between the status snapshot and application.
  vi.mocked(f.ctx.serialize).mockReturnValueOnce(text(BASE)).mockReturnValue(text(change('a', 'Latest edit')));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.ctx.merge!.replace).not.toHaveBeenCalled();
  expect(f.ctx.bindings.get(MODEL)?.commit).toBe('root');
  expect(f.state.status?.local).toBe(true);
});

it.each(['reload', 'model', 'binding', 'stop', 'hidden', 'offline', 'room', 'settings'] as const)('invalidates an in-flight result on %s', async (transition) => {
  const f = await setup();
  const head = f.repo.push('main', change('a', 'Remote'));
  const gate = deferred<string>();
  vi.spyOn(f.repo, 'branchHead').mockImplementationOnce(() => gate.promise);
  f.state.settings = { checkIntervalMinutes: 1, autoPull: true };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  if (transition === 'model') f.state.modelIri = 'https://example.org/other';
  if (transition === 'binding') f.ctx.bindings.set(MODEL, { ...f.binding, path: 'other.nt' });
  if (transition === 'hidden') f.state.visible = false;
  if (transition === 'offline') f.state.online = false;
  if (transition === 'room') f.state.room = 'shared';
  if (transition === 'settings') f.state.settings = {};
  if (transition === 'stop') f.sync.stop();
  else f.sync.refresh(transition === 'reload');
  gate.resolve(head);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.state.model).toEqual(BASE);
  expect(f.ctx.bindings.get(MODEL)?.commit).toBe('root');
  expect(f.ctx.saved).not.toHaveBeenCalled();
});

it.each(['visible', 'online'] as const)('pauses while not %s, then performs only one overdue check', async (property) => {
  const f = await setup();
  const head = vi.spyOn(f.repo, 'branchHead');
  f.state.settings = { checkIntervalMinutes: 1 };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(30_000);
  f.state[property] = false;
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(head).not.toHaveBeenCalled();
  f.state[property] = true;
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(head).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(head).toHaveBeenCalledTimes(1);
});

it('has one automatic owner per destination, transfers ownership, and retains independent bases', async () => {
  const hub = new MemoryLocks();
  const a = await setup('github', hub.client());
  const b = await setup('github', hub.client());
  const first = vi.spyOn(a.repo, 'branchHead');
  const second = vi.spyOn(b.repo, 'branchHead');
  for (const f of [a, b]) { f.state.settings = { checkIntervalMinutes: 1 }; f.sync.refresh(); }
  await vi.advanceTimersByTimeAsync(60_000);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  expect(b.state.status?.message).toContain('Another tab');
  a.state.visible = false;
  a.sync.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(second).toHaveBeenCalledTimes(1);
  expect(a.ctx.bindings.get(MODEL)).toEqual(a.binding);
  expect(b.ctx.bindings.get(MODEL)).toEqual(b.binding);
});

it('the owner lock allows manual checks in another tab, while the operation lock prevents overlap', async () => {
  const hub = new MemoryLocks();
  const f = await setup('github', hub.client());
  const head = vi.spyOn(f.repo, 'branchHead');
  f.state.settings = { checkIntervalMinutes: 1 };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(0);
  const gate = deferred<void>();
  const manual = hub.client().run(destinationKey(f.binding), false, () => gate.promise);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(head).not.toHaveBeenCalled();
  expect(f.state.status?.message).toContain('operation');
  gate.resolve();
  await manual;
  await vi.advanceTimersByTimeAsync(1000);
  expect(head).toHaveBeenCalledTimes(1);
  const other = await setup('github', hub.client());
  await other.sync.check();
  expect(other.state.status?.phase).toBe('current');
});

it('without tab coordination, pauses automation but leaves manual check available', async () => {
  const f = await setup('github', new GitLocks(null));
  f.state.settings = { checkIntervalMinutes: 1 };
  f.sync.refresh();
  const head = vi.spyOn(f.repo, 'branchHead');
  await vi.advanceTimersByTimeAsync(120_000);
  expect(head).not.toHaveBeenCalled();
  expect(f.state.status).toMatchObject({ phase: 'paused', canCheck: true });
  await f.sync.check();
  expect(head).toHaveBeenCalledTimes(1);
  expect(f.state.status?.lastChecked).toBe(Date.now());
});

it('a denied lock API pauses automation but does not prevent a manual check', async () => {
  const locks = new GitLocks({ request: () => { throw new DOMException('Not allowed', 'SecurityError'); } } as unknown as LockManager);
  const f = await setup('github', locks);
  f.state.settings = { checkIntervalMinutes: 1 };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.state.status).toMatchObject({ phase: 'paused', canCheck: true });
  await f.sync.check();
  expect(f.state.status?.lastChecked).toBe(Date.now());
});

it('a failed operation is never executed again as a lock fallback', async () => {
  const locks = new MemoryLocks().client();
  const operation = vi.fn(async () => { throw new Error('write failed'); });
  await expect(locks.run('file', false, operation)).rejects.toThrow('write failed');
  expect(operation).toHaveBeenCalledTimes(1);
});

it('pauses for unresolved conflicts and pending branch merges, then resumes when resolved', async () => {
  const f = await setup();
  f.state.settings = { checkIntervalMinutes: 1, autoPull: true };
  f.state.conflicts = 1;
  f.sync.refresh();
  const head = vi.spyOn(f.repo, 'branchHead');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.state.status?.phase).toBe('conflicts');
  expect(head).not.toHaveBeenCalled();
  f.state.conflicts = 0;
  f.ctx.bindings.set(MODEL, { ...f.binding, update: { branch: 'topic', commit: 'other' } });
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(head).not.toHaveBeenCalled();
  expect(f.state.status?.message).toContain('branch merge');
  f.ctx.bindings.set(MODEL, f.binding);
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(head).toHaveBeenCalledTimes(1);
});

it('background authentication failures never prompt or retry until a manual action', async () => {
  const f = await setup();
  const head = vi.spyOn(f.repo, 'branchHead').mockRejectedValue(new GitError('not-found', 'Private repository'));
  f.state.settings = { checkIntervalMinutes: 1 };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(head).toHaveBeenCalledTimes(1);
  expect(f.ctx.dialogs.form).not.toHaveBeenCalled();
  expect(f.state.status?.phase).toBe('error');
  head.mockRejectedValueOnce(new GitError('not-found', 'Private repository')).mockResolvedValue('root');
  vi.mocked(f.ctx.dialogs.form).mockResolvedValue({ token: 'FAKE_READ_ONLY' });
  await f.sync.check();
  expect(f.ctx.dialogs.form).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(0); // the resumed scheduler acquires its owner lock
  expect(f.state.status?.phase).toBe('current');
});

it.each(['network', 'rate-limit', 'server'] as const)('backs off a %s failure, honors a later host retry, and recovers', async (kind) => {
  const f = await setup();
  const retryAt = Date.now() + 5 * 60_000;
  const head = vi.spyOn(f.repo, 'branchHead').mockRejectedValueOnce(new GitError(kind, 'Try later', 429, retryAt));
  f.state.settings = { checkIntervalMinutes: 1 };
  f.sync.refresh();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.state.status?.nextCheck).toBe(retryAt);
  await vi.advanceTimersByTimeAsync(239_999);
  expect(head).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(head).toHaveBeenCalledTimes(2);
  expect(f.state.status?.phase).toBe('current');
  expect(f.ctx.dialogs.form).not.toHaveBeenCalled();
});

it('does not mutate on missing/invalid files or denied host policy', async () => {
  const f = await setup();
  const head = f.repo.push('main', change('a', 'Remote'));
  f.repo.commits.get(head)!.files.set(PATH, 'invalid RDF');
  await f.sync.check();
  expect(f.state.status?.phase).toBe('error');
  expect(f.state.model).toEqual(BASE);
  expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
  f.ctx.provider = () => { throw new GitError('forbidden', 'Host not allowed'); };
  await f.sync.check();
  expect(f.state.status?.message).toContain('Host not allowed');
  expect(f.repo.made).toEqual([]);
});

it('debounces local-status snapshots and never calls commit history for checks', async () => {
  const f = await setup();
  const history = vi.spyOn(f.repo, 'fileCommits');
  await f.sync.check();
  vi.mocked(f.ctx.serialize).mockClear();
  for (let i = 0; i < 50; i++) { f.state.model = change('a', `Edit ${i}`); f.sync.modelChanged(); }
  expect(f.ctx.serialize).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(f.ctx.serialize).toHaveBeenCalledTimes(1);
  expect(f.state.status?.phase).toBe('local');
  expect(history).not.toHaveBeenCalled();
});
