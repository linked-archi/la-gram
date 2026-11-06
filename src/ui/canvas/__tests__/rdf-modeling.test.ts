// @vitest-environment jsdom

/**
 * `RdfModeling.connect` — a connection born with its relationship type.
 *
 * These run against a real diagram-js instance, so the assertions are about the
 * command stack rather than about a wrapper: what the connection looks like the
 * moment `connection.create` has executed, what the store holds afterwards, and
 * what `commandStack.undo()` puts back.
 *
 * The distinguishing test is
 * "the type is on the business object before any post-hoc hook could set it":
 * it reads the connection from a `connection.create.postExecuted` listener, the
 * exact phase the old `onConnectionCreated` patch used to run in. A later patch
 * therefore cannot account for the value it sees.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import { DiagramCanvas, type DiagramCanvasOptions } from '../diagram-canvas.js';
import { RDF_RELATIONSHIP_HINT } from '../rdf-modeling.js';
import { relationshipKey } from '../relationship-resolution.js';
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

// ── Fixture ───────────────────────────────────────────────────────────

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

/** Ranked candidates: Serving wins, Association trails, as the manager ranks. */
function rankedCandidates(): RelationshipTypeInfo[] {
  return palette().relationshipTypes.map((rel, index) => ({
    ...rel,
    score: 10 - index * 4,
    reason: `matched ${rel.label}`,
  }));
}

interface Fixture {
  canvas: DiagramCanvas;
  container: HTMLElement;
  eventBus: EventBus;
  relationshipManager: RelationshipManager;
  /** Triples the relationship manager wrote, as `s|p|o`. */
  triples(): string[];
  /** A diagram-js service off the live canvas. */
  service<T>(name: string): T;
}

/**
 * A canvas with a TypeA source and a TypeB target already drawn.
 *
 * `candidates` decides what the metamodel is taken to allow, and
 * `qualifiedRelationshipIri` switches the manager between writing a direct
 * triple (returning `null`) and minting a relationship resource.
 */
