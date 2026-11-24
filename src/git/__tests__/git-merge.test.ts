/**
 * Merging in Git (Phase 1 of the Git collaboration plan): *Merge with the newer
 * version* when a save is refused, and *Update from main* — against a
 * repository in memory that keeps commits with their parents, as GitHub (merge
 * commits) and as GitLab (none), with la-gram's own merge.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveToGit, type GitSaveContext } from '../git-save.js';
import { anotherModel, followedMove, updateFromBranch, type MergeSupport } from '../git-merge.js';
import { GitBindings, type GitBinding } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import type { Dialogs, FormField, FormValues } from '../../ui/dialogs.js';
import { applyChoice, snapshotModel, type MergeConflict } from '@linked-archi/kernel/model-manager/model-merge.js';
import { MemoryStorage } from './memory-storage.js';
import { Repository } from './memory-repository.js';

const MODEL = 'https://example.org/m/model';
const PATH = 'models/shop.nt';
const LABEL = '<http://www.w3.org/2004/02/skos/core#prefLabel>';
const line = (subject: string, name: string) => `<https://example.org/m/${subject}> ${LABEL} "${name}"@en .`;
const BASE = [line('e1', 'One'), line('e2', 'Two'), line('e3', 'Three')].sort();
const renamed = (lines: string[], subject: string, name: string) =>
  lines.map((l) => (l.startsWith(`<https://example.org/m/${subject}> `) ? line(subject, name) : l)).sort();
const text = (lines: string[]) => `${lines.join('\n')}\n`;

let repo: Repository;
let model: string[];
let shown: { conflicts: MergeConflict[]; against: { branch: string; commit: string } } | undefined;
let picked: number;
let blankNodes: number;
let asked: string[];
let chooses: Array<string | null>;
let prompts: Array<string | null>;
let forms: FormValues[];
let confirms: boolean[];
let reports: string[];
let bindings: GitBindings;
let ctx: GitSaveContext;

function context(kind: 'github' | 'gitlab'): void {
  repo = new Repository(kind, PATH, text(BASE));
  model = [...BASE];
  shown = undefined;
  picked = 0;
  blankNodes = 0;
  asked = [];
  chooses = [];
  prompts = [];
  forms = [];
  confirms = [];
  reports = [];
  const storage = new MemoryStorage();
  bindings = new GitBindings(storage);
  const merge: MergeSupport = {
    options: () => ({}),
    replace: (snapshot) => {
      model = [...snapshot];
    },
    conflicts: (conflicts, against) => {
      shown = { conflicts, against };
      picked = 0;
    },
    unresolved: () => (shown ? shown.conflicts.length - picked : 0),
    clear: () => {
      shown = undefined;
    },
    blankNodes: () => blankNodes,
  };
  const dialogs: Dialogs = {
    prompt: vi.fn(async (title: string, _label: string, value?: string) => {
      asked.push(`prompt:${title}`);
      const answer = prompts.length ? prompts.shift()! : (value ?? null);
      return answer === '' ? (value ?? null) : answer;
    }),
    form: vi.fn(async (title: string, fields: FormField[]) => {
      asked.push(`form:${title}`);
      return { ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), token: 'TOKEN', ...(forms.shift() ?? {}) } as FormValues;
    }),
    confirm: vi.fn(async (title: string) => {
      asked.push(`confirm:${title}`);
      return confirms.length ? confirms.shift()! : true;
    }),
    choose: vi.fn(async (title: string, options: Array<{ value: string }>) => {
      asked.push(`choose:${title} [${options.map((o) => o.value).join(', ')}]`);
      return chooses.length ? chooses.shift()! : null;
    }),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  ctx = {
    modelIri: () => MODEL,
    modelLabel: () => 'Shop',
    serialize: () => text(model),
    saved: () => undefined,
    dialogs,
    report: (message) => reports.push(message),
    tokens: new WebTokenStore(storage),
    bindings,
    provider: () => repo,
    now: () => new Date('2026-11-05T09:30:00Z'),
    merge,
  };
}

/** The model bound to the file on `branch` at its head, as opening it binds it. */
async function bind(branch = 'main'): Promise<GitBinding> {
  const head = repo.branches.get(branch)!;
  const binding: GitBinding = {
    host: repo.kind === 'github' ? 'github.com' : 'gitlab.com',
    provider: repo.kind,
    apiBase: 'https://api',
    repository: 'acme/arch',
    webUrl: 'https://host/acme/arch',
    branch,
    path: PATH,
    version: (await repo.readFile(head, PATH))!.version,
    commit: head,
  };
  bindings.set(MODEL, binding);
  model = (repo.fileAt(head) ?? '').trim().split('\n').sort();
  return binding;
}

