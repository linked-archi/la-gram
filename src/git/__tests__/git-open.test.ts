/**
 * Open from Git (Req 18.7, 18.9, 18.10): a file link, a repository's model
 * files, another branch, a private repository, the newer version on a conflict
 * — against a fake host.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openFromGit, reopenFromGit, type GitOpenContext } from '../git-open.js';
import { saveToGit, type GitSaveContext } from '../git-save.js';
import { GitBindings } from '../bindings.js';
import { WebTokenStore } from '../credentials.js';
import { GitError } from '../errors.js';
import type { ChoiceOption, Dialogs, FormField, FormOptions, FormValues } from '../../ui/dialogs.js';
import type { CommitResult, FileChange, FileList, GitFile, GitHostProvider } from '../providers/provider.js';
import { parseRepositoryLink } from '../link.js';
import { MemoryStorage } from './memory-storage.js';

const TOKEN = 'glpat-OPEN-secret-7';

/** A repository in memory: branch heads, files at commits; private when asked. */
class FakeRepository implements GitHostProvider {
  readonly heads = new Map<string, string>([
    ['main', 'mainhead1'],
    ['dev', 'devhead22'],
  ]);
  readonly files = new Map<string, GitFile>([
    ['mainhead1:models/shop.ttl', { text: '# shop', version: 'v-shop' }],
    ['mainhead1:models/plant/line.trig', { text: '# line', version: 'v-line' }],
    ['mainhead1:README.md', { text: '# readme', version: 'v-readme' }],
    ['devhead22:models/shop.ttl', { text: '# shop on dev', version: 'v-shop-dev' }],
  ]);
  private = false;
  refuseToken = false;
  token: string | undefined;
  conflictNext = false;
  readonly commits: FileChange[] = [];

  private check(): void {
    if (this.private && !this.token) throw new GitError('not-found', 'The repository acme/arch was not found — or the token cannot see it.', 404);
    if (this.refuseToken && this.token) throw new GitError('auth', 'The token was refused: it is wrong, or it has expired.', 401);
  }
  async defaultBranch() {
    this.check();
    return 'main';
  }
  async branchHead(branch: string) {
    this.check();
    const head = this.heads.get(branch);
    if (!head) throw new GitError('not-found', `The branch ${branch} was not found — or the token cannot see it.`, 404);
    return head;
  }
  async readFile(ref: string, path: string) {
    this.check();
    return this.files.get(`${ref}:${path}`);
  }
  async listFiles(ref: string): Promise<FileList> {
    this.check();
    const paths = [...this.files.keys()].filter((k) => k.startsWith(`${ref}:`)).map((k) => k.slice(ref.length + 1));
    return { paths, truncated: false };
  }
  async listBranches() {
    this.check();
    return [...this.heads.keys()];
  }
  async commitFile(change: FileChange): Promise<CommitResult> {
    this.commits.push(change);
    if (this.conflictNext) {
      this.conflictNext = false;
      throw new GitError('conflict', `${change.path} changed in the repository since it was opened or last saved.`, 409);
    }
    return { version: 'v-new', commit: 'newcommit', branch: change.branch, webUrl: 'u' };
  }
}

let repo: FakeRepository;
let storage: MemoryStorage;
let forms: Array<FormValues | null>;
let chooses: Array<string | null>;
let chooseOptions: ChoiceOption[][];
let prompts: Array<string | null>;
let replaceAnswers: boolean[];
let asked: string[];
let opened: Array<{ text: string; fileName: string }>;
let reports: Array<{ message: string; level?: string }>;
let ctx: GitOpenContext;

