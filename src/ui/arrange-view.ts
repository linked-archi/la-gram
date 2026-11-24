/**
 * Lay out a diagram view (ELK task, R1–R12): its placements, or those selected and what is nested in them,
 * by ELK — bands from the loaded metamodels, an element of no band taking its neighbours' — kept where the
 * drawing's top-left was. The caller writes the result (`applyViewLayout`): as one recorded change for
 * *Arrange view…*, as part of the load for a model opened without geometry.
 */

import type { RdfStore } from '@linked-archi/kernel/rdf-engine/interfaces.js';
import type { ViewManager } from '@linked-archi/kernel/model-manager/interfaces.js';
import { localName } from '@linked-archi/kernel/model-manager/vocabulary.js';
import { bandsOf, withNeighbourBands } from '../layout/bands.js';
import { layout } from '../layout/layout-service.js';
import type { LayoutEngine } from '../layout/elk-engine.js';
import { DEFAULT_LAYOUT_OPTIONS, type LayoutResult } from '../layout/layout-types.js';
import { viewLayoutInput } from '../layout/view-layout.js';
import { containerNameBand } from './canvas/notation-shapes.js';
import type { ArrangeSettings } from './arrange-settings.js';

export interface ArrangeDeps {
  store: RdfStore;
  views: ViewManager;
  /** An element's type. */
  typeOf(iri: string): string | undefined;
  labelOf(iri: string): string;
  /** A relationship's class. */
  relationshipTypeOf(iri: string): string | undefined;
  /** A type and its supertypes, nearest first — a subtype is in its supertype's band. */
  closure(typeIri: string): readonly string[];
  engine: () => Promise<LayoutEngine>;
}

/** The element types the loaded metamodels give bands, and their bands; empty when none publishes an order. */
export function loadedBands(store: RdfStore): Map<string, number> {
  return bandsOf(store);
}

/**
 * Lay out the view — or the placements `only` names — as the settings say. The result's bounds and routes
 * are by node and link IRI; nothing is written here.
 */
export async function layoutView(
  deps: ArrangeDeps,
  viewIri: string,
  settings: ArrangeSettings,
  only?: ReadonlySet<string>,
): Promise<LayoutResult> {
  const bands = settings.bands ? loadedBands(deps.store) : new Map<string, number>();
  const bandOf = (type: string): number | undefined => {
    for (const t of [type, ...deps.closure(type)]) {
      const band = bands.get(t);
      if (band !== undefined) return band;
    }
    return undefined;
  };
  const { input, origin } = viewLayoutInput(
    {
      views: deps.views,
      typeOf: deps.typeOf,
      labelOf: deps.labelOf,
      // Association is undirected in ArchiMate: it does not decide which end comes first.
      isAssociation: (iri) => localName(deps.relationshipTypeOf(iri) ?? '') === 'Association',
      nameBand: containerNameBand(),
      ...(bands.size > 0 ? { bandOf } : {}),
    },
    viewIri,
    only,
  );
  const banded = bands.size > 0 ? withNeighbourBands(input) : input;
  return layout(
    banded,
    { ...DEFAULT_LAYOUT_OPTIONS, direction: settings.direction, spacing: settings.spacing, bands: bands.size > 0, origin },
    deps.engine,
  );
}

/** What la-gram says the grid was used for. */
export function gridNote(result: LayoutResult): string {
  return result.reason === 'too-many'
    ? 'too many elements for the layered layout: placed in a grid'
    : result.reason === 'timed-out'
      ? 'the layered layout took too long: placed in a grid'
      : result.reason === 'failed'
        ? 'the layered layout failed: placed in a grid'
        : '';
}
