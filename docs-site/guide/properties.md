---
title: Properties
description: The Properties tab in la-gram, with its information, properties, analysis and views tabs, adding properties, and changing an element's type.
---
# Properties

The bottom panel's *Properties* tab shows what is selected, on the canvas, in the model tree or in a
list, in vertical tabs. With nothing selected, it shows the open view. A figure or a line from one is
drawing, not model: it has its information and its look only. ++up++ and ++down++ move through the
tabs, and the tab last open stays open for the next selection, and the next visit.

| Tab | For |
|---|---|
| *Element information*, *Relationship information*, *View information*… | what it is: see below |
| *Properties* (with a count) | its properties, and adding one |
| *Analysis* (with a count) | its relationships |
| *Appears in views* (with a count) | the views it is drawn in |
| *Appearance*, *Label*, *Figure*, *Image* | how this placement is drawn: [Appearance, labels and pictures](appearance.md) |

## Information tab {#information-tab}

The first tab is named after what is selected: *Element information*, *Relationship information* or
*View information*.

| Field | What it is |
|---|---|
| *ID* | its local name (`web-shop`); click *ID* for the full IRI |
| *Type* | its type: for an element, a choice of every element type ([Change type](#change-type)) |
| *Model* | the model it is in |
| *Name* | its name, `skos:prefLabel`, in English |
| *Definition* | its definition, `skos:definition` (*Add a definition…* while empty) |
| *Names by presentation* | a name for each presentation context, drawn in its place while that presentation is chosen; empty, its own name is drawn |
| *Pictures by presentation* | a picture for every presentation, and one for each, by address or *Choose file…* (up to 200 KB); drawn on its placements while that presentation is chosen: inside a box, as the figure of one drawn as its icon, or in the badge ([An element's own picture](appearance.md#element-picture)) |

*Names by presentation* and *Pictures by presentation* show when the loaded metamodels define
presentation contexts. A name for an audience is written as a SKOS-XL `skosxl:altLabel`, its text also a
`skos:altLabel`; the element's own name stays its `skos:prefLabel`, and `{name}` in a
[label expression](appearance.md#label-expressions) shows the audience's name. A picture for an audience
is an `arch:altVisNotation` to a `schema:ImageObject` with its address and its presentation context; the
picture for every presentation is the element's `arch:prefVisNotation`.

1. Select "Web shop".
2. In *Definition*, type "Where customers place their orders." and click outside the field.
3. In *Names by presentation*, beside **Developer / Engineering**, type "shop-web".
4. Choose *Presentation* › **Developer / Engineering** in the toolbar: the diagram says "shop-web".

## Properties tab {#properties-tab}

*Properties* lists what has been added to the concept, then, folded under *Relationships* (**folded** by
default, remembered), the direct statements its relationships make, such as `am4:realizes`. Each value
has a × to remove it.

The row at the bottom adds one: *Add a property…*, a value, and *Add*.

| What | Offers |
|---|---|
| *Add a property…* | what applies to its type (by the vocabularies' `rdfs:domain` and the SHACL shapes) — its links among them, `ad:hasDecisionGoal` for a decision, but not those drawn as relationships on the canvas — what the model already uses, and documentation properties; or any name, prefixed name or IRI typed |
| the value | a choice when the property's shape lists its values (`sh:in`); *true* or *false* for a boolean; for a link, the model's concepts by name (*Search the model, or type an address or text*); else text (*Value*) |

1. Select "Web shop", and open *Properties*.
2. In *Add a property…*, type `dcterms:creator` and pick it.
3. In *Value*, type "Acme platform team", and choose *Add*.

```turtle
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix m: <https://example.org/acme/shop/> .

m:web-shop dcterms:creator "Acme platform team" .
```

## Analysis tab {#analysis-tab}

*Analysis* lists the element's relationships, each with its direction (→ from it, ← to it), its type and
the element at the other end; both are links that select them. For a relationship, it shows its two ends
first. The count on the tab is the number of relationships.

1. Select "Web shop", and open *Analysis*.
2. It reads → **Realization** "Online ordering", ← **Association** "Shop team" and ← **Serving** "Card
   payment".
3. Click "Online ordering": it is selected.

## Appears in views {#appears-in-views}

*Appears in views* lists the views the concept is drawn in (*In no view.* when there are none). Clicking
one opens it with the concept selected, and ← in the toolbar goes back.

1. Select "Customer", and open *Appears in views*.
2. It lists "How the shop serves its customers" and "Who is who". Click "Who is who": the catalog opens.

## Change type {#change-type}

An element's type changes in place: it keeps its identity, its name, its properties and its placements.

- In *Element information*, the *Type* field searches every element type of the loaded metamodels by
  name, grouped as in the palette. Types that share a name show their IRIs; *Show IRIs* shows every
  one's, a switch remembered for every such list.
- On the canvas, right-click › *Change type…* opens *Change element type*, a searchable menu of the same.

Relationships the new type does not permit are named before the change, in *Change Web shop to
Application Interface?*: they are kept, and validation flags them until they are changed or deleted.
*Change type* confirms; undo takes it back.

1. Select "Gift wrapping", and in *Type* type "process".
2. Pick **Process**. "Gift wrapping" is now a Process, in the same place, with the same name.
3. Undo, to make it a Service again.
