import { describe, it, expect, vi } from 'vitest';
import type {
  ValidationResult,
  ValidationReport,
  ShaclValidator,
} from '@linked-archi/kernel/rdf-engine/interfaces.js';
import type { NamedNode, Quad } from '@rdfjs/types';
import {
  ValidationPanel,
  iriLabel,
  groupBySeverity,
  buildSummary,
  extractViolatedIris,
  resultsWithin,
  type ValidationNavigateDetail,
  type ValidationHighlightDetail,
} from '../validation-panel.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function nn(value: string): NamedNode {
  return { termType: 'NamedNode', value, equals: () => false } as NamedNode;
}

function makeResult(
  severity: 'Violation' | 'Warning' | 'Info',
  focusIri: string,
  msg: string,
): ValidationResult {
  return {
    focusNode: nn(focusIri),
    resultPath: nn('http://example.org/path'),
    sourceShape: nn('http://example.org/shape#MyShape'),
    message: msg,
    severity,
  };
}

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

function makeCtx(overrides: Record<string, any> = {}) {
  const ctx: any = {
    results: [],
    conforms: true,
    validator: undefined,
    dataGraph: undefined,
    shapesGraph: undefined,
    _collapsedSeverities: new Set<string>(),
    _scope: 'view',
    viewIris: undefined,
    checks: undefined,
    checksAvailable: 0,
    checking: false,
    _checkResults: new Set(),
    dispatchEvent: vi.fn(),
    requestUpdate: vi.fn(),
    ...overrides,
  };
  for (const m of [
    'runValidation',
    'runIncrementalValidation',
    '_emitHighlight',
    '_onResultClick',
    '_toggleSeverity',
    '_renderResultItem',
    '_renderSeverityGroup',
    '_renderSummary',
    '_renderChecksStatus',
    'requestChecks',
    'willUpdate',
    'render',
  ]) {
    if (typeof (ValidationPanel.prototype as any)[m] === 'function') {
      ctx[m] = (ValidationPanel.prototype as any)[m].bind(ctx);
    }
  }
  for (const accessor of ['scope', 'shownScope', 'allResults', 'shownResults']) {
    const descriptor = Object.getOwnPropertyDescriptor(ValidationPanel.prototype, accessor)!;
    Object.defineProperty(ctx, accessor, { get: descriptor.get?.bind(ctx), set: descriptor.set?.bind(ctx), configurable: true });
  }
  return ctx;
}

function mockValidator(report: ValidationReport): ShaclValidator {
  return {
    validate: vi.fn(() => report),
    validateIncremental: vi.fn(() => report),
  };
}

// ── Pure function tests ─────────────────────────────────────────────────

describe('iriLabel', () => {
  it('extracts fragment after #', () => {
    expect(iriLabel('http://example.org/ns#MyClass')).toBe('MyClass');
  });

  it('extracts last path segment after /', () => {
    expect(iriLabel('http://example.org/ns/MyClass')).toBe('MyClass');
  });

  it('returns full IRI when no # or /', () => {
    expect(iriLabel('urn:example')).toBe('urn:example');
  });

  it('prefers # over /', () => {
    expect(iriLabel('http://example.org/ns#Local')).toBe('Local');
  });
});

describe('groupBySeverity', () => {
  it('returns empty groups for empty input', () => {
    const g = groupBySeverity([]);
    expect(g.violations).toEqual([]);
    expect(g.warnings).toEqual([]);
    expect(g.infos).toEqual([]);
  });

  it('groups results by severity', () => {
    const results = [
      makeResult('Violation', 'urn:a', 'v1'),
      makeResult('Warning', 'urn:b', 'w1'),
      makeResult('Info', 'urn:c', 'i1'),
      makeResult('Violation', 'urn:d', 'v2'),
    ];
    const g = groupBySeverity(results);
    expect(g.violations.length).toBe(2);
    expect(g.warnings.length).toBe(1);
    expect(g.infos.length).toBe(1);
  });

  it('handles all same severity', () => {
    const results = [
      makeResult('Warning', 'urn:a', 'w1'),
      makeResult('Warning', 'urn:b', 'w2'),
    ];
    const g = groupBySeverity(results);
    expect(g.violations.length).toBe(0);
    expect(g.warnings.length).toBe(2);
    expect(g.infos.length).toBe(0);
  });
});

