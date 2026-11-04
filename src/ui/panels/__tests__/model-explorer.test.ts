// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ModelContents } from '../../../model-manager/model-queries.js';
import {
  ModelExplorer,
  actionsFor,
  buildModelTree,
  filterTree,
  iriFragment,
  modelFolderOf,
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

/** The same model, kept in folders of its own as a converter brings them over from Archi. */
const withFolders = (): ModelContents => ({
  ...contents(),
  folders: [
    { iri: `${M}/folder/apps`, label: 'Applications', members: [`${M}/element/a`, `${M}/element/b`] },
    { iri: `${M}/folder/business`, label: 'Business', members: [] },
    { iri: `${M}/folder/actors`, label: 'Actors', parentIri: `${M}/folder/business`, members: [`${M}/element/c`] },
    // A member no longer in the model is not listed.
    { iri: `${M}/folder/views`, label: 'Views', members: [`${M}/view/1`, `${M}/element/deleted`] },
  ],
});

/** Labels, nested: a row with children as `[label, children]`. */
const outline = (nodes: TreeNode[]): unknown[] => nodes.map((n) => (n.children.length > 0 ? [n.label, outline(n.children)] : n.label));

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

  it('lists derivations the model does not state apart, by certainty, with their rule, and offers to confirm a potential one', () => {
    const c = contents();
    c.relationships.push(
      { iri: `${M}/d/1`, typeIri: 'urn:t#Serving', typeLabel: 'Serving', label: 'Customer → Web', derivation: { certainty: 'valid', rule: 'DR3' } },
      { iri: `${M}/d/2`, typeIri: 'urn:t#Flow', typeLabel: 'Flow', label: 'API → Customer', derivation: { certainty: 'potential', rule: 'PDR8' } },
    );
    const [root] = buildModelTree(c, undefined);
    expect(root.children.map((f) => [f.label, f.detail])).toEqual([
      ['Views', '2'],
      ['Elements', '3'],
      ['Relationships', '1'],
      ['Derived relationships', '2'],
    ]);
    const derived = root.children[3];
    expect(derived.children.map((f) => [f.label, f.detail])).toEqual([
      ['Valid', '1'],
      ['Potential', '1'],
    ]);
    const valid = find(derived.children, (n) => n.iri === `${M}/d/1`)!;
    const potential = find(derived.children, (n) => n.iri === `${M}/d/2`)!;
    expect([valid.derivation, valid.detail]).toEqual(['valid', 'DR3']);
    expect([potential.derivation, potential.detail]).toEqual(['potential', 'PDR8']);
    expect(find(root.children[2].children, (n) => n.iri === `${M}/d/1`)).toBeUndefined();

    const actions = (n: TreeNode) => actionsFor(n).map((a) => a.action);
    expect(actions(potential)).toContain('confirm-derivation');
    expect(actions(valid)).not.toContain('confirm-derivation');
    expect(actions(valid)).not.toContain('rename');
    expect(actions(find(root.children[2].children, (n) => n.iri === `${M}/rel/1`)!)).not.toContain('confirm-derivation');
  });

  it('adds an Unclassified folder only when there is something in it', () => {
    const c = contents();
    expect(buildModelTree(c, undefined)[0].children).toHaveLength(3);
    c.unclassified.push({ iri: 'urn:x', typeIri: 'urn:u#T', typeLabel: 'T', label: 'x' });
    expect(buildModelTree(c, undefined)[0].children.map((f) => f.label)).toContain('Unclassified');
  });
});

