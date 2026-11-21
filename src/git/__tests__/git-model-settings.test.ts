/**
 * What Model settings shows of the model in Git (Req 18.30): a model not saved there, an account not known yet,
 * one not recorded with the edits; the bound case is shown through the mounted UI (`git-module.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { modelSettingsFields } from '../git-model-settings.js';
import type { GitBinding } from '../bindings.js';

const binding: GitBinding = {
  host: 'gitlab.com',
  provider: 'gitlab',
  apiBase: 'https://gitlab.com/api/v4',
  repository: 'acme/ea/arch',
  webUrl: 'https://gitlab.com/acme/ea/arch',
  branch: 'model-update',
  path: 'models/shop.trig',
  version: 'blob1',
  commit: '5c0e9d41aa',
};
const ada = { url: 'https://gitlab.com/ada', username: 'ada', name: 'Ada Lovelace' };

const shown = (fields: ReturnType<typeof modelSettingsFields>) => fields.map((f) => [f.name, f.value ?? null, f.hint]);

describe('Model settings’ Git part', () => {
  it('a bound model: the file’s address on its branch, and the account recorded with the edits', () => {
    expect(shown(modelSettingsFields(binding, ada, true))).toEqual([
      ['git', null, 'Kept in acme/ea/arch, on branch model-update.'],
      ['git.address', 'https://gitlab.com/acme/ea/arch/-/blob/model-update/models/shop.trig',
        'The file models/shop.trig, last read or written at commit 5c0e9d41. File › Open from Git… opens it from this address.'],
      ['git.account', 'ada · https://gitlab.com/ada', 'Recorded with your edits, beside your name from File › Settings… › You.'],
    ]);
  });

  it('a model not saved to Git, and no account read yet', () => {
    expect(shown(modelSettingsFields(undefined, undefined, true))).toEqual([
      ['git', null, 'Not saved to Git: File › Save to Git… keeps the model in a repository.'],
      ['git.address', 'Not in Git', 'Where the model is kept, once saved to Git.'],
      ['git.account', 'None yet', 'Read from GitLab or GitHub with the token you give la-gram, when you open or save a model there.'],
    ]);
  });

  it('an account not recorded with the edits says where to record it', () => {
    expect(modelSettingsFields(binding, ada, false).find((f) => f.name === 'git.account')?.hint).toBe(
      'Not recorded with your edits: File › Settings… › You records it.',
    );
  });
});
