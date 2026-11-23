/** Completion-scheduled remote checks, independent of commit history (Req 18.25). */
import { snapshotOfText } from '../model-manager/model-merge.js';
import { GitError } from './errors.js';
import { bindingKey, destinationKey, observeGit, ObsoleteGitRead, type GitObservation } from './git-observation.js';
import { sameLines } from './git-merge.js';
import { applyGitObservation, type GitPullContext } from './git-pull.js';
import { formatOfPath, type PersonalGitSettings } from './git-save.js';
import type { GitLocks, GitLockResult } from './git-locks.js';
import { AutoCommitStore, autoCommitKey, type AutoCommitSettings } from './auto-commit-settings.js';
import { autoCommit } from './git-auto-commit.js';

export interface GitSyncStatus {
  phase: 'unchecked' | 'checking' | 'committing' | 'incoming' | 'local' | 'current' | 'paused' | 'conflicts' | 'error';
  message: string;
  where?: string;
  local?: boolean;
  incoming?: boolean;
  lastChecked?: number;
  nextCheck?: number;
  intervalMinutes: number;
  autoPull: boolean;
  canCheck: boolean;
  canPull: boolean;
  autoCommit?: AutoCommitSettings;
  nextCommit?: number;
  lastCommit?: number;
  canResume?: boolean;
}

export interface SyncClock {
  now(): number;
  after(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}

export interface GitSyncDeps {
  context: GitPullContext;
  settings(): PersonalGitSettings;
  visible(): boolean;
  online(): boolean;
  busy(): boolean;
  locks: GitLocks;
  run(operation: () => Promise<void>, automatic: boolean): Promise<GitLockResult<void>>;
  publish(status: GitSyncStatus): void;
  clock?: SyncClock;
  autoCommits?: AutoCommitStore;
}

export function syncSettings(settings: PersonalGitSettings): { minutes: number; autoPull: boolean } {
  const minutes = [1, 2, 5, 10].includes(settings.checkIntervalMinutes ?? 0) ? settings.checkIntervalMinutes! : 0;
  return { minutes, autoPull: minutes > 0 && settings.autoPull === true };
}

export class GitSync {
  private readonly clock: SyncClock;
  private generation = 0;
  private stopped = false;
  private checking = false;
  private scope = '';
  private environment = '';
  private settingsKey = '';
  private minutes = 0;
  private autoPull = false;
  private observed?: GitObservation;
  private local?: boolean;
  private lastChecked?: number;
  private due?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private editTimer?: ReturnType<typeof setTimeout>;
  private ownerKey?: string;
  private releaseOwner?: () => void;
  private ownerAttempt = 0;
  private owns = false;
  private lockFailed = false;
  private error?: string;
  private blocked = false;
  private failures = 0;
  private committing = false;
  private modelEpoch = 0;
  private room?: string;
  private readonly editor = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  private internal = 0;
  private revision = 0;
  private lastEdit = 0;
  private autoKey = '';
  private auto: AutoCommitSettings = { mode: 'off', idleMinutes: 2, intervalMinutes: 10 };
  private commitDue?: number;
  private commitRetry = 0;
  private commitFailures = 0;
  private lastCommit?: number;

  constructor(private readonly deps: GitSyncDeps) {
    this.clock = deps.clock ?? { now: () => Date.now(), after: (fn, ms) => setTimeout(fn, ms), cancel: (timer) => clearTimeout(timer) };
  }

  private binding() {
    const model = this.deps.context.modelIri();
    return model ? this.deps.context.bindings.get(model) : undefined;
  }

  private scopeKey(): string { return `${this.deps.context.modelIri() ?? ''}\n${bindingKey(this.binding())}`; }

  modelLoaded(): void { this.modelEpoch++; this.refresh(true); }

  /** Pull/merge mutations are not user edits for the idle timer. */
  internalChange<T>(operation: () => T): T {
    this.internal++;
    try { return operation(); } finally { this.internal--; }
  }

  pause(): void {
    if (this.autoKey) this.deps.autoCommits?.pause(this.autoKey, 'Paused by you. Resume auto-commit when ready.');
    this.refresh();
  }

  resume(): void {
    if (!this.autoKey || this.unavailable(false) || this.committing || this.deps.busy()) return;
    this.deps.autoCommits?.resume(this.autoKey);
    this.commitRetry = 0;
    this.refresh(true);
  }

  /** Only a completed manual Git save acknowledges pending writes; local-file saves do not. */
  manualCommitted(): void {
    const binding = this.binding();
    if (!binding) return;
    const key = autoCommitKey(this.deps.context.modelIri()!, binding);
    this.refresh(true);
    try {
      this.deps.autoCommits?.clear(key);
      this.deps.autoCommits?.resume(key);
    } catch {
      this.deps.autoCommits?.pause(key, 'Saved to Git, but the pending-write record could not be cleared. Restore local storage before resuming auto-commit.');
    }
    this.lastCommit = this.clock.now();
    this.refresh();
  }

