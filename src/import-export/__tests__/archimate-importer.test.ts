// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { OxigraphElementManager } from '../../model-manager/element-manager.js';
import { OxigraphRelationshipManager } from '../../model-manager/relationship-manager.js';
import { OxigraphViewManager } from '../../model-manager/view-manager.js';
import { modelQuads } from '../../model-manager/model-queries.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import {
  ARCHIMATE_NS,
  applyExchangeModel,
  exchangeRelationshipTypeIri,
  exchangeTypeIri,
  parseArchiMateExchange,
} from '../archimate-importer.js';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';

const nn = (v: string) => DataFactory.namedNode(v) as unknown as NamedNode;
const AM3 = ARCHIMATE_NS;

/** A small but complete exchange file: properties, nesting, bendpoints, a junction, an unknown type. */
const EXCHANGE = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       identifier="id-model">
  <name xml:lang="en">Shop</name>
  <documentation xml:lang="en">A web shop.</documentation>
  <elements>
    <element identifier="id-web" xsi:type="ApplicationComponent">
      <name xml:lang="en">Web Shop</name>
      <documentation xml:lang="en">Customer-facing web front end.</documentation>
      <properties><property propertyDefinitionRef="pd-owner"><value xml:lang="en">Team A</value></property></properties>
    </element>
    <element identifier="id-api" xsi:type="ApplicationComponent"><name xml:lang="en">Order API</name></element>
    <element identifier="id-cust" xsi:type="BusinessActor"><name xml:lang="en">Customer</name></element>
    <element identifier="id-j" xsi:type="AndJunction"/>
    <element identifier="id-x" xsi:type="SomethingProprietary"><name>X</name></element>
  </elements>
  <relationships>
    <relationship identifier="id-r1" xsi:type="Serving" source="id-api" target="id-web"/>
    <relationship identifier="id-r2" xsi:type="Serving" source="id-web" target="id-cust"><name xml:lang="en">serves</name></relationship>
    <relationship identifier="id-r3" xsi:type="Association" source="id-cust" target="id-r2"/>
  </relationships>
  <propertyDefinitions>
    <propertyDefinition identifier="pd-owner" type="string"><name xml:lang="en">Owner</name></propertyDefinition>
  </propertyDefinitions>
  <views>
    <diagrams>
      <view identifier="id-v1" xsi:type="Diagram" viewpoint="Application Cooperation">
        <name xml:lang="en">Main</name>
        <node identifier="n-group" xsi:type="Container" x="10" y="10" w="400" h="300">
          <node identifier="n-web" elementRef="id-web" xsi:type="Element" x="40" y="40" w="120" h="55"/>
        </node>
        <node identifier="n-api" elementRef="id-api" xsi:type="Element" x="300" y="40" w="120" h="55"/>
        <node identifier="n-api2" elementRef="id-api" xsi:type="Element" x="300" y="200" w="120" h="55"/>
        <connection identifier="c1" relationshipRef="id-r1" xsi:type="Relationship" source="n-api" target="n-web">
          <bendpoint x="230" y="150"/>
        </connection>
      </view>
    </diagrams>
  </views>
</model>`;

/** Every kind of access, and both kinds of association. */
const KINDS = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       identifier="id-model">
  <name xml:lang="en">Kinds</name>
  <elements>
    <element identifier="id-p" xsi:type="BusinessProcess"><name xml:lang="en">Ship</name></element>
    <element identifier="id-o" xsi:type="BusinessObject"><name xml:lang="en">Order</name></element>
  </elements>
  <relationships>
    <relationship identifier="id-read" xsi:type="Access" accessType="Read" source="id-p" target="id-o"/>
    <relationship identifier="id-write" xsi:type="Access" source="id-p" target="id-o"/>
    <relationship identifier="id-rw" xsi:type="Access" accessType="ReadWrite" source="id-p" target="id-o"/>
    <relationship identifier="id-any" xsi:type="Access" accessType="Access" source="id-p" target="id-o"/>
    <relationship identifier="id-dir" xsi:type="Association" isDirected="true" source="id-p" target="id-o"/>
    <relationship identifier="id-undir" xsi:type="Association" source="id-p" target="id-o"/>
  </relationships>
</model>`;

