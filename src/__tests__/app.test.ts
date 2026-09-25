/**
 * Tests for the App wiring module.
 *
 * Verifies that:
 * - App creates all required components
 * - Event wiring is set up correctly
 * - Key integration flows work (palette-drag → element-created, property-edited → store update)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import type { RdfStore, SparqlResult, TtlParser, TtlSerializer, ShaclValidator, PrefixMap, ValidationReport } from '../rdf-engine/interfaces.js';
import type { LoadedMetamodel, MetamodelLoader, PaletteGenerator, ViewpointManager, MetamodelInfo, PaletteDefinition } from '../metamodel-manager/interfaces.js';
import type { ElementManager, RelationshipManager, ViewManager, Bounds, ViewInfo } from '../model-manager/interfaces.js';
import type { RelationshipTypeInfo } from '../metamodel-manager/interfaces.js';
import { ModelOperations } from '../model-manager/model-operations.js';
import { TtlFileIO } from '../import-export/ttl-file-io.js';
import type { PlatformService } from '../platform/interfaces.js';
import { EventBus } from '../ui/event-bus.js';
import { App, type AppComponents } from '../app.js';

const { namedNode, literal } = DataFactory;

// ── Minimal stubs for each layer ──────────────────────────────────────

function stubParser(): TtlParser {
  return { parse: vi.fn(() => ({ ok: true as const, quads: [] })) };
}

function stubSerializer(): TtlSerializer {
  return { serialize: vi.fn(() => '') };
}

function stubStore(): RdfStore {
  const quads: Quad[] = [];
  return {
    addQuads: vi.fn((qs: Quad[]) => quads.push(...qs)),
    removeQuads: vi.fn((qs: Quad[]) => {
      for (const q of qs) {
        const idx = quads.findIndex(
          (e) => e.subject.value === q.subject.value &&
                 e.predicate.value === q.predicate.value &&
                 e.object.value === q.object.value,
        );
        if (idx >= 0) quads.splice(idx, 1);
      }
    }),
    getQuads: vi.fn(
      (s?: NamedNode | null, p?: NamedNode | null, o?: NamedNode | null, g?: NamedNode | null) => {
        return quads.filter((q) => {
          if (s && q.subject.value !== s.value) return false;
          if (p && q.predicate.value !== p.value) return false;
          if (o && q.object.value !== o.value) return false;
          if (g && q.graph.value !== g.value) return false;
          return true;
        });
      },
    ),
    query: vi.fn((): SparqlResult => ({ type: 'bindings', results: [] })),
    update: vi.fn(),
  };
}

function stubValidator(): ShaclValidator {
  return {
    validate: vi.fn((): ValidationReport => ({ conforms: true, results: [] })),
    validateIncremental: vi.fn((): ValidationReport => ({ conforms: true, results: [] })),
  };
}

function stubPlatform(): PlatformService {
  return {
    readFile: vi.fn(async () => ({ content: '', name: 'test.ttl' })),
    writeFile: vi.fn(async () => {}),
    showOpenDialog: vi.fn(async () => null),
    showSaveDialog: vi.fn(async () => null),
    isDesktop: vi.fn(() => false),
  };
}

function stubElementManager(): ElementManager {
  return {
    createElement: vi.fn((_t: string, _m: string, _p: Bounds) =>
      namedNode('urn:test:elem-1') as unknown as NamedNode),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
}

function stubRelationshipManager(): RelationshipManager {
  return {
    getValidRelationships: vi.fn((): RelationshipTypeInfo[] => []),
    createRelationship: vi.fn(() => null),
    deleteRelationship: vi.fn(),
  };
}

function stubViewManager(): ViewManager {
  return {
    createView: vi.fn(() => namedNode('urn:test:view-1') as unknown as NamedNode),
    getViews: vi.fn((): ViewInfo[] => []),
    addElementToView: vi.fn(),
    removeElementFromView: vi.fn(),
  };
}

const STUB_METAMODEL_INFO: MetamodelInfo = {
  iri: 'urn:test:mm', name: 'Test', version: '1.0', description: '',
};

function stubLoadedMetamodel(): LoadedMetamodel {
  return {
    metamodelIri: 'urn:test:mm#Language',
    manifestGraphIri: 'urn:test:mm#',
    info: STUB_METAMODEL_INFO,
    graphsByRole: { manifest: ['urn:test:mm#'] },
    notationSetIri: 'urn:test:mm#Notation',
    assets: [],
  };
}

function stubMetamodelLoader(): MetamodelLoader {
  return {
    loadMetamodel: vi.fn(async (): Promise<MetamodelInfo> => STUB_METAMODEL_INFO),
    loadMetamodelFromManifest: vi.fn(async (): Promise<LoadedMetamodel> => stubLoadedMetamodel()),
    loadBundledMetamodel: vi.fn(async (): Promise<LoadedMetamodel> => stubLoadedMetamodel()),
    loadShapes: vi.fn(async () => {}),
    resolveImports: vi.fn(async () => {}),
  };
}

function stubPaletteGenerator(): PaletteGenerator {
  return {
    generatePalette: vi.fn((): PaletteDefinition => ({
      elementGroups: [], relationshipTypes: [],
    })),
    filterByViewpoint: vi.fn(
      (p: PaletteDefinition) => p,
    ),
  };
}

function stubViewpointManager(): ViewpointManager {
  return {
    getViewpoints: vi.fn(() => []),
    getPermittedTypes: vi.fn(() => ({ elements: [], relationships: [] })),
  };
}

function buildComponents(overrides: Partial<AppComponents> = {}): AppComponents {
  const parser = overrides.parser ?? stubParser();
  const serializer = overrides.serializer ?? stubSerializer();
  const store = overrides.store ?? stubStore();
  const platform = overrides.platform ?? stubPlatform();
  return {
    platform,
    parser,
    serializer,
    store,
    validator: overrides.validator ?? stubValidator(),
    metamodelLoader: overrides.metamodelLoader ?? stubMetamodelLoader(),
    paletteGenerator: overrides.paletteGenerator ?? stubPaletteGenerator(),
    viewpointManager: overrides.viewpointManager ?? stubViewpointManager(),
    elementManager: overrides.elementManager ?? stubElementManager(),
    relationshipManager: overrides.relationshipManager ?? stubRelationshipManager(),
    viewManager: overrides.viewManager ?? stubViewManager(),
    modelOperations: new ModelOperations(parser, serializer, store),
    ttlFileIO: new TtlFileIO(parser, serializer, store, platform),
    eventBus: overrides.eventBus ?? new EventBus(),
  };
}

describe('App', () => {
  describe('component creation', () => {
    it('exposes all required components', () => {
      const app = new App(buildComponents());
      const c = app.components;
      expect(c.platform).toBeDefined();
      expect(c.parser).toBeDefined();
      expect(c.serializer).toBeDefined();
      expect(c.store).toBeDefined();
      expect(c.validator).toBeDefined();
      expect(c.metamodelLoader).toBeDefined();
      expect(c.paletteGenerator).toBeDefined();
      expect(c.viewpointManager).toBeDefined();
      expect(c.elementManager).toBeDefined();
      expect(c.relationshipManager).toBeDefined();
      expect(c.viewManager).toBeDefined();
      expect(c.modelOperations).toBeDefined();
      expect(c.ttlFileIO).toBeDefined();
      expect(c.eventBus).toBeDefined();
    });
  });

  describe('event wiring', () => {
    let app: App;
    let eventBus: EventBus;

    beforeEach(() => {
      eventBus = new EventBus();
      app = new App(buildComponents({ eventBus }));
    });

    it('registers listeners for all model mutation events', () => {
      const expectedEvents = [
        'element-created', 'element-deleted', 'element-updated',
        'relationship-created', 'relationship-deleted',
        'property-edited', 'palette-drag',
        'metamodel-loaded', 'model-loaded', 'model-saved',
      ] as const;

      for (const evt of expectedEvents) {
        expect(eventBus.listenerCount(evt)).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('palette-drag → element creation flow', () => {
    it('creates an element and emits element-created', () => {
      const eventBus = new EventBus();
      const elementManager = stubElementManager();
      const app = new App(buildComponents({ eventBus, elementManager }));

      const created: string[] = [];
      eventBus.on('element-created', (e) => {
        if (e.detail?.elementIri) created.push(e.detail.elementIri as string);
      });

      eventBus.emit('palette-drag', {
        typeIri: 'urn:test:Type', modelIri: 'urn:test:model',
        x: 10, y: 20, width: 100, height: 50,
      });

      // An element is a model concept; its position belongs to a view, and
      // there is no open view in this stubbed app.
      expect(elementManager.createElement).toHaveBeenCalledWith('urn:test:Type', 'urn:test:model');
      expect(created).toContain('urn:test:elem-1');
    });
  });

  describe('property-edited → store update flow', () => {
    it('calls elementManager.updateProperty on property-edited', () => {
      const eventBus = new EventBus();
      const elementManager = stubElementManager();
      new App(buildComponents({ eventBus, elementManager }));

      eventBus.emit('property-edited', {
        elementIri: 'urn:test:elem-1',
        property: 'http://www.w3.org/2004/02/skos/core#prefLabel',
        value: 'New Label',
      });

      expect(elementManager.updateProperty).toHaveBeenCalledWith(
        'urn:test:elem-1',
        'http://www.w3.org/2004/02/skos/core#prefLabel',
        expect.objectContaining({ value: 'New Label' }),
      );
    });
  });

  describe('metamodel-loaded → palette regeneration', () => {
    it('calls paletteGenerator.generatePalette on metamodel-loaded', () => {
      const eventBus = new EventBus();
      const paletteGenerator = stubPaletteGenerator();
      new App(buildComponents({ eventBus, paletteGenerator }));

      eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:test:mm' });

      expect(paletteGenerator.generatePalette).toHaveBeenCalledWith('urn:test:mm');
    });
  });

  describe('announceLoadedMetamodel', () => {
    it('emits metamodel-loaded for the metamodel loaded at startup', () => {
      const eventBus = new EventBus();
      const loaded = stubLoadedMetamodel();
      const app = new App(buildComponents({ eventBus }), loaded);

      const seen: Record<string, unknown>[] = [];
      eventBus.on('metamodel-loaded', (e) => {
        if (e.detail) seen.push(e.detail);
      });

      expect(app.announceLoadedMetamodel()).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0].metamodelIri).toBe('urn:test:mm#Language');
      expect(seen[0].notationSetIri).toBe('urn:test:mm#Notation');
    });

    it('emits nothing when the metamodel failed to load', () => {
      const eventBus = new EventBus();
      const app = new App(buildComponents({ eventBus }), null);

      let emitted = 0;
      eventBus.on('metamodel-loaded', () => {
        emitted += 1;
      });

      expect(app.announceLoadedMetamodel()).toBe(false);
      expect(emitted).toBe(0);
      expect(app.loadedMetamodel).toBeNull();
    });
  });
});
