---
title: Settings
description: la-gram's personal settings, under File › Settings…, with which metamodels the menu offers, which modules are on, and Git storage's defaults and tokens.
---
# Settings

*File › Settings…* holds what you set for yourself, kept on this machine. What the installation sets,
in its [deployment configuration file](../reference/configuration.md), is shown and not offered for
change.

## The dialog {#the-dialog}

*File › Settings…* (*modules, defaults*) opens *Settings*: *Kept on this machine, and applied at once.
What the deployment sets is shown, not offered for change.* It has a tab for each part:

| Tab | Shown |
|---|---|
| *Metamodels* | always |
| *Git storage* | while Git storage is on |
| *Modules* | when there is a module to switch |

*Apply* applies every tab at once; *Cancel*, or ++esc++, changes nothing. ++up++ and ++down++ move
through the tabs. A field with a problem opens its tab, marked, and *Apply* waits until it is put right.
*Metamodels › Choose which to show…* opens the dialog at its *Metamodels* tab. The settings are kept in
this browser's `localStorage` (in the desktop app, on the computer), not in the model.

1. Choose *File › Settings…*.
2. Click *Git storage*, change a field, and choose *Apply*.

## Metamodels tab {#metamodels-tab}

*Which metamodels the Metamodels menu offers.* The tab has a checkbox for each catalogue entry, grouped
as the menu groups them, *Core*, *Modelling languages*, *Frameworks* and *Extensions*, each group with
*All* and *None*. Every one is **ticked** at first. Unticked, an entry is left out of the menu: a
metamodel that is loaded is listed there anyway, and *Load by IRI…* reaches any. What is kept is the
entries hidden, so a metamodel the catalogue gains later is offered.

1. Choose *Metamodels › Choose which to show…*.
2. Under *Extensions*, choose *None*, and *Apply*. The menu has no *Extensions* section, and
   *Choose which to show…* says how many are hidden.

## Modules tab {#modules-tab}

*Parts of la-gram that can be switched off. Off, a module shows nothing, loads nothing and talks to no
one.* There is one module, Git storage, with its checkbox:

| Checkbox | Default | Does |
|---|---|---|
| *Git storage — open a model from a GitHub or GitLab repository, and save it there as a commit* | **on**, or what the deployment says | switches Git storage on or off, at once and at the next start |

A deployment can set the module `off` (until you switch it on here) or `unavailable` (not offered).
`?git=off` in the address switches it off for that session only, and a build can leave it out.

1. Choose *File › Settings…*, and *Modules*.
2. Untick the Git storage box, and choose *Apply*. la-gram says "Git storage is off.", and the *File*
   menu has no Git entries.

```text
https://app.linked.archi/la-gram/?git=off
```

## Git storage tab {#git-storage-tab}

*Where Save to Git and Open from Git start, for a model not bound to a file. Empty: the default the hint
names.* Each field's hint says what an empty one means.

| Field | Values | Empty means |
|---|---|---|
| *Git hosts allowed* | read only, shown when the deployment lists hosts: each with its kind | — |
| *Default repository* | an `https://` link to a repository | the deployment's, else **the last one used** |
| *Default branch* | a branch name | the deployment's, else **the repository's default** |
| *Folder for new files* | a folder in the repository, `models` or `arch/models`; `.` for its top | the deployment's, else **`models`** |
| *Commit message* | a template: `{action}` (Add, Update), `{model}`, `{path}`, `{branch}` | **`{action} {model}`** |
| *New branch names start with* | text | **`la-gram/`** |
| *Remember tokens* | read only, when the deployment says `never`: *Never: a token is kept for the session only* | — |
| *Offer to remember a new token, ticked* | a checkbox: whether the access token dialog's *Remember* starts ticked | **off** in the web app, **on** in the desktop app |
| *Forget the token for* a host | a checkbox for each host with a token kept: ticked, *Apply* forgets it, in memory and remembered | — |
| *Forget the host kinds learned* | a checkbox, with the hosts la-gram has learned to be GitHub or GitLab: ticked, *Apply* forgets them | — |

*Apply* checks the fields first, and a problem opens the tab: a repository link it cannot read (or on a
host the deployment does not allow), a branch name Git would refuse, a folder that starts with `/` or has
`.` or `..` in it, and a prefix a branch name **cannot start with** (*New branch names cannot start with
“…”.*).

1. Choose *File › Settings…*, and *Git storage*.
2. In *Default branch*, type `main`; in *Folder for new files*, `architecture/models`; and in
   *Commit message*, `{action} {model} on {branch}`.
3. Choose *Apply*. The next *Save to Git…* proposes `architecture/models/acme-online-shop.ttl`, and the
   message "Add Acme online shop on main".

What a deployment sets shows here as it is. With this deployment configuration, *Git hosts allowed*
lists the two hosts, *Remember tokens* says *Never*, and *Folder for new files* is `architecture/models`
when empty:

```json title="la-gram.config.json"
{
  "git": {
    "hosts": [
      { "host": "github.com", "kind": "github" },
      { "host": "git.example.com", "kind": "gitlab" }
    ],
    "rememberTokens": "never",
    "defaults": { "folder": "architecture/models" }
  }
}
```
