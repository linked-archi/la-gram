// @vitest-environment jsdom

/**
 * Drawing relationships from the UI, against a real diagram-js instance.
 *
 * These cover the interaction path that was previously a dead end: the context
 * pad's Connect entry, the palette's connect tool, and completing a drag between
 * two shapes. diagram-js's `dragging` service is put in `manual` mode — the same
 * thing diagram-js's own tests do — so a drag can be driven step by step instead
 * of depending on synthetic pointer events reaching jsdom.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DataFactory, Store } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { DiagramCanvas, type DiagramCanvasOptions } from '../diagram-canvas.js';
import {
  RELATIONSHIP_REPLACE_MENU_ID,
  relationshipEntryId,
} from '../rdf-replace-menu-provider.js';
import { EventBus } from '../../event-bus.js';
import type { ElementManager, RelationshipManager, Bounds } from '../../../model-manager/interfaces.js';
import type {
  PaletteDefinition,
  RelationshipTypeInfo,
} from '../../../metamodel-manager/interfaces.js';
import { RENDER_CLASSES } from '../rdf-renderer.js';
import { buildClassClosure } from '../relationship-resolution.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';

installJsdomSvgSupport();

const { namedNode, quad } = DataFactory;

const MODEL_IRI = 'https://example.org/model/test';
const MM = 'https://example.org/mm#';

/** An abstract superclass — the only thing the relationship domains name. */
const ACTIVE_STRUCTURE = `${MM}ActiveStructureElement`;
const PASSIVE_STRUCTURE = `${MM}PassiveStructureElement`;
/** Concrete leaf types. Neither appears in any `domainTypes` list. */
const BUSINESS_ACTOR = `${MM}BusinessActor`;
const BUSINESS_ROLE = `${MM}BusinessRole`;
const DATA_OBJECT = `${MM}DataObject`;

const SERVING = `${MM}Serving`;
const SERVES = `${MM}serves`;
const ASSOCIATION = `${MM}Association`;
const ASSOCIATED_WITH = `${MM}associatedWith`;

const SRC = 'https://example.org/model/src';
const TGT = 'https://example.org/model/tgt';

let created: DiagramCanvas[] = [];

afterEach(() => {
  for (const canvas of created) canvas.destroy();
  created = [];
  document.body.innerHTML = '';
});

// ── Fixtures ──────────────────────────────────────────────────────────

/**
 * A metamodel hierarchy in a *named* graph, mirroring how `N3MetamodelLoader`
 * loads the real ontologies.
 */
function metamodelStore(): { getQuads(...args: never[]): Quad[]; removeQuads(q: never[]): void } {
  const store = new Store();
  const graph = namedNode('urn:test:metamodel');
  const sub = namedNode(NAMESPACES.rdfs + 'subClassOf');
  store.addQuads([
    quad(namedNode(BUSINESS_ACTOR), sub, namedNode(ACTIVE_STRUCTURE), graph),
    quad(namedNode(BUSINESS_ROLE), sub, namedNode(ACTIVE_STRUCTURE), graph),
    quad(namedNode(DATA_OBJECT), sub, namedNode(PASSIVE_STRUCTURE), graph),
  ]);
  return {
    getQuads: (...args: never[]) =>
      store.getQuads(
        (args[0] ?? null) as never,
        (args[1] ?? null) as never,
        (args[2] ?? null) as never,
        (args[3] ?? null) as never,
      ) as unknown as Quad[],
    removeQuads: (quads: never[]) => store.removeQuads(quads as never),
  };
}

