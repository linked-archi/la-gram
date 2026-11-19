---
title: Models and views
description: One model and its views in la-gram, with new models, model settings, diagram, catalog and matrix views, viewpoints and presentations.
---
# Models and views

la-gram holds one model at a time, with any number of views of it: diagrams, catalogs and matrices. An
element is one resource wherever it appears; a view only presents it. Deleting from a view leaves the
model as it was, and deleting from the model takes the element out of every view.

## New model {#new-model}

*File › New model* replaces the open model with an empty one, after asking if it has unsaved changes
(*Start a new model* anyway?) or is shared in a collaboration room. Its dialog, *New model*, has two
fields:

| Field | Default | What it is |
|---|---|---|
| *Name* | **Untitled model** | the model's name, its `skos:prefLabel` |
| *Namespace* | **`{base}{notation}/{uuid}/`**, for example `https://example.org/archimate/e6d8f280-…/` | where every IRI of the model is minted; an `https:` or `http:` IRI with no `#` or `?`, spaces or `<>"{}|\^` characters |

`{base}` is `https://example.org/` unless [`?base=`](../reference/url-parameters.md) says otherwise,
`{notation}` comes from the first metamodel loaded (`archimate` for ArchiMate 3.2 and 4.0), and the
UUID is new each time. `example.org` is a placeholder: use your own domain to publish. The new model has
one diagram view, *Default View*, with no viewpoint.

1. Choose *File › New model*.
2. In *Name*, type "Acme online shop".
3. Choose *Create*.

