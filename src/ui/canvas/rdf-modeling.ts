/**
 * RdfModeling — a connection is born with its relationship type.
 *
 * ## The pattern, and where it comes from
 *
 * bpmn-js overrides `Modeling.connect` to consult its rules and hand the answer
 * straight to `createConnection`:
 *
 * ```js
 * Modeling.prototype.connect = function(source, target, attrs, hints) {
 *   if (!attrs) attrs = this._bpmnRules.canConnect(source, target);
 *   if (!attrs) return;
 *   return this.createConnection(source, target, attrs, source.parent, hints);
 * };
 * ```
 *
 * {@link RdfRuleProvider.canConnect} already answers with the winning
 * relationship type ({@link RdfConnectionAttrs}), so the same override gives
 * la-gram a connection whose `businessObject.typeIri` is set before
 * `connection.create` ever executes. Nothing has to patch it afterwards.
 *
 * ## Why the RDF triple needs its own command
 *
 * The triple has to be written *inside* the same undo group, and it cannot be
 * written by the `connection.create` handler: `CommandStack._setHandler` throws
 * on `overriding handler for command <connection.create>`, so that handler is
 * not replaceable. Two mechanisms remain — a `preExecute` interceptor, or a
 * dedicated command registered through `Modeling.getHandlers()` — and this
 * module uses **both, for what each is good at**:
 *
 * - {@link CreateRelationshipHandler} is registered as `rdf.relationship.create`
 *   via {@link RdfModeling.getHandlers}, which is how bpmn-js contributes its
 *   own handlers (`handlers['element.updateModdleProperties'] = ...`). Being a
 *   real command, its `revert` runs on undo, so the triple is retracted.
 * - {@link RdfRelationshipBehavior} hooks `connection.create` at `preExecute`
 *   and *executes* that command. `preExecute` is fired outside
 *   `CommandStack._atomicDo`, so a nested `execute` is legal there, and
 *   `_pushAction` gives the nested action the outer action's id — which is
 *   exactly what makes `commandStack.undo()` revert both as one unit.
 *
 * An interceptor alone would write the triple but never unwrite it; a command
 * alone has no way to run when a connection is created.
 *
 * {@link RetypeRelationshipHandler} (`rdf.relationship.retype`) is contributed
 * the same way and needs no interceptor: retyping is always something the user
 * asked for explicitly, so the canvas executes it directly. See the note on the
 * class for why diagram-js's `features/replace` is not that mechanism.
 *
 * ## The same pattern for *elements*
 *
 * A shape created by `create.start` (a palette drag, or the append gesture) is
 * built by `elementFactory.createShape(...)` and has no IRI at that point:
 * diagram-js knows nothing about RDF, so nothing minted one. The gesture is
 * therefore only half a creation until the triples exist.
 *
 * {@link CreateElementHandler} (`rdf.element.create`) and
 * {@link RdfElementBehavior} are the element-side twins of the pair above, for
 * the identical reason: the handler can revert, the interceptor can run. The
 * hooked phase is `commandStack.shape.create.preExecute`, and `preExecute`
 * specifically because
 *
 * - it is fired outside `CommandStack._atomicDo`, so a nested `execute` is legal
 *   and inherits the outer action's id — one undo group for the whole gesture;
 * - `CreateShapeHandler.execute` calls `canvas.addShape`, which registers the
 *   shape under its `id`. This app's invariant is *shape id === element IRI*
 *   (`elementRegistry.get(iri)` is how every other path finds a shape), so the
 *   IRI has to be on the shape *before* `execute` — which leaves `preExecute` as
 *   the only phase that works.
 *
 * `shape.append` (diagram-js's `AppendShapeHandler`) then nests both the
 * `shape.create` and the `modeling.connect` inside its own action, so a completed
 * append is a single undoable unit spanning four commands:
 * `shape.append` → `shape.create` → `rdf.element.create`, then
 * `connection.create` → `rdf.relationship.create`.
 *
 * ## What does *not* write a triple
 *
 * The store→canvas direction (`DiagramCanvas.addRelationship`) draws
 * relationships that are already in RDF. It calls `modeling.createConnection`
 * directly and never sets the {@link RDF_RELATIONSHIP_HINT} hint, so the
 * behaviour sits out and nothing is written twice.
 */

import Modeling from 'diagram-js/lib/features/modeling/Modeling.js';
import ModelingModule from 'diagram-js/lib/features/modeling/index.js';

import type { RelationshipTypeInfo } from '../../metamodel-manager/interfaces.js';
import { ARRANGE_APPLY_COMMAND, ArrangeApplyHandler } from './canvas-arrange.js';
import { AttachedConnectionBehavior, CroppingLayouter } from './connection-docking.js';
import { FastCroppingConnectionDocking } from './straight-docking.js';
import type { RdfBusinessObject } from './rdf-renderer.js';
import type { RdfConnectionAttrs, RdfRuleProvider } from './rdf-rule-provider.js';
import { relationshipKey } from './relationship-resolution.js';
import type { RdfReuseCheck } from './reuse-relationship.js';
import type { ObservableRdfStore, RdfDiff } from '../../rdf-engine/observable-store.js';

