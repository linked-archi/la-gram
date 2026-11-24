// @vitest-environment jsdom

/**
 * The append gesture, against a real diagram-js instance.
 *
 * Appending is two model changes in one user action: a new element with its own
 * IRI, and a relationship to it whose type the metamodel decides. These tests
 * drive it both ways diagram-js offers — a drag out of the append menu onto empty
 * canvas (`create.start` with a `{ source }` hint) and a click that lets
 * `autoPlace` position the element — and check that RDF ends up with both halves,
 * and that one undo removes both again.
 *
 * `dragging` is put in `manual` mode, as the connect tests do, so a drag can be
 * driven step by step rather than depending on synthetic pointer events reaching
 * jsdom.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DataFactory, Store } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { DiagramCanvas, type DiagramCanvasOptions } from '../diagram-canvas.js';
import { APPEND_TARGET_MENU_ID, appendEntryId } from '../rdf-append-menu-provider.js';
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
import { buildClassClosure } from '../relationship-resolution.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';

installJsdomSvgSupport();

const { namedNode, literal, quad } = DataFactory;

const MODEL_IRI = 'https://example.org/model/test';
const MM = 'https://example.org/mm#';

/** Abstract superclasses — the only things the relationship domains/ranges name. */
const ACTIVE_STRUCTURE = `${MM}ActiveStructureElement`;
const PASSIVE_STRUCTURE = `${MM}PassiveStructureElement`;

/** Concrete leaf types. */
const BUSINESS_ACTOR = `${MM}BusinessActor`;
const BUSINESS_ROLE = `${MM}BusinessRole`;
/** Reachable only through `Access`, whose domain is active and range passive. */
const DATA_OBJECT = `${MM}DataObject`;
/** Named by no relationship's range at all: the negative case. */
const LOCATION = `${MM}Location`;

const SERVING = `${MM}Serving`;
const SERVES = `${MM}serves`;
const ASSOCIATION = `${MM}Association`;
const ASSOCIATED_WITH = `${MM}associatedWith`;
const ACCESS = `${MM}Access`;
const ACCESSES = `${MM}accesses`;

const SRC = 'https://example.org/model/src';

let created: DiagramCanvas[] = [];

afterEach(() => {
  for (const canvas of created) canvas.destroy();
  created = [];
  document.body.innerHTML = '';
});

// ── Fixtures ──────────────────────────────────────────────────────────

/** A metamodel hierarchy in a named graph, as `N3MetamodelLoader` loads one. */
function metamodelStore(): Store {
  const store = new Store();
  const graph = namedNode('urn:test:metamodel');
  const sub = namedNode(NAMESPACES.rdfs + 'subClassOf');
  store.addQuads([
    quad(namedNode(BUSINESS_ACTOR), sub, namedNode(ACTIVE_STRUCTURE), graph),
    quad(namedNode(BUSINESS_ROLE), sub, namedNode(ACTIVE_STRUCTURE), graph),
    quad(namedNode(DATA_OBJECT), sub, namedNode(PASSIVE_STRUCTURE), graph),
    // Location deliberately has no superclass, so no domain/range names it.
  ]);
  return store;
}

function palette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Business',
        elements: [
          { iri: BUSINESS_ACTOR, label: 'Business Actor', isAbstract: false },
          { iri: BUSINESS_ROLE, label: 'Business Role', isAbstract: false },
          { iri: LOCATION, label: 'Location', isAbstract: false },
          { iri: `${MM}AbstractThing`, label: 'Abstract Thing', isAbstract: true },
        ],
      },
      {
        category: 'Application',
        elements: [{ iri: DATA_OBJECT, label: 'Data Object', isAbstract: false }],
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
      {
        iri: ACCESS,
        label: 'Access',
        domainTypes: [ACTIVE_STRUCTURE],
        rangeTypes: [PASSIVE_STRUCTURE],
        unqualifiedPredicateIri: ACCESSES,
      },
    ],
  };
}

