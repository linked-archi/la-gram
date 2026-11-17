---
title: Building
description: How to build la-gram's web app, desktop app and la-gram-git from source, with every npm script, build switch and output folder.
---
# Building

One TypeScript source tree, built by webpack into four things: the web app, the desktop app (Electron),
the la-gram-git command line, and, with MkDocs, these pages ([Writing the documentation](documentation.md)).
Every command runs from the checkout's top folder.

```sh
npm ci                 # the dependencies, from package-lock.json
npm run build:web      # the web app, into dist/web/
npm run dev            # a development build, served on http://localhost:8080
```

`npm ci` takes seconds with npm's cache filled: *added 422 packages*. Electron's own binary (a 125 MB
download for macOS on Apple silicon) is not part of it: Electron 44 downloads it the first time it runs,
once, saying *Downloading Electron binary...*.

## Requirements {#requirements}

| Tool | Needed for | Version |
|---|---|---|
| Node.js and npm | everything | **22 or later** (`engines` in `package.json`); la-gram-git, once built, runs on 20 or later (its own `engines`) |
| Python 3 | `npm run serve` and `npm run dev`, which serve with `python3 -m http.server`; and the documentation | any Python 3 to serve; **3.11 or later** for the documentation |
| Google Chrome | `npm run test:browser`, `npm run bench`, `npm run icons`, `npm run docs:screenshots` | the system's, or `LA_GRAM_CHROME` ([Testing](testing.md#chrome)) |
| Docker | the container image only | any |

Node 22 and npm are not all you need to run la-gram locally: `npm run dev` stops without Python 3.

```console
$ node --version
v25.2.1
$ python3 --version
Python 3.14.0
```

## npm scripts

### `npm run build` {#npm-run-build}

All five webpack targets, in production mode: the web app, the desktop app's three parts and
la-gram-git.

```console
$ npm run build
…
  web (webpack 5.105.4) compiled with 2 warnings in 20490 ms
  electron-main (webpack 5.105.4) compiled successfully in 12483 ms
  electron-preload (webpack 5.105.4) compiled successfully in 11504 ms
  electron-renderer (webpack 5.105.4) compiled with 2 warnings in 21494 ms
  la-gram-git (webpack 5.105.4) compiled successfully in 15290 ms
```

The two warnings are webpack's size hints, against its 244 KiB recommendation: one names the assets
over it, the WebAssembly (3.86 MiB), the main bundle (2.12 MiB) and ArchiMate 3.2's relationship
shapes (1.24 MiB); the other the entry point (2.12 MiB). Expected, and harmless.

### `npm run build:web` {#npm-run-build-web}

