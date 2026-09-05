/**
 * TTL File I/O — wires TTL Serializer/Parser through PlatformService.
 *
 * Provides high-level save and load operations for architecture models
 * persisted as Turtle (TTL) files. Coordinates between the RDF engine
 * layer (parser, serializer, store) and the platform abstraction layer
 * (file dialogs, read/write).
 */

import type { Quad } from '@rdfjs/types';
import type { TtlParser, TtlSerializer, RdfStore, PrefixMap, ParseError } from '../rdf-engine/interfaces.js';
import type { PlatformService, FileFilter } from '../platform/interfaces.js';
import { PREFIXES } from '../rdf-engine/namespaces.js';

/** TTL file dialog filter. */
const TTL_FILTERS: FileFilter[] = [
  { name: 'Turtle files', extensions: ['ttl'] },
];

/** Result returned after saving a TTL file. */
export interface SaveResult {
  /** Whether the save completed successfully. */
  ok: boolean;
  /** Number of quads serialized. */
  quadCount: number;
  /** Error message if save failed. */
  error?: string;
}

/** Result returned after loading a TTL file. */
export interface LoadResult {
  /** Whether the load completed successfully. */
  ok: boolean;
  /** Name of the loaded file. */
  fileName: string;
  /** Number of quads loaded into the store. */
  quadCount: number;
  /** Parse error details if parsing failed. */
  parseError?: ParseError;
  /** Error message for non-parse failures (e.g. file I/O). */
  error?: string;
}

/** Result of a TTL export (serialization without file write). */
export interface ExportResult {
  /** The serialized Turtle string. */
  ttl: string;
  /** Number of quads serialized. */
  quadCount: number;
}

/**
 * TTL File I/O coordinator.
 *
 * Wires the TTL Serializer output through PlatformService for file save,
 * and PlatformService file read through TTL Parser for file load.
 */
export class TtlFileIO {
  constructor(
    private readonly parser: TtlParser,
    private readonly serializer: TtlSerializer,
    private readonly store: RdfStore,
    private readonly platform: PlatformService,
  ) {}

  /**
   * Export all model triples as a valid Turtle string.
   *
   * Retrieves all quads from the RDF store and serializes them
   * with the standard namespace prefixes plus any extras provided.
   */
  exportTtl(extraPrefixes?: PrefixMap): ExportResult {
    const quads = this.store.getQuads();
    const prefixes: PrefixMap = { ...PREFIXES, ...extraPrefixes };
    const ttl = this.serializer.serialize(quads, prefixes);
    return { ttl, quadCount: quads.length };
  }

  /**
   * Save all model triples to a TTL file via PlatformService.
   *
   * Serializes the full RDF store contents and writes the result
   * through the platform's file write mechanism.
   */
  async saveTtl(
    suggestedName?: string,
    extraPrefixes?: PrefixMap,
  ): Promise<SaveResult> {
    try {
      const { ttl, quadCount } = this.exportTtl(extraPrefixes);
      await this.platform.writeFile(ttl, suggestedName ?? 'model.ttl');
      return { ok: true, quadCount };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, quadCount: 0, error: message };
    }
  }

  /**
   * Load a TTL file via PlatformService and parse it into the RDF store.
   *
   * Opens a file through the platform's read mechanism, parses the
   * Turtle content, and adds the resulting quads to the store.
   */
  async loadTtl(): Promise<LoadResult> {
    let content: string;
    let fileName: string;

    try {
      const file = await this.platform.readFile();
      content = file.content;
      fileName = file.name;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, fileName: '', quadCount: 0, error: message };
    }

    return this.parseTtlIntoStore(content, fileName);
  }

  /**
   * Load a TTL file from a specific path (desktop only) and parse it
   * into the RDF store.
   */
  async loadTtlFromPath(path: string): Promise<LoadResult> {
    let content: string;
    let fileName: string;

    try {
      const file = await this.platform.readFile(path);
      content = file.content;
      fileName = file.name;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, fileName: '', quadCount: 0, error: message };
    }

    return this.parseTtlIntoStore(content, fileName);
  }

  /**
   * Parse TTL content and add quads to the store.
   */
  private parseTtlIntoStore(content: string, fileName: string): LoadResult {
    const result = this.parser.parse(content);

    if (!result.ok) {
      return {
        ok: false,
        fileName,
        quadCount: 0,
        parseError: result.error,
      };
    }

    this.store.addQuads(result.quads);
    return { ok: true, fileName, quadCount: result.quads.length };
  }
}
