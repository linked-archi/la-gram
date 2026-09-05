/**
 * RdfPaletteProvider — diagram-js palette module driven by PaletteGenerator.
 *
 * Generates palette entries from the PaletteDefinition and triggers
 * element creation via ElementManager when entries are dragged to the canvas.
 */

import type { PaletteDefinition, ElementTypeInfo } from '../../metamodel-manager/interfaces.js';
import type { ElementManager, Bounds } from '../../model-manager/interfaces.js';

/** A single palette entry for diagram-js. */
export interface PaletteEntry {
  group: string;
  title: string;
  className: string;
  imageUrl?: string;
  action: {
    dragstart: (event: any) => void;
    click: (event: any) => void;
  };
}

/**
 * Builds diagram-js palette entries from a PaletteDefinition.
 *
 * Each concrete element type becomes a draggable palette entry.
 * Dragging or clicking an entry creates a new element via the ElementManager.
 */
export class RdfPaletteProvider {
  private paletteDefinition: PaletteDefinition;
  private elementManager: ElementManager;
  private modelIri: string;

  constructor(
    paletteDefinition: PaletteDefinition,
    elementManager: ElementManager,
    modelIri: string,
  ) {
    this.paletteDefinition = paletteDefinition;
    this.elementManager = elementManager;
    this.modelIri = modelIri;
  }

  /**
   * Returns palette entries keyed by a unique identifier.
   * Each entry corresponds to a concrete element type from the metamodel.
   */
  getPaletteEntries(): Record<string, PaletteEntry> {
    const entries: Record<string, PaletteEntry> = {};

    for (const group of this.paletteDefinition.elementGroups) {
      for (const element of group.elements) {
        if (element.isAbstract) continue;

        const entryId = this.toEntryId(element.iri);
        entries[entryId] = this.buildEntry(element, group.category);
      }
    }

    return entries;
  }

  /** Update the palette definition (e.g. after viewpoint change). */
  updatePaletteDefinition(paletteDefinition: PaletteDefinition): void {
    this.paletteDefinition = paletteDefinition;
  }

  private buildEntry(element: ElementTypeInfo, category: string): PaletteEntry {
    const defaultBounds: Bounds = { x: 100, y: 100, width: 130, height: 60 };

    const createAction = (event: any) => {
      const position: Bounds = {
        x: event?.x ?? defaultBounds.x,
        y: event?.y ?? defaultBounds.y,
        width: defaultBounds.width,
        height: defaultBounds.height,
      };
      this.elementManager.createElement(element.iri, this.modelIri, position);
    };

    return {
      group: category,
      title: element.label,
      className: `palette-icon-${this.toEntryId(element.iri)}`,
      imageUrl: element.iconUrl,
      action: {
        dragstart: createAction,
        click: createAction,
      },
    };
  }

  /** Convert an IRI to a safe entry ID string. */
  private toEntryId(iri: string): string {
    return iri.replace(/[^a-zA-Z0-9]/g, '-');
  }
}
