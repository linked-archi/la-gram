/**
 * Changing an element's type on the canvas: `rdf.element.retype`.
 *
 * The element keeps its IRI, its name, its properties and its placement in every
 * view; only its `rdf:type` changes — and its name, when that was still the old
 * type's default name (a new element is named after its type). The canvas builds
 * the store operation; this handler runs it as a recorded store change (undo
 * restores the old type exactly, redo re-applies it) and redraws the shape in
 * the new type's notation. Canvas commands are not followed by a re-read of the
 * store, so the drawing must follow the command itself, on undo too.
 */

import { RdfChangeHandler, type RdfChangeContext } from './rdf-modeling.js';
import type { RdfBusinessObject } from './rdf-renderer.js';
import type { ObservableRdfStore } from '../../rdf-engine/observable-store.js';

/** Command id of a type change on the canvas. */
export const RETYPE_ELEMENT_COMMAND = 'rdf.element.retype';

/** What the shape shows of the type: kept to restore it on undo. */
interface ShownType {
  typeIri: string;
  iconUrl?: string;
  label?: string;
}

/** Context of {@link RETYPE_ELEMENT_COMMAND}. */
export interface RetypeElementContext extends RdfChangeContext {
  element: { businessObject?: RdfBusinessObject };
  typeIri: string;
  iconUrl?: string;
  /** The new name, when the old one was the old type's default. */
  label?: string;
  /** Filled in on first execute. */
  previous?: ShownType;
}

export class RetypeElementHandler extends RdfChangeHandler {
  static override $inject = ['rdfChangeStore'];

  constructor(store: ObservableRdfStore | null) {
    super(store);
  }

  override execute(context: RdfChangeContext): unknown[] {
    const retype = context as RetypeElementContext;
    const shown = retype.element.businessObject!;
    retype.previous ??= { typeIri: shown.typeIri, iconUrl: shown.iconUrl, label: shown.label };
    super.execute(retype);
    shown.typeIri = retype.typeIri;
    shown.iconUrl = retype.iconUrl;
    if (retype.label) shown.label = retype.label;
    return [retype.element];
  }

  override revert(context: RdfChangeContext): unknown[] {
    const retype = context as RetypeElementContext;
    super.revert(retype);
    const shown = retype.element.businessObject;
    if (shown && retype.previous) {
      shown.typeIri = retype.previous.typeIri;
      shown.iconUrl = retype.previous.iconUrl;
      shown.label = retype.previous.label;
    }
    return [retype.element];
  }
}
