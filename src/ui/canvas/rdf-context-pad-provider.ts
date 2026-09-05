/**
 * RdfContextPadProvider — context-sensitive actions per element type.
 *
 * Shows delete action for all elements and connect action for elements
 * that have valid outgoing relationships.
 */

import type { RelationshipManager, ElementManager } from '../../model-manager/interfaces.js';
import type { PaletteDefinition } from '../../metamodel-manager/interfaces.js';

/** A single context pad action entry. */
export interface ContextPadEntry {
  group: string;
  title: string;
  className: string;
  action: (event: any) => void;
}

/** Element info needed for context pad generation. */
export interface ContextPadElement {
  iri: string;
  typeIri: string;
}

/**
 * Generates context pad entries for a selected element.
 *
 * - Delete action: available for all elements
 * - Connect action: available when the element type has valid outgoing relationships
 */
export class RdfContextPadProvider {
  private elementManager: ElementManager;
  private relationshipManager: RelationshipManager;
  private paletteDefinition: PaletteDefinition;
  private onStartConnect?: (sourceElement: ContextPadElement) => void;

  constructor(
    elementManager: ElementManager,
    relationshipManager: RelationshipManager,
    paletteDefinition: PaletteDefinition,
    onStartConnect?: (sourceElement: ContextPadElement) => void,
  ) {
    this.elementManager = elementManager;
    this.relationshipManager = relationshipManager;
    this.paletteDefinition = paletteDefinition;
    this.onStartConnect = onStartConnect;
  }

  /**
   * Returns context pad entries for the given element.
   */
  getContextPadEntries(element: ContextPadElement): Record<string, ContextPadEntry> {
    const entries: Record<string, ContextPadEntry> = {};

    // Delete action — always available
    entries['delete'] = {
      group: 'edit',
      title: 'Delete',
      className: 'context-pad-delete',
      action: () => {
        this.elementManager.deleteElement(element.iri);
      },
    };

    // Connect action — available if element has valid outgoing relationships
    if (this.hasOutgoingRelationships(element.typeIri)) {
      entries['connect'] = {
        group: 'connect',
        title: 'Connect',
        className: 'context-pad-connect',
        action: () => {
          this.onStartConnect?.(element);
        },
      };
    }

    return entries;
  }

  /** Update the palette definition (e.g. after viewpoint change). */
  updatePaletteDefinition(paletteDefinition: PaletteDefinition): void {
    this.paletteDefinition = paletteDefinition;
  }

  /**
   * Check if the given element type has any valid outgoing relationships
   * by checking if it appears in any relationship type's domainTypes.
   */
  private hasOutgoingRelationships(typeIri: string): boolean {
    return this.paletteDefinition.relationshipTypes.some((rel) =>
      rel.domainTypes.includes(typeIri),
    );
  }
}
