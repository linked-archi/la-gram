/**
 * A snapshot refresh chooses its source explicitly and commits only complete
 * downloads. Exercise real bytes in isolated asset trees without the network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseOptions, syncAssets } from '../../scripts/sync-assets.mjs';

const SITE = 'https://meta.linked.archi/';
const NS = `${SITE}example/onto#`;
const ONTOLOGY = 'example/arbitrary-bundle-name.ttl';
const ICON = 'example/icons/existing.svg';
const NEW_ICON = 'example/icons/new.svg';
const SOURCE = `${SITE}example/onto/ontology.ttl`;
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">\r\n<!-- kept byte for byte: é -->\r\n<path d="M0 0"/>\r\n</svg>\r\n');
const NEW_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>');

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function write(file: string, body: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function ontology(label: string, extra = ''): string {
  return `@prefix vann: <http://purl.org/vocab/vann/> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
<${NS}> a <http://www.w3.org/2002/07/owl#Ontology> ;
    vann:preferredNamespaceUri "${NS}" ; skos:prefLabel "${label}"@en .
${extra}`;
}

function catalogue(label: string): string {
  return `<${SITE}catalog> a <http://www.w3.org/ns/dcat#Catalog> ;
    <http://purl.org/dc/terms/title> "${label}"@en .\n`;
}

function fixture(withCatalogue = true): { root: string; assets: string } {
  const root = mkdtempSync(join(tmpdir(), 'la-gram-sync-assets-'));
  roots.push(root);
  const assets = join(root, 'assets');
  write(join(assets, ONTOLOGY), ontology('Old ontology'));
  write(join(assets, ICON), '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>');
  if (withCatalogue) write(join(assets, 'catalog.ttl'), catalogue('Old catalogue'));
  return { root, assets };
}

/** Include directories too: --check must not create a new output folder. */
function tree(root: string): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) { result[`${rel}/`] = null; walk(join(at, entry.name), `${rel}/`); }
      else result[rel] = readFileSync(join(at, entry.name)).toString('base64');
    }
  };
  walk(root, '');
  return result;
}

type Reply = { body: string | Uint8Array; type?: string; status?: number };
function remote(overrides: Record<string, Reply> = {}, text = ontology('Published ontology')) {
  const replies: Record<string, Reply> = {
    [`${SITE}catalog.ttl`]: { body: catalogue('Published catalogue'), type: 'text/turtle' },
    [SOURCE]: { body: text, type: 'text/turtle; charset=utf-8' },
    [`${SITE}${ICON}`]: { body: SVG, type: 'image/svg+xml' },
    [`${SITE}${NEW_ICON}`]: { body: NEW_SVG, type: 'image/svg+xml' },
    ...overrides,
  };
  return vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const reply = replies[String(url)];
    if (!reply) throw new Error(`Unexpected download: ${url}`);
    return new Response(reply.body, { status: reply.status ?? 200, headers: { 'content-type': reply.type ?? 'text/turtle' } });
  });
}

function localCheckout(root: string, withCatalogue = true): string {
  const meta = join(root, 'meta');
  write(join(meta, 'published/example/onto/ontology.ttl'), ontology('Unpublished local ontology'));
  write(join(meta, 'published', ICON), SVG);
  write(join(meta, 'published', NEW_ICON), NEW_SVG);
  // The two publishing scripts stand in for meta's scripts, not for sync logic.
  // Their single output argument is the isolated publish tree the script reads.
  for (const name of ['copy-ttl-sources.sh', 'copy-icon-assets.sh']) {
    write(join(meta, '.scripts', name), '#!/usr/bin/env bash\nset -eu\ncp -R "$(dirname "$0")/../published/." "$1/"\n');
  }
  if (withCatalogue) write(join(meta, '.onto-docs/catalog.ttl'), catalogue('Local catalogue'));
  return meta;
}

describe('sync-assets source selection', () => {
  it('defaults to the published site without a local checkout', () => {
    const options = parseOptions([], {});
    expect(options.check).toBe(false);
    expect(options.meta).toBeUndefined();
    expect(parseOptions(['--check'], {}).check).toBe(true);
  });

  it('keeps local opt-ins, explicit path precedence, and an online override', () => {
    expect(parseOptions([], { LINKED_ARCHI_META: '/tmp/meta-env' }).meta).toBe('/tmp/meta-env');
    expect(parseOptions(['--meta', '/tmp/meta-explicit'], { LINKED_ARCHI_META: '/tmp/meta-env' }).meta).toBe('/tmp/meta-explicit');
    expect(parseOptions(['--online'], { LINKED_ARCHI_META: '/tmp/meta-env' }).meta).toBeUndefined();
    expect(parseOptions(['--online', '--check'], {}).check).toBe(true);
  });

  it.each([
    ['--meta'], ['--meta', '--check'], ['--unknown'], ['--online', '--meta', '/tmp/meta'],
  ])('rejects an invalid command before syncing: %j', (...args) => {
    expect(() => parseOptions(args, {})).toThrow();
  });
});

