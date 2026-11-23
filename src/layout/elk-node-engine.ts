/**
 * ELK in this thread, for Node — the tests, and the command line later (ELK task). Apart from
 * `elk-engine.ts` so the web build, which runs ELK in a worker, does not carry this build of it.
 */

import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { LayoutEngine } from './elk-engine.js';

export async function bundledEngine(): Promise<LayoutEngine> {
  const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ElkBundled();
  return { layout: (graph) => elk.layout(graph) as Promise<ElkNode> };
}
