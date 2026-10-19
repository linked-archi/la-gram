/**
 * Personal settings (Req 19.5): each part of la-gram's own, kept on this
 * machine — this browser profile's `localStorage`, `la-gram:settings`, one
 * object per section (`{ "git": { "folder": "architecture" } }`).
 *
 * Set in *File › Settings…*; read each time they are used, so a change applies
 * at once. They are defaults — the deployment's policies are never set here
 * (`config.ts`, Req 19.6–19.7).
 */

const KEY = 'la-gram:settings';

/** The settings kept on this machine. */
export class PersonalSettings {
  private readonly memory = new Map<string, Record<string, unknown>>();

  constructor(private readonly storage: Storage | undefined = safeLocalStorage()) {}

  /** A section's settings; empty when none are kept. */
  get<T extends object>(section: string): Partial<T> {
    return { ...((this.all()[section] ?? this.memory.get(section) ?? {}) as Partial<T>) };
  }

  /** Replace a section's settings; a value `undefined` or `''` is not kept (the default applies). */
  set(section: string, values: Record<string, unknown>): void {
    const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== ''));
    this.memory.set(section, kept);
    const all = this.all();
    if (Object.keys(kept).length === 0) delete all[section];
    else all[section] = kept;
    try {
      if (Object.keys(all).length === 0) this.storage?.removeItem(KEY);
      else this.storage?.setItem(KEY, JSON.stringify(all));
    } catch {
      // Storage refused: the settings hold for the session.
    }
  }

  private all(): Record<string, Record<string, unknown>> {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Record<string, unknown>>) : {};
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
