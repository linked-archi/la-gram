/**
 * What merging needs of the running la-gram (`git-merge.ts`'s `MergeSupport`):
 * the single-value rules and the count check, the model replaced as one
 * undoable step, and the Conflicts tab (`conflicts-panel.ts`) — added to the
 * bottom panel when a merge leaves conflicts, taken away once the model is
 * committed or another model is opened.
 *
 * A choice in the tab swaps the lines the conflict holds for the chosen side's,
 * in the store, as one undoable step; choosing the other side later swaps them
 * back.
 */
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { App } from '../app.js';
import type { BottomTabHandle, MountedUi } from '../ui/mount-ui.js';
import type { ModelEventHandler } from '../ui/event-bus.js';
import { RdfShaclValidator } from '../rdf-engine/shacl-validator.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { modelQuads } from '../model-manager/model-queries.js';
import { diffSnapshots, snapshotOf } from '../model-manager/version-history.js';
import { quadsOfSnapshot, shaclCountCheck, type MergeConflict, type MergeSide } from '../model-manager/model-merge.js';
import type { MergeSupport } from './git-merge.js';
import './conflicts-panel.js';
import type { ConflictPickDetail, ConflictsPanel } from './conflicts-panel.js';

/** The bottom panel tab's id. */
export const CONFLICTS_TAB = 'conflicts';

/** A conflict shown, with the lines it holds in the model now. */
interface Shown {
  conflict: MergeConflict;
  picked?: MergeSide;
  /** What stands for it in the model: `held` until a side is chosen, then that side's. */
  current: string[];
}

/** Merging, wired into la-gram; `stop` takes the tab away. */
export function startMerging(app: App, ui: MountedUi): { support: MergeSupport; panel: ConflictsPanel; stop(): void } {
  const store = app.components.store;
  const { eventBus } = app.components;
  // The count check's own: it compiles the shapes once, and keeps them while they last.
  const validator = new RdfShaclValidator();
  const panel = document.createElement('git-conflicts');
  panel.describe = (iri) => ui.describeConcept(iri);
  panel.propertyName = (predicate) => ui.propertyName(predicate);
  let tab: BottomTabHandle | undefined;
  let shown: { modelIri: string | undefined; entries: Shown[]; against: { branch: string; commit: string } } | undefined;

  /** Take `removed` out of the model and put `added` in, as one undoable step. */
  const change = (removed: string[], added: string[]): void => {
    if (removed.length + added.length === 0) return;
    const apply = () => {
      const batching = store as { batch?: <R>(fn: () => R) => R };
      const run = () => {
        if (removed.length > 0) store.removeQuads(quadsOfSnapshot(removed));
        if (added.length > 0) store.addQuads(quadsOfSnapshot(added));
      };
      if (typeof batching.batch === 'function') batching.batch(run);
      else run();
    };
    if (!ui.diagramCanvas.recordChange(apply)) eventBus.emit('model-changed', { origin: 'git' });
    eventBus.emit('views-changed', {});
  };

  const open = () => shown?.entries.filter((e) => !e.picked).length ?? 0;
  const render = (): void => {
    panel.entries = (shown?.entries ?? []).map(({ conflict, picked }) => ({ conflict, ...(picked ? { picked } : {}) }));
    panel.against = shown?.against;
    const left = open();
    tab?.setBadge(left > 0 ? String(left) : undefined);
  };

  const support: MergeSupport = {
    options: () => ({
      singleValued: app.singleValued(),
      counts: shaclCountCheck(
        validator,
        app.relationshipCheck().split.kept,
        store.getQuads(null, DataFactory.namedNode(NAMESPACES.rdfs + 'subClassOf') as unknown as NamedNode),
      ),
    }),
    replace: (snapshot) => {
      const { added, removed } = diffSnapshots(snapshotOf(modelQuads(store)), snapshot);
      change(removed, added);
    },
    conflicts: (conflicts, against) => {
      shown = { modelIri: app.session.modelIri, entries: conflicts.map((conflict) => ({ conflict, current: conflict.held })), against };
      tab ??= ui.addBottomTab({ id: CONFLICTS_TAB, label: 'Conflicts', element: panel });
      render();
      tab.show();
    },
    unresolved: () => (shown && shown.modelIri === app.session.modelIri ? open() : 0),
    clear: () => {
      shown = undefined;
      render();
      tab?.remove();
      tab = undefined;
    },
    blankNodes: () => modelQuads(store).filter((q: Quad) => q.subject.termType === 'BlankNode' || q.object.termType === 'BlankNode').length,
  };

  const onPick = (event: Event): void => {
    const { index, side } = (event as CustomEvent<ConflictPickDetail>).detail;
    const entry = shown?.entries[index];
    if (!entry || entry.picked === side) return;
    const chosen = entry.conflict.options[side];
    const keep = new Set(chosen);
    const before = new Set(entry.current);
    change(
      entry.current.filter((line) => !keep.has(line)),
      chosen.filter((line) => !before.has(line)),
    );
    entry.current = chosen;
    entry.picked = side;
    render();
  };
  const onSelect = (event: Event): void => ui.selectConcept((event as CustomEvent<{ iri: string }>).detail.iri);
  // Another model opened: its conflicts are not this one's.
  const onLoaded: ModelEventHandler = () => support.clear();
  panel.addEventListener('conflict-pick', onPick);
  panel.addEventListener('conflict-select', onSelect);
  eventBus.on('model-loaded', onLoaded);

  return {
    support,
    panel,
    stop() {
      eventBus.off('model-loaded', onLoaded);
      panel.removeEventListener('conflict-pick', onPick);
      panel.removeEventListener('conflict-select', onSelect);
      support.clear();
    },
  };
}
