/**
 * Application entry point — wires all architectural layers together.
 *
 * Platform Abstraction → RDF Engine → Metamodel Manager → Model Manager → UI Layer
 *
 * The EventBus is the central communication mechanism: model mutations
 * emit events that UI panels subscribe to for reactive updates.
 *
 * ## What the App owns beyond the wiring
 *
 * - **The loaded metamodels.** Any number, from the bundle, the network or an
 *   upload; the palette, the relationship rules and validation use their union.
 * - **The model** — through {@link ModelSession} (which model, which view is
 *   open) and {@link ModelIO} (files in and out).
 * - **Validation.** Debounced, against the real shapes graphs of the loaded
 *   metamodels plus the core shapes, over the model data and the class
 *   hierarchy the shapes' targets need.
 */

import type { NamedNode, Quad } from '@rdfjs/types';
import { DataFactory } from 'n3';

// RDF Engine
import type { RdfStore, ShaclValidator, TtlParser, TtlSerializer, ValidationReport } from './rdf-engine/interfaces.js';
import { OxigraphRdfStore } from './rdf-engine/rdf-store.js';
import { ObservableRdfStore } from './rdf-engine/observable-store.js';
import { N3TtlParser } from './rdf-engine/ttl-parser.js';
import { N3TtlSerializer } from './rdf-engine/ttl-serializer.js';
import { RdfShaclValidator } from './rdf-engine/shacl-validator.js';
import { NAMESPACES } from './rdf-engine/namespaces.js';

// Metamodel Manager
import type {
  LoadedMetamodel,
  MetamodelLoader,
  PaletteGenerator,
  ViewpointManager,
} from './metamodel-manager/interfaces.js';
import { N3MetamodelLoader } from './metamodel-manager/metamodel-loader.js';
import { SparqlPaletteGenerator } from './metamodel-manager/palette-generator.js';
import { SparqlViewpointManager } from './metamodel-manager/viewpoint-manager.js';
import { DEFAULT_METAMODEL, type BundledAssetRole } from './metamodel-manager/bundled-assets.js';
import {
  BundledAssetSource,
  RemoteAssetSource,
  UploadedAssetSource,
  createAssetSource,
  detectFormat,
  parseRdf,
  type AssetMode,
  type AssetSource,
} from './metamodel-manager/asset-sources.js';
import { loadCatalogue, type CatalogueEntry } from './metamodel-manager/catalogue.js';

// Model Manager
import type { ElementManager, RelationshipManager, ViewManager } from './model-manager/interfaces.js';
import { OxigraphElementManager } from './model-manager/element-manager.js';
import { OxigraphRelationshipManager } from './model-manager/relationship-manager.js';
import { OxigraphViewManager } from './model-manager/view-manager.js';
import { ModelOperations } from './model-manager/model-operations.js';
import { ModelSession, type AdoptResult } from './model-manager/model-session.js';
import { labelOf, modelQuads, typeClosure, type TypeClosure } from './model-manager/model-queries.js';
import { readPermittedPermissions, type TablePermissions } from './model-manager/direct-permissions.js';
import { splitTableShapes, type TableShapes } from './model-manager/relationship-validity.js';
import { createValidationService, type ValidationService } from './rdf-engine/validation-service.js';
import type { EngineSetup } from './rdf-engine/validation-engine.js';
import { encodeQuads } from './rdf-engine/term-codec.js';
import { isValidPrefix } from './model-manager/model-namespace.js';
import { DEFAULT_MODEL_BASE, ensureNamespace, mintModelNamespace, namespaceProblem, notationSlug } from './rdf-engine/iri.js';

// Platform
import type { PlatformService } from './platform/interfaces.js';
import { createPlatformService } from './platform/platform-factory.js';

// Import/Export
import { TtlFileIO } from './import-export/ttl-file-io.js';
import { ModelIO, formatInfo, type ModelFormat, type SerializationProfile } from './import-export/model-io.js';
import {
  ARCHIMATE3_METAMODEL,
  applyExchangeModel,
  parseArchiMateExchange,
  type ImportReport,
} from './import-export/archimate-importer.js';

// UI
import { EventBus } from './ui/event-bus.js';

const { namedNode } = DataFactory;

/** Legacy shapes graph that `MetamodelLoader.loadShapes` writes to. */
const LEGACY_SHAPES_GRAPH = 'urn:la-gram:shapes';

/** Predicates whose values are human text and so get a language tag. */
const TEXT_PREDICATES = new Set([
  NAMESPACES.skos + 'prefLabel',
  NAMESPACES.skos + 'altLabel',
  NAMESPACES.skos + 'definition',
  NAMESPACES.skos + 'note',
  NAMESPACES.skos + 'scopeNote',
  NAMESPACES.rdfs + 'label',
  NAMESPACES.rdfs + 'comment',
  NAMESPACES.dcterms + 'title',
  NAMESPACES.dcterms + 'description',
]);

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

