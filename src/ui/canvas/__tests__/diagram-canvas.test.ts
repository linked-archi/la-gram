// @vitest-environment jsdom

/**
 * DiagramCanvas against a real diagram-js instance.
 *
 * The point of these tests is that diagram-js is genuinely running: a canvas
 * exists in the host container, shapes and connections reach the DOM, and the
 * command stack drives the write-back to the model managers. Only the SVG layout
 * APIs jsdom lacks are stubbed, so assertions are on DOM structure and on the
 * calls the managers receive — never on measured geometry.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { DiagramCanvas, type DiagramCanvasOptions } from '../diagram-canvas.js';
import { EventBus } from '../../event-bus.js';
import type {
  ElementManager,
  RelationshipManager,
  Bounds,
} from '@linked-archi/kernel/model-manager/interfaces.js';
import type {
  PaletteDefinition,
  RelationshipTypeInfo,
} from '@linked-archi/kernel/metamodel-manager/interfaces.js';
import { RENDER_CLASSES } from '../rdf-renderer.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const { namedNode } = DataFactory;

const MODEL_IRI = 'https://example.org/model/test';
const TYPE_A = 'https://example.org/mm#TypeA';
const TYPE_B = 'https://example.org/mm#TypeB';
const REL_TYPE = 'https://example.org/mm#Serves';

let created: DiagramCanvas[] = [];

afterEach(() => {
  for (const canvas of created) canvas.destroy();
  created = [];
  document.body.innerHTML = '';
});

function createMockElementManager(): ElementManager {
  let counter = 0;
  return {
    createElement: vi.fn(
      () => namedNode(`https://example.org/model/new-${++counter}`) as unknown as NamedNode,
    ),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
}

function createMockRelationshipManager(validTypes: RelationshipTypeInfo[] = []): RelationshipManager {
  return {
    getValidRelationships: vi.fn().mockReturnValue(validTypes),
    createRelationship: vi.fn(
      () => namedNode('https://example.org/model/rel-1') as unknown as NamedNode,
    ),
    deleteRelationship: vi.fn(),
  };
}

function createTestPalette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Test',
        elements: [
          {
            iri: TYPE_A,
            label: 'Type A',
            isAbstract: false,
            style: {
              shapeType: 'Rectangle',
              fillColor: '#FFFFB5',
              lineColor: '#000000',
              renderingMode: 'ShapeOnly',
              defaultWidth: 120,
              defaultHeight: 55,
            },
            renderingMode: 'ShapeOnly',
          },
          { iri: TYPE_B, label: 'Type B', isAbstract: false },
        ],
      },
    ],
    relationshipTypes: [
      {
        iri: REL_TYPE,
        label: 'Serves',
        domainTypes: [TYPE_A],
        rangeTypes: [TYPE_B],
        relationshipStyle: {
          lineStyle: 'SolidLine',
          sourceDecor: 'NoDecoration',
          targetDecor: 'OpenArrowhead',
        },
      },
    ],
  };
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
  const container = document.createElement('div');
  document.body.appendChild(container);

  const options: DiagramCanvasOptions = {
    container,
    eventBus,
    elementManager,
    relationshipManager,
    paletteDefinition: createTestPalette(),
    modelIri: MODEL_IRI,
    ...overrides,
  };

  const canvas = new DiagramCanvas(options);
  created.push(canvas);
  return {
    canvas,
    eventBus,
    elementManager: options.elementManager,
    relationshipManager: options.relationshipManager,
    container: options.container,
  };
}

/** A diagram-js service off a live canvas. */
function service<T>(canvas: DiagramCanvas, name: string): T {
  const diagram = canvas.getDiagram();
  if (!diagram) throw new Error('canvas has no diagram');
  return (diagram as unknown as { get(n: string): T }).get(name);
}

const BOUNDS: Bounds = { x: 100, y: 200, width: 130, height: 60 };

