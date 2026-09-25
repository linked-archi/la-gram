// @vitest-environment jsdom

/**
 * Drawing a relationship against the real bundled ArchiMate 4.0 metamodel.
 *
 * Nothing is stubbed except the SVG layout APIs jsdom lacks. The metamodel is
 * loaded off disk, the palette is generated from it, the real
 * `OxigraphRelationshipManager` writes the triples, and a connect drag is driven
 * through diagram-js to completion.
 *
 * ## What this test also documents
 *
 * `N3MetamodelLoader` loads every metamodel document into a **named graph**
 * keyed by its ontology IRI. Measured against the bundle that is 3 640 triples
 * across nine named graphs and **none** in the default graph, so an unscoped
 * SPARQL pattern — which in SPARQL means the default graph alone — matches no
 * metamodel at all. `OxigraphRelationshipManager` used to be written that way,
 * returned `[]` for every pair, and `RdfRuleProvider` consequently refused every
 * connection; a `withPaletteFallback` wrapper covered for it. The manager now
 * scopes its reads across the whole dataset, the wrapper is gone, and the canvas
 * below is wired to the bare manager so a scoping regression fails here rather
 * than being absorbed.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { N3TtlParser } from '../../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { N3MetamodelLoader } from '../../../metamodel-manager/metamodel-loader.js';
import { SparqlPaletteGenerator } from '../../../metamodel-manager/palette-generator.js';
import { OxigraphRelationshipManager } from '../../../model-manager/relationship-manager.js';
import { OxigraphElementManager } from '../../../model-manager/element-manager.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import type { ElementManager, Bounds } from '../../../model-manager/interfaces.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas } from '../diagram-canvas.js';
import {
  RELATIONSHIP_REPLACE_MENU_ID,
  relationshipEntryId,
} from '../rdf-replace-menu-provider.js';
import { APPEND_TARGET_MENU_ID, appendEntryId } from '../rdf-append-menu-provider.js';
import { RENDER_CLASSES } from '../rdf-renderer.js';
import { buildClassClosure } from '../relationship-resolution.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const { defaultGraph, namedNode } = DataFactory;

/**
 * Read the *model* triples only.
 *
 * `store.getQuads()` with no arguments spans every graph, so it would return the
 * whole metamodel. Model mutations land in the default graph, which is what this
 * scopes to — and what the teardown clears, so the metamodel survives between
 * tests.
 */
function defaultGraphQuads(store: OxigraphRdfStore) {
  return store.getQuads(null, null, null, defaultGraph() as unknown as NamedNode);
}

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const BUSINESS_ACTOR = `${AM4}BusinessActor`;
const ACTIVE_STRUCTURE = `${AM4}ActiveStructureElement`;

const ACTOR_A = 'https://example.org/model/actor-a';
const ACTOR_B = 'https://example.org/model/actor-b';

let palette: PaletteDefinition;
let store: OxigraphRdfStore;

beforeAll(async () => {
  store = new OxigraphRdfStore();
  const loader = new N3MetamodelLoader(new N3TtlParser(), store);
  const loaded = await loader.loadBundledMetamodel();
  palette = new SparqlPaletteGenerator(store).generatePalette(loaded.metamodelIri);
}, 60_000);

interface Fixture {
  canvas: DiagramCanvas;
  container: HTMLElement;
  /** Model triples only — the metamodel lives in named graphs. */
  modelTriples(): string[];
}

let mounted: DiagramCanvas | undefined;

afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
  // Drop the model triples the test wrote; leave the metamodel graphs alone.
  store.removeQuads(defaultGraphQuads(store));
});

function mount(): Fixture {
  const container = document.createElement('div');
  document.body.appendChild(container);

  // The real manager, over the real store: an appended element gets its own IRI
  // and its own triples, and they land in the default graph the teardown clears.
  const elementManager: ElementManager = new OxigraphElementManager(store);

  const closure = buildClassClosure(store);
  // The real manager, unwrapped: nothing stands between the canvas and its SPARQL.
  const relationshipManager = new OxigraphRelationshipManager(store);

  const canvas = new DiagramCanvas({
    container,
    eventBus: new EventBus(),
    elementManager,
    relationshipManager,
    paletteDefinition: palette,
    modelIri: 'https://example.org/model/test',
    classClosure: closure,
    rdfStore: store,
  });
  mounted = canvas;

  const bounds: Bounds = { x: 0, y: 0, width: 120, height: 55 };
  canvas.addElement(ACTOR_A, BUSINESS_ACTOR, bounds);
  canvas.addElement(ACTOR_B, BUSINESS_ACTOR, { ...bounds, x: 400 });

  return {
    canvas,
    container,
    modelTriples: () =>
      defaultGraphQuads(store)
        .map((q) => `${q.subject.value}|${q.predicate.value}|${q.object.value}`)
        .sort(),
  };
}

