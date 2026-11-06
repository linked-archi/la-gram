/**
 * The validation worker (Task 22): validates the model off the UI thread.
 * `validation-service.ts` posts it the metamodels' setup, the model and its
 * changes, and asks for a validation; it answers with the report. Messages are
 * handled in order, so a validation sees every change posted before it.
 */
import { ValidationEngine, type EngineSetup } from './validation-engine.js';
import type { EncodedQuad } from './term-codec.js';

/** What the service posts. */
export type WorkerRequest =
  | { type: 'setup'; setup: EngineSetup }
  | { type: 'load'; quads: EncodedQuad[] }
  | { type: 'apply'; added: EncodedQuad[]; removed: EncodedQuad[] }
  | { type: 'validate'; id: number };

const engine = new ValidationEngine();
const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: unknown): void };

scope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.type === 'setup') engine.setup(request.setup);
    else if (request.type === 'load') engine.load(request.quads);
    else if (request.type === 'apply') engine.apply(request.added, request.removed);
    else if (request.type === 'validate') scope.postMessage({ type: 'report', id: request.id, report: engine.validate() });
  } catch (err: unknown) {
    scope.postMessage({
      type: 'error',
      ...(request.type === 'validate' ? { id: request.id } : {}),
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