/**
 * Hint key carrying the relationship to assert alongside a `connection.create`.
 *
 * Set by {@link RdfModeling.connect} only, so it doubles as the marker that
 * separates a canvas-initiated connection from one drawn off the store.
 */
export const RDF_RELATIONSHIP_HINT = 'rdfRelationship';

/** Command asserting the relationship a newly drawn connection stands for. */
export const CREATE_RELATIONSHIP_COMMAND = 'rdf.relationship.create';

/** Command swapping a connection's relationship for another type. */
export const RETYPE_RELATIONSHIP_COMMAND = 'rdf.relationship.retype';

/** Command minting the RDF element a newly created shape stands for. */
export const CREATE_ELEMENT_COMMAND = 'rdf.element.create';

/** A recorded, undoable model change; see {@link RdfChangeHandler}. */
export const RDF_CHANGE_COMMAND = 'rdf.store.change';

/**
 * The same, for a change made outside the canvas — a property edited in the
 * panel. Its own name so the canvas knows to redraw from the store when it is
 * undone or redone: no shape command carries the change back.
 */
export const RDF_STORE_EDIT_COMMAND = 'rdf.store.edit';

/** Delete a concept from the model, shapes and all; see {@link ModelDeleteHandler}. */
export const RDF_MODEL_DELETE_COMMAND = 'rdf.model.delete';

/**
 * Hint on `connection.create` naming an existing relationship to draw, as
 * opposed to {@link RDF_RELATIONSHIP_HINT}, which creates one.
 */
export const RDF_EXISTING_RELATIONSHIP_HINT = 'rdfExistingRelationship';

/** Hint: the modeller was asked whether to use a relationship the model already has, and answered a new one. */
export const RDF_REUSE_ANSWERED_HINT = 'rdfReuseAnswered';

/** The relationship a connection stands for, everything needed to (un)write it. */
export interface RdfRelationship {
  sourceIri: string;
  targetIri: string;
  /** IRI of the relationship *type* (the palette concept). */
  typeIri: string;
  /** Predicate of the direct triple — the type's unqualified form when it has one. */
  predicateIri: string;
  /** Every type the metamodel allowed for the pair, best-ranked first. */
  candidates: RelationshipTypeInfo[];
}

/** A relationship plus the connection that stands for it. */
export interface RdfRelationshipRequest extends RdfRelationship {
  /** diagram-js id of the connection, so the canvas can key its registry. */
  connectionId: string;
  /** The placements the connection was drawn between, when its ends are placed elements. */
  sourceNodeIri?: string;
  targetNodeIri?: string;
  /** Set by the writer: the view's link it drew the relationship with. */
  linkIri?: string;
  /**
   * IRI a previous `execute` minted, reused on redo so the relationship keeps
   * its identity across any number of undo/redo cycles.
   */
  iri?: string;
}

/**
 * The RDF side of a connection, supplied by the canvas.
 *
 * Kept behind an interface so the command handler stays a command handler: it
 * decides *when* the model changes, not how the store is spoken to.
 */
export interface RdfRelationshipWriter {
  /**
   * Assert the relationship.
   *
   * @return IRI of the created relationship resource, when the model has one.
   * A direct triple has none.
   */
  create(request: RdfRelationshipRequest): string | undefined;

  /** Retract what {@link create} wrote. */
  remove(request: RdfRelationshipRequest, relationshipIri?: string): void;

  /**
   * Change an existing relationship's kind in place — same IRI, properties
   * kept. When absent, a retype falls back to remove + create.
   */
  retype?(relationshipIri: string, from: RdfRelationshipRequest, to: RdfRelationshipRequest): void;

  /**
   * Draw an *existing* relationship in the open view (an `arch-vis:Link`),
   * without creating anything in the model.
   */
  draw?(relationshipIri: string, ends?: { sourceNodeIri?: string; targetNodeIri?: string }): string | undefined;
}

/** Minimal view of the diagram-js elements this module touches. */
interface DjsElement {
  id: string;
  businessObject?: RdfBusinessObject;
  parent?: unknown;
}

