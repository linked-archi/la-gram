---
title: User guide
description: A tour of la-gram's workbench, with its layout, the toolbar, the la-gram menu and its messages.
---
# User guide

The workbench, part by part. This page is the tour: the layout, the toolbar, la-gram's own menu and its
messages. The pages after it each take one part.

<figure markdown="span">
  ![The la-gram workbench with the Acme online shop open: the toolbar at the top, the model tree on the left with the About panel under it, the diagram in the middle with the canvas toolbar above it, the palette on the right, and the Properties tab under the canvas.](../assets/screenshots/guide/index/workbench.png)
  <figcaption>The workbench with the example model open.</figcaption>
</figure>

## Panels {#panels}

| Where | What | Page |
|---|---|---|
| Top | the toolbar: la-gram's menu, the model's name, *File*, *Metamodels*, undo and redo, back and forward, the view, its viewpoint and presentation, the panel toggles, *Share* | this one |
| Left | the model tree, with *About ‹type›* under it | [Model tree](model-tree.md), [Palette and About ‹type›](palette.md) |
| Middle | the open view: a diagram with the canvas toolbar above it, or a catalog or matrix | [Canvas](canvas.md), [Catalog and matrix](catalog-and-matrix.md) |
| Right | the palette; the RDF panel when it is open | [Palette](palette.md), [RDF panel](rdf-panel.md) |
| Bottom | the tabs: Properties, Validation, SPARQL Query, Graph, History | below |

Three toggles at the right of the toolbar show and hide the side panels:

| Toggle | Panel | At the start |
|---|---|---|
| ☰ Model | the model tree, on the left | **shown** |
| ▦ Palette | the palette, on the right | **shown** |
| { } RDF | the RDF panel, on the right | **hidden** (shown with [`?rdf=1`](../reference/url-parameters.md)) |

Each toggle is pressed while its panel shows. Whether a panel is shown is not remembered: la-gram starts
as in the table.

1. Click { } *RDF* in the toolbar: the RDF panel opens beside the palette.
2. Click ▦ *Palette*: the palette hides, and the canvas takes its room.
3. Click both again to put them back as they were.

## Bottom tabs {#bottom-tabs}

Under the canvas, five tabs: *Properties*, *Validation* (with the number of violations on it), *SPARQL
Query*, *Graph* and *History*. A module adds its own: Git storage adds *Conflicts* while a merge has
any left to choose. The tab open last is open again next time.

1. Select an element on the canvas.
2. Click *Graph*: its relationships are drawn around it.
3. Click *Properties* to go back to its properties.

## Resizing {#resizing}

Every panel resizes by its **inner edge**: the model tree by its right edge, the palette and the RDF panel
by their left edge, the bottom panel by its top edge, and *About ‹type›* by its top edge, under the tree.
The canvas always keeps at least 240 × 160 px. Sizes are remembered in this browser.

1. Point at the edge between the model tree and the canvas; the pointer changes.
2. Drag it right to widen the tree.

## Folding and maximizing {#folding-and-maximizing}

| To | Do |
|---|---|
| fold the bottom panel to its tabs | click the open tab, or the ▾ at the right of the tabs (*Fold the panel*) |
| unfold it | click any tab |
| maximize it over the workspace | ⤢, or double-click the empty part of the tab strip |
| restore it | ⤡, ++esc++, or double-click the tab strip again |

The RDF panel maximizes and restores from its own header the same way. Folding is remembered; a
maximized panel is not.

1. Click *Properties* while it is open: the panel folds to its tabs.
2. Click it again: it unfolds.
3. Double-click the empty part of the tab strip: the panel fills the workspace. Press ++esc++ to restore it.

## The la-gram menu {#la-gram-menu}

The icon and name at the top left, la-gram ▾, open la-gram's menu. Its pages open in a new tab (in the
desktop app, in your web browser).

| Part | Entries |
|---|---|
| la-gram | *About la-gram*, *Keyboard shortcuts* |
| Guides | *la-gram documentation*, *Linked.Archi documentation*, *Quick start*, *Modelling guide*, *ArchiMate 4.0 primer*, *Names, labels and pictures per audience*, *Metamodel catalogue* |
| la-gram's pages | *Download the desktop app…* (a dialog), *la-gram: what it does (README)*, *Source code*, *Report a problem or an idea* (the issue tracker; reporting needs a GitLab account) |

*la-gram documentation* opens these pages. The web app opens the copy served with it, in its own
`docs/`, of the same version, wherever it is deployed: https://app.linked.archi/la-gram/docs/ for
https://app.linked.archi/la-gram/. The desktop app opens https://app.linked.archi/la-gram/docs/.
The other guides are Linked.Archi's, on [meta.linked.archi](https://meta.linked.archi/docs/): how to model,
and the languages.

