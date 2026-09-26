import { describe, it, expect, vi } from 'vitest';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import type { RdfStore } from '../../../rdf-engine/interfaces.js';
import type { ElementManager } from '../../../model-manager/interfaces.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';
import {
  PropertyPanel,
  type PropertyEntry,
  type PropertyEditDetail,
  type ShaclPropertyShape,
  extractShaclShapes,
  buildPropertyEntries,
} from '../property-panel.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeQuad(s: string, p: string, o: string): Quad {
  return {
    subject: { value: s, termType: 'NamedNode' } as NamedNode,
    predicate: { value: p, termType: 'NamedNode' } as NamedNode,
    object: { value: o, termType: 'Literal' },
    graph: { value: '', termType: 'DefaultGraph' },
  } as unknown as Quad;
}

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const SKOS_DEFINITION = NAMESPACES.skos + 'definition';
const XSD_STRING = NAMESPACES.xsd + 'string';
const XSD_INTEGER = NAMESPACES.xsd + 'integer';

const SH = NAMESPACES.sh;

function sampleQuads(iri: string): Quad[] {
  return [
    makeQuad(iri, RDF_TYPE, 'https://example.org/BusinessProcess'),
    makeQuad(iri, SKOS_PREF_LABEL, 'My Process'),
    makeQuad(iri, SKOS_DEFINITION, 'A sample business process'),
    makeQuad(iri, 'https://example.org/custom', 'custom-value'),
  ];
}

function sampleShaclQuads(typeIri: string): Quad[] {
  const shapeIri = 'https://example.org/shapes/BPShape';
  const propShape1 = 'https://example.org/shapes/BPShape/label';
  const propShape2 = 'https://example.org/shapes/BPShape/count';
  return [
    makeQuad(shapeIri, SH + 'targetClass', typeIri),
    makeQuad(shapeIri, SH + 'property', propShape1),
    makeQuad(propShape1, SH + 'path', SKOS_PREF_LABEL),
    makeQuad(propShape1, SH + 'name', 'Label'),
    makeQuad(propShape1, SH + 'datatype', XSD_STRING),
    makeQuad(propShape1, SH + 'minCount', '1'),
    makeQuad(propShape1, SH + 'maxCount', '1'),
    makeQuad(shapeIri, SH + 'property', propShape2),
    makeQuad(propShape2, SH + 'path', 'https://example.org/count'),
    makeQuad(propShape2, SH + 'name', 'Count'),
    makeQuad(propShape2, SH + 'datatype', XSD_INTEGER),
    makeQuad(propShape2, SH + 'minCount', '0'),
  ];
}