beforeEach(() => {
  repo = new FakeRepository();
  storage = new MemoryStorage();
  forms = [];
  chooses = [];
  chooseOptions = [];
  prompts = [];
  replaceAnswers = [];
  asked = [];
  opened = [];
  reports = [];
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
    confirm: vi.fn(async () => true),
    choose: vi.fn(async (title: string, options: ChoiceOption[]) => {
      asked.push(`choose:${title}`);
      chooseOptions.push(options);
      return chooses.length ? chooses.shift()! : null;
    }),
    info: vi.fn(async () => undefined),
    toast: vi.fn(),
  };
  ctx = {
    dialogs,
    report: (message, level) => reports.push({ message, ...(level ? { level } : {}) }),
    tokens: new WebTokenStore(storage),
    bindings: new GitBindings(storage),
    provider: (_link, token) => {
      repo.token = token;
      return repo;
    },
    confirmReplace: async (what) => {
      asked.push(`replace:${what}`);
      return replaceAnswers.length ? replaceAnswers.shift()! : true;
    },
    open: async (text, fileName) => {
      opened.push({ text, fileName });
      return `https://example.org/m/${opened.length}`;
    },
  };
});

describe('a link to a file', () => {
  it('opens it at the branch’s head, without a token for a public repository, and binds the model', async () => {
    forms.push({ repository: 'https://gitlab.com/acme/arch/-/blob/main/models/shop.ttl' });
    const iri = await openFromGit(ctx);
    expect(asked).toEqual(['form:Open from Git', 'replace:Open from Git']);
    expect(opened).toEqual([{ text: '# shop', fileName: 'shop.ttl' }]);
    expect(repo.token).toBeUndefined();
    expect(ctx.bindings.get(iri!)).toMatchObject({
      host: 'gitlab.com',
      repository: 'acme/arch',
      branch: 'main',
      path: 'models/shop.ttl',
      version: 'v-shop',
      commit: 'mainhead1',
    });
    expect(reports.at(-1)?.message).toBe('From acme/arch · main · models/shop.ttl at mainhead: Save to Git commits there.');
  });

  it('?git=<link>: no dialog', async () => {
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/dev/models/shop.ttl');
    expect(asked).toEqual(['replace:Open from Git']);
    expect(opened[0].text).toBe('# shop on dev');
  });

  it('a file that is not a model, or not there', async () => {
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/README.md');
    expect(reports.at(-1)).toMatchObject({ level: 'error' });
    expect(reports.at(-1)?.message).toMatch(/README\.md is not a model file/);
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/models/gone.ttl');
    expect(reports.at(-1)?.message).toMatch(/models\/gone\.ttl is not on main/);
    expect(opened).toEqual([]);
  });

  it('kept from replacing the model: nothing opened, nothing bound', async () => {
    replaceAnswers.push(false);
    const iri = await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/models/shop.ttl');
    expect(iri).toBeUndefined();
    expect(opened).toEqual([]);
  });
});

describe('a link to a repository', () => {
  it('lists the model files on the default branch, by folder, and opens the one chosen', async () => {
    forms.push({ repository: 'https://gitlab.com/acme/arch' });
    chooses.push('models/plant/line.trig');
    await openFromGit(ctx);
    const options = chooseOptions[0];
    expect(options.map((o) => [o.group, o.label])).toEqual([
      ['models', 'shop.ttl'],
      ['models/plant', 'line.trig'],
      ['Branch', 'Another branch…'],
    ]);
    expect(asked).toContain('choose:Open from acme/arch · main');
    expect(opened).toEqual([{ text: '# line', fileName: 'line.trig' }]);
  });

  it('a folder link lists what is in it', async () => {
    chooses.push(null);
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/tree/main/models/plant');
    expect(chooseOptions[0].filter((o) => !o.disabled && o.group !== 'Branch').map((o) => o.value)).toEqual(['models/plant/line.trig']);
  });

  it('another branch, then its files', async () => {
    forms.push({ repository: 'https://gitlab.com/acme/arch' });
    chooses.push('\u0000branch', 'dev', 'models/shop.ttl');
    await openFromGit(ctx);
    expect(asked.filter((a) => a.startsWith('choose:'))).toEqual([
      'choose:Open from acme/arch · main',
      'choose:Branches of acme/arch',
      'choose:Open from acme/arch · dev',
    ]);
    expect(opened[0].text).toBe('# shop on dev');
    expect(ctx.bindings.get('https://example.org/m/1')).toMatchObject({ branch: 'dev', commit: 'devhead22' });
  });

  it('a branch with no model files says so', async () => {
    repo.files.clear();
    chooses.push(null);
    await openFromGit(ctx, 'https://gitlab.com/acme/arch');
    expect(chooseOptions[0].find((o) => o.disabled)?.label).toMatch(/No model files here/);
  });
});

