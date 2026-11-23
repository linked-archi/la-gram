---
title: Files, import and export
description: How la-gram opens and saves model files in six RDF formats, saves without diagram geometry, imports ArchiMate Exchange files, and exports a view as SVG or PNG or copies it to the clipboard.
---
# Files, import and export

A model is a file of RDF: TriG by default, or any of five other formats. la-gram does not save on its
own; the *File* menu opens and saves, imports an ArchiMate Exchange file, and exports the open diagram
as a picture, to a file or to the clipboard. In the browser, a file opens from your computer and saves as
a download. What is in the file, its graphs and its vocabulary, is in
[File formats and vocabulary](../reference/file-formats.md).

## The File menu {#file-menu}

The *File* menu is in sections, each entry with its icon:

| Section | Entries |
|---|---|
| opening | *New model*, *Open…* (++ctrl+o++), *Import ArchiMate exchange…* |
| saving | *Save* (++ctrl+s++, TriG), *Save as ▸* with each format, *Git ▸* with Git storage's entries ([Git](git.md#file-menu)) |
| the open view | *Export view ▸*: *Save as SVG…*, *Save as PNG…*, *Copy as PNG*, *Copy as SVG* |
| settings | *Model settings…*, *Settings…* |

A submenu (▸) opens when the pointer is over its entry, or on a click; with the keyboard, ++arrow-right++
or ++enter++ opens it at its first entry and ++arrow-left++ or ++esc++ closes it. On a Mac the keys are
++cmd+o++ and ++cmd+s++ ([Keyboard and mouse](../reference/keyboard.md#files)).

1. Open *File*, and point at *Save as*: the six formats, then *Turtle without diagram geometry*.
2. Point at *Export view*: the open diagram to a file or to the clipboard.

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

1. Choose *File › Open…*, or press ++ctrl+o++.
2. Choose [shop.ttl](../examples/shop.ttl), saved from this site. The diagram opens.

## Save {#save}

*File › Save*, or ++ctrl+s++ (++cmd+s++ on a Mac), saves the model as **TriG**, named after the model:
`Acme-online-shop.trig`. In the browser it is a download, where the browser saves them. Saved, the ● after
the model's name goes, and the title's •. TriG keeps the model in its [graphs](../reference/file-formats.md#graphs):
the model resource, its semantics — elements, relationships, views — the diagram geometry, which a
pipeline can drop on its own, and who changed what and when ([Last changed](properties.md#last-changed)).
The example model, abridged:

```trig
@prefix arch: <https://meta.linked.archi/core#>.
@prefix arch-vis: <https://meta.linked.archi/core-vis#>.
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.
@prefix am4mm: <https://meta.linked.archi/archimate4/metamodel#>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix m: <https://example.org/acme/shop/>.
@prefix mg: <https://example.org/acme/shop/graph/>.

mg:model {
m:model a arch:Model;
    skos:prefLabel "Acme online shop"@en;
    arch:modelConformsToMetamodel am4mm:ArchiMate4
}
mg:semantic {
m:web-shop a am4:ApplicationComponent;
    skos:prefLabel "Web shop"@en;
    am4:qualifiedRealization m:web-shop-realizes-online-ordering;
    am4:realizes m:online-ordering;
    arch:inModel m:model;
    arch:inView m:view-service-realization.
}
mg:views {
m:link-card-payment-serves-web-shop a arch-vis:Link;
    arch-vis:archRelationship m:card-payment-serves-web-shop;
    arch-vis:source m:node-card-payment;
    arch-vis:target m:node-web-shop;
    arch-vis:view m:view-service-realization.
}
```

A field you are typing in when you press ++ctrl+s++ is left first, so what it holds is saved too.

1. Change the model, and press ++ctrl+s++.
2. `Acme-online-shop.trig` is in your downloads, and the title loses its •.

## Save as {#save-as}

*File › Save as ▸* saves in another format, the extension after each entry:

| Entry | File |
|---|---|
| *Turtle* | `.ttl`: one graph, the four together; `arch:inModel` on every concept keeps membership clear |
| *TriG (graph per layer)* | `.trig`, as *Save* writes it |
| *JSON-LD* | `.jsonld`, with the graphs |
| *N-Quads* | `.nq`, with the graphs |
| *N-Triples* | `.nt` |
| *RDF/XML* | `.rdf` |
| *Turtle without diagram geometry* | `.no-geometry.ttl` ([below](#save-without-geometry)) |

Each opens again with *File › Open…*.

1. Choose *File › Save as › N-Triples*.
2. `Acme-online-shop.nt` has one statement a line:

```text
<https://example.org/acme/shop/web-shop> <http://www.w3.org/2004/02/skos/core#prefLabel> "Web shop"@en .
```

## Save without diagram geometry {#save-without-geometry}

*File › Save as › Turtle without diagram geometry* saves Turtle without the diagram geometry, the
`arch-vis:` nodes, links, bounds and routes: `Acme-online-shop.no-geometry.ttl`. The views stay, as views
with their members (`arch:inView`); only the coordinates go. It is the file to hand to a pipeline that
reasons over the architecture and has no use for layout. Opened again, its diagrams are laid out afresh:
*Opened Acme-online-shop.no-geometry.ttl: 112 triples, 8 elements laid out.*

1. Choose *File › Save as › Turtle without diagram geometry*.
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
| a reference to another view (a `Label` with a `viewRef`) | a [view reference](canvas.md#view-references) to that view; a note when the file has no such view |
| folders | not imported: convert the file with `archimate2linkedarchi` to keep them |

It says what it imported (*Imported … elements, … relationships, … views.*), and names the types it
skipped (*Skipped unknown types: …*): types the ArchiMate 3.2 ontology does not define are reported, not
invented.

1. Export the model from Archi in the Open Exchange format, as an `.xml` file.
2. In la-gram, choose *File › Import ArchiMate exchange…*, and choose the `.xml` file.
3. The model opens in ArchiMate 3.2, its diagrams as they were drawn, with their colours.

## Export view as SVG or PNG {#export-svg-png}

*File › Export view › Save as SVG…* and *Save as PNG…*, also *Export view as SVG* and *Export view as PNG*
in the empty canvas's right-click menu, save the open diagram as a picture, named after the view:
`How-the-shop-serves-its-customers.svg`.

| | SVG | PNG |
|---|---|---|
| what | the diagram, **cropped** to what is drawn | the same, as pixels |
| size | as drawn | twice as drawn, so it is sharp on a high-density screen, in a document or a slide; made smaller when it would be over **16 384 px** a side or 120 million pixels |
| glyphs and pictures | in the file, so it shows them wherever it is opened | in the file |
| a picture its site does not let la-gram read (no CORS) | linked, and named in a message | left out, and named in a message |

Only a diagram exports: with a catalog or matrix open, la-gram says *Open a diagram view to export it.*

1. Open "How the shop serves its customers".
2. Choose *File › Export view › Save as PNG…*. `How-the-shop-serves-its-customers.png` is saved, at
   twice the size drawn.

## Copy view to the clipboard {#copy-view}

*File › Export view › Copy as PNG* and *Copy as SVG*, also *Copy view as PNG* and *Copy view as SVG* in the
empty canvas's right-click menu, put the open diagram on the clipboard, drawn as the export draws it, to
paste straight into a document, a slide, a chat or a drawing. la-gram says *Copied the view as PNG: paste
it where you want it.*

| | *Copy as PNG* | *Copy as SVG* |
|---|---|---|
| on the clipboard | a picture (`image/png`), twice as drawn | the drawing as vector (`image/svg+xml`) where the browser writes it, and its SVG markup as text |
| pastes into | anything that takes a pasted picture: documents, slides, chats, image editors | drawing tools that read SVG; a text editor gets the markup |
| glyphs and pictures | in the picture; one la-gram cannot read is left out, and named | in the markup; one la-gram cannot read is linked, and named |

The browser asks nothing for this: the click is the permission. A browser that cannot put a picture on the
clipboard says so (*This browser cannot put a picture on the clipboard: export the view as PNG
instead.*). Only a diagram copies: with a catalog or matrix open, la-gram says *Open a diagram view to
copy it.*

1. Open "How the shop serves its customers", and right-click the empty canvas.
2. Choose *Copy view as PNG*, then paste into a document: the diagram is there, as a picture.

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
