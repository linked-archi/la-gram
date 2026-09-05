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

    entries['delete'].action({});

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

  it('connect action calls onStartConnect callback', () => {
    const element: ContextPadElement = { iri: 'ex:comp-1', typeIri: 'arch:AppComponent' };
    const entries = provider.getContextPadEntries(element);

    entries['connect'].action({});

    expect(onStartConnect).toHaveBeenCalledWith(element);
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

  it('works without onStartConnect callback', () => {
    const providerNoCallback = new RdfContextPadProvider(
      elementManager,
      relationshipManager,
      palette,
    );
    const element: ContextPadElement = { iri: 'ex:comp-1', typeIri: 'arch:AppComponent' };
    const entries = providerNoCallback.getContextPadEntries(element);

    // Should not throw when connect action is invoked without callback
    expect(() => entries['connect'].action({})).not.toThrow();
  });
});
