---
title: Bundled metamodels and icons
description: Use the kernel's pinned metamodel snapshot and render la-gram's application icons.
---
# Bundled metamodels and icons

The installed `@linked-archi/kernel` package owns the bundled semantic assets: ArchiMate 4.0 and 3.2,
Basic, the core vocabularies, icons, markers and the catalogue. They are in
`node_modules/@linked-archi/kernel/assets/`. The web app uses this snapshot first; the desktop app and
la-gram-git use it alone ([asset modes](../reference/url-parameters.md#assets)). Every build copies the
installed snapshot into its output `assets/` directory.

A catalogue entry does not mean the language is bundled offline. Other languages, including LeanIX,
load by IRI when selected. Uploaded documents and the chosen asset mode work through the same kernel
loader. Reopen the application to refresh documents already held in a session.

## Updating the snapshot {#updating-the-snapshot}

Refresh and qualify assets in the **linked-archi-kernel repository**, following its development guide.
Its asset synchronizer is the only implementation. la-gram takes an updated kernel package; it does
not maintain or edit a second source snapshot.

Until registry publication, put the kernel's packed archive in `vendor/` and install it as a file
package. For the current package:

```sh
npm install ./vendor/linked-archi-kernel-0.1.0.tgz
npm run typecheck
npm test
npm run build
npm run test:browser
```

Commit the archive, dependency manifest and lockfile together. The workspace must use the same qualified
archive for the two-tool gate. Install the archive, not a link to the kernel checkout: a linked checkout
can resolve a second instance of n3 or Oxigraph. `kernel-package.test.ts` checks dependency identity and
asset ownership.

### Building the snapshot {#building-the-snapshot}

Builds copy the installed package's assets without fetching updates. Their `?v=` digest is computed
from that same package's file names and contents ([Building](building.md#assets-version)). Changing
the package's assets changes the digest. Each output replaces its generated asset copy, removing
files the new package no longer contains.

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