describe('buildModelTree, by folder', () => {
  it("shows the model's own folders — folders first, then by name, each folded — and what no folder holds apart", () => {
    const [root] = buildModelTree(withFolders(), `${M}/view/1`, new Set([`${M}/element/a`]), 'folders');
    expect(outline(root.children)).toEqual([
      ['Applications', ['API', 'Web']],
      ['Business', [['Actors', ['Customer']]]],
      ['Views', ['Main']],
      ['Not in a folder', [['Views', ['Inventory']], ['Relationships', [['Serving', ['API → Web']]]]]],
    ]);
    expect(root.children.map((f) => f.detail)).toEqual(['2', '1', '1', '2']);
    const folders = root.children.slice(0, 3);
    expect(folders.every((f) => f.folded)).toBe(true);
    expect(find(folders, (n) => n.label === 'Actors')?.folded).toBe(true);
    // What no folder holds starts open, its relationships folded, as by type.
    const unfiled = root.children[3];
    expect(unfiled.folded).toBeUndefined();
    expect(unfiled.children.map((g) => [g.label, g.folded ?? false])).toEqual([
      ['Views', false],
      ['Relationships', true],
    ]);
    // A concept's row is the same as by type: the open view marked, placement shown.
    expect(find(root.children, (n) => n.iri === `${M}/view/1`)?.active).toBe(true);
    expect(find(root.children, (n) => n.iri === `${M}/element/a`)).toMatchObject({ kind: 'element', placed: true });
  });

  it('keeps derivations apart, last', () => {
    const c = withFolders();
    c.relationships.push({ iri: `${M}/d/1`, typeIri: 'urn:t#Serving', typeLabel: 'Serving', label: 'Customer → Web', derivation: { certainty: 'valid' } });
    const [root] = buildModelTree(c, undefined, new Set(), 'folders');
    expect(root.children.map((f) => f.label).slice(-2)).toEqual(['Not in a folder', 'Derived relationships']);
  });

  it("shows a converter's folder for the model itself as the model: its folders at the top", () => {
    const c = contents();
    c.folders = [
      { iri: `${M}/folder`, label: 'shop', members: [] },
      { iri: `${M}/folder/Elements`, label: 'Elements', parentIri: `${M}/folder`, members: [`${M}/element/a`, `${M}/element/b`, `${M}/element/c`] },
      { iri: `${M}/folder/Relationships`, label: 'Relationships', parentIri: `${M}/folder`, members: [`${M}/rel/1`] },
      { iri: `${M}/folder/Views`, label: 'Views', parentIri: `${M}/folder`, members: [`${M}/view/1`, `${M}/view/2`] },
    ];
    const [root] = buildModelTree(c, undefined, new Set(), 'folders');
    expect(root.children.map((f) => [f.label, f.detail])).toEqual([
      ['Elements', '3'],
      ['Relationships', '1'],
      ['Views', '2'],
    ]);
  });

  it('keeps a folder of the user\'s own that holds only folders: it is not named after the model', () => {
    const c = contents();
    c.folders = [
      { iri: `${M}/folder/business`, label: 'Business', members: [] },
      { iri: `${M}/folder/actors`, label: 'Actors', parentIri: `${M}/folder/business`, members: [`${M}/element/c`] },
    ];
    expect(modelFolderOf(c)).toBeUndefined();
    const [root] = buildModelTree(c, undefined, new Set(), 'folders');
    expect(root.children.map((f) => f.label)).toEqual(['Business', 'Not in a folder']);
    // A folder row carries the folder it shows.
    expect(root.children[0]).toMatchObject({ kind: 'folder', folderIri: `${M}/folder/business` });
    // Named as the model is: the converter's, shown as the model.
    c.folders[0].label = 'shop';
    expect(modelFolderOf(c)?.iri).toBe(`${M}/folder/business`);
    expect(buildModelTree(c, undefined, new Set(), 'folders')[0].children.map((f) => f.label)).toEqual(['Actors', 'Not in a folder']);
  });

  it('lists what folders in a cycle hold as in no folder', () => {
    const c = contents();
    c.folders = [
      { iri: `${M}/folder/x`, label: 'X', parentIri: `${M}/folder/y`, members: [`${M}/element/a`] },
      { iri: `${M}/folder/y`, label: 'Y', parentIri: `${M}/folder/x`, members: [] },
    ];
    const [root] = buildModelTree(c, undefined, new Set(), 'folders');
    expect(root.children.map((f) => f.label)).toEqual(['Not in a folder']);
    expect(find(root.children, (n) => n.iri === `${M}/element/a`)).toBeDefined();
  });

  it('groups by type when asked, or when the model has no folders', () => {
    const byType = outline(buildModelTree(contents(), undefined));
    expect(outline(buildModelTree(withFolders(), undefined, new Set(), 'types'))).toEqual(byType);
    expect(outline(buildModelTree(contents(), undefined, new Set(), 'folders'))).toEqual(byType);
  });

  it('filters through folders', () => {
    const tree = filterTree(buildModelTree(withFolders(), undefined, new Set(), 'folders'), 'cust');
    expect(outline(tree[0].children)).toEqual([['Business', [['Actors', ['Customer']]]]]);
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

  it('makes a folder from the model and from a folder of its own; moves a concept only when there are folders', () => {
    const actions = (n: TreeNode, folders = false) => actionsFor(n, { folders }).map((a) => a.action);
    expect(actions({ id: 'm', iri: 'm', kind: 'model', label: 'M', children: [] })).toContain('new-folder');
    expect(actions({ id: 'folder-iri:f', folderIri: 'f', kind: 'folder', label: 'F', children: [] }, true)).toEqual([
      'new-folder',
      'rename-folder',
      'move-to-folder',
      'delete-folder',
    ]);
    // The tree's own groupings are no folders of the model's.
    expect(actions({ id: 'folder:elements', kind: 'folder', label: 'Elements', children: [] }, true)).toEqual([]);
    const element: TreeNode = { id: 'a', iri: 'a', kind: 'element', label: 'A', children: [] };
    expect(actions(element)).not.toContain('move-to-folder');
    expect(actions(element, true)).toContain('move-to-folder');
    expect(actions({ id: 'v', iri: 'v', kind: 'view', label: 'V', children: [] }, true)).toContain('move-to-folder');
    expect(actions({ id: 'r', iri: 'r', kind: 'relationship', label: 'R', children: [] }, true)).toContain('move-to-folder');
    // A derivation is not the model's: nothing to file.
    expect(actions({ id: 'd', iri: 'd', kind: 'relationship', label: 'D', derivation: 'potential', children: [] }, true)).not.toContain('move-to-folder');
  });
});

describe('iriFragment', () => {
  it('takes the part after # or the last /', () => {
    expect(iriFragment('https://e.org/x#Y')).toBe('Y');
    expect(iriFragment('https://e.org/x/y')).toBe('y');
  });
});

describe('<model-explorer>', () => {
  // Node's own localStorage stub shadows jsdom's: remembered choices go here.
  const remembered = new Map<string, string>();
  beforeEach(() => {
    remembered.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => remembered.get(key) ?? null,
      setItem: (key: string, value: string) => void remembered.set(key, value),
      removeItem: (key: string) => void remembered.delete(key),
    });
    // jsdom has no CSS.escape, which revealing a row uses to find it.
    vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/["\\]/g, '\\$&') });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  async function mount(provider: () => ModelContents = contents): Promise<ModelExplorer> {
    const el = document.createElement('model-explorer');
    el.contentsProvider = provider;
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

  it('refreshes when the model changes — once for the events of one task', async () => {
    const el = await mount();
    const provider = vi.fn(contents);
    el.contentsProvider = provider;
    await el.updateComplete;
    provider.mockClear();
    el.eventBus!.emit('model-changed', {});
    el.eventBus!.emit('views-changed', {});
    el.eventBus!.emit('element-created', {});
    expect(provider).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider).toHaveBeenCalledTimes(1);
  });

  describe('a model with folders', () => {
    const switchOf = (el: ModelExplorer) => el.shadowRoot!.querySelector('.grouping');
    const pressed = (el: ModelExplorer) => el.shadowRoot!.querySelector('.grouping [aria-pressed="true"]')?.getAttribute('data-grouping');
    const pick = async (el: ModelExplorer, grouping: 'folders' | 'types') => {
      el.shadowRoot!.querySelector<HTMLButtonElement>(`.grouping [data-grouping="${grouping}"]`)!.click();
      await el.updateComplete;
    };
    const folderRow = (el: ModelExplorer, label: string) =>
      [...el.shadowRoot!.querySelectorAll<HTMLElement>('.row.folder')].find((r) => r.querySelector('.label')?.textContent === label)!;

    it('offers Folders | Types — Folders greyed out, the tree by type, when the model has none', async () => {
      const plain = await mount();
      expect(switchOf(plain)).not.toBeNull();
      expect(pressed(plain)).toBe('types');
      const greyed = plain.shadowRoot!.querySelector<HTMLButtonElement>('.grouping [data-grouping="folders"]')!;
      expect(greyed.disabled).toBe(true);
      expect(greyed.title).toBe('This model has no folders');
      // Greyed out, not forgotten: a model with folders still opens in them.
      expect(remembered.get('la-gram:explorer-grouping')).toBeUndefined();
      document.body.innerHTML = '';
      const el = await mount(withFolders);
      expect(pressed(el)).toBe('folders');
      expect(el.shadowRoot!.querySelector<HTMLButtonElement>('.grouping [data-grouping="folders"]')!.disabled).toBe(false);
    });

    it('starts with the folders folded, and unfolds one on a click', async () => {
      const el = await mount(withFolders);
      expect(el.shadowRoot!.querySelector(`.row[data-iri="${M}/element/a"]`)).toBeNull();
      folderRow(el, 'Applications').click();
      await el.updateComplete;
      expect(row(el, `${M}/element/a`)).not.toBeNull();
      folderRow(el, 'Applications').click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`.row[data-iri="${M}/element/a"]`)).toBeNull();
    });

    it('switches to by type and back, and remembers the pick', async () => {
      const el = await mount(withFolders);
      await pick(el, 'types');
      expect(pressed(el)).toBe('types');
      // By type: Elements open, its concepts shown.
      expect(row(el, `${M}/element/a`)).not.toBeNull();
      expect(folderRow(el, 'Applications')).toBeUndefined();
      document.body.innerHTML = '';
      const again = await mount(withFolders);
      expect(pressed(again)).toBe('types');
      await pick(again, 'folders');
      expect(folderRow(again, 'Applications')).toBeDefined();
      expect(remembered.get('la-gram:explorer-grouping')).toBe('folders');
    });

    it('shows what folded folders hold while filtering', async () => {
      const el = await mount(withFolders);
      const input = el.shadowRoot!.querySelector<HTMLInputElement>('.filter-input')!;
      input.value = 'cust';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;
      expect(row(el, `${M}/element/c`)).not.toBeNull();
    });

    it("reports a folder's menu picks with the folder it shows", async () => {
      const el = await mount(withFolders);
      const actions: ExplorerActionDetail[] = [];
      el.addEventListener('explorer-action', (e) => actions.push((e as CustomEvent<ExplorerActionDetail>).detail));
      folderRow(el, 'Business').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>('.menu [data-action="new-folder"]')!.click();
      expect(actions).toEqual([{ action: 'new-folder', iri: `${M}/folder/business`, kind: 'folder' }]);
      // A concept's menu offers to move it, now that there are folders.
      folderRow(el, 'Applications').click();
      await el.updateComplete;
      row(el, `${M}/element/a`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.menu [data-action="move-to-folder"]')).not.toBeNull();
    });

    it('reveals a folder — in the folders, switching to them', async () => {
      const el = await mount(withFolders);
      await pick(el, 'types');
      // jsdom does not scroll.
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value() {} });
      try {
        el.revealIri(`${M}/folder/actors`);
        await el.updateComplete;
        expect(pressed(el)).toBe('folders');
        expect(row(el, `${M}/folder/actors`).classList.contains('selected')).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it('unfolds the folders around a concept it reveals', async () => {
      const el = await mount(withFolders);
      // jsdom does not scroll.
      const scrolled: Element[] = [];
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value(this: HTMLElement) {
          scrolled.push(this);
        },
      });
      try {
        el.revealIri(`${M}/element/c`);
        await el.updateComplete;
        expect(row(el, `${M}/element/c`)).not.toBeNull();
        expect(el.selectedIri).toBe(`${M}/element/c`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(scrolled).toEqual([row(el, `${M}/element/c`)]);
      } finally {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });
  });

  it('marks another active view without reading the model again', async () => {
    const el = await mount();
    const provider = vi.fn(contents);
    el.contentsProvider = provider;
    await el.updateComplete;
    provider.mockClear();
    el.activeViewIri = 'urn:another-view';
    await el.updateComplete;
    expect(provider).not.toHaveBeenCalled();
  });
});
