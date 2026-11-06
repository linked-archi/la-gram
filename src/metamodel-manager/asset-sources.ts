/**
 * Where metamodel documents come from.
 *
 * The loader follows a manifest's `arch:*` references and `owl:imports` and asks
 * an {@link AssetSource} for each document IRI it discovers. Three sources exist,
 * and the application chains them:
 *
 * - {@link UploadedAssetSource} — documents the user supplied (file upload or a
 *   pasted IRI whose content was already fetched). Consulted first, so a local
 *   edit of a published file overrides the published one.
 * - {@link RemoteAssetSource} — dereferences the IRI over HTTP with
 *   `Accept: text/turtle`. `meta.linked.archi` serves every document with
 *   `Access-Control-Allow-Origin: *`, so the browser needs no proxy.
 * - {@link BundledAssetSource} — the copies under `assets/`, which mirror the
 *   published site. The offline fallback, and the only source in tests.
 *
 * ## Why the Accept header is a single type
 *
 * `meta.linked.archi` content-negotiates on the literal header value; a
 * multi-valued header with quality parameters (`text/turtle;q=1, *\/*;q=0.1`)
 * is answered with a 404 rather than the best match. One exact type is sent.
 */

import { Parser as N3Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import * as oxigraph from 'oxigraph';
import {
  BUNDLED_CATALOGUE_PATH,
  CATALOGUE_IRI,
  fetchAssetText,
  getAssetByIri,
  type BundledAssetRole,
} from './bundled-assets.js';

/** Serialization of a fetched document, as far as the loader cares. */
export type AssetFormat =
  | 'text/turtle'
  | 'application/trig'
  | 'application/n-triples'
  | 'application/n-quads'
  | 'application/ld+json'
  | 'application/rdf+xml';

/** Where a document was found. */
export type AssetOrigin = 'bundled' | 'remote' | 'uploaded';

/** A document as returned by a source. */
export interface AssetDocument {
  /** The document IRI asked for (the named-graph key). */
  documentIri: string;
  /** Raw text. */
  text: string;
  /** Serialization of {@link text}. */
  format: AssetFormat;
  /** Which source answered. */
  origin: AssetOrigin;
  /** The URL actually read, when it differs from the IRI (bundled path, redirect). */
  location?: string;
  /** Role, when the source knows it (the bundle registry does). */
  role?: BundledAssetRole;
}

/** Something that can turn a document IRI into its content. */
export interface AssetSource {
  /** A short name for status reporting. */
  readonly kind: AssetOrigin | 'chain';
  /**
   * The document behind `documentIri`, or `null` when this source does not
   * have it. Throws only for a real failure (the source *should* have it but
   * could not read it), so a chain can tell "absent" from "broken".
   */
  fetch(documentIri: string): Promise<AssetDocument | null>;
}

/** The URL to dereference for a document IRI: the IRI without its fragment. */
export function dereferenceUrl(documentIri: string): string {
  const hash = documentIri.indexOf('#');
  return hash === -1 ? documentIri : documentIri.slice(0, hash);
}

/**
 * Guess a format from a media type and, failing that, a file name.
 *
 * Returns `text/turtle` when nothing matches: Turtle is what every Linked.Archi
 * document is published as, and N-Triples is a subset of it.
 */
export function detectFormat(contentType: string | null | undefined, name?: string): AssetFormat {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/trig') return 'application/trig';
  if (type === 'application/n-quads') return 'application/n-quads';
  if (type === 'application/n-triples') return 'application/n-triples';
  if (type === 'application/ld+json' || type === 'application/json') return 'application/ld+json';
  if (type === 'application/rdf+xml' || type === 'application/xml' || type === 'text/xml') {
    return 'application/rdf+xml';
  }
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.trig')) return 'application/trig';
  if (lower.endsWith('.nq')) return 'application/n-quads';
  if (lower.endsWith('.nt')) return 'application/n-triples';
  if (lower.endsWith('.jsonld') || lower.endsWith('.json')) return 'application/ld+json';
  if (lower.endsWith('.rdf') || lower.endsWith('.owl') || lower.endsWith('.xml')) {
    return 'application/rdf+xml';
  }
  return 'text/turtle';
}

/**
 * Parse any supported serialization into quads.
 *
 * Turtle-family formats go through n3 (fast, keeps prefixes available to the
 * caller); JSON-LD and RDF/XML go through a throw-away Oxigraph store, which
 * parses both natively. Terms come back as n3 terms either way.
 */
export function parseRdf(text: string, format: AssetFormat, baseIri?: string): Quad[] {
  if (format === 'application/ld+json' || format === 'application/rdf+xml') {
    const scratch = new oxigraph.Store();
    scratch.load(text, { format, ...(baseIri ? { base_iri: baseIri } : {}) });
    const nquads = scratch.dump({ format: 'application/n-quads' });
    return new N3Parser({ format: 'application/n-quads' }).parse(nquads) as unknown as Quad[];
  }
  const parser = new N3Parser({ format, ...(baseIri ? { baseIRI: baseIri } : {}) });
  return parser.parse(text) as unknown as Quad[];
}

// ── Bundled ─────────────────────────────────────────────────────────────

/** Reads the copies shipped under `assets/` — the registry's files, and the catalogue. */
export class BundledAssetSource implements AssetSource {
  readonly kind = 'bundled' as const;

  async fetch(documentIri: string): Promise<AssetDocument | null> {
    if (documentIri === CATALOGUE_IRI) {
      const text = await fetchAssetText(BUNDLED_CATALOGUE_PATH);
      return { documentIri, text, format: 'text/turtle', origin: 'bundled', location: BUNDLED_CATALOGUE_PATH };
    }
    const asset = getAssetByIri(documentIri);
    if (!asset) return null;
    const text = await fetchAssetText(asset);
    return {
      documentIri,
      text,
      format: 'text/turtle',
      origin: 'bundled',
      location: asset.path,
      role: asset.role,
    };
  }
}

// ── Remote ──────────────────────────────────────────────────────────────

/** The part of `fetch` this module uses; injectable for tests. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; cache?: 'no-cache' },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Options for {@link RemoteAssetSource}. */
export interface RemoteAssetSourceOptions {
  /** Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Per-request timeout. A slow network must not stall startup indefinitely. */
  timeoutMs?: number;
  /**
   * Only dereference IRIs under these prefixes. Empty means "any http(s) IRI".
   * Keeps a manifest that `owl:imports` the whole web from fanning out.
   */
  allowedPrefixes?: readonly string[];
}

/** Dereferences document IRIs over HTTP. */
export class RemoteAssetSource implements AssetSource {
  readonly kind = 'remote' as const;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly timeoutMs: number;
  private readonly allowedPrefixes: readonly string[];

  constructor(options: RemoteAssetSourceOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ??
      (typeof fetch === 'function' ? (fetch.bind(globalThis) as unknown as FetchLike) : undefined);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.allowedPrefixes = options.allowedPrefixes ?? [];
  }

  async fetch(documentIri: string): Promise<AssetDocument | null> {
    if (!this.fetchImpl) return null;
    if (!/^https?:\/\//.test(documentIri)) return null;
    if (
      this.allowedPrefixes.length > 0 &&
      !this.allowedPrefixes.some((prefix) => documentIri.startsWith(prefix))
    ) {
      return null;
    }

    const url = dereferenceUrl(documentIri);
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'text/turtle' },
        // Always ask the server: meta.linked.archi sends no Cache-Control, so a
        // browser would otherwise keep a "fresh" copy for hours after a publish.
        // An unchanged document costs a 304.
        cache: 'no-cache',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) {
        // A 404 is "not here", not "broken": the chain moves on to the bundle.
        if (response.status === 404 || response.status === 410) return null;
        throw new Error(`${response.status} ${response.statusText} for <${url}>`);
      }
      const text = await response.text();
      const format = detectFormat(response.headers.get('content-type'), url);
      if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
        // A site answering an unknown path with its HTML 404 page.
        return null;
      }
      return {
        documentIri,
        text,
        format,
        origin: 'remote',
        location: response.url || url,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

// ── Uploaded ────────────────────────────────────────────────────────────

/** Documents the user handed over; answers only for IRIs it was given. */
export class UploadedAssetSource implements AssetSource {
  readonly kind = 'uploaded' as const;
  private readonly documents = new Map<string, AssetDocument>();

  /** Register a document under an IRI (normally the file's `owl:Ontology`). */
  add(documentIri: string, text: string, format: AssetFormat = 'text/turtle', name?: string): void {
    this.documents.set(documentIri, {
      documentIri,
      text,
      format,
      origin: 'uploaded',
      ...(name ? { location: name } : {}),
    });
  }

  /** Forget a document. */
  remove(documentIri: string): void {
    this.documents.delete(documentIri);
  }

  /** IRIs currently registered. */
  list(): string[] {
    return [...this.documents.keys()];
  }

  async fetch(documentIri: string): Promise<AssetDocument | null> {
    return this.documents.get(documentIri) ?? null;
  }
}

// ── Chain ───────────────────────────────────────────────────────────────

/**
 * Asks each source in turn; the first non-null answer wins.
 *
 * A source that *throws* is recorded and skipped, so a flaky network falls back
 * to the bundle. When every source either lacks the document or failed, the
 * last error is rethrown (so the loader reports `error`), or `null` is returned
 * when nobody failed (so the loader reports `not-bundled`/`unavailable`).
 */
export class ChainedAssetSource implements AssetSource {
  readonly kind = 'chain' as const;

  constructor(readonly sources: readonly AssetSource[]) {}

  async fetch(documentIri: string): Promise<AssetDocument | null> {
    let lastError: unknown;
    for (const source of this.sources) {
      try {
        const doc = await source.fetch(documentIri);
        if (doc) return doc;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError !== undefined) throw lastError;
    return null;
  }
}

/** How the application should resolve metamodel documents. */
export type AssetMode = 'bundled-first' | 'remote-first' | 'offline';

/**
 * The application's source chain.
 *
 * - `remote-first` (default when online): the published version wins, the
 *   bundle covers outages. What a user of a live metamodel expects.
 * - `bundled-first`: the bundle wins, remote covers what is not bundled. Faster
 *   and deterministic; what tests and demos want.
 * - `offline`: bundle only.
 */
export function createAssetSource(
  mode: AssetMode,
  uploaded: UploadedAssetSource = new UploadedAssetSource(),
  remoteOptions?: RemoteAssetSourceOptions,
): ChainedAssetSource {
  const bundled = new BundledAssetSource();
  if (mode === 'offline') return new ChainedAssetSource([uploaded, bundled]);
  const remote = new RemoteAssetSource(remoteOptions);
  return mode === 'remote-first'
    ? new ChainedAssetSource([uploaded, remote, bundled])
    : new ChainedAssetSource([uploaded, bundled, remote]);
}
