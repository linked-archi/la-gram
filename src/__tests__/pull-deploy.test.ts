/**
 * la-gram's release on GitHub, `.github/workflows/la-gram.yml`, and the server's side of it,
 * `ops/pull-deploy/`: the workflow publishes, and app.linked.archi fetches and installs what it
 * publishes, only when the build record says this workflow built it (.agents/tasks/pull-deploy/).
 * The two halves name the same files, the same workflow and the same refs; the server's side holds
 * no secret. And la-gram-git's release from the same workflow, on its own tag: npm and the image
 * (.agents/tasks/github-move/). Nothing is built for release anywhere else.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_DOWNLOADS } from '../help-links.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const workflow = read('.github/workflows/la-gram.yml');
const pull = read('ops/pull-deploy/la-gram-pull');
const unit = read('ops/pull-deploy/la-gram-pull@.service');
const conf = read('ops/pull-deploy/la-gram-pull.conf.example');
const version = (JSON.parse(read('package.json')) as { version: string }).version;

/** A job's lines, from its name under `jobs:` up to the next job's. */
function job(name: string): string {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  const at = jobs.search(new RegExp(`^ {2}${name}:\\n`, 'm'));
  expect(at, `job ${name}`).toBeGreaterThanOrEqual(0);
  const rest = jobs.slice(at);
  const end = rest.search(/\n {2}[\w-]+:\n/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

/** A shell function's body in la-gram-pull. */
function fn(name: string): string {
  const body = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(pull)?.[0];
  expect(body, `function ${name}`).toBeDefined();
  return body!;
}

describe('la-gram released on GitHub, installed by app.linked.archi itself', () => {
  it('releases on a tag la-gram-v<the version in package.json>, and on no other of its form', () => {
    expect(workflow).toContain("tags: ['la-gram-v*', 'la-gram-git-v*']");
    // GitHub Actions only: no other pipeline builds or deploys la-gram (GH-8).
    expect(existsSync(join(ROOT, '.gitlab-ci.yml'))).toBe(false);
    const rule = new RegExp(/=~ (\^la-gram-v\S+\$) \]\]/.exec(job('version'))![1]!);
    expect(rule.test(`la-gram-v${version}`)).toBe(true);
    expect(rule.test('la-gram-v0.2.0-rc.1')).toBe(true);
    for (const other of [`v${version}`, 'la-gram-v1.2', 'la-gram-vx', 'la-gram-git-v0.1.0']) expect(rule.test(other)).toBe(false);
    expect(job('version')).toContain('[ "${REF_NAME#la-gram-v}" != "$VERSION" ]');
  });

  it('holds one secret, la-gram-git’s first npm token, in its own environment; the run’s own token, read-only but where a job publishes; every action pinned to a commit', () => {
    expect([...workflow.matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map((m) => m[1])).toEqual(['NPM_TOKEN']);
    const npm = job('npm');
    expect(npm).toContain('NPM_TOKEN: ${{ secrets.NPM_TOKEN }}');
    expect(npm).toMatch(/environment:\n {6}name: la-gram-git\n/);
    // Only when set, for the first release; written as a reference npm resolves, never as its value.
    expect(npm).toContain(`if [ -n "$NPM_TOKEN" ]; then echo '//registry.npmjs.org/:_authToken=\${NPM_TOKEN}' > "$HOME/.npmrc"; fi`);
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    for (const name of ['version', 'test', 'package', 'web', 'docs', 'desktop']) expect(job(name)).not.toContain('permissions:');
    for (const name of ['release', 'alpha']) expect(job(name)).toMatch(/permissions:\n {6}contents: write/);
    for (const name of ['npm', 'image', 'image-tags']) expect(job(name)).toMatch(/permissions:\n {6}contents: read\n/);
    expect(npm).toContain('id-token: write');
    for (const name of ['image', 'image-tags']) expect(job(name)).toContain('packages: write');
    const uses = [...workflow.matchAll(/^\s+(?:- )?uses: (\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, action, rest] of uses) expect(`${action}${rest}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    // No job leaves the token in the checkout for the steps after it.
    const checkouts = (workflow.match(/uses: actions\/checkout@/g) ?? []).length;
    expect((workflow.match(/persist-credentials: false/g) ?? []).length).toBe(checkouts);
  });

  it('publishes the five desktop apps under the names the server puts beside the web app', () => {
    const desktop = job('desktop');
    const targets = [...desktop.matchAll(/- \{ platform: (\w+), arch: (\w+) \}/g)].map((m) => `${m[1]}-${m[2]}`);
    expect(targets).toEqual(DESKTOP_DOWNLOADS.map((d) => d.id));
    expect(desktop).toContain('NAME="la-gram-$VERSION-$PLATFORM-$ARCH"');
    expect(desktop).toMatch(/if \[ "\$PLATFORM" = linux \]; then\n\s+tar -czf "\.\.\/\.\.\/release\/\$NAME\.tar\.gz"/);
    expect(desktop).toMatch(/echo "[0-9a-f]{64} {2}rcodesign\.tar\.gz" \| sha256sum --check -/);
    // The server fetches la-gram-<version>-<target> and serves it as downloads/la-gram-<target>, la-gram's menu's names.
    const pulled = /^TARGETS="([^"]+)"$/m.exec(pull)![1]!.split(' ');
    expect(pulled.map((t) => `la-gram-${t}`)).toEqual(DESKTOP_DOWNLOADS.map((d) => d.file));
    for (const t of pulled) expect(t.endsWith(t.startsWith('linux-') ? '.tar.gz' : '.zip'), t).toBe(true);
    expect(pull).toContain('name="la-gram-$ID-$v"');
    expect(pull).toContain('mv "$WORK/$name" "$stage/downloads/la-gram-$v"');
    expect(pull).toContain('sha256sum la-gram-* > SHA256SUMS.txt');
  });

  it('records how each published file was built, and the server installs only what that record vouches for', () => {
    for (const name of ['release', 'alpha']) {
      const publish = job(name);
      expect(publish).toMatch(/uses: actions\/attest-build-provenance@[0-9a-f]{40}/);
      expect(publish).toContain("subject-path: 'release/la-gram-*'");
      expect(publish).toContain('id-token: write');
      expect(publish).toContain('attestations: write');
    }
    const signer = /^WORKFLOW=\$\{WORKFLOW:-(\S+)\}$/m.exec(pull)![1]!;
    expect(signer).toBe('.github/workflows/la-gram.yml');
    expect(existsSync(join(ROOT, signer))).toBe(true);
    expect(conf).toContain(`WORKFLOW=${signer}`);
    // Each file: its sum, then its build record, for this workflow, the channel's ref, a GitHub-hosted runner.
    const check = fn('check');
    expect(check.indexOf('sha256sum --check')).toBeLessThan(check.indexOf('gh attestation verify'));
    expect(check).toContain('--signer-workflow "$REPO/$WORKFLOW" --source-ref "$REF" --deny-self-hosted-runners');
    expect(fn('release')).toContain('REF="refs/tags/$TAG"');
    expect(fn('release')).toContain('REF=refs/heads/main');
    // Checked before it is unpacked, and every desktop app before it goes into the folder.
    const deploy = fn('deploy');
    expect(deploy.indexOf('check "$web"')).toBeLessThan(deploy.indexOf('tar -xzf'));
    expect(deploy.indexOf('check "$name"')).toBeLessThan(deploy.indexOf('mv "$WORK/$name"'));
  });

  it('replaces the web app with a release only, never a pre-release; the alpha only from main, built for its channel (Req 15.10)', () => {
    const select = fn('release');
    expect(select).toContain('select(.draft | not) | select(.prerelease | not)');
    expect(select).toContain(String.raw`test("^la-gram-v[0-9]+\\.[0-9]+\\.[0-9]+$")`);
    expect(job('release')).toContain('if [[ "$VERSION" == *-* ]]; then FLAGS=(--prerelease --latest=false)');
    expect(job('version')).toMatch(/refs\/heads\/main\)\n\s+if \[ "\$EVENT" = push \]; then\n\s+case "\$VERSION" in \*-\*\) KIND=alpha ;; esac/);
    expect(job('alpha')).toContain("if: needs.version.outputs.kind == 'alpha'");
    expect(job('alpha')).toContain('--prerelease --latest=false');
    expect(job('web')).toContain("LA_GRAM_CHANNEL: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'alpha' || '' }}");
    // The version's page names the commit from GitHub's own variables, which every step has
    // (webpack.config.js, version-page.test): nothing to set here.
    expect(job('web')).not.toContain('CI_COMMIT_');
  });

  it('is served as the operating page’s nginx rules say: the alpha beside the release, the downloads folder sending visitors to the documentation', () => {
    const web = read('docs-site/operating/web-app.md');
    expect(web).toContain('location ^~ /la-gram-alpha/ {');
    expect(web).toContain(
      'location = /la-gram/downloads/ {\n        absolute_redirect off;\n        return 302 /la-gram/docs/getting-started/desktop/#download;',
    );
    // Between releases, package.json says the next release's alpha.
    expect(version).toMatch(/^\d+\.\d+\.\d+(-alpha)?$/);
  });

  it('builds this version’s page, and keeps every version’s page served (Req 9.16)', () => {
    expect(job('web')).toContain('test -f "dist/web/v$VERSION/index.html"');
    for (const name of ['release', 'alpha']) {
      expect(job(name)).toContain('test -f dist/web/index.html && test -f dist/web/docs/index.html && test -f "dist/web/v$VERSION/index.html"');
    }
    const deploy = fn('deploy');
    expect(deploy).toContain('replace "$stage/$name" "$BASE/versions/$name"');
    expect(deploy).toContain('cp -a "$BASE/versions/." "$stage/"');
    expect(fn('prune')).not.toContain('versions');
    // adopt takes the pages the SSH deploy kept into versions/.
    expect(fn('adopt')).toContain('cp -a "$v" "$BASE/versions/"');
  });

  it('runs the server’s side as its own user, with no rights it does not need', () => {
    for (const line of ['User=la-gram-pull', 'ExecStart=/usr/local/bin/la-gram-pull %i', 'NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes']) {
      expect(unit).toContain(`${line}\n`);
    }
    expect(unit).toMatch(/^CapabilityBoundingSet=$/m);
    const base = /^BASE=\$\{BASE:-(\S+)\}$/m.exec(pull)![1]!;
    expect(/^ReadWritePaths=(.+)$/m.exec(unit)![1]).toBe(base);
    expect(conf).toContain(`BASE=${base}`);
    expect(statSync(join(ROOT, 'ops/pull-deploy/la-gram-pull')).mode & 0o111).not.toBe(0);
  });
});

describe('la-gram-git released from the same workflow, on its own tag', () => {
  const cli = (JSON.parse(read('packages/la-gram-git/package.json')) as { version: string; repository: { url: string } });

  it('on a tag la-gram-git-v<the version in its package.json>, and on no other of its form; nothing of la-gram’s, and la-gram’s tag nothing of its', () => {
    const rule = new RegExp(/=~ (\^la-gram-git-v\S+\$) \]\]/.exec(job('version'))![1]!);
    expect(rule.test(`la-gram-git-v${cli.version}`)).toBe(true);
    expect(rule.test('la-gram-git-v0.2.0-rc.1')).toBe(true);
    for (const other of [`la-gram-v${version}`, 'la-gram-git-v1.2', 'la-gram-git-vx']) expect(rule.test(other)).toBe(false);
    expect(job('version')).toContain('[ "${REF_NAME#la-gram-git-v}" != "$CLI_VERSION" ]');
    // Its case before every other tag's, which would refuse it as not la-gram-v<version>.
    expect(job('version').indexOf('refs/tags/la-gram-git-v*)')).toBeLessThan(job('version').indexOf('refs/tags/*)'));
    for (const name of ['npm', 'image', 'image-tags']) expect(job(name)).toContain("if: needs.version.outputs.cli != 'none'");
    expect(job('package')).toContain("if: ${{ !startsWith(github.ref, 'refs/tags/la-gram-v') }}");
    for (const name of ['web', 'docs']) expect(job(name)).toContain("if: ${{ !startsWith(github.ref, 'refs/tags/la-gram-git-v') }}");
  });

  it('publishes the one file the package job packed: to npm with provenance, a pre-release under next; as the image, for both platforms', () => {
    expect(job('package')).toContain('path: packages/la-gram-git/linked-archi-la-gram-git-*.tgz');
    const npm = job('npm');
    expect(npm).toContain('needs: [version, test, package]');
    expect(npm).toContain('npm install --global npm@11');
    expect(npm).toContain('case "$VERSION" in *-*) DIST_TAG=next ;; *) DIST_TAG=latest ;; esac');
    expect(npm).toContain('npm publish "./linked-archi-la-gram-git-$VERSION.tgz" --access public --tag "$DIST_TAG" --provenance');
    const image = job('image');
    // After npm's, whose approval releases both.
    expect(image).toContain('needs: [version, package, npm]');
    expect(image).toContain('- { arch: amd64, runner: ubuntu-24.04 }');
    expect(image).toContain('- { arch: arm64, runner: ubuntu-24.04-arm }');
    expect(image).toContain('IMAGE: ghcr.io/linked-archi/la-gram-git');
    // Tried before it is pushed.
    expect(image.indexOf('la-gram-git --version')).toBeGreaterThan(0);
    expect(image.indexOf('la-gram-git check shop.ttl')).toBeLessThan(image.indexOf('docker push'));
    expect(job('image-tags')).toContain('case "$VERSION" in *-*) TAGS="$VERSION" ;; *) TAGS="$VERSION ${VERSION%%.*} latest" ;; esac');
    expect(job('image-tags')).toContain('"$IMAGE:$VERSION-amd64" "$IMAGE:$VERSION-arm64"');
  });

  it('names this repository where npm’s provenance and ghcr.io’s link to it look for it', () => {
    expect(cli.repository.url).toBe('git+https://github.com/linked-archi/la-gram.git');
    expect(read('packages/la-gram-git/Dockerfile')).toContain('org.opencontainers.image.source="https://github.com/linked-archi/la-gram"');
  });
});
