import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha1Hex, shortHash } from '../short-hash.js';

describe('sha1Hex', () => {
  it('is SHA-1 of the UTF-8 bytes, as SPARQL’s SHA1() gives it', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    // Each padding boundary, and text beyond ASCII.
    for (const text of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(119), 'Serving → ✓ ü '.repeat(30)]) {
      expect(sha1Hex(text)).toBe(createHash('sha1').update(text, 'utf8').digest('hex'));
    }
  });

  it('leaves shortHash as it was', () => {
    expect(shortHash('abc')).toMatch(/^[0-9a-f]{8}$/);
  });
});
