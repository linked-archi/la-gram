// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../named-picker.js';
import type { NamedOption, NamedPicker } from '../named-picker.js';

const AM3 = 'https://meta.linked.archi/archimate3/onto#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const TYPES: NamedOption[] = [
  { iri: `${AM4}BusinessActor`, label: 'Business Actor', groupLabel: 'Business' },
  { iri: `${AM4}BusinessRole`, label: 'Business Role', groupLabel: 'Business' },
  { iri: `${AM3}BusinessActor`, label: 'Business Actor', groupLabel: 'Business (ArchiMate 3)' },
];

async function mount(configure: (picker: NamedPicker) => void = () => {}) {
  const picker = document.createElement('named-picker') as NamedPicker;
  picker.options = () => TYPES;
  picker.iris = 'toggle';
  configure(picker);
  document.body.append(picker);
  await picker.updateComplete;
  const root = picker.shadowRoot!;
  const input = root.querySelector<HTMLInputElement>('input[type="text"]')!;
  const settle = () => picker.updateComplete;
  const open = async () => {
    input.dispatchEvent(new Event('focus'));
    await settle();
  };
  const type = async (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const key = async (k: string) => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    await settle();
  };
  const iris = () => [...root.querySelectorAll('.option')].map((o) => o.querySelector('.iri')?.textContent ?? null);
  return { picker, root, input, open, type, key, iris, settle };
}

// Node's own localStorage stub shadows jsdom's: remembered choices go here.
const remembered = new Map<string, string>();
beforeEach(() => {
  remembered.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => remembered.get(key) ?? null,
    setItem: (key: string, value: string) => void remembered.set(key, value),
    removeItem: (key: string) => void remembered.delete(key),
  });
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('<named-picker>', () => {
  it('shows names only — but the IRIs of entries that share a name — and every IRI behind its switch, remembered', async () => {
    const { root, open, iris, settle } = await mount();
    await open();
    expect([...root.querySelectorAll('.option .name')].map((n) => n.textContent)).toEqual(['Business Actor', 'Business Role', 'Business Actor']);
    expect(iris()).toEqual([`${AM4}BusinessActor`, null, `${AM3}BusinessActor`]);

    const toggle = root.querySelector<HTMLInputElement>('.iri-switch input')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await settle();
    expect(iris()).toEqual([`${AM4}BusinessActor`, `${AM4}BusinessRole`, `${AM3}BusinessActor`]);
    expect(remembered.get('la-gram:picker-show-iris')).toBe('true');

    // Another picker starts with them shown.
    const other = await mount();
    await other.open();
    expect(other.iris()).toEqual([`${AM4}BusinessActor`, `${AM4}BusinessRole`, `${AM3}BusinessActor`]);
  });

  it('is a choice of its selected entry: shows its name, and goes back to it when left without a pick', async () => {
    const { picker, input, open, type, settle } = await mount((p) => (p.selected = TYPES[0]));
    expect(input.value).toBe('Business Actor');
    expect(picker.choice?.iri).toBe(`${AM4}BusinessActor`);
    await open();
    await type('Role');
    input.dispatchEvent(new Event('blur'));
    await settle();
    expect(input.value).toBe('Business Actor');
    expect(picker.choice?.iri).toBe(`${AM4}BusinessActor`);
  });

  it('reports a pick, and goes back when told the choice was not made', async () => {
    const { picker, root, input, open, settle } = await mount((p) => (p.selected = TYPES[0]));
    const picked: string[] = [];
    picker.addEventListener('named-picked', (e) => picked.push((e as CustomEvent<NamedOption>).detail.iri));
    await open();
    root.querySelector<HTMLElement>(`.option[data-iri="${AM4}BusinessRole"]`)!.click();
    await settle();
    expect(picked).toEqual([`${AM4}BusinessRole`]);
    expect(input.value).toBe('Business Role');
    picker.revert();
    await settle();
    expect(input.value).toBe('Business Actor');
  });

  it('lists its first entries of a long list, says how many more, and offers typed text last', async () => {
    const many: NamedOption[] = Array.from({ length: 30 }, (_, i) => ({ iri: `https://example.org/m/e${i}`, label: `Element ${i}`, detail: 'Business Actor' }));
    const { root, open, type, key, picker } = await mount((p) => {
      p.options = () => many;
      p.limit = 10;
      p.typed = (text) => (text.trim() ? { iri: text, label: text, text: true, prefix: 'Text: ' } : undefined);
    });
    await open();
    expect(root.querySelectorAll('.option')).toHaveLength(10);
    expect(root.querySelector('.hint')!.textContent).toBe('20 more — type to narrow down.');
    expect(root.querySelector('.option .detail')!.textContent).toBe('Business Actor');
    await type('Element 2');
    expect([...root.querySelectorAll('.option .name')].map((n) => n.textContent)).toEqual([
      'Element 2',
      'Element 20',
      'Element 21',
      'Element 22',
      'Element 23',
      'Element 24',
      'Element 25',
      'Element 26',
      'Element 27',
      'Element 28',
      'Element 2',
    ]);
    expect(root.querySelector('.option.new .name')!.getAttribute('data-prefix')).toBe('Text: ');
    // Typed and never picked: the text is the choice; Enter on the closed list submits.
    await key('Escape');
    const submitted: string[] = [];
    picker.addEventListener('named-submit', () => submitted.push(picker.choice!.iri));
    await key('Enter');
    expect(submitted).toEqual(['Element 2']);
    expect(picker.choice?.text).toBe(true);
  });

  it('filters by kind beside the name: a switch per group, all on at first', async () => {
    const CONCEPTS: NamedOption[] = [
      { iri: 'urn:e:gateway', label: 'Payments Gateway', detail: 'Application Component', groupLabel: 'Elements' },
      { iri: 'urn:e:ledger', label: 'Ledger', detail: 'Application Component', groupLabel: 'Elements' },
      { iri: 'urn:r:serves', label: 'Gateway serves Ledger', detail: 'Serving', groupLabel: 'Relationships' },
      { iri: 'urn:v:main', label: 'Main', detail: 'View', groupLabel: 'Views' },
    ];
    const { root, open, type, settle } = await mount((p) => {
      p.options = () => CONCEPTS;
      p.groupFilter = true;
    });
    await open();
    const names = () => [...root.querySelectorAll('.option .name')].map((n) => n.textContent);
    const kinds = () => [...root.querySelectorAll<HTMLButtonElement>('.kinds .kind')];
    expect(kinds().map((k) => [k.textContent?.trim(), k.getAttribute('aria-pressed')])).toEqual([
      ['Elements', 'true'],
      ['Relationships', 'true'],
      ['Views', 'true'],
    ]);
    expect(names()).toHaveLength(4);

    kinds()[0]!.click();
    await settle();
    expect(names()).toEqual(['Gateway serves Ledger', 'Main']);
    // With the name filter too.
    await type('gateway');
    expect(names()).toEqual(['Gateway serves Ledger']);
    kinds()[0]!.click();
    kinds()[1]!.click();
    await settle();
    expect(names()).toEqual(['Payments Gateway']);
  });

  it('has no kind switches unless asked, nor with one group', async () => {
    const plain = await mount();
    await plain.open();
    expect(plain.root.querySelector('.kinds')).toBeNull();
    const single = await mount((p) => {
      p.groupFilter = true;
      p.options = () => TYPES.slice(0, 2);
    });
    await single.open();
    expect(single.root.querySelector('.kinds')).toBeNull();
  });
});
