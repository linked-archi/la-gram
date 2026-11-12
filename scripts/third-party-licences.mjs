/**
 * The licences of the packages a bundle carries (Req 15.9).
 *
 * A bundle copies code from npm packages into la-gram's own files, and most of their licences ask that
 * their notice goes with every copy. Minification keeps only comments marked `/*!` or `@license` — the
 * `*.js.LICENSE.txt` files — and many packages mark none: Cytoscape.js, diagram-js and D3 among them.
 * So each bundle gets one more file, {@link LICENCES_FILE}, beside it: every package one of its emitted
 * modules comes from, with its name, its version, the licence its `package.json` declares, and the text
 * of each licence and notice file the package ships, as it ships it.
 *
 * Only what the bundle emits counts — the modules of its chunks, inside concatenated modules too — so a
 * package that is only a dependency of a dependency, or whose code tree shaking removed, is not listed,
 * and an `externals` import (la-gram-git's dependencies, installed with their own licences) is not either.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** The file's name, beside each bundle. `src/help-links.ts` links to it as `THIRD_PARTY_LICENCES`. */
export const LICENCES_FILE = 'third-party-licences.txt';

/** A licence or notice file, as packages name them: `LICENSE`, `LICENCE.md`, `LICENSE-MIT`, `COPYING`, `NOTICE.txt`. */
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(-[a-z0-9]+)?(\.(md|txt|markdown|rst))?$/i;

/**
 * The npm package a module's file belongs to: the folder of the nearest `package.json` above it that has a
 * name and a version — a package may hold others with neither, such as `dist/esm/package.json` saying only
 * `"type": "module"` — inside a `node_modules` folder. `undefined` for la-gram's own files.
 */
export function packageRootOf(file) {
  if (!file.split(path.sep).includes('node_modules')) return undefined;
  let dir = path.dirname(file);
  for (;;) {
    if (path.basename(dir) === 'node_modules') return undefined;
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof pkg.name === 'string' && typeof pkg.version === 'string') return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The licence a `package.json` declares: an SPDX expression, or the older `{ type }` and `licenses: […]` forms. */
function declaredLicence(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter((t) => typeof t === 'string');
    if (types.length > 0) return types.join(' OR ');
  }
  return undefined;
}

/** Who wrote a package and where its source is, as its `package.json` says: for a package that ships no licence file. */
function authorOf(pkg) {
  const person = (p) => (typeof p === 'string' ? p : p && typeof p.name === 'string' ? p.name : undefined);
  return person(pkg.author) ?? (Array.isArray(pkg.contributors) ? pkg.contributors.map(person).filter(Boolean).join(', ') || undefined : undefined);
}

function sourceOf(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return typeof url === 'string' ? url.replace(/^git\+/, '').replace(/\.git$/, '') : typeof pkg.homepage === 'string' ? pkg.homepage : undefined;
}

/** A package's licence: its name, version, declared licence, author and source, and each licence or notice file it ships. */
export function licenceOf(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = readdirSync(root)
    .filter((name) => LICENCE_FILE.test(name) && statSync(path.join(root, name)).isFile())
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n').trim() }));
  return { name: pkg.name, version: pkg.version, licence: declaredLicence(pkg), author: authorOf(pkg), source: sourceOf(pkg), files };
}

/**
 * The file's text: what it is and whose build — `own`, the package being built — then each package — by
 * name, then version; a package installed twice at one version once — with its licence files, or, where it
 * ships none, what its `package.json` declares.
 */
export function licencesText(packages, own = { name: 'la-gram', version: '', licence: undefined }) {
  const seen = new Set();
  const unique = [...packages]
    .sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version, 'en', { numeric: true }) : a.name < b.name ? -1 : 1))
    .filter((p) => {
      const key = `${p.name}@${p.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const rule = '='.repeat(78);
  const parts = [
    `${own.name}${own.version ? ` ${own.version}` : ''} — the licences of the open-source packages in this build`,
    '',
    `This build includes code from the ${unique.length} packages below. Each is listed with its version, the`,
    'licence its package.json declares, and the text of each licence and notice file it ships, as it ships it.',
    ...(own.licence ? [`${own.name} itself is licensed under ${own.licence}.`] : []),
  ];
  for (const p of unique) {
    parts.push('', rule, `${p.name} ${p.version}`, `Licence: ${p.licence ?? 'not declared'}`);
    if (p.author) parts.push(`Author: ${p.author}`);
    if (p.source) parts.push(`Source: ${p.source}`);
    parts.push(rule);
    if (p.files.length === 0) {
      parts.push('', `The package ships no licence file; its package.json declares: ${p.licence ?? 'none'}.`);
    }
    for (const file of p.files) parts.push('', `--- ${file.name} ---`, '', file.text);
  }
  return parts.join('\n') + '\n';
}

/** The files of the npm packages a compilation emits code from: every module of every chunk, inside concatenations too. */
export function emittedPackageRoots(compilation) {
  const roots = new Set();
  const visit = (module) => {
    if (Array.isArray(module.modules)) for (const inner of module.modules) visit(inner);
    if (typeof module.resource !== 'string') return;
    const root = packageRootOf(module.resource.replace(/[?#].*$/, ''));
    if (root) roots.add(root);
  };
  for (const chunk of compilation.chunks) {
    for (const module of compilation.chunkGraph.getChunkModulesIterable(chunk)) visit(module);
  }
  return [...roots];
}

/** Emits {@link LICENCES_FILE} beside the bundle, once its chunks are final. */
export class ThirdPartyLicencesPlugin {
  /** @param {{ filename?: string }} [options] */
  constructor(options = {}) {
    this.filename = options.filename ?? LICENCES_FILE;
  }

  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    const name = 'ThirdPartyLicencesPlugin';
    compiler.hooks.thisCompilation.tap(name, (compilation) => {
      compilation.hooks.processAssets.tap({ name, stage: Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        const packages = emittedPackageRoots(compilation).map(licenceOf);
        const own = JSON.parse(readFileSync(path.join(compiler.context, 'package.json'), 'utf8'));
        const text = licencesText(packages, { name: own.name, version: own.version, licence: declaredLicence(own) });
        compilation.emitAsset(this.filename, new sources.RawSource(text));
      });
    });
  }
}
