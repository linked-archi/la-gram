/**
 * Save to Git (Req 18.6–18.8, 18.10): the dialog, the token, the binding, a
 * file that is there, a file that moved on — against a fake host.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveToGit, formatOfPath, pathProblem, branchProblem, type GitSaveContext } from '../git-save.js';
import { GitBindings } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import type { Dialogs, FormField, FormOptions, FormValues } from '../../ui/dialogs.js';
import type { CommitResult, FileChange, GitFile, GitHostProvider } from '../providers/provider.js';
import type { RepositoryLink } from '../link.js';
import { MemoryStorage } from './memory-storage.js';

const TOKEN = 'glpat-SECRET-token-42';
const MODEL = 'https://example.org/archimate4/m1/model';

/** A repository in memory: files per branch, versions, commits. */
class FakeRepository implements GitHostProvider {
  readonly commits: FileChange[] = [];
  readonly files = new Map<string, GitFile>(); // `${branch}:${path}`
  conflictNext = false;
  refuseToken = false;
  links: RepositoryLink[] = [];
  tokens: Array<string | undefined> = [];
  private n = 0;

  async defaultBranch() {
    if (this.refuseToken) throw new GitError('auth', 'The token was refused: it is wrong, or it has expired.', 401);
    return 'main';
  }
  async branchHead(branch: string) {
    return `head-of-${branch}`;
  }
  async readFile(ref: string, path: string) {
    return this.files.get(`${ref}:${path}`);
  }
  async commitFile(change: FileChange): Promise<CommitResult> {
    this.commits.push(change);
    if (this.conflictNext) {
      this.conflictNext = false;
      throw new GitError('conflict', `${change.path} changed in the repository since it was opened or last saved.`, 409);
    }
    const branch = change.newBranch ?? change.branch;
    const commit = `c${++this.n}0000000000`;
    this.files.set(`${branch}:${change.path}`, { text: change.text, version: `v${this.n}` });
    return { version: `v${this.n}`, commit, branch, webUrl: `https://gitlab.com/acme/arch/-/commit/${commit}` };
  }
}

