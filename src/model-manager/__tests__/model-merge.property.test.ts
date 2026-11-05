/**
 * Properties of the three-way merge, on models la-gram's own managers make and
 * edit — elements named in two languages, serving relationships, a diagram with
 * nodes and routed links — so the edits are the ones the editor makes,
 * deletions with their real cascade included:
 *
 * - the result does not depend on which side is "ours";
 * - merging a version with itself, or with an unchanged base, gives it back;
 * - changes that do not touch each other never conflict, and are all kept.
 *
 * And of the diff by element (`model-diff.ts`) on the same edits: every line
 * changed is under one concept, never under a shape or a route cell of its own;
 * compared the other way round, what was added is removed.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { OxigraphElementManager } from '../element-manager.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { OxigraphViewManager } from '../view-manager.js';
import { modelQuads } from '../model-queries.js';
import { quadsOf, snapshotOf } from '../version-history.js';
import { IRI, langLiteral, nn, triple } from '../vocabulary.js';
import { mergeSnapshots, type MergeConflict } from '../model-merge.js';
import { diffByElement } from '../model-diff.js';

const MODEL = 'https://example.org/m/model';
const COMPONENT = 'https://meta.linked.archi/archimate4/onto#ApplicationComponent';
const SERVING = 'https://meta.linked.archi/archimate4/onto#Serving';
const SERVES = 'https://meta.linked.archi/archimate4/onto#serves';
const ELEMENTS = 6;
/** Elements 0–2 are one half of the model, 3–5 the other. */
const HALF = 3;

/** The base model as built: its snapshot, and the IRIs edits refer to by number. */
interface Base {
  snapshot: string[];
  elements: string[];
  relationships: string[];
  view: string;
}

type Edit =
  | { kind: 'rename'; element: number; language: 'en' | 'fr'; text: string }
  | { kind: 'move'; element: number; x: number; y: number }
  | { kind: 'resize'; element: number; width: number }
  | { kind: 'reroute'; relationship: number; points: Array<{ x: number; y: number }> }
  | { kind: 'delete'; element: number }
  | { kind: 'unrelate'; relationship: number }
  | { kind: 'relate'; source: number; target: number }
  | { kind: 'place'; element: number }
  | { kind: 'unplace'; element: number };

function managers(store: OxigraphRdfStore) {
  return {
    elements: new OxigraphElementManager(store),
    relationships: new OxigraphRelationshipManager(store),
    views: new OxigraphViewManager(store),
  };
}

function build(placed: boolean[], pairs: Array<[number, number]>, routed: boolean[]): Base {
  const store = new OxigraphRdfStore();
  try {
    const { elements, relationships, views } = managers(store);
    const ids = Array.from({ length: ELEMENTS }, (_, i) => elements.createElement(COMPONENT, MODEL, { label: `E${i}` }).value);
    ids.forEach((id, i) => {
      if (i % 2 === 0) store.addQuads([triple(nn(id), nn(IRI.prefLabel), langLiteral(`É${i}`, 'fr'))]);
    });
    const view = views.createView('Diagram', undefined, { modelIri: MODEL }).value;
    ids.forEach((id, i) => {
      if (placed[i]) views.addElementToView(view, id, { x: i * 150, y: 0, width: 120, height: 55 });
    });
    const rels = pairs
      .filter(([s, t]) => s !== t)
      .map(([s, t], j) => {
        const iri = relationships.createQualifiedRelationship({ typeIri: SERVING, predicateIri: SERVES, sourceIri: ids[s], targetIri: ids[t], modelIri: MODEL }).iri;
        views.addRelationshipToView(view, iri, routed[j % routed.length] ? [{ x: 10 * j, y: 100 }] : undefined);
        return iri;
      });
    return { snapshot: snapshotOf(modelQuads(store)), elements: ids, relationships: rels, view };
  } finally {
    store.dispose();
  }
}

