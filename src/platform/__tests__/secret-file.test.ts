/**
 * The desktop's secrets file (Req 18.5): ciphertext only, under keys la-gram
 * keeps, and nothing kept where there is no keychain.
 */
import { describe, it, expect } from 'vitest';
import { SecretFile, type Cipher } from '../secret-file.js';

/** A stand-in for `safeStorage`: reversible, and not the plain text. */
function cipher(available = true): Cipher {
  return {
    available: () => available,
    encrypt: (text) => new TextEncoder().encode(`enc:${[...text].reverse().join('')}`),
    decrypt: (data) => {
      const text = new TextDecoder().decode(data);
      if (!text.startsWith('enc:')) throw new Error('not ours');
      return [...text.slice(4)].reverse().join('');
    },
  };
}

function file() {
  let text: string | undefined;
  return {
    io: { read: async () => text, write: async (t: string) => void (text = t) },
    contents: () => text ?? '',
    set: (t: string) => void (text = t),
  };
}

describe('the secrets file', () => {
  it('keeps a token encrypted, and gives it back', async () => {
    const f = file();
    const secrets = new SecretFile(cipher(), f.io);
    await secrets.set('git:github.com', 'ghp_TOKEN');
    expect(f.contents()).not.toContain('ghp_TOKEN');
    expect(f.contents()).toContain('git:github.com');
    expect(await secrets.get('git:github.com')).toBe('ghp_TOKEN');
    expect(await secrets.keys()).toEqual(['git:github.com']);
    await secrets.delete('git:github.com');
    expect(await secrets.get('git:github.com')).toBeNull();
  });

  it('only keys la-gram keeps', async () => {
    const secrets = new SecretFile(cipher(), file().io);
    for (const key of ['other', 'git:', 'git:../etc', 'git:Host.com', 'git:a b']) {
      await expect(secrets.set(key, 'x')).rejects.toThrow(/Not a secret key/);
    }
    await secrets.set('git:gitlab.example.org:8443', 'x');
  });

  it('without a keychain: nothing kept, nothing read', async () => {
    const f = file();
    const secrets = new SecretFile(cipher(false), f.io);
    await expect(secrets.set('git:github.com', 'tok')).rejects.toThrow(/session only/);
    expect(f.contents()).toBe('');
    expect(await secrets.get('git:github.com')).toBeNull();
  });

  it('a value encrypted elsewhere, or a broken file, reads as nothing kept', async () => {
    const f = file();
    f.set(JSON.stringify({ 'git:github.com': Buffer.from('garbage').toString('base64') }));
    expect(await new SecretFile(cipher(), f.io).get('git:github.com')).toBeNull();
    f.set('{not json');
    expect(await new SecretFile(cipher(), f.io).keys()).toEqual([]);
  });
});
