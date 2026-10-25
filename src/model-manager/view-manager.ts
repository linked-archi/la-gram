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
 * m:view-…  a arch:View, arch:Diagram ;
 *         arch:inModel m:model ;
 *         skos:prefLabel "Application Cooperation"@en ;
 *         arch:viewConformsToViewpoint am4vp:ApplicationCooperationViewpoint .
 *
 * m:element-…  arch:inView m:view-… .                 # membership, survives geometry loss
 *
 * m:node-…  a arch-vis:ArchNode ;                     # geometry
 *         arch-vis:view m:view-… ;
 *         arch-vis:archElement m:element-… ;
 *         arch-vis:bounds-x 40.0 ; … bounds-y, bounds-w, bounds-h .
 *
 * m:link-…  a arch-vis:Link ;
 *         arch-vis:view m:view-… ;
 *         arch-vis:archRelationship m:relationship-… ;
 *         arch-vis:source m:node-… ; arch-vis:target m:node-… ;
 *         arch-vis:points m:link-…-points-0 .         # optional route: m:link-…-p0, -p1 …
 * ```
 *
 * Nodes and links are minted in the view's model's namespace, like everything
 * else in the model (`rdf-engine/iri.ts`).
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

import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { mintIri } from '../rdf-engine/iri.js';
import { modelNamespace, viewNamespace } from './model-namespace.js';
import type {
  Bounds,
  LinkInfo,
  NodeInfo,
  Point,
  ViewInfo,
  ViewKind,
  ViewManager,
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
  triple,
} from './vocabulary.js';

/** The default graph: the model. */
const MODEL_GRAPH = { termType: 'DefaultGraph', value: '' } as unknown as NamedNode;

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
  constructor(private readonly store: RdfStore) {}

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
    }
    // …and every membership statement naming it. The concepts themselves stay.
    quads.push(...this.read(null, T.inView, view));
    return dedupe(quads);
  }

  duplicateView(viewIri: string, label?: string): NamedNode {
    const source = this.getView(viewIri);
    if (!source) throw new Error(`Not a view: <${viewIri}>`);
    const copy = this.createView(source.type, source.viewpointIri, {
      label: label ?? `${source.label || 'View'} (copy)`,
      ...(source.modelIri ? { modelIri: source.modelIri } : {}),
    });
    const nodes = this.getNodes(viewIri);
    for (const node of nodes) {
      this.addElementToView(copy.value, node.elementIri, node.bounds);
    }
    for (const node of nodes) {
      if (node.parentElementIri) this.setNodeParent(copy.value, node.elementIri, node.parentElementIri);
    }
    for (const link of this.getLinks(viewIri)) {
      this.addRelationshipToView(copy.value, link.relationshipIri, link.waypoints);
    }
    // A catalog or matrix lists concepts without geometry: copy the membership.
    for (const q of this.read(null, T.inView, nn(viewIri))) {
      this.store.addQuads([triple(q.subject, T.inView, copy)]);
    }
    return copy;
  }

  // ── Nodes ──────────────────────────────────────────────────────────────

  addElementToView(viewIri: string, elementIri: string, bounds: Bounds = DEFAULT_BOUNDS): string {
    const existing = this.getNode(viewIri, elementIri);
    if (existing) return existing.nodeIri;

    const view = nn(viewIri);
    const element = nn(elementIri);
    const nodeIri = mintIri(viewNamespace(this.store, viewIri), 'node');
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

  removeElementFromView(viewIri: string, elementIri: string): void {
    this.remove(this.collectNodeQuads(viewIri, elementIri));
  }

  collectNodeQuads(viewIri: string, elementIri: string): Quad[] {
    const view = nn(viewIri);
    const quads: Quad[] = [];
    const nodeIris = this.nodeIrisFor(viewIri, elementIri);
    for (const nodeIri of nodeIris) {
      const node = nn(nodeIri);
      quads.push(...this.subjectQuads(node));
      // What was drawn inside it is no longer inside anything.
      quads.push(...this.read(null, T.inNode, node));
      // Links ending at this node cannot outlive it.
      for (const end of [T.visSource, T.visTarget]) {
        for (const link of this.read(null, end, node)) {
          quads.push(...this.linkQuads(link.subject, view));
        }
      }
    }
    if (nodeIris.length > 0) {
      quads.push(...this.read(nn(elementIri), T.inView, view));
    }
    return dedupe(quads);
  }

  getNodes(viewIri: string): NodeInfo[] {
    const nodes: NodeInfo[] = [];
    for (const q of this.read(null, T.visView, nn(viewIri))) {
      const info = this.readNode(q.subject);
      if (info) nodes.push(info);
    }
    return nodes;
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

  addRelationshipToView(viewIri: string, relationshipIri: string, waypoints?: Point[]): string | undefined {
    const existing = this.linkIrisFor(viewIri, relationshipIri)[0];
    if (existing) {
      if (waypoints) this.updateLinkWaypoints(viewIri, relationshipIri, waypoints);
      return existing;
    }

    const relationship = nn(relationshipIri);
    const sourceIri = this.objects(relationship, T.source)[0];
    const targetIri = this.objects(relationship, T.target)[0];
    if (!sourceIri || !targetIri) return undefined;
    const [sourceNode] = this.nodeIrisFor(viewIri, sourceIri);
    const [targetNode] = this.nodeIrisFor(viewIri, targetIri);
    // A link needs both ends drawn; the canvas adds the link once they are.
    if (!sourceNode || !targetNode) return undefined;

    const view = nn(viewIri);
    const linkIri = mintIri(viewNamespace(this.store, viewIri), 'link');
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

  collectLinkQuads(viewIri: string, relationshipIri: string): Quad[] {
    const view = nn(viewIri);
    const quads: Quad[] = [];
    for (const linkIri of this.linkIrisFor(viewIri, relationshipIri)) {
      quads.push(...this.linkQuads(nn(linkIri), view));
    }
    return dedupe(quads);
  }

  getLinks(viewIri: string): LinkInfo[] {
    const links: LinkInfo[] = [];
    for (const q of this.read(null, T.visView, nn(viewIri))) {
      const info = this.readLink(q.subject);
      if (info) links.push(info);
    }
    return links;
  }

  updateLinkWaypoints(viewIri: string, relationshipIri: string, waypoints: Point[]): void {
    const [linkIri] = this.linkIrisFor(viewIri, relationshipIri);
    if (!linkIri) return;
    const link = nn(linkIri);
    this.remove([...this.read(link, T.points), ...this.pointListQuads(link)]);
    if (waypoints.length > 0) this.writePoints(link, waypoints);
  }

  refreshLinksOf(relationshipIri: string): void {
    const rel = nn(relationshipIri);
    const sourceIri = this.objects(rel, T.source)[0];
    const targetIri = this.objects(rel, T.target)[0];
    for (const q of this.read(null, T.archRelationship, rel)) {
      const link = q.subject as NamedNode;
      const viewIri = this.objects(link, T.visView)[0];
      if (!viewIri) continue;
      const [sourceNode] = sourceIri ? this.nodeIrisFor(viewIri, sourceIri) : [];
      const [targetNode] = targetIri ? this.nodeIrisFor(viewIri, targetIri) : [];
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
    return [...views].sort();
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private readNode(node: Term): NodeInfo | undefined {
    const types = this.objects(node, T.rdfType);
    if (!types.includes(IRI.ArchNode)) return undefined;
    const elementIri = this.objects(node, T.archElement)[0];
    if (!elementIri) return undefined;
    const bound = (predicate: string, fallback: number) =>
      numberOf(this.read(node as NamedNode, nn(predicate))[0]?.object) ?? fallback;
    const parentNode = this.read(node as NamedNode, T.inNode)[0]?.object;
    const parentElementIri = parentNode ? this.objects(parentNode, T.archElement)[0] : undefined;
    return {
      nodeIri: node.value,
      elementIri,
      ...(parentElementIri ? { parentElementIri } : {}),
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
    const relationshipIri = this.objects(link, T.archRelationship)[0];
    const sourceNode = this.objectTerms(link, T.visSource)[0];
    const targetNode = this.objectTerms(link, T.visTarget)[0];
    if (!relationshipIri || !sourceNode || !targetNode) return undefined;
    const sourceElementIri = this.objects(sourceNode, T.archElement)[0];
    const targetElementIri = this.objects(targetNode, T.archElement)[0];
    if (!sourceElementIri || !targetElementIri) return undefined;
    return {
      linkIri: link.value,
      relationshipIri,
      sourceNodeIri: sourceNode.value,
      targetNodeIri: targetNode.value,
      sourceElementIri,
      targetElementIri,
      waypoints: this.readPoints(link),
    };
  }

  /** The link's own quads, its route, and the relationship's membership in the view. */
  private linkQuads(link: Term, view: NamedNode): Quad[] {
    const quads = [...this.subjectQuads(link), ...this.pointListQuads(link)];
    for (const relationshipIri of this.objects(link, T.archRelationship)) {
      // Only drop inView when this is the relationship's last link in the view.
      const others = this.linkIrisFor(view.value, relationshipIri).filter((iri) => iri !== link.value);
      if (others.length === 0) quads.push(...this.read(nn(relationshipIri), T.inView, view));
    }
    return quads;
  }

  private nodeIrisFor(viewIri: string, elementIri: string): string[] {
    const view = viewIri;
    return this.store
      .getQuads(null, T.archElement, nn(elementIri))
      .map((q) => q.subject)
      .filter((node) => this.objects(node, T.visView).includes(view))
      .map((node) => node.value);
  }

  private linkIrisFor(viewIri: string, relationshipIri: string): string[] {
    return this.store
      .getQuads(null, T.archRelationship, nn(relationshipIri))
      .map((q) => q.subject)
      .filter((link) => this.objects(link, T.visView).includes(viewIri))
      .map((link) => link.value);
  }

  /** Write `waypoints` as an IRI-celled `rdf:List` of `arch-vis:Point`s. */
  private writePoints(link: NamedNode, waypoints: Point[]): void {
    const quads: Quad[] = [];
    // Named after the link, flat like every minted IRI: `m:link-…-points-0`, `m:link-…-p0`.
    const cell = (i: number) => nn(`${link.value}-points-${i}`);
    const point = (i: number) => nn(`${link.value}-p${i}`);
    quads.push(triple(link, T.points, cell(0)));
    waypoints.forEach((wp, i) => {
      quads.push(
        triple(cell(i), T.rdfFirst, point(i)),
        triple(cell(i), T.rdfRest, i === waypoints.length - 1 ? T.rdfNil : cell(i + 1)),
        triple(point(i), T.rdfType, T.Point),
        triple(point(i), T.pointX, doubleLiteral(Math.round(wp.x))),
        triple(point(i), T.pointY, doubleLiteral(Math.round(wp.y))),
      );
    });
    this.store.addQuads(quads);
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
