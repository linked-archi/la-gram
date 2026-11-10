---
title: Relationship graph
description: The Graph tab in la-gram, which draws what the selected element is related to, its depth, layout and filters, its SPARQL query, and a new view from it.
---
# Relationship graph

The *Graph* tab, under the canvas, draws what the selected element is related to in the model, in any
view or none, as a graph around it. It follows the selection while it is open, and does no work while it
is not.

<figure markdown="span">
  ![The Graph tab for Web shop: Depth 2, Layout Force, Fit, 6 elements · 6 relationships, the Query and Graph buttons, the Elements filter with its counts, and on the right the graph laid out by Force, each relationship's type on its line.](../assets/screenshots/guide/graph/graph-tab.png)
  <figcaption>The relationships around "Web shop", two hops out.</figcaption>
</figure>

## Depth {#depth}

*Depth* is how many hops out the graph reaches: **1** to **5**, **2** by default, remembered in this
browser. Every relationship within that many hops of the element is drawn, either way round, with its
ends; the line over the graph counts them, *6 elements · 6 relationships*.

1. Select "Web shop", and open *Graph*.
2. Click *Depth* **1**: only what "Web shop" is directly related to.
3. Click **3**: one hop further.

## Layout {#layout}

| *Layout* | Draws |
|---|---|
| **Force** (the default) | the graph pulled into shape by its links, live: it moves into place, comes to rest and stops |
| Rings | the element at the centre, each hop a ring further out |
| Tree | the element at the top, each hop a level down |

The layout is remembered in this browser, and a choice made before is kept. *Fit* frames the graph in the
panel at once.

**The view while Force runs.** The view does not move while the graph moves. When the graph comes to
rest, the panel frames it, unless you have clicked, dragged or scrolled in the drawing since you last
chose an element, a depth, a filter or a layout, or *Fit*. Then the view stays where you put it, also
while the graph settles again after a change elsewhere in the model, and when you come back to the tab.
Rings and Tree frame the graph each time they lay it out.

**Reduced motion.** Under the system's setting to reduce motion, Force shows the graph in place in one
change, a large graph after a moment, and a dragged element moves alone.

**Large graphs.** How Force lays a graph out depends on its size:

| Elements in the graph | Force |
|---|---|
| up to **100** | moves the graph into place; a dragged element pulls the elements linked to it |
| 101 to **800** | places the graph without movement and shows it at rest; a dragged element moves alone |
| more than 800 | draws the graph in rings, as Rings does, and nothing moves; the line that counts the elements and relationships adds *· drawn in rings: Force lays out up to 800 elements* |

The three numbers are measured with la-gram's benchmark, on a processor slowed to a laptop's
([Testing › `npm run bench`](../developing/testing.md#npm-run-bench)).

1. In *Layout*, choose **Tree**.
2. Choose **Force**: the graph moves out of its tree into a shape of its own, comes to rest and is framed.
3. Drag the panel's top edge up, then choose *Fit*.

## Filters {#filters}

Under the buttons, *Elements* and *Relationships* list the types the graph holds, each with its count and
a checkbox, all **shown** at first; *none* and *all* switch a list at once. The filters **prune** the
walk, not only the drawing: a relationship type left out is not followed, and an element type left out
is not stepped onto, so what lies beyond them is not reached either.

1. With "Web shop" at depth 2, untick **Association** under *Relationships*.
2. "Shop team" goes from the graph: it was reached through an association only.

## Navigate {#navigate}

| Gesture | Does |
|---|---|
| click a node or a line | selects that element or relationship, on the canvas and in the Properties tab |
| **double-click a node** | makes it the graph's centre, and selects it |
| drag an element | moves it. With Force, the elements linked to it follow, and when you let go it settles back among them. Drag the element in the middle and the graph follows it; it stays where you drop it |
| drag the background, scroll | moves and zooms the graph |

With Rings and Tree, and with Force on a graph of more than 100 elements, a dragged element moves alone.
Where you drag elements is the drawing's only: nothing is saved with the model, and a reload lays the
graph out again. With Force, a change keeps the elements still drawn where they are, and places the new
ones beside the elements they are reached from.

1. With "Web shop" at depth 2, drag "Card payment" away from "Web shop": "Payments", linked to it,
   follows. Let go: "Card payment" settles back.
2. Double-click "Card payment" in the graph: the graph is redrawn around it.

## Query {#query}

The graph is the answer to a SPARQL query, and *Query* shows it, in either form:

| Form | Gives |
|---|---|
| **SELECT** (the default) | a table, one row per relationship |
| CONSTRUCT | the graph's triples |

The form is remembered in this browser. *Run in SPARQL tab* runs the query there, where it can be read
and changed; *.rq ⬇* downloads it. Run, it gives what is drawn.

1. Choose **CONSTRUCT** under *Query*.
2. Choose *Run in SPARQL tab*: the SPARQL Query tab opens, with the query and its triples.

## New view {#new-view}

*＋ New view*, under *Graph*, makes a diagram of the elements and relationships drawn, **laid out as
drawn**: where the elements are when you choose it, still moving or at rest. It asks for the view's name,
by default the element and the depth (*Web shop — 2 hops*).
*.ttl ⬇* downloads the graph's triples as Turtle instead.

1. Select "Web shop", at depth 2.
2. Choose *＋ New view*, and *OK*: the view "Web shop — 2 hops" opens, laid out as the graph was.
