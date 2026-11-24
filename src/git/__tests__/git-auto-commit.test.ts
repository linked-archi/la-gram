import { afterEach, describe, expect, it, vi } from 'vitest';
import { IRI } from '@linked-archi/kernel/model-manager/vocabulary.js';
import { snapshotOfText } from '@linked-archi/kernel/model-manager/model-merge.js';
import { AutoCommitStore, autoCommitKey } from '../auto-commit-settings.js';
import { GitBindings, type GitBinding } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import { autoCommit, type AutoCommitContext } from '../git-auto-commit.js';
import { GitLocks } from '../git-locks.js';
import { destinationKey, ObsoleteGitRead } from '../git-observation.js';
import type { GitPullContext } from '../git-pull.js';
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
const controllers: GitSync[] = [];
afterEach(() => { controllers.splice(0).forEach((s) => s.stop()); vi.useRealTimers(); });

async function setup(kind: 'github' | 'gitlab' = 'github') {
  const storage = new MemoryStorage();
  const store = new AutoCommitStore(storage);
  const repo = new Repository(kind, PATH, text(BASE));
  const binding: GitBinding = { host: `${kind}.com`, provider: kind, apiBase: `https://${kind}.com/api`, repository: 'acme/arch',
    webUrl: `https://${kind}.com/acme/arch`, branch: 'main', path: PATH, commit: 'root', version: (await repo.readFile('root', PATH))!.version };
  const state = { model: [...BASE], modelIri: MODEL, active: true, canWrite: true, revision: 0, conflicts: 0, dirty: false, room: undefined as string | undefined };
  const ctx: GitPullContext = {
    modelIri: () => state.modelIri, modelLabel: () => 'Shop', serialize: () => text(state.model),
    current: () => state.active, room: () => state.room, personal: () => ({ message: '{action} {model} on {branch}: {path}' }),
    saved: vi.fn(() => { state.dirty = false; }), changed: vi.fn(() => { state.dirty = true; }), isDirty: () => state.dirty,
    tokens: new WebTokenStore(storage), bindings: new GitBindings(storage), provider: () => repo, report: vi.fn(),
    dialogs: { prompt: vi.fn(async () => null), form: vi.fn(async () => null), confirm: vi.fn(async () => false),
      choose: vi.fn(async () => null), info: vi.fn(async () => undefined), toast: vi.fn() },
    merge: { options: () => ({}), unresolved: () => state.conflicts, blankNodes: () => 0,
      replace: vi.fn((snapshot) => { state.model = snapshot; }), clear: vi.fn(), conflicts: vi.fn((entries) => { state.conflicts = entries.length; }) },
  };
  ctx.bindings.set(MODEL, binding);
  await ctx.tokens.set(binding.host, 'FAKE_TOKEN_TEST_ONLY', false);
  const key = autoCommitKey(MODEL, binding);
  store.set(key, { mode: 'idle', idleMinutes: 1, intervalMinutes: 5 });
  const deps: AutoCommitContext = { context: ctx, store, stamp: 'editor:1', active: () => state.active,
    canWrite: () => state.canWrite, revision: () => state.revision, observed: vi.fn(), committed: vi.fn() };
  return { storage, store, repo, binding, key, state, ctx, deps, run: () => autoCommit(deps) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe.each(['github', 'gitlab'] as const)('auto-commit on %s', (kind) => {
  it('compares the Git base even after a local file save, and uses immutable text, version and template', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Local');
    const write = vi.spyOn(f.repo, 'commitFile');
    await f.run();
    expect(write).toHaveBeenCalledWith({ branch: 'main', path: PATH, text: text(f.state.model), expectedVersion: f.binding.version,
      message: 'Update Shop on main: models/shop.nt' });
    expect(f.repo.made).toHaveLength(1);
    expect(f.ctx.bindings.get(MODEL)?.commit).toBe(f.repo.made[0]!.commit);
    expect(f.ctx.saved).toHaveBeenCalledOnce();
    expect(f.store.pending(f.key)).toBeUndefined();
    expect(f.ctx.dialogs.form).not.toHaveBeenCalled();
    expect(f.ctx.dialogs.confirm).not.toHaveBeenCalled();
    expect(f.repo.requests).toEqual([]);
    await f.run();
    expect(f.repo.made).toHaveLength(1);
  });

  it('skips undo-to-base, serialization differences and clean models with incoming changes', async () => {
    const f = await setup(kind);
    f.state.model = BASE.slice().reverse();
    f.state.dirty = true;
    f.repo.push('main', change('b', 'Remote'));
    await f.run();
    expect(f.repo.made).toEqual([]);
    expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
    expect(f.ctx.saved).not.toHaveBeenCalled();
  });

  it('merges disjoint changes before writing; the model and binding match the submitted result', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Local');
    const head = f.repo.push('main', change('b', 'Remote'));
    await f.run();
    expect(f.state.model).toEqual(change('a', 'Local', change('b', 'Remote')));
    expect(snapshotOfText(f.repo.fileAt('main')!, PATH)).toEqual(f.state.model);
    expect(f.repo.made[0]!.parents).toEqual([head]);
    expect(f.ctx.merge!.replace).toHaveBeenCalledOnce();
  });

  it('pauses conflicts without activating a tab or committing the held values', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Local');
    f.repo.push('main', change('a', 'Remote'));
    await f.run();
    expect(f.repo.made).toEqual([]);
    expect(f.state.conflicts).toBeGreaterThan(0);
    expect(f.store.get(f.key).paused).toContain('Conflicts tab');
    expect(vi.mocked(f.ctx.merge!.conflicts).mock.calls[0]![2]).toBe(false);
    expect(new AutoCommitStore(f.storage).get(f.key).paused).toContain('Conflicts tab');
  });

  it('reconciles a version conflict before retrying and keeps both people’s edits', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Local');
    f.repo.beforeCommit = () => { f.repo.push('main', change('b', 'Late remote')); };
    await f.run();
    expect(f.repo.made).toHaveLength(1);
    expect(snapshotOfText(f.repo.fileAt('main')!, PATH)).toEqual(change('a', 'Local', change('b', 'Late remote')));
  });

  it('keeps edits and undo during a write dirty while recording exactly the sent snapshot', async () => {
    const f = await setup(kind);
    const submitted = change('a', 'Submitted');
    f.state.model = submitted;
    f.repo.beforeCommit = () => { f.state.model = [...BASE]; f.state.revision++; };
    expect(await f.run()).toBe(0);
    expect(snapshotOfText(f.repo.fileAt('main')!, PATH)).toEqual(submitted);
    expect(f.state.model).toEqual(BASE);
    expect(f.state.dirty).toBe(true);
    expect(f.ctx.saved).not.toHaveBeenCalled();
  });

  it('confirms a lost response without another commit, then requires explicit resume', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Submitted');
    const commit = f.repo.commitFile.bind(f.repo);
    vi.spyOn(f.repo, 'commitFile').mockImplementationOnce(async (change) => { await commit(change); throw new GitError('network', 'Lost response'); });
    await f.run();
    expect(f.repo.made).toHaveLength(1);
    expect(f.ctx.bindings.get(MODEL)?.commit).toBe(f.repo.made[0]!.commit);
    expect(f.store.pending(f.key)).toBeUndefined();
    expect(f.store.get(f.key).paused).toContain('confirmed');
  });

  it('finds a lost write in history before a colleague’s later deletion, preserving that deletion on the next merge', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Submitted');
    const commit = f.repo.commitFile.bind(f.repo);
    vi.spyOn(f.repo, 'commitFile').mockImplementationOnce(async (change) => {
      await commit(change);
      f.repo.push('main', f.state.model.filter((line) => !line.includes('example.org/a>')));
      throw new GitError('network', 'Lost response');
    });
    await f.run();
    expect(f.ctx.bindings.get(MODEL)?.commit).toBe(f.repo.made[0]!.commit);
    f.store.resume(f.key);
    f.state.model = change('b', 'More local', f.state.model);
    await f.run();
    expect(f.repo.fileAt('main')).not.toContain('Submitted');
    expect(f.repo.fileAt('main')).toContain('More local');
    expect(f.repo.made).toHaveLength(2);
  });

  it('retains an unconfirmed journal across restart and never blindly retries it', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Submitted');
    const write = vi.spyOn(f.repo, 'commitFile').mockRejectedValue(new GitError('network', 'Lost response'));
    await f.run();
    expect(f.store.pending(f.key)?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(f.storage.dump()).not.toContain('Submitted');
    expect(f.storage.dump()).not.toContain('FAKE_TOKEN');
    f.deps.store = new AutoCommitStore(f.storage);
    f.deps.stamp = 'new-editor';
    await f.run();
    expect(write).toHaveBeenCalledTimes(1);
    expect(f.ctx.saved).not.toHaveBeenCalled();
  });

  it('does not rebind a reloaded model after a sent write completes', async () => {
    const f = await setup(kind);
    f.state.model = change('a', 'Submitted');
    f.repo.beforeCommit = () => { f.state.active = false; f.state.model = [...BASE]; };
    await f.run();
    expect(f.repo.made).toHaveLength(1);
    expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
    expect(f.ctx.saved).not.toHaveBeenCalled();
    expect(f.store.pending(f.key)?.receipt?.commit).toBe(f.repo.made[0]!.commit);
    f.state.active = true;
    f.deps.stamp = 'reloaded-editor';
    await f.run();
    expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
    expect(f.repo.made).toHaveLength(1);
    expect(f.store.get(f.key).paused).toContain('previous editor');
  });
});

