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
import { modelQuads, typeClosure } from './model-queries.js';
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
  const data = modelQuads(store);

  // 1. Straight renames.
  for (const [from, to] of RENAMES) {
    for (const q of data) {
      if (q.predicate.value !== from) continue;
      remove.push(q);
      add.push(triple(q.subject, nn(to), q.object));
      report.renamed += 1;
    }
  }

  // 2. Views: `arch:viewpoint` and container-first `arch:contains`.
  const views = new Set(
    data.filter((q) => q.predicate.value === IRI.rdfType && q.object.value === IRI.View).map((q) => q.subject.value),
  );
  for (const q of data) {
    if (q.predicate.value === IRI.legacyViewpoint && views.has(q.subject.value)) {
      remove.push(q);
      add.push(triple(q.subject, T.viewConformsToViewpoint, q.object));
      report.renamed += 1;
    }
    if (q.predicate.value === IRI.legacyContains && views.has(q.object.value)) {
      remove.push(q);
      add.push(triple(q.object, T.inModel, q.subject));
      report.renamed += 1;
    }
  }

  // 3. `arch:relPredicate` → a class type plus the unqualified triple.
  const closure = typeClosure(store);
  for (const q of data) {
    if (q.predicate.value !== IRI.legacyRelPredicate) continue;
    remove.push(q);
    report.relationships += 1;
    const rel = q.subject;
    const predicateIri = q.object.value;
    const isClass = closure(predicateIri).includes(IRI.QualifiedRelationship);
    // Several resources may name the predicate as their unqualified form —
    // ArchiMate 4.0 also maps the qualified *property* `am4:qualifiedServes` to
    // `am4:serves` — so only a relationship class qualifies.
    const classIri = isClass
      ? predicateIri
      : store
          .getQuads(null, T.unqualifiedForm, nn(predicateIri))
          .map((m) => m.subject.value)
          .find((candidate) => closure(candidate).includes(IRI.QualifiedRelationship));
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
    const source = data.find((d) => d.subject.equals(rel) && (d.predicate.value === IRI.legacyRelSource || d.predicate.value === IRI.source));
    const target = data.find((d) => d.subject.equals(rel) && (d.predicate.value === IRI.legacyRelTarget || d.predicate.value === IRI.target));
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
  const data = modelQuads(store);
  const typesOf = new Map<string, Set<string>>();
  for (const q of data) {
    if (q.predicate.value !== IRI.rdfType) continue;
    const set = typesOf.get(q.subject.value) ?? new Set<string>();
    set.add(q.object.value);
    typesOf.set(q.subject.value, set);
  }
  const isDiagramElement = (iri: string) =>
    [...(typesOf.get(iri) ?? [])].some((t) => t.startsWith('https://meta.linked.archi/core-vis#'));

  // Elements carrying bounds or an arch-vis:view of their own.
  const carriers = new Set<string>();
  for (const q of data) {
    if (isDiagramElement(q.subject.value)) continue;
    if (q.predicate.value === IRI.boundsX || q.predicate.value === IRI.visView) carriers.add(q.subject.value);
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
