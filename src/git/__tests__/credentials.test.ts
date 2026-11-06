/**
 * Where tokens are kept (Req 18.5): the session always, beyond it only when
 * asked — the system keychain on the desktop, this browser's storage on the web.
 */
import { describe, it, expect, vi } from 'vitest';
import { DesktopTokenStore, WebTokenStore } from '../credentials.js';
import type { DesktopBridge } from '../../platform/desktop-bridge.js';
import { MemoryStorage } from './memory-storage.js';

describe('the web build', () => {
  it('keeps a token for the session only, unless asked', async () => {
    const storage = new MemoryStorage();
    const store = new WebTokenStore(storage);
    expect(store.rememberByDefault).toBe(false);
    await store.set('GitHub.com', 'tok-1', false);
    expect(await store.get('github.com')).toBe('tok-1');
    expect(storage.dump()).not.toContain('tok-1');
    expect(await new WebTokenStore(storage).get('github.com')).toBeUndefined();
  });

  it('remembers on this browser when asked, and forgets', async () => {
    const storage = new MemoryStorage();
    const store = new WebTokenStore(storage);
    await store.set('gitlab.com', 'tok-2', true);
    expect(await new WebTokenStore(storage).get('gitlab.com')).toBe('tok-2');
    expect(await store.hosts()).toEqual(['gitlab.com']);
    await store.forget('gitlab.com');
    expect(await store.get('gitlab.com')).toBeUndefined();
    expect(storage.length).toBe(0);
  });

  it('not remembering a host again takes it out of the browser', async () => {
    const storage = new MemoryStorage();
    const store = new WebTokenStore(storage);
    await store.set('gitlab.com', 'old', true);
    await store.set('gitlab.com', 'new', false);
    expect(storage.dump()).not.toContain('old');
    expect(await store.get('gitlab.com')).toBe('new');
  });

  it('switched off, the session forgets', async () => {
    const store = new WebTokenStore(new MemoryStorage());
    await store.set('github.com', 'tok', false);
    store.clearSession();
    expect(await store.get('github.com')).toBeUndefined();
  });
});

/** The bridge, as the main process answers it, over a map. */
function bridge(available: boolean) {
  const kept = new Map<string, string>();
  const b: DesktopBridge = {
    showOpenDialog: async () => null,
    showSaveDialog: async () => null,
    readFile: async () => ({ content: '', name: '' }),
    writeFile: async () => undefined,
    secretsAvailable: async () => available,
    secretGet: vi.fn(async (key: string) => kept.get(key) ?? null),
    secretSet: vi.fn(async (key: string, value: string) => {
      if (!available) throw new Error('no keychain');
      kept.set(key, value);
    }),
    secretDelete: vi.fn(async (key: string) => {
      kept.delete(key);
    }),
    secretKeys: async () => [...kept.keys()],
  };
  return { bridge: b, kept };
}

describe('the desktop build', () => {
  it('remembers through the bridge, under git:<host>, by default', async () => {
    const { bridge: b, kept } = bridge(true);
    const store = (await DesktopTokenStore.create(b))!;
    expect(store.rememberLabel).toMatch(/system keychain/);
    expect(store.rememberByDefault).toBe(true);
    await store.set('GitLab.example.org:8443', 'tok', true);
    expect(kept.get('git:gitlab.example.org:8443')).toBe('tok');
    expect(await (await DesktopTokenStore.create(b))!.get('gitlab.example.org:8443')).toBe('tok');
    expect(await store.hosts()).toEqual(['gitlab.example.org:8443']);
    await store.forget('gitlab.example.org:8443');
    expect(kept.size).toBe(0);
  });

  it('without a keychain: the session only, and no checkbox', async () => {
    const { bridge: b } = bridge(false);
    const store = (await DesktopTokenStore.create(b))!;
    expect(store.rememberLabel).toBeUndefined();
    await store.set('github.com', 'tok', true);
    expect(b.secretSet).not.toHaveBeenCalled();
    expect(await store.get('github.com')).toBe('tok');
  });

  it('an older bridge without secrets: no desktop store', async () => {
    const { bridge: b } = bridge(true);
    const { secretGet: _g, secretSet: _s, secretDelete: _d, secretKeys: _k, secretsAvailable: _a, ...old } = b;
    expect(await DesktopTokenStore.create(old)).toBeUndefined();
  });
});