describe('parseArchiMateExchange', () => {
  it('reads elements, relationships, properties and diagrams', () => {
    const model = parseArchiMateExchange(EXCHANGE);
    expect(model.name).toBe('Shop');
    expect(model.lang).toBe('en');
    expect(model.elements.map((e) => e.type)).toEqual([
      'ApplicationComponent',
      'ApplicationComponent',
      'BusinessActor',
      'AndJunction',
      'SomethingProprietary',
    ]);
    expect(model.elements[0].properties).toEqual([{ name: 'Owner', value: 'Team A' }]);
    expect(model.relationships[0]).toMatchObject({ id: 'id-r1', type: 'Serving', source: 'id-api', target: 'id-web' });
    const view = model.views[0];
    expect(view.viewpoint).toBe('Application Cooperation');
    // Nested nodes are flattened, coordinates kept absolute.
    expect(view.nodes.map((n) => n.id)).toEqual(['n-group', 'n-web', 'n-api', 'n-api2']);
    expect(view.connections[0].bendpoints).toEqual([{ x: 230, y: 150 }]);
  });

  it('rejects text that is not an exchange model', () => {
    expect(() => parseArchiMateExchange('<<not xml')).toThrow();
    expect(() => parseArchiMateExchange('<other/>')).toThrow(/Not an ArchiMate exchange file/);
  });

  it('maps junction names onto the ontology spelling', () => {
    expect(exchangeTypeIri('AndJunction')).toBe(AM3 + 'Junction_And');
    expect(exchangeTypeIri('Serving')).toBe(AM3 + 'Serving');
  });

  it('reads the kind of access and a directed association', () => {
    const model = parseArchiMateExchange(KINDS);
    expect(model.relationships.map((r) => [r.type, r.accessType, r.isDirected])).toEqual([
      ['Access', 'Read', undefined],
      ['Access', undefined, undefined],
      ['Access', 'ReadWrite', undefined],
      ['Access', 'Access', undefined],
      ['Association', undefined, true],
      ['Association', undefined, undefined],
    ]);
  });

  it('types an access by its kind — Write when the file gives none, the format default — and a directed association', () => {
    const types = parseArchiMateExchange(KINDS).relationships.map((r) => exchangeRelationshipTypeIri(r).replace(AM3, ''));
    expect(types).toEqual(['ReadAccess', 'WriteAccess', 'ReadWriteAccess', 'Access', 'DirectedAssociation', 'Association']);
    // An ontology without the kinds keeps the relationship's own type.
    const [read] = parseArchiMateExchange(KINDS).relationships;
    expect(exchangeRelationshipTypeIri(read, AM3, (iri) => !iri.endsWith('ReadAccess'))).toBe(AM3 + 'Access');
  });
});

