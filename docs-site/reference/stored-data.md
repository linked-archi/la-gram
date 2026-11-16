---
title: Data kept on your machine
description: What la-gram keeps in the browser's or the desktop app's storage, under which key, and how to clear it.
---
# Data kept on your machine

la-gram has no server of its own and no account: what it remembers, it keeps on your machine. In the
web app that is this browser profile's storage for the app's site; in the desktop app, the app's own
storage on the computer. None of it is in the model, and la-gram sends none of it to a server of its
own: a Git token goes only to its Git host, when you use Git storage.

| Where | Holds |
|---|---|
| `localStorage`, keys starting `la-gram:` | settings, module switches, panel sizes and choices, Git bindings, and, if you ask, Git tokens in the web app |
| IndexedDB `la-gram-history` | History checkpoints |
| the desktop app's `secrets.json` | Git tokens, encrypted |

To see them in a Chromium-based browser: open the developer tools, then *Application* › *Storage*. To
clear them all, clear the site's data for app.linked.archi in the browser's settings. That also forgets
remembered tokens and History checkpoints, and cannot be undone.

What the storage held after opening the example model, choosing *Default branch* `main` in
*File › Settings…* › *Git storage* and switching Git storage off under *Modules*:

```json
{
  "la-gram:modules": "{\"git\":false}",
  "la-gram:settings": "{\"git\":{\"branch\":\"main\",\"rememberByDefault\":false}}"
}
```

A key appears only once there is something to keep: the panel keys below, for example, once a bottom
tab is opened, or a panel folded or resized.

## Settings {#settings}

`localStorage` key `la-gram:settings`: your *File › Settings…*, one JSON object per part of la-gram.

| Part | Holds |
|---|---|
| `metamodels` | `hidden`: the catalogue entries unticked in *Metamodels*, by IRI |
| `git` | the *Git storage* tab's fields: `repository`, `branch`, `folder`, `message`, `branchPrefix`, and `rememberByDefault` |

An empty field is not kept: the deployment's value, or la-gram's, applies. If the browser refuses
storage, settings hold for the session only.

## Modules {#modules}

`la-gram:modules`: your switches in *File › Settings…* › *Modules*, as `{ "git": true }` or
`{ "git": false }`. Absent, the deployment's default applies ([configuration](configuration.md#modules)).
`?git=off` in the address is not kept here.

## Panel sizes {#panel-sizes}

Sizes are in pixels, each kept when you drag a panel's edge.

| Key | Holds | First | Smallest |
|---|---|---|---|
| `la-gram:explorer-panel-width` | the model tree's width | **260** | 160 |
| `la-gram:palette-panel-width` | the palette's width | **250** | 180 |
| `la-gram:rdf-panel-width` | the RDF panel's width | **440** | 280 |
| `la-gram:bottom-panel-height` | the bottom panel's height | **280** | 120 |
| `la-gram:bottom-panel-tab` | the bottom panel's open tab | **`properties`** | — |
| `la-gram:bottom-panel-folded` | whether the bottom panel is folded to its tabs | **`false`** | — |
| `la-gram:guide-height` | the *About ‹type›* section's height, under the model tree | **300** | 90 |
| `la-gram:guide-folded` | whether *About ‹type›* is folded | **`false`** | — |

## Canvas switches {#canvas-switches}

| Key | The switch |
|---|---|
| `la-gram:canvas-relationship-names` | *Relationship names*, on the canvas toolbar |
| `la-gram:canvas-notation-only` | *Notation only*, on the canvas toolbar |
| `la-gram:canvas-figures` | whether the *Shapes* row is open |
| `la-gram:picker-show-iris` | *Show IRIs*, in the type pickers |

Each is off until you switch it on.

## Panel choices {#panel-choices}

