/**
 * Where ELK runs in the browser and the desktop app (ELK task, R13): in a worker, made on the first layout
 * and kept. In Node — the tests, the command line — `elk-node-engine.ts`, kept apart so the web build does
 * not carry ELK's single-thread build.
 */

import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';

/** What lays out an ELK graph. */
export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
  /** Stop a layout that runs too long: the worker is ended, and the next layout makes another. */
  stop?(): void;
}

let workerElk: ELK | undefined;

/** ELK in a worker. */
export async function workerEngine(): Promise<LayoutEngine> {
  if (!workerElk) {
    const { default: ElkApi } = await import('elkjs/lib/elk-api.js');
    workerElk = new ElkApi({ workerFactory: () => new Worker(new URL('./elk.worker.ts', import.meta.url)) });
  }
  const elk = workerElk;
  return {
    layout: (graph) => elk.layout(graph) as Promise<ElkNode>,
    stop: () => {
      elk.terminateWorker();
      if (workerElk === elk) workerElk = undefined;
    },
  };
}
