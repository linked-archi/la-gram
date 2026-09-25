// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ModelContents } from '../../../model-manager/model-queries.js';
import {
  ModelExplorer,
  actionsFor,
  buildModelTree,
  filterTree,
  iriFragment,
  type ExplorerActionDetail,
  type ExplorerDragDetail,
  type ExplorerSelectDetail,
  type TreeNode,
} from '../model-explorer.js';
import { EventBus } from '../../event-bus.js';

const M = 'urn:m';
const contents = (): ModelContents => ({
  model: { iri: M, label: 'Shop' },
  views: [
    { iri: `${M}/view/1`, label: 'Main', type: 'Diagram' },
    { iri: `${M}/view/2`, label: 'Inventory', type: 'Catalog' },
  ],
  elements: [
    { iri: `${M}/element/a`, typeIri: 'urn:t#AppComponent', typeLabel: 'Application Component', label: 'Web' },
    { iri: `${M}/element/b`, typeIri: 'urn:t#AppComponent', typeLabel: 'Application Component', label: 'API' },
    { iri: `${M}/element/c`, typeIri: 'urn:t#Actor', typeLabel: 'Business Actor', label: 'Customer' },
  ],
  relationships: [
    { iri: `${M}/rel/1`, typeIri: 'urn:t#Serving', typeLabel: 'Serving', label: 'API → Web', sourceIri: `${M}/element/b`, targetIri: `${M}/element/a` },
  ],
  unclassified: [],
});

function find(nodes: TreeNode[], pred: (n: TreeNode) => boolean): TreeNode | undefined {
  for (const n of nodes) {
    if (pred(n)) return n;
    const inner = find(n.children, pred);
    if (inner) return inner;
  }
  return undefined;
}

describe('buildModelTree', () => {
  it('roots the tree at the model, with Views, Elements and Relationships folders', () => {
    const [root] = buildModelTree(contents(), `${M}/view/1`);
    expect(root).toMatchObject({ kind: 'model', label: 'Shop', iri: M });
    expect(root.children.map((c) => [c.label, c.detail])).toEqual([
      ['Views', '2'],
      ['Elements', '3'],
      ['Relationships', '1'],
    ]);
  });

  it('marks the open view and groups elements by type label', () => {
    const tree = buildModelTree(contents(), `${M}/view/1`, new Set([`${M}/element/a`]));
    expect(find(tree, (n) => n.iri === `${M}/view/1`)?.active).toBe(true);
    const elements = tree[0].children[1];
    expect(elements.children.map((g) => [g.label, g.detail])).toEqual([
      ['Application Component', '2'],
      ['Business Actor', '1'],
    ]);
    expect(find(tree, (n) => n.iri === `${M}/element/a`)?.placed).toBe(true);
    expect(find(tree, (n) => n.iri === `${M}/element/b`)?.placed).toBe(false);
  });

  it('adds an Unclassified folder only when there is something in it', () => {
    const c = contents();
    expect(buildModelTree(c, undefined)[0].children).toHaveLength(3);
    c.unclassified.push({ iri: 'urn:x', typeIri: 'urn:u#T', typeLabel: 'T', label: 'x' });
    expect(buildModelTree(c, undefined)[0].children.map((f) => f.label)).toContain('Unclassified');
  });
});

describe('filterTree', () => {
  it('keeps matches with their ancestors', () => {
    const tree = filterTree(buildModelTree(contents(), undefined), 'cust');
    expect(find(tree, (n) => n.label === 'Customer')).toBeDefined();
    expect(find(tree, (n) => n.label === 'Web')).toBeUndefined();
  });

  it('keeps a whole folder whose label matches', () => {
    const tree = filterTree(buildModelTree(contents(), undefined), 'application component');
    const group = find(tree, (n) => n.label === 'Application Component');
    expect(group?.children).toHaveLength(2);
  });

  it('returns everything for an empty query', () => {
    const tree = buildModelTree(contents(), undefined);
    expect(filterTree(tree, '  ')).toBe(tree);
  });
});

describe('actionsFor', () => {
  it('offers add-to-view for an unplaced element and reveal for a placed one', () => {
    const unplaced = actionsFor({ id: 'a', iri: 'a', kind: 'element', label: 'A', placed: false, children: [] });
    const placed = actionsFor({ id: 'a', iri: 'a', kind: 'element', label: 'A', placed: true, children: [] });
    expect(unplaced.map((a) => a.action)).toContain('add-to-view');
    expect(placed.map((a) => a.action)).toContain('reveal');
    expect(placed.find((a) => a.action === 'delete-from-model')?.danger).toBe(true);
  });

  it('offers view management on a view and view creation on the model', () => {
    expect(actionsFor({ id: 'v', iri: 'v', kind: 'view', label: 'V', children: [] }).map((a) => a.action)).toEqual([
      'open-view',
      'rename-view',
      'set-viewpoint',
      'duplicate-view',
      'delete-view',
    ]);
    expect(actionsFor({ id: 'm', iri: 'm', kind: 'model', label: 'M', children: [] }).map((a) => a.action)).toContain(
      'new-diagram',
    );
  });
});

describe('iriFragment', () => {
  it('takes the part after # or the last /', () => {
    expect(iriFragment('https://e.org/x#Y')).toBe('Y');
    expect(iriFragment('https://e.org/x/y')).toBe('y');
  });
});

describe('<model-explorer>', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mount(): Promise<ModelExplorer> {
    const el = document.createElement('model-explorer');
    el.contentsProvider = contents;
    el.activeViewIri = `${M}/view/1`;
    el.eventBus = new EventBus();
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  const row = (el: ModelExplorer, iri: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(`.row[data-iri="${iri}"]`)!;

  it('renders the tree and selects on click', async () => {
    const el = await mount();
    const seen: ExplorerSelectDetail[] = [];
    el.addEventListener('explorer-select', (e) => seen.push((e as CustomEvent<ExplorerSelectDetail>).detail));
    row(el, `${M}/element/a`).click();
    expect(seen).toEqual([{ iri: `${M}/element/a`, kind: 'element' }]);
  });

  it('opens a context menu and reports the picked action', async () => {
    const el = await mount();
    const actions: ExplorerActionDetail[] = [];
    el.addEventListener('explorer-action', (e) => actions.push((e as CustomEvent<ExplorerActionDetail>).detail));
    row(el, `${M}/view/2`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>('.menu [data-action="delete-view"]')!.click();
    expect(actions).toEqual([{ action: 'delete-view', iri: `${M}/view/2`, kind: 'view' }]);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.menu')).toBeNull();
  });

  it('turns a press on an element into a drag only past the threshold', async () => {
    const el = await mount();
    const drags: ExplorerDragDetail[] = [];
    el.addEventListener('explorer-drag-start', (e) => drags.push((e as CustomEvent<ExplorerDragDetail>).detail));
    row(el, `${M}/element/c`).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 11 }));
    expect(drags).toHaveLength(0);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 10 }));
    expect(drags.map((d) => d.iri)).toEqual([`${M}/element/c`]);
  });

  it('refreshes when the model changes', async () => {
    const el = await mount();
    const provider = vi.fn(contents);
    el.contentsProvider = provider;
    await el.updateComplete;
    provider.mockClear();
    el.eventBus!.emit('model-changed', {});
    expect(provider).toHaveBeenCalled();
  });
});
