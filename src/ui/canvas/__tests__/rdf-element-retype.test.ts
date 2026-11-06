import { describe, it, expect, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { ObservableRdfStore } from '../../../rdf-engine/observable-store.js';
import { RetypeElementHandler, type RetypeElementContext } from '../rdf-element-retype.js';
import {
  RdfElementReplaceMenuProvider,
  ELEMENT_TYPE_ENTRY_CLASS_CURRENT,
  elementTypeEntryId,
} from '../rdf-element-replace-menu-provider.js';
import { RdfContextPadProvider } from '../rdf-context-pad-provider.js';
import { RdfContextMenuProvider, CONTEXT_MENU_ENTRY_CLASS } from '../rdf-context-menu-provider.js';
import type { ElementGroup } from '../../../metamodel-manager/interfaces.js';

const { namedNode, quad } = DataFactory;
const L = 'https://example.org/lang#';
const IRI = 'https://example.org/m/element-1';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

const GROUPS: ElementGroup[] = [
  { category: 'Business', elements: [{ iri: L + 'Actor', label: 'Actor' }, { iri: L + 'Role', label: 'Role' }] },
  { category: 'Application', elements: [{ iri: L + 'Component', label: 'Component', definition: 'A software unit.' }] },
];

describe('the element type menu', () => {
  const retype = vi.fn();
  const provider = new RdfElementReplaceMenuProvider(
    (target) => (target === 'shape' ? { shapeId: 'shape-1', currentTypeIri: L + 'Actor' } : undefined),
    () => GROUPS,
    retype,
  );

  it('offers every loaded element type under its palette group, the current one marked', () => {
    const entries = provider.getPopupMenuEntries('shape') as Record<string, { label: string; className: string; group: { name: string }; action: () => void }>;
    expect(Object.values(entries).map((e) => [e.group.name, e.label])).toEqual([
      ['Business', 'Actor'],
      ['Business', 'Role'],
      ['Application', 'Component'],
    ]);
    expect(entries[elementTypeEntryId(L + 'Actor')]!.className).toContain(ELEMENT_TYPE_ENTRY_CLASS_CURRENT);
    entries[elementTypeEntryId(L + 'Actor')]!.action();
    expect(retype).not.toHaveBeenCalled();
    entries[elementTypeEntryId(L + 'Component')]!.action();
    expect(retype).toHaveBeenCalledWith('shape-1', L + 'Component');
  });

  it('is empty for anything else, or when there is no other type', () => {
    expect(provider.getPopupMenuEntries('connection')).toEqual({});
    const lone = new RdfElementReplaceMenuProvider(
      () => ({ shapeId: 's', currentTypeIri: L + 'Actor' }),
      () => [{ category: 'Business', elements: [{ iri: L + 'Actor', label: 'Actor' }] }],
      vi.fn(),
    );
    expect(lone.getPopupMenuEntries('shape')).toEqual({});
    expect(lone.getPopupMenuHeaderEntries('shape')).toEqual([]);
  });

  it('shows the IRIs of types that share a name, and every IRI behind the header’s switch', () => {
    // Node's own localStorage stub is not a working one: remembered choices go here.
    const remembered = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => remembered.get(key) ?? null,
      setItem: (key: string, value: string) => void remembered.set(key, value),
      removeItem: (key: string) => void remembered.delete(key),
    });
    try {
      const AM3 = 'https://meta.linked.archi/archimate3/onto#';
      const AM4 = 'https://meta.linked.archi/archimate4/onto#';
      const refresh = vi.fn();
      const menu = new RdfElementReplaceMenuProvider(
        (target) => (target === 'shape' ? { shapeId: 's', currentTypeIri: AM4 + 'BusinessActor' } : undefined),
        () => [
          { category: 'Business', elements: [{ iri: AM4 + 'BusinessActor', label: 'Business Actor' }, { iri: AM4 + 'BusinessRole', label: 'Business Role' }] },
          { category: 'Other', elements: [{ iri: AM3 + 'BusinessActor', label: 'Business Actor' }] },
        ],
        vi.fn(),
        refresh,
      );
      const lines = () =>
        Object.values(menu.getPopupMenuEntries('shape') as Record<string, { label: string; description?: string }>).map((e) => [e.label, e.description]);

      expect(lines()).toEqual([
        ['Business Actor', `${AM4}BusinessActor`],
        ['Business Role', undefined],
        ['Business Actor', `${AM3}BusinessActor`],
      ]);
      const [toggle] = menu.getPopupMenuHeaderEntries('shape');
      expect(toggle).toMatchObject({ label: 'Show IRIs', active: false });

      toggle!.action();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(remembered.get('la-gram:picker-show-iris')).toBe('true');
      expect(lines()[1]).toEqual(['Business Role', `${AM4}BusinessRole`]);
      expect(menu.getPopupMenuHeaderEntries('shape')[0]!.active).toBe(true);
      expect(menu.getPopupMenuHeaderEntries('connection')).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the context pad', () => {
  it('leaves an element\u2019s type to the property panel and the right-click menu', () => {
    const pad = new RdfContextPadProvider({} as never, { getValidRelationships: () => [] } as never, { elementGroups: GROUPS, relationshipTypes: [] } as never);
    expect(pad.getContextPadEntries({ iri: IRI, typeIri: L + 'Actor', kind: 'element' })['replace']).toBeUndefined();
  });
});

describe('the right-click menu', () => {
  it('lays out the canvas\u2019s actions in sections, with shortcuts in the tooltip', () => {
    const rename = vi.fn();
    const provider = new RdfContextMenuProvider((target) =>
      target === 'shape'
        ? [
            { id: 'rename', label: 'Rename', section: 'edit', shortcut: 'F2', run: rename },
            { id: 'delete', label: 'Delete from view', section: 'delete', run: vi.fn() },
          ]
        : [],
    );
    const entries = provider.getPopupMenuEntries('shape') as Record<string, { label: string; className: string; group: string; title: string; action: () => void }>;
    expect(Object.entries(entries).map(([id, e]) => [id, e.label, e.group, e.title])).toEqual([
      ['rename', 'Rename', 'edit', 'Rename (F2)'],
      ['delete', 'Delete from view', 'delete', 'Delete from view'],
    ]);
    expect(entries['rename']!.className).toBe(`${CONTEXT_MENU_ENTRY_CLASS} la-context-rename`);
    entries['rename']!.action();
    expect(rename).toHaveBeenCalled();
    expect(provider.getPopupMenuEntries('root')).toEqual({});
  });

  it('closes before an entry runs — whatever it does, and so another menu it opens stays', () => {
    const order: string[] = [];
    const provider = new RdfContextMenuProvider(
      () => [{ id: 'select-all', label: 'Select all', section: 'view', run: () => order.push('run') }],
      () => order.push('close'),
    );
    (provider.getPopupMenuEntries('root') as Record<string, { action: () => void }>)['select-all']!.action();
    expect(order).toEqual(['close', 'run']);
  });
});

describe('RetypeElementHandler', () => {
  it('changes the type in the model and on the shape; undo restores both, redo replays', () => {
    const store = new ObservableRdfStore(new OxigraphRdfStore());
    store.addQuads([quad(namedNode(IRI), namedNode(RDF_TYPE), namedNode(L + 'Actor')) as unknown as Quad]);
    const types = () => store.getQuads(namedNode(IRI) as never, namedNode(RDF_TYPE) as never).map((q) => q.object.value);
    const shape = { businessObject: { iri: IRI, typeIri: L + 'Actor', kind: 'element' as const, label: 'Actor', iconUrl: 'actor.svg' } };
    const context: RetypeElementContext = {
      element: shape,
      typeIri: L + 'Component',
      iconUrl: 'component.svg',
      label: 'Component',
      apply: () => {
        store.removeQuads(store.getQuads(namedNode(IRI) as never, namedNode(RDF_TYPE) as never));
        store.addQuads([quad(namedNode(IRI), namedNode(RDF_TYPE), namedNode(L + 'Component')) as unknown as Quad]);
      },
    };
    const handler = new RetypeElementHandler(store);
    expect(handler.execute(context)).toEqual([shape]);
    expect(types()).toEqual([L + 'Component']);
    expect(shape.businessObject).toMatchObject({ typeIri: L + 'Component', iconUrl: 'component.svg', label: 'Component' });
    handler.revert(context);
    expect(types()).toEqual([L + 'Actor']);
    expect(shape.businessObject).toMatchObject({ typeIri: L + 'Actor', iconUrl: 'actor.svg', label: 'Actor' });
    handler.execute(context);
    expect(types()).toEqual([L + 'Component']);
  });
});
