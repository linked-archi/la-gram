/**
 * Model Manager layer interfaces.
 *
 * CRUD operations on architecture model elements, relationships, and views.
 * All mutations go through this layer to ensure RDF store consistency.
 */

import type { NamedNode, Term } from '@rdfjs/types';
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

/** Metadata about a view resource. */
export interface ViewInfo {
  /** IRI of the view resource. */
  iri: string;
  /** Display label. */
  label: string;
  /** View type: Diagram, Catalog, or Matrix. */
  type: 'Diagram' | 'Catalog' | 'Matrix';
  /** Optional viewpoint IRI assigned to this view. */
  viewpointIri?: string;
}

// ---------------------------------------------------------------------------
// Element Manager
// ---------------------------------------------------------------------------

/** Manages architecture model elements in the RDF store. */
export interface ElementManager {
  createElement(typeIri: string, modelIri: string, position: Bounds): NamedNode;
  updateProperty(elementIri: string, property: string, value: Term): void;
  deleteElement(elementIri: string): void;
  updateLayout(elementIri: string, bounds: Bounds): void;
}

// ---------------------------------------------------------------------------
// Relationship Manager
// ---------------------------------------------------------------------------

/** Manages relationships between architecture elements. */
export interface RelationshipManager {
  getValidRelationships(sourceTypeIri: string, targetTypeIri: string): RelationshipTypeInfo[];
  createRelationship(
    typeIri: string,
    sourceIri: string,
    targetIri: string,
    qualified?: boolean,
  ): NamedNode | null;
  deleteRelationship(relationshipIri: string): void;
}

// ---------------------------------------------------------------------------
// View Manager
// ---------------------------------------------------------------------------

/** Manages architecture views (Diagram, Catalog, Matrix). */
export interface ViewManager {
  createView(type: 'Diagram' | 'Catalog' | 'Matrix', viewpointIri?: string): NamedNode;
  getViews(): ViewInfo[];
  addElementToView(viewIri: string, elementIri: string): void;
  removeElementFromView(viewIri: string, elementIri: string): void;
}
