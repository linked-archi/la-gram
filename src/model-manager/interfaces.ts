/**
 * Model Manager layer interfaces.
 *
 * CRUD operations on architecture model elements, relationships, views and the
 * diagram geometry inside views. All mutations go through this layer to keep
 * the RDF store consistent; the store (not the canvas) is the model of record.
 */

import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RelationshipTypeInfo } from '../metamodel-manager/interfaces.js';
import type { Appearance, AppearanceChanges } from './appearance.js';

export type { Appearance, AppearanceChanges } from './appearance.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Position and size of a diagram element. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A waypoint on a link's route. */
export interface Point {
  x: number;
  y: number;
}

/** The three kinds of `arch:View`. */
export type ViewKind = 'Diagram' | 'Catalog' | 'Matrix';

/** Metadata about a view resource. */
export interface ViewInfo {
  /** IRI of the view resource. */
  iri: string;
  /** Display label (`skos:prefLabel`). */
  label: string;
  /** View type: Diagram, Catalog, or Matrix. */
  type: ViewKind;
  /** Viewpoint the view conforms to (`arch:viewConformsToViewpoint`). */
  viewpointIri?: string;
  /** Model the view belongs to (`arch:inModel`). */
  modelIri?: string;
}

/** One element's placement in a diagram view (`arch-vis:ArchNode`) — or a figure's. */
/** A placement's own label expression: its text, and the presentation context it is for — every context when absent. */
export interface LabelExpressionInfo {
  context?: string;
  expression: string;
}

export interface NodeInfo {
  /** How it looks in each presentation context it has a style for (core-vis 0.7), over {@link appearance}. */
  contextAppearances?: Record<string, Appearance>;
  /** What its label says, as its own style gives it: one expression a presentation context, one for every context. */
  labelExpressions?: LabelExpressionInfo[];
  nodeIri: string;
  /** The element the node draws; for a figure, which stands for none, the node itself. */
  elementIri: string;
  bounds: Bounds;
  /** The element — or figure — whose node this one is drawn inside (`arch-vis:inNode`), if any. */
  parentElementIri?: string;
  /** The node it is drawn inside — which of that element's placements, when it has several. */
  parentNodeIri?: string;
  /** Set when the node stands for no model element. */
  figure?: FigureInfo;
  /** How an element's placement looks, from its own style; a figure's is in its {@link figure}. */
  appearance?: Appearance;
}

/**
 * What a figure is: drawing only, no model element behind it.
 *
 * - `group` — a box holding others, its name at the top (`arch-vis:ContainerNode`);
 * - `shape` — a core-vis shape type (`arch-vis:ContainerNode` whose `arch-vis:style`
 *   gives `arch-vis:shapeType`), which may hold others too;
 * - `note` — a sticky note: free-standing text (`arch-vis:LabelNode` no element's
 *   `arch-vis:label` points at).
 *
 * Its text is its `skos:prefLabel`.
 */
export type FigureKind = 'group' | 'shape' | 'note';

export interface FigureInfo extends Appearance {
  kind: FigureKind;
  /** The core-vis shape type of a `shape`. */
  shapeType?: string;
  text?: string;
}

/** A figure's colours (`#rrggbb`), on its own core-vis style; absent, the figure's default. */
export interface FigureColours {
  fillColor?: string;
  lineColor?: string;
  fontColor?: string;
}

