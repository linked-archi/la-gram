// @vitest-environment jsdom

/**
 * Tests for mountUi — the module that fills app-shell's five named slots.
 *
 * These cover the "blank screen" regression: without mounting, app-shell
 * renders empty slots and nothing is visible.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type {
  RdfStore,
  ShaclValidator,
  SparqlResult,
  TtlParser,
  TtlSerializer,
  ValidationReport,
  ValidationResult,
} from '@linked-archi/kernel/rdf-engine/interfaces.js';
import type {
  LoadedMetamodel,
  MetamodelLoader,
  MetamodelInfo,
  PaletteDefinition,
  PaletteGenerator,
  ViewpointManager,
} from '@linked-archi/kernel/metamodel-manager/interfaces.js';
import type {
  Bounds,
  ElementManager,
  RelationshipManager,
  ViewInfo,
  ViewManager,
} from '@linked-archi/kernel/model-manager/interfaces.js';
import type { PlatformService } from '../../platform/interfaces.js';
import { ModelOperations } from '@linked-archi/kernel/model-manager/model-operations.js';
import { TtlFileIO } from '../../import-export/ttl-file-io.js';
import { EventBus } from '../event-bus.js';
import { App, type AppComponents } from '../../app.js';
import { mountUi, modelTitle, DEFAULT_MODEL_IRI, type MountedUi } from '../mount-ui.js';
import type { Dialogs } from '../dialogs.js';
import { RELATIONSHIP_REPLACE_MENU_ID } from '../canvas/rdf-replace-menu-provider.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import {
  ARCH_ELEMENT,
  ARCH_QUALIFIED_RELATIONSHIP,
  BUBBLE_ELEMENT_STYLE,
  BUBBLE_SET,
  GENERIC_RELATIONSHIP_STYLE,
} from '../../__tests__/kernel/basic-fixture.js';
import { installJsdomSvgSupport } from './jsdom-svg-support.js';

// mountUi constructs a real diagram-js Diagram for the canvas slot, which needs
// the SVG layout APIs jsdom does not implement.
installJsdomSvgSupport();

const { namedNode, quad } = DataFactory;

const SHAPES_GRAPH = 'urn:la-gram:shapes';

const SAMPLE_PALETTE: PaletteDefinition = {
  elementGroups: [
    {
      category: 'Business',
      elements: [{ iri: 'urn:t:Actor', label: 'Actor', isAbstract: false }],
    },
  ],
  relationshipTypes: [],
};

const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';

// ── Stubs ─────────────────────────────────────────────────────────────

function stubStore(seed: Quad[] = []): RdfStore {
  const quads: Quad[] = [...seed];
  return {
    addQuads: vi.fn((qs: Quad[]) => quads.push(...qs)),
    removeQuads: vi.fn(),
    getQuads: vi.fn(
      (s?: NamedNode | null, p?: NamedNode | null, o?: NamedNode | null, g?: NamedNode | null) =>
        quads.filter((q) => {
          if (s && q.subject.value !== s.value) return false;
          if (p && q.predicate.value !== p.value) return false;
          if (o && q.object.value !== o.value) return false;
          if (g && q.graph.value !== g.value) return false;
          return true;
        }),
    ),
    query: vi.fn((): SparqlResult => ({ type: 'bindings', results: [] })),
    update: vi.fn(),
  };
}

function buildComponents(overrides: Partial<AppComponents> = {}): AppComponents {
  const parser: TtlParser = { parse: vi.fn(() => ({ ok: true as const, quads: [] })) };
  const serializer: TtlSerializer = { serialize: vi.fn(() => '') };
  const store = overrides.store ?? stubStore();
  const platform: PlatformService = {
    readFile: vi.fn(async () => ({ content: '', name: 't.ttl' })),
    writeFile: vi.fn(async () => {}),
    showOpenDialog: vi.fn(async () => null),
    showSaveDialog: vi.fn(async () => null),
    isDesktop: vi.fn(() => false),
  };
  const validator: ShaclValidator = {
    validate: vi.fn((): ValidationReport => ({ conforms: true, results: [] })),
    validateIncremental: vi.fn((): ValidationReport => ({ conforms: true, results: [] })),
  };
  const metamodelInfo: MetamodelInfo = { iri: 'urn:mm', name: '', version: '', description: '' };
  const loadedMetamodel: LoadedMetamodel = {
    metamodelIri: 'urn:mm',
    manifestGraphIri: 'urn:mm',
    info: metamodelInfo,
    graphsByRole: {},
    assets: [],
  };
  const metamodelLoader: MetamodelLoader = {
    loadMetamodel: vi.fn(async (): Promise<MetamodelInfo> => metamodelInfo),
    loadMetamodelFromManifest: vi.fn(async (): Promise<LoadedMetamodel> => loadedMetamodel),
    loadBundledMetamodel: vi.fn(async (): Promise<LoadedMetamodel> => loadedMetamodel),
    loadShapes: vi.fn(async () => {}),
    resolveImports: vi.fn(async () => {}),
  };
  const paletteGenerator: PaletteGenerator = {
    generatePalette: vi.fn((): PaletteDefinition => SAMPLE_PALETTE),
    filterByViewpoint: vi.fn((p: PaletteDefinition) => p),
  };
  const viewpointManager: ViewpointManager = {
    getViewpoints: vi.fn(() => []),
    getPermittedTypes: vi.fn(() => ({ elements: [], relationships: [] })),
  };
  const elementManager: ElementManager = {
    createElement: vi.fn(
      (_t: string, m: string, _p: Bounds) => namedNode(`${m}/elem-1`) as unknown as NamedNode,
    ),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn(() => []),
    createRelationship: vi.fn(() => null),
    deleteRelationship: vi.fn(),
  };
  const viewManager: ViewManager = {
    createView: vi.fn(() => namedNode('urn:v') as unknown as NamedNode),
    getViews: vi.fn((): ViewInfo[] => []),
    getView: vi.fn(() => undefined),
    renameView: vi.fn(),
    setViewpoint: vi.fn(),
    deleteView: vi.fn(),
    collectViewQuads: vi.fn(() => []),
    duplicateView: vi.fn(() => namedNode('urn:v2') as unknown as NamedNode),
    addElementToView: vi.fn(() => 'urn:v/node/1'),
    removeElementFromView: vi.fn(),
    collectNodeQuads: vi.fn(() => []),
    getNodes: vi.fn(() => []),
    getNode: vi.fn(() => undefined),
    updateNodeBounds: vi.fn(),
    addRelationshipToView: vi.fn(() => undefined),
    removeRelationshipFromView: vi.fn(),
    collectLinkQuads: vi.fn(() => []),
    getLinks: vi.fn(() => []),
    updateLinkWaypoints: vi.fn(),
    viewsContaining: vi.fn(() => []),
  };

  return {
    platform,
    parser,
    serializer,
    store,
    validator,
    metamodelLoader,
    paletteGenerator,
    viewpointManager,
    elementManager,
    relationshipManager,
    viewManager,
    modelOperations: new ModelOperations(parser, serializer, store),
    ttlFileIO: new TtlFileIO(parser, serializer, store, platform),
    eventBus: overrides.eventBus ?? new EventBus(),
    ...overrides,
  };
}

/** Direct light-DOM children of the shell assigned to a given slot. */
function slotted(ui: MountedUi, slot: string): Element[] {
  return [...ui.shell.children].filter((el) => el.getAttribute('slot') === slot);
}

