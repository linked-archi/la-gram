---
title: In the browser
description: How to open la-gram in a browser, which browsers it needs, and the first URL parameters to try.
---
# In the browser

la-gram's web app is at **https://app.linked.archi/la-gram/**. Open it and it starts with an empty model
and ArchiMate 4.0 loaded: nothing to install, no account.

## Browsers

la-gram runs in a current desktop browser: its RDF store is [Oxigraph](https://github.com/oxigraph/oxigraph)
compiled to WebAssembly, and validation runs in a Web Worker. Its own browser tests run in Google Chrome.
The toolbar fits from a window 1100 px wide.

*About la-gram*, in la-gram's menu (the icon and name at the top left), says which browser and version it
is running in, and *Copy version info* copies that line for a problem report.

## The example model

The Acme online shop is a small ArchiMate 4.0 model: a customer, the process of placing an order, the
services behind it and the applications that realize them. Open it with this link:

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl
```

The model opens in its diagram view, "How the shop serves its customers", beside a catalog view,
"Who is who". One of its services, "Gift wrapping", is realized by nothing on purpose, so that the
[Validation tab](../guide/validation.md) has a warning to show.

The file itself is [shop.ttl](../examples/shop.ttl), as la-gram saves it.

## First URL parameters

Parameters after the `?` set how la-gram starts. They combine with `&`.

| Parameter | What it does |
|---|---|
| `model` | opens a model file by its address: relative to the app, or on another site that allows it (CORS) |
| `rdf=1` | starts with the RDF panel open, beside the canvas |
| `assets` | where metamodels come from: **`bundled-first`**, `remote-first` or `offline` |
| `metamodel` | the metamodel to load in place of ArchiMate 4.0, by its IRI; a `#` in it written `%23` |
| `base` | where new models' namespaces start, `https://example.org/` by default |

The example model with the RDF panel open, to see the model as Turtle beside its diagram:

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&rdf=1
```

la-gram with nothing fetched from meta.linked.archi, only what it bundles:

```text
https://app.linked.archi/la-gram/?assets=offline
```

ArchiMate 3.2 instead of 4.0:

```text
https://app.linked.archi/la-gram/?metamodel=https://meta.linked.archi/archimate3/metamodel%23ArchiMate3.2
```

New models under your own namespace, here Acme's:

```text
https://app.linked.archi/la-gram/?base=https://example.org/acme/
```

A model the app cannot fetch (a wrong address, or a site that does not allow it) does not open, and the
reason is in the browser's console only. Every parameter, the collaboration and Git ones included, is in
[URL parameters](../reference/url-parameters.md).

## Leaving with unsaved changes

The model is kept in the page, not on a server, and la-gram does not save it on its own. With changes not
saved, closing the tab or reloading asks first. Save with *File › Save*, or
[in Git](../guide/git.md). In a collaboration room, the room keeps the model and nothing is asked.
