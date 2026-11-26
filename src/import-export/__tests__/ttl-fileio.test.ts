import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import type { TtlParser, TtlSerializer, RdfStore } from '@linked-archi/kernel/rdf-engine/interfaces.js';
import type { PlatformService } from '../../platform/interfaces.js';
import { TtlFileIO } from '../ttl-file-io.js';
import { PREFIXES } from '@linked-archi/kernel/rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

function makeQ(s: string, p: string, o: string): Quad {
  return quad(namedNode(s) as any, namedNode(p) as any, namedNode(o) as any) as unknown as Quad;
}
function makeLQ(s: string, p: string, o: string): Quad {
  return quad(namedNode(s) as any, namedNode(p) as any, literal(o) as any) as unknown as Quad;
}

const QUADS: Quad[] = [
  makeQ('urn:ex:s1', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', 'https://meta.linked.archi/core#Model'),
  makeLQ('urn:ex:s1', 'http://www.w3.org/2004/02/skos/core#prefLabel', 'Test'),
];
const TTL = '@prefix arch: <https://meta.linked.archi/core#> .\n';

function mkParser(): TtlParser {
  return { parse: vi.fn().mockReturnValue({ ok: true, quads: QUADS }) };
}
function mkSerializer(): TtlSerializer {
  return { serialize: vi.fn().mockReturnValue(TTL) };
}
function mkStore(q: Quad[] = QUADS): RdfStore {
  return {
    addQuads: vi.fn(), removeQuads: vi.fn(),
    getQuads: vi.fn().mockReturnValue(q),
    query: vi.fn(), update: vi.fn(),
  } as unknown as RdfStore;
}
function mkPlatform(): PlatformService {
  return {
    readFile: vi.fn().mockResolvedValue({ content: TTL, name: 'm.ttl' }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    showOpenDialog: vi.fn().mockResolvedValue('m.ttl'),
    showSaveDialog: vi.fn().mockResolvedValue('m.ttl'),
    isDesktop: vi.fn().mockReturnValue(false),
  };
}

describe('TtlFileIO', () => {
  let parser: TtlParser;
  let serializer: TtlSerializer;
  let store: RdfStore;
  let platform: PlatformService;
  let io: TtlFileIO;

  beforeEach(() => {
    parser = mkParser();
    serializer = mkSerializer();
    store = mkStore();
    platform = mkPlatform();
    io = new TtlFileIO(parser, serializer, store, platform);
  });

  describe('exportTtl', () => {
    it('retrieves quads from store and serializes them', () => {
      const result = io.exportTtl();
      expect(store.getQuads).toHaveBeenCalled();
      expect(serializer.serialize).toHaveBeenCalledWith(
        QUADS, expect.objectContaining(PREFIXES),
      );
      expect(result.ttl).toBe(TTL);
      expect(result.quadCount).toBe(2);
    });

    it('merges extra prefixes with standard ones', () => {
      io.exportTtl({ ex: 'https://example.org/' });
      expect(serializer.serialize).toHaveBeenCalledWith(
        QUADS, expect.objectContaining({ ex: 'https://example.org/' }),
      );
    });

    it('returns zero quadCount for empty store', () => {
      (store.getQuads as any).mockReturnValue([]);
      expect(io.exportTtl().quadCount).toBe(0);
    });
  });

  describe('saveTtl', () => {
    it('writes serialized TTL via platform', async () => {
      const result = await io.saveTtl('my-model.ttl');
      expect(result.ok).toBe(true);
      expect(result.quadCount).toBe(2);
      expect(platform.writeFile).toHaveBeenCalledWith(TTL, 'my-model.ttl');
    });

    it('uses default filename when none provided', async () => {
      await io.saveTtl();
      expect(platform.writeFile).toHaveBeenCalledWith(TTL, 'model.ttl');
    });

    it('returns error on write failure', async () => {
      (platform.writeFile as any).mockRejectedValue(new Error('Disk full'));
      const result = await io.saveTtl();
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Disk full');
    });

    it('passes extra prefixes to serializer', async () => {
      await io.saveTtl('out.ttl', { custom: 'https://c.ns/' });
      expect(serializer.serialize).toHaveBeenCalledWith(
        QUADS, expect.objectContaining({ custom: 'https://c.ns/' }),
      );
    });
  });

  describe('loadTtl', () => {
    it('reads file and parses into store', async () => {
      const result = await io.loadTtl();
      expect(result.ok).toBe(true);
      expect(result.fileName).toBe('m.ttl');
      expect(result.quadCount).toBe(2);
      expect(parser.parse).toHaveBeenCalledWith(TTL);
      expect(store.addQuads).toHaveBeenCalledWith(QUADS);
    });

    it('returns error on read failure', async () => {
      (platform.readFile as any).mockRejectedValue(new Error('No file'));
      const result = await io.loadTtl();
      expect(result.ok).toBe(false);
      expect(result.error).toBe('No file');
    });

    it('returns parse error for invalid TTL', async () => {
      (parser.parse as any).mockReturnValue({
        ok: false, error: { line: 3, message: 'bad' },
      });
      const result = await io.loadTtl();
      expect(result.ok).toBe(false);
      expect(result.parseError).toEqual({ line: 3, message: 'bad' });
      expect(store.addQuads).not.toHaveBeenCalled();
    });
  });

  describe('loadTtlFromPath', () => {
    it('reads from specific path', async () => {
      const result = await io.loadTtlFromPath('/home/user/model.ttl');
      expect(result.ok).toBe(true);
      expect(platform.readFile).toHaveBeenCalledWith('/home/user/model.ttl');
      expect(store.addQuads).toHaveBeenCalledWith(QUADS);
    });

    it('returns error on path read failure', async () => {
      (platform.readFile as any).mockRejectedValue(new Error('Not found'));
      const result = await io.loadTtlFromPath('/bad.ttl');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not found');
    });

    it('returns parse error for invalid content at path', async () => {
      (parser.parse as any).mockReturnValue({
        ok: false, error: { line: 5, message: 'EOF' },
      });
      const result = await io.loadTtlFromPath('/some.ttl');
      expect(result.ok).toBe(false);
      expect(result.parseError).toEqual({ line: 5, message: 'EOF' });
    });
  });
});
