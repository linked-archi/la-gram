---
title: Deployment configuration file
description: The la-gram.config.json file a deployment puts beside the web app, with every key, its values and its default.
---
# Deployment configuration file

A deployment of la-gram can set, for everyone who uses it, which modules it offers and how Git storage
behaves. It does so in one optional file, `la-gram.config.json`. Without the file, la-gram uses its own
defaults: every module on, any Git host, tokens remembered when the user asks.

| Key | Values | Default |
|---|---|---|
| [`modules.<id>`](#modules) | `on`, `off`, `unavailable` | **`on`** |
| [`git.hosts[]`](#git-hosts) | a list of hosts, each with `host`, `kind` and optionally `api` | **absent: any host** |
| [`git.rememberTokens`](#git-remembertokens) | `ask`, `never` | **`ask`** |
| [`git.defaults.repository`](#git-defaults) | an `https://` repository address | **none: the last one used** |
| [`git.defaults.branch`](#git-defaults) | a branch name | **none: the repository's default branch** |
| [`git.defaults.folder`](#git-defaults) | a folder in the repository | **`models`** |
| [`git.defaults.message`](#git-defaults-message) | a commit message template | **`{action} {model}`** |
| [`git.defaults.branchPrefix`](#git-defaults) | text | **`la-gram/`** |

## Where the file goes {#location}

The file is named `la-gram.config.json` and sits **beside `index.html`**, in the folder the web app is
served from: on app.linked.archi that would be `/la-gram/la-gram.config.json`. la-gram reads it once, as
it starts, from its own address only. No URL parameter can name another file, so a link cannot widen what
the deployment allows.

- **No file** (the server answers 404, or answers with an HTML page, as a single-page fallback does): no
  configuration, and la-gram's defaults apply.
- **A file that fails the check** is reported, and the modules it governs do not start: Git storage stays
  off until the file is fixed. A deployment that meant to restrict the Git hosts must not end up with no
  restriction at all.
- **A file that passes** applies at once, to every user of the deployment.

Two ways to put it in place:

1. **Drop it into a built folder**, next to `index.html`, on the server or in `dist/web/` after
   `npm run build:web`. It is fetched with `cache: no-store`, so a change applies at the next reload.
2. **Build it in** with `LA_GRAM_CONFIG=<file>`, which copies the file beside `index.html` in the web
   build and in the desktop app's renderer, and so into `npm run package`'s app
   ([Building](../developing/building.md#env-la-gram-config)).

The desktop app reads it from its own `app://la-gram/la-gram.config.json`, which only a build with
`LA_GRAM_CONFIG` puts there.

A complete file, with every key:

```json title="la-gram.config.json"
{
  "modules": { "git": "on" },
  "git": {
    "hosts": [
      { "host": "github.com", "kind": "github" },
      { "host": "git.example.com", "kind": "gitlab" }
    ],
    "rememberTokens": "ask",
    "defaults": {
      "repository": "https://git.example.com/acme/architecture",
      "branch": "main",
      "folder": "models",
      "message": "{action} {model}",
      "branchPrefix": "la-gram/"
    }
  }
}
```

Built in, then found in the output (the file is copied as it is, under the name `la-gram.config.json`):

```sh
LA_GRAM_CONFIG=deploy/acme.json npm run build:web
ls dist/web | grep config    # la-gram.config.json
```

## `modules` {#modules}

`modules.<id>` says how a deployment offers a module. The one module today is Git storage, `git`.

| Value | The module is |
|---|---|
| **`on`** | on, until a user switches it off in *File › Settings…* |
| `off` | off, until a user switches it on in *File › Settings…*; the choice is then kept |
| `unavailable` | not offered: no Git entries, nothing in *Settings*, and `?git=<link>` does nothing |

- **Default:** `on` for every module the build has.
- **Values:** exactly `on`, `off` or `unavailable`. Any other value fails the check, for example
  `la-gram.config.json: modules.git must be "on", "off" or "unavailable", not "yes".`
- **Any id is accepted**, also one for a module la-gram does not have, and without a word: a misspelt
  `"gti"` passes the check and changes nothing. Check the spelling against *File › Settings…* ›
  *Modules*.

Git storage offered, but off until each user switches it on:

```json title="la-gram.config.json"
{ "modules": { "git": "off" } }
```

Git storage not offered at all:

```json title="la-gram.config.json"
{ "modules": { "git": "unavailable" } }
```

A misspelt id, accepted, with Git storage still on:

```json title="la-gram.config.json"
{ "modules": { "gti": "off" } }
```

## `git.hosts` {#git-hosts}

`git.hosts[]` is the allow-list of Git hosts. When it is given, la-gram talks to these hosts only: a link
on any other host is refused before anything is asked or sent. Each entry names one host and what it is,
so la-gram never asks a user whether a self-hosted address is GitHub or GitLab.

| Key | Values | Default |
|---|---|---|
| `git.hosts[].host` | the host name in lower case, with `:port` when it has one: `git.example.com`, `git.example.com:8443` | required |
| `git.hosts[].kind` | `github` or `gitlab` | required |
| `git.hosts[].api` | the REST API's `https://` address | **`https://api.github.com`** for github.com, **`https://HOST/api/v3`** for another GitHub (Enterprise Server), **`https://HOST/api/v4`** for GitLab |

- **Default:** absent, so any host. Users then choose GitHub or GitLab for a self-hosted address the first
  time, and la-gram remembers it ([stored data](stored-data.md#git)).
- **An empty list** (`"hosts": []`) allows no host.
- *File › Settings…* › *Git storage* shows the list as *Git hosts allowed*, read only.
- **Checked:** `host` must be a host name, `kind` exactly `github` or `gitlab`, and `api`, when given, an
  `https://` address without a user name or password. Anything else fails the check, for example
  `la-gram.config.json: git.hosts[0].kind must be "github" or "gitlab", not "gitea".`

github.com, a GitHub Enterprise Server and a GitLab on another port:

```json title="la-gram.config.json"
{
  "git": {
    "hosts": [
      { "host": "github.com", "kind": "github" },
      { "host": "github.example.com", "kind": "github" },
      { "host": "git.example.com:8443", "kind": "gitlab", "api": "https://git.example.com:8443/api/v4" }
    ]
  }
}
```

The second entry's API is `https://github.example.com/api/v3`, the default for a GitHub host that is not
github.com.

### An unknown key in a host entry {#git-hosts-unknown-keys}

A key la-gram does not know **inside an entry of `git.hosts`** fails the whole file. It is not ignored, as
unknown keys elsewhere are ([unknown keys](#unknown-keys)): an entry la-gram half understands could allow
a host it should not. The entry's keys are `host`, `kind` and `api`, and nothing else.

A host given a name, refused:

```json title="la-gram.config.json, refused"
{
  "git": {
    "hosts": [{ "host": "git.example.com", "kind": "gitlab", "name": "Acme GitLab" }]
  }
}
```

la-gram starts, says so in a message, and leaves Git storage off:

```text
la-gram.config.json: git.hosts[0].name is not a host's setting. Git storage is off until it is fixed.
```

## `git.rememberTokens` {#git-remembertokens}

Whether users may have their Git access tokens remembered on their machine.

| Value | Means |
|---|---|
| **`ask`** | the access token dialog offers *Remember*. In the web app it is unticked at first, and remembers the token **unencrypted** in the browser; in the desktop app it is ticked at first, and keeps the token encrypted by the system keychain |
| `never` | no *Remember*: a token is kept in memory for the session only, and a reload or restart asks again. Tokens remembered before are not read |

- **Default:** `ask`.
- *File › Settings…* › *Git storage* says *Never: a token is kept for the session only* when the
  deployment says `never`.
- Any other value fails the check, for example
  `la-gram.config.json: git.rememberTokens must be "ask" or "never", not "always".`

Tokens for the session only, everywhere:

```json title="la-gram.config.json"
{ "git": { "rememberTokens": "never" } }
```

## `git.defaults` {#git-defaults}

What a new *Save to Git…* and *Open from Git…* start from, for a model not yet bound to a file. Each user
can override them in *File › Settings…* › *Git storage*; an empty field there means the deployment's
value, and an absent deployment value means la-gram's.

| Key | Values | Without it |
|---|---|---|
| `git.defaults.repository` | the repository's `https://` address | **the last repository used** on this machine |
| `git.defaults.branch` | a branch name | **the repository's default branch** |
| `git.defaults.folder` | a folder in the repository, `models` or `arch/models`; no leading `/`, no `.` or `..`; a trailing `/` is dropped | **`models`** |
| `git.defaults.message` | the commit message template | **`{action} {model}`** ([below](#git-defaults-message)) |
| `git.defaults.branchPrefix` | text | **`la-gram/`**: what a suggested new branch's name starts with |

- Each value is text; anything else fails the check (`git.defaults.branch must be text.`).
- A repository that is not an `https://` address fails it:
  `la-gram.config.json: git.defaults.repository must be the repository’s https:// address.`
- A folder that starts with `/` or has `.` or `..` in it fails it:
  `la-gram.config.json: git.defaults.folder is a folder in the repository, as models or arch/models — not /models, nor with . or ..`

Acme's architecture repository, its `main` branch, models under `architecture/models`, and new branches
named `acme/…`:

```json title="la-gram.config.json"
{
  "git": {
    "defaults": {
      "repository": "https://git.example.com/acme/architecture",
      "branch": "main",
      "folder": "architecture/models",
      "branchPrefix": "acme/"
    }
  }
}
```

The first *Save to Git…* of the example model then proposes the file
`architecture/models/acme-online-shop.ttl` in that repository, on `main`.

### `git.defaults.message` {#git-defaults-message}

The template of the commit message a save proposes. The user can still edit the message before saving.

| Placeholder | Becomes |
|---|---|
| `{action}` | `Add` for a new file, `Update` for one that is there |
| `{model}` | the model's name |
| `{path}` | the file's path in the repository |
| `{branch}` | the branch the commit goes to |

- **Default:** `{action} {model}`, which gives "Add Acme online shop".
- Other text is kept as it is; a placeholder la-gram does not know stays as written.

```json title="la-gram.config.json"
{ "git": { "defaults": { "message": "{action} {model} on {branch} ({path})" } } }
```

With this message and the defaults of the example above, saving the example model for the first time
proposes "Add Acme online shop on main (architecture/models/acme-online-shop.ttl)".

## No secrets in the file {#no-secrets}

A configuration never holds a credential: each user gives their own token, in the app. The check refuses
the whole file, and Git storage stays off, when it finds any of these:

- **a key named like a secret**, anywhere in the file: one containing `token`, `password`, `passwd`,
  `secret`, `credential`, `private key` or `api key` (with or without a separator), or one named exactly
  `key`. `rememberTokens` is la-gram's own and allowed;
- **a value shaped like a GitHub or GitLab token** (`ghp_…`, `github_pat_…`, `glpat-…` and their kin);
- **an address with credentials in it**, such as `https://user:password@host/…`.

A token in the file, refused:

```json title="la-gram.config.json, refused"
{ "git": { "accessToken": "<your-token>" } }
```

```text
la-gram.config.json: git.accessToken: tokens and passwords are never configured, each user gives their own. Git storage is off until it is fixed.
```

A repository address with a password in it, refused:

```json title="la-gram.config.json, refused"
{ "git": { "defaults": { "repository": "https://deploy:<password>@git.example.com/acme/architecture" } } }
```

```text
la-gram.config.json: git.defaults.repository is an address with credentials in it: take them out. Git storage is off until it is fixed.
```

## Unknown keys {#unknown-keys}

A key la-gram does not know at the top of the file, in `git` or in `git.defaults` is **reported and
ignored**: la-gram says which, in a message and in the browser's console, and uses the rest of the file.
The exception is a key inside a `git.hosts` entry, which fails the file
([above](#git-hosts-unknown-keys)).

Other problems fail the file, whatever their place: a file that is not JSON, not a JSON object, or has a
value la-gram does not accept.

```json title="la-gram.config.json, reported, not refused"
{
  "theme": "dark",
  "git": { "colour": "blue", "defaults": { "author": "Jane Doe" } }
}
```

la-gram starts with Git storage on, and says:

```text
la-gram.config.json: ignored what la-gram does not know: theme, git.colour, git.defaults.author.
```

A file that is not JSON, here with a trailing comma, fails:

```text
{ "modules": { "git": "off" },}
```

```text
la-gram.config.json is not JSON: Expected double-quoted property name in JSON at position 30 (line 1 column 31) Git storage is off until it is fixed.
```

## Which source wins {#precedence}

A module can be switched in several places. The first that applies wins:

1. **the build**: a build without the module, such as `LA_GRAM_GIT=off`, never offers it;
2. **the deployment's `unavailable`**, and a file that failed its check, which make Git storage
   unavailable;
3. **`?<id>=off`** in the address: off for that session;
4. **the user's choice** in *File › Settings…* › *Modules*, kept on their machine;
5. **the deployment's default**, `on` or `off`;
6. **la-gram's**: on.

The Git policies, `git.hosts` and `git.rememberTokens`, bind every user and are not offered in
*Settings*. The Git defaults are the other way round: a user's own value in *File › Settings…* › *Git
storage* wins over the deployment's, and the deployment's over la-gram's.

!!! example "A deployment default, a user's choice and a link"

    With this file, Git storage starts off for everyone:

    ```json title="la-gram.config.json"
    { "modules": { "git": "off" }, "git": { "defaults": { "folder": "architecture/models" } } }
    ```

    1. A user switches Git storage on in *File › Settings…* › *Modules*. It stays on for them at every
       later visit, the deployment's `off` notwithstanding.
    2. They open `https://app.linked.archi/la-gram/?git=off`: off for that visit only.
    3. In *Git storage*, they leave *Folder for new files* empty: `architecture/models`, the deployment's,
       applies. They type `models`: theirs applies.
