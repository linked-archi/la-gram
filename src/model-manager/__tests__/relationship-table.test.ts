import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { EMPTY_RELATIONSHIP_TABLE, readRelationshipTable, type RelationshipTable } from '../relationship-table.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const ARCH = 'https://meta.linked.archi/core#';

/** The bundled ArchiMate 4.0 — its relationship shapes are the relationship matrix. */
let store: OxigraphRdfStore;
let table: RelationshipTable;
let manager: OxigraphRelationshipManager;

beforeAll(async () => {
  store = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), store).loadBundledMetamodel('archimate4');
  table = readRelationshipTable(store);
  manager = new OxigraphRelationshipManager(store);
}, 60_000);
afterAll(() => store.dispose());

const labels = (source: string, target: string) =>
  manager.getValidRelationships(AM4 + source, AM4 + target).map((r) => r.label);

describe('readRelationshipTable', () => {
  it('reads every qualified relationship shape of ArchiMate 4.0', () => {
    expect(table.size).toBe(10);
    expect(table.targetsOf(AM4 + 'Access', AM4 + 'ApplicationComponent').map((t) => t.replace(AM4, ''))).toEqual([
      'Artifact',
      'BusinessObject',
      'DataObject',
      'Grouping',
      'Material',
    ]);
  });

  it('admits a pair when a listed source and target are in the types’ closures', () => {
    const access = [AM4 + 'Access'];
    expect(table.allows(access, [AM4 + 'ApplicationComponent'], [AM4 + 'DataObject'])).toBe(true);
    expect(table.allows(access, [AM4 + 'ApplicationComponent'], [AM4 + 'BusinessActor'])).toBe(false);
  });

  it('applies a superclass’s shape to a subclass relationship (Composition ⊂ Aggregation), all of them', () => {
    const composition = [AM4 + 'Composition', AM4 + 'Aggregation'];
    expect(table.covers([AM4 + 'Composition'])).toBe(false);
    expect(table.covers(composition)).toBe(true);
    expect(table.allows(composition, [AM4 + 'ApplicationComponent'], [AM4 + 'ApplicationComponent'])).toBe(true);
    expect(table.allows(composition, [AM4 + 'BusinessActor'], [AM4 + 'ApplicationComponent'])).toBe(false);
  });

  it('answers the prefilters’ questions: may a relationship start here, end there', () => {
    const access = [AM4 + 'Access'];
    expect(table.allowsSource(access, [AM4 + 'ApplicationComponent'])).toBe(true);
    expect(table.allowsSource(access, [AM4 + 'DataObject'])).toBe(false);
    expect(table.allowsTarget(access, [AM4 + 'DataObject'])).toBe(true);
    expect(table.allowsTarget(access, [AM4 + 'BusinessActor'])).toBe(false);
  });

  it('leaves unconstrained relationship classes alone', () => {
    expect(table.covers([ARCH + 'SomethingElse'])).toBe(false);
    expect(table.allows([ARCH + 'SomethingElse'], [], [])).toBe(true);
    expect(EMPTY_RELATIONSHIP_TABLE.allows([AM4 + 'Access'], [], [])).toBe(true);
  });
});

describe('getValidRelationships against the relationship shapes', () => {
  it('offers only what the shapes permit — not everything the domain/range hints would', () => {
    // The hints alone admit Composition and Access here too; the matrix does not. Serving leads the
    // three the matrix permits by derivation: its hints describe an actor serving a component; then the
    // general order, triggering before flow.
    expect(labels('BusinessActor', 'ApplicationComponent')).toEqual([
      'Serving',
      'Triggering',
      'Flow',
      'Association',
      'Directed Association',
    ]);
    expect(labels('ApplicationComponent', 'DataObject')).toContain('Access');
    expect(labels('BusinessActor', 'ApplicationComponent')).not.toContain('Access');
  });

  it('allows the kinds of access exactly where Access is allowed (they are its subclasses)', () => {
    const kinds = ['Access', 'Read Access', 'Write Access', 'Read-Write Access'];
    expect(labels('ApplicationComponent', 'DataObject')).toEqual(expect.arrayContaining(kinds));
    for (const kind of kinds) expect(labels('BusinessActor', 'ApplicationComponent')).not.toContain(kind);
  });

  it('reads the specification\'s tables the right way round: columns are the source, rows the target', () => {
    // Active structure is assigned to behaviour and realizes services — not the reverse.
    expect(labels('ApplicationComponent', 'Function')).toContain('Assignment');
    expect(labels('Function', 'ApplicationComponent')).not.toContain('Assignment');
    expect(labels('BusinessActor', 'Role')).toContain('Assignment');
    for (const active of ['ApplicationComponent', 'Node', 'SystemSoftware', 'BusinessActor', 'Role']) {
      expect(labels(active, 'Service')).toEqual(expect.arrayContaining(['Realization', 'Assignment']));
      expect(labels('Service', active)).not.toContain('Realization');
    }
    expect(labels('Process', 'Service')).toContain('Realization');
    expect(labels('Process', 'Node')).not.toContain('Realization');
    expect(labels('Process', 'Node')).not.toContain('Assignment');
    // Technology realizes application: system software and artifacts realize components.
    expect(labels('SystemSoftware', 'ApplicationComponent')).toContain('Realization');
    expect(labels('ApplicationComponent', 'SystemSoftware')).not.toContain('Realization');
    expect(labels('Artifact', 'ApplicationComponent')).toContain('Realization');
    // Components realize capabilities; nothing serves one.
    expect(labels('ApplicationComponent', 'Capability')).toContain('Realization');
    expect(labels('ApplicationComponent', 'Capability')).not.toContain('Serving');
  });

  it('allows Composition exactly where Aggregation is allowed', () => {
    expect(labels('ApplicationComponent', 'ApplicationComponent')).toEqual(
      expect.arrayContaining(['Aggregation', 'Composition']),
    );
    expect(labels('BusinessActor', 'ApplicationComponent')).not.toContain('Composition');
  });

  it('says why a relationship is allowed', () => {
    const [flow] = manager.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'ApplicationComponent');
    expect(flow.reason).toMatch(/relationship shapes/);
  });
});
