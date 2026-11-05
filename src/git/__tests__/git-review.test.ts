/**
 * *Open merge request* (Phase 2 of the Git collaboration plan), as GitHub (a
 * pull request) and as GitLab (a merge request), against a repository in
 * memory: from the bound branch into the default, titled by the branch's last
 * commit, described by element — or where one is open already, or nothing to
 * merge — and offered after a save to a new branch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveToGit, type GitSaveContext } from '../git-save.js';
import { openMergeRequest } from '../git-review.js';
import { GitBindings, type GitBinding } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import type { Dialogs, FormField, FormValues } from '../../ui/dialogs.js';
import { MemoryStorage } from './memory-storage.js';
import { Repository } from './memory-repository.js';

const MODEL = 'https://example.org/m/model';
const PATH = 'models/shop.nt';
const LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const COMPONENT = 'https://meta.linked.archi/archimate4/onto#ApplicationComponent';
const element = (id: string, name: string) => [
  `<https://example.org/m/${id}> <${LABEL}> "${name}"@en .`,
  `<https://example.org/m/${id}> <${TYPE}> <${COMPONENT}> .`,
];
const BASE = [...element('e1', 'One'), ...element('e2', 'Two')].sort();
const RENAMED = [...element('e1', 'Uno'), ...element('e2', 'Two')].sort();
const FEATURE = 'la-gram/shop';

let repo: Repository;
let asked: string[];
let forms: Array<FormValues | null>;
let filled: Array<{ title: string; fields: FormField[] }>;
let confirms: boolean[];
let reports: string[];
let bindings: GitBindings;
let dirty: boolean;
let ctx: GitSaveContext;

function context(kind: 'github' | 'gitlab'): void {
  repo = new Repository(kind, PATH, `${BASE.join('\n')}\n`);
  asked = [];
  forms = [];
  filled = [];
  confirms = [];
  reports = [];
  dirty = false;
  const storage = new MemoryStorage();
  bindings = new GitBindings(storage);
  const dialogs: Dialogs = {
    prompt: vi.fn(async (title: string, _label: string, value?: string) => {
      asked.push(`prompt:${title}`);
      return value ?? null;
    }),
    form: vi.fn(async (title: string, fields: FormField[]) => {
      asked.push(`form:${title}`);
      filled.push({ title, fields });
      const answer = title.startsWith('Access token') ? { token: 'TOKEN' } : forms.length ? forms.shift()! : {};
      return answer === null ? null : ({ ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...answer } as FormValues);
    }),
    confirm: vi.fn(async (title: string) => {
      asked.push(`confirm:${title}`);
      return confirms.length ? confirms.shift()! : true;
    }),
    choose: vi.fn(async () => null),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  ctx = {
    modelIri: () => MODEL,
    modelLabel: () => 'Shop',
    serialize: () => repo.fileAt(bindings.get(MODEL)?.commit ?? 'main') ?? '',
    saved: () => undefined,
    dialogs,
    report: (message) => reports.push(message),
    tokens: new WebTokenStore(storage),
    bindings,
    provider: () => repo,
    now: () => new Date('2026-11-05T09:30:00Z'),
    isDirty: () => dirty,
    words: {
      typeName: (iri) => (iri === COMPONENT ? 'Application Component' : iri),
      propertyName: (iri) => (iri === LABEL ? 'Name' : iri),
    },
  };
}

/** The model bound to the file on `branch` at its head, as opening it binds it. */
async function bind(branch: string): Promise<GitBinding> {
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
  return binding;
}

/** A branch from main's head, with one commit renaming One. */
function feature(): void {
  repo.commit(FEATURE, ['root'], new Map(repo.commits.get('root')!.files));
  repo.push(FEATURE, RENAMED, 'Rename One to Uno\n\nAs agreed.');
}

