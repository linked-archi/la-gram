// @vitest-environment jsdom

/**
 * The form dialog's fields: a section's heading (no value), a fixed field
 * (shown, not changed), a read-only one (shown to copy), a secret (never
 * pre-filled), a select.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detailLines, domDialogs, type DetailBlock } from '../dialogs.js';

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

  it('a read-only field is shown to select and copy, not to change, and is not the one focused', async () => {
    const answer = domDialogs.form('Model settings', [
      { name: 'git.file', label: 'File', value: 'https://gitlab.com/acme/arch/-/blob/main/a.ttl', readOnly: true },
      { name: 'label', label: 'Name', value: 'Shop' },
    ]);
    const file = dialog().querySelector<HTMLInputElement>('input[name="git.file"]')!;
    expect([file.readOnly, file.disabled, file.value]).toEqual([true, false, 'https://gitlab.com/acme/arch/-/blob/main/a.ttl']);
    expect(file.closest('.la-form-row')?.classList.contains('fixed')).toBe(true);
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    await Promise.resolve();
    expect(select.mock.contexts).toEqual([dialog().querySelector('input[name="label"]')]);
    select.mockRestore();
    ok();
    expect(await answer).toEqual({ 'git.file': 'https://gitlab.com/acme/arch/-/blob/main/a.ttl', label: 'Shop' });
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

describe('a form of several parts, as tabs', () => {
  const parts = [
    { name: 'metamodels', label: 'Metamodels', type: 'section' as const, hint: 'Which the menu offers.' },
    { name: 'metamodels.languages', label: 'Modelling languages', type: 'group' as const },
    { name: 'metamodels.am3', label: 'ArchiMate 3.2', type: 'checkbox' as const, value: true },
    { name: 'metamodels.am4', label: 'ArchiMate 4.0', type: 'checkbox' as const, value: false },
    { name: 'metamodels.frameworks', label: 'Frameworks', type: 'group' as const },
    { name: 'metamodels.togaf', label: 'TOGAF', type: 'checkbox' as const, value: true },
    { name: 'git', label: 'Git storage', type: 'section' as const },
    { name: 'git.folder', label: 'Folder', value: 'models' },
    { name: 'modules', label: 'Modules', type: 'section' as const },
    { name: 'modules.git', label: 'Git storage', type: 'checkbox' as const, value: true },
  ];
  const tabs = () => [...dialog().querySelectorAll<HTMLButtonElement>('.la-form-tab')];
  const shown = () => [...dialog().querySelectorAll<HTMLElement>('.la-form-pane')].filter((p) => !p.hidden).map((p) => p.dataset['section']);

  it('lists the parts down the side and shows one at a time; Up and Down move between them', async () => {
    const answer = domDialogs.form('Settings', parts, { tabs: true });
    expect(tabs().map((t) => t.textContent)).toEqual(['Metamodels', 'Git storage', 'Modules']);
    expect(shown()).toEqual(['metamodels']);
    expect(dialog().classList.contains('la-dialog-tabbed')).toBe(true);
    tabs()[1]!.click();
    expect(shown()).toEqual(['git']);
    tabs()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(shown()).toEqual(['modules']);
    tabs()[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(shown()).toEqual(['metamodels']);
    // Every part's values, whichever tab was open.
    ok();
    expect(await answer).toEqual({ 'metamodels.am3': true, 'metamodels.am4': false, 'metamodels.togaf': true, 'git.folder': 'models', 'modules.git': true });
  });

  it('opens at the part asked for', async () => {
    void domDialogs.form('Settings', parts, { tabs: true, openSection: 'git' });
    expect(shown()).toEqual(['git']);
  });

  it('puts a group’s switches in two columns, with All and None', async () => {
    const answer = domDialogs.form('Settings', parts, { tabs: true });
    const languages = dialog().querySelectorAll('.la-form-group-body')[0]!;
    expect(languages.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    const head = dialog().querySelectorAll('.la-form-group')[0]!;
    [...head.querySelectorAll<HTMLButtonElement>('.la-form-group-all')].find((b) => b.textContent === 'All')!.click();
    [...dialog().querySelectorAll('.la-form-group')[1]!.querySelectorAll<HTMLButtonElement>('.la-form-group-all')]
      .find((b) => b.textContent === 'None')!
      .click();
    ok();
    expect(await answer).toMatchObject({ 'metamodels.am3': true, 'metamodels.am4': true, 'metamodels.togaf': false });
  });

  it('opens and marks the part a problem is in', async () => {
    let tries = 0;
    void domDialogs.form('Settings', parts, {
      tabs: true,
      validate: () => (tries++ === 0 ? { message: 'Git storage: no such folder', field: 'git' } : null),
    });
    ok();
    expect(shown()).toEqual(['git']);
    expect(tabs()[1]!.classList.contains('invalid')).toBe(true);
    expect(dialog().querySelector('.la-dialog-error')!.textContent).toBe('Git storage: no such folder');
  });
});

describe('the choice dialog', () => {
  it('puts a filter over a long list — rows and the groups left empty hidden — and none over a short one', async () => {
    const short = domDialogs.choose('Viewpoint', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]);
    expect(dialog().querySelector('.la-choice-filter')).toBeNull();
    ok();
    expect(await short).toBe('a');
    document.querySelector('.la-dialog-backdrop')?.remove();

    const names = ['Actors', 'Applications', 'Business', 'Data', 'Devices', 'Goals', 'Motivation', 'Nodes', 'Roles', 'Strategy', 'Views'];
    const answer = domDialogs.choose(
      'Move to folder',
      names.map((name, i) => ({ value: name, label: name, group: i < 3 ? 'First' : 'Rest', ...(name === 'Roles' ? { detail: 'in Business' } : {}) })),
      'Views',
    );
    const filter = dialog().querySelector<HTMLInputElement>('.la-choice-filter')!;
    const shown = () => [...dialog().querySelectorAll<HTMLElement>('.la-choice')].filter((r) => !r.hidden).map((r) => r.dataset.value);
    const groups = () => [...dialog().querySelectorAll<HTMLElement>('.la-choice-group')].filter((g) => !g.hidden).map((g) => g.textContent);
    filter.value = 'bus';
    filter.dispatchEvent(new Event('input'));
    // By name, or by what is said under it.
    expect(shown()).toEqual(['Business', 'Roles']);
    expect(groups()).toEqual(['First', 'Rest']);
    // Every word, in the name or under it: a folder by its path.
    filter.value = 'busi  ro';
    filter.dispatchEvent(new Event('input'));
    expect(shown()).toEqual(['Roles']);
    filter.value = 'dev';
    filter.dispatchEvent(new Event('input'));
    expect(shown()).toEqual(['Devices']);
    expect(groups()).toEqual(['Rest']);
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    expect(shown()).toHaveLength(names.length);
    ok();
    expect(await answer).toBe('Views');
  });
});

describe('the details dialog (About, the keyboard shortcuts)', () => {
  const blocks: DetailBlock[] = [
    { kind: 'header', image: 'favicon.svg', title: 'la-gram', subtitle: 'Semantic Modeller for Enterprise and IT Architecture', note: 'Version 0.1.0' },
    { kind: 'heading', text: 'Licence' },
    { kind: 'text', text: 'Apache License 2.0.' },
    { kind: 'links', links: [{ label: 'Source code', href: 'https://example.org/la-gram' }] },
    { kind: 'rows', keys: true, rows: [['Ctrl+Y / Ctrl+Shift+Z', 'Redo']] },
  ];

  it('shows each part: the header, headings, text, links opened apart, keys as keys', async () => {
    const closed = domDialogs.details!('About la-gram', blocks);
    expect(dialog().classList.contains('la-dialog-details')).toBe(true);
    expect(dialog().querySelector('.la-details-header img')?.getAttribute('src')).toBe('favicon.svg');
    expect(dialog().querySelector('.la-details-title')?.textContent).toBe('la-gram');
    expect(dialog().querySelector('.la-details-note')?.textContent).toBe('Version 0.1.0');
    expect(dialog().querySelector('.la-details-heading')?.textContent).toBe('Licence');
    const link = dialog().querySelector<HTMLAnchorElement>('.la-details-links a')!;
    expect([link.textContent, link.getAttribute('href'), link.target, link.rel]).toEqual([
      'Source code',
      'https://example.org/la-gram',
      '_blank',
      'noopener noreferrer',
    ]);
    const keys = [...dialog().querySelectorAll('.la-details-rows.keys kbd')].map((k) => k.textContent);
    expect(keys).toEqual(['Ctrl+Y', 'Ctrl+Shift+Z']);
    expect(dialog().querySelector('.la-details-rows td:first-child')?.textContent).toBe('Ctrl+Y or Ctrl+Shift+Z');
    ok();
    await closed;
    expect(document.querySelector('.la-dialog')).toBeNull();
  });

  it('copies its text with the copy button, and stays open', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const closed = domDialogs.details!('About la-gram', blocks, { copy: { label: 'Copy version info', text: 'la-gram 0.1.0' } });
    const copy = [...dialog().querySelectorAll<HTMLButtonElement>('.la-button')].find((b) => b.textContent === 'Copy version info')!;
    copy.click();
    expect(writeText).toHaveBeenCalledWith('la-gram 0.1.0');
    expect(document.querySelector('.la-dialog')).not.toBeNull();
    ok();
    await closed;
    document.querySelector('.la-toasts')?.remove();
  });

  it('reads as lines of text where a dialog shows no parts', () => {
    expect(detailLines(blocks)).toEqual([
      'la-gram',
      'Semantic Modeller for Enterprise and IT Architecture',
      'Version 0.1.0',
      '',
      'Licence',
      'Apache License 2.0.',
      'Source code: https://example.org/la-gram',
      'Ctrl+Y / Ctrl+Shift+Z  Redo',
    ]);
  });
});

describe('the toast', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelector('.la-toasts')?.remove();
  });
  const toasts = () => [...document.querySelectorAll<HTMLElement>('.la-toast')];

  it('goes by itself after a few seconds; kept until its × closes it, `sticky` (Req 18.31)', () => {
    vi.useFakeTimers();
    domDialogs.toast('Saved shop.trig');
    domDialogs.toast('Committed abc12345 to acme/arch · main · models/shop.ttl', 'info', { sticky: true });
    expect(toasts().map((t) => t.classList.contains('sticky'))).toEqual([false, true]);
    vi.advanceTimersByTime(60_000);
    expect(toasts()).toHaveLength(1);
    const close = toasts()[0].querySelector<HTMLButtonElement>('.la-toast-close')!;
    expect(close.getAttribute('aria-label')).toBe('Close message');
    close.click();
    expect(toasts()).toHaveLength(0);
  });

  it('web addresses are links, opened on their own; trailing punctuation and markup stay text', () => {
    domDialogs.toast('Committed abc12345 — https://github.com/acme/arch/commit/abc12345. See <b>it</b>, or ftp://x.', 'info', { sticky: true });
    const [toast] = toasts();
    const links = [...toast.querySelectorAll('a')];
    expect(links.map((a) => [a.getAttribute('href'), a.target, a.rel])).toEqual([
      ['https://github.com/acme/arch/commit/abc12345', '_blank', 'noopener noreferrer'],
    ]);
    expect(toast.querySelector('b')).toBeNull();
    expect(toast.querySelector('.la-toast-text')!.textContent).toBe('Committed abc12345 — https://github.com/acme/arch/commit/abc12345. See <b>it</b>, or ftp://x.');
  });
});
