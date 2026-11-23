/**
 * View Manager — views and the diagram geometry inside them.
 *
 * ## Model / view separation
 *
 * Elements and relationships belong to the *model*. A view presents a subset of
 * them; deleting something from a view removes the presentation, never the
 * concept. The RDF follows the published vocabulary exactly:
 *
 * ```turtle
 * mv:{v}  a arch:View, arch:Diagram ;
 *         arch:inModel m:model ;
 *         skos:prefLabel "Application Cooperation"@en ;
 *         arch:viewConformsToViewpoint am4vp:ApplicationCooperationViewpoint .
 *
 * me:{e}  arch:inView mv:{v} .                        # membership, survives geometry loss
 *
 * mv{hash}:node-{n}  a arch-vis:ArchNode ;            # geometry: {view}#node-{n}
 *         arch-vis:view mv:{v} ;
 *         arch-vis:archElement me:{e} ;
 *         arch-vis:bounds-x 40.0 ; … bounds-y, bounds-w, bounds-h .
 *
 * mv{hash}:link-{l}  a arch-vis:Link ;                # {view}#link-{l}
 *         arch-vis:view mv:{v} ;
 *         arch-vis:archRelationship mr:{r} ;
 *         arch-vis:source mv{hash}:node-{n} ; arch-vis:target … ;
 *         arch-vis:points mv{hash}:link-{l}-points-0 ;  # optional route: …-point-0, …-point-1 …
 *         arch-vis:label mv{hash}:link-{l}-label .       # optional: where its name was moved to
 *
 * mv{hash}:link-{l}-label  a arch-vis:LabelNode ;
 *         arch-vis:view mv:{v} ;
 *         arch-vis:bounds-x 210.0 ; … bounds-y, bounds-w, bounds-h .
 * ```
 *
 * A node or a link is named in its view's IRI, and its parts under it with `-`,
 * as everything after a `#` is (DD-41). A model la-gram saved before keeps its
 * names — `m:node-…`, `m:link-…-points-0`, `m:link-…-p0`, `m:node-…-style` — and
 * they are read, and written on in place, as the placement's own: a tool never
 * renames a part.
 *
 * A link's `arch-vis:LabelNode` keeps where the relationship's name was moved
 * to, in the diagram's coordinates, as core-vis gives a node's bounds; without
 * one the name is at the middle of the route. It goes with its link — removed,
 * restored and copied with it.
 *
 * A relationship whose source or target is another relationship is drawn to
 * that relationship's link: the end is the link, not a node (core-vis 0.6). A
 * link therefore needs the links it ends on drawn first, and goes with them.
 *
 * Nodes and links are minted in their view's IRI, `{view}#node-{uuid}`
 * (`rdf-engine/iri.ts`, `mintShapeIri`).
 *
 * `arch:inView` is written with the node and removed with the last node of that
 * concept in the view, so the coarse membership fact and the geometry never
 * disagree. Point lists use IRI-named cells rather than blank nodes: geometry
 * is synchronised between collaborators triple by triple, and a blank node has
 * no identity outside the store that minted it.
 *
 * ## One placement per element per view
 *
 * The canvas keys shapes by element IRI, so a view holds at most one node per
 * element. {@link addElementToView} is idempotent on that pair.
 *
 * ## Undo
 *
 * Every removal has a `collect…` twin that returns exactly the quads the removal
 * would delete. The canvas snapshots them before removing and puts them back on
 * undo — the store is the model of record, so "undo" means "restore these
 * triples", not "re-run some inverse logic".
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { isPartNamed, mintIri, mintShapeIri, partIri, type ShapeKind } from '../rdf-engine/iri.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { modelNamespace, viewNamespace } from './model-namespace.js';
import { shortHash } from './short-hash.js';
import { picturesOf } from './element-pictures.js';
import { copyPlacements } from './placement-copy.js';
import { collectRelationshipQuads, relationshipsTouching } from './cascade.js';
import {
  APPEARANCE_KEYS,
  APPEARANCE_PREDICATES,
  appearanceObject,
  appearanceOrNone,
  appearanceValue,
  type Appearance,
  type AppearanceChanges,
} from './appearance.js';
import type {
  Bounds,
  FigureColours,
  FigureInfo,
  LabelExpressionInfo,
  LinkInfo,
  NodeInfo,
  Point,
  ViewInfo,
  ViewKind,
  ViewManager,
  ViewReferenceInfo,
} from './interfaces.js';
import {
  BOUNDS_PREDICATES,
  IRI,
  T,
  dedupe,
  doubleLiteral,
  langLiteral,
  nn,
  numberOf,
  quadKey,
  triple,
} from './vocabulary.js';

/** The default graph: the model. */
const MODEL_GRAPH = { termType: 'DefaultGraph', value: '' } as unknown as NamedNode;

/** A presentation context's key in a part's name: `shortHash`'s 8 hex digits. */
const CONTEXT_KEY = /[0-9a-f]{8}/;

/**
 * How a route's cells and points are named: from DD-41 on, as the converters name them, `{link}-points-{i}`
 * and `{link}-point-{i}` ({@link partIri}: with `/` under a link not named in a view's fragment); before it,
 * `{link}-points-{i}` and `{link}-p{i}`. A new route is named the first way; a route named either way keeps
 * its names when it changes.
 */
const ROUTE_NAMES = [
  { cell: (link: string, i: number) => partIri(link, 'points', String(i)), point: (link: string, i: number) => partIri(link, 'point', String(i)) },
  { cell: (link: string, i: number) => `${link}-points-${i}`, point: (link: string, i: number) => `${link}-p${i}` },
] as const;
type RouteNames = (typeof ROUTE_NAMES)[number];

/** Whether a quad is one what a view shows is read from: which view a node or link is in, what it draws. */
function placesInAView(q: Quad): boolean {
  const p = q.predicate.value;
  return p === IRI.visView || p === IRI.archElement || p === IRI.archRelationship || p === IRI.referencesView;
}

/**
 * Whether a quad is one a view's nodes and links are read from: geometry
 * (`arch-vis`), a node's or link's type, a route's list.
 */
function shapesAView(q: Quad): boolean {
  const p = q.predicate.value;
  return (
    p.startsWith(NAMESPACES['arch-vis']) ||
    p === NAMESPACES.rdf + 'first' ||
    p === NAMESPACES.rdf + 'rest' ||
    (p === NAMESPACES.rdf + 'type' && q.object.value.startsWith(NAMESPACES['arch-vis']))
  );
}

/** Map from view kind to its `arch:View` subclass. */
const VIEW_KIND_CLASS: Record<ViewKind, string> = {
  Diagram: IRI.Diagram,
  Catalog: IRI.Catalog,
  Matrix: IRI.Matrix,
};

/** Default size of a node when the caller gives none (the ArchiMate box). */
const DEFAULT_BOUNDS: Bounds = { x: 0, y: 0, width: 120, height: 55 };

/** Concrete {@link ViewManager} over an {@link RdfStore}. */
export class OxigraphViewManager implements ViewManager {
  constructor(private readonly store: RdfStore) {
    const observed = store as RdfStore & { onEveryWrite?(listener: (diff: { added: Quad[]; removed: Quad[] }) => void): unknown };
    if (typeof observed.onEveryWrite === 'function') {
      this.cache = new Map();
      // A figure's text is read with its node: a write of it is the view's too —
      // told by the node's type, so an element renamed does not read a view again.
      const figureText = (q: Quad) =>
        q.predicate.value === IRI.prefLabel &&
        this.objects(q.subject, T.rdfType).some(
          (t) => t === IRI.ContainerNode || t === IRI.LabelNode || t === IRI.ViewReferenceNode || t === IRI.Link,
        );
      const shapes = (q: Quad) => shapesAView(q) || figureText(q);
      observed.onEveryWrite((diff) => {
        if (this.cache?.size && (diff.added.some(shapes) || diff.removed.some(shapes))) this.cache.clear();
        if (this.members.size && (diff.added.some(placesInAView) || diff.removed.some(placesInAView))) this.members.clear();
      });
    }
  }

  /**
   * Each view's nodes and links as last read — the canvas and the model tree
   * both read them after every change, a view of thousands a node at a time —
   * until a write touches what they are read from (Task 22). Only over a store
   * that tells of every write; otherwise every read is fresh.
   */
  private readonly cache: Map<string, { nodes?: NodeInfo[]; links?: LinkInfo[] }> | undefined;
  /** What each view shows, kept even as its shapes move — only over a store that tells of every write. */
  private readonly members = new Map<string, ReadonlySet<string>>();

