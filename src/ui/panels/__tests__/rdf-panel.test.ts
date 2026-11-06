// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { HIGHLIGHT_LIMIT, escapeHtml, highlightRdf, readPrefixes, subjectOf, tokenizeLine } from '../rdf-highlight.js';
import '../rdf-panel.js';
import type { RdfPanel, RdfPanelRequest } from '../rdf-panel.js';

const TTL = `@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.

<urn:m/element/1> a am4:ApplicationComponent;
    skos:prefLabel "Web <shop> & \\"co\\""@en.
<urn:m/view/1/node/1> <https://meta.linked.archi/core-vis#bounds-x> "40"^^<http://www.w3.org/2001/XMLSchema#double>.
`;

describe('tokenizeLine', () => {
  it('recognises the Turtle token kinds', () => {
    const kinds = (line: string) => tokenizeLine(line).filter((t) => t.type !== 'ws').map((t) => t.type);
    expect(kinds('@prefix skos: <http://x#>.')).toEqual(['directive', 'pname', 'iri', 'punct']);
    expect(kinds('<urn:a> a am4:Node;')).toEqual(['iri', 'keyword', 'pname', 'punct']);
    expect(kinds('    skos:prefLabel "x"@en.')).toEqual(['pname', 'string', 'lang', 'punct']);
    expect(kinds('"40"^^<urn:dt> .')).toEqual(['string', 'datatype', 'iri', 'punct']);
    expect(kinds('_:b0 <urn:p> 42 .')).toEqual(['bnode', 'iri', 'number', 'punct']);
    expect(kinds('# a comment')).toEqual(['comment']);
  });

  it('keeps an escaped quote inside the string', () => {
    const strings = tokenizeLine('"a \\"b\\" c"@en.').filter((t) => t.type === 'string');
    expect(strings.map((t) => t.text)).toEqual(['"a \\"b\\" c"']);
  });
});

describe('subjects and prefixes', () => {
  it('reads @prefix declarations and expands prefixed subjects', () => {
    const prefixes = readPrefixes(TTL);
    expect(prefixes.get('am4')).toBe('https://meta.linked.archi/archimate4/onto#');
    expect(subjectOf('<urn:a> a <urn:t>.', prefixes)).toBe('urn:a');
    expect(subjectOf('am4:X a <urn:t>.', prefixes)).toBe('https://meta.linked.archi/archimate4/onto#X');
    expect(subjectOf('    skos:prefLabel "x".', prefixes)).toBeUndefined();
    expect(subjectOf('<urn:g> {', prefixes)).toBeUndefined();
    expect(subjectOf('@prefix a: <b>.', prefixes)).toBeUndefined();
  });
});

