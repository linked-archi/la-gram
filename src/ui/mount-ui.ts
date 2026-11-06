/**
 * UI mounting — instantiates every panel/view and wires it to the App.
 *
 * `app-shell` only renders the layout grid plus named slots — `toolbar`,
 * `explorer` (the model tree, left), `canvas`, `properties` / `validation` /
 * `sparql` (the bottom panel's tabs), `palette` (right) and `rdf` (far right).
 * Nothing fills those slots unless something creates the panel elements, wires them to
 * the App's components and appends them as light-DOM children of the shell —
 * that is this module's job, together with executing what the toolbar, the
 * model tree and the canvas ask for.
 *
 * Importing the panel modules here is also what registers their custom
 * elements: the `@customElement(...)` decorators only run as an import side
 * effect.
 *
 * ## Who changes the model
 *
 * Panels never write the store: they emit events. Canvas gestures write through
 * the canvas's own undoable commands; everything else (the property panel, the
 * model tree, the toolbar) is executed here or by the App. After a change that
 * did not come from the canvas, the canvas reconciles itself with the store
 * (`syncFromStore`), so there is one source of truth and no second copy to keep
 * in step.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';

import type { App } from '../app.js';
import type { PaletteDefinition, ViewpointInfo } from '../metamodel-manager/interfaces.js';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import { ObservableRdfStore } from '../rdf-engine/observable-store.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { DEFAULT_MODEL_BASE, ensureNamespace, modelIriIn } from '../rdf-engine/iri.js';
import type { ViewKind } from '../model-manager/interfaces.js';
import { VersionHistory } from '../model-manager/version-history.js';
import type { HistoryCommitDetail, HistoryGitSource, HistoryPanel, HistoryRestoreDetail } from './panels/history-panel.js';
import { ModelContentsIndex, hasLabel, labelOf, modelNameOf, modelQuads, statementsOf, typeClosure, type TypeClosure } from '../model-manager/model-queries.js';
import { relationshipNamesShown, rememberRelationshipNamesShown } from './relationship-names.js';
import {
  KIND_FOLDER_NAMES,
  applyFolderChange,
  combine,
  deleteFolder,
  folderLayout,
  folderPath,
  folderWithin,
  groupFolder,
  moveToFolder,
  newFolder,
  renameFolder,
  type FolderChange,
  type FolderKind,
} from '../model-manager/folders.js';
import { confirmationQuads, derivationDetails, derivationStatus, ruleOf } from '../model-manager/derivations.js';
import { localName as localNameOf } from '../model-manager/vocabulary.js';
import {
  listQuestions,
  offeredQuestions,
  runModelChecks,
  type ModelQuestion,
  type QuestionBindings,
} from '../model-manager/questions.js';
import { PropertyCatalog, curieOf } from '../model-manager/property-catalog.js';
import { MODEL_FORMATS, formatInfo, partitionModel, type ModelFormat, type SerializationProfile } from '../import-export/model-io.js';
import { conceptStatements, viewMembers, viewStatements } from '../model-manager/rdf-scope.js';
import { ViewHistory, type ViewPlace, type ViewVisit } from './view-history.js';
import { exportPng, exportSvg } from '../import-export/svg-png-exporter.js';
import type { ModelEventHandler } from './event-bus.js';
import { domDialogs, type Dialogs, type FormField, type FormValues } from './dialogs.js';
import { PersonalSettings } from '../settings.js';
import { CATALOGUE_KIND_LABELS } from '../metamodel-manager/catalogue.js';

// Side-effect imports: register the custom elements.
import './app-shell.js';
import './panels/app-toolbar.js';
import './panels/palette-panel.js';
import './panels/canvas-toolbar.js';
import './panels/property-panel.js';
import { fieldName } from './panels/property-panel.js';
import { hasFolders } from './panels/model-explorer.js';
import './panels/validation-panel.js';
import './panels/sparql-editor.js';
import './views/catalog-view.js';
import './views/matrix-view.js';
import './panels/rdf-panel.js';
import './panels/graph-panel.js';
import './panels/history-panel.js';
import './panels/type-guide-panel.js';

import type { AppShell, BottomTab } from './app-shell.js';
import type { AppToolbar, FileMenuItem, LabelledIri, ToolbarCommandDetail } from './panels/app-toolbar.js';
import type { ModuleSwitch } from '../modules.js';
import type {
  PalettePanel,
  PaletteDragDetail,
  PaletteHoverDetail,
  PaletteAxisChangeDetail,
} from './panels/palette-panel.js';
import type { CanvasToolbar, ToolbarToolDetail } from './panels/canvas-toolbar.js';
import type {
  PropertyPanel,
  PropertyEditDetail,
  PropertyChangeDetail,
  PropertyAnalysis,
} from './panels/property-panel.js';
import type {
  ModelExplorer,
  ExplorerSelectDetail,
  ExplorerActionDetail,
  ExplorerDragDetail,
  ExplorerMoveDetail,
} from './panels/model-explorer.js';
import type { ValidationPanel, ValidationNavigateDetail, FocusDescription } from './panels/validation-panel.js';
import type { SparqlEditor } from './panels/sparql-editor.js';
import type { TypeGuidePanel } from './panels/type-guide-panel.js';
import type { CatalogView, CatalogSelectDetail } from './views/catalog-view.js';
import type { MatrixView } from './views/matrix-view.js';
import type { RdfPanel, RdfDownloadDetail, RdfPanelContent, RdfPanelRequest, RdfSelectDetail } from './panels/rdf-panel.js';
import type { GraphPanel, GraphDownloadDetail, GraphNewViewDetail, GraphOpenSparqlDetail, GraphTypeLook, GraphTypeOption } from './panels/graph-panel.js';
import type { ResultsViewRequestDetail, SparqlSelectDetail } from './panels/sparql-editor.js';
import { layoutPositions } from './panels/graph-view.js';
import { mostSpecificType, relationshipGraph } from '../model-manager/relationship-graph.js';
import { planView, placeNodes, type ConceptKinds } from '../model-manager/view-from-results.js';
import { readTypeGuide, type TypeGuide } from '../metamodel-manager/type-guide.js';
import { assetUrl } from '../metamodel-manager/bundled-assets.js';
import { iconHref, NOTATION_DEFAULTS, withRelationshipIcons } from './canvas/notation-shapes.js';
import { NotationStyleRegistry } from './canvas/notation-styles.js';

// The diagram canvas is a plain class, not a custom element: it takes a host
// DOM node in its constructor and manages that subtree itself.
import {
  DiagramCanvas,
  type CanvasContextAction,
  type ConceptDescription,
  type DeleteFromModelRequest,
  type RetypeElementRequest,
} from './canvas/diagram-canvas.js';
import { buildClassClosure, type ClassClosure } from './canvas/relationship-resolution.js';

const { namedNode } = DataFactory;

/** Model IRI used for elements dropped onto the canvas before a model is loaded. */
export const DEFAULT_MODEL_IRI = modelIriIn(DEFAULT_MODEL_BASE);

/** How many folders last moved into *Move to folder…* offers first. */
const RECENT_FOLDERS = 5;

/** What a group's concepts are called, several of them. */
const KIND_PLURALS: Record<FolderKind, string> = { view: 'views', element: 'elements', relationship: 'relationships' };

/** CSS marker on shapes with SHACL violations. */
export const VIOLATION_MARKER = 'la-violation';

/** Empty palette used until a metamodel is loaded. */
function emptyPalette(): PaletteDefinition {
  return { elementGroups: [], relationshipTypes: [] };
}

/** Which element occupies the centre (canvas) slot. */
export type CanvasViewKind = 'diagram' | 'catalog' | 'matrix';

/** Handles to everything mounted into the shell. */
export interface MountedUi {
  shell: AppShell;
  /** The bar across the top: file, metamodels, views, collaboration. */
  appToolbar: AppToolbar;
  palettePanel: PalettePanel;
  /** The global-tool strip above the diagram. */
  canvasToolbar: CanvasToolbar;
  modelExplorer: ModelExplorer;
  propertyPanel: PropertyPanel;
  validationPanel: ValidationPanel;
  sparqlEditor: SparqlEditor;
  catalogView: CatalogView;
  matrixView: MatrixView;
  /** Show or hide the model tree, on the left (shown by default). */
  setExplorerOpen(open: boolean): void;
  /** Whether the model tree is shown. */
  isExplorerOpen(): boolean;
  /** Show or hide the palette, on the right (shown by default). */
  setPaletteOpen(open: boolean): void;
  /** Whether the palette is shown. */
  isPaletteOpen(): boolean;
  /** Open a tab of the bottom panel: properties, validation or the SPARQL editor. */
  showBottomTab(tab: BottomTab): void;
  /** The model as RDF (Turtle, …), far right; hidden until opened. */
  rdfPanel: RdfPanel;
  /** The relationships around the selected element, as a graph (the Graph tab). */
  graphPanel: GraphPanel;
  /** The model's commits (the History tab). */
  historyPanel: HistoryPanel;
  /** What the metamodel says about the selected type, under the model tree. */
  typeGuidePanel: TypeGuidePanel;
  /** Show or hide the RDF panel. */
  setRdfPanelOpen(open: boolean): void;
  /** Whether the RDF panel is shown. */
  isRdfPanelOpen(): boolean;
  /** Host element handed to diagram-js / the DiagramCanvas renderer. */
  canvasHost: HTMLElement;
  diagramCanvas: DiagramCanvas;
  /** Switch the centre area between the diagram, catalog and matrix views. */
  setActiveCanvasView(kind: CanvasViewKind): void;
  /** Currently visible centre view. */
  activeCanvasView(): CanvasViewKind;
  /**
   * Regroup the palette along another classification axis (e.g. "Element by
   * Aspect" instead of "Element by Domain"). Ignored when the metamodel does
   * not publish the axis.
   */
  setPaletteAxis(axisIri: string | undefined): void;
  /** Select a concept everywhere (tree, properties, canvas). */
  selectConcept(iri: string | undefined): void;
  /** Execute a toolbar command, as if picked. */
  runCommand(detail: ToolbarCommandDetail): Promise<void>;
  /** The dialogs the UI asks with (scripted in tests): for modules. */
  dialogs: Dialogs;
  /** Say something: a toast, and `notify` on the event bus. */
  report(message: string, level?: 'info' | 'warning' | 'error'): void;
  /**
   * Ask before the model is replaced, as File › Open does: when it has unsaved
   * changes, or is shared in a room. `false` when the user says no.
   */
  confirmReplace(what: string): Promise<boolean>;
  /** Open a model file's text as File › Open does — the model replaced — and say what it did. */
  openModelText(text: string, fileName: string): Promise<void>;
  /**
   * A module's entries in the File menu. `items` is asked each time the menu
   * opens, so an entry can name the model's state; `run` runs one, its failure
   * reported. Returns what takes the entries away.
   */
  addFileMenu(moduleId: string, items: () => ModuleMenuItem[], run: (itemId: string) => Promise<void>): () => void;
  /** The modules File › Settings… switches, and what switches one. */
  setModuleSwitches(list: () => ModuleSwitch[], toggle: (id: string, on: boolean) => Promise<void>): void;
  /** A part's own section of File › Settings…. Returns what takes it away. */
  addSettingsSection(section: SettingsSection): () => void;
  /**
   * A module's tab in the bottom panel, after la-gram's own: `element` is shown
   * in it. Returns what shows it, sets its badge, and takes it away.
   */
  addBottomTab(tab: { id: string; label: string; element: HTMLElement }): BottomTabHandle;
  /** A concept as the model tree and the Validation tab name it: its name, its type in words. */
  describeConcept(iri: string): FocusDescription;
  /** A property as the Properties tab names it (`Name`, `Documentation`). */
  propertyName(predicate: string): string;
  /** A class as the palette and the model tree name it (`Application Component`). */
  typeName(iri: string): string;
  /**
   * The bound file's Git history for the History tab (Task 21): `source` gives
   * it for a model, `undefined` for one not bound. Returns what takes it away.
   */
  setGitHistory(source: (modelIri: string) => HistoryGitSource | undefined): () => void;
  /** Refresh every panel from the store. */
  refresh(): void;
  /** Detach listeners and remove the shell from the document. */
  dispose(): void;
}

/** A module's tab of the bottom panel ({@link MountedUi.addBottomTab}). */
export interface BottomTabHandle {
  /** Open it, unfolding the panel. */
  show(): void;
  /** A small count on it; none for `undefined`. */
  setBadge(text: string | undefined): void;
  /** Take it away (another tab opens if it was open). */
  remove(): void;
}

/** A part's section of File › Settings… ({@link MountedUi.addSettingsSection}, Req 19.5). */
export interface SettingsSection {
  id: string;
  title: string;
  /** A line under the title. */
  detail?: string;
  /**
   * The section's fields with their current values, asked each time the dialog
   * opens; a field the deployment sets is `disabled` (Req 19.6).
   */
  fields(): FormField[] | Promise<FormField[]>;
  /** The problem with the section's values, or `null`. */
  validate?(values: FormValues): string | null;
  /** Keep the section's values (its own fields, by their own names). */
  apply(values: FormValues): Promise<void> | void;
}

/** An entry a module puts in the File menu ({@link MountedUi.addFileMenu}). */
export interface ModuleMenuItem {
  id: string;
  label: string;
  hint?: string;
  /** Beside Open or beside Save. */
  section: 'open' | 'save';
}

/** Options for {@link mountUi}. */
export interface MountOptions {
  /** Dialog implementation; the DOM one by default, scripted in tests. */
  dialogs?: Dialogs;
  /** Pick a file to open; an `<input type=file>` by default. */
  pickFile?: (accept: string) => Promise<{ name: string; text: string } | null>;
  /** Hand a file to the user; a download by default. */
  saveFile?: (content: string | Blob, fileName: string, mediaType: string) => Promise<void> | void;
  /** Start with the RDF panel open (`?rdf=1`). Hidden by default. */
  rdfOpen?: boolean;
}

/** Let the user pick a file with a hidden input. */
function defaultPickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { name: file.name, text: await file.text() } : null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

/** Download a file. */
function defaultSaveFile(content: string | Blob, fileName: string, mediaType: string): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mediaType};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Most specific type of a resource: the one whose closure is largest, never the core's generic relationship types. */
function mainType(types: string[], closure: TypeClosure): string | undefined {
  const generic = new Set([NAMESPACES.arch + 'QualifiedRelationship', NAMESPACES.arch + 'ModelConcept']);
  const specific = types.filter((t) => !generic.has(t));
  return [...(specific.length > 0 ? specific : types)].sort((a, b) => closure(b).length - closure(a).length)[0];
}

/**
 * Create every panel, wire it to the App's components, and mount it into an
 * `<app-shell>` under `root`.
 */
