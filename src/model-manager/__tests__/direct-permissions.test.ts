import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { NO_DIRECT_PERMISSIONS, readDirectPermissions } from '../direct-permissions.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM = 'https://meta.linked.archi/archimate3/onto#';

/** The bundled ArchiMate 4.0 and 3.2, each with its relationship tables. */
let store4: OxigraphRdfStore;
let store3: OxigraphRdfStore;
let manager4: OxigraphRelationshipManager;
let manager3: OxigraphRelationshipManager;

beforeAll(async () => {
  store4 = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), store4).loadBundledMetamodel('archimate4');
  manager4 = new OxigraphRelationshipManager(store4);
  store3 = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), store3).loadBundledMetamodel('archimate3');
  manager3 = new OxigraphRelationshipManager(store3);
}, 120_000);
afterAll(() => {
  store4.dispose();
  store3.dispose();
});

/** The candidates for a pair, as `label` or `label (derived)`, in rank order. */
const ranked = (manager: OxigraphRelationshipManager, source: string, target: string) =>
  manager
    .getValidRelationships(source, target)
    .map((r) => (r.direct === false ? `${r.label} (derived)` : r.label));

describe('readDirectPermissions', () => {
  it('reads the direct permissions of the bundled relationship tables', () => {
    const permissions = readDirectPermissions(store4);
    expect(permissions.size).toBeGreaterThanOrEqual(10);
    // 4.0: an artifact realizes a data object directly, a business object only by derivation.
    expect(permissions.isDirect(AM4 + 'realizes', [AM4 + 'Artifact'], [AM4 + 'DataObject'])).toBe(true);
    expect(permissions.isDirect(AM4 + 'realizes', [AM4 + 'Artifact'], [AM4 + 'BusinessObject'])).toBe(false);
  });

  it('does not say for an end type the tables never mention, nor for a predicate they do not cover', () => {
    const permissions = readDirectPermissions(store4);
    expect(permissions.isDirect(AM4 + 'assignedTo', [AM4 + 'BusinessActor'], [AM4 + 'AndJunction'])).toBeUndefined();
    expect(permissions.isDirect('https://example.org/relatesTo', [AM4 + 'Artifact'], [AM4 + 'DataObject'])).toBeUndefined();
    expect(NO_DIRECT_PERMISSIONS.isDirect(AM4 + 'realizes', [AM4 + 'Artifact'], [AM4 + 'DataObject'])).toBeUndefined();
  });
});

describe('getValidRelationships: direct, then only by derivation, then the fallbacks', () => {
  it('ranks a derived-only relationship after the direct ones and before the fallbacks, and says why (4.0)', () => {
    expect(ranked(manager4, AM4 + 'Artifact', AM4 + 'BusinessObject')).toEqual([
      'Specialization',
      'Realization (derived)',
      'Association',
      'Directed Association',
    ]);
    const realization = manager4
      .getValidRelationships(AM4 + 'Artifact', AM4 + 'BusinessObject')
      .find((r) => r.label === 'Realization');
    expect(realization?.reason).toContain('Only by derivation');
  });

  it('marks a relationship direct where the tables print it in upper case', () => {
    const realization = manager4
      .getValidRelationships(AM4 + 'Artifact', AM4 + 'DataObject')
      .find((r) => r.label === 'Realization');
    expect(realization?.direct).toBe(true);
  });

  it('follows each version’s tables: 3.2 lets an artifact realize a business object directly', () => {
    const realization = manager3
      .getValidRelationships(AM + 'Artifact', AM + 'BusinessObject')
      .find((r) => r.label === 'Realization');
    expect(realization?.direct).toBe(true);
    const derived = manager3
      .getValidRelationships(AM + 'Node', AM + 'BusinessProcess')
      .filter((r) => r.direct === false)
      .map((r) => r.label);
    expect(derived).toContain('Realization');
  });

  it('leaves a relationship to a junction unmarked: the tables do not list junctions', () => {
    const candidates = manager4.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'AndJunction');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((r) => r.direct === undefined)).toBe(true);
  });

  it('defaults to a derived-only relationship where only a fallback is direct (4.0: a node and a process)', () => {
    const candidates = manager4.getValidRelationships(AM4 + 'Node', AM4 + 'Process');
    expect(candidates[0].direct).toBe(false);
    expect(candidates[0].label).not.toMatch(/Association/);
    expect(candidates.at(-1)?.label).toMatch(/Association/);
  });
});