/** A diagram-js shape, as far as the element command reads it. */
interface DjsShapeLike extends DjsElement {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Bounds of an element, matching `model-manager`'s `Bounds`. */
export interface RdfElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What {@link RdfElementWriter.create} is asked to bring into being. */
export interface RdfElementRequest {
  /** IRI of the element *type* (the palette concept, e.g. `am4:BusinessActor`). */
  typeIri: string;
  /** Bounds to record, already in the diagram coordinates the shape will get. */
  bounds: RdfElementBounds;
  /**
   * IRI a previous `execute` minted, replayed on redo.
   *
   * `ElementManager.createElement` mints its own IRI and cannot be told one, so
   * a redo that simply called it again would produce a *different* element —
   * leaving the relationship triple written by the sibling
   * `rdf.relationship.create` pointing at the IRI from the first execute. Redo
   * therefore restores rather than recreates; see {@link snapshot}.
   */
  iri?: string;
  /** The triples the first `execute` wrote, replayed verbatim on redo. */
  snapshot?: unknown[];
  /** Label to give the new element (the palette entry's, by default). */
  label?: string;
}

/** What the writer managed to create. */
export interface RdfElementResult {
  iri: string;
  /** The node it was placed with in the open view. */
  nodeIri?: string;
  /**
   * The triples that now describe the element, for a later redo.
   *
   * Empty when the writer cannot read them back, which makes redo fall back to
   * minting a fresh element. See {@link RdfElementRequest.iri}.
   */
  snapshot: unknown[];
}

/**
 * The RDF side of a shape, supplied by the canvas.
 *
 * The element twin of {@link RdfRelationshipWriter}, and behind an interface for
 * the same reason: the command handler decides *when* the model changes, not how
 * the store is spoken to.
 */
export interface RdfElementWriter {
  /**
   * Create the element, or put back the one `request.iri` names.
   *
   * @return the IRI and the triples written, or `undefined` when nothing could
   * be created.
   */
  create(request: RdfElementRequest): RdfElementResult | undefined;

  /** Retract what {@link create} wrote. */
  remove(iri: string): void;

  /**
   * Place an element that already exists in the model into the open view.
   * The model is not touched; only a node (and `arch:inView`) is written.
   */
  place?(iri: string, bounds: RdfElementBounds): string | undefined;
}

/** Context of the `rdf.element.create` command. */
interface ElementCommandContext {
  shape: DjsShapeLike;
  request: RdfElementRequest;
  /** Filled in by `execute`, read by `revert` and by a later redo. */
  iri?: string;
  /** The node it was placed with, kept for a redo. */
  nodeIri?: string;
  snapshot?: unknown[];
  /** diagram-js id the shape had before `execute` adopted the IRI. */
  previousShapeId?: string;
  /** Business object IRI before `execute` replaced it (normally `''`). */
  previousIri?: string;
}

/**
 * Mints (and on undo deletes) the RDF element a newly created shape stands for.
 *
 * Returns no dirty elements: the sibling `shape.create` command owns the diagram
 * change and already reports the shape. This command changes the *model* — and
 * the shape's identity, which has to be the element's IRI before `shape.create`
 * registers it on the canvas.
 */
export class CreateElementHandler {
  static $inject = ['rdfElementWriter'];

  private writer: RdfElementWriter;

  constructor(rdfElementWriter: RdfElementWriter) {
    this.writer = rdfElementWriter;
  }

  execute(context: ElementCommandContext): void {
    const { shape, request } = context;

    const result = this.writer.create({
      ...request,
      iri: context.iri,
      snapshot: context.snapshot,
    });
    if (!result) return;

    context.iri = result.iri;
    context.snapshot = result.snapshot;
    context.nodeIri = result.nodeIri ?? context.nodeIri;
    if (context.previousShapeId === undefined) context.previousShapeId = shape.id;
    if (context.previousIri === undefined) context.previousIri = shape.businessObject?.iri ?? '';

    shape.id = result.iri;
    if (shape.businessObject) {
      shape.businessObject.iri = result.iri;
      if (context.nodeIri) shape.businessObject.nodeIri = context.nodeIri;
    }
  }

  revert(context: ElementCommandContext): void {
    const { shape, iri, previousShapeId, previousIri } = context;
    if (!iri) return;

    this.writer.remove(iri);

    if (previousShapeId !== undefined) shape.id = previousShapeId;
    if (previousIri !== undefined && shape.businessObject) shape.businessObject.iri = previousIri;
  }
}

/**
 * Turns a `shape.create` for an as-yet IRI-less RDF shape into the element
 * command, grouped with the `shape.create` that triggered it.
 *
 * A plain `eventBus` listener rather than a `CommandInterceptor` subclass, for
 * the same reason as {@link RdfRelationshipBehavior}: one hook, and the phase is
 * the whole point.
 *
 * Deliberately keyed off "has a type but no IRI". The store→canvas direction
 * (`DiagramCanvas.addElement`) calls `canvas.addShape` directly and never reaches
 * `shape.create` at all, and anything that *does* arrive already carrying an IRI
 * is a shape for an element that exists — so neither writes twice.
 */
export class RdfElementBehavior {
  static $inject = ['eventBus', 'commandStack', 'rdfElementWriter', 'elementRegistry'];

