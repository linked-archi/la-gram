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
import { CroppingConnectionDocking, CroppingLayouter } from './connection-docking.js';
import type { RdfBusinessObject } from './rdf-renderer.js';
import type { RdfConnectionAttrs, RdfRuleProvider } from './rdf-rule-provider.js';
import { relationshipKey } from './relationship-resolution.js';

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
}

/** What the writer managed to create. */
export interface RdfElementResult {
  iri: string;
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
}

/** Context of the `rdf.element.create` command. */
interface ElementCommandContext {
  shape: DjsShapeLike;
  request: RdfElementRequest;
  /** Filled in by `execute`, read by `revert` and by a later redo. */
  iri?: string;
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
    if (context.previousShapeId === undefined) context.previousShapeId = shape.id;
    if (context.previousIri === undefined) context.previousIri = shape.businessObject?.iri ?? '';

    shape.id = result.iri;
    if (shape.businessObject) shape.businessObject.iri = result.iri;
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
  static $inject = ['eventBus', 'commandStack'];

  constructor(eventBus: DjsEventBus, commandStack: DjsCommandStack) {
    eventBus.on<{ context?: ShapeCreateContext }>(
      'commandStack.shape.create.preExecute',
      (event) => {
        const context = event.context;
        const shape = context?.shape;
        const businessObject = shape?.businessObject;
        if (!shape || !businessObject) return;
        if (!businessObject.typeIri || businessObject.iri) return;
        if (businessObject.kind !== undefined && businessObject.kind !== 'element') return;

        commandStack.execute(CREATE_ELEMENT_COMMAND, {
          shape,
          request: {
            typeIri: businessObject.typeIri,
            bounds: plannedBounds(shape, context?.position),
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
function plannedBounds(
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

    const relationshipIri = this.writer.create(relationship);
    context.relationshipIri = relationshipIri;

    // A qualified relationship has an IRI of its own; adopt it now that it
    // exists. The business object was born with the stable triple identity, so
    // it is never without one.
    if (relationshipIri && connection.businessObject) {
      context.previousIri = connection.businessObject.iri;
      connection.businessObject.iri = relationshipIri;
    }
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

    this.writer.remove(from, fromRelationshipIri);
    context.toRelationshipIri = this.writer.create(to);

    connection.businessObject = businessObjectFor(to, context.toRelationshipIri);
    return [connection];
  }

  revert(context: RetypeRelationshipContext): DjsElement[] {
    const { connection, from, to, toRelationshipIri } = context;

    this.writer.remove(to, toRelationshipIri);
    // A qualified relationship is minted afresh, so the IRI put back may differ
    // from the one that was there before. Record it, so a redo retracts *this*
    // resource rather than a stale IRI.
    context.fromRelationshipIri = this.writer.create(from);

    connection.businessObject = businessObjectFor(from, context.fromRelationshipIri);
    return [connection];
  }
}

/** The business object a connection carries for `relationship`. */
function businessObjectFor(
  relationship: RdfRelationship,
  relationshipIri: string | undefined,
): RdfBusinessObject {
  return {
    iri:
      relationshipIri ??
      relationshipKey(relationship.sourceIri, relationship.targetIri, relationship.typeIri),
    typeIri: relationship.typeIri,
    kind: 'relationship',
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
  static $inject = ['eventBus', 'commandStack'];

  constructor(eventBus: DjsEventBus, commandStack: DjsCommandStack) {
    eventBus.on<{ context?: ConnectionCreateContext }>(
      'commandStack.connection.create.preExecute',
      (event) => {
        const context = event.context;
        const relationship = context?.hints?.[RDF_RELATIONSHIP_HINT];
        const connection = context?.connection;
        if (!relationship || !connection) return;

        // The connection object already exists (Modeling.createConnection built
        // it before executing), so the handler can complete its business object.
        const request: RdfRelationshipRequest = { ...relationship, connectionId: connection.id };
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
  hints?: { rdfRelationship?: RdfRelationship };
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
  static $inject = ['eventBus', 'elementFactory', 'commandStack', 'rdfRuleProvider'];

  private rdfRuleProvider: RdfRuleProvider;

  constructor(
    eventBus: unknown,
    elementFactory: unknown,
    commandStack: unknown,
    rdfRuleProvider: RdfRuleProvider,
  ) {
    super(eventBus, elementFactory, commandStack);
    this.rdfRuleProvider = rdfRuleProvider;
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
 * See `connection-docking.ts` for what each of the two does.
 */
export function rdfModelingModule(
  rdfRelationshipWriter: RdfRelationshipWriter,
  rdfElementWriter: RdfElementWriter = inertElementWriter,
): Record<string, unknown> {
  return {
    __depends__: [ModelingModule],
    __init__: ['modeling', 'rdfRelationshipBehavior', 'rdfElementBehavior'],
    modeling: ['type', RdfModeling],
    layouter: ['type', CroppingLayouter],
    connectionDocking: ['type', CroppingConnectionDocking],
    rdfRelationshipBehavior: ['type', RdfRelationshipBehavior],
    rdfRelationshipWriter: ['value', rdfRelationshipWriter],
    rdfElementBehavior: ['type', RdfElementBehavior],
    rdfElementWriter: ['value', rdfElementWriter],
  };
}