The web app alone, in production mode, into `dist/web/` ([web output](#web-output)). This is what the
release deploys.

```console
$ npm run build:web
…
  web (webpack 5.105.4) compiled with 2 warnings in 10431 ms
$ ls dist/web
3af2f08a210aab7ebadd.wasm
599.56d894bd.js
…
assets
bundle.84052483.js
bundle.84052483.js.LICENSE.txt
bundle.84052483.js.map
diagram-js.css
docs
favicon.ico
favicon.svg
git.29feaea7.js
git.29feaea7.js.map
index.html
```

### `npm run build:cli` {#npm-run-build-cli}

la-gram-git, into `packages/la-gram-git/` ([la-gram-git output](#la-gram-git-output)). Then run it from
there:

```console
$ npm run build:cli
…
  la-gram-git (webpack 5.105.4) compiled successfully in 3224 ms
$ node packages/la-gram-git/dist/la-gram-git.js --version
0.1.0
```

### `npm run build:electron` {#npm-run-build-electron}

The desktop app's main process, preload and renderer, into `dist/electron/`. `npm run electron` runs the
result; `npm run package` builds it first.

```console
$ npm run build:electron
…
  electron-main (webpack 5.105.4) compiled successfully in 7643 ms
  electron-preload (webpack 5.105.4) compiled successfully in 6864 ms
  electron-renderer (webpack 5.105.4) compiled with 2 warnings in 14219 ms
```

### `npm run build:dev` {#npm-run-build-dev}

All targets in development mode ([mode](#mode)): unminified, with inline source maps. Name one target
after `--`:

```console
$ npm run build:dev -- --config-name web
> webpack --mode development --config-name web
  web (webpack 5.105.4) compiled successfully in 3857 ms
```

A development build of `dist/web` is not one to deploy. Rebuild with `npm run build:web` before
`npm run test:browser` or `npm run docs:screenshots`.

### `npm run serve` {#npm-run-serve}

Serves `dist/web/` on port **8080** with `python3 -m http.server 8080 --directory dist/web`, which
**needs Python 3**. It builds nothing: build first. It serves the documentation too, at `/docs/`, once
`npm run docs:build` has run. Python's server sends `.wasm` as `application/wasm` and `.ttl` as
`text/turtle`.

When port 8080 is taken, run the same server on another:

```console
$ python3 -m http.server 41238 --directory dist/web
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:41238/docs/
200 text/html
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:41238/3af2f08a210aab7ebadd.wasm
200 application/wasm
```

### `npm run dev` {#npm-run-dev}

A development build of the web app, then `npm run serve`: http://localhost:8080. `npm start` does
exactly the same. Rebuild by running it again; there is no watch mode. Both need Python 3 for the
serving half. In `package.json`:

```text
"start": "npm run build:dev -- --config-name web && npm run serve",
"dev": "npm run build:dev -- --config-name web && npm run serve",
```

With port 8080 taken, run the two halves, [`build:dev`](#npm-run-build-dev) and the server on another
port, [as above](#npm-run-serve).

Open http://localhost:8080/?model=docs/examples/shop.ttl for the example model, after
`npm run docs:build`.

### `npm run electron` {#npm-run-electron}

Runs the desktop app from `dist/electron/main.cjs`, unpackaged, after `npm run build:electron`. On macOS
its Dock icon is la-gram's.

```console
$ npm run build:electron && npm run electron
…
> electron dist/electron/main.cjs
```

In a terminal of VS Code, see [ELECTRON_RUN_AS_NODE](#env-electron-run-as-node).

### `npm run package` {#npm-run-package}

`npm run build:electron`, then `scripts/package-electron.mjs`: the desktop app, ready to run, in
`dist/packages/la-gram-<platform>-<arch>/`.

| Option | Values | Default |
|---|---|---|
| `--platform` | `darwin`, `win32`, `linux` | **this machine's** |
| `--arch` | `x64`, `arm64` | **this machine's** |

What the packager is told, every time:

| Setting | Value |
|---|---|
| contents | `package.json` and `dist/electron/`, without `.map` files, in an `asar` archive; no sources, tests or `node_modules` |
| app name and version | `la-gram`, the version in `package.json` |
| Electron | the version installed in `node_modules` |
| icon | `src/icons/app-icon.icns` (macOS), `.ico` (Windows); the window's icon on Linux |
| macOS bundle id and category | `archi.linked.la-gram`, `public.app-category.developer-tools` |
| Windows metadata | company *Linked.Archi*, product *la-gram*, description *la-gram — Semantic Modeller for Enterprise and IT Architecture* |
| signing | none: the macOS app keeps Electron's ad-hoc signature; the release re-signs it ad hoc ([Releasing](releasing.md#desktop-apps)) |

The Electron runtime for the target comes from the cache `npm ci` filled, or is downloaded once. Another
platform's app is built the same way, off that platform.

```console
$ npm run package
…
Packaged: dist/packages/la-gram-darwin-arm64
$ /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' dist/packages/la-gram-darwin-arm64/la-gram.app/Contents/Info.plist
archi.linked.la-gram
```

The target named after `--`, here this machine's own, spelled out; `--platform win32 --arch x64` builds
the Windows app the same way:

```console
$ npm run package -- --platform darwin --arch arm64
…
Packaged: dist/packages/la-gram-darwin-arm64
```

## Build switches

### `LA_GRAM_GIT` {#env-la-gram-git}

`LA_GRAM_GIT=off` leaves Git storage out of the build: the module is not in the bundle, its chunk
(`git.<hash>.js`) is not written, and nothing in the app offers it. **Any other value, or none, keeps
it.** It applies to every target that bundles the app: web, desktop renderer and la-gram-git.

```console
$ LA_GRAM_GIT=off npm run build:web
…
$ ls dist/web | grep '^git\.' || echo "no git.* chunk"
no git.* chunk
$ npm run build:web
$ ls dist/web | grep '^git\.'
git.29feaea7.js
git.29feaea7.js.map
```

To turn Git storage off without rebuilding, use the deployment's `modules.git`
([configuration](../reference/configuration.md#modules)).

### `LA_GRAM_CONFIG` {#env-la-gram-config}

`LA_GRAM_CONFIG=<file>` copies that JSON file into the build as `la-gram.config.json`, beside
`index.html`, in the web build and in the desktop renderer, and so into `npm run package`'s app. The
file is copied as it is; the app checks it when it starts
([Deployment configuration file](../reference/configuration.md)). Without it, the build has no
configuration file.

```console
$ LA_GRAM_CONFIG=deploy/acme.json npm run build:web
…
$ ls dist/web | grep config
la-gram.config.json
```

The run above used a scratch file with a Git host list and a default folder; `cmp` found the copy
identical.

### `__LA_GRAM_ASSETS_VERSION__` {#assets-version}

A digest of every file under `assets/` (names and contents), 12 hex digits, made at build time. la-gram
adds it to every bundled asset's address as `?v=`, so that a browser never draws a cached icon or
metamodel after the bundle changed, and keeps them while it did not. *About la-gram* shows it as
*Bundled metamodels snapshot …*, and *Copy version info* includes it.

```text
/assets/archimate4/icons/business-actor.svg?v=e4882df07d49
```

### `__LA_GRAM_BUILD__` {#build-info}

la-gram's version, from `package.json`, and the main components it is built with, each with the version
and licence its own package states, for *About la-gram*'s *Built with*. The desktop build adds Electron.
From this build:

```text
{version:"0.1.0",components:[{name:"diagram-js",version:"14.11.3",license:"MIT"},{name:"oxigraph",version:"0.5.11",license:"MIT OR Apache-2.0"},{name:"n3",version:"2.13.12",license:"MIT"},{name:"rdf-validate-shacl",version:"0.5.10",license:"MIT"},{name:"lit",version:"3.3.2",license:"BSD-3-Clause"},{name:"@codemirror/view",version:"6.39.17",license:"MIT"},{name:"cytoscape",version:"3.34.3",license:"MIT"},{name:"d3-force",version:"3.0.1",license:"ISC"},{name:"yjs",version:"13.6.33",license:"MIT"},{name:"@hocuspocus/provider",version:"4.7.0",license:"MIT"}]}
```

### `--mode` {#mode}

webpack's mode, which every script sets:

| Value | Source maps | Used by |
|---|---|---|
| `production` | separate `.map` files, shipped beside the bundles | `build`, `build:web`, `build:cli`, `build:electron`, the release |
| `development` | inline (`eval-source-map`), faster to build | `build:dev`, `dev`, `start` |

The difference shows in `dist/web`: the production build has a `.map` beside each bundle, the
development build none.

```console
$ npm run build:web && ls dist/web | grep -c '\.map$'
…
5
$ npm run build:dev -- --config-name web && ls dist/web | grep -c '\.map$'
…
0
```

### `--config-name` {#targets}

Which of the five targets to build; name several by repeating it. Without it, all five.

| Name | Entry | Output |
|---|---|---|
| `web` | `src/index.ts` | `dist/web/` |
| `electron-main` | `src/electron-main.ts` | `dist/electron/main.cjs`, `app-icon.png` |
| `electron-preload` | `src/electron-preload.ts` | `dist/electron/preload.cjs` |
| `electron-renderer` | `src/index.ts` | `dist/electron/renderer/` |
| `la-gram-git` | `src/cli/bin.ts` | `packages/la-gram-git/dist/la-gram-git.js` |

```sh
npx webpack --mode production --config-name electron-main --config-name electron-preload
```

## Outputs

### The web app {#web-output}

`dist/web/`, which is cleaned on each build **except its `docs/` folder**, where `npm run docs:build`
writes the documentation:

| File | Is |
|---|---|
| `index.html` | the page |
| `bundle.<8 hex>.js` and chunks `<name>.<8 hex>.js` | the app, named by content; `git.<8 hex>.js` is Git storage |
| `<hex>.wasm` | Oxigraph, the RDF store |
| `*.map` | source maps, shipped |
| `assets/` | the bundled metamodels ([below](#bundled-assets)) |
| `diagram-js.css`, `favicon.svg`, `favicon.ico` | the canvas's stylesheet and the icons |
| `la-gram.config.json` | only with `LA_GRAM_CONFIG` |
| `docs/` | the documentation, kept across builds |

The documentation built first survives a later app build:

```console
$ npm run docs:build && npm run build:web && test -f dist/web/docs/index.html && echo kept
…
kept
```

### Bundled assets {#bundled-assets}

`assets/` is copied into the web build, the desktop renderer and la-gram-git as it is, with the same
layout as meta.linked.archi's published tree, files starting with `.` left out. It is what la-gram uses
offline and first ([`assets`](../reference/url-parameters.md#assets)), and what
[Bundled metamodels and icons](assets.md) refreshes.

Every build replaces the generated asset copy. In la-gram-git's package, `assets/` is beside `dist/`,
so the build cleans that generated folder explicitly before copying; a semantic file removed from
the source snapshot must also disappear from the package.

```console
$ ls dist/web/assets
archimate3	catalog.ttl
archimate4	core
basic		core-vis
```

### la-gram-git {#la-gram-git-output}

`packages/la-gram-git/dist/la-gram-git.js`, an ES module for Node 20 or later, unminified, with its
dependencies left as imports for npm to install. The build also copies `assets/`, `ci/` and `LICENSE`
beside it, since la-gram-git reads the bundled metamodels and the CI templates from there. All of it is
git-ignored; `npm pack` packs it ([Container image](../operating/container-image.md#build-it-yourself)).

```console
$ ls packages/la-gram-git
Dockerfile	dist
LICENSE		docs
README.md	package.json
assets		smoke
ci
```

## Environment for Electron

### `ELECTRON_SKIP_BINARY_DOWNLOAD` {#env-electron-skip-binary-download}

`ELECTRON_SKIP_BINARY_DOWNLOAD=1` told older Electron packages to skip downloading their binary at
`npm ci`. la-gram's CI sets it for every job, since no job runs Electron, and `npm run package`
downloads each target's Electron itself. **With Electron 44 it changes nothing**: Electron no longer
downloads at install, but the first time it runs (`npm run electron`, the browser suite's Electron
test), and `node node_modules/electron/install.js` fetches it on purpose. Both installs below gave the
same 422 packages and no Electron binary until it was first asked for:

```console
$ ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
…
added 422 packages, and audited 423 packages in 2s
$ npm ci
…
added 422 packages, and audited 423 packages in 2s
$ node -e "console.log(require('electron'))"
Downloading Electron binary...
…/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
```

The two installs ran in scratch copies of `package.json` and `package-lock.json`, not in the checkout.

### `ELECTRON_RUN_AS_NODE` {#env-electron-run-as-node}

**Must be unset.** Set, Electron starts as plain Node, and the desktop app fails at once. VS Code sets
it in its terminals: run the app with it unset there.

```console
$ ELECTRON_RUN_AS_NODE=1 npm run electron
…
TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')
…
$ env -u ELECTRON_RUN_AS_NODE npm run electron
> electron dist/electron/main.cjs
```