| Key | Holds | Default |
|---|---|---|
| `la-gram:property-panel-tab` | the property panel's open tab | **the first** |
| `la-gram:property-panel-relationships-open` | whether the *Relationships* group of the *Properties* tab is open | **folded** |
| `la-gram:explorer-grouping` | the model tree by `folders` or by `types` | **`folders`** |
| `la-gram:rdf-scope` | the RDF panel's scope | **View** |
| `la-gram:validation-scope` | the Validation tab's scope | **View** |
| `la-gram:graph-depth`, `la-gram:graph-layout`, `la-gram:graph-query-form` | the Graph tab's depth, layout and query form | **2**, **Force**, **SELECT** |
| `la-gram:graph-forces` | the Graph tab's [*Forces*](../guide/graph.md#forces), *Link distance*, *Charge strength* and *Collision radius*, as one JSON object: `{"linkDistance":180,"chargeStrength":-350,"collideScale":1}`, the charge as d3-force takes it, negative. Written when a slider is let go or a key moves it; a value out of range, or between two steps, is read as the nearest its slider offers, anything unreadable as the default. *Reset* removes the key | **180 px**, **350**, **1.0×** |
| `la-gram:arrange-view` | [*Arrange view…*](../guide/canvas.md#arrange-view)'s *Direction*, *Spacing* and *Group by band*, as one JSON object: `{"direction":"DOWN","spacing":"normal","bands":true}`. Written when *Arrange* is chosen; a value it does not know is read as the default. Also used for a model opened with no geometry and for *Render as new view* | **Down**, **Normal**, **on** |
| `la-gram:arrange-grid` | [*Align to grid…*](../guide/canvas.md#align-to-grid)'s *Grid* and *Align*, as one JSON object: `{"grid":20,"axis":"both"}`. Written when *Align* is chosen; also what the *Align to grid* button uses | **20**, **both** |
| `la-gram:arrange-sizes` | [*Sizes…*](../guide/canvas.md#sizes)'s *Make them* and *Change*, as one JSON object: `{"reference":"largest","dimension":"both"}`. Written when *Resize* matches sizes; also what the *Match* buttons use | **largest**, **both** |
| `la-gram:palette-notices-closed` | the [notices about incomplete metamodels](../guide/palette.md#incomplete) closed with ✕, as a JSON array, each the metamodel's IRI and what the notice said: `["https://meta.linked.archi/atam/metamodel#ATAM it names no classification…"]`. A notice that reads differently is shown again | **none closed** |
| `la-gram:about-sections` | which sections of *About ‹type›* are open | **as la-gram opens them** |
| `la-gram:matrix-axes:<viewIri>` | a matrix view's row and column types, per view | **the two most common types** |

## Git {#git}

| Key | Holds |
|---|---|
| `la-gram:git-bindings` | for each model, by its IRI, the Git file it was opened from or saved to: repository, branch, path and the version last seen |
| `la-gram:git-last-repository` | the repository used last, which *Save to Git…* proposes when nothing else does |
| `la-gram:git-hosts` | the kinds learned for self-hosted hosts: `github` or `gitlab`, per host |

*File › Settings…* › *Git storage* forgets the learned host kinds (*Forget the host kinds learned*).

## Git tokens in the web app {#git-tokens}

`la-gram:git-tokens`: the access tokens you asked the web app to remember, per host.

- An access token is kept **in memory** for the session. A reload, or closing the tab, forgets it, and
  the next Git action asks for it again.
- Ticked, *Remember on this browser (stored unencrypted; anyone using this browser profile can read it)*
  keeps it in this key, as plain text, until you forget it in *File › Settings…* › *Git storage* or
  clear the site's data. It is unticked at first, unless you change *Offer to remember a new token,
  ticked* in *Settings*.
- A deployment that sets [`rememberTokens`](configuration.md#git-remembertokens) to `never` offers no
  *Remember*, and la-gram neither reads nor writes this key.

!!! warning "Remembered tokens are stored unencrypted"

    A token remembered in the web app can be read by anyone who can use this browser profile, and by any
    script that runs on the app's site. Remember one only on a machine and profile that are yours, give
    the token no more than the repositories and the scopes la-gram needs, and give it an expiry date. The
    desktop app keeps tokens encrypted instead ([below](#desktop-secrets)).

## History checkpoints {#checkpoints}

IndexedDB database `la-gram-history`, store `commits`: the checkpoints of the History tab, per model,
each with its message, its time, the model's triples, and its author when it was saved in a
collaboration room ([`user`](url-parameters.md#user)). They stay when you close la-gram,
and are not in the model file. Git commits of a model bound to Git are not kept here; History reads them
from the repository.

## Desktop app secrets {#desktop-secrets}

The desktop app keeps Git tokens in `userData/secrets.json`, in the app's data folder (Electron's `userData`:
`~/Library/Application Support/la-gram` on macOS, `%APPDATA%\la-gram` on Windows,
`~/.config/la-gram` on Linux). Each token is encrypted by the system's keychain (`safeStorage`), keyed
`git:<host>`, and the file is readable by your user only.

On Linux without a keyring, where the encryption would fall back to a fixed key, no token is written:
each is kept for the session only. The desktop app's other data (settings, panel sizes, checkpoints) is
in the same folder, as a browser would keep it.

## What is not kept {#not-kept}

These are **not kept** between visits, on purpose or for now:

- **The model you are working on.** la-gram has no autosave: an unsaved model is lost when the tab
  reloads or closes, and la-gram asks first ([no autosave](../troubleshooting.md#no-autosave)). Save it to
  a file or to Git, or save a checkpoint in History, which is kept.
- **Whether the model tree, the palette and the RDF panel are shown.** Each starts as la-gram starts it:
  tree and palette shown, RDF panel closed unless the address has [`rdf=1`](url-parameters.md#rdf).
  Their sizes are kept.
- **A maximized panel**: a reload starts with it restored.
- **The presentation** chosen in the toolbar: each visit starts with *Default notation*.
- **Recent folders** of *Move to folder…*: for the session only.
- **A Git token** not remembered, as above.
