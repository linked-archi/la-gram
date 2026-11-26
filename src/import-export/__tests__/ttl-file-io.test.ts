import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { TtlFileIO } from '../ttl-file-io.js';
import {
  N3TtlParser,
  N3TtlSerializer,
  OxigraphRdfStore,
  NAMESPACES,
  PREFIXES,
} from '@linked-archi/kernel/rdf-engine/index.js';
import type { PlatformService, FileFilter } from '../../platform/interfaces.js';

const { namedNode, literal, quad } = DataFactory;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'https://model.linked.archi/test/';

/** Build a quad with a NamedNode object. */
function refQuad(subject: string, predicate: string, object: string): Quad {
  return quad(
    namedNode(subject),
    namedNode(predicate),
    namedNode(object),
  ) as unknown as Quad;
}

/** Build a quad with a plain literal object. */
function litQuad(subject: string, predicate: string, value: string): Quad {
  return quad(
    namedNode(subject),
    namedNode(predicate),
    literal(value),
  ) as unknown as Quad;
}

/** A small but representative model: one typed element with a label. */
function sampleQuads(): Quad[] {
  return [
    refQuad(BASE + 'e1', NAMESPACES.rdf + 'type', NAMESPACES.arch + 'Element'),
    litQuad(BASE + 'e1', NAMESPACES.skos + 'prefLabel', 'Order Processing'),
    refQuad(BASE + 'e2', NAMESPACES.rdf + 'type', NAMESPACES.arch + 'Element'),
  ];
}

/** Mock PlatformService whose file contents are controlled per test. */
function mockPlatform(
  file: { content: string; name: string } = { content: '', name: 'model.ttl' },
) {
  return {
    readFile: vi
      .fn<[path?: string], Promise<{ content: string; name: string }>>()
      .mockResolvedValue(file),
    writeFile: vi
      .fn<[content: string, suggestedName?: string], Promise<void>>()
      .mockResolvedValue(undefined),
    showOpenDialog: vi
      .fn<[FileFilter[]?], Promise<string | null>>()
      .mockResolvedValue(null),
    showSaveDialog: vi
      .fn<[FileFilter[]?], Promise<string | null>>()
      .mockResolvedValue(null),
    isDesktop: vi.fn<[], boolean>().mockReturnValue(false),
  };
}

type MockPlatform = ReturnType<typeof mockPlatform>;

// Compile-time guard: the mock must satisfy the real interface.
const _platformShapeCheck: PlatformService = mockPlatform();
void _platformShapeCheck;

/** Wire a TtlFileIO with real RDF engine parts and a mock platform. */
function makeIO(platform: MockPlatform) {
  const parser = new N3TtlParser();
  const serializer = new N3TtlSerializer();
  const store = new OxigraphRdfStore();
  const io = new TtlFileIO(parser, serializer, store, platform);
  return { io, parser, serializer, store };
}

// ---------------------------------------------------------------------------
// exportTtl
// ---------------------------------------------------------------------------

describe('TtlFileIO.exportTtl', () => {
  it('serializes all store quads to Turtle', () => {
    const { io, store } = makeIO(mockPlatform());
    store.addQuads(sampleQuads());

    const result = io.exportTtl();

    expect(result.quadCount).toBe(3);
    expect(result.ttl).toContain('@prefix arch:');
    expect(result.ttl).toContain('arch:Element');
    expect(result.ttl).toContain('Order Processing');
  });

  it('returns prefix declarations only for an empty store', () => {
    const { io } = makeIO(mockPlatform());

    const result = io.exportTtl();

    expect(result.quadCount).toBe(0);
    expect(result.ttl).toContain('@prefix arch:');
    // No triples: every non-empty line is a prefix declaration.
    const nonPrefixLines = result.ttl
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('@prefix'));
    expect(nonPrefixLines).toHaveLength(0);
  });

  it('declares the standard prefixes used by the model', () => {
    const { io, store } = makeIO(mockPlatform());
    store.addQuads(sampleQuads());

    const { ttl } = io.exportTtl();

    expect(ttl).toContain(`@prefix arch: <${PREFIXES.arch}>`);
    expect(ttl).toContain(`@prefix skos: <${PREFIXES.skos}>`);
  });

  it('merges extra prefixes so their IRIs are abbreviated', () => {
    const { io, store } = makeIO(mockPlatform());
    store.addQuads([
      refQuad('https://example.org/thing', NAMESPACES.rdf + 'type', NAMESPACES.arch + 'Element'),
    ]);

    const withExtra = io.exportTtl({ ex: 'https://example.org/' });
    const withoutExtra = io.exportTtl();

    expect(withExtra.ttl).toContain('@prefix ex: <https://example.org/>');
    expect(withExtra.ttl).toContain('ex:thing');
    expect(withoutExtra.ttl).not.toContain('@prefix ex:');
    expect(withoutExtra.ttl).toContain('<https://example.org/thing>');
  });
});

