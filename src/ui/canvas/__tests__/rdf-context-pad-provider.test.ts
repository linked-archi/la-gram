import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RdfContextPadProvider, type ContextPadElement } from '../rdf-context-pad-provider.js';
import type { ElementManager, RelationshipManager } from '../../../model-manager/interfaces.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';

function createMockElementManager(): ElementManager {
  return {
    createElement: vi.fn(),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
}

function createMockRelationshipManager(): RelationshipManager {
  return {
    getValidRelationships: vi.fn(),
    createRelationship: vi.fn(),
    deleteRelationship: vi.fn(),
  };
}

function createTestPalette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Application',
        elements: [
          { iri: 'arch:AppComponent', label: 'Application Component', isAbstract: false },
          { iri: 'arch:AppService', label: 'Application Service', isAbstract: false },
        ],
      },
    ],
    relationshipTypes: [
      {
        iri: 'arch:serves',
        label: 'Serves',
        domainTypes: ['arch:AppComponent'],
        rangeTypes: ['arch:AppService'],
      },
    ],
  };
}

describe('RdfContextPadProvider', () => {
  let provider: RdfContextPadProvider;
  let elementManager: ElementManager;
  let relationshipManager: RelationshipManager;
  let palette: PaletteDefinition;
  let onStartConnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    elementManager = createMockElementManager();
    relationshipManager = createMockRelationshipManager();
    palette = createTestPalette();
    onStartConnect = vi.fn();
    provider = new RdfContextPadProvider(
      elementManager,
      relationshipManager,
      palette,
      onStartConnect,
    );
  });

  it('always includes delete action', () => {
    const element: ContextPadElement = { iri: 'ex:elem-1', typeIri: 'arch:AppService' };
    const entries = provider.getContextPadEntries(element);

    expect(entries['delete']).toBeDefined();
    expect(entries['delete'].title).toBe('Delete');
    expect(entries['delete'].group).toBe('edit');
  });

  it('delete action calls elementManager.deleteElement', () => {
    const element: ContextPadElement = { iri: 'ex:elem-1', typeIri: 'arch:AppService' };
    const entries = provider.getContextPadEntries(element);

    (entries['delete'].action as (event: unknown) => void)({});

    expect(elementManager.deleteElement).toHaveBeenCalledWith('ex:elem-1');
  });

  it('includes connect action when element type has outgoing relationships', () => {
    // arch:AppComponent is in domainTypes of arch:serves
    const element: ContextPadElement = { iri: 'ex:comp-1', typeIri: 'arch:AppComponent' };
    const entries = provider.getContextPadEntries(element);

    expect(entries['connect']).toBeDefined();
    expect(entries['connect'].title).toBe('Connect');
    expect(entries['connect'].group).toBe('connect');
  });

  it('does not include connect action when element type has no outgoing relationships', () => {
    // arch:AppService is NOT in domainTypes of any relationship
    const element: ContextPadElement = { iri: 'ex:svc-1', typeIri: 'arch:AppService' };
    const entries = provider.getContextPadEntries(element);

    expect(entries['connect']).toBeUndefined();
  });

  it('connect action is registered for both click and dragstart', () => {
    const element: ContextPadElement = { iri: 'ex:comp-1', typeIri: 'arch:AppComponent' };
    const entries = provider.getContextPadEntries(element);
    const action = entries['connect'].action as Record<string, unknown>;

    // diagram-js only turns a pad button into a connect drag when the entry
    // exposes `dragstart`; a bare callback is click-only.
    expect(typeof action['click']).toBe('function');
    expect(typeof action['dragstart']).toBe('function');
  });

  it('connect action calls onStartConnect with the triggering event', () => {
    const element: ContextPadElement = { iri: 'ex:comp-1', typeIri: 'arch:AppComponent' };
    const entries = provider.getContextPadEntries(element);
    const action = entries['connect'].action as {
      dragstart(event: unknown, target?: unknown, autoActivate?: boolean): void;
    };

    const event = { type: 'dragstart' };
    action.dragstart(event, undefined, false);

    expect(onStartConnect).toHaveBeenCalledWith(element, event, false);
  });

  it('updatePaletteDefinition changes connect availability', () => {
    // Initially arch:AppService has no outgoing relationships
    const svcElement: ContextPadElement = { iri: 'ex:svc-1', typeIri: 'arch:AppService' };
    let entries = provider.getContextPadEntries(svcElement);
    expect(entries['connect']).toBeUndefined();

    // Update palette so AppService now has outgoing relationships
    const newPalette: PaletteDefinition = {
      elementGroups: palette.elementGroups,
      relationshipTypes: [
        {
          iri: 'arch:triggers',
          label: 'Triggers',
          domainTypes: ['arch:AppService'],
          rangeTypes: ['arch:AppComponent'],
        },
      ],
    };
    provider.updatePaletteDefinition(newPalette);

    entries = provider.getContextPadEntries(svcElement);
    expect(entries['connect']).toBeDefined();
  });

  describe('the replace entry on a connection', () => {
    const connection: ContextPadElement = {
      iri: 'ex:rel-1',
      typeIri: 'arch:serves',
      kind: 'relationship',
      diagramElement: { id: 'connection-1' },
    };

    function withReplaceSupport(available: boolean): {
      provider: RdfContextPadProvider;
      opened: unknown[];
    } {
      const opened: unknown[] = [];
      return {
        provider: new RdfContextPadProvider(
          elementManager,
          relationshipManager,
          palette,
          onStartConnect,
          undefined,
          undefined,
          {
            isAvailable: () => available,
            open: (element, event) => opened.push({ element, event }),
          },
        ),
        opened,
      };
    }

    it('appears, named after the current type, when the menu has entries', () => {
      const { provider: withMenu } = withReplaceSupport(true);

      const entries = withMenu.getContextPadEntries(connection);

      expect(entries['replace'].title).toBe('Change relationship type: Serves');
      expect(entries['replace'].className).toBe('context-pad-replace');
      // A connection is never the source of a connection.
      expect(entries['connect']).toBeUndefined();
    });

    it('is absent when the menu is empty — bpmn-js\u2019s !popupMenu.isEmpty gate', () => {
      const { provider: withMenu } = withReplaceSupport(false);

      const entries = withMenu.getContextPadEntries(connection);

      expect(entries['replace']).toBeUndefined();
      expect(entries['delete']).toBeDefined();
    });

    it('triggering it opens the menu with the triggering event', () => {
      const { provider: withMenu, opened } = withReplaceSupport(true);
      const event = { x: 12, y: 34 };

      (withMenu.getContextPadEntries(connection)['replace'].action as (e: unknown) => void)(event);

      expect(opened).toEqual([{ element: expect.objectContaining({ iri: 'ex:rel-1' }), event }]);
    });

    it('falls back to the type IRI fragment when the palette does not declare it', () => {
      const { provider: withMenu } = withReplaceSupport(true);

      const entries = withMenu.getContextPadEntries({
        ...connection,
        typeIri: 'https://example.org/mm#Association',
      });

      expect(entries['replace'].title).toBe('Change relationship type: Association');
    });

    it('is absent altogether when no replace support is wired', () => {
      const entries = provider.getContextPadEntries(connection);

      expect(entries['replace']).toBeUndefined();
      expect(entries['delete']).toBeDefined();
    });
  });

  it('works without onStartConnect callback', () => {
    const providerNoCallback = new RdfContextPadProvider(
      elementManager,
      relationshipManager,
      palette,
    );
    const element: ContextPadElement = { iri: 'ex:comp-1', typeIri: 'arch:AppComponent' };
    const entries = providerNoCallback.getContextPadEntries(element);

    // Should not throw when connect action is invoked without callback
    const action = entries['connect'].action as { click(event: unknown): void };
    expect(() => action.click({})).not.toThrow();
  });
});
