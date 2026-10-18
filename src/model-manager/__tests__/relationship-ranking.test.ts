/**
 * What is proposed first when two elements are connected (bundled ArchiMate 4.0).
 *
 * The groups, best first: a proposal order scoped to the elements puts a relationship first; then what
 * the specification's metamodel figures draw for the pair, in the language's general proposal order;
 * then what the tables permit directly, then only by derivation, then the fallbacks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { readDrawnPermissions } from '../direct-permissions.js';
import { readProposalOrders } from '../proposal-order.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';

let store: OxigraphRdfStore;
let manager: OxigraphRelationshipManager;

beforeAll(async () => {
  store = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), store).loadBundledMetamodel('archimate4');
  manager = new OxigraphRelationshipManager(store);
}, 120_000);
afterAll(() => store.dispose());

/** The candidates for a pair, by label, in rank order. */
const ranked = (source: string, target: string) => manager.getValidRelationships(AM4 + source, AM4 + target);
const labels = (source: string, target: string) => ranked(source, target).map((r) => r.label);
const first = (source: string, target: string) => ranked(source, target)[0];

describe('reading what the metamodel draws and the order of proposal', () => {
  it('reads the relationships the figures draw from the relationship tables', () => {
    const drawn = readDrawnPermissions(store);
    expect(drawn.holds(AM4 + 'assignedTo', [AM4 + 'ApplicationComponent'], [AM4 + 'DataObject'])).toBe(true);
    expect(drawn.holds(AM4 + 'accesses', [AM4 + 'ApplicationComponent'], [AM4 + 'DataObject'])).toBe(false);
  });

  it('reads the general order and the five scoped ones from the taxonomy', () => {
    expect(readProposalOrders(store).size).toBe(6);
  });
});

describe('what the metamodel draws comes first, in the order of proposal', () => {
  it('an application component is assigned to a data object, as 4.0 draws it; access, derived, second', () => {
    const top = first('ApplicationComponent', 'DataObject');
    expect(top.label).toBe('Assignment');
    expect(top.preference).toBe('drawn');
    expect(labels('ApplicationComponent', 'DataObject')[1]).toBe('Access');
  });

  it('an actor is assigned to a role', () => {
    expect(first('BusinessActor', 'Role').label).toBe('Assignment');
  });

  it('a process triggers another, then flows to it, then aggregates it', () => {
    expect(labels('Process', 'Process').slice(0, 3)).toEqual(['Triggering', 'Flow', 'Aggregation']);
  });

  it('a process realizes a service before it triggers it', () => {
    expect(first('Process', 'Service').label).toBe('Realization');
  });

  it('a collaboration aggregates a role before it is assigned to one', () => {
    expect(labels('Collaboration', 'Role').slice(0, 2)).toEqual(['Aggregation', 'Assignment']);
  });

  it('a work package realizes a deliverable before it accesses it', () => {
    expect(labels('WorkPackage', 'Deliverable').slice(0, 2)).toEqual(['Realization', 'Access']);
  });

  it('an interface serves an actor — drawn, though the tables permit it only by derivation', () => {
    const top = first('BusinessInterface', 'BusinessActor');
    expect(top.label).toBe('Serving');
    expect(top.preference).toBe('drawn');
    expect(top.direct).toBe(false);
  });
});

describe('an order scoped to the elements puts its relationship first', () => {
  it('composition between two capabilities, which the figures do not draw', () => {
    const top = first('Capability', 'Capability');
    expect(top.label).toBe('Composition');
    expect(top.preference).toBe('first');
  });

  it('triggering from a work package to an event', () => {
    expect(first('WorkPackage', 'Event').label).toBe('Triggering');
  });

  it('composition from a facility to a node', () => {
    expect(first('Facility', 'Node').label).toBe('Composition');
  });

  it('aggregation from a grouping or a plateau, whatever the target', () => {
    expect(first('Grouping', 'Requirement').label).toBe('Aggregation');
    expect(first('Plateau', 'ApplicationComponent').label).toBe('Aggregation');
  });

  it('applies only where it names the elements: from a capability to a resource, no composition first', () => {
    expect(first('Capability', 'Resource')?.label).not.toBe('Composition');
  });
});