const fileLines = (ref: string) => (repo.fileAt(ref) ?? '').trim().split('\n').sort();

describe.each(['github', 'gitlab'] as const)('Merge with the newer version (%s)', (kind) => {
  beforeEach(() => context(kind));

  it('is offered first when a save is refused; it commits both changes to the same branch', async () => {
    await bind();
    repo.push('main', renamed(BASE, 'e2', 'Two (theirs)'));
    model = renamed(model, 'e1', 'One (mine)');
    chooses.push('merge');
    const result = await saveToGit(ctx);

    expect(asked.find((a) => a.startsWith('choose:'))).toBe('choose:models/shop.nt changed in the repository [merge, branch, overwrite]');
    expect(result?.branch).toBe('main');
    expect(fileLines('main')).toEqual(renamed(renamed(BASE, 'e1', 'One (mine)'), 'e2', 'Two (theirs)'));
    expect(model).toEqual(fileLines('main'));
    expect([...repo.branches.keys()]).toEqual(['main']);
    expect(bindings.get(MODEL)?.commit).toBe(repo.branches.get('main'));
  });

  it('merges again when the branch moves on while it merges', async () => {
    await bind();
    repo.push('main', renamed(BASE, 'e2', 'Two (theirs)'));
    model = renamed(model, 'e1', 'One (mine)');
    chooses.push('merge');
    let first = true;
    const commitFile = repo.commitFile.bind(repo);
    repo.commitFile = async (change) => {
      if (first) {
        first = false;
        repo.push('main', renamed(renamed(BASE, 'e2', 'Two (theirs)'), 'e3', 'Three (another)'));
      }
      return commitFile(change);
    };
    await saveToGit(ctx);
    expect(fileLines('main')).toEqual(renamed(renamed(renamed(BASE, 'e1', 'One (mine)'), 'e2', 'Two (theirs)'), 'e3', 'Three (another)'));
  });

  it('with conflicts: commits nothing, lists them, holds base’s value and binds the model to the head', async () => {
    await bind();
    const head = repo.push('main', renamed(BASE, 'e1', 'One (theirs)'));
    model = renamed(model, 'e1', 'One (mine)');
    chooses.push('merge');
    expect(await saveToGit(ctx)).toBeUndefined();

    expect(shown?.conflicts.map((c) => [c.kind, c.subjects[0]])).toEqual([['value', 'https://example.org/m/e1']]);
    expect(shown?.against).toEqual({ branch: 'main', commit: head });
    expect(model).toEqual(BASE);
    expect(bindings.get(MODEL)?.commit).toBe(head);
    expect(repo.made).toEqual([]);

    // Chosen, the next save commits on top of theirs, without a conflict.
    model = applyChoice(model, shown!.conflicts[0], 'ours');
    picked = 1;
    await saveToGit(ctx);
    expect(fileLines('main')).toEqual(renamed(BASE, 'e1', 'One (mine)'));
    expect(repo.made.map((m) => m.parents)).toEqual([[head]]);
  });

  it('asks before saving with conflicts not chosen', async () => {
    await bind();
    repo.push('main', renamed(BASE, 'e1', 'One (theirs)'));
    model = renamed(model, 'e1', 'One (mine)');
    chooses.push('merge');
    await saveToGit(ctx);
    confirms.push(false);
    asked = [];
    expect(await saveToGit(ctx)).toBeUndefined();
    expect(asked).toEqual(['confirm:Conflicts not chosen']);
    expect(repo.made).toEqual([]);
  });

  it('nothing of the model’s own left: binds to the head and commits nothing', async () => {
    await bind();
    repo.push('main', renamed(BASE, 'e1', 'One (theirs)'));
    chooses.push('merge');
    model = [...BASE, line('e9', 'Nine')].sort();
    repo.push('main', [...renamed(BASE, 'e1', 'One (theirs)'), line('e9', 'Nine')].sort());
    await saveToGit(ctx);
    expect(repo.made).toEqual([]);
    expect(reports.at(-1)).toMatch(/nothing to commit/);
  });

  it('is not offered for a file the model was not bound to', async () => {
    // Bound to another file; saved as… this one, which moves on before the commit.
    bindings.set(MODEL, { ...(await bind()), path: 'models/other.nt' });
    forms.push({ path: PATH });
    repo.beforeCommit = () => repo.push('main', renamed(BASE, 'e2', 'Two (theirs)'));
    chooses.push(null);
    await saveToGit(ctx, true);
    expect(asked.filter((a) => a.startsWith('choose:'))).toEqual(['choose:models/shop.nt changed in the repository [branch, overwrite]']);
  });
});

