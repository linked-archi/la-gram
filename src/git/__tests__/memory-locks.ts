/** Queued exclusive locks shared by test editors; no platform globals or real services. */
import { GitLocks } from '../git-locks.js';

export class MemoryLocks {
  private held = new Set<string>();
  private waiting = new Map<string, Array<() => void>>();

  client(): GitLocks {
    return new GitLocks({ request: this.request.bind(this) } as unknown as LockManager);
  }

  private request<T>(name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const queue = this.waiting.get(name);
        if (queue) this.waiting.set(name, queue.filter((item) => item !== take));
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const take = () => {
        options.signal?.removeEventListener('abort', abort);
        if (options.signal?.aborted) { abort(); return; }
        this.held.add(name);
        void Promise.resolve().then(() => callback({ name, mode: 'exclusive' } as Lock)).then(resolve, reject).finally(() => {
          this.held.delete(name);
          this.waiting.get(name)?.shift()?.();
        });
      };
      if (options.signal?.aborted) { abort(); return; }
      if (options.ifAvailable && this.held.has(name)) { void Promise.resolve(callback(null)).then(resolve, reject); return; }
      if (this.held.has(name)) {
        const queue = this.waiting.get(name) ?? [];
        queue.push(take);
        this.waiting.set(name, queue);
        options.signal?.addEventListener('abort', abort, { once: true });
      } else take();
    });
  }
}
