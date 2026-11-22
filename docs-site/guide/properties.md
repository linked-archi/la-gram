---
title: Properties
description: The Properties tab in la-gram, with its information, properties, analysis and views tabs, adding properties, who changed a concept and when, and changing an element's type.
---
# Properties

The bottom panel's *Properties* tab shows what is selected, on the canvas, in the model tree or in a
list, in vertical tabs. With nothing selected, it shows the open view. A figure or a line from one is
drawing, not model: it has its information and its look only. A
[view reference](canvas.md#view-references) is its view's placement: selected, the tab shows the view,
with the reference's own *Text* and *Opens* after the view's information, and the reference's look.
++up++ and ++down++ move through the tabs, and the tab last open stays open for the next selection, and
the next visit.

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
| *Type* | its type: for an element, a choice of every element type ([Change type](#change-type)); the *IRI* button beside the field shows or hides the current type's full IRI without opening the choice |
| *Model* | the model it is in |
| *Name* | its name, `skos:prefLabel`, in English |
| *Definition* | its definition, `skos:definition` (*Add a definition…* while empty) |
| *Names by presentation* | a name for each presentation context, drawn in its place while that presentation is chosen; empty, its own name is drawn |
| *Pictures by presentation* | a picture for every presentation, and one for each, by address or *Choose file…* (up to 200 KB); drawn on its placements while that presentation is chosen: inside a box, as the figure of one drawn as its icon, or in the badge ([An element's own picture](appearance.md#element-picture)) |
| *Last changed* | when it was last changed, by whom and with which la-gram, read-only ([below](#last-changed)); a converted model's source, too |

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

## Last changed {#last-changed}

la-gram records who changed a concept, when and with which la-gram, as it is changed. *Last changed*, at
the end of the information tab, shows it: *20 Nov 2026, 16:40 · by Ada Lovelace · with la-gram 0.3.0*. It
cannot be edited, and is never offered as a property: la-gram writes it, and so do the converters, whose
source a converted concept names below it (*Was derived from*).

| What | Recorded |
|---|---|
| which concepts | the model, its elements, relationships and views. Moving, resizing or restyling a placement, or rerouting a line, changes its view; renaming an element changes the element; every change changes the model |
| on the concept | *Created* (`dcterms:created`) when it is made, and *Modified* (`dcterms:modified`) at every change: on the [Properties tab](#properties-tab), saved with it. A value you type there yourself stays |
| in the model's provenance | the editing activity that changed it last (`prov:wasGeneratedBy`) and when (`prov:generatedAtTime`); the activity, from the first change after the model was opened or saved to the next save, with **la-gram** at its version and **you**. Saved in its own graph ([File formats](../reference/file-formats.md#graphs)), shown in the RDF panel unless *provenance* is unticked ([The RDF panel](rdf-panel.md#provenance)) |
| who you are | *File › Settings… › You* (*Name*, *Email*, and your Git account unless you untick it: [Settings](settings.md#you-tab)); without a name, your Git account's, else your collaboration name in a shared room, else nobody: la-gram alone |
| not recorded | opening, importing, a new model, undo and redo (the stamps go and come back with the change), merging, pulling, restoring a version, moving the model to another namespace, and a collaborator's changes, which their la-gram records |

la-gram at a version is the address of that version's page, `https://app.linked.archi/la-gram/v0.3.0`;
the activities and the users are named in the model's namespace, `{ns}provenance/edit-…` and
`{ns}provenance/user-…`. A user's name is a digest of their Git account, else their address, else their
name, so it carries nothing personal; what the model says of the user — name, address, account — is
updated each time an activity starts. A model keeps only what is behind its current state: an activity no
concept was last changed by goes, with a user no activity names. What exactly changed, and who changed it,
is what the [History tab](history.md#compare) compares.

```turtle
me:3f2a… dcterms:created "2026-11-20T09:12:04Z"^^xsd:dateTime ;
    dcterms:modified "2026-11-20T16:40:31Z"^^xsd:dateTime ;
    prov:wasGeneratedBy mp:edit-5c0e… ;
    prov:generatedAtTime "2026-11-20T16:40:31Z"^^xsd:dateTime .

mp:edit-5c0e… a prov:Activity ;
    prov:startedAtTime "2026-11-20T16:02:10Z"^^xsd:dateTime ;
    prov:endedAtTime "2026-11-20T16:40:31Z"^^xsd:dateTime ;
    prov:wasAssociatedWith <https://app.linked.archi/la-gram/v0.3.0>, mp:user-9d41… .

mp:user-9d41… a prov:Person ;
    schema:name "Ada Lovelace" ;
    schema:sameAs <https://gitlab.com/ada> ;
    schema:alternateName "ada" .
```

1. Choose *File › Settings…*, *You*, and type your name.
2. Rename "Web shop": its *Last changed* says now, by you, with this la-gram.
3. Undo: it says what it said before.

## Properties tab {#properties-tab}

*Properties* lists what has been added to the concept: text, numbers, dates, and links — to another element
or relationship, a view, a value of the metamodel's reference data such as a lifecycle stage, or an address
outside the model — and *Created* and *Modified*, which la-gram keeps as the concept changes
([Last changed](#last-changed)). Its relationships are on the [Analysis tab](#analysis-tab), not here, and
its provenance is not a property. Each value has a × to remove it.

The row at the bottom adds one: *Add a property…*, a value, and *Add*.

| What | Offers |
|---|---|
| *Add a property…* | what applies to its type (by the vocabularies' `rdfs:domain` and the SHACL shapes) — its links among them, `ad:hasDecisionGoal` for a decision, but not one drawn as a relationship on the canvas — what the model already uses, and documentation properties; or any name, prefixed name or IRI typed |
| the value | a choice when the property's shape lists its values (`sh:in`); *true* or *false* for a boolean; for a link, the model's elements, relationships and views by name (*Search the model, or type an address or text*), with a switch for each kind — *Elements*, *Relationships*, *Views*, all **on** — to leave one out; else text (*Value*) |

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
- To inspect the current type, click *IRI* beside the field. Its full IRI appears below, selectable
  for copying; click *IRI* again to hide it. The type stays the same.
- On the canvas, right-click › *Change type…* opens *Change element type*, a searchable menu of the same.

Relationships the new type does not permit are named before the change, in *Change Web shop to
Application Interface?*: they are kept, and validation flags them until they are changed or deleted.
*Change type* confirms; undo takes it back.

1. Select "Gift wrapping", and in *Type* type "process".
2. Pick **Process**. "Gift wrapping" is now a Process, in the same place, with the same name.
3. Undo, to make it a Service again.