describe('blank nodes', () => {
  beforeEach(() => context('github'));

  it('a model with blank nodes is saved only when the user says so, asked once a session', async () => {
    await bind();
    blankNodes = 3;
    model = renamed(model, 'e1', 'One (mine)');
    confirms.push(false);
    expect(await saveToGit(ctx)).toBeUndefined();
    expect(asked).toEqual(['confirm:Blank nodes']);
    confirms.push(true);
    await saveToGit(ctx);
    asked = [];
    model = renamed(model, 'e2', 'Two (mine)');
    await saveToGit(ctx);
    expect(asked).not.toContain('confirm:Blank nodes');
    expect(repo.made).toHaveLength(2);
  });
});

describe('Update from main', () => {
  /** A branch `feature` from main, the model bound to it and changed; main changed meanwhile. */
  async function diverged(): Promise<{ fork: string; mainHead: string }> {
    const fork = repo.branches.get('main')!;
    repo.commit('feature', [fork], new Map(repo.commits.get(fork)!.files));
    const featureHead = repo.push('feature', renamed(BASE, 'e1', 'One (feature)'));
    const mainHead = repo.push('main', renamed(BASE, 'e2', 'Two (main)'));
    await bind('feature');
    expect(bindings.get(MODEL)?.commit).toBe(featureHead);
    model = renamed(model, 'e3', 'Three (unsaved)');
    return { fork, mainHead };
  }

  it('on GitHub: merges main into the model and commits a merge commit — main its second parent', async () => {
    context('github');
    const { mainHead } = await diverged();
    const featureHead = repo.branches.get('feature')!;
    chooses.push('main');
    const result = await updateFromBranch(ctx);

    expect(asked.find((a) => a.startsWith('choose:'))).toBe('choose:Update feature from… [main]');
    expect(asked).toContain('prompt:Save to Git');
    expect(repo.made).toEqual([{ kind: 'merge', branch: 'feature', commit: result!.commit, parents: [featureHead, mainHead] }]);
    expect(fileLines('feature')).toEqual(renamed(renamed(renamed(BASE, 'e1', 'One (feature)'), 'e2', 'Two (main)'), 'e3', 'Three (unsaved)'));
    expect(bindings.get(MODEL)?.update).toBeUndefined();
    // main is now behind nothing on feature: their merge base is main's head.
    expect(await repo.mergeBase(repo.branches.get('feature')!, mainHead)).toBe(mainHead);
  });

  it('on GitLab: commits the merged model to a new branch started from main, and binds the model to it', async () => {
    context('gitlab');
    const { mainHead } = await diverged();
    chooses.push('main');
    prompts.push('', 'la-gram/shop-updated');
    const result = await updateFromBranch(ctx);

    expect(asked).toContain('prompt:Commit to a new branch');
    expect(result?.branch).toBe('la-gram/shop-updated');
    expect(repo.made).toEqual([{ kind: 'file', branch: 'la-gram/shop-updated', commit: result!.commit, parents: [mainHead] }]);
    expect(fileLines('la-gram/shop-updated')).toEqual(renamed(renamed(renamed(BASE, 'e1', 'One (feature)'), 'e2', 'Two (main)'), 'e3', 'Three (unsaved)'));
    expect(bindings.get(MODEL)?.branch).toBe('la-gram/shop-updated');
  });

  it('with conflicts: lists them and remembers main; the save after choosing records the merge', async () => {
    context('github');
    const fork = repo.branches.get('main')!;
    repo.commit('feature', [fork], new Map(repo.commits.get(fork)!.files));
    const featureHead = repo.push('feature', renamed(BASE, 'e1', 'One (feature)'));
    const mainHead = repo.push('main', renamed(BASE, 'e1', 'One (main)'));
    await bind('feature');
    chooses.push('main');
    expect(await updateFromBranch(ctx)).toBeUndefined();

    expect(shown?.against).toEqual({ branch: 'main', commit: mainHead });
    expect(bindings.get(MODEL)?.update).toEqual({ branch: 'main', commit: mainHead, version: repo.version(repo.fileAt(mainHead)!) });
    expect(repo.made).toEqual([]);

    model = applyChoice(model, shown!.conflicts[0], 'theirs');
    picked = 1;
    asked = [];
    await saveToGit(ctx);
    expect(asked).toEqual(['prompt:Save to Git']);
    expect(repo.made.map((m) => [m.kind, m.parents])).toEqual([['merge', [featureHead, mainHead]]]);
    expect(fileLines('feature')).toEqual(renamed(BASE, 'e1', 'One (main)'));
  });

  it('first merges the model’s own branch when it moved on', async () => {
    context('github');
    const { mainHead } = await diverged();
    // Someone else adds to feature after the model was bound to it.
    const featureHead = repo.push('feature', [...renamed(BASE, 'e1', 'One (feature)'), line('e4', 'Four')].sort());
    chooses.push('main');
    await updateFromBranch(ctx);
    expect(repo.made.map((m) => m.parents)).toEqual([[featureHead, mainHead]]);
    expect(fileLines('feature')).toEqual(
      [...renamed(renamed(renamed(BASE, 'e1', 'One (feature)'), 'e2', 'Two (main)'), 'e3', 'Three (unsaved)'), line('e4', 'Four')].sort(),
    );
  });

  it('says so when the branch already has everything on main', async () => {
    context('github');
    const fork = repo.branches.get('main')!;
    repo.commit('feature', [fork], new Map(repo.commits.get(fork)!.files));
    repo.push('feature', renamed(BASE, 'e1', 'One (feature)'));
    await bind('feature');
    chooses.push('main');
    expect(await updateFromBranch(ctx)).toBeUndefined();
    expect(reports.at(-1)).toBe('feature already has everything on main.');
  });

  it('waits for the conflicts to be chosen first', async () => {
    context('github');
    await diverged();
    shown = { conflicts: [{} as MergeConflict], against: { branch: 'main', commit: 'x' } };
    expect(await updateFromBranch(ctx)).toBeUndefined();
    expect(reports.at(-1)).toMatch(/Choose the conflict in the Conflicts tab first/);
    expect(asked).toEqual([]);
  });
});