  /** Manual Pull already read and incorporated this version: reuse it without another request. */
  incorporated(observed: GitObservation, dirty: boolean): void {
    this.refresh();
    if (this.stopped || observed.modelIri !== this.deps.context.modelIri() || this.binding()?.commit !== observed.head) return;
    this.observed = { ...observed, binding: this.binding()!, base: observed.remote, incoming: false };
    this.local = dirty;
    this.lastChecked = this.clock.now();
    this.due = this.clock.now() + this.minutes * 60_000;
    this.error = undefined;
    this.blocked = false;
    this.refresh();
  }

  /** Called on model, room, settings, visibility/connectivity and manual-flow transitions. */
  refresh(reset = false): void {
    if (this.stopped) return;
    const scope = this.scopeKey();
    const settings = syncSettings(this.deps.settings());
    const binding = this.binding();
    const autoKey = binding ? autoCommitKey(this.deps.context.modelIri()!, binding) : '';
    const room = this.deps.context.room();
    // Leaving and returning must not revive a write sent by the previous destination/room lifecycle.
    if (autoKey !== this.autoKey || room !== this.room) this.modelEpoch++;
    this.room = room;
    const auto = this.deps.autoCommits?.get(autoKey) ?? this.auto;
    if (auto.mode !== 'off' && !auto.paused && (this.deps.context.merge?.unresolved() || binding?.update)) {
      auto.paused = 'Finish the conflicts or branch merge, then Save to Git or Resume auto-commit.';
      this.deps.autoCommits?.pause(autoKey, auto.paused);
    }
    const autoChanged = autoKey !== this.autoKey || JSON.stringify(auto) !== JSON.stringify(this.auto);
    const settingsKey = JSON.stringify([settings, auto]);
    const environment = JSON.stringify([this.deps.visible(), this.deps.online(), this.deps.context.room()]);
    if (reset || scope !== this.scope || settingsKey !== this.settingsKey || environment !== this.environment) this.generation++;
    if (reset || scope !== this.scope || settingsKey !== this.settingsKey) {
      this.error = undefined;
      this.blocked = false;
      this.lockFailed = false;
      this.failures = 0;
    }
    if (scope !== this.scope) {
      this.observed = undefined;
      this.local = undefined;
      this.lastChecked = undefined;
    }
    if (scope !== this.scope || settingsKey !== this.settingsKey || reset) this.due = this.clock.now() + settings.minutes * 60_000;
    this.scope = scope;
    this.settingsKey = settingsKey;
    this.environment = environment;
    this.minutes = settings.minutes;
    this.autoPull = settings.autoPull;
    if (autoKey !== this.autoKey) { this.lastCommit = undefined; this.commitRetry = 0; this.commitFailures = 0; }
    if (autoChanged || reset) {
      this.commitDue = this.clock.now() + (auto.mode === 'idle' ? auto.idleMinutes : auto.intervalMinutes) * 60_000;
    }
    this.autoKey = autoKey;
    this.auto = auto;
    this.ownership();
    this.schedule();
    this.render();
  }

  /** Debounce status snapshots; never serialize a large model on each pointer movement. */
  modelChanged(): void {
    if (this.stopped) return;
    if (!this.internal) {
      this.revision++;
      this.lastEdit = this.clock.now();
      if (this.auto.mode === 'idle') this.commitDue = this.lastEdit + this.auto.idleMinutes * 60_000;
      this.schedule();
    }
    if (this.editTimer !== undefined) this.clock.cancel(this.editTimer);
    this.editTimer = this.clock.after(() => {
      this.editTimer = undefined;
      this.refresh();
      if (this.observed) {
        try { this.local = !sameLines(this.snapshot(), this.observed.base); }
        catch { this.local = true; }
        this.render();
      }
    }, 150);
  }

  private snapshot(): string[] {
    const binding = this.binding()!;
    const format = formatOfPath(binding.path);
    if (!format) throw new GitError('invalid', `The file format of ${binding.path} is not supported.`);
    return snapshotOfText(this.deps.context.serialize(format), binding.path);
  }

  private unavailable(automatic: boolean): string | undefined {
    const ctx = this.deps.context;
    if (!this.binding()) return 'Open from Git or Save to Git to bind this model.';
    if (ctx.room()) return 'Git synchronization is paused in a shared room.';
    if (ctx.merge?.unresolved()) return 'Choose the remaining changes in the Conflicts tab.';
    if (this.binding()?.update) return 'Finish the pending branch merge with Save to Git.';
    if (!this.deps.online()) return 'Offline. Checks resume when the connection returns.';
    if (automatic && !this.deps.visible()) return 'Checks are paused while this app is hidden.';
    return undefined;
  }

