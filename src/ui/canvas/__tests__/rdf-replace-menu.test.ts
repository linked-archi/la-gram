// @vitest-environment jsdom

/**
 * The relationship-type chooser, as diagram-js's popup menu.
 *
 * This replaces the bespoke `<relationship-type-picker>` Lit component and its
 * tests. The coverage carried over is the same set of questions — one option per
 * ranked candidate, in order; the current type marked; each candidate explaining
 * itself; picking one changes the model; picking the current one changes nothing
 * — asked of {@link RdfReplaceMenuProvider} and of the live `popupMenu` service
 * instead of a shadow root.
 *
 * Two things the component could not be asked at all are asked here: whether the
 * menu is *empty* (which is what gates the context pad entry), and whether the
 * change is undoable.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { DiagramCanvas, type DiagramCanvasOptions } from '../diagram-canvas.js';
import {
  RdfReplaceMenuProvider,
  RELATIONSHIP_REPLACE_MENU_ID,
  ENTRY_CLASS,
  ENTRY_CLASS_CURRENT,
  ENTRY_GROUP,
  relationshipEntryId,
  type RelationshipReplaceContext,
} from '../rdf-replace-menu-provider.js';
import { RETYPE_RELATIONSHIP_COMMAND } from '../rdf-modeling.js';
import { EventBus } from '../../event-bus.js';
import type {
  ElementManager,
  RelationshipManager,
  Bounds,
} from '../../../model-manager/interfaces.js';
import type {
  PaletteDefinition,
  RelationshipTypeInfo,
} from '../../../metamodel-manager/interfaces.js';
import { RENDER_CLASSES } from '../rdf-renderer.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const { namedNode, quad } = DataFactory;

const MODEL_IRI = 'https://example.org/model/test';
const MM = 'https://example.org/mm#';
const TYPE_A = `${MM}TypeA`;
const TYPE_B = `${MM}TypeB`;

const SERVING = `${MM}Serving`;
const SERVES = `${MM}serves`;
const ASSOCIATION = `${MM}Association`;
const ASSOCIATED_WITH = `${MM}associatedWith`;

const SRC = 'https://example.org/model/src';
const TGT = 'https://example.org/model/tgt';

const BOUNDS: Bounds = { x: 0, y: 0, width: 120, height: 55 };

let created: DiagramCanvas[] = [];

afterEach(() => {
  for (const canvas of created) canvas.destroy();
  created = [];
  document.body.innerHTML = '';
});

// ── Fixtures ──────────────────────────────────────────────────────────

function palette(): PaletteDefinition {
  return {
    elementGroups: [
      {
        category: 'Test',
        elements: [
          { iri: TYPE_A, label: 'Type A', isAbstract: false },
          { iri: TYPE_B, label: 'Type B', isAbstract: false },
        ],
      },
    ],
    relationshipTypes: [
      {
        iri: SERVING,
        label: 'Serving',
        domainTypes: [TYPE_A],
        rangeTypes: [TYPE_B],
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
        domainTypes: [TYPE_A],
        rangeTypes: [TYPE_B],
        unqualifiedPredicateIri: ASSOCIATED_WITH,
      },
    ],
  };
}

/** Two candidates, ranked and explained, the way the manager reports them. */
function rankedCandidates(): RelationshipTypeInfo[] {
  const [serving, association] = palette().relationshipTypes;
  return [
    {
      ...serving,
      score: 10,
      preference: 'drawn',
      reason: 'Allowed because Type A matches Active Structure Element.',
    },
    {
      ...association,
      score: 6,
      preference: 'fallback',
      reason: 'Allowed because the metamodel declares no constraint.',
    },
  ];
}

/** One candidate: nothing to choose. */
function singleCandidate(): RelationshipTypeInfo[] {
  return [rankedCandidates()[0]];
}

// ── The provider on its own ───────────────────────────────────────────