  /**
   * The elements and relationships a view shows (by IRI): what the model tree
   * marks, after every change — read again only when a node or link is added,
   * removed or re-pointed, not when one moves (Task 22).
   */
  placedIn(viewIri: string): ReadonlySet<string> {
    const known = this.members.get(viewIri);
    if (known) return known;
    const placed = new Set<string>();
    for (const q of this.read(null, T.visView, nn(viewIri))) {
      for (const element of this.objects(q.subject, T.archElement)) placed.add(element);
      for (const relationship of this.objects(q.subject, T.archRelationship)) placed.add(relationship);
      // A reference places the view it opens, as a box its element (VC-DD-1).
      const view = this.viewOf(q.subject);
      if (view) placed.add(view);
    }
    if (this.cache) this.members.set(viewIri, placed);
    return placed;
  }

  /**
   * Views, their nodes, links and routes are the model's: read from the model
   * graph — which the application's store answers from its copy in JavaScript,
   * a view of thousands of nodes being read a node at a time (Task 22).
   */
  private read(subject?: NamedNode | Term | null, predicate?: NamedNode | null, object?: NamedNode | Term | null): Quad[] {
    return this.store.getQuads((subject ?? null) as NamedNode | null, predicate ?? null, (object ?? null) as NamedNode | null, MODEL_GRAPH);
  }

  // ── Views ──────────────────────────────────────────────────────────────

  createView(
    type: ViewKind,
    viewpointIri?: string,
    options: { label?: string; modelIri?: string; iri?: string } = {},
  ): NamedNode {
    const viewIri = options.iri ?? mintIri(modelNamespace(this.store, options.modelIri), 'view');
    const view = nn(viewIri);
    const quads: Quad[] = [
      triple(view, T.rdfType, T.View),
      triple(view, T.rdfType, nn(VIEW_KIND_CLASS[type])),
    ];
    if (options.modelIri) quads.push(triple(view, T.inModel, nn(options.modelIri)));
    if (options.label) quads.push(triple(view, T.prefLabel, langLiteral(options.label)));
    if (viewpointIri) quads.push(triple(view, T.viewConformsToViewpoint, nn(viewpointIri)));
    this.store.addQuads(quads);
    return view;
  }

