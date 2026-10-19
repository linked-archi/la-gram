// @vitest-environment jsdom

/**
 * The form dialog's fields: a section's heading (no value), a fixed field
 * (shown, not changed), a secret (never pre-filled), a select.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { domDialogs } from '../dialogs.js';

afterEach(() => document.querySelector('.la-dialog-backdrop')?.remove());

const dialog = () => document.querySelector('.la-dialog')!;
const ok = () => dialog().querySelector<HTMLButtonElement>('.la-button.primary')!.click();

describe('the form dialog', () => {
  it('sections head their fields, and give no value', async () => {
    const answer = domDialogs.form('Settings', [
      { name: 'git', label: 'Git storage', type: 'section', hint: 'Where saves start.' },
      { name: 'git.folder', label: 'Folder', value: 'models' },
      { name: 'modules', label: 'Modules', type: 'section' },
      { name: 'modules.git', label: 'Git storage', type: 'checkbox', value: true },
    ]);
    const headings = [...dialog().querySelectorAll('.la-form-section-title')].map((h) => h.textContent);
    expect(headings).toEqual(['Git storage', 'Modules']);
    expect(dialog().querySelector('.la-form-section .la-dialog-hint')?.textContent).toBe('Where saves start.');
    ok();
    expect(await answer).toEqual({ 'git.folder': 'models', 'modules.git': true });
  });

  it('a fixed field is shown and disabled, and the first field focused is one that can change', async () => {
    const answer = domDialogs.form('Settings', [
      { name: 'hosts', label: 'Git hosts allowed', value: 'github.com', disabled: true, hint: 'Set by the deployment.' },
      { name: 'folder', label: 'Folder', value: '' },
    ]);
    const hosts = dialog().querySelector<HTMLInputElement>('input[name="hosts"]')!;
    expect(hosts.disabled).toBe(true);
    expect(hosts.value).toBe('github.com');
    expect(hosts.closest('.la-form-row')?.classList.contains('fixed')).toBe(true);
    ok();
    expect(await answer).toEqual({ hosts: 'github.com', folder: '' });
  });

  it('a secret is typed unseen and never pre-filled; a select gives its value', async () => {
    const answer = domDialogs.form('Token', [
      { name: 'token', label: 'Token', type: 'password', value: 'should-not-show' },
      { name: 'kind', label: 'Host', type: 'select', value: 'gitlab', options: [{ value: 'github', label: 'GitHub' }, { value: 'gitlab', label: 'GitLab' }] },
    ]);
    const token = dialog().querySelector<HTMLInputElement>('input[name="token"]')!;
    expect(token.type).toBe('password');
    expect(token.value).toBe('');
    expect(token.getAttribute('autocomplete')).toBe('off');
    token.value = 'typed';
    ok();
    expect(await answer).toEqual({ token: 'typed', kind: 'gitlab' });
  });
});
