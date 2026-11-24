// @vitest-environment jsdom
/**
 * The Conflicts tab: a row per conflict — what it is about, each side's version
 * in words, a button for each — and what a click says to the host.
 */
import { describe, it, expect, afterEach } from 'vitest';
import '../conflicts-panel.js';
import type { ConflictPickDetail, ConflictsPanel } from '../conflicts-panel.js';
import type { MergeConflict } from '@linked-archi/kernel/model-manager/model-merge.js';

const M = 'https://example.org/m/';
const LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const VIS = 'https://meta.linked.archi/core-vis#';
const ARCH = 'https://meta.linked.archi/core#';
const bounds = (node: string, x: number) =>
  [`<${M}${node}> <${VIS}bounds-h> "55"^^<http://www.w3.org/2001/XMLSchema#double> .`,
   `<${M}${node}> <${VIS}bounds-w> "120"^^<http://www.w3.org/2001/XMLSchema#double> .`,
   `<${M}${node}> <${VIS}bounds-x> "${x}"^^<http://www.w3.org/2001/XMLSchema#double> .`,
   `<${M}${node}> <${VIS}bounds-y> "0"^^<http://www.w3.org/2001/XMLSchema#double> .`];

const CONFLICTS: MergeConflict[] = [
  {
    kind: 'value',
    subjects: [`${M}billing`],
    predicate: LABEL,
    language: 'en',
    held: [`<${M}billing> <${LABEL}> "Billing"@en .`],
    options: { ours: [`<${M}billing> <${LABEL}> "Invoicing"@en .`], theirs: [`<${M}billing> <${LABEL}> "Accounts"@en .`] },
  },
  {
    kind: 'value',
    subjects: [`${M}serving`],
    predicate: `${ARCH}target`,
    held: [],
    options: {
      ours: [`<${M}serving> <${ARCH}source> <${M}billing> .`, `<${M}serving> <${ARCH}target> <${M}crm> .`],
      theirs: [`<${M}serving> <${ARCH}source> <${M}billing> .`, `<${M}serving> <${ARCH}target> <${M}erp> .`],
    },
  },
  { kind: 'bounds', subjects: [`${M}node-billing`], held: bounds('node-billing', 0), options: { ours: bounds('node-billing', 40), theirs: bounds('node-billing', 80) } },
  { kind: 'deleted', subjects: [`${M}crm`], deletedBy: 'theirs', held: ['x'], options: { ours: ['x'], theirs: [] } },
];

const NAMES: Record<string, string> = { billing: 'Billing', serving: 'Serves', crm: 'CRM', erp: 'ERP', 'node-billing': 'Billing' };

async function panel(): Promise<{ panel: ConflictsPanel; root: ShadowRoot }> {
  const element = document.createElement('git-conflicts');
  element.describe = (iri) => ({ name: NAMES[iri.slice(M.length)] ?? iri, type: 'Application Component' });
  element.propertyName = (p) => (p === LABEL ? 'Name' : p === `${ARCH}target` ? 'Target' : p);
  element.entries = CONFLICTS.map((conflict) => ({ conflict }));
  element.against = { branch: 'main', commit: 'abcdef1234567' };
  document.body.append(element);
  await element.updateComplete;
  return { panel: element, root: element.shadowRoot! };
}

afterEach(() => document.body.replaceChildren());

const rows = (root: ShadowRoot) => [...root.querySelectorAll('.conflict')];
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the Conflicts tab', () => {
  it('says what was merged with, and how many are left', async () => {
    const { root } = await panel();
    expect(text(root.querySelector('.panel-header'))).toBe('Conflicts with main at abcdef12');
    expect(text(root.querySelector('.summary'))).toMatch(/^4 changes made on both sides to choose between/);
  });

  it('a value: the concept, the property and language, each side’s value, Keep mine and Take theirs', async () => {
    const { root } = await panel();
    const row = rows(root)[0];
    expect(text(row.querySelector('.what'))).toBe('Billing Application Component Name (en)');
    expect([...row.querySelectorAll('.value')].map(text)).toEqual(['“Invoicing” (en)', '“Accounts” (en)']);
    expect([...row.querySelectorAll('button')].map(text)).toEqual(['Keep mine', 'Take theirs']);
  });

  it('a relationship’s ends, as source → target; bounds as position and size', async () => {
    const { root } = await panel();
    expect([...rows(root)[1].querySelectorAll('.value')].map(text)).toEqual(['Billing → CRM', 'Billing → ERP']);
    expect([...rows(root)[2].querySelectorAll('.value')].map(text)).toEqual(['at 40, 0 · 120 × 55', 'at 80, 0 · 120 × 55']);
  });

  it('a deletion: Keep it for the side that kept it, Delete it for the side that deleted it', async () => {
    const { root } = await panel();
    const row = rows(root)[3];
    expect(text(row.querySelector('.aspect'))).toBe('deleted on one side, changed on the other');
    expect([...row.querySelectorAll('button')].map((b) => [text(b), b.getAttribute('data-side')])).toEqual([
      ['Keep it', 'ours'],
      ['Delete it', 'theirs'],
    ]);
    expect([...row.querySelectorAll('.value')].map(text)).toEqual(['Changed here', 'Deleted in theirs']);
  });

  it('a button asks the host for that side; a click on the concept shows it', async () => {
    const { panel: element, root } = await panel();
    const picks: ConflictPickDetail[] = [];
    const shown: string[] = [];
    element.addEventListener('conflict-pick', (e) => picks.push((e as CustomEvent<ConflictPickDetail>).detail));
    element.addEventListener('conflict-select', (e) => shown.push((e as CustomEvent<{ iri: string }>).detail.iri));
    (rows(root)[0].querySelector('button[data-side="theirs"]') as HTMLButtonElement).click();
    (rows(root)[3].querySelector('.what') as HTMLElement).click();
    expect(picks).toEqual([{ index: 0, side: 'theirs' }]);
    expect(shown).toEqual([`${M}crm`]);
  });

  it('a chosen side is marked, and all chosen says Save to Git commits', async () => {
    const { panel: element, root } = await panel();
    element.entries = CONFLICTS.map((conflict, i) => ({ conflict, picked: i === 0 ? 'theirs' : 'ours' }));
    await element.updateComplete;
    expect(rows(root)[0].classList.contains('chosen')).toBe(true);
    expect(rows(root)[0].querySelector('button[data-side="theirs"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(text(root.querySelector('.summary'))).toBe('All chosen. Save to Git commits the merged model.');
  });
});