/** Extra state {@link createApp} hands the App. */
export interface AppExtras {
  /** Graphs loaded by `loadCoreAssets` (core ontologies, core shapes). */
  coreGraphs?: Partial<Record<BundledAssetRole, string[]>>;
  /** User-supplied metamodel documents, consulted before any other source. */
  uploaded?: UploadedAssetSource;
  /** Validation debounce; 0 runs synchronously (tests). */
  validationDelayMs?: number;
  /** Where the model is validated: a worker in the browser, this thread elsewhere (`createValidationService`). */
  validation?: ValidationService;
  /** Metamodels loaded at startup after the primary one. */
  additionalMetamodels?: LoadedMetamodel[];
  /** Base new models' namespaces are minted under; `https://example.org/` by default. */
  base?: string;
  /**
   * Where the published catalogue of metamodels is read from, after the bundled
   * copy (`loadCatalogue`); none offline.
   */
  catalogueSource?: AssetSource;
}

/** A model file ready to hand to the platform's save dialog. */
export interface SavedModel {
  text: string;
  fileName: string;
  mediaType: string;
}

/** What opening a model did. */
export interface OpenedModel extends AdoptResult {
  quadCount: number;
  /** Metamodels the model declared that could not be loaded. */
  missingMetamodels: string[];
}

/**
 * Central application class that instantiates and wires all layers.
 */
export class App {
  readonly components: AppComponents;
  /** The model being edited and its open view. */
  readonly session: ModelSession;
  /** Model files in and out. */
  readonly modelIO: ModelIO;
  /** User-uploaded metamodel documents. */
  readonly uploaded: UploadedAssetSource;
  /**
   * The collaboration room the model is shared in, if any. Replacing the model
   * (New, Open, Import) then replaces it for everyone, so the UI asks first.
   */
  collaborationRoom: string | undefined;
  /** The name this user goes by in the room — the author of the commits they make. */
  collaborationUser: string | undefined;

  private metamodels: LoadedMetamodel[] = [];
  private coreGraphs: Partial<Record<BundledAssetRole, string[]>>;
  private readonly catalogueSource: AssetSource | undefined;
  private shapesCache: Quad[] | null = null;
  /** The shapes split for validation: what SHACL checks, what the relationship tables check. */
  private relationshipCheckCache: { shapes: Quad[]; split: TableShapes; tables: TablePermissions; closure: TypeClosure } | null = null;
  private validationTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly validationDelayMs: number;
  private presentationContext: string | undefined;
  /** Whether the model changed since it was last opened or saved. */
  private dirty = false;

  /**
   * @param loadedMetamodel The metamodel loaded at startup, or `null` when asset
   *   loading failed — a supported state: the app runs with an empty palette
   *   rather than refusing to start.
   */
  constructor(components: AppComponents, loadedMetamodel: LoadedMetamodel | null = null, extras: AppExtras = {}) {
    this.components = components;
    if (loadedMetamodel) this.metamodels.push(loadedMetamodel);
    this.metamodels.push(...(extras.additionalMetamodels ?? []));
    this.coreGraphs = extras.coreGraphs ?? {};
    this.uploaded = extras.uploaded ?? new UploadedAssetSource();
    this.catalogueSource = extras.catalogueSource;
    this.validationDelayMs = extras.validationDelayMs ?? 0;
    this.session = new ModelSession(
      components.store,
      components.elementManager,
      components.viewManager,
      components.eventBus,
      { relationships: components.relationshipManager, base: extras.base ?? DEFAULT_MODEL_BASE },
    );
    this.modelIO = new ModelIO(components.store);
    this.validation = extras.validation ?? createValidationService({ inline: true });
    this.followModelForValidation();
    this.wireEvents();
  }

  /** Where the model is validated (Task 22). */
  readonly validation: ValidationService;
  /** The metamodels changed since the validation service was last set up. */
  private validationSetupDirty = true;
  /** Whether the service follows the store's changes (else it is given the model at each validation). */
  private validationFollowsStore = false;

  /**
   * Give the validation service the model, then every change to it as it
   * happens — so a validation copies nothing out of the store.
   */
  private followModelForValidation(): void {
    const store = this.components.store as Partial<ObservableRdfStore>;
    if (typeof store.subscribe !== 'function') return;
    this.validation.load(encodeQuads(modelQuads(this.components.store)));
    store.subscribe((change) => {
      if (change.added.length + change.removed.length > 0) {
        this.validation.apply(encodeQuads(change.added), encodeQuads(change.removed));
      }
    });
    this.validationFollowsStore = true;
  }