export function mountUi(app: App, root: HTMLElement, options: MountOptions = {}): MountedUi {
  const {
    eventBus,
    store,
    validator,
    elementManager,
    relationshipManager,
    viewManager,
    viewpointManager,
    paletteGenerator,
  } = app.components;
  const dialogs = options.dialogs ?? domDialogs;
  const pickFile = options.pickFile ?? defaultPickFile;
  const saveFile = options.saveFile ?? defaultSaveFile;
  const session = app.session;

  // ── Shell ────────────────────────────────────────────────────────────
  // `eventBus` must be assigned before the shell connects, because
  // AppShell.connectedCallback subscribes to whatever bus it holds at
  // that moment. Detaching and re-appending an existing shell re-runs
  // connectedCallback so the subscription targets the App's bus.
  const existing = root.querySelector('app-shell') as AppShell | null;
  const shell: AppShell = existing ?? document.createElement('app-shell');
  shell.remove();
  shell.eventBus = eventBus;

  // The class hierarchy changes with the loaded metamodels; both closures are
  // rebuilt on `metamodel-loaded`.
  let closure: TypeClosure = typeClosure(store);
  // The model's contents for the tree, the RDF panel and the Graph tab, kept up
  // to date by the store's changes rather than read whole after each (Task 22).
  const contentsIndex = new ModelContentsIndex(store, () => closure);
  const stopIndexing = (store as Partial<ObservableRdfStore>).subscribe?.((change) => contentsIndex.note(change));
  const modelContents = () => contentsIndex.contents(viewManager.getViews());
  let classClosure: ClassClosure = buildClassClosure(store);
  const closureLookup: ClassClosure = (typeIri) => classClosure(typeIri);

  const describe = (iri: string): ConceptDescription | undefined => {
    const types = statementsOf(store, namedNode(iri) as unknown as NamedNode, namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode).map((q) => q.object.value);
    if (types.length === 0) return undefined;
    // The name only when asked for: drawing a view asks a link its type and its
    // name in the model (`modelName`), never `label`, which looks in every graph (Task 22).
    return {
      typeIri: mainType(types, closure),
      get label() {
        return labelOf(store, iri);
      },
      get named() {
        return hasLabel(store, iri);
      },
      // A relationship's line is labelled from the model alone: cheap enough for every line of a view.
      get modelName() {
        return modelNameOf(store, iri);
      },
      // A derivation the model does not state: a valid one, or a potential one not confirmed.
      get derivation() {
        const status = derivationStatus(store, iri);
        return status && !status.confirmed ? status.certainty : undefined;
      },
      get derivationRule() {
        const rule = ruleOf(store, iri);
        return rule ? localNameOf(rule) : undefined;
      },
    };
  };

  // ── Top: app toolbar ─────────────────────────────────────────────────
  const appToolbar = document.createElement('app-toolbar');
  appToolbar.slot = 'toolbar';
  // The bundled catalogue, then the published one (App.loadCatalogue).
  appToolbar.catalogue = [];
  void app.loadCatalogue((entries) => {
    appToolbar.catalogue = entries;
  });

  // ── Right: palette ───────────────────────────────────────────────────
  const palettePanel = document.createElement('palette-panel');
  palettePanel.slot = 'palette';
  palettePanel.palette = emptyPalette();

  // ── Left: model tree ─────────────────────────────────────────────────
  const modelExplorer = document.createElement('model-explorer');
  modelExplorer.slot = 'explorer';

  // ── Bottom, "Properties" tab: property panel ─────────────────────────
  // No element manager: edits travel as events to the App, which tags text
  // with its language — the one place that knows the shapes want it.
  const propertyPanel = document.createElement('property-panel');
  propertyPanel.slot = 'properties';
  propertyPanel.rdfStore = store;
  propertyPanel.nameOf = (iri) => (hasLabel(store, iri) ? labelOf(store, iri) : undefined);
  propertyPanel.shapesGraph = app.shapesGraph();
  // The value of a link added there is picked from the model's concepts, by name.
  propertyPanel.concepts = () => {
    const contents = modelContents();
    const byName = new Intl.Collator('en').compare;
    const named = <T extends { label: string }>(list: readonly T[]) => [...list].sort((a, b) => byName(a.label, b.label));
    return [
      ...named(contents.elements).map((c) => ({ iri: c.iri, label: c.label, detail: c.typeLabel, groupLabel: 'Elements' })),
      ...named(contents.relationships).map((r) => ({ iri: r.iri, label: r.label, detail: r.typeLabel, groupLabel: 'Relationships' })),
      ...named(contents.views).map((v) => ({ iri: v.iri, label: v.label, detail: 'View', groupLabel: 'Views' })),
    ];
  };

  // ── Centre: diagram host + alternative catalog/matrix views ──────────
  const canvasArea = document.createElement('div');
  canvasArea.slot = 'canvas';
  canvasArea.className = 'la-canvas-area';

  // The global tools (connect / lasso / hand) live in this strip rather than
  // in diagram-js's own in-canvas palette, which would duplicate the sidebar.
  const canvasToolbar = document.createElement('canvas-toolbar');

  const canvasHost = document.createElement('div');
  canvasHost.className = 'la-diagram-host';

  const catalogView = document.createElement('catalog-view');
  catalogView.rdfStore = store;
  catalogView.elementManager = elementManager;
  catalogView.viewManager = viewManager;
  catalogView.hidden = true;

  const matrixView = document.createElement('matrix-view');
  matrixView.rdfStore = store;
  matrixView.viewManager = viewManager;
  matrixView.hidden = true;

  canvasArea.append(canvasToolbar, canvasHost, catalogView, matrixView);

  // The palette drives the closure-aware domain/range matching on the context
  // pad, so it has to be readable as it changes.
  let currentPalette: PaletteDefinition = emptyPalette();
  // How a type looks outside the canvas — the Graph tab, a new view's sizes —
  // read the way the canvas reads it: the palette entry, else the palette's
  // notation index (Req 2.16). Updated wherever `currentPalette` is.
  const lookStyles = new NotationStyleRegistry(currentPalette);
  // A type's label in the catalog and matrix views, as the palette shows it.
  const typeLabelOf = (typeIri: string): string => lookStyles.labelFor(typeIri) ?? labelOf(store, typeIri);
  catalogView.typeLabelOf = typeLabelOf;
  matrixView.typeLabelOf = typeLabelOf;
  // Their membership changed (an element added to or taken out of the view).
  const onViewMembersChange = (e: Event): void => {
    eventBus.emit('views-changed', { viewIri: (e as CustomEvent<{ viewIri: string }>).detail.viewIri });
  };
  catalogView.addEventListener('view-members-change', onViewMembersChange);
  matrixView.addEventListener('view-members-change', onViewMembersChange);

  const diagramCanvas = new DiagramCanvas({
    container: canvasHost,
    eventBus,
    elementManager,
    relationshipManager,
    paletteDefinition: currentPalette,
    modelIri: session.modelIri ?? DEFAULT_MODEL_IRI,
    classClosure: closureLookup,
    rdfStore: store,
    viewManager,
    ...(store instanceof ObservableRdfStore ? { changeStore: store } : {}),
    describeElement: describe,
    confirmDeleteFromModel: (request: DeleteFromModelRequest) => confirmModelDelete(request),
    confirmRetypeElement: (request: RetypeElementRequest) =>
      dialogs.confirm(
        `Change ${request.label} to ${request.toLabel}?`,
        request.notPermitted.length === 1
          ? `One of its relationships is not permitted between a ${request.toLabel} and the other end. It is kept, and validation will flag it until it is changed or deleted.`
          : `${request.notPermitted.length} of its relationships are not permitted between a ${request.toLabel} and the other end. They are kept, and validation will flag them until they are changed or deleted.`,
        { confirmLabel: 'Change type', details: request.notPermitted },
      ),
    onContextAction: (action, iri) => onCanvasContextAction(action, iri),
    canMoveToFolder: () => hasFolders(modelContents()),
    onToolChanged: (tool) => {
      canvasToolbar.activeTool = tool ?? undefined;
    },
    onNotice: (message, level) => dialogs.toast(message, level),
  });

  // ── Bottom, "Validation" and "SPARQL Query" tabs ─────────────────────
  const validationPanel = document.createElement('validation-panel');
  validationPanel.slot = 'validation';
  validationPanel.validator = validator;
  validationPanel.labelFor = (iri) => labelOf(store, iri);
  // As the tree lists it: a relationship without a name by its ends, an element without one as unnamed.
  validationPanel.describe = (iri) => {
    const concept = contentsIndex.concept(iri);
    if (!concept) {
      const view = viewManager.getView?.(iri);
      return view ? { name: view.label || 'Untitled view', type: 'View' } : { name: labelOf(store, iri) };
    }
    if (concept.kind === 'model') return { name: concept.summary.label, type: 'Model' };
    const unnamed = concept.kind !== 'relationship' && !hasLabel(store, iri);
    return { name: unnamed ? 'Unnamed' : concept.summary.label, type: concept.summary.typeLabel, ...(unnamed ? { unnamed } : {}) };
  };
  validationPanel.fieldNameFor = (predicate) => fieldName(predicate, undefined, propertyPanel.nameOf);
  // No data graph: the panel shows the app's reports (`validation-updated`), and
  // a copy of every graph would only be held in memory (Task 22).
  validationPanel.shapesGraph = app.shapesGraph();

  const sparqlEditor = document.createElement('sparql-editor');
  sparqlEditor.slot = 'sparql';
  sparqlEditor.rdfStore = store;

  const graphPanel = document.createElement('graph-panel');
  graphPanel.slot = 'graph';

  // ── Bottom, "History" tab: the model's commits ───────────────────────
  const historyPanel = document.createElement('history-panel');
  historyPanel.slot = 'history';
  const versionHistory = new VersionHistory(store);
  const typeGuidePanel = document.createElement('type-guide-panel');
  typeGuidePanel.slot = 'guide';

  // ── Far right: the model as RDF ──────────────────────────────────────
  // Hidden by default; the toolbar's "RDF" toggles it. It serializes through
  // the same path as Save — the whole model, or the open view's or the
  // selection's statements written the same way — and it does no work at all
  // while hidden.
  /** What the RDF panel shows, and what it downloads, for a scope. */
  const rdfContent = (request: RdfPanelRequest): RdfPanelContent & { fileName?: string; mediaType?: string } => {
    const { format, profile, scope, selectedIris } = request;
    if (scope === 'model') {
      const contents = modelContents();
      return {
        text: app.saveModel(format, profile).text,
        stats: {
          elements: contents.elements.length + contents.unclassified.length,
          relationships: contents.relationships.length,
          views: contents.views.length,
          triples: modelQuads(store).length,
        },
      };
    }
    const viewIri = session.activeViewIri;
    const iris = scope === 'view' ? (viewIri ? [viewIri] : []) : selectedIris;
    if (iris.length === 0) return { text: '' };
    const all = scope === 'view' ? viewStatements(store, iris[0]!) : conceptStatements(store, iris, viewIri);
    // Without geometry, what Save would leave out is left out here too — and from the count.
    const geometry = profile === 'no-geometry' ? new Set(partitionModel(all, session.modelIri).views) : undefined;
    const quads = geometry ? all.filter((q) => !geometry.has(q)) : all;
    const contents = modelContents();
    const subjects = new Set(quads.map((q) => q.subject.value));
    const count = (list: Array<{ iri: string }>) => list.filter((c) => subjects.has(c.iri)).length;
    const caption = iris.length === 1 ? labelOf(store, iris[0]!) : `${iris.length} selected`;
    const info = formatInfo(format);
    return {
      text: quads.length > 0 ? app.modelIO.serialize(session.modelIri, { format, quads }) : '',
      stats: {
        elements: count(contents.elements) + count(contents.unclassified),
        relationships: count(contents.relationships),
        views: count(contents.views),
        triples: quads.length,
      },
      caption,
      fileName: `${(iris.length === 1 ? caption : 'selection').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'rdf'}.${info.extension}`,
      mediaType: info.mediaType,
    };
  };
  const rdfPanel = document.createElement('rdf-panel');
  rdfPanel.slot = 'rdf';
  rdfPanel.source = rdfContent;

  // ── Attach to the document ───────────────────────────────────────────
  shell.append(appToolbar, modelExplorer, typeGuidePanel, canvasArea, propertyPanel, validationPanel, sparqlEditor, graphPanel, historyPanel, palettePanel, rdfPanel);
  root.appendChild(shell);

  // ── Model tree data ──────────────────────────────────────────────────
  const placedInView = (): ReadonlySet<string> => {
    const viewIri = session.activeViewIri;
    if (!viewIri || typeof viewManager.getNodes !== 'function') return new Set();
    // What the view shows, kept as its shapes move (Task 22).
    const placed = (viewManager as { placedIn?(viewIri: string): ReadonlySet<string> }).placedIn;
    if (placed) return placed.call(viewManager, viewIri);
    return new Set([
      ...viewManager.getNodes(viewIri).map((n) => n.elementIri),
      ...viewManager.getLinks(viewIri).map((l) => l.relationshipIri),
    ]);
  };
  modelExplorer.contentsProvider = modelContents;
  modelExplorer.placedProvider = placedInView;
  modelExplorer.eventBus = eventBus;
  modelExplorer.activeViewIri = session.activeViewIri;

  // ── Selection routing ────────────────────────────────────────────────
  const analysisFor = (iri: string): PropertyAnalysis | undefined => {
    const info = describe(iri);
    if (!info) return undefined;
    const views = (typeof viewManager.viewsContaining === 'function' ? viewManager.viewsContaining(iri) : []).map((v) => ({
      iri: v,
      label: viewManager.getView?.(v)?.label ?? v,
    }));
    const rel = relationshipManager.getRelationship?.(iri);
    if (rel) {
      return {
        relationships: [],
        views,
        ends: {
          sourceIri: rel.sourceIri,
          sourceLabel: labelOf(store, rel.sourceIri),
          targetIri: rel.targetIri,
          targetLabel: labelOf(store, rel.targetIri),
        },
      };
    }
    const relationships = (relationshipManager.getRelationshipsOf?.(iri) ?? []).map((r) => {
      const out = r.sourceIri === iri;
      const other = out ? r.targetIri : r.sourceIri;
      return {
        iri: r.iri,
        direction: out ? ('out' as const) : ('in' as const),
        typeLabel: labelOf(store, r.classIri),
        otherIri: other,
        otherLabel: labelOf(store, other),
      };
    });
    return { relationships, views };
  };

  const headingFor = (iri: string) => {
    const types = statementsOf(store, namedNode(iri) as unknown as NamedNode, namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode).map((q) => q.object.value);
    const typeIri = mainType(types, closure);
    const all = new Set(types.flatMap((t) => closure(t)));
    const kind = types.includes(NAMESPACES.arch + 'Model')
      ? 'Model'
      : all.has(NAMESPACES.arch + 'View')
        ? 'View'
        : all.has(NAMESPACES.arch + 'QualifiedRelationship')
          ? 'Relationship'
          : 'Element';
    // A derived relationship: what derived it, from what, and whether it is confirmed.
    const details = kind === 'Relationship' ? derivationDetails(store, iri) : undefined;
    const derivation = details && {
      certainty: details.certainty,
      confirmed: details.confirmed,
      ...(details.rule ? { rule: localNameOf(details.rule) } : {}),
      premises: details.premises.map((premise) => ({ iri: premise, label: labelOf(store, premise) })),
    };
    const shown = derivation && !derivation.confirmed ? (derivation.certainty === 'valid' ? 'Derived relationship' : 'Potential relationship') : kind;
    return { kind: shown, ...(typeIri ? { typeIri, typeLabel: labelOf(store, typeIri) } : {}), ...(derivation ? { derivation } : {}) };
  };

  // ── Under the tree: what the metamodel says about the selected type ──
  /** What the metamodels say about a type; cached until metamodels or the model change. */
  const guides = new Map<string, TypeGuide | undefined>();
  typeGuidePanel.guideSource = (iri) => {
    if (!guides.has(iri)) guides.set(iri, readTypeGuide(store, iri));
    return guides.get(iri);
  };
  /** What the guide describes for a concept: its type — for a view, the viewpoint it follows. */
  const guideIriFor = (iri: string): string => {
    const heading = headingFor(iri);
    const viewpointIri = heading.kind === 'View' ? viewManager.getView?.(iri)?.viewpointIri : undefined;
    return viewpointIri ?? heading.typeIri ?? '';
  };
  /** The guide shows a type picked in the palette, not the selection's. */
  let guideFromPalette = false;
  typeGuidePanel.folded = shell.guideFolded;
  const onGuidePanelChanged = (e: Event): void => {
    typeGuidePanel.folded = (e as CustomEvent<{ folded: boolean }>).detail.folded;
  };
  shell.addEventListener('guide-panel-changed', onGuidePanelChanged);
  // The RDF panel shows whether the shell has it over the workspace.
  const onRdfPanelChanged = (e: Event): void => {
    rdfPanel.maximized = (e as CustomEvent<{ maximized: boolean }>).detail.maximized;
  };
  shell.addEventListener('rdf-panel-changed', onRdfPanelChanged);

  let selecting = false;
  /**
   * @param options.theView `iri` is the open view, shown because nothing is
   *   selected on the canvas: neither revealed in the tree nor taking the
   *   type guide from a palette pick.
   */
  const selectConcept = (iri: string | undefined, options: { fromCanvas?: boolean; fromGraph?: boolean; theView?: boolean } = {}): void => {
    if (selecting) return;
    selecting = true;
    try {
      propertyPanel.selectedIri = iri ?? '';
      propertyPanel.heading = iri ? headingFor(iri) : undefined;
      propertyPanel.analysis = iri ? analysisFor(iri) : undefined;
      propertyPanel.typeChoices = typeChoicesFor(propertyPanel.heading);
      // A palette pick stays until something is selected: starting to create
      // it clears the canvas selection, and so may a click on empty canvas.
      if (iri && !(options.theView && guideFromPalette)) {
        typeGuidePanel.guideIri = guideIriFor(iri);
        guideFromPalette = false;
      } else if (!iri && !guideFromPalette) {
        typeGuidePanel.guideIri = '';
      }
      if (iri && !options.theView) modelExplorer.revealIri(iri);
      else modelExplorer.selectedIri = iri ?? '';
      catalogView.selectedIri = iri ?? '';
      rdfPanel.selectedIri = iri ?? '';
      rdfPanel.selectedIris = iri ? [iri] : [];
      graphPanel.selectedIri = iri ?? '';
      // The graph centres on the selected element — unless the pick came from
      // the graph itself, which would re-centre it under the pointer.
      if (iri && !options.fromGraph && isElement(iri)) graphPanel.rootIri = iri;
      if (iri && !options.fromCanvas) diagramCanvas.reveal(iri);
      if (!options.fromCanvas) eventBus.emit('selection-changed', { iri });
    } finally {
      selecting = false;
    }
  };

  const onExplorerSelect = (e: Event): void => {
    selectConcept((e as CustomEvent<ExplorerSelectDetail>).detail.iri);
  };
  const onCatalogSelect = (e: Event): void => {
    selectConcept((e as CustomEvent<CatalogSelectDetail>).detail.iri);
  };
  const onValidationNavigate = (e: Event): void => {
    void revealAnywhere((e as CustomEvent<ValidationNavigateDetail>).detail.focusNodeIri);
  };
  /** Nothing selected: the open view is, as a click on it in the tree selects it — its properties shown. */
  const selectTheView = (): void => {
    selectConcept(session.activeViewIri, { fromCanvas: true, theView: true });
  };
  const onCanvasSelection: ModelEventHandler = (event) => {
    if (selecting) return;
    const iri = event.detail?.iri as string | undefined;
    if (!iri) {
      selectTheView();
      return;
    }
    selectConcept(iri, { fromCanvas: true });
    // The rest of the panels follow the first; the RDF panel shows them all.
    rdfPanel.selectedIris = (event.detail?.iris as string[] | undefined) ?? [iri];
  };

  modelExplorer.addEventListener('explorer-select', onExplorerSelect);
  catalogView.addEventListener('catalog-select', onCatalogSelect);
  validationPanel.addEventListener('validation-navigate', onValidationNavigate);

  /**
   * Show a concept: select it on the canvas when the open view has it,
   * otherwise open a view that does, otherwise just select it in the tree.
   */
  const revealAnywhere = async (iri: string): Promise<void> => {
    if (diagramCanvas.reveal(iri)) {
      selectConcept(iri, { fromCanvas: true });
      return;
    }
    const views = typeof viewManager.viewsContaining === 'function' ? viewManager.viewsContaining(iri) : [];
    const diagram = views.find((v) => viewManager.getView?.(v)?.type === 'Diagram');
    if (diagram) {
      session.openView(diagram);
      diagramCanvas.reveal(iri);
    }
    selectConcept(iri, { fromCanvas: true });
  };

  // ── An element's type: from the property panel ───────────────────────
  /** An element can be changed to any loaded element type; other concepts show theirs read-only. */
  const typeChoicesFor = (heading: { kind: string } | undefined) =>
    heading?.kind === 'Element' ? currentPalette.elementGroups : undefined;
  const onPropertyRetype = (e: Event): void => {
    const { elementIri, typeIri, reply } = (e as CustomEvent<{ elementIri: string; typeIri: string; reply?: (changed: boolean) => void }>).detail;
    void diagramCanvas.retypeElement(elementIri, typeIri).then((changed) => reply?.(changed));
  };
  propertyPanel.addEventListener('property-retype', onPropertyRetype);

  // ── The canvas's right-click menu: what the rest of the app does ─────
  const onCanvasContextAction = (action: CanvasContextAction, iri: string): void => {
    switch (action) {
      case 'properties':
        selectConcept(iri, { fromCanvas: true });
        shell.showTab('properties');
        return;
      case 'reveal-tree':
        setExplorerOpen(true);
        modelExplorer.revealIri(iri);
        return;
      case 'graph':
        selectConcept(iri, { fromCanvas: true });
        graphPanel.rootIri = iri;
        shell.showTab('graph');
        return;
      case 'ask':
        // The questions about it, in the SPARQL tab, where the one picked runs.
        selectConcept(iri, { fromCanvas: true });
        shell.showTab('sparql');
        sparqlEditor.openQuestions({ focus: iri });
        return;
      case 'copy-iri':
        void Promise.resolve(globalThis.navigator?.clipboard?.writeText(iri))
          .then(() => dialogs.toast('IRI copied'))
          .catch(() => dialogs.toast(`IRI: ${iri}`));
        return;
      // The model tree's own actions, on a relationship or the open view.
      case 'rename':
      case 'show-source':
      case 'show-target':
        void handleExplorerAction({ action, iri, kind: 'relationship' });
        return;
      case 'rename-view':
      case 'set-viewpoint':
      case 'duplicate-view':
      case 'delete-view':
        void handleExplorerAction({ action, iri, kind: 'view' });
        return;
      case 'move-to-folder': {
        // The one right-clicked and the others selected of its kind.
        const kind = kindOfConcept(iri);
        if (!kind) return;
        const kindOf = layoutNow().kindOf;
        const selected = diagramCanvas.selectedIris();
        const iris = selected.includes(iri) ? [iri, ...selected.filter((other) => other !== iri && kindOf.get(other) === kind)] : [iri];
        void moveToFolderAsked(iris, kind);
        return;
      }
    }
  };

  // ── Property panel → model ───────────────────────────────────────────
  // Each edit is one step on the open view's undo stack (`recordChange`); with
  // no view open it is made as it is.

  /** Make a property change; tell the app when the canvas did not record it (it does when it did). */
  const changeProperties = (elementIri: string, apply: () => void): void => {
    if (!diagramCanvas.recordChange(apply)) eventBus.emit('model-changed', { origin: 'properties', iri: elementIri });
  };

  /**
   * The term a value from the panel stands for: an IRI chosen from the shape's
   * list, a literal of the shape's datatype (bs:orphan → xsd:boolean), text in
   * its language, or — typed — an IRI when it looks like one.
   */
  const termFor = (d: { predicate: string; value: string; isIri?: boolean; datatype?: string; language?: string }): Term =>
    (d.isIri || (!d.datatype && !d.language && /^(https?|urn):/.test(d.value))
      ? DataFactory.namedNode(d.value)
      : d.language
        ? DataFactory.literal(d.value, d.language)
        : d.datatype
          ? DataFactory.literal(d.value, DataFactory.namedNode(d.datatype))
          : DataFactory.literal(
              d.value,
              d.predicate.startsWith(NAMESPACES.skos) || d.predicate.startsWith(NAMESPACES.dcterms) ? 'en' : undefined,
            )) as unknown as Term;

  /** The element's own values of a property (not the metamodel's), matching `value` and, when given, `language`. */
  const valuesOf = (elementIri: string, predicate: string, value: string, language?: string): Quad[] =>
    store
      .getQuads(namedNode(elementIri) as unknown as NamedNode, namedNode(predicate) as unknown as NamedNode)
      .filter(
        (q) =>
          q.graph.termType === 'DefaultGraph' &&
          q.object.value === value &&
          (language === undefined || ((q.object as { language?: string }).language ?? '') === language),
      );

  /** Replace one value of a property — only it: the name in another language stays. */
  const editProperty = (d: PropertyEditDetail): void => {
    const value = termFor(d);
    changeProperties(d.elementIri, () => {
      const replaced = d.previous ? valuesOf(d.elementIri, d.predicate, d.previous, d.previousLanguage) : [];
      if (replaced.length > 0) store.removeQuads(replaced);
      store.addQuads([DataFactory.quad(DataFactory.namedNode(d.elementIri), DataFactory.namedNode(d.predicate), value as never) as unknown as Quad]);
    });
  };

  const onPropertyEdit = (e: Event): void => editProperty((e as CustomEvent<PropertyEditDetail>).detail);
  const onPropertyAdd = (e: Event): void => {
    const d = (e as CustomEvent<PropertyChangeDetail>).detail;
    const value = termFor(d);
    changeProperties(d.elementIri, () => {
      store.addQuads([DataFactory.quad(DataFactory.namedNode(d.elementIri), DataFactory.namedNode(d.predicate), value as never) as unknown as Quad]);
    });
  };
  const onPropertyRemove = (e: Event): void => {
    const d = (e as CustomEvent<PropertyChangeDetail>).detail;
    changeProperties(d.elementIri, () => {
      const stale = valuesOf(d.elementIri, d.predicate, d.value);
      if (stale.length > 0) store.removeQuads(stale);
    });
  };
  const onPanelNavigate = (e: Event): void => {
    void revealAnywhere((e as CustomEvent<{ iri: string }>).detail.iri);
  };
  const onPanelOpenView = (e: Event): void => {
    const { viewIri, iri } = (e as CustomEvent<{ viewIri: string; iri?: string }>).detail;
    session.openView(viewIri);
    if (iri) diagramCanvas.reveal(iri);
  };
  propertyPanel.addEventListener('property-edit', onPropertyEdit);
  propertyPanel.addEventListener('property-add', onPropertyAdd);
  propertyPanel.addEventListener('property-remove', onPropertyRemove);
  propertyPanel.addEventListener('panel-navigate', onPanelNavigate);
  const onConfirmDerivation = (e: Event): void => confirmDerivation((e as CustomEvent<{ iri: string }>).detail.iri);
  propertyPanel.addEventListener('confirm-derivation', onConfirmDerivation);
  propertyPanel.addEventListener('panel-open-view', onPanelOpenView);

  // ── Palette → diagram-js `create` ────────────────────────────────────
  //
  // `palette-panel` starts the gesture from `mousedown` (and `click`, for
  // click-to-place) and hands the raw event over. `Dragging.init` binds
  // `mousemove`/`mouseup` on `document`, so a press that begins in the sidebar
  // is tracked all the way onto the canvas; diagram-js computes the drop
  // position, shows the preview, applies snapping, and mints the RDF element
  // inside the resulting `shape.create` command.
  const onPaletteDragStart = (e: Event): void => {
    const detail = (e as CustomEvent<PaletteDragDetail>).detail;
    if (!detail?.iri) return;
    // The picked type is what the guide under the tree describes, until something is selected.
    typeGuidePanel.guideIri = detail.iri;
    guideFromPalette = true;
    clearTimeout(paletteHover);
    typeGuidePanel.previewIri = '';

    if (detail.kind === 'relationship') {
      // A relationship type is not a shape, so there is nothing to drag onto the
      // canvas. Picking one arms the connect tool with that type preselected.
      diagramCanvas.setPreferredRelationshipType(detail.iri);
      diagramCanvas.activateTool('connect', detail.sourceEvent);
      return;
    }

    diagramCanvas.startCreate(detail.iri, detail.sourceEvent);
  };
  palettePanel.addEventListener('palette-drag-start', onPaletteDragStart);

  /**
   * The palette entry under the pointer is shown in the About box under the
   * tree — its name, IRI and definition — after a pause, so sweeping across
   * the palette does not churn it; once one is shown the next follows at once.
   * Off the palette, the box shows what it showed before.
   */
  let paletteHover: ReturnType<typeof setTimeout> | undefined;
  const onPaletteHover = (e: Event): void => {
    const { iri } = (e as CustomEvent<PaletteHoverDetail>).detail;
    clearTimeout(paletteHover);
    const delay = iri ? (typeGuidePanel.previewIri ? 60 : 350) : 250;
    paletteHover = setTimeout(() => (typeGuidePanel.previewIri = iri ?? ''), delay);
  };
  palettePanel.addEventListener('palette-hover', onPaletteHover);

  // ── Model tree → canvas and model ────────────────────────────────────
  const onExplorerDrag = (e: Event): void => {
    const { iri, sourceEvent } = (e as CustomEvent<ExplorerDragDetail>).detail;
    if (activeKind !== 'diagram') return;
    diagramCanvas.startPlaceExisting(iri, sourceEvent);
  };
  const onExplorerActivate = (e: Event): void => {
    const { iri, kind } = (e as CustomEvent<ExplorerSelectDetail>).detail;
    if (kind === 'view') session.openView(iri);
    else if (kind === 'model') void runCommand({ command: 'model-settings' });
    else void revealAnywhere(iri);
  };
  const onExplorerAction = (e: Event): void => {
    void handleExplorerAction((e as CustomEvent<ExplorerActionDetail>).detail);
  };
  modelExplorer.addEventListener('explorer-drag-start', onExplorerDrag);
  modelExplorer.addEventListener('explorer-activate', onExplorerActivate);
  modelExplorer.addEventListener('explorer-action', onExplorerAction);

  const renameConcept = async (iri: string): Promise<void> => {
    const current = labelOf(store, iri);
    const name = await dialogs.prompt('Rename', 'Name', current);
    if (!name) return;
    editProperty({
      elementIri: iri,
      predicate: NAMESPACES.skos + 'prefLabel',
      value: name,
      language: 'en',
      ...(hasLabel(store, iri) ? { previous: current } : {}),
    });
  };

  const handleExplorerAction = async (detail: ExplorerActionDetail): Promise<void> => {
    const { action, iri } = detail;
    switch (action) {
      case 'rename-model':
        return runCommand({ command: 'rename-model' });
      case 'model-settings':
        return runCommand({ command: 'model-settings' });
      case 'new-diagram':
        return runCommand({ command: 'new-view', value: 'Diagram' });
      case 'new-catalog':
        return runCommand({ command: 'new-view', value: 'Catalog' });
      case 'new-matrix':
        return runCommand({ command: 'new-view', value: 'Matrix' });
      case 'open-view':
        session.openView(iri);
        return;
      case 'rename-view': {
        const name = await dialogs.prompt('Rename view', 'Name', viewManager.getView?.(iri)?.label ?? '');
        if (name) session.renameView(iri, name);
        return;
      }
      case 'duplicate-view':
        session.openView(session.duplicateView(iri));
        return;
      case 'delete-view': {
        const view = viewManager.getView?.(iri);
        const ok = await dialogs.confirm(
          'Delete view',
          `Delete the view "${view?.label ?? iri}"? The elements and relationships it shows stay in the model.`,
          { confirmLabel: 'Delete view', danger: true },
        );
        if (ok) session.deleteView(iri);
        return;
      }
      case 'set-viewpoint': {
        const choice = await chooseViewpoint(viewManager.getView?.(iri)?.viewpointIri);
        if (choice !== null) session.setViewpoint(iri, choice || undefined);
        return;
      }
      case 'add-to-view':
        if (activeKind !== 'diagram') {
          dialogs.toast('Open a diagram view to place it in.', 'warning');
        } else if (detail.kind === 'relationship') {
          if (!diagramCanvas.drawExistingRelationship(iri)) {
            dialogs.toast('Place both of its elements in this view first.', 'warning');
          }
        } else if (!diagramCanvas.placeExisting(iri)) {
          dialogs.toast('This element cannot be placed here.', 'warning');
        }
        return;
      case 'reveal':
        void revealAnywhere(iri);
        return;
      case 'rename':
        return renameConcept(iri);
      case 'delete-from-model':
        await deleteFromModel(iri);
        return;
      case 'show-source':
      case 'show-target': {
        const rel = relationshipManager.getRelationship?.(iri);
        if (rel) void revealAnywhere(action === 'show-source' ? rel.sourceIri : rel.targetIri);
        return;
      }
      case 'confirm-derivation':
        confirmDerivation(iri);
        return;
      case 'new-folder':
        return newFolderIn(detail.folderKind, detail.kind === 'folder' && iri ? iri : undefined);
      case 'rename-folder':
        return renameFolderAt(iri);
      case 'move-to-folder': {
        const kind = detail.folderKind ?? kindOfConcept(iri);
        return kind ? moveToFolderAsked(detail.iris ?? [iri], kind) : undefined;
      }
      case 'delete-folder':
        return deleteFolderAsked(iri);
    }
  };

  // ── The model's folders (Req 10.13–10.15) ────────────────────────────

  /** Folders moved into, most recent first: offered first the next time. */
  let recentFolders: string[] = [];
  const usedFolder = (iri: string | undefined): void => {
    if (iri) recentFolders = [iri, ...recentFolders.filter((f) => f !== iri)].slice(0, RECENT_FOLDERS);
  };

  /** Make a folder change as one step on the open view's undo stack, then show `reveal` in the tree. */
  const changeFolders = (change: FolderChange, reveal?: string): void => {
    if (change.remove.length === 0 && change.add.length === 0) return;
    changeProperties(session.modelIri ?? '', () => applyFolderChange(store, change));
    modelExplorer.refresh();
    if (reveal) modelExplorer.revealIri(reveal);
  };

  const layoutNow = () => folderLayout(modelContents());

  /** A folder in another, or at the top of a group — in the folder standing for it, made with it when there is none. */
  const newFolderIn = async (kind: FolderKind | undefined, parentIri?: string): Promise<void> => {
    const modelIri = session.modelIri;
    if (!modelIri || (!parentIri && !kind)) return;
    const name = await dialogs.prompt('New folder', 'Name', 'New folder');
    if (!name) return;
    const group = parentIri ? undefined : groupFolder(store, modelIri, layoutNow(), kind!);
    const made = newFolder(store, modelIri, name, parentIri ?? group!.iri);
    changeFolders(group ? combine(group.change, made.change) : made.change, made.iri);
  };

  const renameFolderAt = async (iri: string): Promise<void> => {
    const current = modelContents().folders?.find((f) => f.iri === iri)?.label ?? '';
    const name = await dialogs.prompt('Rename folder', 'Name', current);
    if (!name || name === current) return;
    changeFolders(renameFolder(store, iri, name), iri);
  };

  /**
   * Move concepts of a group — or one folder — into a folder of the group, or
   * out of their folders (a folder: to the top of its group). One step.
   */
  const moveInto = (iris: string[], kind: FolderKind, folderIri?: string): void => {
    const modelIri = session.modelIri;
    if (!modelIri || iris.length === 0) return;
    const layout = layoutNow();
    const movingFolder = iris.length === 1 && layout.byIri.has(iris[0]);
    const group = movingFolder && !folderIri ? groupFolder(store, modelIri, layout, kind) : undefined;
    try {
      const change = combine(...(group ? [group.change] : []), ...iris.map((iri) => moveToFolder(store, iri, folderIri ?? group?.iri, modelIri)));
      usedFolder(folderIri);
      changeFolders(change, iris[0]);
    } catch (error) {
      dialogs.toast((error as Error).message, 'warning');
    }
  };

  /**
   * Ask where concepts of a group — or a folder — go: the group's folders, any
   * but the one moving and those inside it, each with the folders it is in; the
   * ones last moved into first.
   */
  const moveToFolderAsked = async (iris: string[], kind: FolderKind): Promise<void> => {
    if (!session.modelIri || iris.length === 0) return;
    const layout = layoutNow();
    const folder = iris.length === 1 && layout.byIri.has(iris[0]) ? iris[0] : undefined;
    const candidates = [...layout.kinds]
      .filter(([iri, kinds]) => kinds.has(kind) && !(folder && folderWithin(layout, iri, folder)))
      .map(([iri]) => ({ f: layout.byIri.get(iri)!, path: folderPath(layout, iri) }))
      .sort((a, b) => [...a.path, a.f.label].join('\u0000').localeCompare([...b.path, b.f.label].join('\u0000')));
    const recent = recentFolders.map((iri) => candidates.find((c) => c.f.iri === iri)).filter((c): c is (typeof candidates)[number] => Boolean(c));
    const option = (c: (typeof candidates)[number], group?: string) => ({
      value: c.f.iri,
      label: c.f.label,
      ...(c.path.length > 0 ? { detail: `in ${c.path.join(' ▸ ')}` } : {}),
      ...(group ? { group } : {}),
    });
    const groupName = KIND_FOLDER_NAMES[kind];
    const current = folder
      ? layout.byIri.get(folder)?.parentIri
      : iris.length === 1
        ? candidates.find((c) => c.f.members.includes(iris[0]))?.f.iri
        : undefined;
    const choice = await dialogs.choose(
      iris.length > 1 ? `Move ${iris.length} ${KIND_PLURALS[kind]} to folder` : 'Move to folder',
      [
        folder
          ? { value: '', label: `— At the top of ${groupName} —` }
          : { value: '', label: '— No folder —', detail: `Directly under ${groupName}` },
        ...recent.map((c) => option(c, 'Recent')),
        ...candidates.map((c) => option(c, recent.length > 0 ? 'All folders' : undefined)),
      ],
      current && layout.kinds.get(current)?.has(kind) ? current : '',
    );
    if (choice === null) return;
    moveInto(iris, kind, choice || undefined);
  };

  /** A concept's group, as the folders take it. */
  const kindOfConcept = (iri: string): FolderKind | undefined => layoutNow().kindOf.get(iri);

  const deleteFolderAsked = async (iri: string): Promise<void> => {
    const modelIri = session.modelIri;
    if (!modelIri) return;
    const layout = layoutNow();
    const folder = layout.byIri.get(iri);
    const parent = folder?.parentIri ? layout.byIri.get(folder.parentIri) : undefined;
    // The parent is shown when it is a folder of its own, not one standing for a group or the model.
    const shownParent = parent && layout.kinds.has(parent.iri) ? parent : undefined;
    const ok = await dialogs.confirm(
      'Delete folder',
      shownParent
        ? `Delete the folder "${folder?.label ?? iri}"? What it holds stays in the model and moves to "${shownParent.label}".`
        : `Delete the folder "${folder?.label ?? iri}"? What it holds stays in the model and moves up to the top of its group.`,
      { confirmLabel: 'Delete folder', danger: true },
    );
    if (!ok) return;
    changeFolders(deleteFolder(store, iri, modelIri, layout.modelFolder?.iri), shownParent?.iri);
  };

  const onExplorerMove = (e: Event): void => {
    const { iris, kind, folderIri } = (e as CustomEvent<ExplorerMoveDetail>).detail;
    moveInto(iris, kind, folderIri);
  };
  modelExplorer.addEventListener('explorer-move', onExplorerMove);

  /**
   * Confirm a potential derivation: state its triple and the qualified predicate
   * leading to it, and its membership of the model — one undoable step.
   */
  const confirmDerivation = (iri: string): void => {
    const quads = confirmationQuads(store, iri, session.modelIri);
    if (quads.length === 0) return;
    changeProperties(iri, () => store.addQuads(quads));
  };

  /** Delete from the model — through the canvas when it is drawn, so it is undoable. */
  const deleteFromModel = async (iri: string): Promise<void> => {
    const result = await diagramCanvas.deleteFromModel(iri);
    if (result) {
      selectTheView();
      eventBus.emit('model-changed', { origin: 'explorer' });
    }
  };

  const confirmModelDelete = (request: DeleteFromModelRequest): Promise<boolean> => {
    const viewLabels = request.views.map((v) => viewManager.getView?.(v)?.label || v);
    return dialogs.confirm(
      request.kind === 'element' ? 'Delete element from model' : 'Delete relationship from model',
      request.views.length > 0
        ? `"${request.label}" will be removed from the model and from every view it appears in:`
        : `"${request.label}" will be removed from the model.`,
      {
        confirmLabel: 'Delete from model',
        danger: true,
        details: [
          ...viewLabels,
          ...(request.kind === 'element' ? ['— and every relationship connected to it'] : []),
        ],
      },
    );
  };

  // ── Canvas toolbar → diagram-js tool services ────────────────────────
  const onToolbarTool = (e: Event): void => {
    const detail = (e as CustomEvent<ToolbarToolDetail>).detail;
    if (!detail?.tool) return;
    diagramCanvas.setPreferredRelationshipType(undefined);
    diagramCanvas.activateTool(detail.tool, detail.sourceEvent);
  };
  canvasToolbar.addEventListener('toolbar-tool', onToolbarTool);

  // Relationships' names on their lines: off unless switched on, remembered per browser.
  const showRelationshipNames = (shown: boolean): void => {
    canvasToolbar.relationshipNames = shown;
    diagramCanvas.setRelationshipNamesShown(shown);
  };
  showRelationshipNames(relationshipNamesShown());
  const onRelationshipNames = (event: Event): void => {
    const shown = (event as CustomEvent<{ shown: boolean }>).detail?.shown === true;
    rememberRelationshipNamesShown(shown);
    showRelationshipNames(shown);
  };
  canvasToolbar.addEventListener('relationship-names', onRelationshipNames);

  // ── Palette generation ───────────────────────────────────────────────
  let currentMetamodelIri: string | undefined;
  let currentAxisIri: string | undefined;

  /** Relationship icons a metamodel names that do not load: drawn from the notation instead. */
  const brokenIcons = new Set<string>();
  const triedIcons = new Set<string>();
  let iconRepair: ReturnType<typeof setTimeout> | undefined;
  /**
   * Try each relationship icon the palette names (once); one that does not
   * load — the ArchiMate 3.2 ontology names images never published — is
   * swapped for a drawn one, in the palette and the canvas's menus.
   */
  const tryRelationshipIcons = (palette: PaletteDefinition): void => {
    if (typeof Image !== 'function') return;
    const failed = (iconUrl: string) => () => {
      brokenIcons.add(iconUrl);
      iconRepair ??= setTimeout(() => {
        iconRepair = undefined;
        currentPalette = withRelationshipIcons(currentPalette, (url) => brokenIcons.has(url));
        palettePanel.palette = currentPalette;
        diagramCanvas.updatePaletteDefinition(currentPalette, { iconsOnly: true });
      }, 50);
    };
    for (const { iconUrl } of palette.relationshipTypes) {
      if (!iconUrl || iconUrl.startsWith('data:') || triedIcons.has(iconUrl)) continue;
      triedIcons.add(iconUrl);
      const href = iconHref(iconUrl, assetUrl);
      if (!href) {
        failed(iconUrl)();
        continue;
      }
      const probe = new Image();
      probe.onerror = failed(iconUrl);
      probe.src = href;
    }
  };

  const regeneratePalette = (): void => {
    const context = app.activePresentationContext();
    // The loaded metamodels' default sets in load order: the primary's styles
    // the palette when no context chooses, the others are the fallback layers
    // for classes the active set does not describe (Req 2.16).
    const defaultNotationSetIris = app
      .loadedMetamodels()
      .flatMap((m) => (m.notationSetIri ? [m.notationSetIri] : []));
    // In load order too: the first language's classification stays the default grouping.
    const metamodelIris = app.loadedMetamodels().map((m) => m.metamodelIri);
    // A relationship type its notation publishes no icon for — or one that does
    // not load — is shown with one drawn from its line and ends.
    const palette = withRelationshipIcons(
      paletteGenerator.generatePalette(currentMetamodelIri, {
        ...(metamodelIris.length > 0 ? { metamodelIris } : {}),
        ...(currentAxisIri ? { axisIri: currentAxisIri } : {}),
        ...(context ? { presentationContextIri: context } : {}),
        ...(defaultNotationSetIris.length > 0 ? { defaultNotationSetIris } : {}),
      }),
      (url) => brokenIcons.has(url),
    );
    tryRelationshipIcons(palette);
    // The active axis may differ from the requested one when the metamodel does
    // not publish it; follow what the generator actually used.
    currentAxisIri = palette.activeAxisIri;
    currentPalette = palette;
    lookStyles.update(palette);
    // Types by their prefixed names (`am4:Serving`), from the loaded vocabularies' prefixes.
    const prefixes = app.modelIO.collectPrefixes();
    const prefixedName = (iri: string): string => curieOf(iri, prefixes);
    palettePanel.prefixedName = prefixedName;
    typeGuidePanel.prefixedName = prefixedName;
    palettePanel.palette = palette;
    diagramCanvas.updatePaletteDefinition(palette);
    propertyPanel.typeChoices = typeChoicesFor(propertyPanel.heading);
  };

  const onAxisChange = (e: Event): void => {
    const detail = (e as CustomEvent<PaletteAxisChangeDetail>).detail;
    currentAxisIri = detail.axisIri;
    regeneratePalette();
  };
  palettePanel.addEventListener('palette-axis-change', onAxisChange);

  // ── Views on the canvas ──────────────────────────────────────────────
  let active: CanvasViewKind = 'diagram';
  const setActiveCanvasView = (kind: CanvasViewKind): void => {
    active = kind;
    activeKind = kind;
    canvasHost.hidden = kind !== 'diagram';
    canvasToolbar.hidden = kind !== 'diagram';
    catalogView.hidden = kind !== 'catalog';
    matrixView.hidden = kind !== 'matrix';
  };
  let activeKind: CanvasViewKind = 'diagram';

  const viewpointOf = (viewIri: string | undefined): ViewpointInfo | undefined => {
    const vpIri = viewIri ? viewManager.getView?.(viewIri)?.viewpointIri : undefined;
    if (!vpIri) return undefined;
    return viewpointManager.getViewpoints().find((v) => v.iri === vpIri);
  };

  /** Put the session's open view on screen, with its viewpoint applied. */
  const showActiveView = (): void => {
    const viewIri = session.activeViewIri;
    const info = viewIri ? viewManager.getView?.(viewIri) : undefined;
    const kind: CanvasViewKind = info?.type === 'Catalog' ? 'catalog' : info?.type === 'Matrix' ? 'matrix' : 'diagram';
    setActiveCanvasView(kind);
    diagramCanvas.showView(kind === 'diagram' ? viewIri : undefined);
    // A catalog lists, and a matrix indexes, the elements the view presents (arch:inView).
    catalogView.viewIri = kind === 'catalog' && viewIri ? viewIri : '';
    matrixView.viewIri = kind === 'matrix' && viewIri ? viewIri : '';
    if (kind === 'catalog') catalogView.refresh();
    if (kind === 'matrix') matrixView.refresh();

    const viewpoint = viewpointOf(viewIri);
    palettePanel.activeViewpoint = viewpoint && viewpoint.permittedElements.length > 0 ? viewpoint : undefined;
    const permitted = viewpoint ? new Set(viewpoint.permittedElements) : undefined;
    diagramCanvas.setViewpointFilter(permitted && permitted.size > 0 ? (typeIri) => permitted.has(typeIri) : undefined);

    modelExplorer.activeViewIri = viewIri;
    refreshToolbar();
  };

  // ── Property suggestions ─────────────────────────────────────────────
  /**
   * What the property panel offers when adding a property: what applies to the
   * selected concept's type, what the model already uses, documentation, and
   * the rest folded away; or any name, CURIE or IRI typed
   * (`model-manager/property-catalog.ts`). Object properties are not offered:
   * a relationship is drawn on the canvas, where it becomes a qualified
   * resource as well as a triple.
   */
  propertyPanel.catalog = new PropertyCatalog(store, {
    closure: () => closure,
    prefixes: () => app.modelIO.collectPrefixes(session.modelIri),
    modelNamespace: () => session.namespace()?.namespace ?? DEFAULT_MODEL_BASE,
  });

  // Showing, hiding or resizing a side panel resizes the canvas; diagram-js
  // caches the viewbox size (zoom-to-fit, scrolling) until told.
  const canvasResize =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => (diagramCanvas.getDiagram()?.get('canvas') as { resized(): void } | undefined)?.resized())
      : undefined;
  canvasResize?.observe(canvasHost);

  // ── Model tree and palette: shown by default, hideable and resizable ──
  const setExplorerOpen = (open: boolean): void => {
    shell.explorerOpen = open;
    appToolbar.explorerOpen = open;
  };
  const setPaletteOpen = (open: boolean): void => {
    shell.paletteOpen = open;
    appToolbar.paletteOpen = open;
  };

  // ── Graph tab: the relationships around the selected element ─────────
  /**
   * An element of the model — not a relationship, a view, the model, or a
   * class of a metamodel (typed in its named graph) — can be a graph's root.
   */
  const isElement = (iri: string): boolean => {
    const types = store
      .getQuads(namedNode(iri) as unknown as NamedNode, namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode)
      .filter((q) => q.graph.termType === 'DefaultGraph')
      .map((q) => q.object.value);
    if (types.length === 0) return false;
    if (store.getQuads(namedNode(iri) as unknown as NamedNode, namedNode(NAMESPACES.arch + 'source') as unknown as NamedNode).length > 0) return false;
    const all = new Set(types.flatMap((t) => closure(t)));
    return !all.has(NAMESPACES.arch + 'View') && !all.has(NAMESPACES.arch + 'Model');
  };
  /**
   * How the Graph tab draws a type: as the canvas would — the palette entry,
   * else the notation index, so a type the palette does not list keeps its
   * resolved colour or line. Labels stay the palette's, else the store's.
   */
  const graphLook = (typeIri: string | undefined): GraphTypeLook => {
    if (!typeIri) return { label: 'Unknown' };
    const element = lookStyles.elementType(typeIri);
    // A type the palette lists as a relationship is drawn as one, whatever the index holds.
    const relationship = element ? undefined : lookStyles.relationshipType(typeIri);
    const style = relationship ? undefined : lookStyles.styleFor(typeIri);
    if (element || style) {
      const icon = iconHref(style?.iconSymbol ?? element?.iconSymbol?.url, assetUrl);
      return {
        label: lookStyles.labelFor(typeIri) ?? labelOf(store, typeIri),
        ...(style?.fillColor ? { color: style.fillColor } : {}),
        ...(icon ? { icon } : {}),
      };
    }
    const line = lookStyles.relationshipStyleFor(typeIri);
    if (relationship || line) {
      return {
        label: relationship?.label ?? labelOf(store, typeIri),
        ...(line?.lineStyle ? { lineStyle: line.lineStyle } : {}),
        ...(line?.sourceDecor ? { sourceDecor: line.sourceDecor } : {}),
        ...(line?.targetDecor ? { targetDecor: line.targetDecor } : {}),
      };
    }
    return { label: labelOf(store, typeIri) };
  };
  const countTypes = (concepts: Array<{ typeIri: string; typeLabel: string }>): GraphTypeOption[] => {
    const byType = new Map<string, GraphTypeOption>();
    for (const c of concepts) {
      const option = byType.get(c.typeIri);
      if (option) option.count += 1;
      else {
        const color = graphLook(c.typeIri).color;
        byType.set(c.typeIri, { iri: c.typeIri, label: c.typeLabel, count: 1, ...(color ? { color } : {}) });
      }
    }
    return [...byType.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  graphPanel.source = {
    // Each concept drawn by its most specific type, as the tree lists it — not
    // the `arch:ModelConcept` a converted model also types it with.
    graph: (options) =>
      relationshipGraph(store, options, app.modelIO.collectPrefixes(session.modelIri), mostSpecificType((t) => closure(t))),
    types: () => {
      const contents = modelContents();
      return { elements: countTypes(contents.elements), relationships: countTypes(contents.relationships) };
    },
    look: graphLook,
    turtle: (quads) => app.modelIO.serializeQuads(quads, session.modelIri, 'turtle'),
    label: (iri) => labelOf(store, iri),
  };
  const onBottomPanelChanged = (): void => {
    graphPanel.active = shell.visibleBottomTab === 'graph';
    const shown = shell.visibleBottomTab === 'history';
    if (shown !== historyShown) {
      historyShown = shown;
      void refreshHistory(shown);
    }
  };

  // ── History: commit, compare, restore ────────────────────────────────
  let historyShown = false;
  /** The bound file's Git history, from the Git module while it runs. */
  let gitHistory: ((modelIri: string) => HistoryGitSource | undefined) | undefined;
  historyPanel.diffOptions = () => ({ singleValued: app.singleValued() });
  historyPanel.words = { typeName: typeLabelOf, propertyName: (p) => fieldName(p, undefined, propertyPanel.nameOf) };
  /** While the tab is shown: the bound file's Git history — read again when the tab opens (`opened`). */
  const showGitHistory = (opened = false): void => {
    if (!historyShown) return;
    const modelIri = session.modelIri;
    historyPanel.git = modelIri ? gitHistory?.(modelIri) : undefined;
    if (opened) historyPanel.reloadGit();
  };
  /** The open model's commits, and — while the tab is shown — its working state to compare with. */
  const refreshHistory = async (opened = false): Promise<void> => {
    const modelIri = session.modelIri;
    historyPanel.canCommit = Boolean(modelIri);
    historyPanel.prefixes = app.modelIO.collectPrefixes(modelIri);
    try {
      historyPanel.commits = modelIri ? await versionHistory.list(modelIri) : [];
    } catch (err: unknown) {
      report(`History unavailable: ${err instanceof Error ? err.message : String(err)}`, 'error');
      historyPanel.commits = [];
    }
    historyPanel.working = historyShown && modelIri ? versionHistory.workingSnapshot() : undefined;
    showGitHistory(opened);
  };
  const setGitHistory = (source: (modelIri: string) => HistoryGitSource | undefined): (() => void) => {
    gitHistory = source;
    showGitHistory(true);
    return () => {
      if (gitHistory !== source) return;
      gitHistory = undefined;
      historyPanel.git = undefined;
    };
  };
  const onDiffSelect = (e: Event): void => {
    const { iri } = (e as CustomEvent<{ iri: string }>).detail;
    // Only what the model has now: a concept the version compared had, and the model no longer does, is not there to show.
    if (store.getQuads(namedNode(iri) as never, null, null, DataFactory.defaultGraph() as never).length > 0) selectConcept(iri);
  };
  const onHistoryCommit = async (e: Event): Promise<void> => {
    const modelIri = session.modelIri;
    if (!modelIri) return;
    const { message } = (e as CustomEvent<HistoryCommitDetail>).detail;
    try {
      await versionHistory.commit(modelIri, message, app.collaborationUser);
      dialogs.toast('Checkpoint saved');
    } catch (err: unknown) {
      report(`The checkpoint could not be saved: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    await refreshHistory();
  };
  const onHistoryRestore = async (e: Event): Promise<void> => {
    const { id } = (e as CustomEvent<HistoryRestoreDetail>).detail;
    const commit = historyPanel.commits.find((c) => c.id === id);
    if (!commit) return;
    const go = await dialogs.confirm(
      'Restore this checkpoint',
      `The model becomes the checkpoint of ${new Date(commit.timestamp).toLocaleString()}${commit.message ? ` ("${commit.message}")` : ''}. ` +
        'Changes since the last checkpoint are replaced — save a checkpoint first to keep them. Undo takes the restore back while this view stays open.',
      { confirmLabel: 'Restore', ...(app.collaborationRoom ? { details: [`It is restored for everyone in room "${app.collaborationRoom}".`] } : {}) },
    );
    if (!go) return;
    if (!diagramCanvas.recordChange(versionHistory.restorer(commit))) {
      eventBus.emit('model-changed', { origin: 'history' });
    }
    eventBus.emit('views-changed', {});
    await refreshHistory();
  };
  historyPanel.addEventListener('history-commit', onHistoryCommit);
  historyPanel.addEventListener('history-restore', onHistoryRestore);
  historyPanel.addEventListener('diff-select', onDiffSelect);
  shell.addEventListener('bottom-panel-changed', onBottomPanelChanged);
  // The Graph tab may be the one left open last time.
  queueMicrotask(onBottomPanelChanged);
  const onGraphSelect = (e: Event): void => {
    const { iri } = (e as CustomEvent<{ iri: string }>).detail;
    selectConcept(iri, { fromGraph: true });
  };
  const onGraphRoot = (e: Event): void => {
    const { iri } = (e as CustomEvent<{ iri: string }>).detail;
    graphPanel.rootIri = iri;
    selectConcept(iri, { fromGraph: true });
  };
  const onGraphDownload = (e: Event): void => {
    const { text, fileName, mediaType } = (e as CustomEvent<GraphDownloadDetail>).detail;
    void saveFile(text, fileName, mediaType);
  };
  const onGraphOpenSparql = (e: Event): void => {
    // The tab first: the editor lays its text out when it is visible.
    shell.showTab('sparql');
    sparqlEditor.run((e as CustomEvent<GraphOpenSparqlDetail>).detail.query);
  };
  const onGraphNewView = (e: Event): void => {
    const { iris, centres, label } = (e as CustomEvent<GraphNewViewDetail>).detail;
    void newViewFrom(iris, { label, centres });
  };
  graphPanel.addEventListener('graph-select', onGraphSelect);
  graphPanel.addEventListener('graph-root', onGraphRoot);
  graphPanel.addEventListener('graph-download', onGraphDownload);
  graphPanel.addEventListener('graph-open-sparql', onGraphOpenSparql);
  graphPanel.addEventListener('graph-new-view', onGraphNewView);

  // ── A new view from results: the Graph tab's and the SPARQL tab's ────
  const conceptKinds: ConceptKinds = {
    isElement,
    endsOf: (iri) => {
      const end = (predicate: string) =>
        store
          .getQuads(namedNode(iri) as unknown as NamedNode, namedNode(predicate) as unknown as NamedNode)
          .find((q) => q.graph.termType === 'DefaultGraph' && q.object.termType === 'NamedNode')?.object.value;
      const source = end(NAMESPACES.arch + 'source');
      const target = end(NAMESPACES.arch + 'target');
      return source && target ? { source, target } : undefined;
    },
  };
  /** An element's size on a new view: its notation's default, from the palette entry or the notation index. */
  const sizeOf = (iri: string): { width: number; height: number } => {
    const types = store.getQuads(namedNode(iri) as unknown as NamedNode, namedNode(NAMESPACES.rdf + 'type') as unknown as NamedNode);
    const style = types.map((q) => lookStyles.styleFor(q.object.value)).find(Boolean);
    return { width: style?.defaultWidth ?? NOTATION_DEFAULTS.width, height: style?.defaultHeight ?? NOTATION_DEFAULTS.height };
  };
  /**
   * Make a view of the elements and relationships among `iris` — laid out as
   * drawn when `centres` places them all (the Graph tab), else as a tree;
   * following `viewpoint` when given (a question's).
   */
  const newViewFrom = async (
    iris: string[],
    options: { label: string; centres?: Map<string, { x: number; y: number }>; viewpoint?: string },
  ): Promise<void> => {
    const plan = planView(iris, conceptKinds);
    if (plan.elements.length === 0) {
      dialogs.toast('The results mention no elements of this model.', 'warning');
      return;
    }
    const counts = `${plan.elements.length} element${plan.elements.length === 1 ? '' : 's'}, ${plan.relationships.length} relationship${plan.relationships.length === 1 ? '' : 's'}`;
    const label = await dialogs.prompt('New view', `Name — ${counts}`, options.label);
    if (label === null) return;
    const drawn = !!options.centres && plan.elements.every((iri) => options.centres!.has(iri));
    const centres = drawn
      ? options.centres!
      : layoutPositions(
          plan.elements.map((id) => ({ id })),
          plan.relationships.map((id) => ({ id, ...conceptKinds.endsOf(id)! })),
          { layout: 'tree', width: NOTATION_DEFAULTS.width, height: NOTATION_DEFAULTS.height },
        );
    // The Graph tab draws smaller boxes, closer together, than a diagram.
    const bounds = placeNodes(plan.elements, centres, sizeOf, { spread: drawn ? 1.3 : 1.1 });
    session.createViewWith(
      label,
      plan.elements.map((iri) => ({ iri, bounds: bounds.get(iri)! })),
      plan.relationships,
      options.viewpoint ? { viewpointIri: options.viewpoint } : {},
    );
    const following = options.viewpoint ? ` (${labelOf(store, options.viewpoint)})` : '';
    dialogs.toast(`New view "${label.trim()}"${following}: ${counts}.`);
  };
  const onResultsViewRequest = (e: Event): void => {
    const { iris, label, viewpoint } = (e as CustomEvent<ResultsViewRequestDetail>).detail;
    void newViewFrom(iris, { label: label ?? 'Query results', ...(viewpoint ? { viewpoint } : {}) });
  };
  const onSparqlSelect = (e: Event): void => {
    void revealAnywhere((e as CustomEvent<SparqlSelectDetail>).detail.iri);
  };
  sparqlEditor.prefixSource = () => app.modelIO.collectPrefixes(session.modelIri);
  sparqlEditor.addEventListener('results-view-request', onResultsViewRequest);
  sparqlEditor.addEventListener('sparql-select', onSparqlSelect);

  // ── Model questions: the Questions menu, "Ask about this element…", the model checks ──
  /** Every question of the loaded question sets; read again when a metamodel loads. */
  let questionCache: ModelQuestion[] | undefined;
  const allQuestions = (): ModelQuestion[] => (questionCache ??= listQuestions(store));
  /** The open view's viewpoint. */
  const openViewpoint = (): string | undefined =>
    (session.activeViewIri && viewManager.getView?.(session.activeViewIri)?.viewpointIri) || undefined;
  /**
   * The documents of the open model's languages: every graph of the loaded
   * metamodels it declares conformance to — of every loaded one when it
   * declares none. A language's questions mean nothing for a model in another
   * (ArchiMate 4.0's find no `am4:Capability` in an ArchiMate 3.2 model).
   */
  const modelLanguageGraphs = (): Set<string> => {
    const model = session.modelIri;
    const declared = new Set(
      model
        ? [NAMESPACES.arch + 'modelConformsToMetamodel', NAMESPACES.arch + 'conformsToMetamodel'].flatMap((predicate) =>
            store
              .getQuads(namedNode(model) as unknown as NamedNode, namedNode(predicate) as unknown as NamedNode)
              .filter((q) => q.graph.termType === 'DefaultGraph')
              .map((q) => q.object.value),
          )
        : [],
    );
    const loaded = app.loadedMetamodels();
    const used = declared.size > 0 ? loaded.filter((m) => declared.has(m.metamodelIri)) : loaded;
    return new Set(used.flatMap((m) => Object.values(m.graphsByRole).flat() as string[]));
  };
  /** The questions worth offering: those of the open model's languages, the open view's viewpoint's first. */
  const questionsOffered = (): ModelQuestion[] => offeredQuestions(allQuestions(), modelLanguageGraphs(), openViewpoint());
  /**
   * What the workbench binds: the open model, view and its viewpoint; the
   * selected element (`focus`), or two (`from`, `to`); the type picked in the
   * palette (`conceptType`), until something is selected.
   */
  const questionBindings = (): QuestionBindings => {
    const onCanvas = diagramCanvas.selectedIris().filter(isElement);
    const picked = propertyPanel.selectedIri;
    const selected = onCanvas.length > 0 ? onCanvas : picked && isElement(picked) ? [picked] : [];
    return {
      model: session.modelIri,
      view: session.activeViewIri,
      viewpoint: openViewpoint(),
      focus: selected.length === 1 ? selected[0] : undefined,
      from: selected.length === 2 ? selected[0] : undefined,
      to: selected.length === 2 ? selected[1] : undefined,
      conceptType: guideFromPalette && typeGuidePanel.guideIri ? typeGuidePanel.guideIri : undefined,
    };
  };
  sparqlEditor.questionSource = questionsOffered;
  sparqlEditor.bindingSource = questionBindings;
  sparqlEditor.labelFor = (iri) => labelOf(store, iri);

  /** The model checks: the finding questions offered. */
  const modelChecks = (): ModelQuestion[] => questionsOffered().filter((q) => q.isFinding);
  /** Every violation drawn is marked, whatever the Validation tab's scope: the shapes' and the model checks'. */
  const markViolations = (): void => {
    diagramCanvas.setMarkers(
      VIOLATION_MARKER,
      new Set(validationPanel.allResults.filter((r) => r.severity === 'Violation').map((r) => r.focusNode.value)),
    );
  };
  /**
   * Run the model checks on request (Requirement 12.2) and list their findings
   * beside the SHACL results, until the next run or another model.
   */
  const onModelChecksRequest = async (): Promise<void> => {
    if (validationPanel.checking) return;
    validationPanel.checking = true;
    // "Checking…" shows before the queries hold the main thread.
    await validationPanel.updateComplete;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const run = runModelChecks(store, modelChecks(), { model: session.modelIri });
      validationPanel.checks = {
        results: run.results,
        ran: run.ran.length,
        failed: run.failed.map(({ question, reason }) => ({ label: question.label, reason })),
        capped: run.capped.map((q) => ({ label: q.label, limit: q.defaultLimit ?? 0 })),
      };
    } catch (err: unknown) {
      report(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      validationPanel.checking = false;
    }
    scopeValidation();
    markViolations();
  };
  const onModelChecksEvent = (): void => void onModelChecksRequest();
  validationPanel.addEventListener('model-checks-request', onModelChecksEvent);
  /** An edit after the checks ran: their findings may no longer hold. */
  const onEditAfterChecks: ModelEventHandler = () => {
    const checks = validationPanel.checks;
    if (checks && !checks.stale) validationPanel.checks = { ...checks, stale: true };
  };

  // ── RDF panel ────────────────────────────────────────────────────────
  const setRdfPanelOpen = (open: boolean): void => {
    shell.rdfOpen = open;
    appToolbar.rdfOpen = open;
    rdfPanel.selectedIri = propertyPanel.selectedIri;
    rdfPanel.active = open;
  };
  const onRdfDownload = (e: Event): void => {
    const request = (e as CustomEvent<RdfDownloadDetail>).detail;
    // The whole model downloads as Save writes it; a view or a concept as the panel shows it.
    if (request.scope === 'model') return save(request.format, request.profile);
    const content = rdfContent(request);
    if (content.text && content.fileName) void saveFile(content.text, content.fileName, content.mediaType ?? 'text/plain');
  };
  const onRdfSelect = (e: Event): void => {
    void revealAnywhere((e as CustomEvent<RdfSelectDetail>).detail.iri);
  };
  const onRdfClose = (): void => setRdfPanelOpen(false);
  rdfPanel.addEventListener('rdf-download', onRdfDownload);
  rdfPanel.addEventListener('rdf-select', onRdfSelect);
  rdfPanel.addEventListener('rdf-close', onRdfClose);

  // ── Toolbar state ────────────────────────────────────────────────────
  const presentationContexts = (): LabelledIri[] => {
    const out: LabelledIri[] = [];
    for (const m of app.loadedMetamodels()) {
      const scheme = m.presentationContextSchemeIri;
      if (!scheme) continue;
      for (const q of store.getQuads(null, namedNode(NAMESPACES.skos + 'inScheme') as unknown as NamedNode, namedNode(scheme) as unknown as NamedNode)) {
        out.push({ iri: q.subject.value, label: labelOf(store, q.subject.value) });
      }
    }
    return out;
  };

  // ── Back and forward between views: the history ─────────────────────
  // Every way of opening a view comes through `view-opened`; each opening is a
  // visit, and the view it leaves keeps where it was (visible area, selection)
  // for when Back or Forward returns to it. Per model.
  const viewHistory = new ViewHistory((iri) => Boolean(viewManager.getView?.(iri)));
  /** The view on the canvas: the one being left when another opens. */
  let shownViewIri: string | undefined;
  /** The visit Back or Forward is opening, to put back as it was left. */
  let travelling: ViewVisit | undefined;

  const refreshToolbar = (): void => {
    appToolbar.modelLabel = session.modelLabel();
    appToolbar.dirty = app.isDirty();
    appToolbar.views = viewManager.getViews();
    appToolbar.activeViewIri = session.activeViewIri ?? '';
    const named = (iri: string | undefined) => (iri ? viewManager.getView?.(iri)?.label || 'Untitled view' : '');
    appToolbar.backLabel = named(viewHistory.peekBack()?.viewIri);
    appToolbar.forwardLabel = named(viewHistory.peekForward()?.viewIri);
    appToolbar.viewpoints = viewpointManager.getViewpoints().map((v) => ({ iri: v.iri, label: v.label }));
    appToolbar.activeViewpointIri = (session.activeViewIri && viewManager.getView?.(session.activeViewIri)?.viewpointIri) || '';
    appToolbar.loadedMetamodels = app.loadedMetamodels().map((m) => ({
      iri: m.metamodelIri,
      label: m.info.name || labelOf(store, m.metamodelIri),
    }));
    appToolbar.presentationContexts = presentationContexts();
    appToolbar.activeContextIri = app.activePresentationContext() ?? '';
  };

  // ── Modules: their File-menu entries, and File › Settings… ──────────
  const moduleMenus = new Map<string, { items: () => ModuleMenuItem[]; run: (itemId: string) => Promise<void> }>();
  let moduleSwitches: { list: () => ModuleSwitch[]; toggle: (id: string, on: boolean) => Promise<void> } | undefined;
  appToolbar.fileMenuItems = (): FileMenuItem[] =>
    [...moduleMenus].flatMap(([moduleId, menu]) =>
      menu.items().map((item) => ({
        command: `${moduleId}:${item.id}`,
        label: item.label,
        section: item.section,
        ...(item.hint ? { hint: item.hint } : {}),
      })),
    );
  const addFileMenu = (moduleId: string, items: () => ModuleMenuItem[], run: (itemId: string) => Promise<void>): (() => void) => {
    const entry = { items, run };
    moduleMenus.set(moduleId, entry);
    appToolbar.requestUpdate();
    return () => {
      if (moduleMenus.get(moduleId) === entry) moduleMenus.delete(moduleId);
      appToolbar.requestUpdate();
    };
  };
  const settingsSections = new Map<string, SettingsSection>();
  const updateSettingsMenu = (): void => {
    appToolbar.settingsMenu = (moduleSwitches?.list().length ?? 0) > 0 || settingsSections.size > 0;
  };
  const setModuleSwitches = (list: () => ModuleSwitch[], toggle: (id: string, on: boolean) => Promise<void>): void => {
    moduleSwitches = { list, toggle };
    updateSettingsMenu();
  };
  const addBottomTab = ({ id, label, element }: { id: string; label: string; element: HTMLElement }): BottomTabHandle => {
    element.slot = id;
    shell.appendChild(element);
    shell.moduleTabs = [...shell.moduleTabs.filter((t) => t.id !== id), { id, label }];
    const setBadge = (text: string | undefined): void => {
      const { [id]: _old, ...others } = shell.tabBadges;
      shell.tabBadges = text ? { ...others, [id]: text } : others;
    };
    return {
      show: () => shell.showTab(id),
      setBadge,
      remove: () => {
        setBadge(undefined);
        element.remove();
        shell.moduleTabs = shell.moduleTabs.filter((t) => t.id !== id);
        if (shell.bottomTab === id) shell.bottomTab = 'properties';
      },
    };
  };

  const addSettingsSection = (section: SettingsSection): (() => void) => {
    settingsSections.set(section.id, section);
    updateSettingsMenu();
    return () => {
      if (settingsSections.get(section.id) === section) settingsSections.delete(section.id);
      updateSettingsMenu();
    };
  };
  /** The modules' switches, as the first section. */
  const modulesSection = (): SettingsSection | undefined => {
    if (!moduleSwitches || moduleSwitches.list().length === 0) return undefined;
    const switches = moduleSwitches;
    return {
      id: 'modules',
      title: 'Modules',
      detail: 'Parts of la-gram that can be switched off. Off, a module shows nothing, loads nothing and talks to no one.',
      fields: () => switches.list().map((m) => ({ name: m.id, label: `${m.label} — ${m.detail}`, type: 'checkbox' as const, value: m.enabled })),
      apply: async (values) => {
        for (const m of switches.list()) {
          const on = values[m.id] === true;
          if (on !== m.enabled) {
            await switches.toggle(m.id, on);
            report(`${m.label} is ${on ? 'on' : 'off'}.`);
          }
        }
      },
    };
  };
  /**
   * File › Settings…: one dialog, a tab per part, applied at once (Req 19.5);
   * opened at the part `open` names (its section id), else at the first.
   */
  const openSettings = async (open?: string): Promise<void> => {
    const sections = [...settingsSections.values(), ...[modulesSection()].filter((s): s is SettingsSection => !!s)];
    if (sections.length === 0) return;
    const fields: FormField[] = [];
    for (const section of sections) {
      fields.push({ name: section.id, label: section.title, type: 'section', ...(section.detail ? { hint: section.detail } : {}) });
      for (const field of await section.fields()) fields.push({ ...field, name: `${section.id}.${field.name}` });
    }
    const own = (values: FormValues, id: string): FormValues =>
      Object.fromEntries(
        Object.entries(values)
          .filter(([name]) => name.startsWith(`${id}.`))
          .map(([name, v]) => [name.slice(id.length + 1), v]),
      );
    const values = await dialogs.form('Settings', fields, {
      message: 'Kept on this machine, and applied at once. What the deployment sets is shown, not offered for change.',
      confirmLabel: 'Apply',
      tabs: true,
      ...(open && sections.some((s) => s.id === open) ? { openSection: open } : {}),
      // A part's problem opens its tab, marked.
      validate: (v) => {
        for (const section of sections) {
          const problem = section.validate?.(own(v, section.id));
          if (problem) return { message: `${section.title}: ${problem}`, field: section.id };
        }
        return null;
      },
    });
    if (!values) return;
    // A module's own settings first: switching it off after is then its last word.
    for (const section of sections) await section.apply(own(values, section.id));
  };

  // ── File › Settings… › Metamodels: which ones the Metamodels menu offers ──
  // Kept as the entries hidden, so a metamodel the catalogue gains later is offered.
  const personalSettings = new PersonalSettings();
  const hiddenMetamodels = (): string[] => {
    const hidden = personalSettings.get<{ hidden: unknown }>('metamodels').hidden;
    return Array.isArray(hidden) ? hidden.filter((iri): iri is string => typeof iri === 'string') : [];
  };
  appToolbar.hiddenCatalogue = new Set(hiddenMetamodels());
  addSettingsSection({
    id: 'metamodels',
    title: 'Metamodels',
    detail: 'Which metamodels the Metamodels menu offers. One that is loaded is listed there anyway, and Load by IRI… reaches any.',
    fields: () => {
      const hidden = new Set(hiddenMetamodels());
      const entries = appToolbar.catalogue;
      const kinds = (['core', 'language', 'framework', 'extension'] as const).filter((kind) => entries.some((e) => e.kind === kind));
      return kinds.flatMap((kind): FormField[] => [
        { name: `kind:${kind}`, label: CATALOGUE_KIND_LABELS[kind], type: 'group' },
        ...entries
          .filter((e) => e.kind === kind)
          .map((e): FormField => ({ name: e.iri, label: e.label, type: 'checkbox', value: !hidden.has(e.iri) })),
      ]);
    },
    apply: (values) => {
      const entries = appToolbar.catalogue;
      // Hidden from a catalogue not reached this time (offline) stays hidden.
      const unseen = hiddenMetamodels().filter((iri) => !entries.some((e) => e.iri === iri));
      const hidden = [...unseen, ...entries.filter((e) => values[e.iri] === false).map((e) => e.iri)];
      personalSettings.set('metamodels', { hidden: hidden.length > 0 ? hidden : undefined });
      appToolbar.hiddenCatalogue = new Set(hidden);
    },
  });

  // ── Toolbar commands ─────────────────────────────────────────────────
  const onToolbarCommand = (e: Event): void => {
    void runCommand((e as CustomEvent<ToolbarCommandDetail>).detail);
  };
  appToolbar.addEventListener('toolbar-command', onToolbarCommand);

  const guardUnsaved = async (what: string): Promise<boolean> => {
    if (app.collaborationRoom) {
      return dialogs.confirm(
        'Shared model',
        `This model is shared in room "${app.collaborationRoom}". ${what} replaces it for everyone in the room.`,
        { confirmLabel: what, danger: true },
      );
    }
    if (!app.isDirty()) return true;
    return dialogs.confirm('Unsaved changes', `The model has unsaved changes. ${what} anyway?`, {
      confirmLabel: what,
      danger: true,
    });
  };

  const chooseViewpoint = async (current?: string): Promise<string | null> =>
    dialogs.choose(
      'Viewpoint',
      [
        { value: '', label: '— none —', detail: 'Every element type is offered' },
        ...viewpointManager.getViewpoints().map((v) => ({
          value: v.iri,
          label: v.label,
          detail: `${v.permittedElements.length} element types`,
        })),
      ],
      current ?? '',
    );

  const save = (format: ModelFormat, profile: SerializationProfile = 'full'): void => {
    const saved = app.saveModel(format, profile);
    void Promise.resolve(saveFile(saved.text, saved.fileName, saved.mediaType)).then(() => {
      eventBus.emit('model-saved', { fileName: saved.fileName });
      refreshToolbar();
    });
  };

  const report = (message: string, level: 'info' | 'warning' | 'error' = 'info') => {
    dialogs.toast(message, level);
    eventBus.emit('notify', { level, message });
  };

  /** Open a model file's text as File › Open does, and say what it did. */
  const openModelText = async (text: string, fileName: string): Promise<void> => {
    const opened = await app.openModel(text, fileName);
    report(
      `Opened ${fileName}: ${opened.quadCount} triples` +
        (opened.autoPlaced ? `, ${opened.autoPlaced} elements laid out` : '') +
        (opened.migration.renamed + opened.migration.relationships + opened.migration.placements > 0
          ? ', older vocabulary migrated'
          : '') +
        '.',
    );
    if (opened.missingMetamodels.length > 0) {
      report(`Could not load: ${opened.missingMetamodels.join(', ')}`, 'warning');
    }
  };

  /** Name, namespace and prefix of the model, in one dialog. */
  const editModelSettings = async (): Promise<void> => {
    const current = session.namespace();
    if (!current) return;
    const values = await dialogs.form(
      'Model settings',
      [
        { name: 'label', label: 'Name', value: session.modelLabel() },
        {
          name: 'namespace',
          label: 'Namespace',
          value: current.namespace,
          hint: 'Where the model\'s IRIs are minted, e.g. https://acme.com/ea/payments/',
        },
        { name: 'prefix', label: 'Prefix', value: current.prefix, hint: 'Stands for the namespace in Turtle: m:element-…' },
        {
          name: 'rename',
          type: 'checkbox',
          label: 'Move the model\'s existing IRIs into the new namespace',
          value: true,
          hint: 'Otherwise only IRIs minted from now on use it.',
        },
      ],
      {
        confirmLabel: 'Apply',
        validate: (v) =>
          String(v['label']) ? app.namespaceProblem(String(v['namespace']), String(v['prefix'])) : 'The model needs a name.',
      },
    );
    if (!values) return;
    const label = String(values['label']);
    const namespace = ensureNamespace(String(values['namespace']));
    const prefix = String(values['prefix']);
    const rename = values['rename'] === true;
    if (label !== session.modelLabel()) session.renameModel(label);
    if (namespace !== current.namespace || prefix !== current.prefix || !current.declared) {
      if (
        rename &&
        namespace !== current.namespace &&
        app.collaborationRoom &&
        !(await dialogs.confirm(
          'Shared model',
          `This model is shared in room "${app.collaborationRoom}". Moving it to ${namespace} renames its IRIs for everyone in the room.`,
          { confirmLabel: 'Move' },
        ))
      ) {
        refreshToolbar();
        return;
      }
      const moved = app.setModelNamespace(namespace, { prefix, rename });
      report(moved > 0 ? `Moved ${moved} IRIs to ${namespace}.` : `Namespace set to ${namespace}.`);
    }
    refreshToolbar();
  };

  const runCommand = async (detail: ToolbarCommandDetail): Promise<void> => {
    const { command, value } = detail;
    try {
      switch (command) {
        case 'view-back':
          return travel('back');
        case 'view-forward':
          return travel('forward');
        case 'new-model': {
          if (!(await guardUnsaved('Start a new model'))) return;
          const values = await dialogs.form(
            'New model',
            [
              { name: 'label', label: 'Name', value: 'Untitled model' },
              {
                name: 'namespace',
                label: 'Namespace',
                value: app.suggestNamespace(),
                hint: 'Every IRI of the model is minted here. example.org is a placeholder; use your own domain to publish.',
              },
            ],
            {
              confirmLabel: 'Create',
              validate: (v) => app.namespaceProblem(String(v['namespace']), 'm'),
            },
          );
          if (!values) return;
          app.newModel(String(values['label'] || 'Untitled model'), { namespace: String(values['namespace']) });
          return;
        }
        case 'open-model': {
          if (!(await guardUnsaved('Open another model'))) return;
          const file = await pickFile(MODEL_FORMATS.map((f) => `.${f.extension}`).join(','));
          if (!file) return;
          await openModelText(file.text, file.name);
          return;
        }
        case 'import-archimate': {
          if (!(await guardUnsaved('Import'))) return;
          const file = await pickFile('.xml');
          if (!file) return;
          const result = await app.importArchiMate(file.text, file.name);
          report(
            `Imported ${result.elementCount} elements, ${result.relationshipCount} relationships, ${result.viewCount} views.`,
          );
          if (result.unrecognizedTypes.length > 0) {
            report(`Skipped unknown types: ${result.unrecognizedTypes.join(', ')}`, 'warning');
          }
          return;
        }
        case 'save':
          save('turtle');
          return;
        case 'save-as':
          save((value as ModelFormat) ?? 'turtle');
          return;
        case 'save-no-geometry':
          save('turtle', 'no-geometry');
          return;
        case 'export-svg': {
          const svg = exportSvg(diagramCanvas.toSvg());
          await saveFile(svg, `${(viewManager.getView?.(session.activeViewIri ?? '')?.label || 'view').replace(/[^\w.-]+/g, '-')}.svg`, 'image/svg+xml');
          return;
        }
        case 'export-png': {
          const png = await exportPng(exportSvg(diagramCanvas.toSvg()));
          await saveFile(png, `${(viewManager.getView?.(session.activeViewIri ?? '')?.label || 'view').replace(/[^\w.-]+/g, '-')}.png`, 'image/png');
          return;
        }
        case 'rename-model': {
          const name = await dialogs.prompt('Rename model', 'Model name', session.modelLabel());
          if (name) session.renameModel(name);
          refreshToolbar();
          return;
        }
        case 'model-settings':
          await editModelSettings();
          return;
        case 'open-view':
          if (value) session.openView(value);
          return;
        case 'new-view': {
          const kind = (value as ViewKind) ?? 'Diagram';
          const name = await dialogs.prompt(`New ${kind.toLowerCase()}`, 'Name', `New ${kind.toLowerCase()}`);
          if (name === null) return;
          // The metamodels expect every view to declare its viewpoint; offer
          // the choice up front (none is allowed, and settable later).
          const viewpoint = viewpointManager.getViewpoints().length > 0 ? await chooseViewpoint() : '';
          session.createView(kind, { label: name, ...(viewpoint ? { viewpointIri: viewpoint } : {}) });
          return;
        }
        case 'set-viewpoint':
          if (session.activeViewIri) session.setViewpoint(session.activeViewIri, value || undefined);
          return;
        case 'add-metamodel':
        case 'switch-metamodel': {
          if (!value) return;
          const loaded = await app.loadMetamodel(value, { replace: command === 'switch-metamodel' });
          const failed = loaded.assets.filter((a) => a.outcome === 'error' || a.outcome === 'unavailable');
          report(
            `Loaded ${loaded.info.name || value}` +
              (failed.length > 0 ? ` — ${failed.length} part(s) unavailable (see Show loaded assets)` : ''),
            failed.length > 0 ? 'warning' : 'info',
          );
          return;
        }
        case 'unload-metamodel':
          if (value) app.unloadMetamodel(value);
          return;
        case 'load-metamodel-iri': {
          const iri = await dialogs.prompt(
            'Load metamodel',
            'IRI of an arch:Metamodel (or its manifest)',
            'https://meta.linked.archi/',
          );
          if (!iri) return;
          return runCommand({ command: 'add-metamodel', value: iri });
        }
        case 'upload-asset': {
          const file = await pickFile('.ttl,.trig,.jsonld,.json,.rdf,.owl,.nt,.nq');
          if (!file) return;
          const result = await app.loadAssetFile(file.text, file.name);
          report(result.kind === 'metamodel' ? `Loaded metamodel ${result.iri}` : `Added ${result.iri}`);
          return;
        }
        case 'show-assets': {
          const lines: string[] = [];
          for (const m of app.loadedMetamodels()) {
            lines.push(`■ ${m.info.name || m.metamodelIri}`);
            for (const a of m.assets) {
              lines.push(`   ${a.outcome.padEnd(14)} ${a.role ?? ''} ${a.documentIri}${a.origin ? ` (${a.origin})` : ''}${a.quadCount ? ` · ${a.quadCount} triples` : ''}`);
            }
          }
          if (app.uploaded.list().length > 0) lines.push('■ Uploaded', ...app.uploaded.list().map((d) => `   ${d}`));
          await dialogs.info('Loaded semantic assets', lines.length > 0 ? lines : ['Nothing loaded.']);
          return;
        }
        case 'set-context':
          app.setPresentationContext(value || undefined);
          return;
        case 'share':
          eventBus.emit('collab-status', { request: 'share' });
          return;
        case 'module': {
          const [moduleId, ...entry] = (value ?? '').split(':');
          await moduleMenus.get(moduleId)?.run(entry.join(':'));
          return;
        }
        case 'settings':
        case 'modules':
          // From the Metamodels menu's "Choose which to show…": at that tab.
          await openSettings(typeof value === 'string' ? value : undefined);
          return;
        case 'toggle-explorer':
          setExplorerOpen(!shell.explorerOpen);
          return;
        case 'toggle-palette':
          setPaletteOpen(!shell.paletteOpen);
          return;
        case 'toggle-rdf':
          setRdfPanelOpen(!shell.rdfOpen);
          return;
        case 'undo':
        case 'redo': {
          const stack = (diagramCanvas.getDiagram() as unknown as { get(n: string): { undo(): void; redo(): void } } | null)?.get('commandStack');
          if (command === 'undo') stack?.undo();
          else stack?.redo();
          return;
        }
      }
    } catch (err: unknown) {
      report(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // ── EventBus → panels ────────────────────────────────────────────────
  const refreshGraphs = (): void => {
    const shapes = app.shapesGraph();
    propertyPanel.shapesGraph = shapes;
    validationPanel.shapesGraph = shapes;
    // Not the data graph: the panel shows the app's reports (`validation-updated`);
    // copying the model for it on every load cost seconds on a large model (Task 22).
  };

  /**
   * The Validation tab's view scope follows the open view — what it covers
   * changes with every edit, which validation follows — and the tab's badge
   * counts the violations of the scope shown, as the tab lists them.
   */
  const scopeValidation = (): void => {
    const viewIri = session.activeViewIri;
    validationPanel.viewIris = viewIri ? viewMembers(store, viewIri) : undefined;
    const violations = validationPanel.shownResults.filter((r) => r.severity === 'Violation').length;
    const { validation: _shown, ...others } = shell.tabBadges;
    shell.tabBadges = violations > 0 ? { ...others, validation: String(violations) } : others;
  };
  const onValidationScopeChange = (): void => scopeValidation();

  const onValidationUpdated: ModelEventHandler = (event) => {
    const detail = event.detail as { conforms?: boolean; results?: ValidationResult[] } | undefined;
    const results = detail?.results ?? [];
    validationPanel.conforms = detail?.conforms ?? true;
    validationPanel.results = results;
    validationPanel.validating = false;
    // The violations show on the Validation tab, which may not be the open one.
    scopeValidation();
    markViolations();
  };

  const onMetamodelLoaded: ModelEventHandler = (event) => {
    // The class hierarchy has just changed, so the closure indexes are stale.
    warmRelationshipTables();
    guides.clear();
    classClosure = buildClassClosure(store);
    closure = typeClosure(store);
    contentsIndex.invalidate();
    const metamodelIri = event.detail?.metamodelIri as string | undefined;
    if (metamodelIri || event.detail?.empty) {
      currentMetamodelIri = metamodelIri;
      regeneratePalette();
    }
    refreshGraphs();
    refreshToolbar();
    diagramCanvas.syncFromStore();
    // Another language's questions, or none.
    questionCache = undefined;
    validationPanel.checksAvailable = modelChecks().length;
  };

  /**
   * Read the relationship tables, permissions and proposal orders while the
   * browser is idle after a model or metamodel loads, rather than when a shape
   * is first selected and its context pad asks — on a large model, the first
   * drag froze for that (Task 22).
   */
  let warming: number | null = null;
  const warmRelationshipTables = (): void => {
    if (warming !== null) return;
    const idle = (globalThis as { requestIdleCallback?(fn: () => void, options?: { timeout: number }): number }).requestIdleCallback;
    const run = () => {
      warming = null;
      const manager = relationshipManager as unknown as Partial<Record<'relationshipTable' | 'directPermissions' | 'drawnPermissions' | 'proposalOrders', () => unknown>>;
      try {
        manager.relationshipTable?.();
        manager.directPermissions?.();
        manager.drawnPermissions?.();
        manager.proposalOrders?.();
      } catch (err: unknown) {
        console.warn('[la-gram] Reading the relationship tables failed', err);
      }
    };
    warming = idle ? idle(run, { timeout: 2000 }) : (setTimeout(run, 200) as unknown as number);
  };

  // ── Back and forward between views (the history is declared with the toolbar) ──
  const placeOnCanvas = (): ViewPlace => {
    const viewbox = diagramCanvas.viewport();
    return { ...(viewbox ? { viewbox } : {}), selection: diagramCanvas.selectedIris() };
  };
  /** Back or Forward: leave the open view where it is, and open the visit's view as it was left. */
  const travel = (direction: 'back' | 'forward'): void => {
    viewHistory.leave(placeOnCanvas());
    const visit = direction === 'back' ? viewHistory.back() : viewHistory.forward();
    if (!visit) return;
    travelling = visit;
    session.openView(visit.viewIri);
  };
  // Alt+← and Alt+→ — not in a text field, where they move by word, nor under a dialog.
  const onHistoryKey = (e: KeyboardEvent): void => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const target = e.composedPath?.()[0] as HTMLElement | undefined;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? ''))) return;
    if (document.querySelector('.la-dialog')) return;
    e.preventDefault();
    travel(e.key === 'ArrowLeft' ? 'back' : 'forward');
  };
  globalThis.addEventListener?.('keydown', onHistoryKey);

  const onModelLoaded: ModelEventHandler = () => {
    viewHistory.clear();
    shownViewIri = undefined;
    warmRelationshipTables();
    void refreshHistory();
    guides.clear();
    diagramCanvas.setModelIri(session.modelIri ?? DEFAULT_MODEL_IRI);
    refreshGraphs();
    showActiveView();
    // Nothing selected in another model: its open view is.
    selectTheView();
    // The findings are the last model's until this one's come — seconds on a
    // large model, where they read as this one's: none shown until then.
    if (app.validationPending?.() && app.shapesGraph().length > 0) {
      validationPanel.results = [];
      validationPanel.conforms = true;
      validationPanel.validating = true;
    }
    // The model checks were the last model's; its languages' are offered.
    validationPanel.checks = undefined;
    validationPanel.checksAvailable = modelChecks().length;
    scopeValidation();
    markViolations();
  };

  const onViewOpened: ModelEventHandler = () => {
    const viewIri = session.activeViewIri;
    const place = travelling?.viewIri === viewIri ? travelling?.place : undefined;
    if (!travelling) {
      if (shownViewIri && shownViewIri !== viewIri) viewHistory.leave(placeOnCanvas());
      if (viewIri) viewHistory.visit(viewIri);
    }
    travelling = undefined;
    shownViewIri = viewIri;
    showActiveView();
    // Back or Forward: the view as it was left.
    if (place) {
      if (place.viewbox) diagramCanvas.restoreViewport(place.viewbox);
      diagramCanvas.selectIris(place.selection ?? []);
    }
    // The RDF panel follows the open view (and draws the selection in it), as does the Validation tab.
    rdfPanel.scheduleRefresh();
    scopeValidation();
    // A view opened from a maximized panel (a new view from results, a
    // revealed concept) is what the user wants to see: put the panel back.
    shell.setBottomMaximized(false);
  };

  const onViewsChanged: ModelEventHandler = (event) => {
    // A re-pointed viewpoint on the open view changes what is greyed out.
    if (event.detail?.viewIri === session.activeViewIri) showActiveView();
    else refreshToolbar();
  };

  const onModelChanged: ModelEventHandler = (event) => {
    if (event.detail?.origin !== 'canvas') diagramCanvas.syncFromStore();
    propertyPanel.reload();
    // What is not committed yet, while the History tab shows it — and where the model is bound now (a merge rebinds it).
    if (historyShown && session.modelIri) {
      historyPanel.working = versionHistory.workingSnapshot();
      showGitHistory();
    }
    if (propertyPanel.selectedIri) {
      propertyPanel.heading = headingFor(propertyPanel.selectedIri);
      propertyPanel.analysis = analysisFor(propertyPanel.selectedIri);
      propertyPanel.typeChoices = typeChoicesFor(propertyPanel.heading);
      // A view's viewpoint may have changed — unless the guide shows a palette pick.
      if (!guideFromPalette) typeGuidePanel.guideIri = guideIriFor(propertyPanel.selectedIri);
    }
    appToolbar.dirty = app.isDirty();
    appToolbar.modelLabel = session.modelLabel();
  };

  const onElementDeleted: ModelEventHandler = (event) => {
    const iri = event.detail?.iri as string | undefined;
    if (iri && iri === propertyPanel.selectedIri && store.getQuads(namedNode(iri) as unknown as NamedNode).length === 0) {
      selectTheView();
    }
  };

  const onContextChanged: ModelEventHandler = () => {
    regeneratePalette();
    refreshToolbar();
  };

  const onSaved: ModelEventHandler = () => {
    refreshToolbar();
    // Saved to Git: a new commit to list.
    showGitHistory();
  };

  // Anything that changes the model changes the RDF text. The panel ignores
  // this while hidden and debounces it while shown.
  const onAnyModelChange: ModelEventHandler = () => {
    rdfPanel.scheduleRefresh();
    graphPanel.scheduleRefresh();
    if (!catalogView.hidden) catalogView.refresh();
    if (!matrixView.hidden) matrixView.refresh();
  };
  const RDF_REFRESH_EVENTS = [
    'model-changed',
    'model-loaded',
    'views-changed',
    'metamodel-loaded',
    'element-created',
    'element-deleted',
    'element-updated',
    'relationship-created',
    'relationship-deleted',
  ] as const;
  for (const type of RDF_REFRESH_EVENTS) eventBus.on(type, onAnyModelChange);
  const EDIT_EVENTS = [
    'model-changed',
    'views-changed',
    'element-created',
    'element-deleted',
    'element-updated',
    'relationship-created',
    'relationship-deleted',
  ] as const;
  for (const type of EDIT_EVENTS) eventBus.on(type, onEditAfterChecks);
  validationPanel.checksAvailable = modelChecks().length;

  eventBus.on('validation-updated', onValidationUpdated);
  eventBus.on('metamodel-loaded', onMetamodelLoaded);
  eventBus.on('model-loaded', onModelLoaded);
  eventBus.on('view-opened', onViewOpened);
  validationPanel.addEventListener('validation-scope-change', onValidationScopeChange);
  // The view open before these listeners: the first visit.
  if (session.activeViewIri) {
    viewHistory.visit(session.activeViewIri);
    shownViewIri = session.activeViewIri;
  }
  scopeValidation();
  eventBus.on('views-changed', onViewsChanged);
  eventBus.on('model-changed', onModelChanged);
  eventBus.on('selection-changed', onCanvasSelection);
  eventBus.on('element-deleted', onElementDeleted);
  eventBus.on('relationship-deleted', onElementDeleted);
  eventBus.on('presentation-context-changed', onContextChanged);
  eventBus.on('model-saved', onSaved);

  // The model the App started with.
  if (session.activeViewIri) showActiveView();
  else refreshToolbar();
  if (options.rdfOpen) setRdfPanelOpen(true);

  const refresh = (): void => {
    refreshGraphs();
    modelExplorer.refresh();
    diagramCanvas.syncFromStore();
    refreshToolbar();
  };

  const dispose = (): void => {
    if (iconRepair) clearTimeout(iconRepair);
    stopIndexing?.();
    canvasResize?.disconnect();
    eventBus.off('validation-updated', onValidationUpdated);
    eventBus.off('metamodel-loaded', onMetamodelLoaded);
    eventBus.off('model-loaded', onModelLoaded);
    eventBus.off('view-opened', onViewOpened);
    eventBus.off('views-changed', onViewsChanged);
    eventBus.off('model-changed', onModelChanged);
    eventBus.off('selection-changed', onCanvasSelection);
    eventBus.off('element-deleted', onElementDeleted);
    eventBus.off('relationship-deleted', onElementDeleted);
    eventBus.off('presentation-context-changed', onContextChanged);
    eventBus.off('model-saved', onSaved);
    for (const type of RDF_REFRESH_EVENTS) eventBus.off(type, onAnyModelChange);
    for (const type of EDIT_EVENTS) eventBus.off(type, onEditAfterChecks);
    rdfPanel.removeEventListener('rdf-download', onRdfDownload);
    rdfPanel.removeEventListener('rdf-select', onRdfSelect);
    rdfPanel.removeEventListener('rdf-close', onRdfClose);
    graphPanel.removeEventListener('graph-select', onGraphSelect);
    graphPanel.removeEventListener('graph-root', onGraphRoot);
    graphPanel.removeEventListener('graph-download', onGraphDownload);
    graphPanel.removeEventListener('graph-open-sparql', onGraphOpenSparql);
    graphPanel.removeEventListener('graph-new-view', onGraphNewView);
    shell.removeEventListener('guide-panel-changed', onGuidePanelChanged);
    shell.removeEventListener('rdf-panel-changed', onRdfPanelChanged);
    globalThis.removeEventListener?.('keydown', onHistoryKey);
    propertyPanel.removeEventListener('property-retype', onPropertyRetype);
    sparqlEditor.removeEventListener('results-view-request', onResultsViewRequest);
    sparqlEditor.removeEventListener('sparql-select', onSparqlSelect);
    shell.removeEventListener('bottom-panel-changed', onBottomPanelChanged);
    historyPanel.removeEventListener('history-commit', onHistoryCommit);
    historyPanel.removeEventListener('history-restore', onHistoryRestore);
    historyPanel.removeEventListener('diff-select', onDiffSelect);
    appToolbar.removeEventListener('toolbar-command', onToolbarCommand);
    palettePanel.removeEventListener('palette-axis-change', onAxisChange);
    palettePanel.removeEventListener('palette-drag-start', onPaletteDragStart);
    palettePanel.removeEventListener('palette-hover', onPaletteHover);
    clearTimeout(paletteHover);
    canvasToolbar.removeEventListener('toolbar-tool', onToolbarTool);
    canvasToolbar.removeEventListener('relationship-names', onRelationshipNames);
    modelExplorer.removeEventListener('explorer-select', onExplorerSelect);
    modelExplorer.removeEventListener('explorer-drag-start', onExplorerDrag);
    modelExplorer.removeEventListener('explorer-activate', onExplorerActivate);
    modelExplorer.removeEventListener('explorer-action', onExplorerAction);
    modelExplorer.removeEventListener('explorer-move', onExplorerMove);
    catalogView.removeEventListener('catalog-select', onCatalogSelect);
    catalogView.removeEventListener('view-members-change', onViewMembersChange);
    matrixView.removeEventListener('view-members-change', onViewMembersChange);
    validationPanel.removeEventListener('validation-navigate', onValidationNavigate);
    validationPanel.removeEventListener('validation-scope-change', onValidationScopeChange);
    validationPanel.removeEventListener('model-checks-request', onModelChecksEvent);
    propertyPanel.removeEventListener('property-edit', onPropertyEdit);
    propertyPanel.removeEventListener('property-add', onPropertyAdd);
    propertyPanel.removeEventListener('property-remove', onPropertyRemove);
    propertyPanel.removeEventListener('panel-navigate', onPanelNavigate);
    propertyPanel.removeEventListener('confirm-derivation', onConfirmDerivation);
    propertyPanel.removeEventListener('panel-open-view', onPanelOpenView);
    modelExplorer.eventBus = undefined;
    diagramCanvas.destroy();
    shell.remove();
  };

  return {
    shell,
    appToolbar,
    palettePanel,
    canvasToolbar,
    modelExplorer,
    propertyPanel,
    validationPanel,
    sparqlEditor,
    catalogView,
    matrixView,
    canvasHost,
    diagramCanvas,
    rdfPanel,
    graphPanel,
    historyPanel,
    typeGuidePanel,
    setRdfPanelOpen,
    isRdfPanelOpen: () => shell.rdfOpen,
    setExplorerOpen,
    isExplorerOpen: () => shell.explorerOpen,
    setPaletteOpen,
    isPaletteOpen: () => shell.paletteOpen,
    showBottomTab: (tab: BottomTab) => shell.showTab(tab),
    setActiveCanvasView,
    activeCanvasView: () => active,
    setPaletteAxis: (axisIri) => {
      currentAxisIri = axisIri;
      regeneratePalette();
    },
    selectConcept: (iri) => selectConcept(iri),
    runCommand,
    dialogs,
    report,
    confirmReplace: guardUnsaved,
    openModelText,
    addFileMenu,
    setModuleSwitches,
    addSettingsSection,
    addBottomTab,
    describeConcept: (iri) => validationPanel.describe?.(iri) ?? { name: labelOf(store, iri) },
    propertyName: (predicate) => fieldName(predicate, undefined, propertyPanel.nameOf),
    typeName: typeLabelOf,
    setGitHistory,
    refresh,
    dispose,
  };
}
