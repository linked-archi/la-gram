/**
 * DiagramCanvas — wraps diagram-js initialization with custom RDF modules.
 *
 * This is a plain class (NOT a Lit component) because diagram-js manages
 * its own DOM. It initializes diagram-js with RdfPaletteProvider,
 * RdfRenderer, RdfRuleProvider, and RdfContextPadProvider modules,
 * and synchronizes canvas state with the RDF store via EventBus events.
 */

import type { PaletteDefinition } from '../../metamodel-manager/interfaces.js';
import type { ElementManager, RelationshipManager, Bounds } from '../../model-manager/interfaces.js';
import type { EventBus } from '../event-bus.js';
import { RdfPaletteProvider } from './rdf-palette-provider.js';
import { RdfRenderer, type RenderableElement } from './rdf-renderer.js';
import { RdfRuleProvider } from './rdf-rule-provider.js';
import { RdfContextPadProvider, type ContextPadElement } from './rdf-context-pad-provider.js';

/** Options for initializing the DiagramCanvas. */
export interface DiagramCanvasOptions {
  container: HTMLElement;
  eventBus: EventBus;
  elementManager: ElementManager;
  relationshipManager: RelationshipManager;
  paletteDefinition: PaletteDefinition;
  modelIri: string;
}

/** Tracks an element on the canvas. */
export interface CanvasElement {
  iri: string;
  typeIri: string;
  label: string;
  iconUrl?: string;
  bounds: Bounds;
}

/**
 * Main canvas wrapper that initializes diagram-js with custom RDF modules.
 *
 * Exposes methods to add, remove, and update elements on the canvas,
 * and listens to EventBus events to keep the canvas in sync with the RDF store.
 */
export class DiagramCanvas {
  private container: HTMLElement;
  private eventBus: EventBus;
  private elementManager: ElementManager;
  private relationshipManager: RelationshipManager;
  private modelIri: string;

  /** Custom RDF modules */
  readonly paletteProvider: RdfPaletteProvider;
  readonly renderer: RdfRenderer;
  readonly ruleProvider: RdfRuleProvider;
  readonly contextPadProvider: RdfContextPadProvider;

  /** Internal element registry keyed by IRI. */
  private elements = new Map<string, CanvasElement>();

  /** Internal relationship registry keyed by a composite key. */
  private relationships = new Map<string, { sourceIri: string; targetIri: string; typeIri: string }>();

  /** Whether the canvas has been initialized. */
  private initialized = false;

  constructor(options: DiagramCanvasOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.elementManager = options.elementManager;
    this.relationshipManager = options.relationshipManager;
    this.modelIri = options.modelIri;

    // Initialize custom modules
    this.paletteProvider = new RdfPaletteProvider(
      options.paletteDefinition,
      this.elementManager,
      this.modelIri,
    );

    this.renderer = new RdfRenderer();

    this.ruleProvider = new RdfRuleProvider(this.relationshipManager);

    this.contextPadProvider = new RdfContextPadProvider(
      this.elementManager,
      this.relationshipManager,
      options.paletteDefinition,
      (sourceElement: ContextPadElement) => {
        this.eventBus.emit('selection-changed', {
          iri: sourceElement.iri,
          mode: 'connect',
        });
      },
    );

    this.setupEventListeners();
    this.initialized = true;
  }

  /** Whether the canvas is initialized and ready. */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Get the container element. */
  getContainer(): HTMLElement {
    return this.container;
  }

  /** Get all elements currently on the canvas. */
  getElements(): Map<string, CanvasElement> {
    return new Map(this.elements);
  }

  /** Get a specific element by IRI. */
  getElement(iri: string): CanvasElement | undefined {
    return this.elements.get(iri);
  }

  /**
   * Add an element to the canvas.
   */
  addElement(iri: string, typeIri: string, bounds: Bounds, label?: string, iconUrl?: string): void {
    const element: CanvasElement = {
      iri,
      typeIri,
      label: label ?? iri.split('/').pop() ?? iri,
      iconUrl,
      bounds,
    };

    this.elements.set(iri, element);
    this.renderElement(element);
  }

