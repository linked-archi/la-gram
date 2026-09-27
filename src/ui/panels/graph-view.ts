/**
 * The drawing half of the Graph tab: Cytoscape.js over a plain node/edge list.
 *
 * Kept apart from `graph-panel.ts` so the panel (controls, queries, exports) is
 * testable without a canvas, and so the rendering library is one file's
 * concern. Nodes carry the notation's fill colour and badge glyph; edges its
 * line style and endpoint decorations — the graph reads like the diagram.
 */

import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, StylesheetJson } from 'cytoscape';
import type { Decoration, LineStyle } from '../../metamodel-manager/notation.js';

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

/** A drawn graph. */
export interface GraphView {
  show(nodes: GraphViewNode[], edges: GraphViewEdge[], rootId: string, layout: GraphLayout): void;
  /** Re-lay out the current graph. */
  relayout(layout: GraphLayout): void;
  fit(): void;
  /** The container changed size (a tab became visible, the panel was resized). */
  resize(): void;
  /** Highlight a node or edge (the concept selected elsewhere). */
  highlight(id: string | undefined): void;
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

function layoutOptions(layout: GraphLayout, rootId: string): LayoutOptions {
  switch (layout) {
    case 'tree':
      return { name: 'breadthfirst', roots: [rootId], directed: false, spacingFactor: 1.15, animate: false, padding: 24 } as LayoutOptions;
    case 'force':
      return { name: 'cose', animate: false, padding: 24, nodeRepulsion: () => 12000, idealEdgeLength: () => 120 } as LayoutOptions;
    default:
      return { name: 'breadthfirst', roots: [rootId], circle: true, directed: false, spacingFactor: 1.05, animate: false, padding: 24 } as LayoutOptions;
  }
}

/** Largest zoom a fit may choose: nodes a little over their drawn size. */
const MAX_FIT_ZOOM = 1.25;

/** The Cytoscape.js implementation. */
export const createCytoscapeView: GraphViewFactory = (container, handlers) => {
  const cy: Core = cytoscape({
    container,
    style: STYLE,
    wheelSensitivity: 0.3,
    minZoom: 0.2,
    maxZoom: 3,
    boxSelectionEnabled: false,
  });
  let rootId = '';

  /** Fit the graph to the panel — but a small graph is not blown up past life size. */
  const fit = () => {
    cy.fit(undefined, 24);
    if (cy.zoom() > MAX_FIT_ZOOM) {
      cy.zoom(MAX_FIT_ZOOM);
      cy.center();
    }
  };

  cy.on('tap', 'node', (e) => handlers.select(e.target.id(), 'node'));
  cy.on('tap', 'edge', (e) => handlers.select(e.target.id(), 'edge'));
  cy.on('dbltap', 'node', (e) => handlers.root(e.target.id()));

  const run = (layout: GraphLayout) => {
    if (cy.nodes().length === 0) return;
    cy.layout(layoutOptions(layout, rootId)).run();
    fit();
  };

  return {
    show(nodes, edges, root, layout) {
      rootId = root;
      const elements: ElementDefinition[] = [
        ...nodes.map((n) => ({
          group: 'nodes' as const,
          data: {
            id: n.id,
            label: n.label,
            color: n.color ?? '#ffffff',
            depth: n.depth,
            ...(n.icon ? { icon: n.icon } : {}),
          },
          classes: n.id === root ? 'root' : '',
        })),
        ...edges.map((e) => {
          const target = arrow(e.targetDecor ?? 'OpenArrowhead');
          const source = arrow(e.sourceDecor);
          return {
            group: 'edges' as const,
            data: {
              id: e.id,
              source: e.source,
              target: e.target,
              label: e.label,
              lineStyle: LINE_STYLE[e.lineStyle ?? 'SolidLine'],
              targetArrow: target.shape,
              targetFill: target.fill,
              sourceArrow: source.shape,
              sourceFill: source.fill,
            },
          };
        }),
      ];
      cy.batch(() => {
        cy.elements().remove();
        cy.add(elements);
      });
      run(layout);
    },
    relayout: run,
    fit,
    resize() {
      cy.resize();
      fit();
    },
    highlight(id) {
      cy.elements('.highlighted').removeClass('highlighted');
      if (id) cy.getElementById(id).addClass('highlighted');
    },
    destroy: () => cy.destroy(),
  };
};
