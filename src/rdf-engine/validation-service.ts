/**
 * Where the model is validated (Task 22): a Web Worker in the browser and the
 * desktop app, so the UI never waits for it; the calling thread where there is
 * no worker (Node, the tests), where a validation answers at once — as before.
 *
 * Both run the same {@link ValidationEngine}, which keeps its own copy of the
 * model: it is given the model whole once, then the store's changes as they
 * happen, so validating copies nothing out of the store.
 *
 * A worker validation is not interrupted. Asked again while one runs, the
 * service lets it finish and then runs once more for the latest state: the
 * earlier callers get `undefined` (superseded), the last the fresh report.
 */
import { DataFactory } from 'n3';
import type { ValidationReport } from './interfaces.js';
import { ValidationEngine, fromPlainReport, type EngineSetup, type PlainReport } from './validation-engine.js';
import type { EncodedQuad } from './term-codec.js';
import type { WorkerRequest } from './validation.worker.js';

/** Validation of the model, wherever it runs. */
export interface ValidationService {
  /** Where it runs. */
  readonly where: 'worker' | 'inline';
  /** What validation needs of the metamodels: again whenever they change. */
  setup(setup: EngineSetup): void;
  /** The model, whole. */
  load(quads: EncodedQuad[]): void;
  /** A change to the model. */
  apply(added: EncodedQuad[], removed: EncodedQuad[]): void;
  /**
   * Validate the model as it is now: the report at once (inline), or when the
   * worker answers — `undefined` when a later request superseded this one.
   */
  validate(): ValidationReport | Promise<ValidationReport | undefined>;
  /** Whether a validation is running or asked for. */
  readonly busy: boolean;
  dispose(): void;
}

const toTerm = (iri: string) => DataFactory.namedNode(iri);

/** The engine on the calling thread. */
export class InlineValidationService implements ValidationService {
  readonly where = 'inline' as const;
  private readonly engine = new ValidationEngine();

  setup(setup: EngineSetup): void {
    this.engine.setup(setup);
  }

  load(quads: EncodedQuad[]): void {
    this.engine.load(quads);
  }

  apply(added: EncodedQuad[], removed: EncodedQuad[]): void {
    this.engine.apply(added, removed);
  }

  validate(): ValidationReport {
    return fromPlainReport(this.engine.validate(), toTerm);
  }

  readonly busy = false;

  dispose(): void {}
}

/** What the service needs of a worker: posting, and hearing back. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((event: { data: WorkerAnswer }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

/** What the worker answers. */
type WorkerAnswer = { type: 'report'; id: number; report: PlainReport } | { type: 'error'; id?: number; message: string };

/** The engine in a worker. */
export class WorkerValidationService implements ValidationService {
  readonly where = 'worker' as const;
  private nextId = 0;
  /** The validation running in the worker, if any. */
  private running: number | undefined;
  /** Whether another was asked for while it ran. */
  private again = false;
  /** Callers waiting: all but the last are superseded. */
  private waiting: Array<(report: ValidationReport | undefined) => void> = [];

  constructor(
    private readonly worker: WorkerLike,
    private readonly onTiming?: (timing: PlainReport['timing']) => void,
  ) {
    worker.onmessage = (event) => this.answer(event.data);
    worker.onerror = (event) => {
      console.warn('[la-gram] The validation worker failed', event.message ?? event);
      this.settle(undefined);
    };
  }

  setup(setup: EngineSetup): void {
    this.worker.postMessage({ type: 'setup', setup });
  }

  load(quads: EncodedQuad[]): void {
    this.worker.postMessage({ type: 'load', quads });
  }

  apply(added: EncodedQuad[], removed: EncodedQuad[]): void {
    this.worker.postMessage({ type: 'apply', added, removed });
  }

  get busy(): boolean {
    return this.running !== undefined || this.waiting.length > 0;
  }

  validate(): Promise<ValidationReport | undefined> {
    const answer = new Promise<ValidationReport | undefined>((resolve) => this.waiting.push(resolve));
    if (this.running === undefined) this.start();
    else this.again = true;
    return answer;
  }

  dispose(): void {
    this.worker.terminate();
    this.settle(undefined);
  }

  private start(): void {
    this.running = ++this.nextId;
    this.again = false;
    this.worker.postMessage({ type: 'validate', id: this.running });
  }

  private answer(message: WorkerAnswer): void {
    if (message.type === 'error') {
      console.warn('[la-gram] Validation failed:', message.message);
      if (message.id !== undefined && message.id === this.running) this.finish(undefined);
      return;
    }
    if (message.id !== this.running) return;
    this.onTiming?.(message.report.timing);
    this.finish(fromPlainReport(message.report, toTerm));
  }

  /** A validation came back: run again if asked meanwhile, else give the report to the waiting. */
  private finish(report: ValidationReport | undefined): void {
    this.running = undefined;
    if (this.again) {
      // What it validated is already stale: the earlier callers are superseded.
      const last = this.waiting.pop();
      for (const resolve of this.waiting) resolve(undefined);
      this.waiting = last ? [last] : [];
      this.start();
      return;
    }
    this.settle(report);
  }

  private settle(report: ValidationReport | undefined): void {
    const waiting = this.waiting;
    this.waiting = [];
    this.running = undefined;
    const last = waiting.pop();
    for (const resolve of waiting) resolve(undefined);
    last?.(report);
  }
}

/**
 * The service for this environment: a worker where there are workers (and
 * `inline` is not asked for), the calling thread otherwise.
 */
export function createValidationService(options: { inline?: boolean; onTiming?: (timing: PlainReport['timing']) => void } = {}): ValidationService {
  if (!options.inline && typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    try {
      const worker = new Worker(new URL('./validation.worker.ts', import.meta.url));
      return new WorkerValidationService(worker as unknown as WorkerLike, options.onTiming);
    } catch (err: unknown) {
      console.warn('[la-gram] No validation worker; validating on the UI thread', err);
    }
  }
  return new InlineValidationService();
}