/**
 * An RDF store good enough for the element and relationship writers: n3's
 * `Store` behind the structural interface `DiagramCanvas` asks for, `addQuads`
 * included — which is what makes redo restore the same element.
 */
function canvasStore(): {
  store: Store;
  facade: {
    getQuads(s?: unknown, p?: unknown, o?: unknown, g?: unknown): unknown[];
    removeQuads(q: never[]): void;
    addQuads(q: never[]): void;
  };
  triples(): string[];
} {
  const store = new Store();
  return {
    store,
    facade: {
      getQuads: (s, p, o, g) =>
        store.getQuads(
          (s ?? null) as never,
          (p ?? null) as never,
          (o ?? null) as never,
          (g ?? null) as never,
        ) as unknown[],
      removeQuads: (quads) => store.removeQuads(quads as never),
      addQuads: (quads) => store.addQuads(quads as never),
    },
    triples: () =>
      store
        .getQuads(null, null, null, null)
        .map((q) => `${q.subject.value}|${q.predicate.value}|${q.object.value}`)
        .sort(),
  };
}

/** The real element manager's contract, over an n3 store. */
function elementManagerOver(store: Store): ElementManager {
  let counter = 0;
  const boundsPredicate = (suffix: string) =>
    namedNode(NAMESPACES['arch-vis'] + `bounds-${suffix}`);
  return {
    createElement: vi.fn((typeIri: string, modelIri: string) => {
      const iri = `${modelIri}/elem-${++counter}`;
      const subject = namedNode(iri);
      store.addQuads([quad(subject, namedNode(NAMESPACES.rdf + 'type'), namedNode(typeIri))]);
      return subject as unknown as NamedNode;
    }),
    updateProperty: vi.fn(),
    deleteElement: vi.fn((iri: string) => {
      const subject = namedNode(iri);
      store.removeQuads(store.getQuads(subject, null, null, null));
      store.removeQuads(store.getQuads(null, null, subject, null));
    }),
    // The legacy element-level layout sink a canvas without a view manager
    // writes to (this fixture has no views).
    updateLayout: vi.fn((iri: string, bounds: Bounds) => {
      const subject = namedNode(iri);
      for (const suffix of ['x', 'y', 'w', 'h']) {
        store.removeQuads(store.getQuads(subject, boundsPredicate(suffix), null, null));
      }
      store.addQuads([
        quad(subject, boundsPredicate('x'), literal(String(bounds.x))),
        quad(subject, boundsPredicate('y'), literal(String(bounds.y))),
        quad(subject, boundsPredicate('w'), literal(String(bounds.width))),
        quad(subject, boundsPredicate('h'), literal(String(bounds.height))),
      ]);
    }),
  };
}

/** Candidate resolution the way the real manager does it: closure-aware. */
function relationshipManagerOver(
  store: Store,
  paletteDefinition: PaletteDefinition,
  closure: (typeIri: string) => string[],
): RelationshipManager & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getValidRelationships: vi.fn((source: string, target: string): RelationshipTypeInfo[] => {
      calls.push(`${source}->${target}`);
      const sourceClosure = closure(source);
      const targetClosure = closure(target);
      return paletteDefinition.relationshipTypes
        .filter(
          (rel) =>
            rel.domainTypes.some((d) => sourceClosure.includes(d)) &&
            rel.rangeTypes.some((r) => targetClosure.includes(r)),
        )
        .map((rel, index) => ({ ...rel, score: 10 - index, reason: `matched ${rel.label}` }));
    }),
    createRelationship: vi.fn((typeIri: string, sourceIri: string, targetIri: string) => {
      store.addQuads([quad(namedNode(sourceIri), namedNode(typeIri), namedNode(targetIri))]);
      return null;
    }),
    deleteRelationship: vi.fn(),
  };
}

interface Fixture {
  canvas: DiagramCanvas;
  container: HTMLElement;
  eventBus: EventBus;
  elementManager: ElementManager;
  relationshipManager: RelationshipManager & { calls: string[] };
  /** Every triple in the model store, as `s|p|o` strings, sorted. */
  triples(): string[];
  /** Triples whose predicate is one of the relationship predicates. */
  relationshipTriples(): string[];
}

