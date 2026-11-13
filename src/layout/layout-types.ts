/**
 * Automatic layout (ELK task, `.agents/tasks/elk-auto-layout/`): what is laid out, how, and what comes back.
 * DOM-free: the same in the browser, the desktop app and Node.
 */

import type { Bounds, Point } from '../model-manager/interfaces.js';

/** Something to place: an element's placement, a figure. */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  /** The node it is drawn inside; it is laid out inside it, and the parent sized to hold it. */
  parent?: string;
  /** Room kept inside a parent around what it holds — its name band at the top. */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Its band, when the layout keeps bands in order (0 first); none: placed by its relationships alone. */
  band?: number;
  /** Where it goes among the others before layout — the order ELK keeps, for the same result each time. */
  key?: string;
}

/** A line to route between two nodes. */
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** An association does not decide which end comes first. */
  kind?: 'association' | 'other';
}

export interface LayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';
export type LayoutSpacing = 'compact' | 'normal' | 'roomy';

export interface LayoutOptions {
  direction: LayoutDirection;
  spacing: LayoutSpacing;
  /** Keep the nodes' bands in order. */
  bands: boolean;
  /** Where the laid-out drawing's top-left goes. */
  origin: Point;
  /** Above this many nodes, the grid — unless forced. */
  maxNodes: number;
  /** After this long, the grid. */
  timeoutMs: number;
  /** Lay out with ELK even above `maxNodes`. */
  force?: boolean;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  direction: 'DOWN',
  spacing: 'normal',
  bands: false,
  origin: { x: 40, y: 40 },
  maxNodes: 2000,
  timeoutMs: 10_000,
};

/** Why the grid was used instead of ELK. */
export type GridReason = 'too-many' | 'failed' | 'timed-out';

export interface LayoutResult {
  /** Top-left bounds per node, in the diagram's coordinates. */
  bounds: Map<string, Bounds>;
  /** Per edge, its route: start, bends, end. None from the grid: straight. */
  routes: Map<string, Point[]>;
  engine: 'elk' | 'grid';
  reason?: GridReason;
}