describe('online semantic snapshot refresh', () => {
  it('reads published paths by namespace, revalidates, and preserves exact SVG bytes', async () => {
    const { root, assets } = fixture();
    const fetchImpl = remote();
    await syncAssets({ root, fetchImpl, log: () => {} });
    expect(readFileSync(join(assets, ONTOLOGY), 'utf8')).toBe(ontology('Published ontology'));
    expect(readFileSync(join(assets, 'catalog.ttl'), 'utf8')).toBe(catalogue('Published catalogue'));
    expect(readFileSync(join(assets, ICON))).toEqual(SVG);
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      SOURCE, `${SITE}catalog.ttl`, `${SITE}${ICON}`,
    ].sort());
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(init?.cache).toBe('no-cache');
      expect(init?.signal).toBeDefined();
      expect(new Headers(init?.headers).get('Accept')).toBe(String(url).endsWith('.svg') ? 'image/svg+xml' : 'text/turtle');
    }
  });

  it('accepts an SVG document with an XML prolog, exporter comments and a doctype', async () => {
    const { root, assets } = fixture();
    const exported = Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<!-- exporter metadata -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- image -->\n<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>\n');
    await syncAssets({ root, fetchImpl: remote({ [`${SITE}${ICON}`]: { body: exported, type: 'image/svg+xml' } }), log: () => {} });
    expect(readFileSync(join(assets, ICON))).toEqual(exported);
  });

  it('reports changed and newly referenced assets without modifying anything in --check mode', async () => {
    const { root, assets } = fixture();
    const text = ontology('Published ontology', `<${NS}Widget> <${SITE}core-vis#iconSymbol> "${SITE}${NEW_ICON}"^^<http://www.w3.org/2001/XMLSchema#anyURI> .`);
    const before = tree(root);
    const result = await syncAssets({ root, check: true, fetchImpl: remote({}, text), log: () => {} });
    expect(result.updated).toHaveLength(3);
    expect(result.added).toHaveLength(1);
    expect(tree(root)).toEqual(before);
    expect(existsSync(join(assets, NEW_ICON))).toBe(false);
  });

  it('copies new referenced icons and adds a catalogue missing from the bundle', async () => {
    const { root, assets } = fixture(false);
    const text = ontology('Published ontology', `<${NS}Widget> <${SITE}core-vis#iconSymbol> <${SITE}${NEW_ICON}> .`);
    const result = await syncAssets({ root, fetchImpl: remote({}, text), log: () => {} });
    expect(result.added).toHaveLength(2);
    expect(readFileSync(join(assets, NEW_ICON))).toEqual(NEW_SVG);
    expect(readFileSync(join(assets, 'catalog.ttl'), 'utf8')).toBe(catalogue('Published catalogue'));
  });

  it('leaves the entire snapshot untouched when a newly referenced icon fetch fails after the first batch', async () => {
    const { root } = fixture();
    const before = tree(root);
    const text = ontology('Published ontology', `<${NS}Widget> <${SITE}core-vis#iconSymbol> <${SITE}${NEW_ICON}> .`);
    const fetchImpl = remote({ [`${SITE}${NEW_ICON}`]: { body: 'Missing', status: 404 } }, text);
    await expect(syncAssets({ root, fetchImpl, log: () => {} })).rejects.toThrow();
    expect(tree(root)).toEqual(before);
  });

  it.each([
    [SOURCE, { body: '<html><body>Maintenance</body></html>', type: 'text/html' }],
    [`${SITE}catalog.ttl`, { body: '<html><body>Maintenance</body></html>', type: 'text/turtle' }],
    [`${SITE}${ICON}`, { body: '<html><body><svg xmlns="http://www.w3.org/2000/svg"><path/></svg>Maintenance</body></html>', type: 'image/svg+xml' }],
    [SOURCE, { body: '@prefix invalid Turtle', type: 'text/turtle' }],
    [SOURCE, { body: '  \n# No triples returned by a broken endpoint\n', type: 'text/turtle' }],
  ] as Array<[string, Reply]>)('rejects a non-asset response from %s without partial writes', async (url, reply) => {
    const { root } = fixture();
    const before = tree(root);
    await expect(syncAssets({ root, fetchImpl: remote({ [url]: reply }), log: () => {} })).rejects.toThrow();
    expect(tree(root)).toEqual(before);
  });
});

describe('local checkout snapshot refresh', () => {
  it('uses the checkout publishing scripts and catalogue without making network requests', async () => {
    const { root, assets } = fixture();
    const meta = localCheckout(root);
    const fetchImpl = vi.fn(async () => { throw new Error('Local sync must not fetch'); });
    await syncAssets({ root, meta, fetchImpl, log: () => {} });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFileSync(join(assets, ONTOLOGY), 'utf8')).toBe(ontology('Unpublished local ontology'));
    expect(readFileSync(join(assets, 'catalog.ttl'), 'utf8')).toBe(catalogue('Local catalogue'));
    expect(readFileSync(join(assets, NEW_ICON))).toEqual(NEW_SVG);
  });

  it('retains and reports a missing generated local catalogue', async () => {
    const { root, assets } = fixture();
    const meta = localCheckout(root, false);
    const log = vi.fn();
    await syncAssets({ root, meta, fetchImpl: remote(), log });
    expect(readFileSync(join(assets, 'catalog.ttl'), 'utf8')).toBe(catalogue('Old catalogue'));
    expect(log.mock.calls.map(([message]) => String(message)).join('\n')).toMatch(/catalog\.ttl.*(?:no|missing)|(?:no|missing).*catalog\.ttl/i);
  });
});
