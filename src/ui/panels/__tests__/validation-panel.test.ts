import { describe, it, expect, vi } from 'vitest';
import type {
  ValidationResult,
  ValidationReport,
  ShaclValidator,
} from '../../../rdf-engine/interfaces.js';
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
    'render',
  ]) {
    if (typeof (ValidationPanel.prototype as any)[m] === 'function') {
      ctx[m] = (ValidationPanel.prototype as any)[m].bind(ctx);
    }
  }
  for (const accessor of ['scope', 'shownScope', 'shownResults']) {
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

  it('renders result details with path and shape', () => {
    const results = [makeResult('Violation', 'http://example.org/ns#Elem1', 'err')];
    const ctx = makeCtx({ conforms: false, results });
    const o = flat(ctx.render());
    expect(o).toContain('Path:');
    expect(o).toContain('Shape:');
    expect(o).toContain('MyShape');
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
