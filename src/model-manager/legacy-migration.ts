/**
 * Bring a loaded model up to the current vocabulary.
 *
 * Models in the wild predate `core` 0.4.0 and the view layer this tool now
 * writes. Rather than reason over old terms forever, loading rewrites them once,
 * in the default graph only (metamodel graphs are never touched):
 *
 * | Old                                   | Current                                   |
 * |---------------------------------------|-------------------------------------------|
 * | `arch:partOfModel`                    | `arch:inModel` (DD-30)                    |
 * | `arch:exposedInView`                  | `arch:inView` (DD-30)                     |
 * | `<model> arch:contains <view>`        | `<view> arch:inModel <model>` (DD-30)     |
 * | `arch:conformsToMetamodel`            | `arch:modelConformsToMetamodel`           |
 * | `<view> arch:viewpoint <vp>`          | `<view> arch:viewConformsToViewpoint <vp>`|
 * | `arch:relSource` / `relTarget`        | `arch:source` / `arch:target`             |
 * | `arch:relPredicate <p>`               | `rdf:type` the class mapped to `p`, plus the unqualified triple |
 * | bounds on the element itself (la-gram ≤ 0.1) | an `arch-vis:ArchNode` in a view   |
 * | `<element> arch-vis:view <view>` (la-gram ≤ 0.1) | a node in that view           |
 *
 * `arch:contains` is not declared a sub- or inverse property of anything in
 * 0.4.0 (DD-30 explains why no sound mapping exists in general), so it is only
 * rewritten in the one shape a model-to-view link can take.
 */

import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import type { Bounds, ViewManager } from './interfaces.js';
import { typeClosure } from './model-queries.js';

/** The default graph: the model. */
const MODEL_GRAPH = { termType: 'DefaultGraph', value: '' } as unknown as NamedNode;
import { IRI, T, nn, numberOf, triple } from './vocabulary.js';

/** What a migration changed. */
export interface MigrationReport {
  /** Triples rewritten from a retired predicate to its replacement. */
  renamed: number;
  /** Qualified relationships moved to `arch:source` / `arch:target`. */
  relationships: number;
  /** Element-level bounds turned into view nodes. */
  placements: number;
  /** Things the migration could not do, for the user. */
  notes: string[];
}

/** Straight predicate renames: old → new. */
const RENAMES: ReadonlyArray<[string, string]> = [
  [IRI.legacyPartOfModel, IRI.inModel],
  [IRI.legacyExposedInView, IRI.inView],
  [IRI.legacyConformsToMetamodel, IRI.modelConformsToMetamodel],
  [IRI.legacyRelSource, IRI.source],
  [IRI.legacyRelTarget, IRI.target],
];

/**
 * Rewrite retired vocabulary in the model data.
 *
 * @param options.viewManager Used to create nodes for element-level bounds.
 * @param options.defaultView Returns the view such bounds go into, creating it
 *   if need be. Called at most once.
 */