  getViews(modelIri?: string): ViewInfo[] {
    const views: ViewInfo[] = [];
    for (const q of this.read(null, T.rdfType, T.View)) {
      if (q.graph.termType !== 'DefaultGraph') continue;
      const info = this.getView(q.subject.value);
      if (!info) continue;
      if (modelIri && info.modelIri && info.modelIri !== modelIri) continue;
      views.push(info);
    }
    return views.sort((a, b) => a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri));
  }

  getView(viewIri: string): ViewInfo | undefined {
    const view = nn(viewIri);
    const types = new Set(this.objects(view, T.rdfType));
    if (!types.has(IRI.View)) return undefined;
    const type: ViewKind = types.has(IRI.Catalog) ? 'Catalog' : types.has(IRI.Matrix) ? 'Matrix' : 'Diagram';
    const info: ViewInfo = {
      iri: viewIri,
      label: this.objects(view, T.prefLabel)[0] ?? '',
      type,
    };
    const viewpoint = this.objects(view, T.viewConformsToViewpoint)[0];
    if (viewpoint) info.viewpointIri = viewpoint;
    const model = this.objects(view, T.inModel)[0];
    if (model) info.modelIri = model;
    return info;
  }

  renameView(viewIri: string, label: string): void {
    const view = nn(viewIri);
    this.replace(view, T.prefLabel, label.trim() ? langLiteral(label.trim()) : undefined);
  }

  setViewpoint(viewIri: string, viewpointIri: string | undefined): void {
    this.replace(nn(viewIri), T.viewConformsToViewpoint, viewpointIri ? nn(viewpointIri) : undefined);
  }

  deleteView(viewIri: string): void {
    this.remove(this.collectViewQuads(viewIri));
  }

  collectViewQuads(viewIri: string): Quad[] {
    const view = nn(viewIri);
    const quads: Quad[] = [...this.read(view, null, null)];
    // Everything drawn in it, with its routes…
    for (const node of this.read(null, T.visView, view)) {
      quads.push(...this.subjectQuads(node.subject));
      quads.push(...this.pointListQuads(node.subject));
      // A label node another tool wrote without a view of its own goes with what it labels.
      quads.push(...this.labelNodeQuads(node.subject));
      // …and its own styles, with the label expressions they give, as when it is removed alone.
      quads.push(...this.ownStylesQuads(node.subject));
      quads.push(...this.blankStyleQuads(node.subject));
    }
    // …and every membership statement naming it. The concepts themselves stay.
    quads.push(...this.read(null, T.inView, view));
    // …and every reference to it from another view, which would open nothing once it is gone: removed as when it is
    // removed alone (core-vis-shapes 0.5.0 asks a reference for the view it opens).
    for (const reference of this.read(null, T.referencesView, view)) {
      const holder = this.objects(reference.subject, T.visView)[0];
      if (holder && holder !== viewIri) quads.push(...this.collectNodeQuads(holder, reference.subject.value));
    }
    // …and the relationships it is an end of, which cannot outlive it, as an element's cannot (VC-DD-7) — with a
    // concept's `arch:refinedInto` it, which another tool may write without one (its `arch:refines` is its own).
    for (const relationship of relationshipsTouching(this.store, viewIri)) {
      quads.push(...collectRelationshipQuads(this.store, relationship));
    }
    quads.push(...this.read(null, T.refinedInto, view));
    return dedupe(quads);
  }

  duplicateView(viewIri: string, label?: string): NamedNode {
    const source = this.getView(viewIri);
    if (!source) throw new Error(`Not a view: <${viewIri}>`);
    const copy = this.createView(source.type, source.viewpointIri, {
      label: label ?? `${source.label || 'View'} (copy)`,
      ...(source.modelIri ? { modelIri: source.modelIri } : {}),
    });
    // Every node and link placed again, as paste places a copy's (`placement-copy.ts`).
    copyPlacements(this, viewIri, this, copy.value);
    // A catalog or matrix lists concepts without geometry: copy the membership.
    for (const q of this.read(null, T.inView, nn(viewIri))) {
      this.store.addQuads([triple(q.subject, T.inView, copy)]);
    }
    return copy;
  }

  // ── Nodes ──────────────────────────────────────────────────────────────

  addElementToView(
    viewIri: string,
    elementIri: string,
    bounds: Bounds = DEFAULT_BOUNDS,
    options: { another?: boolean; iri?: string } = {},
  ): string {
    const existing = options.another ? undefined : this.getNode(viewIri, elementIri);
    if (existing) return existing.nodeIri;

    const view = nn(viewIri);
    const element = nn(elementIri);
    const nodeIri = options.iri ?? this.mintShape(viewIri, 'node');
    const node = nn(nodeIri);
    this.store.addQuads([
      triple(node, T.rdfType, T.ArchNode),
      triple(node, T.visView, view),
      triple(node, T.archElement, element),
      ...boundsQuads(node, bounds),
      triple(element, T.inView, view),
    ]);
    return nodeIri;
  }

  addFigure(viewIri: string, figure: FigureInfo & { bounds: Bounds; parentIri?: string }, iri?: string): string {
    const view = nn(viewIri);
    const nodeIri = iri ?? this.mintShape(viewIri, 'node');
    const node = nn(nodeIri);
    // A reference opening no view is a note: text, standing for nothing (core-vis-shapes 0.5.0).
    const opens = figure.kind === 'reference' ? figure.view : undefined;
    const type = opens ? T.ViewReferenceNode : figure.kind === 'note' || figure.kind === 'reference' ? T.LabelNode : T.ContainerNode;
    const quads: Quad[] = [triple(node, T.rdfType, type), triple(node, T.visView, view), ...boundsQuads(node, figure.bounds)];
    if (opens) {
      // It stands for the view it opens, which is presented in this one, as an element's placement presents the
      // element (`arch:inView`, DD-30) — unless it opens the view it is drawn in.
      quads.push(triple(node, T.referencesView, nn(opens)));
      if (opens !== viewIri) quads.push(triple(nn(opens), T.inView, view));
    }
    if (figure.kind === 'shape' && figure.shapeType) {
      const style = nn(this.styleIriOf(nodeIri));
      quads.push(triple(node, T.visStyle, style), triple(style, T.rdfType, T.Style), triple(style, T.shapeType, nn(figure.shapeType)));
    }
    // Its text as given — an empty one too: a reference's drawn as nothing, where none of its own shows its view's name.
    if (figure.text !== undefined) quads.push(triple(node, T.prefLabel, langLiteral(figure.text)));
    const [parentNode] = figure.parentIri ? this.nodeIrisFor(viewIri, figure.parentIri) : [];
    if (parentNode && parentNode !== nodeIri) quads.push(triple(node, T.inNode, nn(parentNode)));
    this.store.addQuads(quads);
    // How it looks, as a copied view's figure does.
    const appearance = appearanceOrNone(Object.fromEntries(APPEARANCE_KEYS.map((key) => [key, figure[key]])) as Appearance);
    if (appearance) this.setAppearance(viewIri, nodeIri, appearance);
    return nodeIri;
  }

  /** A connector's text, on a connector of this view; none removes it. */
  setConnectorText(viewIri: string, linkIri: string, text: string | undefined): void {
    const link = nn(linkIri);
    if (!this.objects(link, T.visView).includes(viewIri) || !this.objects(link, T.rdfType).includes(IRI.Link)) return;
    this.remove(this.read(link, T.prefLabel));
    if (text) this.store.addQuads([triple(link, T.prefLabel, langLiteral(text))]);
  }

  setFigureText(viewIri: string, nodeIri: string, text: string | undefined): void {
    if (!this.nodeIrisFor(viewIri, nodeIri).includes(nodeIri)) return;
    const node = nn(nodeIri);
    this.remove(this.read(node, T.prefLabel));
    if (text) this.store.addQuads([triple(node, T.prefLabel, langLiteral(text))]);
  }

  // ── References to other views (core-vis 0.9, Req 3.23) ─────────────────

  referencesTo(viewIri: string): ViewReferenceInfo[] {
    const references: ViewReferenceInfo[] = [];
    for (const q of this.read(null, T.referencesView, nn(viewIri))) {
      if (!this.objects(q.subject, T.rdfType).includes(IRI.ViewReferenceNode)) continue;
      for (const holderIri of this.objects(q.subject, T.visView)) references.push({ nodeIri: q.subject.value, holderIri });
    }
    return references.sort((a, b) => a.holderIri.localeCompare(b.holderIri) || a.nodeIri.localeCompare(b.nodeIri));
  }

  setReferenceView(holderIri: string, nodeIri: string, viewIri: string): void {
    const { removed, added } = this.setReferenceViewQuads(holderIri, nodeIri, viewIri);
    this.remove(removed);
    if (added.length > 0) this.store.addQuads(added);
  }

  setReferenceViewQuads(holderIri: string, nodeIri: string, viewIri: string): { removed: Quad[]; added: Quad[] } {
    const node = nn(nodeIri);
    const holder = nn(holderIri);
    const unchanged = { removed: [], added: [] };
    if (!this.objects(node, T.visView).includes(holderIri) || !this.objects(node, T.rdfType).includes(IRI.ViewReferenceNode)) return unchanged;
    // A reference opens exactly one view, one of the model's (core-vis-shapes 0.5.0).
    if (!this.getView(viewIri)) return unchanged;
    const current = this.read(node, T.referencesView);
    if (current.length === 1 && current[0]!.object.value === viewIri) return unchanged;
    const removed: Quad[] = [...current];
    const added: Quad[] = [triple(node, T.referencesView, nn(viewIri))];
    // The view it opened leaves the holder with its last reference there, as when the reference is removed…
    for (const opened of new Set(current.map((q) => q.object.value))) {
      if (opened === viewIri) continue;
      const others = this.read(null, T.referencesView, nn(opened)).filter(
        (q) => q.subject.value !== nodeIri && this.objects(q.subject, T.visView).includes(holderIri),
      );
      if (others.length === 0) removed.push(...this.read(nn(opened), T.inView, holder));
    }
    // …and the one it opens now is presented there, as when one is drawn — unless it is the holder (DD-42).
    if (viewIri !== holderIri && this.read(nn(viewIri), T.inView, holder).length === 0) {
      added.push(triple(nn(viewIri), T.inView, holder));
    }
    // The lines at it drew relationships of the view it opened: they go, as a line whose end is no longer placed
    // does (`refreshLinksOf`); a line standing for no relationship stays (VC-9).
    for (const end of [T.visSource, T.visTarget]) {
      for (const link of this.read(null, end, node)) {
        if (this.objects(link.subject, T.archRelationship).length > 0) removed.push(...this.linkQuads(link.subject, holder));
      }
    }
    return { removed: dedupe(removed), added };
  }

  viewsRefining(conceptIri: string): ViewInfo[] {
    // `V arch:refines X`, as la-gram writes it, or `X arch:refinedInto V`, as another tool may (VC-DD-6).
    const iris = new Set<string>();
    for (const q of this.read(null, T.refines, nn(conceptIri))) iris.add(q.subject.value);
    for (const q of this.read(nn(conceptIri), T.refinedInto, null)) iris.add(q.object.value);
    return [...iris]
      .flatMap((iri) => {
        const view = iri === conceptIri ? undefined : this.getView(iri);
        return view ? [view] : [];
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri));
  }

  removeElementFromView(viewIri: string, elementIri: string): void {
    this.remove(this.collectNodeQuads(viewIri, elementIri));
  }

  collectNodeQuads(viewIri: string, elementIri: string): Quad[] {
    const view = nn(viewIri);
    const quads: Quad[] = [];
    const nodeIris = this.nodeIrisFor(viewIri, elementIri);
    // Given one placement (a node), its element leaves the view with its last.
    const element = this.objects(nn(elementIri), T.archElement)[0];
    if (element) {
      quads.push(...this.placementQuads(view, nodeIris));
      const others = this.nodeIrisFor(viewIri, element).filter((n) => !nodeIris.includes(n));
      if (others.length === 0) quads.push(...this.read(nn(element), T.inView, view));
      return dedupe(quads);
    }
    quads.push(...this.placementQuads(view, nodeIris));
    if (nodeIris.length > 0) {
      quads.push(...this.read(nn(elementIri), T.inView, view));
    }
    // A referenced view leaves the view with its last reference there, as an element with its last placement.
    for (const nodeIri of nodeIris) {
      for (const opened of this.objects(nn(nodeIri), T.referencesView)) {
        const others = this.read(null, T.referencesView, nn(opened)).filter(
          (q) => !nodeIris.includes(q.subject.value) && this.objects(q.subject, T.visView).includes(viewIri),
        );
        if (others.length === 0) quads.push(...this.read(nn(opened), T.inView, view));
      }
    }
    return dedupe(quads);
  }

  /** The quads of these nodes: their own, a figure's style, what was inside them, links ending at them. */
  private placementQuads(view: NamedNode, nodeIris: readonly string[]): Quad[] {
    const quads: Quad[] = [];
    for (const nodeIri of nodeIris) {
      const node = nn(nodeIri);
      quads.push(...this.subjectQuads(node));
      // Its own styles go with it — a figure's shape type, a placement's colours, for every presentation context and
      // for each — with what its label says, and one a converter wrote for it alone.
      quads.push(...this.ownStylesQuads(node));
      quads.push(...this.blankStyleQuads(node));
      // What was drawn inside it is no longer inside anything.
      quads.push(...this.read(null, T.inNode, node));
      // Links ending at this node cannot outlive it.
      for (const end of [T.visSource, T.visTarget]) {
        for (const link of this.read(null, end, node)) {
          quads.push(...this.linkQuads(link.subject, view));
        }
      }
    }
    return quads;
  }

  getNodes(viewIri: string): NodeInfo[] {
    const known = this.cache?.get(viewIri)?.nodes;
    if (known) return known.slice();
    const nodes: NodeInfo[] = [];
    for (const q of this.read(null, T.visView, nn(viewIri))) {
      const info = this.readNode(q.subject);
      if (info) nodes.push(info);
    }
    this.remember(viewIri, { nodes });
    return nodes.slice();
  }

  private remember(viewIri: string, read: { nodes?: NodeInfo[]; links?: LinkInfo[] }): void {
    if (!this.cache) return;
    this.cache.set(viewIri, { ...this.cache.get(viewIri), ...read });
  }

  getNode(viewIri: string, elementIri: string): NodeInfo | undefined {
    const [nodeIri] = this.nodeIrisFor(viewIri, elementIri);
    return nodeIri ? this.readNode(nn(nodeIri)) : undefined;
  }

  setNodeParent(viewIri: string, elementIri: string, parentElementIri: string | undefined): void {
    const [nodeIri] = this.nodeIrisFor(viewIri, elementIri);
    if (!nodeIri) return;
    const node = nn(nodeIri);
    const [parentIri] = parentElementIri ? this.nodeIrisFor(viewIri, parentElementIri) : [];
    const current = this.read(node, T.inNode);
    if (current.length === 1 && current[0].object.value === parentIri) return;
    this.remove(current);
    if (parentIri && parentIri !== nodeIri) this.store.addQuads([triple(node, T.inNode, nn(parentIri))]);
  }

  updateNodeBounds(viewIri: string, elementIri: string, bounds: Bounds): void {
    const [nodeIri] = this.nodeIrisFor(viewIri, elementIri);
    if (!nodeIri) return;
    const node = nn(nodeIri);
    const stale: Quad[] = [];
    for (const predicate of BOUNDS_PREDICATES) {
      stale.push(...this.read(node, nn(predicate)));
    }
    this.remove(stale);
    this.store.addQuads(boundsQuads(node, bounds));
  }

  // ── Links ──────────────────────────────────────────────────────────────

  addRelationshipToView(
    viewIri: string,
    relationshipIri: string,
    waypoints?: Point[],
    ends: { sourceNodeIri?: string; targetNodeIri?: string } = {},
    options: { another?: boolean; iri?: string } = {},
  ): string | undefined {
    const existing = options.another ? undefined : this.linkIrisFor(viewIri, relationshipIri)[0];
    if (existing) {
      if (waypoints) this.updateLinkWaypoints(viewIri, relationshipIri, waypoints);
      return existing;
    }

    const relationship = nn(relationshipIri);
    const sourceIri = this.objects(relationship, T.source)[0];
    const targetIri = this.objects(relationship, T.target)[0];
    if (!sourceIri || !targetIri) return undefined;
    // The placements named, when they are the ends' in this view; else the ends' first.
    const placed = (given: string | undefined, concept: string) =>
      given && this.objects(nn(given), T.visView).includes(viewIri) && this.conceptOf(nn(given)) === concept ? given : undefined;
    const sourceNode = placed(ends.sourceNodeIri, sourceIri) ?? this.endFor(viewIri, sourceIri);
    const targetNode = placed(ends.targetNodeIri, targetIri) ?? this.endFor(viewIri, targetIri);
    // A link needs both ends drawn; the canvas adds the link once they are.
    if (!sourceNode || !targetNode) return undefined;

    const view = nn(viewIri);
    const linkIri = options.iri ?? this.mintShape(viewIri, 'link');
    const link = nn(linkIri);
    this.store.addQuads([
      triple(link, T.rdfType, T.Link),
      triple(link, T.visView, view),
      triple(link, T.archRelationship, relationship),
      triple(link, T.visSource, nn(sourceNode)),
      triple(link, T.visTarget, nn(targetNode)),
      triple(relationship, T.inView, view),
    ]);
    if (waypoints && waypoints.length > 0) this.writePoints(link, waypoints);
    return linkIri;
  }

  removeRelationshipFromView(viewIri: string, relationshipIri: string): void {
    this.remove(this.collectLinkQuads(viewIri, relationshipIri));
  }

  addConnector(
    viewIri: string,
    ends: { sourceNodeIri: string; targetNodeIri: string },
    waypoints?: Point[],
    iri?: string,
  ): string | undefined {
    // A node, or an element (its first placement), or a figure.
    const sourceNodeIri = this.nodeIrisFor(viewIri, ends.sourceNodeIri)[0];
    const targetNodeIri = this.nodeIrisFor(viewIri, ends.targetNodeIri)[0];
    if (!sourceNodeIri || !targetNodeIri || sourceNodeIri === targetNodeIri) return undefined;
    const linkIri = iri ?? this.mintShape(viewIri, 'link');
    const link = nn(linkIri);
    // A link with no arch-vis:archRelationship: drawing, no relationship in the model, no arch:inView.
    this.store.addQuads([
      triple(link, T.rdfType, T.Link),
      triple(link, T.visView, nn(viewIri)),
      triple(link, T.visSource, nn(sourceNodeIri)),
      triple(link, T.visTarget, nn(targetNodeIri)),
    ]);
    if (waypoints && waypoints.length > 0) this.writePoints(link, waypoints);
    return linkIri;
  }

  reconnectConnector(viewIri: string, linkIri: string, ends: { sourceNodeIri: string; targetNodeIri: string }): void {
    const link = nn(linkIri);
    if (!this.isConnector(link) || !this.objects(link, T.visView).includes(viewIri)) return;
    const sourceNodeIri = this.nodeIrisFor(viewIri, ends.sourceNodeIri)[0];
    const targetNodeIri = this.nodeIrisFor(viewIri, ends.targetNodeIri)[0];
    if (!sourceNodeIri || !targetNodeIri || sourceNodeIri === targetNodeIri) return;
    const stale: Quad[] = [];
    if (this.objects(link, T.visSource)[0] !== sourceNodeIri) stale.push(...this.read(link, T.visSource));
    if (this.objects(link, T.visTarget)[0] !== targetNodeIri) stale.push(...this.read(link, T.visTarget));
    if (stale.length === 0) return;
    this.remove(stale);
    this.store.addQuads([triple(link, T.visSource, nn(sourceNodeIri)), triple(link, T.visTarget, nn(targetNodeIri))]);
  }

  collectLinkQuads(viewIri: string, relationshipIri: string): Quad[] {
    const view = nn(viewIri);
    const quads: Quad[] = [];
    for (const linkIri of this.linkIrisFor(viewIri, relationshipIri)) {
      quads.push(...this.linkQuads(nn(linkIri), view));
    }
    return dedupe(quads);
  }

  getLinks(viewIri: string): LinkInfo[] {
    const known = this.cache?.get(viewIri)?.links;
    if (known) return known.slice();
    const links: LinkInfo[] = [];
    for (const q of this.read(null, T.visView, nn(viewIri))) {
      const info = this.readLink(q.subject);
      if (info) links.push(info);
    }
    const ordered = endsFirst(links);
    this.remember(viewIri, { links: ordered });
    return ordered.slice();
  }

  updateLinkWaypoints(viewIri: string, relationshipIri: string, waypoints: Point[]): void {
    const [linkIri] = this.linkIrisFor(viewIri, relationshipIri);
    if (!linkIri) return;
    this.rewritePoints(nn(linkIri), waypoints);
  }

  setLinkLabel(viewIri: string, relationshipIri: string, bounds: Bounds | undefined): void {
    const [linkIri] = this.linkIrisFor(viewIri, relationshipIri);
    if (!linkIri) return;
    const link = nn(linkIri);
    // Its own label keeps its name — `{link}-label`, or `{link}/label` under a link not named in a fragment.
    const own = this.objectTerms(link, T.visLabel).find((l) => l.termType === 'NamedNode' && isPartNamed(linkIri, l.value, 'label'));
    this.remove(this.labelNodeQuads(link));
    if (!bounds) return;
    const label = own ? (own as NamedNode) : nn(partIri(linkIri, 'label'));
    this.store.addQuads([
      triple(link, T.visLabel, label),
      triple(label, T.rdfType, T.LabelNode),
      triple(label, T.visView, nn(viewIri)),
      ...boundsQuads(label, bounds),
    ]);
  }

  refreshLinksOf(relationshipIri: string): void {
    const rel = nn(relationshipIri);
    const sourceIri = this.objects(rel, T.source)[0];
    const targetIri = this.objects(rel, T.target)[0];
    for (const q of this.read(null, T.archRelationship, rel)) {
      const link = q.subject as NamedNode;
      const viewIri = this.objects(link, T.visView)[0];
      if (!viewIri) continue;
      const sourceNode = sourceIri ? this.endFor(viewIri, sourceIri) : undefined;
      const targetNode = targetIri ? this.endFor(viewIri, targetIri) : undefined;
      if (!sourceNode || !targetNode) {
        // An end is not placed in this view: the link cannot stay.
        this.remove(this.linkQuads(link, nn(viewIri)));
        continue;
      }
      const stale: Quad[] = [];
      if (this.objects(link, T.visSource)[0] !== sourceNode) stale.push(...this.read(link, T.visSource));
      if (this.objects(link, T.visTarget)[0] !== targetNode) stale.push(...this.read(link, T.visTarget));
      if (stale.length === 0) continue;
      this.remove(stale);
      this.store.addQuads([triple(link, T.visSource, nn(sourceNode)), triple(link, T.visTarget, nn(targetNode))]);
    }
  }

  // ── Membership without geometry (catalogs and matrices) ────────────────

  /** The concepts a view presents (`arch:inView`). */
  getMembers(viewIri: string): string[] {
    return this.read(null, T.inView, nn(viewIri)).map((q) => q.subject.value);
  }

  /**
   * Present a concept in a view without placing it — `arch:inView` alone, which
   * is all a catalog or a matrix holds (idempotent).
   */
  addMember(viewIri: string, conceptIri: string): void {
    if (this.read(nn(conceptIri), T.inView, nn(viewIri)).length > 0) return;
    this.store.addQuads([triple(nn(conceptIri), T.inView, nn(viewIri))]);
  }

  /** Stop presenting a concept in a catalog or matrix: its `arch:inView`. */
  removeMember(viewIri: string, conceptIri: string): void {
    const quads = this.read(nn(conceptIri), T.inView, nn(viewIri));
    if (quads.length > 0) this.store.removeQuads(quads);
  }

  // ── Queries across views ───────────────────────────────────────────────

  viewsContaining(conceptIri: string): string[] {
    const views = new Set<string>();
    for (const q of this.read(nn(conceptIri), T.inView, null)) views.add(q.object.value);
    // Geometry without the membership triple (hand-written or imported data).
    for (const q of this.read(null, T.archElement, nn(conceptIri))) {
      for (const v of this.objects(q.subject, T.visView)) views.add(v);
    }
    for (const q of this.read(null, T.archRelationship, nn(conceptIri))) {
      for (const v of this.objects(q.subject, T.visView)) views.add(v);
    }
    // A view, by the references drawing it (VC-DD-1).
    for (const q of this.read(null, T.referencesView, nn(conceptIri))) {
      if (!this.objects(q.subject, T.rdfType).includes(IRI.ViewReferenceNode)) continue;
      for (const v of this.objects(q.subject, T.visView)) views.add(v);
    }
    return [...views].sort();
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private readNode(node: Term): NodeInfo | undefined {
    const figure = this.figureOf(node);
    const elementIri = figure ? node.value : this.objects(node, T.archElement)[0];
    if (!elementIri || (!figure && !this.objects(node, T.rdfType).includes(IRI.ArchNode))) return undefined;
    const bound = (predicate: string, fallback: number) =>
      numberOf(this.read(node as NamedNode, nn(predicate))[0]?.object) ?? fallback;
    const parentNode = this.read(node as NamedNode, T.inNode)[0]?.object;
    // The element drawn there — or, a figure, the node itself.
    const parentElementIri = parentNode
      ? (this.objects(parentNode, T.archElement)[0] ?? (this.figureOf(parentNode) ? parentNode.value : undefined))
      : undefined;
    // A placement's own look; a figure's is in its figure.
    const appearance = figure ? undefined : this.appearanceOf(node);
    // How it looks for each presentation — a figure's too; its look for every one is in its figure.
    const contextAppearances = this.contextAppearancesOf(node);
    const labelExpressions = figure ? [] : this.labelExpressionsOf(node);
    return {
      nodeIri: node.value,
      elementIri,
      ...(labelExpressions.length > 0 ? { labelExpressions } : {}),
      ...(contextAppearances ? { contextAppearances } : {}),
      ...(parentElementIri ? { parentElementIri, parentNodeIri: parentNode!.value } : {}),
      ...(figure ? { figure } : {}),
      ...(appearance ? { appearance } : {}),
      bounds: {
        x: bound(IRI.boundsX, DEFAULT_BOUNDS.x),
        y: bound(IRI.boundsY, DEFAULT_BOUNDS.y),
        width: bound(IRI.boundsW, DEFAULT_BOUNDS.width),
        height: bound(IRI.boundsH, DEFAULT_BOUNDS.height),
      },
    };
  }

  private readLink(link: Term): LinkInfo | undefined {
    const types = this.objects(link, T.rdfType);
    if (!types.includes(IRI.Link)) return undefined;
    // A link standing for no relationship is a connector: its own key, its ends nodes.
    const connector = this.objects(link, T.archRelationship).length === 0;
    const relationshipIri = connector ? link.value : this.objects(link, T.archRelationship)[0];
    const sourceNode = this.objectTerms(link, T.visSource)[0];
    const targetNode = this.objectTerms(link, T.visTarget)[0];
    if (!relationshipIri || !sourceNode || !targetNode) return undefined;
    const endOf = (node: Term) => (connector ? this.nodeConceptOf(node) : this.conceptOf(node));
    const sourceElementIri = endOf(sourceNode);
    const targetElementIri = endOf(targetNode);
    if (!sourceElementIri || !targetElementIri) return undefined;
    const appearance = this.appearanceOf(link);
    const contextAppearances = this.contextAppearancesOf(link);
    // A line from a note may say something: its text, as a figure's.
    const text = connector ? this.read(link as NamedNode, T.prefLabel)[0]?.object.value : undefined;
    return {
      ...(appearance ? { appearance } : {}),
      ...(contextAppearances ? { contextAppearances } : {}),
      ...(text ? { text } : {}),
      linkIri: link.value,
      relationshipIri,
      ...(connector ? { connector: true } : {}),
      sourceNodeIri: sourceNode.value,
      targetNodeIri: targetNode.value,
      sourceElementIri,
      targetElementIri,
      waypoints: this.readPoints(link),
      ...this.readLabel(link),
    };
  }

  /** Where a link's `arch-vis:LabelNode` puts its text, when it has one with a position. */
  private readLabel(link: Term): Pick<LinkInfo, 'label'> {
    // As a term: another tool's label node may be a blank node.
    const label = this.objectTerms(link, T.visLabel)[0];
    if (!label) return {};
    const bound = (predicate: NamedNode) => numberOf(this.read(label as NamedNode, predicate)[0]?.object);
    const x = bound(T.boundsX);
    const y = bound(T.boundsY);
    if (x === undefined || y === undefined) return {};
    return { label: { x, y, width: bound(T.boundsW) ?? 0, height: bound(T.boundsH) ?? 0 } };
  }

  /** A link's `arch-vis:label` statements and its label nodes' own quads. */
  private labelNodeQuads(link: Term): Quad[] {
    const quads = this.read(link as NamedNode, T.visLabel);
    for (const q of [...quads]) quads.push(...this.read(q.object as NamedNode));
    return quads;
  }

  /**
   * The link's own quads, its route, and the relationship's membership in the
   * view — and the same for every link ending on it, which cannot outlive it.
   */
  private linkQuads(link: Term, view: NamedNode, seen: Set<string> = new Set()): Quad[] {
    if (seen.has(link.value)) return [];
    seen.add(link.value);
    const quads = [
      ...this.subjectQuads(link),
      ...this.pointListQuads(link),
      ...this.labelNodeQuads(link),
      ...this.blankStyleQuads(link),
      // Its own styles — for every presentation context and for each — its look in this view.
      ...this.ownStylesQuads(link),
    ];
    for (const relationshipIri of this.objects(link, T.archRelationship)) {
      // Only drop inView when this is the relationship's last link in the view.
      const others = this.linkIrisFor(view.value, relationshipIri).filter((iri) => iri !== link.value);
      if (others.length === 0) quads.push(...this.read(nn(relationshipIri), T.inView, view));
    }
    for (const end of [T.visSource, T.visTarget]) {
      for (const attached of this.read(null, end, link)) quads.push(...this.linkQuads(attached.subject, view, seen));
    }
    return quads;
  }

  /**
   * What stands for a concept in a view, for a link to end on: the element's
   * node, or — for a relationship whose end is a relationship — that
   * relationship's link.
   */
  private endFor(viewIri: string, conceptIri: string): string | undefined {
    return this.nodeIrisFor(viewIri, conceptIri)[0] ?? this.linkIrisFor(viewIri, conceptIri)[0];
  }

  /** The concept a link's end stands for: a node's element — a reference's view — or a link's relationship. */
  private conceptOf(end: Term): string | undefined {
    return this.objects(end, T.archElement)[0] ?? this.objects(end, T.archRelationship)[0] ?? this.viewOf(end);
  }

  /** The view a reference node opens: the concept it stands for, as an ArchNode's element (VC-DD-1). */
  private viewOf(node: Term): string | undefined {
    return this.objects(node, T.rdfType).includes(IRI.ViewReferenceNode) ? this.objects(node, T.referencesView)[0] : undefined;
  }

  /** What a connector's end, a node, is keyed by: its element — or, a figure, the node itself. */
  private nodeConceptOf(node: Term): string | undefined {
    return this.objects(node, T.archElement)[0] ?? (this.figureOf(node) ? node.value : undefined);
  }

  /** Whether a link stands for no relationship: a connector. */
  private isConnector(link: Term): boolean {
    return this.objects(link, T.rdfType).includes(IRI.Link) && this.objects(link, T.archRelationship).length === 0;
  }

  private nodeIrisFor(viewIri: string, elementIri: string): string[] {
    const view = viewIri;
    // A node — an element's placement — keys itself.
    const asNode = nn(elementIri);
    if (this.objects(asNode, T.archElement).length > 0 && this.objects(asNode, T.visView).includes(view)) return [elementIri];
    const nodes = this.store
      .getQuads(null, T.archElement, nn(elementIri))
      .map((q) => q.subject)
      .filter((node) => this.objects(node, T.visView).includes(view))
      .map((node) => node.value);
    if (nodes.length > 0) return nodes;
    // A figure stands for no element: its node is its own key.
    const node = nn(elementIri);
    if (this.objects(node, T.visView).includes(view) && this.figureOf(node)) return [elementIri];
    // A view's placements are the references to it there (VC-DD-1).
    return this.read(null, T.referencesView, node)
      .map((q) => q.subject)
      .filter((reference) => this.objects(reference, T.visView).includes(view) && this.viewOf(reference) === elementIri)
      .map((reference) => reference.value);
  }

  /**
   * What a node is when it stands for no model element: a group or a shape (an
   * `arch-vis:ContainerNode`, with a shape type or without), a note (an
   * `arch-vis:LabelNode` that is no diagram element's `arch-vis:label`), or a
   * reference to another view (an `arch-vis:ViewReferenceNode`, core-vis 0.9).
   */
  private figureOf(node: Term): FigureInfo | undefined {
    const types = this.objects(node, T.rdfType);
    const style = this.styleOf(node);
    // How it looks, from its style for every presentation context.
    const colours: Appearance = style ? this.appearanceOfStyle(style) : {};
    if (types.includes(IRI.ContainerNode) && this.objects(node, T.archElement).length === 0) {
      const text = this.read(node as NamedNode, T.prefLabel)[0]?.object.value;
      const shapeType = style ? this.objects(style, T.shapeType)[0] : undefined;
      return { kind: shapeType ? 'shape' : 'group', ...(shapeType ? { shapeType } : {}), ...(text !== undefined ? { text } : {}), ...colours };
    }
    if (types.includes(IRI.ViewReferenceNode)) {
      const text = this.read(node as NamedNode, T.prefLabel)[0]?.object.value;
      const view = this.objects(node, T.referencesView)[0];
      return { kind: 'reference', ...(view ? { view } : {}), ...(text !== undefined ? { text } : {}), ...colours };
    }
    if (types.includes(IRI.LabelNode) && this.read(null, T.visLabel, node as NamedNode).length === 0) {
      const text = this.read(node as NamedNode, T.prefLabel)[0]?.object.value;
      return { kind: 'note', ...(text !== undefined ? { text } : {}), ...colours };
    }
    return undefined;
  }

  setFigureColours(viewIri: string, nodeIri: string, colours: { [K in keyof FigureColours]?: string | null }): void {
    if (!this.nodeIrisFor(viewIri, nodeIri).includes(nodeIri) || !this.figureOf(nn(nodeIri))) return;
    this.setAppearance(viewIri, nodeIri, colours);
  }

  setAppearance(viewIri: string, iri: string, changes: AppearanceChanges, context?: string): void {
    const subject = nn(iri);
    // A node or a link of this view, named by its own IRI.
    if (!this.objects(subject, T.visView).includes(viewIri)) return;
    if (!this.readNode(subject) && !this.objects(subject, T.rdfType).includes(IRI.Link)) return;
    const keys = APPEARANCE_KEYS.filter((key) => changes[key] !== undefined);
    if (keys.length === 0) return;
    // A line's text put somewhere else along it: no longer where it was moved by hand.
    const current = context ? this.contextAppearancesOf(subject)?.[context] : this.appearanceOf(subject);
    if (keys.includes('labelAnchor') && (current?.labelAnchor ?? null) !== (changes.labelAnchor ?? null)) {
      this.remove(this.labelNodeQuads(subject));
    }
    // Its style for that presentation context (core-vis 0.7), else its own for every context.
    const style = context ? this.contextStyle(subject, context) : this.ownStyle(subject);
    for (const key of keys) {
      const predicate = nn(APPEARANCE_PREDICATES[key]);
      const value = changes[key];
      const object = value === null || value === undefined ? undefined : appearanceObject(key, value);
      // A value that is not one of the key's — a picture's address that is none — changes nothing.
      if (value !== null && !object) continue;
      this.remove(this.read(style, predicate));
      if (!object) continue;
      const term =
        'iri' in object
          ? nn(object.iri)
          : 'integer' in object
            ? DataFactory.literal(String(object.integer), nn(NAMESPACES.xsd + 'integer'))
            : 'uri' in object
              ? DataFactory.literal(object.uri, nn(NAMESPACES.xsd + 'anyURI'))
              : 'boolean' in object
                ? DataFactory.literal(String(object.boolean), nn(NAMESPACES.xsd + 'boolean'))
                : DataFactory.literal(object.string);
      this.store.addQuads([triple(style, predicate, term)]);
    }
    // Nothing left to say — but what it is, and the context it is for: no such style at all.
    if (this.read(style).every((q) => q.predicate.value === IRI.rdfType || q.predicate.value === IRI.inPresentationContext)) {
      this.remove([...this.read(style), ...this.read(subject, T.visStyle, style)]);
    }
  }

  /**
   * A node's or a link's style for `context` (core-vis 0.7: `arch:inPresentationContext`
   * on the style) — or, `context` absent, its style for every context, the one
   * without. `undefined` when it has none.
   */
  private styleOf(subject: Term, context?: string): Term | undefined {
    return this.read(subject as NamedNode, T.visStyle)
      .map((q) => q.object)
      .find((style) => this.objects(style, T.inPresentationContext)[0] === context);
  }

  /** Its style for `context`, to write on: made when it has none, named after it and the context, `{subject}/style/{hash}`. */
  private contextStyle(subject: NamedNode, context: string): NamedNode {
    const found = this.styleOf(subject, context);
    if (found && found.termType === 'NamedNode') return found as NamedNode;
    const style = nn(partIri(this.styleIriOf(subject.value), shortHash(context)));
    this.store.addQuads([
      triple(subject, T.visStyle, style),
      triple(style, T.rdfType, T.Style),
      triple(style, T.inPresentationContext, nn(context)),
    ]);
    return style;
  }

  /** How a node or a link looks in each presentation context it has a style for; `undefined` with none. */
  private contextAppearancesOf(subject: Term): Record<string, Appearance> | undefined {
    const looks: Record<string, Appearance> = {};
    for (const q of this.read(subject as NamedNode, T.visStyle)) {
      const context = this.objects(q.object, T.inPresentationContext)[0];
      const look = context ? appearanceOrNone(this.appearanceOfStyle(q.object)) : undefined;
      if (context && look) looks[context] = look;
    }
    return Object.keys(looks).length > 0 ? looks : undefined;
  }

  usedImages(): string[] {
    // A picture in a node, and a placement's own icon — a style a diagram element hangs, not a notation's glyph.
    const own = this.read(null, nn(APPEARANCE_PREDICATES.iconSymbol)).filter(
      (q) => this.read(null, T.visStyle, q.subject as NamedNode).length > 0,
    );
    const images = [...this.read(null, nn(APPEARANCE_PREDICATES.image)), ...own]
      .map((q) => appearanceValue('image', q.object))
      .filter((uri): uri is string => uri !== undefined);
    // And the model's elements' own pictures (core 0.5.0) — not a notation's, about a type.
    for (const predicate of [T.prefVisNotation, T.altVisNotation]) {
      for (const q of this.read(null, predicate)) {
        if (q.graph.termType !== 'DefaultGraph' || this.read(q.subject as NamedNode, T.inModel).length === 0) continue;
        images.push(...picturesOf(this.store, q.subject.value).map((p) => p.url));
      }
    }
    return [...new Set(images)].sort();
  }

  setLabelExpression(viewIri: string, nodeIri: string, context: string | undefined, expression: string | null): void {
    const subject = nn(nodeIri);
    if (!this.objects(subject, T.visView).includes(viewIri) || !this.readNode(subject) || this.figureOf(subject)) return;
    const text = expression?.replace(/\r\n?/g, '\n') ?? '';
    // The one it has for that context goes — a blank node another tool wrote too, when nothing else points at it.
    // One named as the node's own keeps its name for what replaces it.
    let kept: NamedNode | undefined;
    const style = this.styleOf(subject);
    if (style) {
      for (const q of this.read(style as NamedNode, T.labelExpression)) {
        const scope = this.objects(q.object, T.inPresentationContext)[0];
        if (scope !== context) continue;
        const shared = this.read(null, T.labelExpression, q.object as NamedNode).length > 1;
        this.remove([q, ...(shared ? [] : this.read(q.object as NamedNode))]);
        if (!shared && q.object.termType === 'NamedNode' && isPartNamed(nodeIri, q.object.value, 'label-expression', CONTEXT_KEY)) {
          kept = q.object as NamedNode;
        }
      }
    }
    if (text.trim() !== '') {
      const own = this.ownStyle(subject);
      const label = kept ?? nn(this.labelExpressionIriOf(nodeIri, context));
      this.store.addQuads([
        triple(own, T.labelExpression, label),
        triple(label, T.rdfType, T.LabelExpression),
        triple(label, T.expression, DataFactory.literal(text)),
        ...(context ? [triple(label, T.inPresentationContext, nn(context))] : []),
      ]);
    }
    // Nothing left to say: no style at all.
    const left = this.styleOf(subject);
    if (left && this.read(left as NamedNode).every((q) => q.predicate.value === IRI.rdfType)) {
      this.remove([...this.read(left as NamedNode), ...this.read(subject, T.visStyle, left as NamedNode)]);
    }
  }

  /**
   * The quads of a node's or a link's own styles — named after it, for every
   * presentation context and for each — with the label expressions they give.
   */
  private ownStylesQuads(subject: Term): Quad[] {
    const quads: Quad[] = [];
    for (const q of this.read(subject as NamedNode, T.visStyle)) {
      if (!this.isOwnStyle(subject.value, q.object)) continue;
      quads.push(...this.read(q.object as NamedNode));
      for (const label of this.read(q.object as NamedNode, T.labelExpression)) quads.push(...this.read(label.object as NamedNode));
    }
    return quads;
  }

  /**
   * Whether `style` is `owner`'s own by its name, matched exactly: `{owner}-style` — la-gram's and the
   * converters' for a shape named in its view — or `{owner}-style-{hash}` for a presentation context; or the
   * same joined with `/`, as under a shape not named in a fragment. Not a prefix: `{owner}-style-x` of another
   * node is not.
   */
  private isOwnStyle(owner: string, style: Term): boolean {
    return style.termType === 'NamedNode' && isPartNamed(owner, style.value, 'style', CONTEXT_KEY);
  }

  /**
   * A placement's own label expression, named after it — and the context it is for, when it is for one — so it
   * goes with it: `{node}-label-expression`, `{node}-label-expression-{hash}`.
   */
  private labelExpressionIriOf(nodeIri: string, context: string | undefined): string {
    return context ? partIri(nodeIri, 'label-expression', shortHash(context)) : partIri(nodeIri, 'label-expression');
  }

  /** The label expressions a node's own style points at. */
  private ownLabelExpressions(node: Term): Term[] {
    const style = this.styleOf(node);
    return style ? this.read(style as NamedNode, T.labelExpression).map((q) => q.object) : [];
  }

  /** What a node's own style says its label says. */
  private labelExpressionsOf(node: Term): LabelExpressionInfo[] {
    const labels: LabelExpressionInfo[] = [];
    for (const label of this.ownLabelExpressions(node)) {
      const expression = this.read(label as NamedNode, T.expression)[0]?.object.value;
      if (expression === undefined) continue;
      const context = this.objects(label, T.inPresentationContext)[0];
      labels.push({ expression, ...(context ? { context } : {}) });
    }
    // For every context last: one for the context shown is found first.
    return labels.sort((a, b) => (a.context ? 0 : 1) - (b.context ? 0 : 1) || (a.context ?? '').localeCompare(b.context ?? ''));
  }

  /** How a node or a link looks, from its own style; `undefined` when it sets nothing. */
  private appearanceOf(subject: Term): Appearance | undefined {
    const style = this.styleOf(subject);
    return style ? appearanceOrNone(this.appearanceOfStyle(style)) : undefined;
  }

  /** What a style says of how its node or link looks. */
  private appearanceOfStyle(style: Term): Appearance {
    const appearance: Record<string, unknown> = {};
    for (const key of APPEARANCE_KEYS) {
      const term = this.read(style as NamedNode, nn(APPEARANCE_PREDICATES[key]))[0]?.object;
      const value = term ? appearanceValue(key, term) : undefined;
      if (value !== undefined) appearance[key] = value;
    }
    return appearance as Appearance;
  }

  /** A node's or a link's own style — a figure's shape type, a placement's colours — named after it, so it goes with it: `{iri}-style`. */
  private styleIriOf(iri: string): string {
    return partIri(iri, 'style');
  }

  /**
   * A node's or a link's own style, to write on: made when it has none. Its own
   * by name — `{subject}/style`, or `{subject}-style` as la-gram named it before —
   * is written on in place. One another tool wrote — a blank node, or a style
   * others share — is copied to its own first, so a change is to this one alone
   * and keeps what the style said (its shape type, its font).
   */
  private ownStyle(subject: NamedNode): NamedNode {
    // Its styles for every presentation context — not one for a context, which stays as it is.
    const current = this.read(subject, T.visStyle).filter((q) => this.objects(q.object, T.inPresentationContext).length === 0);
    if (current.length === 1 && this.isOwnStyle(subject.value, current[0]!.object)) return current[0]!.object as NamedNode;
    const own = nn(this.styleIriOf(subject.value));
    const quads: Quad[] = [triple(subject, T.visStyle, own), triple(own, T.rdfType, T.Style)];
    for (const q of current) {
      for (const said of this.read(q.object)) {
        if (said.predicate.value !== IRI.rdfType) quads.push(triple(own, said.predicate as NamedNode, said.object));
      }
    }
    // What it replaces goes: a blank style only it used, and one named as its own — not a style others share.
    const replaced = current.flatMap((q) =>
      this.isOwnStyle(subject.value, q.object) && q.object.value !== own.value ? this.read(q.object as NamedNode) : this.ownedBlankStyle(q.object),
    );
    this.remove([...current, ...replaced]);
    this.store.addQuads(dedupe(quads));
    return own;
  }

  /** A blank-node style only `style` names — a converter's — whose quads go with what it styles. */
  private ownedBlankStyle(style: Term): Quad[] {
    if (style.termType !== 'BlankNode' || this.read(null, T.visStyle, style).length !== 1) return [];
    return this.read(style);
  }

  /** The quads of the styles `subject` alone uses as blank nodes. */
  private blankStyleQuads(subject: Term): Quad[] {
    return this.read(subject as NamedNode, T.visStyle).flatMap((q) => this.ownedBlankStyle(q.object));
  }

  private linkIrisFor(viewIri: string, relationshipIri: string): string[] {
    // A link — one line of a relationship — keys itself.
    const asLink = nn(relationshipIri);
    if (
      (this.objects(asLink, T.archRelationship).length > 0 || this.isConnector(asLink)) &&
      this.objects(asLink, T.visView).includes(viewIri)
    )
      return [relationshipIri];
    return this.store
      .getQuads(null, T.archRelationship, nn(relationshipIri))
      .map((q) => q.subject)
      .filter((link) => this.objects(link, T.visView).includes(viewIri))
      .map((link) => link.value);
  }

  /** A new node's or link's IRI, in its view's: `{view}#node-{uuid}` (`mintShapeIri`). */
  private mintShape(viewIri: string, kind: ShapeKind): string {
    return mintShapeIri(viewIri, kind, () => viewNamespace(this.store, viewIri));
  }

  /** Write `waypoints` as an IRI-celled `rdf:List` of `arch-vis:Point`s, named `{link}-points-{i}` and `{link}-point-{i}`. */
  private writePoints(link: NamedNode, waypoints: Point[]): void {
    this.store.addQuads(this.routeQuads(link, waypoints, ROUTE_NAMES[0]));
  }

  /** The quads of a route through `waypoints` with its cells and points named by `names`. */
  private routeQuads(link: NamedNode, waypoints: Point[], names: RouteNames): Quad[] {
    if (waypoints.length === 0) return [];
    const cell = (i: number) => nn(names.cell(link.value, i));
    const point = (i: number) => nn(names.point(link.value, i));
    const quads: Quad[] = [triple(link, T.points, cell(0))];
    waypoints.forEach((wp, i) => {
      quads.push(
        triple(cell(i), T.rdfFirst, point(i)),
        triple(cell(i), T.rdfRest, i === waypoints.length - 1 ? T.rdfNil : cell(i + 1)),
        triple(point(i), T.rdfType, T.Point),
        triple(point(i), T.pointX, doubleLiteral(Math.round(wp.x))),
        triple(point(i), T.pointY, doubleLiteral(Math.round(wp.y))),
      );
    });
    return quads;
  }

  /**
   * How a link's route is named, when every cell and point is named under the link in one of
   * {@link ROUTE_NAMES}' patterns, counting from 0; `undefined` for no route, or one named otherwise.
   */
  private routeNamesOf(link: NamedNode): RouteNames | undefined {
    const cells = this.listCells(link);
    if (cells.length === 0) return undefined;
    return ROUTE_NAMES.find((names) =>
      cells.every((cell, i) => {
        if (cell.termType !== 'NamedNode' || cell.value !== names.cell(link.value, i)) return false;
        const points = this.objectTerms(cell, T.rdfFirst);
        return points.length === 1 && points[0]!.termType === 'NamedNode' && points[0]!.value === names.point(link.value, i);
      }),
    );
  }

  /**
   * A link's route changed to `waypoints`. A route named under its link keeps its names, la-gram's and the
   * converters' alike, and only what differs is written: a moved bend is its point's coordinates. A route
   * named otherwise — blank nodes, another tool's names — is written anew under la-gram's.
   */
  private rewritePoints(link: NamedNode, waypoints: Point[]): void {
    const old = [...this.read(link, T.points), ...this.pointListQuads(link)];
    const names = this.routeNamesOf(link);
    if (!names) {
      this.remove(old);
      if (waypoints.length > 0) this.writePoints(link, waypoints);
      return;
    }
    const next = this.routeQuads(link, waypoints, names);
    const wanted = new Set(next.map(quadKey));
    const had = new Set(old.map(quadKey));
    this.remove(old.filter((q) => !wanted.has(quadKey(q))));
    const added = next.filter((q) => !had.has(quadKey(q)));
    if (added.length > 0) this.store.addQuads(added);
  }

  private readPoints(link: Term): Point[] {
    const points: Point[] = [];
    for (const cell of this.listCells(link)) {
      // As terms throughout: another tool's list may have blank-node cells and points.
      const point = this.objectTerms(cell, T.rdfFirst)[0];
      if (point) {
        const x = numberOf(this.read(point as NamedNode, T.pointX)[0]?.object);
        const y = numberOf(this.read(point as NamedNode, T.pointY)[0]?.object);
        if (x !== undefined && y !== undefined) points.push({ x, y });
      }
    }
    return points;
  }

  /**
   * The cells of a link's `arch-vis:points` list, in order — named or blank (la-gram
   * names its own, `writePoints`; a converter's may be blank nodes). Stops at
   * `rdf:nil`, and at a cell seen before.
   */
  private listCells(link: Term): Term[] {
    const cells: Term[] = [];
    const seen = new Set<string>();
    let cell = this.objectTerms(link, T.points)[0];
    while (cell && !(cell.termType === 'NamedNode' && cell.value === IRI.rdfNil)) {
      const key = `${cell.termType}:${cell.value}`;
      if (seen.has(key)) break;
      seen.add(key);
      cells.push(cell);
      cell = this.objectTerms(cell, T.rdfRest)[0];
    }
    return cells;
  }

  /** The list cells and points hanging off a link's `arch-vis:points`. */
  private pointListQuads(link: Term): Quad[] {
    const quads: Quad[] = [];
    for (const cell of this.listCells(link)) {
      for (const point of this.objectTerms(cell, T.rdfFirst)) quads.push(...this.read(point as NamedNode));
      quads.push(...this.read(cell as NamedNode));
    }
    return quads;
  }

  private subjectQuads(subject: Term): Quad[] {
    return this.read(subject as NamedNode, null, null);
  }

  private objects(subject: Term, predicate: NamedNode): string[] {
    return this.read(subject as NamedNode, predicate).map((q) => q.object.value);
  }

  /** The objects as terms: a blank node stays one, where `objects`' values would lose it. */
  private objectTerms(subject: Term, predicate: NamedNode): Term[] {
    return this.read(subject as NamedNode, predicate).map((q) => q.object);
  }

  /** Set a single-valued property (or clear it with `undefined`). */
  private replace(subject: NamedNode, predicate: NamedNode, value: Term | undefined): void {
    this.remove(this.read(subject, predicate));
    if (value) this.store.addQuads([triple(subject, predicate, value)]);
  }

  private remove(quads: Quad[]): void {
    if (quads.length > 0) this.store.removeQuads(quads);
  }
}

