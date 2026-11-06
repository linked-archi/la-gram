/**
 * RdfRuleProvider — enforces metamodel constraints on canvas operations.
 *
 * Validates connections based on domain/range constraints from
 * `RelationshipManager.getValidRelationships()`.
 *
 * Two layers, deliberately:
 *
 * - {@link RdfRuleProvider} is a plain, synchronous decision object. It knows
 *   nothing about diagram-js, so the metamodel rules can be exercised on their
 *   own.
 * - {@link RdfRules} adapts it to diagram-js, subclassing the framework's
 *   `RuleProvider` so the decisions reach the command stack and therefore the
 *   connect tool, the context pad and drag previews.
 */

import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider.js';

import type { RelationshipTypeInfo } from '../../metamodel-manager/interfaces.js';
import type { RelationshipManager } from '../../model-manager/interfaces.js';
import type { RdfBusinessObject } from './rdf-renderer.js';
import { labelFitsInside } from './notation-shapes.js';

/**
 * What a permitted connection *is*, not merely that it is permitted.
 *
 * This is the shape bpmn-js's `BpmnRules.canConnect` returns
 * (`{ type: 'bpmn:SequenceFlow' }`): diagram-js's connect tool passes a
 * non-boolean rule result straight into `modeling.connect` as the connection
 * attributes, so returning the winning relationship type here is what lets a
 * connection be born with its type instead of being patched afterwards.
 */
export interface RdfConnectionAttrs {
  /** IRI of the winning relationship *type* (the palette concept, `am4:Serving`). */
  typeIri: string;
  /**
   * The line stands for no relationship: an end is a figure — a note pointing
   * at what it is about, say. `typeIri` is then empty, `candidates` too.
   */
  connector?: boolean;
  /**
   * The type's `arch:unqualifiedForm`, when it publishes one — the predicate a
   * direct triple has to use (`am4:serves` for `am4:Serving`).
   */
  unqualifiedPredicateIri?: string;
  /**
   * Label of the winning type, for prompts and pad titles.
   *
   * Deliberately *not* called `label`. diagram-js's `connection-preview` feeds a
   * truthy rule result straight into `elementFactory.createConnection(attrs)`
   * (`ConnectionPreview.getConnection` → `ensureConnectionAttrs`), and `label` on
   * a diagram-js element is a managed reference into its `labels` collection — so
   * a string there makes `object-refs` throw `Object.defineProperty called on
   * non-object` on every pointer move of a connect drag. bpmn-js keeps its own
   * result to `{ type }` for the same reason. Every key on this interface has to
   * be one a diagram-js element can carry harmlessly.
   */
  typeLabel?: string;
  /**
   * Every type the metamodel allows for the pair, best-ranked first.
   *
   * Carried on the result so the relationship-type menu offers exactly the
   * ranking the rules decided by. Recomputing it later risks a different answer
   * than the one the connection was created from.
   */
  candidates: RelationshipTypeInfo[];
}

/** A required relationship type the pair does not permit, and what it does permit. */
export interface RelationshipRefusal {
  typeIri: string;
  permitted: RelationshipTypeInfo[];
}

/**
 * Validates whether canvas operations (especially connections) are
 * permitted according to the metamodel's domain/range constraints.
 */
export class RdfRuleProvider {
  private relationshipManager: RelationshipManager;

  /**
   * Relationship type the user asked for, when they asked for one.
   *
   * Set by picking a relationship type in the palette (and by the append menu,
   * for one append). It is *required*, not just preferred: a pair the metamodel
   * does not permit it for cannot be connected. Creating the best permitted type
   * instead would hide the rule that forbade the one asked for — Realization
   * between two application components quietly became something else. The
   * canvas says why a release is refused ({@link refusal}).
   */
  private preferredTypeIri?: string;

  constructor(relationshipManager: RelationshipManager) {
    this.relationshipManager = relationshipManager;
  }

  /**
   * Require `typeIri` for the pair being connected. `undefined` goes back to
   * the metamodel's own ranking.
   */
  setPreferredType(typeIri: string | undefined): void {
    this.preferredTypeIri = typeIri;
  }

