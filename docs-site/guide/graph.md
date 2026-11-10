---
title: Relationship graph
description: The Graph tab in la-gram, which draws what the selected element is related to, its depth, layout, forces and filters, its SPARQL query, and a new view from it.
---
# Relationship graph

The *Graph* tab, under the canvas, draws what the selected element is related to in the model, in any
view or none, as a graph around it. It follows the selection while it is open, and does no work while it
is not.

<figure markdown="span">
  ![The Graph tab for Web shop: Depth 2, Layout Force, Fit, Forces folded under Layout, 6 elements · 6 relationships, the Query and Graph buttons, the Elements filter's heading, 4/4, and on the right the graph laid out by Force, each relationship's type on its line.](../assets/screenshots/guide/graph/graph-tab.png)
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
chose an element, a depth, a filter, a layout or a [force](#forces), or *Fit*. Then the view stays
where you put it, also while the graph settles again after a change elsewhere in the model, and when
you come back to the tab. Rings and Tree frame the graph each time they lay it out.

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

### Forces {#forces}

With *Layout* **Force**, *Forces* under *Layout* sets how the graph is pulled into shape. It is folded at
first: click *Forces* to open it. Rings and Tree have no forces.

| Control | Values | Does |
|---|---|---|
| *Link distance* | 40 to 400 px, in steps of 10; **180 px** | how long each relationship's line is pulled to be, from the centre of one element to the centre of the other |
| *Charge strength* | 0 to 1 500, in steps of 50; **350** | how hard the elements push each other apart. At 0 they do not, and only *Collision radius* keeps them apart |
| *Collision radius* | 0.5× to 2×, in steps of 0.1; **1.0×** | the room kept round each element: a circle round its box, 133 px across at 1.0×, times this. Below 1.0× boxes can come closer than at the default, and overlap |

- Each slider shows its value beside its name. Drag it, or move it with the keyboard: ++left++ and
  ++right++ by one step, ++home++ and ++end++ to its ends.
- With up to 100 elements, the graph follows a slider as you drag it. With more, or under the system's
  setting to reduce motion, it is laid out again when you let go of the slider, or at each key, and shown
  at rest.
- A change of forces is one you asked for: when the graph comes to rest, it is framed.
- *Reset* sets the three back to **180 px**, **350** and **1.0×**.
- The forces are remembered in this browser, and *Reset* forgets them
  ([stored data](../reference/stored-data.md#panel-choices)).
- On a graph of more than 800 elements, which Force draws in rings, *Forces* is greyed out, and the line
  that counts the elements and relationships says why.
- A *Link distance* shorter than the room the elements keep brings linked elements no closer: at
  *Collision radius* 1.0×, their centres stay about 133 px apart however short it is set.

1. Select "Web shop", and open *Graph*.
2. Click *Forces*, under *Layout*.
3. Drag *Link distance* to **300 px**: the lines grow as you drag, and the graph is framed when it comes
   to rest.
4. Choose *Reset*: the lines are about 180 px long again.
5. Set *Collision radius* to **2.0×**: the elements move apart, each keeping a circle twice as wide round
   it.
6. Choose *Reset*.

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
