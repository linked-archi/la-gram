/**
 * The licences of the packages a bundle carries (Req 15.9): `scripts/third-party-licences.mjs`, the
 * webpack plugin that writes `third-party-licences.txt` beside each bundle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  emittedPackageRoots,
  LICENCES_FILE,
  licenceOf,
  licencesText,
  packageRootOf,
} from '../../scripts/third-party-licences.mjs';
import { THIRD_PARTY_LICENCES } from '../help-links.js';

let root: string;
const write = (file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const at = (file: string) => path.join(root, file);

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'la-gram-licences-'));
  // A package with a nested package.json that only sets the module type, and several licence files.
  write('node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '1.2.0', license: 'MIT' }));
  write('node_modules/alpha/dist/esm/package.json', JSON.stringify({ type: 'module' }));
  write('node_modules/alpha/dist/esm/index.js', 'export {};');
  write('node_modules/alpha/LICENSE', 'Copyright (c) Alpha\r\nPermission is granted…\r\n');
  write('node_modules/alpha/LICENSE-MIT.txt', 'MIT text');
  write('node_modules/alpha/NOTICE', 'Alpha notice');
  write('node_modules/alpha/license-update.mjs', '// a script, not a licence');
  // A scoped package that ships no licence file, its licence in the old object form.
  write('node_modules/@scope/beta/package.json', JSON.stringify({
    name: '@scope/beta', version: '2.0.0', license: { type: 'ISC' },
    author: { name: 'Beta Author' }, repository: { url: 'git+https://example.com/beta.git' },
  }));
  write('node_modules/@scope/beta/index.js', '');
  // A package installed again inside another, at another version, the old `licenses` array.
  write('node_modules/alpha/node_modules/gamma/package.json', JSON.stringify({
    name: 'gamma', version: '0.1.0', licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }],
  }));
  write('node_modules/alpha/node_modules/gamma/lib/gamma.js', '');
  // la-gram's own file.
  write('src/index.ts', '');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the package a module comes from', () => {
  it('is the nearest package.json with a name and a version, not one that only sets the module type', () => {
    expect(packageRootOf(at('node_modules/alpha/dist/esm/index.js'))).toBe(at('node_modules/alpha'));
    expect(packageRootOf(at('node_modules/@scope/beta/index.js'))).toBe(at('node_modules/@scope/beta'));
    expect(packageRootOf(at('node_modules/alpha/node_modules/gamma/lib/gamma.js'))).toBe(at('node_modules/alpha/node_modules/gamma'));
  });

  it("is none for la-gram's own files", () => {
    expect(packageRootOf(at('src/index.ts'))).toBeUndefined();
  });
});

describe("a package's licence", () => {
  it('is its declared licence and each licence or notice file it ships, as it ships it — no other file', () => {
    const alpha = licenceOf(at('node_modules/alpha'));
    expect(alpha).toMatchObject({ name: 'alpha', version: '1.2.0', licence: 'MIT' });
    expect(alpha.files.map((f: { name: string }) => f.name)).toEqual(['LICENSE', 'LICENSE-MIT.txt', 'NOTICE']);
    expect(alpha.files[0].text).toBe('Copyright (c) Alpha\nPermission is granted…');
  });

  it('reads the older forms of the declared licence, and who wrote the package and where its source is', () => {
    expect(licenceOf(at('node_modules/@scope/beta'))).toMatchObject({
      licence: 'ISC', author: 'Beta Author', source: 'https://example.com/beta', files: [],
    });
    expect(licenceOf(at('node_modules/alpha/node_modules/gamma')).licence).toBe('MIT OR Apache-2.0');
  });
});

describe('the file', () => {
  it('names whose build it is, then lists each package by name and version, once each, with its licence texts', () => {
    const alpha = licenceOf(at('node_modules/alpha'));
    const text = licencesText(
      [licenceOf(at('node_modules/alpha/node_modules/gamma')), alpha, licenceOf(at('node_modules/@scope/beta')), alpha],
      { name: 'la-gram', version: '0.2.0', licence: 'Apache-2.0' },
    );
    expect(text.startsWith('la-gram 0.2.0 — the licences of the open-source packages in this build\n')).toBe(true);
    expect(text).toContain('This build includes code from the 3 packages below.');
    expect(text).toContain('la-gram itself is licensed under Apache-2.0.');
    const order = ['@scope/beta 2.0.0', 'alpha 1.2.0', 'gamma 0.1.0'].map((h) => text.indexOf(`\n${h}\n`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.split('\nalpha 1.2.0\n')).toHaveLength(2);
    expect(text).toContain('--- LICENSE-MIT.txt ---\n\nMIT text');
    expect(text).toContain('Author: Beta Author\nSource: https://example.com/beta');
    expect(text).toContain('The package ships no licence file; its package.json declares: ISC.');
  });

  it('is the file About links to', () => {
    expect(LICENCES_FILE).toBe(THIRD_PARTY_LICENCES);
  });
});

describe('the packages a bundle emits code from', () => {
  it("every module of every chunk, inside concatenated modules too, a resource's query left out; not la-gram's own", () => {
    const chunks = [{ id: 'main' }, { id: 'lazy' }];
    const modules = new Map<unknown, unknown[]>([
      [chunks[0], [
        { resource: at('src/index.ts') },
        { modules: [{ resource: `${at('node_modules/alpha/dist/esm/index.js')}?inline` }, { resource: at('src/index.ts') }] },
        { identifier: 'a runtime module, with no resource' },
      ]],
      [chunks[1], [{ resource: at('node_modules/@scope/beta/index.js') }, { resource: at('node_modules/alpha/LICENSE') }]],
    ]);
    const compilation = { chunks, chunkGraph: { getChunkModulesIterable: (chunk: unknown) => modules.get(chunk) ?? [] } };
    expect(emittedPackageRoots(compilation).sort()).toEqual([at('node_modules/@scope/beta'), at('node_modules/alpha')]);
  });

  it('finds the licence texts the minified bundle leaves out — Cytoscape.js, diagram-js and D3 among them', () => {
    for (const name of ['cytoscape', 'diagram-js', 'd3-force']) {
      const licence = licenceOf(path.resolve('node_modules', name));
      expect(licence.files.length, name).toBeGreaterThan(0);
      expect(licence.files[0].text, name).toMatch(/copyright/i);
    }
  });
});
