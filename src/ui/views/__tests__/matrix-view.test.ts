import { describe, it, expect, vi } from 'vitest';
import type { Quad, NamedNode } from '@rdfjs/types';
import type { RdfStore } from '@linked-archi/kernel/rdf-engine/interfaces.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import {
  MatrixView,
  type MatrixHeader,
  type MatrixCell,
  type MatrixCellClickDetail,
  type MatrixData,
  iriLabel,
  collectHeaders,
  buildMatrixData,
  cellKey,
} from '../matrix-view.js';

// ── Constants ───────────────────────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const ARCH_REL_SOURCE = NAMESPACES.arch + 'relSource';
const ARCH_REL_TARGET = NAMESPACES.arch + 'relTarget';
const ARCH_REL_PREDICATE = NAMESPACES.arch + 'relPredicate';

const TYPE_BP = 'https://example.org/BusinessProcess';
const TYPE_APP = 'https://example.org/ApplicationComponent';
const REL_SERVES = 'https://example.org/serves';
const REL_ACCESSES = 'https://example.org/accesses';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeQuad(s: string, p: string, o: string): Quad {
  return {
    subject: { value: s, termType: 'NamedNode' } as NamedNode,
    predicate: { value: p, termType: 'NamedNode' } as NamedNode,
    object: { value: o, termType: 'Literal' },
    graph: { value: '', termType: 'DefaultGraph' },
  } as unknown as Quad;
}

function mockRdfStore(quads: Quad[]): RdfStore {
  return {
    addQuads: vi.fn(),
    removeQuads: vi.fn(),
    getQuads: vi.fn(() => quads),
    query: vi.fn(),
    update: vi.fn(),
  };
}

function sampleQuads(): Quad[] {
  return [
    // Row elements (BusinessProcess)
    makeQuad('ex:bp1', RDF_TYPE, TYPE_BP),
    makeQuad('ex:bp1', SKOS_PREF_LABEL, 'Process Alpha'),
    makeQuad('ex:bp2', RDF_TYPE, TYPE_BP),
    makeQuad('ex:bp2', SKOS_PREF_LABEL, 'Process Beta'),
    // Column elements (ApplicationComponent)
    makeQuad('ex:app1', RDF_TYPE, TYPE_APP),
    makeQuad('ex:app1', SKOS_PREF_LABEL, 'CRM System'),
    makeQuad('ex:app2', RDF_TYPE, TYPE_APP),
    makeQuad('ex:app2', SKOS_PREF_LABEL, 'ERP System'),
    // Direct relationship: bp1 serves app1
    makeQuad('ex:bp1', REL_SERVES, 'ex:app1'),
    // Relationship label
    makeQuad(REL_SERVES, SKOS_PREF_LABEL, 'serves'),
    // Qualified relationship: bp2 accesses app2
    makeQuad('ex:qr1', ARCH_REL_SOURCE, 'ex:bp2'),
    makeQuad('ex:qr1', ARCH_REL_TARGET, 'ex:app2'),
    makeQuad('ex:qr1', ARCH_REL_PREDICATE, REL_ACCESSES),
    makeQuad(REL_ACCESSES, SKOS_PREF_LABEL, 'accesses'),
  ];
}

// ── Tests: iriLabel ─────────────────────────────────────────────────────

describe('iriLabel (matrix)', () => {
  it('extracts fragment after #', () => {
    expect(iriLabel('http://example.org/ns#MyClass')).toBe('MyClass');
  });

  it('extracts last path segment after /', () => {
    expect(iriLabel('http://example.org/ns/MyClass')).toBe('MyClass');
  });

  it('returns full string when no # or /', () => {
    expect(iriLabel('MyClass')).toBe('MyClass');
  });
});

// ── Tests: collectHeaders ───────────────────────────────────────────────

describe('collectHeaders', () => {
  it('collects elements of the given type', () => {
    const headers = collectHeaders(sampleQuads(), TYPE_BP);
    expect(headers).toHaveLength(2);
    expect(headers.map((h) => h.iri)).toContain('ex:bp1');
    expect(headers.map((h) => h.iri)).toContain('ex:bp2');
  });

  it('uses skos:prefLabel for labels', () => {
    const headers = collectHeaders(sampleQuads(), TYPE_BP);
    const bp1 = headers.find((h) => h.iri === 'ex:bp1');
    expect(bp1?.label).toBe('Process Alpha');
  });

  it('sorts headers alphabetically by label', () => {
    const headers = collectHeaders(sampleQuads(), TYPE_BP);
    expect(headers[0].label).toBe('Process Alpha');
    expect(headers[1].label).toBe('Process Beta');
  });

  it('returns empty for type with no elements', () => {
    const headers = collectHeaders(sampleQuads(), 'https://example.org/NonExistent');
    expect(headers).toEqual([]);
  });

  it('returns empty for empty quads', () => {
    expect(collectHeaders([], TYPE_BP)).toEqual([]);
  });

  it('falls back to IRI fragment when no label', () => {
    const quads = [makeQuad('https://example.org/bp1', RDF_TYPE, TYPE_BP)];
    const headers = collectHeaders(quads, TYPE_BP);
    expect(headers[0].label).toBe('bp1');
  });
});

