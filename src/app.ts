/**
 * Application entry point — wires all architectural layers together.
 *
 * Platform Abstraction → RDF Engine → Metamodel Manager → Model Manager → UI Layer
 *
 * The EventBus is the central communication mechanism: model mutations
 * emit events that UI panels subscribe to for reactive updates.
 */

import type { NamedNode } from '@rdfjs/types';
import { DataFactory } from 'n3';

// RDF Engine
import type { RdfStore, ShaclValidator, TtlParser, TtlSerializer } from './rdf-engine/interfaces.js';
import { OxigraphRdfStore } from './rdf-engine/rdf-store.js';
import { N3TtlParser } from './rdf-engine/ttl-parser.js';
import { N3TtlSerializer } from './rdf-engine/ttl-serializer.js';
import { RdfShaclValidator } from './rdf-engine/shacl-validator.js';

// Metamodel Manager
import type { MetamodelLoader, PaletteGenerator, ViewpointManager } from './metamodel-manager/interfaces.js';
import { N3MetamodelLoader } from './metamodel-manager/metamodel-loader.js';
import { SparqlPaletteGenerator } from './metamodel-manager/palette-generator.js';
import { SparqlViewpointManager } from './metamodel-manager/viewpoint-manager.js';

// Model Manager
import type { ElementManager, RelationshipManager, ViewManager } from './model-manager/interfaces.js';
import { OxigraphElementManager } from './model-manager/element-manager.js';
import { OxigraphRelationshipManager } from './model-manager/relationship-manager.js';
import { OxigraphViewManager } from './model-manager/view-manager.js';
import { ModelOperations } from './model-manager/model-operations.js';

// Platform
import type { PlatformService } from './platform/interfaces.js';
import { createPlatformService } from './platform/platform-factory.js';

// Import/Export
import { TtlFileIO } from './import-export/ttl-file-io.js';

// UI
import { EventBus } from './ui/event-bus.js';

const { namedNode } = DataFactory;

/** All component instances managed by the App. */
export interface AppComponents {
  platform: PlatformService;
  parser: TtlParser;
  serializer: TtlSerializer;
  store: RdfStore;
  validator: ShaclValidator;
  metamodelLoader: MetamodelLoader;
  paletteGenerator: PaletteGenerator;
  viewpointManager: ViewpointManager;
  elementManager: ElementManager;
  relationshipManager: RelationshipManager;
  viewManager: ViewManager;
  modelOperations: ModelOperations;
  ttlFileIO: TtlFileIO;
  eventBus: EventBus;
}

/**
 * Central application class that instantiates and wires all layers.
 */
export class App {
  readonly components: AppComponents;

  constructor(components: AppComponents) {
    this.components = components;
    this.wireEvents();
  }

