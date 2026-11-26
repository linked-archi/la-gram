---
title: Troubleshooting and FAQ
description: Answers to common problems with la-gram, how to report one, and what la-gram does not do yet.
---
# Troubleshooting and FAQ

## A model link does not open {#model-link-does-not-open}

An address with [`?model=`](reference/url-parameters.md#model) starts la-gram with an empty model, and no
message. la-gram could not fetch or open the file, and says why **in the browser's console only**: open
the developer tools (++f12++, or ++option+cmd+i++ on a Mac) and look for a line starting
`[la-gram] Could not open`.

```text
[la-gram] Could not open https://models.example.org/acme/shop.ttl TypeError: Failed to fetch
[la-gram] Could not open docs/examples/missing.ttl Error: 404 Not Found
```

| The console says | Usually because |
|---|---|
| `TypeError: Failed to fetch` | the file is on another site, which does not allow it: it must send `Access-Control-Allow-Origin` (CORS). Or the address is wrong, or the site is down |
| `Error: 404 Not Found`, or another status | the address is wrong, or the file is not there |
| a parse error | the file is not RDF in the format its extension says |

Try the file with *File › Open…* after downloading it: that names the problem in la-gram's own message.
A model on GitHub or GitLab opens with [`?git=`](reference/url-parameters.md#git) instead, which asks the
host's API and needs no CORS from you.

## Git storage is off {#git-storage-is-off}

The *File* menu has no *Git ▸* submenu, with *Open from Git…* and *Save to Git…*. One of these switched Git storage off; the
first that applies wins ([which source wins](reference/configuration.md#precedence)):

1. **The build** left it out (`LA_GRAM_GIT=off`). Nothing turns it on but another build.
2. **The deployment's configuration failed its check.** la-gram said so as it started, in a message ending
   *Git storage is off until it is fixed.*, and in the console. An unknown key inside a `git.hosts` entry
   is enough: unlike unknown keys elsewhere, it fails the file
   ([unknown key in a host entry](reference/configuration.md#git-hosts-unknown-keys)).
3. **The deployment makes it `unavailable`**, or `off` until you switch it on.
4. **The address has `?git=off`**: for this visit only.
5. **You switched it off** in *File › Settings…* › *Modules*.

To switch it back on:

1. Choose *File › Settings…*. If there is a *Modules* tab with Git storage unticked, tick it and choose
   *Apply*: la-gram says *Git storage is on.*
2. If there is no *Modules* tab, the build or the deployment decides: ask whoever runs your installation,
   and give them the message la-gram showed as it started.

A deployment's `modules` takes any id without a word, so a misspelt `"gti": "off"` changes nothing: Git
storage stays on.

## Python for `npm run dev` {#python-for-npm-run-dev}

`npm run dev`, `npm start` and `npm run serve` serve `dist/web` with `python3 -m http.server`: without
Python 3 they build the app and then stop, with `python3: command not found` or the like. Install Python 3,
or serve `dist/web` with any static server that sends `.wasm` as `application/wasm`
([Building](developing/building.md#requirements)).

Google Chrome is needed too, for `npm run test:browser`, `npm run bench`, `npm run icons` and
`npm run docs:screenshots`; `LA_GRAM_CHROME` names another
([Testing](developing/testing.md#chrome)).

```sh
python3 --version
python3 -m http.server 41238 --directory dist/web
```

## The token was forgotten after a reload {#token-forgotten-after-reload}

In the web app, an access token is kept **in memory** for the session: a reload, or closing the tab,
forgets it, and the next Git action asks again. That is on purpose.

- To keep it on this browser, tick *Remember on this browser (stored unencrypted; anyone using this
  browser profile can read it)* in the token dialog. It is then kept in `localStorage`, as plain text,
  until you forget it in *File › Settings…* › *Git storage* ([stored data](reference/stored-data.md#git-tokens)).
- The desktop app keeps a token encrypted with the system's keychain, and offers *Remember* ticked.
- If the dialog offers no *Remember*, the deployment set `rememberTokens` to `never`
  ([configuration](reference/configuration.md#git-remembertokens)): tokens are for the session only.

!!! warning "A remembered web token is readable"

    Remember a token only on a machine and browser profile that are yours, and give it the narrowest
    scope and an expiry date.

1. Choose *Save to Git…* and give your token, with *Remember on this browser* ticked.
2. Reload: the next *Save to Git…* does not ask for it.

## Changes were lost: no automatic local recovery copy {#no-autosave}

la-gram keeps no automatic local recovery copy of the model you are working on. Optional
[auto-commit](guide/git.md#auto-commit) saves to Git only when enabled for that destination, and may be
paused or still waiting. Unsaved edits are lost when the tab reloads or closes; la-gram asks first, with the browser's *Leave site?* question, or
the desktop app's *Close without saving* / *Cancel*.

- **Save** to a file (*File › Save*) or to Git (*Save to Git…*).
- **A checkpoint** in the History tab is kept on this machine, across reloads, and can be restored
  ([History](guide/history.md)). It is not a file: clearing the site's data removes it.
- **In a collaboration room**, the server keeps the model, and la-gram does not ask before you leave.

A checkpoint across a reload:

1. Make a change, then open the History tab and save a checkpoint, "Before the payments".
2. Reload, and open the same model again: *History* lists the checkpoint, and *Restore* brings the model
   back to it.

## Undo does not undo it {#undo}

Undo (++ctrl+z++, ++cmd+z++ on a Mac) reverses what you did **in the open view**: placing, moving,
connecting, renaming, deleting from the view, and property edits. It does not reverse:

- **a change from elsewhere**: a collaborator's edit, an import, a model opened over the old one;
- **a deletion from the model tree** of a concept that is not on the canvas;
- **what you did in another view**: each view has its own undo history, and it starts again when another
  view opens.

To get back to an earlier state, use a History checkpoint ([History](guide/history.md#restore)), or Git.

1. Rename *Gift wrapping* on the canvas, then press ++ctrl+z++: the old name is back.
2. Rename it again, open *Who is who*, and come back: ++ctrl+z++ does nothing, since the view's history
   started again.

## Files in the desktop app {#files-in-the-desktop-app}

The desktop app opens and saves files the way the web app does: *File › Open…*, *Import* and
*Upload* show the system's file chooser through the page, and *Save*, *Save as …* and *Export* hand the
file over as a download. They do not yet use the desktop bridge's own Open and Save dialogs
([Desktop app internals](reference/desktop.md#bridge)).

Where a saved file goes is up to Electron's handling of downloads, which normally asks where to save it.
This was not tested in a packaged app. If a save seems to do nothing, look in your *Downloads* folder.

1. In the desktop app, choose *File › Save*.
2. Choose where to save the file if asked; otherwise look for `<model name>.ttl` in *Downloads*.

## Reporting a problem {#reporting-a-problem}

1. Open la-gram's menu, at the top left, and choose *About la-gram*.
2. Choose *Copy version info*: la-gram copies one line with its version, where it runs, the metamodels
   loaded and the bundle's snapshot.
3. Choose *Report a problem or an idea*, in the same menu, which opens la-gram's issues on GitHub, and
   paste the line into a new issue, with what you did, what you expected, and what happened. A model
   file that shows the problem helps; use one without confidential content.

```text
la-gram 0.1.0 · Web — Chrome 156 · metamodels: ArchiMate 4.0 Metamodel · bundled metamodels: e4882df07d49
```

## Not yet in la-gram {#not-yet-in-la-gram}

These are not available in la-gram today. Some are planned; none is promised for a given release.

- **Running derivation rules.** la-gram shows the derived relationships a file brings, and confirms one
  into the model on request; it does not derive them itself.
- **Decision modelling.**
- **Validation on a server.** Validation runs in your browser, and in `la-gram-git check`.
- **Collaborators' cursors.** Their selections show, and lock what they selected; their pointers do not.
- **Working offline across reloads** in a collaboration room: changes made while disconnected are kept
  only while the page stays open.
- **Shared checkpoints.** History checkpoints are on your machine only.
- **A file with several models.** A file holds one model.
- **A collaboration room bound to a Git branch.**
- **Automatic Git commits.** Regular checks and optional automatic pull are available; use
  *Save to Git* to commit local changes.
- **More than two panes**, dragging an element from one pane into the other, and the split kept over a
  reload ([Two views at once](guide/models-and-views.md#split-view)).

### Pasting does nothing {#copy-and-paste}

- **The focus is in a field or a panel:** ++ctrl+v++ (++cmd+v++) pastes there, not on the diagram. Click an
  empty part of the diagram first.
- **What is on the clipboard is not la-gram's:** ++ctrl+v++ pastes on the diagram only what la-gram
  copied — here or in another la-gram window. Copy on a diagram or in the model tree first.
- ***Paste as copies*, *Paste as references*, *Duplicate* and the right-click menu's *Paste*** paste what
  this window copied last, or last pasted: a page cannot read the clipboard without asking. After copying
  in another window, press ++ctrl+v++ (++cmd+v++) once here first.
- **In the desktop app**, the Edit menu has *Cut*, *Copy* and *Paste*; the other pastes and *Duplicate* are
  on the keys and the right-click menu.

See [Copy and paste](guide/canvas.md#copy-and-paste).