  /** The currently preferred relationship type, if any. */
  getPreferredType(): string | undefined {
    return this.preferredTypeIri;
  }

  /**
   * The connection the metamodel allows from `sourceTypeIri` to
   * `targetTypeIri`, or `false` when it allows none.
   *
   * `RelationshipManager.getValidRelationships` is the authority on both
   * validity and ranking — closure matching, permissive empty constraints,
   * `arch:Element` / `arch:ModelConcept` wildcards and Association last all live
   * there. This picks its first answer and reports the rest alongside — unless a
   * preferred type was asked for and is among the answers, in which case that one
   * wins. Note the ordering: the preference is applied *after* the manager has
   * ruled, so it can only choose between types the metamodel already allows.
   */
  canConnect(sourceTypeIri: string, targetTypeIri: string): RdfConnectionAttrs | false {
    const candidates = this.relationshipManager.getValidRelationships(
      sourceTypeIri,
      targetTypeIri,
    );

    // A type the user asked for is required: the pair permits it, or nothing.
    const winner = this.preferredTypeIri
      ? candidates.find((candidate) => candidate.iri === this.preferredTypeIri)
      : candidates[0];
    if (!winner) return false;

    return {
      typeIri: winner.iri,
      unqualifiedPredicateIri: winner.unqualifiedPredicateIri,
      typeLabel: winner.label,
      candidates,
    };
  }

  /**
   * Why {@link canConnect} refuses the pair while a type is required: that type,
   * and the types the pair does permit. `undefined` when no type is required or
   * the pair permits it.
   */
  refusal(sourceTypeIri: string, targetTypeIri: string): RelationshipRefusal | undefined {
    const required = this.preferredTypeIri;
    if (!required) return undefined;
    const permitted = this.relationshipManager.getValidRelationships(sourceTypeIri, targetTypeIri);
    if (permitted.some((candidate) => candidate.iri === required)) return undefined;
    return { typeIri: required, permitted };
  }

  /**
   * Check whether an element of the given type can be created on the canvas.
   * Currently all non-abstract element types are allowed.
   */
  canCreate(typeIri: string): boolean {
    // All concrete types from the palette are allowed on the canvas
    return !!typeIri;
  }

  /**
   * Check whether an element can be deleted.
   * Currently all elements can be deleted.
   */
  canDelete(_elementIri: string): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// diagram-js adapter
// ---------------------------------------------------------------------------

/** The bit of a diagram-js element the rules need. */
interface RuleTarget {
  businessObject?: RdfBusinessObject;
  waypoints?: unknown;
  width?: number;
  height?: number;
  /** The container: another shape, or the diagram root. */
  parent?: RuleTarget;
}

/** Context diagram-js passes to the `connection.*` rules. */
interface ConnectContext {
  source?: RuleTarget;
  target?: RuleTarget;
  /** The line whose end is moved, for `connection.reconnect`. */
  connection?: RuleTarget;
}

/** The rules' answer for a line standing for no relationship. */
const CONNECTOR_ATTRS: RdfConnectionAttrs = { typeIri: '', connector: true, candidates: [] };

/**
 * Context diagram-js passes to the `shape.create` rule.
 *
 * `source` is present only for an *append* — `Create` puts the source hint there
 * when `create.start` was given one — and `target` is the prospective parent, not
 * the other end of a relationship.
 */
interface CreateContext {
  shape?: RuleTarget;
  source?: RuleTarget;
  target?: RuleTarget;
}

/** Context diagram-js passes to the `elements.move` rule: the shapes moved, and where to. */
interface MoveContext {
  shapes?: RuleTarget[];
  target?: RuleTarget;
}

/**
 * Bridges {@link RdfRuleProvider} into diagram-js's rule evaluation.
 *
 * ## Why `init()` touches no instance state
 *
 * diagram-js's `RuleProvider` calls `this.init()` from its own constructor,
 * i.e. during `super(...)`, before this subclass's field assignments have run.
 * `init()` therefore only registers closures; the closures dereference
 * `this.rdfRules` when a rule is *evaluated*, which is always later. Reading a
 * field directly inside `init()` would silently see `undefined`.
 */
export class RdfRules extends RuleProvider {
  static $inject = ['eventBus', 'rdfRuleProvider'];