function fixture(options?: {
  sourceType?: string;
  overrides?: Partial<DiagramCanvasOptions>;
}): Fixture {
  const closure = buildClassClosure(metamodelStore() as never);
  const paletteDefinition = palette();
  const model = canvasStore();

  const elementManager = elementManagerOver(model.store);
  const relationshipManager = relationshipManagerOver(model.store, paletteDefinition, closure);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const eventBus = new EventBus();

  const canvas = new DiagramCanvas({
    container,
    eventBus,
    elementManager,
    relationshipManager,
    paletteDefinition,
    modelIri: MODEL_IRI,
    classClosure: closure,
    rdfStore: model.facade,
    ...options?.overrides,
  });
  created.push(canvas);

  canvas.addElement(SRC, options?.sourceType ?? BUSINESS_ACTOR, {
    x: 0,
    y: 0,
    width: 120,
    height: 55,
  });

  const predicates = new Set([SERVES, ASSOCIATED_WITH, ACCESSES, SERVING, ASSOCIATION, ACCESS]);

  return {
    canvas,
    container,
    eventBus,
    elementManager,
    relationshipManager,
    triples: model.triples,
    relationshipTriples: () =>
      model.triples().filter((t) => predicates.has(t.split('|')[1] ?? '')),
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

interface Registry {
  get(id: string): { id: string; businessObject?: { iri: string; typeIri: string } } | undefined;
  getAll(): Array<{ id: string; waypoints?: unknown; parent?: unknown }>;
  getGraphics(element: unknown): unknown;
}

/** Shapes on the canvas other than the root and the connections. */
function shapeIds(canvas: DiagramCanvas): string[] {
  return [...canvas.getElements().keys()];
}

/**
 * Drive an append drag from the source shape onto empty canvas and drop it.
 *
 * "Empty canvas" is the root element as far as diagram-js is concerned, so the
 * hover is over the root — which is what `Create` needs as the drop parent.
 */
function completeAppendDrag(
  canvas: DiagramCanvas,
  typeIri: string,
  start: 'menu' | 'api' = 'api',
): void {
  const dragging = service<Dragging>(canvas, 'dragging');
  dragging.setOptions({ manual: true });

  const registry = service<Registry>(canvas, 'elementRegistry');
  const source = registry.get(SRC)!;
  const root = service<{ getRootElement(): unknown }>(canvas, 'canvas').getRootElement();

  if (start === 'menu') {
    const entries = canvas.appendMenuProvider.getPopupMenuEntries(source);
    entries[appendEntryId(typeIri)].action.dragstart(canvasEvent(canvas, 10, 10, 'dragstart'));
  } else {
    canvas.startAppend(SRC, typeIri, canvasEvent(canvas, 10, 10, 'dragstart'));
  }

  dragging.move(canvasEvent(canvas, 300, 200));
  dragging.hover({ element: root, gfx: registry.getGraphics(root) });
  dragging.move(canvasEvent(canvas, 320, 210));
  dragging.end();
}

// ── Part A: the services exist ────────────────────────────────────────

describe('features/create and features/auto-place are registered', () => {
  it('resolves `create` and `autoPlace` as services', () => {
    const { canvas } = fixture();

    expect(service<unknown>(canvas, 'create')).toBeDefined();
    expect(service<unknown>(canvas, 'autoPlace')).toBeDefined();
    // What each module pulls in, and what it makes live.
    expect(service<unknown>(canvas, 'createPreview')).toBeDefined();
    expect(service<unknown>(canvas, 'previewSupport')).toBeDefined();
    expect(service<unknown>(canvas, 'autoPlaceSelectionBehavior')).toBeDefined();
    // Snapping was registered in an earlier pass but had no create drags to
    // snap; `CreateMoveSnapping` listens on `create.*`.
    expect(service<unknown>(canvas, 'createMoveSnapping')).toBeDefined();
  });

  it('the modeling layer is still the RDF one, so appends route through it', () => {
    const { canvas } = fixture();
    const modeling = service<{ connect: unknown; appendShape: unknown }>(canvas, 'modeling');

    // `Create` and `AutoPlace` both end in `modeling.appendShape`, whose
    // postExecute calls `modeling.connect` — RdfModeling's override.
    expect(typeof modeling.appendShape).toBe('function');
    expect(service<unknown>(canvas, 'connectionDocking')).toBeDefined();
  });
});

// ── Part B: the pad entry and the offered targets ─────────────────────

describe('the context pad append entry', () => {
  it('appears for a type that can connect to something', () => {
    const { canvas } = fixture();
    const shape = service<Registry>(canvas, 'elementRegistry').get(SRC);

    const entries = canvas.contextPadProvider.getContextPadEntries(shape as never);

    expect(entries['append']).toBeDefined();
    expect(entries['append'].title).toBe('Append element');
  });

  it('is absent for a type that can reach nothing', () => {
    // Location is in no closure any range names, so no relationship can end at
    // it — and nothing can start at it either.
    const { canvas } = fixture({ sourceType: LOCATION });
    const shape = service<Registry>(canvas, 'elementRegistry').get(SRC);

    const entries = canvas.contextPadProvider.getContextPadEntries(shape as never);

    expect(entries['append']).toBeUndefined();
    expect(entries['connect']).toBeUndefined();
  });

  it('opening it renders the popup menu of target types', () => {
    const f = fixture();
    const shape = service<Registry>(f.canvas, 'elementRegistry').get(SRC);
    const entries = f.canvas.contextPadProvider.getContextPadEntries(shape as never);

    (entries['append'].action as (event: unknown) => void)({ x: 20, y: 30 });

    const rows = [...f.container.querySelectorAll('.djs-popup .entry')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.getAttribute('data-id'))).toContain(
      appendEntryId(BUSINESS_ROLE),
    );
  });
});

describe('the offered target types are derived from the metamodel', () => {
  it('offers only types the metamodel permits a relationship to', () => {
    const { canvas } = fixture();

    const targets = canvas.appendTargets(BUSINESS_ACTOR);
    const offered = targets.map((t) => t.type.iri);

    // Reachable: another active-structure type (Serving/Association) and a
    // passive one (Access).
    expect(offered).toContain(BUSINESS_ROLE);
    expect(offered).toContain(DATA_OBJECT);
    // Not reachable: no relationship's range admits Location.
    expect(offered).not.toContain(LOCATION);
    // Abstract types never appear.
    expect(offered).not.toContain(`${MM}AbstractThing`);
  });

  it('says which relationship each append would create', () => {
    const { canvas } = fixture();

    const targets = canvas.appendTargets(BUSINESS_ACTOR);
    const toRole = targets.find((t) => t.type.iri === BUSINESS_ROLE)!;
    const toData = targets.find((t) => t.type.iri === DATA_OBJECT)!;

    expect(toRole.relationships[0].iri).toBe(SERVING);
    expect(toRole.relationships.map((r) => r.iri)).toEqual([SERVING, ASSOCIATION]);
    expect(toData.relationships.map((r) => r.iri)).toEqual([ACCESS]);
  });

  it('the menu entry names the relationship and carries both gestures', () => {
    const { canvas } = fixture();
    const shape = service<Registry>(canvas, 'elementRegistry').get(SRC);

    const entries = canvas.appendMenuProvider.getPopupMenuEntries(shape);
    const entry = entries[appendEntryId(BUSINESS_ROLE)];

    expect(entry.label).toBe('Business Role');
    expect(entry.description).toContain('via Serving');
    // Both halves of bpmn-js's appendAction, on one entry.
    expect(typeof entry.action.click).toBe('function');
    expect(typeof entry.action.dragstart).toBe('function');
    // Bucketed the way the palette is.
    expect(entry.group).toEqual({ id: 'Business', name: 'Business' });
    expect(entries[appendEntryId(DATA_OBJECT)].group?.name).toBe('Application');
  });

  it('a source that can reach nothing yields an empty menu, which is the gate', () => {
    const { canvas } = fixture({ sourceType: LOCATION });
    const shape = service<Registry>(canvas, 'elementRegistry').get(SRC);

    expect(canvas.appendMenuProvider.getPopupMenuEntries(shape)).toEqual({});
    expect(
      service<{ isEmpty(t: unknown, id: string): boolean }>(canvas, 'popupMenu').isEmpty(
        shape,
        APPEND_TARGET_MENU_ID,
      ),
    ).toBe(true);
  });

  it('the derivation is memoized, and invalidated by a palette change', () => {
    const f = fixture();
    const pairsFor = (): string[] => f.relationshipManager.calls.filter((c) => c.includes('->'));

    f.canvas.appendTargets(BUSINESS_ACTOR);
    const first = pairsFor().length;
    f.canvas.appendTargets(BUSINESS_ACTOR);

    // Second ask costs nothing: the manager re-reads the store on every call.
    expect(pairsFor().length).toBe(first);
    // The prefilter kept the manager away from Location and the abstract type,
    // so the pair count is below the number of concrete palette types.
    expect(first).toBeLessThan(4);

    f.canvas.updatePaletteDefinition(palette());
    f.canvas.appendTargets(BUSINESS_ACTOR);

    expect(pairsFor().length).toBeGreaterThan(first);
  });
});

// ── Part C: the appended element is a real RDF element ────────────────

describe('completing an append drag', () => {
  it('creates a shape and a connection in one gesture', () => {
    const f = fixture();

    completeAppendDrag(f.canvas, BUSINESS_ROLE, 'menu');

    // Two shapes: the source and the appended one.
    expect(shapeIds(f.canvas)).toHaveLength(2);
    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).not.toBeNull();
    expect(f.canvas.getRelationships().size).toBe(1);
  });

  it('uses the relationship type the metamodel ranks first', () => {
    const f = fixture();

    completeAppendDrag(f.canvas, BUSINESS_ROLE);

    const relationship = [...f.canvas.getRelationships().values()][0];
    expect(relationship.typeIri).toBe(SERVING);
    expect(relationship.sourceIri).toBe(SRC);
  });

  it('the new element exists in RDF with its own IRI', () => {
    const f = fixture();

    completeAppendDrag(f.canvas, BUSINESS_ROLE);

    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;
    expect(appended).toMatch(/^https:\/\/example\.org\/model\/test\/elem-\d+$/);
    // The type triple is there, and the shape's diagram-js id *is* the IRI.
    expect(f.triples()).toContain(`${appended}|${NAMESPACES.rdf}type|${BUSINESS_ROLE}`);
    expect(service<Registry>(f.canvas, 'elementRegistry').get(appended)).toBeDefined();
  });

  it('the relationship triple uses the unqualified predicate', () => {
    const f = fixture();

    completeAppendDrag(f.canvas, BUSINESS_ROLE);
    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;

    expect(f.relationshipTriples()).toEqual([`${SRC}|${SERVES}|${appended}`]);
  });

  it('records layout that agrees with where the shape was drawn', () => {
    const f = fixture();

    completeAppendDrag(f.canvas, BUSINESS_ROLE);
    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;
    const drawn = f.canvas.getElement(appended)!;

    const boundsOf = (suffix: string): string =>
      f
        .triples()
        .find((t) => t.includes(`${NAMESPACES['arch-vis']}bounds-${suffix}|`))!
        .split('|')[2];

    // `rdf.element.create` mirrors CreateShapeHandler's centring, so the triples
    // and the canvas cannot disagree.
    expect(boundsOf('x')).toBe(String(drawn.bounds.x));
    expect(boundsOf('y')).toBe(String(drawn.bounds.y));
  });

  it('announces the new element on the app event bus', () => {
    const f = fixture();
    const seen: Array<Record<string, unknown> | undefined> = [];
    f.eventBus.on('element-created', (event) => seen.push(event.detail));

    completeAppendDrag(f.canvas, BUSINESS_ROLE);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.['typeIri']).toBe(BUSINESS_ROLE);
    // Exactly one shape was drawn — the announcement did not draw a second.
    expect(shapeIds(f.canvas)).toHaveLength(2);
  });

  it('refuses a target the metamodel forbids', () => {
    const f = fixture();

    // Location can be created, but no relationship can reach it, so `Create`'s
    // `connection.create` check fails and the drop is rejected outright.
    completeAppendDrag(f.canvas, LOCATION);

    expect(shapeIds(f.canvas)).toHaveLength(1);
    expect(f.canvas.getRelationships().size).toBe(0);
    expect(f.relationshipTriples()).toEqual([]);
  });
});

