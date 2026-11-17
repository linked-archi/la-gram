---
title: Bundled metamodels and icons
description: Refresh la-gram's bundled semantic assets from meta.linked.archi or a local checkout, and render its application icons.
---
# Bundled metamodels and icons

`assets/` holds a snapshot of what meta.linked.archi serves: ArchiMate 4.0 and 3.2, la-gram's Basic
metamodel, the Linked.Archi core vocabularies, their icons and markers, and the catalogue
(`assets/catalog.ttl`) that the *Metamodels* menu offers. The web app uses it first, the desktop app and
la-gram-git use it alone ([`assets`](../reference/url-parameters.md#assets)), and every build copies it
as it is ([Building](building.md#bundled-assets)). Everything in it is meta.linked.archi's: do not edit
it by hand.

LeanIX and other languages outside this snapshot load from meta.linked.archi when selected. Their
documents are fetched with HTTP revalidation and kept in memory for that session. After publishing
new resources, reopen la-gram to load them again. Listing a language in the bundled catalogue does
not mean its semantic documents are bundled for offline use.

## `npm run sync-assets` {#npm-run-sync-assets}

Refreshes `assets/` from **https://meta.linked.archi/** by default. No local meta checkout is required.
The published files are copied byte for byte into the snapshot:

- Turtle documents from `<their namespace's path>/ontology.ttl`, using the namespace in the bundled
  copy (`vann:preferredNamespaceUri`, else `@prefix :`, else `@base`);
- icons, glyphs and markers from their paths relative to the published site;
- the catalogue from `https://meta.linked.archi/catalog.ttl`.

The online sync also downloads newly referenced icons within folders already bundled, discovered
from the notation documents it downloads. It refreshes the bundled languages; it does not add every
language listed in the catalogue or discover new Turtle dependencies.

```sh
npm run sync-assets -- --check
npm run sync-assets
npm run build
```

`--check` compares with the selected source without changing files. An online request that fails
fails the sync: there is no fallback to a local checkout or a successful result based on the old
snapshot. Every required download is staged before the snapshot is changed, so a network failure
leaves `assets/` intact.

### Choosing a source {#sync-source}

| Option | Values | Default |
|---|---|---|
| `--check` | compare only; change nothing | **off**: update `assets/` |
| `--meta <path>` | explicitly use a `linked-archi-meta` checkout | **unset**: use the published site |
| `LINKED_ARCHI_META=<path>` | select a local checkout from the environment; `--meta` takes precedence | **unset**: use the published site |
| `--online` | use the published site even when `LINKED_ARCHI_META` is set | **off**: honour an explicit local source |
| `--help`, `-h` | show usage without syncing | **off** |

`--online` and `--meta` are alternative source choices; passing both is a usage error.

To work with an unpublished meta checkout:

```sh
npm run sync-assets -- --meta ../../../linked-archi-meta
```

Local mode runs that checkout's publishing scripts (`.scripts/copy-ttl-sources.sh` and
`.scripts/copy-icon-assets.sh`) into a temporary folder, then copies the bundled files from their
published paths. New files in a bundled icon folder are included. The catalogue comes from the
checkout's last generated site, `.onto-docs/catalog.ttl`; run `.scripts/docgen/generate-docs.sh` in
that checkout first for a current full catalogue. When the generated catalogue is missing, the
bundled catalogue is kept and the run reports it. A successful local `--check` compares with the
checkout's generated files; it does not establish that its catalogue reflects the current sources.

To select the published site despite an environment override:

```sh
LINKED_ARCHI_META=../../../linked-archi-meta npm run sync-assets -- --online --check
```

| Exit code | Means |
|---|---|
| **0** | updated successfully; with `--check`, nothing differs |
| **1** | `--check` found differences or missing files, or an online request failed |
| **2** | invalid arguments or an unavailable local checkout |

### Building the snapshot {#building-the-snapshot}

After an update, rebuild (`npm run build`) to ship it. Each build's `?v=` digest of `assets/` changes
with the snapshot, so browsers load the new files ([Building](building.md#assets-version)). Builds
copy the snapshot as it stands and do not run the sync command automatically.

## `npm run icons` {#npm-run-icons}

Renders la-gram's own icons from their SVGs, with Chrome (the system's, or `LA_GRAM_CHROME`), after
`src/icons/favicon.svg` or `src/icons/app-icon.svg` changed. Every file it writes is kept in the
repository, beside its SVG:

| File | From | For |
|---|---|---|
| `favicon.ico` | the mark, at 16, 32 and 48 px | browsers that take no SVG favicon, and whatever asks for `/favicon.ico` |
| `app-icon.icns` | the mark on a tile; the bare mark at 32 px and less | the macOS app, in `npm run package` |
| `app-icon.ico` | the same | the Windows app |
| `app-icon.png` | the tile, 512 px | the window's icon on Windows and Linux, and the Dock's while the app runs unpackaged on macOS |

It overwrites those four files: review the change with `git diff --stat src/icons` before committing.

```sh
npm run icons
git diff --stat src/icons
```

The documentation's logo, `docs-site/assets/images/la-gram.svg`, is a copy of `src/icons/favicon.svg`;
copy it again when the mark changes ([Writing the documentation](documentation.md#the-logo)).