describe.each(['github', 'gitlab'] as const)('a model moved to another namespace (DD-41, scenario S7; %s)', (kind) => {
  const OLD = 'https://example.org/m/';
  const NEW = 'https://acme.com/ea/shop/';
  const OTHER = 'https://acme.com/ea/store/';
  /** The model in a namespace, stating it, with these names. */
  const version = (ns: string, names: Record<string, string>) =>
    [
      `<${ns}model> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://meta.linked.archi/core#Model> .`,
      `<${ns}model> <http://purl.org/vocab/vann/preferredNamespaceUri> "${ns}" .`,
      ...Object.entries(names).map(([s, name]) => `<${ns}element/${s}> ${LABEL} "${name}"@en .`),
    ].sort();
  let open: string;

  /** Bound at main's head to the model in OLD; moved here to `to`, as Model settings moves it. */
  async function bindAndMove(to?: string, names: Record<string, string> = { e1: 'One', e2: 'Two' }): Promise<GitBinding> {
    context(kind);
    repo = new Repository(kind, PATH, text(version(OLD, { e1: 'One', e2: 'Two' })));
    open = `${OLD}model`;
    ctx.modelIri = () => open;
    // As la-gram's replace does: a snapshot with the model under another IRI moves the open model there.
    ctx.merge = {
      ...ctx.merge!,
      replace: (snapshot) => {
        model = [...snapshot];
        const moved = snapshotModel(snapshot)?.model;
        if (moved && moved !== open) {
          bindings.move(open, moved);
          open = moved;
        }
      },
    };
    const head = repo.branches.get('main')!;
    const binding: GitBinding = {
      host: kind === 'github' ? 'github.com' : 'gitlab.com', provider: kind, apiBase: 'https://api', repository: 'acme/arch',
      webUrl: 'https://host/acme/arch', branch: 'main', path: PATH, version: (await repo.readFile(head, PATH))!.version, commit: head,
    };
    bindings.set(open, binding);
    model = version(OLD, names);
    if (to) {
      model = version(to, names);
      bindings.move(open, `${to}model`);
      open = `${to}model`;
    }
    return binding;
  }

  it('the binding follows the model, noting the IRI the file still has it under; moved back, the note goes', async () => {
    const binding = await bindAndMove(NEW);
    expect(bindings.get(`${OLD}model`)).toBeUndefined();
    expect(bindings.get(`${NEW}model`)).toEqual({ ...binding, movedFrom: `${OLD}model` });
    bindings.move(`${NEW}model`, `${OTHER}model`);
    expect(bindings.get(`${OTHER}model`)).toEqual({ ...binding, movedFrom: `${OLD}model` });
    bindings.move(`${OTHER}model`, `${OLD}model`);
    expect(bindings.get(`${OLD}model`)).toEqual(binding);
    // A binding the new IRI had was another model's: the moved model keeps its own file.
    bindings.set(`${NEW}model`, { ...binding, path: 'models/other.nt' });
    bindings.move(`${OLD}model`, `${NEW}model`);
    expect(bindings.get(`${NEW}model`)).toEqual({ ...binding, movedFrom: `${OLD}model` });
    expect(bindings.get(`${OLD}model`)).toBeUndefined();
  });

  it('moved here, the save refused: merged with the newer version moved after it, and committed to the same file', async () => {
    await bindAndMove(NEW);
    repo.push('main', version(OLD, { e1: 'One', e2: 'Two (theirs)' }));
    chooses.push('merge');
    const result = await saveToGit(ctx);

    expect(result?.branch).toBe('main');
    expect(fileLines('main')).toEqual(version(NEW, { e1: 'One', e2: 'Two (theirs)' }));
    expect(model).toEqual(fileLines('main'));
    expect(shown).toBeUndefined();
    // Committed from here: the file has the moved model, and the binding says nothing more.
    expect(bindings.get(`${NEW}model`)).toMatchObject({ commit: repo.branches.get('main') });
    expect(bindings.get(`${NEW}model`)?.movedFrom).toBeUndefined();
  });

  it('moved there, the save refused: the open model moves there, merged, and is committed to the same file', async () => {
    await bindAndMove(undefined, { e1: 'One (mine)', e2: 'Two' });
    repo.push('main', version(NEW, { e1: 'One', e2: 'Two (theirs)' }));
    chooses.push('merge');
    const result = await saveToGit(ctx);

    expect(result?.branch).toBe('main');
    expect(open).toBe(`${NEW}model`);
    expect(fileLines('main')).toEqual(version(NEW, { e1: 'One (mine)', e2: 'Two (theirs)' }));
    expect(model).toEqual(fileLines('main'));
    expect(reports).toContain(followedMove('main', `${NEW}model`));
    // Bound under its new IRI, the file as it is now; nothing left under the old one.
    expect(bindings.get(`${OLD}model`)).toBeUndefined();
    expect(bindings.get(`${NEW}model`)).toMatchObject({ commit: repo.branches.get('main'), path: PATH });
    expect(bindings.get(`${NEW}model`)?.movedFrom).toBeUndefined();
  });

  it('another model there, in the same namespace: not merged into the open model, and it says what to do', async () => {
    await bindAndMove(undefined, { e1: 'One (mine)', e2: 'Two' });
    repo.push('main', version(OLD, { e1: 'One', e2: 'Two' }).map((l) => l.replace(`<${OLD}model>`, `<${OLD}other>`)));
    chooses.push('merge');
    const before = [...model];
    expect(await saveToGit(ctx)).toBeUndefined();

    expect(model).toEqual(before);
    expect(open).toBe(`${OLD}model`);
    expect(repo.made).toEqual([]);
    expect(reports.at(-1)).toBe(anotherModel('main', `${OLD}other`));
  });

  it('moved here and there, to two namespaces: not merged', async () => {
    await bindAndMove(NEW);
    repo.push('main', version(OTHER, { e1: 'One', e2: 'Two' }));
    chooses.push('merge');
    expect(await saveToGit(ctx)).toBeUndefined();
    expect(repo.made).toEqual([]);
    expect(reports.at(-1)).toBe(`The model was moved to another namespace both here, to ${NEW}, and on main, to ${OTHER}: move it to the same one on both, then merge again.`);
  });

  it('Update from main… on the branch the model was moved on merges a branch started before the move into it', async () => {
    await bindAndMove();
    const fork = repo.branches.get('main')!;
    repo.commit('feature', [fork], new Map(repo.commits.get(fork)!.files));
    repo.push('feature', version(OLD, { e1: 'One (feature)', e2: 'Two' }));
    // The move, committed on main.
    model = version(NEW, { e1: 'One', e2: 'Two' });
    bindings.move(open, `${NEW}model`);
    open = `${NEW}model`;
    await saveToGit(ctx);
    expect(fileLines('main')).toEqual(model);

    chooses.push('feature');
    const result = await updateFromBranch(ctx);
    // On GitHub a merge commit on main; on GitLab a new branch started from feature's head.
    expect(fileLines(result!.branch)).toEqual(version(NEW, { e1: 'One (feature)', e2: 'Two' }));
  });

  it('Update from main… on a branch started before main moved the model: the model moves there, and the update is committed', async () => {
    const binding = await bindAndMove();
    const fork = repo.branches.get('main')!;
    repo.commit('feature', [fork], new Map(repo.commits.get(fork)!.files));
    const featureHead = repo.push('feature', version(OLD, { e1: 'One (feature)', e2: 'Two' }));
    const mainHead = repo.push('main', version(NEW, { e1: 'One', e2: 'Two (main)' }));
    bindings.set(open, { ...binding, branch: 'feature', commit: featureHead, version: (await repo.readFile(featureHead, PATH))!.version });
    model = fileLines('feature');

    chooses.push('main');
    // Asked for the update's commit message, and on GitLab for the new branch's name.
    const result = await updateFromBranch(ctx);
    expect(open).toBe(`${NEW}model`);
    expect(reports).toContain(followedMove('main', `${NEW}model`));
    expect(bindings.get(`${OLD}model`)).toBeUndefined();
    // On GitHub a merge commit on feature; on GitLab a new branch started from main's head.
    expect(result?.branch).toEqual(kind === 'github' ? 'feature' : expect.stringMatching(/^la-gram\//));
    expect(fileLines(result!.branch)).toEqual(version(NEW, { e1: 'One (feature)', e2: 'Two (main)' }));
    expect(bindings.get(`${NEW}model`)).toMatchObject({ branch: result!.branch, commit: result!.commit });
    expect(bindings.get(`${NEW}model`)?.movedFrom).toBeUndefined();
    expect(bindings.get(`${NEW}model`)?.update).toBeUndefined();
    if (kind === 'github') expect(repo.commits.get(result!.commit)?.parents).toEqual([featureHead, mainHead]);
  });

  it('Update from main… on a branch started before main moved the model, with a conflict: the model moves, and the move is noted until committed', async () => {
    const binding = await bindAndMove();
    const fork = repo.branches.get('main')!;
    repo.commit('feature', [fork], new Map(repo.commits.get(fork)!.files));
    const featureHead = repo.push('feature', version(OLD, { e1: 'One (feature)', e2: 'Two' }));
    repo.push('main', version(NEW, { e1: 'One (main)', e2: 'Two' }));
    bindings.set(open, { ...binding, branch: 'feature', commit: featureHead, version: (await repo.readFile(featureHead, PATH))!.version });
    model = fileLines('feature');

    chooses.push('main');
    expect(await updateFromBranch(ctx)).toBeUndefined();
    expect(open).toBe(`${NEW}model`);
    expect(shown?.conflicts).toHaveLength(1);
    // The file on feature still has the model in the old namespace, until the update is committed.
    expect(bindings.get(`${NEW}model`)).toMatchObject({ branch: 'feature', commit: featureHead, movedFrom: `${OLD}model`, update: { branch: 'main' } });
    expect(repo.made).toEqual([]);
  });
});