describe('click-to-append', () => {
  it('positions the element via autoPlace and still connects it', () => {
    const f = fixture();
    const source = f.canvas.getElement(SRC)!;

    const appended = f.canvas.appendElement(SRC, BUSINESS_ROLE);

    expect(appended).toBeDefined();
    expect(shapeIds(f.canvas)).toHaveLength(2);
    // AutoPlace puts it to the right of the source, untouched by any pointer.
    expect(appended!.x).toBeGreaterThan(source.bounds.x + source.bounds.width);
    expect(f.canvas.getRelationships().size).toBe(1);
    expect([...f.canvas.getRelationships().values()][0].typeIri).toBe(SERVING);
  });

  it('creates the relationship the user picked, when the metamodel permits it', () => {
    const f = fixture();

    f.canvas.appendElement(SRC, BUSINESS_ROLE, ASSOCIATION);

    expect([...f.canvas.getRelationships().values()][0].typeIri).toBe(ASSOCIATION);
    // The pick lasts for that append only.
    expect(f.canvas.preferredRelationshipType()).toBeUndefined();
  });

  it('is what the menu entry does on click', () => {
    const f = fixture();
    const shape = service<Registry>(f.canvas, 'elementRegistry').get(SRC);
    const entry = f.canvas.appendMenuProvider.getPopupMenuEntries(shape)[
      appendEntryId(DATA_OBJECT)
    ];

    entry.action.click({});

    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;
    expect(f.relationshipTriples()).toEqual([`${SRC}|${ACCESSES}|${appended}`]);
    expect(f.triples()).toContain(`${appended}|${NAMESPACES.rdf}type|${DATA_OBJECT}`);
  });

  it('selects the appended element, as AutoPlaceSelectionBehavior does', () => {
    const f = fixture();

    const appended = f.canvas.appendElement(SRC, BUSINESS_ROLE)!;

    const selected = service<{ get(): Array<{ id: string }> }>(f.canvas, 'selection').get();
    expect(selected.map((s) => s.id)).toEqual([appended.id]);
  });
});

