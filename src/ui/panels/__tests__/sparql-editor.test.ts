import { describe, it, expect, vi } from 'vitest';
import type { RdfStore, SparqlResult } from '../../../rdf-engine/interfaces.js';
import {
  SparqlEditor,
  sparqlStreamParser,
  sparqlLanguage,
  buildPrefixCompletions,
  extractColumns,
  termValue,
  type ConstructViewRequestDetail,
  type QueryExecuteDetail,
} from '../sparql-editor.js';

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
    extraPrefixes: undefined,
    dispatchEvent: vi.fn(),
    requestUpdate: vi.fn(),
    ...overrides,
  };
  // Bind prototype methods
  for (const m of [
    'executeQuery',
    'getQuery',
    'setQuery',
    '_onRunClick',
    '_onConstructViewClick',
    '_renderResult',
    '_renderBindingsResult',
    '_renderBooleanResult',
    '_renderQuadsResult',
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

  it('renders quads result with count', () => {
    const ctx = makeCtx({
      _result: {
        type: 'quads',
        quads: [{ subject: {}, predicate: {}, object: {}, graph: {} }],
      },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('1 quad(s) returned');
    expect(o).toContain('Render as new view');
  });

  it('renders empty quads without view button', () => {
    const ctx = makeCtx({
      _result: { type: 'quads', quads: [] },
    });
    const o = flat(ctx._renderResult());
    expect(o).toContain('quad(s) returned');
    expect(o).not.toContain('Render as new view');
  });

  it('returns nothing when no result', () => {
    const ctx = makeCtx({ _result: null });
    const o = ctx._renderResult();
    // Lit's `nothing` sentinel — flat() converts Symbol to string
    expect(o).toBeDefined();
    expect(flat(o)).not.toContain('result-section');
  });
});

describe('construct view request', () => {
  it('dispatches construct-view-request event', () => {
    const quads = [{ subject: {}, predicate: {}, object: {}, graph: {} }];
    const ctx = makeCtx({
      _result: { type: 'quads', quads },
    });
    ctx._onConstructViewClick();
    expect(ctx.dispatchEvent).toHaveBeenCalled();
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<ConstructViewRequestDetail>;
    expect(evt.type).toBe('construct-view-request');
    expect(evt.detail.quads).toBe(quads);
  });

  it('does not dispatch when result is not quads', () => {
    const ctx = makeCtx({
      _result: { type: 'bindings', results: [] },
    });
    ctx._onConstructViewClick();
    expect(ctx.dispatchEvent).not.toHaveBeenCalled();
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