  constructor(
    eventBus: DjsEventBus,
    commandStack: DjsCommandStack,
    elementWriter: RdfElementWriter,
    elementRegistry: { get(id: string): unknown },
  ) {
    eventBus.on<{ context?: ShapeCreateContext }>(
      'commandStack.shape.create.preExecute',
      (event) => {
        const context = event.context;
        const shape = context?.shape;
        const businessObject = shape?.businessObject;
        if (!shape || !businessObject) return;
        if (businessObject.kind !== undefined && businessObject.kind !== 'element') return;

        // An element that already exists, dropped into this view (from the model
        // tree, or "add to view"): a placement, not a new element.
        if (businessObject.iri && businessObject.placeExisting) {
          const iri = businessObject.iri;
          const bounds = plannedBounds(shape, context?.position);
          commandStack.execute(RDF_CHANGE_COMMAND, {
            apply: () => {
              const node = elementWriter.place?.(iri, bounds);
              if (!node) return;
              businessObject.nodeIri = node;
              // Placed again: its element's IRI keys the first placement, its node this one.
              if (shape.id === iri && elementRegistry.get(iri)) shape.id = node;
            },
          } satisfies RdfChangeContext);
          return;
        }

        if (!businessObject.typeIri || businessObject.iri) return;

        commandStack.execute(CREATE_ELEMENT_COMMAND, {
          shape,
          request: {
            typeIri: businessObject.typeIri,
            bounds: plannedBounds(shape, context?.position),
            // Unnamed when the shape cannot show a name (a junction).
            ...(businessObject.label && businessObject.named !== false ? { label: businessObject.label } : {}),
          },
        });
      },
    );
  }
}

/**
 * Where `CreateShapeHandler` is about to put the shape.
 *
 * Mirrors that handler exactly — a `position` is a *centre* and gets halved off,
 * whereas a value carrying a `width` is already bounds — so the layout triples
 * this command writes agree with the shape the next command draws. Getting it
 * wrong would leave RDF claiming a position half a shape away from the canvas.
 */
export function plannedBounds(
  shape: DjsShapeLike,
  positionOrBounds: Partial<RdfElementBounds> | undefined,
): RdfElementBounds {
  const width = Math.round(shape.width ?? 0);
  const height = Math.round(shape.height ?? 0);

  if (!positionOrBounds) {
    return { x: Math.round(shape.x ?? 0), y: Math.round(shape.y ?? 0), width, height };
  }

  if (positionOrBounds.width !== undefined) {
    return {
      x: Math.round(positionOrBounds.x ?? 0),
      y: Math.round(positionOrBounds.y ?? 0),
      width: Math.round(positionOrBounds.width),
      height: Math.round(positionOrBounds.height ?? height),
    };
  }

  return {
    x: Math.round((positionOrBounds.x ?? 0) - Math.round(width / 2)),
    y: Math.round((positionOrBounds.y ?? 0) - Math.round(height / 2)),
    width,
    height,
  };
}

/** The `shape.create` command context, as far as this module reads it. */
interface ShapeCreateContext {
  shape?: DjsShapeLike;
  /** A centre point, or full bounds when a `width` is present. */
  position?: Partial<RdfElementBounds>;
}

/** Writer used when the canvas supplied none: creates nothing, breaks nothing. */
const inertElementWriter: RdfElementWriter = {
  create: () => undefined,
  remove: () => undefined,
};

/** Context of the `rdf.relationship.create` command. */
interface RelationshipCommandContext {
  connection: DjsElement;
  relationship: RdfRelationshipRequest;
  /** Filled in by `execute`, read by `revert`. */
  relationshipIri?: string;
  /** The business object IRI before `execute` replaced it. */
  previousIri?: string;
}

/** Context of the `rdf.relationship.retype` command. */
export interface RetypeRelationshipContext {
  connection: DjsElement;
  /** The relationship to retract. */
  from: RdfRelationshipRequest;
  /** The relationship to assert in its place. */
  to: RdfRelationshipRequest;
  /** IRI of the *existing* relationship resource, when the model minted one. */
  fromRelationshipIri?: string;
  /** IRI of the relationship resource `execute` minted, read by `revert`. */
  toRelationshipIri?: string;
}

/**
 * Writes (and on undo retracts) the RDF relationship a connection stands for.
 *
 * Returns no dirty elements: the diagram change is the sibling
 * `connection.create` command's business, and it already reports the connection.
 * This command changes the *model*.
 */
export class CreateRelationshipHandler {
  static $inject = ['rdfRelationshipWriter'];

  private writer: RdfRelationshipWriter;

  constructor(rdfRelationshipWriter: RdfRelationshipWriter) {
    this.writer = rdfRelationshipWriter;
  }

