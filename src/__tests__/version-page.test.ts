/**
 * The page of a la-gram version (`scripts/version-page.mjs`, Req 9.16, 15.10): what the IRI la-gram records
 * as the agent of its edits resolves to — a release's, linking its Release; a pre-release built from a
 * commit, naming the commit and its channel's app.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a build script, plain JavaScript without types.
import { versionPageHtml } from '../../scripts/version-page.mjs';

const REPOSITORY = 'https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram';
const page = (options: Record<string, string>) =>
  versionPageHtml({ repository: REPOSITORY, built: '2026-11-20', licence: 'Apache-2.0', ...options }) as string;

describe('a version’s page', () => {
  it('a release: its identifier, its Release and source at its tag, the app and documentation at la-gram’s home', () => {
    const html = page({ version: '0.3.0' });
    expect(html).toContain('<link rel="canonical" href="https://app.linked.archi/la-gram/v0.3.0">');
    expect(html).toContain(`${REPOSITORY}/-/releases/la-gram-v0.3.0`);
    expect(html).toContain('href="https://app.linked.archi/la-gram/docs/"');
    expect(html).not.toContain('pre-release');
    const jsonLd = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(jsonLd).toMatchObject({ '@id': 'https://app.linked.archi/la-gram/v0.3.0', 'schema:softwareVersion': '0.3.0' });
  });

  it('the alpha, built from a commit: the commit, no Release; its own app and documentation; the identifier under la-gram’s home', () => {
    const html = page({ version: '0.3.0-alpha', commit: '0123456789abcdef', app: 'https://app.linked.archi/la-gram-alpha/' });
    expect(html).toContain('<link rel="canonical" href="https://app.linked.archi/la-gram/v0.3.0-alpha">');
    expect(html).toContain(`${REPOSITORY}/-/commit/0123456789abcdef`);
    expect(html).toContain('<code>01234567</code>');
    expect(html).not.toContain('/-/releases/');
    expect(html).toContain('href="https://app.linked.archi/la-gram-alpha/docs/"');
    expect(html).toContain('A pre-release');
  });
});
