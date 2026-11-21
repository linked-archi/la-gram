/**
 * A channel's build keeps its browser storage apart from the release's, on the same origin (Req 15.10).
 */
import { describe, it, expect } from 'vitest';
import { ScopedStorage, scopeBrowserStorage, scopedName, unscopedKey } from '../storage-scope.js';
import { MemoryStorage } from '../git/__tests__/memory-storage.js';

describe('the storage of a channel’s build', () => {
  it('the alpha’s keys under alpha:, the release’s as they were; clearing one leaves the other', () => {
    const origin = new MemoryStorage();
    origin.setItem('la-gram:settings', '{"release":true}');
    const alpha = new ScopedStorage(origin, 'alpha:');
    expect(alpha.getItem('la-gram:settings')).toBeNull();
    alpha.setItem('la-gram:settings', '{"alpha":true}');
    expect(origin.getItem('alpha:la-gram:settings')).toBe('{"alpha":true}');
    expect(origin.getItem('la-gram:settings')).toBe('{"release":true}');
    expect([alpha.length, alpha.key(0)]).toEqual([1, 'la-gram:settings']);
    alpha.clear();
    expect([alpha.length, origin.getItem('la-gram:settings')]).toEqual([0, '{"release":true}']);
  });

  it('installed for a channel only, once; the checkpoints’ database named with it; another channel’s events not its own', () => {
    const origin = new MemoryStorage();
    const global = { localStorage: origin } as unknown as typeof globalThis;
    scopeBrowserStorage('', global);
    expect(global.localStorage).toBe(origin);
    scopeBrowserStorage('alpha', global);
    scopeBrowserStorage('alpha', global);
    global.localStorage.setItem('k', 'v');
    expect(origin.getItem('alpha:k')).toBe('v');
    expect([scopedName('la-gram-history', ''), scopedName('la-gram-history', 'alpha')]).toEqual(['la-gram-history', 'la-gram-history-alpha']);
    expect([unscopedKey('alpha:k', 'alpha'), unscopedKey('k', 'alpha'), unscopedKey('alpha:k', ''), unscopedKey(null, 'alpha')]).toEqual(['k', null, 'alpha:k', null]);
  });
});
