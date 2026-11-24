/**
 * The drawing half of the Graph tab: Cytoscape.js over a plain node/edge list.
 *
 * Kept apart from `graph-panel.ts` so the panel (controls, queries, exports) is
 * testable without a canvas, and so the rendering library is one file's
 * concern. Nodes carry the notation's fill colour and badge glyph; edges its
 * line style and endpoint decorations — the graph reads like the diagram.
 *
 * Force is d3-force's simulation, live (key decision 17, `graph-force.ts`): the
 * graph moves into place and comes to rest, and a dragged element pulls the
 * elements linked to it. Cytoscape.js draws, hit-tests, pans, zooms and selects,
 * and lays out Rings and Tree. The drawing is updated in place, so a refresh
 * that changes nothing drawn moves nothing; with Force the camera moves only at
 * rest, and only while the user has not taken it since the last graph asked for.
 * The forces the panel's sliders set (Req 17.13) reach an animated layout as a
 * slider moves, and a layout laid out at once when it is let go.
 */

import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, NodeSingular, StylesheetJson } from 'cytoscape';
import type { Decoration, LineStyle } from '@linked-archi/kernel/metamodel-manager/notation.js';
import {
  LiveForce,
  browserFrames,
  forcePositions,
  resolveLimits,
  topologyChange,
  topologyOf,
  type ForceLimits,
  type ForceParams,
  type ForceRunStats,
  type Topology,
} from './graph-force.js';

/** A node to draw. */
export interface GraphViewNode {
  id: string;
  label: string;
  /** Type label, shown on hover. */
  typeLabel?: string;
  /** Fill colour from the notation. */
  color?: string;
  /** Badge glyph URL. */
  icon?: string;
  /** Hops from the root. */
  depth: number;
}

/** An edge to draw. */
export interface GraphViewEdge {
  id: string;
  source: string;
  target: string;
  /** Type label, with the relationship's own name when it has one. */
  label: string;
  lineStyle?: LineStyle;
  sourceDecor?: Decoration;
  targetDecor?: Decoration;
}

/** How to lay the graph out. */
export type GraphLayout = 'rings' | 'tree' | 'force';

/** What the drawing reports back. */
export interface GraphViewHandlers {
  /** A node or edge was clicked. */
  select(id: string, kind: 'node' | 'edge'): void;
  /** A node was double-clicked: make it the root. */
  root(id: string): void;
}

/** How a graph is shown. */
export interface GraphShowOptions {
  /**
   * Whether the graph is one the user asked for (another element in the middle,
   * the depth, the filters), so that a change it brings starts following: the
   * view frames it at rest. `true` unless given; a refresh after a model change
   * and a return to the tab pass `false`, and keep the camera.
   */
  follow?: boolean;
}

/** How the drawing was laid out, for the stats line, the bench and tests. */
export interface GraphLayoutStats {
  /** The layout chosen. */
  layout: GraphLayout;
  /** What laid the drawing out: `rings` for Force above its limit. */
  drawnBy: 'force' | 'rings' | 'tree';
  /** The simulation's latest run, when it laid the drawing out. */
  run?: ForceRunStats;
  /** The limits in force. */
  limits: ForceLimits;
}

/** A drawn graph. */
export interface GraphView {
  show(nodes: GraphViewNode[], edges: GraphViewEdge[], rootId: string, layout: GraphLayout, options?: GraphShowOptions): void;
  /** Re-lay out the current graph. */
  relayout(layout: GraphLayout): void;
  /**
   * The Force layout's forces (Req 17.13). `final` for a slider's `change` (let
   * go, or a key), *Reset* and the panel's first push; not for its `input` as
   * it moves, which only an animated layout follows. A change to a graph Force
   * lays out runs it again, framed at rest; otherwise the forces are kept for
   * the next force layout.
   */
  setForceParams(params: ForceParams, final: boolean): void;
  /** Frame the graph now, and follow: the next rest is framed too. */
  fit(): void;
  /** The container changed size (a tab became visible, the panel was resized): framed only while following and at rest. */
  resize(): void;
  /** Highlight a node or edge (the concept selected elsewhere). */
  highlight(id: string | undefined): void;
  /** Where each node is drawn, as copies: its centre in the graph's coordinates, or in the drawing area's pixels. */
  positions(space?: 'model' | 'rendered'): Map<string, { x: number; y: number }>;
  /** Stop moving; positions stay. The next `show()` resumes a layout that had not come to rest. */
  pause(): void;
  layoutStats(): GraphLayoutStats;
  destroy(): void;
}

/** Makes a {@link GraphView}; replaced in tests, where there is no canvas. */
export type GraphViewFactory = (container: HTMLElement, handlers: GraphViewHandlers) => GraphView;

