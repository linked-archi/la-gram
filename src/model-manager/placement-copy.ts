/**
 * Placing a view's nodes and links again, in another view or the same one — what *Duplicate view*
 * (`ViewManager.duplicateView`) and paste (`clipboard.ts`) both do, in one place.
 *
 * Node by node: a figure is a figure; an element placed twice is placed twice (`another: true`), what was
 * inside a node inside its copy; each with its appearance, its appearances per presentation and its label
 * expressions. Then link by link, in passes — a link ending on another link waits for that one's copy: a
 * connector between the copied figures, a relationship between the copied placements of its ends, each with
 * its route, its looks and a name moved off its line. The source and the target may be different stores:
 * paste reads a copy's placements through a view manager over the copy and places them in the open view.
 */

import type { Bounds, FigureInfo, Point, ViewManager } from './interfaces.js';

/**
 * A figure as the target can place it. A reference opens a view of its own model: pasted into a model without
 * that view it would open nothing, so it is placed as a note with its text (core-vis-shapes 0.5.0).
 */
function placeable(figure: FigureInfo | undefined, target: ViewManager): FigureInfo | undefined {
  if (figure?.kind !== 'reference' || !figure.view || target.getView(figure.view)) return figure;
  const note: FigureInfo = { ...figure, kind: 'note' };
  delete note.view;
  return note;
}

export interface PlacementCopyOptions {
  /** Only these placements of the source view, by node IRI; every node when absent. */
  nodes?: ReadonlySet<string>;
  /** Only these links, by link IRI; every link when absent. A link is copied only when both its ends are. */
  links?: ReadonlySet<string>;
  /** The concept a copied placement draws in the target: a copy's IRI for its original's. The same by default. */
  concept?: (iri: string) => string;
  /** Every position moved by this much. */
  offset?: Point;
}

/** The placements made, by the source placement they copy. */
export interface PlacementCopy {
  nodes: Map<string, string>;
  links: Map<string, string>;
}

export function copyPlacements(
  source: ViewManager,
  sourceViewIri: string,
  target: ViewManager,
  targetViewIri: string,
  options: PlacementCopyOptions = {},
): PlacementCopy {
  const concept = options.concept ?? ((iri: string) => iri);
  const dx = options.offset?.x ?? 0;
  const dy = options.offset?.y ?? 0;
  const moved = (b: Bounds): Bounds => ({ ...b, x: b.x + dx, y: b.y + dy });
  const route = (points: Point[]): Point[] => points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

  const nodes = source.getNodes(sourceViewIri).filter((node) => !options.nodes || options.nodes.has(node.nodeIri));
  const copies = new Map<string, string>();
  for (const node of nodes) {
    const figure = placeable(node.figure, target);
    const copied = figure
      ? target.addFigure!(targetViewIri, { ...figure, bounds: moved(node.bounds) })
      : target.addElementToView(targetViewIri, concept(node.elementIri), moved(node.bounds), { another: true });
    copies.set(node.nodeIri, copied);
    // Looking as it did: a figure's appearance is copied with it; its label saying what it said.
    if (node.appearance) target.setAppearance!(targetViewIri, copied, node.appearance);
    for (const [context, look] of Object.entries(node.contextAppearances ?? {})) target.setAppearance!(targetViewIri, copied, look, context);
    for (const label of node.labelExpressions ?? []) target.setLabelExpression!(targetViewIri, copied, label.context, label.expression);
  }
  for (const node of nodes) {
    const parent = node.parentNodeIri ? copies.get(node.parentNodeIri) : undefined;
    if (parent) target.setNodeParent!(targetViewIri, copies.get(node.nodeIri)!, parent);
  }

  const linkCopies = new Map<string, string>();
  let pending = source.getLinks(sourceViewIri).filter((link) => !options.links || options.links.has(link.linkIri));
  for (;;) {
    const waiting = pending.filter((link) => {
      const end = (iri: string) => copies.get(iri) ?? linkCopies.get(iri);
      const sourceNodeIri = end(link.sourceNodeIri);
      const targetNodeIri = end(link.targetNodeIri);
      // A connector joins figures, copied already.
      if (link.connector) {
        const copied =
          sourceNodeIri && targetNodeIri ? target.addConnector!(targetViewIri, { sourceNodeIri, targetNodeIri }, route(link.waypoints)) : undefined;
        if (!copied) return false;
        linkCopies.set(link.linkIri, copied);
        if (link.appearance) target.setAppearance!(targetViewIri, copied, link.appearance);
        for (const [context, look] of Object.entries(link.contextAppearances ?? {})) target.setAppearance!(targetViewIri, copied, look, context);
        if (link.text) target.setConnectorText!(targetViewIri, copied, link.text);
        if (link.label) target.setLinkLabel!(targetViewIri, copied, moved(link.label));
        return false;
      }
      // Copied only between copied ends: a link to a placement not copied is left out (the selection
      // decides; *Duplicate view* copies every node). Its ends may yet be copied in a later pass.
      if (options.nodes && (!sourceNodeIri || !targetNodeIri)) return true;
      const copied = target.addRelationshipToView(
        targetViewIri,
        concept(link.relationshipIri),
        route(link.waypoints),
        { ...(sourceNodeIri ? { sourceNodeIri } : {}), ...(targetNodeIri ? { targetNodeIri } : {}) },
        { another: true },
      );
      if (!copied) return true;
      linkCopies.set(link.linkIri, copied);
      if (link.appearance) target.setAppearance!(targetViewIri, copied, link.appearance);
      for (const [context, look] of Object.entries(link.contextAppearances ?? {})) target.setAppearance!(targetViewIri, copied, look, context);
      // A name moved off the middle of its line stays where it was put.
      if (link.label) target.setLinkLabel!(targetViewIri, copied, moved(link.label));
      return false;
    });
    if (waiting.length === 0 || waiting.length === pending.length) break;
    pending = waiting;
  }
  return { nodes: copies, links: linkCopies };
}
