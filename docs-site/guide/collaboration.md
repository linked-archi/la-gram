---
title: Collaboration
description: How several people edit one la-gram model at the same time in a room, with presence, soft locks and edits that converge, and what sharing replaces.
---
# Collaboration

Several people can edit one model at the same time, in a room: every change to the model's triples
reaches everyone in it at once (Yjs, over a Hocuspocus server). Each sees the others, what they have
open, and what they have selected. A room needs a collaboration server, `ws://localhost:1234` unless
`?ws=` says otherwise; [Collaboration server](../operating/collaboration-server.md) says how to run one.

!!! warning "Rooms have no authentication"

    Anyone who can reach the collaboration server and knows a room's name can join it, read the model and
    change it, and its HTTP interface lists the rooms and serves their models to anyone. Run it on a
    network you trust, behind TLS (`wss://`), and do not share models there that others may not read.

## Share {#share}

The indicator at the right of the toolbar says where the model stands:

| Indicator | Means |
|---|---|
| grey dot, *Share* | **not shared** (*Not shared — click to collaborate*) |
| yellow dot, the room's name | connecting |
| green dot, the room's name, the others' initials | connected: each circle is someone in the room, in their colour |
| red dot, the room's name | disconnected from the server |

*Share* asks for a room, in *Share this model*, with a *Room name* (by default **`model-`** and six
random letters and digits, `model-4s3k3t` say). It puts `?room=` with it into the page's address, joins
the room, and puts the model there ([Joining a room](#joining-a-room)). Clicking the indicator in a room
shows *Collaborating*: the room, the server, the status, and the address to share with your
collaborators.

1. Click *Share* in the toolbar.
2. Type "acme-shop" in *Room name*, and choose *OK*.
3. Click the indicator, and copy the address it shows to your collaborators.

## Joining a room {#joining-a-room}

The link someone shares opens la-gram in the room. In the address, `room` names it, `ws` the server and
`user` the name the others see (**Guest** and three digits, without it):

```text
https://app.linked.archi/la-gram/?room=acme-shop&user=Jane&ws=wss://collab.example.org
```

What the model becomes on joining depends on the room (**prefer-room**):

| The room | Then |
|---|---|
| has a model | the room's model wins: it replaces yours, which is not uploaded |
| is empty | it gets your model, as the first to arrive |

1. Open the shared link.
2. The indicator turns green, and the room's model replaces the one you had.

## Presence and locks {#presence-and-locks}

Everyone in a room publishes their name, a colour (one of eight, picked by their client), the view they
have open and what they have selected. What another person has selected is highlighted on your canvas
in their colour, and **locked**: it cannot be moved, resized, deleted or re-routed on your side until they
let go of it. The locks are soft: they last only while it is selected.

1. With two people in the room, one selects "Web shop".
2. On the other's canvas, "Web shop" is highlighted, and dragging it does nothing.

## Simultaneous edits {#simultaneous-edits}

When two people set a property that takes one value at the same moment, every client keeps the same one,
so the copies cannot drift apart. A property takes one value when it is a node's position, a name in one
language, or anything the loaded metamodels declare functional (`owl:FunctionalProperty`) or limit to
one value (`sh:maxCount 1`, `sh:uniqueLang`). The model's `dcterms:modified` keeps the later of two
stamps.

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <https://example.org/acme/shapes#> .

ex:OneOwnerShape a sh:NodeShape ;
    sh:property [
        sh:path ex:owner ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path skos:prefLabel ;
        sh:uniqueLang true
    ] .
```

With shapes like these loaded, two people giving an element an owner at once both see the same owner
afterwards, and one English name.

## Replacing a shared model {#replacing-a-shared-model}

In a room, *File › New model*, *Open…* and *Import ArchiMate exchange…* replace the model for everyone, and
ask first, *Shared model*: *This model is shared in room "acme-shop". Start a new model replaces it for
everyone in the room.* So do moving the model to another namespace in *Model settings*, and restoring a
checkpoint.

1. In a room, choose *File › New model*.
2. *Shared model* asks: choose *Cancel* to keep the room's model.

## Leaving {#leaving}

The room keeps the model, so while you are connected, closing or reloading the tab **asks nothing**,
unsaved changes or not. To leave, close the tab, or open la-gram without `?room=` in its address. The
model you leave behind is the room's; save a copy first (*File › Save*, or Git) to keep one of your own.

1. Choose *File › Save* to keep a copy.
2. Close the tab: nothing is asked.
