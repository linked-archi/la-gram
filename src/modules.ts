/**
 * Switchable modules (Req 18.1): parts of la-gram that can be turned off. Off,
 * a module shows nothing, loads none of its code and talks to no one.
 *
 * Switched in three places, the first winning:
 *
 * - the build — a module the build leaves out is never registered
 *   (`LA_GRAM_GIT=off` for Git storage; `index.ts`);
 * - `?<id>=off` in the address — off for the session;
 * - a setting kept on this machine (`localStorage`), on by default — File →
 *   Modules….
 *
 * A module's code is imported when it starts, so one that stays off is never
 * fetched.
 */

/** A module la-gram can switch. */
export interface ModuleDescriptor {
  id: string;
  label: string;
  /** What it does, in a line, for File → Modules…. */
  detail: string;
  /** Import and start it. */
  start(): Promise<StartedModule>;
}

/** A started module. */
export interface StartedModule {
  stop(): void;
}

/** A module as File → Modules… shows it. */
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
  ) {
    this.sessionOff = new Set([...params.entries()].filter(([, v]) => v === 'off').map(([k]) => k));
  }

  register(module: ModuleDescriptor): void {
    this.modules.push(module);
  }

  /** Whether a module is on: not off for the session, and not switched off here. */
  enabled(id: string): boolean {
    return this.modules.some((m) => m.id === id) && !this.sessionOff.has(id) && this.setting()[id] !== false;
  }

  /** Whether it is running. */
  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** The registered modules, for File → Modules…. */
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
    const setting = this.setting();
    if (on) delete setting[id];
    else setting[id] = false;
    try {
      if (Object.keys(setting).length === 0) this.storage?.removeItem(KEY);
      else this.storage?.setItem(KEY, JSON.stringify(setting));
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
