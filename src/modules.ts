/**
 * Switchable modules (Req 18.1): parts of la-gram that can be turned off. Off,
 * a module shows nothing, loads none of its code and talks to no one.
 *
 * Switched in these places, the first winning (Req 19.7):
 *
 * - the build — a module the build leaves out is never registered
 *   (`LA_GRAM_GIT=off` for Git storage; `index.ts`);
 * - the deployment's configuration (`config.ts`): `unavailable` — not
 *   registered either;
 * - `?<id>=off` in the address — off for the session;
 * - the user's choice, kept on this machine (`localStorage`) — File › Settings…;
 * - the deployment's default: `on`, or `off` until the user switches it on;
 * - on.
 *
 * A module's code is imported when it starts, so one that stays off is never
 * fetched.
 */

import type { ModuleAvailability } from './config.js';

/** A module la-gram can switch. */
export interface ModuleDescriptor {
  id: string;
  label: string;
  /** What it does, in a line, for File › Settings…. */
  detail: string;
  /** Import and start it. */
  start(): Promise<StartedModule>;
}

/** A started module. */
export interface StartedModule {
  stop(): void;
}

/** A module as File › Settings… shows it. */
export interface ModuleSwitch {
  id: string;
  label: string;
  detail: string;
  enabled: boolean;
}

const KEY = 'la-gram:modules';

/** The registered modules, which of them run, and the setting. */
export class ModuleSwitchboard {
  private readonly modules: ModuleDescriptor[] = [];
  private readonly running = new Map<string, StartedModule>();
  private readonly sessionOff: Set<string>;

  constructor(
    params: URLSearchParams = new URLSearchParams(),
    private readonly storage: Storage | undefined = safeLocalStorage(),
    private readonly onError: (id: string, err: unknown) => void = (id, err) =>
      console.error(`[la-gram] The ${id} module did not start`, err),
    /** The deployment's availability per module (`config.ts`); absent: `on`. */
    private readonly availability: Record<string, ModuleAvailability> = {},
  ) {
    this.sessionOff = new Set([...params.entries()].filter(([, v]) => v === 'off').map(([k]) => k));
  }

  /** Register a module — unless the deployment makes it unavailable. */
  register(module: ModuleDescriptor): void {
    if (this.availability[module.id] === 'unavailable') return;
    this.modules.push(module);
  }

  /** Whether a module is on: not off for the session; else the user's choice; else the deployment's default. */
  enabled(id: string): boolean {
    if (!this.modules.some((m) => m.id === id) || this.sessionOff.has(id)) return false;
    return this.setting()[id] ?? this.availability[id] !== 'off';
  }

  /** Whether it is running. */
  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** The registered modules, for File › Settings…. */
  list(): ModuleSwitch[] {
    return this.modules.map((m) => ({ id: m.id, label: m.label, detail: m.detail, enabled: this.enabled(m.id) }));
  }

  /** Start every module that is on. */
  async startEnabled(): Promise<void> {
    for (const module of this.modules) if (this.enabled(module.id)) await this.start(module);
  }

  /** Switch a module on or off, here, and start or stop it now. */
  async set(id: string, on: boolean): Promise<void> {
    const module = this.modules.find((m) => m.id === id);
    if (!module) return;
    this.sessionOff.delete(id);
    // The choice is kept either way: a module the deployment has off by default stays on once switched on.
    const setting = { ...this.setting(), [id]: on };
    try {
      this.storage?.setItem(KEY, JSON.stringify(setting));
    } catch {
      // Storage refused: the switch holds for the session.
    }
    if (on && !this.running.has(id)) await this.start(module);
    if (!on) {
      this.running.get(id)?.stop();
      this.running.delete(id);
    }
  }

  private async start(module: ModuleDescriptor): Promise<void> {
    try {
      this.running.set(module.id, await module.start());
    } catch (err: unknown) {
      this.onError(module.id, err);
    }
  }

  private setting(): Record<string, boolean> {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