export function migrateLegacyModel(
  store: RdfStore,
  options: { viewManager?: ViewManager; defaultView?: () => string } = {},
): MigrationReport {
  const report: MigrationReport = { renamed: 0, relationships: 0, placements: 0, notes: [] };
  const add: Quad[] = [];
  const remove: Quad[] = [];
  // The model's statements with a predicate, by index — not the model scanned
  // for each kind, on every opening (Task 22).
  const withPredicate = (predicate: string) => store.getQuads(null, nn(predicate), null, MODEL_GRAPH);

  // 1. Straight renames.
  for (const [from, to] of RENAMES) {
    for (const q of withPredicate(from)) {
      remove.push(q);
      add.push(triple(q.subject, nn(to), q.object));
      report.renamed += 1;
    }
  }

  // 2. Views: `arch:viewpoint` and container-first `arch:contains`.
  const legacyViewpoints = withPredicate(IRI.legacyViewpoint);
  const legacyContains = withPredicate(IRI.legacyContains);
  const views = new Set(
    legacyViewpoints.length + legacyContains.length > 0
      ? store.getQuads(null, T.rdfType, T.View, MODEL_GRAPH).map((q) => q.subject.value)
      : [],
  );
  for (const q of legacyViewpoints) {
    if (!views.has(q.subject.value)) continue;
    remove.push(q);
    add.push(triple(q.subject, T.viewConformsToViewpoint, q.object));
    report.renamed += 1;
  }
  for (const q of legacyContains) {
    if (!views.has(q.object.value)) continue;
    remove.push(q);
    add.push(triple(q.object, T.inModel, q.subject));
    report.renamed += 1;
  }

  // 3. `arch:relPredicate` → a class type plus the unqualified triple.
  const relPredicates = withPredicate(IRI.legacyRelPredicate);
  const closure = relPredicates.length > 0 ? typeClosure(store) : () => [];
  for (const q of relPredicates) {
    remove.push(q);
    report.relationships += 1;
    const rel = q.subject;
    const predicateIri = q.object.value;
    const isClass = closure(predicateIri).includes(IRI.QualifiedRelationship);
    // Several resources may name the predicate as their unqualified form —
    // ArchiMate 4.0 also maps the qualified *property* `am4:qualifiedServing` to
    // `am4:serves` — so only a relationship class qualifies; and subclasses
    // share their class's (`am4:ReadAccess` is `am4:accesses` too), so the most
    // general one, which says no more than the predicate does.
    const candidates = isClass
      ? []
      : store
          .getQuads(null, T.unqualifiedForm, nn(predicateIri))
          .map((m) => m.subject.value)
          .filter((candidate) => closure(candidate).includes(IRI.QualifiedRelationship));
    const classIri = isClass
      ? predicateIri
      : candidates.find((candidate) =>
          closure(candidate).every((superClass) => superClass === candidate || !candidates.includes(superClass)),
        );
    if (classIri) {
      add.push(triple(rel, T.rdfType, nn(classIri)));
    } else {
      report.notes.push(
        `Relationship <${rel.value}> names <${predicateIri}>, which no loaded metamodel defines; it stays a generic arch:QualifiedRelationship.`,
      );
    }
    const unqualified = isClass
      ? store.getQuads(nn(predicateIri), T.unqualifiedForm)[0]?.object.value
      : classIri
        ? predicateIri
        : undefined;
    const end = (legacy: string, current: string) =>
      store.getQuads(rel as NamedNode, nn(legacy), null, MODEL_GRAPH)[0] ?? store.getQuads(rel as NamedNode, nn(current), null, MODEL_GRAPH)[0];
    const source = end(IRI.legacyRelSource, IRI.source);
    const target = end(IRI.legacyRelTarget, IRI.target);
    if (unqualified && source && target) add.push(triple(source.object, nn(unqualified), target.object));
  }

  if (remove.length > 0) store.removeQuads(remove);
  if (add.length > 0) store.addQuads(add);

  // 4. Element-level geometry (la-gram ≤ 0.1) → nodes.
  if (options.viewManager) migrateElementGeometry(store, options.viewManager, options.defaultView, report);

  return report;
}

/** Move bounds and `arch-vis:view` off elements into proper view nodes. */
function migrateElementGeometry(
  store: RdfStore,
  viewManager: ViewManager,
  defaultView: (() => string) | undefined,
  report: MigrationReport,
): void {
  const isDiagramElement = (subject: Quad['subject']) =>
    store.getQuads(subject as NamedNode, T.rdfType, null, MODEL_GRAPH).some((q) => q.object.value.startsWith('https://meta.linked.archi/core-vis#'));

  // Elements carrying bounds or an arch-vis:view of their own.
  const carriers = new Set<string>();
  for (const predicate of [IRI.boundsX, IRI.visView]) {
    for (const q of store.getQuads(null, nn(predicate), null, MODEL_GRAPH)) {
      if (!carriers.has(q.subject.value) && !isDiagramElement(q.subject)) carriers.add(q.subject.value);
    }
  }
  if (carriers.size === 0) return;

  let fallbackView: string | undefined;
  for (const elementIri of carriers) {
    const element = nn(elementIri);
    const read = (predicate: string) => numberOf(store.getQuads(element, nn(predicate))[0]?.object);
    const bounds: Bounds = {
      x: read(IRI.boundsX) ?? 0,
      y: read(IRI.boundsY) ?? 0,
      width: read(IRI.boundsW) ?? 120,
      height: read(IRI.boundsH) ?? 55,
    };
    const ownViews = store.getQuads(element, T.visView).map((q) => q.object.value);
    const targets =
      ownViews.length > 0 ? ownViews : [(fallbackView ??= defaultView?.() ?? viewManager.getViews()[0]?.iri ?? '')];
    for (const viewIri of targets.filter(Boolean)) {
      viewManager.addElementToView(viewIri, elementIri, bounds);
      report.placements += 1;
    }
    const stale = [
      ...store.getQuads(element, T.visView),
      ...[IRI.boundsX, IRI.boundsY, IRI.boundsW, IRI.boundsH].flatMap((p) =>
        store.getQuads(element, nn(p) as NamedNode),
      ),
    ];
    if (stale.length > 0) store.removeQuads(stale);
  }
}