/** The four bounds triples for a node. */
function boundsQuads(node: NamedNode, bounds: Bounds): Quad[] {
  return [
    triple(node, T.boundsX, doubleLiteral(Math.round(bounds.x))),
    triple(node, T.boundsY, doubleLiteral(Math.round(bounds.y))),
    triple(node, T.boundsW, doubleLiteral(Math.round(bounds.width))),
    triple(node, T.boundsH, doubleLiteral(Math.round(bounds.height))),
  ];
}

/**
 * Links in an order a canvas can draw them in: each after the links it ends on.
 * A link ending on one that is not in the list, or in a cycle, keeps its place
 * at the end.
 */
export function endsFirst(links: readonly LinkInfo[]): LinkInfo[] {
  const byRelationship = new Map(links.map((link) => [link.relationshipIri, link]));
  const ordered: LinkInfo[] = [];
  const placed = new Set<LinkInfo>();
  const visiting = new Set<LinkInfo>();
  const visit = (link: LinkInfo): void => {
    if (placed.has(link) || visiting.has(link)) return;
    visiting.add(link);
    for (const end of [link.sourceElementIri, link.targetElementIri]) {
      const under = byRelationship.get(end);
      if (under && under !== link) visit(under);
    }
    visiting.delete(link);
    placed.add(link);
    ordered.push(link);
  };
  for (const link of links) visit(link);
  return ordered;
}

/**
 * Add relationships to a view, each once the links it ends on are there: a
 * relationship ending on another is drawn after it, whatever order they come
 * in. Returns how many were drawn.
 */
export function addRelationshipsToView(
  views: Pick<ViewManager, 'addRelationshipToView'>,
  viewIri: string,
  relationshipIris: readonly string[],
  waypointsOf: (relationshipIri: string) => Point[] | undefined = () => undefined,
  endsOf: (relationshipIri: string) => { sourceNodeIri?: string; targetNodeIri?: string } | undefined = () => undefined,
): number {
  let pending = [...relationshipIris];
  let drawn = 0;
  for (;;) {
    const waiting = pending.filter((iri) => {
      if (!views.addRelationshipToView(viewIri, iri, waypointsOf(iri), endsOf(iri))) return true;
      drawn += 1;
      return false;
    });
    if (waiting.length === pending.length) return drawn;
    pending = waiting;
  }
}
