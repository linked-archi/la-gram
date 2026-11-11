---
title: Desktop app internals
description: How la-gram's desktop app is isolated, with its window, menus, file access and Content-Security-Policy.
---
# Desktop app internals

The desktop app is the web app in an Electron window, with the browser's limits kept: its page runs
without Node, isolated from the desktop, and reaches the system only through a narrow bridge. What it
looks like to use is in [Desktop app](../getting-started/desktop.md); this page says how it is built.
The browser suite's `tests/browser/electron.spec.ts` checks the window's page, its isolation, its
Content-Security-Policy and its file access ([Testing](../developing/testing.md#npm-run-test-browser)).

## The window {#window}

One window, **1280 × 800** at first, with la-gram's icon (the app bundle's on macOS). Its page has:

| Setting | Value | Means |
|---|---|---|
| `sandbox` | `true` | the page runs in Chromium's sandbox |
| `contextIsolation` | `true` | the page cannot reach the bridge's own code, only what it exposes |
| `nodeIntegration` | `false` | no Node: no `require`, no `process`, no file system |
| `preload` | `preload.cjs` | the bridge ([below](#bridge)) |

Closing a window with unsaved changes asks first: *Close without saving* or *Cancel*, which is the
default. On macOS the app keeps running when its last window closes, and its Dock icon opens a new one.

## The `app://la-gram/` scheme {#app-scheme}

The page and everything it loads come from `app://la-gram/`, a scheme the app registers as standard and
secure, with `fetch` and CORS. It answers from the build's `renderer/` folder only: any other host, or a
path that leads out of that folder, is answered 404. So the page has an origin of its own, as on a web
server: its `localStorage` and IndexedDB are kept, and the bundled metamodels are fetched as the web
build fetches them.

```text
app://la-gram/index.html                          the page
app://la-gram/assets/archimate4/archimate4-onto.ttl   a bundled metamodel file, as text/turtle
app://la-gram/la-gram.config.json                 the deployment configuration, if the build has one (else 404)
app://example.org/index.html                      404: not the app's host
```

## Content-Security-Policy {#content-security-policy}

Every answer from `app://la-gram/` carries this policy, as `src/electron-main.ts` sets it:

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: ws: wss: http://localhost:* http://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

| Directive | Allows | Why |
|---|---|---|
| `script-src 'self' 'wasm-unsafe-eval'` | the app's own scripts, and WebAssembly | the RDF store, Oxigraph, is WebAssembly; no inline script, no `eval` |
| `style-src 'self' 'unsafe-inline'` | the app's styles, and inline ones | the components' own styles |
| `img-src 'self' data: blob: https:` | pictures from the app, `data:`, `blob:` and any `https:` site | pictures on elements, metamodels' icons |
| `connect-src 'self' https: ws: wss: http://localhost:* http://127.0.0.1:*` | metamodels and Git hosts over `https:`, a collaboration server over `ws:` or `wss:`, and servers on this computer | unlike the web app's site policy, `ws:` and `localhost` are allowed: a desktop user may run `npm run collab` beside it |
| `worker-src 'self' blob:` | the validation worker | validation runs off the page's thread |
| `object-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` | nothing | no plug-ins, no form posts, no framing |

The web app's policy on app.linked.archi is the same but for `connect-src 'self' https: wss:`,
`frame-ancestors 'self'` and no `form-action` ([Hosting the web app](../operating/web-app.md#content-security-policy)).

## Links {#links}

A web link (`http:` or `https:`) the page opens, in a new window or in place, opens in the **system
browser**. Nothing but la-gram's own page is ever loaded into its window: any other navigation is
blocked, and no second window is opened. The *Help* menu's entries open in the browser too.

1. In the desktop app, choose *Help › Quick start*.
2. The guide opens in the system browser; la-gram's window stays as it was.

## The bridge {#bridge}

The page reaches the desktop only through `window.laGramDesktop`, which the preload script exposes. Each
call is a message to the app's main process, which answers only the app's own page:

```text
showOpenDialog(filters?)                   the system's Open dialog; the chosen path, or null
showSaveDialog(filters?, defaultPath?)     the system's Save dialog; the chosen path, or null
readFile(path)                             a file chosen in one of those dialogs in this session
writeFile(path, content)                   the same, written
secretsAvailable()                         whether tokens can be kept encrypted here
secretGet(key), secretSet(key, value),     Git tokens in secrets.json, keys git:<host>
secretDelete(key), secretKeys()
```

- **Files:** `readFile` and `writeFile` refuse any path not chosen in a dialog in this session, with
  *Only a file chosen in a dialog can be read*.
- **Secrets:** stored encrypted ([stored data](stored-data.md#desktop-secrets)); refused when the system
  has no keychain to encrypt with, as on Linux without one.
- **In practice, the menus open and save files the browser's way.** *File › Open…*, *Import* and
  *Upload* use the page's file chooser, and *Save* and *Export* a download, as in the web app; the
  dialogs above are used by none of today's menus. See
  [Files in the desktop app](../troubleshooting.md#files-in-the-desktop-app).

## No command line, no file associations {#no-command-line}

The desktop app takes **no command-line switches** and no [URL parameters](url-parameters.md): it always
opens its own page with an empty model. It registers no file types, so a `.ttl` file is not opened by
double-clicking it or with *Open with*. Open a model with *File › Open…* once la-gram is running.
