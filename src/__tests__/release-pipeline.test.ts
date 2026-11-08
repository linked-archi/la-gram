/**
 * la-gram's release in `.gitlab-ci.yml`: a tag `la-gram-v<version>` publishes
 * the desktop apps and the web app, and nothing of la-gram-git's; la-gram-git's
 * tag publishes nothing of la-gram's. And the README sets up on the server the
 * folder the pipeline copies the web app into.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const pipeline = read('.gitlab-ci.yml');
const version = (JSON.parse(read('package.json')) as { version: string }).version;

/** A job's lines, up to the next top-level key. */
function job(name: string): string {
  const at = pipeline.search(new RegExp(`^${name.replace('.', '\\.')}:`, 'm'));
  expect(at, `job ${name}`).toBeGreaterThanOrEqual(0);
  const rest = pipeline.slice(at);
  const end = rest.search(/\n[.\w-]+:/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

describe("la-gram's release pipeline", () => {
  it('runs on a tag la-gram-v<the version in package.json>, and on no other of its form', () => {
    const workflow = /^workflow:\n {2}rules:\n([\s\S]*?)\n\n/m.exec(pipeline)![1]!;
    const rules = [...workflow.matchAll(/\$CI_COMMIT_TAG =~ \/(.+)\/\s*$/gm)].map((m) => new RegExp(m[1]!));
    const accepted = (tag: string) => rules.some((rule) => rule.test(tag));
    expect(accepted(`la-gram-v${version}`)).toBe(true);
    expect(accepted('la-gram-v0.2.0-rc.1')).toBe(true);
    for (const other of [`v${version}`, 'la-gram-v1.2', 'la-gram-v1.2.3 ', 'la-gram-vx']) expect(accepted(other)).toBe(false);
  });

  it("publishes la-gram's on its tag only, and la-gram-git's on la-gram-git's only", () => {
    expect(job('.la-gram-release')).toContain('- if: $CI_COMMIT_TAG =~ /^la-gram-v/');
    for (const name of ['web-deploy', 'la-gram-release']) expect(job(name)).toMatch(/^ {2}extends: \.la-gram-release$/m);
    expect(job('.release')).toContain('- if: $CI_COMMIT_TAG =~ /^la-gram-git-v/');
    // la-gram-git's package is not built on la-gram's tag, la-gram's web app not on la-gram-git's.
    expect(job('package')).toMatch(/- if: \$CI_COMMIT_TAG =~ \/\^la-gram-v\/\n {6}when: never/);
    expect(job('web')).toMatch(/- if: \$CI_COMMIT_TAG =~ \/\^la-gram-git-v\/\n {6}when: never/);
    // The web app replaced by a release only, not by a pre-release; the Release made either way.
    expect(job('web-deploy')).toContain('- if: $CI_COMMIT_TAG =~ /^la-gram-v\\d+\\.\\d+\\.\\d+$/');
    const final = new RegExp(/- if: \$CI_COMMIT_TAG =~ \/(.+)\/\n {2}needs: \[web\]/.exec(job('web-deploy'))![1]!);
    expect([final.test(`la-gram-v${version}`), final.test('la-gram-v0.2.0-rc.1')]).toEqual([true, false]);
    expect(job('la-gram-release')).toMatch(/- job: web-deploy # not on a pre-release\n {6}artifacts: false\n {6}optional: true/);
    // The desktop apps: on la-gram's tag; by hand otherwise, never failing a request.
    expect(job('desktop')).toMatch(/- if: \$CI_COMMIT_TAG =~ \/\^la-gram-v\/\n {4}- if: \$CI_COMMIT_TAG\n {6}when: never\n {4}- when: manual\n {6}allow_failure: true/);
  });

  it("fails when the tag's version is not package.json's", () => {
    expect(pipeline).toContain('VERSION="$(node -p \'require("./package.json").version\')"');
    expect(pipeline).toContain('[ "${CI_COMMIT_TAG#la-gram-v}" != "$VERSION" ]');
    for (const name of ['web', 'desktop']) expect(job(name)).toContain('- *la-gram-version');
  });

  it('packages the five desktop targets, and the Release links the files they make', () => {
    const desktop = job('desktop');
    expect(desktop).toContain('- PLATFORM: darwin\n        ARCH: [arm64, x64]');
    expect(desktop).toContain('- PLATFORM: win32\n        ARCH: x64');
    expect(desktop).toContain('- PLATFORM: linux\n        ARCH: [x64, arm64]');
    expect(desktop).toContain('npm run package -- --platform "$PLATFORM" --arch "$ARCH" && break');
    const release = job('la-gram-release');
    const links = [...release.matchAll(/url: \$CI_API_V4_URL\/projects\/\$CI_PROJECT_ID\/packages\/generic\/la-gram\/\$VERSION\/(\S+)/g)].map((m) => m[1]);
    expect(links.sort()).toEqual(
      [
        'la-gram-$VERSION-darwin-arm64.zip',
        'la-gram-$VERSION-darwin-x64.zip',
        'la-gram-$VERSION-win32-x64.zip',
        'la-gram-$VERSION-linux-x64.tar.gz',
        'la-gram-$VERSION-linux-arm64.tar.gz',
      ].sort(),
    );
    // Uploaded where the links point; zipped as named: Linux as a tarball.
    expect(desktop).toContain('"$CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/generic/la-gram/$VERSION/$FILE"');
    expect(desktop).toContain('NAME="la-gram-$VERSION-$PLATFORM-$ARCH"');
    expect(desktop).toMatch(/if \[ "\$PLATFORM" = linux \]; then\n\s+FILE="\$NAME\.tar\.gz"/);
    // The macOS app signed ad hoc before it is zipped, by a pinned rcodesign whose checksum is checked.
    const sign = desktop.indexOf('rcodesign" sign "dist/packages/la-gram-$PLATFORM-$ARCH/la-gram.app"');
    expect(sign).toBeGreaterThan(0);
    expect(sign).toBeLessThan(desktop.indexOf('zip -qry'));
    expect(desktop).toMatch(/echo "[0-9a-f]{64}  rcodesign\.tar\.gz" \| sha256sum --check -/);
    // VERSION reaches the Release's fields from the web job.
    expect(job('web')).toContain('dotenv: version.env');
    expect(release).toMatch(/- job: web # VERSION\n {6}artifacts: true/);
  });

  it('copies the web app into the folder the README sets up on the server', () => {
    const folder = /LA_GRAM_DEPLOY_PATH  the folder nginx serves as \/la-gram\/ \((\S+)\)/.exec(pipeline)?.[1];
    expect(folder).toBe('/var/www/linked-archi-app/la-gram');
    const readme = read('README.md');
    expect(readme).toContain(`| \`LA_GRAM_DEPLOY_PATH\` | Variable | Visible | \`${folder}\` |`);
    expect(readme).toContain(`sudo mkdir -p ${folder}`);
    expect(job('web-deploy')).toContain('rsync -az --delete --chmod=D755,F644 dist/web/ "$DEPLOY_USER@$DEPLOY_HOST:$LA_GRAM_DEPLOY_PATH/"');
  });
});