/** One relationship drawn in a diagram view (`arch-vis:Link`). */
export interface LinkInfo {
  /** How the line looks in each presentation context it has a style for (core-vis 0.7), over {@link appearance}. */
  contextAppearances?: Record<string, Appearance>;
  linkIri: string;
  relationshipIri: string;
  /** What the link starts at: a node, or the link of the relationship it starts at. */
  sourceNodeIri: string;
  /** What the link ends at: a node, or the link of the relationship it ends at. */
  targetNodeIri: string;
  /** The concept it starts at: an element, or a relationship. */
  sourceElementIri: string;
  /** The concept it ends at: an element, or a relationship. */
  targetElementIri: string;
  /** Persisted route, empty when the layouter should compute one. */
  waypoints: Point[];
  /**
   * A line standing for no relationship — a core-vis `arch-vis:Link` with no
   * `arch-vis:archRelationship`, drawn from a note or another figure to what it
   * points at. Its `relationshipIri` is then the link's own IRI, and its ends'
   * `…ElementIri` a figure's node where the end is a figure.
   */
  connector?: boolean;
  /** A connector's text (`skos:prefLabel`): what a line from a note says. */
  text?: string;
  /**
   * Where the relationship's name was moved to: its `arch-vis:LabelNode`'s
   * bounds, in the diagram's coordinates. Absent, the name is at the middle of
   * the route.
   */
  label?: Bounds;
  /** How the line looks, from its own style. */
  appearance?: Appearance;
}

/** A qualified relationship as read from the store. */
export interface RelationshipInfo {
  iri: string;
  /** The `arch:QualifiedRelationship` subclass (e.g. `am4:Serving`). */
  classIri: string;
  /** The unqualified predicate (e.g. `am4:serves`), when the metamodel maps one. */
  predicateIri?: string;
  sourceIri: string;
  targetIri: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// Element Manager
// ---------------------------------------------------------------------------

/** Options for {@link ElementManager.createElement}. */
export interface CreateElementOptions {
  /** `skos:prefLabel`, written language-tagged. Omit for none. */
  label?: string;
  /** Use this IRI instead of minting one (redo, import, collaboration). */
  iri?: string;
  /** Language of the label; `en` by default. */
  language?: string;
}

/** Manages architecture model elements in the RDF store. */
export interface ElementManager {
  /**
   * Create an element: `rdf:type`, `arch:inModel` and (optionally) a label.
   * Placing it in a view is the view manager's job.
   */
  createElement(typeIri: string, modelIri: string, options?: CreateElementOptions): NamedNode;
  updateProperty(elementIri: string, property: string, value: Term): void;
  /** Delete the element from the *model*: every view, every relationship. */
  deleteElement(elementIri: string): void;
  /** The quads {@link deleteElement} would remove — for undo snapshots. */
  collectElementQuads?(elementIri: string): Quad[];
  /**
   * Legacy layout sink for a canvas that has no view manager (an embedded
   * diagram with nowhere to put an `arch-vis:ArchNode`). The Oxigraph manager
   * does not implement it: layout belongs to views.
   */
  updateLayout?(elementIri: string, bounds: Bounds): void;
}

// ---------------------------------------------------------------------------
// Relationship Manager
// ---------------------------------------------------------------------------

/** Request for {@link RelationshipManager.createQualifiedRelationship}. */
export interface CreateRelationshipRequest {
  /** Relationship class (`am4:Serving`) or its unqualified predicate (`am4:serves`). */
  typeIri: string;
  /** The unqualified predicate, when the caller already knows it. */
  predicateIri?: string;
  sourceIri: string;
  targetIri: string;
  modelIri?: string;
  label?: string;
  /** Use this IRI instead of minting one. */
  iri?: string;
}

/** Manages relationships between architecture elements. */
export interface RelationshipManager {
  getValidRelationships(sourceTypeIri: string, targetTypeIri: string): RelationshipTypeInfo[];
  /**
   * Legacy form: a direct triple (returns `null`) or a bare qualified resource.
   * New code uses {@link createQualifiedRelationship}.
   */
  createRelationship(
    typeIri: string,
    sourceIri: string,
    targetIri: string,
    qualified?: boolean,
  ): NamedNode | null;
  /**
   * Create a relationship the way the Linked.Archi pattern prescribes: a
   * qualified resource typed with its class, *and* the unqualified triple.
   */
  createQualifiedRelationship?(request: CreateRelationshipRequest): RelationshipInfo;
  /** Delete a qualified relationship from the model, with its triple and links. */
  deleteRelationship(relationshipIri: string): void;
  /** The quads {@link deleteRelationship} would remove — for undo snapshots. */
  collectRelationshipQuads?(relationshipIri: string): Quad[];
  /** Read one qualified relationship. */
  getRelationship?(relationshipIri: string): RelationshipInfo | undefined;
  /** Every qualified relationship with the element at either end. */
  getRelationshipsOf?(elementIri: string): RelationshipInfo[];
  /**
   * Change a relationship's kind in place: same IRI, same properties, new class
   * type and unqualified triple.
   */
  retypeRelationship?(relationshipIri: string, typeIri: string): RelationshipInfo | undefined;
  /**
   * Move a relationship's ends to other elements (a connection reattached on
   * the canvas): `arch:source`/`arch:target` and the unqualified triple follow.
   */
  reconnectRelationship?(relationshipIri: string, sourceIri: string, targetIri: string): RelationshipInfo | undefined;
}

// ---------------------------------------------------------------------------
// View Manager
// ---------------------------------------------------------------------------

/** Manages architecture views (Diagram, Catalog, Matrix) and their geometry. */
export interface ViewManager {
  createView(
    type: ViewKind,
    viewpointIri?: string,
    options?: { label?: string; modelIri?: string; iri?: string },
  ): NamedNode;
  getViews(modelIri?: string): ViewInfo[];
  getView(viewIri: string): ViewInfo | undefined;
  renameView(viewIri: string, label: string): void;
  setViewpoint(viewIri: string, viewpointIri: string | undefined): void;
  /** Delete the view, its geometry and its placements' and lines' own styles; the concepts it showed stay in the model. */
  deleteView(viewIri: string): void;
  collectViewQuads(viewIri: string): Quad[];
  duplicateView(viewIri: string, label?: string): NamedNode;

