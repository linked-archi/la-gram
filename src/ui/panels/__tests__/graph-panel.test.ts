// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GraphQueryOptions, RelationshipGraph } from '../../../model-manager/relationship-graph.js';
import '../graph-panel.js';
import type { GraphPanel, GraphSource, GraphDownloadDetail } from '../graph-panel.js';
import type { GraphView, GraphViewHandlers } from '../graph-view.js';

const M = 'https://example.org/m/';
const L = 'https://example.org/lang#';

function fakeView() {
  const shown: Array<{ nodes: unknown[]; edges: unknown[]; root: string }> = [];
  let handlers: GraphViewHandlers | undefined;
  const view: GraphView = {
    show: (nodes, edges, root) => void shown.push({ nodes, edges, root }),
    relayout: vi.fn(),
    fit: vi.fn(),
    resize: vi.fn(),
    highlight: vi.fn(),
    destroy: vi.fn(),
  };
  return { view, shown, factory: vi.fn((_c: HTMLElement, h: GraphViewHandlers) => ((handlers = h), view)), handlers: () => handlers! };
}

function fakeSource() {
  const calls: GraphQueryOptions[] = [];
  const source: GraphSource = {
    graph: (options): RelationshipGraph => {
      calls.push(options);
      return {
        query: `# query for depth ${options.depth}`,
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

async function mount(active = true) {
  const panel = document.createElement('graph-panel') as GraphPanel;
  const view = fakeView();
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

afterEach(() => {
  document.body.innerHTML = '';
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

  it('exports the query and its result, and opens the query in the SPARQL tab', async () => {
    const { panel, root } = await mount();
    const downloads: GraphDownloadDetail[] = [];
    const opened: string[] = [];
    panel.addEventListener('graph-download', (e) => downloads.push((e as CustomEvent<GraphDownloadDetail>).detail));
    panel.addEventListener('graph-open-sparql', (e) => opened.push((e as CustomEvent<{ query: string }>).detail.query));
    root.querySelector<HTMLButtonElement>('[data-export="sparql"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-export="turtle"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-export="open-sparql"]')!.click();
    expect(downloads).toEqual([
      { text: '# query for depth 2', fileName: 'Clerk-graph.rq', mediaType: 'application/sparql-query' },
      { text: '@prefix m: <https://example.org/m/>.\nm:r1 a lang:Serving.', fileName: 'Clerk-graph.ttl', mediaType: 'text/turtle' },
    ]);
    expect(opened).toEqual(['# query for depth 2']);
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
