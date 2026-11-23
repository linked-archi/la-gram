/**
 * Zooming in: from an element or a relationship to a view that refines it — `V arch:refines X`, or
 * `X arch:refinedInto V` (VC-6, VC-DD-6) — whether or not a reference to that view is drawn. Refined by one view,
 * the pad's *Zoom in* opens it; by several, this menu lists them by name, and the one picked opens. The right-click
 * menu lists each itself.
 */

import type { ViewInfo } from '../../model-manager/interfaces.js';

/** Popup menu id of the views a concept zooms into. */
export const ZOOM_MENU_ID = 'la-zoom-in';

/** What the menu is for: set by the canvas as it opens it. */
export interface PendingZoom {
  /** The views refining the concept, by name. */
  views: ViewInfo[];
}

/** What a view is, in a word: the menu's description of an entry. */
const KIND_WORDS: Record<ViewInfo['type'], string> = { Diagram: 'diagram', Catalog: 'catalog', Matrix: 'matrix' };

/** The menu of the views refining a concept: each opens its view. */
export class RdfZoomMenuProvider {
  pending: PendingZoom | undefined;

  /** @param open Called with the view picked. */
  constructor(private readonly open: (viewIri: string) => void) {}

  getPopupMenuEntries(_target: unknown): Record<string, unknown> {
    const entries: Record<string, unknown> = {};
    (this.pending?.views ?? []).forEach((view, index) => {
      entries[`la-zoom-${index}`] = {
        label: view.label || view.iri,
        className: 'la-zoom-entry',
        title: `Open the ${KIND_WORDS[view.type]} ${view.label || view.iri}`,
        description: KIND_WORDS[view.type],
        action: () => this.open(view.iri),
      };
    });
    return entries;
  }
}