  /** What validation needs of the loaded metamodels, for the service. */
  private validationSetup(shapes: Quad[]): EngineSetup {
    const store = this.components.store;
    const rdfType = namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode;
    const unqualifiedForms: Array<[string, string]> = [];
    for (const q of store.getQuads(null, namedNode(NAMESPACES.arch + 'unqualifiedForm') as unknown as NamedNode, null)) {
      if (q.subject.termType === 'NamedNode' && q.object.termType === 'NamedNode') unqualifiedForms.push([q.subject.value, q.object.value]);
    }
    const tables = readPermittedPermissions(store);
    return {
      shapes: encodeQuads(shapes),
      hierarchy: encodeQuads(store.getQuads(null, namedNode(NAMESPACES.rdfs + 'subClassOf') as unknown as NamedNode, null)),
      outsideTypes: encodeQuads(store.getQuads(null, rdfType, null).filter((q) => q.graph.termType !== 'DefaultGraph')),
      unqualifiedForms,
      tables: tables.size > 0 ? tables.toPlain() : null,
    };
  }

  /** The first loaded metamodel (the "primary" language), or `null`. */
  get loadedMetamodel(): LoadedMetamodel | null {
    return this.metamodels[0] ?? null;
  }

  /**
   * The metamodels to offer (`metamodel-manager/catalogue.ts`), handed to
   * `onEntries` as they arrive: the bundled catalogue first, then the published
   * one — unless offline. A published catalogue that cannot be read leaves the
   * bundled list; one that has no metamodels is not taken.
   */
  async loadCatalogue(onEntries: (entries: CatalogueEntry[]) => void): Promise<void> {
    try {
      onEntries((await loadCatalogue(new BundledAssetSource())) ?? []);
    } catch (err: unknown) {
      console.warn('[app] The bundled catalogue could not be read', err);
      onEntries([]);
    }
    if (!this.catalogueSource) return;
    try {
      const published = await loadCatalogue(this.catalogueSource);
      if (published && published.length > 0) onEntries(published);
    } catch (err: unknown) {
      console.warn('[app] The published catalogue could not be read; the bundled one stays', err);
    }
  }

  /** Every loaded metamodel, primary first. */
  loadedMetamodels(): LoadedMetamodel[] {
    return [...this.metamodels];
  }

  /** Whether the model has unsaved changes. */
  isDirty(): boolean {
    return this.dirty;
  }

  /** The presentation context whose notation set the palette uses. */
  activePresentationContext(): string | undefined {
    return this.presentationContext;
  }

  /**
   * Emit `metamodel-loaded` for each metamodel loaded at startup.
   *
   * Deliberately not done in {@link createApp}: the UI subscribes during
   * `mountUi`, which runs after the app is built, and the EventBus does not
   * replay. The entry point calls this once the UI is mounted.
   *
   * @returns Whether an event was emitted (false when nothing loaded).
   */
  announceLoadedMetamodel(): boolean {
    if (this.metamodels.length === 0) return false;
    for (const loaded of this.metamodels) this.emitMetamodelLoaded(loaded);
    return true;
  }

  // ── Metamodels ─────────────────────────────────────────────────────────

  /**
   * Load a metamodel by IRI — its `arch:Metamodel` subject or manifest — from
   * whichever source can provide it (upload, bundle, network).
   *
   * @param options.replace Unload every other metamodel first (a language
   *   switch); otherwise the new one is added alongside (an extension).
   */
  async loadMetamodel(iri: string, options: { replace?: boolean } = {}): Promise<LoadedMetamodel> {
    const loader = this.components.metamodelLoader;
    const existing = this.metamodels.find((m) => m.metamodelIri === iri || m.manifestGraphIri === iri);
    if (existing && !options.replace) return existing;

    const loaded = await loader.loadMetamodelByIri(iri);
    if (options.replace) {
      for (const other of this.metamodels) {
        if (other.metamodelIri !== loaded.metamodelIri) loader.unloadMetamodel(other, [loaded]);
      }
      this.metamodels = [];
    }
    this.metamodels = [...this.metamodels.filter((m) => m.metamodelIri !== loaded.metamodelIri), loaded];
    this.afterMetamodelsChanged();
    this.emitMetamodelLoaded(loaded);
    return loaded;
  }

  /** Drop a metamodel. The model data is untouched; its concepts may become unclassified. */
  unloadMetamodel(iri: string): void {
    const target = this.metamodels.find((m) => m.metamodelIri === iri);
    if (!target) return;
    const keep = this.metamodels.filter((m) => m !== target);
    this.components.metamodelLoader.unloadMetamodel(target, keep);
    this.metamodels = keep;
    this.afterMetamodelsChanged();
    // Re-announce what remains so the palette regenerates from it.
    if (keep.length > 0) this.emitMetamodelLoaded(keep[0]);
    else this.components.eventBus.emit('metamodel-loaded', { metamodelIri: undefined, empty: true });
  }

