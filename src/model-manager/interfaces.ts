/**
 * Model Manager layer interfaces.
 *
 * CRUD operations on architecture model elements, relationships, views and the
 * diagram geometry inside views. All mutations go through this layer to keep
 * the RDF store consistent; the store (not the canvas) is the model of record.
 */

import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RelationshipTypeInfo } from '../metamodel-manager/interfaces.js';

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

/** One element's placement in a diagram view (`arch-vis:ArchNode`). */
export interface NodeInfo {
  nodeIri: string;
  elementIri: string;
  bounds: Bounds;
  /** The element whose node this one is drawn inside (`arch-vis:inNode`), if any. */
  parentElementIri?: string;
}

/** One relationship drawn in a diagram view (`arch-vis:Link`). */
export interface LinkInfo {
  linkIri: string;
  relationshipIri: string;
  sourceNodeIri: string;
  targetNodeIri: string;
  sourceElementIri: string;
  targetElementIri: string;
  /** Persisted route, empty when the layouter should compute one. */
  waypoints: Point[];
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
  /** Delete the view and its geometry; the concepts it showed stay in the model. */
  deleteView(viewIri: string): void;
  collectViewQuads(viewIri: string): Quad[];
  duplicateView(viewIri: string, label?: string): NamedNode;

  /** Place an element (idempotent per view). Returns the node IRI. */
  addElementToView(viewIri: string, elementIri: string, bounds?: Bounds): string;
  /** Remove the element's node, its links, and its `arch:inView` for this view. */
  removeElementFromView(viewIri: string, elementIri: string): void;
  /**
   * Draw an element's node inside another's in the view (`arch-vis:inNode`), or
   * — `undefined` — inside nothing. Bounds are not changed.
   */
  setNodeParent?(viewIri: string, elementIri: string, parentElementIri: string | undefined): void;
  collectNodeQuads(viewIri: string, elementIri: string): Quad[];
  getNodes(viewIri: string): NodeInfo[];
  getNode(viewIri: string, elementIri: string): NodeInfo | undefined;
  updateNodeBounds(viewIri: string, elementIri: string, bounds: Bounds): void;

  /** Draw a relationship between two placed elements. `undefined` if an end is missing. */
  addRelationshipToView(viewIri: string, relationshipIri: string, waypoints?: Point[]): string | undefined;
  removeRelationshipFromView(viewIri: string, relationshipIri: string): void;
  collectLinkQuads(viewIri: string, relationshipIri: string): Quad[];
  getLinks(viewIri: string): LinkInfo[];
  updateLinkWaypoints(viewIri: string, relationshipIri: string, waypoints: Point[]): void;

  /** Views presenting a concept (by `arch:inView` or by geometry). */
  viewsContaining(conceptIri: string): string[];
  /**
   * After a relationship's ends changed: re-point its links at the nodes of
   * the new ends in every view, and remove the link where an end is not placed.
   */
  refreshLinksOf?(relationshipIri: string): void;
}