/** Base with the edits made through the managers, as the editor makes them. */
function edited(base: Base, edits: readonly Edit[]): string[] {
  const store = new OxigraphRdfStore();
  try {
    store.addQuads(quadsOf(base.snapshot));
    const { elements, relationships, views } = managers(store);
    const exists = (iri: string | undefined) => !!iri && store.getQuads(nn(iri)).length > 0;
    const placedIn = (iri: string) => store.getQuads(null, nn(IRI.archElement), nn(iri)).length > 0;
    const drawn = (iri: string) => store.getQuads(null, nn(IRI.archRelationship), nn(iri)).length > 0;
    for (const edit of edits) {
      switch (edit.kind) {
        case 'rename': {
          const el = base.elements[edit.element];
          if (!exists(el)) break;
          const stale = store.getQuads(nn(el), nn(IRI.prefLabel)).filter((q) => (q.object as { language?: string }).language === edit.language);
          if (stale.length > 0) store.removeQuads(stale);
          store.addQuads([triple(nn(el), nn(IRI.prefLabel), langLiteral(edit.text, edit.language))]);
          break;
        }
        case 'move':
        case 'resize': {
          const el = base.elements[edit.element];
          if (!exists(el) || !placedIn(el)) break;
          const bounds = edit.kind === 'move' ? { x: edit.x, y: edit.y, width: 120, height: 55 } : { x: edit.element * 150, y: 0, width: edit.width, height: 55 };
          views.updateNodeBounds(base.view, el, bounds);
          break;
        }
        case 'reroute': {
          const rel = base.relationships[edit.relationship];
          if (exists(rel) && drawn(rel)) views.updateLinkWaypoints(base.view, rel, edit.points);
          break;
        }
        case 'delete': {
          const el = base.elements[edit.element];
          if (exists(el)) elements.deleteElement(el);
          break;
        }
        case 'unrelate': {
          const rel = base.relationships[edit.relationship];
          if (exists(rel)) relationships.deleteRelationship(rel);
          break;
        }
        case 'relate': {
          const [s, t] = [base.elements[edit.source], base.elements[edit.target]];
          if (s === t || !exists(s) || !exists(t)) break;
          const iri = relationships.createQualifiedRelationship({ typeIri: SERVING, predicateIri: SERVES, sourceIri: s, targetIri: t, modelIri: MODEL }).iri;
          views.addRelationshipToView(base.view, iri);
          break;
        }
        case 'place': {
          const el = base.elements[edit.element];
          if (exists(el)) views.addElementToView(base.view, el, { x: edit.element * 150, y: 300, width: 120, height: 55 });
          break;
        }
        case 'unplace': {
          const el = base.elements[edit.element];
          if (exists(el) && placedIn(el)) views.removeElementFromView(base.view, el);
          break;
        }
      }
    }
    return snapshotOf(modelQuads(store));
  } finally {
    store.dispose();
  }
}

const baseArb = fc.record({
  placed: fc.array(fc.boolean(), { minLength: ELEMENTS, maxLength: ELEMENTS }),
  pairs: fc.array(fc.tuple(fc.nat(ELEMENTS - 1), fc.nat(ELEMENTS - 1)), { maxLength: 6 }),
  routed: fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
});
type Spec = typeof baseArb extends fc.Arbitrary<infer T> ? T : never;

/** The relationships a spec makes, by index, with both ends among elements `from`..`to` - 1. */
function within(spec: Spec, from: number, to: number): number[] {
  return spec.pairs
    .filter(([s, t]) => s !== t)
    .map(([s, t], j) => ({ s, t, j }))
    .filter(({ s, t }) => s >= from && s < to && t >= from && t < to)
    .map(({ j }) => j);
}

/** A base, and edits for each side: ours on elements `ours`, theirs on `theirs` (ranges, end excluded). */
function scenario(ours: [number, number], theirs: [number, number]) {
  return baseArb.chain((spec) =>
    fc.record({
      spec: fc.constant(spec),
      ours: editArb(ours[0], ours[1], within(spec, ...ours)),
      theirs: editArb(theirs[0], theirs[1], within(spec, ...theirs)),
    }),
  );
}

/** Edits on elements `from`..`to` - 1 only, and on relationships between them. */
function editArb(from: number, to: number, relationships: number[]): fc.Arbitrary<Edit[]> {
  const element = fc.integer({ min: from, max: to - 1 });
  const coordinate = fc.integer({ min: 0, max: 20 }).map((n) => n * 10);
  const options: Array<fc.Arbitrary<Edit>> = [
    fc.record({ kind: fc.constant('rename' as const), element, language: fc.constantFrom('en' as const, 'fr' as const), text: fc.constantFrom('Alpha', 'Beta', 'Gamma') }),
    fc.record({ kind: fc.constant('move' as const), element, x: coordinate, y: coordinate }),
    fc.record({ kind: fc.constant('resize' as const), element, width: fc.constantFrom(80, 160, 200) }),
    fc.record({ kind: fc.constant('delete' as const), element }),
    fc.record({ kind: fc.constant('relate' as const), source: element, target: element }),
    fc.record({ kind: fc.constant('place' as const), element }),
    fc.record({ kind: fc.constant('unplace' as const), element }),
  ];
  if (relationships.length > 0) {
    const relationship = fc.constantFrom(...relationships);
    const point = fc.record({ x: coordinate, y: coordinate });
    options.push(
      fc.record({ kind: fc.constant('reroute' as const), relationship, points: fc.array(point, { maxLength: 3 }) }),
      fc.record({ kind: fc.constant('unrelate' as const), relationship }),
    );
  }
  return fc.array(fc.oneof(...options), { maxLength: 6 });
}