function fixture(options?: {
  candidates?: RelationshipTypeInfo[];
  qualifiedRelationshipIri?: string;
  overrides?: Partial<DiagramCanvasOptions>;
}): Fixture {
  const quads: Quad[] = [];

  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn().mockReturnValue(options?.candidates ?? rankedCandidates()),
    createRelationship: vi.fn((typeIri: string, sourceIri: string, targetIri: string) => {
      quads.push(
        quad(namedNode(sourceIri), namedNode(typeIri), namedNode(targetIri)) as unknown as Quad,
      );
      return options?.qualifiedRelationshipIri
        ? (namedNode(options.qualifiedRelationshipIri) as unknown as NamedNode)
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
    triples: () =>
      quads.map((q) => `${q.subject.value}|${q.predicate.value}|${q.object.value}`),
    service: resolve,
  };
}

interface DjsConnection {
  id: string;
  businessObject?: { iri: string; typeIri: string; kind?: string };
}

interface DjsModeling {
  connect(
    source: unknown,
    target: unknown,
    attrs?: Record<string, unknown> | null,
    hints?: Record<string, unknown>,
  ): DjsConnection | undefined;
}

interface DjsRegistry {
  get(id: string): unknown;
  getAll(): Array<{ waypoints?: unknown }>;
}

/** `modeling.connect(src, tgt, attrs?)` on the fixture's shapes. */
function connect(f: Fixture, attrs?: Record<string, unknown> | null): DjsConnection | undefined {
  const registry = f.service<DjsRegistry>('elementRegistry');
  return f
    .service<DjsModeling>('modeling')
    .connect(registry.get(SRC), registry.get(TGT), attrs);
}

/** Every drawn connection. */
function connections(f: Fixture): Array<{ waypoints?: unknown }> {
  return f.service<DjsRegistry>('elementRegistry').getAll().filter((e) => e.waypoints);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('the modeling service is the RDF-aware one', () => {
  it('replaces diagram-js default modeling and registers the RDF command', () => {
    const f = fixture();

    const modeling = f.service<DjsModeling & { getHandlers(): Record<string, unknown> }>(
      'modeling',
    );

    expect(modeling.constructor.name).toBe('RdfModeling');
    expect(Object.keys(modeling.getHandlers())).toContain('rdf.relationship.create');
    // The command is registered with the stack, not merely listed.
    expect(
      f.service<{ _handlerMap: Record<string, unknown> }>('commandStack')._handlerMap[
        'rdf.relationship.create'
      ],
    ).toBeDefined();
  });
});

describe('connect with no attributes', () => {
  it('creates a connection of the type the rules chose', () => {
    const f = fixture();

    const connection = connect(f);

    expect(connection).toBeDefined();
    expect(connection!.businessObject?.typeIri).toBe(SERVING);
    expect(connections(f)).toHaveLength(1);
    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).not.toBeNull();
  });

  it('the type is on the business object before any post-hoc hook could set it', () => {
    const f = fixture();
    const seen: Array<string | undefined> = [];

    f.service<{ on(event: string, cb: (e: never) => void): void }>('eventBus').on(
      'commandStack.connection.create.postExecuted',
      (event: { context?: { connection?: DjsConnection } }) => {
        seen.push(event.context?.connection?.businessObject?.typeIri);
      },
    );

    connect(f);

    // Read in the very phase the old patch ran in, so the value cannot be the
    // patch's work.
    expect(seen).toEqual([SERVING]);
  });

  it('writes the direct triple with the unqualified predicate', () => {
    const f = fixture();

    connect(f);

    expect(f.relationshipManager.createRelationship).toHaveBeenCalledWith(SERVES, SRC, TGT);
    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
  });

  it('registers the relationship under the connection it drew', () => {
    const f = fixture();

    const connection = connect(f)!;

    const relationship = f.canvas.getRelationships().get(connection.id);
    expect(relationship).toMatchObject({
      sourceIri: SRC,
      targetIri: TGT,
      typeIri: SERVING,
      predicateIri: SERVES,
    });
  });

  it('carries the triple identity as the business object IRI, or the minted one', () => {
    const direct = fixture();
    expect(connect(direct)!.businessObject?.iri).toBe(relationshipKey(SRC, TGT, SERVING));

    const qualified = fixture({ qualifiedRelationshipIri: `${MM}rel-1` });
    expect(connect(qualified)!.businessObject?.iri).toBe(`${MM}rel-1`);
  });

  it('passes the ranked candidates along as a hint, matching the rules answer', () => {
    const f = fixture();
    const hints: Array<Record<string, unknown> | undefined> = [];

    f.service<{ on(event: string, cb: (e: never) => void): void }>('eventBus').on(
      'commandStack.connection.create.postExecuted',
      (event: { context?: { hints?: Record<string, unknown> } }) => {
        hints.push(event.context?.hints);
      },
    );

    connect(f);

    const relationship = hints[0]?.[RDF_RELATIONSHIP_HINT] as
      | { candidates: RelationshipTypeInfo[] }
      | undefined;
    expect(relationship?.candidates.map((c) => c.iri)).toEqual([SERVING, ASSOCIATION]);
  });
});

describe('connect with explicit attributes', () => {
  it('uses the given type and does not consult the rules', () => {
    const f = fixture();
    const canConnect = vi.spyOn(f.canvas.ruleProvider, 'canConnect');

    const connection = connect(f, {
      typeIri: ASSOCIATION,
      unqualifiedPredicateIri: ASSOCIATED_WITH,
    });

    expect(connection!.businessObject?.typeIri).toBe(ASSOCIATION);
    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATED_WITH}|${TGT}`]);
    expect(canConnect).not.toHaveBeenCalled();
  });

  it('falls back to the type IRI as predicate when no unqualified form is given', () => {
    const f = fixture();

    connect(f, { typeIri: ASSOCIATION });

    expect(f.triples()).toEqual([`${SRC}|${ASSOCIATION}|${TGT}`]);
  });
});

describe('undo', () => {
  it('removes the connection and the triple as one unit', () => {
    const f = fixture();
    const connection = connect(f)!;
    expect(f.triples()).toHaveLength(1);

    f.service<{ undo(): void }>('commandStack').undo();

    expect(f.service<DjsRegistry>('elementRegistry').get(connection.id)).toBeUndefined();
    expect(connections(f)).toHaveLength(0);
    expect(f.triples()).toEqual([]);
    expect(f.canvas.getRelationships().size).toBe(0);
    expect(f.container.querySelector(`.${RENDER_CLASSES.connection}`)).toBeNull();
  });

  it('deletes the qualified relationship resource when the model minted one', () => {
    const f = fixture({ qualifiedRelationshipIri: `${MM}rel-1` });
    connect(f);

    f.service<{ undo(): void }>('commandStack').undo();

    expect(f.relationshipManager.deleteRelationship).toHaveBeenCalledWith(`${MM}rel-1`);
  });

  it('redo puts both back', () => {
    const f = fixture();
    connect(f);
    const commandStack = f.service<{ undo(): void; redo(): void }>('commandStack');

    commandStack.undo();
    commandStack.redo();

    expect(connections(f)).toHaveLength(1);
    expect(f.triples()).toEqual([`${SRC}|${SERVES}|${TGT}`]);
    expect(f.canvas.getRelationships().size).toBe(1);
  });
});

describe('zero valid candidates', () => {
  it('draws nothing and writes nothing', () => {
    const f = fixture({ candidates: [] });

    expect(connect(f)).toBeUndefined();
    expect(connections(f)).toHaveLength(0);
    expect(f.relationshipManager.createRelationship).not.toHaveBeenCalled();
    expect(f.triples()).toEqual([]);
    expect(f.canvas.getRelationships().size).toBe(0);
  });
});

describe('the store to canvas direction', () => {
  it('addRelationship draws the connection without writing a second triple', () => {
    const f = fixture();

    // The relationship is already in RDF; the canvas only has to draw it.
    f.canvas.addRelationship(SRC, TGT, SERVING);

    expect(connections(f)).toHaveLength(1);
    expect(f.relationshipManager.createRelationship).not.toHaveBeenCalled();
    expect(f.triples()).toEqual([]);
    expect(f.canvas.getRelationships().get(relationshipKey(SRC, TGT, SERVING))).toMatchObject({
      typeIri: SERVING,
      predicateIri: SERVES,
    });
  });

  it('the drawn connection still carries its type', () => {
    const f = fixture();

    f.canvas.addRelationship(SRC, TGT, SERVING, `${MM}rel-9`);

    // A qualified relationship's connection is keyed by the relationship's own
    // IRI, so two relationships of one type between one pair stay two.
    const connection = f.service<DjsRegistry>('elementRegistry').get(
      `${MM}rel-9`,
    ) as DjsConnection;
    expect(connection.businessObject?.typeIri).toBe(SERVING);
    expect(connection.businessObject?.iri).toBe(`${MM}rel-9`);
  });
});