  private rdfRules!: RdfRuleProvider;

  constructor(eventBus: unknown, rdfRuleProvider: RdfRuleProvider) {
    super(eventBus as never);
    this.rdfRules = rdfRuleProvider;
  }

  init(): void {
    this.addRule('connection.create', (context: ConnectContext) => this.checkConnect(context));
    this.addRule('connection.reconnect', (context: ConnectContext) => this.checkReconnect(context));

    // `connection.start` — "may a connection begin here at all?", asked with
    // only a source. `GlobalConnect` (the palette's connect tool) gates its
    // entire hand-off to `Connect` on it, and `Rules.allowed` returns *false*
    // for an action no provider answers, so leaving it unregistered makes the
    // tool arm a drag that can never produce anything: no marker on hover, no
    // connect on release. bpmn-js registers the same rule for the same reason.
    //
    // The answer is deliberately weaker than `connection.create`'s: the target
    // is unknown here, so the only thing that can be checked is that the source
    // is a typed element rather than the root or a connection. Which
    // relationship types the pair admits is still decided on hover, by
    // `checkConnect`.
    this.addRule('connection.start', (context: ConnectContext) => this.checkConnectStart(context));

    // Creating a shape is unconstrained *unless* it is an append, in which case
    // the relationship has to be possible for the gesture to mean anything — or
    // it is dropped into something that cannot hold it.
    this.addRule('shape.create', (context: CreateContext) => this.checkCreate(context));

    // Shapes are freely movable and resizable — on the diagram, or into an
    // element that can hold them (nesting); the metamodel constrains
    // relationships, not layout.
    this.addRule('shape.resize', () => true);
    this.addRule('elements.move', (context: MoveContext) => canContain(context.target, context.shapes));

    // An element grows to hold what is dropped, moved or resized inside it.
    this.addRule('element.autoResize', (context: { target?: RuleTarget }) => isElementShape(context.target));
  }

  /**
   * Allow a connection only when the metamodel offers at least one
   * relationship type for the pair, and say *which* type by returning it.
   *
   * A truthy object reads as "allowed" everywhere diagram-js tests a rule, and
   * `Connect` additionally forwards it to `modeling.connect` as the connection
   * attributes — the mechanism bpmn-js uses to create a typed connection in one
   * command.
   *
   * Returns `undefined` (continue evaluating) while either end is still
   * unknown, which is the state during a drag before the target is hovered.
   */
  private checkConnect(context: ConnectContext): RdfConnectionAttrs | false | undefined {
    // A figure — a group, a shape, a note — is drawing: no relationship has it
    // as an end, but a line may join it to an element or another figure.
    if (isFigure(context.source) || isFigure(context.target)) return this.checkConnector(context);
    const sourceType = context.source?.businessObject?.typeIri;
    const targetType = context.target?.businessObject?.typeIri;
    if (!sourceType || !targetType) return undefined;
    return this.rdfRules.canConnect(sourceType, targetType);
  }

  /**
   * Allow moving an end of a connection onto what the metamodel permits it to
   * join — as for drawing one ({@link checkConnect}), but never undecided.
   *
   * Both ends are always known here: `BendpointMove` asks with the connection's
   * own ends, and mid-drag with whatever is under the pointer — the diagram root
   * over empty canvas. The root has no type, and `checkConnect`'s "cannot decide
   * yet" (`undefined`) reads as *allowed* to diagram-js's `Rules`, so an end let
   * go on empty canvas was reattached to the root: drawn hanging where it was
   * dropped, while the model still had it on its element.
   */
  private checkReconnect(context: ConnectContext): RdfConnectionAttrs | false {
    // A line drawn from a figure keeps a figure at an end; a relationship's keeps none.
    const connector = context.connection?.businessObject?.kind === 'connector';
    const figureEnd = isFigure(context.source) || isFigure(context.target);
    if (connector !== figureEnd) return false;
    return this.checkConnect(context) || false;
  }