  /**
   * Take an uploaded file: a complete metamodel (a manifest, whose other
   * documents are then resolved like any other) or an individual asset (an
   * extension ontology, a shapes file) added to the loaded pool.
   */
  async loadAssetFile(text: string, fileName: string): Promise<{ kind: 'metamodel' | 'asset'; iri: string }> {
    const format = detectFormat(null, fileName);
    const quads = parseRdf(text, format);
    const manifest = quads.find(
      (q) => q.predicate.value === NAMESPACES.rdf + 'type' && q.object.value === NAMESPACES.arch + 'Metamodel',
    );
    const ontology = quads.find(
      (q) => q.predicate.value === NAMESPACES.rdf + 'type' && q.object.value === NAMESPACES.owl + 'Ontology',
    );
    if (manifest) {
      const documentIri = ontology?.subject.value ?? manifest.subject.value.replace(/#.*$/, '#');
      this.uploaded.add(documentIri, text, format, fileName);
      await this.loadMetamodel(manifest.subject.value);
      return { kind: 'metamodel', iri: manifest.subject.value };
    }
    const status = await this.components.metamodelLoader.loadDocument(text, { format });
    this.uploaded.add(status.documentIri, text, format, fileName);
    // Attach the document to the primary metamodel's graphs so validation and
    // unloading see it.
    const primary = this.metamodels[0];
    if (primary && status.role) {
      const list = primary.graphsByRole[status.role] ?? [];
      if (!list.includes(status.documentIri)) primary.graphsByRole[status.role] = [...list, status.documentIri];
    }
    this.afterMetamodelsChanged();
    if (primary) this.emitMetamodelLoaded(primary);
    return { kind: 'asset', iri: status.documentIri };
  }

  /** Switch presentation context: the palette and canvas take its notation set. */
  setPresentationContext(contextIri: string | undefined): void {
    this.presentationContext = contextIri;
    this.components.eventBus.emit('presentation-context-changed', { contextIri });
  }

  // ── Model ──────────────────────────────────────────────────────────────

  /**
   * Start a fresh model conforming to the loaded metamodels.
   *
   * @param options.namespace The model's namespace; a fresh one under the
   *   configured base ({@link suggestNamespace}) when omitted.
   */
  newModel(label?: string, options: { namespace?: string; prefix?: string } = {}): { modelIri: string; viewIri: string } {
    const result = this.session.newModel({
      ...(label ? { label } : {}),
      ...(options.namespace ? { namespace: options.namespace } : {}),
      ...(options.prefix ? { prefix: options.prefix } : {}),
      metamodelIris: this.metamodels.map((m) => m.metamodelIri),
    });
    this.scheduleValidation();
    return result;
  }

  /** A fresh namespace for a new model: `{base}{notation}/{uuid}/`. */
  suggestNamespace(): string {
    return mintModelNamespace(this.session.base, notationSlug(this.metamodels[0]?.metamodelIri));
  }

  /**
   * What is wrong with a namespace and prefix for the model, or `null`.
   * The prefix must be a Turtle prefix name and not already stand for another
   * namespace in the output (`am4:`, `skos:`, …).
   */
  namespaceProblem(namespace: string, prefix: string): string | null {
    const problem = namespaceProblem(namespace);
    if (problem) return problem;
    if (!isValidPrefix(prefix.trim())) return 'The prefix must start with a letter and use only letters, digits, - and _.';
    const ns = ensureNamespace(namespace);
    const bound = this.modelIO.collectPrefixes()[prefix.trim()];
    if (bound && bound !== ns) return `The prefix "${prefix.trim()}" already stands for ${bound}.`;
    return null;
  }

  /**
   * Change the model's namespace (and prefix). With `rename` (the default) the
   * model's IRIs move into the new namespace; see `ModelSession.setNamespace`.
   *
   * @returns How many IRIs changed.
   */
  setModelNamespace(namespace: string, options: { prefix?: string; rename?: boolean } = {}): number {
    const problem = this.namespaceProblem(namespace, options.prefix ?? this.session.namespace()?.prefix ?? 'm');
    if (problem) throw new Error(problem);
    const changed = this.session.setNamespace(namespace, options);
    this.scheduleValidation();
    return changed.size;
  }

  /**
   * Open a model file (Turtle, TriG, JSON-LD, N-Quads, N-Triples, RDF/XML).
   *
   * The current model is replaced. Metamodels the file declares conformance to
   * are loaded first when they are not already, so its concepts are classified
   * and drawn with the right notation.
   */
  async openModel(text: string, fileName: string): Promise<OpenedModel> {
    const { quadCount } = this.modelIO.load(text, fileName);
    const declared = new Set(
      modelQuads(this.components.store)
        .filter((q) => q.predicate.value === NAMESPACES.arch + 'modelConformsToMetamodel' || q.predicate.value === NAMESPACES.arch + 'conformsToMetamodel')
        .map((q) => q.object.value),
    );
    const missingMetamodels: string[] = [];
    for (const iri of declared) {
      if (this.metamodels.some((m) => m.metamodelIri === iri)) continue;
      try {
        await this.loadMetamodel(iri);
      } catch {
        missingMetamodels.push(iri);
      }
    }
    const adopted = this.session.adopt({
      fallbackLabel: fileName.replace(/\.[^.]+$/, ''),
      metamodelIris: this.metamodels.map((m) => m.metamodelIri),
    });
    this.scheduleValidation();
    return { ...adopted, quadCount, missingMetamodels };
  }

  /** Serialize the model for saving. */
  saveModel(format: ModelFormat = 'turtle', profile: SerializationProfile = 'full'): SavedModel {
    const info = formatInfo(format);
    const text = this.modelIO.serialize(this.session.modelIri, { format, profile });
    const base = (this.session.modelLabel() || 'model').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
    return {
      text,
      fileName: `${base}${profile === 'no-geometry' ? '.no-geometry' : ''}.${info.extension}`,
      mediaType: info.mediaType,
    };
  }

  /**
   * Import an ArchiMate exchange file as a new model. Loads the ArchiMate 3.2
   * metamodel (bundled) first, because the exchange format is 3.x.
   */
  async importArchiMate(xml: string, fileName = 'model.xml'): Promise<ImportReport & { modelIri: string; viewIri: string }> {
    const parsed = parseArchiMateExchange(xml);
    await this.loadMetamodel(ARCHIMATE3_METAMODEL);
    const store = this.components.store;
    const { modelIri } = this.session.newModel({
      label: parsed.name ?? fileName.replace(/\.[^.]+$/, ''),
      metamodelIris: [ARCHIMATE3_METAMODEL],
    });
    // The fresh model's empty default view is not wanted: the file brings views.
    const emptyDefault = this.session.activeViewIri;
    const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode;
    const OWL_CLASS = namedNode(NAMESPACES.owl + 'Class') as unknown as NamedNode;
    const report = applyExchangeModel(parsed, {
      elements: this.components.elementManager,
      relationships: this.components.relationshipManager,
      views: this.components.viewManager,
      modelIri,
      ...(this.session.namespace() ? { modelNamespace: this.session.namespace()!.namespace } : {}),
      knownClass: (iri) => store.getQuads(namedNode(iri) as unknown as NamedNode, RDF_TYPE, OWL_CLASS).length > 0,
      viewpointFor: (name) => this.findViewpointByName(name),
    });
    if (report.viewCount > 0 && emptyDefault) this.components.viewManager.deleteView(emptyDefault);
    const adopted = this.session.adopt({ metamodelIris: [ARCHIMATE3_METAMODEL] });
    this.scheduleValidation();
    return { ...report, modelIri: adopted.modelIri, viewIri: adopted.viewIri };
  }

  // ── Validation ─────────────────────────────────────────────────────────

  /** Validate soon (debounced), or now when the delay is 0. */
  scheduleValidation(): void {
    if (this.validationDelayMs <= 0) {
      this.runValidation();
      return;
    }
    if (this.validationTimer) clearTimeout(this.validationTimer);
    this.validationTimer = setTimeout(() => {
      this.validationTimer = null;
      this.runValidation();
    }, this.validationDelayMs);
  }

  /**
   * The shapes to validate against: every `shapes` graph of every loaded
   * metamodel, the core shapes, and anything loaded through the legacy
   * `loadShapes`. Cached until the metamodels change, so the validator can
   * keep its compiled engine.
   */
  shapesGraph(): Quad[] {
    if (this.shapesCache) return this.shapesCache;
    const store = this.components.store;
    const graphs = new Set<string>([LEGACY_SHAPES_GRAPH, ...(this.coreGraphs.coreShapes ?? [])]);
    for (const m of this.metamodels) for (const g of m.graphsByRole.shapes ?? []) graphs.add(g);
    const quads: Quad[] = [];
    for (const g of graphs) quads.push(...store.getQuads(null, null, null, namedNode(g) as unknown as NamedNode));
    this.shapesCache = quads;
    return quads;
  }

  /**
   * The data to validate: the model, plus the `rdfs:subClassOf` axioms — a
   * shape targeting `am4:ActiveStructureElement` reaches an
   * `am4:ApplicationComponent` only through them, and SHACL reads class
   * membership from the data graph.
   */
  validationDataGraph(): Quad[] {
    const store = this.components.store;
    const data = modelQuads(store);
    const subClassOf = store.getQuads(null, namedNode(NAMESPACES.rdfs + 'subClassOf') as unknown as NamedNode, null);
    // `sh:class` checks on values the model *references* — the viewpoint a
    // view conforms to, the metamodel a model conforms to — need those
    // resources' types, which live in the metamodel graphs.
    const rdfType = namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode;
    const referenced = new Set<string>();
    for (const q of data) if (q.object.termType === 'NamedNode' && q.predicate.value !== rdfType.value) referenced.add(q.object.value);
    const types: Quad[] = [];
    for (const iri of referenced) {
      for (const q of store.getQuads(namedNode(iri) as unknown as NamedNode, rdfType)) {
        if (q.graph.termType !== 'DefaultGraph') types.push(q);
      }
    }
    return [...data, ...subClassOf, ...types];
  }

  /**
   * The shapes graph split for validation (`relationship-validity.ts`): the
   * relationship shapes the loaded relationship tables cover are checked by
   * lookup in the tables, the rest by SHACL. Cached with the shapes.
   */
  relationshipCheck(): { shapes: Quad[]; split: TableShapes; tables: TablePermissions; closure: TypeClosure } {
    const shapes = this.shapesGraph();
    if (this.relationshipCheckCache?.shapes === shapes) return this.relationshipCheckCache;
    const store = this.components.store;
    const closure = typeClosure(store);
    const tables = readPermittedPermissions(store);
    const formOf = new Map<string, string>();
    for (const q of store.getQuads(null, namedNode(NAMESPACES.arch + 'unqualifiedForm') as unknown as NamedNode, null)) {
      if (q.subject.termType === 'NamedNode' && q.object.termType === 'NamedNode') formOf.set(q.subject.value, q.object.value);
    }
    const relationship = NAMESPACES.arch + 'QualifiedRelationship';
    const split = splitTableShapes(shapes, tables, formOf, (c) => closure(c).includes(relationship));
    this.relationshipCheckCache = { shapes, split, tables, closure };
    return this.relationshipCheckCache;
  }

  /**
   * Validate the model now and publish the report: at once where validation
   * runs on this thread (Node, the tests), when the worker answers in the
   * browser — a report a later request superseded is not published.
   */
  runValidation(): void | Promise<void> {
    const shapes = this.shapesGraph();
    if (shapes.length === 0) return;
    try {
      if (this.validationSetupDirty) {
        this.validation.setup(this.validationSetup(shapes));
        this.validationSetupDirty = false;
      }
      if (!this.validationFollowsStore) this.validation.load(encodeQuads(modelQuads(this.components.store)));
      const outcome = this.validation.validate();
      if (outcome instanceof Promise) {
        return outcome.then(
          (report) => {
            if (report) this.publishValidation(report);
          },
          (err: unknown) => console.warn('[app] Validation failed', err),
        );
      }
      this.publishValidation(outcome);
    } catch (err: unknown) {
      console.warn('[app] Validation failed', err);
    }
  }

  private publishValidation(report: ValidationReport): void {
    this.components.eventBus.emit('validation-updated', {
      conforms: report.conforms,
      resultCount: report.results.length,
      results: report.results,
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────

  /**
   * Wire event handlers on the EventBus so that model mutations
   * propagate to all interested UI panels and trigger validation.
   */
  private wireEvents(): void {
    const { eventBus, elementManager, paletteGenerator } = this.components;

    for (const type of [
      'element-created',
      'element-deleted',
      'element-updated',
      'relationship-created',
      'relationship-deleted',
      'model-changed',
      'model-loaded',
    ] as const) {
      eventBus.on(type, () => this.scheduleValidation());
    }

    // ── Dirty tracking: edits make the model dirty, open/save make it clean ──
    for (const type of [
      'element-created',
      'element-deleted',
      'element-updated',
      'relationship-created',
      'relationship-deleted',
      'model-changed',
      'views-changed',
    ] as const) {
      eventBus.on(type, () => {
        this.dirty = true;
      });
    }
    eventBus.on('model-loaded', () => {
      this.dirty = false;
    });
    eventBus.on('model-saved', () => {
      this.dirty = false;
    });

    // ── Property edits → RDF store. Text gets a language tag: the Linked.Archi
    //    shapes reject a plain-string skos:prefLabel. ──
    eventBus.on('property-edited', (event) => {
      const detail = event.detail as
        | { elementIri?: string; property?: string; value?: string; language?: string }
        | undefined;
      if (detail?.elementIri && detail.property && detail.value !== undefined) {
        const value = TEXT_PREDICATES.has(detail.property)
          ? DataFactory.literal(detail.value, detail.language ?? 'en')
          : DataFactory.literal(detail.value);
        elementManager.updateProperty(detail.elementIri, detail.property, value as never);
        eventBus.emit('model-changed', { origin: 'properties', iri: detail.elementIri });
      }
    });

    // ── Palette drag (legacy event path) → element in the model and the open view ──
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
        const elem = elementManager.createElement(detail.typeIri, detail.modelIri);
        // Placed into the open view, when there is one: an element is a model
        // concept, its position belongs to a view.
        const viewIri = this.session.activeViewIri;
        if (viewIri) this.components.viewManager.addElementToView(viewIri, elem.value, position);
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

    // ── Metamodel loaded → regenerate palette ──
    eventBus.on('metamodel-loaded', (event) => {
      const detail = event.detail as { metamodelIri?: string } | undefined;
      if (detail?.metamodelIri) {
        // Palette generator will re-query the store for the new metamodel
        paletteGenerator.generatePalette(detail.metamodelIri);
      }
    });
  }

  private afterMetamodelsChanged(): void {
    this.shapesCache = null;
    this.validationSetupDirty = true;
    this.session.setMetamodels(this.metamodels.map((m) => m.metamodelIri));
    this.components.eventBus.emit('metamodels-changed', {
      metamodelIris: this.metamodels.map((m) => m.metamodelIri),
    });
    this.scheduleValidation();
  }

  private emitMetamodelLoaded(loaded: LoadedMetamodel): void {
    const { metamodelIri, info, notationSetIri, manifestGraphIri } = loaded;
    this.components.eventBus.emit('metamodel-loaded', {
      metamodelIri,
      name: info.name,
      version: info.version,
      notationSetIri,
      manifestGraphIri,
    });
  }

  /** A viewpoint IRI by its label (`Application Cooperation`), across loaded viewpoints. */
  private findViewpointByName(name: string): string | undefined {
    const wanted = name.replace(/[\s_-]+/g, '').toLowerCase();
    for (const vp of this.components.viewpointManager.getViewpoints()) {
      if (vp.label.replace(/[\s_-]+/g, '').toLowerCase() === wanted) return vp.iri;
      const local = vp.iri.slice(vp.iri.lastIndexOf('#') + 1).toLowerCase();
      if (local === wanted) return vp.iri;
    }
    return undefined;
  }
}

/** Options for {@link createApp}. */
export interface CreateAppOptions {
  /**
   * Where metamodel documents come from. Default: `bundled-first` in a browser
   * (fast and offline for the bundled languages, network for the rest),
   * `offline` elsewhere (tests and tools never touch the network unasked).
   */
  assetMode?: AssetMode;
  /**
   * Where the published catalogue of metamodels is read from: meta.linked.archi
   * unless `assetMode` is `offline`, when only the bundled copy is read.
   */
  catalogueSource?: AssetSource;
  /** Metamodels to load at startup; ArchiMate 4.0 when omitted. */
  metamodels?: string[];
  /** Validation debounce in ms; 0 validates synchronously. */
  validationDelayMs?: number;
  /**
   * Where the model is validated: in a worker where the environment has workers
   * (the browser, the desktop app) unless `inline` is asked for; on this thread
   * otherwise (Node, the tests).
   */
  validation?: 'auto' | 'inline';
  /** Start a new, empty model (default true). */
  newModel?: boolean;
  /**
   * Base new models' namespaces are minted under (`{base}{notation}/{uuid}/`);
   * `https://example.org/` by default. Each model records its own namespace,
   * which can be changed afterwards.
   */
  base?: string;
}

/**
 * Factory function that creates and wires the full application.
 *
 * Instantiates all layers in dependency order:
 * Platform → RDF Engine → Metamodel Manager → Model Manager → Import/Export
 */
export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  // 1. Platform
  const platform = await createPlatformService();

  // 2. RDF Engine
  //    OxigraphRdfStore.create() awaits the WASM instantiation that the
  //    browser build of Oxigraph requires; it is a no-op under Node. The
  //    observable wrapper is what undo/redo and collaboration listen to.
  const parser = new N3TtlParser();
  const serializer = new N3TtlSerializer();
  const store = new ObservableRdfStore(await OxigraphRdfStore.create());
  const validator = new RdfShaclValidator();

  // 3. Metamodel Manager
  const assetMode: AssetMode =
    options.assetMode ?? (typeof window !== 'undefined' && typeof document !== 'undefined' ? 'bundled-first' : 'offline');
  const uploaded = new UploadedAssetSource();
  const metamodelLoader = new N3MetamodelLoader(
    parser,
    store,
    createAssetSource(assetMode, uploaded, { allowedPrefixes: [] }),
  );
  const paletteGenerator = new SparqlPaletteGenerator(store);
  const viewpointManager = new SparqlViewpointManager(store);

  // 3a. Core documents, then the startup metamodels. A failure here (missing
  //     assets, no network) must not stop the app from starting: without a
  //     metamodel the palette is simply empty, which is recoverable, whereas a
  //     rejected createApp() leaves a blank screen.
  let coreGraphs: Partial<Record<BundledAssetRole, string[]>> = {};
  try {
    coreGraphs = await metamodelLoader.loadCoreAssets();
  } catch (err: unknown) {
    console.warn('[app] Core assets could not be loaded', err);
  }
  const wanted = options.metamodels && options.metamodels.length > 0 ? options.metamodels : [DEFAULT_METAMODEL.metamodelIri];
  const loaded: LoadedMetamodel[] = [];
  for (const iri of wanted) {
    const result = await loadMetamodelReporting(metamodelLoader, iri);
    if (result) loaded.push(result);
  }

  // 4. Model Manager
  const elementManager = new OxigraphElementManager(store);
  const relationshipManager = new OxigraphRelationshipManager(store);
  const viewManager = new OxigraphViewManager(store);
  const modelOperations = new ModelOperations(parser, serializer, store);

  // 5. Import/Export
  const ttlFileIO = new TtlFileIO(parser, serializer, store, platform);

  // 6. Event Bus
  const eventBus = new EventBus();

  const app = new App(
    {
      platform, parser, serializer, store, validator,
      metamodelLoader, paletteGenerator, viewpointManager,
      elementManager, relationshipManager, viewManager,
      modelOperations, ttlFileIO, eventBus,
    },
    loaded[0] ?? null,
    {
      coreGraphs,
      uploaded,
      validationDelayMs: options.validationDelayMs ?? 0,
      validation: createValidationService({
        inline: options.validation === 'inline',
        onTiming: (t) => {
          if (t.shacl + t.tables > 1000) console.info(`[app] Validated ${t.nodes === 'all' ? 'the whole model' : `${t.nodes} nodes`} in the worker: SHACL ${t.shacl} ms, tables ${t.tables} ms`);
        },
      }),
      additionalMetamodels: loaded.slice(1),
      // The published catalogue is read from meta.linked.archi whatever the mode
      // but offline: bundled-first would always answer from the bundle, and a
      // newly published metamodel would wait for a new la-gram.
      ...(options.catalogueSource
        ? { catalogueSource: options.catalogueSource }
        : assetMode === 'offline'
          ? {}
          : { catalogueSource: new RemoteAssetSource() }),
      ...(options.base && !namespaceProblem(options.base) ? { base: ensureNamespace(options.base) } : {}),
    },
  );
  if (options.newModel !== false) app.newModel();
  return app;
}

/**
 * Load a metamodel, reporting rather than throwing on failure.
 *
 * Partial loads are normal and expected: a manifest references derivation
 * rules and document templates the editor has no use for. Those are logged in
 * one line so a missing layer is visible instead of silent.
 */
async function loadMetamodelReporting(loader: MetamodelLoader, iri: string): Promise<LoadedMetamodel | null> {
  try {
    const loaded = await loader.loadMetamodelByIri(iri);

    const graphCount = loaded.assets.filter((asset) => asset.outcome === 'loaded').length;
    console.info(
      `[app] Loaded metamodel ${loaded.info.name || loaded.metamodelIri} ` +
        `(${graphCount} graphs, notation set ${loaded.notationSetIri ?? 'none'}).`,
    );

    const notLoaded = loaded.assets.filter(
      (asset) => asset.outcome === 'not-bundled' || asset.outcome === 'unavailable' || asset.outcome === 'skipped',
    );
    if (notLoaded.length > 0) {
      console.info(
        `[app] ${notLoaded.length} referenced graphs were not loaded: ` +
          notLoaded.map((asset) => `${asset.documentIri} (${asset.outcome})`).join(', '),
      );
    }
    for (const asset of loaded.assets.filter((a) => a.outcome === 'error')) {
      console.warn(
        `[app] Metamodel asset failed to load: <${asset.documentIri}> via ${asset.via} — ${asset.message}`,
      );
    }

    return loaded;
  } catch (err: unknown) {
    console.error(
      `[app] Failed to load the metamodel <${iri}> — starting without it.`,
      err,
    );
    return null;
  }
}

/** Label of a concept, for UI callers that hold only the App. */
export function conceptLabel(app: App, iri: string): string {
  return labelOf(app.components.store, iri);
}