  execute(context: RelationshipCommandContext): void {
    const { connection, relationship } = context;

    // On redo, ask for the IRI the first execute minted.
    const relationshipIri = this.writer.create(
      context.relationshipIri ? { ...relationship, iri: context.relationshipIri } : relationship,
    );
    context.relationshipIri = relationshipIri;

    // A qualified relationship has an IRI of its own; adopt it now that it
    // exists. The business object was born with the stable triple identity, so
    // it is never without one.
    if (relationshipIri && connection.businessObject) {
      context.previousIri = connection.businessObject.iri;
      connection.businessObject.iri = relationshipIri;
    }
    // Which line of it in the view: the link the writer drew.
    if (relationship.linkIri && connection.businessObject) connection.businessObject.linkIri = relationship.linkIri;
  }

  revert(context: RelationshipCommandContext): void {
    const { connection, relationship, relationshipIri, previousIri } = context;

    this.writer.remove(relationship, relationshipIri);

    if (previousIri !== undefined && connection.businessObject) {
      connection.businessObject.iri = previousIri;
    }
  }
}

/**
 * Changes which relationship a connection stands for, undoably.
 *
 * ## Why not `features/replace`
 *
 * diagram-js ships `Replace.replaceElement(oldElement, attrs, hints)`, and its
 * `.d.ts` types `oldElement` as a `Shape`. That is not a documentation
 * shortcut — the implementation opens with
 *
 * ```js
 * if (oldElement.waypoints) {
 *   // TODO(nikku): we do not replace connections, yet
 *   return null;
 *   }
 * ```
 *
 * so a connection is refused outright, and `Modeling.replaceShape` behind it
 * deletes and recreates the element, which would give the connection a new
 * diagram-js id and drop its bendpoints. bpmn-js reaches connections through its
 * own `BpmnReplace`, which for a `bpmn:SequenceFlow` ends up in
 * `modeling.updateProperties` rather than in `replaceShape`.
 *
 * The equivalent here is a command of our own: the connection is *kept*, its
 * business object is rewritten, and the two triples move in one undo group —
 * exactly the shape {@link CreateRelationshipHandler} already established.
 *
 * `execute` and `revert` return the connection as dirty, because unlike
 * `rdf.relationship.create` this command has no sibling `connection.*` command
 * to report the diagram change for it. That is what redraws the line with the
 * new notation.
 */
export class RetypeRelationshipHandler {
  static $inject = ['rdfRelationshipWriter'];

  private writer: RdfRelationshipWriter;

  constructor(rdfRelationshipWriter: RdfRelationshipWriter) {
    this.writer = rdfRelationshipWriter;
  }

  execute(context: RetypeRelationshipContext): DjsElement[] {
    const { connection, from, to, fromRelationshipIri } = context;

    // In place when the writer can: the relationship keeps its IRI and whatever
    // properties the user gave it.
    if (this.writer.retype && fromRelationshipIri) {
      this.writer.retype(fromRelationshipIri, from, to);
      context.toRelationshipIri = fromRelationshipIri;
      connection.businessObject = businessObjectFor(to, fromRelationshipIri, connection.businessObject?.linkIri);
      return [connection];
    }

    this.writer.remove(from, fromRelationshipIri);
    context.toRelationshipIri = this.writer.create(to);

    connection.businessObject = businessObjectFor(to, context.toRelationshipIri, connection.businessObject?.linkIri);
    return [connection];
  }

  revert(context: RetypeRelationshipContext): DjsElement[] {
    const { connection, from, to, toRelationshipIri } = context;

    if (this.writer.retype && toRelationshipIri && toRelationshipIri === context.fromRelationshipIri) {
      this.writer.retype(toRelationshipIri, to, from);
      connection.businessObject = businessObjectFor(from, toRelationshipIri, connection.businessObject?.linkIri);
      return [connection];
    }

    this.writer.remove(to, toRelationshipIri);
    // A qualified relationship is minted afresh, so the IRI put back may differ
    // from the one that was there before. Record it, so a redo retracts *this*
    // resource rather than a stale IRI.
    context.fromRelationshipIri = this.writer.create(from);

    connection.businessObject = businessObjectFor(from, context.fromRelationshipIri, connection.businessObject?.linkIri);
    return [connection];
  }
}

/** The business object a connection carries for `relationship` — the line's link kept. */
function businessObjectFor(
  relationship: RdfRelationship,
  relationshipIri: string | undefined,
  linkIri?: string,
): RdfBusinessObject {
  return {
    iri:
      relationshipIri ??
      relationshipKey(relationship.sourceIri, relationship.targetIri, relationship.typeIri),
    typeIri: relationship.typeIri,
    kind: 'relationship',
    ...(linkIri ? { linkIri } : {}),
  };
}

/**
 * Turns the {@link RDF_RELATIONSHIP_HINT} hint into the RDF command, grouped
 * with the `connection.create` that carried it.
 *
 * Deliberately a plain `eventBus` listener rather than a `CommandInterceptor`
 * subclass: one hook, and the phase (`preExecute`) is the whole point, so
 * spelling it out reads better than inheriting it.
 */
export class RdfRelationshipBehavior {
  static $inject = ['eventBus', 'commandStack', 'rdfRelationshipWriter', 'elementRegistry'];

