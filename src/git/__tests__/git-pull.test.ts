/** Same-branch pulls against both hosts, without any repository writes. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChoice, type MergeConflict } from '../../model-manager/model-merge.js';
import { IRI } from '../../model-manager/vocabulary.js';
import { GitBindings, type GitBinding } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import { pullFromGit, type GitPullContext } from '../git-pull.js';
import { saveToGit } from '../git-save.js';
import { MemoryStorage } from './memory-storage.js';
import { Repository } from './memory-repository.js';

const MODEL = 'https://example.org/m/model';
const PATH = 'models/shop.nt';
const line = (subject: string, label: string) => `<https://example.org/m/${subject}> <${IRI.prefLabel}> "${label}"@en .`;
const BASE = [`<${MODEL}> <${IRI.rdfType}> <${IRI.Model}> .`, line('a', 'A'), line('b', 'B')].sort();
const rename = (lines: string[], subject: string, label: string) => lines.map((l) => l.startsWith(`<https://example.org/m/${subject}> <${IRI.prefLabel}>`) ? line(subject, label) : l).sort();
const text = (lines: string[]) => `${lines.join('\n')}\n`;

describe.each(['github', 'gitlab'] as const)('Pull from %s', (kind) => {
  let repo: Repository;
  let ctx: GitPullContext;
  let model: string[];
  let bound: GitBinding;
  let conflicts: MergeConflict[];
  let valid: boolean;
  let dirty: boolean;
  let undo: string[][];

  beforeEach(async () => {
    repo = new Repository(kind, PATH, text(BASE));
    model = [...BASE];
    conflicts = [];
    valid = true;
    dirty = false;
    undo = [];
    const storage = new MemoryStorage();
    ctx = {
      modelIri: () => MODEL, modelLabel: () => 'Shop', serialize: () => text(model),
      current: () => valid, room: () => undefined,
      saved: vi.fn(() => { dirty = false; }), changed: vi.fn(() => { dirty = true; }),
      isDirty: () => dirty,
      dialogs: { prompt: vi.fn(async () => 'Save choices'), form: vi.fn(async () => null), confirm: vi.fn(async () => true),
        choose: vi.fn(async () => null), info: vi.fn(async () => undefined), toast: vi.fn() },
      report: vi.fn(), tokens: new WebTokenStore(storage), bindings: new GitBindings(storage), provider: vi.fn(() => repo),
      merge: { options: () => ({}), unresolved: () => conflicts.length, blankNodes: () => 0,
        replace: vi.fn((snapshot) => { undo.push(model); model = snapshot; }),
        conflicts: vi.fn((items) => { conflicts = items; }), clear: vi.fn(() => { conflicts = []; }) },
    };
    bound = { host: kind === 'github' ? 'github.com' : 'gitlab.com', provider: kind,
      apiBase: kind === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4',
      repository: 'acme/arch', webUrl: `https://${kind}.com/acme/arch`, branch: 'main', path: PATH,
      commit: 'root', version: (await repo.readFile('root', PATH))!.version };
    ctx.bindings.set(MODEL, bound);
  });

  it('pulls a clean model at the pinned head, marks it clean and does not commit or ask for a token', async () => {
    const remote = rename(BASE, 'a', 'Remote');
    const head = repo.push('main', remote);
    expect(await pullFromGit(ctx)).toBe('pulled');
    expect(model).toEqual(remote);
    expect(ctx.bindings.get(MODEL)).toMatchObject({ commit: head, version: (await repo.readFile(head, PATH))!.version });
    expect(dirty).toBe(false);
    expect(undo).toEqual([BASE]);
    expect(repo.made).toEqual([]);
    expect(repo.branches.size).toBe(1);
    expect(ctx.dialogs.form).not.toHaveBeenCalled();
  });

  it('keeps local edits even after a local-file save cleared the app dirty flag', async () => {
    model = rename(BASE, 'a', 'Local saved to disk');
    repo.push('main', rename(BASE, 'b', 'Remote'));
    expect(await pullFromGit(ctx)).toBe('merged');
    expect(model).toEqual(rename(rename(BASE, 'a', 'Local saved to disk'), 'b', 'Remote'));
    expect(dirty).toBe(true);
    expect(repo.made).toEqual([]);
  });

  it('makes no undo entry for an identical file, including unrelated commits and different ordering', async () => {
    const head = repo.push('main', [...BASE].reverse());
    expect(await pullFromGit(ctx)).toBe('unchanged');
    expect(await pullFromGit(ctx)).toBe('unchanged');
    expect(undo).toEqual([]);
    expect(ctx.bindings.get(MODEL)?.commit).toBe(head);
    expect(repo.made).toEqual([]);
  });

  it('keeps the incorporated base after undo, so the restored snapshot is a local change', async () => {
    const head = repo.push('main', rename(BASE, 'a', 'Remote'));
    await pullFromGit(ctx);
    model = undo.pop()!;
    expect(await pullFromGit(ctx)).toBe('merged');
    expect(model).toEqual(BASE);
    expect(dirty).toBe(true);
    expect(ctx.bindings.get(MODEL)?.commit).toBe(head);
    expect(undo).toEqual([]);
  });

  it('holds conflicting values at base, blocks another pull, and saves choices only when requested', async () => {
    model = rename(BASE, 'a', 'Local');
    const head = repo.push('main', rename(rename(BASE, 'a', 'Remote'), 'b', 'Disjoint'));
    expect(await pullFromGit(ctx)).toBe('conflicts');
    expect(model).toEqual(rename(BASE, 'b', 'Disjoint'));
    expect(ctx.bindings.get(MODEL)?.commit).toBe(head);
    expect(conflicts).toHaveLength(1);
    expect(await pullFromGit(ctx)).toBe('stopped');
    model = applyChoice(model, conflicts[0]!, 'ours');
    conflicts = [];
    expect(repo.made).toEqual([]);
    await ctx.tokens.set(bound.host, 'FAKE_TOKEN', false);
    await saveToGit(ctx);
    expect(repo.made).toHaveLength(1);
    expect(repo.made[0]?.branch).toBe('main');
    expect(repo.fileAt('main')).toBe(text(model));
  });

  it('includes edits made while a remote read was in flight and ignores later unobserved heads', async () => {
    const head = repo.push('main', rename(BASE, 'b', 'Remote'));
    const originalRead = repo.readFile.bind(repo);
    vi.spyOn(repo, 'readFile').mockImplementation(async (ref, path) => {
      const file = await originalRead(ref, path);
      if (ref === head) {
        model = rename(BASE, 'a', 'Typed during request');
        repo.push('main', rename(BASE, 'b', 'Later remote'));
      }
      return file;
    });
    expect(await pullFromGit(ctx)).toBe('merged');
    expect(model).toEqual(rename(rename(BASE, 'a', 'Typed during request'), 'b', 'Remote'));
    expect(ctx.bindings.get(MODEL)?.commit).toBe(head);
    expect(repo.readFile).toHaveBeenCalledWith(head, PATH);
  });

  it.each(['lifecycle', 'model', 'binding', 'room'] as const)('discards a result after the %s changes', async (what) => {
    repo.push('main', rename(BASE, 'a', 'Remote'));
    const read = repo.readFile.bind(repo);
    vi.spyOn(repo, 'readFile').mockImplementation(async (ref, path) => {
      const result = await read(ref, path);
      if (what === 'lifecycle') valid = false;
      if (what === 'model') ctx.modelIri = () => `${MODEL}-other`;
      if (what === 'binding') ctx.bindings.set(MODEL, { ...bound, path: 'other.nt' });
      if (what === 'room') ctx.room = () => 'shared';
      return result;
    });
    expect(await pullFromGit(ctx)).toBe('obsolete');
    expect(model).toEqual(BASE);
    expect(undo).toEqual([]);
    expect(ctx.saved).not.toHaveBeenCalled();
    expect(ctx.bindings.get(MODEL)?.commit).toBe('root');
  });

  it.each(['base', 'file', 'branch', 'identity', 'parse', 'blank nodes'] as const)('leaves model and binding intact on missing or invalid %s', async (what) => {
    const head = repo.push('main', rename(BASE, 'a', 'Remote'));
    if (what === 'base') repo.commits.delete('root');
    if (what === 'file') repo.commits.get(head)!.files.clear();
    if (what === 'branch') repo.branches.clear();
    if (what === 'identity') repo.commits.get(head)!.files.set(PATH, text(BASE).replace(MODEL, `${MODEL}-other`));
    if (what === 'parse') repo.commits.get(head)!.files.set(PATH, 'not RDF');
    if (what === 'blank nodes') repo.commits.get(head)!.files.set(PATH, `${text(BASE)}_:x <${IRI.prefLabel}> "Blank"@en .`);
    expect(await pullFromGit(ctx)).toBe('stopped');
    expect(model).toEqual(BASE);
    expect(ctx.bindings.get(MODEL)).toEqual(bound);
    expect(undo).toEqual([]);
    expect(repo.made).toEqual([]);
  });

  it('does not start in a room, during a branch merge or with unresolved conflicts', async () => {
    ctx.room = () => 'room';
    expect(await pullFromGit(ctx)).toBe('stopped');
    ctx.room = () => undefined;
    ctx.bindings.set(MODEL, { ...bound, update: { branch: 'main', commit: 'other' } });
    expect(await pullFromGit(ctx)).toBe('stopped');
    ctx.bindings.set(MODEL, bound);
    ctx.merge!.unresolved = () => 1;
    expect(await pullFromGit(ctx)).toBe('stopped');
    expect(ctx.provider).not.toHaveBeenCalled();
  });

  it('asks for read access once on a private repository, then pulls without writing', async () => {
    const head = repo.push('main', rename(BASE, 'a', 'Remote'));
    vi.mocked(ctx.dialogs.form).mockResolvedValue({ token: 'FAKE_READ_ONLY' });
    vi.spyOn(repo, 'branchHead').mockRejectedValueOnce(new GitError('not-found', 'Private repository')).mockResolvedValue(head);
    expect(await pullFromGit(ctx)).toBe('pulled');
    expect(ctx.dialogs.form).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(ctx.dialogs.form).mock.calls)).toContain('read');
    expect(repo.made).toEqual([]);
  });

  it('does not prompt for an obsolete authentication failure', async () => {
    vi.spyOn(repo, 'branchHead').mockImplementation(async () => {
      valid = false;
      throw new GitError('auth', 'Refused');
    });
    expect(await pullFromGit(ctx)).toBe('obsolete');
    expect(ctx.dialogs.form).not.toHaveBeenCalled();
  });

  it('reports a rejected saved token and leaves the model intact', async () => {
    await ctx.tokens.set(bound.host, 'FAKE_EXPIRED', false);
    vi.spyOn(repo, 'branchHead').mockRejectedValue(new GitError('auth', 'Token refused'));
    expect(await pullFromGit(ctx)).toBe('stopped');
    expect(await ctx.tokens.get(bound.host)).toBeUndefined();
    expect(ctx.bindings.get(MODEL)).toEqual(bound);
    expect(model).toEqual(BASE);
  });
});

it('another editor cannot silently advance this editor’s incorporated base through localStorage', () => {
  const storage = new MemoryStorage();
  const first = new GitBindings(storage);
  const second = new GitBindings(storage);
  const binding = { commit: 'base', path: PATH } as GitBinding;
  first.set(MODEL, binding);
  expect(second.get(MODEL)?.commit).toBe('base');
  first.set(MODEL, { ...binding, commit: 'newer' });
  expect(second.get(MODEL)?.commit).toBe('base');
  expect(new GitBindings(storage).get(MODEL)?.commit).toBe('newer');
});