/** Domains declared only against the abstract superclass. */
function palette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Business',
        elements: [
          { iri: BUSINESS_ACTOR, label: 'Business Actor', isAbstract: false },
          { iri: BUSINESS_ROLE, label: 'Business Role', isAbstract: false },
          { iri: DATA_OBJECT, label: 'Data Object', isAbstract: false },
        ],
      },
    ],
    relationshipTypes: [
      {
        iri: SERVING,
        label: 'Serving',
        domainTypes: [ACTIVE_STRUCTURE],
        rangeTypes: [ACTIVE_STRUCTURE],
        unqualifiedPredicateIri: SERVES,
        relationshipStyle: {
          lineStyle: 'SolidLine',
          sourceDecor: 'NoDecoration',
          targetDecor: 'OpenArrowhead',
        },
      },
      {
        iri: ASSOCIATION,
        label: 'Association',
        domainTypes: [ACTIVE_STRUCTURE],
        rangeTypes: [ACTIVE_STRUCTURE],
        unqualifiedPredicateIri: ASSOCIATED_WITH,
      },
    ],
  };
}

function elementManagerStub(): ElementManager {
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

/**
 * A relationship manager that answers from the palette using the closure, i.e.
 * the behaviour the real `OxigraphRelationshipManager` has once its queries can
 * see the metamodel. `createRelationship` writes the direct triple into `store`.
 */
function relationshipManagerOver(
  store: ReturnType<typeof metamodelStore>,
  candidatesFor: (source: string, target: string) => RelationshipTypeInfo[],
): RelationshipManager & { quads: Quad[] } {
  const quads: Quad[] = [];
  return {
    quads,
    getValidRelationships: vi.fn(candidatesFor),
    createRelationship: vi.fn((typeIri: string, sourceIri: string, targetIri: string) => {
      quads.push(
        quad(namedNode(sourceIri), namedNode(typeIri), namedNode(targetIri)) as unknown as Quad,
      );
      return null;
    }),
    deleteRelationship: vi.fn(),
  };
}

interface Fixture {
  canvas: DiagramCanvas;
  container: HTMLElement;
  eventBus: EventBus;
  relationshipManager: RelationshipManager;
  /** Triples the relationship manager wrote, as `s|p|o` strings. */
  triples(): string[];
}

/**
 * A canvas with two shapes of `sourceType` / `targetType` already drawn, wired
 * to a closure-aware candidate resolver.
 */
function fixture(options?: {
  sourceType?: string;
  targetType?: string;
  candidates?: (source: string, target: string) => RelationshipTypeInfo[];
  overrides?: Partial<DiagramCanvasOptions>;
}): Fixture {
  const store = metamodelStore();
  const closure = buildClassClosure(store as never);
  const paletteDefinition = palette();

  const defaultCandidates = (source: string, target: string): RelationshipTypeInfo[] => {
    const sourceClosure = closure(source);
    const targetClosure = closure(target);
    return paletteDefinition.relationshipTypes
      .filter(
        (rel) =>
          rel.domainTypes.some((d) => sourceClosure.includes(d)) &&
          rel.rangeTypes.some((r) => targetClosure.includes(r)),
      )
      .map((rel, index) => ({ ...rel, score: 10 - index, reason: `matched ${rel.label}` }));
  };

  const relationshipManager = relationshipManagerOver(
    store,
    options?.candidates ?? defaultCandidates,
  );

  const container = document.createElement('div');
  document.body.appendChild(container);
  const eventBus = new EventBus();

  const canvas = new DiagramCanvas({
    container,
    eventBus,
    elementManager: elementManagerStub(),
    relationshipManager,
    paletteDefinition,
    modelIri: MODEL_IRI,
    classClosure: closure,
    rdfStore: {
      getQuads: (s, p, o) =>
        relationshipManager.quads.filter(
          (q) =>
            (!s || q.subject.value === (s as NamedNode).value) &&
            (!p || q.predicate.value === (p as NamedNode).value) &&
            (!o || q.object.value === (o as NamedNode).value),
        ),
      removeQuads: (quads) => {
        for (const q of quads as unknown as Quad[]) {
          const index = relationshipManager.quads.indexOf(q);
          if (index >= 0) relationshipManager.quads.splice(index, 1);
        }
      },
    },
    ...options?.overrides,
  });
  created.push(canvas);

  const bounds: Bounds = { x: 0, y: 0, width: 120, height: 55 };
  canvas.addElement(SRC, options?.sourceType ?? BUSINESS_ACTOR, bounds);
  canvas.addElement(TGT, options?.targetType ?? BUSINESS_ROLE, { ...bounds, x: 400 });

  return {
    canvas,
    container,
    eventBus,
    relationshipManager,
    triples: () =>
      relationshipManager.quads.map(
        (q) => `${q.subject.value}|${q.predicate.value}|${q.object.value}`,
      ),
  };
}

/** A diagram-js service off a live canvas. */
function service<T>(canvas: DiagramCanvas, name: string): T {
  const diagram = canvas.getDiagram();
  if (!diagram) throw new Error('canvas has no diagram');
  return (diagram as unknown as { get(n: string): T }).get(name);
}

interface Dragging {
  setOptions(options: Record<string, unknown>): void;
  context(): { prefix?: string } | null;
  hover(event: { element: unknown; gfx: unknown }): void;
  move(event: unknown): void;
  end(event?: unknown): void;
}

/** Build the kind of event diagram-js's own drag tests use. */
function canvasEvent(canvas: DiagramCanvas, x: number, y: number, type = 'mousemove'): unknown {
  const bus = service<{ createEvent(data: Record<string, unknown>): unknown }>(canvas, 'eventBus');
  return bus.createEvent({
    type,
    target: service<{ getContainer(): HTMLElement }>(canvas, 'canvas').getContainer(),
    clientX: x,
    clientY: y,
    offsetX: x,
    offsetY: y,
    button: 0,
  });
}

/**
 * Drive a connect drag from the source shape to the target shape and drop it.
 *
 * Mirrors diagram-js's own connect tests: manual dragging, an explicit hover
 * over the drop target, then `end`.
 */
function completeConnect(canvas: DiagramCanvas, startFrom: 'contextPad' | 'api' = 'api'): void {
  const dragging = service<Dragging>(canvas, 'dragging');
  dragging.setOptions({ manual: true });

  const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');
  const graphics = service<{ getGraphics(element: unknown): unknown }>(canvas, 'elementRegistry');
  const source = registry.get(SRC);
  const target = registry.get(TGT);

  if (startFrom === 'contextPad') {
    const entries = canvas.contextPadProvider.getContextPadEntries(source as never);
    const action = entries['connect'].action as {
      dragstart(event: unknown, target?: unknown, autoActivate?: boolean): void;
    };
    action.dragstart(canvasEvent(canvas, 10, 10, 'dragstart'), source, false);
  } else {
    canvas.startConnect(SRC, canvasEvent(canvas, 10, 10, 'dragstart'), false);
  }

  dragging.move(canvasEvent(canvas, 420, 20));
  dragging.hover({ element: target, gfx: graphics.getGraphics(target) });
  dragging.move(canvasEvent(canvas, 430, 25));
  dragging.end();
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('context pad Connect entry', () => {
  it('appears for a concrete type whose domain is an abstract superclass', () => {
    const { canvas } = fixture();
    const shape = service<{ get(id: string): unknown }>(canvas, 'elementRegistry').get(SRC);

    const entries = canvas.contextPadProvider.getContextPadEntries(shape as never);

    expect(entries['connect']).toBeDefined();
    // Nothing declares BusinessActor as a domain: only the abstract superclass
    // is named, which is what the previous exact-IRI check missed.
    expect(palette().relationshipTypes.some((r) => r.domainTypes.includes(BUSINESS_ACTOR))).toBe(
      false,
    );
  });

  it('is registered as a diagram-js dragstart action, not a bare callback', () => {
    const { canvas } = fixture();
    const shape = service<{ get(id: string): unknown }>(canvas, 'elementRegistry').get(SRC);

    const action = canvas.contextPadProvider.getContextPadEntries(shape as never)['connect'].action;

    expect(typeof action).not.toBe('function');
    expect(typeof (action as Record<string, unknown>)['dragstart']).toBe('function');
  });

  it('activating it starts the diagram-js connect interaction', () => {
    const { canvas } = fixture();
    const dragging = service<Dragging>(canvas, 'dragging');
    dragging.setOptions({ manual: true });

    const shape = service<{ get(id: string): unknown }>(canvas, 'elementRegistry').get(SRC);
    const action = canvas.contextPadProvider.getContextPadEntries(shape as never)['connect']
      .action as { dragstart(event: unknown, target?: unknown, autoActivate?: boolean): void };

    action.dragstart(canvasEvent(canvas, 10, 10, 'dragstart'), shape, false);

    // A live connect drag: diagram-js's dragging context is prefixed 'connect'.
    expect(dragging.context()?.prefix).toBe('connect');
  });

  it('is absent for a type no relationship can start from', () => {
    const { canvas } = fixture({ sourceType: DATA_OBJECT });
    const shape = service<{ get(id: string): unknown }>(canvas, 'elementRegistry').get(SRC);

    expect(canvas.contextPadProvider.getContextPadEntries(shape as never)['connect']).toBeUndefined();
  });
});

describe('the connect tool', () => {
  it('activating it starts the diagram-js global-connect tool', () => {
    const { canvas } = fixture();
    const dragging = service<Dragging>(canvas, 'dragging');
    dragging.setOptions({ manual: true });

    canvas.activateTool('connect', canvasEvent(canvas, 5, 5, 'click'));

    expect(dragging.context()?.prefix).toBe('global-connect');
  });

  it('reports the armed tool, so a toolbar can show it', () => {
    const changes: (string | null)[] = [];
    const { canvas } = fixture({
      overrides: { onToolChanged: (tool) => changes.push(tool) },
    });
    const dragging = service<Dragging>(canvas, 'dragging');
    dragging.setOptions({ manual: true });

    // `ToolManager` names it `global-connect`; this app calls it `connect`, and
    // the mapping is what makes the toolbar highlight the right button.
    canvas.activateTool('connect', canvasEvent(canvas, 5, 5, 'click'));
    expect(changes).toEqual(['connect']);

    // Cancelling the gesture drops the tool, and the toolbar hears about it —
    // which is why it cannot just track its own clicks.
    dragging.cancel();
    expect(changes).toEqual(['connect', null]);
  });

  it('permits a connection to start at an element, so the tool can hand off', () => {
    // `GlobalConnect` gates its whole hand-off to `Connect` on
    // `rules.allowed('connection.start', { source })`, and `Rules.allowed`
    // answers *false* for an action no provider registered. Arming the drag
    // (above) therefore proves nothing on its own; without this rule the tool
    // marks nothing on hover and creates nothing on release.
    const { canvas } = fixture();
    const rules = service<{ allowed(action: string, context: unknown): unknown }>(canvas, 'rules');
    const registry = service<{ get(id: string): unknown }>(canvas, 'elementRegistry');

    expect(rules.allowed('connection.start', { source: registry.get(SRC) })).toBe(true);

    // ...but not from the diagram root, and not from a connection.
    const canvasService = service<{ getRootElement(): unknown }>(canvas, 'canvas');
    expect(rules.allowed('connection.start', { source: canvasService.getRootElement() })).toBe(
      false,
    );
  });

  it('activates the lasso and hand tools too', () => {
    const { canvas } = fixture();
    const dragging = service<Dragging>(canvas, 'dragging');
    dragging.setOptions({ manual: true });

    canvas.activateTool('lasso', canvasEvent(canvas, 5, 5, 'click'));
    expect(dragging.context()?.prefix).toBe('lasso.selection');

    canvas.activateTool('hand', canvasEvent(canvas, 5, 5, 'click'));
    expect(dragging.context()?.prefix).toBe('hand');
  });
});

describe('a preselected relationship type', () => {
  it('wins over the metamodel ranking, but only among types it permits', () => {
    // Picking a relationship type in the palette records it here. It reorders
    // the metamodel's answer; it cannot add to it.
    const { canvas } = fixture();
    const ranked = canvas.relationshipCandidates(BUSINESS_ACTOR, BUSINESS_ROLE);
    expect(ranked.length).toBeGreaterThan(1);

    const second = ranked[1];
    canvas.setPreferredRelationshipType(second.iri);
    expect(canvas.ruleProvider.canConnect(BUSINESS_ACTOR, BUSINESS_ROLE)).toMatchObject({
      typeIri: second.iri,
    });

    // A type the metamodel forbids for the pair is ignored, not honoured.
    canvas.setPreferredRelationshipType('urn:not:a:permitted:type');
    expect(canvas.ruleProvider.canConnect(BUSINESS_ACTOR, BUSINESS_ROLE)).toMatchObject({
      typeIri: ranked[0].iri,
    });
  });

  it('is dropped when diagram-js drops the connect tool', () => {
    const { canvas } = fixture();
    const dragging = service<Dragging>(canvas, 'dragging');
    dragging.setOptions({ manual: true });

    canvas.setPreferredRelationshipType('urn:some:type');
    canvas.activateTool('connect', canvasEvent(canvas, 5, 5, 'click'));
    expect(canvas.preferredRelationshipType()).toBe('urn:some:type');

    dragging.cancel();
    expect(canvas.preferredRelationshipType()).toBeUndefined();
  });
});

describe('completing a connect drag', () => {
  it('draws a connection and writes the RDF relationship', () => {
    const f = fixture();

    completeConnect(f.canvas, 'contextPad');

    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).not.toBeNull();
    expect(f.relationshipManager.createRelationship).toHaveBeenCalledTimes(1);
    // The direct triple uses the unqualified predicate, not the class IRI.
    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
  });

  it('records the relationship with the best-ranked type', () => {
    const f = fixture();

    completeConnect(f.canvas);

    const relationships = [...f.canvas.getRelationships().values()];
    expect(relationships).toHaveLength(1);
    expect(relationships[0].typeIri).toBe(SERVING);
  });

  it('emits relationship-created on the app event bus', () => {
    const f = fixture();
    const seen: Array<Record<string, unknown> | undefined> = [];
    f.eventBus.on('relationship-created', (event) => seen.push(event.detail));

    completeConnect(f.canvas);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.['typeIri']).toBe(SERVING);
  });

  it('undoing the drag removes the connection and the triple together', () => {
    const f = fixture();
    completeConnect(f.canvas);
    expect(f.triples()).toHaveLength(1);

    service<{ undo(): void }>(f.canvas, 'commandStack').undo();

    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).toBeNull();
    expect(f.triples()).toEqual([]);
    expect(f.canvas.getRelationships().size).toBe(0);
  });
});