it('bounds repeated version conflicts', async () => {
  const f = await setup();
  f.state.model = change('a', 'Local');
  const write = vi.spyOn(f.repo, 'commitFile').mockRejectedValue(new GitError('conflict', 'Changed'));
  await expect(f.run()).rejects.toThrow('keeps changing');
  expect(write).toHaveBeenCalledTimes(3);
  expect(f.store.pending(f.key)).toBeUndefined();
});

it.each(['token', 'blank nodes', 'pending merge', 'storage', 'policy'] as const)('does not write when %s needs attention', async (condition) => {
  const f = await setup();
  f.state.model = change('a', 'Local');
  if (condition === 'token') await f.ctx.tokens.forget(f.binding.host);
  if (condition === 'blank nodes') f.ctx.merge!.blankNodes = () => 1;
  if (condition === 'pending merge') f.ctx.bindings.set(MODEL, { ...f.binding, update: { branch: 'other', commit: 'root' } });
  if (condition === 'storage') vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  if (condition === 'policy') f.ctx.provider = () => { throw new GitError('forbidden', 'Host denied'); };
  await expect(f.run()).rejects.toThrow();
  expect(f.repo.made).toEqual([]);
  expect(f.ctx.dialogs.form).not.toHaveBeenCalled();
});

it.each(['off', 'reload', 'room', 'destination'] as const)('discards reads after %s changes before sending', async (condition) => {
  const f = await setup();
  f.state.model = change('a', 'Local');
  const gate = deferred<string>();
  vi.spyOn(f.repo, 'branchHead').mockImplementationOnce(() => gate.promise);
  const pending = f.run();
  // Wait until the asynchronous token lookups reach branchHead.
  await vi.waitFor(() => expect(f.repo.branchHead).toHaveBeenCalled());
  if (condition === 'off') f.state.canWrite = false;
  if (condition === 'reload') f.state.active = false;
  if (condition === 'room') f.state.room = 'room';
  if (condition === 'destination') f.ctx.bindings.set(MODEL, { ...f.binding, path: 'different.nt' });
  gate.resolve('root');
  await expect(pending).rejects.toBeInstanceOf(ObsoleteGitRead);
  expect(f.repo.made).toEqual([]);
});

