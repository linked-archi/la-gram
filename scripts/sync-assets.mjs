#!/usr/bin/env node
/**
 * Refresh the bundled snapshot from meta.linked.archi by default, or explicitly
 * from a local linked-archi-meta checkout (--meta / LINKED_ARCHI_META).
 *
 *   npm run sync-assets                     published assets
 *   npm run sync-assets -- --check           compare without writing
 *   npm run sync-assets -- --meta <path>     local publishing scripts + catalogue
 *   npm run sync-assets -- --online          published assets, ignoring the env override
 *
 * Builds copy assets/ as it stands; run this before building to refresh it.
 * All inputs are fetched and validated before replacing any bundled file, so
 * an unavailable asset cannot leave a partially refreshed network snapshot.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'n3';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_BASE = 'https://meta.linked.archi/';
const CATALOGUE = 'catalog.ttl';

class UsageError extends Error {}

/** No checkout is inferred: an explicit CLI or environment value selects local mode. */
export function parseOptions(args, env = {}) {
  let check = false;
  let meta;
  let online = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--check') check = true;
    else if (arg === '--online') online = true;
    else if (arg === '--meta') {
      meta = args[++i];
      if (!meta || meta.startsWith('--')) throw new UsageError('--meta requires a checkout path.');
    } else throw new UsageError(`Unknown option: ${arg}`);
  }
  if (online && meta) throw new UsageError('Choose either --online or --meta <path>.');
  return { check, meta: online ? undefined : meta ?? (env.LINKED_ARCHI_META || undefined) };
}