/** Cytoscape arrow shape and fill for a notation decoration. */
function arrow(decoration: Decoration | undefined): { shape: string; fill: 'filled' | 'hollow' } {
  switch (decoration) {
    case 'OpenArrowhead':
    case 'HalfArrowhead':
      return { shape: 'vee', fill: 'filled' };
    case 'ClosedArrowhead':
      return { shape: 'triangle', fill: 'filled' };
    case 'HollowArrowhead':
      return { shape: 'triangle', fill: 'hollow' };
    case 'FilledDiamond':
      return { shape: 'diamond', fill: 'filled' };
    case 'HollowDiamond':
      return { shape: 'diamond', fill: 'hollow' };
    case 'CircleDot':
      return { shape: 'circle', fill: 'filled' };
    default:
      return { shape: 'none', fill: 'filled' };
  }
}

const LINE_STYLE: Record<LineStyle, string> = { SolidLine: 'solid', DashedLine: 'dashed', DottedLine: 'dotted' };

const STYLE: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      width: 120,
      height: 46,
      'background-color': 'data(color)',
      'border-width': 1,
      'border-color': '#5f6368',
      label: 'data(label)',
      'font-size': 11,
      'font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
      color: '#202124',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': '104px',
    },
  },
  {
    selector: 'node[icon]',
    style: {
      'background-image': 'data(icon)',
      'background-width': 14,
      'background-height': 14,
      'background-position-x': '94%',
      'background-position-y': '12%',
      'background-clip': 'none',
      'background-image-containment': 'over',
    },
  },
  { selector: 'node.root', style: { 'border-width': 3, 'border-color': '#1a73e8', 'font-weight': 'bold' } },
  { selector: 'node.highlighted', style: { 'overlay-color': '#1a73e8', 'overlay-opacity': 0.15, 'overlay-padding': 4 } },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'curve-style': 'bezier',
      'line-color': '#5f6368',
      'line-style': (e: cytoscape.EdgeSingular) => e.data('lineStyle'),
      'target-arrow-shape': (e: cytoscape.EdgeSingular) => e.data('targetArrow'),
      'target-arrow-fill': (e: cytoscape.EdgeSingular) => e.data('targetFill'),
      'target-arrow-color': '#5f6368',
      'source-arrow-shape': (e: cytoscape.EdgeSingular) => e.data('sourceArrow'),
      'source-arrow-fill': (e: cytoscape.EdgeSingular) => e.data('sourceFill'),
      'source-arrow-color': '#5f6368',
      'arrow-scale': 1.1,
      label: 'data(label)',
      'font-size': 9,
      color: '#5f6368',
      'text-rotation': 'autorotate',
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.85,
      'text-background-padding': '1px',
    },
  },
  { selector: 'edge.highlighted', style: { width: 3, 'line-color': '#1a73e8', 'target-arrow-color': '#1a73e8', 'source-arrow-color': '#1a73e8' } },
  { selector: ':selected', style: { 'overlay-color': '#1a73e8', 'overlay-opacity': 0.2, 'overlay-padding': 4 } },
];

/** The static layouts, Cytoscape.js's `breadthfirst`: in circles round the root, or as a tree. Force is `graph-force.ts`'s. */
function layoutOptions(layout: Exclude<GraphLayout, 'force'>, rootId: string | undefined): LayoutOptions {
  const roots = rootId ? { roots: [rootId] } : {};
  switch (layout) {
    case 'tree':
      return { name: 'breadthfirst', ...roots, directed: false, spacingFactor: 1.15, animate: false, padding: 24 } as LayoutOptions;
    default:
      return { name: 'breadthfirst', ...roots, circle: true, directed: false, spacingFactor: 1.05, animate: false, padding: 24 } as LayoutOptions;
  }
}

/** Largest zoom a fit may choose: nodes a little over their drawn size. */
const MAX_FIT_ZOOM = 1.25;

/** A node's data as drawn: its name, its notation's colour and glyph. */
function nodeData(n: GraphViewNode) {
  return { label: n.label, color: n.color ?? '#ffffff', depth: n.depth, ...(n.icon ? { icon: n.icon } : {}) };
}

/** An edge's data as drawn, but its ends: its name, line style and end decorations. */
function edgeData(e: GraphViewEdge) {
  const target = arrow(e.targetDecor ?? 'OpenArrowhead');
  const source = arrow(e.sourceDecor);
  return {
    label: e.label,
    lineStyle: LINE_STYLE[e.lineStyle ?? 'SolidLine'],
    targetArrow: target.shape,
    targetFill: target.fill,
    sourceArrow: source.shape,
    sourceFill: source.fill,
  };
}