// ── Tests: cellKey ──────────────────────────────────────────────────────

describe('cellKey', () => {
  it('creates a key from row and column IRIs', () => {
    expect(cellKey('ex:bp1', 'ex:app1')).toBe('ex:bp1|ex:app1');
  });
});

// ── Tests: buildMatrixData ──────────────────────────────────────────────

describe('buildMatrixData', () => {
  it('builds rows and columns from quads', () => {
    const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
    expect(data.rows).toHaveLength(2);
    expect(data.columns).toHaveLength(2);
  });

  it('detects direct relationships', () => {
    const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
    const cell = data.cells.get(cellKey('ex:bp1', 'ex:app1'));
    expect(cell).toBeDefined();
    expect(cell!.relationshipType).toBe(REL_SERVES);
    expect(cell!.relationshipLabel).toBe('serves');
  });

  it('detects qualified relationships', () => {
    const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
    const cell = data.cells.get(cellKey('ex:bp2', 'ex:app2'));
    expect(cell).toBeDefined();
    expect(cell!.relationshipType).toBe(REL_ACCESSES);
    expect(cell!.relationshipLabel).toBe('accesses');
  });

  it('leaves cells empty when no relationship exists', () => {
    const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
    const cell = data.cells.get(cellKey('ex:bp1', 'ex:app2'));
    expect(cell).toBeDefined();
    expect(cell!.relationshipType).toBe('');
    expect(cell!.relationshipLabel).toBe('');
  });

  it('creates cells for all row/column pairs', () => {
    const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
    // 2 rows × 2 columns = 4 cells
    expect(data.cells.size).toBe(4);
  });

  it('returns empty data for empty quads', () => {
    const data = buildMatrixData([], TYPE_BP, TYPE_APP);
    expect(data.rows).toEqual([]);
    expect(data.columns).toEqual([]);
    expect(data.cells.size).toBe(0);
  });

  it('returns empty cells when no relationships exist', () => {
    const quads = [
      makeQuad('ex:bp1', RDF_TYPE, TYPE_BP),
      makeQuad('ex:bp1', SKOS_PREF_LABEL, 'BP1'),
      makeQuad('ex:app1', RDF_TYPE, TYPE_APP),
      makeQuad('ex:app1', SKOS_PREF_LABEL, 'APP1'),
    ];
    const data = buildMatrixData(quads, TYPE_BP, TYPE_APP);
    expect(data.rows).toHaveLength(1);
    expect(data.columns).toHaveLength(1);
    const cell = data.cells.get(cellKey('ex:bp1', 'ex:app1'));
    expect(cell!.relationshipType).toBe('');
  });

  it('falls back to IRI fragment for relationship label when no skos:prefLabel', () => {
    const quads = [
      makeQuad('ex:bp1', RDF_TYPE, TYPE_BP),
      makeQuad('ex:app1', RDF_TYPE, TYPE_APP),
      makeQuad('ex:bp1', 'https://example.org/customRel', 'ex:app1'),
    ];
    const data = buildMatrixData(quads, TYPE_BP, TYPE_APP);
    const cell = data.cells.get(cellKey('ex:bp1', 'ex:app1'));
    expect(cell!.relationshipLabel).toBe('customRel');
  });
});

// ── Tests: MatrixView component ─────────────────────────────────────────

