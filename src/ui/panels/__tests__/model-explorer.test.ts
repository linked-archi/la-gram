import { describe, it, expect, vi } from 'vitest';
import type { Quad, NamedNode } from '@rdfjs/types';
import type { RdfStore } from '../../../rdf-engine/interfaces.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';
import {
  ModelExplorer,
  buildTree,
  filterTree,
  iriFragment,
  type TreeNode,
  type ExplorerSelectDetail,
} from '../model-explorer.js';
import { EventBus } from '../../event-bus.js';

// ── Helpers ─────────────────────────────────────────────────────────────

const RDF_TYPE = NAMESPACES.rdf + 'type';
const SKOS_PREF_LABEL = NAMESPACES.skos + 'prefLabel';
const ARCH_FOLDER = NAMESPACES.arch + 'Folder';
const ARCH_CONTAINS = NAMESPACES.arch + 'contains';
const ARCH_ELEMENT = NAMESPACES.arch + 'Element';

function nn(value: string): NamedNode {
  return { value, termType: 'NamedNode' } as NamedNode;
}

function lit(value: string) {
  return { value, termType: 'Literal' } as any;
}

function makeQuad(s: string, p: string, o: string): Quad {
  return {
    subject: nn(s),
    predicate: nn(p),
    object: p === SKOS_PREF_LABEL ? lit(o) : nn(o),
    graph: { value: '', termType: 'DefaultGraph' },
  } as Quad;
}

function mockRdfStore(quads: Quad[]): RdfStore {
  return {
    addQuads: vi.fn(),
    removeQuads: vi.fn(),
    getQuads: vi.fn(() => quads),
    query: vi.fn(),
    update: vi.fn(),
  } as unknown as RdfStore;
}

// ── Sample data ─────────────────────────────────────────────────────────

function sampleQuads(): Quad[] {
  return [
    // Folder
    makeQuad('ex:folder1', RDF_TYPE, ARCH_FOLDER),
    makeQuad('ex:folder1', SKOS_PREF_LABEL, 'Business Layer'),
    // Elements in folder
    makeQuad('ex:elem1', RDF_TYPE, NAMESPACES.arch + 'BusinessProcess'),
    makeQuad('ex:elem1', SKOS_PREF_LABEL, 'Order Processing'),
    makeQuad('ex:elem2', RDF_TYPE, NAMESPACES.arch + 'BusinessActor'),
    makeQuad('ex:elem2', SKOS_PREF_LABEL, 'Customer'),
    // Containment
    makeQuad('ex:folder1', ARCH_CONTAINS, 'ex:elem1'),
    makeQuad('ex:folder1', ARCH_CONTAINS, 'ex:elem2'),
    // Root-level element (not in any folder)
    makeQuad('ex:elem3', RDF_TYPE, NAMESPACES.arch + 'ApplicationComponent'),
    makeQuad('ex:elem3', SKOS_PREF_LABEL, 'CRM System'),
  ];
}

// ── iriFragment ─────────────────────────────────────────────────────────

describe('iriFragment', () => {
  it('extracts fragment after #', () => {
    expect(iriFragment('https://example.org/ontology#Element')).toBe('Element');
  });

  it('extracts last path segment after /', () => {
    expect(iriFragment('https://example.org/ontology/Element')).toBe('Element');
  });

  it('returns full string when no # or /', () => {
    expect(iriFragment('Element')).toBe('Element');
  });

  it('prefers # over /', () => {
    expect(iriFragment('https://example.org/path#Fragment')).toBe('Fragment');
  });
});

// ── buildTree ───────────────────────────────────────────────────────────

