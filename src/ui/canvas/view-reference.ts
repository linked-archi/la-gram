/**
 * A reference to another view, on the canvas (Req 3.23): drawn as a figure — its own look, its text, the small view
 * in its corner — and, wherever a concept is asked for, its view's placement, as an element's box is the element's
 * (VC-DD-1). A relationship drawn to it has the view as its end, nesting it in an element may stand for the view
 * refining the element, and the rules take the view's class as its type (VC-DD-2).
 *
 * Its shape's `iri` stays its node's, as every figure's, and its `nodeIri` says so too: the line drawn from it is
 * drawn from that placement of the view. Its `label` is the view's name — what F2 renames — and its `labelText` its
 * own text, an empty one too, drawn in place of the name when it has one (VC-DD-4).
 *
 * No imports but types and the vocabulary: the modeling, the rules and the label editing all ask it, and the label
 * editing imports the modeling.
 */

import type { ViewKind } from '@linked-archi/kernel/model-manager/interfaces.js';
import { IRI } from '@linked-archi/kernel/model-manager/vocabulary.js';
import type { RdfBusinessObject } from './rdf-renderer.js';

interface WithBusinessObject {
  businessObject?: RdfBusinessObject;
}

/**
 * Whether a shape is a reference to another view. Double-clicked, it opens that view (the canvas's); with no text
 * of its own it shows the view's name, and with an empty one, nothing.
 */
export function isViewReference(element: unknown): boolean {
  const businessObject = (element as WithBusinessObject | undefined)?.businessObject;
  return businessObject?.kind === 'figure' && businessObject.figure?.kind === 'reference';
}

/**
 * The concept a shape or a line stands for: a reference's view (none when it opens none); else its own IRI — an
 * element's, a relationship's, or a figure's node, which stands for nothing but itself.
 */
export function conceptIriOf(element: unknown): string | undefined {
  const businessObject = (element as WithBusinessObject | undefined)?.businessObject;
  if (!businessObject) return undefined;
  if (businessObject.kind === 'figure' && businessObject.figure?.kind === 'reference') return businessObject.figure.view;
  return businessObject.iri || undefined;
}

/**
 * Whether a shape is drawing alone — a group, a shape, a note — standing for no concept: a line to or from it stands
 * for no relationship (Req 3.13). A reference is not: it stands for its view.
 */
export function isDrawingOnly(element: unknown): boolean {
  const businessObject = (element as WithBusinessObject | undefined)?.businessObject;
  return businessObject?.kind === 'figure' && businessObject.figure?.kind !== 'reference';
}

/** The class of a view of a kind: a reference's type, for the rules (VC-DD-2). */
export function viewClassOf(kind: ViewKind | undefined): string {
  return kind === 'Catalog' ? IRI.Catalog : kind === 'Matrix' ? IRI.Matrix : IRI.Diagram;
}