// ── Part C: undo ─────────────────────────────────────────────────────

describe('undoing an append', () => {
  it('reverses the connection, the triple, the shape and the element triples', () => {
    const f = fixture();
    completeAppendDrag(f.canvas, BUSINESS_ROLE);
    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;
    expect(f.triples().filter((t) => t.startsWith(appended)).length).toBeGreaterThan(0);

    service<{ undo(): void }>(f.canvas, 'commandStack').undo();

    // Connection: gone from the canvas and from the registry.
    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).toBeNull();
    expect(f.canvas.getRelationships().size).toBe(0);
    // Relationship triple: retracted.
    expect(f.relationshipTriples()).toEqual([]);
    // Shape: gone.
    expect(shapeIds(f.canvas)).toEqual([SRC]);
    expect(service<Registry>(f.canvas, 'elementRegistry').get(appended)).toBeUndefined();
    // Element triples: retracted. Only the source's remain.
    expect(f.triples().every((t) => t.startsWith(SRC))).toBe(true);
  });

  it('is a single undo, not one per command', () => {
    const f = fixture();
    completeAppendDrag(f.canvas, BUSINESS_ROLE);
    const commandStack = service<{ undo(): void; canUndo(): boolean }>(f.canvas, 'commandStack');

    commandStack.undo();

    // `shape.append`, `shape.create`, `rdf.element.create`, `connection.create`
    // and `rdf.relationship.create` all share the outer action's id, so one undo
    // unwinds every one of them and nothing is left on the stack.
    expect(commandStack.canUndo()).toBe(false);
  });

  it('announces the deletion on the app event bus', () => {
    const f = fixture();
    completeAppendDrag(f.canvas, BUSINESS_ROLE);
    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;
    const seen: Array<Record<string, unknown> | undefined> = [];
    f.eventBus.on('element-deleted', (event) => seen.push(event.detail));

    service<{ undo(): void }>(f.canvas, 'commandStack').undo();

    expect(seen.map((detail) => detail?.['iri'])).toEqual([appended]);
  });

  it('redo restores the same element IRI, so the relationship still points at it', () => {
    const f = fixture();
    completeAppendDrag(f.canvas, BUSINESS_ROLE);
    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;
    const commandStack = service<{ undo(): void; redo(): void }>(f.canvas, 'commandStack');

    commandStack.undo();
    commandStack.redo();

    // The IRI is restored from the snapshot rather than minted afresh, which is
    // what keeps the relationship triple meaningful across an undo/redo cycle.
    expect(shapeIds(f.canvas)).toContain(appended);
    expect(f.relationshipTriples()).toEqual([`${SRC}|${SERVES}|${appended}`]);
    expect(f.triples()).toContain(`${appended}|${NAMESPACES.rdf}type|${BUSINESS_ROLE}`);
  });

  it('undoing a click-append reverses it the same way', () => {
    const f = fixture();
    f.canvas.appendElement(SRC, DATA_OBJECT);

    service<{ undo(): void }>(f.canvas, 'commandStack').undo();

    expect(shapeIds(f.canvas)).toEqual([SRC]);
    expect(f.relationshipTriples()).toEqual([]);
    expect(f.triples().every((t) => t.startsWith(SRC))).toBe(true);
  });
});

