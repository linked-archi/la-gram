import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagramCanvas, type DiagramCanvasOptions } from '../diagram-canvas.js';
import { EventBus } from '../../event-bus.js';
import type { ElementManager, RelationshipManager, Bounds } from '../../../model-manager/interfaces.js';
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
    getValidRelationships: vi.fn().mockReturnValue([]),
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

function createMockContainer(): HTMLElement {
  return {
    querySelector: vi.fn().mockReturnValue(null),
    innerHTML: '',
  } as unknown as HTMLElement;
}

function createCanvas(overrides?: Partial<DiagramCanvasOptions>): {
  canvas: DiagramCanvas;
  eventBus: EventBus;
  elementManager: ElementManager;
  relationshipManager: RelationshipManager;
  container: HTMLElement;
} {
  const eventBus = new EventBus();
  const elementManager = createMockElementManager();
  const relationshipManager = createMockRelationshipManager();
  const container = createMockContainer();

  const options: DiagramCanvasOptions = {
    container,
    eventBus,
    elementManager,
    relationshipManager,
    paletteDefinition: createTestPalette(),
    modelIri: 'https://example.org/model/test',
    ...overrides,
  };

  const canvas = new DiagramCanvas(options);
  return { canvas, eventBus, elementManager, relationshipManager, container };
}