  /**
   * A line from or to a figure stands for no relationship: allowed between two
   * different shapes — an element's or a figure's — unless a relationship type
   * was picked to draw. Undecided while the other end is unknown.
   */
  private checkConnector(context: ConnectContext): RdfConnectionAttrs | false | undefined {
    if (this.rdfRules.getPreferredType()) return false;
    const { source, target } = context;
    if (!source || !target) return undefined;
    const isShape = (end: RuleTarget) => !end.waypoints && Boolean(end.parent) && (isFigure(end) || isElementShape(end));
    if (source === target || !isShape(source) || !isShape(target)) return false;
    return CONNECTOR_ATTRS;
  }

  /**
   * Whether a connection may *start* at `source`.
   *
   * True for a shape carrying an element type — every element the metamodel
   * defines can be one end of something. False for the diagram root, which has
   * no `businessObject`, and for a connection, which has a `typeIri` but is a
   * relationship rather than an endpoint; `waypoints` is what tells the two
   * apart. Returning a hard `false` rather than `undefined` matters:
   * `GlobalConnect.canStartConnect` treats `null`/`undefined` as "ignore this
   * hover" and leaves the tool armed over an element it will never accept.
   */
  private checkConnectStart(context: ConnectContext): boolean {
    const source = context.source;
    if (!source || source.waypoints) return false;
    // A figure starts a line to what it is about.
    return Boolean(source.businessObject?.typeIri) || isFigure(source);
  }

  /**
   * Allow a shape to be created, unless it is an append the metamodel forbids.
   *
   * Without this, an append drag over a target the metamodel cannot connect to
   * would still *succeed* — just without the connection. `Create.canCreate`
   * treats a refused `connection.create` as `{ connect: false }`, which is
   * truthy, so it falls back to `modeling.createElements` and leaves an orphan
   * element behind. bpmn-js closes the same hole the same way: `BpmnRules`
   * forwards `shape.create` to `canConnect(source, shape)` whenever a `source` is
   * present.
   *
   * `source` is absent for an ordinary palette create, which stays unconstrained.
   */
  private checkCreate(context: CreateContext): boolean {
    if (!canContain(context.target)) return false;
    const source = context.source;
    if (!source) return true;
    const allowed = this.checkConnect({ source, target: context.shape });
    // `undefined` means a rule cannot decide (an end without a type); do not turn
    // that into a refusal.
    return allowed === undefined ? true : !!allowed;
  }
}

/** A shape standing for an element (not the diagram, not a relationship). */
function isElementShape(target: RuleTarget | undefined): boolean {
  return Boolean(target && !target.waypoints && target.businessObject?.typeIri && target.parent);
}

/** A figure: a group, a shape or a note, standing for no model element. */
function isFigure(target: RuleTarget | undefined): boolean {
  return target?.businessObject?.kind === 'figure';
}

/**
 * Whether shapes may be dropped into `target`: the diagram, or an element or a
 * figure big enough to hold them — not a relationship, not a junction, not a
 * note, and not one of the shapes moved or anything inside them.
 */
function canContain(target: RuleTarget | undefined, moved: readonly RuleTarget[] = []): boolean {
  if (!target) return true;
  if (target.waypoints) return false;
  const figure = isFigure(target);
  if (!figure && !isElementShape(target)) return true;
  if (figure && target.businessObject?.figure?.kind === 'note') return false;
  if (!labelFitsInside(target.width ?? 0, target.height ?? 0)) return false;
  for (let at: RuleTarget | undefined = target; at; at = at.parent) {
    if (moved.includes(at)) return false;
  }
  return true;
}

/**
 * diagram-js module registering the rules.
 *
 * `rdfRuleProvider` is bound as a value so the same decision object can be
 * shared with code outside the diagram (the context pad, for instance).
 */
export function rdfRulesModule(rdfRuleProvider: RdfRuleProvider): Record<string, unknown> {
  return {
    __init__: ['rdfRules'],
    rdfRules: ['type', RdfRules],
    rdfRuleProvider: ['value', rdfRuleProvider],
  };
}
