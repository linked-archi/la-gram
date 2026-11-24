import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { BUNDLED_ASSETS } from '@linked-archi/kernel/metamodel-manager/bundled-assets.js';
import configurations from '../../webpack.config.js';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const require = createRequire(import.meta.url);
const kernel = require.resolve('@linked-archi/kernel/package.json');
const assets = join(dirname(kernel), 'assets');

it('resolves a single copy of every RDF runtime library (KM-3)', () => {
  const fromKernel = createRequire(kernel);
  for (const name of ['n3', 'oxigraph', 'rdf-validate-shacl']) expect(fromKernel.resolve(name)).toBe(require.resolve(name));
  const pkg = JSON.parse(readFileSync(kernel, 'utf8'));
  expect(pkg.dependencies.n3).toBe(JSON.parse(readFileSync('package.json', 'utf8')).dependencies.n3);
});

it('ships the kernel asset registry in every model-reading build (KM-7)', () => {
  for (const asset of BUNDLED_ASSETS) expect(existsSync(join(assets, asset.path)), asset.path).toBe(true);
  for (const config of configurations({}, { mode: 'production' }).filter((c: {name:string}) => ['web','electron-renderer','la-gram-git'].includes(c.name))) {
    const patterns = config.plugins.filter((p: unknown) => p instanceof CopyWebpackPlugin).flatMap((p: CopyWebpackPlugin) => p.patterns);
    expect(patterns.some((p: {from?:string;to?:string}) => p.from === assets && p.to === 'assets')).toBe(true);
  }
});
