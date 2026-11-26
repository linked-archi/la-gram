import { describe, it, expect, vi } from 'vitest';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import type { RdfStore } from '@linked-archi/kernel/rdf-engine/interfaces.js';
import type { ElementManager } from '@linked-archi/kernel/model-manager/interfaces.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import {
  CatalogView,
  type CatalogRow,
  type CatalogEditDetail,
  type CatalogSelectDetail,
  type CatalogColumn,
  iriLabel,
  discoverColumns,
  buildCatalogRows,
} from '../catalog-view.js';

// ── Helpers ─────────────────────────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const SKOS_DEFINITION = NAMESPACES.skos + 'definition';

function makeQuad(s: string, p: string, o: string): Quad {
  return {
    subject: { value: s, termType: 'NamedNode' } as NamedNode,
    predicate: { value: p, termType: 'NamedNode' } as NamedNode,
    object: { value: o, termType: 'Literal' },
    graph: { value: '', termType: 'DefaultGraph' },
  } as unknown as Quad;
}

const TYPE_BP = 'https://example.org/BusinessProcess';
const TYPE_APP = 'https://example.org/ApplicationComponent';
const CUSTOM_PROP = 'https://example.org/priority';

function sampleQuads(): Quad[] {
  return [
    makeQuad('ex:bp1', RDF_TYPE, TYPE_BP),
    makeQuad('ex:bp1', SKOS_PREF_LABEL, 'Process Alpha'),
    makeQuad('ex:bp1', SKOS_DEFINITION, 'First process'),
    makeQuad('ex:bp1', CUSTOM_PROP, 'high'),
    makeQuad('ex:bp2', RDF_TYPE, TYPE_BP),
    makeQuad('ex:bp2', SKOS_PREF_LABEL, 'Process Beta'),
    makeQuad('ex:bp2', CUSTOM_PROP, 'low'),
    makeQuad('ex:app1', RDF_TYPE, TYPE_APP),
    makeQuad('ex:app1', SKOS_PREF_LABEL, 'CRM System'),
  ];
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

function mockElementManager(): ElementManager {
  return {
    createElement: vi.fn(),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
}

// ── Tests: iriLabel ─────────────────────────────────────────────────────

describe('iriLabel', () => {
  it('extracts fragment after #', () => {
    expect(iriLabel('http://example.org/ns#MyClass')).toBe('MyClass');
  });

  it('extracts last path segment after /', () => {
    expect(iriLabel('http://example.org/ns/MyClass')).toBe('MyClass');
  });

  it('returns full string when no # or /', () => {
    expect(iriLabel('MyClass')).toBe('MyClass');
  });

  it('prefers # over /', () => {
    expect(iriLabel('http://example.org/ns#local')).toBe('local');
  });
});

// ── Tests: discoverColumns ──────────────────────────────────────────────

describe('discoverColumns', () => {
  it('discovers columns for elements of a given type', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    expect(cols.length).toBeGreaterThanOrEqual(2);
    expect(cols.map((c) => c.predicate)).toContain(SKOS_PREF_LABEL);
    expect(cols.map((c) => c.predicate)).toContain(CUSTOM_PROP);
  });

  it('excludes rdf:type from columns', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    expect(cols.map((c) => c.predicate)).not.toContain(RDF_TYPE);
  });

  it('places skos:prefLabel first', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    expect(cols[0].predicate).toBe(SKOS_PREF_LABEL);
  });

  it('places skos:definition second when present', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    expect(cols[1].predicate).toBe(SKOS_DEFINITION);
  });

  it('returns empty for type with no elements', () => {
    const cols = discoverColumns(sampleQuads(), 'https://example.org/NonExistent');
    expect(cols).toEqual([]);
  });

  it('returns empty for empty quads', () => {
    expect(discoverColumns([], TYPE_BP)).toEqual([]);
  });

  it('does not include columns from other types', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_APP);
    // APP only has prefLabel
    expect(cols.length).toBe(1);
    expect(cols[0].predicate).toBe(SKOS_PREF_LABEL);
  });
});

// ── Tests: buildCatalogRows ─────────────────────────────────────────────

