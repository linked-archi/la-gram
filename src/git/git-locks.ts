/** Browser-profile ownership is separate from the short lock on each Git operation. */
export type GitLockResult<T> = { ran: true; value: T } | { ran: false; reason: 'busy' | 'unavailable' };

export class GitLocks {
  constructor(private readonly locks: LockManager | null | undefined = globalThis.navigator?.locks) {}

  get available(): boolean { return !!this.locks; }

  /** Keep one visible editor scheduled; waiting owners take over when it releases. */
  own(key: string, acquired: () => void, failed: () => void): () => void {
    const controller = new AbortController();
    let release = () => {};
    if (!this.locks) return () => {};
    void Promise.resolve().then(() => this.locks!.request(`la-gram:git-owner:${key}`, { signal: controller.signal }, async () => {
      if (controller.signal.aborted) return;
      const held = new Promise<void>((resolve) => { release = resolve; });
      acquired();
      await held;
    })).catch(() => { if (!controller.signal.aborted) failed(); });
    return () => { controller.abort(); release(); };
  }

  /** Manual actions still work on platforms without locks; automation must pause. */
  async run<T>(key: string | undefined, automatic: boolean, operation: () => Promise<T>): Promise<GitLockResult<T>> {
    if (!key || !this.locks) return automatic ? { ran: false, reason: 'unavailable' } : { ran: true, value: await operation() };
    let started = false;
    try {
      return await this.locks.request(`la-gram:git-operation:${key}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return { ran: false as const, reason: 'busy' as const };
        started = true;
        return { ran: true as const, value: await operation() };
      });
    } catch (error) {
      // A browser may expose the API but deny access. Never retry an operation that already ran.
      if (started) throw error;
      return automatic ? { ran: false, reason: 'unavailable' } : { ran: true, value: await operation() };
    }
  }
}