describe.each(['github', 'gitlab'] as const)('Open merge request (%s)', (kind) => {
  const name = kind === 'github' ? 'pull request' : 'merge request';
  beforeEach(() => context(kind));

  it('not bound: says to save to Git first', async () => {
    expect(await openMergeRequest(ctx)).toBeUndefined();
    expect(reports).toEqual(['Save the model to Git first: a merge request merges the branch it is committed to.']);
    expect(asked).toEqual([]);
  });

  it('on the default branch: says it is the one a request would merge into', async () => {
    await bind('main');
    expect(await openMergeRequest(ctx)).toBeUndefined();
    expect(reports[0]).toBe(`The model is on main, the branch a ${name} would merge into. Save to Git as… commits it to a branch of its own.`);
    expect(repo.requests).toEqual([]);
  });

  it('opens one from the bound branch into the default: titled by its last commit, described by element', async () => {
    feature();
    await bind(FEATURE);
    const opened = await openMergeRequest(ctx);

    const dialog = filled.find((f) => f.title === `Open ${name}`)!;
    const value = (field: string) => dialog.fields.find((f) => f.name === field)?.value;
    expect(value('title')).toBe('Rename One to Uno');
    expect(value('description')).toBe(
      [
        '**Changes by element:** 1 changed',
        '',
        '- ✏️ **Uno** _Application Component_',
        '  - Name (en): “One” → “Uno”',
        '',
        `_In \`${PATH}\`, when this was opened._`,
      ].join('\n'),
    );
    expect(opened).toEqual({ number: 1, title: 'Rename One to Uno', webUrl: 'https://host/acme/arch/requests/1', source: FEATURE, target: 'main' });
    expect(repo.requests[0]?.description).toBe(value('description'));
    expect(reports).toEqual([`Opened ${name} ${kind === 'github' ? '#' : '!'}1 from ${FEATURE} into main — https://host/acme/arch/requests/1`]);
  });

  it('the title and description as edited', async () => {
    feature();
    await bind(FEATURE);
    forms.push({ title: 'Shop: names', description: 'Renames.' });
    await openMergeRequest(ctx);
    expect(repo.requests.map((r) => [r.title, r.description])).toEqual([['Shop: names', 'Renames.']]);
  });

  it('one open already from the branch: says where it is, and opens none', async () => {
    feature();
    await bind(FEATURE);
    await repo.openMergeRequest({ source: FEATURE, target: 'main', title: 'Earlier', description: '' });
    const found = await openMergeRequest(ctx);
    expect(found?.number).toBe(1);
    expect(repo.requests).toHaveLength(1);
    expect(reports[0]).toBe(`A ${name} from ${FEATURE} into main is open already: ${kind === 'github' ? '#' : '!'}1 Earlier — https://host/acme/arch/requests/1`);
    expect(asked.filter((a) => a.startsWith('form:Open'))).toEqual([]);
  });

  it('changes not saved to Git: asks first — and opens nothing when told not to', async () => {
    feature();
    await bind(FEATURE);
    dirty = true;
    confirms.push(false);
    expect(await openMergeRequest(ctx)).toBeUndefined();
    expect(asked).toContain('confirm:Changes not saved to Git');
    expect(repo.requests).toEqual([]);
  });

  it('nothing on the branch the default has not: says so', async () => {
    // Made from main's head, and committed to since only on main.
    repo.branches.set(FEATURE, 'root');
    repo.push('main', RENAMED);
    await bind(FEATURE);
    expect(await openMergeRequest(ctx)).toBeUndefined();
    expect(reports[0]).toBe(`${FEATURE} has nothing main does not: there is nothing to merge.`);
  });

  it('a token that may not: says which permission it needs', async () => {
    feature();
    await bind(FEATURE);
    repo.openMergeRequest = async () => {
      throw new GitError('forbidden', 'The token may not do this.', 403);
    };
    await openMergeRequest(ctx);
    expect(reports[0]).toBe(
      kind === 'github'
        ? 'The token may not open pull requests in acme/arch: it needs Pull requests: read and write on the repository, besides Contents.'
        : 'The token may not open merge requests in acme/arch: it needs the api scope.',
    );
  });

  it('refused because one was opened meanwhile: says where it is', async () => {
    feature();
    await bind(FEATURE);
    const open = repo.openMergeRequest.bind(repo);
    repo.openMergeRequest = async (change) => {
      await open({ ...change, title: 'Someone else’s' });
      throw new GitError('invalid', 'The host refused the request.', 422);
    };
    const found = await openMergeRequest(ctx);
    expect(found?.title).toBe('Someone else’s');
    expect(reports.at(-1)).toMatch(/is open already/);
  });

  it('after a save to a new branch: offered; accepted, into the branch it started from', async () => {
    await bind('main');
    repo.push('main', [...element('e1', 'One'), ...element('e2', 'Two (theirs)')].sort());
    const review = vi.fn(async () => undefined);
    ctx.review = review;
    (ctx.dialogs.choose as ReturnType<typeof vi.fn>).mockResolvedValueOnce('branch');
    const result = await saveToGit(ctx);

    expect(result?.branch).not.toBe('main');
    expect(asked).toContain(`confirm:Open ${name}`);
    expect(review).toHaveBeenCalledWith('main');
  });

  it('after a save to the same branch: not offered', async () => {
    await bind('main');
    const review = vi.fn(async () => undefined);
    ctx.review = review;
    await saveToGit(ctx);
    expect(asked.filter((a) => a.startsWith('confirm:Open'))).toEqual([]);
    expect(review).not.toHaveBeenCalled();
  });
});
