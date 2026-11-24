import { describe, it, expect, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import type { RdfStore } from '@linked-archi/kernel/rdf-engine/interfaces.js';
import type { ElementManager } from '@linked-archi/kernel/model-manager/interfaces.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
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

  it('leaves out a relationship’s rdf:reifies: la-gram keeps it in step with the ends and type', () => {
    const { namedNode, quad } = DataFactory;
    const reifies = quad(
      namedNode(iri),
      namedNode(NAMESPACES.rdf + 'reifies'),
      quad(namedNode('urn:a'), namedNode('urn:p'), namedNode('urn:b')) as never,
    ) as unknown as Quad;
    const entries = buildPropertyEntries([...sampleQuads(iri), reifies], []);
    expect(entries.map((e) => e.predicate)).not.toContain(NAMESPACES.rdf + 'reifies');
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

  it('takes the SHACL shape’s datatype and cardinality; names the fields every concept has as a modeller knows them', () => {
    const shapes: ShaclPropertyShape[] = [
      { path: SKOS_PREF_LABEL, name: 'prefLabel', datatype: XSD_STRING, minCount: 1 },
      { path: 'https://example.org/custom', name: 'Cost centre' },
    ];
    const entries = buildPropertyEntries(sampleQuads(iri), shapes);
    const labelEntry = entries.find((e) => e.predicate === SKOS_PREF_LABEL);
    expect(labelEntry?.label).toBe('Name');
    expect(labelEntry?.datatype).toBe(XSD_STRING);
    expect(labelEntry?.minCount).toBe(1);
    expect(entries.map((e) => e.label)).toEqual(['Type', 'Name', 'Definition', 'Cost centre']);
  });

  it('names a field by its shape or its vocabulary when that is more than its local name, else by the local name in words', () => {
    const names: Record<string, string> = {
      'https://example.org/hasOwner': 'owned by',
      'https://example.org/serves': 'serves',
    };
    const quads = [
      makeQuad(iri, 'https://example.org/custom', 'x'),
      makeQuad(iri, 'https://example.org/hasOwner', 'x'),
      makeQuad(iri, 'https://example.org/serves', 'x'),
      makeQuad(iri, 'https://example.org/modelRepresentsSystem', 'x'),
      makeQuad(iri, 'https://example.org/source', 'x'),
    ];
    const shapes: ShaclPropertyShape[] = [{ path: 'https://example.org/source', name: 'source' }];
    const label = (p: string) => buildPropertyEntries(quads, shapes, (x) => names[x]).find((e) => e.predicate === p)?.label;
    expect(label('https://example.org/custom')).toBe('Custom');
    expect(label('https://example.org/hasOwner')).toBe('Owned by');
    expect(label('https://example.org/serves')).toBe('Serves');
    expect(label('https://example.org/modelRepresentsSystem')).toBe('Model represents system');
    expect(label('https://example.org/source')).toBe('Source');
  });

  it('names a link by what the loaded data calls it, else by its local name in words', () => {
    const iriQuad = (s: string, p: string, o: string): Quad =>
      ({ ...makeQuad(s, p, o), object: { value: o, termType: 'NamedNode' } }) as unknown as Quad;
    const names: Record<string, string> = { 'https://example.org/m/model': 'Shop architecture' };
    const entries = buildPropertyEntries(
      [
        iriQuad(iri, RDF_TYPE, 'https://meta.linked.archi/archimate4/onto#ApplicationComponent'),
        iriQuad(iri, NAMESPACES.arch + 'inModel', 'https://example.org/m/model'),
        makeQuad(iri, SKOS_PREF_LABEL, 'Web shop'),
      ],
      [],
      (x) => names[x],
    );
    expect(entries.map((e) => [e.label, e.valueLabel])).toEqual([
      ['Type', 'Application Component'],
      ['Model', 'Shop architecture'],
      ['Name', undefined],
      ['Definition', undefined],
    ]);
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
    expect(entries.map((e) => e.label)).toEqual(['Type', 'Model', 'Name', 'Definition', 'Cost', 'Owner', 'Serves']);
    expect(entries.filter((e) => e.custom).map((e) => e.label)).toEqual(['Cost', 'Owner', 'Serves']);
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
      'Type',
      'Model',
      'Name',
      'Definition',
      'Source',
      'Target',
      'Weight',
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
        _shapes: new Map(),
        _pickedPredicate: '',
        _newValue: '',
        dispatchEvent: vi.fn(),
        catalog: undefined,
        _shownIris: new Set(),
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
        '_renderNewValue',
        '_renderRelationships',
        '_renderViews',
        'selectTab',
        '_onTabKey',
        '_renderRemove',
        '_emit',
        '_remove',
        '_add',
        '_renderTypeChoice',
        '_irisShown',
        '_toggleIris',
        '_renderLabel',
        '_renderIris',
        '_renderNamed',
        '_renderId',
        '_renderDerivation',
        '_renderContextNames',
        '_renderContextPictures',
        '_renderProvenance',
        '_takesLinks',
        '_renderRelationshipGroup',
        '_toggleRelationships',
        '_renderReferencedFrom',
        '_renderFigureText',
        '_renderReference',
        '_renderOpens',
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

    it('says what derived a relationship and from what, and offers to confirm a potential one', () => {
      const premises = [
        { iri: 'https://example.org/r1', label: 'K8s Cluster → Azure Cloud' },
        { iri: 'https://example.org/r2', label: 'Azure Cloud → Postgres DB' },
      ];
      const potential = renderPanel({
        selectedIri: 'https://example.org/d1',
        heading: { kind: 'Potential relationship', derivation: { certainty: 'potential', confirmed: false, rule: 'PDR8', premises } },
      });
      expect(potential).toContain('Potential relationship information');
      expect(potential).toContain('Potential: may hold');
      expect(potential).toContain('PDR8');
      expect(potential).toContain('K8s Cluster → Azure Cloud');
      expect(potential).toContain('Azure Cloud → Postgres DB');
      expect(potential).toContain('confirm-derivation');

      const valid = renderPanel({
        selectedIri: 'https://example.org/d2',
        heading: { kind: 'Derived relationship', derivation: { certainty: 'valid', confirmed: false, rule: 'DR2', premises } },
      });
      expect(valid).toContain('Derived, valid');
      expect(valid).toContain('DR2');
      expect(valid).not.toContain('confirm-derivation');

      const confirmed = renderPanel({
        selectedIri: 'https://example.org/d1',
        heading: { kind: 'Relationship', derivation: { certainty: 'potential', confirmed: true, rule: 'PDR8', premises } },
      });
      expect(confirmed).toContain('Confirmed: proposed as a potential derivation');
      expect(confirmed).not.toContain('confirm-derivation');

      expect(renderPanel({ selectedIri: 'https://example.org/r1', heading: { kind: 'Relationship' } })).not.toContain('Derivation');
    });

    const TABBED: PropertyEntry[] = [
      { predicate: RDF_TYPE, label: 'Type', value: 'https://example.org/BP', valueLabel: 'BP', readonly: true, isIri: true },
      { predicate: SKOS_PREF_LABEL, label: 'Name', value: 'Web', readonly: false },
      { predicate: 'https://example.org/cost', label: 'Cost', value: '1', readonly: false, custom: true },
      { predicate: 'https://example.org/owner', label: 'Owner', value: 'A', readonly: false, custom: true },
    ];
    const ANALYSIS = { relationships: [], views: [{ iri: 'https://example.org/v1', label: 'Main' }] };

    it('shows a view reference’s Text — its view’s name greyed with none of its own — and what it Opens, with Open and Change… (VR-4, VR-8)', () => {
      const node = 'https://example.org/view/1#node-1';
      const views = [{ iri: 'https://example.org/view/2', label: 'Payments', kind: 'Diagram' as const }];
      const heading = (reference: Record<string, unknown>) => ({ kind: 'View reference', figure: { kind: 'reference' }, reference: { nodeIri: node, views, ...reference } });
      const none = renderPanel({ selectedIri: node, heading: heading({ viewIri: views[0]!.iri, viewLabel: 'Payments' }) });
      // The view's name as the field's value, greyed: no text of its own, no ×.
      expect(none).toContain('class="property-value inherited"');
      expect(none).not.toContain("Show the view's name");
      expect(none).toContain('Opens');
      expect(none).toMatch(/class="opens-view [^"]*"[^>]*>Payments</);
      expect(none).toContain('>Open</button>');
      expect(none).toContain('>Change…</button>');
      // Text of its own — an empty one too: not greyed, and × shows the view's name again.
      const own = (value: string) =>
        renderPanel({
          selectedIri: node,
          heading: heading({ nodeIri: node, viewIri: views[0]!.iri, viewLabel: 'Payments', text: value, textLanguage: 'en' }),
        });
      for (const value of ['See also', '']) {
        expect(own(value)).not.toContain('class="property-value inherited"');
        expect(own(value)).toContain(`title=Show the view's name`);
      }
      expect(own('')).toContain('placeholder=No text');
      // A view not in the model: said.
      expect(renderPanel({ selectedIri: node, heading: heading({ viewIri: 'https://example.org/view/9' }) })).toContain('A view not in the model');
      // Another figure has neither.
      const note = renderPanel({ selectedIri: node, heading: { kind: 'Note', figure: { kind: 'note' } } });
      expect(note).not.toContain('Opens');
      expect(note).toContain('placeholder=Add a name…');
    });

    it('empties a figure’s text — a note’s goes, a view reference’s is written empty — where a name is not emptied', () => {
      const changed = (entry: Partial<PropertyEntry>, value = '  ') => {
        const ctx = makeCtx({ selectedIri: 'https://example.org/view/1#node-1', requestUpdate: vi.fn() });
        ctx._onPropertyChange({ predicate: SKOS_PREF_LABEL, label: 'Text', value: 'See also', readonly: false, language: 'en', ...entry }, value);
        return ctx.dispatchEvent.mock.calls.map((call: [CustomEvent]) => [call[0].type, call[0].detail.value, call[0].detail.previous]);
      };
      // A note's, a group's or a shape's text: taken away — nothing drawn.
      expect(changed({ emptied: 'removed' })).toEqual([['property-remove', 'See also', undefined]]);
      // A view reference's own text: written empty, in place of the one it had — an empty one too.
      expect(changed({ emptied: 'blank' })).toEqual([['property-edit', '', 'See also']]);
      expect(changed({ emptied: 'blank', value: '' }, 'Read next')).toEqual([['property-edit', 'Read next', '']]);
      // Its view's name, shown greyed with none of its own: unchanged, no edit; emptied or typed over, its own.
      const inherited = { emptied: 'blank' as const, value: 'Payments', inherited: true, language: undefined };
      expect(changed(inherited, 'Payments')).toEqual([]);
      expect(changed(inherited)).toEqual([['property-edit', '', undefined]]);
      expect(changed(inherited, 'Pay')).toEqual([['property-edit', 'Pay', undefined]]);
      // A name is not emptied.
      expect(changed({})).toEqual([]);
    });

    it('shows the view a selected reference stands for — its information, tabs and properties — with the reference’s Text and Opens (VC-1)', () => {
      const view = 'https://example.org/view/2';
      const node = 'https://example.org/view/1#node-1';
      const views = [{ iri: view, label: 'Payments', kind: 'Diagram' as const }];
      const viewHeading = (reference: Record<string, unknown>) => ({ kind: 'View', typeLabel: 'Diagram', reference: { nodeIri: node, viewIri: view, viewLabel: 'Payments', views, ...reference } });
      const entries = [{ predicate: SKOS_PREF_LABEL, label: 'Name', value: 'Payments', readonly: false, language: 'en' }];
      const shown = renderPanel({ selectedIri: view, _entries: entries, heading: viewHeading({}), analysis: ANALYSIS });
      expect(shown).toContain('View information');
      expect(shown).toContain('Analysis');
      expect(shown).toContain('Appears in views');
      expect(shown).toContain('Opens');
      // Its Text: the view's name, greyed, with none of its own.
      expect(shown).toContain('class="property-value inherited"');
      // Typed in its Text, the reference's own — not the view's name, edited above it.
      const ctx = makeCtx({ selectedIri: view, _entries: entries, heading: viewHeading({ text: 'See also', textLanguage: 'en' }), requestUpdate: vi.fn() });
      const edits = (entry: Partial<PropertyEntry>, value: string) => {
        ctx.dispatchEvent.mockClear();
        ctx._onPropertyChange({ predicate: SKOS_PREF_LABEL, label: 'Text', readonly: false, emptied: 'blank', ...entry }, value);
        return ctx.dispatchEvent.mock.calls.map((call: [CustomEvent]) => [call[0].type, call[0].detail.elementIri, call[0].detail.value, call[0].detail.previous]);
      };
      expect(edits({ subject: node, value: 'See also', language: 'en' }, 'Read next')).toEqual([['property-edit', node, 'Read next', 'See also']]);
      expect(edits({ subject: node, value: 'See also', language: 'en' }, '')).toEqual([['property-edit', node, '', 'See also']]);
      expect(edits({ subject: node, value: '', language: 'en' }, 'Back')).toEqual([['property-edit', node, 'Back', '']]);
      // Its view's name with none of its own: unchanged, no edit.
      expect(edits({ subject: node, value: 'Payments', inherited: true }, 'Payments')).toEqual([]);
      // × takes its own away, from the reference.
      ctx.dispatchEvent.mockClear();
      ctx._remove({ predicate: SKOS_PREF_LABEL, label: 'Text', value: 'See also', readonly: false, subject: node });
      expect(ctx.dispatchEvent.mock.calls.map((call: [CustomEvent]) => [call[0].type, call[0].detail.elementIri])).toEqual([['property-remove', node]]);
      // A view selected otherwise — in the tree — shows no reference's rows.
      expect(renderPanel({ selectedIri: view, _entries: entries, heading: { kind: 'View' }, analysis: ANALYSIS })).not.toContain('Opens');
    });

    it('lists the views referencing a view — Referenced from, each opening it — and nothing with none (VR-11)', () => {
      const view = 'https://example.org/view/2';
      const ctx = makeCtx({
        selectedIri: view,
        heading: { kind: 'View', referencedFrom: [{ iri: 'https://example.org/view/1', label: 'Index' }] },
      });
      const shown = flat((PropertyPanel.prototype as any).render.call(ctx));
      expect(shown).toContain('Referenced from');
      expect(shown).toContain('>Index</a');
      expect(renderPanel({ selectedIri: view, heading: { kind: 'View' } })).not.toContain('Referenced from');
      expect(renderPanel({ selectedIri: view, heading: { kind: 'View', referencedFrom: [] } })).not.toContain('Referenced from');
    });

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
      expect(at('>ID<')).toBeLessThan(at('>Type<'));
      expect(o).not.toContain('>Cost<');
    });

    it('shows the open tab’s pane only', () => {
      const o = renderPanel({
        selectedIri: 'https://example.org/elem1',
        _entries: TABBED,
        analysis: ANALYSIS,
        _tab: 'properties',
      });
      expect(o).toContain('>Cost<');
      expect(o).toContain('>Owner<');
      expect(o).toContain('Add');
      expect(o).not.toContain('>ID<');
      const views = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: TABBED, analysis: ANALYSIS, _tab: 'views' });
      expect(views).toContain('Main');
      expect(views).not.toContain('>Cost<');
    });

    it('leaves a drawn relationship\u2019s direct statement to the Analysis tab, and lists any other link as a property', () => {
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const AD = 'https://meta.linked.archi/arch-decision#';
      const entries: PropertyEntry[] = [
        ...TABBED,
        { predicate: AM4 + 'serves', label: 'Serves', value: 'urn:e2', valueLabel: 'Clerk', readonly: true, isIri: true, custom: true, drawn: true },
        // To another concept, but drawn by no relationship class: a property.
        { predicate: AD + 'relatedDecision', label: 'Related decision', value: 'urn:d2', valueLabel: 'Hosting', isIri: true, custom: true },
      ];
      const analysis = {
        relationships: [{ iri: 'urn:r1', direction: 'out' as const, typeLabel: 'Serving', otherIri: 'urn:e2', otherLabel: 'Clerk' }],
        views: [],
      };
      const properties = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: entries, _tab: 'properties', analysis });
      expect(properties).toMatch(/Properties<\/span>\s*<span class="count">3</);
      expect(properties).toContain('>Related decision<');
      expect(properties).not.toContain('>Clerk</button>');
      expect(properties).not.toContain('Relationships <span');
      const listed = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: entries, _tab: 'analysis', analysis });
      expect(listed).toMatch(/Analysis<\/span>\s*<span class="count">1</);
      expect(listed).toContain('>Serving</a>');
    });

    it('falls back to the information tab when the remembered one does not apply', () => {
      // No analysis (a model): no analysis or views tab.
      const o = renderPanel({ selectedIri: 'https://example.org/m', _entries: TABBED, _tab: 'views' });
      expect(o).not.toContain('Appears in views');
      expect(o).toContain('>ID<');
    });

    it('shows names, not IRIs — the ID by its short identifier, a link by its name — and the IRIs on a click', () => {
      const MODEL = 'https://example.org/m/model';
      const entries: PropertyEntry[] = [
        ...TABBED.slice(0, 1),
        { predicate: NAMESPACES.arch + 'inModel', label: 'Model', value: MODEL, valueLabel: 'Shop', readonly: true, isIri: true },
        ...TABBED.slice(1, 2),
      ];
      const ctx = makeCtx({ selectedIri: 'https://example.org/m/element-web', _entries: entries });
      const render = () => flat((PropertyPanel.prototype as any).render.call(ctx));
      const shown = render();
      expect(shown).toContain('>element-web</button>');
      expect(shown).toContain('>Shop</button>');
      expect(shown).toContain('>BP</button>');
      expect(shown).not.toContain(MODEL);
      expect(shown).not.toContain('https://example.org/m/element-web');

      // The link's row: the property's IRI and the value's; the ID: the concept's IRI.
      ctx._toggleIris(`${NAMESPACES.arch}inModel ${MODEL}`);
      ctx._toggleIris('id');
      const opened = render();
      expect(opened).toContain(`<dd>${NAMESPACES.arch}inModel</dd>`);
      expect(opened).toContain(`<dd>${MODEL}</dd>`);
      expect(opened).toContain('<dd>https://example.org/m/element-web</dd>');
      expect(opened).not.toContain(`<dd>${RDF_TYPE}</dd>`);
      // A second click hides them.
      ctx._toggleIris('id');
      expect(render()).not.toContain('<dd>https://example.org/m/element-web</dd>');
    });

    it('names a value’s language when it is not English, the language names are read in', () => {
      const entries: PropertyEntry[] = [
        { predicate: SKOS_PREF_LABEL, label: 'Name', value: 'Clerk', readonly: false, language: 'en' },
        { predicate: SKOS_PREF_LABEL, label: 'Name', value: 'Sachbearbeiter', readonly: false, language: 'de' },
      ];
      const o = renderPanel({ selectedIri: 'https://example.org/elem1', _entries: entries });
      expect(o).toContain('>German<');
      expect(o).not.toContain('English');
      expect(o).not.toContain('@en');
    });

    it('picks the value of a link from the model’s concepts, by name; text stays a text field', () => {
      const SEE_ALSO = NAMESPACES.rdfs + 'seeAlso';
      const catalog = { suggest: () => [], resolve: () => undefined, takesLinks: (iri: string) => iri === SEE_ALSO };
      const add = (picked: string) =>
        renderPanel({ selectedIri: 'https://example.org/elem1', _entries: TABBED, _tab: 'properties', catalog, _pickedPredicate: picked });
      expect(add(SEE_ALSO)).toContain('<named-picker');
      expect(add(SEE_ALSO)).toContain('link-value');
      expect(add('https://example.org/owner')).not.toContain('link-value');
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

    it('leaves out the qualified predicate to each relationship: Analysis lists them', () => {
      const iri = 'https://example.org/elem1';
      const rel = 'https://example.org/rel1';
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const iriQuad = (s: string, p: string, o: string): Quad =>
        ({ ...makeQuad(s, p, o), object: { value: o, termType: 'NamedNode' } }) as unknown as Quad;
      const store = mockRdfStore([
        ...sampleQuads(iri),
        iriQuad(iri, NAMESPACES.arch + 'hasQualifiedRelationship', rel),
        iriQuad(iri, AM4 + 'qualifiedServing', rel),
        iriQuad(AM4 + 'qualifiedServing', NAMESPACES.arch + 'unqualifiedForm', AM4 + 'serves'),
        iriQuad(iri, AM4 + 'serves', 'https://example.org/elem2'),
      ]);
      const ctx: any = { selectedIri: iri, rdfStore: store, shapesGraph: undefined, _entries: [] };
      (PropertyPanel.prototype as any)._loadProperties.call(ctx);
      const predicates = ctx._entries.map((e: PropertyEntry) => e.predicate);
      expect(predicates).not.toContain(NAMESPACES.arch + 'hasQualifiedRelationship');
      expect(predicates).not.toContain(AM4 + 'qualifiedServing');
      expect(predicates).toContain(AM4 + 'serves');
    });

    it('leaves out the way in to a relationship whatever it is called, and marks a relationship\u2019s direct statement', () => {
      const iri = 'https://example.org/elem1';
      const rel = 'https://example.org/rel1';
      const AM3 = 'https://meta.linked.archi/archimate3/onto#';
      const iriQuad = (s: string, p: string, o: string): Quad =>
        ({ ...makeQuad(s, p, o), object: { value: o, termType: 'NamedNode' } }) as unknown as Quad;
      const quads = [
        ...sampleQuads(iri),
        // A converter's own name for the qualified predicate, which no loaded vocabulary declares.
        iriQuad(iri, AM3 + 'qualifiedAggregates', rel),
        iriQuad(rel, NAMESPACES.arch + 'source', iri),
        // A direct statement, and the relationship type that declares its predicate.
        iriQuad(iri, AM3 + 'serves', 'https://example.org/elem2'),
        iriQuad(AM3 + 'Serving', NAMESPACES.arch + 'unqualifiedForm', AM3 + 'serves'),
        iriQuad(iri, NAMESPACES.rdfs + 'seeAlso', 'https://example.org/page'),
      ];
      // A store that matches all three positions.
      const store = {
        ...mockRdfStore(quads),
        getQuads: vi.fn((s?: NamedNode | null, p?: NamedNode | null, o?: NamedNode | null) =>
          quads.filter((q) => (!s || q.subject.value === s.value) && (!p || q.predicate.value === p.value) && (!o || q.object.value === o.value)),
        ),
      } as unknown as RdfStore;
      const ctx: any = { selectedIri: iri, rdfStore: store, shapesGraph: undefined, _entries: [] };
      (PropertyPanel.prototype as any)._loadProperties.call(ctx);
      const byPredicate = new Map<string, PropertyEntry>(ctx._entries.map((e: PropertyEntry) => [e.predicate, e]));
      expect(byPredicate.has(AM3 + 'qualifiedAggregates')).toBe(false);
      expect(byPredicate.get(AM3 + 'serves')?.drawn).toBe(true);
      expect(byPredicate.get(NAMESPACES.rdfs + 'seeAlso')?.drawn).toBeUndefined();
    });

    it('keeps provenance out of the properties, and shows it read-only: when, by whom, with which la-gram (Req 9.16)', () => {
      const iri = 'https://example.org/elem1';
      const PROV = NAMESPACES.prov;
      const activity = 'https://example.org/provenance/a1';
      const ada = 'https://example.org/provenance/ada';
      const laGram = 'https://app.linked.archi/la-gram/v0.3.0';
      const iriQuad = (s: string, p: string, o: string): Quad =>
        ({ ...makeQuad(s, p, o), object: { value: o, termType: 'NamedNode' } }) as unknown as Quad;
      const quads = [
        ...sampleQuads(iri),
        iriQuad(iri, PROV + 'wasGeneratedBy', activity),
        makeQuad(iri, PROV + 'generatedAtTime', '2026-11-20T16:40:31Z'),
        iriQuad(iri, PROV + 'wasDerivedFrom', 'https://example.org/source/shop.xml'),
        iriQuad(activity, PROV + 'wasAssociatedWith', laGram),
        iriQuad(activity, PROV + 'wasAssociatedWith', ada),
        iriQuad(laGram, NAMESPACES.rdf + 'type', PROV + 'SoftwareAgent'),
        makeQuad(laGram, 'https://schema.org/name', 'la-gram'),
        makeQuad(laGram, 'https://schema.org/softwareVersion', '0.3.0'),
        iriQuad(ada, NAMESPACES.rdf + 'type', PROV + 'Person'),
        makeQuad(ada, 'https://schema.org/name', 'Ada'),
      ];
      const store = {
        ...mockRdfStore(quads),
        getQuads: vi.fn((s?: NamedNode | null, p?: NamedNode | null, o?: NamedNode | null) =>
          quads.filter((q) => (!s || q.subject.value === s.value) && (!p || q.predicate.value === p.value) && (!o || q.object.value === o.value)),
        ),
      } as unknown as RdfStore;
      const ctx: any = { selectedIri: iri, rdfStore: store, shapesGraph: undefined, _entries: [] };
      (PropertyPanel.prototype as any)._loadProperties.call(ctx);
      expect(ctx._entries.some((e: PropertyEntry) => e.predicate.startsWith(PROV))).toBe(false);
      expect(ctx._provenance).toEqual({
        changed: { at: '2026-11-20T16:40:31Z', by: 'Ada', tool: 'la-gram 0.3.0' },
        other: [{ predicate: PROV + 'wasDerivedFrom', value: 'https://example.org/source/shop.xml' }],
      });
      // Shown as text, never as a field to edit.
      // The template's text, its values in place (this file runs without a DOM).
      const textOf = (r: any): string =>
        r == null || typeof r === 'symbol'
          ? ''
          : Array.isArray(r)
            ? r.map(textOf).join('')
            : r.strings
              ? r.strings.map((s: string, i: number) => s + (i < r.values.length ? textOf(r.values[i]) : '')).join('')
              : String(r);
      const text = textOf((PropertyPanel.prototype as any)._renderProvenance.call(ctx));
      expect(text).toMatch(/data-provenance="changed"\s*>20 Nov 2026, \d\d:\d\d · by Ada · with la-gram 0\.3\.0</);
      expect(text).not.toMatch(/<input|<textarea|<select/);
      expect(text).toContain('https://example.org/source/shop.xml');
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
      expect(labelEntry?.minCount).toBe(1);
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

// ── Allowed values (sh:in) and booleans ──────────────────────────────────

describe('a property whose shape lists its values (sh:in), and a boolean', () => {
  const BS = 'https://meta.linked.archi/backstage/onto#';
  const RDF = NAMESPACES.rdf;
  const XSD_BOOLEAN = NAMESPACES.xsd + 'boolean';
  const iriQuad = (s: string, p: string, o: string): Quad =>
    ({ ...makeQuad(s, p, o), object: { value: o, termType: 'NamedNode' } }) as unknown as Quad;
  const boolQuad = (s: string, p: string, o: string): Quad =>
    ({ ...makeQuad(s, p, o), object: { value: o, termType: 'Literal', datatype: { value: XSD_BOOLEAN } } }) as unknown as Quad;

  /** Backstage's component shape: bs:lifecycleState from a list of states, bs:orphan a boolean. */
  const SHAPES: Quad[] = [
    iriQuad('_:shape', SH + 'targetClass', `${BS}Component`),
    iriQuad('_:shape', SH + 'property', '_:type'),
    iriQuad('_:type', SH + 'path', `${BS}lifecycleState`),
    makeQuad('_:type', SH + 'name', 'Lifecycle state'),
    iriQuad('_:type', SH + 'in', '_:l1'),
    iriQuad('_:l1', RDF + 'first', `${BS}Production`),
    iriQuad('_:l1', RDF + 'rest', '_:l2'),
    iriQuad('_:l2', RDF + 'first', `${BS}DeprecatedState`),
    iriQuad('_:l2', RDF + 'rest', RDF + 'nil'),
    iriQuad('_:shape', SH + 'property', '_:ext'),
    iriQuad('_:ext', SH + 'path', `${BS}orphan`),
    makeQuad('_:ext', SH + 'name', 'Orphan'),
    iriQuad('_:ext', SH + 'datatype', XSD_BOOLEAN),
  ];
  const DB = 'https://example.org/m/billing-service';

  it('reads the list in order', () => {
    const shapes = extractShaclShapes(SHAPES, `${BS}Component`);
    expect(shapes.find((s) => s.path === `${BS}lifecycleState`)?.in).toEqual([
      { value: `${BS}Production`, isIri: true },
      { value: `${BS}DeprecatedState`, isIri: true },
    ]);
  });

  it('makes a listed link a choice, labelled in words, rather than read-only', () => {
    const entries = buildPropertyEntries(
      [makeQuad(DB, RDF_TYPE, `${BS}Component`), iriQuad(DB, `${BS}lifecycleState`, `${BS}Production`)],
      extractShaclShapes(SHAPES, `${BS}Component`),
    );
    const entry = entries.find((e) => e.predicate === `${BS}lifecycleState`)!;
    expect(entry.readonly).toBe(false);
    expect(entry.choices?.map((c) => c.label)).toEqual(['Production', 'Deprecated State']);
    // A link without a list stays read-only.
    const other = buildPropertyEntries([iriQuad(DB, 'https://example.org/dependsOn', 'https://example.org/m/x')], []);
    expect(other.find((e) => e.predicate === 'https://example.org/dependsOn')!.readonly).toBe(true);
  });

  it('labels a choice by its name in the loaded data, else in words', () => {
    const names: Record<string, string> = { [`${BS}DeprecatedState`]: 'Deprecated (sunset)' };
    const entries = buildPropertyEntries(
      [iriQuad(DB, `${BS}lifecycleState`, `${BS}Production`)],
      extractShaclShapes(SHAPES, `${BS}Component`),
      (iri) => names[iri],
    );
    const entry = entries.find((e) => e.predicate === `${BS}lifecycleState`)!;
    expect(entry.choices?.map((c) => c.label)).toEqual(['Production', 'Deprecated (sunset)']);
  });

  it('saves a chosen value as the IRI it is, and a ticked box as true', () => {
    const elementManager = mockElementManager();
    const ctx: any = { selectedIri: DB, elementManager, dispatchEvent: vi.fn(), requestUpdate: vi.fn(), _loadProperties: vi.fn() };
    const change = (PropertyPanel.prototype as any)._onPropertyChange.bind(ctx);
    const [typeEntry, externalEntry] = [`${BS}lifecycleState`, `${BS}orphan`].map(
      (p) =>
        buildPropertyEntries(
          [iriQuad(DB, `${BS}lifecycleState`, `${BS}Production`), boolQuad(DB, `${BS}orphan`, 'false')],
          extractShaclShapes(SHAPES, `${BS}Component`),
        ).find((e) => e.predicate === p)!,
    );
    change(typeEntry, `${BS}DeprecatedState`);
    change(externalEntry, 'true');
    const calls = (elementManager.updateProperty as any).mock.calls;
    expect(calls[0][2]).toMatchObject({ termType: 'NamedNode', value: `${BS}DeprecatedState` });
    expect(calls[1][2]).toMatchObject({ termType: 'Literal', value: 'true', datatype: { value: XSD_BOOLEAN } });
  });

  it('adds a link’s value as the IRI picked, and typed text as text', () => {
    const added: any[] = [];
    const add = (choice: { iri: string; label: string; text?: boolean }) => {
      const ctx: any = {
        selectedIri: DB,
        _shapes: new Map(),
        _newValue: '',
        _picker: { value: { iri: NAMESPACES.rdfs + 'seeAlso' }, clear: vi.fn(), focus: vi.fn() },
        _linkPicker: { choice, clear: vi.fn() },
        _emit: (_name: string, detail: unknown) => added.push(detail),
      };
      (PropertyPanel.prototype as any)._add.call(ctx);
      expect(ctx._linkPicker.clear).toHaveBeenCalled();
    };
    add({ iri: 'https://example.org/m/element-clerk', label: 'Clerk' });
    add({ iri: 'see the wiki', label: 'see the wiki', text: true });
    expect(added[0]).toMatchObject({ value: 'https://example.org/m/element-clerk', isIri: true });
    expect(added[1]).toMatchObject({ value: 'see the wiki' });
    expect(added[1].isIri).toBeUndefined();
  });

  it('adds a value the way its shape says: a chosen IRI, or a literal of its datatype', () => {
    const shapes = new Map(extractShaclShapes(SHAPES, `${BS}Component`).map((s) => [s.path, s]));
    const added: any[] = [];
    const add = (predicate: string, value: string) => {
      const ctx: any = {
        selectedIri: DB,
        _shapes: shapes,
        _newValue: value,
        _picker: { value: { iri: predicate }, clear: vi.fn(), focus: vi.fn() },
        _emit: (_name: string, detail: unknown) => added.push(detail),
      };
      (PropertyPanel.prototype as any)._add.call(ctx);
    };
    add(`${BS}lifecycleState`, `${BS}Production`);
    add(`${BS}orphan`, 'true');
    expect(added[0]).toMatchObject({ predicate: `${BS}lifecycleState`, value: `${BS}Production`, isIri: true });
    expect(added[1]).toMatchObject({ predicate: `${BS}orphan`, value: 'true', datatype: XSD_BOOLEAN });
    expect(added[1].isIri).toBeUndefined();
  });
});
