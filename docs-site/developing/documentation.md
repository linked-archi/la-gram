---
title: Writing the documentation
description: How these pages are written and built, from docs-site/ with MkDocs and Material for MkDocs, and published with the web app.
---
# Writing the documentation

These pages are Markdown in `docs-site/`, built by [MkDocs](https://www.mkdocs.org/) with
[Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) into `dist/web/docs/`, inside the web
app's folder. The release puts the two in place together, so https://app.linked.archi/la-gram/docs/
always describes the app deployed beside it ([Releasing](releasing.md#installed-by-the-server)).

| Path | Holds |
|---|---|
| `mkdocs.yml` | the site's configuration and its navigation |
| `docs-site/` | the pages, by section: `getting-started/`, `guide/`, `reference/`, `operating/`, `developing/`, and `index.md` and `troubleshooting.md` |
| `docs-site/assets/` | the logo, `images/la-gram.svg`, and the screenshots, `screenshots/<section>/<page>/` |
| `docs-site/examples/shop.ttl` | the example model the pages open in la-gram |
| `docs-site/stylesheets/extra.css` | Linked.Archi's colours |
| `scripts/docs/` | the build's hooks, the runner of the `docs:*` commands, the environment check and the screenshot script |
| `requirements-docs.txt` | every Python package of the toolchain, at an exact version |

## Commands {#commands}

| Command | Does |
|---|---|
| `npm run docs:setup` | makes `.venv-docs/`, the documentation's own Python environment, and installs `requirements-docs.txt` into it, exactly: `pip install --no-deps`, then `pip check` |
| `npm run docs:build` | `mkdocs build --strict`, into `dist/web/docs/`: any warning fails it |
| `npm run docs:serve` | `mkdocs serve`: the site at http://127.0.0.1:8000/la-gram/docs/, rebuilt on every save |
| `npm run docs:screenshots` | the User guide's screenshots, from the built app ([below](#screenshots)) |

Arguments after `--` go to `pip install` (setup) or to MkDocs: `npm run docs:serve -- --dev-addr
127.0.0.1:8001` when port 8000 is taken.

- **`.venv-docs` is always the interpreter**: `.venv-docs/bin/python`, or `.venv-docs\Scripts\python.exe`
  on Windows. **`VIRTUAL_ENV` is ignored**, so another project's active environment, with its own MkDocs
  or Material, never builds this site.
- **`PYTHON`** names the Python that `docs:setup` makes the environment from: 3.11 or later, `python3` by
  default (`python` on Windows). It is read by `setup` only. An existing `.venv-docs` is reused; one made
  from a Python older than 3.11 must be removed first, and setup says so.
- **Before `build` and `serve`**, `scripts/docs/check_env.py` confirms that `.venv-docs` has exactly the
  versions `requirements-docs.txt` pins. If it has not, or there is no `.venv-docs`, the command stops
  with exit code 2: *No Python environment for the documentation, or not the one requirements-docs.txt
  pins: run npm run docs:setup (Python 3.11 or later).*
- **`NO_MKDOCS_2_WARNING=true`** is set for every command the runner starts, and in CI's `docs` job.
  Material for MkDocs otherwise prints, on every build, its team's warning that MkDocs 2.0 will not run
  it. That is about a future MkDocs this site does not use: the toolchain is pinned to MkDocs 1.6
  ([Material's maintenance mode](#material-and-zensical)).

```console
$ npm run docs:setup
…
No broken requirements found.
$ npm run docs:build
INFO    -  Cleaning site directory
INFO    -  Building documentation to directory: …/dist/web/docs
INFO    -  moved 184 inline scripts into 7 files
INFO    -  Documentation built in 0.48 seconds
$ npm run docs:serve -- --dev-addr 127.0.0.1:41240
…
INFO    -  [22:18:38] Watching paths for changes: 'docs-site', 'mkdocs.yml', 'ci', 'packages/la-gram-git/docs'
INFO    -  [22:18:38] Serving on http://127.0.0.1:41240/la-gram/docs/
```

Another environment active, and a Python too old or missing (exit codes 0, 2 and 2):

```console
$ VIRTUAL_ENV=/tmp/la-gram-docs-other-venv npm run docs:build
…
INFO    -  Documentation built in 0.48 seconds
$ PYTHON=/usr/bin/python3 npm run docs:setup
…
/usr/bin/python3 is Python 3.9; the documentation needs 3.11 or later: name one with PYTHON=<path>.
$ PYTHON=/tmp/la-gram-docs-nowhere/python npm run docs:setup
…
No Python at /tmp/la-gram-docs-nowhere/python: install Python 3.11 or later, or name one with PYTHON=<path>.
```

What `check_env.py` says of an environment that does not match a pin (here a scratch list pinning
Material 9.7.6):

```console
$ .venv-docs/bin/python scripts/docs/check_env.py /tmp/la-gram-docs-lock.txt
mkdocs-material: 9.7.7 installed, 9.7.6 required
```

The warning `NO_MKDOCS_2_WARNING` keeps out, as Material prints it without the variable:

```text
 │  ⚠  Warning from the Material for MkDocs team
 │
 │  MkDocs 2.0, the underlying framework of Material for MkDocs,
 │  will introduce backward-incompatible changes, including:
 …
```

**The docs and the app, locally.** `npm run build:web` keeps `dist/web/docs/` (webpack's clean step
leaves that folder alone), so the order of the two builds does not matter. `npm run dev` or
`npm run serve` then serve the documentation at http://localhost:8080/docs/ beside the app. Links from
the documentation to the app are absolute, `https://app.linked.archi/la-gram/…`, so a local preview opens
production for them. So are the app's links to its documentation: *la-gram documentation* in la-gram's
menu opens https://app.linked.archi/la-gram/docs/, so open the local copy by its address.

## Writing rules {#writing-rules}

- **Front matter:** every page starts with a `title` and a one-sentence `description`, one line of at most
  200 characters. A page without one fails the strict build. Other fields, such as `date` or `tags`, are
  accepted and not used ([below](#what-the-site-leaves-out)).

    ```yaml
    ---
    title: Writing the documentation
    description: How these pages are written and built, from docs-site/ with MkDocs and Material for MkDocs, and published with the web app.
    ---
    ```

- **Language:** British English with the Oxford `-ize` (*realize*, *organization*), plain and precise.
  Do not count the languages or frameworks la-gram offers: the catalogue grows.
- **UI labels** in *italics*, exactly as the app shows them, menus joined with › (*File › Settings…*).
- **Keys** with `++ctrl+z++`, which shows as ++ctrl+z++; where Windows and macOS differ, linked tabs,
  `=== "Windows and Linux"` and `=== "macOS"`, as on [Keyboard and mouse](../reference/keyboard.md).
- **Options:** each setting, key, flag or parameter under its own heading, or as a row of a table under
  one, with what it does, its values, its default in **bold**, and an example: a code block, numbered
  steps or a `!!! example`.
- **Caveats** as admonitions; `!!! warning` for security.
- **Examples are real:** run every command shown, and quote its output, shortened with `…`. Use Acme and
  `example.org`, `git.example.com` and the like, and placeholders for anything of a real installation:
  `<deploy-host>`, `<web-root>`. No server's own configuration, paths, user names or certificates.
- **Links:** to other pages, relative `.md` links; to the app, `https://app.linked.archi/la-gram/…`; to
  semantic assets, their full `https://meta.linked.archi/…` IRIs; to a repository file, its GitHub
  `blob/main/…` address. A relative link out of `docs-site/` fails the strict build.
- **Unimplemented features** appear only in [Not yet in la-gram](../troubleshooting.md#not-yet-in-la-gram).
- **Embedding a repository file**: a line `--8<-- "ci/github/la-gram-git.yml"` inside a fenced block is
  replaced by that file. To show the line itself, as here, write it with a `;` in front:
  `;--8<-- "…"` shows as the line without the `;`. An unescaped one is expanded without a word.

    ```text
    ;--8<-- "ci/github/la-gram-git.yml"
    ```

**Snippet limits.** An embedded file is read from the checkout's top folder, must exist (a missing one
fails the build), may not lead out of it, and may not be a URL. `docs:serve` reloads on changes to
`docs-site/`, `mkdocs.yml`, and the two folders embedded today: `ci/` and `packages/la-gram-git/docs/`.

## Screenshots {#screenshots}

`npm run docs:screenshots` makes the User guide's screenshots, from the production web build in Chrome,
with the example model open: `/la-gram/?model=docs/examples/shop.ttl&assets=offline`, at 1600 × 1000 and a
scale of 2, each in a fresh browser context, every wait for a state. It writes
`docs-site/assets/screenshots/guide/<page>/*.png`, and only once all of them succeeded, so a failed run
leaves the committed ones as they were. The PNGs are committed: CI has no Chrome.

- **Build first:** `npm run build:web` (and `npm run docs:build`, for the example model it serves).
- **Chrome:** the system's, or `LA_GRAM_CHROME=<path>` ([Testing](testing.md#chrome)).
- **Exit codes:** 0 when all are written; 1 when a shot fails (a wait timed out, the page threw), naming
  the shot and what it waited for; 2 when the build, the model or Chrome is missing.
- **Look at each one** before committing it, and write its alt text from what it shows. Each goes in a
  `<figure markdown="span">` with a `<figcaption>`.

```console
$ npm run build:web && npm run docs:screenshots
…
docs-site/assets/screenshots/guide/index/workbench.png  463 KiB
docs-site/assets/screenshots/guide/canvas/context-pad.png  12 KiB
docs-site/assets/screenshots/guide/appearance/appearance-tab.png  95 KiB
docs-site/assets/screenshots/guide/validation/validation-tab.png  83 KiB
docs-site/assets/screenshots/guide/sparql/questions-menu.png  83 KiB
docs-site/assets/screenshots/guide/graph/graph-tab.png  90 KiB
docs-site/assets/screenshots/guide/rdf-panel/rdf-panel.png  394 KiB
docs-site/assets/screenshots/guide/metamodels/metamodels-menu.png  149 KiB
8 screenshots, 1.34 MiB, at 1600×1000 × 2
$ LA_GRAM_CHROME=/tmp/la-gram-docs-nowhere/chrome npm run docs:screenshots
…
Install Google Chrome, or set LA_GRAM_CHROME to the path of a Chrome or Chromium executable.
```

A run on another Chrome version can give PNGs that differ byte for byte while showing the same: read the
change with your eyes, not with `git diff --stat`.

## The example model {#the-example-model}

`docs-site/examples/shop.ttl` is Acme's online shop, a small ArchiMate 4.0 model, in the namespace
`https://example.org/acme/shop/`. The build publishes it as `docs/examples/shop.ttl`, so a page opens it
with https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl, and the screenshots show it.

**Its one warning is on purpose.** Nothing realizes the service *Gift wrapping*, so the Validation tab
shows the `ServiceWithoutRealizationShape` warning, which `validation-tab.png` needs. The model says so
itself, in RDF:

```turtle
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix m: <https://example.org/acme/shop/>.
m:model skos:editorialNote "Gift wrapping is realized by nothing on purpose: the documentation's Validation screenshot shows the ServiceWithoutRealizationShape warning it raises."@en.
```

Do not "fix" it. The screenshot script waits for that warning, and stops if it is gone.

**Editing it:**

1. Keep it exactly as la-gram writes it. **No Turtle comments**: `la-gram-git fix` removes them, and
   `la-gram-git check` fails a file that has them. Anything the file should say goes into RDF, as the
   editorial note does. Write bounds as `"40"^^xsd:double`: a bare `40.0` is a decimal in Turtle, and
   fails the core-vis shapes.
2. Or edit it in la-gram, and save it over the file with *File › Save*.
3. Then `npm run build:cli`, `node packages/la-gram-git/dist/la-gram-git.js fix docs-site/examples` and
   `node packages/la-gram-git/dist/la-gram-git.js check docs-site/examples`. The check must pass, with the
   *Gift wrapping* warning as its one `warning:` line. Its names are readable ones written by hand, such
   as `m:card-payment`, not the IRI layout la-gram mints, so the *IRI layout* lines list them: advisory,
   never failed, and on purpose, as the pages quote those names.
4. Regenerate the screenshots, and read the pages that quote the model.

```console
$ node packages/la-gram-git/dist/la-gram-git.js check docs-site/examples
✓ docs-site/examples/shop.ttl
  · 3 from the shapes' SPARQL-based rules (advisory):
  ·   warning: Gift wrapping (Service) · Service Gift wrapping is not realized by anything. (https://meta.linked.archi/archimate4/principle-shapes#ServiceWithoutRealizationShape)
  ·   info: Online ordering (Service) · Service Online ordering is realized by only one application component (Web shop). Consider redundancy for critical services. (https://meta.linked.archi/archimate4/principle-shapes#SinglePointOfFailureShape)
  ·   info: Card payment (Service) · Service Card payment is realized by only one application component (Payments). Consider redundancy for critical services. (https://meta.linked.archi/archimate4/principle-shapes#SinglePointOfFailureShape)
  · IRI layout (DD-41), advisory:
  ·   the model does not state its namespace (vann:preferredNamespaceUri), read as https://example.org/acme/shop/
  ·   16 outside it, not model, graph/… or {kind}/{id}: card-payment, card-payment-serves-web-shop, customer, … and 13 more
  ·   18 named before it (legacy): link-card-payment-serves-web-shop, link-customer-assigned-to-place-order, link-gift-wrapping-serves-customer, … and 15 more

1 model file checked: all well.
```

**It is tied to la-gram-git's releases.** The pipeline's `package` job checks the example on merge
requests and on `la-gram-git-v*` tags too ([Releasing](releasing.md#jobs)). A la-gram-git change that
writes files differently, or finds more, fails there until the example is brought up to date: run
`la-gram-git fix docs-site/examples`, then `npm run docs:screenshots`, and commit both.

## The CSP hook {#csp-hook}

app.linked.archi's Content-Security-Policy runs no inline script (`script-src 'self'
'wasm-unsafe-eval'`), and the docs are served under it, on the app's own site
([Hosting the web app](../operating/web-app.md#content-security-policy)). Material writes small inline
scripts into every page, without which none of its JavaScript (search, navigation, the palette toggle,
tabs, copy buttons) would start. `scripts/docs/csp_hook.py`, a MkDocs hook, makes the site run under
the policy as it is:

- it moves each inline script into a file of the site, `assets/javascripts/inline.<16 hex>.js`, named by
  its content, and puts a `<script src>` where it was, so order and position are kept. The same script
  on many pages is one file. Data blocks, such as Material's `application/json` configuration, stay;
- after the build, it checks every page and stylesheet for anything the policy would block, or a request
  to another site: an inline script or handler, a `javascript:` link, a script, stylesheet, font or frame
  from elsewhere, a Mermaid diagram, an image without `alt`. Each is a warning, which fails
  `npm run docs:build` and CI.

`scripts/docs/front_matter_hook.py`, the other hook, warns of a page without a valid `description`.

```text
INFO    -  moved 184 inline scripts into 7 files
```

**After editing a hook, restart `npm run docs:serve`; `npm run docs:build` always uses the current
code.** MkDocs keeps a hook it has loaded for as long as it serves.

The policy is not loosened for the docs: `'unsafe-inline'` on the app's own site would let an injected
script read what the web app keeps there, such as a remembered Git token
([stored data](../reference/stored-data.md#git-tokens)).

## The logo {#the-logo}

`docs-site/assets/images/la-gram.svg`, the site's logo and favicon, is a byte-for-byte copy of
`src/icons/favicon.svg`. When the mark changes, copy it again, and compare:

```console
$ cp src/icons/favicon.svg docs-site/assets/images/la-gram.svg
$ cmp docs-site/assets/images/la-gram.svg src/icons/favicon.svg && echo identical
identical
```

## What the site leaves out {#what-the-site-leaves-out}

Kept out on purpose, most because they would break the policy or have every reader's browser ask
another site for something:

| Left out | Because |
|---|---|
| instant navigation (`navigation.instant`) | each page loads as a page of its own, with the scripts the CSP hook moved out of it, rather than being swapped in by script |
| search sharing (`search.share`) | its link is a `javascript:` URL, which the policy blocks |
| edit and view links (`content.action.*`), `repo_url` | with `repo_url`, Material's script asks GitHub's API for the project's stars from every reader's browser; the footer links to GitHub instead |
| Mermaid | Material loads it from a CDN; diagrams are SVG files |
| analytics, cookie consent | nothing is measured |
| Google Fonts (`theme.font: false`) | the system's fonts; the policy takes fonts from the site only |

**Front matter.** The site asks for `title` and `description` only: no `date`, `date_modified`, `tags`,
JSON-LD or `og:image`, though the Linked.Archi workspace's documentation conventions name `date`,
`date_modified` and `tags` as portable expectations. Material without template overrides emits none of
them, so they would do nothing here. The front-matter hook accepts those fields without a warning, so
adopting them later only adds them to the pages.

## Upgrading the toolchain {#upgrading-the-toolchain}

`requirements-docs.txt` pins every package, the three the site uses (MkDocs 1.6, Material 9.7,
pymdown-extensions 12) and what they bring, so a build next month is this build. Upgrade on purpose:

1. **Look for newer patches** of the three: `pip index versions mkdocs`, `pip index versions
   mkdocs-material`, `pip index versions pymdown-extensions`. Bump a direct pin to a newer 1.6.x, 9.7.x or
   12.x.
2. **Freeze locally:** in a fresh environment, Python 3.11 or later, install the three direct pins *with*
   their dependencies, then `pip freeze`.
3. **Freeze in CI's image**, if Docker is at hand:
   `docker run --rm -v "$PWD":/w -w /w python:3.14.10-slim-trixie sh -c 'python -m venv /tmp/v && /tmp/v/bin/pip install --quiet mkdocs==… mkdocs-material==… pymdown-extensions==… && /tmp/v/bin/pip freeze'`.
4. **Reconcile:** if the two freezes differ, the CI image's wins, since it builds the published site. Keep
   every version at or above the security floors the file notes. Rewrite its "What they bring" block.
5. **Verify:** `npm run docs:setup` (`--no-deps`, then `pip check`), `npm run docs:build`, and
   `npm run docs:screenshots`; then look at the built site under the server's policy, served as
   [Hosting the web app](../operating/web-app.md) shows.

```console
$ .venv-docs/bin/pip index versions mkdocs-material
mkdocs-material (9.8.1)
Available versions: 9.8.1, 9.8.0, 9.7.7, 9.7.6, …
$ .venv-docs/bin/pip index versions mkdocs
mkdocs (1.6.1)
$ .venv-docs/bin/pip index versions pymdown-extensions
pymdown-extensions (13.0)
```

Today 9.7.7 and 1.6.1 are the newest of their series. Material 9.8.1 and pymdown-extensions 13.0 are
newer series, a choice of their own.

### Material's maintenance mode and Zensical {#material-and-zensical}

Material for MkDocs is in maintenance mode, with critical fixes and security updates only. 9.7.7 fixed
a cross-site scripting flaw in search suggestions. 9.8.0 is a security release that raises the minimum
versions of Material's dependencies and needs Python 3.11 or later; the pins of `requirements-docs.txt`
already meet those minimums. Its notice gives Material's end of life as 5 May 2027, and points to
Zensical, from the same team. Since 9.7.5, Material requires MkDocs below 2.0; MkDocs 2.0, if it ships,
drops the plugin and theme systems Material builds on.

The site is kept easy to move:

- only Material's built-in features, its own search, and Python-Markdown and pymdown-extensions;
- no third-party plugins, no template overrides, no extra JavaScript;
- MkDocs-specific code only in the two hooks, whose work is done by functions over the HTML text.

The ways forward: Material 9.8.1, which needs Python 3.11 or later, as the site already does, and
where Material's fixes now land; or Zensical before Material's end of life. Zensical reads `mkdocs.yml`, but does
not run hooks yet: the hook's functions would run as a pass over the built site instead, and its link
validation and strictness are to be checked against MkDocs'. It has its own search, so `plugins:
[search]` is the setting to look at again.