describe('mountUi', () => {
  let root: HTMLElement;
  let app: App;
  let ui: MountedUi;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    app = new App(buildComponents());
    ui = mountUi(app, root);
  });

  afterEach(() => {
    ui.dispose();
    root.remove();
  });

  describe('custom element registration', () => {
    it.each([
      'app-shell',
      'palette-panel',
      'property-panel',
      'model-explorer',
      'validation-panel',
      'sparql-editor',
      'catalog-view',
      'matrix-view',
    ])('registers <%s>', (tag) => {
      expect(customElements.get(tag)).toBeDefined();
    });
  });

  describe('slot assignment', () => {
    it('appends the shell to the root', () => {
      expect(ui.shell.parentElement).toBe(root);
      expect(root.querySelectorAll('app-shell')).toHaveLength(1);
    });

    it.each([
      ['explorer', 'MODEL-EXPLORER'],
      ['palette', 'PALETTE-PANEL'],
      ['properties', 'PROPERTY-PANEL'],
      ['validation', 'VALIDATION-PANEL'],
      ['sparql', 'SPARQL-EDITOR'],
      ['graph', 'GRAPH-PANEL'],
      ['rdf', 'RDF-PANEL'],
    ])('fills the %s slot with %s', (slot, tagName) => {
      const els = slotted(ui, slot);
      expect(els).toHaveLength(1);
      expect(els[0].tagName).toBe(tagName);
    });

    it('fills the canvas slot with the diagram host', () => {
      const els = slotted(ui, 'canvas');
      expect(els).toHaveLength(1);
      expect(els[0].contains(ui.canvasHost)).toBe(true);
    });

    it('puts the properties, validation and SPARQL editor in the bottom panel’s tabs', () => {
      expect(slotted(ui, 'properties')[0]).toBe(ui.propertyPanel);
      expect(slotted(ui, 'validation')[0]).toBe(ui.validationPanel);
      expect(slotted(ui, 'sparql')[0]).toBe(ui.sparqlEditor);
    });

    it('leaves no slot empty', () => {
      for (const slot of ['toolbar', 'explorer', 'canvas', 'properties', 'validation', 'sparql', 'graph', 'palette', 'rdf']) {
        expect(slotted(ui, slot).length).toBeGreaterThan(0);
      }
    });
  });

  describe('component wiring', () => {
    it('passes the App event bus to the shell', () => {
      expect(ui.shell.eventBus).toBe(app.components.eventBus);
    });

    it('gives the store to every store-backed panel', () => {
      const { store } = app.components;
      // The model tree reads a classified snapshot of the store, not raw quads.
      expect(ui.modelExplorer.contentsProvider).toBeTypeOf('function');
      expect(ui.propertyPanel.rdfStore).toBe(store);
      expect(ui.sparqlEditor.rdfStore).toBe(store);
      expect(ui.catalogView.rdfStore).toBe(store);
      expect(ui.matrixView.rdfStore).toBe(store);
    });

    it('gives the element manager to the catalog, and routes property edits through the App', () => {
      // The property panel emits edits instead of writing: the App tags text
      // with its language, which the Linked.Archi shapes require of labels.
      expect(ui.propertyPanel.elementManager).toBeUndefined();
      expect(ui.catalogView.elementManager).toBe(app.components.elementManager);
    });

    it('gives the validator to the validation panel', () => {
      expect(ui.validationPanel.validator).toBe(app.components.validator);
    });

    it('initializes the diagram canvas on the canvas host', () => {
      expect(ui.diagramCanvas.isInitialized()).toBe(true);
      expect(ui.diagramCanvas.getContainer()).toBe(ui.canvasHost);
    });
  });

  describe('event routing', () => {
    it('pushes validation-updated results into the validation panel', () => {
      const result: ValidationResult = {
        focusNode: namedNode('urn:e:1') as unknown as NamedNode,
        resultPath: namedNode('urn:p:1') as unknown as NamedNode,
        sourceShape: namedNode('urn:s:1') as unknown as NamedNode,
        message: 'boom',
        severity: 'Violation',
      };

      app.components.eventBus.emit('validation-updated', {
        conforms: false,
        resultCount: 1,
        results: [result],
      });

      expect(ui.validationPanel.conforms).toBe(false);
      expect(ui.validationPanel.results).toEqual([result]);
    });

    it("drops the last model's findings when another opens, until its own come", () => {
      const result: ValidationResult = {
        focusNode: namedNode('urn:e:1') as unknown as NamedNode,
        resultPath: namedNode('urn:p:1') as unknown as NamedNode,
        sourceShape: namedNode('urn:s:1') as unknown as NamedNode,
        message: 'boom',
        severity: 'Violation',
      };
      app.components.eventBus.emit('validation-updated', { conforms: false, resultCount: 1, results: [result] });
      // Validation is due (debounced, or running in the worker) when the model opens.
      vi.spyOn(app, 'scheduleValidation').mockImplementation(() => {});
      vi.spyOn(app, 'validationPending').mockReturnValue(true);
      vi.spyOn(app, 'shapesGraph').mockReturnValue([result as never]);
      app.components.eventBus.emit('model-loaded', { modelIri: 'urn:m:2' });
      expect([ui.validationPanel.results, ui.validationPanel.validating, ui.shell.tabBadges]).toEqual([[], true, {}]);
      app.components.eventBus.emit('validation-updated', { conforms: false, resultCount: 1, results: [result] });
      expect([ui.validationPanel.results, ui.validationPanel.validating]).toEqual([[result], false]);
    });

    it('regenerates the palette when a metamodel is loaded', () => {
      expect(ui.palettePanel.palette.elementGroups).toHaveLength(0);

      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenCalledWith('urn:mm', {
        axisIri: undefined,
      });
      // The generated palette, each element type with no icon given its drawn figure.
      const shown = ui.palettePanel.palette;
      expect(shown.elementGroups.map((g) => g.elements.map((e) => e.iri))).toEqual([['urn:t:Actor']]);
      expect(shown.elementGroups[0]!.elements[0]!.iconUrl).toMatch(/^data:image\/svg\+xml/);
    });

    it('draws the figure of an element type whose named icon does not load, and keeps the one that does', async () => {
      const missing = 'https://example.org/icons/glyphs/application.svg';
      const published = 'https://example.org/icons/glyphs/actor.svg';
      vi.stubGlobal(
        'Image',
        class {
          onerror: (() => void) | null = null;
          onload: (() => void) | null = null;
          set src(value: string) {
            setTimeout(() => (value === missing ? this.onerror?.() : this.onload?.()), 0);
          }
        },
      );
      vi.mocked(app.components.paletteGenerator.generatePalette).mockReturnValue({
        elementGroups: [
          {
            category: 'Application',
            elements: [
              { iri: 'urn:t:Application', label: 'Application', iconUrl: missing, isAbstract: false, style: { shapeType: 'RoundedRectangle', fillColor: '#E8F5E9' } },
              { iri: 'urn:t:Actor', label: 'Actor', iconUrl: published, isAbstract: false },
            ],
          },
        ],
        relationshipTypes: [],
      });
      try {
        app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });
        const icons = () => ui.palettePanel.palette.elementGroups[0]!.elements.map((e) => e.iconUrl);
        expect(icons()).toEqual([missing, published]);
        await vi.waitFor(() => expect(icons()[0]).toMatch(/^data:image\/svg\+xml/));
        expect(decodeURIComponent(icons()[0]!)).toContain('fill="#E8F5E9"');
        expect(icons()[1]).toBe(published);
        // Known not to load: the next palette draws it at once.
        app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });
        expect(icons()[0]).toMatch(/^data:image\/svg\+xml/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('draws the icon of a relationship type whose named icon does not load, and keeps the one that does', async () => {
      const missing = 'https://example.org/img/rel_serving.svg';
      const published = 'https://example.org/img/rel_flow.svg';
      // The page's images: the missing one fails, as an unpublished link does.
      vi.stubGlobal(
        'Image',
        class {
          onerror: (() => void) | null = null;
          onload: (() => void) | null = null;
          set src(value: string) {
            setTimeout(() => (value === missing ? this.onerror?.() : this.onload?.()), 0);
          }
        },
      );
      vi.mocked(app.components.paletteGenerator.generatePalette).mockReturnValue({
        ...SAMPLE_PALETTE,
        relationshipTypes: [
          { iri: 'urn:t:Serving', label: 'Serving', iconUrl: missing, relationshipStyle: { targetDecor: 'OpenArrowhead' }, domainTypes: [], rangeTypes: [] },
          { iri: 'urn:t:Flow', label: 'Flow', iconUrl: published, domainTypes: [], rangeTypes: [] },
        ],
      });
      try {
        app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });
        expect(ui.palettePanel.palette.relationshipTypes.map((r) => r.iconUrl)).toEqual([missing, published]);
        await vi.waitFor(() => expect(ui.palettePanel.palette.relationshipTypes[0]!.iconUrl).toMatch(/^data:image\/svg\+xml/));
        expect(ui.palettePanel.palette.relationshipTypes[1]!.iconUrl).toBe(published);
        // Known not to load: the next palette draws it at once.
        app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });
        expect(ui.palettePanel.palette.relationshipTypes[0]!.iconUrl).toMatch(/^data:image\/svg\+xml/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('regroups the palette when the panel asks for another axis', () => {
      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-axis-change', {
          detail: { axisIri: 'urn:axis:aspect' },
          bubbles: true,
          composed: true,
        }),
      );

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenLastCalledWith('urn:mm', {
        axisIri: 'urn:axis:aspect',
      });
    });

    it('regroups the palette through setPaletteAxis', () => {
      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });

      ui.setPaletteAxis('urn:axis:domain');

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenLastCalledWith('urn:mm', {
        axisIri: 'urn:axis:domain',
      });
    });

    it("passes the loaded metamodels — each with the documents it loaded (Req 2.24) — and their default notation sets, in load order (Req 2.16)", () => {
      const loaded = (iri: string, notationSetIri?: string): LoadedMetamodel => ({
        metamodelIri: iri,
        manifestGraphIri: iri,
        info: { iri, name: `${iri.slice(7)} Metamodel`, version: '', description: '' },
        graphsByRole: {},
        assets: [
          { referencedIri: `${iri}:onto`, documentIri: `${iri}:onto`, via: 'arch:modelConcepts', outcome: 'loaded' },
          { referencedIri: `${iri}:gone`, documentIri: `${iri}:gone`, via: 'arch:formalRules', outcome: 'unavailable' },
        ],
        ...(notationSetIri ? { notationSetIri } : {}),
      });
      vi.spyOn(app, 'loadedMetamodels').mockReturnValue([
        loaded('urn:mm:primary', 'urn:set:primary'),
        loaded('urn:mm:without-a-set'),
        loaded('urn:mm:added', 'urn:set:added'),
      ]);

      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm:primary' });

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenLastCalledWith('urn:mm:primary', {
        metamodelIris: ['urn:mm:primary', 'urn:mm:without-a-set', 'urn:mm:added'],
        metamodels: [
          { iri: 'urn:mm:primary', label: 'primary', documents: ['urn:mm:primary:onto'], conceptDocuments: ['urn:mm:primary:onto'] },
          { iri: 'urn:mm:without-a-set', label: 'without-a-set', documents: ['urn:mm:without-a-set:onto'], conceptDocuments: ['urn:mm:without-a-set:onto'] },
          { iri: 'urn:mm:added', label: 'added', documents: ['urn:mm:added:onto'], conceptDocuments: ['urn:mm:added:onto'] },
        ],
        defaultNotationSetIris: ['urn:set:primary', 'urn:set:added'],
      });
    });

    it('routes an explorer selection to the property panel', () => {
      const seen: string[] = [];
      app.components.eventBus.on('selection-changed', (e) => {
        seen.push(e.detail?.iri as string);
      });

      ui.modelExplorer.dispatchEvent(
        new CustomEvent('explorer-select', { detail: { iri: 'urn:e:42' } }),
      );

      expect(ui.propertyPanel.selectedIri).toBe('urn:e:42');
      expect(seen).toContain('urn:e:42');
    });

    it('writes a property-panel edit to the store, replacing only the value edited', () => {
      const store = app.components.store;
      const label = (value: string, language: string) =>
        DataFactory.quad(DataFactory.namedNode('urn:e:1'), DataFactory.namedNode(SKOS_PREF_LABEL), DataFactory.literal(value, language)) as unknown as Quad;
      store.addQuads([label('Old', 'en'), label('Alt', 'de')]);

      ui.propertyPanel.dispatchEvent(
        new CustomEvent('property-edit', {
          detail: { elementIri: 'urn:e:1', predicate: SKOS_PREF_LABEL, value: 'Hello', language: 'en', previous: 'Old', previousLanguage: 'en' },
        }),
      );

      const removed = (store.removeQuads as ReturnType<typeof vi.fn>).mock.calls.flat(2) as Quad[];
      expect(removed.map((q) => q.object.value)).toEqual(['Old']);
      const added = (store.addQuads as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Quad[];
      expect(added.map((q) => [q.object.value, (q.object as { language?: string }).language])).toEqual([['Hello', 'en']]);
    });

    it('writes a value chosen from a list as the IRI it is, and a datatype\'s value typed', () => {
      const store = app.components.store;
      for (const detail of [
        { elementIri: 'urn:e:1', predicate: 'urn:p:state', value: 'urn:v:Production', isIri: true },
        { elementIri: 'urn:e:1', predicate: 'urn:p:orphan', value: 'true', datatype: 'http://www.w3.org/2001/XMLSchema#boolean' },
      ]) {
        ui.propertyPanel.dispatchEvent(new CustomEvent('property-edit', { detail }));
      }
      const added = (store.addQuads as ReturnType<typeof vi.fn>).mock.calls.slice(-2).map((call) => (call[0] as Quad[])[0].object);
      expect(added[0].termType).toBe('NamedNode');
      expect(added[1]).toMatchObject({ termType: 'Literal', value: 'true', datatype: { value: 'http://www.w3.org/2001/XMLSchema#boolean' } });
    });

    /**
     * Pressing on a sidebar entry hands the gesture to diagram-js's `create`
     * rather than writing triples, which is the whole point of dropping the HTML5
     * drag-and-drop path: the drag gets a preview, snapping and a drop position
     * from diagram-js, and the element is minted inside the `shape.create`
     * command. `dragging` is put in manual mode so the armed drag can be
     * inspected without a real pointer.
     */
    const armedDrag = (): { prefix?: string } | null => {
      const diagram = ui.diagramCanvas.getDiagram()!;
      return (
        diagram as unknown as { get(n: string): { context(): { prefix?: string } | null } }
      )
        .get('dragging')
        .context();
    };

    const manualDragging = (): void => {
      const diagram = ui.diagramCanvas.getDiagram()!;
      (diagram as unknown as { get(n: string): { setOptions(o: unknown): void } })
        .get('dragging')
        .setOptions({ manual: true });
    };

    it('starts a diagram-js create drag when a sidebar entry is pressed', () => {
      manualDragging();

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-drag-start', {
          detail: {
            iri: 'urn:t:Actor',
            label: 'Actor',
            kind: 'element',
            sourceEvent: new MouseEvent('mousedown', { clientX: 40, clientY: 55, button: 0 }),
          },
        }),
      );

      expect(armedDrag()?.prefix).toBe('create');
      // Nothing is written until the drop.
      expect(app.components.elementManager.createElement).not.toHaveBeenCalled();
    });

    it('arms the connect tool with the type when a relationship entry is picked', () => {
      manualDragging();

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-drag-start', {
          detail: {
            iri: 'urn:t:Serving',
            label: 'Serving',
            kind: 'relationship',
            sourceEvent: new MouseEvent('click', { clientX: 5, clientY: 5, button: 0 }),
          },
        }),
      );

      // A relationship is not a shape, so there is nothing to create — the type
      // is remembered and the connect tool takes over.
      expect(ui.diagramCanvas.preferredRelationshipType()).toBe('urn:t:Serving');
      expect(armedDrag()?.prefix).toBe('global-connect');
    });

    it('ignores an entry that names no type', () => {
      manualDragging();

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-drag-start', {
          detail: { iri: '', label: '', kind: 'element', sourceEvent: new MouseEvent('mousedown') },
        }),
      );

      // `Dragging.context()` reports `undefined` when nothing is armed.
      expect(armedDrag()).toBeFalsy();
      expect(app.components.elementManager.createElement).not.toHaveBeenCalled();
    });

    it('activates a tool from the toolbar, and clears any preselected type', () => {
      manualDragging();
      ui.diagramCanvas.setPreferredRelationshipType('urn:t:Serving');

      ui.canvasToolbar.dispatchEvent(
        new CustomEvent('toolbar-tool', {
          detail: { tool: 'hand', sourceEvent: new MouseEvent('click', { button: 0 }) },
        }),
      );

      expect(armedDrag()?.prefix).toBe('hand');
      // Picking a tool by hand means "use the metamodel's own ranking again".
      expect(ui.diagramCanvas.preferredRelationshipType()).toBeUndefined();
    });

    it('shows the armed tool on the toolbar, and stops showing it when dropped', () => {
      manualDragging();
      const diagram = ui.diagramCanvas.getDiagram()!;
      const dragging = (
        diagram as unknown as { get(n: string): { cancel(): void } }
      ).get('dragging');

      ui.canvasToolbar.dispatchEvent(
        new CustomEvent('toolbar-tool', {
          detail: { tool: 'lasso', sourceEvent: new MouseEvent('click', { button: 0 }) },
        }),
      );
      expect(ui.canvasToolbar.activeTool).toBe('lasso');

      dragging.cancel();
      expect(ui.canvasToolbar.activeTool).toBeUndefined();
    });
  });

  describe('canvas view switching', () => {
    it('shows the diagram by default', () => {
      expect(ui.activeCanvasView()).toBe('diagram');
      expect(ui.canvasHost.hidden).toBe(false);
      expect(ui.catalogView.hidden).toBe(true);
      expect(ui.matrixView.hidden).toBe(true);
    });

    it.each(['catalog', 'matrix'] as const)('switches to the %s view', (kind) => {
      ui.setActiveCanvasView(kind);

      expect(ui.activeCanvasView()).toBe(kind);
      expect(ui.canvasHost.hidden).toBe(true);
      expect(ui.catalogView.hidden).toBe(kind !== 'catalog');
      expect(ui.matrixView.hidden).toBe(kind !== 'matrix');
    });
  });

  describe('relationship drawing', () => {
    it('registers the relationship-replace popup menu on the canvas diagram', () => {
      // Retyping is diagram-js's own affair now: the provider lives on the
      // `popupMenu` service, so `mountUi` has nothing left to wire for it.
      const diagram = ui.diagramCanvas.getDiagram()!;
      const popupMenu = (
        diagram as unknown as {
          get(name: string): { isEmpty(target: unknown, providerId: string): boolean };
        }
      ).get('popupMenu');

      expect(ui.diagramCanvas.replaceMenuProvider).toBeDefined();
      // No relationship types in the empty starting palette, so nothing to offer
      // — but the provider is registered, which is what `isEmpty` returning
      // without throwing "provider not found" shows.
      expect(popupMenu.isEmpty({ id: 'nothing' }, RELATIONSHIP_REPLACE_MENU_ID)).toBe(true);
    });

    it('binds diagram-js keyboard handling, so undo has a key', () => {
      const diagram = ui.diagramCanvas.getDiagram()!;
      const keyboard = (
        diagram as unknown as { get(name: string): { getBinding(): EventTarget | null } }
      ).get('keyboard');
      const editorActions = (
        diagram as unknown as { get(name: string): { getActions(): string[] } }
      ).get('editorActions');

      expect(keyboard.getBinding()).toBe(document);
      expect(editorActions.getActions()).toEqual(expect.arrayContaining(['undo', 'redo']));
    });

    it('gives the canvas a relationship manager that falls back to the palette', () => {
      // The App's manager reports nothing (it queries the default graph, while
      // the metamodel is loaded into named graphs), so without the fallback the
      // rule provider would refuse every connection.
      expect(app.components.relationshipManager.getValidRelationships('a', 'b')).toEqual([]);

      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });
      ui.palettePanel.palette = SAMPLE_PALETTE;

      // SAMPLE_PALETTE declares no relationship types, so there is still nothing
      // to offer — but the canvas asked the wrapper, not the bare manager.
      expect(ui.diagramCanvas.relationshipCandidates('urn:t:Actor', 'urn:t:Actor')).toEqual([]);
    });

    it('puts the global tools in a toolbar above the diagram, not in the canvas', () => {
      // diagram-js's own palette is not registered at all — its entries would be
      // the element types the sidebar already lists.
      const diagram = ui.diagramCanvas.getDiagram()!;
      expect(() =>
        (diagram as unknown as { get(n: string): unknown }).get('palette'),
      ).toThrow();

      expect(ui.canvasToolbar).toBeDefined();
      // Mounted ahead of the diagram host, inside the canvas slot.
      const area = ui.canvasHost.parentElement!;
      expect(Array.from(area.children).indexOf(ui.canvasToolbar)).toBe(0);
      expect(Array.from(area.children).indexOf(ui.canvasHost)).toBe(1);
    });
  });

  describe('notation look outside the canvas (Req 2.16)', () => {
    /** A class no taxonomy names, so the palette never lists it. */
    const UNLISTED = 'https://example.org/extra#Unlisted';
    const LISTED = 'urn:t:Styled';
    const LISTED_RELATIONSHIP = 'urn:t:Serving';
    const ELEMENT = 'urn:e:unlisted-1';

    /**
     * A palette whose notation index answers for types it does not list, as the
     * generator resolves them with Basic's bubble set active: a class under
     * arch:Element, and the generic relationship, which the palette lists only
     * when the core taxonomy names it.
     */
    const paletteWithIndex = (): PaletteDefinition => ({
      elementGroups: [
        {
          category: 'Business',
          elements: [
            { iri: LISTED, label: 'Styled', isAbstract: false, style: { shapeType: 'Rectangle', fillColor: '#FFFFB5' } },
          ],
        },
      ],
      relationshipTypes: [
        {
          iri: LISTED_RELATIONSHIP,
          label: 'Serving',
          domainTypes: [],
          rangeTypes: [],
          relationshipStyle: { lineStyle: 'SolidLine', sourceDecor: 'NoDecoration', targetDecor: 'OpenArrowhead' },
        },
      ],
      notationIndex: {
        [UNLISTED]: {
          source: 'active-superclass',
          notationSetIri: BUBBLE_SET,
          matchedClassIri: ARCH_ELEMENT,
          style: { ...BUBBLE_ELEMENT_STYLE },
          renderingMode: 'ShapeOnly',
        },
        [ARCH_QUALIFIED_RELATIONSHIP]: {
          source: 'active',
          notationSetIri: BUBBLE_SET,
          matchedClassIri: ARCH_QUALIFIED_RELATIONSHIP,
          relationshipStyle: { ...GENERIC_RELATIONSHIP_STYLE },
        },
        // Same IRIs as palette entries, styled differently: the palette entries must win.
        [LISTED]: { source: 'fallback', style: { shapeType: 'Circle', fillColor: '#000001', defaultWidth: 10, defaultHeight: 10 } },
        [LISTED_RELATIONSHIP]: {
          source: 'fallback',
          style: { fillColor: '#000002' },
          relationshipStyle: { lineStyle: 'DottedLine' },
        },
      },
    });

    /** Dialogs that answer every prompt with `answer`. */
    const scriptedDialogs = (answer: string): Dialogs => ({
      prompt: vi.fn(async () => answer),
      form: vi.fn(async () => null),
      confirm: vi.fn(async () => false),
      choose: vi.fn(async () => null),
      info: vi.fn(async () => {}),
      toast: vi.fn(),
    });

    let scopedRoot: HTMLElement;
    let scopedUi: MountedUi;
    let components: AppComponents;

    beforeEach(() => {
      const store = stubStore([
        quad(namedNode(ELEMENT), namedNode(`${NAMESPACES.rdf}type`), namedNode(UNLISTED)) as unknown as Quad,
      ]);
      const paletteGenerator: PaletteGenerator = {
        generatePalette: vi.fn(paletteWithIndex),
        filterByViewpoint: vi.fn((p: PaletteDefinition) => p),
      };
      components = buildComponents({ store, paletteGenerator });
      scopedRoot = document.createElement('div');
      document.body.appendChild(scopedRoot);
      scopedUi = mountUi(new App(components), scopedRoot, { dialogs: scriptedDialogs('Around the element') });
      components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });
    });

    afterEach(() => {
      scopedUi.dispose();
      scopedRoot.remove();
    });

    it("gives the Graph tab the index's colour for a type the palette does not list", () => {
      expect(scopedUi.graphPanel.source?.look(UNLISTED)).toMatchObject({ color: BUBBLE_ELEMENT_STYLE.fillColor });
    });

    it("gives the Graph tab the index's line and decorations for a relationship type the palette does not list", () => {
      expect(scopedUi.graphPanel.source?.look(ARCH_QUALIFIED_RELATIONSHIP)).toMatchObject({
        lineStyle: 'SolidLine',
        sourceDecor: 'NoDecoration',
        targetDecor: 'OpenArrowhead',
      });
    });

    it('keeps palette entries ahead of the index, and a listed relationship a relationship', () => {
      expect(scopedUi.graphPanel.source?.look(LISTED)).toEqual({ label: 'Styled', color: '#FFFFB5' });
      expect(scopedUi.graphPanel.source?.look(LISTED_RELATIONSHIP)).toEqual({
        label: 'Serving',
        lineStyle: 'SolidLine',
        sourceDecor: 'NoDecoration',
        targetDecor: 'OpenArrowhead',
      });
    });

    it("sizes an element the palette does not list at its notation's default on a new view", async () => {
      scopedUi.graphPanel.dispatchEvent(
        new CustomEvent('graph-new-view', {
          detail: { iris: [ELEMENT], centres: new Map([[ELEMENT, { x: 0, y: 0 }]]), label: 'Around' },
        }),
      );

      await vi.waitFor(() => expect(components.viewManager.addElementToView).toHaveBeenCalled());
      // The bubble set's 80 × 80 circle, not the built-in 120 × 55 box.
      expect(components.viewManager.addElementToView).toHaveBeenCalledWith(
        'urn:v',
        ELEMENT,
        expect.objectContaining({ width: BUBBLE_ELEMENT_STYLE.defaultWidth, height: BUBBLE_ELEMENT_STYLE.defaultHeight }),
      );
    });
  });

  describe('shapes graph propagation', () => {
    it('reads the shapes named graph for the property and validation panels', () => {
      const shapeQuad = quad(
        namedNode('urn:shape:1'),
        namedNode('http://www.w3.org/ns/shacl#targetClass'),
        namedNode('urn:t:Actor'),
        namedNode(SHAPES_GRAPH),
      ) as unknown as Quad;

      const store = stubStore([shapeQuad]);
      const scopedApp = new App(buildComponents({ store }));
      const scopedUi = mountUi(scopedApp, root);

      expect(scopedUi.propertyPanel.shapesGraph).toEqual([shapeQuad]);
      expect(scopedUi.validationPanel.shapesGraph).toEqual([shapeQuad]);

      scopedUi.dispose();
    });
  });

  describe('dispose', () => {
    it('removes the shell and stops listening to the bus', () => {
      const { eventBus } = app.components;
      ui.dispose();

      expect(ui.shell.parentElement).toBeNull();
      expect(eventBus.listenerCount('validation-updated')).toBe(0);
      expect(eventBus.listenerCount('metamodel-loaded')).toBe(0);
    });
  });
});

describe('the page title with a model open', () => {
  it("is the model's name and la-gram, marked while it has unsaved changes", () => {
    expect(modelTitle('Payments platform', false)).toBe('Payments platform — la-gram');
    expect(modelTitle('Payments platform', true)).toBe('• Payments platform — la-gram');
  });

  it('names an unnamed model', () => {
    expect(modelTitle('  ', false)).toBe('Untitled model — la-gram');
  });
});