describe('buildSummary', () => {
  it('returns conforms message when model conforms', () => {
    expect(buildSummary(true, [])).toBe('✓ Model conforms');
    expect(buildSummary(true, [], 'View')).toBe('✓ View conforms');
  });

  it('returns violation count', () => {
    const results = [makeResult('Violation', 'urn:a', 'v1')];
    expect(buildSummary(false, results)).toBe('✗ 1 violation(s)');
  });

  it('returns mixed counts', () => {
    const results = [
      makeResult('Violation', 'urn:a', 'v1'),
      makeResult('Violation', 'urn:b', 'v2'),
      makeResult('Warning', 'urn:c', 'w1'),
      makeResult('Info', 'urn:d', 'i1'),
    ];
    expect(buildSummary(false, results)).toBe('✗ 2 violation(s), 1 warning(s), 1 info(s)');
  });

  it('omits zero-count severities', () => {
    const results = [makeResult('Info', 'urn:a', 'i1')];
    expect(buildSummary(false, results)).toBe('✗ 1 info(s)');
  });
});

describe('resultsWithin', () => {
  it('keeps the findings on what a view covers', () => {
    const results = [makeResult('Violation', 'urn:a', 'a'), makeResult('Warning', 'urn:b', 'b')];
    expect(resultsWithin(results, new Set(['urn:b', 'urn:view']))).toEqual([results[1]]);
    expect(resultsWithin(results, new Set())).toEqual([]);
  });
});

describe('validation scope', () => {
  const results = () => [
    makeResult('Violation', 'urn:a', 'on a'),
    makeResult('Violation', 'urn:b', 'on b'),
    makeResult('Warning', 'urn:c', 'on c'),
  ];

  it("shows the open view's findings, and how many more the model has", () => {
    const ctx = makeCtx({ results: results(), conforms: false, viewIris: new Set(['urn:a', 'urn:view']) });
    expect(ctx.shownScope).toBe('view');
    const o = flat(ctx.render());
    expect(o).toContain('✗ 1 violation(s)');
    expect(o).toContain('on a');
    expect(o).not.toContain('on b');
    expect(o).toContain('2 more in the model');
  });

  it('says the view conforms when none of the findings are on it', () => {
    const ctx = makeCtx({ results: results(), conforms: false, viewIris: new Set(['urn:view']) });
    const o = flat(ctx.render());
    expect(o).toContain('✓ View conforms');
    expect(o).toContain('3 more in the model');
    expect(o).not.toContain('Violations');
  });

  it('shows the whole model when it is chosen, or when no view is open', () => {
    const chosen = makeCtx({ results: results(), conforms: false, viewIris: new Set(['urn:a']), _scope: 'model' });
    expect(flat(chosen.render())).toContain('✗ 2 violation(s), 1 warning(s)');
    expect(flat(chosen.render())).not.toContain('more in the model');
    const noView = makeCtx({ results: results(), conforms: false });
    expect(noView.shownScope).toBe('model');
    expect(noView.shownResults).toHaveLength(3);
  });

  it('says it is validating, not that the model conforms, while the findings are awaited', () => {
    const awaited = makeCtx({ validating: true, viewIris: new Set(['urn:view']) });
    const o = flat(awaited.render());
    expect(o).toContain('Validating…');
    expect(o).not.toContain('conforms');
    // Findings that came — an edit's, while the next validation runs — are shown.
    expect(flat(makeCtx({ validating: true, results: results(), conforms: false, _scope: 'model' }).render())).toContain('✗ 2 violation(s)');
  });

  it('announces another scope, and only another', () => {
    const ctx = makeCtx({ viewIris: new Set<string>() });
    ctx.scope = 'view';
    expect(ctx.dispatchEvent).not.toHaveBeenCalled();
    ctx.scope = 'model';
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<{ scope: string }>;
    expect([evt.type, evt.detail.scope, ctx.shownScope]).toEqual(['validation-scope-change', 'model', 'model']);
  });
});

