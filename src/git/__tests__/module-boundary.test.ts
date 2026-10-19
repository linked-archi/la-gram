/**
 * The Git module stays out of the main bundle (Req 18.1): nothing outside
 * `src/git/` imports it statically, and `index.ts` imports it only behind the
 * build switch, so a build with `LA_GRAM_GIT=off` has no chunk of it and a
 * build with it loads the chunk only when the module is on.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === '__tests__' || file === path.join(SRC, 'git') ? [] : sources(file);
    return file.endsWith('.ts') && !file.endsWith('.d.ts') ? [file] : [];
  });
}

describe('the Git module’s boundary', () => {
  it('no static import of src/git outside it', () => {
    const offenders = sources(SRC).filter((file) =>
      /^\s*(import|export)\b[^;]*?from\s+['"][./]*(?:\.\.\/)*git\//m.test(readFileSync(file, 'utf-8')),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('index.ts imports it dynamically, behind the build switch', () => {
    const index = readFileSync(path.join(SRC, 'index.ts'), 'utf-8');
    const guarded = /if \(__LA_GRAM_GIT__\) \{[\s\S]*?import\(\/\* webpackChunkName: "git" \*\/ '\.\/git\/module\.js'\)/;
    expect(index).toMatch(guarded);
    expect(index.match(/['"]\.\/git\//g)).toHaveLength(1);
  });
});
