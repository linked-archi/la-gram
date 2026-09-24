import { describe, it, expect } from 'vitest';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import {
  ASSET_ROOT,
  BUNDLED_ASSETS,
  BUNDLED_ICON_PREFIXES,
  PUBLISHED_BASE_URI,
  fetchAllAssetTexts,
  fetchAssetText,
  getAssetByIri,
  getAssetsByRole,
  resolveIconUri,
  resolveIconUriOrPassThrough,
  type BundledAssetRole,
} from '../bundled-assets.js';

describe('bundled asset registry', () => {
  it('describes every bundled TTL with a role, graph IRI and path', () => {
    expect(BUNDLED_ASSETS).toHaveLength(9);
    for (const asset of BUNDLED_ASSETS) {
      expect(asset.ontologyIri.startsWith(PUBLISHED_BASE_URI)).toBe(true);
      expect(asset.path.endsWith('.ttl')).toBe(true);
      expect(asset.path.startsWith('/')).toBe(false);
    }
  });

  it('covers all nine logical roles exactly once', () => {
    const roles: BundledAssetRole[] = [
      'manifest',
      'ontology',
      'taxonomy',
      'notation',
      'shapes',
      'presentationContexts',
      'viewpoints',
      'coreOntology',
      'coreVisOntology',
    ];
    for (const role of roles) {
      expect(getAssetsByRole(role)).toHaveLength(1);
    }
  });

  it('orders the core ontologies before the files that import them', () => {
    const coreIndex = BUNDLED_ASSETS.findIndex((a) => a.role === 'coreOntology');
    const coreVisIndex = BUNDLED_ASSETS.findIndex((a) => a.role === 'coreVisOntology');
    const notationIndex = BUNDLED_ASSETS.findIndex((a) => a.role === 'notation');

    expect(coreIndex).toBeLessThan(notationIndex);
    expect(coreVisIndex).toBeLessThan(notationIndex);
  });

  it('looks assets up by graph IRI', () => {
    const onto = getAssetByIri('https://meta.linked.archi/archimate4/onto#');
    expect(onto?.role).toBe('ontology');
    expect(onto?.path).toBe('archimate4/archimate4-onto.ttl');

    expect(getAssetByIri('https://example.org/not-bundled#')).toBeUndefined();
  });
});

describe('icon URI resolution', () => {
  it('rewrites the published base to an asset-root-relative path', () => {
    expect(resolveIconUri('https://meta.linked.archi/archimate4/icons/business-actor.svg')).toBe(
      'archimate4/icons/business-actor.svg',
    );
  });

  it('preserves the glyphs subdirectory', () => {
    expect(resolveIconUri('https://meta.linked.archi/archimate4/icons/glyphs/role.svg')).toBe(
      'archimate4/icons/glyphs/role.svg',
    );
  });

  it('reports icon sets that are not bundled as unresolvable', () => {
    // Published, but core-vis markers are not part of this bundle.
    expect(resolveIconUri('https://meta.linked.archi/core-vis/markers/arrow.svg')).toBeNull();
    expect(resolveIconUri('https://meta.linked.archi/c4/icons/person.svg')).toBeNull();
  });

  it('returns null for URIs outside the published base', () => {
    expect(resolveIconUri('https://example.org/icons/thing.svg')).toBeNull();
    expect(resolveIconUri('archimate4/icons/role.svg')).toBeNull();
  });

  it('passes unresolvable URIs through unchanged in the lenient helper', () => {
    expect(resolveIconUriOrPassThrough('https://example.org/icons/thing.svg')).toBe(
      'https://example.org/icons/thing.svg',
    );
    expect(
      resolveIconUriOrPassThrough('https://meta.linked.archi/archimate4/icons/node.svg'),
    ).toBe('archimate4/icons/node.svg');
  });

  it('resolves every bundled icon prefix', () => {
    for (const prefix of BUNDLED_ICON_PREFIXES) {
      expect(resolveIconUri(`${PUBLISHED_BASE_URI}${prefix}example.svg`)).toBe(
        `${prefix}example.svg`,
      );
    }
  });
});

describe('Node-side asset loading', () => {
  it('reads a bundled TTL off disk and parses it with N3TtlParser', async () => {
    const onto = getAssetsByRole('ontology')[0];
    const ttl = await fetchAssetText(onto);

    expect(ttl.length).toBeGreaterThan(0);
    expect(ttl).toContain('<https://meta.linked.archi/archimate4/onto#>');

    const parser = new N3TtlParser();
    const result = parser.parse(ttl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Non-zero quad count: the asset really loaded, it is not an empty stub.
    expect(result.quads.length).toBeGreaterThan(0);
    // Floor well below the 927 quads the current file yields, so a truncated or
    // placeholder copy is caught while an upstream asset refresh is not.
    expect(result.quads.length).toBeGreaterThan(500);
    expect(parser.prefixes.arch).toBe('https://meta.linked.archi/core#');
  });

  it('accepts an asset-root-relative path as well as a registry entry', async () => {
    const ttl = await fetchAssetText('core/core-vis-onto.ttl');
    expect(ttl).toContain('<https://meta.linked.archi/core-vis#>');
  });

  it('parses every bundled asset without error', async () => {
    const loaded = await fetchAllAssetTexts();
    expect(loaded).toHaveLength(BUNDLED_ASSETS.length);

    for (const { asset, ttl } of loaded) {
      const result = new N3TtlParser().parse(ttl);
      expect(result.ok, `${asset.path} failed to parse`).toBe(true);
      if (result.ok) {
        expect(result.quads.length, `${asset.path} produced no quads`).toBeGreaterThan(0);
      }
    }
  });

  it('reports a missing asset rather than returning empty text', async () => {
    await expect(fetchAssetText('archimate4/does-not-exist.ttl')).rejects.toThrow();
  });

  it('exposes the asset root the webpack copy target uses', () => {
    expect(ASSET_ROOT).toBe('assets');
  });
});