  constructor(
    eventBus: DjsEventBus,
    commandStack: DjsCommandStack,
    relationshipWriter: RdfRelationshipWriter,
    elementRegistry: { get(id: string): unknown } | null = null,
  ) {
    eventBus.on<{ context?: ConnectionCreateContext }>(
      'commandStack.connection.create.preExecute',
      (event) => {
        const context = event.context;
        const connection = context?.connection;

        // Between which placements: an element placed more than once is drawn from the one picked.
        const sourceNodeIri = context?.source?.businessObject?.nodeIri;
        const targetNodeIri = context?.target?.businessObject?.nodeIri;
        const ends = { ...(sourceNodeIri ? { sourceNodeIri } : {}), ...(targetNodeIri ? { targetNodeIri } : {}) };

        // A relationship that already exists in the model, drawn into this view.
        const existing = context?.hints?.[RDF_EXISTING_RELATIONSHIP_HINT];
        if (existing && connection) {
          commandStack.execute(RDF_CHANGE_COMMAND, {
            apply: () => {
              const link = relationshipWriter.draw?.(existing, ends);
              if (!link || !connection.businessObject) return;
              connection.businessObject.linkIri = link;
              // Drawn again: its relationship's IRI keys its first line, its link this one.
              if (connection.id === existing && elementRegistry?.get(existing)) connection.id = link;
            },
          } satisfies RdfChangeContext);
          return;
        }

        const relationship = context?.hints?.[RDF_RELATIONSHIP_HINT];
        if (!relationship || !connection) return;

        // The connection object already exists (Modeling.createConnection built
        // it before executing), so the handler can complete its business object.
        const request: RdfRelationshipRequest = { ...relationship, connectionId: connection.id, ...ends };
        commandStack.execute(CREATE_RELATIONSHIP_COMMAND, { connection, relationship: request });
      },
    );
  }
}

/**
 * The `connection.create` command context, as far as this module reads it.
 *
 * The key is spelled out rather than computed from {@link RDF_RELATIONSHIP_HINT}
 * because a type literal cannot take a computed name. Drift is not a risk: the
 * runtime read is `hints[RDF_RELATIONSHIP_HINT]`, so renaming the constant
 * without renaming the key fails to compile.
 */
interface ConnectionCreateContext {
  connection?: DjsElement;
  source?: DjsElement;
  target?: DjsElement;
  hints?: { rdfRelationship?: RdfRelationship; rdfExistingRelationship?: string };
}

/** The bit of diagram-js's event bus this module uses. */
interface DjsEventBus {
  on<T>(event: string, callback: (event: T) => void): void;
}

/** The bit of diagram-js's command stack this module uses. */
interface DjsCommandStack {
  execute(command: string, context: unknown): void;
}

/**
 * Attributes {@link RdfModeling.connect} accepts.
 *
 * Either the rule provider's answer ({@link RdfConnectionAttrs}) — which is what
 * diagram-js's `Connect` forwards when a rule returns an object — or explicit
 * connection attributes from a caller that has already decided.
 */
export type RdfConnectAttrs = Partial<RdfConnectionAttrs> & {
  id?: string;
  businessObject?: RdfBusinessObject;
};

/**
 * Base class typed structurally.
 *
 * `Modeling.d.ts` declares `getHandlers(): Map<string, ...>` although the
 * implementation returns a plain object, and `connect(): T` although bpmn-js's
 * override returns `undefined` when the rules refuse. Extending the published
 * types would mean casting in every method body; naming the two members this
 * subclass actually builds on keeps the casts to this one place.
 */
const ModelingBase = Modeling as unknown as {
  new (eventBus: unknown, elementFactory: unknown, commandStack: unknown): {
    getHandlers(): Record<string, unknown>;
    createConnection(
      source: unknown,
      target: unknown,
      connection: Record<string, unknown>,
      parent: unknown,
      hints?: Record<string, unknown>,
    ): DjsElement;
  };
};

/**
 * diagram-js's `Modeling`, with a `connect` that knows about the metamodel.
 */
export class RdfModeling extends ModelingBase {
  static $inject = ['eventBus', 'elementFactory', 'commandStack', 'rdfRuleProvider', 'rdfReuseCheck'];

  private rdfRuleProvider: RdfRuleProvider;
  private rdfReuseCheck: RdfReuseCheck | null;

  constructor(
    eventBus: unknown,
    elementFactory: unknown,
    commandStack: unknown,
    rdfRuleProvider: RdfRuleProvider,
    rdfReuseCheck: RdfReuseCheck | null = null,
  ) {
    super(eventBus, elementFactory, commandStack);
    this.rdfRuleProvider = rdfRuleProvider;
    this.rdfReuseCheck = rdfReuseCheck;
  }

