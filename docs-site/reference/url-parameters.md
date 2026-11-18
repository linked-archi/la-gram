---
title: URL parameters
description: Every URL parameter the la-gram web app reads, with its values, its default and an example link.
---
# URL parameters

The web app reads these parameters from its address once, as it starts. They follow the `?` and combine
with `&`. Reload the page to apply a changed one. A parameter la-gram does not know is ignored.

The desktop app always loads its own page with no address of yours, so none of these reach it.

| Parameter | Values | Default |
|---|---|---|
| [`metamodel`](#metamodel) | metamodel IRIs, repeated or comma-separated | **ArchiMate 4.0** |
| [`assets`](#assets) | `bundled-first`, `remote-first`, `offline` | **`bundled-first`** |
| [`model`](#model) | the address of a model file | **none**: an empty model |
| [`room`](#room) | a room name | **none**: no collaboration |
| [`ws`](#ws) | a WebSocket address | **`ws://localhost:1234`** |
| [`user`](#user) | a display name | **`Guest NNN`** |
| [`rdf`](#rdf) | `1` | **closed** |
| [`base`](#base) | an `https:` or `http:` IRI | **`https://example.org/`** |
| [`git`](#git) | a link to a model file in Git, or `off` | **none** |
| [`<module-id>=off`](#module-off) | `off` | **on** |

Write a `#` inside a value as `%23`, and a space as `%20`. Otherwise the browser takes everything after a
`#` for the page's fragment, and la-gram never sees it.

The example model, with the RDF panel open and nothing fetched from meta.linked.archi:

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&rdf=1&assets=offline
```

## `metamodel` {#metamodel}

The metamodels la-gram loads as it starts, in place of ArchiMate 4.0. The value is a metamodel's IRI, as
the [catalogue](https://meta.linked.archi/) gives it. Give several by repeating the parameter, by
separating IRIs with commas in one value, or both. The **first** one loaded is the primary metamodel: the
notation part of a new model's namespace comes from it (see [`base`](#base)). A new model conforms to
every metamodel loaded.

- **Default:** ArchiMate 4.0, `https://meta.linked.archi/archimate4/metamodel#ArchiMate4`.
- **Where it comes from:** the bundle or meta.linked.archi, in the order [`assets`](#assets) sets.
- **A metamodel that does not load** is left out, and the app starts with the others. With none loaded,
  the palette is empty until you add one from *Metamodels*.
- **Opening a model** loads the metamodels it declares as well, whatever this parameter said.

ArchiMate 3.2 instead of 4.0:

```text
https://app.linked.archi/la-gram/?metamodel=https://meta.linked.archi/archimate3/metamodel%23ArchiMate3.2
```

ArchiMate 3.2 first, then Basic, comma-separated, and the same with the parameter repeated:

```text
https://app.linked.archi/la-gram/?metamodel=https://meta.linked.archi/archimate3/metamodel%23ArchiMate3.2,https://meta.linked.archi/basic/metamodel%23Basic
https://app.linked.archi/la-gram/?metamodel=https://meta.linked.archi/archimate3/metamodel%23ArchiMate3.2&metamodel=https://meta.linked.archi/basic/metamodel%23Basic
```

*Metamodels › Loaded* then lists *ArchiMate 3.2 Metamodel* and *Basic Metamodel*, ArchiMate 3.2 first.

## `assets` {#assets}

Where metamodel documents come from, and in which order la-gram tries the sources. A file you uploaded
with *Metamodels › Upload metamodel or asset file…* is always tried first.

| Value | Order | When to use it |
|---|---|---|
| **`bundled-first`** | the bundle, then meta.linked.archi for what the bundle lacks | the default: fast, and the same every time |
| `remote-first` | meta.linked.archi, then the bundle when the site cannot be reached | to see a metamodel as it is published today |
| `offline` | the bundle only | nothing is fetched from meta.linked.archi, not even the catalogue |

- **Default:** `bundled-first` in the web and desktop apps. Any other value is ignored, and the default
  applies.
- **The catalogue** that *Metamodels* lists is bundled too. Unless the mode is `offline`, la-gram also
  fetches the published catalogue from meta.linked.archi, and it replaces the bundled one when it arrives.
- **With `offline`**, a metamodel that is not bundled does not load.

```text
https://app.linked.archi/la-gram/?assets=offline
https://app.linked.archi/la-gram/?assets=remote-first
https://app.linked.archi/la-gram/?assets=bundled-first
```

## `model` {#model}

The address of a model file to open as la-gram starts. la-gram fetches it, asking for Turtle
(`Accept: text/turtle`), and opens it as *File › Open…* would. The model is named after the last part of
the address, `shop.ttl` here.

- **Default:** none. la-gram starts with an empty model.
- **Relative addresses** are taken from the app's own address, so `docs/examples/shop.ttl` is the example
  model these pages use. An address on another site works only if that site allows it, with CORS
  (`Access-Control-Allow-Origin`).
- **The format** comes from the file's extension, as with *File › Open…*: `.ttl`, `.trig`, `.jsonld`,
  `.nq`, `.nt` or `.rdf`.
- **A file that cannot be fetched or opened** is reported in the browser's console only. The app starts
  with an empty model and no message. See
  [A model link does not open](../troubleshooting.md#model-link-does-not-open).
- **With [`room`](#room)**, the model opens first. If the room is new, this model goes into it. If the
  room already holds a model, the room's model replaces it.

The example model, by a relative and by an absolute address:

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl
https://app.linked.archi/la-gram/?model=https://app.linked.archi/la-gram/docs/examples/shop.ttl
```

What the console says when a model on another site cannot be fetched, and when a file is not there:

```text
[la-gram] Could not open https://models.example.org/acme/shop.ttl TypeError: Failed to fetch
[la-gram] Could not open docs/examples/missing.ttl Error: 404 Not Found
```

## `room` {#room}

The collaboration room to join as la-gram starts. Everyone in the same room on the same server edits the
same model. *Share*, in the toolbar, puts the parameter into the address for you.

- **Default:** none. Nothing connects until you choose *Share*.
- **A new room** receives the model la-gram has open. A room that already holds a model replaces the
  open one with its own.
- **The server** is the one [`ws`](#ws) names, `ws://localhost:1234` by default. Your name is
  [`user`](#user)'s.
- What collaboration does is in [Collaboration](../guide/collaboration.md). How to run a server is in
  [Collaboration server](../operating/collaboration-server.md).

```text
https://app.linked.archi/la-gram/?room=acme-review
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&room=acme-shop-draft
```

The second link puts the example model into the room `acme-shop-draft` when it is new. Opened again by
someone else, once the room has the model, the same link gives them the room's model, with what was
changed there since.

## `ws` {#ws}

The collaboration server's WebSocket address, used when a room is joined, by [`room`](#room) or by
*Share*.

- **Default:** `ws://localhost:1234`, the address `npm run collab` listens on.
- **On app.linked.archi** and any site served over HTTPS, use `wss://`. The site's
  Content-Security-Policy allows `wss:` connections only, and browsers refuse `ws://` from an HTTPS page.
  [Hosting the web app](../operating/web-app.md#behind-tls) says how to put the server behind TLS.
- The desktop app may connect to `ws:` and `wss:` addresses, but it reads no URL parameters: it always
  uses the default.

```text
https://app.linked.archi/la-gram/?room=acme-review&ws=wss://collab.example.org
```

## `user` {#user}

The name others in the room see beside your presence avatar. It is also the author of the History
checkpoints you save while in the room.

- **Default:** `Guest` and a random number from 100 to 999, such as `Guest 482`, new at each load.
- Write a space as `%20`.

```text
https://app.linked.archi/la-gram/?room=acme-review&ws=wss://collab.example.org&user=Jane%20Doe
```

## `rdf` {#rdf}

`rdf=1` starts with the RDF panel open, beside the canvas: the model, view or selection as Turtle or
another format ([The RDF panel](../guide/rdf-panel.md)).

- **Default:** closed. Only the value `1` opens it: `rdf=true` or `rdf=yes` leave it closed.
- Whether the panel is open is not remembered between visits. Open it from the toolbar's *RDF* button.

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&rdf=1
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&rdf=true
```

The first opens the panel; the second does not.

## `base` {#base}

Where the namespaces of new models start. *File › New model* proposes `{base}{notation}/{uuid}/`, where
the notation is the metamodel's slug (`archimate` for both ArchiMate versions) and the UUID is new for
each model.

- **Default:** `https://example.org/`.
- **A base without a trailing `/`** gets one: `https://example.org/acme` gives
  `https://example.org/acme/archimate/…/`.
- **A value that is not an `https:` or `http:` IRI, or holds a `#` or a `?`** (`not an iri`,
  `urn:acme:`, say) is ignored, and the default applies, with no message.
- Models you open keep their own namespace. *File › Model settings…* changes it afterwards.

```text
https://app.linked.archi/la-gram/?base=https://example.org/acme/
https://app.linked.archi/la-gram/?base=https://example.org/acme
```

With either, *File › New model* proposes a namespace such as
`https://example.org/acme/archimate/0fc63d62-…/`.

## `git` {#git}

The Git storage module ([Git storage](../guide/git.md)) reads this parameter.

- **A link to a model file** in a GitHub or GitLab repository: la-gram opens that file from Git when the
  module starts, as *File › Open from Git…* would. A link to a private repository asks for an access
  token first. A link on a host the [deployment](configuration.md#git-hosts) does not allow is refused.
  The link is used once: switching the module off and on does not open it again.
- **`off`**: Git storage is off for this session. See [`<module-id>=off`](#module-off).
- **Default:** none. Git storage is on, and opens nothing.
- In a build without Git storage, or where the deployment makes it `unavailable`, the parameter does
  nothing.

```text
https://app.linked.archi/la-gram/?git=https://git.example.com/acme/architecture/-/blob/main/models/shop.ttl
https://app.linked.archi/la-gram/?git=off
```

## `<module-id>=off` {#module-off}

Any parameter whose value is `off` switches the module with that id off for this session. Off, a module
shows nothing, loads none of its code and talks to no one. The one module today is Git storage, id `git`,
so `?git=off` is the only one with an effect.

- **Default:** every module as the deployment and your *File › Settings…* have it, on unless one says
  otherwise.
- **For the session only.** Nothing is remembered: the next visit without the parameter has the module
  as before.
- **Your choice wins afterwards.** Ticking the module in *File › Settings…* › *Modules* switches it on for
  the rest of the session, and remembers it.
- **The order of the sources** is in [configuration](configuration.md#precedence).

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&git=off
```

The *File* menu then has no *Open from Git…*, *Save to Git…* or the other Git entries.
