/**
 * What Model settings shows of the model in Git (Req 18.30), after its name and namespace: where it is kept —
 * the file's address, as the host's page has it, which *Open from Git…* opens — and the account the user's
 * edits and commits name (Req 9.16, 18.29), as *File › Settings… › You* shows it. Shown to read and copy;
 * changed elsewhere: the address by *Save to Git as…*, the account by the token given for the host.
 */

import { accountText, type GitAccount } from '../model-manager/provenance.js';
import type { FormField } from '../ui/dialogs.js';
import type { GitBinding } from './bindings.js';
import { fileLink } from './link.js';

/** Model settings' *Git* part: the bound file, if any, and the account. */
export function modelSettingsFields(binding: GitBinding | undefined, account: GitAccount | undefined, recorded: boolean): FormField[] {
  const commit = binding?.commit ? `, last read or written at commit ${binding.commit.slice(0, 8)}` : '';
  return [
    {
      name: 'git',
      label: 'Git',
      type: 'section',
      hint: binding
        ? `Kept in ${binding.repository}, on branch ${binding.branch}.`
        : 'Not saved to Git: File › Save to Git… keeps the model in a repository.',
    },
    {
      name: 'git.address',
      label: 'Address',
      value: binding ? fileLink(binding, binding.branch, binding.path) : 'Not in Git',
      hint: binding
        ? `The file ${binding.path}${commit}. File › Open from Git… opens it from this address.`
        : 'Where the model is kept, once saved to Git.',
    },
    {
      name: 'git.account',
      label: 'Your Git account',
      value: account ? accountText(account) : 'None yet',
      hint: !account
        ? 'Read from GitLab or GitHub with the token you give la-gram, when you open or save a model there.'
        : recorded
          ? 'Recorded with your edits, beside your name from File › Settings… › You.'
          : 'Not recorded with your edits: File › Settings… › You records it.',
    },
  ];
}
