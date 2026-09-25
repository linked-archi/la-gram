#!/usr/bin/env node
/**
 * la-gram collaboration server.
 *
 * A Hocuspocus (Yjs) WebSocket server whose documents are RDF models. Each room
 * is one model; its Y.Doc holds a `Y.Map` named `triples` keyed by N-Triples
 * lines (see `src/collab/rdf-yjs-binding.ts`), which makes persistence trivial
 * and tool-friendly:
 *
 *   data/rooms/<room>.nt    the working state, one triple per line (authoritative)
 *   data/rooms/<room>.ttl   the same, pretty-printed Turtle, for people and Git
 *
 * and lets the server answer plain HTTP with the live model:
 *
 *   GET /rooms/<room>.ttl   the room's model as Turtle
 *   GET /rooms/<room>.nt    as N-Triples
 *   GET /rooms              the rooms on disk, as JSON
 *
 * Usage:
 *   node server/collab-server.mjs            # port 1234, ./data/rooms
 *   PORT=4000 DATA_DIR=/var/la-gram node server/collab-server.mjs
 *
 * Requires Node 22+ (Hocuspocus 4).
 */

import { Server } from '@hocuspocus/server';
import { Parser, Writer } from 'n3';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? process.env.HOCUSPOCUS_PORT ?? 1234);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(here, '..', 'data', 'rooms'));
const TRIPLES_MAP = 'triples';

/** Prefixes for the Turtle snapshot. The model's own (`m:`) is added per model. */
const PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  vann: 'http://purl.org/vocab/vann/',
  arch: 'https://meta.linked.archi/core#',
  'arch-vis': 'https://meta.linked.archi/core-vis#',
  am4: 'https://meta.linked.archi/archimate4/onto#',
  am3: 'https://meta.linked.archi/archimate3/onto#',
};

/** A room name safe to use as a file name. */
function fileBase(room) {
  const safe = room.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_');
  return path.join(DATA_DIR, safe.slice(0, 120) || 'room');
}

/** Write a file atomically: a crash mid-write must not truncate the model. */
async function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

/** N-Triples lines of a room's document, sorted so the file diffs cleanly. */
function linesOf(document) {
  return [...document.getMap(TRIPLES_MAP).keys()].sort();
}

/**
 * The model's namespace and prefix, as the editor reads them
 * (`src/model-manager/model-namespace.ts`): the model's VANN statements, else
 * derived from the model IRI.
 */
function modelNamespace(quads, model) {
  const value = (local) =>
    quads.find((q) => q.subject.value === model && q.predicate.value === PREFIXES.vann + local)?.object.value.trim();
  const uri = value('preferredNamespaceUri');
  const prefix = value('preferredNamespacePrefix');
  let namespace;
  if (uri) namespace = /[/#:]$/.test(uri) ? uri : `${uri}/`;
  else if (/[/#]$/.test(model)) namespace = model;
  else if (/[/#]model$/.test(model)) namespace = model.slice(0, -'model'.length);
  else namespace = `${model}/`;
  return { namespace, prefix: prefix && /^[A-Za-z]([\w.-]*[\w-])?$/.test(prefix) ? prefix : 'm' };
}

/** Turtle for a set of N-Triples lines. */
function toTurtle(lines) {
  const quads = new Parser({ format: 'N-Triples', blankNodePrefix: '' }).parse(lines.map((l) => `${l} .`).join('\n'));
  const model = quads.find(
    (q) => q.predicate.value === PREFIXES.rdf + 'type' && q.object.value === PREFIXES.arch + 'Model',
  )?.subject.value;
  const prefixes = { ...PREFIXES };
  if (model) {
    const own = modelNamespace(quads, model);
    prefixes[own.prefix] = own.namespace;
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer({ prefixes });
    for (const q of quads) writer.addQuad(q);
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

async function readLines(room) {
  try {
    const text = await readFile(`${fileBase(room)}.nt`, 'utf8');
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\s*\.\s*$/, ''));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const server = new Server({
  port: PORT,
  quiet: true,
  // Save shortly after edits settle, and at least every 10 s during a burst.
  debounce: 1500,
  maxDebounce: 10000,

  async onListen() {
    await mkdir(DATA_DIR, { recursive: true });
    console.log(`[la-gram collab] ws://localhost:${PORT}  ·  rooms in ${DATA_DIR}`);
  },

  /** Hydrate a room from disk the first time anyone opens it. */
  async onLoadDocument({ document, documentName }) {
    const lines = await readLines(documentName);
    if (lines.length === 0) return document;
    const map = document.getMap(TRIPLES_MAP);
    document.transact(() => {
      for (const line of lines) map.set(line, true);
    });
    console.log(`[la-gram collab] loaded "${documentName}" (${lines.length} triples)`);
    return document;
  },

  /** Persist the working state. */
  async onStoreDocument({ document, documentName }) {
    await mkdir(DATA_DIR, { recursive: true });
    const lines = linesOf(document);
    const base = fileBase(documentName);
    await writeAtomic(`${base}.nt`, lines.map((l) => `${l} .`).join('\n') + (lines.length ? '\n' : ''));
    await writeAtomic(`${base}.ttl`, await toTurtle(lines));
  },

  /** Plain HTTP: the live model, for tools that do not speak Yjs. */
  async onRequest({ request, response, instance }) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (url.pathname === '/rooms') {
      await mkdir(DATA_DIR, { recursive: true });
      const onDisk = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.nt')).map((f) => f.slice(0, -3));
      const live = [...instance.documents.keys()];
      response.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      response.end(JSON.stringify({ rooms: [...new Set([...onDisk, ...live])].sort() }));
      throw null; // handled: stop Hocuspocus's default response
    }
    const match = /^\/rooms\/(.+)\.(ttl|nt)$/.exec(url.pathname);
    if (!match) return;
    const room = decodeURIComponent(match[1]);
    const doc = instance.documents.get(room);
    const lines = doc ? linesOf(doc) : (await readLines(room)).sort();
    if (match[2] === 'nt') {
      response.writeHead(200, { 'Content-Type': 'application/n-triples; charset=utf-8', ...cors });
      response.end(lines.map((l) => `${l} .`).join('\n'));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/turtle; charset=utf-8', ...cors });
      response.end(await toTurtle(lines));
    }
    throw null;
  },
});

server.listen();
