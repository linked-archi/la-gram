// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { escapeHtml, highlightRdf, readPrefixes, subjectOf, tokenizeLine } from '../rdf-highlight.js';
import '../rdf-panel.js';
import type { RdfPanel } from '../rdf-panel.js';

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
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  async function mount(active: boolean) {
    const panel = document.createElement('rdf-panel') as RdfPanel;
    const source = vi.fn((format: string) => (format === 'turtle' ? TTL : `# ${format}`));
    panel.source = source;
    panel.statsProvider = () => ({ elements: 1, relationships: 0, views: 1, triples: 3 });
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
    expect(source).toHaveBeenCalledWith('turtle', 'full');
    const root = panel.shadowRoot!;
    expect(root.querySelector('.code')!.textContent).toContain('skos:prefLabel');
    expect(root.querySelectorAll('.code .rdf-block')).toHaveLength(2);
    expect(root.querySelector('.stats')!.textContent).toMatch(/1\s*elements/);
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
    const select = panel.shadowRoot!.querySelector<HTMLSelectElement>('select')!;
    select.value = 'json-ld';
    select.dispatchEvent(new Event('change'));
    expect(source).toHaveBeenLastCalledWith('json-ld', 'full');
    const box = panel.shadowRoot!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(source).toHaveBeenLastCalledWith('json-ld', 'no-geometry');
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

  it('asks the host to download, and to close', async () => {
    const { panel } = await mount(true);
    const events: string[] = [];
    panel.addEventListener('rdf-download', (e) => events.push(`download:${(e as CustomEvent<{ format: string }>).detail.format}`));
    panel.addEventListener('rdf-close', () => events.push('close'));
    const buttons = [...panel.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')];
    buttons.find((b) => b.textContent!.trim() === 'Download')!.click();
    buttons.find((b) => b.classList.contains('close'))!.click();
    expect(events).toEqual(['download:turtle', 'close']);
  });
});