/** The Cytoscape.js implementation. */
export const createCytoscapeView: GraphViewFactory = (container, handlers) => {
  const cy: Core = cytoscape({
    container,
    style: STYLE,
    wheelSensitivity: 0.3,
    // A fit frames about a thousand elements in a short, wide panel; 0.2 stopped it at about a hundred.
    minZoom: 0.05,
    maxZoom: 3,
    boxSelectionEnabled: false,
  });
  /** The current layout; `show()` and `relayout()` set it before anything else. */
  let layout: GraphLayout = 'force';
  let rootId = '';
  let lastNodes: GraphViewNode[] = [];
  let lastEdges: GraphViewEdge[] = [];
  let drawn: Topology | undefined;
  /** Whether a run's rest is framed: the user has not pressed, scrolled or pinched since the last graph asked for, or Fit. */
  let following = true;
  /** Whether the simulation laid out what is drawn (false: a static layout did). */
  let forceDrawn = false;
  /** The elements being dragged, as given to `force.dragStart`. */
  const dragged = new Set<string>();
  let byIri = new Map<string, NodeSingular>();
  const limits = resolveLimits();
  const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  /** Fit the graph to the panel — but a small graph is not blown up past life size. */
  const frame = () => {
    cy.fit(undefined, 24);
    if (cy.zoom() > MAX_FIT_ZOOM) {
      cy.zoom(MAX_FIT_ZOOM);
      cy.center();
    }
  };

  const force = new LiveForce({
    frames: browserFrames,
    // Half the drawn box's diagonal (120 × 46), plus the collision padding.
    radius: Math.hypot(120, 46) / 2 + 2,
    reducedMotion,
    write(nodes) {
      // A pressed element that is not dragged is written like the rest, so it does not freeze and then jump.
      cy.batch(() => {
        for (const n of nodes) if (!dragged.has(n.id)) byIri.get(n.id)?.position({ x: n.x, y: n.y });
      });
    },
    state(s) {
      // Framed first, so that whatever waits for `settled` sees the final positions and the final camera.
      if (s === 'settled' && forceDrawn && following) frame();
      container.dataset.layout = s;
    },
  });
  container.dataset.layout = 'settled';

  const centre = () => {
    const e = cy.extent();
    return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
  };
  const aspect = () => (cy.width() > 0 && cy.height() > 0 ? cy.width() / cy.height() : 1);
  const modelPositions = () => new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }] as const));
  /** Rings or Tree, and Force above its limit as Rings; framed after. */
  const runStatic = () => {
    if (cy.nodes().length === 0) return;
    cy.layout(layoutOptions(layout === 'tree' ? 'tree' : 'rings', rootId)).run();
    frame();
  };

  cy.on('tap', 'node', (e) => handlers.select(e.target.id(), 'node'));
  cy.on('tap', 'edge', (e) => handlers.select(e.target.id(), 'edge'));
  cy.on('dbltap', 'node', (e) => handlers.root(e.target.id()));
  // Any press in the drawing, or a zoom, takes the camera: nothing is re-fitted until the next graph asked for, or Fit.
  cy.on('tapstart', () => {
    following = false;
  });
  cy.on('scrollzoom pinchzoom', () => {
    following = false;
  });
  // A press's first move starts a drag (not the press: a click does not stir the graph).
  cy.on('drag', 'node', (e) => {
    if (!forceDrawn) return;
    const id: string = e.target.id();
    if (!dragged.has(id)) {
      dragged.add(id);
      force.dragStart(id);
    }
    force.dragMove(id, e.target.position());
  });
  cy.on('free', 'node', (e) => {
    const id: string = e.target.id();
    if (!dragged.has(id)) return;
    force.dragEnd(id, e.target.position());
    dragged.delete(id);
  });

  return {
    show(nodes, edges, root, next, { follow = true } = {}) {
      const after = topologyOf(nodes, edges, root);
      const change = topologyChange(drawn, after);
      const previous = modelPositions();
      const layoutChanged = next !== layout;
      layout = next;
      rootId = root;
      lastNodes = nodes;
      lastEdges = edges;

      const byForce = layout === 'force' && nodes.length <= limits.forceMaxNodes;
      let restart = false;
      let start: ReadonlyMap<string, { x: number; y: number }>;
      if (byForce) {
        // A switch to Force, and Force taking over from its own rings: the drawing was laid out by a static layout.
        restart = !forceDrawn;
        forceDrawn = true;
        start = force.setGraph({
          nodes,
          edges,
          rootId: root,
          at: previous,
          centre: centre(),
          aspect: aspect(),
          reheat: restart ? 1 : change.reheat,
          kept: change.kept,
          restart,
        });
        if (restart) dragged.clear();
      } else {
        forceDrawn = false;
        force.end();
        dragged.clear();
        start = previous;
      }

      // In place: a refresh that changes nothing drawn moves nothing, and a grabbed element stays grabbed.
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edgeById = new Map(edges.map((e) => [e.id, e]));
      cy.batch(() => {
        cy.edges().forEach((edge) => {
          const e = edgeById.get(edge.id());
          if (!e || edge.data('source') !== e.source || edge.data('target') !== e.target) edge.remove();
        });
        cy.nodes().forEach((node) => {
          if (!nodeIds.has(node.id())) node.remove();
        });
        const added: ElementDefinition[] = [];
        for (const n of nodes) {
          const node = cy.getElementById(n.id);
          if (node.nonempty()) {
            // A glyph that is gone goes.
            node.removeData('icon');
            node.data(nodeData(n));
            node.toggleClass('root', n.id === root);
          } else {
            const at = start.get(n.id);
            added.push({ group: 'nodes', data: { id: n.id, ...nodeData(n) }, classes: n.id === root ? 'root' : '', ...(at ? { position: { x: at.x, y: at.y } } : {}) });
          }
        }
        for (const e of edges) {
          const edge = cy.getElementById(e.id);
          if (edge.nonempty()) edge.data(edgeData(e));
          else added.push({ group: 'edges', data: { id: e.id, source: e.source, target: e.target, ...edgeData(e) } });
        }
        if (added.length > 0) cy.add(added);
      });
      byIri = new Map(cy.nodes().map((n) => [n.id(), n] as const));
      for (const id of [...dragged]) if (!nodeIds.has(id)) dragged.delete(id);
      drawn = after;

      const moved = change.reheat > 0 || layoutChanged || restart;
      if (moved && follow) following = true;
      // The run frames at rest (`state`); a static layout frames after it runs.
      if (byForce) force.run();
      else if (moved) runStatic();
    },
    relayout(next) {
      following = true;
      layout = next;
      dragged.clear();
      if (layout === 'force' && cy.nodes().length <= limits.forceMaxNodes) {
        forceDrawn = true;
        force.setGraph({
          nodes: lastNodes,
          edges: lastEdges,
          rootId,
          at: modelPositions(),
          centre: centre(),
          aspect: aspect(),
          reheat: 1,
          kept: new Set(cy.nodes().map((n) => n.id())),
          restart: true,
        });
        force.run();
      } else {
        forceDrawn = false;
        force.end();
        runStatic();
      }
    },
    setForceParams(params, final) {
      // Laid out at once (above animateMaxNodes, or under reduced motion): recomputed when the slider is let go.
      if (!final && !force.animates()) return;
      if (!force.setParams(params)) return;
      // Rings, Tree, and Force drawing rings: kept for the next force layout.
      if (!forceDrawn) return;
      // A change the user asked for, like a change of layout: the rest is framed.
      following = true;
      force.run();
    },
    fit() {
      following = true;
      frame();
    },
    resize() {
      cy.resize();
      if (following && force.state === 'settled') frame();
    },
    highlight(id) {
      cy.elements('.highlighted').removeClass('highlighted');
      if (id) cy.getElementById(id).addClass('highlighted');
    },
    positions: (space = 'model') =>
      new Map(cy.nodes().map((n) => [n.id(), space === 'rendered' ? { ...n.renderedPosition() } : { ...n.position() }] as const)),
    pause: () => force.pause(),
    layoutStats: () => ({
      layout,
      drawnBy: forceDrawn ? 'force' : layout === 'tree' ? 'tree' : 'rings',
      ...(forceDrawn ? { run: force.stats() } : {}),
      limits,
    }),
    destroy() {
      force.destroy();
      cy.destroy();
    },
  };
};

/**
 * Lay out a graph that is not drawn — query results made into a view — with
 * the layouts the Graph tab draws with, on nodes of the given size; Force with
 * the given forces, the defaults where none are given.
 *
 * @returns Each node's centre.
 */
export function layoutPositions(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ id: string; source: string; target: string }>,
  options: { layout: GraphLayout; rootId?: string; width: number; height: number; params?: Partial<ForceParams> },
): Map<string, { x: number; y: number }> {
  if (options.layout === 'force') return forcePositions(nodes, edges, options);
  const layout = options.layout;
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    style: [{ selector: 'node', style: { width: options.width, height: options.height } }],
    elements: [
      ...nodes.map((n) => ({ group: 'nodes' as const, data: { id: n.id } })),
      ...edges.map((e) => ({ group: 'edges' as const, data: { id: e.id, source: e.source, target: e.target } })),
    ],
  });
  if (nodes.length > 0) cy.layout({ ...layoutOptions(layout, options.rootId), boundingBox: undefined } as LayoutOptions).run();
  const positions = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }] as const));
  cy.destroy();
  return positions;
}