async function scheduled(mode: 'idle' | 'interval' | 'off' = 'idle', locks = new MemoryLocks().client()) {
  vi.useFakeTimers();
  const f = await setup();
  f.store.set(f.key, { mode, idleMinutes: 1, intervalMinutes: 5 });
  let status: GitSyncStatus | undefined;
  let visible = true;
  let busy = false;
  const sync = new GitSync({ context: f.ctx, settings: () => ({}), autoCommits: f.store, locks,
    busy: () => busy, visible: () => visible, online: () => true, publish: (s) => { status = s; },
    run: async (op, automatic) => { busy = true;
      try { return await locks.run(destinationKey(f.ctx.bindings.get(MODEL)!), automatic, op); } finally { busy = false; } } });
  controllers.push(sync);
  const replace = f.ctx.merge!.replace;
  f.ctx.merge!.replace = (snapshot) => sync.internalChange(() => { replace(snapshot); sync.modelChanged(); });
  f.ctx.changed = () => sync.internalChange(() => sync.modelChanged());
  sync.refresh();
  return { ...f, sync, status: () => status!, hide: (value: boolean) => { visible = !value; sync.refresh(); } };
}

it('Off performs no automatic reads or writes', async () => {
  const f = await scheduled('off');
  f.state.model = change('a', 'Local');
  const read = vi.spyOn(f.repo, 'branchHead');
  f.sync.modelChanged();
  await vi.advanceTimersByTimeAsync(900_000);
  expect(read).not.toHaveBeenCalled();
  expect(f.repo.made).toEqual([]);
});

