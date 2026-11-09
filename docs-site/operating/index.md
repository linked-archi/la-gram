---
title: Operating
description: For people who host la-gram's web app, run its collaboration server or use la-gram-git in model repositories.
---
# Operating

These pages are for whoever runs la-gram for others: a web server that hosts the app, a collaboration
server for rooms, or the CI and the Git server of a model repository.

| Page | For |
|---|---|
| [Hosting the web app](web-app.md) | serving the app's static files and its documentation, with the types, caching, Content-Security-Policy and compression app.linked.archi's server uses |
| [Collaboration server](collaboration-server.md) | running the room server, where it keeps rooms, its HTTP API, TLS in front of it, and its security limits |
| [la-gram-git in CI](ci.md) | the GitHub Actions and GitLab CI templates that check models and comment on requests |
| [Container image](container-image.md) | la-gram-git's image, with Node.js and Git: its contents, tags and build |
| [Merge driver on Gitaly](gitaly.md) | la-gram-git as a merge driver on a self-managed GitLab |

What la-gram needs from each, at a glance:

- **The web app**: a static file server, with `.wasm` as `application/wasm` and `.ttl` as `text/turtle`,
  over HTTPS. Optionally `la-gram.config.json` beside `index.html`
  ([Deployment configuration file](../reference/configuration.md)).
- **Collaboration**: Node 22 or later and one open port, behind a TLS proxy for an HTTPS site. The server
  has no authentication.
- **Model repositories**: Node 20 or later and Git in CI, or la-gram-git's image; a token with
  Reporter and `api` on GitLab for the comment.

Try the pieces locally, from a la-gram checkout:

1. `npm ci`, then `npm run build:web && npm run docs:build`: the app and these pages in `dist/web/`.
2. `python3 -m http.server 41238 --directory dist/web`, and open `http://127.0.0.1:41238/`.
3. In another terminal, `npm run collab`, and open the app with `?room=acme-review`: it joins the room on
   `ws://localhost:1234`.
4. `npm run build:cli`, then `node packages/la-gram-git/dist/la-gram-git.js check docs-site/examples`:
   *1 model file checked: all well.*