// ── Part D: the palette goes through create.start ─────────────────────

describe('the palette creates through diagram-js', () => {
  it('starting a create drag writes no triples until the drop', () => {
    const f = fixture();
    const dragging = service<Dragging>(f.canvas, 'dragging');
    dragging.setOptions({ manual: true });

    f.canvas.startCreate(BUSINESS_ROLE, canvasEvent(f.canvas, 5, 5, 'mousedown'));

    expect(dragging.context()?.prefix).toBe('create');
    expect(f.elementManager.createElement).not.toHaveBeenCalled();
  });

  it('completing that drag creates the element at the drop position', () => {
    const f = fixture();
    const dragging = service<Dragging>(f.canvas, 'dragging');
    dragging.setOptions({ manual: true });
    const registry = service<Registry>(f.canvas, 'elementRegistry');
    const root = service<{ getRootElement(): unknown }>(f.canvas, 'canvas').getRootElement();

    f.canvas.startCreate(BUSINESS_ROLE, canvasEvent(f.canvas, 5, 5, 'mousedown'));
    dragging.move(canvasEvent(f.canvas, 250, 150));
    dragging.hover({ element: root, gfx: registry.getGraphics(root) });
    dragging.move(canvasEvent(f.canvas, 260, 160));
    dragging.end();

    const appended = shapeIds(f.canvas).find((iri) => iri !== SRC)!;
    expect(appended).toBeDefined();
    expect(f.triples()).toContain(`${appended}|${NAMESPACES.rdf}type|${BUSINESS_ROLE}`);
    // No `source` hint, so no connection: this is a plain create, not an append.
    expect(f.canvas.getRelationships().size).toBe(0);
  });

  it('the toolbar still activates its tool', () => {
    const f = fixture();
    const dragging = service<Dragging>(f.canvas, 'dragging');
    dragging.setOptions({ manual: true });

    f.canvas.activateTool('connect', canvasEvent(f.canvas, 5, 5, 'click'));

    expect(dragging.context()?.prefix).toBe('global-connect');
  });
});
