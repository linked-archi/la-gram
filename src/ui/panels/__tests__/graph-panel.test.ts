// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { GraphQueryOptions, RelationshipGraph } from '@linked-archi/kernel/model-manager/relationship-graph.js';
import '../graph-panel.js';
import type { GraphPanel, GraphSource, GraphDownloadDetail, GraphNewViewDetail, GraphOpenSparqlDetail } from '../graph-panel.js';
import type { ForceParams } from '../graph-force.js';
import type { GraphLayout, GraphLayoutStats, GraphShowOptions, GraphView, GraphViewHandlers } from '../graph-view.js';

const M = 'https://example.org/m/';
const L = 'https://example.org/lang#';

const LIMITS = { animateMaxNodes: 300, liveDragMaxNodes: 600, forceMaxNodes: 600, syncSettleMs: 100, sliceMs: 12, settleBudgetMs: 1500 };

function fakeView() {
  const shown: Array<{ nodes: unknown[]; edges: unknown[]; root: string; layout: GraphLayout; options: GraphShowOptions | undefined }> = [];
  /** Each setForceParams(), with how many drawings came before it. */
  const forced: Array<{ params: ForceParams; final: boolean; shownBefore: number }> = [];
  let handlers: GraphViewHandlers | undefined;
  const view = {
    show: (nodes, edges, root, layout, options) => void shown.push({ nodes, edges, root, layout, options }),
    relayout: vi.fn(),
    setForceParams: vi.fn((params: ForceParams, final: boolean) => void forced.push({ params, final, shownBefore: shown.length })),
    fit: vi.fn(),
    resize: vi.fn(),
    highlight: vi.fn(),
    positions: vi.fn((space?: 'model' | 'rendered') =>
      space === 'rendered'
        ? new Map([[M + 'a', { x: 400, y: 120 }], [M + 'b', { x: 520, y: 120 }]])
        : new Map([[M + 'a', { x: 0, y: 0 }], [M + 'b', { x: 150, y: 0 }]]),
    ),
    pause: vi.fn(),
    layoutStats: vi.fn((): GraphLayoutStats => ({ layout: 'force', drawnBy: 'force', limits: LIMITS })),
    destroy: vi.fn(),
  } satisfies GraphView;
  return { view, shown, forced, factory: vi.fn((_c: HTMLElement, h: GraphViewHandlers) => ((handlers = h), view)), handlers: () => handlers! };
}

function fakeSource() {
  const calls: GraphQueryOptions[] = [];
  const source: GraphSource = {
    graph: (options): RelationshipGraph => {
      calls.push(options);
      return {
        query: `# construct for depth ${options.depth}`,
        selectQuery: `# select for depth ${options.depth}`,
        quads: [],
        nodes: [
          { iri: M + 'a', label: 'Clerk', typeIri: L + 'Actor', depth: 0 },
          { iri: M + 'b', label: 'Shop', typeIri: L + 'Component', depth: 1 },
        ],
        edges: [{ iri: M + 'r1', typeIri: L + 'Serving', source: M + 'a', target: M + 'b' }],
      };
    },
    types: () => ({
      elements: [
        { iri: L + 'Actor', label: 'Actor', count: 1, color: '#ffffb5' },
        { iri: L + 'Component', label: 'Component', count: 2 },
      ],
      relationships: [{ iri: L + 'Serving', label: 'Serving', count: 1 }],
    }),
    look: (typeIri) =>
      typeIri === L + 'Serving' ? { label: 'Serving', targetDecor: 'OpenArrowhead' } : { label: typeIri?.replace(L, '') ?? '?', color: '#ffffb5' },
    turtle: () => '@prefix m: <https://example.org/m/>.\nm:r1 a lang:Serving.',
    label: (iri) => (iri === M + 'a' ? 'Clerk' : iri),
  };
  return { source, calls };
}

