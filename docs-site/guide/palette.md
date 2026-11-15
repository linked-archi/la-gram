---
title: Palette and About ‹type›
description: The palette of element and relationship types in la-gram, its search, grouping and viewpoint filter, and the About panel that explains a type.
---
# Palette and About ‹type›

The palette, on the right, lists the types the loaded metamodels define: relationship types first, then
element types in the groups the metamodel's taxonomy gives them. Drag a type onto the canvas, or click it
and then the canvas ([Placing elements](canvas.md#placing-elements)). ▦ *Palette* in the toolbar hides
and shows it. *About ‹type›*, under the model tree, says what a type is.

## Search {#search}

*Search types*, at the top of the palette, keeps the types whose name or prefixed name has what you
type: "actor" finds Business Actor, and "am4:Serv" finds Service and Serving. ✕ clears it. Abstract
types are never offered.

1. Click *Search types* and type "realiz".
2. The palette shows **Realization** among the relationships, and the element types whose names have
   it.

## Group by {#group-by}

When the metamodel classifies its types in more than one way, *Group by* picks the one the palette is
grouped by: ArchiMate 4.0 has **Domain** and **Aspect**, ArchiMate 3.2 **Layer** and **Aspect**.
The default is the one the metamodel names first for its
palette, by domain or by layer; a metamodel that names none groups by the first by name. With one way,
there is no *Group by*. The choice lasts while la-gram is open.

1. In *Group by*, choose **Aspect**.
2. The element types are grouped by aspect: structure first — its active and passive structure sections among
   them — then behaviour, and so on.

## Sections {#sections}

The palette's sections, each with its count:

1. *Relationships*, first, and **folded** — click its header to open it; a search opens it too. Every
   relationship type, grouped by category where the metamodel classifies them — for ArchiMate,
   **Structural Relationship**, **Dependency Relationship**, **Dynamic Relationship** and **Other
   Relationship**, in that order, each folding by its header. Within a
   category the types come strongest first, as the metamodel orders them — **Composition**,
   **Aggregation**, **Assignment**, **Realization** — where it gives an order, else by name. A kind of
   relationship, such as **Read Access**, comes just after the relationship it is a kind of.
2. The element groups, in the order the metamodel gives them: for ArchiMate 4.0 by domain, **Common
   Domain**, **Business Domain**, **Application Domain**, **Technology Domain**, **Strategy Domain**,
   **Motivation Domain** and **Implementation and Migration Domain**; for ArchiMate 3.2 by layer, the
   layers, then **Motivation** and **Composite**, whose elements are in no layer. A metamodel that gives
   no order has its groups by name.
3. **Junction**, last: the junctions, which are in no domain, layer or aspect — the metamodel classifies
   them on their own, so they keep this section whatever *Group by* says. A type the metamodel
   classifies nowhere is in *Other*.

Within a section, the types follow the order the metamodel gives the section's group, where it gives
one — ArchiMate 4.0's **Common Domain**: Process, Function, Service, Event, Role, Collaboration, Path,
Grouping, Location. Elsewhere they follow the metamodel's other way of grouping, where it names one: in
an ArchiMate 3.2 layer or an ArchiMate 4.0 domain, structure (active and passive), then behaviour, then
composite — each by name.

| Section | Begins with |
|---|---|
| **Common Domain** (4.0) | Process, Function, Service, Event, then Role, Collaboration, Path |
| **Business Domain** (4.0) | Business Actor, Business Interface, Business Object, Product |
| **Business Layer** (3.2) | Business Actor, Business Collaboration, Business Interface, Business Object, Business Role, Contract, Representation, then the behaviour |

Each section folds by its header. A search opens every section, so that nothing found is hidden.

## Viewpoint filter {#viewpoint-filter}

With a viewpoint set on the open view, the palette offers only the element types it names, and the
relationship types it names. A viewpoint that names element types and no relationship types, as
ArchiMate 4.0's do, offers every relationship type: which one fits a pair is for the connect rules to
decide. A viewpoint that names no types offers none. Elements already on the view are not affected:
those outside the viewpoint are greyed ([Viewpoints](models-and-views.md#viewpoints)).

1. In the toolbar's *Viewpoint*, choose **Organization Viewpoint**.
2. The palette offers the types of an organization view only: actors, roles, collaborations and their
   kin.
3. Choose **— none —**: every type is back.

## No classification {#no-classification}

A metamodel whose manifest names no taxonomy (`arch:conceptClassification`), or whose taxonomy did not
load, still works: the palette lists every element class of its ontology, grouped by a guess from its
name, and says so:

!!! example "The notice at the top of the palette"

    *No classification loaded — types grouped by name.* Pointing at it says why: the metamodel names no
    classification, or it did not load.

[Show loaded assets…](metamodels.md#loaded-assets) says which of the two it is.

## About ‹type› {#about-type}

Under the model tree, *About ‹type›* says what the loaded ontology and taxonomy say about a type: the
selected element's or relationship's type, or, for a view, its viewpoint. **Point at** a palette entry,
and it shows that type instead.

| Section | Says |
|---|---|
| the heading | the type's name and prefixed name (`am4:ApplicationComponent`), its other names (*Also: Application, Software Component*) and its definition |
| *Guidance* | how the specification says to use it |
| *In models* | facts for modelling with it; for a viewpoint, what it shows, for whom, its concerns and its purpose |
| *Classification* | where the taxonomy files it, and the other types in its group |
| *Specializes* | its superclasses |
| *Changes* | the changes the ontology records for it |
| *Source* | the specification's section, linked |

Each section folds by its title, and the choice is remembered in this browser: *Guidance*, *In models*
and *Classification* start open, *Specializes* and *Changes* folded. The whole panel folds to its header,
and resizes by its **top edge**, both remembered.

1. Point at **Application Component** in the palette.
2. "About Application Component" shows its definition and *Guidance*.
3. Click the panel's header to fold it; click it again to unfold it.