  private ownership(): void {
    const binding = this.binding();
    const wanted = binding && ((this.minutes && !this.blocked) || this.autoEnabled()) && !this.unavailable(true) && !this.lockFailed && this.deps.locks.available
      ? destinationKey(binding) : undefined;
    if (wanted === this.ownerKey) return;
    this.releaseOwner?.();
    this.releaseOwner = undefined;
    this.owns = false;
    this.ownerKey = wanted;
    const attempt = ++this.ownerAttempt;
    if (wanted) this.releaseOwner = this.deps.locks.own(wanted, () => {
      if (this.stopped || attempt !== this.ownerAttempt) return;
      this.owns = true;
      this.schedule();
      this.render();
    }, () => {
      if (this.stopped || attempt !== this.ownerAttempt) return;
      this.lockFailed = true;
      this.refresh();
    });
  }

  private schedule(): void {
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = undefined;
    if (this.stopped || this.checking || this.committing || !this.owns || this.unavailable(true) || this.deps.busy()) return;
    const checkDue = this.minutes && !this.blocked ? this.due : undefined;
    const commitDue = this.autoEnabled() && this.commitDue !== undefined ? Math.max(this.commitDue, this.commitRetry) : undefined;
    const due = Math.min(checkDue ?? Infinity, commitDue ?? Infinity);
    if (!Number.isFinite(due)) return;
    // Avoid overflow for a host's very distant Retry-After; check again at the capped deadline.
    const delay = Math.min(2_147_000_000, Math.max(0, due - this.clock.now()));
    this.timer = this.clock.after(() => {
      this.timer = undefined;
      if (due > this.clock.now()) { this.schedule(); return; }
      if (commitDue !== undefined && commitDue <= due) void this.commit();
      else void this.check(true);
    }, delay);
  }

  private autoEnabled(): boolean { return !!this.autoKey && this.auto.mode !== 'off' && !this.auto.paused; }

  private async commit(): Promise<void> {
    this.refresh();
    if (this.stopped || this.checking || this.committing || !this.owns || !this.autoEnabled() || this.unavailable(true)) return;
    const generation = this.generation;
    const epoch = this.modelEpoch;
    const key = this.autoKey;
    const ctx = this.deps.context;
    const active = () => !this.stopped && epoch === this.modelEpoch && ctx.current() && this.autoKey === key;
    const canWrite = () => active() && generation === this.generation && this.autoEnabled() && this.owns && !this.unavailable(true);
    this.committing = true;
    this.render();
    try {
      const result = await this.deps.run(async () => {
        const revision = await autoCommit({ context: ctx, store: this.deps.autoCommits!, stamp: `${this.editor}:${epoch}`,
          active, canWrite, revision: () => this.revision,
          observed: (observed, incorporated) => {
            this.observed = observed;
            if (incorporated) this.scope = this.scopeKey();
            this.local = !sameLines(this.snapshot(), observed.base);
            this.lastChecked = this.clock.now();
            this.due = this.clock.now() + this.minutes * 60_000;
          },
          committed: () => { this.lastCommit = this.clock.now(); },
        });
        if (active()) {
          this.error = undefined;
          this.commitRetry = 0;
          this.commitFailures = 0;
          this.commitDue = this.auto.mode === 'interval' ? this.clock.now() + this.auto.intervalMinutes * 60_000
            : revision < this.revision ? this.lastEdit + this.auto.idleMinutes * 60_000 : undefined;
        }
      }, true);
      if (!result.ran && active()) {
        if (result.reason === 'unavailable') this.deps.autoCommits!.pause(key, 'Auto-commit requires browser support for coordinating tabs.');
        else this.commitRetry = this.clock.now() + 1000;
      }
    } catch (error: unknown) {
      if (!(error instanceof ObsoleteGitRead) && active()) {
        if (error instanceof GitError && ['network', 'server', 'rate-limit'].includes(error.kind)) {
          this.commitRetry = Math.max(this.clock.now() + Math.min(600_000, 60_000 * 2 ** Math.min(++this.commitFailures, 4)), error.retryAt ?? 0);
          if (this.minutes) this.due = Math.max(this.due ?? 0, this.commitRetry);
          this.error = `${error.message} Auto-commit will retry after the delay.`;
        } else this.deps.autoCommits!.pause(key, error instanceof Error ? error.message : String(error));
      }
    } finally { this.committing = false; this.refresh(); }
  }