describe('highlightRdf', () => {
  it('escapes everything it does not tokenize into markup', () => {
    const html = highlightRdf(TTL, 'turtle');
    expect(html).toContain('Web &lt;shop&gt; &amp;');
    expect(html).not.toMatch(/<shop>/);
  });

  it('wraps each subject’s statements in one block, continuation lines included', () => {
    const doc = new DOMParser().parseFromString(`<pre>${highlightRdf(TTL, 'turtle')}</pre>`, 'text/html');
    const blocks = [...doc.querySelectorAll('.rdf-block')];
    expect(blocks.map((b) => b.getAttribute('data-subject'))).toEqual(['urn:m/element/1', 'urn:m/view/1/node/1']);
    expect(blocks[0].textContent).toContain('skos:prefLabel');
    // Prefix lines are outside any block.
    expect(doc.querySelector('.rdf-block .rdf-directive')).toBeNull();
  });

  it('groups consecutive N-Triples lines of one subject', () => {
    const nt = '<urn:a> <urn:p> "1" .\n<urn:a> <urn:q> "2" .\n<urn:b> <urn:p> "3" .\n';
    const doc = new DOMParser().parseFromString(`<pre>${highlightRdf(nt, 'n-triples')}</pre>`, 'text/html');
    expect([...doc.querySelectorAll('.rdf-block')].map((b) => b.getAttribute('data-subject'))).toEqual(['urn:a', 'urn:b']);
  });

  it('does not treat a TriG graph opening as a subject', () => {
    const trig = '<urn:g> {\n<urn:a> <urn:p> "1"\n}\n';
    const doc = new DOMParser().parseFromString(`<pre>${highlightRdf(trig, 'trig')}</pre>`, 'text/html');
    expect([...doc.querySelectorAll('.rdf-block')].map((b) => b.getAttribute('data-subject'))).toEqual(['urn:a']);
  });

  it('escapes JSON-LD and RDF/XML and colours their strings', () => {
    expect(highlightRdf('{"@id": "urn:<a>"}', 'json-ld')).toContain('urn:&lt;a&gt;');
    expect(highlightRdf('<rdf:RDF a="1"/>', 'rdf-xml')).toContain('&lt;<span class="rdf-pname">rdf:RDF</span>');
  });

  it('skips tokenizing past the size limit but still escapes', () => {
    const html = highlightRdf(TTL, 'turtle', 10);
    expect(html).not.toContain('rdf-pname');
    expect(html).toContain('&lt;urn:m/element/1&gt;');
  });

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('<rdf-panel>', () => {
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mount(active: boolean, text: (request: RdfPanelRequest) => string = (r) => (r.format === 'turtle' ? TTL : `# ${r.format}`)) {
    const panel = document.createElement('rdf-panel') as RdfPanel;
    const source = vi.fn((request: RdfPanelRequest) => ({
      text: text(request),
      stats: { elements: 1, relationships: 0, views: 1, triples: 3 },
      ...(request.scope === 'view' ? { caption: 'Landscape' } : {}),
    }));
    panel.source = source;
    panel.active = active;
    document.body.append(panel);
    await panel.updateComplete;
    return { panel, source };
  }

  it('does no work while hidden', async () => {
    const { panel, source } = await mount(false);
    panel.scheduleRefresh();
    panel.refresh();
    expect(source).not.toHaveBeenCalled();
  });

  it('serializes when opened and shows highlighted Turtle with counts', async () => {
    const { panel, source } = await mount(true);
    // The open view, by default.
    expect(source).toHaveBeenCalledWith({ format: 'turtle', profile: 'full', scope: 'view', selectedIris: [] });
    const root = panel.shadowRoot!;
    expect(root.querySelector('.code')!.textContent).toContain('skos:prefLabel');
    expect(root.querySelectorAll('.code .rdf-block')).toHaveLength(2);
    expect(root.querySelector('.stats')!.textContent).toMatch(/Landscape\s*1\s*elements\s*3\s*triples/);
  });

  it('debounces refreshes while shown', async () => {
    vi.useFakeTimers();
    const { panel, source } = await mount(true);
    source.mockClear();
    panel.scheduleRefresh();
    panel.scheduleRefresh();
    panel.scheduleRefresh();
    expect(source).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('switches format and drops geometry on request', async () => {
    const { panel, source } = await mount(true);
    const select = panel.shadowRoot!.querySelector<HTMLSelectElement>('select.format')!;
    select.value = 'json-ld';
    select.dispatchEvent(new Event('change'));
    expect(source).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'json-ld', profile: 'full' }));
    const box = panel.shadowRoot!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(source).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'json-ld', profile: 'no-geometry' }));
  });

  it('highlights the selected concept’s block, and selects on click', async () => {
    const { panel } = await mount(true);
    panel.selectedIri = 'urn:m/element/1';
    await panel.updateComplete;
    const block = panel.shadowRoot!.querySelector<HTMLElement>('.rdf-block[data-subject="urn:m/element/1"]')!;
    expect(block.classList.contains('selected')).toBe(true);

    const picked: string[] = [];
    panel.addEventListener('rdf-select', (e) => picked.push((e as CustomEvent<{ iri: string }>).detail.iri));
    panel.shadowRoot!.querySelector<HTMLElement>('.rdf-block[data-subject="urn:m/view/1/node/1"] .rdf-iri')!.click();
    expect(picked).toEqual(['urn:m/view/1/node/1']);
  });

  it('shows the scope chosen — remembered — and follows the selection when that is what it shows', async () => {
    const { panel, source } = await mount(true);
    const scope = panel.shadowRoot!.querySelector<HTMLSelectElement>('select.scope')!;
    expect([...scope.options].map((o) => o.textContent)).toEqual(['View', 'Selection', 'Model']);
    scope.value = 'selection';
    scope.dispatchEvent(new Event('change'));
    expect(remembered.get('la-gram:rdf-scope')).toBe('selection');
    expect(source).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'selection', selectedIris: [] }));
    source.mockClear();
    panel.selectedIri = 'urn:m/element/1';
    await panel.updateComplete;
    expect(source).toHaveBeenCalledWith(expect.objectContaining({ scope: 'selection', selectedIris: ['urn:m/element/1'] }));
    // Several selected on the canvas: all of them.
    source.mockClear();
    panel.selectedIris = ['urn:m/element/1', 'urn:m/view/1/node/1'];
    await panel.updateComplete;
    expect(source).toHaveBeenCalledWith(expect.objectContaining({ selectedIris: ['urn:m/element/1', 'urn:m/view/1/node/1'] }));
    const marked = [...panel.shadowRoot!.querySelectorAll<HTMLElement>('.rdf-block.selected')].map((b) => b.dataset['subject']);
    expect(marked).toEqual(['urn:m/element/1', 'urn:m/view/1/node/1']);
    // Another panel starts where this one was left.
    const again = await mount(true);
    expect(again.panel.scope).toBe('selection');
  });

  it('says what a scope with nothing to show needs', async () => {
    const { panel } = await mount(true, () => '');
    panel.scope = 'selection';
    await panel.updateComplete;
    expect(panel.shadowRoot!.querySelector('.empty')!.textContent).toMatch(/Select an element/);
    panel.scope = 'view';
    await panel.updateComplete;
    expect(panel.shadowRoot!.querySelector('.empty')!.textContent).toBe('No view is open.');
  });

  it('gives the size of a whole model too large to show, copies it afresh, and does not redo it on every change', async () => {
    vi.useFakeTimers();
    let version = 0;
    const { panel, source } = await mount(true, (r) => (r.scope === 'model' ? `# ${++version}\n` + 'x'.repeat(HIGHLIGHT_LIMIT) : TTL));
    panel.scope = 'model';
    await panel.updateComplete;
    const root = panel.shadowRoot!;
    expect(root.querySelector('.notice')!.textContent!.replace(/\s+/g, ' ')).toMatch(/1\.5 MB of Turtle — too large to show here/);
    expect(root.querySelector('.code')!.innerHTML).toBe('');
    source.mockClear();
    panel.scheduleRefresh();
    vi.advanceTimersByTime(300);
    expect(source).not.toHaveBeenCalled();
    const copied: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => void copied.push(t) } });
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Copy')!.click();
    await Promise.resolve();
    expect(copied[0]!.startsWith('# 2\n')).toBe(true);
    // Back to the view: shown again.
    panel.scope = 'view';
    await panel.updateComplete;
    expect(root.querySelector('.notice')).toBeNull();
    expect(root.querySelector('.code')!.textContent).toContain('skos:prefLabel');
  });

  it('asks to be maximized over the workspace, and shows when it is', async () => {
    const { panel } = await mount(true);
    const asked: string[] = [];
    panel.addEventListener('rdf-maximize-toggle', () => asked.push('toggle'));
    const button = () => panel.shadowRoot!.querySelector<HTMLButtonElement>('button.maximize')!;
    expect(button().textContent!.trim()).toBe('⤢');
    button().click();
    expect(asked).toEqual(['toggle']);
    panel.maximized = true;
    await panel.updateComplete;
    expect([button().textContent!.trim(), button().getAttribute('aria-pressed')]).toEqual(['⤡', 'true']);
  });

  it('asks the host to download, and to close', async () => {
    const { panel } = await mount(true);
    const events: string[] = [];
    panel.addEventListener('rdf-download', (e) => {
      const d = (e as CustomEvent<{ format: string; scope: string }>).detail;
      events.push(`download:${d.format}:${d.scope}`);
    });
    panel.addEventListener('rdf-close', () => events.push('close'));
    const buttons = [...panel.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')];
    buttons.find((b) => b.textContent!.trim() === 'Download')!.click();
    buttons.find((b) => b.classList.contains('close'))!.click();
    expect(events).toEqual(['download:turtle:view', 'close']);
  });
});