describe('buildCatalogRows', () => {
  it('builds rows for elements of the given type', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    const rows = buildCatalogRows(sampleQuads(), TYPE_BP, cols);
    expect(rows).toHaveLength(2);
  });

  it('excludes elements of other types', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    const rows = buildCatalogRows(sampleQuads(), TYPE_BP, cols);
    const iris = rows.map((r) => r.iri);
    expect(iris).not.toContain('ex:app1');
  });

  it('populates property maps correctly', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    const rows = buildCatalogRows(sampleQuads(), TYPE_BP, cols);
    const bp1 = rows.find((r) => r.iri === 'ex:bp1');
    expect(bp1).toBeDefined();
    expect(bp1!.properties.get(SKOS_PREF_LABEL)).toBe('Process Alpha');
    expect(bp1!.properties.get(CUSTOM_PROP)).toBe('high');
  });

  it('sorts rows by prefLabel', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    const rows = buildCatalogRows(sampleQuads(), TYPE_BP, cols);
    expect(rows[0].properties.get(SKOS_PREF_LABEL)).toBe('Process Alpha');
    expect(rows[1].properties.get(SKOS_PREF_LABEL)).toBe('Process Beta');
  });

  it('returns empty for no matching elements', () => {
    const cols: CatalogColumn[] = [];
    const rows = buildCatalogRows(sampleQuads(), 'https://example.org/None', cols);
    expect(rows).toEqual([]);
  });

  it('returns empty for empty quads', () => {
    expect(buildCatalogRows([], TYPE_BP, [])).toEqual([]);
  });

  it('handles missing property values gracefully', () => {
    const cols = discoverColumns(sampleQuads(), TYPE_BP);
    const rows = buildCatalogRows(sampleQuads(), TYPE_BP, cols);
    // bp2 has no definition
    const bp2 = rows.find((r) => r.iri === 'ex:bp2');
    expect(bp2).toBeDefined();
    expect(bp2!.properties.get(SKOS_DEFINITION)).toBeUndefined();
  });
});

// ── Tests: CatalogView component ────────────────────────────────────────