/** The drawn connection's diagram-js element. */
function connectionElement(f: Fixture): unknown {
  const connectionId = [...f.canvas.getRelationships().keys()][0];
  return service<{ get(id: string): unknown }>(f.canvas, 'elementRegistry').get(connectionId);
}

interface PopupMenu {
  isEmpty(target: unknown, providerId: string): boolean;
  isOpen(): boolean;
  close(): void;
}

describe('relationship type choice', () => {
  it('the metamodel offers nothing to choose when exactly one type is valid', () => {
    const f = fixture({
      candidates: () => [
        { iri: SERVING, label: 'Serving', domainTypes: [], rangeTypes: [], score: 10 },
      ],
    });

    completeConnect(f.canvas);

    // No entries means `isEmpty`, which is what keeps the pad entry away.
    expect(
      service<PopupMenu>(f.canvas, 'popupMenu').isEmpty(
        connectionElement(f),
        RELATIONSHIP_REPLACE_MENU_ID,
      ),
    ).toBe(true);
    expect(f.triples()).toEqual([`${SRC}|${SERVING}|${TGT}`]);
  });

  it('offers the ranked candidates when more than one type is valid', () => {
    const f = fixture();

    completeConnect(f.canvas);

    const entries = f.canvas.replaceMenuProvider.getPopupMenuEntries(connectionElement(f));
    expect(Object.values(entries).map((entry) => entry.label)).toEqual([
      'Serving',
      'Association',
    ]);
    // Every candidate explains itself and shows where it ranked.
    expect(entries[relationshipEntryId(SERVING)].description).toContain('matched Serving');
    expect(entries[relationshipEntryId(SERVING)].description).toContain('current');
    expect(entries[relationshipEntryId(ASSOCIATION)].description).toContain('matched Association');
  });

  it('does not open itself when the connection is drawn', () => {
    const f = fixture();

    completeConnect(f.canvas);

    expect(service<PopupMenu>(f.canvas, 'popupMenu').isOpen()).toBe(false);
  });

  it('the user choice is what ends up in the model', () => {
    const f = fixture();
    completeConnect(f.canvas);
    const connectionId = [...f.canvas.getRelationships().keys()][0];

    const changed = f.canvas.changeRelationshipType(connectionId, ASSOCIATION);

    expect(changed).toBe(true);
    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATED_WITH}|${TGT}`]);
    expect([...f.canvas.getRelationships().values()][0].typeIri).toBe(ASSOCIATION);
  });

  it('refuses a type the metamodel does not allow for the pair', () => {
    const f = fixture();
    completeConnect(f.canvas);
    const connectionId = [...f.canvas.getRelationships().keys()][0];

    expect(f.canvas.changeRelationshipType(connectionId, `${MM}Access`)).toBe(false);
    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
  });

  it('selecting an existing connection does not open the menu either', () => {
    const f = fixture();
    completeConnect(f.canvas);

    service<{ select(element: unknown): void }>(f.canvas, 'selection').select(
      connectionElement(f),
    );

    expect(service<PopupMenu>(f.canvas, 'popupMenu').isOpen()).toBe(false);
  });
});

describe('the type of an existing connection is visible on the context pad', () => {
  function padEntriesForConnection(f: Fixture): Record<string, { title: string; action: unknown }> {
    return f.canvas.contextPadProvider.getContextPadEntries(
      connectionElement(f) as never,
    ) as never;
  }

  it('names the current relationship type', () => {
    const f = fixture();
    completeConnect(f.canvas);

    expect(padEntriesForConnection(f)['replace'].title).toBe(
      'Change relationship type: Serving',
    );
  });

  it('follows a type change', () => {
    const f = fixture();
    completeConnect(f.canvas);
    f.canvas.changeRelationshipType([...f.canvas.getRelationships().keys()][0], ASSOCIATION);

    expect(padEntriesForConnection(f)['replace'].title).toBe(
      'Change relationship type: Association',
    );
  });

  it('opens the popup menu with every candidate, current one marked', () => {
    const f = fixture();
    completeConnect(f.canvas);

    (padEntriesForConnection(f)['replace'].action as (event: unknown) => void)({ x: 20, y: 30 });

    const rows = [...f.container.querySelectorAll('.djs-popup .entry')];
    expect(rows.map((row) => row.getAttribute('data-id'))).toEqual([
      relationshipEntryId(SERVING),
      relationshipEntryId(ASSOCIATION),
    ]);
    expect(rows[0].querySelector('.la-relationship-type-current')).not.toBeNull();
  });

  it('offers no replace entry when the metamodel allows a single type', () => {
    const f = fixture({
      candidates: () => [
        { iri: SERVING, label: 'Serving', domainTypes: [], rangeTypes: [], score: 10 },
      ],
    });
    completeConnect(f.canvas);

    expect(padEntriesForConnection(f)['replace']).toBeUndefined();
  });

  it('offers no connect entry on a connection', () => {
    const f = fixture();
    completeConnect(f.canvas);

    expect(padEntriesForConnection(f)['connect']).toBeUndefined();
  });

  it('deleting from the pad removes the connection and the triple', () => {
    const f = fixture();
    completeConnect(f.canvas);

    (padEntriesForConnection(f)['delete'].action as (event: unknown) => void)({});

    expect(f.canvas.getRelationships().size).toBe(0);
    expect(f.triples()).toEqual([]);
    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).toBeNull();
  });
});

describe('changing an existing connection type', () => {
  it('retracts the old triple, asserts the new one and redraws', () => {
    const f = fixture();
    completeConnect(f.canvas);
    const connectionId = [...f.canvas.getRelationships().keys()][0];

    const redrawn: unknown[] = [];
    service<{ on(event: string, cb: (e: unknown) => void): void }>(f.canvas, 'eventBus').on(
      'elements.changed',
      (event) => redrawn.push(event),
    );

    f.canvas.changeRelationshipType(connectionId, ASSOCIATION);

    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATED_WITH}|${TGT}`]);
    expect(redrawn.length).toBeGreaterThan(0);
    // Still exactly one connection: the existing one was relabelled, not replaced.
    expect(f.container.querySelectorAll(`.${RENDER_CLASSES.connection}`)).toHaveLength(1);
    expect(f.canvas.getRelationships().size).toBe(1);
  });

  it('deletes the qualified relationship resource when the model has one', () => {
    const f = fixture();
    const relationshipManager = f.relationshipManager;
    vi.mocked(relationshipManager.createRelationship).mockImplementation(
      () => namedNode('https://example.org/model/qr-1') as unknown as NamedNode,
    );
    completeConnect(f.canvas);
    const connectionId = [...f.canvas.getRelationships().keys()][0];

    f.canvas.changeRelationshipType(connectionId, ASSOCIATION);

    expect(relationshipManager.deleteRelationship).toHaveBeenCalledWith(
      'https://example.org/model/qr-1',
    );
  });

  it('is a no-op when the type is unchanged', () => {
    const f = fixture();
    completeConnect(f.canvas);
    const connectionId = [...f.canvas.getRelationships().keys()][0];

    expect(f.canvas.changeRelationshipType(connectionId, SERVING)).toBe(false);
    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
  });

  it('is undoable: one command puts the old type and triple back', () => {
    const f = fixture();
    completeConnect(f.canvas);
    const connectionId = [...f.canvas.getRelationships().keys()][0];
    f.canvas.changeRelationshipType(connectionId, ASSOCIATION);

    service<{ undo(): void }>(f.canvas, 'commandStack').undo();

    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
    expect(f.canvas.getRelationships().get(connectionId)?.typeIri).toBe(SERVING);
    // Undoing the retype does not undo the connect as well.
    expect(f.container.querySelectorAll(`.${RENDER_CLASSES.connection}`)).toHaveLength(1);
  });
});