describe('a private repository', () => {
  it('asks for a token when the host refuses without one, and reads again with it', async () => {
    repo.private = true;
    forms.push({ token: TOKEN, remember: false });
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/models/shop.ttl');
    expect(asked).toEqual(['form:Access token for gitlab.com', 'replace:Open from Git']);
    expect(repo.token).toBe(TOKEN);
    expect(opened).toHaveLength(1);
    expect(await ctx.tokens.get('gitlab.com')).toBe(TOKEN);
  });

  it('the token prompt names read access', async () => {
    repo.private = true;
    forms.push(null);
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/models/shop.ttl');
    const hint = vi.mocked(ctx.dialogs.form).mock.calls[0][1][0].hint;
    expect(hint).toMatch(/read_repository/);
    expect(opened).toEqual([]);
  });

  it('a refused token is forgotten, and said so', async () => {
    await ctx.tokens.set('gitlab.com', 'stale', false);
    repo.refuseToken = true;
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/models/shop.ttl');
    expect(reports.at(-1)?.message).toMatch(/refused.*forgotten/);
    expect(await ctx.tokens.get('gitlab.com')).toBeUndefined();
  });

  it('the token is in no report and no stored binding', async () => {
    repo.private = true;
    forms.push({ token: TOKEN, remember: false });
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/models/shop.ttl');
    expect(JSON.stringify(reports) + storage.dump()).not.toContain(TOKEN);
  });
});

describe('the newer version, on a conflict (Req 18.7)', () => {
  it('reopenFromGit asks, reads the head, and binds the model at the newer version', async () => {
    const link = parseRepositoryLink('https://gitlab.com/acme/arch');
    repo.heads.set('main', 'mainhead9');
    repo.files.set('mainhead9:models/shop.ttl', { text: '# shop, theirs', version: 'v-theirs' });
    expect(await reopenFromGit(ctx, link, 'main', 'models/shop.ttl')).toBe(true);
    expect(asked).toEqual(['replace:Open the newer version']);
    expect(ctx.bindings.get('https://example.org/m/1')).toMatchObject({ version: 'v-theirs', commit: 'mainhead9' });
  });

  it('Save to Git offers it when the file moved on', async () => {
    const reopened: string[] = [];
    const save: GitSaveContext = {
      modelIri: () => 'https://example.org/m/1',
      modelLabel: () => 'Shop',
      serialize: () => '# mine',
      saved: () => undefined,
      dialogs: ctx.dialogs,
      report: ctx.report,
      tokens: ctx.tokens,
      bindings: ctx.bindings,
      provider: ctx.provider,
      reopen: async (_link, branch, path) => {
        reopened.push(`${branch}:${path}`);
        return true;
      },
    };
    await openFromGit(ctx, 'https://gitlab.com/acme/arch/-/blob/main/models/shop.ttl');
    repo.conflictNext = true;
    forms.push({ token: TOKEN });
    prompts.push('Update');
    chooses.push('open');
    await saveToGit(save);
    expect(chooseOptions.at(-1)?.map((o) => o.value)).toEqual(['branch', 'overwrite', 'open']);
    expect(reopened).toEqual(['main:models/shop.ttl']);
    expect(repo.commits).toHaveLength(1);
  });
});
