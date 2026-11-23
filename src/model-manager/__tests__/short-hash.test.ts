import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { keyDigest, sha256Hex, shortHash } from '../short-hash.js';

describe('shortHash', () => {
  it('is 8 hex characters', () => {
    expect(shortHash('abc')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('keyDigest', () => {
  it('is the first 20 hex characters of the SHA-256, as DD-41, the converters and SPARQL’s SUBSTR(SHA256(…), 1, 20) give it', () => {
    expect(keyDigest('abc')).toBe('ba7816bf8f01cfea4141');
    for (const text of ['', 'Serving → ✓ ü 🙂', 'urn:bare:a https://meta.linked.archi/archimate4/onto#serves urn:bare:b']) {
      expect(keyDigest(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 20));
    }
  });
});

describe('sha256Hex', () => {
  it('is SHA-256 of the UTF-8 bytes', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    // Each padding boundary, several blocks, and text beyond ASCII.
    for (const text of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(119), 'a'.repeat(1000), 'Serving → ✓ ü 🙂 '.repeat(30)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });

  it('names the views of meta’s IRI Minting guide as the guide does', () => {
    const view = 'https://example.org/archimate/2d441909-2be6-4dfe-aaa5-c7ee59edbc4c/view/4b7e0c12-9d3a-4f61-8e2b-1c5d7a9e3f40';
    expect(sha256Hex(view).slice(0, 8)).toBe('3ef7da72');
    expect(sha256Hex('https://example.org/c4/bigbank/view/SystemContext').slice(0, 8)).toBe('00494f1d');
    expect(sha256Hex('https://example.org/c4/bigbank/view/Containers').slice(0, 8)).toBe('e7282c35');
  });
});