it('idle scheduling resets on local edits, consumes no-ops and works with regular checks Off', async () => {
  const f = await scheduled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.status().nextCommit).toBeUndefined();
  f.state.model = change('a', 'First'); f.sync.modelChanged();
  await vi.advanceTimersByTimeAsync(30_000);
  f.state.model = change('a', 'Second'); f.sync.modelChanged();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(f.repo.made).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(f.status().phase).not.toBe('committing'));
  expect(f.repo.made).toHaveLength(1);
  expect(f.repo.fileAt('main')).toContain('Second');
  expect(f.status().nextCommit).toBeUndefined();
});

it('interval mode pauses hidden clients and performs one due operation on return', async () => {
  const f = await scheduled('interval');
  f.state.model = change('a', 'Local');
  f.hide(true);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(f.repo.made).toEqual([]);
  f.hide(false);
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() => expect(f.repo.made).toHaveLength(1));
  await vi.waitFor(() => expect(f.status().phase).not.toBe('committing'));
  expect(f.status().nextCommit).toBeGreaterThan(Date.now());
  await vi.advanceTimersByTimeAsync(300_000);
  expect(f.repo.made).toHaveLength(1);
});

it('conflict choices and setting changes do not resume; explicit Resume or a manual commit does', async () => {
  const f = await scheduled();
  f.state.model = change('a', 'Local');
  f.repo.push('main', change('a', 'Remote'));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.status().autoCommit?.paused).toContain('Conflicts');
  f.state.conflicts = 0; f.sync.modelChanged(); f.sync.refresh(true);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.repo.made).toEqual([]);
  f.sync.resume();
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(f.repo.made).toHaveLength(1));
  await vi.waitFor(() => expect(f.status().phase).not.toBe('committing'));
  f.sync.pause();
  expect(f.store.get(f.key).paused).toBeDefined();
  f.sync.manualCommitted();
  expect(f.store.get(f.key).paused).toBeUndefined();
});

it('a new destination starts Off, while Pause survives returning to the original destination', async () => {
  const f = await scheduled();
  f.sync.pause();
  f.ctx.bindings.set(MODEL, { ...f.binding, branch: 'different' });
  f.sync.refresh();
  expect(f.status().autoCommit?.mode).toBe('off');
  f.ctx.bindings.set(MODEL, f.binding);
  f.sync.refresh();
  expect(f.status().autoCommit?.paused).toContain('Paused by you');
});

it('backs off reads with the host retry time even when idle edits keep arriving', async () => {
  const f = await scheduled();
  f.state.model = change('a', 'Local');
  const retryAt = Date.now() + 900_000;
  vi.spyOn(f.repo, 'branchHead').mockRejectedValue(new GitError('rate-limit', 'Wait', 429, retryAt));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.status().nextCommit).toBe(retryAt);
  f.sync.modelChanged();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.repo.branchHead).toHaveBeenCalledTimes(1);
  expect(f.status().nextCommit).toBe(retryAt);
});

it('fails closed without cross-tab locks', async () => {
  const f = await scheduled('idle', new GitLocks(null));
  f.state.model = change('a', 'Local');
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.repo.made).toEqual([]);
  expect(f.status().phase).toBe('paused');
});