*Download the desktop app…* opens a dialog with a link to each platform's app of the latest release,
those for this computer first (on a Mac, *For this computer*: *macOS (Apple silicon)*, *macOS (Intel)*),
then *The first time* — how to open an app that is not signed — and links to *Opening it, in the
documentation*, *SHA-256 checksums* and *Every release, on GitLab*
([Desktop app](../getting-started/desktop.md#download)).

1. Click la-gram ▾ at the top left.
2. Choose *Quick start*: Linked.Archi's quick start opens in a new tab.
3. Choose *Download the desktop app…*, then your platform's: the app downloads.

## About la-gram {#about-la-gram}

*About la-gram* shows the version (*Development build* for a build from a checkout), where it runs
(*Web — Chrome 156*, say, or *Desktop app — Electron* and its version), the metamodels loaded, the snapshot of the
bundled metamodels, the licence and the open-source components it is built with. *Third-party licences*
opens the licences of every package built into la-gram, with their texts: in the web app, the copy beside
it; in the desktop app, the published web app's, in your browser. *Copy version info* copies one line of it
for a problem report.

1. Choose *la-gram › About la-gram*.
2. Choose *Copy version info*, and paste the line into your report:

```text
la-gram 0.1.0 · Web — Chrome 156 · metamodels: ArchiMate 4.0 Metamodel · bundled metamodels: e4882df07d49
```

In the desktop app, the menu bar has an About panel of the system's too
([Desktop app](../getting-started/desktop.md#menu-bar)).

## Keyboard shortcuts {#keyboard-shortcuts}

*Keyboard shortcuts* lists the keys and mouse gestures by where they work, with ⌘, ⌥ and ⇧ on a Mac and
Ctrl, Alt and Shift elsewhere. Every key is in [Keyboard and mouse](../reference/keyboard.md), which the
dialog's last line, *Keyboard and mouse, in the documentation*, opens.

=== "Windows and Linux"

    | Keys | Does |
    |---|---|
    | ++ctrl+z++ | undo |
    | ++ctrl+y++ or ++ctrl+shift+z++ | redo |
    | ++f2++ or double-click | rename the selected element or relationship |
    | ++alt+left++ / ++alt+right++ | the view before, the view after |
    | ++ctrl+enter++ | run the SPARQL query |

=== "macOS"

    | Keys | Does |
    |---|---|
    | ++cmd+z++ | undo |
    | ++cmd+y++ or ++shift+cmd+z++ | redo |
    | ++f2++ or double-click | rename the selected element or relationship |
    | ++option+left++ / ++option+right++ | the view before, the view after |
    | ++cmd+enter++ | run the SPARQL query |

1. Choose *la-gram › Keyboard shortcuts*.
2. Press ++esc++ to close it.

## Narrow windows {#narrow-windows}

The toolbar fits from **1100 px** wide. As the window narrows, it makes room in steps:

| Window width | The toolbar |
|---|---|
| 1680 px or less | the *View*, *Viewpoint* and *Presentation* selectors narrow |
| 1500 px or less | the selectors lose their names (*View*, *Viewpoint*, *Presentation*) |
| 1340 px or less | the panel toggles lose their words: ☰, ▦ and { } alone |
| 1150 px or less | the selectors narrow again |

Each control says what it is when you point at it.

!!! example "On a laptop screen"

    At 1280 px wide, the toolbar shows ☰, ▦ and { } without *Model*, *Palette* and *RDF*, and the
    selectors without their names. Pointing at { } says *Show the model as RDF (Turtle) on the right*.

## Window title {#window-title}

The browser tab and the window are titled by the open model: `Acme online shop — la-gram`, with a • in
front while it has unsaved changes (`• Acme online shop — la-gram`). Before the app has started, the
title is `la-gram — Semantic Modeller for Enterprise and IT Architecture`.

## Messages {#messages}

What la-gram did, or could not do, it says in a short message at the bottom of the window: an info,
warning or error. Info and warning messages go after 4 seconds, errors after 8. Nothing needs to be
dismissed.

| Level | For example |
|---|---|
| info | *Checkpoint saved*, *IRI copied*, *Loaded ArchiMate 3.2* |
| warning | *Open a diagram view to export it.* |
| error | a deployment configuration that failed its check, with *Git storage is off until it is fixed.* |

1. Right-click an element on the canvas and choose *Copy IRI*.
2. The message *IRI copied* shows, and goes.
