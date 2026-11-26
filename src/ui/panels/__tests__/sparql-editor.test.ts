import { describe, it, expect, vi } from 'vitest';
import type { RdfStore, SparqlResult } from '@linked-archi/kernel/rdf-engine/interfaces.js';
import {
  SparqlEditor,
  sparqlStreamParser,
  sparqlLanguage,
  buildPrefixCompletions,
  extractColumns,
  termValue,
  curieOf,
  projectedVariables,
  resultIris,
  questionGroups,
  boundParameters,
  type ResultsViewRequestDetail,
  type QueryExecuteDetail,
} from '../sparql-editor.js';
import type { ModelQuestion } from '@linked-archi/kernel/model-manager/questions.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Creates a mock RdfStore that returns a given result or throws. */
function mockStore(result?: SparqlResult, error?: string): RdfStore {
  return {
    addQuads: vi.fn(),
    removeQuads: vi.fn(),
    getQuads: vi.fn(() => []),
    query: vi.fn((sparql: string) => {
      if (error) throw new Error(error);
      return result ?? { type: 'bindings', results: [] };
    }),
    update: vi.fn(),
  };
}

/** Flattens a Lit template result to a string for content assertions. */
function flat(t: any): string {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (typeof t === 'number' || typeof t === 'boolean') return String(t);
  if (t.strings) {
    let o = '';
    for (let i = 0; i < t.strings.length; i++) {
      o += t.strings[i];
      if (i < t.values?.length) o += flat(t.values[i]);
    }
    return o;
  }
  if (Array.isArray(t)) return t.map(flat).join('');
  return String(t ?? '');
}