it('two automatic writers share one owner and hand over without losing either editor’s changes', async () => {
  const hub = new MemoryLocks();
  const first = await scheduled('idle', hub.client());
  const second = await scheduled('idle', hub.client());
  // Separate editors share the remote repository, but keep their own incorporated bases.
  second.ctx.provider = () => first.repo;
  first.state.model = change('a', 'First editor');
  second.state.model = change('b', 'Second editor');
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(first.repo.made).toHaveLength(1));
  await vi.waitFor(() => expect(first.status().phase).not.toBe('committing'));
  expect(second.status().message).toContain('Another tab');
  first.sync.stop();
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() => expect(first.repo.made).toHaveLength(2));
  expect(first.repo.fileAt('main')).toContain('First editor');
  expect(first.repo.fileAt('main')).toContain('Second editor');
});

it('a malformed write response is uncertain and must be confirmed remotely', async () => {
  const f = await setup();
  f.state.model = change('a', 'Submitted');
  const commit = f.repo.commitFile.bind(f.repo);
  vi.spyOn(f.repo, 'commitFile').mockImplementationOnce(async (change) => ({ ...await commit(change), commit: '' }));
  await f.run();
  expect(f.repo.made).toHaveLength(1);
  expect(f.ctx.bindings.get(MODEL)?.commit).toBe(f.repo.made[0]!.commit);
  expect(f.store.get(f.key).paused).toContain('confirmed');
});

it('Pause during a sent write settles its receipt, preserves newer edits and stops subsequent commits', async () => {
  const f = await scheduled();
  f.state.model = change('a', 'Submitted');
  f.repo.beforeCommit = () => {
    f.sync.pause();
    f.state.model = change('a', 'Newer edit');
    f.sync.modelChanged();
  };
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(f.status().phase).toBe('paused'));
  expect(f.repo.made).toHaveLength(1);
  expect(f.ctx.bindings.get(MODEL)?.commit).toBe(f.repo.made[0]!.commit);
  expect(f.state.model).toEqual(change('a', 'Newer edit'));
  expect(f.status().local).toBe(true);
  expect(f.ctx.saved).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.repo.made).toHaveLength(1);
});

it('storage becoming full pauses in memory instead of repeatedly retrying the due write', async () => {
  const f = await scheduled();
  f.state.model = change('a', 'Local');
  vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  const heads = vi.spyOn(f.repo, 'branchHead');
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(f.status().autoCommit?.paused).toContain('could not be recorded'));
  await vi.advanceTimersByTimeAsync(600_000);
  expect(heads).toHaveBeenCalledOnce();
  expect(f.repo.made).toEqual([]);
});

it.each(['reload', 'room roundtrip', 'destination roundtrip'] as const)('a sent write cannot rebind after a %s', async (transition) => {
  const f = await scheduled();
  f.state.model = change('a', 'Submitted');
  const response = deferred<void>();
  const commit = f.repo.commitFile.bind(f.repo);
  vi.spyOn(f.repo, 'commitFile').mockImplementationOnce(async (change) => { const result = await commit(change); await response.promise; return result; });
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(f.repo.made).toHaveLength(1));
  if (transition === 'reload') f.sync.modelLoaded();
  if (transition === 'room roundtrip') {
    f.state.room = 'room'; f.sync.refresh();
    f.state.room = undefined; f.sync.refresh();
  }
  if (transition === 'destination roundtrip') {
    f.ctx.bindings.set(MODEL, { ...f.binding, branch: 'other' }); f.sync.refresh();
    f.ctx.bindings.set(MODEL, f.binding); f.sync.refresh();
  }
  f.state.model = [...BASE];
  response.resolve();
  await vi.waitFor(() => expect(f.status().phase).toBe('paused'));
  expect(f.ctx.bindings.get(MODEL)).toEqual(f.binding);
  expect(f.ctx.saved).not.toHaveBeenCalled();
  expect(f.store.pending(f.key)?.receipt?.commit).toBe(f.repo.made[0]!.commit);
});

it('a completed manual save still succeeds if pending-write storage cannot be cleared', async () => {
  const f = await scheduled();
  vi.spyOn(f.storage, 'removeItem').mockImplementation(() => { throw new Error('Storage denied'); });
  expect(() => f.sync.manualCommitted()).not.toThrow();
  expect(f.status().lastCommit).toBe(Date.now());
  expect(f.store.get(f.key).paused).toContain('Saved to Git');
});