describe('extractViolatedIris', () => {
  it('returns empty for no results', () => {
    expect(extractViolatedIris([])).toEqual([]);
  });

  it('extracts unique focus node IRIs', () => {
    const results = [
      makeResult('Violation', 'urn:a', 'v1'),
      makeResult('Warning', 'urn:b', 'w1'),
      makeResult('Violation', 'urn:a', 'v2'),
    ];
    const iris = extractViolatedIris(results);
    expect(iris).toContain('urn:a');
    expect(iris).toContain('urn:b');
    expect(iris.length).toBe(2);
  });
});

// ── Component tests ─────────────────────────────────────────────────────

describe('ValidationPanel', () => {
  it('exports the class', () => {
    expect(ValidationPanel).toBeDefined();
  });

  it('has static styles', () => {
    expect((ValidationPanel as any).styles).toBeDefined();
  });

  it('has render on prototype', () => {
    expect(typeof ValidationPanel.prototype.render).toBe('function');
  });
});

describe('render template', () => {
  it('renders panel header', () => {
    const ctx = makeCtx();
    const o = flat(ctx.render());
    expect(o).toContain('Validation');
  });

  it('renders conforms summary when model conforms', () => {
    const ctx = makeCtx({ conforms: true, results: [] });
    const o = flat(ctx.render());
    expect(o).toContain('✓ Model conforms');
    expect(o).toContain('conforms');
  });

  it('renders non-conforms summary with counts', () => {
    const results = [
      makeResult('Violation', 'urn:a', 'v1'),
      makeResult('Warning', 'urn:b', 'w1'),
    ];
    const ctx = makeCtx({ conforms: false, results });
    const o = flat(ctx.render());
    expect(o).toContain('✗ 1 violation(s), 1 warning(s)');
    expect(o).toContain('non-conforms');
  });

  it('renders severity groups with items', () => {
    const results = [
      makeResult('Violation', 'http://example.org/ns#Elem1', 'Missing label'),
      makeResult('Warning', 'http://example.org/ns#Elem2', 'Optional field'),
    ];
    const ctx = makeCtx({ conforms: false, results });
    const o = flat(ctx.render());
    expect(o).toContain('Violations');
    expect(o).toContain('Warnings');
    expect(o).toContain('Elem1');
    expect(o).toContain('Missing label');
    expect(o).toContain('Elem2');
    expect(o).toContain('Optional field');
  });

  it('does not render empty severity groups', () => {
    const results = [makeResult('Violation', 'urn:a', 'v1')];
    const ctx = makeCtx({ conforms: false, results });
    const o = flat(ctx.render());
    expect(o).toContain('Violations');
    expect(o).not.toContain('Warnings');
    expect(o).not.toContain('Info');
  });

  it('renders result details with property and shape', () => {
    const results = [makeResult('Violation', 'http://example.org/ns#Elem1', 'err')];
    const ctx = makeCtx({ conforms: false, results });
    const o = flat(ctx.render());
    expect(o).toContain('Property:');
    expect(o).toContain('Shape:');
    expect(o).toContain('MyShape');
  });

  it('sets each finding apart in its severity, and names its property as the Properties tab does', () => {
    const results = [makeResult('Violation', 'urn:a', 'v1'), makeResult('Warning', 'urn:b', 'w1')];
    const ctx = makeCtx({ conforms: false, results, fieldNameFor: (p: string) => (p === 'http://example.org/path' ? 'Name' : p) });
    const o = flat(ctx.render());
    expect(o).toContain('class="result-item violation"');
    expect(o).toContain('class="result-item warning"');
    expect(o).toMatch(/Property: <span class="field" title="?[^>]*>Name<\/span>/);
    expect((ValidationPanel as any).styles.cssText).toMatch(/\.severity-items\.hidden\s*\{\s*display: none/);
  });

  it("names a finding's concept and its type as the tree does, and leaves out a shape written inline", () => {
    const inline = { ...makeResult('Violation', 'urn:a', 'v1'), sourceShape: { termType: 'BlankNode', value: 'cc9e574c' } as any };
    // As the validator hands it on: a named node, its value a blank node's id.
    const handedOn = { ...makeResult('Info', 'urn:a', 'i1'), sourceShape: nn('e7c5f6f9b162c99505726a1d84b6c892') };
    const ctx = makeCtx({
      conforms: false,
      results: [inline, makeResult('Warning', 'urn:b', 'w1'), handedOn],
      describe: (iri: string) => (iri === 'urn:a' ? { name: 'Unnamed', type: 'Business Actor', unnamed: true } : { name: 'Clerk', type: 'Business Role' }),
    });
    const o = flat(ctx.render());
    expect(o).toMatch(/<span class="?unnamed"? title="?urn:a"?>Unnamed<\/span>\s*<span class="type">Business Actor<\/span>/);
    expect(o).toMatch(/>Clerk<\/span>\s*<span class="type">Business Role<\/span>/);
    expect(o).not.toContain('cc9e574c');
    expect(o).not.toContain('e7c5f6f9');
    expect(o.match(/Shape:/g)).toHaveLength(1);
  });

  it("links a finding's shape to its IRI — or, written inline, the shape it is written in — without showing the concept", () => {
    const flow = {
      ...makeResult('Violation', 'urn:a', 'An element cannot compose itself.'),
      sourceShape: nn('https://meta.linked.archi/archimate4/element-shapes#NoSelfCompositionShape'),
    };
    const inline = {
      ...makeResult('Violation', 'urn:b', 'Name it'),
      sourceShape: nn('n3-17'),
      withinShape: nn('https://meta.linked.archi/archimate4/element-shapes#ArchiMateElementShape'),
    };
    const own = { ...makeResult('Warning', 'urn:c', 'Ours'), sourceShape: nn('urn:example:shapes#OwnShape') };
    const ctx = makeCtx({ conforms: false, results: [flow, inline, own] });
    const o = flat(ctx.render());
    expect(o).toMatch(
      /Shape: <a class="shape" href=https:\/\/meta\.linked\.archi\/archimate4\/element-shapes#NoSelfCompositionShape target="_blank" rel="noopener noreferrer" title=https:\/\/meta\.linked\.archi\/archimate4\/element-shapes#NoSelfCompositionShape[\s\S]*?>NoSelfCompositionShape<\/a/,
    );
    expect(o).toMatch(/href=https:\/\/meta\.linked\.archi\/archimate4\/element-shapes#ArchiMateElementShape [\s\S]*?>ArchiMateElementShape<\/a/);
    expect(o).not.toContain('n3-17');
    // Not a web address: named, the IRI on hover, no link.
    expect(o).toContain('Shape: <span title=urn:example:shapes#OwnShape>OwnShape</span>');

    // Opening the link does not also show the concept.
    const find = (t: any): any =>
      t?.strings?.join('').includes('class="shape"') ? t : (t?.values ?? []).map(find).find(Boolean);
    const link = find(ctx._renderResultItem(flow));
    const handlers = link.values.filter((v: unknown) => typeof v === 'function');
    expect(handlers).toHaveLength(2);
    const event = { stopPropagation: vi.fn() };
    for (const h of handlers) h(event);
    expect(event.stopPropagation).toHaveBeenCalledTimes(2);
  });

  it('renders empty state when no results', () => {
    const ctx = makeCtx({ conforms: true, results: [] });
    const o = flat(ctx.render());
    expect(o).toContain('Validation');
    expect(o).toContain('✓ Model conforms');
    expect(o).not.toContain('severity-group');
  });
});

describe('severity collapsing', () => {
  it('collapsed severity has hidden class', () => {
    const results = [makeResult('Violation', 'urn:a', 'v1')];
    const ctx = makeCtx({
      conforms: false,
      results,
      _collapsedSeverities: new Set(['Violation']),
    });
    const o = flat(ctx.render());
    expect(o).toContain('hidden');
    expect(o).toContain('▸');
  });

  it('non-collapsed severity has no hidden class', () => {
    const results = [makeResult('Violation', 'urn:a', 'v1')];
    const ctx = makeCtx({ conforms: false, results });
    const o = flat(ctx.render());
    expect(o).not.toContain('hidden');
    expect(o).toContain('▾');
  });

  it('toggle adds severity', () => {
    const ctx = makeCtx();
    ctx._toggleSeverity('Violation');
    expect(ctx._collapsedSeverities.has('Violation')).toBe(true);
    expect(ctx.requestUpdate).toHaveBeenCalled();
  });

  it('toggle removes on second call', () => {
    const ctx = makeCtx({ _collapsedSeverities: new Set(['Violation']) });
    ctx._toggleSeverity('Violation');
    expect(ctx._collapsedSeverities.has('Violation')).toBe(false);
  });
});

describe('navigation events', () => {
  it('dispatches validation-navigate on result click', () => {
    const ctx = makeCtx();
    const result = makeResult('Violation', 'http://example.org/ns#Elem1', 'err');
    ctx._onResultClick(result);
    expect(ctx.dispatchEvent).toHaveBeenCalled();
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<ValidationNavigateDetail>;
    expect(evt.type).toBe('validation-navigate');
    expect(evt.detail.focusNodeIri).toBe('http://example.org/ns#Elem1');
    expect(evt.bubbles).toBe(true);
    expect(evt.composed).toBe(true);
  });
});

describe('runValidation', () => {
  it('returns null when no validator', () => {
    const ctx = makeCtx({ validator: undefined, dataGraph: [], shapesGraph: [] });
    expect(ctx.runValidation()).toBeNull();
  });

  it('returns null when no dataGraph', () => {
    const ctx = makeCtx({
      validator: mockValidator({ conforms: true, results: [] }),
      dataGraph: undefined,
      shapesGraph: [],
    });
    expect(ctx.runValidation()).toBeNull();
  });

  it('returns null when no shapesGraph', () => {
    const ctx = makeCtx({
      validator: mockValidator({ conforms: true, results: [] }),
      dataGraph: [],
      shapesGraph: undefined,
    });
    expect(ctx.runValidation()).toBeNull();
  });

  it('runs validation and updates state', () => {
    const report: ValidationReport = {
      conforms: false,
      results: [makeResult('Violation', 'urn:a', 'v1')],
    };
    const validator = mockValidator(report);
    const ctx = makeCtx({ validator, dataGraph: [], shapesGraph: [] });
    const result = ctx.runValidation();
    expect(result).toEqual(report);
    expect(ctx.conforms).toBe(false);
    expect(ctx.results).toEqual(report.results);
    expect(validator.validate).toHaveBeenCalled();
  });

  it('dispatches validation-highlight event', () => {
    const report: ValidationReport = {
      conforms: false,
      results: [makeResult('Violation', 'urn:a', 'v1')],
    };
    const ctx = makeCtx({
      validator: mockValidator(report),
      dataGraph: [],
      shapesGraph: [],
    });
    ctx.runValidation();
    expect(ctx.dispatchEvent).toHaveBeenCalled();
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<ValidationHighlightDetail>;
    expect(evt.type).toBe('validation-highlight');
    expect(evt.detail.iris).toContain('urn:a');
  });

  it('dispatches highlight with conforms report', () => {
    const report: ValidationReport = { conforms: true, results: [] };
    const ctx = makeCtx({
      validator: mockValidator(report),
      dataGraph: [],
      shapesGraph: [],
    });
    ctx.runValidation();
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<ValidationHighlightDetail>;
    expect(evt.detail.iris).toEqual([]);
  });
});

describe('runIncrementalValidation', () => {
  it('returns null when no validator', () => {
    const ctx = makeCtx({ validator: undefined, dataGraph: [], shapesGraph: [] });
    expect(ctx.runIncrementalValidation(nn('urn:x'))).toBeNull();
  });

  it('runs incremental validation and updates state', () => {
    const report: ValidationReport = {
      conforms: false,
      results: [makeResult('Warning', 'urn:x', 'w1')],
    };
    const validator = mockValidator(report);
    const ctx = makeCtx({ validator, dataGraph: [], shapesGraph: [] });
    const result = ctx.runIncrementalValidation(nn('urn:x'));
    expect(result).toEqual(report);
    expect(ctx.conforms).toBe(false);
    expect(ctx.results).toEqual(report.results);
    expect(validator.validateIncremental).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'urn:x' }),
      [],
      [],
    );
  });

  it('dispatches validation-highlight event', () => {
    const report: ValidationReport = {
      conforms: false,
      results: [makeResult('Violation', 'urn:y', 'v1')],
    };
    const ctx = makeCtx({
      validator: mockValidator(report),
      dataGraph: [],
      shapesGraph: [],
    });
    ctx.runIncrementalValidation(nn('urn:y'));
    const evt = ctx.dispatchEvent.mock.calls[0][0] as CustomEvent<ValidationHighlightDetail>;
    expect(evt.type).toBe('validation-highlight');
    expect(evt.detail.iris).toContain('urn:y');
  });
});