/** Every file below a directory, deterministically ordered; dotfiles are not bundled. */
function filesUnder(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      if (name.startsWith('.')) continue;
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** The namespace publishing rule used by linked-archi-meta's copy-ttl-sources.sh. */
function namespaceOf(text) {
  const vann = /preferredNamespaceUri[^"]*"([^"]+)"/.exec(text);
  if (vann) return vann[1].trim();
  const prefix = /^@prefix :\s*<([^>]+)>/m.exec(text);
  if (prefix) return prefix[1].trim();
  return /^@base\s*<([^>]+)>/m.exec(text)?.[1].trim();
}

/** TTLs are addressed by namespace, not by the local bundle's filename. */
function publishedPath(assetPath, assets) {
  if (assetPath === CATALOGUE || !assetPath.endsWith('.ttl')) return assetPath;
  const ns = namespaceOf(readFileSync(join(assets, assetPath), 'utf8'));
  if (!ns?.startsWith(SITE_BASE)) return undefined;
  const path = ns.slice(SITE_BASE.length).replace(/#$/, '').replace(/\/$/, '');
  return path ? `${path}/ontology.ttl` : undefined;
}

/** Parse RDF rather than accepting an HTML error page returned with status 200. */
function validateBody(bytes, path, contentType = '') {
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error(`HTML response for ${path}`);
  if (path.endsWith('.ttl')) {
    try {
      if (!new Parser().parse(bytes.toString('utf8')).length) throw new Error('empty document');
    }
    catch (error) { throw new Error(`Invalid Turtle for ${path}: ${error.message}`); }
  } else if (path.endsWith('.svg')) {
    // An HTML error page may contain an SVG logo. Require an SVG document root,
    // allowing the XML declaration/comments used by SVG exporters before it.
    const body = bytes.toString('utf8').replace(/^\uFEFF/, '')
      .replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/, '')
      .replace(/^<!DOCTYPE\s+svg\b[^>]*>\s*/i, '')
      .replace(/^(?:<!--[\s\S]*?-->\s*)*/, '');
    if (!/^<svg(?:\s|\/?>)/i.test(body)) throw new Error(`Invalid SVG for ${path}`);
  }
}

/** Avoid opening hundreds of connections while fetching the bundled snapshot. */
async function mapLimited(items, run) {
  let next = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(8, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  });
  // Wait for all workers even after failure; no background fetch outlives this sync.
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}

/** Discover newly referenced icons in folders that this application already bundles. */
function referencedIcons(staged, iconFolders) {
  const paths = new Set();
  for (const [path, bytes] of staged) {
    if (!path.endsWith('.ttl') || path === CATALOGUE) continue;
    for (const quad of new Parser().parse(bytes.toString('utf8'))) {
      const value = quad.object.value;
      if (!value.startsWith(SITE_BASE)) continue;
      const iconPath = value.slice(SITE_BASE.length);
      if (!/\.svg$/.test(iconPath) || !iconFolders.includes(dirname(iconPath))) continue;
      // Keep publication paths within the existing bundle's folders.
      if (iconPath.split('/').some((part) => part === '..' || part === '.')) continue;
      if (!staged.has(iconPath)) paths.add(iconPath);
    }
  }
  return [...paths].sort();
}

/** Refresh or compare the snapshot. Exported for isolated filesystem/network regression tests. */
export async function syncAssets({ root = ROOT, meta, check = false, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const assets = join(root, 'assets');
  const bundled = filesUnder(assets);
  const staged = new Map();
  const own = [];
  const iconFolders = [...new Set(bundled.filter((path) => !path.endsWith('.ttl')).map(dirname))];
  const localMeta = meta ? resolve(meta) : undefined;
  let site;
  let noCatalogue = false;
  try {
    if (localMeta) {
      for (const script of ['copy-ttl-sources.sh', 'copy-icon-assets.sh']) {
        if (!existsSync(join(localMeta, '.scripts', script))) {
          throw new UsageError(`No linked-archi-meta checkout at ${localMeta} (missing .scripts/${script}).`);
        }
      }
      site = mkdtempSync(join(tmpdir(), 'la-gram-sync-'));
      for (const script of ['copy-ttl-sources.sh', 'copy-icon-assets.sh']) {
        execFileSync('bash', [join(localMeta, '.scripts', script), site], { stdio: 'pipe' });
      }
      const generatedCatalogue = join(localMeta, '.onto-docs', CATALOGUE);
      for (const path of new Set([...bundled, CATALOGUE])) {
        const from = path === CATALOGUE ? generatedCatalogue : publishedPath(path, assets);
        const source = path === CATALOGUE ? from : from ? join(site, from) : undefined;
        if (path === CATALOGUE && !existsSync(generatedCatalogue)) {
          noCatalogue = true;
          continue;
        }
        if (!source || !existsSync(source)) { own.push(path); continue; }
        const bytes = readFileSync(source);
        validateBody(bytes, path);
        staged.set(path, bytes);
      }
      // A local publishing tree can enumerate new icons, including unreferenced ones.
      for (const folder of iconFolders) {
        const published = join(site, folder);
        if (!existsSync(published)) continue;
        for (const name of readdirSync(published).sort()) {
          if (name.startsWith('.') || !statSync(join(published, name)).isFile()) continue;
          const path = `${folder}/${name}`;
          if (!staged.has(path)) {
            const bytes = readFileSync(join(published, name));
            validateBody(bytes, path);
            staged.set(path, bytes);
          }
        }
      }
    } else {
      const download = async (path, remotePath) => {
        const url = new URL(remotePath, SITE_BASE).href;
        let response;
        try {
          response = await fetchImpl(url, {
            headers: { Accept: path.endsWith('.ttl') ? 'text/turtle' : path.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream' },
            cache: 'no-cache',
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          validateBody(bytes, path, response.headers.get('content-type') ?? '');
          return [path, bytes];
        } catch (error) { throw new Error(`Cannot sync ${url}: ${error.message}`); }
      };
      const requests = [];
      for (const path of new Set([...bundled, CATALOGUE])) {
        const from = publishedPath(path, assets);
        if (from) requests.push([path, from]);
        else own.push(path);
      }
      for (const [path, bytes] of await mapLimited(requests, ([path, from]) => download(path, from))) staged.set(path, bytes);
      for (const [path, bytes] of await mapLimited(referencedIcons(staged, iconFolders), (path) => download(path, path))) staged.set(path, bytes);
    }

    const unchanged = [];
    const updated = [];
    const added = [];
    for (const [path, bytes] of staged) {
      const target = join(assets, path);
      if (!existsSync(target)) added.push(path);
      else if (readFileSync(target).equals(bytes)) unchanged.push(path);
      else updated.push(path);
    }
    // Every input has succeeded before the first bundled file is changed.
    if (!check) {
      for (const path of [...updated, ...added]) {
        const target = join(assets, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, staged.get(path));
      }
    }
    log(`Source: ${localMeta ? `local ${localMeta}` : SITE_BASE}`);
    log(`${unchanged.length} unchanged, ${updated.length} ${check ? 'differ' : 'updated'}, ${added.length} ${check ? 'missing' : 'added'}, ${own.length} own (not mapped to this source)`);
    for (const path of updated) log(`  ${check ? 'differs' : 'updated'}  ${path}`);
    for (const path of added) log(`  ${check ? 'missing' : 'added'}    ${path}`);
    for (const path of own) log(`  own      ${path}`);
    if (noCatalogue) log(`  kept     ${CATALOGUE} — no ${join(localMeta, '.onto-docs', CATALOGUE)}; generate the full catalogue in that checkout first`);
    if (!check && (updated.length || added.length)) log('Rebuild to ship it: npm run build');
    return { unchanged, updated, added, own };
  } finally {
    if (site) rmSync(site, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: npm run sync-assets -- [--check] [--online | --meta <checkout>]\nDefault: https://meta.linked.archi/. LINKED_ARCHI_META explicitly selects a local checkout; --online overrides it.');
    return 0;
  }
  try {
    const options = parseOptions(args, env);
    const result = await syncAssets(options);
    return options.check && (result.updated.length || result.added.length) ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
