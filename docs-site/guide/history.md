---
title: History and checkpoints
description: The History tab in la-gram, with checkpoints kept on this machine, comparing versions by element or as triples, restoring one, and a Git file's commits.
---
# History and checkpoints

The *History* tab, under the canvas, keeps checkpoints of the model on this machine, and, for a model
bound to a file in Git, lists that file's commits beside them. It shows what changed between any of them
and the model now.

## Checkpoints {#checkpoints}

A checkpoint is a copy of the model at a moment, with a message, kept in this browser (IndexedDB), per
model. It is not a Git commit, and is not shared: *File › Save to Git…* makes commits. Type what changed
in *What changed*, then *Save checkpoint* or ++enter++. Under it, the tab says what changed since the
last one: *Since the last checkpoint: +1 −1 triples.*, or *No changes since the last checkpoint.*

The list, newest first, gives each checkpoint's message, when it was saved and how many triples it added
and removed. A long list scrolls, and so does what the one selected changed, beside it; *What changed*
and the line under it stay at the top.

1. Open the example, and the *History* tab.
2. Type "Before the payments" in *What changed*, and press ++enter++. *Checkpoint saved*, and the list
   has it, with "+208 −0": everything was new.
3. Rename "Gift wrapping" to "Gift wrap". The tab says "Since the last checkpoint: +1 −1 triples."

## Compare {#compare}

Click a checkpoint (or a commit) to see what changed, in either of two comparisons:

| Comparison | Shows |
|---|---|
| *Changes in this checkpoint* (*Changes in this commit*) | what it changed from the one before it |
| *Since then, to now* | how the model now differs from it |
| *Committed on* and the branch | for a branch other than the default: what the branch has against the default |
| *With the model now* | the same branch, against the model now |

and in either of two forms:

| Form | Lists |
|---|---|
| **By element** | each concept added, removed or changed: a name old → new, a relationship's ends, a view's shapes placed, moved or rerouted |
| *As triples* | the triples added and removed, at most **500** of each, with the count of all |

1. Click "Before the payments".
2. Choose *Since then, to now* and *By element*: "1 changed", "Gift wrap", with its name (en) from
   “Gift wrapping” to “Gift wrap”.
3. Choose *As triples*: the `skos:prefLabel` "Gift wrapping" removed, and "Gift wrap" added.

## Restore {#restore}

*Restore this checkpoint*, under a checkpoint's changes, makes the model that checkpoint again. It asks
first, in *Restore this checkpoint*: *The model becomes the checkpoint of … Changes since the last
checkpoint are replaced — save a checkpoint first to keep them.* In a collaboration room, it is restored
for everyone in the room. *Restore* confirms, and undo takes the restore back while the view stays open.

1. Click "Before the payments", and choose *Restore this checkpoint*.
2. Choose *Restore*: "Gift wrap" is "Gift wrapping" again.

## Git commits {#git-commits}

For a model bound to a file in Git ([Git storage](git.md)), the tab also lists that file's commits,
newest first, beside the checkpoints: each with its message, its author and a link to it on the host.
They are read when the tab opens, and again on *Read again*; *Older commits…* reads more. A commit's
changes are shown as a checkpoint's, against the commit before it or the model now.

*Open this version* makes the model the file at that commit, after asking, undoably, and still bound to
its branch: the next save commits to the branch as usual. A commit from before the model was moved to
another namespace is not opened: the message says so ([Moving the model to another namespace](git.md#namespace)).
Bound to a branch other than the default, the first entry is
the branch against the default (*Branch*, *What merging it into main would bring*).

1. Open a model from Git ([Open from Git](git.md#open-from-git)), and the *History* tab.
2. Click a commit, then *Open this version*: the model is the file as it was then.
3. Save to Git to commit it as the newest version, or undo.
