#!/usr/bin/env node
/**
 * Refresh la-gram's bundled snapshot (`assets/`) from a linked-archi-meta
 * checkout — what meta.linked.archi would serve once that checkout is published.
 *
 *   npm run sync-assets                    update assets/ from ../../../linked-archi-meta
 *   npm run sync-assets -- --check         only report; exit 1 when anything differs
 *   npm run sync-assets -- --meta <path>   another checkout (or LINKED_ARCHI_META=<path>)
 *
 * It does not keep its own map of where files live. It runs linked-archi-meta's
 * own publishing scripts (`.scripts/copy-ttl-sources.sh`, `.scripts/copy-icon-
 * assets.sh`) into a temporary folder — a local stand-in for the published site
 * — and then refreshes every bundled file from its published path:
 *
 * - a `.ttl` file from `<namespace path>/ontology.ttl`, the namespace read from
 *   the bundled copy exactly as `copy-ttl-sources.sh` reads it
 *   (`vann:preferredNamespaceUri`, else `@prefix :`, else `@base`);
 * - anything else (icons, glyphs, markers) from the same relative path. New
 *   files in a bundled icon folder are added too.
 *
 * The catalogue (`catalog.ttl`, the metamodels the Metamodels menu offers) is
 * written by meta's documentation generator, which takes minutes, so it is not
 * run here: it is taken from the checkout's last generated site,
 * `.onto-docs/catalog.ttl` — run `.scripts/docgen/generate-docs.sh` there first
 * for a current one. Without it, the bundled copy stays and the run says so.
 *
 * Files the published tree does not have are la-gram's own (the core metamodel
 * manifest and taxonomy, until they are published) and are left alone. After a
 * sync, rebuild (`npm run build`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const SITE_BASE = 'https://meta.linked.archi/';

const args = process.argv.slice(2);
const check = args.includes('--check');
const metaArg = args.includes('--meta') ? args[args.indexOf('--meta') + 1] : undefined;
const META = resolve(metaArg ?? process.env.LINKED_ARCHI_META ?? join(ROOT, '../../../linked-archi-meta'));

if (!existsSync(join(META, '.scripts/copy-ttl-sources.sh'))) {
  console.error(`No linked-archi-meta checkout at ${META} (pass --meta <path> or set LINKED_ARCHI_META).`);
  process.exit(2);
}

/** Every file under a directory, as paths relative to it (dotfiles skipped). */
function filesUnder(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      if (name.startsWith('.')) continue;
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** The namespace a TTL file publishes under — the rule of `copy-ttl-sources.sh`. */
function namespaceOf(text) {
  const vann = /preferredNamespaceUri[^"]*"([^"]+)"/.exec(text);
  if (vann) return vann[1].trim();
  const prefix = /^@prefix :\s*<([^>]+)>/m.exec(text);
  if (prefix) return prefix[1].trim();
  const base = /^@base\s*<([^>]+)>/m.exec(text);
  return base ? base[1].trim() : undefined;
}

/** The catalogue: bundled at the site root, as the site serves it. */
const CATALOGUE = 'catalog.ttl';
const GENERATED_CATALOGUE = join(META, '.onto-docs', CATALOGUE);

/** Where the published site serves a bundled file, relative to its root. */
function publishedPath(assetPath) {
  if (!assetPath.endsWith('.ttl')) return assetPath;
  const ns = namespaceOf(readFileSync(join(ASSETS, assetPath), 'utf8'));
  if (!ns || !ns.startsWith(SITE_BASE)) return undefined;
  const path = ns.slice(SITE_BASE.length).replace(/#$/, '').replace(/\/$/, '');
  return path ? `${path}/ontology.ttl` : undefined;
}

const site = mkdtempSync(join(tmpdir(), 'la-gram-sync-'));
try {
  for (const script of ['copy-ttl-sources.sh', 'copy-icon-assets.sh']) {
    execFileSync('bash', [join(META, '.scripts', script), site], { stdio: 'ignore' });
  }

  const updated = [];
  const unchanged = [];
  const own = [];
  const added = [];

  const bundled = filesUnder(ASSETS);
  let noCatalogue = false;
  for (const assetPath of bundled) {
    const isCatalogue = assetPath === CATALOGUE;
    if (isCatalogue && !existsSync(GENERATED_CATALOGUE)) {
      noCatalogue = true;
      continue;
    }
    const from = isCatalogue ? '.onto-docs/catalog.ttl' : publishedPath(assetPath);
    const source = isCatalogue ? GENERATED_CATALOGUE : from ? join(site, from) : undefined;
    if (!source || !existsSync(source)) {
      own.push(assetPath);
      continue;
    }
    const same = readFileSync(source).equals(readFileSync(join(ASSETS, assetPath)));
    if (same) {
      unchanged.push(assetPath);
      continue;
    }
    updated.push(`${assetPath}  ←  ${from}`);
    if (!check) copyFileSync(source, join(ASSETS, assetPath));
  }

  // The catalogue, when it is not bundled yet.
  if (!bundled.includes(CATALOGUE) && existsSync(GENERATED_CATALOGUE)) {
    added.push(`${CATALOGUE}  ←  .onto-docs/catalog.ttl`);
    if (!check) copyFileSync(GENERATED_CATALOGUE, join(ASSETS, CATALOGUE));
  }

  // New icons in a folder la-gram already bundles.
  const iconFolders = [...new Set(bundled.filter((p) => !p.endsWith('.ttl')).map((p) => dirname(p)))];
  for (const folder of iconFolders) {
    const published = join(site, folder);
    if (!existsSync(published)) continue;
    for (const name of readdirSync(published)) {
      const path = `${folder}/${name}`;
      if (statSync(join(published, name)).isDirectory() || bundled.includes(path)) continue;
      added.push(path);
      if (!check) {
        mkdirSync(join(ASSETS, folder), { recursive: true });
        copyFileSync(join(published, name), join(ASSETS, path));
      }
    }
  }

  const verb = check ? 'differ' : 'updated';
  console.log(`linked-archi-meta: ${META}`);
  console.log(`${unchanged.length} unchanged, ${updated.length} ${verb}, ${added.length} ${check ? 'missing' : 'added'}, ${own.length} la-gram's own (not published by linked-archi-meta)`);
  for (const line of updated) console.log(`  ${check ? 'differs' : 'updated'}  ${line}`);
  for (const line of added) console.log(`  ${check ? 'missing' : 'added  '}  ${line}`);
  for (const line of own) console.log(`  own      ${line}`);
  if (noCatalogue) {
    console.log(`  kept     ${CATALOGUE} — no ${GENERATED_CATALOGUE}; run .scripts/docgen/generate-docs.sh in the checkout`);
  }
  if (!check && (updated.length > 0 || added.length > 0)) console.log('Rebuild to ship it: npm run build');
  if (check && (updated.length > 0 || added.length > 0)) process.exitCode = 1;
} finally {
  rmSync(site, { recursive: true, force: true });
}
