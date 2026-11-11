---
title: Collaboration server
description: How to run la-gram's collaboration server, where it keeps each room's model, its HTTP API, TLS in front of it, and its security limits.
---
# Collaboration server

la-gram's collaboration rooms need a server that holds each room's model and passes every change to the
others in the room ([Collaboration](../guide/collaboration.md)). It is `server/collab-server.mjs` in
la-gram's repository, a [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) WebSocket server
whose documents are RDF models. No release builds or deploys it: whoever wants rooms runs it.

!!! warning "No authentication: run it only where you trust everyone who can reach it"

    The server checks no one. Anyone who can reach its port can join any room, read its model, change it
    or empty it, and its HTTP API lists every room and serves each model to any web page
    (`Access-Control-Allow-Origin: *`). It listens on every network interface of its machine. Run it on a
    machine and a network where everyone who can reach it may see and change every model, or put a proxy
    in front of it that admits only them.

## Run it {#run-it}

From a checkout of la-gram, after `npm ci`, with **Node 22** or later (Hocuspocus 4 needs it):

```console
$ PORT=41234 DATA_DIR=/tmp/la-gram-docs-rooms npm run collab

> la-gram@0.1.0 collab
> node server/collab-server.mjs

[la-gram collab] ws://localhost:41234  ·  rooms in /tmp/la-gram-docs-rooms
```

`npm run collab` is `node server/collab-server.mjs`; either runs it in the foreground until stopped
(++ctrl+c++). Without the variables it listens on port **1234** and keeps rooms in `data/rooms/` of the
checkout, which is what the app's default `ws://localhost:1234` expects.

Then join a room from the app, with the server's address in [`ws`](../reference/url-parameters.md#ws):

```text
https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl&room=acme-online-shop&ws=wss://collab.example.org&user=Jane%20Doe
```

The room was new, so the example model went into it, and the server wrote it to disk about a second and
a half later. Run as above, on this machine's own app build with `ws=ws://127.0.0.1:41234`, the room
`acme-online-shop` then held the model's 208 triples, and Jane Doe was the one person in it.

## Port {#port}

| Variable | Values | Default |
|---|---|---|
| `PORT` | the TCP port to listen on | **1234** |
| `HOCUSPOCUS_PORT` | the same, read when `PORT` is not set | — |

