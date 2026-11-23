/**
 * Lay out (ELK task, R1–R8): ELK's layered layout, or the grid when there are too many nodes, or ELK fails
 * or takes too long — never half of one. DOM-free; the engine says where ELK runs.
 */

import { fromElkGraph } from './elk-result.js';
import { toElkGraph } from './elk-graph.js';
import { gridLayout } from './grid-layout.js';
import type { LayoutEngine } from './elk-engine.js';
import type { GridReason, LayoutInput, LayoutOptions, LayoutResult } from './layout-types.js';

export async function layout(
  input: LayoutInput,
  options: LayoutOptions,
  engine: LayoutEngine | (() => Promise<LayoutEngine>),
): Promise<LayoutResult> {
  const grid = (reason: GridReason): LayoutResult => ({ ...gridLayout(input, options), engine: 'grid', reason });
  if (input.nodes.length === 0) return { bounds: new Map(), routes: new Map(), engine: 'elk' };
  if (input.nodes.length > options.maxNodes && !options.force) return grid('too-many');
  let running: LayoutEngine | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    running = typeof engine === 'function' ? await engine() : engine;
    const timedOut = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), options.timeoutMs);
    });
    const laidOut = await Promise.race([running.layout(toElkGraph(input, options)), timedOut]);
    if (laidOut === 'timed-out') {
      running.stop?.();
      return grid('timed-out');
    }
    return { ...fromElkGraph(laidOut, options.origin), engine: 'elk' };
  } catch {
    running?.stop?.();
    return grid('failed');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
