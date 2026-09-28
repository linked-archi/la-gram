// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TypeGuide } from '../../../metamodel-manager/type-guide.js';
import '../type-guide-panel.js';
import type { TypeGuidePanel } from '../type-guide-panel.js';

const AM = 'https://example.org/am#';
const TAX = 'https://example.org/tax#';

const guides: Record<string, TypeGuide> = {
  [AM + 'Actor']: {
    iri: AM + 'Actor',
    label: 'Business Actor',
    altLabels: ['Person', 'Department'],
    definition: 'A business actor represents a business entity that is capable of performing behavior.',
    notes: ['A business actor may be assigned to one or more roles.', 'The name of a business actor should preferably be a noun.'],
    changes: ['4.0: roles moved to the Common Domain.'],
    abstract: false,
    sources: ['https://pubs.example.org/spec/chap08.html#sec-Business-Actor'],
    superclasses: [{ iri: AM + 'ActiveStructure', label: 'Active Structure Element', definition: 'Performs behavior.' }],
    classifications: [
      {
        axis: { iri: TAX + 'ByDomain', label: 'Element by Domain' },
        path: [{ iri: TAX + 'Business', label: 'Business Domain' }],
        group: { iri: TAX + 'Business', label: 'Business Domain', definition: 'Elements specific to the business.', notes: [], changes: [] },
        members: [{ iri: AM + 'Interface', label: 'Business Interface' }],
      },
    ],
    facts: [],
  },
  [AM + 'Interface']: {
    iri: AM + 'Interface',
    label: 'Business Interface',
    altLabels: [],
    definition: 'A point of access where a business actor makes services available.',
    notes: [],
    changes: [],
    abstract: false,
    sources: [],
    superclasses: [],
    classifications: [],
    facts: [],
  },
};

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

async function mount() {
  const panel = document.createElement('type-guide-panel') as TypeGuidePanel;
  panel.guideSource = (iri) => guides[iri];
  panel.guideIri = AM + 'Actor';
  document.body.append(panel);
  await panel.updateComplete;
  const root = panel.shadowRoot!;
  const about = async () => root.querySelector<HTMLElement>('.body')!;
  return { panel, root, about };
}

describe('<type-guide-panel>', () => {
  it('is headed by the type it describes, and asks the shell to fold it', async () => {
    const { panel, root } = await mount();
    expect(root.querySelector('.header .title')!.textContent).toBe('About Business Actor');
    const asked = vi.fn();
    panel.addEventListener('guide-fold-toggle', asked);
    root.querySelector<HTMLButtonElement>('.header')!.click();
    expect(asked).toHaveBeenCalledTimes(1);
    // The shell answers by folding it: the header stays, the body goes.
    panel.folded = true;
    await panel.updateComplete;
    expect(root.querySelector<HTMLElement>('.body')!.hidden).toBe(true);
    expect(root.querySelector('.header')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('asks for a selection when there is none', async () => {
    const { panel, root } = await mount();
    panel.guideIri = '';
    await panel.updateComplete;
    expect(root.querySelector('.header .title')!.textContent).toBe('About');
    expect(root.querySelector('.body')!.textContent).toMatch(/Select an element/);
  });

  it('shows the definition, other names, guidance, classification, superclasses, changes and the source', async () => {
    const { about } = await mount();
    const pane = await about();
    expect(pane.querySelector('.type')!.textContent).toMatch(/Business Actor/);
    expect(pane.querySelector('.aka')!.textContent).toBe('Also: Person, Department');
    expect(pane.querySelector('.definition')!.textContent).toMatch(/^A business actor represents/);
    const section = (id: string) => pane.querySelector<HTMLDetailsElement>(`details[data-section="${id}"]`)!;
    expect(section('guidance').querySelectorAll('p')).toHaveLength(2);
    expect(section('classification').textContent).toMatch(/Element by Domain[\s\S]*Business Domain[\s\S]*Also in Business Domain: Business Interface/);
    expect(section('ontology').textContent).toMatch(/Active Structure Element[\s\S]*Performs behavior/);
    expect(section('changes').textContent).toMatch(/roles moved/);
    // Guidance and classification open; the longer lists folded.
    expect([section('guidance').open, section('classification').open, section('ontology').open, section('changes').open]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    const source = pane.querySelector<HTMLAnchorElement>('.sources a')!;
    expect(source.textContent).toBe('pubs.example.org · Business Actor');
    expect(source.target).toBe('_blank');
  });

  it('opens a related type from its link, and comes back', async () => {
    const { panel, root, about } = await mount();
    const pane = await about();
    pane.querySelector<HTMLAnchorElement>(`.members a[data-iri="${AM}Interface"]`)!.click();
    await panel.updateComplete;
    const now = root.querySelector('.body')!;
    expect(now.querySelector('.type')!.textContent).toMatch(/Business Interface/);
    expect(root.querySelector('.header .title')!.textContent).toBe('About Business Interface');
    expect(now.querySelector('.back')!.textContent).toMatch(/← Business Actor/);
    now.querySelector<HTMLAnchorElement>('.back a')!.click();
    await panel.updateComplete;
    expect(root.querySelector('.body .type')!.textContent).toMatch(/Business Actor/);
    expect(root.querySelector('.body .back')).toBeNull();
  });

  it('goes back to the selection’s own type when another type is selected, but not on a mere refresh', async () => {
    const { panel, root, about } = await mount();
    (await about()).querySelector<HTMLAnchorElement>(`.members a[data-iri="${AM}Interface"]`)!.click();
    await panel.updateComplete;
    // The host re-sends the same type after any model change: stay.
    panel.guideIri = AM + 'Actor';
    await panel.updateComplete;
    expect(root.querySelector('.body .type')!.textContent).toMatch(/Business Interface/);
    panel.guideIri = AM + 'Interface';
    await panel.updateComplete;
    panel.guideIri = AM + 'Actor';
    await panel.updateComplete;
    expect(root.querySelector('.body .type')!.textContent).toMatch(/Business Actor/);
    expect(root.querySelector('.body .back')).toBeNull();
  });

  it('remembers which sections are open', async () => {
    const { about } = await mount();
    const pane = await about();
    const ontology = pane.querySelector<HTMLDetailsElement>('details[data-section="ontology"]')!;
    ontology.open = true;
    ontology.dispatchEvent(new Event('toggle'));
    expect(JSON.parse(remembered.get('la-gram:about-sections')!)).toEqual({ ontology: true });
    document.body.innerHTML = '';
    const again = await (await mount()).about();
    expect(again.querySelector<HTMLDetailsElement>('details[data-section="ontology"]')!.open).toBe(true);
  });

  it('says so when the metamodels say nothing about the type', async () => {
    const { panel, root } = await mount();
    panel.guideIri = AM + 'Unknown';
    await panel.updateComplete;
    expect(root.querySelector('.body')!.textContent).toMatch(/say nothing about this type/);
  });
});
