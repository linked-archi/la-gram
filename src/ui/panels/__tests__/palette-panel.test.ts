import { describe, it, expect, vi } from 'vitest';
import type { PaletteDefinition, ViewpointInfo } from '../../../metamodel-manager/interfaces.js';
import { PalettePanel, type PaletteDragDetail } from '../palette-panel.js';

function testPalette(): PaletteDefinition {
  return {
    elementGroups: [
      { category: 'Business', elements: [
        { iri: 'arch:BP', label: 'Business Process', iconUrl: 'bp.svg', isAbstract: false },
        { iri: 'arch:BA', label: 'Business Actor', isAbstract: false },
        { iri: 'arch:AB', label: 'Abstract Business', isAbstract: true },
      ]},
      { category: 'Application', elements: [
        { iri: 'arch:AC', label: 'Application Component', iconUrl: 'ac.svg', isAbstract: false },
      ]},
    ],
    relationshipTypes: [
      { iri: 'arch:serves', label: 'Serves', iconUrl: 'serves.svg', domainTypes: ['arch:AC'], rangeTypes: ['arch:BP'] },
      { iri: 'arch:accesses', label: 'Accesses', domainTypes: [], rangeTypes: [] },
    ],
  };
}

function makeCtx(
  palette: PaletteDefinition,
  collapsed = new Set<string>(),
  activeViewpoint?: ViewpointInfo,
) {
  const p = PalettePanel.prototype as any;
  const c: any = { palette, _collapsedGroups: collapsed, activeViewpoint, dispatchEvent: vi.fn() };
  // Bind the _effectivePalette getter from the prototype
  Object.defineProperty(c, '_effectivePalette', Object.getOwnPropertyDescriptor(PalettePanel.prototype as any, '_effectivePalette')!);
  for (const m of ['_renderGroup','_renderElementItem','_renderRelationship','_toggleGroup','_onDragStart']) {
    c[m] = p[m].bind(c);
  }
  return c;
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

function rs(
  palette: PaletteDefinition,
  collapsed = new Set<string>(),
  activeViewpoint?: ViewpointInfo,
): string {
  return flat((PalettePanel.prototype as any).render.call(makeCtx(palette, collapsed, activeViewpoint)));
}

describe('PalettePanel', () => {
  it('exports the class', () => {
    expect(PalettePanel).toBeDefined();
  });

  it('has static styles', () => {
    expect((PalettePanel as any).styles).toBeDefined();
  });

  it('has render on prototype', () => {
    expect(typeof PalettePanel.prototype.render).toBe('function');
  });

  describe('render template', () => {
    it('renders group headers', () => {
      const o = rs(testPalette());
      expect(o).toContain('Business');
      expect(o).toContain('Application');
    });

    it('renders concrete labels', () => {
      const o = rs(testPalette());
      expect(o).toContain('Business Process');
      expect(o).toContain('Business Actor');
      expect(o).toContain('Application Component');
    });

    it('excludes abstract elements (5 palette-items)', () => {
      expect((rs(testPalette()).match(/palette-item/g) ?? []).length).toBe(5);
    });

    it('renders relationships section', () => {
      const o = rs(testPalette());
      expect(o).toContain('Relationships');
      expect(o).toContain('Serves');
      expect(o).toContain('Accesses');
    });

    it('renders icons', () => {
      const o = rs(testPalette());
      expect(o).toContain('bp.svg');
      expect(o).toContain('ac.svg');
      expect(o).toContain('serves.svg');
    });

    it('omits rels section when empty', () => {
      expect(rs({ elementGroups: testPalette().elementGroups, relationshipTypes: [] })).not.toContain('Relationships');
    });

    it('empty palette shows header only', () => {
      const o = rs({ elementGroups: [], relationshipTypes: [] });
      expect(o).toContain('Palette');
      expect(o).not.toContain('palette-item');
    });

    it('skips all-abstract groups', () => {
      const p: PaletteDefinition = {
        elementGroups: [{ category: 'OnlyAbstract', elements: [{ iri: 'a:1', label: 'A1', isAbstract: true }] }],
        relationshipTypes: [],
      };
      expect(rs(p)).not.toContain('OnlyAbstract');
    });
  });

  describe('collapsing', () => {
    it('collapsed group has hidden class', () => {
      const o = rs(testPalette(), new Set(['Business']));
      expect(o).toContain('hidden');
      expect(o).toContain('collapsed');
    });

    it('non-collapsed has no hidden', () => {
      expect(rs(testPalette())).not.toContain('hidden');
    });

    it('toggle adds category', () => {
      const c: any = { _collapsedGroups: new Set<string>() };
      (PalettePanel.prototype as any)._toggleGroup.call(c, 'Biz');
      expect(c._collapsedGroups.has('Biz')).toBe(true);
    });

    it('toggle removes on second call', () => {
      const c: any = { _collapsedGroups: new Set(['Biz']) };
      (PalettePanel.prototype as any)._toggleGroup.call(c, 'Biz');
      expect(c._collapsedGroups.has('Biz')).toBe(false);
    });
  });

  describe('drag events', () => {
    it('dispatches palette-drag-start', () => {
      const spy = vi.fn();
      const setData = vi.fn();
      const detail: PaletteDragDetail = { iri: 'x', label: 'X', kind: 'element' };
      (PalettePanel.prototype as any)._onDragStart.call(
        { dispatchEvent: spy },
        { dataTransfer: { setData } },
        detail,
      );
      expect(setData).toHaveBeenCalledWith('application/json', JSON.stringify(detail));
      const evt = spy.mock.calls[0][0] as CustomEvent;
      expect(evt.type).toBe('palette-drag-start');
      expect(evt.detail).toEqual(detail);
      expect(evt.bubbles).toBe(true);
      expect(evt.composed).toBe(true);
    });

    it('handles null dataTransfer', () => {
      expect(() =>
        (PalettePanel.prototype as any)._onDragStart.call(
          { dispatchEvent: vi.fn() },
          { dataTransfer: null },
          { iri: 'x', label: 'x', kind: 'element' },
        ),
      ).not.toThrow();
    });

    it('element kind', () => {
      const spy = vi.fn();
      (PalettePanel.prototype as any)._onDragStart.call(
        { dispatchEvent: spy },
        { dataTransfer: { setData: vi.fn() } },
        { iri: 'a', label: 'a', kind: 'element' },
      );
      expect((spy.mock.calls[0][0] as CustomEvent).detail.kind).toBe('element');
    });

    it('relationship kind', () => {
      const spy = vi.fn();
      (PalettePanel.prototype as any)._onDragStart.call(
        { dispatchEvent: spy },
        { dataTransfer: { setData: vi.fn() } },
        { iri: 'r', label: 'r', kind: 'relationship' },
      );
      expect((spy.mock.calls[0][0] as CustomEvent).detail.kind).toBe('relationship');
    });
  });

  describe('viewpoint filtering', () => {
    const viewpoint: ViewpointInfo = {
      iri: 'vp:business',
      label: 'Business Viewpoint',
      permittedElements: ['arch:BP', 'arch:BA'],
      permittedRelationships: ['arch:serves'],
    };

    it('shows only permitted elements when viewpoint is active', () => {
      const o = rs(testPalette(), new Set(), viewpoint);
      expect(o).toContain('Business Process');
      expect(o).toContain('Business Actor');
      expect(o).not.toContain('Application Component');
    });

    it('shows only permitted relationships when viewpoint is active', () => {
      const o = rs(testPalette(), new Set(), viewpoint);
      expect(o).toContain('Serves');
      expect(o).not.toContain('Accesses');
    });

    it('hides entire group when no elements are permitted', () => {
      const o = rs(testPalette(), new Set(), viewpoint);
      expect(o).not.toContain('Application');
    });

    it('shows all types when no viewpoint is active', () => {
      const o = rs(testPalette(), new Set(), undefined);
      expect(o).toContain('Business Process');
      expect(o).toContain('Application Component');
      expect(o).toContain('Serves');
      expect(o).toContain('Accesses');
    });

    it('hides relationships section when none are permitted', () => {
      const vpNoRels: ViewpointInfo = {
        iri: 'vp:norels',
        label: 'No Rels',
        permittedElements: ['arch:BP'],
        permittedRelationships: [],
      };
      const o = rs(testPalette(), new Set(), vpNoRels);
      expect(o).not.toContain('Relationships');
    });

    it('empty result when viewpoint permits nothing', () => {
      const vpEmpty: ViewpointInfo = {
        iri: 'vp:empty',
        label: 'Empty',
        permittedElements: [],
        permittedRelationships: [],
      };
      const o = rs(testPalette(), new Set(), vpEmpty);
      expect(o).toContain('Palette');
      expect(o).not.toContain('palette-item');
    });
  });
});
