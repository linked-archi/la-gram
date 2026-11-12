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
 * m:model a arch:Model ;
 *     skos:prefLabel "Order Platform"@en ;
 *     vann:preferredNamespacePrefix "m" ;
 *     vann:preferredNamespaceUri "https://example.org/archimate/3f2c…/" ;
 *     arch:modelConformsToMetamodel am4mm:ArchiMate4 ;
 *     dcterms:created "2026-09-25T…"^^xsd:dateTime .
 * ```
 *
 * The namespace is where every IRI of the model is minted (see
 * `model-namespace.ts`); a new model gets one under the configured base,
 * `https://example.org/` by default.
 */

import type { Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { DEFAULT_MODEL_BASE, ensureNamespace, mintModelNamespace, modelIriIn, notationSlug } from '../rdf-engine/iri.js';
import type { Bounds, ElementManager, RelationshipManager, ViewKind, ViewManager } from './interfaces.js';
import { migrateLegacyModel, type MigrationReport } from './legacy-migration.js';
import { addRelationshipsToView } from './view-manager.js';
import { classify, findModelIri, labelOf, modelQuads, typeClosure } from './model-queries.js';
import {
  DEFAULT_MODEL_PREFIX,
  declaredNamespaceQuads,
  namespaceQuads,
  planNamespaceChange,
  readModelNamespace,
  type ModelNamespace,
} from './model-namespace.js';
import { IRI, T, dateTimeLiteral, langLiteral, nn, triple, tripleTerm } from './vocabulary.js';
import type { NamedNode } from '@rdfjs/types';

/** The default graph: the model. */
const MODEL_GRAPH = { termType: 'DefaultGraph', value: '' } as unknown as NamedNode;
import { isQualifiedPredicate, qualifiedFormOf, relationshipClassOf, unqualifiedFormOf } from './cascade.js';
import { certaintyNamed, isCertaintyPredicate, isLedTo } from './derivations.js';
import { AUTO_LAYOUT } from './grid.js';

/** The slice of the event bus the session needs; structural so it stays UI-free. */
export interface SessionEvents {
  emit(type: string, detail?: Record<string, unknown>): void;
}

/** Name given to the view every new model starts with. */
export const DEFAULT_VIEW_LABEL = 'Default View';


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
  /** The model's namespace when it was last looked at — kept to follow a remote rename. */
  private currentNamespace: string | undefined;

  constructor(
    private readonly store: RdfStore,
    private readonly elements: ElementManager,
    private readonly views: ViewManager,
    private readonly events?: SessionEvents,
    private readonly options: { base?: string; relationships?: RelationshipManager } = {},
  ) {}

  /** Base new models are minted under; `https://example.org/` unless configured. */
  get base(): string {
    return this.options.base ?? DEFAULT_MODEL_BASE;
  }

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

  /** The model's namespace and prefix (what `m:` stands for). */
  namespace(): ModelNamespace | undefined {
    return this.currentModel ? readModelNamespace(this.store, this.currentModel) : undefined;
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
    this.currentNamespace = undefined;
  }

  /**
   * Start a fresh model with one empty diagram view.
   *
   * @param options.metamodelIris Conformance statements to write.
   * @param options.namespace The model's namespace; minted under `base` when omitted.
   * @param options.base Base to mint the namespace under; the session's otherwise.
   * @param options.prefix Prefix for the namespace, `m` by default.
   */
  newModel(
    options: { label?: string; metamodelIris?: string[]; base?: string; namespace?: string; prefix?: string } = {},
  ): {
    modelIri: string;
    viewIri: string;
  } {
    this.clearModelData();
    const metamodels = options.metamodelIris ?? [];
    const namespace = options.namespace?.trim()
      ? ensureNamespace(options.namespace)
      : mintModelNamespace(options.base ?? this.base, notationSlug(metamodels[0]));
    const modelIri = modelIriIn(namespace);
    const model = nn(modelIri);
    const quads: Quad[] = [
      triple(model, T.rdfType, T.Model),
      triple(model, T.prefLabel, langLiteral(options.label?.trim() || 'Untitled model')),
      ...namespaceQuads(modelIri, namespace, options.prefix?.trim() || DEFAULT_MODEL_PREFIX),
      triple(model, nn(IRI.dctermsCreated), dateTimeLiteral()),
      ...metamodels.map((mm) => triple(model, T.modelConformsToMetamodel, nn(mm))),
    ];
    this.store.addQuads(quads);
    this.currentModel = modelIri;
    this.currentNamespace = namespace;
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
      const namespace = mintModelNamespace(this.base, notationSlug(options.metamodelIris?.[0]));
      modelIri = modelIriIn(namespace);
      const model = nn(modelIri);
      this.store.addQuads([
        triple(model, T.rdfType, T.Model),
        triple(model, T.prefLabel, langLiteral(options.fallbackLabel?.trim() || 'Imported model')),
        ...namespaceQuads(modelIri, namespace),
        ...(options.metamodelIris ?? []).map((mm) => triple(model, T.modelConformsToMetamodel, nn(mm))),
      ]);
    }
    this.currentModel = modelIri;
    this.currentNamespace = readModelNamespace(this.store, modelIri).namespace;

    const migration = migrateLegacyModel(this.store, { viewManager: this.views, defaultView: ensureDefaultView });
    // Before the repairs: the `rdf:reifies` they give an older relationship does not make it one.
    const unstated = this.unstated();
    this.ensureMembership(modelIri, unstated);
    this.ensureReifies();
    this.ensureQualifiedPointers(unstated);

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

  /**
   * Set the model's namespace (and prefix).
   *
   * With `rename` (the default) the model's existing IRIs move into the new
   * namespace — see {@link planNamespaceChange} — and the canvas re-opens the
   * same view under its new IRI. Without it only IRIs minted from now on use
   * the new namespace. Either way it is one store change, so collaborators
   * receive it as one update and follow it ({@link resync}).
   *
   * @returns The IRIs that changed, old → new.
   */
  setNamespace(namespace: string, options: { prefix?: string; rename?: boolean } = {}): Map<string, string> {
    const modelIri = this.currentModel;
    if (!modelIri) return new Map();
    const current = readModelNamespace(this.store, modelIri);
    const target = ensureNamespace(namespace);
    const prefix = options.prefix?.trim() || current.prefix;
    const plan =
      options.rename === false
        ? { mapping: new Map<string, string>(), remove: [], add: [] }
        : planNamespaceChange(this.store, modelIri, current.namespace, target);
    const nextModel = plan.mapping.get(modelIri) ?? modelIri;
    const stale = declaredNamespaceQuads(this.store, modelIri);
    const unchanged = plan.mapping.size === 0 && current.declared && current.namespace === target && current.prefix === prefix;
    if (unchanged) return plan.mapping;

    this.batch(() => {
      const removed = [...stale, ...plan.remove];
      if (removed.length > 0) this.store.removeQuads(removed);
      this.store.addQuads([...plan.add, ...namespaceQuads(nextModel, target, prefix)]);
      this.currentModel = nextModel;
      this.touch();
    });
    this.currentNamespace = target;
    const nextView = this.currentView ? plan.mapping.get(this.currentView) : undefined;
    if (nextView) this.currentView = nextView;

    if (plan.mapping.size > 0) {
      // Every IRI on the canvas may have changed: re-open the view.
      this.events?.emit('model-loaded', { modelIri: nextModel, viewIri: this.currentView, renamed: true });
    }
    this.events?.emit('model-changed', { namespace: target });
    return plan.mapping;
  }

  /**
   * Follow a change made elsewhere (a collaborator) that replaced the model
   * resource — a namespace change, or a new model. Re-points the session at the
   * model now in the store and at the same view under its new IRI when there is
   * one, then emits `model-loaded`.
   *
   * @returns Whether anything was re-pointed.
   */
  resync(): boolean {
    const modelIri = this.currentModel;
    if (!modelIri) return false;
    const stillThere = this.store
      .getQuads(nn(modelIri), T.rdfType, T.Model)
      .some((q) => q.graph.termType === 'DefaultGraph');
    if (stillThere) return false;
    const next = findModelIri(this.store);
    if (!next) return false;

    const namespace = readModelNamespace(this.store, next).namespace;
    const previous = this.currentNamespace;
    let view: string | undefined;
    if (this.currentView && previous && this.currentView.startsWith(previous)) {
      const local = this.currentView.slice(previous.length);
      view = [`${namespace}${local.replace(/\//g, '-')}`, `${namespace}${local}`].find((iri) => this.views.getView(iri));
    }
    this.currentModel = next;
    this.currentNamespace = namespace;
    this.currentView = view ?? this.views.getViews().find((v) => v.type === 'Diagram')?.iri ?? this.views.getViews()[0]?.iri;
    this.events?.emit('model-loaded', { modelIri: next, viewIri: this.currentView, remote: true });
    return true;
  }

  /**
   * Replace the model's metamodel conformance statements — while the model is
   * there: a file being opened has replaced it already, and the metamodels the
   * file declares are loaded before it is adopted, so writing them for the
   * model being left would put a statement about it among the file's triples,
   * saved with them.
   */
  setMetamodels(metamodelIris: string[]): void {
    if (!this.currentModel) return;
    const model = nn(this.currentModel);
    if (this.store.getQuads(model, T.rdfType, T.Model).length === 0) return;
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

  createView(kind: ViewKind, options: { label?: string; viewpointIri?: string; open?: boolean; folderIri?: string } = {}): string {
    let viewIri = '';
    // Made and filed in its folder (Req 10.16) as one change, which collaborators receive as one update.
    this.batch(() => {
      viewIri = this.views.createView(kind, options.viewpointIri, {
        label: options.label?.trim() || `New ${kind.toLowerCase()}`,
        ...(this.currentModel ? { modelIri: this.currentModel } : {}),
      }).value;
      if (options.folderIri) this.store.addQuads([triple(nn(viewIri), T.dctermsIsPartOf, nn(options.folderIri))]);
    });
    this.events?.emit('views-changed', { viewIri });
    if (options.open !== false) this.openView(viewIri);
    return viewIri;
  }

  /**
   * A new diagram showing these elements, where given, and the relationships
   * among them, following `viewpointIri` when given — one change for
   * collaborators; opened unless `open` is false.
   */
  createViewWith(
    label: string,
    nodes: ReadonlyArray<{ iri: string; bounds: Bounds }>,
    relationships: readonly string[],
    options: { open?: boolean; viewpointIri?: string } = {},
  ): string {
    let viewIri = '';
    this.batch(() => {
      viewIri = this.views.createView('Diagram', options.viewpointIri, {
        label: label.trim() || 'New diagram',
        ...(this.currentModel ? { modelIri: this.currentModel } : {}),
      }).value;
      for (const node of nodes) this.views.addElementToView(viewIri, node.iri, node.bounds);
      addRelationshipsToView(this.views, viewIri, relationships);
      this.touch();
    });
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
  /** One change notification for `fn`'s edits, when the store can batch. */
  private batch(fn: () => void): void {
    const batching = this.store as RdfStore & { batch?: <R>(f: () => R) => R };
    if (typeof batching.batch === 'function') batching.batch(fn);
    else fn();
  }

  private touch(): void {
    if (!this.currentModel) return;
    const model = nn(this.currentModel);
    const stale = this.store.getQuads(model, nn(IRI.dctermsModified));
    if (stale.length > 0) this.store.removeQuads(stale);
    this.store.addQuads([triple(model, nn(IRI.dctermsModified), dateTimeLiteral())]);
  }

  /**
   * The resources that are propositions, not relationships of the model (core's
   * `arch:QualifiedRelationship`): each reifies a triple the model does not
   * assert, with no qualified predicate leading to it — a potential derivation,
   * until a modeller confirms it. Loading leaves them as they are: a qualified
   * predicate leading to one is half of confirming it.
   */
  private propositions(): Set<string> {
    const found = new Set<string>();
    const model = MODEL_GRAPH;
    for (const q of this.store.getQuads(null, T.reifies, null, model)) {
      if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'Quad') continue;
      const { subject, predicate, object } = q.object as unknown as Quad;
      if (this.store.getQuads(subject as NamedNode, predicate as NamedNode, object as NamedNode, model).length > 0) continue;
      const incoming = this.store.getQuads(null, null, nn(q.subject.value), model);
      if (incoming.some((p) => isQualifiedPredicate(this.store, p.predicate.value))) continue;
      found.add(q.subject.value);
    }
    return found;
  }

  /**
   * The resources that are not relationships the model states: its
   * propositions; its valid derivations, which hold but which nobody stated; and
   * its potential derivations no qualified predicate leads to, though another
   * derivation of the same triple was confirmed (`derivations.ts`). A potential
   * derivation a modeller confirmed is stated.
   */
  private unstated(): Set<string> {
    const found = this.propositions();
    for (const q of this.store.getQuads(null, null, null, MODEL_GRAPH)) {
      if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode' || !isCertaintyPredicate(q.predicate.value)) continue;
      const certainty = certaintyNamed(q.object.value);
      if (certainty === 'valid' || (certainty === 'potential' && !isLedTo(this.store, q.subject.value))) found.add(q.subject.value);
    }
    return found;
  }

  /**
   * Every element, relationship and view names its model (DD-15: membership is
   * asserted, not implied by the graph). Data from another tool often omits it.
   * A derivation the model does not state gets none: it is not part of what was
   * modelled.
   */
  private ensureMembership(modelIri: string, unstated: ReadonlySet<string>): void {
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
      if (members.has(iri) || unstated.has(iri)) continue;
      const kind = classify(types, closure, false);
      if (kind === 'element' || kind === 'relationship' || kind === 'view' || kind === 'unclassified') {
        add.push(triple(nn(iri), T.inModel, model));
      }
    }
    if (add.length > 0) this.store.addQuads(add);
  }

  /**
   * Give every qualified relationship the `rdf:reifies` of the unqualified
   * triple its class maps to (the core's pattern, RDF 1.2), where it has none —
   * a model saved before la-gram wrote it, or made by another tool. A
   * relationship whose class has no `arch:unqualifiedForm` stands for no triple
   * and gets none.
   *
   * And one whose triple term names other ends than the relationship's own
   * `arch:source` and `arch:target` is made to name them again, its predicate
   * kept: a namespace change before it rewrote triple terms moved every IRI of
   * the model but those, leaving the relationship reifying a triple of IRIs the
   * model no longer has.
   */
  private ensureReifies(): void {
    const add: Quad[] = [];
    const remove: Quad[] = [];
    // The model's relationships, by index in the model graph (Task 22).
    const model = MODEL_GRAPH;
    for (const q of this.store.getQuads(null, T.source, null, model)) {
      if (q.subject.termType !== 'NamedNode') continue;
      const rel = q.subject.value;
      const target = this.store.getQuads(nn(rel), T.target, null, model)[0]?.object;
      const ends = q.object.termType === 'NamedNode' && target?.termType === 'NamedNode';
      const reifies = this.store.getQuads(nn(rel), T.reifies, null, model);
      if (reifies.length > 0) {
        for (const r of reifies) {
          if (!ends || r.object.termType !== 'Quad') continue;
          const term = r.object as unknown as Quad;
          if (term.subject.value === q.object.value && term.object.value === target!.value) continue;
          remove.push(r);
          add.push(triple(nn(rel), T.reifies, tripleTerm(nn(q.object.value), term.predicate, nn(target!.value))));
        }
        continue;
      }
      const classIri = relationshipClassOf(this.store, rel);
      const predicate = classIri ? unqualifiedFormOf(this.store, classIri) : undefined;
      if (!ends || !predicate) continue;
      add.push(triple(nn(rel), T.reifies, tripleTerm(nn(q.object.value), nn(predicate), nn(target!.value))));
    }
    if (remove.length > 0) this.store.removeQuads(remove);
    if (add.length > 0) this.store.addQuads(add);
  }

  /**
   * Give every qualified relationship the qualified predicate leading to it
   * from its source (`am4:qualifiedServing`, else core's
   * `arch:hasQualifiedRelationship`), where it has none — a model saved before
   * la-gram wrote it, or made by another tool. One it has, of whichever
   * predicate, is kept. A derivation the model does not state gets none: for a
   * potential one, that would be half of confirming it.
   */
  private ensureQualifiedPointers(unstated: ReadonlySet<string>): void {
    const add: Quad[] = [];
    const formOf = new Map<string, string>();
    const qualified = new Map<string, boolean>();
    const isQualified = (predicate: string): boolean => {
      if (!qualified.has(predicate)) qualified.set(predicate, isQualifiedPredicate(this.store, predicate));
      return qualified.get(predicate)!;
    };
    // The model's relationships, by index in the model graph (Task 22).
    const model = MODEL_GRAPH;
    for (const q of this.store.getQuads(null, T.source, null, model)) {
      if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
      const rel = q.subject.value;
      if (unstated.has(rel)) continue;
      if (this.store.getQuads(nn(q.object.value), null, nn(rel), model).some((p) => isQualified(p.predicate.value))) continue;
      const classIri = relationshipClassOf(this.store, rel) ?? IRI.QualifiedRelationship;
      if (!formOf.has(classIri)) formOf.set(classIri, qualifiedFormOf(this.store, classIri));
      add.push(triple(nn(q.object.value), nn(formOf.get(classIri)!), nn(rel)));
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

  /**
   * Draw every relationship the model states whose two ends are placed in the
   * view. A derivation it does not state is drawn only when asked for.
   */
  linkAllPlaced(viewIri: string): number {
    const unstated = this.unstated();
    const stated = this.store
      .getQuads(null, T.source, null)
      .filter((q) => q.graph.termType === 'DefaultGraph' && !unstated.has(q.subject.value))
      .map((q) => q.subject.value);
    // In passes: a relationship ending on another is drawn once that one is.
    return addRelationshipsToView(this.views, viewIri, stated);
  }

  /** The element manager, for callers that received the session only. */
  get elementManager(): ElementManager {
    return this.elements;
  }
}