describe('DiagramCanvas', () => {
  it('initializes successfully', () => {
    const { canvas } = createCanvas();
    expect(canvas.isInitialized()).toBe(true);
  });

  it('exposes the container element', () => {
    const { canvas, container } = createCanvas();
    expect(canvas.getContainer()).toBe(container);
  });

  it('constructs a real diagram-js instance in the container', () => {
    const { canvas, container } = createCanvas();

    expect(canvas.getDiagram()).not.toBeNull();
    expect(container.querySelector('.djs-container')).not.toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    // The custom renderer was constructed by the injector, not by us.
    expect(canvas.renderer).toBeDefined();
  });

  it('gives the diagram a root element so shapes have a parent', () => {
    const { canvas } = createCanvas();
    const djsCanvas = service<{ getRootElement(): { id: string } }>(canvas, 'canvas');
    expect(djsCanvas.getRootElement().id).toBe('urn:la-gram:diagram-root');
  });

  it('does not register diagram-js\'s own palette', () => {
    // The element types are the sidebar `palette-panel`'s job, and the global
    // tools are `canvas-toolbar`'s. Registering diagram-js's palette as well put
    // the same 42 types on screen twice, so the feature is left out entirely —
    // and an unregistered service is one didi cannot resolve.
    const { canvas } = createCanvas();
    expect(() => service<unknown>(canvas, 'palette')).toThrow();
  });

  it('registers the custom providers with the diagram-js services', () => {
    const { canvas } = createCanvas();

    const pad = service<{ getEntries(t: unknown): Record<string, unknown> }>(canvas, 'contextPad');
    canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);
    const shape = service<{ get(id: string): unknown }>(canvas, 'elementRegistry').get(
      'https://example.org/model/e1',
    );
    expect(Object.keys(pad.getEntries(shape))).toContain('delete');
  });

  it('exposes every custom module', () => {
    const { canvas } = createCanvas();
    expect(canvas.renderer).toBeDefined();
    expect(canvas.ruleProvider).toBeDefined();
    expect(canvas.contextPadProvider).toBeDefined();
    expect(canvas.replaceMenuProvider).toBeDefined();
  });

  describe('addElement', () => {
    it('draws a shape on the canvas at the given bounds', () => {
      const { canvas, container } = createCanvas();

      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS, 'My Element');

      const drawn = container.querySelector(
        '[data-element-iri="https://example.org/model/e1"]',
      ) as SVGElement | null;
      expect(drawn).not.toBeNull();
      expect(drawn!.classList.contains(RENDER_CLASSES.shape)).toBe(true);
      expect(drawn!.querySelector(`.${RENDER_CLASSES.body}`)).not.toBeNull();

      // Bounds land on the diagram-js element, which is what positions the gfx.
      const element = canvas.getElement('https://example.org/model/e1')!;
      expect(element.bounds).toEqual(BOUNDS);
    });

    it('registers the element with diagram-js under its IRI', () => {
      const { canvas } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      const registry = service<{ get(id: string): { id: string } | undefined }>(
        canvas,
        'elementRegistry',
      );
      expect(registry.get('https://example.org/model/e1')?.id).toBe(
        'https://example.org/model/e1',
      );
    });

    it('records type and label on the element', () => {
      const { canvas } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS, 'My Element');

      const element = canvas.getElement('https://example.org/model/e1')!;
      expect(element.typeIri).toBe(TYPE_A);
      expect(element.label).toBe('My Element');
    });

    it('falls back to the palette label, then the IRI fragment', () => {
      const { canvas } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/e2', 'https://example.org/mm#Unknown', BOUNDS);

      expect(canvas.getElement('https://example.org/model/e1')!.label).toBe('Type A');
      expect(canvas.getElement('https://example.org/model/e2')!.label).toBe('e2');
    });

    it('stores iconUrl when provided', () => {
      const { canvas } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS, 'Test', 'icon.svg');
      expect(canvas.getElement('https://example.org/model/e1')!.iconUrl).toBe('icon.svg');
    });

    it('is idempotent: a repeat add updates instead of failing on a duplicate id', () => {
      const { canvas, container } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS, 'First');

      expect(() =>
        canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS, 'Second'),
      ).not.toThrow();

      expect(canvas.getElement('https://example.org/model/e1')!.label).toBe('Second');
      expect(
        container.querySelectorAll('[data-element-iri="https://example.org/model/e1"]'),
      ).toHaveLength(1);
    });
  });

  describe('addRelationship', () => {
    function withTwoShapes(): ReturnType<typeof createCanvas> {
      const fixture = createCanvas();
      fixture.canvas.addElement('https://example.org/model/src', TYPE_A, {
        x: 0,
        y: 0,
        width: 120,
        height: 55,
      });
      fixture.canvas.addElement('https://example.org/model/tgt', TYPE_B, {
        x: 300,
        y: 0,
        width: 120,
        height: 55,
      });
      return fixture;
    }

    it('draws a connection between two shapes', () => {
      const { canvas, container } = withTwoShapes();

      canvas.addRelationship(
        'https://example.org/model/src',
        'https://example.org/model/tgt',
        REL_TYPE,
      );

      const line = container.querySelector(`.${RENDER_CLASSES.connection}`);
      expect(line).not.toBeNull();
      expect(line!.getAttribute('points')).toBeTruthy();
      expect(line!.getAttribute('data-type-iri')).toBe(REL_TYPE);
    });

    it('renders the notation markers for the relationship type', () => {
      const { canvas, container } = withTwoShapes();
      canvas.addRelationship(
        'https://example.org/model/src',
        'https://example.org/model/tgt',
        REL_TYPE,
      );

      const line = container.querySelector(`.${RENDER_CLASSES.connection}`)!;
      expect(line.getAttribute('marker-end')).toContain('OpenArrowhead');
      expect(container.querySelector('defs.la-notation-markers')).not.toBeNull();
    });

    it('records the relationship', () => {
      const { canvas } = withTwoShapes();
      canvas.addRelationship(
        'https://example.org/model/src',
        'https://example.org/model/tgt',
        REL_TYPE,
      );

      const relationships = canvas.getRelationships();
      expect(relationships.size).toBe(1);
      const relationship = [...relationships.values()][0];
      expect(relationship.sourceIri).toBe('https://example.org/model/src');
      expect(relationship.targetIri).toBe('https://example.org/model/tgt');
      expect(relationship.typeIri).toBe(REL_TYPE);
    });

    it('records but does not draw a relationship whose ends are not on the canvas', () => {
      const { canvas, container } = createCanvas();
      canvas.addRelationship('urn:missing:src', 'urn:missing:tgt', REL_TYPE);

      expect(canvas.getRelationships().size).toBe(1);
      expect(container.querySelector(`.${RENDER_CLASSES.connection}`)).toBeNull();
    });
  });

  describe('layout write-back', () => {
    it('calls updateLayout when a shape is moved', () => {
      const { canvas, elementManager } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      const modeling = service<{ moveElements(e: unknown[], d: unknown): void }>(canvas, 'modeling');
      modeling.moveElements([registry.get('https://example.org/model/e1')], { x: 20, y: 30 });

      expect(elementManager.updateLayout).toHaveBeenCalledWith('https://example.org/model/e1', {
        x: 120,
        y: 230,
        width: 130,
        height: 60,
      });
    });

    it('calls updateLayout when a shape is resized', () => {
      const { canvas, elementManager } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      const modeling = service<{ resizeShape(s: unknown, b: Bounds): void }>(canvas, 'modeling');
      modeling.resizeShape(registry.get('https://example.org/model/e1'), {
        x: 100,
        y: 200,
        width: 200,
        height: 120,
      });

      expect(elementManager.updateLayout).toHaveBeenCalledWith('https://example.org/model/e1', {
        x: 100,
        y: 200,
        width: 200,
        height: 120,
      });
    });

    it('writes back every shape of a multi-element move', () => {
      const { canvas, elementManager } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/e2', TYPE_A, { ...BOUNDS, x: 400 });

      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      const modeling = service<{ moveElements(e: unknown[], d: unknown): void }>(canvas, 'modeling');
      modeling.moveElements(
        [registry.get('https://example.org/model/e1'), registry.get('https://example.org/model/e2')],
        { x: 10, y: 10 },
      );

      const written = vi
        .mocked(elementManager.updateLayout)
        .mock.calls.map((call) => call[0] as string);
      expect(new Set(written)).toEqual(
        new Set(['https://example.org/model/e1', 'https://example.org/model/e2']),
      );
    });
  });

  describe('selection', () => {
    it('emits selection-changed on the app EventBus', () => {
      const { canvas, eventBus } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      const seen: Array<Record<string, unknown> | undefined> = [];
      eventBus.on('selection-changed', (event) => seen.push(event.detail));

      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      service<{ select(e: unknown): void }>(canvas, 'selection').select(
        registry.get('https://example.org/model/e1'),
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.['iri']).toBe('https://example.org/model/e1');
    });

    it('emits an empty selection when the selection is cleared', () => {
      const { canvas, eventBus } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);
      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      const selection = service<{ select(e: unknown): void }>(canvas, 'selection');
      selection.select(registry.get('https://example.org/model/e1'));

      const seen: Array<Record<string, unknown> | undefined> = [];
      eventBus.on('selection-changed', (event) => seen.push(event.detail));
      selection.select(null);

      expect(seen).toHaveLength(1);
      expect(seen[0]?.['iri']).toBeUndefined();
    });
  });

  describe('deletion', () => {
    it('deleteFromCanvas removes the shape and the triples', () => {
      const { canvas, container, elementManager } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      canvas.deleteFromCanvas('https://example.org/model/e1');

      expect(
        container.querySelector('[data-element-iri="https://example.org/model/e1"]'),
      ).toBeNull();
      expect(elementManager.deleteElement).toHaveBeenCalledWith('https://example.org/model/e1');
      expect(canvas.getElement('https://example.org/model/e1')).toBeUndefined();
    });

    it('a store-initiated removal removes the shape without deleting again', () => {
      const { canvas, container, elementManager } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      canvas.removeElement('https://example.org/model/e1');

      expect(
        container.querySelector('[data-element-iri="https://example.org/model/e1"]'),
      ).toBeNull();
      expect(elementManager.deleteElement).not.toHaveBeenCalled();
    });

    it('removes relationships involving a deleted element', () => {
      const { canvas } = createCanvas();
      canvas.addElement('https://example.org/model/src', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/tgt', TYPE_B, { ...BOUNDS, x: 400 });
      canvas.addRelationship(
        'https://example.org/model/src',
        'https://example.org/model/tgt',
        REL_TYPE,
      );

      canvas.removeElement('https://example.org/model/src');

      expect(canvas.getRelationships().size).toBe(0);
    });

    it('the context pad delete action removes the shape and the triples', () => {
      const { canvas, container, elementManager } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);
      const shape = service<{ get(id: string): unknown }>(canvas, 'elementRegistry').get(
        'https://example.org/model/e1',
      );

      (
        canvas.contextPadProvider.getContextPadEntries(shape as never)['delete'].action as (
          event: unknown,
        ) => void
      )({});

      expect(
        container.querySelector('[data-element-iri="https://example.org/model/e1"]'),
      ).toBeNull();
      expect(elementManager.deleteElement).toHaveBeenCalledWith('https://example.org/model/e1');
    });
  });

  describe('palette-driven creation', () => {
    /**
     * The palette entry no longer creates anything by itself: it hands the
     * gesture to diagram-js's `create` service, and the element is minted inside
     * the `shape.create` command that the drop executes. See
     * `append-interaction.test.ts` for a completed drag.
     */
    it('starts a diagram-js create drag rather than writing triples', () => {
      const { canvas, elementManager } = createCanvas();
      const dragging = service<{ setOptions(o: Record<string, unknown>): void; context(): { prefix?: string } | null }>(
        canvas,
        'dragging',
      );
      dragging.setOptions({ manual: true });

      const bus = service<{ createEvent(data: Record<string, unknown>): unknown }>(
        canvas,
        'eventBus',
      );
      canvas.startCreate(
        TYPE_A,
        bus.createEvent({ type: 'mousedown', clientX: 40, clientY: 60, button: 0 }),
      );

      expect(dragging.context()?.prefix).toBe('create');
      // Nothing is written until the drop.
      expect(elementManager.createElement).not.toHaveBeenCalled();
    });

    it('still draws a shape for an element the store reports', () => {
      // The other creation path, unchanged: triples first, then the shape.
      const { canvas, container, eventBus } = createCanvas();

      eventBus.emit('element-created', {
        iri: 'https://example.org/model/e9',
        typeIri: TYPE_A,
        bounds: { x: 40, y: 60, width: 120, height: 55 },
      });

      expect(canvas.getElement('https://example.org/model/e9')).toBeDefined();
      expect(
        container.querySelector('[data-element-iri="https://example.org/model/e9"]'),
      ).not.toBeNull();
    });
  });

  describe('connection drawn on the canvas', () => {
    /**
     * `modeling.connect` is what the connect tool calls, and since `RdfModeling`
     * took over that method it is also where the relationship type is decided.
     * These used to drive `createConnection` directly and rely on a
     * `connection.create.postExecuted` hook patching the type in afterwards;
     * that hook is gone.
     */
    function connect(canvas: DiagramCanvas, attrs?: Record<string, unknown>): unknown {
      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      return service<{
        connect(s: unknown, t: unknown, a?: unknown): unknown;
      }>(canvas, 'modeling').connect(
        registry.get('https://example.org/model/src'),
        registry.get('https://example.org/model/tgt'),
        attrs,
      );
    }

    it('creates the RDF relationship for the best-ranked valid type', () => {
      const relationshipManager = createMockRelationshipManager([
        { iri: REL_TYPE, label: 'Serves', domainTypes: [TYPE_A], rangeTypes: [TYPE_B] },
      ]);
      const { canvas, eventBus } = createCanvas({ relationshipManager });
      canvas.addElement('https://example.org/model/src', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/tgt', TYPE_B, { ...BOUNDS, x: 400 });

      const emitted: Array<Record<string, unknown> | undefined> = [];
      eventBus.on('relationship-created', (event) => emitted.push(event.detail));

      connect(canvas);

      expect(relationshipManager.createRelationship).toHaveBeenCalledWith(
        REL_TYPE,
        'https://example.org/model/src',
        'https://example.org/model/tgt',
      );
      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.['typeIri']).toBe(REL_TYPE);
    });

    it('creates nothing when the metamodel allows no relationship for the pair', () => {
      const relationshipManager = createMockRelationshipManager([]);
      const { canvas } = createCanvas({ relationshipManager });
      canvas.addElement('https://example.org/model/src', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/tgt', TYPE_B, { ...BOUNDS, x: 400 });

      expect(connect(canvas)).toBeUndefined();
      expect(relationshipManager.createRelationship).not.toHaveBeenCalled();
      expect(canvas.getRelationships().size).toBe(0);
    });
  });

  describe('metamodel rules reach the command stack', () => {
    it('refuses a connection the metamodel does not allow', () => {
      const relationshipManager = createMockRelationshipManager([]);
      const { canvas } = createCanvas({ relationshipManager });
      canvas.addElement('https://example.org/model/src', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/tgt', TYPE_B, { ...BOUNDS, x: 400 });

      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      const allowed = service<{ allowed(action: string, context: unknown): boolean }>(
        canvas,
        'rules',
      ).allowed('connection.create', {
        source: registry.get('https://example.org/model/src'),
        target: registry.get('https://example.org/model/tgt'),
      });

      expect(allowed).toBe(false);
    });

    /**
     * The rule answers with the connection's attributes rather than `true` —
     * diagram-js reads any truthy result as allowed, and `Connect` forwards an
     * object result to `modeling.connect`, which is how the type reaches the
     * connection at birth.
     */
    it('allows a connection by naming the type the metamodel offers', () => {
      const relationshipManager = createMockRelationshipManager([
        { iri: REL_TYPE, label: 'Serves', domainTypes: [TYPE_A], rangeTypes: [TYPE_B] },
      ]);
      const { canvas } = createCanvas({ relationshipManager });
      canvas.addElement('https://example.org/model/src', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/tgt', TYPE_B, { ...BOUNDS, x: 400 });

      const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
      const allowed = service<{ allowed(action: string, context: unknown): unknown }>(
        canvas,
        'rules',
      ).allowed('connection.create', {
        source: registry.get('https://example.org/model/src'),
        target: registry.get('https://example.org/model/tgt'),
      });

      expect(allowed).toMatchObject({ typeIri: REL_TYPE });
    });
  });

  describe('updateElement', () => {
    it('updates the label and redraws', () => {
      const { canvas, container } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS, 'Old');

      canvas.updateElement('https://example.org/model/e1', { label: 'New' });

      expect(canvas.getElement('https://example.org/model/e1')!.label).toBe('New');
      const drawn = container.querySelector('[data-element-iri="https://example.org/model/e1"]')!;
      expect(drawn.querySelector(`.${RENDER_CLASSES.label}`)!.textContent).toContain('New');
    });

    it('updates bounds', () => {
      const { canvas } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      const newBounds: Bounds = { x: 50, y: 75, width: 200, height: 100 };
      canvas.updateElement('https://example.org/model/e1', { bounds: newBounds });

      expect(canvas.getElement('https://example.org/model/e1')!.bounds).toEqual(newBounds);
    });

    it('does nothing for a non-existent element', () => {
      const { canvas } = createCanvas();
      expect(() => canvas.updateElement('urn:nonexistent', { label: 'X' })).not.toThrow();
    });
  });

  describe('EventBus synchronization', () => {
    it('draws a shape on element-created', () => {
      const { canvas, eventBus, container } = createCanvas();

      eventBus.emit('element-created', {
        iri: 'https://example.org/model/new-elem',
        typeIri: TYPE_A,
        bounds: { x: 10, y: 20, width: 130, height: 60 },
        label: 'New Element',
      });

      expect(canvas.getElement('https://example.org/model/new-elem')!.label).toBe('New Element');
      expect(
        container.querySelector('[data-element-iri="https://example.org/model/new-elem"]'),
      ).not.toBeNull();
    });

    it('removes the shape on element-deleted', () => {
      const { canvas, eventBus, container } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      eventBus.emit('element-deleted', { iri: 'https://example.org/model/e1' });

      expect(canvas.getElement('https://example.org/model/e1')).toBeUndefined();
      expect(
        container.querySelector('[data-element-iri="https://example.org/model/e1"]'),
      ).toBeNull();
    });

    it('updates the shape on element-updated', () => {
      const { canvas, eventBus } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS, 'Old');

      eventBus.emit('element-updated', { iri: 'https://example.org/model/e1', label: 'Updated' });

      expect(canvas.getElement('https://example.org/model/e1')!.label).toBe('Updated');
    });

    it('draws a connection on relationship-created', () => {
      const { canvas, eventBus, container } = createCanvas();
      canvas.addElement('https://example.org/model/src', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/tgt', TYPE_B, { ...BOUNDS, x: 400 });

      eventBus.emit('relationship-created', {
        sourceIri: 'https://example.org/model/src',
        targetIri: 'https://example.org/model/tgt',
        typeIri: REL_TYPE,
      });

      expect(canvas.getRelationships().size).toBe(1);
      expect(container.querySelector(`.${RENDER_CLASSES.connection}`)).not.toBeNull();
    });

    it('removes the connection on relationship-deleted', () => {
      const { canvas, eventBus, container, relationshipManager } = createCanvas();
      canvas.addElement('https://example.org/model/src', TYPE_A, BOUNDS);
      canvas.addElement('https://example.org/model/tgt', TYPE_B, { ...BOUNDS, x: 400 });
      canvas.addRelationship(
        'https://example.org/model/src',
        'https://example.org/model/tgt',
        REL_TYPE,
      );

      eventBus.emit('relationship-deleted', {
        sourceIri: 'https://example.org/model/src',
        targetIri: 'https://example.org/model/tgt',
        typeIri: REL_TYPE,
      });

      expect(canvas.getRelationships().size).toBe(0);
      expect(container.querySelector(`.${RENDER_CLASSES.connection}`)).toBeNull();
      // Store-initiated, so the triples are not deleted a second time.
      expect(relationshipManager.deleteRelationship).not.toHaveBeenCalled();
    });

    it('ignores events with missing required fields', () => {
      const { canvas, eventBus } = createCanvas();

      eventBus.emit('element-created', { typeIri: TYPE_A });
      expect(canvas.getElements().size).toBe(0);

      expect(() => eventBus.emit('element-deleted', {})).not.toThrow();
    });
  });

  describe('updatePaletteDefinition', () => {
    it('takes the new definition into the next create gesture', () => {
      // The definition reaches the create path through `buildNewShape`, which
      // reads the type's declared label from it. With no definition the shape
      // falls back to the IRI's local name, so the label is what shows whether
      // the update landed.
      const { canvas } = createCanvas();
      const dragging = service<{
        setOptions(o: Record<string, unknown>): void;
        context(): { data?: { shape?: { businessObject?: { label?: string } } } } | null;
        cancel(): void;
      }>(canvas, 'dragging');
      dragging.setOptions({ manual: true });
      const bus = service<{ createEvent(data: Record<string, unknown>): unknown }>(
        canvas,
        'eventBus',
      );
      const press = (): unknown =>
        bus.createEvent({ type: 'mousedown', clientX: 10, clientY: 10, button: 0 });

      canvas.updatePaletteDefinition({ elementGroups: [], relationshipTypes: [] });
      canvas.startCreate(TYPE_A, press());
      expect(dragging.context()?.data?.shape?.businessObject?.label).toBe('TypeA');
      dragging.cancel();

      canvas.updatePaletteDefinition(createTestPalette());
      canvas.startCreate(TYPE_A, press());
      expect(dragging.context()?.data?.shape?.businessObject?.label).toBe('Type A');
      dragging.cancel();
    });

    it('restyles already-drawn elements from the new notation', () => {
      const { canvas, container } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);

      const before = container
        .querySelector('[data-element-iri="https://example.org/model/e1"]')!
        .querySelector(`.${RENDER_CLASSES.body}`)!;
      expect(before.getAttribute('fill')).toBe('#FFFFB5');

      canvas.updatePaletteDefinition({
        elementGroups: [
          {
            category: 'Test',
            elements: [
              {
                iri: TYPE_A,
                label: 'Type A',
                isAbstract: false,
                style: {
                  shapeType: 'Octagon',
                  fillColor: '#C9E7B7',
                  lineColor: '#336699',
                  renderingMode: 'ShapeOnly',
                },
                renderingMode: 'ShapeOnly',
              },
            ],
          },
        ],
        relationshipTypes: [],
      });

      const after = container
        .querySelector('[data-element-iri="https://example.org/model/e1"]')!
        .querySelector(`.${RENDER_CLASSES.body}`)!;
      expect(after.tagName).toBe('polygon');
      expect(after.getAttribute('fill')).toBe('#C9E7B7');
      expect(after.getAttribute('stroke')).toBe('#336699');
    });
  });

  describe('destroy', () => {
    it('leaves the container empty and clears state', () => {
      const { canvas, container } = createCanvas();
      canvas.addElement('https://example.org/model/e1', TYPE_A, BOUNDS);
      canvas.addRelationship(
        'https://example.org/model/e1',
        'https://example.org/model/e1',
        REL_TYPE,
      );

      canvas.destroy();

      expect(container.innerHTML).toBe('');
      expect(canvas.isInitialized()).toBe(false);
      expect(canvas.getElements().size).toBe(0);
      expect(canvas.getRelationships().size).toBe(0);
      expect(canvas.getDiagram()).toBeNull();
    });

    it('is safe to call twice', () => {
      const { canvas } = createCanvas();
      canvas.destroy();
      expect(() => canvas.destroy()).not.toThrow();
    });

    it('addElement after destroy is a no-op rather than a crash', () => {
      const { canvas } = createCanvas();
      canvas.destroy();
      expect(() => canvas.addElement('urn:e:1', TYPE_A, BOUNDS)).not.toThrow();
      expect(canvas.getElements().size).toBe(0);
    });
  });
});