/** A conflict as the other side sees it. */
function swapped(c: MergeConflict): MergeConflict {
  return {
    ...c,
    ...(c.deletedBy ? { deletedBy: c.deletedBy === 'ours' ? 'theirs' : 'ours' } : {}),
    options: { ours: c.options.theirs, theirs: c.options.ours },
  };
}
const canonical = (conflicts: MergeConflict[]) => conflicts.map((c) => JSON.stringify(c)).sort();

/** Base with both sides' changes applied. */
function bothApplied(base: string[], ours: string[], theirs: string[]): string[] {
  const b = new Set(base);
  const out = new Set(base);
  for (const side of [ours, theirs]) {
    const s = new Set(side);
    for (const l of base) if (!s.has(l)) out.delete(l);
    for (const l of side) if (!b.has(l)) out.add(l);
  }
  return [...out].sort();
}

/** Runs per property; `MERGE_RUNS=1000 npx vitest …` for a longer search. */
const RUNS = { numRuns: Number(process.env.MERGE_RUNS ?? 60) };

describe('the three-way merge', () => {
  it('does not depend on which side is ours', () => {
    fc.assert(
      fc.property(scenario([0, ELEMENTS], [0, ELEMENTS]), ({ spec, ours: ourEdits, theirs: theirEdits }) => {
        const base = build(spec.placed, spec.pairs, spec.routed);
        const ours = edited(base, ourEdits);
        const theirs = edited(base, theirEdits);
        const one = mergeSnapshots(base.snapshot, ours, theirs);
        const other = mergeSnapshots(base.snapshot, theirs, ours);
        expect(other.merged).toEqual(one.merged);
        expect(canonical(other.conflicts.map(swapped))).toEqual(canonical(one.conflicts));
      }),
      RUNS,
    );
  });

  it('gives a version back when merged with itself or with an unchanged base', () => {
    fc.assert(
      fc.property(scenario([0, ELEMENTS], [0, ELEMENTS]), ({ spec, ours: edits }) => {
        const base = build(spec.placed, spec.pairs, spec.routed);
        const version = edited(base, edits);
        expect(mergeSnapshots(base.snapshot, version, version)).toEqual({ merged: version, conflicts: [] });
        expect(mergeSnapshots(base.snapshot, base.snapshot, version)).toEqual({ merged: version, conflicts: [] });
        expect(mergeSnapshots(base.snapshot, version, base.snapshot)).toEqual({ merged: version, conflicts: [] });
      }),
      RUNS,
    );
  });

  it('never finds a conflict between changes that do not touch each other, and keeps them all', () => {
    fc.assert(
      fc.property(scenario([0, HALF], [HALF, ELEMENTS]), ({ spec, ours: ourEdits, theirs: theirEdits }) => {
        const base = build(spec.placed, spec.pairs, spec.routed);
        const ours = edited(base, ourEdits);
        const theirs = edited(base, theirEdits);
        const { merged, conflicts } = mergeSnapshots(base.snapshot, ours, theirs);
        expect(conflicts).toEqual([]);
        expect(merged).toEqual(bothApplied(base.snapshot, ours, theirs));
      }),
      RUNS,
    );
  });
});

describe('the diff by element, on the same edits', () => {
  it('puts every line changed under one concept — an element, relationship, view or the model — and reads the same both ways', () => {
    fc.assert(
      fc.property(scenario([0, ELEMENTS], [0, ELEMENTS]), ({ spec, ours: edits }) => {
        const base = build(spec.placed, spec.pairs, spec.routed);
        const version = edited(base, edits);
        const diff = diffByElement(base.snapshot, version);
        expect(diff.changes.flatMap((c) => c.lines.added).sort()).toEqual([...diff.lines.added].sort());
        expect(diff.changes.flatMap((c) => c.lines.removed).sort()).toEqual([...diff.lines.removed].sort());
        expect(diff.changes.filter((c) => !['element', 'relationship', 'view', 'model'].includes(c.kind))).toEqual([]);

        const back = diffByElement(version, base.snapshot);
        const flip = { added: 'removed', removed: 'added', changed: 'changed' } as const;
        expect(back.changes.map((c) => `${c.subject} ${c.status}`).sort()).toEqual(diff.changes.map((c) => `${c.subject} ${flip[c.status]}`).sort());
      }),
      RUNS,
    );
  });
});