  /**
   * The base handlers plus the RDF one.
   *
   * `Modeling`'s constructor registers whatever `this.getHandlers()` returns on
   * `diagram.init`, so contributing here is enough — the same place bpmn-js adds
   * `element.updateModdleProperties`.
   */
  override getHandlers(): Record<string, unknown> {
    return {
      ...super.getHandlers(),
      [CREATE_RELATIONSHIP_COMMAND]: CreateRelationshipHandler,
      [RETYPE_RELATIONSHIP_COMMAND]: RetypeRelationshipHandler,
      [CREATE_ELEMENT_COMMAND]: CreateElementHandler,
      [RDF_CHANGE_COMMAND]: RdfChangeHandler,
      [RDF_STORE_EDIT_COMMAND]: RdfChangeHandler,
      [RDF_MODEL_DELETE_COMMAND]: ModelDeleteHandler,
      // The arrange options' moves, resizes and routes, one step (canvas-arrange.ts).
      [ARRANGE_APPLY_COMMAND]: ArrangeApplyHandler,
    };
  }

  /**
   * Connect two elements, typed.
   *
   * With no `attrs`, the rule provider decides the relationship type; refusing
   * means no connection at all. With `attrs`, those are used as given and the
   * rules are not consulted — which is also the path diagram-js's `Connect`
   * takes, since it forwards the object a rule returned.
   *
   * The resulting connection carries a `businessObject` with the type on it, and
   * the hint that makes {@link RdfRelationshipBehavior} write the triple in the
   * same command group.
   *
   * When the model already relates the two by the type, in that direction, and
   * this view does not draw it, the modeller is asked first ({@link RdfReuseCheck}):
   * nothing is drawn now, and the answer draws the existing one or connects again.
   */
  connect(
    source: DjsElement,
    target: DjsElement,
    attrs?: RdfConnectAttrs | null,
    hints?: Record<string, unknown>,
  ): DjsElement | undefined {
    const sourceIri = source.businessObject?.iri;
    const targetIri = target.businessObject?.iri;

    const resolved =
      attrs ??
      this.consultRules(source.businessObject?.typeIri, target.businessObject?.typeIri);
    if (!resolved) return undefined;

    // A line from or to a figure stands for no relationship: the view's link is
    // written as the line is created (the canvas's `connection.create` hook).
    if (resolved.connector) {
      const connector: RdfBusinessObject = { iri: '', typeIri: '', kind: 'connector' };
      return this.createConnection(source, target, { businessObject: connector }, source.parent, { ...hints });
    }

    const typeIri = resolved.typeIri ?? resolved.businessObject?.typeIri;

    // Only what a connection is allowed to carry: `candidates` belongs on the
    // hint, not on the diagram element.
    const connectionAttrs: Record<string, unknown> = {};
    if (resolved.id !== undefined) connectionAttrs['id'] = resolved.id;

    const businessObject: RdfBusinessObject | undefined =
      resolved.businessObject ??
      (typeIri && sourceIri && targetIri
        ? {
            iri: relationshipKey(sourceIri, targetIri, typeIri),
            typeIri,
            kind: 'relationship',
          }
        : undefined);
    if (businessObject) connectionAttrs['businessObject'] = businessObject;

    const connectHints: Record<string, unknown> = { ...hints };
    if (
      typeIri &&
      sourceIri &&
      targetIri &&
      !connectHints[RDF_REUSE_ANSWERED_HINT] &&
      this.rdfReuseCheck?.({
        source,
        target,
        typeIri,
        createNew: () => this.connect(source, target, resolved, { ...hints, [RDF_REUSE_ANSWERED_HINT]: true }),
      })
    ) {
      return undefined;
    }
    if (typeIri && sourceIri && targetIri) {
      const relationship: RdfRelationship = {
        sourceIri,
        targetIri,
        typeIri,
        predicateIri: resolved.unqualifiedPredicateIri ?? typeIri,
        candidates: resolved.candidates ?? [],
      };
      connectHints[RDF_RELATIONSHIP_HINT] = relationship;
    }

    return this.createConnection(source, target, connectionAttrs, source.parent, connectHints);
  }