describe('model checks', () => {
  const check = (severity: 'Violation' | 'Warning' | 'Info', focusIri: string, id: string): ValidationResult => ({
    focusNode: nn(focusIri),
    resultPath: nn(''),
    sourceShape: nn(`https://meta.linked.archi/core-questions#${id}`),
    message: `${id}?`,
    severity,
  });
  const withChecks = (overrides: Record<string, any> = {}) => {
    const ctx = makeCtx({
      results: [makeResult('Violation', 'urn:a', 'on a')],
      conforms: false,
      checksAvailable: 14,
      checks: {
        results: [check('Warning', 'urn:a', 'unrealised-services'), check('Info', 'urn:b', 'orphans')],
        ran: 13,
        failed: [{ label: 'Which views show it?', reason: 'Select an element' }],
        capped: [{ label: 'Which elements appear in no view?', limit: 500 }],
      },
      ...overrides,
    });
    ctx.willUpdate(new Map([['checks', undefined]]));
    return ctx;
  };

  it('are offered when the loaded languages ask any, and asked for on request', () => {
    expect(flat(makeCtx().render())).not.toContain('checks-btn');
    const ctx = makeCtx({ checksAvailable: 14 });
    const o = flat(ctx.render());
    expect(o).toContain('Model checks');
    expect(o).toContain('Ask the 14 finding questions');
    ctx.requestChecks();
    expect(ctx.dispatchEvent.mock.calls[0][0].type).toBe('model-checks-request');
    expect(flat(makeCtx({ checksAvailable: 14, checking: true }).render())).toContain('Checking…');
  });

  it('list their findings beside the shapes’, counted and scoped as they are', () => {
    const model = withChecks({ _scope: 'model' });
    expect(model.allResults).toHaveLength(3);
    let o = flat(model.render());
    expect(o).toContain('✗ 1 violation(s), 1 warning(s), 1 info(s)');
    expect(o).toMatch(/Check: <a class="shape" href=https:\/\/meta\.linked\.archi\/core-questions#orphans [\s\S]*?>orphans<\/a/);
    expect(o).toContain('Shape: <a class="shape" href=http://example.org/shape#MyShape');
    // On the open view: only what is on it.
    const view = withChecks({ viewIris: new Set(['urn:a']) });
    o = flat(view.render());
    expect(o).toContain('✗ 1 violation(s), 1 warning(s)');
    expect(o).toContain('1 more in the model');
  });

  it('a model conforms only when no check finds anything either', () => {
    const ctx = withChecks({ results: [], conforms: true, _scope: 'model' });
    expect(flat(ctx.render())).not.toContain('Model conforms');
    const none = withChecks({ results: [], conforms: true, _scope: 'model', checks: { results: [], ran: 14, failed: [], capped: [] } });
    expect(flat(none.render())).toContain('✓ Model conforms');
    // (flat() leaves out a 0.)
    expect(flat(none.render())).toMatch(/Model checks: 14 run, 0? ?findings/);
  });

  it('say how many ran, which stopped at their limit, which could not run and why, and when the model has changed', () => {
    let o = flat(withChecks().render());
    expect(o).toContain('Model checks: 13 run, 2 findings');
    expect(o).toContain('“Which elements appear in no view?” stopped at 500: there may be more.');
    expect(o).toContain('“Which views show it?” could not run: Select an element');
    expect(o).toContain('Run checks again');
    expect(o).not.toContain('has changed');
    const stale = withChecks();
    stale.checks = { ...stale.checks, stale: true };
    o = flat(stale.render());
    expect(o).toContain('the model has changed since they ran');
  });
});
