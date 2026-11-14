/**
 * What is proposed first when two elements are connected (bundled ArchiMate 4.0 and 3.2).
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
const AM3 = 'https://meta.linked.archi/archimate3/onto#';

let store: OxigraphRdfStore;
let manager: OxigraphRelationshipManager;
let store3: OxigraphRdfStore;
let manager3: OxigraphRelationshipManager;

beforeAll(async () => {
  store = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), store).loadBundledMetamodel('archimate4');
  manager = new OxigraphRelationshipManager(store);
  store3 = new OxigraphRdfStore();
  await new N3MetamodelLoader(new N3TtlParser(), store3).loadBundledMetamodel('archimate3');
  manager3 = new OxigraphRelationshipManager(store3);
}, 120_000);
afterAll(() => {
  store.dispose();
  store3.dispose();
});

/** The candidates for a pair, by label, in rank order. */
const ranked = (source: string, target: string) => manager.getValidRelationships(AM4 + source, AM4 + target);
const labels = (source: string, target: string) => ranked(source, target).map((r) => r.label);
const first = (source: string, target: string) => ranked(source, target)[0];
const ranked3 = (source: string, target: string) => manager3.getValidRelationships(AM3 + source, AM3 + target);
const labels3 = (source: string, target: string) => ranked3(source, target).map((r) => r.label);
const first3 = (source: string, target: string) => ranked3(source, target)[0];

describe('reading what the metamodel draws and the order of proposal', () => {
  it('reads the relationships the figures draw from the relationship tables', () => {
    const drawn = readDrawnPermissions(store);
    expect(drawn.holds(AM4 + 'assignedTo', [AM4 + 'ApplicationComponent'], [AM4 + 'DataObject'])).toBe(true);
    expect(drawn.holds(AM4 + 'accesses', [AM4 + 'ApplicationComponent'], [AM4 + 'DataObject'])).toBe(false);
  });

  it('reads the general order and the eight scoped ones from the taxonomy', () => {
    expect(readProposalOrders(store).size).toBe(9);
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

  it('between two processes, the strongest first: aggregation, then triggering and flow', () => {
    expect(labels('Process', 'Process').slice(0, 3)).toEqual(['Aggregation', 'Triggering', 'Flow']);
  });

  it('between two application components, which the figures draw nothing between, the strongest first', () => {
    expect(labels('ApplicationComponent', 'ApplicationComponent').slice(0, 3)).toEqual(['Composition', 'Aggregation', 'Specialization']);
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

  it('assignment from a node to an artifact — the artifact deployed on it — before access', () => {
    const top = first('Node', 'Artifact');
    expect(top.label).toBe('Assignment');
    expect(top.preference).toBe('first');
    expect(labels('Node', 'Artifact')).toContain('Access');
  });

  it('composition from a facility to a device, as to a node', () => {
    expect(first('Facility', 'Device').label).toBe('Composition');
  });

  it('triggering between two events, which the tables permit only by derivation', () => {
    const top = first('Event', 'Event');
    expect(top.label).toBe('Triggering');
    expect(top.preference).toBe('first');
    expect(top.direct).toBe(false);
  });

  it('aggregation from a grouping or a plateau, whatever the target', () => {
    expect(first('Grouping', 'Requirement').label).toBe('Aggregation');
    expect(first('Plateau', 'ApplicationComponent').label).toBe('Aggregation');
  });

  it('applies only where it names the elements: from a capability to a resource, no composition first', () => {
    expect(first('Capability', 'Resource')?.label).not.toBe('Composition');
  });
});

describe('ArchiMate 3.2: its own figures, the same order of proposal', () => {
  it('reads the general order and the seven scoped ones from the 3.2 taxonomy', () => {
    expect(readProposalOrders(store3).size).toBe(8);
  });

  it('an application component accesses a data object, as modellers of 3.2 are used to: 3.2 draws no assignment', () => {
    expect(readDrawnPermissions(store3).holds(AM3 + 'assignedTo', [AM3 + 'ApplicationComponent'], [AM3 + 'DataObject'])).toBe(false);
    expect(first3('ApplicationComponent', 'DataObject').label).toBe('Access');
  });

  it('between two business processes, the strongest first: composition, aggregation, then triggering', () => {
    expect(labels3('BusinessProcess', 'BusinessProcess').slice(0, 3)).toEqual(['Composition', 'Aggregation', 'Triggering']);
  });

  it('a business actor is assigned to a business role, as figure 53 draws it', () => {
    const top = first3('BusinessActor', 'BusinessRole');
    expect(top.label).toBe('Assignment');
    expect(top.preference).toBe('drawn');
  });

  it('the generic figures hold within a layer: a business process accessing a data object is only derived', () => {
    const top = first3('BusinessProcess', 'DataObject');
    expect(top.label).toBe('Access');
    expect(top.preference).toBe('derived');
  });

  it('a work package realizes a requirement — drawn in figure 113, though the tables permit it only by derivation', () => {
    const top = first3('WorkPackage', 'Requirement');
    expect(top.label).toBe('Realization');
    expect(top.preference).toBe('drawn');
    expect(top.direct).toBe(false);
  });

  it('the scoped orders: composition between capabilities and from a facility to a node, assignment from a node to an artifact, triggering from a work package to an implementation event, aggregation from a grouping', () => {
    expect(first3('Capability', 'Capability').label).toBe('Composition');
    expect(first3('Facility', 'Node').label).toBe('Composition');
    expect(first3('Node', 'Artifact').label).toBe('Assignment');
    expect(first3('WorkPackage', 'ImplementationEvent').label).toBe('Triggering');
    expect(first3('Grouping', 'Requirement').label).toBe('Aggregation');
    expect(first3('Node', 'Artifact').preference).toBe('first');
  });

  it('composition from a device to system software, and from a facility to a device — a node in 3.2', () => {
    expect(labels3('Device', 'SystemSoftware')[0]).toBe('Composition');
    expect(first3('Facility', 'Device').label).toBe('Composition');
  });

  it('between events, triggering in a layer and realization upwards across layers, as the figures draw them', () => {
    expect(first3('BusinessEvent', 'BusinessEvent').label).toBe('Triggering');
    expect(first3('TechnologyEvent', 'TechnologyEvent').label).toBe('Triggering');
    expect(first3('ApplicationEvent', 'BusinessEvent').label).toBe('Realization');
    expect(first3('TechnologyEvent', 'ApplicationEvent').label).toBe('Realization');
    expect(first3('TechnologyEvent', 'BusinessEvent').label).toBe('Realization');
    expect(first3('BusinessEvent', 'ApplicationEvent').label).not.toBe('Triggering');
  });
});