function scripted() {
  const forms: Array<FormValues | null> = [];
  const prompts: Array<string | null> = [];
  const chooses: Array<string | null> = [];
  const confirms: boolean[] = [];
  const asked: string[] = [];
  const dialogs: Dialogs = {
    prompt: vi.fn(async (title: string) => {
      asked.push(`prompt:${title}`);
      return prompts.length ? prompts.shift()! : null;
    }),
    form: vi.fn(async (title: string, fields: FormField[], options?: FormOptions) => {
      asked.push(`form:${title}`);
      const answer = forms.length ? forms.shift()! : {};
      if (answer === null) return null;
      const values: FormValues = { ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...answer };
      const problem = options?.validate?.(values);
      if (problem) throw new Error(`form rejected: ${problem}`);
      return values;
    }),
    confirm: vi.fn(async (title: string) => {
      asked.push(`confirm:${title}`);
      return confirms.length ? confirms.shift()! : true;
    }),
    choose: vi.fn(async (title: string) => {
      asked.push(`choose:${title}`);
      return chooses.length ? chooses.shift()! : null;
    }),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  return { dialogs, forms, prompts, chooses, confirms, asked };
}

let repo: FakeRepository;
let script: ReturnType<typeof scripted>;
let storage: MemoryStorage;
let reports: Array<{ message: string; level?: string }>;
let saved: string[];
let serialized: string[];
let ctx: GitSaveContext;

beforeEach(() => {
  repo = new FakeRepository();
  script = scripted();
  storage = new MemoryStorage();
  reports = [];
  saved = [];
  serialized = [];
  ctx = {
    modelIri: () => MODEL,
    modelLabel: () => 'Shop Floor',
    serialize: (format) => {
      serialized.push(format);
      return `# the model as ${format}\n`;
    },
    saved: (fileName) => saved.push(fileName),
    dialogs: script.dialogs,
    report: (message, level) => reports.push({ message, ...(level ? { level } : {}) }),
    tokens: new WebTokenStore(storage),
    bindings: new GitBindings(storage),
    provider: (link, token) => {
      repo.links.push(link);
      repo.tokens.push(token);
      return repo;
    },
    now: () => new Date('2026-10-19T09:30:00Z'),
  };
});

/** The first save: the dialog, then the token. */
async function firstSave(repository = 'https://gitlab.com/acme/arch', extra: FormValues = {}) {
  script.forms.push({ repository, ...extra }, { token: TOKEN, remember: false });
  return saveToGit(ctx);
}

describe('the first save to a repository', () => {
  it('asks where and for a token, commits to the default branch, binds the model, marks it saved', async () => {
    const result = await firstSave();
    expect(script.asked).toEqual(['form:Save to Git', 'form:Access token for gitlab.com']);
    expect(repo.commits).toEqual([
      { branch: 'main', path: 'models/shop-floor.ttl', text: '# the model as turtle\n', message: 'Add Shop Floor' },
    ]);
    expect(repo.tokens).toEqual([TOKEN]);
    expect(result?.commit).toBe('c10000000000');
    expect(ctx.bindings.get(MODEL)).toMatchObject({
      host: 'gitlab.com',
      repository: 'acme/arch',
      branch: 'main',
      path: 'models/shop-floor.ttl',
      version: 'v1',
      commit: 'c10000000000',
    });
    expect(saved).toEqual(['shop-floor.ttl']);
    expect(reports.at(-1)?.message).toMatch(/^Committed c1000000 to acme\/arch · main · models\/shop-floor\.ttl — https:\/\//);
  });

  it('a link to a file on a branch fills them in; the extension decides the format', async () => {
    await firstSave('https://gitlab.com/acme/arch/-/blob/dev/arch/shop.trig');
    expect(repo.commits[0]).toMatchObject({ branch: 'dev', path: 'arch/shop.trig' });
    expect(serialized).toEqual(['trig']);
  });

  it('a file already there is replaced only when the user says so — naming its version', async () => {
    repo.files.set('main:models/shop-floor.ttl', { text: 'theirs', version: 'theirs-1' });
    script.confirms.push(false);
    await firstSave();
    expect(script.asked).toContain('confirm:The file is there');
    expect(repo.commits).toHaveLength(0);

    script.confirms.push(true);
    await firstSave();
    expect(repo.commits[0].expectedVersion).toBe('theirs-1');
  });

  it('to a new branch, started from the one named', async () => {
    await firstSave('https://gitlab.com/acme/arch', { branch: 'main', newBranch: 'review/shop' });
    expect(repo.commits[0]).toMatchObject({ branch: 'main', newBranch: 'review/shop' });
    expect(repo.commits[0]).not.toHaveProperty('startFrom');
    expect(ctx.bindings.get(MODEL)?.branch).toBe('review/shop');
  });

  it('cancelled at the dialog or the token: nothing committed, nothing kept', async () => {
    script.forms.push(null);
    await saveToGit(ctx);
    script.forms.push({ repository: 'https://gitlab.com/acme/arch' }, null);
    await saveToGit(ctx);
    expect(repo.commits).toHaveLength(0);
    expect(ctx.bindings.get(MODEL)).toBeUndefined();
  });

  it('what the dialog refuses', async () => {
    const refused = async (repository: string, extra: FormValues, problem: RegExp) => {
      script.forms.length = 0;
      await expect(firstSave(repository, extra)).rejects.toThrow(problem);
    };
    await refused('https://gitlab.com/acme/arch', { path: 'models/shop.txt' }, /extension decides the format/);
    await refused('https://gitlab.com/acme/arch', { path: '/models/shop.ttl' }, /relative to the repository/);
    await refused('https://gitlab.com/acme/arch', { newBranch: 'my branch' }, /no spaces/);
    await refused('https://tok@gitlab.com/acme/arch', {}, /token is given separately/);
    expect(repo.commits).toHaveLength(0);
  });

  it('no model: nothing asked', async () => {
    ctx.modelIri = () => undefined;
    await saveToGit(ctx);
    expect(script.asked).toEqual([]);
    expect(reports[0].level).toBe('warning');
  });
});

describe('a bound model', () => {
  beforeEach(async () => {
    await firstSave();
    script.asked.length = 0;
  });

  it('asks only for the message, and replaces the version it saved', async () => {
    script.prompts.push('Name the conveyor');
    await saveToGit(ctx);
    expect(script.asked).toEqual(['prompt:Save to Git']);
    expect(repo.commits[1]).toMatchObject({ branch: 'main', path: 'models/shop-floor.ttl', message: 'Name the conveyor', expectedVersion: 'v1' });
    expect(ctx.bindings.get(MODEL)).toMatchObject({ version: 'v2', commit: 'c20000000000' });
  });

  it('Save to Git as… asks again, with the binding filled in', async () => {
    script.forms.push({ path: 'models/shop-2.ttl' });
    await saveToGit(ctx, true);
    expect(script.asked).toEqual(['form:Save to Git']);
    expect(repo.commits[1]).toMatchObject({ path: 'models/shop-2.ttl' });
  });

  it('the file moved on → a new branch, from the commit the model was saved at, replacing that version', async () => {
    repo.conflictNext = true;
    script.prompts.push('Update', 'la-gram/shop');
    script.chooses.push('branch');
    await saveToGit(ctx);
    expect(script.asked).toEqual(['prompt:Save to Git', 'choose:models/shop-floor.ttl changed in the repository', 'prompt:Save to a new branch']);
    expect(repo.commits[2]).toMatchObject({ branch: 'main', newBranch: 'la-gram/shop', startFrom: 'c10000000000', expectedVersion: 'v1' });
    expect(ctx.bindings.get(MODEL)?.branch).toBe('la-gram/shop');
  });

  it('the new branch’s name is suggested from the model and the time', async () => {
    repo.conflictNext = true;
    script.prompts.push('Update');
    script.chooses.push('branch');
    await saveToGit(ctx);
    const suggested = vi.mocked(script.dialogs.prompt).mock.calls.at(-1)?.[2];
    expect(suggested).toBe('la-gram/shop-floor-20261019-0930');
  });

  it('the file moved on → overwrite, naming the newer version', async () => {
    repo.files.set('main:models/shop-floor.ttl', { text: 'theirs', version: 'theirs-2' });
    repo.conflictNext = true;
    script.prompts.push('Update');
    script.chooses.push('overwrite');
    await saveToGit(ctx);
    expect(repo.commits[2]).toMatchObject({ branch: 'main', expectedVersion: 'theirs-2' });
    expect(repo.commits[2]).not.toHaveProperty('newBranch');
  });

  it('the file moved on → cancelled: nothing more committed, the binding as it was', async () => {
    repo.conflictNext = true;
    script.prompts.push('Update');
    script.chooses.push(null);
    await saveToGit(ctx);
    expect(repo.commits).toHaveLength(2);
    expect(saved).toEqual(['shop-floor.ttl']);
    expect(ctx.bindings.get(MODEL)?.version).toBe('v1');
  });
});

describe('the token', () => {
  it('kept for the session: the next save does not ask again', async () => {
    await firstSave();
    script.asked.length = 0;
    script.prompts.push('Again');
    await saveToGit(ctx);
    expect(script.asked).toEqual(['prompt:Save to Git']);
  });

  it('refused: forgotten, said in words, and asked for next time', async () => {
    repo.refuseToken = true;
    await firstSave();
    expect(reports.at(-1)).toMatchObject({ level: 'error' });
    expect(reports.at(-1)?.message).toMatch(/token was refused.*forgotten/);
    expect(await ctx.tokens.get('gitlab.com')).toBeUndefined();
  });

  it('never in a report, the binding, the stored data or the file written', async () => {
    await firstSave();
    script.prompts.push('Again');
    await saveToGit(ctx);
    const everything = [JSON.stringify(reports), storage.dump(), ...repo.commits.map((c) => c.text + c.message)].join('\n');
    expect(everything).not.toContain(TOKEN);
  });
});

describe('paths, formats and branch names', () => {
  it('the extension decides the format', () => {
    expect(formatOfPath('a/b.ttl')).toBe('turtle');
    expect(formatOfPath('a/b.TRIG')).toBe('trig');
    expect(formatOfPath('b.jsonld')).toBe('json-ld');
    expect(formatOfPath('b.txt')).toBeUndefined();
    expect(pathProblem('models/../x.ttl')).toMatch(/\.\./);
    expect(pathProblem('models/x.ttl')).toBeNull();
  });

  it('branch names Git takes', () => {
    for (const ok of ['main', 'feature/shop', 'la-gram/shop-20261019']) expect(branchProblem(ok)).toBeNull();
    for (const bad of ['a b', 'a..b', 'a~1', '/a', 'a/', '-a', 'a.lock', 'a//b']) expect(branchProblem(bad)).not.toBeNull();
  });
});