  /**
   * Place an element: idempotent per view — the node it has — unless `another`
   * asks for one more placement of it. Returns the node IRI.
   *
   * Wherever an element's IRI keys a node (`getNode`, `updateNodeBounds`,
   * `setNodeParent`, `removeElementFromView`, `collectNodeQuads`), a node's IRI
   * does too, and names that one placement.
   */
  /**
   * Place an element in a view. `another` places it again beside a placement it has; `iri` names the node,
   * where an import keeps its source's names — otherwise it is minted in the view's IRI, `{view}#node-{uuid}`.
   */
  addElementToView(viewIri: string, elementIri: string, bounds?: Bounds, options?: { another?: boolean; iri?: string }): string;
  /**
   * Remove the element's nodes, their links, and its `arch:inView` for this
   * view — or, given a node, that placement alone (`arch:inView` with its last).
   */
  removeElementFromView(viewIri: string, elementIri: string): void;
  /**
   * Draw an element's node inside another's in the view (`arch-vis:inNode`), or
   * — `undefined` — inside nothing. Bounds are not changed.
   */
  setNodeParent?(viewIri: string, elementIri: string, parentElementIri: string | undefined): void;
  /**
   * Draw a figure in a diagram view — a group, a shape, a note — standing for
   * no model element; `parentIri` names the element or figure it is drawn
   * inside. Returns the node's IRI, which is the figure's key wherever an
   * element's IRI keys a node (`getNode`, `updateNodeBounds`, `setNodeParent`,
   * `removeElementFromView`).
   */
  addFigure?(viewIri: string, figure: FigureInfo & { bounds: Bounds; parentIri?: string }, iri?: string): string;
  /** A figure's text (`skos:prefLabel`), or none. */
  setFigureText?(viewIri: string, nodeIri: string, text: string | undefined): void;
  /** A connector's text (its `skos:prefLabel`); none removes it. */
  setConnectorText?(viewIri: string, linkIri: string, text: string | undefined): void;
  /** Set a figure's colours on its own style — `null` takes one back to the default. */
  setFigureColours?(viewIri: string, nodeIri: string, colours: { [K in keyof FigureColours]?: string | null }): void;
  /**
   * Set how one thing drawn in the view looks, on its own style: a node (an
   * element's placement, a figure) or a link (a relationship's line, a line
   * from a note), by its IRI. `null` takes a value back to the default. A
   * style it shares, or one another tool wrote as a blank node, is copied to
   * its own first, so the change is to it alone.
   */
  setAppearance?(viewIri: string, iri: string, changes: AppearanceChanges, context?: string): void;
  /**
   * What a placement's label says (core-vis 0.7's `arch-vis:labelExpression`):
   * its expression for one presentation context (core's
   * `arch:inPresentationContext`), or — `context` absent — for every context;
   * `null` or empty takes it away. On the node's own style.
   */
  setLabelExpression?(viewIri: string, nodeIri: string, context: string | undefined, expression: string | null): void;
  /** Every picture (`arch-vis:image`) any style of the model draws, once each, in order: to pick one again. */
  usedImages?(): string[];
  /**
   * Draw a line standing for no relationship between two nodes of a diagram
   * view (placements or figures; an element's IRI names its first placement)
   * — a note pointing at what it is about.
   * Returns the link's IRI, its key wherever a relationship's IRI keys a link
   * (`updateLinkWaypoints`, `setLinkLabel`, `removeRelationshipFromView`), or
   * `undefined` when an end is not a node of the view.
   */
  addConnector?(
    viewIri: string,
    ends: { sourceNodeIri: string; targetNodeIri: string },
    waypoints?: Point[],
    iri?: string,
  ): string | undefined;
  /** Re-point such a line's ends at other nodes of its view. */
  reconnectConnector?(viewIri: string, linkIri: string, ends: { sourceNodeIri: string; targetNodeIri: string }): void;
  collectNodeQuads(viewIri: string, elementIri: string): Quad[];
  getNodes(viewIri: string): NodeInfo[];
  getNode(viewIri: string, elementIri: string): NodeInfo | undefined;
  updateNodeBounds(viewIri: string, elementIri: string, bounds: Bounds): void;