// ---------------------------------------------------------------------------
// saveTtl
// ---------------------------------------------------------------------------

describe('TtlFileIO.saveTtl', () => {
  let platform: MockPlatform;

  beforeEach(() => {
    platform = mockPlatform();
  });

  it('writes the serialized model through the platform', async () => {
    const { io, store } = makeIO(platform);
    store.addQuads(sampleQuads());
    const expected = io.exportTtl().ttl;

    const result = await io.saveTtl('my-model.ttl');

    expect(result).toEqual({ ok: true, quadCount: 3 });
    expect(platform.writeFile).toHaveBeenCalledTimes(1);
    expect(platform.writeFile).toHaveBeenCalledWith(expected, 'my-model.ttl');
  });

  it('falls back to model.ttl when no name is suggested', async () => {
    const { io, store } = makeIO(platform);
    store.addQuads(sampleQuads());

    await io.saveTtl();

    expect(platform.writeFile).toHaveBeenCalledWith(expect.any(String), 'model.ttl');
  });

  it('applies extra prefixes to the written content', async () => {
    const { io, store } = makeIO(platform);
    store.addQuads([
      refQuad('https://example.org/thing', NAMESPACES.rdf + 'type', NAMESPACES.arch + 'Element'),
    ]);

    await io.saveTtl('out.ttl', { ex: 'https://example.org/' });

    const [content] = platform.writeFile.mock.calls[0];
    expect(content).toContain('@prefix ex: <https://example.org/>');
  });

  it('saves an empty store as a triple-free document', async () => {
    const { io } = makeIO(platform);

    const result = await io.saveTtl();

    expect(result).toEqual({ ok: true, quadCount: 0 });
    const [content, name] = platform.writeFile.mock.calls[0];
    expect(name).toBe('model.ttl');
    expect(content).toContain('@prefix arch:');
    expect(content).not.toContain(NAMESPACES.arch + 'Element');
  });

  it('reports failure when the platform write rejects', async () => {
    platform.writeFile.mockRejectedValue(new Error('Disk full'));
    const { io, store } = makeIO(platform);
    store.addQuads(sampleQuads());

    const result = await io.saveTtl();

    expect(result.ok).toBe(false);
    expect(result.quadCount).toBe(0);
    expect(result.error).toBe('Disk full');
  });

  it('stringifies non-Error rejections', async () => {
    platform.writeFile.mockRejectedValue('cancelled');
    const { io } = makeIO(platform);

    const result = await io.saveTtl();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// loadTtl
// ---------------------------------------------------------------------------

const VALID_TTL = `
@prefix arch: <${NAMESPACES.arch}> .
@prefix skos: <${NAMESPACES.skos}> .
@prefix ex: <${BASE}> .

ex:e1 a arch:Element ;
  skos:prefLabel "Order Processing" .
ex:e2 a arch:Element .
`;

describe('TtlFileIO.loadTtl', () => {
  it('parses the opened file into the store', async () => {
    const platform = mockPlatform({ content: VALID_TTL, name: 'loaded.ttl' });
    const { io, store } = makeIO(platform);

    const result = await io.loadTtl();

    expect(result.ok).toBe(true);
    expect(result.fileName).toBe('loaded.ttl');
    expect(result.quadCount).toBe(3);
    expect(result.parseError).toBeUndefined();
    expect(store.getQuads()).toHaveLength(3);
    expect(platform.readFile).toHaveBeenCalledWith();
  });

  it('adds loaded quads on top of existing store content', async () => {
    const platform = mockPlatform({ content: VALID_TTL, name: 'loaded.ttl' });
    const { io, store } = makeIO(platform);
    store.addQuads([
      refQuad(BASE + 'pre', NAMESPACES.rdf + 'type', NAMESPACES.arch + 'Element'),
    ]);

    await io.loadTtl();

    expect(store.getQuads()).toHaveLength(4);
  });

  it('reports a parse error and leaves the store untouched for invalid TTL', async () => {
    const platform = mockPlatform({ content: 'this is not turtle @@@', name: 'broken.ttl' });
    const { io, store } = makeIO(platform);

    const result = await io.loadTtl();

    expect(result.ok).toBe(false);
    expect(result.fileName).toBe('broken.ttl');
    expect(result.quadCount).toBe(0);
    expect(result.parseError).toBeDefined();
    expect(result.parseError!.line).toBeGreaterThanOrEqual(1);
    expect(result.parseError!.message).toBeTruthy();
    expect(store.getQuads()).toHaveLength(0);
  });

  it('reports an error when the platform read rejects', async () => {
    const platform = mockPlatform();
    platform.readFile.mockRejectedValue(new Error('No file selected'));
    const { io, store } = makeIO(platform);

    const result = await io.loadTtl();

    expect(result.ok).toBe(false);
    expect(result.fileName).toBe('');
    expect(result.quadCount).toBe(0);
    expect(result.error).toBe('No file selected');
    expect(store.getQuads()).toHaveLength(0);
  });

  it('loads an empty file as zero quads', async () => {
    const platform = mockPlatform({ content: '', name: 'empty.ttl' });
    const { io } = makeIO(platform);

    const result = await io.loadTtl();

    expect(result.ok).toBe(true);
    expect(result.quadCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadTtlFromPath
// ---------------------------------------------------------------------------

describe('TtlFileIO.loadTtlFromPath', () => {
  it('forwards the path to the platform and parses the result', async () => {
    const platform = mockPlatform({ content: VALID_TTL, name: 'model.ttl' });
    const { io, store } = makeIO(platform);

    const result = await io.loadTtlFromPath('/home/user/model.ttl');

    expect(result.ok).toBe(true);
    expect(result.fileName).toBe('model.ttl');
    expect(result.quadCount).toBe(3);
    expect(platform.readFile).toHaveBeenCalledWith('/home/user/model.ttl');
    expect(store.getQuads()).toHaveLength(3);
  });

  it('reports an error when the path cannot be read', async () => {
    const platform = mockPlatform();
    platform.readFile.mockRejectedValue(new Error('ENOENT'));
    const { io } = makeIO(platform);

    const result = await io.loadTtlFromPath('/missing.ttl');

    expect(result.ok).toBe(false);
    expect(result.fileName).toBe('');
    expect(result.error).toBe('ENOENT');
  });

  it('reports a parse error for invalid content at the path', async () => {
    const platform = mockPlatform({ content: '<a> <b> .', name: 'bad.ttl' });
    const { io } = makeIO(platform);

    const result = await io.loadTtlFromPath('/bad.ttl');

    expect(result.ok).toBe(false);
    expect(result.parseError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe('TtlFileIO round trip', () => {
  it('export → load reproduces the same quads in a fresh store', async () => {
    const source = makeIO(mockPlatform());
    source.store.addQuads(sampleQuads());
    const { ttl, quadCount } = source.io.exportTtl();

    const target = makeIO(mockPlatform({ content: ttl, name: 'round-trip.ttl' }));
    const result = await target.io.loadTtl();

    expect(result.ok).toBe(true);
    expect(result.quadCount).toBe(quadCount);
    expect(target.store.getQuads()).toHaveLength(quadCount);

    // Re-exporting the reloaded model yields identical Turtle.
    expect(target.io.exportTtl().ttl).toBe(ttl);
  });

  it('save → load round trips through the platform', async () => {
    const savePlatform = mockPlatform();
    const source = makeIO(savePlatform);
    source.store.addQuads(sampleQuads());

    const saveResult = await source.io.saveTtl('round.ttl');
    expect(saveResult.ok).toBe(true);

    const [written, name] = savePlatform.writeFile.mock.calls[0];
    expect(name).toBe('round.ttl');
    const target = makeIO(mockPlatform({ content: written, name: name! }));
    const loadResult = await target.io.loadTtlFromPath('/tmp/round.ttl');

    expect(loadResult.ok).toBe(true);
    expect(loadResult.quadCount).toBe(saveResult.quadCount);
    expect(loadResult.fileName).toBe('round.ttl');
  });
});