  /** The rules' verdict, or `false` while either end has no type. */
  private consultRules(
    sourceTypeIri: string | undefined,
    targetTypeIri: string | undefined,
  ): RdfConnectAttrs | false {
    if (!sourceTypeIri || !targetTypeIri) return false;
    return this.rdfRuleProvider.canConnect(sourceTypeIri, targetTypeIri);
  }
}

/**
 * diagram-js module replacing the default `modeling` service.
 *
 * Same shape as diagram-js's own `features/modeling/index.js` — `__init__` plus a
 * `['type', ...]` binding for `modeling` — so the later declaration wins in didi
 * and every consumer of `modeling` (the connect tool included) gets this one.
 *
 * ## Why docking is bound here and not in `DiagramCanvas`
 *
 * bpmn-js binds `connectionDocking` in its *own* `features/modeling/index.js`,
 * beside `modeling` and `layouter`. This module is la-gram's counterpart of that
 * file: it already depends on diagram-js's `ModelingModule` and rebinds
 * `modeling` over it, and `DiagramCanvas` registers it last so its bindings win.
 *
 * The three belong together. {@link CroppingLayouter} is only correct if
 * `connectionDocking` is bound, and both are only correct paired with a
 * `modeling` whose handlers run through them. Declaring them in the module keeps
 * the modeling layer internally consistent for every consumer — including tests
 * that boot `rdfModelingModule` on its own — instead of making correctness
 * depend on `DiagramCanvas` remembering two extra array entries.
 *
 * See `connection-docking.ts` for what each of the two does, and for
 * `attachedConnectionBehavior`, which keeps a relationship that ends on another
 * relationship docked to it — the same concern, for the one kind of end
 * diagram-js does not re-lay out itself.
 */
export function rdfModelingModule(
  rdfRelationshipWriter: RdfRelationshipWriter,
  rdfElementWriter: RdfElementWriter = inertElementWriter,
  rdfChangeStore: ObservableRdfStore | null = null,
  rdfReuseCheck: RdfReuseCheck | null = null,
): Record<string, unknown> {
  return {
    __depends__: [ModelingModule],
    __init__: ['modeling', 'rdfRelationshipBehavior', 'rdfElementBehavior', 'attachedConnectionBehavior'],
    modeling: ['type', RdfModeling],
    layouter: ['type', CroppingLayouter],
    connectionDocking: ['type', FastCroppingConnectionDocking],
    attachedConnectionBehavior: ['type', AttachedConnectionBehavior],
    rdfRelationshipBehavior: ['type', RdfRelationshipBehavior],
    rdfRelationshipWriter: ['value', rdfRelationshipWriter],
    rdfElementBehavior: ['type', RdfElementBehavior],
    rdfElementWriter: ['value', rdfElementWriter],
    rdfChangeStore: ['value', rdfChangeStore],
    rdfReuseCheck: ['value', rdfReuseCheck],
  };
}

// ── Recorded model changes ─────────────────────────────────────────────

/** Context of the generic {@link RDF_CHANGE_COMMAND}. */
export interface RdfChangeContext {
  /** The model operation. Run once; afterwards its recorded diff is replayed. */
  apply: () => void;
  /** Filled in on first execute: exactly what `apply` changed. */
  diff?: RdfDiff;
  /** Used only without a recording store: how to take `apply` back. */
  undo?: () => void;
}

/**
 * Any model change made on behalf of a canvas gesture — a node moved, removed
 * from a view, a link re-routed — as one undoable step.
 *
 * The operation runs once, inside {@link ObservableRdfStore.record}; undo
 * applies the inverse of what was recorded and redo re-applies it. That is
 * exact where re-running logic is not: a redo that re-ran "create a node" would
 * mint a different node IRI, and one that re-ran "remove from view" after an
 * intervening edit could remove something else.
 *
 * Without a recording store (unit tests with mock managers) the operation runs
 * on every execute and `undo`, when given, on revert.
 */
export class RdfChangeHandler {
  static $inject = ['rdfChangeStore'];

  constructor(private readonly store: ObservableRdfStore | null) {}

  execute(context: RdfChangeContext): void {
    if (!this.store) {
      context.apply();
      return;
    }
    if (context.diff) {
      this.store.applyDiff(context.diff);
      return;
    }
    const { added, removed } = this.store.record(context.apply);
    context.diff = { added, removed };
  }

  revert(context: RdfChangeContext): void {
    if (this.store && context.diff) this.store.applyDiff(context.diff, true);
    else context.undo?.();
  }
}

/** Context of {@link RDF_MODEL_DELETE_COMMAND}. */
export interface ModelDeleteContext extends RdfChangeContext {
  /** The diagram elements standing for the concept in the open view. */
  elements: DjsElement[];
}

/**
 * "Delete from model" as one undoable step: the shapes leave the canvas (as
 * nested `shape.delete` / `connection.delete` commands, in `preExecute`) and
 * then the concept leaves the model — every view, every relationship — in
 * `execute`. Undo reverses both: the triples come back, then the shapes.
 */
export class ModelDeleteHandler extends RdfChangeHandler {
  static override $inject = ['rdfChangeStore', 'modeling'];

  constructor(
    store: ObservableRdfStore | null,
    private readonly modeling: { removeElements(elements: unknown[]): void },
  ) {
    super(store);
  }

  preExecute(context: ModelDeleteContext): void {
    const live = context.elements.filter((element) => (element as { parent?: unknown }).parent);
    if (live.length > 0) this.modeling.removeElements(live);
  }
}