The model's elements are minted in the namespace as `element/…`, its views as `view/…`, and a diagram's
nodes and lines in their view: `view/…#node-…`, `view/…#link-…`. A saved model writes them `me:…`, `mv:…`
and `mv3ef7da72:node-…` ([File formats and vocabulary](../reference/file-formats.md#formats)).

## Model settings {#model-settings}

The model's name in the toolbar, with a ● after it while there are unsaved changes, opens *Model
settings*; so do *File › Model settings…* and *Model settings…* on the model in the model tree.

| Field | Default | What it is |
|---|---|---|
| *Name* | the model's name | the model's name |
| *Namespace* | the model's namespace | where new IRIs are minted |
| *Prefix* | **`m`** | the prefix that stands for the namespace in Turtle (`m:model`), and begins the prefix of each kind (`me:` for elements, `mv:` for views): starts with a letter, then letters, digits, `-` and `_`; not one that already stands for another namespace, such as `am4` or `skos` |
| *Move the model's existing IRIs into the new namespace* | **on** | on, every IRI in the old namespace moves to the new one, keeping the rest of its name, those in the triple a relationship reifies (`rdf:reifies`) too; off, only IRIs minted from now on use it |

*Apply* makes the change, as one step that undo takes back, and a message says how many IRIs moved. In a
collaboration room, moving the namespace asks first: it renames the IRIs for everyone in the room. For a
model saved to Git, it asks too, in *Model saved to Git*: the model stays bound to its file, and *Save to
Git* commits the move there ([Moving the model to another namespace](git.md#namespace)).

1. Click the model's name in the toolbar.
2. In *Namespace*, type `https://example.org/acme/models/shop/`; in *Prefix*, `shop`.
3. Leave the box that moves the existing IRIs ticked, and choose *Apply*.

Every IRI of the model now starts with `https://example.org/acme/models/shop/`, written `shop:…` in
Turtle.

## Open a view {#open-a-view}

The *View* selector in the toolbar lists the model's views by name, a catalog or matrix with its kind
after it: *Who is who (catalog)*. Choosing one opens it. A view also opens from the model tree (a
double-click, or *Open* in its menu) and from *Appears in views* in the Properties tab.

1. Open the example model.
2. In the toolbar's *View*, choose "Who is who (catalog)". The catalog takes the canvas's place.

## Back and forward {#back-and-forward}

← and → in the toolbar, or ++alt+left++ and ++alt+right++ (++option+left++ and ++option+right++ on a
Mac), go back to the views you came from, however you got there: the selector, the model tree, *Appears
in views*, a revealed concept. Each view comes back as you left it, with its zoom, scroll and selection.
Pointing at ← says where it goes, *Back to How the shop serves its customers (Alt+←)*; with nowhere to
go, it is greyed out (*Back (no earlier view)*).

1. In the example, open "Who is who (catalog)" from the *View* selector.
2. Click ←: the diagram comes back, as it was.
3. Click →: the catalog again.

## New view {#new-view}

＋ beside the *View* selector opens the new-view menu; the model's menu in the model tree has the same
three, and so do the *Views* group's and a folder of views', which put the view in that folder
([New views and elements](model-tree.md#new-views-and-elements)):

| Entry | Makes |
|---|---|
| *New diagram* | a diagram: elements drawn and connected |
| *New catalog* | a catalog: a table of elements, one per type |
| *New matrix* | a matrix: elements of two types, and the relationships between them |

Each asks for a *Name* (by default **New diagram**, **New catalog** or **New matrix**), then, when the
loaded metamodels have viewpoints, which viewpoint the view follows (see [Viewpoints](#viewpoints)). The new
view opens at once.

1. Choose ＋ › *New matrix*.
2. Name it "Who serves what", and choose *OK*.
3. Choose **— none —** in the viewpoint list, and *OK*. The empty matrix opens; add its elements as
   [Catalog and matrix views](catalog-and-matrix.md) says.

## Viewpoints {#viewpoints}

A viewpoint says what a view is for and which element types it shows. Each view has one or none. The
toolbar's *Viewpoint* selector sets the open view's; **— none —** is the default for a new diagram. When
a new view is made, a chooser offers **— none —** (*Every element type is offered*) or each viewpoint
with the number of element types it admits (*Service Realization Viewpoint — 15 element types*, in
ArchiMate 4.0). *Set viewpoint…*, in the canvas's right-click menu and the view's menu in the model tree,
changes it later.

What a viewpoint does to the view:

- The palette offers only the element types it names, and the relationships between them.
- Elements already on the view that it does not admit are **greyed**, never removed. The SPARQL tab's
  question *Which elements does their view's viewpoint not admit?* lists them.
- Its description shows in [*About ‹type›*](palette.md#about-type) while nothing is selected.

ArchiMate 4.0's shapes expect every view to declare a viewpoint: a view with none has a warning in the
Validation tab.

1. Open the example's diagram. Its viewpoint, in the toolbar, is **Service Realization Viewpoint**.
2. In *Viewpoint*, choose **Organization Viewpoint**. Everything but "Customer" and "Shop team" is
   greyed, and the palette offers the organization's types only.
3. Choose **Service Realization Viewpoint** again.

## Presentations {#presentations}

A presentation context is an audience: executives, developers, operations. When the loaded metamodels
define some, the toolbar has a *Presentation* selector: **Default notation**, then each context.
ArchiMate 4.0 has *Governance / Compliance*, *Operations / Infrastructure*, *Developer / Engineering*,
*Architect* and *Executive / C-Level*.

Choosing one draws the view for that audience: in its notation set, with the names, labels and pictures
given for it ([Appearance, labels and pictures](appearance.md#per-presentation), and *Names by
presentation* in [Properties](properties.md#information-tab)). It changes how the model is drawn, not the
model. The choice lasts for the session: la-gram starts with **Default notation**.

1. In the example, choose *Presentation* › **Executive / C-Level**.
2. Give "Web shop" a name for executives in the Properties tab's *Names by presentation*, "Online shop".
   The diagram shows it at once.
3. Choose **Default notation**: "Web shop" again.

## Rename {#rename}

Every name can be changed from the model tree, the canvas or the Properties tab. The dialogs have one
field each:

| Dialog | From | Field |
|---|---|---|
| *Rename* | an element's or a relationship's *Rename…* in the model tree | *Name* |
| *Rename view* | *Rename…* on a view in the model tree, *Rename view…* on the canvas | *Name* |
| *Rename model* | *Rename model…* on the model in the model tree | *Model name* |

On the canvas, a double-click or ++f2++ renames in place instead ([Canvas](canvas.md#rename-in-place)).
Every rename is undoable.

1. Right-click "Who is who" in the model tree's *Views*, and choose *Rename…*.
2. Type "Who is who at Acme", and choose *OK*.

## Delete a view {#delete-a-view}

Deleting a view keeps what it shows: its elements and relationships stay in the model, and in every other
view. *Delete view (keeps its elements)* in the model tree, or *Delete view…* in the canvas's right-click
menu, asks first: *Delete the view "Who is who"? The elements and relationships it shows stay in the
model.*

1. Right-click "Who is who" in the model tree, and choose *Delete view (keeps its elements)*.
2. Choose *Delete view* to confirm. "Customer" and "Shop team" are still under *Elements*.

*Duplicate view* (*Duplicate* in the model tree) makes a copy of a view, with the same elements placed
the same way, and opens it.
