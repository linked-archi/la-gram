---
title: Desktop app
description: How to download, open and use la-gram's desktop app on macOS, Windows and Linux.
---
# Desktop app

The same app as the web one, as a desktop application (Electron). It carries everything it needs, the
bundled metamodels included, so it works offline and needs nothing installed, not even Node.

## Download

Each release's apps are on the project's
[Releases page](https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/releases), and la-gram's
own menu links to it: *Download the desktop app*.

| Platform | File | Inside it |
|---|---|---|
| macOS, Apple silicon | `la-gram-<version>-darwin-arm64.zip` | `la-gram-darwin-arm64/la-gram.app` |
| macOS, Intel | `la-gram-<version>-darwin-x64.zip` | `la-gram-darwin-x64/la-gram.app` |
| Windows x64 | `la-gram-<version>-win32-x64.zip` | `la-gram-win32-x64/la-gram.exe` |
| Linux x64 | `la-gram-<version>-linux-x64.tar.gz` | `la-gram-linux-x64/la-gram` |
| Linux arm64 | `la-gram-<version>-linux-arm64.tar.gz` | `la-gram-linux-arm64/la-gram` |

Unzip it (on Linux, `tar -xzf` it) and open the app. On macOS, `la-gram.app` can be moved to
Applications first.

## The first time you open it

The apps are not signed by a developer, so the system stops one downloaded from the web the first time
it is opened. Allow it once; after that it opens as any other app. An app you package yourself
([Building](../developing/building.md)) opens as it is.

=== "macOS"

    1. Open `la-gram.app`. macOS does not open it the first time, and says why.
    2. Open *System Settings › Privacy & Security*.
    3. Choose *Open Anyway* for la-gram, and confirm.

=== "Windows"

    1. Open `la-gram.exe`. Windows SmartScreen stops it the first time.
    2. Choose *More info*, then *Run anyway*.

=== "Linux"

    1. Run `la-gram` from the folder you unpacked. Nothing asks first.

## Help, online

The desktop app does not include this documentation. Its Help menu and la-gram's own menu open each
guide in your web browser, so reading them needs the network. These pages are at
https://app.linked.archi/la-gram/docs/.

## Menu bar {#menu-bar}

The desktop app's menu bar has Electron's standard **File, Edit, View, Window and Help** menus, with
la-gram's pages in Help in place of Electron's own links. On macOS the app menu, named la-gram, comes
first.

| Menu | What is in it |
|---|---|
| la-gram (macOS only) | *About la-gram*, hiding, and quitting |
| File | closing the window (on Windows and Linux, quitting) |
| Edit | undo, cut, copy and paste in text fields |
| View | reloading, zoom and full screen |
| Window | minimizing and the window list |
| Help | the Linked.Archi guides (*Linked.Archi documentation*, *Quick start*, *Modelling guide*, *ArchiMate 4.0 primer*, *Names, labels and pictures per audience*, *Metamodel catalogue*), then *la-gram: what it does (README)*, *Source code* and *Report a problem or an idea*; on Windows and Linux, *About la-gram* last |

la-gram's own menu, under its icon at the top left of the window, is there too, with
*Download the desktop app* besides. Help leaves that one out: this is it.

The **About panel** is the system's own. la-gram gives it its name, its version, the tagline
*Semantic Modeller for Enterprise and IT Architecture* with the licence (Apache License 2.0), the source
code's address and the icon; each system shows what its About panel has room for. The la-gram menu's *About la-gram* dialog says more: where it runs, the
metamodels loaded, the components it is built with.

To read the quick start from the desktop app:

1. Choose *Help › Quick start* in the menu bar.
2. The page opens in your web browser.

To see the version:

1. On macOS, choose *la-gram › About la-gram*; on Windows and Linux, *Help › About la-gram*.
2. The About panel shows the version under the name.

## Unsaved changes {#unsaved-changes}

Closing the window while the model has changes that are not saved asks first, in the system's own
dialog, *Unsaved changes*: "The model has changes that are not saved. Closing the window discards them."

| Choice | What it does |
|---|---|
| *Close without saving* | closes the window; the changes are lost |
| **Cancel** (the default, and Esc) | keeps the window open, with the model as it was |

The model is not saved on its own (there is no autosave), so to keep the changes:

1. Choose **Cancel**.
2. Save with *File › Save* in la-gram's toolbar (or *Save to Git*).
3. Close the window again: nothing is asked.

While the model is shared in a [collaboration room](../guide/collaboration.md), the room holds it, and
closing asks nothing.

## Closing and reopening {#closing-and-reopening}

=== "macOS"

    Closing the window leaves the app running, as macOS apps do: it **stays running** in the Dock with no
    window. Clicking its Dock icon opens a new window, with a new, empty model. *la-gram › Quit la-gram*
    (++cmd+q++) ends it.

    1. Close the window (++cmd+w++).
    2. Click la-gram's icon in the Dock: a new window opens.

=== "Windows and Linux"

    Closing the last window quits the app.

    1. Close the window.
    2. Open the app again to start a new session, with a new, empty model.

A new window starts afresh: the model of the last one is not reopened.

Run from a checkout with `npm run electron`, unpackaged, the app sets its own icon in the macOS Dock, in
place of Electron's.
