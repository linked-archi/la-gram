---
title: SPARQL and model questions
description: How to query a la-gram model with SPARQL, read the results, ask the languages' model questions, and make a view of an answer.
---
# SPARQL and model questions

The *SPARQL Query* tab, under the canvas, runs SPARQL over the model as la-gram holds it, in Oxigraph.
The model is the default graph; each loaded metamodel document is a named graph of its own, which
`GRAPH ?g { … }` reaches. Its *Questions* menu asks the questions the loaded languages publish, without
writing any SPARQL.

## Editor {#editor}

The editor highlights SPARQL's keywords, variables and prefixes, and wraps long lines. It starts with
**`SELECT ?s ?p ?o WHERE { ?s ?p ?o . } LIMIT 10`**. ▶ *Run*, or ++ctrl+enter++ (++cmd+enter++ on a
Mac), runs it. Declare the prefixes a query uses (`PREFIX am4: <…>`): the editor does not add them. A
query that cannot be parsed or run says why, under the editor.

1. Open the *SPARQL Query* tab, and replace the query with the one below.
2. Press ++ctrl+enter++ (++cmd+enter++): one row, "Gift wrapping".

```sparql
PREFIX am4: <https://meta.linked.archi/archimate4/onto#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?service ?name WHERE {
  ?service am4:serves ?customer ;
           skos:prefLabel ?name .
  ?customer skos:prefLabel "Customer"@en .
}
```

## Results {#results}

| Query | Shown as |
|---|---|
| `SELECT` | a table, a column per variable |
| `CONSTRUCT`, `DESCRIBE` | the triples, as a table of subject, predicate and object |
| `ASK` | true or false |

The first **500** rows are shown; the count above them says how many there are (*10 result(s)*). IRIs
are written as **prefixed** names (`m:web-shop`, `am4:realizes`), and clicking one selects the concept:
on the canvas, in a view that shows it, and in the Properties tab.

```sparql
PREFIX am4: <https://meta.linked.archi/archimate4/onto#>
PREFIX arch: <https://meta.linked.archi/core#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?application ?service WHERE {
  ?realization a am4:Realization ;
               arch:source ?a ;
               arch:target ?s .
  ?a skos:prefLabel ?application .
  ?s skos:prefLabel ?service .
}
ORDER BY ?application
```

| application | service |
|---|---|
| Payments | Card payment |
| Web shop | Online ordering |

```sparql
PREFIX am4: <https://meta.linked.archi/archimate4/onto#>

ASK { ?component a am4:ApplicationComponent }
```

The `ASK` answers *true*.

## Questions {#questions}

*Questions ▾*, beside ▶ *Run*, lists the questions the loaded languages and the core publish of a model.
They are grouped by stage, *Orientation*, *Resolution*, *Discovery*, *Analysis*, *Enrichment*, *Quality*
and *Views*, after those that fit the open view's viewpoint, under *Fits this view*. A question whose rows
are problems is marked *finding*; the [Validation tab's](validation.md#model-checks) *Model checks* ask
those.

| Part of the menu | What it does |
|---|---|
| *Concern* | **All concerns**, or one concern: only the questions that address it |
| the line under the title | what the questions are asked about: *View*, *Viewpoint*, and the element selected (*Element*, or *From* and *To* for two) |
| a greyed question | needs what is not selected, and says so: *Select an element* |

Picking a question puts its query in the editor, with the model, view, viewpoint and selection bound as
`VALUES` and a `LIMIT`, and runs it. Above the result, it says what a row means (*A row:*) and what it
does not prove (*Does not prove:*); a finding with no rows says *None found.* Right-click an element ›
*Ask about this element…* opens the menu with the questions about it.

<figure markdown="span">
  ![The SPARQL Query tab with the Questions menu open for the example's diagram: the view and its viewpoint, Service Realization, named under the title; under Fits this view, Which services does nothing realise?, marked finding; then Orientation and Resolution, where What is recorded about this element? is greyed with Select an element.](../assets/screenshots/guide/sparql/questions-menu.png)
  <figcaption>The Questions menu, the questions that fit the view first.</figcaption>
</figure>

1. Open the example, and the *SPARQL Query* tab.
2. Choose *Questions ▾*, then "Which services does nothing realise?" under *Fits this view*.
3. The editor holds its query, and the result reads:

```text
Which services does nothing realise?
A row: One row per service nothing realises.
Does not prove: That the service is not delivered: it may be bought in, or realised in a model that is not loaded.
1 result(s)
service          label
m:gift-wrapping  Gift wrapping
```

## Render as new view {#render-as-new-view}

*Render as new view*, over a `SELECT` or `CONSTRUCT` result, makes a diagram of the elements and
relationships the result mentions, laid out as [*Arrange view*](canvas.md#arrange-view) lays a diagram
out, with the choices last made there: in rows, the relationships among them routed at right angles.
It asks for the view's name, *New view*, with what it will hold in the field's label (*Name — 4
elements, 2 relationships*); the name proposed is the question asked, or *Query results*. A view of a
question's answer follows the question's viewpoint. A result that mentions no element of the model says
so, and makes nothing.

The Graph tab's *＋ New view* makes a view the same way ([Graph](graph.md#new-view)).

1. Run the query below.
2. Choose *Render as new view*.
3. Name it "What realizes what", and choose *OK*: a diagram with "Payments", "Card payment", "Web
   shop" and "Online ordering", and the two Realizations.

```sparql
PREFIX am4: <https://meta.linked.archi/archimate4/onto#>
PREFIX arch: <https://meta.linked.archi/core#>

CONSTRUCT {
  ?realization arch:source ?application ;
               arch:target ?service .
} WHERE {
  ?realization a am4:Realization ;
               arch:source ?application ;
               arch:target ?service .
}
```
