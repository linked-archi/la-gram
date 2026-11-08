#!/usr/bin/env node
/**
 * Package the desktop app: `npm run package` (builds first).
 *
 * The app is the Electron build alone — `dist/electron` (main process and
 * renderer, which bundles its dependencies and the offline metamodels) and
 * `package.json` for its name, version and entry point. Nothing else is
 * copied: no sources, tests, `node_modules` or the web build.
 *
 * Writes `dist/packages/la-gram-<platform>-<arch>/` for the machine it runs on;
 * pass `--platform` / `--arch` (`darwin`, `win32`, `linux`; `x64`, `arm64`) for
 * another. The Electron runtime comes from the cache `npm install` filled, or is
 * downloaded once. The macOS app is not signed: open it with right-click › Open
 * the first time.
 */

import { packager } from '@electron/packager';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;

/** `--name value` from the command line. */
function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** Keep `package.json` and `dist/electron/**`; the packager asks about every path, relative to the root. */
function ignore(file) {
  if (file === '' || file === '/package.json') return false;
  if (file === '/dist' || file === '/dist/electron' || file.startsWith('/dist/electron/')) return file.endsWith('.map');
  return true;
}

const paths = await packager({
  dir: root,
  out: path.join(root, 'dist/packages'),
  name: pkg.productName ?? pkg.name,
  appVersion: pkg.version,
  electronVersion,
  platform: arg('platform') ?? process.platform,
  arch: arg('arch') ?? process.arch,
  ignore,
  prune: false,
  asar: true,
  overwrite: true,
  // The packager adds the platform's extension: app-icon.icns on macOS, .ico on
  // Windows (rendered by `npm run icons`); Linux takes the window's icon.
  icon: path.join(root, 'src/icons/app-icon'),
  appBundleId: 'archi.linked.la-gram',
  appCategoryType: 'public.app-category.developer-tools',
});
for (const p of paths) console.log(`Packaged: ${path.relative(root, p)}`);
