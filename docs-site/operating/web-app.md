---
title: Hosting the web app
description: How to serve la-gram's web app and its documentation from any static web server, with app.linked.archi's server as the worked example.
---
# Hosting the web app

la-gram's web app is a folder of static files: `npm run build:web` writes it to `dist/web/`, and each
release's workflow builds the same ([Releasing](../developing/releasing.md)). It needs no server
program, no database and no account system: any web server that serves files can host it. This page
says what that server has to do, and shows the rules app.linked.archi's server follows, as nginx
configuration with placeholders.

## What any server needs {#requirements}

| Need | Why |
|---|---|
| serve the folder's files, with `index.html` for the folder itself | the app is `index.html`, its scripts, its WebAssembly and its bundled metamodels; `third-party-licences.txt`, which *About la-gram* links to, holds the licences of the packages built into it |
| `.wasm` as `application/wasm` | the browser compiles the RDF store, Oxigraph, only from that type |
| `.ttl` as `text/turtle` | the bundled metamodels and the example model are Turtle; most servers do not know the extension |
| HTTPS | the app sends Git access tokens to Git hosts and models to collaborators: serve it over HTTPS, and collaboration over `wss:` ([below](#behind-tls)) |
| `index.html` and the bundled metamodels revalidated on every load | they keep their names from one release to the next |

Everything else is optional: the cache rules for content-named files, compression and the security
headers below. The app works at any path; app.linked.archi serves it under `/la-gram/`.

**The deployment configuration** goes beside `index.html`: `<web-root>/la-gram/la-gram.config.json` on
the layout below ([Deployment configuration file](../reference/configuration.md#location)). A server
that answers a missing file with 404, or with its own HTML page, is fine either way.

**This version's page** is built into the app's folder too, as `v{version}/index.html`
(`v0.3.0/index.html`): what `https://app.linked.archi/la-gram/v0.3.0`, the address a model names the la-gram
version it was edited with by, resolves to ([Properties](../guide/properties.md#last-changed)). Keep the
pages of earlier versions when a new release replaces the app: app.linked.archi's server copies every
version's page into each release it serves.

**The documentation** is built into the app's folder, as `docs/` (`npm run docs:build` writes
`dist/web/docs/`), and is served from it: `/la-gram/docs/`. Link to it with the trailing slash. Its pages
need no rule of their own, and run under the policy [below](#content-security-policy). la-gram's own menu
links the published documentation, https://app.linked.archi/la-gram/docs/, wherever the app is installed:
an installation elsewhere may serve its copy, but need not.

To try a build locally, any static server does, for example Python's:

```sh
npm run build:web && npm run docs:build
python3 -m http.server 41238 --directory dist/web
```

`http://127.0.0.1:41238/` is then the app and `http://127.0.0.1:41238/docs/` the documentation, with
`.wasm` as `application/wasm` and `.ttl` as `text/turtle`.

## app.linked.archi {#app-linked-archi}

The server at app.linked.archi is nginx. The server installs each release itself, into a folder of its own,
and `la-gram/` is a link to it, swapped in one rename
([Installed by the server](../developing/releasing.md#installed-by-the-server)). Its rules:

- `/` sends visitors to `/la-gram/` with a **302**, a temporary redirect, and `/la-gram`, as people
  type it, to `/la-gram/` with a **301**, written relative so that it holds behind a proxy;
- under `/la-gram/`, each request is a file, a folder (with its `index.html`) or a **404**:
  `try_files $uri $uri/ =404`. There is no fallback to `index.html`: the app has one page;
- `.ttl` files are `text/turtle`, which nginx's own type list does not know;
- the desktop apps, in `/la-gram/downloads/`, are files like any other: a `.zip` is `application/zip`,
  `SHA256SUMS.txt` `text/plain`, and a `.tar.gz`, which nginx's type list does not name, the server's
  default type (`application/octet-stream` as nginx ships), so it downloads. Each is revalidated on
  every load, as everything not named by its content is, so a release's replace the last ones at once.
  The folder itself, `/la-gram/downloads/` (or without the slash), has no page and is not listed: it
  sends visitors to the documentation's [Download](../getting-started/desktop.md#download) section with a
  **302**, which links each platform's app;
- `/la-gram-alpha/` is the alpha — the next release as it is being made, published from each push to
  `main` ([The alpha](../developing/releasing.md#alpha)) — from the folder beside `la-gram/`,
  `la-gram-alpha/`, with the same rules as `/la-gram/`;
- anything else on the host is a 404.

As configuration, with placeholders: `<host>` for the server's name and `<web-root>` for the folder that
holds `la-gram/` and `la-gram-alpha/`. The TLS settings are your server's own, and are left out:

```nginx
server {
    listen 443 ssl;
    server_name <host>;
    root <web-root>;
    index index.html;
    charset utf-8;
    # TLS: your certificate and key, as the rest of your server has them.

    location = / {
        return 302 /la-gram/;
    }
    location = /la-gram {
        absolute_redirect off;
        return 301 /la-gram/;
    }
    location = /la-gram/downloads/ {
        absolute_redirect off;
        return 302 /la-gram/docs/getting-started/desktop/#download;
    }
    location = /la-gram/downloads {
        absolute_redirect off;
        return 302 /la-gram/docs/getting-started/desktop/#download;
    }
    location ^~ /la-gram/ {
        try_files $uri $uri/ =404;
        location ~ \.ttl$ {
            types {
                text/turtle ttl;
            }
            default_type text/plain;
            try_files $uri =404;
        }
    }
    location = /la-gram-alpha {
        absolute_redirect off;
        return 301 /la-gram-alpha/;
    }
    location ^~ /la-gram-alpha/ {
        try_files $uri $uri/ =404;
        location ~ \.ttl$ {
            types {
                text/turtle ttl;
            }
            default_type text/plain;
            try_files $uri =404;
        }
    }
    location / {
        return 404;
    }
}
```

What the live server answers, read with `curl`:

```console
$ curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://app.linked.archi/
302 https://app.linked.archi/la-gram/
$ curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://app.linked.archi/la-gram
301 https://app.linked.archi/la-gram/
```

**A folder without its trailing slash**, such as `/la-gram/docs`, matches `$uri/`, and nginx answers it
with a 301 to the same address with the slash, `/la-gram/docs/`. The redirect is absolute, built from
the request's host. The docs and the app link only to addresses with the slash. A server other than
nginx should do the same: a folder's page served at the address without the slash has its relative
links point one level too high, and shows unstyled.

## Caching {#caching}

A release replaces `index.html` and the bundled metamodels under the same names, and names its scripts
and its WebAssembly by their content (`bundle.84052483.js`, `3af2f08a210aab7ebadd.wasm`). So:

| Files | `Cache-Control` | Why |
|---|---|---|
| everything, by default | **`no-cache`**: kept, but revalidated on every load | a release is there at the next reload |
| `*.<8 or more hex digits>.js` | `public, max-age=31536000, immutable` | the name changes with the content |
| `*.wasm` | `public, max-age=31536000, immutable` | the same |

The bundled metamodels are fetched with `?v=<digest of them all>`, which changes when any of them does,
so a browser never draws an old icon with a new build. The documentation's moved scripts are named
`inline.<16 hex>.js`, so the same rule caches them for a year. Its theme's `bundle.<8 hex>.min.js` does
not end in hex and `.js`, and is revalidated like the rest: correct, only a little slower.

```nginx
# In the http context, beside the server block.
map $uri $la_gram_cache_control {
    default                     "no-cache";
    "~\.[0-9a-f]{8,}\.js$"      "public, max-age=31536000, immutable";
    "~\.wasm$"                  "public, max-age=31536000, immutable";
}

# In the server block, with the other headers.
add_header Cache-Control $la_gram_cache_control always;
```

`map` names are shared by every site of an nginx server, so give yours a name no other site uses. The
quotes keep nginx from reading the braces of `{8,}` as its own.

## Content-Security-Policy {#content-security-policy}

app.linked.archi sends this policy with every answer, the app's and the documentation's alike:

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
```

| Directive | What la-gram needs it for |
|---|---|
| `script-src 'self' 'wasm-unsafe-eval'` | its own scripts, and the WebAssembly of its RDF store. No inline script and no `eval`: the documentation's build moves its theme's inline scripts into files for this reason ([CSP hook](../developing/documentation.md#csp-hook)) |
| `style-src 'self' 'unsafe-inline'` | the components' inline styles |
| `img-src 'self' data: blob: https:` | pictures on elements, by address or as `data:`; metamodels' icons from meta.linked.archi |
| `connect-src 'self' https: wss:` | metamodels and the catalogue from meta.linked.archi, Git hosts' APIs, a collaboration server over `wss:` only |
| `worker-src 'self' blob:` | validation in a worker; the documentation's search |
| `font-src 'self' data:` | no web fonts from elsewhere |
| `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'` | no plug-ins, no base rewriting, framing by the site itself only |

With it, three more headers, by name: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`
and `Referrer-Policy: strict-origin-when-cross-origin`.

```nginx
# In the server block. All the headers here and nowhere else: a location
# that adds a header of its own drops every one inherited from here.
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" always;
```

Read them from the server (other headers left out):

```console
$ curl -sI https://app.linked.archi/la-gram/
HTTP/2 200
content-type: text/html; charset=utf-8
…
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
cache-control: no-cache
content-security-policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
…
```

The desktop app has a policy of its own, which also allows `ws:` and servers on the computer
([Desktop app internals](../reference/desktop.md#content-security-policy)).

## Compression {#compression}

nginx compresses HTML always; the types la-gram needs besides are listed. The WebAssembly and the
Turtle files gain most.

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/javascript application/json
           application/wasm text/turtle image/svg+xml;
```

`text/html` is left out of `gzip_types` on purpose: nginx compresses it anyway, and warns of a
duplicate when it is listed.

## Collaboration behind TLS {#behind-tls}

A page served over HTTPS may connect only to `wss:` servers, and the policy above allows only `wss:`.
The collaboration server speaks plain `ws:`, so run it behind a proxy that terminates TLS, and give its
address with [`?ws=`](../reference/url-parameters.md#ws):

```text
https://app.linked.archi/la-gram/?room=acme-review&ws=wss://collab.example.org
```

The proxy's part is in [Collaboration server](collaboration-server.md#tls).

## Checked locally

Every nginx snippet on this page, put together with `<host>` and `<web-root>` filled in and plain HTTP
in place of TLS, passes `nginx -t` with nginx 1.24 and serves a `dist/web` build as described: the
redirects, `try_files` (with the 301 for `/la-gram/docs`), the `.wasm` and `.ttl` types, the cache rule,
the headers and compression of both `.wasm` and `.ttl`.