  /**
   * Wire event handlers on the EventBus so that model mutations
   * propagate to all interested UI panels and trigger validation.
   */
  private wireEvents(): void {
    const { eventBus, elementManager, paletteGenerator } = this.components;

    // ── Element lifecycle → refresh canvas, explorer, validation ──
    eventBus.on('element-created', () => {
      this.runIncrementalValidation();
    });

    eventBus.on('element-deleted', () => {
      this.runIncrementalValidation();
    });

    eventBus.on('element-updated', () => {
      this.runIncrementalValidation();
    });

    // ── Relationship lifecycle → refresh canvas, validation ──
    eventBus.on('relationship-created', () => {
      this.runIncrementalValidation();
    });

    eventBus.on('relationship-deleted', () => {
      this.runIncrementalValidation();
    });

    // ── Property edits → update RDF store, trigger incremental validation ──
    eventBus.on('property-edited', (event) => {
      const detail = event.detail as { elementIri?: string; property?: string; value?: string } | undefined;
      if (detail?.elementIri && detail.property && detail.value !== undefined) {
        elementManager.updateProperty(
          detail.elementIri,
          detail.property,
          DataFactory.literal(detail.value),
        );
        this.runIncrementalValidation(detail.elementIri);
      }
    });

    // ── Palette drag → create element via Element Manager ──
    eventBus.on('palette-drag', (event) => {
      const detail = event.detail as {
        typeIri?: string; modelIri?: string;
        x?: number; y?: number; width?: number; height?: number;
      } | undefined;
      if (detail?.typeIri && detail.modelIri) {
        const position = {
          x: detail.x ?? 0, y: detail.y ?? 0,
          width: detail.width ?? 130, height: detail.height ?? 60,
        };
        const elem = elementManager.createElement(detail.typeIri, detail.modelIri, position);
        // `iri` / `typeIri` / `bounds` are what DiagramCanvas listens for;
        // `elementIri` is the shape the rest of the app already uses.
        eventBus.emit('element-created', {
          elementIri: elem.value,
          iri: elem.value,
          typeIri: detail.typeIri,
          bounds: position,
        });
      }
    });

    // ── Metamodel loaded → regenerate palette, refresh UI ──
    eventBus.on('metamodel-loaded', (event) => {
      const detail = event.detail as { metamodelIri?: string } | undefined;
      if (detail?.metamodelIri) {
        // Palette generator will re-query the store for the new metamodel
        paletteGenerator.generatePalette(detail.metamodelIri);
      }
    });

    // ── Model loaded / saved → UI state updates are handled by
    //    the AppShell's existing requestUpdate() on these events ──
    eventBus.on('model-loaded', () => {
      this.runIncrementalValidation();
    });

    eventBus.on('model-saved', () => {
      // No-op: UI state update handled by AppShell listener
    });
  }

  /**
   * Run SHACL validation against the current store contents.
   * If a specific resource IRI is provided, runs incremental validation.
   * Emits 'validation-updated' with the report.
   */
  private runIncrementalValidation(resourceIri?: string): void {
    const { store, validator, eventBus } = this.components;
    const dataGraph = store.getQuads();
    // Shapes are stored in the dedicated shapes graph
    const shapesGraph = store.getQuads(
      null, null, null,
      namedNode('urn:la-gram:shapes') as unknown as NamedNode,
    );

    if (shapesGraph.length === 0) return;

    let report;
    if (resourceIri) {
      report = validator.validateIncremental(
        namedNode(resourceIri) as unknown as NamedNode,
        dataGraph,
        shapesGraph,
      );
    } else {
      report = validator.validate(dataGraph, shapesGraph);
    }

    eventBus.emit('validation-updated', {
      conforms: report.conforms,
      resultCount: report.results.length,
      results: report.results,
    });
  }
}

/**
 * Factory function that creates and wires the full application.
 *
 * Instantiates all layers in dependency order:
 * Platform → RDF Engine → Metamodel Manager → Model Manager → Import/Export
 */
export async function createApp(): Promise<App> {
  // 1. Platform
  const platform = await createPlatformService();

  // 2. RDF Engine
  //    OxigraphRdfStore.create() awaits the WASM instantiation that the
  //    browser build of Oxigraph requires; it is a no-op under Node.
  //    rdf-validate-shacl (and n3) are pure JavaScript — no init needed.
  const parser = new N3TtlParser();
  const serializer = new N3TtlSerializer();
  const store = await OxigraphRdfStore.create();
  const validator = new RdfShaclValidator();

  // 3. Metamodel Manager
  const metamodelLoader = new N3MetamodelLoader(parser, store);
  const paletteGenerator = new SparqlPaletteGenerator(store);
  const viewpointManager = new SparqlViewpointManager(store);

  // 4. Model Manager
  const elementManager = new OxigraphElementManager(store);
  const relationshipManager = new OxigraphRelationshipManager(store);
  const viewManager = new OxigraphViewManager(store);
  const modelOperations = new ModelOperations(parser, serializer, store);

  // 5. Import/Export
  const ttlFileIO = new TtlFileIO(parser, serializer, store, platform);

  // 6. Event Bus
  const eventBus = new EventBus();

  return new App({
    platform, parser, serializer, store, validator,
    metamodelLoader, paletteGenerator, viewpointManager,
    elementManager, relationshipManager, viewManager,
    modelOperations, ttlFileIO, eventBus,
  });
}