  /**
   * Draw a relationship between its two ends: placed elements, or — for an end
   * that is a relationship — that relationship's link. `ends` names the
   * placements, when an element has several (its first otherwise). Idempotent
   * per view — the link it has — unless `another` asks for one more line of it.
   * `undefined` if an end is not drawn in the view.
   *
   * Wherever a relationship's IRI keys a link (`updateLinkWaypoints`,
   * `setLinkLabel`, `removeRelationshipFromView`, `collectLinkQuads`), a link's
   * IRI does too, and names that one line.
   */
  addRelationshipToView(
    viewIri: string,
    relationshipIri: string,
    waypoints?: Point[],
    ends?: { sourceNodeIri?: string; targetNodeIri?: string },
    options?: { another?: boolean; iri?: string },
  ): string | undefined;
  removeRelationshipFromView(viewIri: string, relationshipIri: string): void;
  collectLinkQuads(viewIri: string, relationshipIri: string): Quad[];
  getLinks(viewIri: string): LinkInfo[];
  updateLinkWaypoints(viewIri: string, relationshipIri: string, waypoints: Point[]): void;
  /**
   * Keep where a relationship's name is drawn in a view — an
   * `arch-vis:LabelNode` hung on its link with `arch-vis:label` — or, with no
   * bounds, drop it: the name goes back to the middle of the route.
   */
  setLinkLabel?(viewIri: string, relationshipIri: string, bounds: Bounds | undefined): void;

  /** Views presenting a concept (by `arch:inView` or by geometry). */
  viewsContaining(conceptIri: string): string[];
  /** The concepts a view presents (`arch:inView`). */
  getMembers?(viewIri: string): string[];
  /** Present a concept in a catalog or matrix: `arch:inView` alone (idempotent). */
  addMember?(viewIri: string, conceptIri: string): void;
  /** Stop presenting it there: its `arch:inView`. */
  removeMember?(viewIri: string, conceptIri: string): void;
  /**
   * After a relationship's ends changed: re-point its links at the nodes of
   * the new ends in every view, and remove the link where an end is not placed.
   */
  refreshLinksOf?(relationshipIri: string): void;
}
