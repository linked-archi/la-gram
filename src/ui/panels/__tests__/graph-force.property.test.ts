/**
 * Properties of the live force layout's loop (key decision 17), on random
 * graphs and random sequences of what the view does to it: new graphs (another,
 * the same, one node more or fewer, with the reheat and kept nodes the view
 * gives), runs, pauses, ends, drags, frames and changes of the forces (Req
 * 17.13). Whatever the sequence, once the drags end and the layout comes to rest:
 *
 * - every position is finite, and the middle element is where it started or
 *   was last dropped;
 * - nothing is queued;
 * - `running` is never reported twice in a row, and the last report is `settled`;
 * - every graph given is as it was given: its lines' ends still IRIs.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  FORCE_CONTROLS,
  LiveForce,
  topologyChange,
  topologyOf,
  type ForceGraphEdge,
  type ForceGraphNode,
  type LayoutState,
  type LiveGraph,
  type Point,
} from '../graph-force.js';

const RADIUS = Math.hypot(120, 46) / 2 + 2;
const MAX_NODES = 25;

interface Graph {
  nodes: ForceGraphNode[];
  edges: ForceGraphEdge[];
  rootId: string;
}

type Command =
  | { kind: 'graph'; how: 'new' | 'same' | 'add' | 'remove'; size: number; pairs: Array<[number, number]>; pick: number }
  | { kind: 'run' }
  | { kind: 'pause' }
  | { kind: 'end' }
  | { kind: 'dragStart'; pick: number }
  | { kind: 'dragMove'; pick: number; x: number; y: number }
  | { kind: 'dragEnd'; pick: number; x: number; y: number }
  | { kind: 'flush'; frames: number }
  | { kind: 'params'; linkDistance: number; chargeStrength: number; collideScale: number };

/** A graph of `size` nodes and lines between them by index, self-loops included; the middle element by `pick`. */
function makeGraph(size: number, pairs: Array<[number, number]>, pick: number, prefix = 'n'): Graph {
  const nodes = Array.from({ length: size }, (_, i) => ({ id: `${prefix}${i}` }));
  const edges = pairs.filter(([s, t]) => s < size && t < size).map(([s, t], i) => ({ id: `${prefix}e${i}`, source: `${prefix}${s}`, target: `${prefix}${t}` }));
  return { nodes, edges, rootId: nodes[pick % size]!.id };
}

const coordinate = fc.integer({ min: -800, max: 800 });
const pairs = fc.array(fc.tuple(fc.nat(MAX_NODES - 1), fc.nat(MAX_NODES - 1)), { maxLength: 40 });
const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant('graph' as const),
    how: fc.constantFrom('new' as const, 'same' as const, 'add' as const, 'remove' as const),
    size: fc.integer({ min: 0, max: MAX_NODES }),
    pairs,
    pick: fc.nat(100),
  }),
  fc.record({ kind: fc.constant('run' as const) }),
  fc.record({ kind: fc.constant('pause' as const) }),
  fc.record({ kind: fc.constant('end' as const) }),
  fc.record({ kind: fc.constant('dragStart' as const), pick: fc.nat(100) }),
  fc.record({ kind: fc.constant('dragMove' as const), pick: fc.nat(100), x: coordinate, y: coordinate }),
  fc.record({ kind: fc.constant('dragEnd' as const), pick: fc.nat(100), x: coordinate, y: coordinate }),
  fc.record({ kind: fc.constant('flush' as const), frames: fc.integer({ min: 1, max: 60 }) }),
  // Any value of each slider's range, on its step or not: setParams() brings it into range.
  fc.record({
    kind: fc.constant('params' as const),
    linkDistance: fc.integer({ min: FORCE_CONTROLS.linkDistance.min, max: FORCE_CONTROLS.linkDistance.max }),
    chargeStrength: fc.integer({ min: FORCE_CONTROLS.chargeStrength.min, max: FORCE_CONTROLS.chargeStrength.max }),
    collideScale: fc.integer({ min: 5, max: 20 }).map((n) => n / 10),
  }),
);

const scenarioArb = fc.record({
  first: fc.record({ size: fc.integer({ min: 1, max: MAX_NODES }), pairs, pick: fc.nat(100) }),
  commands: fc.array(commandArb, { maxLength: 20 }),
  reduced: fc.boolean(),
  /** Smaller limits, so that every way to run comes up: animated, at once, held drags, alone drags. */
  animateMaxNodes: fc.integer({ min: 1, max: MAX_NODES + 5 }),
  liveDragMaxNodes: fc.integer({ min: 1, max: MAX_NODES + 5 }),
  syncSettleMs: fc.constantFrom(0, 20, 100),
  msPerRead: fc.constantFrom(0.1, 1, 3, 7),
});

/** Runs per property; `FORCE_RUNS=1000 npx vitest …` for a longer search. */
const RUNS = { numRuns: Number(process.env.FORCE_RUNS ?? 30) };