describe('applyExchangeModel against the bundled ArchiMate 3.2 metamodel', () => {
  let store: OxigraphRdfStore;
  beforeAll(async () => {
    store = new OxigraphRdfStore();
    await new N3MetamodelLoader(new N3TtlParser(), store).loadBundledMetamodel('archimate3');
  }, 30_000);
  afterAll(() => store.dispose());

  it('writes the model through the editor managers, in the current vocabulary', () => {
    const elements = new OxigraphElementManager(store);
    const relationships = new OxigraphRelationshipManager(store);
    const views = new OxigraphViewManager(store);
    const ns = 'https://example.org/archimate/test/';
    const modelIri = `${ns}model`;
    const knownClass = (iri: string) =>
      store.getQuads(nn(iri), nn(NAMESPACES.rdf + 'type'), nn(NAMESPACES.owl + 'Class')).length > 0;

    const report = applyExchangeModel(parseArchiMateExchange(EXCHANGE), {
      elements,
      relationships,
      views,
      modelIri,
      knownClass,
    });

    expect(report).toMatchObject({
      elementCount: 4,
      relationshipCount: 3,
      viewCount: 1,
      nodeCount: 2,
      connectionCount: 1,
      unrecognizedTypes: ['SomethingProprietary'],
      skippedNodes: 2, // the container, and the second placement of id-api
    });

    const web = `${ns}element-id-web`;
    const q = (s: string, p: string) => store.getQuads(nn(s), nn(p)).map((x) => x.object.value);
    expect(q(web, NAMESPACES.rdf + 'type')).toEqual([AM3 + 'ApplicationComponent']);
    expect(q(web, NAMESPACES.skos + 'prefLabel')).toEqual(['Web Shop']);
    expect(q(web, NAMESPACES.skos + 'definition')).toEqual(['Customer-facing web front end.']);
    expect(q(web, `${ns}property-owner`)).toEqual(['Team A']);
    expect(q(`${ns}element-id-j`, NAMESPACES.rdf + 'type')).toEqual([AM3 + 'Junction_And']);

    // Qualified relationship + unqualified triple.
    const r1 = `${ns}relationship-id-r1`;
    expect(q(r1, NAMESPACES.rdf + 'type')).toEqual([AM3 + 'Serving']);
    expect(store.getQuads(nn(`${ns}element-id-api`), nn(AM3 + 'serves'), nn(web))).toHaveLength(1);
    // A relationship to a relationship resolves too.
    expect(q(`${ns}relationship-id-r3`, NAMESPACES.arch + 'target')).toEqual([`${ns}relationship-id-r2`]);

    // Geometry: absolute bounds, and a route docked on the shapes' edges.
    const viewIri = `${ns}view-id-v1`;
    expect(views.getNode(viewIri, web)?.bounds).toEqual({ x: 40, y: 40, width: 120, height: 55 });
    const [link] = views.getLinks(viewIri);
    expect(link.relationshipIri).toBe(r1);
    expect(link.waypoints).toHaveLength(3);
    expect(link.waypoints[1]).toEqual({ x: 230, y: 150 });

    // No retired vocabulary.
    for (const old of ['relSource', 'relTarget', 'relPredicate']) {
      expect(store.getQuads(null, nn(NAMESPACES.arch + old))).toHaveLength(0);
    }
    expect(modelQuads(store).every((x) => x.subject.termType === 'NamedNode')).toBe(true);
  });

  it('writes each kind of access and association as its class, with the shared predicate', () => {
    const ns = 'https://example.org/archimate/kinds/';
    const knownClass = (iri: string) =>
      store.getQuads(nn(iri), nn(NAMESPACES.rdf + 'type'), nn(NAMESPACES.owl + 'Class')).length > 0;
    applyExchangeModel(parseArchiMateExchange(KINDS), {
      elements: new OxigraphElementManager(store),
      relationships: new OxigraphRelationshipManager(store),
      views: new OxigraphViewManager(store),
      modelIri: `${ns}model`,
      knownClass,
    });
    const typeOf = (id: string) =>
      store.getQuads(nn(`${ns}relationship-${id}`), nn(NAMESPACES.rdf + 'type')).map((x) => x.object.value.replace(AM3, ''));
    expect(typeOf('id-read')).toEqual(['ReadAccess']);
    expect(typeOf('id-write')).toEqual(['WriteAccess']);
    expect(typeOf('id-rw')).toEqual(['ReadWriteAccess']);
    expect(typeOf('id-any')).toEqual(['Access']);
    expect(typeOf('id-dir')).toEqual(['DirectedAssociation']);
    expect(typeOf('id-undir')).toEqual(['Association']);
    // The unqualified triples are the type's: am:accesses and am:associatedWith.
    expect(store.getQuads(nn(`${ns}element-id-p`), nn(AM3 + 'accesses'), nn(`${ns}element-id-o`))).toHaveLength(1);
    expect(store.getQuads(nn(`${ns}element-id-p`), nn(AM3 + 'associatedWith'), nn(`${ns}element-id-o`))).toHaveLength(1);
  });
});
