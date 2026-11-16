/**
 * What is proposed first when two elements are connected (bundled ArchiMate 4.0 and 3.2): core's rule for the
 * orders a metamodel names with `arch:relationshipProposalOrder`. Three groups — what may be drawn directly, what
 * only a derivation gives, association — and within each, the place the most specific order that lists a
 * relationship gives it. What the metamodel figures draw is said (`drawn`), not ranked by.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataFactory } from 'n3';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphRelationshipManager } from '../relationship-manager.js';
import { readDrawnPermissions } from '../direct-permissions.js';
import { readProposalOrders, RELATIONSHIP_PROPOSAL_ORDER } from '../proposal-order.js';
import { SparqlPaletteGenerator } from '../../metamodel-manager/palette-generator.js';
import { appendableTargetTypes, buildClassClosure } from '../../ui/canvas/relationship-resolution.js';

const { namedNode, quad, defaultGraph } = DataFactory;

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM3 = 'https://meta.linked.archi/archimate3/onto#';
const AM4MM = 'https://meta.linked.archi/archimate4/metamodel#ArchiMate4';
const ARCH = 'https://meta.linked.archi/core#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

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

describe('reading the orders the manifest names', () => {
  it('reads the general order and the eight scoped ones each manifest names', () => {
    expect(readProposalOrders(store).size).toBe(9);
    expect(readProposalOrders(store3).size).toBe(9);
  });

  it('reads what the figures draw from the relationship tables', () => {
    const drawn = readDrawnPermissions(store);
    expect(drawn.holds(AM4 + 'assignedTo', [AM4 + 'ApplicationComponent'], [AM4 + 'DataObject'])).toBe(true);
    expect(drawn.holds(AM4 + 'accesses', [AM4 + 'ApplicationComponent'], [AM4 + 'DataObject'])).toBe(false);
  });

  it('ignores an order a model file names: the pointer counts only in a metamodel\'s own document', () => {
    const s = new OxigraphRdfStore();
    try {
      const order = namedNode('https://model.example.com/m#AssociationFirst');
      const list = namedNode('https://model.example.com/m#list');
      // The model (default graph) points ArchiMate 4.0 at an order putting association first between processes.
      s.addQuads([
        quad(namedNode(AM4MM), namedNode(RELATIONSHIP_PROPOSAL_ORDER), order, defaultGraph()),
        quad(order, namedNode(SKOS + 'memberList'), list, defaultGraph()),
        quad(list, namedNode(RDF + 'first'), namedNode(AM4 + 'Association'), defaultGraph()),
        quad(list, namedNode(RDF + 'rest'), namedNode(RDF + 'nil'), defaultGraph()),
        quad(order, namedNode(ARCH + 'domainIncludes'), namedNode(AM4 + 'Process'), defaultGraph()),
      ]);
      expect(readProposalOrders(s).size).toBe(0);
    } finally {
      s.dispose();
    }
  });

  it('a collection typed arch:RelationshipProposalOrder, a class core no longer has, and named by no manifest, orders nothing', () => {
    const g = namedNode('https://example.com/extension/tax');
    const order = namedNode('https://example.com/extension/tax#AssociationFirst');
    const list = namedNode('https://example.com/extension/tax#list');
    const added = [
      quad(order, namedNode(RDF + 'type'), namedNode(ARCH + 'RelationshipProposalOrder'), g),
      quad(order, namedNode(SKOS + 'memberList'), list, g),
      quad(list, namedNode(RDF + 'first'), namedNode(AM4 + 'Association'), g),
      quad(list, namedNode(RDF + 'rest'), namedNode(RDF + 'nil'), g),
      quad(order, namedNode(ARCH + 'domainIncludes'), namedNode(AM4 + 'Process'), g),
    ];
    store.addQuads(added);
    try {
      expect(readProposalOrders(store).size).toBe(9);
      expect(new OxigraphRelationshipManager(store).getValidRelationships(AM4 + 'Process', AM4 + 'Process')[0].label).toBe('Triggering');
    } finally {
      store.removeQuads(added);
    }
  });
});

describe('the most specific order that lists a relationship gives its place', () => {
  it('a subclass\'s order is more specific than its superclass\'s, both ends named before one', () => {
    const s = new OxigraphRdfStore();
    try {
      const g = namedNode('https://example.com/language/metamodel');
      const ex = (local: string) => namedNode('https://example.com/language#' + local);
      const add = (subject: string, predicate: string, object: ReturnType<typeof namedNode>) =>
        quad(ex(subject), namedNode(predicate), object, g);
      const list = (name: string, members: string[]) =>
        members.flatMap((m, i) => [
          quad(ex(`${name}-${i}`), namedNode(RDF + 'first'), ex(m), g),
          quad(ex(`${name}-${i}`), namedNode(RDF + 'rest'), i + 1 < members.length ? ex(`${name}-${i + 1}`) : namedNode(RDF + 'nil'), g),
        ]);
      s.addQuads([
        // Kind ⊃ Sub; General lists everything, KindOrder applies between kinds, SubOrder from a Sub.
        add('Sub', RDFS + 'subClassOf', ex('Kind')),
        add('Mid', RDFS + 'subClassOf', ex('Kind')),
        add('Sub', RDFS + 'subClassOf', ex('Mid')),
        add('Language', RELATIONSHIP_PROPOSAL_ORDER, ex('General')),
        add('Language', RELATIONSHIP_PROPOSAL_ORDER, ex('KindOrder')),
        add('Language', RELATIONSHIP_PROPOSAL_ORDER, ex('MidOrder')),
        add('Language', RELATIONSHIP_PROPOSAL_ORDER, ex('SubOrder')),
        add('General', SKOS + 'memberList', ex('General-0')),
        ...list('General', ['A', 'B', 'C', 'D']),
        add('KindOrder', SKOS + 'memberList', ex('KindOrder-0')),
        add('KindOrder', ARCH + 'domainIncludes', ex('Kind')),
        add('KindOrder', ARCH + 'rangeIncludes', ex('Kind')),
        ...list('KindOrder', ['C', 'B']),
        add('MidOrder', SKOS + 'memberList', ex('MidOrder-0')),
        add('MidOrder', ARCH + 'domainIncludes', ex('Mid')),
        add('MidOrder', ARCH + 'rangeIncludes', ex('Mid')),
        ...list('MidOrder', ['B']),
        add('SubOrder', SKOS + 'memberList', ex('SubOrder-0')),
        add('SubOrder', ARCH + 'domainIncludes', ex('Sub')),
        ...list('SubOrder', ['D']),
      ]);
      const orders = readProposalOrders(s);
      const closure = (local: string) =>
        ({ Sub: ['Sub', 'Mid', 'Kind'], Mid: ['Mid', 'Kind'], Kind: ['Kind'] })[local]!.map((c) => 'https://example.com/language#' + c);
      const rank = (source: string, target: string) =>
        ['A', 'B', 'C', 'D']
          .map((r) => ({ r, p: orders.proposal('https://example.com/language#' + r, ['https://example.com/language#' + r], closure(source), closure(target)) }))
          .sort((x, y) => y.p.ends - x.p.ends || y.p.depth - x.p.depth || x.p.position - y.p.position)
          .map((x) => x.r);
      expect(rank('Kind', 'Kind')).toEqual(['C', 'B', 'A', 'D']);
      // Mid ⊂ Kind: MidOrder (B) before KindOrder (C), both naming both ends; SubOrder names one end only.
      expect(rank('Sub', 'Mid')).toEqual(['B', 'C', 'D', 'A']);
    } finally {
      s.dispose();
    }
  });
});

describe('by the kinds of the two elements', () => {
  it('between two behaviour elements, triggering and flow first, then composition and aggregation — in both versions', () => {
    expect(labels('Process', 'Process').slice(0, 4)).toEqual(['Triggering', 'Flow', 'Composition', 'Aggregation']);
    expect(labels('Function', 'Process').slice(0, 4)).toEqual(['Triggering', 'Flow', 'Composition', 'Aggregation']);
    expect(labels3('BusinessProcess', 'BusinessProcess').slice(0, 4)).toEqual(['Triggering', 'Flow', 'Composition', 'Aggregation']);
    expect(labels3('BusinessEvent', 'BusinessEvent').slice(0, 2)).toEqual(['Triggering', 'Flow']);
  });

  it('a process realizes a service; a service serves a process', () => {
    expect(first('Process', 'Service').label).toBe('Realization');
    expect(first('Service', 'Process').label).toBe('Serving');
  });

  it('between strategy behaviour elements, realization and then serving; composition between two capabilities', () => {
    expect(first('Capability', 'CourseOfAction').label).toBe('Realization');
    expect(first('Capability', 'ValueStream').label).toBe('Serving');
    expect(first('Capability', 'Capability').label).toBe('Composition');
    expect(first3('Capability', 'CourseOfAction').label).toBe('Realization');
    expect(first3('Capability', 'Capability').label).toBe('Composition');
  });

  it('a collaboration aggregates the elements that work together in it', () => {
    expect(first('Collaboration', 'Role').label).toBe('Aggregation');
    expect(first3('ApplicationCollaboration', 'ApplicationComponent').label).toBe('Aggregation');
  });

  it('between motivation elements, realization and then influence: an outcome realizes a goal, a requirement influences one', () => {
    expect(labels('Outcome', 'Goal').slice(0, 2)).toEqual(['Realization', 'Influence']);
    expect(first('Requirement', 'Goal').label).toBe('Influence');
  });

  it('to a meaning or a value, association — but between two motivation elements their own order', () => {
    expect(first('Process', 'Value').label).toBe('Association');
    expect(first('Stakeholder', 'Value').label).toBe('Influence');
  });

  it('from a grouping, a location, a product or a plateau, aggregation — in both versions', () => {
    expect(first('Grouping', 'Requirement').label).toBe('Aggregation');
    expect(first('Location', 'Node').label).toBe('Aggregation');
    expect(first('Product', 'Service').label).toBe('Aggregation');
    expect(first('Plateau', 'ApplicationComponent').label).toBe('Aggregation');
    expect(first3('Product', 'BusinessService').label).toBe('Aggregation');
  });
});

describe('elsewhere the general order, the strongest first', () => {
  it('between two application components, composition and aggregation, in both versions', () => {
    expect(labels('ApplicationComponent', 'ApplicationComponent').slice(0, 2)).toEqual(['Composition', 'Aggregation']);
    expect(labels3('ApplicationComponent', 'ApplicationComponent').slice(0, 2)).toEqual(['Composition', 'Aggregation']);
  });

  it('between two roles composition; an actor is assigned to a role', () => {
    expect(first('Role', 'Role').label).toBe('Composition');
    expect(first('BusinessActor', 'Role').label).toBe('Assignment');
    expect(first3('BusinessActor', 'BusinessRole').label).toBe('Assignment');
  });

  it('a facility is composed of a node; an artifact is assigned to a node, a device, equipment', () => {
    expect(first('Facility', 'Node').label).toBe('Composition');
    expect(first3('Facility', 'Equipment').label).toBe('Composition');
    expect(first('Node', 'Artifact').label).toBe('Assignment');
    expect(first3('Device', 'Artifact').label).toBe('Assignment');
    expect(first3('Equipment', 'Artifact').label).toBe('Assignment');
  });

  it('an application component is assigned to a data object in 4.0, and accesses it in 3.2, which permits no assignment', () => {
    expect(labels('ApplicationComponent', 'DataObject').slice(0, 2)).toEqual(['Assignment', 'Access']);
    expect(first3('ApplicationComponent', 'DataObject').label).toBe('Access');
  });

  it('a work package realizes a deliverable before it accesses it', () => {
    expect(labels('WorkPackage', 'Deliverable').slice(0, 2)).toEqual(['Realization', 'Access']);
  });
});

describe('the three groups: direct, derived, association', () => {
  it('what may be drawn directly before what only a derivation gives, whatever the order: across 3.2\'s layers, realization', () => {
    const top = first3('ApplicationProcess', 'BusinessProcess');
    expect(top.label).toBe('Realization');
    expect(top.direct).toBe(true);
    expect(labels3('ApplicationProcess', 'BusinessProcess').slice(1, 3)).toEqual(['Triggering', 'Flow']);
    expect(first3('TechnologyEvent', 'ApplicationEvent').label).toBe('Realization');
  });

  it('between two 4.0 events triggering is only derived, so what may be drawn directly comes first', () => {
    const events = ranked('Event', 'Event');
    expect(events[0].label).toBe('Composition');
    expect(events.find((r) => r.label === 'Triggering')?.direct).toBe(false);
  });

  it('where everything is derived, the order decides among them: a component to a process in 4.0, assignment', () => {
    const top = first('ApplicationComponent', 'Process');
    expect(top.label).toBe('Assignment');
    expect(top.direct).toBe(false);
  });

  it('association last, after what is derived', () => {
    expect(labels('Path', 'Node').slice(-2)).toEqual(['Association', 'Directed Association']);
    expect(first('Path', 'Node').fallback).toBeUndefined();
  });
});

describe('the figures are said, not ranked by', () => {
  it('a collaboration is composed of a role before it is assigned to one, though only the assignment is drawn', () => {
    const candidates = ranked('Collaboration', 'Role');
    expect(candidates.map((r) => r.label).slice(0, 3)).toEqual(['Aggregation', 'Composition', 'Assignment']);
    expect(candidates.find((r) => r.label === 'Assignment')?.drawn).toBe(true);
    expect(candidates.find((r) => r.label === 'Composition')?.drawn).toBeUndefined();
  });

  it('an interface serving an actor is drawn, though the tables permit it only by derivation', () => {
    const top = first('BusinessInterface', 'BusinessActor');
    expect(top.label).toBe('Serving');
    expect(top.drawn).toBe(true);
    expect(top.direct).toBe(false);
  });

  it('3.2 draws no assignment from an application component to a data object', () => {
    expect(readDrawnPermissions(store3).holds(AM3 + 'assignedTo', [AM3 + 'ApplicationComponent'], [AM3 + 'DataObject'])).toBe(false);
  });
});

describe('ArchiMate 3.2: devices, system software, equipment and facilities are no nodes (§E.3)', () => {
  it('a device has its own row of the tables, not a node\'s', () => {
    // A node may be composed of a node; a device of devices and system software only.
    expect(labels3('Node', 'Node')).toContain('Composition');
    expect(labels3('Device', 'Node')).not.toContain('Composition');
    expect(labels3('Equipment', 'Node')).not.toContain('Composition');
    expect(labels3('Device', 'SystemSoftware')[0]).toBe('Composition');
  });
});

describe('what the "+" menu offers first after an element: its own type, its own section, the most like it', () => {
  const offered = (s: OxigraphRdfStore, m: OxigraphRelationshipManager, metamodel: string, source: string) => {
    const iri = s.getQuads(null, namedNode(RDF + 'type'), namedNode(ARCH + 'Metamodel'))[0]?.subject.value ?? metamodel;
    const palette = new SparqlPaletteGenerator(s).generatePalette(iri);
    return appendableTargetTypes(palette, buildClassClosure(s), (a, b) => m.getValidRelationships(a, b), source);
  };

  it('after a 4.0 process: a process, the Common Domain\'s behaviour, then business, application, technology', () => {
    const targets = offered(store, manager, AM4MM, AM4 + 'Process');
    expect(targets.slice(0, 4).map((t) => t.type.label)).toEqual(['Process', 'Function', 'Service', 'Event']);
    const sections = [...new Set(targets.map((t) => t.category))];
    expect(sections.slice(0, 4)).toEqual(['Common Domain', 'Business Domain', 'Application Domain', 'Technology Domain']);
  });

  it('after a 3.2 business process: a business process, then the business behaviour before the business actor', () => {
    const targets = offered(store3, manager3, '', AM3 + 'BusinessProcess');
    expect(targets.slice(0, 6).map((t) => t.type.label)).toEqual([
      'Business Process', 'Business Function', 'Business Interaction', 'Business Event', 'Business Service', 'Business Actor',
    ]);
  });
});


describe('the core\'s relationship types, where no loaded language relates two elements (Req 4.21)', () => {
  const AM = 'https://meta.linked.archi/archimate4/onto#';
  const AD = 'https://meta.linked.archi/arch-decision#';
  const ARCH = 'https://meta.linked.archi/core#';
  let both: OxigraphRdfStore;
  let relationships: OxigraphRelationshipManager;

  beforeAll(async () => {
    both = new OxigraphRdfStore();
    const loader = new N3MetamodelLoader(new N3TtlParser(), both);
    await loader.loadBundledMetamodel('archimate4');
    await loader.loadBundledMetamodel('arch-decision');
    relationships = new OxigraphRelationshipManager(both);
  }, 120_000);

  it('are offered between elements of two metamodels — Association first — and say why', () => {
    const offered = relationships.getValidRelationships(`${AM}ApplicationComponent`, `${AD}Decision`);
    expect(offered.map((r) => r.iri)).toEqual([`${ARCH}Association`, `${ARCH}HasPart`, `${ARCH}Refines`]);
    expect(offered.every((r) => r.fallback)).toBe(true);
    expect(offered[0]!.reason).toContain('the loaded metamodels permit no relationship between these two element types');
    expect(offered[0]!.unqualifiedPredicateIri).toBe(`${ARCH}associatedWith`);
  });

  it('are not offered where a language permits something: between two ArchiMate elements, or from an option to a component', () => {
    const core = (source: string, target: string) =>
      relationships.getValidRelationships(source, target).filter((r) => r.iri.startsWith(ARCH));
    expect(core(`${AM}ApplicationComponent`, `${AM}Node`)).toEqual([]);
    expect(core(`${AD}Option`, `${AM}ApplicationComponent`)).toEqual([]);
    expect(relationships.getValidRelationships(`${AD}Option`, `${AM}ApplicationComponent`).map((r) => r.iri)).toContain(`${AD}ModifiesConcept`);
  });

  it('a relationship type no notation describes is drawn with an arrowhead at its target; one with no direction, plain (Req 2.25)', () => {
    const palette = new SparqlPaletteGenerator(both).generatePalette();
    const style = (iri: string) => palette.relationshipTypes.find((r) => r.iri === iri)?.relationshipStyle;
    // A decision link, and the core's directed ones: from source to target.
    expect(style(`${AD}ModifiesConcept`)).toEqual({ lineStyle: 'SolidLine', targetDecor: 'OpenArrowhead' });
    expect(style(`${AD}SupportingInfluence`)).toEqual({ lineStyle: 'SolidLine', targetDecor: 'OpenArrowhead' });
    expect(style(`${ARCH}HasPart`)).toEqual({ lineStyle: 'SolidLine', targetDecor: 'OpenArrowhead' });
    // The core's Association: its predicate is symmetric.
    expect(palette.relationshipTypes.some((r) => r.iri === `${ARCH}Association`)).toBe(true);
    expect(style(`${ARCH}Association`)).toBeUndefined();
    // A type its notation describes keeps that: ArchiMate's Serving.
    expect(style(`${AM}Serving`)?.targetDecor).toBe('OpenArrowhead');
    expect(style(`${AM}Composition`)?.sourceDecor).toBe('FilledDiamond');
  });
});
