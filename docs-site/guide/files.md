---
title: Files, import and export
description: How la-gram opens and saves model files in six RDF formats, saves without diagram geometry, imports ArchiMate Exchange files and exports a view as SVG or PNG.
---
# Files, import and export

A model is a file of RDF: Turtle by default, or any of five other formats. la-gram does not save on its
own; the *File* menu opens and saves, imports an ArchiMate Exchange file, and exports the open diagram
as a picture. In the browser, a file opens from your computer and saves as a download. What is in the
file, its graphs and its vocabulary, is in [File formats and vocabulary](../reference/file-formats.md).

## Open {#open}

*File › Open…* opens a model file: `.ttl`, `.trig`, `.jsonld`, `.nq`, `.nt` or `.rdf`. It replaces the
open model, after asking ([Unsaved changes](#unsaved-changes)), and says what it did: *Opened
shop.ttl: 192 triples.*, with how many elements it laid out when the file had no geometry, and whether an
older vocabulary was migrated. Metamodels the file declares that could not be loaded are named
(*Could not load: …*).

A file of RDF that is not a la-gram model is opened too: la-gram adopts its model resource, its
membership and a view. When no view has diagram geometry, every element is placed on the first diagram
with the relationships between them, laid out as [*Arrange view*](canvas.md#arrange-view) lays a diagram
out, with the choices last made there; when that layout cannot be used, in a grid, and the message says
why.

1. Choose *File › Open…*.
2. Choose [shop.ttl](../examples/shop.ttl), saved from this site. The diagram opens.

## Save {#save}

*File › Save* saves the model as Turtle, named after the model: `Acme-online-shop.ttl`. In the browser it
is a download, where the browser saves them. Saved, the ● after the model's name goes, and the title's •.
The file holds the model and its diagrams, as the RDF panel's *Model* shows them:

```turtle
@prefix arch: <https://meta.linked.archi/core#> .
@prefix am4: <https://meta.linked.archi/archimate4/onto#> .
@prefix am4mm: <https://meta.linked.archi/archimate4/metamodel#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix m: <https://example.org/acme/shop/> .

m:model a arch:Model ;
    skos:prefLabel "Acme online shop"@en ;
    arch:modelConformsToMetamodel am4mm:ArchiMate4 .

m:web-shop a am4:ApplicationComponent ;
    skos:prefLabel "Web shop"@en ;
    am4:realizes m:online-ordering ;
    arch:inModel m:model ;
    arch:inView m:view-service-realization .
```

1. Choose *File › Save*.
2. The file is in your downloads, and the title loses its •.

## Save as {#save-as}

*File › Save as …* saves in another format, the extension after each entry:

| Entry | File |
|---|---|
| *Save as TriG (graph per layer)* | `.trig`: three graphs, the model resource, its semantics (elements, relationships, views) and its diagram geometry |
| *Save as JSON-LD* | `.jsonld`, with the graphs |
| *Save as N-Quads* | `.nq`, with the graphs |
| *Save as N-Triples* | `.nt` |
| *Save as RDF/XML* | `.rdf` |

Each opens again with *File › Open…*.

1. Choose *File › Save as* N-Triples.
2. `Acme-online-shop.nt` has one statement a line:

```text
<https://example.org/acme/shop/web-shop> <http://www.w3.org/2004/02/skos/core#prefLabel> "Web shop"@en .
```

## Save without diagram geometry {#save-without-geometry}

*File › Save without diagram geometry* saves Turtle without the diagram geometry, the `arch-vis:` nodes,
links, bounds and routes: `Acme-online-shop.no-geometry.ttl`. The views stay, as views with their
members (`arch:inView`); only the coordinates go. It is the file to hand to a pipeline that reasons over
the architecture and has no use for layout. Opened again, its diagrams are laid out afresh: *Opened
Acme-online-shop.no-geometry.ttl: 112 triples, 8 elements laid out.*

1. Choose *File › Save without diagram geometry*.
2. Open the file in a text editor: no `arch-vis:ArchNode`.

## Import ArchiMate exchange {#import-archimate-exchange}

*File › Import ArchiMate exchange…* reads an ArchiMate Model Exchange File (`.xml`), the format every
ArchiMate tool writes, Archi, BiZZdesign and Sparx among them. It is a 3.x format, so it is read as
**ArchiMate 3.2**, which la-gram bundles for this, and replaces the open model after asking.

| In the exchange file | In la-gram |
|---|---|
| elements and relationships | ArchiMate 3.2 elements and relationships (an access's read or write kind, a directed association) |
| names, documentation, properties | names, definitions, and properties under the model's namespace |
| diagrams, their viewpoints | diagram views, with their viewpoint when it resolves |
| nodes, nested ones | placements, nested |
| connections and their bendpoints | lines, with their routes |
| styles | each placement's look: fill and line colours, line width, font |
| groups and notes, and the lines from them | groups, notes and lines from figures |
| folders | not imported: convert the file with `archimate2linkedarchi` to keep them |

It says what it imported (*Imported … elements, … relationships, … views.*), and names the types it
skipped (*Skipped unknown types: …*): types the ArchiMate 3.2 ontology does not define are reported, not
invented.

1. Export the model from Archi in the Open Exchange format, as an `.xml` file.
2. In la-gram, choose *File › Import ArchiMate exchange…*, and choose the `.xml` file.
3. The model opens in ArchiMate 3.2, its diagrams as they were drawn, with their colours.

## Export view as SVG or PNG {#export-svg-png}

*File › Export view as SVG* and *Export view as PNG*, also in the empty canvas's right-click menu, save
the open diagram as a picture, named after the view: `How-the-shop-serves-its-customers.svg`.

| | SVG | PNG |
|---|---|---|
| what | the diagram, **cropped** to what is drawn | the same, as pixels |
| size | as drawn | twice as drawn, so it is sharp on a high-density screen, in a document or a slide; made smaller when it would be over **16 384 px** a side or 120 million pixels |
| glyphs and pictures | in the file, so it shows them wherever it is opened | in the file |
| a picture its site does not let la-gram read (no CORS) | linked, and named in a message | left out, and named in a message |

Only a diagram exports: with a catalog or matrix open, la-gram says *Open a diagram view to export it.*

1. Open "How the shop serves its customers".
2. Choose *File › Export view as PNG*. `How-the-shop-serves-its-customers.png` is saved, at twice the
   size drawn.

## Unsaved changes {#unsaved-changes}

*File › New model*, *Open…* and *Import ArchiMate exchange…* replace the open model. With changes not
saved, each asks first, in *Unsaved changes*: *The model has unsaved changes. Open another model anyway?*
Its button says what it will do: *Start a new model*, *Open another model* or *Import*; *Cancel* keeps
the model. In a collaboration room, *Shared model* asks instead
([Collaboration](collaboration.md#replacing-a-shared-model)).

Closing the browser tab with changes not saved asks too, in the browser's own words. The desktop app asks
in its own dialog ([Desktop app](../getting-started/desktop.md#unsaved-changes)).

1. Change the model, then choose *File › Open…*.
2. *Unsaved changes* asks: choose *Cancel*, then *File › Save*, then *File › Open…* again.
