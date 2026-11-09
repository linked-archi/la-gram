---
title: Bundled metamodels and icons
description: How la-gram's bundled snapshot of meta.linked.archi is refreshed from a linked-archi-meta checkout, and how its icons are rendered.
---
# Bundled metamodels and icons

`assets/` holds a snapshot of what meta.linked.archi serves: ArchiMate 4.0 and 3.2, la-gram's Basic
metamodel, the Linked.Archi core vocabularies, their icons and markers, and the catalogue
(`assets/catalog.ttl`) that the *Metamodels* menu offers. The web app uses it first, the desktop app and
la-gram-git use it alone ([`assets`](../reference/url-parameters.md#assets)), and every build copies it
as it is ([Building](building.md#bundled-assets)). Everything in it is meta.linked.archi's: do not edit
it by hand.

## `npm run sync-assets` {#npm-run-sync-assets}

Refreshes `assets/` from a checkout of `linked-archi-meta`, the repository meta.linked.archi is published
from. It keeps no map of its own: it runs that checkout's own publishing scripts
(`.scripts/copy-ttl-sources.sh` and `.scripts/copy-icon-assets.sh`) into a temporary folder, a local
stand-in for the published site, then refreshes each bundled file from its published path:

- a `.ttl` file from `<its namespace's path>/ontology.ttl`, the namespace read from the bundled copy as
  the publishing script reads it (`vann:preferredNamespaceUri`, else `@prefix :`, else `@base`);
- anything else (icons, glyphs, markers) from the same relative path; new files in a bundled icon folder
  are added too;
- the catalogue from the checkout's last generated site, `.onto-docs/catalog.ttl`, because generating it
  takes minutes. Run `.scripts/docgen/generate-docs.sh` there first for a current one. Without it, the
  bundled catalogue stays, and the run says so.

| Option | Values | Default |
|---|---|---|
| `--check` | only report what differs; change nothing | off: update `assets/` |
| `--meta <path>` | the `linked-archi-meta` checkout | **`../../../linked-archi-meta`**, from la-gram's folder |
| `LINKED_ARCHI_META=<path>` | the same, from the environment; `--meta` wins over it | — |

| Exit code | Means |
|---|---|
| **0** | done; with `--check`, nothing differs |
| **1** | with `--check`: something differs or is missing |
| **2** | no checkout at the path: *No linked-archi-meta checkout at … (pass --meta <path> or set LINKED_ARCHI_META).* |

After an update, rebuild (`npm run build`) to ship it: each build's `?v=` digest of `assets/` changes
with it, so browsers load the new files ([Building](building.md#assets-version)).
`LINKED_ARCHI_META` and exit code 2 are not in the README; they are in the script.

What a check says today (the checkout's path shortened):

```console
$ npm run sync-assets -- --check

> la-gram@0.1.0 sync-assets
> node scripts/sync-assets.mjs --check

linked-archi-meta: …/linked-archi-meta
262 unchanged, 1 differ, 0 missing, 0 la-gram's own (not published by linked-archi-meta)
  differs  catalog.ttl  ←  .onto-docs/catalog.ttl
```

It exits 1: the checkout's generated catalogue differs from the bundled one. `npm run sync-assets` would
copy it into `assets/`, then a rebuild ships it.

The checkout named by the environment gives the same; a path with no checkout exits 2:

```console
$ LINKED_ARCHI_META=../../../linked-archi-meta npm run sync-assets -- --check
…
262 unchanged, 1 differ, 0 missing, 0 la-gram's own (not published by linked-archi-meta)
  differs  catalog.ttl  ←  .onto-docs/catalog.ttl
$ npm run sync-assets -- --check --meta /tmp/la-gram-docs-nowhere
…
No linked-archi-meta checkout at /tmp/la-gram-docs-nowhere (pass --meta <path> or set LINKED_ARCHI_META).
```

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
