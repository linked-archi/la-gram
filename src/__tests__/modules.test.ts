/**
 * Switchable modules (Req 18.1): on by default; off by a setting kept on this
 * machine, or by `?<id>=off` for the session; started and stopped as switched.
 */
import { describe, it, expect, vi } from 'vitest';
import { ModuleSwitchboard, type ModuleDescriptor } from '../modules.js';
import { MemoryStorage } from '../git/__tests__/memory-storage.js';

function module(id = 'git') {
  const stop = vi.fn();
  const start = vi.fn(async () => ({ stop }));
  const descriptor: ModuleDescriptor = { id, label: 'Git storage', detail: 'commits', start };
  return { descriptor, start, stop };
}

describe('the switchboard', () => {
  it('a registered module is on, and starts', async () => {
    const m = module();
    const board = new ModuleSwitchboard(new URLSearchParams(), new MemoryStorage());
    board.register(m.descriptor);
    await board.startEnabled();
    expect(m.start).toHaveBeenCalledOnce();
    expect(board.list()).toEqual([{ id: 'git', label: 'Git storage', detail: 'commits', enabled: true }]);
    expect(board.isRunning('git')).toBe(true);
  });

  it('switched off here: not started, and remembered on this machine', async () => {
    const storage = new MemoryStorage();
    const first = module();
    const board = new ModuleSwitchboard(new URLSearchParams(), storage);
    board.register(first.descriptor);
    await board.startEnabled();
    await board.set('git', false);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(board.isRunning('git')).toBe(false);

    const next = module();
    const again = new ModuleSwitchboard(new URLSearchParams(), storage);
    again.register(next.descriptor);
    await again.startEnabled();
    expect(next.start).not.toHaveBeenCalled();
    expect(again.list()[0].enabled).toBe(false);

    await again.set('git', true);
    expect(next.start).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem('la-gram:modules')!)).toEqual({ git: true });
  });

  it('the deployment’s “off”: off until the user switches it on — and that choice is kept', async () => {
    const storage = new MemoryStorage();
    const m = module();
    const board = new ModuleSwitchboard(new URLSearchParams(), storage, undefined, { git: 'off' });
    board.register(m.descriptor);
    await board.startEnabled();
    expect(m.start).not.toHaveBeenCalled();
    expect(board.list()[0].enabled).toBe(false);
    await board.set('git', true);
    const next = module();
    const again = new ModuleSwitchboard(new URLSearchParams(), storage, undefined, { git: 'off' });
    again.register(next.descriptor);
    await again.startEnabled();
    expect(next.start).toHaveBeenCalledOnce();
  });

  it('the deployment’s “unavailable”: not registered, not listed, nothing to switch', async () => {
    const m = module();
    const board = new ModuleSwitchboard(new URLSearchParams(), new MemoryStorage(), undefined, { git: 'unavailable' });
    board.register(m.descriptor);
    await board.startEnabled();
    expect(board.list()).toEqual([]);
    expect(m.start).not.toHaveBeenCalled();
    await board.set('git', true);
    expect(m.start).not.toHaveBeenCalled();
  });

  it('?git=off: off for the session, the setting untouched', async () => {
    const storage = new MemoryStorage();
    const m = module();
    const board = new ModuleSwitchboard(new URLSearchParams('git=off&room=shop'), storage);
    board.register(m.descriptor);
    await board.startEnabled();
    expect(m.start).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
    await board.set('git', true);
    expect(m.start).toHaveBeenCalledOnce();
  });

  it('a build without the module: nothing to switch, nothing on', () => {
    const board = new ModuleSwitchboard(new URLSearchParams(), new MemoryStorage());
    expect(board.list()).toEqual([]);
    expect(board.enabled('git')).toBe(false);
  });

  it('a module that fails to start is reported, and not running', async () => {
    const onError = vi.fn();
    const board = new ModuleSwitchboard(new URLSearchParams(), new MemoryStorage(), onError);
    board.register({ id: 'git', label: 'Git', detail: '', start: async () => Promise.reject(new Error('chunk failed')) });
    await board.startEnabled();
    expect(onError).toHaveBeenCalledWith('git', expect.any(Error));
    expect(board.isRunning('git')).toBe(false);
  });
});