describe('the live force layout', () => {
  it('comes to rest from any sequence, finite, its middle element pinned, nothing queued, its reports in order, its input unchanged', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        let clock = 0;
        const queue: Array<{ id: number; step: () => void }> = [];
        let ids = 0;
        const states: LayoutState[] = [];
        const force = new LiveForce({
          frames: {
            request: (step) => (queue.push({ id: ++ids, step }), ids),
            cancel: (handle) => {
              const i = queue.findIndex((q) => q.id === handle);
              if (i >= 0) queue.splice(i, 1);
            },
            now: () => (clock += s.msPerRead),
          },
          radius: RADIUS,
          reducedMotion: () => s.reduced,
          write: () => undefined,
          state: (state) => states.push(state),
          limits: { animateMaxNodes: s.animateMaxNodes, liveDragMaxNodes: s.liveDragMaxNodes, syncSettleMs: s.syncSettleMs },
        });
        const flush = (n: number) => {
          for (let i = 0; i < n && queue.length > 0; i++) for (const q of queue.splice(0, queue.length)) q.step();
        };

        /** Every graph given, with a copy made before it was given. */
        const given: Array<{ graph: Graph; copy: Graph }> = [];
        let current = makeGraph(s.first.size, s.first.pairs, s.first.pick);
        let drawn: LiveGraph | undefined;
        /** The model of the drags LiveForce holds, and where the middle element must be. */
        const dragged = new Set<string>();
        let middle: Point | undefined;
        let version = 0;

        const show = (g: Graph, restart = false) => {
          given.push({ graph: g, copy: structuredClone(g) });
          const change = topologyChange(drawn && topologyOf(drawn.nodes, drawn.edges, drawn.rootId), topologyOf(g.nodes, g.edges, g.rootId));
          const graph: LiveGraph = {
            ...g,
            at: force.positions(),
            centre: { x: 0, y: 0 },
            aspect: 3,
            reheat: restart ? 1 : change.reheat,
            kept: change.kept,
            restart,
          };
          const same =
            graph.reheat === 0 &&
            !!drawn &&
            new Set(drawn.nodes.map((n) => n.id)).size === new Set(g.nodes.map((n) => n.id)).size &&
            g.nodes.every((n) => drawn!.nodes.some((m) => m.id === n.id));
          const start = force.setGraph(graph);
          if (!same) {
            if (restart) dragged.clear();
            for (const id of [...dragged]) if (!g.nodes.some((n) => n.id === id)) dragged.delete(id);
            // The same middle element starts where it is pinned; another one where it is seeded.
            if (drawn?.rootId === g.rootId && middle) expect(start.get(g.rootId)).toEqual(middle);
            else middle = start.get(g.rootId);
          }
          drawn = graph;
          current = g;
        };
        const nodeAt = (pick: number) => (current.nodes.length > 0 ? current.nodes[pick % current.nodes.length]!.id : undefined);

        show(current);
        for (const c of s.commands) {
          switch (c.kind) {
            case 'graph': {
              let g: Graph;
              if (c.how === 'same') g = { ...current, nodes: [...current.nodes], edges: [...current.edges] };
              else if (c.how === 'new')
                // Half the time of the same names, so that some nodes are kept.
                g = c.size === 0 ? { nodes: [], edges: [], rootId: '' } : makeGraph(c.size, c.pairs, c.pick, c.pick % 2 === 0 ? 'n' : `g${++version}-`);
              else if (c.how === 'add' && current.nodes.length < MAX_NODES) {
                const id = `x${++version}`;
                const to = nodeAt(c.pick);
                g = { ...current, nodes: [...current.nodes, { id }], edges: to ? [...current.edges, { id: `${id}-line`, source: to, target: id }] : current.edges };
                if (!current.rootId) g.rootId = id;
              } else {
                const gone = current.nodes.find((n, i) => n.id !== current.rootId && i === c.pick % Math.max(1, current.nodes.length));
                g = gone
                  ? { ...current, nodes: current.nodes.filter((n) => n !== gone), edges: current.edges.filter((e) => e.source !== gone.id && e.target !== gone.id) }
                  : current;
              }
              show(g, c.pick % 7 === 0);
              force.run();
              break;
            }
            case 'run':
              force.run();
              break;
            case 'pause':
              force.pause();
              break;
            case 'end':
              force.end();
              dragged.clear();
              break;
            case 'dragStart': {
              const id = nodeAt(c.pick);
              if (!id) break;
              force.dragStart(id);
              dragged.add(id);
              break;
            }
            case 'dragMove':
            case 'dragEnd': {
              const id = nodeAt(c.pick);
              if (!id || !dragged.has(id)) break;
              const p = { x: c.x, y: c.y };
              if (c.kind === 'dragMove') force.dragMove(id, p);
              else {
                force.dragEnd(id, p);
                dragged.delete(id);
              }
              if (id === current.rootId) middle = p;
              break;
            }
            case 'flush':
              flush(c.frames);
              break;
            case 'params':
              // As the view does with a slider: the forces, then a run.
              force.setParams({ linkDistance: c.linkDistance, chargeStrength: c.chargeStrength, collideScale: c.collideScale });
              force.run();
              break;
          }
        }
        // The open drags end where their elements are; then a run, and frames until rest.
        for (const id of [...dragged]) {
          const p = force.positions().get(id)!;
          force.dragEnd(id, p);
          if (id === current.rootId) middle = p;
        }
        dragged.clear();
        force.run();
        flush(50_000);

        const at = force.positions();
        expect([...at.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        if (current.rootId && middle) expect(at.get(current.rootId)).toEqual(middle);
        expect(queue).toHaveLength(0);
        for (let i = 1; i < states.length; i++) expect(states[i - 1] === 'running' && states[i] === 'running').toBe(false);
        if (states.length > 0) expect(states.at(-1)).toBe('settled');
        expect(force.state).toBe('settled');
        for (const { graph, copy } of given) {
          expect(graph).toEqual(copy);
          for (const e of graph.edges) expect([typeof e.source, typeof e.target]).toEqual(['string', 'string']);
        }
      }),
      RUNS,
    );
  });
});
