---
title: Catalog and matrix views
description: Catalog views, tables of elements, and matrix views, grids of relationships, in la-gram, and how to add the elements they show.
---
# Catalog and matrix views

Besides diagrams, a view can be a catalog or a matrix ([New view](models-and-views.md#new-view)). Either
presents the elements it is given, as a diagram does: an element is a member of the view
(`arch:inView`), and removing it from the view leaves it in the model. They have no canvas toolbar, and
open from the *View* selector or the model tree like any view.

## Catalog {#catalog}

A catalog lists its elements in **one table per type**, with a column for each property they have: the
name (`prefLabel`) and the definition first, then the rest. Structural links such as `arch:inModel` are
left out.

| To | Do |
|---|---|
| edit a value | double-click its cell, type, then ++enter++ to keep it or ++esc++ to drop it |
| take an element out of the catalog | ✕ at the end of its row: the element stays in the model |
| select an element | click its row: it is selected in the Properties tab and the model tree |

The example's catalog, "Who is who", presents the two business actors. In the file, that is all it takes:

```turtle
@prefix arch: <https://meta.linked.archi/core#> .
@prefix am4vp: <https://meta.linked.archi/archimate4/viewpoints#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix m: <https://example.org/acme/shop/> .

m:view-who-is-who a arch:Catalog, arch:View ;
    skos:prefLabel "Who is who"@en ;
    arch:inModel m:model ;
    arch:viewConformsToViewpoint am4vp:OrganizationViewpoint .

m:customer arch:inView m:view-who-is-who .
m:shop-team arch:inView m:view-who-is-who .
```

1. In the *View* selector, choose "Who is who (catalog)".
2. Double-click "Shop team" in the *prefLabel* column, type "Shop operations", and press ++enter++.

## Matrix {#matrix}

A matrix shows the relationships between two sets of its elements. *Rows* and *Columns*, above the grid,
pick each axis's element type, or **All elements**; a cell shows the relationship between its row and its
column, if the model has one, and names it on hover. When the view opens, they default to its **two most
common types**; a new matrix, empty when it is made, starts at *All elements* until a choice is made or it
is opened again. The choice is remembered for each view in this browser.

1. Make a matrix with ＋ › *New matrix*, and add the services and the application components to it (see
   below).
2. In *Rows*, choose **Application Component**; in *Columns*, **Service**.
3. The cells "Web shop" × "Online ordering" and "Payments" × "Card payment" show their Realization.

## Adding elements {#adding-elements}

Both views have **Add**, with *elements of a type…*: the model's element types not yet all in the view,
each with how many it would add (*Service (3)*). Choosing one adds every element of that type to the
view. Its label, to a screen reader, is *Add the elements of a type*. A new catalog or matrix says *This
catalog lists no elements yet. Add the elements of a type.* until it has some.

1. Open the new matrix.
2. In *Add*, choose **Service (3)**, then **Application Component (2)**.
3. The matrix has its rows and columns.