  /** Manual checks observe only; scheduled checks may apply the explicit clean-only opt-in. */
  async check(automatic = false): Promise<void> {
    this.refresh();
    if (this.stopped || this.checking || this.committing || this.unavailable(automatic) || (automatic && (!this.owns || this.blocked || !this.minutes))) return;
    const ctx = this.deps.context;
    const binding = this.binding()!;
    const started = this.generation;
    const current = () => !this.stopped && started === this.generation && ctx.current() && this.scopeKey() === this.scope
      && !this.unavailable(automatic) && (!automatic || (this.owns && this.minutes > 0));
    this.checking = true;
    this.render();
    try {
      const result = await this.deps.run(async () => {
        const observed = await observeGit(ctx, binding, current, !automatic, this.observed);
        if (!current()) throw new ObsoleteGitRead();
        if (!observed) {
          this.error = 'Check cancelled. Use Check for remote changes to retry.';
          this.blocked = true;
          return;
        }
        this.observed = observed;
        this.local = !sameLines(this.snapshot(), observed.base);
        if (automatic && this.autoPull && observed.incoming && !this.local) {
          // The helper captures the model again immediately before applying. No await follows the check.
          const applied = applyGitObservation({ ...ctx, current }, observed, true);
          if (applied.applied) {
            this.observed = { ...observed, binding: this.binding()!, base: observed.remote, incoming: false };
            this.scope = this.scopeKey();
          }
          this.local = applied.dirty;
        }
        this.lastChecked = this.clock.now();
        this.error = undefined;
        this.blocked = false;
        this.failures = 0;
        this.due = this.clock.now() + this.minutes * 60_000;
      }, automatic);
      if (!result.ran && current()) {
        this.error = result.reason === 'busy' ? 'Another Git operation is in progress.' : 'Automatic checks require browser support for coordinating tabs.';
        this.blocked = result.reason === 'unavailable';
        this.due = this.clock.now() + 1000;
      }
    } catch (error: unknown) {
      if (!(error instanceof ObsoleteGitRead) && current()) {
        this.error = error instanceof Error ? error.message : String(error);
        const transient = error instanceof GitError && ['network', 'server', 'rate-limit'].includes(error.kind);
        this.blocked = !transient;
        if (transient) {
          const delay = Math.min(10 * 60_000, Math.max(60_000, this.minutes * 60_000) * 2 ** Math.min(++this.failures, 4));
          this.due = Math.max(this.clock.now() + delay, error.retryAt ?? 0);
        } else {
          this.error += ' Use Check for remote changes to retry.';
          if (!automatic && error instanceof GitError && error.kind === 'auth') await ctx.tokens.forget(binding.host);
        }
      }
    } finally {
      this.checking = false;
      this.refresh();
    }
  }

  private render(): void {
    if (this.stopped) return;
    const binding = this.binding();
    const automated = this.minutes > 0 || this.auto.mode !== 'off';
    const unavailable = this.unavailable(automated);
    let phase: GitSyncStatus['phase'] = this.observed ? this.observed.incoming ? 'incoming' : this.local ? 'local' : 'current' : 'unchecked';
    let message = phase === 'incoming' ? (this.local ? 'Remote changes are available; local changes are kept for manual pull.' : 'Remote changes are available.')
      : phase === 'local' ? 'Local changes are not saved to Git. No incoming changes.'
      : phase === 'current' ? 'No local or incoming model changes.' : 'Not checked yet.';
    if (this.committing) { phase = 'committing'; message = 'Reconciling and committing local changes…'; }
    else if (this.checking) { phase = 'checking'; message = 'Checking for remote changes…'; }
    else if (unavailable) { phase = this.deps.context.merge?.unresolved() ? 'conflicts' : 'paused'; message = unavailable; }
    else if (this.auto.mode !== 'off' && this.auto.paused) { phase = 'paused'; message = this.auto.paused; }
    else if (this.error) { phase = 'error'; message = this.error; }
    else if (automated && (!this.deps.locks.available || this.lockFailed)) {
      phase = 'paused'; message = 'Automatic checks require browser support for coordinating tabs. Manual Check and Pull remain available.';
    } else if (automated && !this.owns) { phase = 'paused'; message = 'Another tab is checking this file. This tab will take over when available.'; }
    const canAct = !!binding && !this.checking && !this.committing && !this.deps.busy() && !this.unavailable(false);
    this.deps.publish({ phase, message, where: binding ? `${binding.repository} · ${binding.branch} · ${binding.path}` : undefined,
      local: this.local, incoming: this.observed?.incoming, lastChecked: this.lastChecked,
      nextCheck: this.minutes && this.owns && !this.blocked && !unavailable ? this.due : undefined,
      intervalMinutes: this.minutes, autoPull: this.autoPull, canCheck: canAct, canPull: canAct,
      autoCommit: this.auto, lastCommit: this.lastCommit, canResume: canAct,
      nextCommit: this.autoEnabled() && this.owns && !unavailable && this.commitDue !== undefined ? Math.max(this.commitDue, this.commitRetry) : undefined });
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.ownerAttempt++;
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    if (this.editTimer !== undefined) this.clock.cancel(this.editTimer);
    this.releaseOwner?.();
  }
}