function providerOver(
  candidates: RelationshipTypeInfo[],
  context?: Partial<RelationshipReplaceContext> | null,
): {
  provider: RdfReplaceMenuProvider;
  retyped: Array<{ connectionId: string; typeIri: string }>;
} {
  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn().mockReturnValue(candidates),
    createRelationship: vi.fn(),
    deleteRelationship: vi.fn(),
  };
  const retyped: Array<{ connectionId: string; typeIri: string }> = [];

  const resolved: RelationshipReplaceContext | undefined =
    context === null
      ? undefined
      : {
          connectionId: 'connection-1',
          sourceTypeIri: TYPE_A,
          targetTypeIri: TYPE_B,
          currentTypeIri: SERVING,
          ...context,
        };

  return {
    provider: new RdfReplaceMenuProvider(
      relationshipManager,
      () => resolved,
      (connectionId, typeIri) => retyped.push({ connectionId, typeIri }),
    ),
    retyped,
  };
}

describe('RdfReplaceMenuProvider', () => {
  it('offers one entry per ranked candidate, in the order given', () => {
    const { provider } = providerOver(rankedCandidates());

    const entries = provider.getPopupMenuEntries({ id: 'connection-1' });

    expect(Object.keys(entries)).toEqual([
      relationshipEntryId(SERVING),
      relationshipEntryId(ASSOCIATION),
    ]);
    expect(Object.values(entries).map((entry) => entry.label)).toEqual([
      'Serving',
      'Association',
    ]);
  });

  it('puts every entry in one group, so nothing reorders the ranking', () => {
    const { provider } = providerOver(rankedCandidates());

    const groups = Object.values(provider.getPopupMenuEntries({ id: 'connection-1' })).map(
      (entry) => entry.group,
    );

    expect(new Set(groups)).toEqual(new Set([ENTRY_GROUP]));
  });

  it('marks the current type and leaves the others unmarked', () => {
    const { provider } = providerOver(rankedCandidates());

    const entries = provider.getPopupMenuEntries({ id: 'connection-1' });

    expect(entries[relationshipEntryId(SERVING)].className).toContain(ENTRY_CLASS_CURRENT);
    expect(entries[relationshipEntryId(ASSOCIATION)].className).toBe(ENTRY_CLASS);
    expect(entries[relationshipEntryId(SERVING)].description).toContain('current');
  });

  it('says in words why each entry ranks where it does, with the metamodel reason', () => {
    const { provider } = providerOver(rankedCandidates());

    const entries = provider.getPopupMenuEntries({ id: 'connection-1' });

    // Serving is the connection's current type, which the entry says too.
    const serving = entries[relationshipEntryId(SERVING)];
    expect(serving.description).toMatch(/^drawn in the metamodel · current — /);
    expect(serving.description).toContain('Active Structure Element');
    expect(serving.title).toBe('Serving (drawn in the metamodel, current)');
    expect(entries[relationshipEntryId(ASSOCIATION)].description).toMatch(/^always permitted — /);
    // The search box matches label plus reason, which is the point of `search`.
    expect(serving.search).toContain('Serving');
    expect(serving.search).toContain('Active Structure Element');
  });

  it('gives a relationship the tables simply permit no note, and marks one only a derivation gives', () => {
    const [serving, association] = rankedCandidates();
    const { provider } = providerOver([
      { ...serving, preference: 'derived', direct: false },
      { ...association, preference: 'direct' },
    ]);

    const entries = provider.getPopupMenuEntries({ id: 'connection-1' });

    expect(entries[relationshipEntryId(ASSOCIATION)].description).toBe(association.reason);
    expect(entries[relationshipEntryId(ASSOCIATION)].title).toBe('Association');
    expect(entries[relationshipEntryId(SERVING)].description).toMatch(/^only by derivation · current — /);
  });

  it('triggering an entry asks for the retype and mutates nothing itself', () => {
    const { provider, retyped } = providerOver(rankedCandidates());
    const entries = provider.getPopupMenuEntries({ id: 'connection-1' });

    entries[relationshipEntryId(ASSOCIATION)].action({});

    expect(retyped).toEqual([{ connectionId: 'connection-1', typeIri: ASSOCIATION }]);
  });

  it('offers nothing when the pair admits a single type', () => {
    const { provider } = providerOver(singleCandidate());

    expect(provider.getPopupMenuEntries({ id: 'connection-1' })).toEqual({});
  });

  it('offers nothing when the pair admits no type', () => {
    const { provider } = providerOver([]);

    expect(provider.getPopupMenuEntries({ id: 'connection-1' })).toEqual({});
  });

  it('offers nothing for a target that is not a known connection', () => {
    const { provider } = providerOver(rankedCandidates(), null);

    expect(provider.getPopupMenuEntries({ id: 'shape-1' })).toEqual({});
  });

  it('offers nothing for a multi-element target', () => {
    const { provider } = providerOver(rankedCandidates());

    // The canvas's resolver refuses arrays; assert on that contract directly.
    const multi = new RdfReplaceMenuProvider(
      { getValidRelationships: vi.fn(), createRelationship: vi.fn(), deleteRelationship: vi.fn() },
      () => undefined,
      () => undefined,
    );
    expect(multi.getPopupMenuEntries([{ id: 'a' }, { id: 'b' }])).toEqual({});
    expect(provider.getPopupMenuEntries({ id: 'connection-1' })).not.toEqual({});
  });

  it('shows each type with its icon from the palette — published or drawn from its notation', () => {
    const relationshipManager: RelationshipManager = {
      getValidRelationships: vi.fn().mockReturnValue(rankedCandidates()),
      createRelationship: vi.fn(),
      deleteRelationship: vi.fn(),
    };
    const drawn = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';
    const provider = new RdfReplaceMenuProvider(
      relationshipManager,
      () => ({ connectionId: 'connection-1', sourceTypeIri: TYPE_A, targetTypeIri: TYPE_B, currentTypeIri: SERVING }),
      () => undefined,
      (iri) => (iri === SERVING ? drawn : undefined),
    );
    const entries = Object.values(provider.getPopupMenuEntries({ id: 'connection-1' }));
    expect(entries.find((e) => e.label === 'Serving')?.imageUrl).toBe(drawn);
    expect(entries.filter((e) => e.imageUrl)).toHaveLength(1);
  });

  it('gives every entry a selector-safe id derived from the type IRI', () => {
    expect(relationshipEntryId(SERVING)).toBe('replace-https-example-org-mm-Serving');
    expect(relationshipEntryId(SERVING)).toMatch(/^[a-zA-Z0-9-]+$/);
  });
});