`PORT` wins when both are set. The WebSocket and the [HTTP API](#http-api) share the port.

```console
$ HOCUSPOCUS_PORT=41236 DATA_DIR=/tmp/la-gram-docs-rooms npm run collab
…
[la-gram collab] ws://localhost:41236  ·  rooms in /tmp/la-gram-docs-rooms
```

## Data directory {#data-dir}

| Variable | Values | Default |
|---|---|---|
| `DATA_DIR` | a folder; made if missing | **`data/rooms/`** in the checkout, beside `server/` |

The folder holds every room's files ([below](#room-files)). Back it up to keep the rooms: the server
holds nothing else. A room whose files are there is loaded from them the first time someone opens it
after a restart, and that person gets the room's model.

The server restarted on the same folder, and the room opened again by another user,
`?room=acme-online-shop&user=Marcus%20Reid`, with no model of their own:

```console
$ PORT=41234 DATA_DIR=/tmp/la-gram-docs-rooms npm run collab
…
[la-gram collab] ws://localhost:41234  ·  rooms in /tmp/la-gram-docs-rooms
[la-gram collab] loaded "acme-online-shop" (208 triples)
```

## Room files {#room-files}

Each room is two files in the data directory, named after the room:

| File | Holds |
|---|---|
| `<room>.nt` | the room's model as N-Triples, one triple per line, sorted: **authoritative**, what the server loads |
| `<room>.ttl` | the same model as Turtle, with prefixes, for people and for Git |

- **Names:** every run of characters other than letters, digits, `.`, `_` and `-` becomes `_`, a leading
  `.` becomes `_`, and a name is cut at 120 characters.
- **When:** the server writes **1500 ms** after the edits settle, and at least every **10 000 ms** during a
  long burst of edits.
- **How:** each file is written to a temporary file and renamed into place, so a crash never leaves a
  half-written model.
- **Prefixes of the Turtle file:** `rdf`, `rdfs`, `xsd`, `skos`, `dcterms`, `vann`, `arch`, `arch-vis`,
  `am4` and `am3`, and the model's own, from its `vann:preferredNamespacePrefix` and
  `vann:preferredNamespaceUri`, else from its IRI, as `m:`.

```console
$ ls /tmp/la-gram-docs-rooms
acme-online-shop.nt
acme-online-shop.ttl
$ wc -l < /tmp/la-gram-docs-rooms/acme-online-shop.nt
     208
```

The start of `acme-online-shop.ttl`, with one of its resources:

```turtle
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix dcterms: <http://purl.org/dc/terms/>.
@prefix vann: <http://purl.org/vocab/vann/>.
@prefix arch: <https://meta.linked.archi/core#>.
@prefix arch-vis: <https://meta.linked.archi/core-vis#>.
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.
@prefix am3: <https://meta.linked.archi/archimate3/onto#>.
@prefix m: <https://example.org/acme/shop/>.
m:gift-wrapping a am4:Service;
    skos:prefLabel "Gift wrapping"@en;
    am4:qualifiedServing m:gift-wrapping-serves-customer;
    am4:serves m:customer;
    arch:inModel m:model;
    arch:inView m:view-service-realization.
```

The Turtle file opens in la-gram with *File › Open…*, as any model file does.

## HTTP API {#http-api}

The same port answers plain HTTP, for tools that do not speak the collaboration protocol:

| Request | Answers |
|---|---|
| `GET /rooms` | the rooms, on disk and open now, as JSON: `{"rooms": […]}` |
| `GET /rooms/<room>.ttl` | the room's model as Turtle (`text/turtle`), live if the room is open, else from its files |
| `GET /rooms/<room>.nt` | the same as N-Triples (`application/n-triples`) |

Every answer carries `Access-Control-Allow-Origin: *`. A room that does not exist answers 200 with an
empty model: the Turtle file is only its prefixes.

```console
$ curl -s http://localhost:41234/rooms
{"rooms":["acme-online-shop"]}
$ curl -sI http://localhost:41234/rooms
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
…
$ curl -s http://localhost:41234/rooms/acme-online-shop.ttl -o acme-online-shop.ttl -w '%{http_code} %{content_type}\n'
200 text/turtle; charset=utf-8
$ curl -s http://localhost:41234/rooms/acme-online-shop.nt -o acme-online-shop.nt -w '%{http_code} %{content_type}\n'
200 application/n-triples; charset=utf-8
```

## Security {#security}

What the server does not do, and what follows:

| It has | So |
|---|---|
| no authentication and no authorization | anyone who reaches the port can join, read, change or empty any room |
| `Access-Control-Allow-Origin: *` on its HTTP API | any web page a user opens can read every room's model through that user's browser |
| no TLS of its own | its traffic is readable on the network, and an HTTPS page cannot connect to it ([below](#tls)) |
| a listener on every interface | it is reachable from the network, not only from its machine |

Keep it on a machine and network where that is acceptable, such as a workshop's laptop or a team's
private network. To restrict who reaches it, put it behind a proxy that authenticates, or a firewall
that admits only your network. The app connects with a WebSocket and sends no credentials of its own.

Any site may read a room, here asked as a page on `https://example.com` would ask; the answer is the
room's whole model, its 208 triples as N-Triples (the last without a line end, so `wc -l` counts 207):

```console
$ curl -s -D - -o /dev/null -H 'Origin: https://example.com' http://localhost:41234/rooms/acme-online-shop.nt | grep -i access-control
Access-Control-Allow-Origin: *
$ curl -s http://localhost:41234/rooms/acme-online-shop.nt | wc -l
     207
```

## TLS in front of it {#tls}

The app on app.linked.archi, or on any HTTPS site, connects only to `wss:` addresses. Put a proxy that
terminates TLS in front of the server, and pass the WebSocket upgrade on. With nginx, on a host name of
its own and with your TLS settings:

```nginx
server {
    listen 443 ssl;
    server_name <collab-host>;
    # TLS: your certificate and key, as the rest of your server has them.

    location / {
        proxy_pass http://127.0.0.1:1234;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
    }
}
```

Users then join with `?ws=wss://<collab-host>`. `proxy_read_timeout` keeps quiet connections open; the
default of 60 seconds would close an idle room's connection, which the app then reopens.

This snippet, with plain HTTP for the test, passed `nginx -t` with nginx 1.24, and through it the server
answered a WebSocket upgrade with `101 Switching Protocols` and `GET /rooms` with the room list.
