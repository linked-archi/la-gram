/**
 * The page of a la-gram version, `v{version}/index.html` beside the web app: what
 * `https://app.linked.archi/la-gram/v{version}` — the IRI la-gram records as the agent of the edits it makes
 * (Req 9.16; meta's DD-27, *What a modeller records of its edits*) — resolves to. Who made a model's
 * changes, when and with what is in the model; what *with what* was is on this page: the version, when it
 * was built, its release, its source, its documentation and its licence, and, for a program that reads it,
 * the same as JSON-LD.
 *
 * The web build writes the page of its own version; the server keeps the pages of the versions installed
 * before (`ops/pull-deploy/la-gram-pull`, `versions/`), so every version a model names stays reachable.
 *
 * A pre-release built from a commit rather than a release tag — the alpha, from each merge to the default
 * branch (`alpha` in `.github/workflows/la-gram.yml`) — has no release to link to: its page names the commit
 * it was built from, the last one, and the app and documentation of its channel
 * (`https://app.linked.archi/la-gram-alpha/`).
 */

import path from 'node:path';

/** la-gram's home, which every version's page is under (`src/model-manager/provenance.ts`, `LA_GRAM_HOME`). */
export const LA_GRAM_HOME = 'https://app.linked.archi/la-gram/';

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The page of `version`, in `repository` (la-gram's source, `src/help-links.ts`'s `REPOSITORY`), built on
 * `built` (an ISO date) — from `commit`, when it was not built from its release tag, for the app at `app`
 * (la-gram's home by default).
 */
export function versionPageHtml({ version, repository, built, licence, commit, app = LA_GRAM_HOME }) {
  const iri = `${LA_GRAM_HOME}v${version}`;
  const tag = `la-gram-v${version}`;
  const which = app === LA_GRAM_HOME ? 'the latest release' : 'this pre-release, as it is now';
  const links = [
    ...(commit
      ? [['The commit it was built from', `${repository}/commit/${commit}`]]
      : [
          ['Release notes and downloads', `${repository}/releases/tag/${tag}`],
          ['Source at this version', `${repository}/tree/${tag}`],
        ]),
    [`la-gram, in the browser (${which})`, app],
    [`Documentation (${which})`, `${app}docs/`],
    ['Recording who changed what', `${app}docs/guide/properties/#last-changed`],
  ];
  const jsonLd = {
    '@context': { prov: 'http://www.w3.org/ns/prov#', schema: 'https://schema.org/' },
    '@id': iri,
    '@type': ['prov:SoftwareAgent', 'schema:SoftwareApplication'],
    'schema:name': 'la-gram',
    'schema:softwareVersion': version,
    'schema:datePublished': built,
    'schema:license': licence,
    'schema:codeRepository': repository,
    'schema:url': commit ? `${repository}/commit/${commit}` : `${repository}/releases/tag/${tag}`,
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>la-gram ${escape(version)}</title>
<meta name="description" content="la-gram ${escape(version)}, the Linked.Archi modeller: the version a model's edits name as their agent.">
<link rel="icon" href="../favicon.svg">
<link rel="canonical" href="${escape(iri)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>
  :root { color-scheme: light dark; --fg: #202124; --muted: #5f6368; --bg: #fff; --rule: #dadce0; --link: #1a73e8; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8eaed; --muted: #9aa0a6; --bg: #202124; --rule: #3c4043; --link: #8ab4f8; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 3rem 1rem; }
  h1 { font-size: 1.75rem; margin: 0 0 .25rem; display: flex; align-items: center; gap: .5rem; }
  h1 img { width: 32px; height: 32px; }
  .muted { color: var(--muted); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 1.5rem 0; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  code { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; }
  ul { padding-left: 1.2rem; }
  a { color: var(--link); }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }
</style>
</head>
<body>
<main>
<h1><img src="../favicon.svg" alt="">la-gram ${escape(version)}</h1>
<p class="muted">Semantic Modeller for Enterprise and IT Architecture</p>
<p>This page stands for la-gram ${escape(version)}. A model edited with it names this version as the program its
changes were made with: <code>prov:wasAssociatedWith &lt;${escape(iri)}&gt;</code>, beside the person who made them
and when.</p>
${commit ? `<p class="muted">A pre-release: built anew from each change merged before its release, this page says
the last of them.</p>
` : ''}<dl>
  <dt>Version</dt><dd>${escape(version)}</dd>
  <dt>Built</dt><dd>${escape(built)}</dd>
${commit ? `  <dt>Commit</dt><dd><code>${escape(commit.slice(0, 8))}</code></dd>
` : ''}
  <dt>Identifier</dt><dd><code>${escape(iri)}</code></dd>
  <dt>Licence</dt><dd>${escape(licence)}</dd>
</dl>
<ul>
${links.map(([label, href]) => `  <li><a href="${escape(href)}">${escape(label)}</a></li>`).join('\n')}
</ul>
<hr>
<p class="muted">la-gram is part of <a href="https://linked.archi">Linked.Archi</a>.</p>
</main>
</body>
</html>
`;
}

/** Writes the page of the version being built into the web build, as `v{version}/index.html`. */
export class VersionPagePlugin {
  constructor({ version, repository, licence, built = new Date().toISOString().slice(0, 10), commit, app }) {
    this.options = { version, repository, licence, built, ...(commit ? { commit } : {}), ...(app ? { app } : {}) };
  }

  apply(compiler) {
    const { RawSource } = compiler.webpack.sources;
    compiler.hooks.thisCompilation.tap('VersionPagePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'VersionPagePlugin', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          if (!this.options.version) return;
          const file = path.posix.join(`v${this.options.version}`, 'index.html');
          compilation.emitAsset(file, new RawSource(versionPageHtml(this.options)));
        },
      );
    });
  }
}
