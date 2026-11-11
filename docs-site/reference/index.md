---
title: Reference
description: Look-up pages for la-gram's URL parameters, configuration file, keys, file formats, stored data, desktop app and la-gram-git.
---
# Reference

These pages list every option la-gram has, each with its values, its default and an example. The
[User guide](../guide/index.md) says how to do things; these pages say exactly what each setting does.

| Page | What it lists |
|---|---|
| [URL parameters](url-parameters.md) | what the web app reads from its address: the metamodel, the asset mode, a model to open, a collaboration room, Git |
| [Deployment configuration file](configuration.md) | `la-gram.config.json`, which an installation puts beside the app: modules, Git hosts, token policy, Git defaults |
| [Keyboard and mouse](keyboard.md) | every key and gesture, on Windows, Linux and macOS |
| [File formats and vocabulary](file-formats.md) | the RDF formats la-gram reads and writes, the graphs of a saved file, and how files from other tools and older la-gram files are taken in |
| [Data kept on your machine](stored-data.md) | each `localStorage` key, the History database, the desktop app's secrets file, and what is not kept |
| [Desktop app internals](desktop.md) | the desktop window, its `app://` scheme, its Content-Security-Policy, links and the bridge to the system |
| [la-gram-git command line](la-gram-git.md) | every command, option, environment variable and exit code of the command-line tool |

Where la-gram's README or its specifications say something else, these pages follow the code.

## Where each setting comes from

A setting can come from several places. The first one that applies wins:

1. **The build.** A build made with `LA_GRAM_GIT=off` has no Git storage at all
   ([Building](../developing/building.md#env-la-gram-git)).
2. **The deployment.** `la-gram.config.json` can make a module `unavailable`, and its policies (the Git
   hosts, `rememberTokens`) bind every user ([configuration](configuration.md#precedence)).
3. **The address.** `?git=off` switches Git storage off for one session ([URL parameters](url-parameters.md#module-off)).
4. **You.** *File › Settings…*, kept in this browser ([Settings](../guide/settings.md)).
5. **The deployment's defaults**, then **la-gram's own**.

Try it with the example model:

1. Open `https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&git=off`.
2. Open *File*: it has no Git entries, because the address switched Git storage off.
3. Open *File › Settings…* › *Modules*, tick Git storage and choose *Apply*: the switch you made
   wins over the address for the rest of the session.