describe('DiagramCanvas', () => {
  it('initializes successfully', () => {
    const { canvas } = createCanvas();
    expect(canvas.isInitialized()).toBe(true);
  });

  it('exposes the container element', () => {
    const container = createMockContainer();
    const { canvas } = createCanvas({ container });
    expect(canvas.getContainer()).toBe(container);
  });

  it('initializes with custom modules', () => {
    const { canvas } = createCanvas();
    expect(canvas.paletteProvider).toBeDefined();
    expect(canvas.renderer).toBeDefined();
    expect(canvas.ruleProvider).toBeDefined();
    expect(canvas.contextPadProvider).toBeDefined();
  });

  describe('addElement', () => {
    it('adds an element to the canvas', () => {
      const { canvas } = createCanvas();
      const bounds: Bounds = { x: 100, y: 200, width: 130, height: 60 };

      canvas.addElement('ex:elem-1', 'arch:AppComponent', bounds, 'My Component');

      const element = canvas.getElement('ex:elem-1');
      expect(element).toBeDefined();
      expect(element!.iri).toBe('ex:elem-1');
      expect(element!.typeIri).toBe('arch:AppComponent');
      expect(element!.label).toBe('My Component');
      expect(element!.bounds).toEqual(bounds);
    });

    it('uses IRI fragment as default label', () => {
      const { canvas } = createCanvas();
      canvas.addElement('https://example.org/model/elem-1', 'arch:AppComponent', {
        x: 0, y: 0, width: 100, height: 50,
      });

      const element = canvas.getElement('https://example.org/model/elem-1');
      expect(element!.label).toBe('elem-1');
    });

    it('stores iconUrl when provided', () => {
      const { canvas } = createCanvas();
      canvas.addElement('ex:elem-1', 'arch:AppComponent', {
        x: 0, y: 0, width: 100, height: 50,
      }, 'Test', 'icon.svg');

      expect(canvas.getElement('ex:elem-1')!.iconUrl).toBe('icon.svg');
    });
  });

  describe('removeElement', () => {
    it('removes an element from the canvas', () => {
      const { canvas } = createCanvas();
      canvas.addElement('ex:elem-1', 'arch:A', { x: 0, y: 0, width: 100, height: 50 });
      canvas.removeElement('ex:elem-1');

      expect(canvas.getElement('ex:elem-1')).toBeUndefined();
    });

    it('removes relationships involving the deleted element', () => {
      const { canvas } = createCanvas();
      canvas.addElement('ex:src', 'arch:A', { x: 0, y: 0, width: 100, height: 50 });
      canvas.addElement('ex:tgt', 'arch:B', { x: 200, y: 0, width: 100, height: 50 });
      canvas.addRelationship('ex:src', 'ex:tgt', 'arch:serves');

      canvas.removeElement('ex:src');

      expect(canvas.getRelationships().size).toBe(0);
    });
  });

  describe('updateElement', () => {
    it('updates element label', () => {
      const { canvas } = createCanvas();
      canvas.addElement('ex:elem-1', 'arch:A', { x: 0, y: 0, width: 100, height: 50 }, 'Old');

      canvas.updateElement('ex:elem-1', { label: 'New' });

      expect(canvas.getElement('ex:elem-1')!.label).toBe('New');
    });

    it('updates element bounds', () => {
      const { canvas } = createCanvas();
      canvas.addElement('ex:elem-1', 'arch:A', { x: 0, y: 0, width: 100, height: 50 });

      const newBounds: Bounds = { x: 50, y: 75, width: 200, height: 100 };
      canvas.updateElement('ex:elem-1', { bounds: newBounds });

      expect(canvas.getElement('ex:elem-1')!.bounds).toEqual(newBounds);
    });

    it('does nothing for non-existent element', () => {
      const { canvas } = createCanvas();
      expect(() => canvas.updateElement('ex:nonexistent', { label: 'X' })).not.toThrow();
    });
  });

  describe('addRelationship', () => {
    it('adds a relationship to the canvas', () => {
      const { canvas } = createCanvas();
      canvas.addRelationship('ex:src', 'ex:tgt', 'arch:serves');

      const rels = canvas.getRelationships();
      expect(rels.size).toBe(1);
      const rel = rels.values().next().value!;
      expect(rel.sourceIri).toBe('ex:src');
      expect(rel.targetIri).toBe('ex:tgt');
      expect(rel.typeIri).toBe('arch:serves');
    });
  });

  describe('EventBus synchronization', () => {
    it('adds element on element-created event', () => {
      const { canvas, eventBus } = createCanvas();

      eventBus.emit('element-created', {
        iri: 'ex:new-elem',
        typeIri: 'arch:AppComponent',
        bounds: { x: 10, y: 20, width: 130, height: 60 },
        label: 'New Element',
      });

      expect(canvas.getElement('ex:new-elem')).toBeDefined();
      expect(canvas.getElement('ex:new-elem')!.label).toBe('New Element');
    });

    it('removes element on element-deleted event', () => {
      const { canvas, eventBus } = createCanvas();
      canvas.addElement('ex:elem-1', 'arch:A', { x: 0, y: 0, width: 100, height: 50 });

      eventBus.emit('element-deleted', { iri: 'ex:elem-1' });

      expect(canvas.getElement('ex:elem-1')).toBeUndefined();
    });

    it('updates element on element-updated event', () => {
      const { canvas, eventBus } = createCanvas();
      canvas.addElement('ex:elem-1', 'arch:A', { x: 0, y: 0, width: 100, height: 50 }, 'Old');

      eventBus.emit('element-updated', { iri: 'ex:elem-1', label: 'Updated' });

      expect(canvas.getElement('ex:elem-1')!.label).toBe('Updated');
    });

    it('adds relationship on relationship-created event', () => {
      const { canvas, eventBus } = createCanvas();

      eventBus.emit('relationship-created', {
        sourceIri: 'ex:src',
        targetIri: 'ex:tgt',
        typeIri: 'arch:serves',
      });

      expect(canvas.getRelationships().size).toBe(1);
    });

    it('removes relationship on relationship-deleted event', () => {
      const { canvas, eventBus } = createCanvas();
      canvas.addRelationship('ex:src', 'ex:tgt', 'arch:serves');

      eventBus.emit('relationship-deleted', {
        sourceIri: 'ex:src',
        targetIri: 'ex:tgt',
        typeIri: 'arch:serves',
      });

      expect(canvas.getRelationships().size).toBe(0);
    });

    it('ignores events with missing required fields', () => {
      const { canvas, eventBus } = createCanvas();

      // element-created without iri should be ignored
      eventBus.emit('element-created', { typeIri: 'arch:A' });
      expect(canvas.getElements().size).toBe(0);

      // element-deleted without iri should be ignored
      eventBus.emit('element-deleted', {});
      // No error thrown
    });
  });

  describe('updatePaletteDefinition', () => {
    it('updates palette on both providers', () => {
      const { canvas } = createCanvas();
      const newPalette: PaletteDefinition = {
        elementGroups: [],
        relationshipTypes: [],
      };

      canvas.updatePaletteDefinition(newPalette);

      // Verify palette provider was updated (empty entries)
      const entries = canvas.paletteProvider.getPaletteEntries();
      expect(Object.keys(entries)).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('clears all state', () => {
      const { canvas } = createCanvas();
      canvas.addElement('ex:elem-1', 'arch:A', { x: 0, y: 0, width: 100, height: 50 });
      canvas.addRelationship('ex:src', 'ex:tgt', 'arch:serves');

      canvas.destroy();

      expect(canvas.isInitialized()).toBe(false);
      expect(canvas.getElements().size).toBe(0);
      expect(canvas.getRelationships().size).toBe(0);
    });
  });
});
