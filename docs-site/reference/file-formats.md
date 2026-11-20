---
title: File formats and vocabulary
description: The RDF formats la-gram reads and writes, and the vocabulary its model files use.
---
# File formats and vocabulary

A la-gram model file is RDF: the model, its views and their layout, in the Linked.Archi vocabulary, in
whichever RDF format you choose. It holds only the model, never the metamodel, which is referred to by
its IRI. Any RDF tool can read it, and la-gram reads RDF that other tools wrote.

## Formats {#formats}

la-gram opens and saves models in six RDF formats. The format is chosen by the file's extension when a
file is opened, and by you when it is saved ([Files, import and export](../guide/files.md)).

| Format | Extension | Media type | Named graphs |
|---|---|---|---|
| Turtle | `.ttl` | `text/turtle` | no: one graph |
| **TriG** (the default) | `.trig` | `application/trig` | yes: a graph per layer |
| JSON-LD | `.jsonld` | `application/ld+json` | yes |
| N-Quads | `.nq` | `application/n-quads` | yes |
| N-Triples | `.nt` | `application/n-triples` | no |
| RDF/XML | `.rdf` | `application/rdf+xml` | no |

- **Default:** TriG. *File › Save* (++ctrl+s++) writes TriG, the model in its [graphs](#graphs); *File ›
  Save as ▸* writes it in any of the six, Turtle among them.
- **The file name** is the model's name with every run of characters other than letters, digits, `.`,
  `_` and `-` turned into `-`: "Acme online shop" is saved as `Acme-online-shop.trig`.
- **Turtle as la-gram writes it** has the same order, prefixes and layout every time, on any machine,
  so a text diff of two saves shows only what changed. The prefixes are the standard ones, then the
  metamodels' in order of their names (`am4:`, `am4mm:`, `am4vp:`), then the model's own (`m:`). `la-gram-git check` holds model files in Git to that form, and
  `la-gram-git fix` rewrites them into it ([la-gram-git](la-gram-git.md#fix)).
- **IRIs in the Linked.Archi layout**, as the converters write them — `{ns}element/{id}`, a shape
  `{view}#node-{id}` in its view's IRI, a part under its owner (a shape's `{view}#node-{id}-style`, an
  element's `{ns}element/{id}/name/…`) — are written in Turtle and TriG with the first of these that fits:
    1. a prefix per kind: the model's prefix and `e`, `r`, `v`, `f`, `d`, `doc`, `s` or `g`, for
       `element/`, `relationship/`, `view/`, `folder/`, `decision/`, `documentation/`, `stakeholder/`
       and `graph/`
       (`me:5`, and in TriG the graphs `mg:model`, `mg:semantic`, `mg:views`);
    2. a prefix per view, for a shape and its parts: the model's prefix, `v` and the first 8 hex characters
       of the SHA-256 of the view's IRI (`mve7282c35:node-5`, `mve7282c35:node-5-style`). What a local
       name cannot hold is escaped, a `/` as `\/`; a shape's name and its parts' have nothing to escape. A
       view keeps its prefix as other views come and go;
    3. relative to the model's namespace, which the file then names with `@base`
       (`<folder/Elements/item/5305a111ce38b42cb7c9>`, an item of a folder; `<view/SystemContext/node/5>`,
       a converter's older name for a shape);
    4. the whole IRI.

    A C4 model converted by `structurizr2linkedarchi`, given a fill colour in la-gram and saved:

    ```turtle
    @base <https://example.org/c4/bigbank/>.
    …
    @prefix me: <https://example.org/c4/bigbank/element/>.
    …
    @prefix mv: <https://example.org/c4/bigbank/view/>.
    @prefix mf: <https://example.org/c4/bigbank/folder/>.
    …
    @prefix mve7282c35: <https://example.org/c4/bigbank/view/Containers#>.
    …
    me:5 a c4:Container, arch:Element, arch:ModelConcept;
        dcterms:isPartOf mf:Elements;
    …
    <folder/Elements/item/5305a111ce38b42cb7c9> a <https://schema.org/ListItem>;
        <https://schema.org/item> me:5;
        <https://schema.org/position> 8.
    …
    mve7282c35:node-5 a arch-vis:ArchNode;
        arch-vis:archElement me:5;
        arch-vis:style mve7282c35:node-5-style;
        arch-vis:view mv:Containers.
    mve7282c35:node-5-style a arch-vis:Style;
        arch-vis:fillColor "#dae8fc".
    ```

    Where a loaded vocabulary already uses one of these prefixes for something else, it keeps it, and those
    IRIs are written by the next rule. The layout is meta's
    [IRI Minting](https://meta.linked.archi/docs/guide/iri-minting/) guide.
- **Comments** in a Turtle file are not kept: la-gram reads the triples and writes them anew.

The example model saved in each format, from the same session (`app.saveModel` in the built app):

```text
Acme-online-shop.ttl     text/turtle            9 287 characters
Acme-online-shop.trig    application/trig       9 431
Acme-online-shop.jsonld  application/ld+json   23 662
Acme-online-shop.nq      application/n-quads   41 987
Acme-online-shop.nt      application/n-triples 32 511
Acme-online-shop.rdf     application/rdf+xml   28 705
```

## Profiles {#profiles}

What part of the model a save writes.

| Profile | Writes | File name |
|---|---|---|
| **full** | the model, its views and their geometry: every box's place and size, every line's route | `<name>.<ext>` |
| no-geometry | the model and its views, without geometry: each view keeps the concepts it shows (`arch:inView`), only the coordinates go | `<name>.no-geometry.<ext>` |

- **Default:** full.
- *File › Save as › Turtle without diagram geometry* writes the no-geometry profile, in Turtle: the file to hand to a
  pipeline that reasons over the architecture and has no use for layout.
- **Opening a file without geometry** lays the diagram out in a grid, by type, six columns wide.

With the example model:

1. Open the example model, and choose *File › Save as › Turtle without diagram geometry*: the browser saves
   `Acme-online-shop.no-geometry.ttl`, which has `arch:inView` lines and no `arch-vis:ArchNode`.
2. Open that file with *File › Open…*: la-gram says *Opened Acme-online-shop.no-geometry.ttl: 112
   triples, 8 elements laid out.*

## Graphs {#graphs}

In a format that names graphs (TriG, N-Quads, JSON-LD), la-gram writes the model in three graphs, named in
the model's namespace `{ns}`:

| Graph | Holds |
|---|---|
| `{ns}graph/model` | the `arch:Model` resource: its name, namespace and the metamodels it conforms to |
| `{ns}graph/semantic` | the elements, the relationships, the views and what each view shows |
| `{ns}graph/views` | the geometry: nodes, links and their bounds, which can be dropped on its own |

- Turtle, N-Triples and RDF/XML cannot name graphs, so they hold the three together. `arch:inModel` on
  every concept keeps membership clear there.
- **On opening**, every statement goes into one graph, whichever graph it came in; the graphs are made
  again on saving.

The example model in TriG, abridged to one resource in each graph:

```trig
@prefix arch: <https://meta.linked.archi/core#>.
@prefix arch-vis: <https://meta.linked.archi/core-vis#>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.
@prefix am4mm: <https://meta.linked.archi/archimate4/metamodel#>.
@prefix m: <https://example.org/acme/shop/>.
<https://example.org/acme/shop/graph/model> {
m:model a arch:Model;
    skos:prefLabel "Acme online shop"@en;
    arch:modelConformsToMetamodel am4mm:ArchiMate4
}
<https://example.org/acme/shop/graph/semantic> {
m:web-shop a am4:ApplicationComponent;
    skos:prefLabel "Web shop"@en;
    am4:qualifiedRealization m:web-shop-realizes-online-ordering;
    am4:realizes m:online-ordering;
    arch:inModel m:model;
    arch:inView m:view-service-realization.
}
<https://example.org/acme/shop/graph/views> {
m:node-web-shop a arch-vis:ArchNode;
    arch-vis:archElement m:web-shop;
    arch-vis:bounds-h "55"^^xsd:double;
    arch-vis:bounds-w "120"^^xsd:double;
    arch-vis:bounds-x "240"^^xsd:double;
    arch-vis:bounds-y "280"^^xsd:double;
    arch-vis:view m:view-service-realization.
}
```

## The vocabulary {#vocabulary}

The terms a model file uses, from the Linked.Archi core
([`arch:`](https://meta.linked.archi/core#) and [`arch-vis:`](https://meta.linked.archi/core-vis#)) and
from the metamodel (here ArchiMate 4.0, `am4:`):

| Term | On | Says |
|---|---|---|
| `arch:Model` | the model resource, `{ns}model` | this is a model |
| `arch:modelConformsToMetamodel` | the model | the metamodel it follows, by IRI |
| `vann:preferredNamespaceUri`, `vann:preferredNamespacePrefix` | the model | its namespace and prefix, when they are not the model IRI's own |
| `skos:prefLabel` | anything | its name, per language |
| `arch:inModel` | every element, relationship and view | which model it belongs to |
| `arch:View`, with `arch:Diagram`, `arch:Catalog` or `arch:Matrix` | a view | a view, and its kind |
| `arch:viewConformsToViewpoint` | a view | its viewpoint |
| `arch:inView` | a concept | a view that shows it |
| `arch:source`, `arch:target` | a relationship | its two ends |
| `rdf:reifies` | a relationship | the plain triple it stands for, as an RDF 1.2 triple term |
| `arch-vis:ArchNode`, `arch-vis:Link` | geometry | a box in a diagram, a line in a diagram |
| `arch-vis:archElement`, `arch-vis:archRelationship` | a node, a link | what it draws |
| `arch-vis:bounds-x`, `-y`, `-w`, `-h` | a node | its place and size, as `xsd:double` |
| `arch-vis:view` | a node, a link | the diagram it is in |
| `arch:prefVisNotation`, `arch:altVisNotation` | an element | its own picture for every presentation; one for a presentation, a `schema:ImageObject` with its `schema:contentUrl` and `arch:inPresentationContext` |
| `arch-vis:style` | a node, a link | its own look: one for every presentation, and one for each (`arch:inPresentationContext` on the style). Among its values, the pictures: `arch-vis:image` inside it, at `arch-vis:imagePosition`; `arch-vis:iconSymbol`, a picture in place of its glyph, as its figure (`arch-vis:IconCentric`) or its badge (`arch-vis:ShapeWithBadge`); `arch-vis:useElementPicture true`, its element's picture there instead |

**Every relationship is written twice**: as the plain triple (`m:card-payment am4:serves m:web-shop`),
which any RDF tool can query, and as a relationship resource with its type, its ends and its own
properties. `rdf:reifies` links the two, and the element points to the resource
(`am4:qualifiedServing`). Every IRI la-gram makes is in the model's namespace, in the Linked.Archi layout —
`element/…`, `view/…`, a node `view/…#node-…` in its view — so the Turtle reads `me:…`, `mv:…`,
`mv3ef7da72:node-…`; a model saved before keeps its names (`m:element-…`, `m:node-…`) and is written as it
was. Opening a file keeps the two in step: a relationship
without `rdf:reifies` is given the triple its type's predicate names, and one whose triple names other ends
than its `arch:source` and `arch:target` is made to name its own, its predicate kept.

**A link written only as a triple** is a relationship once the file is open. A tool or a hand-written file
may state `m:card-payment am4:serves m:web-shop` and nothing more; la-gram gives it the resource, of the most
general type whose predicate it is (`am4:Serving`), named `relationship/` and the first 20 hex characters of
the SHA-256 of the triple's three IRIs, space-separated — the name the Linked.Archi derivation rules give it,
so opening the file again, or in another window of a shared room, makes no second one. A resource made for a
triple before, named `relationship-` and 40 hex characters, keeps its name. A triple of the inverse a vocabulary declares of a drawn
predicate (`ap:taskOfActivity`, of `ap:hasTask`) is the same link read the other way: its resource, and its
drawn triple, run the drawn way. A triple between something that is no concept of the model, or of a predicate
two unrelated types share, is left as it is. The file changes on the next save.

The Serving from *Card payment* to *Web shop*, as la-gram writes it:

```turtle
@prefix arch: <https://meta.linked.archi/core#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.
@prefix m: <https://example.org/acme/shop/>.
m:card-payment a am4:Service;
    skos:prefLabel "Card payment"@en;
    am4:qualifiedServing m:card-payment-serves-web-shop;
    am4:serves m:web-shop;
    arch:inModel m:model;
    arch:inView m:view-service-realization.
m:card-payment-serves-web-shop a am4:Serving;
    rdf:reifies <<(m:card-payment am4:serves m:web-shop)>>;
    arch:inModel m:model;
    arch:inView m:view-service-realization;
    arch:source m:card-payment;
    arch:target m:web-shop.
```

## RDF from other tools {#foreign-rdf}

A file with no `arch:Model` in it, written by another tool or by hand, opens too. la-gram adopts it:

- it makes a model resource in a new namespace under the [`base`](url-parameters.md#base), named after
  the file (`inventory.ttl` gives the model "inventory"), conforming to the metamodels loaded;
- it makes every element and view a member of the model (`arch:inModel`);
- it makes each link the file states only as a triple a relationship ([The vocabulary](#vocabulary));
- it gives the model a diagram view, *Default View*, when it has none;
- when no view has any geometry, it places every element in that view in a grid, by type, six columns
  wide, and draws the relationships among them;
- the triples it read stay as they are, and are saved with the model.

A file of two application components, from another tool:

```turtle
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix ex: <https://example.org/acme/inventory/>.
ex:web-shop a am4:ApplicationComponent; skos:prefLabel "Web shop"@en; am4:serves ex:warehouse.
ex:warehouse a am4:ApplicationComponent; skos:prefLabel "Warehouse"@en.
```

Opened as `inventory.ttl`, la-gram says *Opened inventory.ttl: 5 triples, 2 elements laid out.* Saved
again, the file has these new statements (the UUIDs, and the view's prefix, which is named after its IRI,
shortened to `…`):

```text
m:model a arch:Model;
    vann:preferredNamespacePrefix "m";
    vann:preferredNamespaceUri "https://example.org/archimate/…/";
    skos:prefLabel "inventory"@en;
    arch:modelConformsToMetamodel am4mm:ArchiMate4.
<https://example.org/acme/inventory/web-shop> … am4:qualifiedServing mr:e26428537a5663f1d196;
    arch:inModel m:model; arch:inView mv:….
mr:e26428537a5663f1d196 a am4:Serving;
    rdf:reifies <<(<https://example.org/acme/inventory/web-shop> am4:serves <https://example.org/acme/inventory/warehouse>)>>;
    arch:inModel m:model; arch:inView mv:…;
    arch:source <https://example.org/acme/inventory/web-shop>; arch:target <https://example.org/acme/inventory/warehouse>.
mv:… a arch:Diagram, arch:View; skos:prefLabel "Default View"@en; arch:inModel m:model.
mv…:node-… a arch-vis:ArchNode; arch-vis:archElement <https://example.org/acme/inventory/web-shop>; …
mv…:link-… a arch-vis:Link; arch-vis:archRelationship mr:e26428537a5663f1d196; …
```

The elements keep their own IRIs, and the `am4:serves` triple gets a relationship,
`mr:e26428537a5663f1d196`, drawn between the two.

## Older la-gram files {#older-models}

Files from earlier versions of la-gram and of the Linked.Archi core use terms that have since been
retired. la-gram rewrites them as it opens the file, and saves the current terms:

| Retired | Becomes |
|---|---|
| `arch:partOfModel` | `arch:inModel` |
| `arch:exposedInView` | `arch:inView` |
| `arch:conformsToMetamodel` | `arch:modelConformsToMetamodel` |
| `arch:relSource`, `arch:relTarget` | `arch:source`, `arch:target` |
| `arch:viewpoint` on a view | `arch:viewConformsToViewpoint` |
| `arch:contains` from a view to a concept | `arch:inModel` on the view |
| `arch:relPredicate` on a relationship | the relationship's class and the plain triple. A predicate no loaded metamodel defines leaves a generic `arch:QualifiedRelationship`, and la-gram says so |
| bounds and `arch-vis:view` on an element (la-gram 0.1 and earlier) | a node in each view it named, or in the first view |

The message after opening ends with *older vocabulary migrated* when anything was rewritten.

```turtle
@prefix arch: <https://meta.linked.archi/core#>.
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix ex: <https://example.org/acme/legacy/>.
ex:model a arch:Model; skos:prefLabel "Acme, an older file"@en;
    arch:conformsToMetamodel <https://meta.linked.archi/archimate4/metamodel#ArchiMate4>.
ex:web-shop a am4:ApplicationComponent; skos:prefLabel "Web shop"@en; arch:partOfModel ex:model.
```

Opened as `legacy.ttl`: *Opened legacy.ttl: 6 triples, 1 elements laid out, older vocabulary migrated.*
Saved again, it has `arch:modelConformsToMetamodel` and `arch:inModel` in place of the two retired terms.
