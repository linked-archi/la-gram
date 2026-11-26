// @vitest-environment jsdom
/**
 * `find-bar` (Req 23.1): what it says, what it asks for, and Esc going no further than it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import '../find-bar.js';
import type { FindBar } from '../find-bar.js';

let bar: FindBar;
afterEach(() => {
  document.body.innerHTML = '';
});

async function mount(setup: (b: FindBar) => void = () => {}): Promise<FindBar> {
  bar = document.createElement('find-bar');
  setup(bar);
  document.body.append(bar);
  await bar.updateComplete;
  return bar;
}
const $ = <T extends Element>(selector: string) => bar.shadowRoot!.querySelector<T>(selector)!;
const events = (...names: string[]) => {
  const seen: Array<[string, unknown]> = [];
  for (const name of names) document.body.addEventListener(name, (e) => seen.push([name, (e as CustomEvent).detail]));
  return seen;
};

describe('find-bar', () => {
  it('says how many match and which is current; nothing before a text; No matches for none', async () => {
    await mount();
    expect($('.count').textContent!.trim()).toBe('');
    bar.query = 'order';
    bar.count = 7;
    bar.current = 2;
    await bar.updateComplete;
    expect($('.count').textContent!.trim()).toBe('3 of 7');
    bar.count = 0;
    bar.current = -1;
    await bar.updateComplete;
    expect($('.count').textContent!.trim()).toBe('No matches');
    expect($<HTMLButtonElement>('button[data-action="next"]').disabled).toBe(true);
    bar.status = 'Too large to show, so not searched';
    await bar.updateComplete;
    expect($('.count').textContent!.trim()).toBe('Too large to show, so not searched');
  });

  it('typing asks for a search; Enter the next match, Shift+Enter the previous; the arrows the same', async () => {
    await mount((b) => {
      b.count = 3;
      b.current = 0;
    });
    const seen = events('find-query', 'find-step');
    const input = $<HTMLInputElement>('input');
    input.value = 'ord';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    $<HTMLButtonElement>('button[data-action="next"]').click();
    $<HTMLButtonElement>('button[data-action="previous"]').click();
    expect(seen).toEqual([
      ['find-query', { query: 'ord', matchCase: false }],
      ['find-step', { direction: 1 }],
      ['find-step', { direction: -1 }],
      ['find-step', { direction: 1 }],
      ['find-step', { direction: -1 }],
    ]);
  });

  it('Esc closes it and goes no further — a maximized panel stays maximized', async () => {
    await mount();
    const seen = events('find-close');
    let reached = false;
    document.body.addEventListener('keydown', () => (reached = true));
    $<HTMLInputElement>('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(seen.map(([name]) => name)).toEqual(['find-close']);
    expect(reached).toBe(false);
  });

  it('offers Aa, Select all and what is elsewhere only when its host does', async () => {
    await mount();
    expect(bar.shadowRoot!.querySelector('[data-action="match-case"]')).toBeNull();
    expect(bar.shadowRoot!.querySelector('[data-action="select-all"]')).toBeNull();
    expect(bar.shadowRoot!.querySelector('[data-action="elsewhere"]')).toBeNull();
    bar.caseOption = true;
    bar.selectAllOption = true;
    bar.elsewhere = '4 more in other views';
    bar.query = 'Shop';
    bar.count = 2;
    await bar.updateComplete;
    const seen = events('find-query', 'find-select-all', 'find-elsewhere');
    $<HTMLButtonElement>('[data-action="match-case"]').click();
    $<HTMLButtonElement>('[data-action="select-all"]').click();
    $<HTMLElement>('[data-action="elsewhere"]').click();
    expect(seen).toEqual([
      ['find-query', { query: 'Shop', matchCase: true }],
      ['find-select-all', null],
      ['find-elsewhere', null],
    ]);
    expect($('[data-action="elsewhere"]').textContent).toBe('4 more in other views');
  });
});
