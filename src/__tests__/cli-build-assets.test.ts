/**
 * A package rebuild must remove semantic assets and CI templates that the source
 * no longer ships, without removing the package's README, manifest or smoke data.
 * Use the CLI webpack configuration against a tiny isolated source/package tree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import webpack from 'webpack';
import type { Compiler, Configuration } from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import configurations from '../../webpack.config.js';

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function write(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

async function run(compiler: Compiler): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) reject(error);
      else if (!stats || stats.hasErrors()) reject(new Error(stats?.toString({ all: false, errors: true }) ?? 'No build stats'));
      else resolve();
    });
  });
}

describe('the generated CLI package', () => {
  it('removes obsolete assets, templates and bundles on rebuild, preserving package sources', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'la-gram-cli-assets-'));
    const source = path.join(root, 'source');
    const packaged = path.join(root, 'package');
    write(path.join(source, 'entry.js'), 'export const built = true;');
    write(path.join(source, 'assets/current.ttl'), 'current semantic asset');
    write(path.join(source, 'ci/current.yml'), 'current CI template');
    write(path.join(source, 'LICENSE'), 'current licence');
    write(path.join(packaged, 'assets/arch-decision/arch-decision-relationships-onto.ttl'), 'retired semantic asset');
    write(path.join(packaged, 'ci/retired.yml'), 'retired CI template');
    write(path.join(packaged, 'dist/old.js'), 'retired bundle');
    const preserved = ['README.md', 'package.json', 'smoke/example.ttl', 'assets-notes/README.md'];
    for (const file of preserved) write(path.join(packaged, file), `keep ${file}`);

    const config = (configurations({}, { mode: 'production' }) as Configuration[]).find((c) => c.name === 'la-gram-git')!;
    const originalPackage = path.resolve('packages/la-gram-git');
    // Preserve the production output's boundary: dist/ before the fix, package/
    // after it. Never run any production plugin against the actual package tree.
    const output = { ...config.output, path: path.resolve(packaged, path.relative(originalPackage, config.output!.path!)) };
    const copier = config.plugins!.find((plugin) => plugin instanceof CopyWebpackPlugin) as CopyWebpackPlugin;
    const patterns = copier.patterns.map((pattern) => {
      if (typeof pattern === 'string' || typeof pattern.from !== 'string' || typeof pattern.to !== 'string') {
        throw new Error('Expected static CLI copy patterns');
      }
      return {
        ...pattern,
        from: path.join(source, pattern.to === 'assets' ? 'assets' : path.relative(process.cwd(), pattern.from)),
        to: path.isAbsolute(pattern.to) ? path.join(packaged, path.relative(originalPackage, pattern.to)) : pattern.to,
      };
    });
    const compiler = webpack({
      name: config.name,
      mode: 'development',
      context: source,
      entry: './entry.js',
      target: config.target,
      experiments: config.experiments,
      output,
      plugins: [new CopyWebpackPlugin({ patterns })],
      devtool: false,
    })!;
    try {
      await run(compiler);
      expect(readFileSync(path.join(packaged, 'assets/current.ttl'), 'utf8')).toBe('current semantic asset');
      expect(readFileSync(path.join(packaged, 'ci/current.yml'), 'utf8')).toBe('current CI template');
      expect(readFileSync(path.join(packaged, 'LICENSE'), 'utf8')).toBe('current licence');
      expect(existsSync(path.join(packaged, 'dist/la-gram-git.js'))).toBe(true);
      for (const obsolete of ['assets/arch-decision/arch-decision-relationships-onto.ttl', 'ci/retired.yml', 'dist/old.js']) {
        expect(existsSync(path.join(packaged, obsolete))).toBe(false);
      }
      // A second build of the same compiler also removes files that disappeared
      // from the source, while copying a replacement to the existing package.
      rmSync(path.join(source, 'assets/current.ttl'));
      write(path.join(source, 'assets/replacement.ttl'), 'replacement semantic asset');
      await run(compiler);
      expect(existsSync(path.join(packaged, 'assets/current.ttl'))).toBe(false);
      expect(readFileSync(path.join(packaged, 'assets/replacement.ttl'), 'utf8')).toBe('replacement semantic asset');
      for (const file of preserved) expect(readFileSync(path.join(packaged, file), 'utf8')).toBe(`keep ${file}`);
    } finally {
      await new Promise<void>((resolve, reject) => compiler.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);
});
