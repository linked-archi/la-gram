/**
 * la-gram-git's package and its release, as files: what npm is given agrees with
 * what the tool imports and with la-gram; the release pipeline accepts the
 * package's version and finds the file `npm pack` makes; the model the release
 * runs the installed tool on passes. Phase 3 of the Git collaboration plan.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../main.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const pkg = JSON.parse(read('packages/la-gram-git/package.json')) as {
  name: string;
  version: string;
  bin: Record<string, string>;
  files: string[];
  dependencies: Record<string, string>;
};
const la = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };

/**
 * The packages the tool's source imports, from `src/cli/bin.ts` along its
 * relative imports: what webpack leaves to Node, which the package must declare.
 * Type-only imports are erased, and so is a package of declarations alone
 * (`@rdfjs/types`); Node's own modules come with Node.
 */
function packagesImported(entry: string): string[] {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'|import\('([^']+)'\)/gm)) {
      if (m[2]) continue;
      const spec = (m[3] ?? m[4])!;
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
      else if (!spec.startsWith('node:') && !['fs', 'path', 'url', 'os', 'child_process', 'util', 'crypto'].includes(spec)) {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);
      }
    }
  };
  visit(join(ROOT, entry));
  return [...packages].filter((name) => !declarationsOnly(name)).sort();
}

/** A package with no code to run: no entry point, nothing but `.d.ts` files. */
function declarationsOnly(name: string): boolean {
  const meta = JSON.parse(read(`node_modules/${name}/package.json`)) as Record<string, unknown>;
  return !meta['main'] && !meta['module'] && !meta['exports'] && !existsSync(join(ROOT, 'node_modules', name, 'index.js'));
}

describe("la-gram-git's package", () => {
  it('declares every package the tool imports, at the version la-gram uses', () => {
    const imported = packagesImported('src/cli/bin.ts');
    expect(Object.keys(pkg.dependencies).sort()).toEqual(imported);
    for (const name of imported) expect(pkg.dependencies[name]).toBe(la.dependencies[name]);
  });

  it('ships the tool, the metamodels, the templates, the licence and the README', () => {
    expect(pkg.bin).toEqual({ 'la-gram-git': 'dist/la-gram-git.js' });
    expect(pkg.files).toEqual(['dist/', 'assets/', 'ci/', 'LICENSE', 'README.md']);
    expect(existsSync(join(ROOT, 'ci/README.md'))).toBe(true);
  });
});

describe('the release pipeline', () => {
  const pipeline = read('.gitlab-ci.yml');
  /** `npm pack`'s file for a scoped name: `@scope/name` → `scope-name-<version>.tgz`. */
  const packed = `${pkg.name.replace(/^@/, '').replace('/', '-')}-`;

  it('runs on the tag of the package’s version, and on no other tag', () => {
    const rule = /\$CI_COMMIT_TAG =~ \/(.+)\/\s*$/m.exec(pipeline)?.[1];
    expect(rule).toBeDefined();
    const tag = new RegExp(rule!);
    expect(tag.test(`la-gram-git-v${pkg.version}`)).toBe(true);
    expect(tag.test('la-gram-git-v0.2.0-rc.1')).toBe(true);
    for (const other of [`v${pkg.version}`, 'la-gram-git-v1.2', 'la-gram-v1.2.3', 'la-gram-git-v1.2.3 ']) expect(tag.test(other)).toBe(false);
  });

  it('publishes on a release tag only; merge requests and the default branch run the tests and the package', () => {
    const workflow = /^workflow:\n {2}rules:\n([\s\S]*?)\n\n/m.exec(pipeline)?.[1] ?? '';
    expect(workflow).toContain('- if: $CI_COMMIT_TAG\n      when: never');
    expect(workflow).toContain('- if: $CI_PIPELINE_SOURCE == "merge_request_event"');
    expect(workflow).toContain('- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH');
    // What publishes extends .release, which runs only with a tag; the image's builds, one per platform.
    expect(pipeline).toMatch(/^\.release:\n(?: {2}.*\n)*? {2}rules:\n {4}- if: \$CI_COMMIT_TAG\n/m);
    for (const job of ['npm', '\\.image-build', 'container-image']) expect(pipeline).toMatch(new RegExp(`^${job}:\\n {2}extends: \\.release$`, 'm'));
    for (const arch of ['amd64', 'arm64']) expect(pipeline).toMatch(new RegExp(`^image-${arch}:\\n {2}extends: \\.image-build$`, 'm'));
    expect(pipeline).toMatch(/^container-image:\n(?: {2}.*\n)*? {2}needs: \[image-amd64, image-arm64\]$/m);
  });

  it('builds the image from the file npm pack makes', () => {
    expect(pipeline).toContain(`${packed}$VERSION.tgz`);
    expect(read('packages/la-gram-git/Dockerfile')).toContain(`COPY ${packed}*.tgz`);
    expect(read('packages/la-gram-git/.dockerignore')).toContain(`!${packed}*.tgz`);
  });

  it('runs the installed tool on a model that passes', async () => {
    const lines: string[] = [];
    const code = await main(['check', 'packages/la-gram-git/smoke'], { out: (l) => lines.push(l), err: (l) => lines.push(l), cwd: ROOT, env: {} });
    expect([code, lines.at(-1)?.trim()]).toEqual([0, '1 model file checked: all well.']);
  }, 60_000);
});