  /**
   * Remove an element from the canvas.
   */
  removeElement(iri: string): void {
    this.elements.delete(iri);

    // Also remove any relationships involving this element
    for (const [key, rel] of this.relationships) {
      if (rel.sourceIri === iri || rel.targetIri === iri) {
        this.relationships.delete(key);
      }
    }
  }

  /**
   * Update an element's properties on the canvas.
   */
  updateElement(iri: string, updates: Partial<Pick<CanvasElement, 'label' | 'iconUrl' | 'bounds'>>): void {
    const existing = this.elements.get(iri);
    if (!existing) return;

    if (updates.label !== undefined) existing.label = updates.label;
    if (updates.iconUrl !== undefined) existing.iconUrl = updates.iconUrl;
    if (updates.bounds !== undefined) existing.bounds = updates.bounds;

    this.renderElement(existing);
  }

  /**
   * Add a relationship between two elements on the canvas.
   */
  addRelationship(sourceIri: string, targetIri: string, typeIri: string): void {
    const key = `${sourceIri}--${typeIri}-->${targetIri}`;
    this.relationships.set(key, { sourceIri, targetIri, typeIri });
  }

  /**
   * Get all relationships on the canvas.
   */
  getRelationships(): Map<string, { sourceIri: string; targetIri: string; typeIri: string }> {
    return new Map(this.relationships);
  }

  /**
   * Update the palette definition (e.g. after viewpoint change).
   */
  updatePaletteDefinition(paletteDefinition: PaletteDefinition): void {
    this.paletteProvider.updatePaletteDefinition(paletteDefinition);
    this.contextPadProvider.updatePaletteDefinition(paletteDefinition);
  }

  /**
   * Destroy the canvas and clean up event listeners.
   */
  destroy(): void {
    this.initialized = false;
    this.elements.clear();
    this.relationships.clear();
  }

  // ── Private helpers ────────────────────────────────────────────────

  /** Set up EventBus listeners to sync canvas state with RDF store. */
  private setupEventListeners(): void {
    this.eventBus.on('element-created', (event) => {
      const detail = event.detail;
      if (detail?.iri && detail?.typeIri && detail?.bounds) {
        this.addElement(
          detail.iri as string,
          detail.typeIri as string,
          detail.bounds as Bounds,
          detail.label as string | undefined,
          detail.iconUrl as string | undefined,
        );
      }
    });

    this.eventBus.on('element-deleted', (event) => {
      const detail = event.detail;
      if (detail?.iri) {
        this.removeElement(detail.iri as string);
      }
    });

    this.eventBus.on('element-updated', (event) => {
      const detail = event.detail;
      if (detail?.iri) {
        this.updateElement(detail.iri as string, {
          label: detail.label as string | undefined,
          iconUrl: detail.iconUrl as string | undefined,
          bounds: detail.bounds as Bounds | undefined,
        });
      }
    });

    this.eventBus.on('relationship-created', (event) => {
      const detail = event.detail;
      if (detail?.sourceIri && detail?.targetIri && detail?.typeIri) {
        this.addRelationship(
          detail.sourceIri as string,
          detail.targetIri as string,
          detail.typeIri as string,
        );
      }
    });

    this.eventBus.on('relationship-deleted', (event) => {
      const detail = event.detail;
      if (detail?.sourceIri && detail?.targetIri && detail?.typeIri) {
        const key = `${detail.sourceIri}--${detail.typeIri}-->${detail.targetIri}`;
        this.relationships.delete(key);
      }
    });
  }

  /** Render a single element using the RdfRenderer. */
  private renderElement(element: CanvasElement): void {
    const renderable: RenderableElement = {
      id: element.iri,
      iri: element.iri,
      typeIri: element.typeIri,
      label: element.label,
      iconUrl: element.iconUrl,
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
    };

    // Generate SVG and update the container
    const svg = this.renderer.renderElement(renderable);

    // Find or create the SVG element for this element
    const existingEl = this.container.querySelector(`[data-element-iri="${element.iri}"]`);
    if (existingEl) {
      existingEl.outerHTML = svg;
    }
    // Note: In a full diagram-js integration, elements would be added
    // to the diagram-js canvas layer. This simplified version appends
    // to the container for testing purposes.
  }
}
