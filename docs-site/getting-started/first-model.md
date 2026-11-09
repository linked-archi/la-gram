---
title: Your first model
description: A first model in la-gram, step by step, from a new model to placed and connected elements, validated and saved.
---
# Your first model

This tutorial draws part of the [example model](web.md#the-example-model), the Acme online shop, in
ArchiMate 4.0: a customer who places orders, the online ordering service behind it, and the web shop that
realizes the service. It takes about ten minutes, in the browser or the desktop app.

The finished example opens with this link, to compare at the end:

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl
```

## 1. A new model

la-gram starts with an empty model, *Untitled model*, and ArchiMate 4.0 loaded.

1. Open https://app.linked.archi/la-gram/.
2. Choose *File › New model*.
3. In *Name*, type "Acme online shop". Leave *Namespace* as it is: it is a placeholder under
   `https://example.org/`, which [Model settings](../guide/models-and-views.md#model-settings) changes
   later.
4. Choose *Create*.

The toolbar shows the model's name, and the canvas the model's one view, *Default View*, empty.

## 2. Place elements

The palette on the right lists what ArchiMate 4.0 has: relationship types first, then element types by
domain.

1. In the palette's *Search types*, type "Business Actor".
2. Click **Business Actor**, then click the canvas near its top left. The element is placed, named after
   its type.
3. Double-click it, type "Customer" and press ++enter++.
4. The same way, place a **Process** to the right of it, named "Place order"; a **Service** under that,
   "Online ordering"; and an **Application Component** under the service, "Web shop".

An element can also be dragged from the palette onto the canvas. The model tree on the left now lists the
four under *Elements*, by type.

## 3. Connect them

A relationship type from the palette draws that type. la-gram offers only what the metamodel permits
between the two.

1. In *Search types*, type "Assignment", and click **Assignment**.
2. Click "Customer", then "Place order". The line is drawn.
3. The same way, draw a **Serving** from "Online ordering" to "Place order", and a **Realization** from
   "Web shop" to "Online ordering".

Undo takes a step back (++ctrl+z++, or ++cmd+z++ on a Mac), redo goes forward again.

## 4. Validate

Validation runs while you work, in the background.

1. Open the *Validation* tab under the canvas. It finds two warnings and one info: the view declares no
   viewpoint, "Web shop" has no owner, and "Online ordering" is realized by only one application
   component.
2. In the toolbar's *Viewpoint*, choose **Service Realization Viewpoint**. The first warning goes.
3. Place a **Business Actor** named "Shop team" under "Customer", and draw an **Association** from it to
   "Web shop". The second warning goes.

What is left is the info, a note rather than a fault: one application realizing a service is a single
point of failure. Click a finding to select what it is about; its shape's name opens the shape's
documentation. [Validation](../guide/validation.md) says more.

## 5. Save

The model lives in the page until you save it; la-gram does not save on its own.

1. Choose *File › Save*. The model is saved as Turtle, `Acme-online-shop.ttl`, where your browser saves
   downloads.
2. The toolbar's ● beside the name goes, and the tab's title loses its •.

To open it again, *File › Open…*. To keep it in a repository instead, see [Git storage](../guide/git.md).

## Next

- The [User guide](../guide/index.md) goes through the workbench: the canvas, appearance, the model tree,
  SPARQL and the rest.
- Open the finished example with the link above, and compare. It has a payment service too, and a
  service realized by nothing, *on purpose*: its Validation tab shows the warning.
