/**
 * The model being edited, and which of its views is open.
 *
 * The store can hold only one model's data at a time (its default graph — see
 * `model-queries.ts`), and exactly one view is on the canvas. This class owns
 * those two facts and the operations that change them: starting a new model,
 * adopting one that was just loaded, and creating, opening, renaming and
 * deleting views. It emits the events the UI re-renders from, and nothing
 * here touches the canvas directly.
 *
 * ```turtle
 * <model> a arch:Model ;
 *     skos:prefLabel "Order Platform"@en ;
 *     arch:modelConformsToMetamodel am4mm:ArchiMate4 ;
 *     dcterms:created "2026-09-25T…"^^xsd:dateTime .
 * ```
 */

import type { Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { DEFAULT_MODEL_BASE, mintModelIri, notationSlug } from '../rdf-engine/iri.js';
import type { ElementManager, RelationshipManager, ViewKind, ViewManager } from './interfaces.js';
import { migrateLegacyModel, type MigrationReport } from './legacy-migration.js';
import { classify, findModelIri, labelOf, modelQuads, typeClosure } from './model-queries.js';
import { IRI, T, dateTimeLiteral, langLiteral, nn, triple } from './vocabulary.js';

/** The slice of the event bus the session needs; structural so it stays UI-free. */
export interface SessionEvents {
  emit(type: string, detail?: Record<string, unknown>): void;
}

/** Name given to the view every new model starts with. */
export const DEFAULT_VIEW_LABEL = 'Default View';

/** Grid used when laying out a model that arrived with no geometry at all. */
const AUTO_LAYOUT = { columns: 6, dx: 170, dy: 100, x0: 40, y0: 40, width: 140, height: 60 };

/** Result of {@link ModelSession.adopt}. */
export interface AdoptResult {
  modelIri: string;
  viewIri: string;
  migration: MigrationReport;
  /** Elements placed by the automatic layout (0 when the model had geometry). */
  autoPlaced: number;
}

export class ModelSession {
  private currentModel: string | undefined;
  private currentView: string | undefined;

  constructor(
    private readonly store: RdfStore,
    private readonly elements: ElementManager,
    private readonly views: ViewManager,
    private readonly events?: SessionEvents,
    private readonly options: { base?: string; relationships?: RelationshipManager } = {},
  ) {}

  /** IRI of the `arch:Model` being edited. */
  get modelIri(): string | undefined {
    return this.currentModel;
  }

  /** IRI of the view on the canvas. */
  get activeViewIri(): string | undefined {
    return this.currentView;
  }

  /** The model's label, or a placeholder. */
  modelLabel(): string {
    return this.currentModel ? labelOf(this.store, this.currentModel) : 'Untitled model';
  }

  /** The metamodels the model declares conformance to. */
  metamodelIris(): string[] {
    if (!this.currentModel) return [];
    return this.store.getQuads(nn(this.currentModel), T.modelConformsToMetamodel).map((q) => q.object.value);
  }

  // ── Model lifecycle ────────────────────────────────────────────────────

  /** Remove every quad of the model data. Metamodel graphs are untouched. */
  clearModelData(): void {
    const quads = modelQuads(this.store);
    if (quads.length > 0) this.store.removeQuads(quads);
    this.currentModel = undefined;
    this.currentView = undefined;
  }

  /**
   * Start a fresh model with one empty diagram view.
   *
   * @param options.metamodelIris Conformance statements to write.
   * @param options.base IRI base; `urn:la-gram:` unless configured.
   */
  newModel(options: { label?: string; metamodelIris?: string[]; base?: string } = {}): {
    modelIri: string;
    viewIri: string;
  } {
    this.clearModelData();
    const metamodels = options.metamodelIris ?? [];
    const modelIri = mintModelIri(options.base ?? this.options.base ?? DEFAULT_MODEL_BASE, notationSlug(metamodels[0]));
    const model = nn(modelIri);
    const quads: Quad[] = [
      triple(model, T.rdfType, T.Model),
      triple(model, T.prefLabel, langLiteral(options.label?.trim() || 'Untitled model')),
      triple(model, nn(IRI.dctermsCreated), dateTimeLiteral()),
      ...metamodels.map((mm) => triple(model, T.modelConformsToMetamodel, nn(mm))),
    ];
    this.store.addQuads(quads);
    this.currentModel = modelIri;
    const viewIri = this.views.createView('Diagram', undefined, { label: DEFAULT_VIEW_LABEL, modelIri }).value;
    this.currentView = viewIri;
    this.events?.emit('model-loaded', { modelIri, viewIri, fresh: true });
    this.events?.emit('view-opened', { viewIri });
    return { modelIri, viewIri };
  }

  /**
   * Take ownership of model data that was just put into the store (a file, an
   * import, a collaboration room).
   *
   * Migrates retired vocabulary, makes sure there is an `arch:Model` and that
   * every concept names it, makes sure there is a view to open, and — when the
   * data carries no geometry at all — lays the elements out in a grid so the
   * model is not an empty canvas.
   */
  adopt(options: { fallbackLabel?: string; metamodelIris?: string[]; emit?: boolean } = {}): AdoptResult {
    let modelIri = findModelIri(this.store);
    let defaultView: string | undefined;
    const ensureDefaultView = (): string => {
      if (!defaultView) {
        defaultView =
          this.views.getViews().find((v) => v.type === 'Diagram')?.iri ??
          this.views.createView('Diagram', undefined, {
            label: DEFAULT_VIEW_LABEL,
            ...(modelIri ? { modelIri } : {}),
          }).value;
      }
      return defaultView;
    };

    if (!modelIri) {
      modelIri = mintModelIri(this.options.base ?? DEFAULT_MODEL_BASE, notationSlug(options.metamodelIris?.[0]));
      const model = nn(modelIri);
      this.store.addQuads([
        triple(model, T.rdfType, T.Model),
        triple(model, T.prefLabel, langLiteral(options.fallbackLabel?.trim() || 'Imported model')),
        ...(options.metamodelIris ?? []).map((mm) => triple(model, T.modelConformsToMetamodel, nn(mm))),
      ]);
    }
    this.currentModel = modelIri;

    const migration = migrateLegacyModel(this.store, { viewManager: this.views, defaultView: ensureDefaultView });
    this.ensureMembership(modelIri);

    // A view to open: the first diagram, else a new one.
    const viewIri = ensureDefaultView();
    const autoPlaced = this.autoLayoutIfNoGeometry(viewIri);

    this.currentView = viewIri;
    if (options.emit !== false) {
      this.events?.emit('model-loaded', { modelIri, viewIri });
      this.events?.emit('view-opened', { viewIri });
    }
    return { modelIri, viewIri, migration, autoPlaced };
  }

  /** Rename the model. */
  renameModel(label: string): void {
    if (!this.currentModel || !label.trim()) return;
    const model = nn(this.currentModel);
    const stale = this.store.getQuads(model, T.prefLabel);
    if (stale.length > 0) this.store.removeQuads(stale);
    this.store.addQuads([triple(model, T.prefLabel, langLiteral(label.trim()))]);
    this.touch();
    this.events?.emit('model-changed', { renamed: true });
  }

  /** Replace the model's metamodel conformance statements. */
  setMetamodels(metamodelIris: string[]): void {
    if (!this.currentModel) return;
    const model = nn(this.currentModel);
    const stale = this.store.getQuads(model, T.modelConformsToMetamodel);
    if (stale.length > 0) this.store.removeQuads(stale);
    this.store.addQuads(metamodelIris.map((mm) => triple(model, T.modelConformsToMetamodel, nn(mm))));
  }

  // ── Views ──────────────────────────────────────────────────────────────

  /** Put a view on the canvas. */
  openView(viewIri: string): void {
    if (!this.views.getView(viewIri)) return;
    this.currentView = viewIri;
    this.events?.emit('view-opened', { viewIri });
  }

  /** The open view, or the first diagram, or a new one — always something. */
  ensureView(): string {
    if (this.currentView && this.views.getView(this.currentView)) return this.currentView;
    const first = this.views.getViews().find((v) => v.type === 'Diagram');
    const viewIri =
      first?.iri ??
      this.views.createView('Diagram', undefined, {
        label: DEFAULT_VIEW_LABEL,
        ...(this.currentModel ? { modelIri: this.currentModel } : {}),
      }).value;
    this.currentView = viewIri;
    return viewIri;
  }

  createView(kind: ViewKind, options: { label?: string; viewpointIri?: string; open?: boolean } = {}): string {
    const viewIri = this.views.createView(kind, options.viewpointIri, {
      label: options.label?.trim() || `New ${kind.toLowerCase()}`,
      ...(this.currentModel ? { modelIri: this.currentModel } : {}),
    }).value;
    this.events?.emit('views-changed', { viewIri });
    if (options.open !== false) this.openView(viewIri);
    return viewIri;
  }

  renameView(viewIri: string, label: string): void {
    this.views.renameView(viewIri, label);
    this.events?.emit('views-changed', { viewIri });
  }

  setViewpoint(viewIri: string, viewpointIri: string | undefined): void {
    this.views.setViewpoint(viewIri, viewpointIri);
    this.events?.emit('views-changed', { viewIri });
  }

  duplicateView(viewIri: string): string {
    const copy = this.views.duplicateView(viewIri).value;
    this.events?.emit('views-changed', { viewIri: copy });
    return copy;
  }

  /** Delete a view; its concepts stay in the model. Opens another if it was open. */
  deleteView(viewIri: string): void {
    this.views.deleteView(viewIri);
    this.events?.emit('views-changed', { viewIri });
    if (this.currentView === viewIri) {
      this.currentView = undefined;
      this.openView(this.ensureView());
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** Stamp `dcterms:modified`. */
  private touch(): void {
    if (!this.currentModel) return;
    const model = nn(this.currentModel);
    const stale = this.store.getQuads(model, nn(IRI.dctermsModified));
    if (stale.length > 0) this.store.removeQuads(stale);
    this.store.addQuads([triple(model, nn(IRI.dctermsModified), dateTimeLiteral())]);
  }

  /**
   * Every element, relationship and view names its model (DD-15: membership is
   * asserted, not implied by the graph). Data from another tool often omits it.
   */
  private ensureMembership(modelIri: string): void {
    const closure = typeClosure(this.store);
    const typesOf = new Map<string, string[]>();
    const members = new Set<string>();
    for (const q of modelQuads(this.store)) {
      if (q.subject.termType !== 'NamedNode') continue;
      if (q.predicate.value === IRI.rdfType) {
        const list = typesOf.get(q.subject.value) ?? [];
        list.push(q.object.value);
        typesOf.set(q.subject.value, list);
      } else if (q.predicate.value === IRI.inModel) {
        members.add(q.subject.value);
      }
    }
    const add: Quad[] = [];
    const model = nn(modelIri);
    for (const [iri, types] of typesOf) {
      if (members.has(iri)) continue;
      const kind = classify(types, closure, false);
      if (kind === 'element' || kind === 'relationship' || kind === 'view' || kind === 'unclassified') {
        add.push(triple(nn(iri), T.inModel, model));
      }
    }
    if (add.length > 0) this.store.addQuads(add);
  }

  /**
   * When no view in the model has any geometry, place every element in a grid
   * in `viewIri` (grouped by type), and draw every relationship between them.
   */
  private autoLayoutIfNoGeometry(viewIri: string): number {
    const anyGeometry =
      this.store.getQuads(null, T.rdfType, T.ArchNode).some((q) => q.graph.termType === 'DefaultGraph');
    if (anyGeometry) return 0;

    const closure = typeClosure(this.store);
    const elements: Array<{ iri: string; type: string }> = [];
    const typesOf = new Map<string, string[]>();
    for (const q of modelQuads(this.store)) {
      if (q.predicate.value !== IRI.rdfType || q.subject.termType !== 'NamedNode') continue;
      const list = typesOf.get(q.subject.value) ?? [];
      list.push(q.object.value);
      typesOf.set(q.subject.value, list);
    }
    for (const [iri, types] of typesOf) {
      const kind = classify(types, closure, true);
      if (kind === 'element' || kind === 'unclassified') elements.push({ iri, type: types[0] });
    }
    elements.sort((a, b) => a.type.localeCompare(b.type) || labelOf(this.store, a.iri).localeCompare(labelOf(this.store, b.iri)));

    elements.forEach(({ iri }, i) => {
      const col = i % AUTO_LAYOUT.columns;
      const row = Math.floor(i / AUTO_LAYOUT.columns);
      this.views.addElementToView(viewIri, iri, {
        x: AUTO_LAYOUT.x0 + col * AUTO_LAYOUT.dx,
        y: AUTO_LAYOUT.y0 + row * AUTO_LAYOUT.dy,
        width: AUTO_LAYOUT.width,
        height: AUTO_LAYOUT.height,
      });
    });
    if (elements.length > 0) this.linkAllPlaced(viewIri);
    return elements.length;
  }

  /** Draw every qualified relationship whose two ends are placed in the view. */
  linkAllPlaced(viewIri: string): number {
    let drawn = 0;
    for (const q of this.store.getQuads(null, T.source, null)) {
      if (q.graph.termType !== 'DefaultGraph') continue;
      if (this.views.addRelationshipToView(viewIri, q.subject.value)) drawn += 1;
    }
    return drawn;
  }

  /** The element manager, for callers that received the session only. */
  get elementManager(): ElementManager {
    return this.elements;
  }
}
