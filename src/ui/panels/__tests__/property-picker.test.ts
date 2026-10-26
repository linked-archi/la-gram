// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import type { PropertySuggestion, ResolvedProperty } from '../../../model-manager/property-catalog.js';
import '../property-picker.js';
import type { PropertyPicker, PropertyPickedDetail } from '../property-picker.js';

const M = 'https://example.org/archimate/1/';
const s = (iri: string, label: string, curie: string, group: PropertySuggestion['group'], groupLabel: string): PropertySuggestion => ({
  iri,
  label,
  curie,
  group,
  groupLabel,
});
const SUGGESTIONS = [
  s('https://meta.linked.archi/core#isAbstract', 'Is abstract', 'arch:isAbstract', 'type', 'For Business Actor'),
  s(`${M}owner`, 'Owner', 'm:owner', 'model', 'Used in this model'),
  s('http://www.w3.org/2004/02/skos/core#definition', 'Definition', 'skos:definition', 'documentation', 'Documentation'),
  s('https://meta.linked.archi/core#rationale', 'Rationale', 'arch:rationale', 'more', 'More'),
  s('https://meta.linked.archi/core#mentionedIn', 'Mentioned in', 'arch:mentionedIn', 'more', 'More'),
];
const resolve = (text: string): ResolvedProperty | undefined =>
  /^[a-z]+$/i.test(text) ? { iri: `${M}${text}`, curie: `m:${text}`, label: text[0].toUpperCase() + text.slice(1) } : undefined;

async function mount() {
  const picker = document.createElement('property-picker') as PropertyPicker;
  picker.suggest = () => SUGGESTIONS;
  picker.resolve = resolve;
  document.body.append(picker);
  await picker.updateComplete;
  const root = picker.shadowRoot!;
  const input = root.querySelector('input')!;
  const open = async () => {
    input.dispatchEvent(new Event('focus'));
    await picker.updateComplete;
  };
  const type = async (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await picker.updateComplete;
  };
  const key = async (k: string) => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    await picker.updateComplete;
  };
  const groups = () => [...root.querySelectorAll('.group')].map((g) => g.textContent!.trim());
  const names = () => [...root.querySelectorAll('.option .name')].map((n) => n.textContent!.trim());
  return { picker, root, open, type, key, groups, names };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<property-picker>', () => {
  it('lists the groups with the name first and the prefixed IRI under it, More folded', async () => {
    const { root, open, groups, names } = await mount();
    await open();
    expect(groups()).toEqual(['For Business Actor', 'Used in this model', 'Documentation', 'More (2) ▸']);
    expect(names()).toEqual(['Is abstract', 'Owner', 'Definition']);
    const first = root.querySelector('.option')!;
    expect(first.querySelector('.name')!.textContent).toBe('Is abstract');
    expect(first.querySelector('.iri')!.textContent).toBe('arch:isAbstract');

    (root.querySelector('.group.toggle') as HTMLElement).click();
    await (root.host as PropertyPicker).updateComplete;
    expect(names()).toEqual(['Is abstract', 'Owner', 'Definition', 'Rationale', 'Mentioned in']);
  });

  it('searches every group, More included, by name or prefixed IRI', async () => {
    const { open, type, names } = await mount();
    await open();
    // Matches first; the typed name itself last, as a new property.
    await type('ration');
    expect(names()).toEqual(['Rationale', 'Ration']);
    await type('skos:');
    expect(names()).toEqual(['Definition']);
  });

  it('offers typed text as a new property when it is not in the list', async () => {
    const { root, open, type, names } = await mount();
    await open();
    await type('budget');
    expect(names()).toEqual(['Budget']);
    expect(root.querySelector('.option.new .iri')!.textContent).toBe('m:budget');
    // Typing an existing one does not offer it twice.
    await type('owner');
    expect(names()).toEqual(['Owner']);
    expect(root.querySelector('.option.new')).toBeNull();
  });

  it('picks with the keyboard, reports it, and shows what was picked', async () => {
    const { picker, root, open, type, key } = await mount();
    const picked: PropertyPickedDetail[] = [];
    picker.addEventListener('property-picked', (e) => picked.push((e as CustomEvent<PropertyPickedDetail>).detail));
    await open();
    await type('o');
    await key('ArrowDown');
    await key('Enter');
    expect(picked).toHaveLength(1);
    expect(picker.value).toEqual(picked[0]);
    expect(root.querySelector('.list')).toBeNull();
    expect(root.querySelector('.chosen')!.textContent).toBe(picked[0].curie);
  });

  it('resolves typed text that was never picked, and clears', async () => {
    const { picker, open, type } = await mount();
    await open();
    await type('budget');
    expect(picker.value).toEqual({ iri: `${M}budget`, curie: 'm:budget', label: 'Budget' });
    picker.clear();
    await picker.updateComplete;
    expect(picker.value).toBeUndefined();
  });
});