/** The facts about a qualified relationship resource, with short predicate names. */
function qualifiedFacts(f: Fixture, relIri: string): string[] {
  const short = (p: string) =>
    p
      .replace('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rdf:')
      .replace('https://meta.linked.archi/core#', 'arch:');
  return f
    .modelTriples()
    .filter((t) => t.startsWith(`${relIri}|`))
    .map((t) => {
      const [, p, o] = t.split('|');
      return `${short(p)}|${o}`;
    })
    .sort();
}

/** Triples of the relationship kind only — the predicate is a published direct form. */
function relationshipTriples(f: Fixture): string[] {
  const directForms = new Set(
    palette.relationshipTypes.flatMap((rel) =>
      rel.unqualifiedPredicateIri ? [rel.unqualifiedPredicateIri, rel.iri] : [rel.iri],
    ),
  );
  return f.modelTriples().filter((triple) => directForms.has(triple.split('|')[1] ?? ''));
}

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

function canvasEvent(canvas: DiagramCanvas, x: number, y: number, type: string): unknown {
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

/** Start a connection from the context pad on actor A and drop it on actor B. */
function drawConnection(canvas: DiagramCanvas): void {
  const dragging = service<Dragging>(canvas, 'dragging');
  dragging.setOptions({ manual: true });

  const registry = service<{ get(id: string): unknown; getGraphics(e: unknown): unknown }>(
    canvas,
    'elementRegistry',
  );
  const source = registry.get(ACTOR_A);
  const target = registry.get(ACTOR_B);

  const action = canvas.contextPadProvider.getContextPadEntries(source as never)['connect']
    .action as { dragstart(event: unknown, target?: unknown, autoActivate?: boolean): void };
  action.dragstart(canvasEvent(canvas, 10, 10, 'dragstart'), source, false);

  dragging.move(canvasEvent(canvas, 420, 20, 'mousemove'));
  dragging.hover({ element: target, gfx: registry.getGraphics(target) });
  dragging.move(canvasEvent(canvas, 430, 25, 'mousemove'));
  dragging.end();
}

describe('bundled ArchiMate 4.0 → connect → RDF', () => {
  it('declares BusinessActor domains only against abstract superclasses', () => {
    // The premise of the closure fix: nothing names the concrete type.
    expect(palette.relationshipTypes.some((r) => r.domainTypes.includes(BUSINESS_ACTOR))).toBe(
      false,
    );
    expect(palette.relationshipTypes.some((r) => r.domainTypes.includes(ACTIVE_STRUCTURE))).toBe(
      true,
    );
  });

  it('the context pad offers Connect on a BusinessActor', () => {
    const { canvas } = mount();
    const shape = service<{ get(id: string): unknown }>(canvas, 'elementRegistry').get(ACTOR_A);

    expect(canvas.contextPadProvider.getContextPadEntries(shape as never)['connect']).toBeDefined();
  });

  it('offers a non-empty, ranked candidate list for BusinessActor → BusinessActor', () => {
    const { canvas } = mount();

    const candidates = canvas.relationshipCandidates(BUSINESS_ACTOR, BUSINESS_ACTOR);

    expect(candidates.length).toBeGreaterThan(1);
    // Ranked: monotonically non-increasing score, every entry explained.
    const scores = candidates.map((c) => c.score ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(candidates.every((c) => !!c.reason)).toBe(true);
    // Association carries the least meaning, so it must not be the default.
    expect(candidates[0].label).not.toBe('Association');

    // eslint-disable-next-line no-console
    console.log(
      'BusinessActor → BusinessActor candidates:',
      candidates.map((c) => `${c.label} (score ${c.score})`).join(', '),
    );
  });

  it('the relationship manager alone answers, even though the metamodel is in named graphs', () => {
    // No wrapper, no palette, no closure helper: just the manager and the store.
    const bare = new OxigraphRelationshipManager(store);

    // The graph layout that used to defeat it, still true: every triple loaded
    // sits in a named graph and the default graph is empty.
    expect(store.getQuads().length).toBeGreaterThan(3000);
    expect(defaultGraphQuads(store)).toHaveLength(0);

    const candidates = bare.getValidRelationships(BUSINESS_ACTOR, BUSINESS_ACTOR);

    expect(candidates.length).toBeGreaterThan(1);
    // Ranked, explained, and de-duplicated — one entry per relationship type
    // despite the scope evaluating each query twice.
    const scores = candidates.map((c) => c.score ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(candidates.every((c) => !!c.reason)).toBe(true);
    expect(new Set(candidates.map((c) => c.iri)).size).toBe(candidates.length);
    // Serving is the semantically expected answer for actor → actor, and it is
    // only reachable through the ActiveStructureElement closure.
    expect(candidates.map((c) => c.label)).toContain('Serving');
    // Association carries the least meaning, so it must not lead.
    expect(candidates[0].label).not.toBe('Association');
    expect(candidates[candidates.length - 1].label).toBe('Association');

    // eslint-disable-next-line no-console
    console.log(
      'bare manager, BusinessActor → BusinessActor:',
      candidates.map((c) => `${c.label} (score ${c.score})`).join(', '),
    );
  });

  it('completing a connect drag draws a connection and asserts the triple', () => {
    const f = mount();

    drawConnection(f.canvas);

    const line = f.container.querySelector(`.${RENDER_CLASSES.connection}`);
    expect(line).not.toBeNull();

    const relationships = [...f.canvas.getRelationships().values()];
    expect(relationships).toHaveLength(1);

    const chosen = palette.relationshipTypes.find((r) => r.iri === relationships[0].typeIri)!;
    expect(chosen).toBeDefined();
    // ArchiMate publishes a direct form for every relationship class, and that
    // is the predicate the triple must use.
    expect(chosen.unqualifiedPredicateIri).toBeTruthy();
    expect(relationshipTriples(f)).toEqual([
      `${ACTOR_A}|${chosen.unqualifiedPredicateIri}|${ACTOR_B}`,
    ]);
    // …and the qualified resource the Linked.Archi pattern pairs it with: typed
    // with the class, naming both ends, in the model — the IRI the connection
    // carries.
    const relIri = relationships[0].relationshipIri!;
    expect(relIri).toMatch(/^https:\/\/example\.org\/model\/test\/relationship\//);
    expect(qualifiedFacts(f, relIri)).toEqual(
      [
        `rdf:type|${chosen.iri}`,
        `arch:source|${ACTOR_A}`,
        `arch:target|${ACTOR_B}`,
        'arch:inModel|https://example.org/model/test',
      ].sort(),
    );
    expect(line!.getAttribute('data-type-iri')).toBe(chosen.iri);
  });

  it('the pad offers the replace menu, because six types are valid for the pair', () => {
    const f = mount();
    drawConnection(f.canvas);

    const connectionId = [...f.canvas.getRelationships().keys()][0];
    const connection = service<{ get(id: string): unknown }>(f.canvas, 'elementRegistry').get(
      connectionId,
    );
    const current = [...f.canvas.getRelationships().values()][0].typeIri;

    expect(
      service<{ isEmpty(t: unknown, id: string): boolean }>(f.canvas, 'popupMenu').isEmpty(
        connection,
        RELATIONSHIP_REPLACE_MENU_ID,
      ),
    ).toBe(false);

    const entries = f.canvas.contextPadProvider.getContextPadEntries(connection as never);
    expect(entries['replace']).toBeDefined();
    expect(entries['replace'].title).toContain(
      palette.relationshipTypes.find((r) => r.iri === current)!.label,
    );
  });

  it('picking from the popup menu retypes the relationship, and undo puts it back', () => {
    const f = mount();
    drawConnection(f.canvas);

    const connectionId = [...f.canvas.getRelationships().keys()][0];
    const connection = service<{ get(id: string): unknown }>(f.canvas, 'elementRegistry').get(
      connectionId,
    );
    const before = [...f.canvas.getRelationships().values()][0];
    const candidates = f.canvas.relationshipCandidates(BUSINESS_ACTOR, BUSINESS_ACTOR);
    const alternative = candidates.find((c) => c.iri !== before.typeIri)!;

    (
      f.canvas.contextPadProvider.getContextPadEntries(connection as never)['replace'].action as (
        event: unknown,
      ) => void
    )({ x: 30, y: 40 });

    // Six ArchiMate types for actor → actor, so the search box is rendered too
    // (PopupMenuComponent only shows it above five entries).
    expect(f.container.querySelectorAll('.djs-popup .entry')).toHaveLength(candidates.length);
    expect(f.container.querySelector('.djs-popup-search input')).not.toBeNull();

    f.container
      .querySelector<HTMLElement>(
        `.djs-popup .entry[data-id="${relationshipEntryId(alternative.iri)}"]`,
      )!
      .click();

    expect(relationshipTriples(f)).toEqual([
      `${ACTOR_A}|${alternative.unqualifiedPredicateIri ?? alternative.iri}|${ACTOR_B}`,
    ]);
    // Retyped in place: the same resource, now of the other class.
    const relIri = [...f.canvas.getRelationships().values()][0].relationshipIri!;
    expect(qualifiedFacts(f, relIri)).toContain(`rdf:type|${alternative.iri}`);
    expect([...f.canvas.getRelationships().values()][0].typeIri).toBe(alternative.iri);
    // One connection, relabelled rather than duplicated.
    expect(f.container.querySelectorAll(`.${RENDER_CLASSES.connection}`)).toHaveLength(1);

    service<{ undo(): void }>(f.canvas, 'commandStack').undo();

    expect(relationshipTriples(f)).toEqual([
      `${ACTOR_A}|${before.predicateIri ?? before.typeIri}|${ACTOR_B}`,
    ]);
    expect(qualifiedFacts(f, relIri)).toContain(`rdf:type|${before.typeIri}`);
    expect([...f.canvas.getRelationships().values()][0].typeIri).toBe(before.typeIri);
    expect(f.container.querySelectorAll(`.${RENDER_CLASSES.connection}`)).toHaveLength(1);
  });
});

describe('bundled ArchiMate 4.0 → append → RDF', () => {
  it('derives the appendable target types for a BusinessActor', () => {
    const { canvas } = mount();

    const started = performance.now();
    const targets = canvas.appendTargets(BUSINESS_ACTOR);
    const elapsed = performance.now() - started;

    const concrete = palette.elementGroups.flatMap((group) =>
      group.elements.filter((element) => !element.isAbstract),
    );

    expect(targets.length).toBeGreaterThan(1);
    // Every offer is a concrete palette type with at least one ranked
    // relationship — the metamodel's answer, not this test's.
    expect(targets.every((t) => !t.type.isAbstract)).toBe(true);
    expect(targets.every((t) => t.relationships.length > 0)).toBe(true);
    expect(targets.length).toBeLessThanOrEqual(concrete.length);
    // A relationship really is allowed to each one, checked independently.
    for (const target of targets.slice(0, 5)) {
      expect(canvas.relationshipCandidates(BUSINESS_ACTOR, target.type.iri).length).toBeGreaterThan(
        0,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `BusinessActor append targets (${targets.length} of ${concrete.length} concrete types, ` +
        `derived in ${elapsed.toFixed(0)} ms): ` +
        targets.map((t) => `${t.type.label} via ${t.relationships[0].label}`).join(', '),
    );
  });

  it('the pad offers Append, and the menu lists those types', () => {
    const f = mount();
    const shape = service<{ get(id: string): unknown }>(f.canvas, 'elementRegistry').get(ACTOR_A);

    expect(
      service<{ isEmpty(t: unknown, id: string): boolean }>(f.canvas, 'popupMenu').isEmpty(
        shape,
        APPEND_TARGET_MENU_ID,
      ),
    ).toBe(false);

    const entries = f.canvas.contextPadProvider.getContextPadEntries(shape as never);
    expect(entries['append']).toBeDefined();

    (entries['append'].action as (event: unknown) => void)({ x: 30, y: 40 });

    const targets = f.canvas.appendTargets(BUSINESS_ACTOR);
    expect(f.container.querySelectorAll('.djs-popup .entry')).toHaveLength(targets.length);
    expect(
      f.container.querySelector(
        `.djs-popup .entry[data-id="${appendEntryId(targets[0].type.iri)}"]`,
      ),
    ).not.toBeNull();
  });

  it('a click-append creates a real element and the relationship to it', () => {
    const f = mount();
    const target = f.canvas.appendTargets(BUSINESS_ACTOR)[0];

    const appended = f.canvas.appendElement(ACTOR_A, target.type.iri)!;

    expect(appended).toBeDefined();
    const iri = appended.businessObject!.iri;
    // A real IRI minted by the real element manager, and the type triple with it.
    expect(iri).toMatch(/^https:\/\/example\.org\/model\/test\/element\/[0-9a-f-]{36}$/);
    expect(f.modelTriples()).toContain(
      `${iri}|http://www.w3.org/1999/02/22-rdf-syntax-ns#type|${target.type.iri}`,
    );

    const relationship = [...f.canvas.getRelationships().values()][0];
    const chosen = palette.relationshipTypes.find((r) => r.iri === relationship.typeIri)!;
    expect(relationshipTriples(f)).toEqual([
      `${ACTOR_A}|${chosen.unqualifiedPredicateIri ?? chosen.iri}|${iri}`,
    ]);
  });

  it('one undo reverses the element, its triples, the connection and the relationship', () => {
    const f = mount();
    const target = f.canvas.appendTargets(BUSINESS_ACTOR)[0];
    const appended = f.canvas.appendElement(ACTOR_A, target.type.iri)!;
    const iri = appended.businessObject!.iri;
    const commandStack = service<{ undo(): void; canUndo(): boolean }>(f.canvas, 'commandStack');

    commandStack.undo();

    expect(commandStack.canUndo()).toBe(false);
    expect(f.canvas.getElement(iri)).toBeUndefined();
    expect(f.canvas.getRelationships().size).toBe(0);
    expect(f.container.querySelectorAll(`.${RENDER_CLASSES.connection}`)).toHaveLength(0);
    // Nothing at all is left in the model graph: the two shapes on the canvas
    // were drawn by `addElement`, which writes no triples.
    expect(f.modelTriples()).toEqual([]);
  });
});
