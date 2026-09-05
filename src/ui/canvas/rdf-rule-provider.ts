/**
 * RdfRuleProvider — enforces metamodel constraints on canvas operations.
 *
 * Validates connections based on domain/range constraints from
 * RelationshipManager.getValidRelationships().
 */

import type { RelationshipManager } from '../../model-manager/interfaces.js';

/** Result of a connection rule check. */
export interface ConnectionRuleResult {
  allowed: boolean;
  validRelationshipTypes: string[];
}

/**
 * Validates whether canvas operations (especially connections) are
 * permitted according to the metamodel's domain/range constraints.
 */
export class RdfRuleProvider {
  private relationshipManager: RelationshipManager;

  constructor(relationshipManager: RelationshipManager) {
    this.relationshipManager = relationshipManager;
  }

  /**
   * Check whether a connection from sourceTypeIri to targetTypeIri is allowed.
   *
   * Returns the list of valid relationship types for the connection.
   * If the list is empty, the connection is not allowed.
   */
  canConnect(sourceTypeIri: string, targetTypeIri: string): ConnectionRuleResult {
    const validTypes = this.relationshipManager.getValidRelationships(
      sourceTypeIri,
      targetTypeIri,
    );

    return {
      allowed: validTypes.length > 0,
      validRelationshipTypes: validTypes.map((t) => t.iri),
    };
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