async function mount(active = true, view = fakeView()) {
  const panel = document.createElement('graph-panel') as GraphPanel;
  const { source, calls } = fakeSource();
  panel.viewFactory = view.factory;
  panel.source = source;
  panel.rootIri = M + 'a';
  panel.active = active;
  document.body.append(panel);
  await panel.updateComplete;
  await panel.updateComplete;
  return { panel, view, calls, root: panel.shadowRoot! };
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

describe('<graph-panel>', () => {
  it('does nothing while its tab is hidden', async () => {
    const { calls, view } = await mount(false);
    expect(calls).toEqual([]);
    expect(view.factory).not.toHaveBeenCalled();
  });

  it('queries around the root at depth 2 and draws what comes back', async () => {
    const { calls, view, root } = await mount();
    expect(calls.at(-1)).toMatchObject({ rootIri: M + 'a', depth: 2, rootLabel: 'Clerk' });
    const drawn = view.shown.at(-1)!;
    expect(drawn.root).toBe(M + 'a');
    expect(drawn.nodes).toEqual([
      { id: M + 'a', label: 'Clerk', typeLabel: 'Actor', depth: 0, color: '#ffffb5' },
      { id: M + 'b', label: 'Shop', typeLabel: 'Component', depth: 1, color: '#ffffb5' },
    ]);
    expect(drawn.edges).toEqual([{ id: M + 'r1', source: M + 'a', target: M + 'b', label: 'Serving', targetDecor: 'OpenArrowhead' }]);
    await (root.host as GraphPanel).updateComplete;
    expect(root.querySelector('.stats')!.textContent).toMatch(/2 elements · 1 relationships/);
  });

  it('changes depth from its buttons', async () => {
    const { panel, calls, root } = await mount();
    root.querySelector<HTMLButtonElement>('.depth button[data-depth="4"]')!.click();
    expect(calls.at(-1)!.depth).toBe(4);
    await panel.updateComplete;
    expect(root.querySelector('.depth button[data-depth="4"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('filters types: what is unticked is left out of the query', async () => {
    const { panel, calls, root } = await mount();
    expect(calls.at(-1)!.elementTypes).toBeUndefined();
    const component = root.querySelector<HTMLInputElement>('details[data-kind="element"] li:nth-child(2) input')!;
    component.checked = false;
    component.dispatchEvent(new Event('change'));
    expect(calls.at(-1)!.elementTypes).toEqual([L + 'Actor']);
    await panel.updateComplete;
    expect(root.querySelector('details[data-kind="element"] .shown')!.textContent).toBe('1/2');
    panel.toggleType('relationship', L + 'Serving', false);
    expect(calls.at(-1)!.relationshipTypes).toEqual([]);
  });

  it('runs and exports the query as a SELECT or a CONSTRUCT, and exports the triples', async () => {
    const { panel, root } = await mount();
    const downloads: GraphDownloadDetail[] = [];
    const opened: GraphOpenSparqlDetail[] = [];
    panel.addEventListener('graph-download', (e) => downloads.push((e as CustomEvent<GraphDownloadDetail>).detail));
    panel.addEventListener('graph-open-sparql', (e) => opened.push((e as CustomEvent<GraphOpenSparqlDetail>).detail));
    // SELECT by default: a table.
    expect(root.querySelector('[data-form="select"]')!.getAttribute('aria-pressed')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-export="open-sparql"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-export="sparql"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-form="construct"]')!.click();
    await panel.updateComplete;
    expect(root.querySelector('[data-form="construct"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(remembered.get('la-gram:graph-query-form')).toBe('construct');
    root.querySelector<HTMLButtonElement>('[data-export="open-sparql"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-export="sparql"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-export="turtle"]')!.click();
    expect(opened).toEqual([
      { query: '# select for depth 2', form: 'select' },
      { query: '# construct for depth 2', form: 'construct' },
    ]);
    expect(downloads).toEqual([
      { text: '# select for depth 2', fileName: 'Clerk-graph-select.rq', mediaType: 'application/sparql-query' },
      { text: '# construct for depth 2', fileName: 'Clerk-graph-construct.rq', mediaType: 'application/sparql-query' },
      { text: '@prefix m: <https://example.org/m/>.\nm:r1 a lang:Serving.', fileName: 'Clerk-graph.ttl', mediaType: 'text/turtle' },
    ]);
  });

  it('asks for a new view of what is drawn, where it is drawn', async () => {
    const { panel, root } = await mount();
    const asked: GraphNewViewDetail[] = [];
    panel.addEventListener('graph-new-view', (e) => asked.push((e as CustomEvent<GraphNewViewDetail>).detail));
    root.querySelector<HTMLButtonElement>('[data-export="view"]')!.click();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.iris).toEqual([M + 'a', M + 'b', M + 'r1']);
    expect(asked[0]!.label).toBe('Clerk — 2 hops');
    expect(asked[0]!.centres.get(M + 'b')).toEqual({ x: 150, y: 0 });
  });

  it('reports clicks and double-clicks on the drawing', async () => {
    const { panel, view } = await mount();
    const events: string[] = [];
    panel.addEventListener('graph-select', (e) => events.push(`select ${(e as CustomEvent<{ iri: string }>).detail.iri}`));
    panel.addEventListener('graph-root', (e) => events.push(`root ${(e as CustomEvent<{ iri: string }>).detail.iri}`));
    view.handlers().select(M + 'b', 'node');
    view.handlers().root(M + 'b');
    expect(events).toEqual([`select ${M}b`, `root ${M}b`]);
  });

  it('asks for a selection when there is no root', async () => {
    const { panel, root } = await mount();
    panel.rootIri = '';
    await panel.updateComplete;
    await panel.updateComplete;
    expect(root.querySelector('.message')!.textContent).toMatch(/Select an element/);
  });
});

describe('<graph-panel> layouts (key decision 17)', () => {
  const select = (root: ShadowRoot) => root.querySelector<HTMLSelectElement>('select[aria-label="Layout"]')!;

  it('lays out with Force when nothing is remembered, listed first; keeps a remembered choice; an unknown one means Force', async () => {
    const { view, root } = await mount();
    expect(view.shown.at(-1)!.layout).toBe('force');
    expect([...select(root).options].map((o) => o.textContent!.trim())).toEqual(['Force', 'Rings', 'Tree']);
    expect(select(root).value).toBe('force');
    for (const [value, expected] of [
      ['rings', 'rings'],
      ['tree', 'tree'],
      ['force', 'force'],
      ['cose', 'force'],
    ] as const) {
      document.body.innerHTML = '';
      remembered.set('la-gram:graph-layout', value);
      const mounted = await mount();
      expect(mounted.view.shown.at(-1)!.layout).toBe(expected);
      expect(select(mounted.root).value).toBe(expected);
      // Nothing is rewritten: only a choice in the select is.
      expect(remembered.get('la-gram:graph-layout')).toBe(value);
    }
  });

  it('remembers Rings when it is chosen, and lays the graph out again with it', async () => {
    const { view, root } = await mount();
    select(root).value = 'rings';
    select(root).dispatchEvent(new Event('change'));
    expect(remembered.get('la-gram:graph-layout')).toBe('rings');
    expect(view.view.relayout).toHaveBeenCalledWith('rings');
  });

  it('pauses the drawing once when the tab is hidden; shown again, it draws with follow: false', async () => {
    const { panel, view } = await mount();
    const drawn = view.shown.length;
    panel.active = false;
    await panel.updateComplete;
    expect(view.view.pause).toHaveBeenCalledTimes(1);
    panel.active = true;
    await panel.updateComplete;
    expect(view.view.pause).toHaveBeenCalledTimes(1);
    expect(view.shown.length).toBe(drawn + 1);
    expect(view.shown.at(-1)!.options).toEqual({ follow: false });
  });

  it('draws a middle element set while the tab was hidden with follow: true when the tab is shown', async () => {
    const { panel, view } = await mount();
    panel.active = false;
    await panel.updateComplete;
    panel.rootIri = M + 'b';
    await panel.updateComplete;
    panel.active = true;
    await panel.updateComplete;
    expect(view.shown.at(-1)).toMatchObject({ root: M + 'b', options: { follow: true } });
  });

  it('destroys the drawing when the panel is removed', async () => {
    const { panel, view } = await mount();
    panel.remove();
    expect(view.view.destroy).toHaveBeenCalledTimes(1);
  });

  it('draws a depth change and an unticked type with follow: true, and a refresh after a model change with follow: false', async () => {
    const { panel, view, root } = await mount();
    expect(view.shown.at(-1)!.options).toEqual({ follow: true });
    root.querySelector<HTMLButtonElement>('.depth button[data-depth="3"]')!.click();
    expect(view.shown.at(-1)!.options).toEqual({ follow: true });
    panel.toggleType('element', L + 'Component', false);
    expect(view.shown.at(-1)!.options).toEqual({ follow: true });
    vi.useFakeTimers();
    try {
      const drawn = view.shown.length;
      panel.scheduleRefresh();
      vi.advanceTimersByTime(299);
      expect(view.shown.length).toBe(drawn);
      vi.advanceTimersByTime(1);
      expect(view.shown.length).toBe(drawn + 1);
      expect(view.shown.at(-1)!.options).toEqual({ follow: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the drawn positions in either space, and ＋ New view the model positions', async () => {
    const { panel, view, root } = await mount();
    expect(panel.drawnPositions('rendered').get(M + 'b')).toEqual({ x: 520, y: 120 });
    expect(view.view.positions).toHaveBeenLastCalledWith('rendered');
    const asked: GraphNewViewDetail[] = [];
    panel.addEventListener('graph-new-view', (e) => asked.push((e as CustomEvent<GraphNewViewDetail>).detail));
    root.querySelector<HTMLButtonElement>('[data-export="view"]')!.click();
    expect(view.view.positions).toHaveBeenLastCalledWith('model');
    expect(asked[0]!.centres.get(M + 'b')).toEqual({ x: 150, y: 0 });
  });

  it('gives the drawing’s layout stats, and none before the tab is first shown', async () => {
    const { panel, view } = await mount(false);
    expect(panel.layoutStats()).toBeUndefined();
    panel.active = true;
    await panel.updateComplete;
    expect(panel.layoutStats()).toEqual({ layout: 'force', drawnBy: 'force', limits: LIMITS });
    expect(view.view.layoutStats).toHaveBeenCalled();
  });

  it('says so on the stats line when Force drew the graph in rings', async () => {
    const view = fakeView();
    view.view.layoutStats.mockReturnValue({ layout: 'force', drawnBy: 'rings', limits: LIMITS });
    const { panel, root } = await mount(true, view);
    await panel.updateComplete;
    expect(root.querySelector('.stats')!.textContent!.trim()).toBe('2 elements · 1 relationships · drawn in rings: Force lays out up to 600 elements');

    document.body.innerHTML = '';
    const plain = await mount();
    await plain.panel.updateComplete;
    expect(plain.root.querySelector('.stats')!.textContent!.trim()).toBe('2 elements · 1 relationships');
  });
});

describe('<graph-panel> forces (Req 17.13)', () => {
  const KEY = 'la-gram:graph-forces';
  const DEFAULTS: ForceParams = { linkDistance: 180, chargeStrength: -350, collideScale: 1 };
  const select = (root: ShadowRoot) => root.querySelector<HTMLSelectElement>('select[aria-label="Layout"]')!;
  const slider = (root: ShadowRoot, key: keyof ForceParams) => root.querySelector<HTMLInputElement>(`details.forces input[data-force="${key}"]`)!;
  /** The three sliders' values, as the slider holds them (the charge's is the push, positive). */
  const values = (root: ShadowRoot) => (['linkDistance', 'chargeStrength', 'collideScale'] as const).map((key) => slider(root, key).value);
  /** The three values shown beside the labels. */
  const shown = (root: ShadowRoot) => ['force-link', 'force-charge', 'force-collide'].map((id) => root.querySelector(`output[for="${id}"]`)!.textContent!.trim());
  const spoken = (root: ShadowRoot) => (['linkDistance', 'chargeStrength', 'collideScale'] as const).map((key) => slider(root, key).getAttribute('aria-valuetext'));
  /** A slider moved to `value`: `input`, as while it is dragged, or `change`, as when it is let go or a key moves it. */
  const slide = (input: HTMLInputElement, value: string, event: 'input' | 'change') => {
    input.value = value;
    input.dispatchEvent(new Event(event));
  };

  it('shows the forces, folded, with Force only: not with Rings or Tree, chosen or remembered, and again with Force', async () => {
    const { panel, root } = await mount();
    const forces = () => root.querySelector<HTMLDetailsElement>('details.forces');
    expect(forces()!.open).toBe(false);
    expect(forces()!.querySelector('summary')!.textContent!.trim()).toBe('Forces');
    for (const layout of ['rings', 'tree', 'force'] as const) {
      select(root).value = layout;
      select(root).dispatchEvent(new Event('change'));
      await panel.updateComplete;
      expect(forces() !== null, layout).toBe(layout === 'force');
    }
    for (const layout of ['rings', 'tree']) {
      document.body.innerHTML = '';
      remembered.set('la-gram:graph-layout', layout);
      const mounted = await mount();
      expect(mounted.root.querySelector('details.forces'), layout).toBeNull();
    }
  });

  it('starts at the defaults when nothing is remembered, each labelled and shown with its unit, and gives them to the view before its first drawing', async () => {
    const { view, root } = await mount();
    expect(view.forced[0]).toEqual({ params: DEFAULTS, final: true, shownBefore: 0 });
    expect([...root.querySelectorAll('details.forces label')].map((l) => [l.textContent!.trim(), l.getAttribute('for')])).toEqual([
      ['Link distance', 'force-link'],
      ['Charge strength', 'force-charge'],
      ['Collision radius', 'force-collide'],
    ]);
    const ranges = (['linkDistance', 'chargeStrength', 'collideScale'] as const).map((key) => {
      const input = slider(root, key);
      return [input.id, input.type, input.min, input.max, input.step];
    });
    expect(ranges).toEqual([
      ['force-link', 'range', '40', '400', '10'],
      ['force-charge', 'range', '0', '1500', '50'],
      ['force-collide', 'range', '0.5', '2', '0.1'],
    ]);
    expect(values(root)).toEqual(['180', '350', '1']);
    expect(shown(root)).toEqual(['180 px', '350', '1.0×']);
    expect(spoken(root)).toEqual(['180 pixels', 'repulsion 350', '1.0 times']);
    expect(remembered.has(KEY)).toBe(false);
  });

  it('brings remembered forces into range and takes an unreadable field or key as the default, rewriting nothing on reading', async () => {
    const text = '{"linkDistance":9999,"chargeStrength":"x","collideScale":0.73}';
    remembered.set(KEY, text);
    const { panel, view, root } = await mount();
    const clamped = { linkDistance: 400, chargeStrength: -350, collideScale: 0.7 };
    expect(view.forced[0]).toEqual({ params: clamped, final: true, shownBefore: 0 });
    expect(panel.forces).toEqual(clamped);
    expect(values(root)).toEqual(['400', '350', '0.7']);
    expect(shown(root)).toEqual(['400 px', '350', '0.7×']);
    expect(remembered.get(KEY)).toBe(text);

    document.body.innerHTML = '';
    remembered.set(KEY, 'not json');
    const unreadable = await mount();
    expect(unreadable.view.forced[0]!.params).toEqual(DEFAULTS);
    expect(values(unreadable.root)).toEqual(['180', '350', '1']);
    expect(remembered.get(KEY)).toBe('not json');
  });

  it('gives a moving slider to the view with final: false, remembering nothing; let go, with final: true, remembering the three', async () => {
    const { panel, view, root } = await mount();
    const link = slider(root, 'linkDistance');
    slide(link, '230', 'input');
    expect(view.forced.at(-1)).toMatchObject({ params: { ...DEFAULTS, linkDistance: 230 }, final: false });
    await panel.updateComplete;
    expect(shown(root)[0]).toBe('230 px');
    expect(link.getAttribute('aria-valuetext')).toBe('230 pixels');
    expect(remembered.has(KEY)).toBe(false);
    slide(link, '230', 'change');
    expect(view.forced.at(-1)).toMatchObject({ params: { ...DEFAULTS, linkDistance: 230 }, final: true });
    expect(remembered.get(KEY)).toBe('{"linkDistance":230,"chargeStrength":-350,"collideScale":1}');
    expect(panel.forces).toEqual({ ...DEFAULTS, linkDistance: 230 });
  });

  it('gives the charge in d3’s sign: the slider at 1000 is a charge of −1000, shown as 1000', async () => {
    const { panel, view, root } = await mount();
    slide(slider(root, 'chargeStrength'), '1000', 'change');
    expect(view.forced.at(-1)).toMatchObject({ params: { ...DEFAULTS, chargeStrength: -1000 }, final: true });
    expect(JSON.parse(remembered.get(KEY)!)).toEqual({ ...DEFAULTS, chargeStrength: -1000 });
    await panel.updateComplete;
    expect(shown(root)[1]).toBe('1000');
    expect(slider(root, 'chargeStrength').getAttribute('aria-valuetext')).toBe('repulsion 1000');
    // The slider's 0 is no push: a charge of 0, not −0.
    slide(slider(root, 'chargeStrength'), '0', 'change');
    expect(Object.is(panel.forces.chargeStrength, 0)).toBe(true);
    expect(JSON.parse(remembered.get(KEY)!).chargeStrength).toBe(0);
  });

  it('Reset gives the defaults to the view with final: true, shows them, and forgets the remembered forces', async () => {
    remembered.set(KEY, '{"linkDistance":300,"chargeStrength":-800,"collideScale":1.5}');
    const { panel, view, root } = await mount();
    expect(values(root)).toEqual(['300', '800', '1.5']);
    root.querySelector<HTMLButtonElement>('details.forces button[data-force="reset"]')!.click();
    expect(view.forced.at(-1)).toMatchObject({ params: DEFAULTS, final: true });
    expect(remembered.has(KEY)).toBe(false);
    expect(panel.forces).toEqual(DEFAULTS);
    await panel.updateComplete;
    expect(values(root)).toEqual(['180', '350', '1']);
    expect(shown(root)).toEqual(['180 px', '350', '1.0×']);
  });

  it('disables the forces where Force draws the graph in rings, which the stats line says', async () => {
    const view = fakeView();
    view.view.layoutStats.mockReturnValue({ layout: 'force', drawnBy: 'rings', limits: LIMITS });
    const { panel, root } = await mount(true, view);
    await panel.updateComplete;
    expect(root.querySelector<HTMLFieldSetElement>('details.forces fieldset')!.disabled).toBe(true);
    expect(root.querySelector('.stats')!.textContent).toMatch(/drawn in rings: Force lays out up to 600 elements/);

    document.body.innerHTML = '';
    const plain = await mount();
    await plain.panel.updateComplete;
    expect(plain.root.querySelector<HTMLFieldSetElement>('details.forces fieldset')!.disabled).toBe(false);
  });
});
