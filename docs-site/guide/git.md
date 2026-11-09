---
title: Git storage
description: How la-gram opens a model from a GitHub or GitLab repository and saves it there as a commit, merges newer versions, resolves conflicts and opens merge requests.
---
# Git storage

Git storage opens a model from a GitHub or GitLab repository, and saves it there as a commit: github.com,
gitlab.com, GitHub Enterprise Server and self-managed GitLab, through their REST APIs, with nothing to
install. A model saved or opened this way stays bound to its file, so the next save asks only for a
message, and a save never overwrites a change it has not seen.

Git storage is a module: [*File › Settings… › Modules*](settings.md#modules-tab) or `?git=off` switches it
off for a session, and an installation can leave it out
([Deployment configuration file](../reference/configuration.md)).

```text
https://app.linked.archi/la-gram/?git=off
```

## File menu {#file-menu}

Git storage adds its entries to the *File* menu, after *Import ArchiMate exchange…* and after *Save
without diagram geometry*:

| Entry | Shown | Does |
|---|---|---|
| *Open from Git…* | always | opens a model from a repository |
| *Save to Git…* | the model is not bound to a file | commits it as a new file, or over one |
| *Save to Git* | the model is bound, its repository and branch beside it | commits it to its file, asking for a message |
| *Save to Git as…* | bound | commits it to another branch or file |
| *Update from main…* | bound | merges another branch into the bound one |
| *Open merge request…* | bound | proposes the bound branch for merging (*a pull request from* the branch, on GitHub) |

1. Open *File*: with Git storage on, *Open from Git…* is under *Import ArchiMate exchange…*.
2. Save the model to Git once: *Save to Git…* becomes *Save to Git*, with its repository and branch.

## Open from Git {#open-from-git}

*File › Open from Git…* asks for:

| Field | Default | What it is |
|---|---|---|
| *Address* | your default repository, else the last one used, else the deployment's | a link as the browser shows it (see [Links](#links)) |
| *Host* | **Decided by the address (github.com, gitlab.com)** | or *GitHub (also GitHub Enterprise Server)*, *GitLab (also self-managed)*: for a host whose kind the address does not say |
| *Branch* | your default branch, else empty | empty: the one the address names, or the repository's default |

A link to a file opens it. A link to a repository, a branch or a folder lists its model files to choose
from, with *Another branch…* to list another branch's. Opening replaces the open model, after asking if
it has unsaved changes. A public repository opens without a token; a private one asks for one ([Access
tokens](#access-tokens)).

1. Choose *File › Open from Git…*.
2. In *Address*, paste the repository's link, `https://github.com/acme/architecture`.
3. Choose *Open*, then the model file in the list.

A model can open from Git as la-gram starts, with `?git=` and the file's link:

```text
https://app.linked.archi/la-gram/?git=https://git.example.com/architecture/models/-/blob/main/shop.ttl
```

## Links {#links}

The address is a link as the browser's address bar has it, or as *Clone* gives it.

| Link | Names |
|---|---|
| `https://github.com/acme/architecture` | a GitHub repository |
| `…/tree/main`, `…/tree/main/models` | a branch, a folder on it |
| `…/blob/main/models/shop.ttl` | a file on a branch |
| `https://gitlab.com/acme/architecture/models/-/blob/main/shop.ttl` | GitLab, subgroups and all (`/-/` marks GitLab) |
| `git@github.com:acme/architecture.git` | the SSH address, read as the HTTPS one |

The host decides the kind: github.com and gitlab.com are what they are; a `/-/` in the path is GitLab's;
a host with `github.` in its name is taken as GitHub Enterprise, any other as a self-managed GitLab,
unless *Host* says otherwise. The API is `https://api.github.com`, `https://<host>/api/v3` (GitHub
Enterprise) or `https://<host>/api/v4` (GitLab). Links must be `https://`, with no user name or token in
them. A branch with a slash in its name (`feature/x`) cannot be told from the folder after it: the link's
first segment is taken as the branch, and the dialog shows both to correct.

```text title="Git link"
https://github.com/acme/architecture
https://github.com/acme/architecture/tree/main/models
https://github.com/acme/architecture/blob/main/models/shop.ttl
https://gitlab.com/acme/architecture/models/-/blob/main/shop.ttl
https://git.example.com/architecture/models/-/tree/main/models
https://github.example.com/acme/architecture/blob/main/models/shop.ttl
git@github.com:acme/architecture.git
```

## Save to Git {#save-to-git}

*File › Save to Git…*, for a model not bound to a file, asks where:

| Field | Default | What it is |
|---|---|---|
| *Repository* | your default repository, else the last one used, else the deployment's | the repository's link |
| *Host* | **Decided by the address** | as for *Open from Git…* |
| *Branch* | your default branch, else **empty**: the repository's default | the branch to commit to, or to start the new one from |
| *New branch* | **empty**: commit to the branch | a branch to make, started from *Branch* |
| *Path* | **`models/<model>.ttl`**: the folder for new files, then the model's name in lower case, `models/acme-online-shop.ttl` | the file, made when it is not there; its extension picks the format: `.ttl`, `.trig`, `.jsonld`, `.nq`, `.nt`, `.rdf` |
| *Commit message* | **`{action} {model}`** filled in: `Add Acme online shop` | the commit's message |

The message template knows `{action}` (*Add* for a new file, *Update* for one there), `{model}`,
`{path}` and `{branch}`; [Settings](settings.md#git-storage-tab) changes it. *Commit* saves. From then
on, the model is bound to that file: *File › Save to Git* asks for the commit message only. A save to a
new branch offers to open its merge request at once.

1. Choose *File › Save to Git…*.
2. In *Repository*, paste `https://github.com/acme/architecture`; leave *Branch* empty.
3. In *New branch*, type `la-gram/shop`, and choose *Commit*.
4. Change the model, then choose *File › Save to Git*: only the message is asked.

## Save to Git as {#save-to-git-as}

*File › Save to Git as…*, for a bound model, asks the same as an unbound save, starting from the bound
file: to commit it to another branch, a new one, or another file. The model is then bound to where it
went.

1. Choose *File › Save to Git as…*.
2. In *New branch*, type `la-gram/shop-payments`, and choose *Commit*.

## When the file changed {#when-the-file-changed}

A save never overwrites a change it has not seen. When the file moved on in the repository since it was
opened or last saved, the save asks, *models/shop.ttl changed in the repository*:

| Choice | Does |
|---|---|
| *Merge with the newer version* (first) | combines your changes with the newer version, by element, and commits the result to the same branch; what changed on both sides goes to the [Conflicts tab](#conflicts-tab) first |
| *Save to a new branch* | commits this model to a new branch, started from the version you opened or last saved, named **`<prefix><model>-<date>-<time>`**, `la-gram/acme-online-shop-20261108-1915` say |
| *Overwrite it on main* | replaces the newer version with this model; what changed there stays in the branch's history, not in its latest file |
| *Open the newer version* | replaces the model here with the repository's; your changes are lost |

1. Save to Git, after someone else has committed to the same file.
2. Choose *Merge with the newer version*. With nothing changed on both sides, the merged model is
   committed at once.

## Before a save {#before-a-save}

A save asks first in two cases:

| Dialog | When | Asked |
|---|---|---|
| *Conflicts not chosen* | conflicts in the Conflicts tab are still open: the model holds the version before either change | every save, until they are chosen |
| *Blank nodes* | the model has triples with a blank node, which an imported file may bring and la-gram never makes: a merge cannot match them, and keeps both copies | once a session for each model |

*Save anyway* saves.

1. Merge a newer version that leaves a conflict, and save to Git without choosing it.
2. *Conflicts not chosen* asks: choose *Cancel*, then choose in the Conflicts tab.

## Conflicts tab {#conflicts-tab}

A merge (*Merge with the newer version*, or *Update from main…*) combines both sides by element. What
both changed the same thing in, a name, a node's position, a route, a relationship's ends, a concept
deleted on one side and changed on the other, is listed in a *Conflicts* tab beside History, each with
the two versions and a button for each:

| Conflict | Choices |
|---|---|
| a value, a relationship's ends, a type, a node's bounds, a line's route | *Keep mine* · *Take theirs* |
| placed twice on a diagram, both kept until one is chosen | *Keep only mine* · *Keep only theirs* |
| deleted on one side, changed on the other | *Keep it* · *Delete it* |

"Mine" is the model here; "theirs" the version merged with. Until a choice is made, the model holds the
version before either change, a deleted concept kept. A choice can be changed, and each is one undoable
step. A click on what a conflict is about shows it.

1. Open the *Conflicts* tab.
2. For the name of "Web shop", choose *Take theirs*.
3. Save to Git: the merge is committed.

## Update from main {#update-from-main}

*File › Update from main…* merges another branch, the default first in the list (*Update la-gram/shop
from…*), into the bound one, so that its merge request merges cleanly. Conflicts go to the Conflicts tab
first.

| Host | The merged model is |
|---|---|
| GitHub | committed to the bound branch as a merge commit |
| GitLab | committed to a new branch started from the other one, as GitLab's API cannot record a merge: *Commit to a new branch* asks its name. Open that branch's merge request, and close the old one |

1. Choose *File › Update from main…*.
2. Pick **main**.
3. On GitHub, the merge is committed to the bound branch.

## Merge requests {#merge-requests}

*File › Open merge request…* proposes the bound branch for merging into the default one: a pull request
on GitHub, a merge request on GitLab. It asks for a *Title*, the branch's last commit's message, and a
*Description* in Markdown, the branch's changes by element; *Open* opens it. A request already open from
the branch is named, with its link, not opened again. A model on the default branch is told to commit to
a branch of its own first, with *Save to Git as…*.

1. Choose *File › Open merge request…*.
2. Read the description, and choose *Open*. The message gives its link.

## Access tokens {#access-tokens}

A public repository opens without a token. Otherwise la-gram asks, in *Access token for github.com*, for
a *Token*, and sends it to that host only, never into the model or a file.

| Host | Token |
|---|---|
| GitHub | a fine-grained personal access token with *Contents: read and write* on the repository (read to open), and *Pull requests: read and write* to open pull requests |
| GitLab | a personal, project or group access token with the `api` scope (`read_repository` to open) |

A token is kept for each host. By default it is kept **in memory** for the session: a reload, or closing
the tab, forgets it. Ticked, the dialog's *Remember* box keeps it:

| Build | *Remember* says | Kept | Ticked at first |
|---|---|---|---|
| web | *Remember on this browser (stored unencrypted; anyone using this browser profile can read it)* | in this browser's `localStorage` (`la-gram:git-tokens`), **unencrypted** | **no** |
| desktop | *Remember on this computer (encrypted with the system keychain)* | encrypted with the system keychain | **yes** |

[*Offer to remember a new token, ticked*](settings.md#git-storage-tab) changes which, and *Forget the
token for …* in Settings forgets one. A deployment that says `rememberTokens: never` keeps every token
for the session only, and there is no *Remember*.

!!! warning "A token remembered in the browser is not encrypted"

    "For the session" means in memory: a reload forgets the token. *Remember* in the web app writes it to
    `localStorage` as it is, where anything running in this browser profile on la-gram's site can read
    it. On a shared or managed computer, leave it unticked, give a token the least it needs, with an
    expiry, and forget it in *File › Settings… › Git storage* when done. The desktop app encrypts it with
    the system keychain instead.

1. Open a private repository with *Open from Git…*.
2. In *Token*, paste a token with the scopes above, leave *Remember* unticked, and choose
   *Use this token*.

## History {#history}

For a model bound to a file, the *History* tab lists the file's commits beside the checkpoints, newest
first, with their authors and links, and shows what each changed by element. *Open this version* makes
the model the file at a commit, still bound to its branch; *Read again* reads the commits again. See
[History and checkpoints](history.md#git-commits).

1. Open a model from Git, and the *History* tab.
2. Choose *Read again* after someone else committed: their commit is listed first.