describe('zero valid candidates', () => {
  it('the rule provider refuses the connection', () => {
    const f = fixture({ candidates: () => [] });
    const registry = service<{ get(id: string): unknown }>(f.canvas, 'elementRegistry');

    const allowed = service<{ allowed(action: string, context: unknown): boolean }>(
      f.canvas,
      'rules',
    ).allowed('connection.create', { source: registry.get(SRC), target: registry.get(TGT) });

    expect(allowed).toBe(false);
  });

  it('a completed drag draws nothing and writes nothing', () => {
    const f = fixture({ candidates: () => [] });

    completeConnect(f.canvas);

    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).toBeNull();
    expect(f.relationshipManager.createRelationship).not.toHaveBeenCalled();
    expect(f.canvas.getRelationships().size).toBe(0);
  });
});

describe('deleting a drawn connection', () => {
  it('retracts the direct triple it wrote', () => {
    const f = fixture();
    completeConnect(f.canvas);
    const connectionId = [...f.canvas.getRelationships().keys()][0];
    const registry = service<{ get(id: string): unknown }>(f.canvas, 'elementRegistry');

    service<{ removeElements(elements: unknown[]): void }>(f.canvas, 'modeling').removeElements([
      registry.get(connectionId),
    ]);

    expect(f.triples()).toEqual([]);
    expect(f.canvas.getRelationships().size).toBe(0);
  });
});