/** Creates a minimal context for calling prototype methods. */
function makeCtx(overrides: Record<string, any> = {}) {
  const ctx: any = {
    rdfStore: undefined,
    _result: null,
    _error: '',
    _editorView: null,
    _prefixes: { ex: 'http://example.org/' },
    _columns: undefined,
    _menu: null,
    _concern: '',
    _asked: null,
    extraPrefixes: undefined,
    dispatchEvent: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
    renderRoot: { querySelector: () => null, querySelectorAll: () => [] },
    ...overrides,
  };
  // Bind prototype methods
  for (const m of [
    'executeQuery',
    'getQuery',
    'setQuery',
    '_onRunClick',
    '_onViewClick',
    '_onIriClick',
    '_renderResult',
    '_renderBindingsResult',
    '_renderBooleanResult',
    '_renderQuadsResult',
    '_renderTerm',
    '_renderViewButton',
    '_renderCount',
    '_renderAsked',
    '_renderQuestionsMenu',
    '_renderQuestion',
    '_name',
    '_menuButtons',
    'openQuestions',
    'closeQuestions',
    'ask',
    'run',
    'render',
  ]) {
    if (typeof (SparqlEditor.prototype as any)[m] === 'function') {
      ctx[m] = (SparqlEditor.prototype as any)[m].bind(ctx);
    }
  }
  return ctx;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('SparqlEditor', () => {
  it('exports the class', () => {
    expect(SparqlEditor).toBeDefined();
  });

  it('has static styles', () => {
    expect((SparqlEditor as any).styles).toBeDefined();
  });

  it('has render on prototype', () => {
    expect(typeof SparqlEditor.prototype.render).toBe('function');
  });
});

describe('sparqlStreamParser', () => {
  it('is defined with startState and token', () => {
    expect(sparqlStreamParser).toBeDefined();
    expect(typeof sparqlStreamParser.startState).toBe('function');
    expect(typeof sparqlStreamParser.token).toBe('function');
  });

  it('startState returns null', () => {
    expect(sparqlStreamParser.startState!(2)).toBeNull();
  });

  it('tokenizes a keyword', () => {
    const stream = makeStream('SELECT');
    const result = sparqlStreamParser.token(stream as any, null);
    expect(result).toBe('keyword');
  });

  it('tokenizes a variable', () => {
    const stream = makeStream('?name');
    const result = sparqlStreamParser.token(stream as any, null);
    expect(result).toBe('variableName');
  });

  it('tokenizes a prefixed name', () => {
    const stream = makeStream('rdf:type');
    const result = sparqlStreamParser.token(stream as any, null);
    expect(result).toBe('namespace');
  });

  it('tokenizes a URI', () => {
    const stream = makeStream('<http://example.org>');
    const result = sparqlStreamParser.token(stream as any, null);
    expect(result).toBe('url');
  });

  it('tokenizes a string', () => {
    const stream = makeStream('"hello"');
    const result = sparqlStreamParser.token(stream as any, null);
    expect(result).toBe('string');
  });

  it('tokenizes a comment', () => {
    const stream = makeStream('# this is a comment');
    const result = sparqlStreamParser.token(stream as any, null);
    expect(result).toBe('comment');
  });

  it('returns null for whitespace', () => {
    const stream = makeStream('  ');
    const result = sparqlStreamParser.token(stream as any, null);
    expect(result).toBeNull();
  });

  it('tokenizes case-insensitive keywords', () => {
    const stream = makeStream('where');
    expect(sparqlStreamParser.token(stream as any, null)).toBe('keyword');
  });

  it('tokenizes single-quoted strings', () => {
    const stream = makeStream("'hello'");
    expect(sparqlStreamParser.token(stream as any, null)).toBe('string');
  });

  it('tokenizes $-prefixed variables', () => {
    const stream = makeStream('$var');
    expect(sparqlStreamParser.token(stream as any, null)).toBe('variableName');
  });

  it('tokenizes bare colon prefix', () => {
    const stream = makeStream(':localName');
    expect(sparqlStreamParser.token(stream as any, null)).toBe('namespace');
  });
});

describe('sparqlLanguage', () => {
  it('returns a LanguageSupport instance', () => {
    const lang = sparqlLanguage();
    expect(lang).toBeDefined();
  });
});

describe('buildPrefixCompletions', () => {
  it('includes default NAMESPACES', () => {
    const completions = buildPrefixCompletions();
    const labels = completions.map((c) => c.label);
    expect(labels).toContain('arch:');
    expect(labels).toContain('rdf:');
    expect(labels).toContain('skos:');
  });

  it('includes extra prefixes', () => {
    const completions = buildPrefixCompletions({ ex: 'http://example.org/' });
    const labels = completions.map((c) => c.label);
    expect(labels).toContain('ex:');
  });

  it('each entry has label and detail', () => {
    const completions = buildPrefixCompletions();
    for (const c of completions) {
      expect(c.label).toBeTruthy();
      expect(c.detail).toBeTruthy();
    }
  });
});

describe('extractColumns', () => {
  it('returns empty for empty results', () => {
    expect(extractColumns([])).toEqual([]);
  });

  it('extracts column names from bindings', () => {
    const results = [
      { s: { value: 'a' }, p: { value: 'b' } },
      { s: { value: 'c' }, o: { value: 'd' } },
    ];
    const cols = extractColumns(results);
    expect(cols).toContain('s');
    expect(cols).toContain('p');
    expect(cols).toContain('o');
  });

  it('deduplicates column names', () => {
    const results = [
      { x: { value: '1' } },
      { x: { value: '2' } },
    ];
    const cols = extractColumns(results);
    expect(cols.filter((c) => c === 'x').length).toBe(1);
  });
});

describe('termValue', () => {
  it('returns empty string for null/undefined', () => {
    expect(termValue(null)).toBe('');
    expect(termValue(undefined)).toBe('');
  });

  it('returns string directly', () => {
    expect(termValue('hello')).toBe('hello');
  });

  it('extracts .value from RDF term', () => {
    expect(termValue({ value: 'http://example.org' })).toBe('http://example.org');
  });

  it('falls back to String() for other types', () => {
    expect(termValue(42)).toBe('42');
  });

  it('writes an RDF 1.2 triple term (what a relationship rdf:reifies) as <<( s p o )>>', () => {
    const iri = (value: string) => ({ termType: 'NamedNode', value });
    const triple = { termType: 'Quad', value: '', subject: iri('urn:a'), predicate: iri('urn:p'), object: iri('urn:b') };
    expect(termValue(triple)).toBe('<<( urn:a urn:p urn:b )>>');
  });
});

describe('executeQuery', () => {
  it('sets error when query is empty', () => {
    const ctx = makeCtx({
      rdfStore: mockStore(),
      _editorView: { state: { doc: { toString: () => '' } } },
    });
    const result = ctx.executeQuery();
    expect(result).toBeNull();
    expect(ctx._error).toBe('Query is empty');
  });

  it('sets error when no rdfStore', () => {
    const ctx = makeCtx({
      rdfStore: undefined,
      _editorView: { state: { doc: { toString: () => 'SELECT * WHERE {}' } } },
    });
    const result = ctx.executeQuery();
    expect(result).toBeNull();
    expect(ctx._error).toBe('No RDF store available');
  });

  it('returns bindings result on success', () => {
    const expected: SparqlResult = {
      type: 'bindings',
      results: [{ s: { value: 'x' } }],
    };
    const store = mockStore(expected);
    const ctx = makeCtx({
      rdfStore: store,
      _editorView: { state: { doc: { toString: () => 'SELECT ?s WHERE { ?s ?p ?o }' } } },
    });
    const result = ctx.executeQuery();
    expect(result).toEqual(expected);
    expect(ctx._error).toBe('');
    expect(ctx._result).toEqual(expected);
  });

  it('returns boolean result on success', () => {
    const expected: SparqlResult = { type: 'boolean', value: true };
    const store = mockStore(expected);
    const ctx = makeCtx({
      rdfStore: store,
      _editorView: { state: { doc: { toString: () => 'ASK { ?s ?p ?o }' } } },
    });
    const result = ctx.executeQuery();
    expect(result).toEqual(expected);
  });

  it('returns quads result on success', () => {
    const expected: SparqlResult = { type: 'quads', quads: [] };
    const store = mockStore(expected);
    const ctx = makeCtx({
      rdfStore: store,
      _editorView: { state: { doc: { toString: () => 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' } } },
    });
    const result = ctx.executeQuery();
    expect(result).toEqual(expected);
  });

  it('captures error from store.query', () => {
    const store = mockStore(undefined, 'Parse error at line 1');
    const ctx = makeCtx({
      rdfStore: store,
      _editorView: { state: { doc: { toString: () => 'INVALID QUERY' } } },
    });
    const result = ctx.executeQuery();
    expect(result).toBeNull();
    expect(ctx._error).toBe('Parse error at line 1');
    expect(ctx._result).toBeNull();
  });

  it('dispatches query-execute event on success', () => {
    const store = mockStore({ type: 'bindings', results: [] });
    const ctx = makeCtx({
      rdfStore: store,
      _editorView: { state: { doc: { toString: () => 'SELECT * WHERE {}' } } },
    });
    ctx.executeQuery();
    expect(ctx.dispatchEvent).toHaveBeenCalled();
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<QueryExecuteDetail>;
    expect(evt.type).toBe('query-execute');
    expect(evt.detail.sparql).toBe('SELECT * WHERE {}');
  });

  it('does not dispatch event on error', () => {
    const store = mockStore(undefined, 'fail');
    const ctx = makeCtx({
      rdfStore: store,
      _editorView: { state: { doc: { toString: () => 'BAD' } } },
    });
    ctx.executeQuery();
    expect(ctx.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('render template', () => {
  it('renders panel header', () => {
    const ctx = makeCtx();
    const o = flat(ctx.render());
    expect(o).toContain('SPARQL Query');
  });

  it('renders run button', () => {
    const ctx = makeCtx();
    const o = flat(ctx.render());
    expect(o).toContain('Run');
  });

  it('renders error display when error is set', () => {
    const ctx = makeCtx({ _error: 'Something went wrong' });
    const o = flat(ctx.render());
    expect(o).toContain('Something went wrong');
    expect(o).toContain('error-display');
  });

  it('does not render error display when no error', () => {
    const ctx = makeCtx({ _error: '' });
    const o = flat(ctx.render());
    expect(o).not.toContain('error-display');
  });
});

describe('result rendering', () => {
  it('renders bindings table', () => {
    const ctx = makeCtx({
      _result: {
        type: 'bindings',
        results: [
          { name: { value: 'Alice' }, age: { value: '30' } },
          { name: { value: 'Bob' }, age: { value: '25' } },
        ],
      },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('result-table');
    expect(o).toContain('name');
    expect(o).toContain('age');
    expect(o).toContain('Alice');
    expect(o).toContain('Bob');
    expect(o).toContain('2 result(s)');
  });

  it('renders empty bindings message', () => {
    const ctx = makeCtx({
      _result: { type: 'bindings', results: [] },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('No results');
  });

  it('renders boolean TRUE', () => {
    const ctx = makeCtx({
      _result: { type: 'boolean', value: true },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('TRUE');
    expect(o).toContain('true');
  });

  it('renders boolean FALSE', () => {
    const ctx = makeCtx({
      _result: { type: 'boolean', value: false },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('FALSE');
    expect(o).toContain('false');
  });

  it('renders IRIs in a table as prefixed names, with the view button', () => {
    const ctx = makeCtx({
      _columns: ['s', 'name', 'unbound'],
      _result: {
        type: 'bindings',
        results: [{ s: { termType: 'NamedNode', value: 'http://example.org/a' }, name: { value: 'A' } }],
      },
    });
    const o = flat(ctx._renderResult());
    // The projection's columns, the unbound one too.
    expect(o).toMatch(/<th>s<\/th>\s*<th>name<\/th>\s*<th>unbound<\/th>/);
    expect(o).toContain('ex:a');
    expect(o).toContain('Render as new view');
  });

  it('renders quads as a table of triples, with the view button', () => {
    const iri = (value: string) => ({ termType: 'NamedNode', value });
    const ctx = makeCtx({
      _result: {
        type: 'quads',
        quads: [{ subject: iri('http://example.org/a'), predicate: iri('http://example.org/p'), object: { termType: 'Literal', value: 'x' }, graph: {} }],
      },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('1 triple(s)');
    expect(o).toMatch(/<th>subject<\/th><th>predicate<\/th><th>object<\/th>/);
    expect(o).toContain('ex:p');
    expect(o).toContain('Render as new view');
  });

  it('renders empty quads without view button', () => {
    const ctx = makeCtx({
      _result: { type: 'quads', quads: [] },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('0 triple(s)');
    expect(o).not.toContain('Render as new view');
  });

  it('says when only the first rows are shown', () => {
    const results = Array.from({ length: 501 }, (_, i) => ({ n: { value: String(i) } }));
    const o = flat(makeCtx({ _result: { type: 'bindings', results } })._renderResult());
    expect(o).toContain('501 result(s) — the first 500 shown');
  });

  it('returns nothing when no result', () => {
    const ctx = makeCtx({ _result: null });
    const o = ctx._renderResult();
    // Lit's `nothing` sentinel — flat() converts Symbol to string
    expect(o).toBeDefined();
    expect(flat(o)).not.toContain('result-section');
  });
});

describe('results view request', () => {
  const iri = (value: string) => ({ termType: 'NamedNode', value });

  it('asks for a view of the IRIs a CONSTRUCT result mentions', () => {
    const quads = [
      { subject: iri('http://x/r'), predicate: iri('http://x/source'), object: iri('http://x/a'), graph: {} },
      { subject: iri('http://x/r'), predicate: iri('http://x/label'), object: { termType: 'Literal', value: 'r' }, graph: {} },
    ];
    const ctx = makeCtx({ _result: { type: 'quads', quads } });
    ctx._onViewClick();
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<ResultsViewRequestDetail>;
    expect(evt.type).toBe('results-view-request');
    expect(evt.detail.iris).toEqual(['http://x/r', 'http://x/a']);
  });

  it('asks for a view of the IRIs in a SELECT table', () => {
    const ctx = makeCtx({ _result: { type: 'bindings', results: [{ a: iri('http://x/a'), n: { value: 'A' } }, { a: iri('http://x/b') }] } });
    ctx._onViewClick();
    expect((ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<ResultsViewRequestDetail>).detail.iris).toEqual(['http://x/a', 'http://x/b']);
  });

  it('does not ask when the result mentions no IRI', () => {
    const ctx = makeCtx({ _result: { type: 'bindings', results: [{ n: { value: '1' } }] } });
    ctx._onViewClick();
    expect(ctx.dispatchEvent).not.toHaveBeenCalled();
  });

  it('reports a clicked IRI', () => {
    const ctx = makeCtx();
    ctx._onIriClick(new Event('click'), 'http://x/a');
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<{ iri: string }>;
    expect([evt.type, evt.detail.iri]).toEqual(['sparql-select', 'http://x/a']);
  });
});

describe('curieOf', () => {
  it('writes an IRI with the longest prefix that covers it', () => {
    const prefixes = { ex: 'http://example.org/', exm: 'http://example.org/m/' };
    expect(curieOf('http://example.org/m/a', prefixes)).toBe('exm:a');
    expect(curieOf('http://example.org/b', prefixes)).toBe('ex:b');
    expect(curieOf('http://other.org/c', prefixes)).toBe('http://other.org/c');
    // A local part a prefixed name cannot hold stays an IRI.
    expect(curieOf('http://example.org/a/b?c', { ex: 'http://example.org/' })).toBe('http://example.org/a/b?c');
  });
});

describe('projectedVariables', () => {
  it('reads the columns of a SELECT, aliases included', () => {
    expect(projectedVariables('SELECT ?a ?b WHERE { ?a ?p ?b }')).toEqual(['a', 'b']);
    expect(
      projectedVariables('# SELECT ?no\nPREFIX x: <http://x/#>\nSELECT DISTINCT (?s AS ?source) (STR(?l) AS ?name) ?t { ?s ?p ?t }'),
    ).toEqual(['source', 'name', 't']);
    expect(projectedVariables('SELECT (COUNT(?s) AS ?n) WHERE { ?s ?p ?o }')).toEqual(['n']);
  });

  it('knows no columns for SELECT * or other forms', () => {
    expect(projectedVariables('SELECT * WHERE { ?s ?p ?o }')).toBeUndefined();
    expect(projectedVariables('ASK { ?s ?p ?o }')).toBeUndefined();
  });
});

describe('resultIris', () => {
  it('lists each IRI once, in order, and nothing for other results', () => {
    const iri = (value: string) => ({ termType: 'NamedNode', value });
    expect(resultIris({ type: 'bindings', results: [{ a: iri('http://x/1') as never, b: iri('http://x/1') as never }] })).toEqual(['http://x/1']);
    expect(resultIris({ type: 'boolean', value: true })).toEqual([]);
    expect(resultIris(null)).toEqual([]);
  });
});

// ── The Questions menu ──────────────────────────────────────────────────

const ARCH = 'https://meta.linked.archi/core#';
const SH = 'http://www.w3.org/ns/shacl#';

function question(id: string, extra: Partial<ModelQuestion> = {}): ModelQuestion {
  return {
    iri: `urn:q:${id}`,
    label: `${id}?`,
    form: 'select',
    text: 'SELECT ?element WHERE {\n  ?element ?p ?o .\n}',
    isFinding: false,
    concerns: [],
    stakeholders: [],
    viewpoints: [],
    purposes: [],
    metamodels: [],
    parameters: [],
    prefixes: { arch: ARCH },
    ...extra,
  };
}

const stage = (name: string) => `${ARCH}${name.charAt(0).toUpperCase()}${name.slice(1)}Stage`;
const ORPHANS = question('orphans', {
  stage: stage('quality'),
  isFinding: true,
  severity: SH + 'Info',
  findingFocus: 'element',
  concerns: ['urn:c:quality'],
  answers: 'One row per unconnected element.',
  doesNotProve: 'That the element is unused.',
  defaultLimit: 500,
});
const IMPACT = question('impact', {
  stage: stage('analysis'),
  viewpoints: ['urn:vp:layered'],
  concerns: ['urn:c:change'],
  parameters: [{ name: 'focus', optional: false, order: 1 }],
});
const INVENTORY = question('inventory', { stage: stage('orientation') });
const SCOPE = question('scope', {
  stage: stage('views'),
  parameters: [{ name: 'viewpoint', optional: false, order: 1 }],
});

/** A context whose editor holds what is set, as CodeMirror would. */
function editorCtx(overrides: Record<string, any> = {}) {
  let doc = '';
  const ctx = makeCtx({
    _editorView: {
      get state() {
        return { doc: { length: doc.length, toString: () => doc } };
      },
      dispatch: (tr: { changes: { insert: string } }) => (doc = tr.changes.insert),
    },
    ...overrides,
  });
  return ctx;
}

describe('questionGroups', () => {
  it('puts those fitting the open view first, then each stage in order', () => {
    const groups = questionGroups([ORPHANS, IMPACT, INVENTORY, SCOPE, question('loose')], { viewpoint: 'urn:vp:layered' });
    expect(groups.map((g) => [g.title, g.questions.map((q) => q.iri)])).toEqual([
      ['Fits this view', ['urn:q:impact']],
      ['Orientation', ['urn:q:inventory']],
      ['Quality', ['urn:q:orphans']],
      ['Views', ['urn:q:scope']],
      ['Other', ['urn:q:loose']],
    ]);
  });

  it('keeps only those addressing a concern', () => {
    const groups = questionGroups([ORPHANS, IMPACT, INVENTORY], { concern: 'urn:c:change' });
    expect(groups.map((g) => g.title)).toEqual(['Analysis']);
  });
});

describe('boundParameters', () => {
  it('lists what is bound to one IRI, by what the workbench calls it', () => {
    expect(boundParameters({ model: 'urn:m', view: 'urn:v', focus: 'urn:e', conceptType: undefined, from: ['urn:a', 'urn:b'] })).toEqual([
      ['Element', 'urn:e'],
      ['View', 'urn:v'],
    ]);
  });
});

describe('the Questions menu', () => {
  it('is offered beside Run when there are questions', () => {
    expect(flat(makeCtx().render())).not.toContain('questions-btn');
    expect(flat(makeCtx({ questionSource: () => [], rdfStore: mockStore() }).render())).toContain('Questions ▾');
  });

  it('lists the offered questions by stage, one that needs a selection disabled, saying what to select', () => {
    const ctx = makeCtx({ questionSource: () => [ORPHANS, IMPACT, SCOPE], bindingSource: () => ({ model: 'urn:m' }) });
    ctx.openQuestions();
    expect(ctx._menu.questions).toHaveLength(3);
    const o = flat(ctx._renderQuestionsMenu());
    expect(o).toContain('Analysis');
    expect(o).toContain('Select an element');
    expect(o).toContain('Open a view that follows a viewpoint');
    expect(o).toMatch(/q-finding info/);
    // The concerns, to filter by.
    expect(o).toContain('All concerns');
    expect(o).toContain('value=urn:c:quality');
  });

  it('shows what is bound, by name', () => {
    const ctx = makeCtx({
      questionSource: () => [IMPACT],
      bindingSource: () => ({ focus: 'http://example.org/crm', view: 'http://example.org/v1' }),
      labelFor: (iri: string) => ({ 'http://example.org/crm': 'CRM', 'http://example.org/v1': 'Hosting' })[iri] ?? '',
    });
    ctx.openQuestions();
    const o = flat(ctx._renderQuestionsMenu());
    expect(o).toContain('Element:</span> CRM');
    expect(o).toContain('View:</span> Hosting');
    expect(o).not.toContain('Select an element');
  });

  it('asked about an element: only the questions taking it, bound to it', () => {
    const ctx = makeCtx({ questionSource: () => [ORPHANS, IMPACT], bindingSource: () => ({ model: 'urn:m' }), labelFor: () => 'CRM' });
    ctx.openQuestions({ focus: 'http://example.org/crm' });
    expect(ctx._menu.questions.map((q: ModelQuestion) => q.iri)).toEqual(['urn:q:impact']);
    expect(ctx._menu.bindings).toEqual({ model: 'urn:m', focus: 'http://example.org/crm' });
    expect(flat(ctx._renderQuestionsMenu())).toContain('About <strong>CRM</strong>');
  });

  it('picking one puts its bound query in the editor, runs it, and says what a row means and does not prove', () => {
    const store = mockStore({ type: 'bindings', results: [] });
    const ctx = editorCtx({ rdfStore: store, questionSource: () => [ORPHANS], bindingSource: () => ({ model: 'urn:m' }) });
    ctx.openQuestions();
    ctx.ask(ORPHANS, ctx._menu.bindings);
    expect(ctx._menu).toBeNull();
    const sent = (store.query as any).mock.calls[0][0] as string;
    expect(sent).toContain('PREFIX arch: <https://meta.linked.archi/core#>');
    expect(sent).toContain('LIMIT 500');
    expect(ctx.getQuery().trim()).toBe(sent);
    const o = flat(ctx._renderResult());
    expect(o).toContain('orphans?');
    expect(o).toContain('None found.');
    expect(o).toContain('One row per unconnected element.');
    expect(o).toContain('Does not prove:</span> That the element is unused.');
  });

  it('binds a parameter as VALUES, and says what is missing when asked without it', () => {
    const store = mockStore({ type: 'bindings', results: [] });
    const ctx = editorCtx({ rdfStore: store });
    ctx.ask(IMPACT, {});
    expect(ctx._error).toContain('?focus');
    expect(store.query).not.toHaveBeenCalled();
    ctx.ask(IMPACT, { focus: 'http://example.org/crm' });
    expect((store.query as any).mock.calls[0][0]).toContain('VALUES ?focus { <http://example.org/crm> }');
  });

  it('an edited question is another query: the caveats go', () => {
    const ctx = editorCtx({ rdfStore: mockStore({ type: 'bindings', results: [] }) });
    ctx.ask(ORPHANS, {});
    expect(ctx._asked).not.toBeNull();
    ctx.setQuery('SELECT ?s WHERE { ?s ?p ?o }');
    ctx.executeQuery();
    expect(ctx._asked).toBeNull();
    expect(flat(ctx._renderResult())).not.toContain('Does not prove');
  });

  it('a view of the answer is named after the question and follows its viewpoint', () => {
    const iri = { termType: 'NamedNode', value: 'http://example.org/crm' };
    const ctx = editorCtx({ rdfStore: mockStore({ type: 'bindings', results: [{ element: iri }] }) });
    ctx.ask(IMPACT, { focus: 'http://example.org/crm' });
    ctx._onViewClick();
    const evt = ctx.dispatchEvent.mock.calls.find((c: any[]) => c[0].type === 'results-view-request')[0] as CustomEvent<ResultsViewRequestDetail>;
    expect(evt.detail).toEqual({ iris: ['http://example.org/crm'], label: 'impact?', viewpoint: 'urn:vp:layered' });
  });
});

describe('getQuery / setQuery', () => {
  it('getQuery returns empty when no editor', () => {
    const ctx = makeCtx({ _editorView: null });
    expect(ctx.getQuery()).toBe('');
  });

  it('getQuery returns doc content', () => {
    const ctx = makeCtx({
      _editorView: { state: { doc: { toString: () => 'SELECT ?x WHERE {}' } } },
    });
    expect(ctx.getQuery()).toBe('SELECT ?x WHERE {}');
  });

  it('setQuery dispatches changes', () => {
    const dispatch = vi.fn();
    const ctx = makeCtx({
      _editorView: { state: { doc: { length: 5 } }, dispatch },
    });
    ctx.setQuery('NEW QUERY');
    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 5, insert: 'NEW QUERY' },
    });
  });

  it('setQuery does nothing when no editor', () => {
    const ctx = makeCtx({ _editorView: null });
    expect(() => ctx.setQuery('test')).not.toThrow();
  });
});

// ── Stream mock helper ──────────────────────────────────────────────────

/** Minimal mock of a CodeMirror StringStream for testing the stream parser. */
function makeStream(text: string) {
  let pos = 0;
  let start = 0;
  return {
    pos,
    string: text,
    eol() { return pos >= text.length; },
    eatSpace() {
      const before = pos;
      while (pos < text.length && /\s/.test(text[pos])) pos++;
      return pos > before;
    },
    match(pattern: string | RegExp, consume = true) {
      if (typeof pattern === 'string') {
        if (text.slice(pos).startsWith(pattern)) {
          if (consume) pos += pattern.length;
          return true;
        }
        return false;
      }
      const m = text.slice(pos).match(pattern);
      if (m && m.index === 0) {
        if (consume) pos += m[0].length;
        return m;
      }
      return null;
    },
    eat(ch: string | RegExp) {
      if (pos >= text.length) return undefined;
      if (typeof ch === 'string') {
        if (text[pos] === ch) { pos++; return ch; }
        return undefined;
      }
      if (ch.test(text[pos])) { const c = text[pos]; pos++; return c; }
      return undefined;
    },
    next() {
      if (pos >= text.length) return undefined;
      return text[pos++];
    },
    current() { return text.slice(start, pos); },
    skipToEnd() { pos = text.length; },
    backUp(n: number) { pos -= n; },
  };
}