// ── Against a live canvas ─────────────────────────────────────────────

interface Fixture {
  canvas: DiagramCanvas;
  container: HTMLElement;
  eventBus: EventBus;
  relationshipManager: RelationshipManager;
  triples(): string[];
  service<T>(name: string): T;
  connectionId(): string;
  connection(): unknown;
}

function fixture(options?: {
  candidates?: RelationshipTypeInfo[];
  qualifiedRelationshipIri?: string;
  overrides?: Partial<DiagramCanvasOptions>;
}): Fixture {
  const quads: Quad[] = [];
  let minted = 0;

  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn().mockReturnValue(options?.candidates ?? rankedCandidates()),
    createRelationship: vi.fn((typeIri: string, sourceIri: string, targetIri: string) => {
      quads.push(
        quad(namedNode(sourceIri), namedNode(typeIri), namedNode(targetIri)) as unknown as Quad,
      );
      return options?.qualifiedRelationshipIri
        ? (namedNode(
            `${options.qualifiedRelationshipIri}-${++minted}`,
          ) as unknown as NamedNode)
        : null;
    }),
    deleteRelationship: vi.fn(),
  };

  const elementManager: ElementManager = {
    createElement: vi.fn(() => namedNode(`${MM}new`) as unknown as NamedNode),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const eventBus = new EventBus();

  const canvas = new DiagramCanvas({
    container,
    eventBus,
    elementManager,
    relationshipManager,
    paletteDefinition: palette(),
    modelIri: MODEL_IRI,
    rdfStore: {
      getQuads: (s, p, o) =>
        quads.filter(
          (q) =>
            (!s || q.subject.value === (s as NamedNode).value) &&
            (!p || q.predicate.value === (p as NamedNode).value) &&
            (!o || q.object.value === (o as NamedNode).value),
        ),
      removeQuads: (toRemove) => {
        for (const q of toRemove as unknown as Quad[]) {
          const index = quads.indexOf(q);
          if (index >= 0) quads.splice(index, 1);
        }
      },
    },
    ...options?.overrides,
  });
  created.push(canvas);

  canvas.addElement(SRC, TYPE_A, BOUNDS);
  canvas.addElement(TGT, TYPE_B, { ...BOUNDS, x: 400 });

  const resolve = <T,>(name: string): T => {
    const diagram = canvas.getDiagram();
    if (!diagram) throw new Error('canvas has no diagram');
    return (diagram as unknown as { get(n: string): T }).get(name);
  };

  return {
    canvas,
    container,
    eventBus,
    relationshipManager,
    triples: () => quads.map((q) => `${q.subject.value}|${q.predicate.value}|${q.object.value}`),
    service: resolve,
    connectionId: () => [...canvas.getRelationships().keys()][0],
    connection: () =>
      resolve<{ get(id: string): unknown }>('elementRegistry').get(
        [...canvas.getRelationships().keys()][0],
      ),
  };
}