describe('buildTree', () => {
  it('builds tree from quads with folder containment', () => {
    const tree = buildTree(sampleQuads());
    // Root should have folder + root-level element
    expect(tree.length).toBe(2);
  });

  it('places folder before non-folder at root', () => {
    const tree = buildTree(sampleQuads());
    expect(tree[0].isFolder).toBe(true);
    expect(tree[0].label).toBe('Business Layer');
  });

  it('nests contained elements under folder', () => {
    const tree = buildTree(sampleQuads());
    const folder = tree.find((n) => n.isFolder)!;
    expect(folder.children.length).toBe(2);
    const labels = folder.children.map((c) => c.label);
    expect(labels).toContain('Order Processing');
    expect(labels).toContain('Customer');
  });

  it('root-level element has no children', () => {
    const tree = buildTree(sampleQuads());
    const rootElem = tree.find((n) => !n.isFolder)!;
    expect(rootElem.label).toBe('CRM System');
    expect(rootElem.children.length).toBe(0);
  });

  it('sets typeName from type IRI fragment', () => {
    const tree = buildTree(sampleQuads());
    const rootElem = tree.find((n) => n.label === 'CRM System')!;
    expect(rootElem.typeName).toBe('ApplicationComponent');
  });

  it('returns empty array for empty quads', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('uses IRI fragment as label when skos:prefLabel is missing', () => {
    const quads = [makeQuad('https://example.org/model#noLabel', RDF_TYPE, ARCH_ELEMENT)];
    const tree = buildTree(quads);
    expect(tree[0].label).toBe('noLabel');
  });

  it('sorts children alphabetically within folders', () => {
    const tree = buildTree(sampleQuads());
    const folder = tree.find((n) => n.isFolder)!;
    // Customer < Order Processing alphabetically
    expect(folder.children[0].label).toBe('Customer');
    expect(folder.children[1].label).toBe('Order Processing');
  });

  it('handles nested folders', () => {
    const quads = [
      makeQuad('ex:root', RDF_TYPE, ARCH_FOLDER),
      makeQuad('ex:root', SKOS_PREF_LABEL, 'Root'),
      makeQuad('ex:sub', RDF_TYPE, ARCH_FOLDER),
      makeQuad('ex:sub', SKOS_PREF_LABEL, 'Sub'),
      makeQuad('ex:root', ARCH_CONTAINS, 'ex:sub'),
      makeQuad('ex:elem', RDF_TYPE, ARCH_ELEMENT),
      makeQuad('ex:elem', SKOS_PREF_LABEL, 'Leaf'),
      makeQuad('ex:sub', ARCH_CONTAINS, 'ex:elem'),
    ];
    const tree = buildTree(quads);
    expect(tree.length).toBe(1);
    expect(tree[0].label).toBe('Root');
    expect(tree[0].children.length).toBe(1);
    expect(tree[0].children[0].label).toBe('Sub');
    expect(tree[0].children[0].children.length).toBe(1);
    expect(tree[0].children[0].children[0].label).toBe('Leaf');
  });
});

// ── filterTree ──────────────────────────────────────────────────────────

describe('filterTree', () => {
  it('returns all nodes when query is empty', () => {
    const tree = buildTree(sampleQuads());
    const filtered = filterTree(tree, '', sampleQuads());
    expect(filtered.length).toBe(tree.length);
  });

  it('filters by label (case-insensitive)', () => {
    const tree = buildTree(sampleQuads());
    const filtered = filterTree(tree, 'customer', sampleQuads());
    // Should include folder (because it contains Customer) and Customer
    const folder = filtered.find((n) => n.isFolder);
    expect(folder).toBeDefined();
    expect(folder!.children.length).toBe(1);
    expect(folder!.children[0].label).toBe('Customer');
  });

  it('filters by type name', () => {
    const tree = buildTree(sampleQuads());
    const filtered = filterTree(tree, 'ApplicationComponent', sampleQuads());
    expect(filtered.length).toBe(1);
    expect(filtered[0].label).toBe('CRM System');
  });

  it('includes parent folder when child matches', () => {
    const tree = buildTree(sampleQuads());
    const filtered = filterTree(tree, 'Order', sampleQuads());
    const folder = filtered.find((n) => n.isFolder);
    expect(folder).toBeDefined();
    expect(folder!.children.some((c) => c.label === 'Order Processing')).toBe(true);
  });

  it('returns empty when nothing matches', () => {
    const tree = buildTree(sampleQuads());
    const filtered = filterTree(tree, 'zzz_no_match', sampleQuads());
    expect(filtered.length).toBe(0);
  });

  it('filters by property value in quads', () => {
    const quads = [
      ...sampleQuads(),
      // Add a custom property to elem3
      makeQuad('ex:elem3', NAMESPACES.skos + 'definition', 'Manages customer relationships'),
    ];
    const tree = buildTree(quads);
    const filtered = filterTree(tree, 'relationships', quads);
    expect(filtered.some((n) => n.label === 'CRM System')).toBe(true);
  });

  it('whitespace-only query returns all nodes', () => {
    const tree = buildTree(sampleQuads());
    const filtered = filterTree(tree, '   ', sampleQuads());
    expect(filtered.length).toBe(tree.length);
  });
});

// ── ModelExplorer component ─────────────────────────────────────────────

describe('ModelExplorer', () => {
  it('exports the class', () => {
    expect(ModelExplorer).toBeDefined();
  });

  it('has static styles', () => {
    expect((ModelExplorer as any).styles).toBeDefined();
  });

  it('has render on prototype', () => {
    expect(typeof ModelExplorer.prototype.render).toBe('function');
  });

  describe('render template', () => {
    function makeCtx(overrides: Record<string, unknown> = {}) {
      const p = ModelExplorer.prototype as any;
      const quads = sampleQuads();
      const c: any = {
        rdfStore: mockRdfStore(quads),
        selectedIri: '',
        _tree: buildTree(quads),
        _filterQuery: '',
        _collapsedNodes: new Set<string>(),
        _allQuads: quads,
        dispatchEvent: vi.fn(),
        ...overrides,
      };
      for (const m of ['_renderNode', '_toggleNode', '_selectNode', '_onFilterInput']) {
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

    function renderPanel(overrides: Record<string, unknown> = {}): string {
      return flat((ModelExplorer.prototype as any).render.call(makeCtx(overrides)));
    }

    it('renders header', () => {
      expect(renderPanel()).toContain('Model Explorer');
    });

    it('renders filter input', () => {
      expect(renderPanel()).toContain('filter-input');
    });

    it('renders folder labels', () => {
      expect(renderPanel()).toContain('Business Layer');
    });

    it('renders element labels', () => {
      const o = renderPanel();
      expect(o).toContain('Order Processing');
      expect(o).toContain('Customer');
      expect(o).toContain('CRM System');
    });

    it('renders type names', () => {
      const o = renderPanel();
      expect(o).toContain('Folder');
      expect(o).toContain('BusinessProcess');
      expect(o).toContain('ApplicationComponent');
    });

    it('renders folder icon', () => {
      expect(renderPanel()).toContain('📁');
    });

    it('renders element icon', () => {
      expect(renderPanel()).toContain('📄');
    });

    it('shows empty message when no elements', () => {
      const o = renderPanel({ _tree: [], _allQuads: [] });
      expect(o).toContain('No elements found');
    });

    it('applies selected class to selected node', () => {
      const o = renderPanel({ selectedIri: 'ex:elem1' });
      expect(o).toContain('selected');
    });

    it('applies hidden class to collapsed children', () => {
      const o = renderPanel({ _collapsedNodes: new Set(['ex:folder1']) });
      expect(o).toContain('hidden');
    });

    it('filters tree when filterQuery is set', () => {
      const o = renderPanel({ _filterQuery: 'CRM' });
      expect(o).toContain('CRM System');
      expect(o).not.toContain('Order Processing');
    });
  });

  describe('event handling', () => {
    it('_selectNode dispatches explorer-select event', () => {
      const spy = vi.fn();
      const ctx = { selectedIri: '', dispatchEvent: spy };
      (ModelExplorer.prototype as any)._selectNode.call(ctx, 'ex:elem1');
      expect(ctx.selectedIri).toBe('ex:elem1');
      const evt = spy.mock.calls[0][0] as CustomEvent<ExplorerSelectDetail>;
      expect(evt.type).toBe('explorer-select');
      expect(evt.detail.iri).toBe('ex:elem1');
      expect(evt.bubbles).toBe(true);
      expect(evt.composed).toBe(true);
    });

    it('_toggleNode adds IRI to collapsed set', () => {
      const ctx: any = { _collapsedNodes: new Set<string>() };
      (ModelExplorer.prototype as any)._toggleNode.call(ctx, 'ex:folder1');
      expect(ctx._collapsedNodes.has('ex:folder1')).toBe(true);
    });

    it('_toggleNode removes IRI on second call', () => {
      const ctx: any = { _collapsedNodes: new Set(['ex:folder1']) };
      (ModelExplorer.prototype as any)._toggleNode.call(ctx, 'ex:folder1');
      expect(ctx._collapsedNodes.has('ex:folder1')).toBe(false);
    });

    it('_onFilterInput updates filter query', () => {
      const ctx: any = { _filterQuery: '' };
      const event = { target: { value: 'test' } };
      (ModelExplorer.prototype as any)._onFilterInput.call(ctx, event);
      expect(ctx._filterQuery).toBe('test');
    });
  });

  describe('EventBus integration', () => {
    it('subscribes to events on connect', () => {
      const bus = new EventBus();
      const ctx: any = {
        eventBus: bus,
        rdfStore: undefined,
        _tree: [],
        _allQuads: [],
        _eventHandler: () => {},
      };
      (ModelExplorer.prototype as any)._subscribeEvents.call(ctx);
      expect(bus.listenerCount('element-created')).toBe(1);
      expect(bus.listenerCount('element-deleted')).toBe(1);
      expect(bus.listenerCount('model-loaded')).toBe(1);
    });

    it('unsubscribes from events on disconnect', () => {
      const bus = new EventBus();
      const handler = () => {};
      const ctx: any = { eventBus: bus, _eventHandler: handler };
      (ModelExplorer.prototype as any)._subscribeEvents.call(ctx);
      (ModelExplorer.prototype as any)._unsubscribeEvents.call(ctx);
      expect(bus.listenerCount('element-created')).toBe(0);
      expect(bus.listenerCount('element-deleted')).toBe(0);
      expect(bus.listenerCount('model-loaded')).toBe(0);
    });

    it('rebuilds tree when event fires', () => {
      const bus = new EventBus();
      const quads = sampleQuads();
      const store = mockRdfStore(quads);
      let treeRebuilt = false;
      const ctx: any = {
        eventBus: bus,
        rdfStore: store,
        _tree: [],
        _allQuads: [],
        _eventHandler: () => { treeRebuilt = true; },
      };
      (ModelExplorer.prototype as any)._subscribeEvents.call(ctx);
      bus.emit('element-created');
      expect(treeRebuilt).toBe(true);
    });

    it('does not throw when eventBus is undefined', () => {
      const ctx: any = { eventBus: undefined, _eventHandler: () => {} };
      expect(() => (ModelExplorer.prototype as any)._subscribeEvents.call(ctx)).not.toThrow();
      expect(() => (ModelExplorer.prototype as any)._unsubscribeEvents.call(ctx)).not.toThrow();
    });
  });

  describe('_rebuildTree', () => {
    it('builds tree from rdfStore quads', () => {
      const quads = sampleQuads();
      const ctx: any = { rdfStore: mockRdfStore(quads), _tree: [], _allQuads: [] };
      (ModelExplorer.prototype as any)._rebuildTree.call(ctx);
      expect(ctx._tree.length).toBeGreaterThan(0);
      expect(ctx._allQuads.length).toBe(quads.length);
    });

    it('clears tree when rdfStore is undefined', () => {
      const ctx: any = { rdfStore: undefined, _tree: [{ iri: 'x' }], _allQuads: [{}] };
      (ModelExplorer.prototype as any)._rebuildTree.call(ctx);
      expect(ctx._tree).toEqual([]);
      expect(ctx._allQuads).toEqual([]);
    });
  });
});