describe('CatalogView', () => {
  it('exports the class', () => {
    expect(CatalogView).toBeDefined();
  });

  it('has static styles', () => {
    expect((CatalogView as any).styles).toBeDefined();
  });

  it('has render on prototype', () => {
    expect(typeof CatalogView.prototype.render).toBe('function');
  });

  describe('render template', () => {
    function makeCtx(overrides: Record<string, unknown> = {}) {
      const ctx: any = {
        typeFilter: '',
        rdfStore: undefined,
        elementManager: undefined,
        selectedIri: '',
        _columns: [],
        _rows: [],
        _editingCell: '',
        _editValue: '',
        dispatchEvent: vi.fn(),
        ...overrides,
      };
      for (const m of ['_renderCell', '_onRowClick', '_startEdit', '_commitEdit', '_onCellKeydown', '_rebuildTable']) {
        if (typeof (CatalogView.prototype as any)[m] === 'function') {
          ctx[m] = (CatalogView.prototype as any)[m].bind(ctx);
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
      return flat((CatalogView.prototype as any).render.call(ctx));
    }

    it('shows "No type filter set" when typeFilter is empty', () => {
      const o = renderView();
      expect(o).toContain('Catalog');
      expect(o).toContain('No type filter set');
    });

    it('shows "No elements of this type" when rows are empty', () => {
      const o = renderView({ typeFilter: TYPE_BP, _columns: [], _rows: [] });
      expect(o).toContain('No elements of this type');
    });

    it('renders table with column headers', () => {
      const cols: CatalogColumn[] = [
        { predicate: SKOS_PREF_LABEL, label: 'prefLabel' },
        { predicate: CUSTOM_PROP, label: 'priority' },
      ];
      const rows: CatalogRow[] = [
        { iri: 'ex:bp1', properties: new Map([[SKOS_PREF_LABEL, 'Alpha'], [CUSTOM_PROP, 'high']]) },
      ];
      const o = renderView({ typeFilter: TYPE_BP, _columns: cols, _rows: rows });
      expect(o).toContain('prefLabel');
      expect(o).toContain('priority');
      expect(o).toContain('Alpha');
      expect(o).toContain('high');
    });

    it('renders type label in header', () => {
      const o = renderView({
        typeFilter: TYPE_BP,
        _columns: [{ predicate: SKOS_PREF_LABEL, label: 'prefLabel' }],
        _rows: [{ iri: 'ex:bp1', properties: new Map([[SKOS_PREF_LABEL, 'X']]) }],
      });
      expect(o).toContain('BusinessProcess');
    });
  });

  describe('_rebuildTable', () => {
    it('populates columns and rows from rdfStore', () => {
      const store = mockRdfStore(sampleQuads());
      const ctx: any = {
        rdfStore: store,
        typeFilter: TYPE_BP,
        _columns: [],
        _rows: [],
      };
      (CatalogView.prototype as any)._rebuildTable.call(ctx);
      expect(ctx._columns.length).toBeGreaterThan(0);
      expect(ctx._rows.length).toBe(2);
    });

    it('clears when no rdfStore', () => {
      const ctx: any = {
        rdfStore: undefined,
        typeFilter: TYPE_BP,
        _columns: [{ predicate: 'x', label: 'x' }],
        _rows: [{ iri: 'x', properties: new Map() }],
      };
      (CatalogView.prototype as any)._rebuildTable.call(ctx);
      expect(ctx._columns).toEqual([]);
      expect(ctx._rows).toEqual([]);
    });

    it('clears when no typeFilter', () => {
      const ctx: any = {
        rdfStore: mockRdfStore(sampleQuads()),
        typeFilter: '',
        _columns: [{ predicate: 'x', label: 'x' }],
        _rows: [{ iri: 'x', properties: new Map() }],
      };
      (CatalogView.prototype as any)._rebuildTable.call(ctx);
      expect(ctx._columns).toEqual([]);
      expect(ctx._rows).toEqual([]);
    });
  });

  describe('_onRowClick', () => {
    it('dispatches catalog-select event', () => {
      const spy = vi.fn();
      const ctx: any = { selectedIri: '', dispatchEvent: spy };
      (CatalogView.prototype as any)._onRowClick.call(ctx, 'ex:bp1');
      expect(ctx.selectedIri).toBe('ex:bp1');
      const evt = spy.mock.calls[0][0] as CustomEvent<CatalogSelectDetail>;
      expect(evt.type).toBe('catalog-select');
      expect(evt.detail.iri).toBe('ex:bp1');
      expect(evt.bubbles).toBe(true);
      expect(evt.composed).toBe(true);
    });
  });

  describe('_commitEdit', () => {
    it('calls elementManager.updateProperty and dispatches catalog-edit', () => {
      const em = mockElementManager();
      const store = mockRdfStore(sampleQuads());
      const spy = vi.fn();
      const ctx: any = {
        elementManager: em,
        rdfStore: store,
        typeFilter: TYPE_BP,
        _editingCell: 'ex:bp1|' + SKOS_PREF_LABEL,
        _editValue: 'New Name',
        _columns: [],
        _rows: [],
        dispatchEvent: spy,
      };
      ctx._rebuildTable = (CatalogView.prototype as any)._rebuildTable.bind(ctx);
      (CatalogView.prototype as any)._commitEdit.call(ctx, 'ex:bp1', SKOS_PREF_LABEL);
      expect(em.updateProperty).toHaveBeenCalledWith(
        'ex:bp1',
        SKOS_PREF_LABEL,
        expect.objectContaining({ value: 'New Name' }),
      );
      expect(ctx._editingCell).toBe('');
      const evt = spy.mock.calls[0][0] as CustomEvent<CatalogEditDetail>;
      expect(evt.type).toBe('catalog-edit');
      expect(evt.detail.elementIri).toBe('ex:bp1');
      expect(evt.detail.predicate).toBe(SKOS_PREF_LABEL);
      expect(evt.detail.value).toBe('New Name');
    });

    it('dispatches event even without elementManager', () => {
      const store = mockRdfStore(sampleQuads());
      const spy = vi.fn();
      const ctx: any = {
        elementManager: undefined,
        rdfStore: store,
        typeFilter: TYPE_BP,
        _editingCell: 'ex:bp1|' + SKOS_PREF_LABEL,
        _editValue: 'New',
        _columns: [],
        _rows: [],
        dispatchEvent: spy,
      };
      ctx._rebuildTable = (CatalogView.prototype as any)._rebuildTable.bind(ctx);
      (CatalogView.prototype as any)._commitEdit.call(ctx, 'ex:bp1', SKOS_PREF_LABEL);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('_startEdit', () => {
    it('sets editing cell and value', () => {
      const ctx: any = { _editingCell: '', _editValue: '' };
      (CatalogView.prototype as any)._startEdit.call(ctx, 'ex:bp1', SKOS_PREF_LABEL, 'Alpha');
      expect(ctx._editingCell).toBe('ex:bp1|' + SKOS_PREF_LABEL);
      expect(ctx._editValue).toBe('Alpha');
    });
  });
});