describe('MatrixView', () => {
  it('exports the class', () => {
    expect(MatrixView).toBeDefined();
  });

  it('has static styles', () => {
    expect((MatrixView as any).styles).toBeDefined();
  });

  it('has render on prototype', () => {
    expect(typeof MatrixView.prototype.render).toBe('function');
  });

  describe('render template', () => {
    function makeCtx(overrides: Record<string, unknown> = {}) {
      const ctx: any = {
        rowTypeFilter: '',
        columnTypeFilter: '',
        rdfStore: undefined,
        _matrixData: { rows: [], columns: [], cells: new Map() },
        dispatchEvent: vi.fn(),
        ...overrides,
      };
      for (const m of ['_onCellClick', '_rebuildMatrix']) {
        if (typeof (MatrixView.prototype as any)[m] === 'function') {
          ctx[m] = (MatrixView.prototype as any)[m].bind(ctx);
        }
      }
      return ctx;
    }

    function flat(t: any): string {
      if (!t) return '';
      if (typeof t === 'string') return t;
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

    function renderView(overrides: Record<string, unknown> = {}): string {
      const ctx = makeCtx(overrides);
      return flat((MatrixView.prototype as any).render.call(ctx));
    }

    it('shows empty message when no type filters set', () => {
      const o = renderView();
      expect(o).toContain('Matrix');
      expect(o).toContain('No row or column type filter set');
    });

    it('shows "No elements found" when rows and columns are empty', () => {
      const o = renderView({
        rowTypeFilter: TYPE_BP,
        columnTypeFilter: TYPE_APP,
        _matrixData: { rows: [], columns: [], cells: new Map() },
      });
      expect(o).toContain('No elements found');
    });

    it('renders table with row and column headers', () => {
      const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
      const o = renderView({
        rowTypeFilter: TYPE_BP,
        columnTypeFilter: TYPE_APP,
        _matrixData: data,
      });
      expect(o).toContain('Process Alpha');
      expect(o).toContain('Process Beta');
      expect(o).toContain('CRM System');
      expect(o).toContain('ERP System');
    });

    it('renders relationship labels in cells', () => {
      const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
      const o = renderView({
        rowTypeFilter: TYPE_BP,
        columnTypeFilter: TYPE_APP,
        _matrixData: data,
      });
      expect(o).toContain('serves');
      expect(o).toContain('accesses');
    });

    it('renders type labels in header', () => {
      const data = buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP);
      const o = renderView({
        rowTypeFilter: TYPE_BP,
        columnTypeFilter: TYPE_APP,
        _matrixData: data,
      });
      expect(o).toContain('BusinessProcess');
      expect(o).toContain('ApplicationComponent');
    });
  });

  describe('_rebuildMatrix', () => {
    it('populates matrix data from rdfStore', () => {
      const store = mockRdfStore(sampleQuads());
      const ctx: any = {
        rdfStore: store,
        rowTypeFilter: TYPE_BP,
        columnTypeFilter: TYPE_APP,
        _matrixData: { rows: [], columns: [], cells: new Map() },
      };
      (MatrixView.prototype as any)._rebuildMatrix.call(ctx);
      expect(ctx._matrixData.rows).toHaveLength(2);
      expect(ctx._matrixData.columns).toHaveLength(2);
      expect(ctx._matrixData.cells.size).toBe(4);
    });

    it('clears when no rdfStore', () => {
      const ctx: any = {
        rdfStore: undefined,
        rowTypeFilter: TYPE_BP,
        columnTypeFilter: TYPE_APP,
        _matrixData: buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP),
      };
      (MatrixView.prototype as any)._rebuildMatrix.call(ctx);
      expect(ctx._matrixData.rows).toEqual([]);
      expect(ctx._matrixData.columns).toEqual([]);
      expect(ctx._matrixData.cells.size).toBe(0);
    });

    it('clears when no rowTypeFilter', () => {
      const store = mockRdfStore(sampleQuads());
      const ctx: any = {
        rdfStore: store,
        rowTypeFilter: '',
        columnTypeFilter: TYPE_APP,
        _matrixData: buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP),
      };
      (MatrixView.prototype as any)._rebuildMatrix.call(ctx);
      expect(ctx._matrixData.rows).toEqual([]);
    });

    it('clears when no columnTypeFilter', () => {
      const store = mockRdfStore(sampleQuads());
      const ctx: any = {
        rdfStore: store,
        rowTypeFilter: TYPE_BP,
        columnTypeFilter: '',
        _matrixData: buildMatrixData(sampleQuads(), TYPE_BP, TYPE_APP),
      };
      (MatrixView.prototype as any)._rebuildMatrix.call(ctx);
      expect(ctx._matrixData.columns).toEqual([]);
    });
  });

  describe('_onCellClick', () => {
    it('dispatches matrix-cell-click event', () => {
      const spy = vi.fn();
      const ctx: any = { dispatchEvent: spy };
      const cell: MatrixCell = {
        rowIri: 'ex:bp1',
        colIri: 'ex:app1',
        relationshipType: REL_SERVES,
        relationshipLabel: 'serves',
      };
      (MatrixView.prototype as any)._onCellClick.call(ctx, cell);
      const evt = spy.mock.calls[0][0] as CustomEvent<MatrixCellClickDetail>;
      expect(evt.type).toBe('matrix-cell-click');
      expect(evt.detail.rowIri).toBe('ex:bp1');
      expect(evt.detail.colIri).toBe('ex:app1');
      expect(evt.detail.relationshipType).toBe(REL_SERVES);
      expect(evt.bubbles).toBe(true);
      expect(evt.composed).toBe(true);
    });

    it('dispatches event for empty cell', () => {
      const spy = vi.fn();
      const ctx: any = { dispatchEvent: spy };
      const cell: MatrixCell = {
        rowIri: 'ex:bp1',
        colIri: 'ex:app2',
        relationshipType: '',
        relationshipLabel: '',
      };
      (MatrixView.prototype as any)._onCellClick.call(ctx, cell);
      const evt = spy.mock.calls[0][0] as CustomEvent<MatrixCellClickDetail>;
      expect(evt.detail.relationshipType).toBe('');
    });
  });
});