function mockRdfStore(quads: Quad[]): RdfStore {
  return {
    addQuads: vi.fn(),
    removeQuads: vi.fn(),
    getQuads: vi.fn((subject?: NamedNode | null) => {
      if (!subject) return quads;
      return quads.filter((q) => q.subject.value === subject.value);
    }),
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

// ── Tests ───────────────────────────────────────────────────────────────

describe('extractShaclShapes', () => {
  it('extracts property shapes for a matching target class', () => {
    const typeIri = 'https://example.org/BusinessProcess';
    const shapes = extractShaclShapes(sampleShaclQuads(typeIri), typeIri);
    expect(shapes).toHaveLength(2);
    expect(shapes[0].path).toBe(SKOS_PREF_LABEL);
    expect(shapes[0].name).toBe('Label');
    expect(shapes[0].datatype).toBe(XSD_STRING);
    expect(shapes[0].minCount).toBe(1);
    expect(shapes[0].maxCount).toBe(1);
  });

  it('returns empty array when no shape targets the type', () => {
    const shapes = extractShaclShapes(sampleShaclQuads('https://example.org/BP'), 'https://other/Type');
    expect(shapes).toEqual([]);
  });

  it('handles shapes with optional fields', () => {
    const typeIri = 'https://example.org/BusinessProcess';
    const shapes = extractShaclShapes(sampleShaclQuads(typeIri), typeIri);
    const countShape = shapes.find((s) => s.path === 'https://example.org/count');
    expect(countShape).toBeDefined();
    expect(countShape!.name).toBe('Count');
    expect(countShape!.datatype).toBe(XSD_INTEGER);
    expect(countShape!.minCount).toBe(0);
    expect(countShape!.maxCount).toBeUndefined();
  });

  it('returns empty for empty shapes graph', () => {
    expect(extractShaclShapes([], 'https://example.org/Type')).toEqual([]);
  });
});

describe('buildPropertyEntries', () => {
  const iri = 'https://example.org/elem1';

  it('builds entries from quads', () => {
    const entries = buildPropertyEntries(sampleQuads(iri), []);
    expect(entries.length).toBe(4);
  });

  it('marks rdf:type as readonly', () => {
    const entries = buildPropertyEntries(sampleQuads(iri), []);
    const typeEntry = entries.find((e) => e.predicate === RDF_TYPE);
    expect(typeEntry?.readonly).toBe(true);
  });

  it('marks non-type entries as editable', () => {
    const entries = buildPropertyEntries(sampleQuads(iri), []);
    const labelEntry = entries.find((e) => e.predicate === SKOS_PREF_LABEL);
    expect(labelEntry?.readonly).toBe(false);
  });

  it('sorts rdf:type first, then prefLabel, definition, then the rest by label', () => {
    const entries = buildPropertyEntries(sampleQuads(iri), []);
    expect(entries.map((e) => e.predicate)).toEqual([
      RDF_TYPE,
      SKOS_PREF_LABEL,
      SKOS_DEFINITION,
      'https://example.org/custom',
    ]);
  });

  it('lists the name and the definition even without a value, empty, to be filled in', () => {
    const entries = buildPropertyEntries([makeQuad(iri, RDF_TYPE, 'https://example.org/BP')], []);
    expect(entries.map((e) => [e.predicate, e.value])).toEqual([
      [RDF_TYPE, 'https://example.org/BP'],
      [SKOS_PREF_LABEL, ''],
      [SKOS_DEFINITION, ''],
    ]);
    expect(entries.slice(1).every((e) => !e.readonly && !e.custom)).toBe(true);
  });

  it('uses SHACL shape name as label when available', () => {
    const shapes: ShaclPropertyShape[] = [
      { path: SKOS_PREF_LABEL, name: 'Label', datatype: XSD_STRING, minCount: 1 },
    ];
    const entries = buildPropertyEntries(sampleQuads(iri), shapes);
    const labelEntry = entries.find((e) => e.predicate === SKOS_PREF_LABEL);
    expect(labelEntry?.label).toBe('Label');
    expect(labelEntry?.datatype).toBe(XSD_STRING);
    expect(labelEntry?.minCount).toBe(1);
  });

  it('falls back to IRI fragment for label', () => {
    const entries = buildPropertyEntries(sampleQuads(iri), []);
    const customEntry = entries.find((e) => e.predicate === 'https://example.org/custom');
    expect(customEntry?.label).toBe('custom');
  });

  it('returns empty for empty quads', () => {
    expect(buildPropertyEntries([], [])).toEqual([]);
  });

  it('lists type, inModel, prefLabel, definition, then every other property by label; leaves out inView', () => {
    const ARCH = NAMESPACES.arch;
    const AM4 = 'https://meta.linked.archi/archimate4/onto#';
    const quads = [
      makeQuad(iri, 'https://example.org/props#owner', 'Team A'),
      makeQuad(iri, ARCH + 'inView', 'https://example.org/m/view-1'),
      makeQuad(iri, 'https://example.org/props#cost', '100'),
      makeQuad(iri, AM4 + 'serves', 'https://example.org/m/element-2'),
      makeQuad(iri, SKOS_PREF_LABEL, 'Order Service'),
      makeQuad(iri, ARCH + 'inModel', 'https://example.org/m/model'),
      makeQuad(iri, RDF_TYPE, AM4 + 'ApplicationComponent'),
    ];
    const entries = buildPropertyEntries(quads, []);
    expect(entries.map((e) => e.label)).toEqual(['type', 'inModel', 'prefLabel', 'definition', 'cost', 'owner', 'serves']);
    expect(entries.filter((e) => e.custom).map((e) => e.label)).toEqual(['cost', 'owner', 'serves']);
  });

  it('orders a relationship the same way: its source and target are among the rest', () => {
    const ARCH = NAMESPACES.arch;
    const quads = [
      makeQuad(iri, ARCH + 'inView', 'https://example.org/m/view-1'),
      makeQuad(iri, ARCH + 'target', 'https://example.org/m/element-2'),
      makeQuad(iri, 'https://example.org/props#weight', '3'),
      makeQuad(iri, ARCH + 'inModel', 'https://example.org/m/model'),
      makeQuad(iri, ARCH + 'source', 'https://example.org/m/element-1'),
      makeQuad(iri, RDF_TYPE, 'https://meta.linked.archi/archimate4/onto#Serving'),
    ];
    expect(buildPropertyEntries(quads, []).map((e) => e.label)).toEqual([
      'type',
      'inModel',
      'prefLabel',
      'definition',
      'source',
      'target',
      'weight',
    ]);
  });
});

describe('PropertyPanel', () => {
  it('exports the class', () => {
    expect(PropertyPanel).toBeDefined();
  });

  it('has static styles', () => {
    expect((PropertyPanel as any).styles).toBeDefined();
  });

  it('has render on prototype', () => {
    expect(typeof PropertyPanel.prototype.render).toBe('function');
  });

  describe('render template', () => {
    function makeCtx(overrides: Record<string, unknown> = {}) {
      const ctx: any = {
        selectedIri: '',
        elementManager: undefined,
        rdfStore: undefined,
        shapesGraph: undefined,
        _entries: [],
        dispatchEvent: vi.fn(),
        catalog: undefined,
        ...overrides,
      };
      // Bind methods from prototype
      for (const m of [
        '_renderEntry',
        '_isTextArea',
        '_inputType',
        '_onPropertyChange',
        '_loadProperties',
        '_renderHeading',
        '_renderAdd',
        '_renderRelationships',
        '_renderViews',
        'selectTab',
        '_onTabKey',
        '_renderRemove',
        '_emit',
        '_remove',
        '_add',
      ]) {
        if (typeof (PropertyPanel.prototype as any)[m] === 'function') {
          ctx[m] = (PropertyPanel.prototype as any)[m].bind(ctx);
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

    function renderPanel(overrides: Record<string, unknown> = {}): string {
      const ctx = makeCtx(overrides);
      return flat((PropertyPanel.prototype as any).render.call(ctx));
    }

    it('shows "No element selected" when no IRI', () => {
      const o = renderPanel();
      expect(o).toContain('No element selected');
    });

    it('renders property entries when selectedIri is set', () => {
      const entries: PropertyEntry[] = [
        { predicate: RDF_TYPE, label: 'type', value: 'https://example.org/BP', readonly: true },
        { predicate: SKOS_PREF_LABEL, label: 'prefLabel', value: 'My Process', readonly: false },
      ];
      const o = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: entries });
      expect(o).toContain('Properties');
      expect(o).toContain('type');
      expect(o).toContain('prefLabel');
      expect(o).not.toContain('No element selected');
    });

    const TABBED: PropertyEntry[] = [
      { predicate: RDF_TYPE, label: 'type', value: 'https://example.org/BP', readonly: true },
      { predicate: SKOS_PREF_LABEL, label: 'prefLabel', value: 'Web', readonly: false },
      { predicate: 'https://example.org/cost', label: 'cost', value: '1', readonly: false, custom: true },
      { predicate: 'https://example.org/owner', label: 'owner', value: 'A', readonly: false, custom: true },
    ];
    const ANALYSIS = { relationships: [], views: [{ iri: 'https://example.org/v1', label: 'Main' }] };

    it('lists the vertical tabs — information, properties, analysis, views — with counts', () => {
      const o = renderPanel({
        selectedIri: 'https://example.org/elem1',
        _entries: TABBED,
        heading: { kind: 'Element' },
        analysis: ANALYSIS,
      });
      const at = (text: string) => o.indexOf(text);
      expect(o).toContain('aria-orientation="vertical"');
      expect(at('Element information')).toBeGreaterThan(-1);
      expect(at('Element information')).toBeLessThan(at('>Properties<'));
      expect(at('>Properties<')).toBeLessThan(at('>Analysis<'));
      expect(at('>Analysis<')).toBeLessThan(at('>Appears in views<'));
      // The information tab is open: ID first, then the leading fields; not the added ones.
      expect(at('>ID<')).toBeGreaterThan(at('>Appears in views<'));
      expect(at('>ID<')).toBeLessThan(o.search(/property-label">\s*type/));
      expect(o).not.toContain('>cost<');
    });

    it('shows the open tab’s pane only', () => {
      const o = renderPanel({
        selectedIri: 'https://example.org/elem1',
        _entries: TABBED,
        analysis: ANALYSIS,
        _tab: 'properties',
      });
      expect(o).toContain('cost');
      expect(o).toContain('owner');
      expect(o).toContain('Add');
      expect(o).not.toContain('>ID<');
      const views = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: TABBED, analysis: ANALYSIS, _tab: 'views' });
      expect(views).toContain('Main');
      expect(views).not.toContain('cost');
    });

    it('falls back to the information tab when the remembered one does not apply', () => {
      // No analysis (a model): no analysis or views tab.
      const o = renderPanel({ selectedIri: 'https://example.org/m', _entries: TABBED, _tab: 'views' });
      expect(o).not.toContain('Appears in views');
      expect(o).toContain('>ID<');
    });

    it('renders textarea for definition fields', () => {
      const entries: PropertyEntry[] = [
        { predicate: SKOS_DEFINITION, label: 'definition', value: 'A process', readonly: false },
      ];
      const o = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: entries });
      expect(o).toContain('textarea');
    });

    it('renders required indicator for minCount > 0', () => {
      const entries: PropertyEntry[] = [
        { predicate: SKOS_PREF_LABEL, label: 'Label', value: 'X', readonly: false, minCount: 1 },
      ];
      const o = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: entries });
      expect(o).toContain('required');
      expect(o).toContain('*');
    });

    it('does not show required indicator when minCount is 0', () => {
      const entries: PropertyEntry[] = [
        { predicate: SKOS_PREF_LABEL, label: 'Label', value: 'X', readonly: false, minCount: 0 },
      ];
      const o = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: entries });
      expect(o).not.toContain('required');
    });
  });

  describe('_inputType', () => {
    function inputType(datatype?: string): string {
      const ctx: any = {};
      return (PropertyPanel.prototype as any)._inputType.call(ctx, { datatype } as PropertyEntry);
    }

    it('returns text for no datatype', () => {
      expect(inputType()).toBe('text');
    });

    it('returns number for xsd:integer', () => {
      expect(inputType(NAMESPACES.xsd + 'integer')).toBe('number');
    });

    it('returns number for xsd:double', () => {
      expect(inputType(NAMESPACES.xsd + 'double')).toBe('number');
    });

    it('returns date for xsd:date', () => {
      expect(inputType(NAMESPACES.xsd + 'date')).toBe('date');
    });

    it('returns datetime-local for xsd:dateTime', () => {
      expect(inputType(NAMESPACES.xsd + 'dateTime')).toBe('datetime-local');
    });

    it('returns text for xsd:string', () => {
      expect(inputType(NAMESPACES.xsd + 'string')).toBe('text');
    });
  });

  describe('_loadProperties', () => {
    it('populates entries from rdfStore', () => {
      const iri = 'https://example.org/elem1';
      const quads = sampleQuads(iri);
      const store = mockRdfStore(quads);
      const ctx: any = {
        selectedIri: iri,
        rdfStore: store,
        shapesGraph: undefined,
        _entries: [],
      };
      (PropertyPanel.prototype as any)._loadProperties.call(ctx);
      expect(ctx._entries.length).toBe(4);
      expect(store.getQuads).toHaveBeenCalled();
    });

    it('clears entries when no selectedIri', () => {
      const ctx: any = {
        selectedIri: '',
        rdfStore: mockRdfStore([]),
        _entries: [{ predicate: 'x', label: 'x', value: 'x', readonly: false }],
      };
      (PropertyPanel.prototype as any)._loadProperties.call(ctx);
      expect(ctx._entries).toEqual([]);
    });

    it('clears entries when no rdfStore', () => {
      const ctx: any = {
        selectedIri: 'https://example.org/elem1',
        rdfStore: undefined,
        _entries: [{ predicate: 'x', label: 'x', value: 'x', readonly: false }],
      };
      (PropertyPanel.prototype as any)._loadProperties.call(ctx);
      expect(ctx._entries).toEqual([]);
    });

    it('enriches entries with SHACL shapes', () => {
      const iri = 'https://example.org/elem1';
      const typeIri = 'https://example.org/BusinessProcess';
      const quads = sampleQuads(iri);
      const store = mockRdfStore(quads);
      const shapesQuads = sampleShaclQuads(typeIri);
      const ctx: any = {
        selectedIri: iri,
        rdfStore: store,
        shapesGraph: shapesQuads,
        _entries: [],
      };
      (PropertyPanel.prototype as any)._loadProperties.call(ctx);
      const labelEntry = ctx._entries.find((e: PropertyEntry) => e.predicate === SKOS_PREF_LABEL);
      expect(labelEntry?.label).toBe('Label');
      expect(labelEntry?.datatype).toBe(XSD_STRING);
    });
  });

  describe('_onPropertyChange', () => {
    it('calls elementManager.updateProperty', () => {
      const em = mockElementManager();
      const store = mockRdfStore(sampleQuads('https://example.org/elem1'));
      const ctx: any = {
        selectedIri: 'https://example.org/elem1',
        elementManager: em,
        rdfStore: store,
        shapesGraph: undefined,
        _entries: [],
        dispatchEvent: vi.fn(),
      };
      // Bind _loadProperties so it can be called after change
      ctx._loadProperties = (PropertyPanel.prototype as any)._loadProperties.bind(ctx);

      const entry: PropertyEntry = {
        predicate: SKOS_PREF_LABEL,
        label: 'prefLabel',
        value: 'Old',
        readonly: false,
      };
      (PropertyPanel.prototype as any)._onPropertyChange.call(ctx, entry, 'New Value');
      expect(em.updateProperty).toHaveBeenCalledWith(
        'https://example.org/elem1',
        SKOS_PREF_LABEL,
        expect.objectContaining({ value: 'New Value' }),
      );
    });

    it('dispatches property-edit event', () => {
      const spy = vi.fn();
      const store = mockRdfStore(sampleQuads('https://example.org/elem1'));
      const ctx: any = {
        selectedIri: 'https://example.org/elem1',
        elementManager: mockElementManager(),
        rdfStore: store,
        shapesGraph: undefined,
        _entries: [],
        dispatchEvent: spy,
      };
      ctx._loadProperties = (PropertyPanel.prototype as any)._loadProperties.bind(ctx);

      const entry: PropertyEntry = {
        predicate: SKOS_PREF_LABEL,
        label: 'prefLabel',
        value: 'Old',
        readonly: false,
      };
      (PropertyPanel.prototype as any)._onPropertyChange.call(ctx, entry, 'New');
      const evt = spy.mock.calls[0][0] as CustomEvent<PropertyEditDetail>;
      expect(evt.type).toBe('property-edit');
      expect(evt.detail.elementIri).toBe('https://example.org/elem1');
      expect(evt.detail.predicate).toBe(SKOS_PREF_LABEL);
      expect(evt.detail.value).toBe('New');
      expect(evt.bubbles).toBe(true);
      expect(evt.composed).toBe(true);
    });

    it('does nothing for readonly entries', () => {
      const em = mockElementManager();
      const spy = vi.fn();
      const ctx: any = {
        selectedIri: 'https://example.org/elem1',
        elementManager: em,
        dispatchEvent: spy,
      };
      const entry: PropertyEntry = {
        predicate: RDF_TYPE,
        label: 'type',
        value: 'https://example.org/BP',
        readonly: true,
      };
      (PropertyPanel.prototype as any)._onPropertyChange.call(ctx, entry, 'new');
      expect(em.updateProperty).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it('does nothing when no selectedIri', () => {
      const em = mockElementManager();
      const spy = vi.fn();
      const ctx: any = {
        selectedIri: '',
        elementManager: em,
        dispatchEvent: spy,
      };
      const entry: PropertyEntry = {
        predicate: SKOS_PREF_LABEL,
        label: 'prefLabel',
        value: 'Old',
        readonly: false,
      };
      (PropertyPanel.prototype as any)._onPropertyChange.call(ctx, entry, 'new');
      expect(em.updateProperty).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it('still dispatches event when no elementManager', () => {
      const spy = vi.fn();
      const store = mockRdfStore(sampleQuads('https://example.org/elem1'));
      const ctx: any = {
        selectedIri: 'https://example.org/elem1',
        elementManager: undefined,
        rdfStore: store,
        shapesGraph: undefined,
        _entries: [],
        dispatchEvent: spy,
      };
      ctx._loadProperties = (PropertyPanel.prototype as any)._loadProperties.bind(ctx);

      const entry: PropertyEntry = {
        predicate: SKOS_PREF_LABEL,
        label: 'prefLabel',
        value: 'Old',
        readonly: false,
      };
      (PropertyPanel.prototype as any)._onPropertyChange.call(ctx, entry, 'New');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