interface DjsModeling {
  connect(source: unknown, target: unknown, attrs?: unknown): { id: string } | undefined;
}

/** Draw a connection the way the connect tool does. */
function connect(f: Fixture): { id: string } {
  const registry = f.service<{ get(id: string): unknown }>('elementRegistry');
  const connection = f
    .service<DjsModeling>('modeling')
    .connect(registry.get(SRC), registry.get(TGT));
  if (!connection) throw new Error('no connection was created');
  return connection;
}

/** Every drawn connection. */
function connections(f: Fixture): unknown[] {
  return f
    .service<{ getAll(): Array<{ waypoints?: unknown }> }>('elementRegistry')
    .getAll()
    .filter((element) => element.waypoints);
}

interface DjsPopupMenu {
  isEmpty(target: unknown, providerId: string): boolean;
  isOpen(): boolean;
  open(target: unknown, providerId: string, position: unknown, options?: unknown): void;
  close(): void;
  trigger(event: Event, entry?: unknown, action?: string): unknown;
}

interface PadEntries {
  [key: string]: { title: string; className: string; action: unknown };
}

function padEntries(f: Fixture): PadEntries {
  return f.canvas.contextPadProvider.getContextPadEntries(f.connection() as never) as PadEntries;
}

describe('the popup menu is wired to the canvas', () => {
  it('registers the relationship-replace provider with the popupMenu service', () => {
    const f = fixture();
    connect(f);

    expect(f.canvas.replaceMenuProvider).toBeInstanceOf(RdfReplaceMenuProvider);
    expect(
      f.service<DjsPopupMenu>('popupMenu').isEmpty(f.connection(), RELATIONSHIP_REPLACE_MENU_ID),
    ).toBe(false);
  });

  it('isEmpty is true when the pair admits a single type', () => {
    const f = fixture({ candidates: singleCandidate() });
    connect(f);

    expect(
      f.service<DjsPopupMenu>('popupMenu').isEmpty(f.connection(), RELATIONSHIP_REPLACE_MENU_ID),
    ).toBe(true);
  });

  it('isEmpty is true for a shape, which has no relationship type at all', () => {
    const f = fixture();
    const shape = f.service<{ get(id: string): unknown }>('elementRegistry').get(SRC);

    expect(
      f.service<DjsPopupMenu>('popupMenu').isEmpty(shape, RELATIONSHIP_REPLACE_MENU_ID),
    ).toBe(true);
  });

  it('opening renders one row per candidate, current one flagged', () => {
    const f = fixture();
    connect(f);

    f.service<DjsPopupMenu>('popupMenu').open(
      f.connection(),
      RELATIONSHIP_REPLACE_MENU_ID,
      { x: 10, y: 10 },
      { title: 'Change relationship type' },
    );

    const rows = [...f.container.querySelectorAll('.djs-popup .entry')];
    expect(rows.map((row) => row.getAttribute('data-id'))).toEqual([
      relationshipEntryId(SERVING),
      relationshipEntryId(ASSOCIATION),
    ]);
    expect(rows[0].querySelector(`.${ENTRY_CLASS_CURRENT}`)).not.toBeNull();
    expect(rows[1].querySelector(`.${ENTRY_CLASS_CURRENT}`)).toBeNull();
    // Every row explains itself, which is why `reason` is carried this far.
    expect(f.container.querySelector('.djs-popup-entry-description')!.textContent).toContain(
      'Active Structure Element',
    );
  });

  it('clicking a row retypes the connection and closes the menu', () => {
    const f = fixture();
    connect(f);
    const popupMenu = f.service<DjsPopupMenu>('popupMenu');
    popupMenu.open(f.connection(), RELATIONSHIP_REPLACE_MENU_ID, { x: 10, y: 10 });

    const row = f.container.querySelector<HTMLElement>(
      `.djs-popup .entry[data-id="${relationshipEntryId(ASSOCIATION)}"]`,
    )!;
    row.click();

    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATED_WITH}|${TGT}`]);
    expect([...f.canvas.getRelationships().values()][0].typeIri).toBe(ASSOCIATION);
    // One connection, relabelled rather than replaced.
    expect(connections(f)).toHaveLength(1);
    expect(f.container.querySelectorAll(`.${RENDER_CLASSES.connection}`)).toHaveLength(1);
    expect(popupMenu.isOpen()).toBe(false);
  });

  it('clicking the current type changes nothing and still closes the menu', () => {
    const f = fixture();
    connect(f);
    const popupMenu = f.service<DjsPopupMenu>('popupMenu');
    popupMenu.open(f.connection(), RELATIONSHIP_REPLACE_MENU_ID, { x: 10, y: 10 });

    f.container
      .querySelector<HTMLElement>(
        `.djs-popup .entry[data-id="${relationshipEntryId(SERVING)}"]`,
      )!
      .click();

    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
    expect(popupMenu.isOpen()).toBe(false);
  });

  it('does not auto-open on connection creation', () => {
    // bpmn-js opens the replace menu only from an explicit pad click, and here
    // there is a mechanical reason to match it: `commandStack.changed` is one of
    // the menu's auto-close events and fires after every `postExecuted` handler,
    // so a menu opened from that phase would be shut again immediately.
    const f = fixture();

    connect(f);

    expect(f.service<DjsPopupMenu>('popupMenu').isOpen()).toBe(false);
    expect(f.container.querySelector('.djs-popup')).toBeNull();
  });

  it('does not auto-open when a connection is selected either', () => {
    const f = fixture();
    connect(f);

    f.service<{ select(element: unknown): void }>('selection').select(f.connection());

    expect(f.service<DjsPopupMenu>('popupMenu').isOpen()).toBe(false);
  });
});

describe('the context pad replace entry', () => {
  it('appears for a connection whose pair admits a choice, and names the current type', () => {
    const f = fixture();
    connect(f);

    const entry = padEntries(f)['replace'];
    expect(entry).toBeDefined();
    expect(entry.title).toBe('Change relationship type: Serving');
    expect(entry.className).toBe('context-pad-replace');
  });

  it('follows a type change', () => {
    const f = fixture();
    connect(f);
    f.canvas.changeRelationshipType(f.connectionId(), ASSOCIATION);

    expect(padEntries(f)['replace'].title).toBe('Change relationship type: Association');
  });

  it('is absent when the pair admits a single type', () => {
    const f = fixture({ candidates: singleCandidate() });
    connect(f);

    expect(padEntries(f)['replace']).toBeUndefined();
    // Delete is still offered, so the connection is not left unmanageable.
    expect(padEntries(f)['delete']).toBeDefined();
  });

  it('triggering it opens the popup menu', () => {
    const f = fixture();
    connect(f);

    (padEntries(f)['replace'].action as (event: unknown) => void)({ x: 40, y: 60 });

    expect(f.service<DjsPopupMenu>('popupMenu').isOpen()).toBe(true);
    expect(f.container.querySelectorAll('.djs-popup .entry')).toHaveLength(2);
  });

  it('is offered on the real contextPad service, not just the provider', () => {
    const f = fixture();
    connect(f);

    const entries = f
      .service<{ getEntries(target: unknown): Record<string, unknown> }>('contextPad')
      .getEntries(f.connection());

    expect(Object.keys(entries)).toContain('replace');
  });
});

describe('retyping is one undoable command', () => {
  it('runs through rdf.relationship.retype', () => {
    const f = fixture();
    connect(f);

    expect(
      f.service<{ _handlerMap: Record<string, unknown> }>('commandStack')._handlerMap[
        RETYPE_RELATIONSHIP_COMMAND
      ],
    ).toBeDefined();

    const commands: string[] = [];
    f.service<{ on(event: string, cb: (e: never) => void): void }>('eventBus').on(
      'commandStack.execute',
      (event: { command?: string }) => commands.push(event.command ?? ''),
    );

    f.canvas.changeRelationshipType(f.connectionId(), ASSOCIATION);

    expect(commands).toEqual([RETYPE_RELATIONSHIP_COMMAND]);
  });

  it('undo restores the previous type and its triple', () => {
    const f = fixture();
    connect(f);
    const connectionId = f.connectionId();

    f.canvas.changeRelationshipType(connectionId, ASSOCIATION);
    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATED_WITH}|${TGT}`]);

    f.service<{ undo(): void }>('commandStack').undo();

    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
    expect(f.canvas.getRelationships().get(connectionId)).toMatchObject({
      typeIri: SERVING,
      predicateIri: SERVES,
    });
    // The connection survived: same id, still exactly one line drawn.
    expect(connections(f)).toHaveLength(1);
    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)!.getAttribute(
      'data-type-iri',
    )).toBe(SERVING);
  });

  it('redo re-applies the change', () => {
    const f = fixture();
    connect(f);
    const connectionId = f.connectionId();
    const commandStack = f.service<{ undo(): void; redo(): void }>('commandStack');

    f.canvas.changeRelationshipType(connectionId, ASSOCIATION);
    commandStack.undo();
    commandStack.redo();

    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATED_WITH}|${TGT}`]);
    expect(f.canvas.getRelationships().get(connectionId)).toMatchObject({
      typeIri: ASSOCIATION,
      predicateIri: ASSOCIATED_WITH,
    });
    expect(connections(f)).toHaveLength(1);
  });

  it('undoing the retype and then the connect leaves nothing behind', () => {
    const f = fixture();
    connect(f);
    const commandStack = f.service<{ undo(): void }>('commandStack');

    f.canvas.changeRelationshipType(f.connectionId(), ASSOCIATION);
    commandStack.undo();
    commandStack.undo();

    expect(f.triples()).toEqual([]);
    expect(connections(f)).toHaveLength(0);
    expect(f.canvas.getRelationships().size).toBe(0);
  });

  it('retracts the qualified relationship resource on the way out and back', () => {
    const f = fixture({ qualifiedRelationshipIri: `${MM}rel` });
    connect(f);

    f.canvas.changeRelationshipType(f.connectionId(), ASSOCIATION);
    // The Serving resource minted by the connect is the one retracted.
    expect(f.relationshipManager.deleteRelationship).toHaveBeenCalledWith(`${MM}rel-1`);

    f.service<{ undo(): void }>('commandStack').undo();

    // Undo retracts the Association resource the retype minted, then re-mints
    // Serving — so the connection's IRI follows the resource that exists.
    expect(f.relationshipManager.deleteRelationship).toHaveBeenCalledWith(`${MM}rel-2`);
    expect(
      (f.connection() as { businessObject?: { iri: string } }).businessObject?.iri,
    ).toBe(`${MM}rel-3`);
  });

  it('is refused, and puts nothing on the stack, for a type the pair does not admit', () => {
    const f = fixture();
    connect(f);
    const commandStack = f.service<{ canUndo(): boolean; undo(): void }>('commandStack');

    expect(f.canvas.changeRelationshipType(f.connectionId(), `${MM}Access`)).toBe(false);

    commandStack.undo();
    // The only thing on the stack was the connect, so undoing it empties the canvas.
    expect(connections(f)).toHaveLength(0);
  });

  it('is refused when the type is unchanged', () => {
    const f = fixture();
    connect(f);

    expect(f.canvas.changeRelationshipType(f.connectionId(), SERVING)).toBe(false);
    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
  });

  it('is refused for an unknown connection', () => {
    const f = fixture();

    expect(f.canvas.changeRelationshipType('no-such-connection', ASSOCIATION)).toBe(false);
  });
});

// ── The diagram-js features that were shipped but never wired up ──────

describe('newly registered diagram-js features', () => {
  it.each([
    'connectionPreview',
    'createMoveSnapping',
    'resizeSnapping',
    'snapping',
    'keyboard',
    'keyboardBindings',
    'editorActions',
    'popupMenu',
  ])('resolves the %s service', (name) => {
    const f = fixture();
    expect(f.service<unknown>(name)).toBeDefined();
  });

  it('the connect tool draws a live preview, because connectionPreview exists', () => {
    const f = fixture();
    // `ConnectPreview` is registered by the connect module but only does anything
    // when `connectionPreview` resolves, which is what this module adds.
    expect(f.service<unknown>('connectPreview')).toBeDefined();
    expect(
      f.service<{ drawPreview(...args: never[]): void }>('connectionPreview').drawPreview,
    ).toBeInstanceOf(Function);
  });

  it('editorActions registers undo and redo', () => {
    const f = fixture();
    const editorActions = f.service<{ getActions(): string[] }>('editorActions');

    expect(editorActions.getActions()).toEqual(
      expect.arrayContaining(['undo', 'redo', 'zoom', 'stepZoom', 'removeSelection']),
    );
  });

  it('undo and redo are reachable by triggering the editor action', () => {
    const f = fixture();
    connect(f);
    const editorActions = f.service<{ trigger(action: string, opts?: unknown): unknown }>(
      'editorActions',
    );

    f.canvas.changeRelationshipType(f.connectionId(), ASSOCIATION);

    editorActions.trigger('undo');
    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);

    editorActions.trigger('redo');
    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATED_WITH}|${TGT}`]);
  });

  it('keyboard is bound to a node, which diagram-js alone never does', () => {
    // `Keyboard` binds itself on the `attach` event; nothing in diagram-js fires
    // it (only bpmn-js's BaseViewer does), so `config.keyboard.bindTo` on its own
    // leaves the bindings dead. The canvas binds explicitly.
    const f = fixture();

    expect(f.service<{ getBinding(): EventTarget | null }>('keyboard').getBinding()).toBe(
      document,
    );
  });

  it('a Ctrl+Z keydown on the bound node undoes through editorActions', () => {
    const f = fixture();
    connect(f);
    f.canvas.changeRelationshipType(f.connectionId(), ASSOCIATION);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );

    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
  });

  it('honours an explicit keyboard binding target', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const f = fixture({ overrides: { keyboardBindTo: host } });

    expect(f.service<{ getBinding(): EventTarget | null }>('keyboard').getBinding()).toBe(host);
  });

  it('binds nothing when asked not to', () => {
    const f = fixture({ overrides: { keyboardBindTo: null } });

    // `Keyboard` reports its node as `undefined` until it has ever been bound,
    // and `null` after an unbind; either way, nothing is listening.
    const binding = f.service<{ getBinding(): EventTarget | null }>('keyboard').getBinding();
    expect(binding ?? null).toBeNull();
  });

  it('unbinds the keyboard on destroy, so a torn-down canvas stops listening', () => {
    const f = fixture();
    const keyboard = f.service<{ getBinding(): EventTarget | null }>('keyboard');

    f.canvas.destroy();

    expect(keyboard.getBinding()).toBeNull();
  });
});
