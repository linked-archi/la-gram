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
      if (spec.startsWith('@linked-archi/kernel/')) visit(join(ROOT, 'node_modules/@linked-archi/kernel/src', spec.slice('@linked-archi/kernel/'.length).replace(/\.js$/, '.ts')));
      else if (spec.startsWith('.')) visit(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
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

describe('the release, in la-gram’s workflow', () => {
  const workflow = read('.github/workflows/la-gram.yml');
  /** `npm pack`'s file for a scoped name: `@scope/name` → `scope-name-<version>.tgz`. */
  const packed = `${pkg.name.replace(/^@/, '').replace('/', '-')}-`;
  /** A job's lines, from its name under `jobs:` up to the next job's. */
  const job = (name: string): string => {
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
    const rest = jobs.slice(jobs.search(new RegExp(`^ {2}${name}:\\n`, 'm')));
    const end = rest.search(/\n {2}[\w-]+:\n/);
    return end < 0 ? rest : rest.slice(0, end + 1);
  };

  it('runs on the tag of the package’s version, and on no other tag', () => {
    const rule = /=~ (\^la-gram-git-v\S+\$) \]\]/.exec(workflow)?.[1];
    expect(rule).toBeDefined();
    const tag = new RegExp(rule!);
    expect(tag.test(`la-gram-git-v${pkg.version}`)).toBe(true);
    expect(tag.test('la-gram-git-v0.2.0-rc.1')).toBe(true);
    for (const other of [`v${pkg.version}`, 'la-gram-git-v1.2', 'la-gram-v1.2.3', 'la-gram-git-v1.2.3 ']) expect(tag.test(other)).toBe(false);
    expect(workflow).toContain(`CLI_VERSION="$(node -p 'require("./packages/la-gram-git/package.json").version')"`);
  });

  it('publishes on its tag only; pull requests and main run the tests and the package', () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/m);
    for (const name of ['npm', 'image', 'image-tags']) expect(job(name)).toContain("if: needs.version.outputs.cli != 'none'");
    // The package job runs on la-gram-git's tag too: what it packs is what is published.
    expect(job('package')).toContain("if: ${{ !startsWith(github.ref, 'refs/tags/la-gram-v') }}");
  });

  it('builds the image from the file npm pack makes', () => {
    expect(job('package')).toContain(`path: packages/la-gram-git/${packed}*.tgz`);
    expect(job('npm')).toContain(`"./${packed}$VERSION.tgz"`);
    expect(job('image')).toMatch(/name: la-gram-git\n {10}path: packages\/la-gram-git\n/);
    expect(read('packages/la-gram-git/Dockerfile')).toContain(`COPY ${packed}*.tgz`);
    expect(read('packages/la-gram-git/.dockerignore')).toContain(`!${packed}*.tgz`);
  });

  it('runs the installed tool on a model that passes', async () => {
    const lines: string[] = [];
    const code = await main(['check', 'packages/la-gram-git/smoke'], { out: (l) => lines.push(l), err: (l) => lines.push(l), cwd: ROOT, env: {} });
    expect([code, lines.at(-1)?.trim()]).toEqual([0, '1 model file checked: all well.']);
  }, 60_000);
});
