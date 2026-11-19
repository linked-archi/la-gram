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
          <label xml:lang="en">Front end</label>
          <node identifier="n-web" elementRef="id-web" xsi:type="Element" x="40" y="40" w="120" h="55"/>
        </node>
        <node identifier="n-note" xsi:type="Label" x="500" y="10" w="185" h="80">
          <label xml:lang="en">Remember the SLA</label>
        </node>
        <node identifier="n-api" elementRef="id-api" xsi:type="Element" x="300" y="40" w="120" h="55"/>
        <node identifier="n-api2" elementRef="id-api" xsi:type="Element" x="300" y="200" w="120" h="55"/>
        <connection identifier="c1" relationshipRef="id-r1" xsi:type="Relationship" source="n-api" target="n-web">
          <bendpoint x="230" y="150"/>
        </connection>
        <connection identifier="c2" xsi:type="Line" source="n-note" target="n-api"/>
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
    expect(view.nodes.map((n) => n.id)).toEqual(['n-group', 'n-web', 'n-note', 'n-api', 'n-api2']);
    // A container's and a label's text.
    expect(view.nodes.filter((n) => n.label).map((n) => [n.id, n.kind, n.label])).toEqual([
      ['n-group', 'Container', 'Front end'],
      ['n-note', 'Label', 'Remember the SLA'],
    ]);
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
      nodeCount: 3, // id-api placed twice
      connectionCount: 2, // the relationship's, and the note's line
      unrecognizedTypes: ['SomethingProprietary'],
      skippedNodes: 0,
      figureCount: 2, // the container and the label: a group and a note
    });

    const web = `${ns}element/id-web`;
    const q = (s: string, p: string) => store.getQuads(nn(s), nn(p)).map((x) => x.object.value);
    expect(q(web, NAMESPACES.rdf + 'type')).toEqual([AM3 + 'ApplicationComponent']);
    expect(q(web, NAMESPACES.skos + 'prefLabel')).toEqual(['Web Shop']);
    expect(q(web, NAMESPACES.skos + 'definition')).toEqual(['Customer-facing web front end.']);
    expect(q(web, `${ns}property-owner`)).toEqual(['Team A']);
    expect(q(`${ns}element/id-j`, NAMESPACES.rdf + 'type')).toEqual([AM3 + 'Junction_And']);

    // Qualified relationship + unqualified triple.
    const r1 = `${ns}relationship/id-r1`;
    expect(q(r1, NAMESPACES.rdf + 'type')).toEqual([AM3 + 'Serving']);
    expect(store.getQuads(nn(`${ns}element/id-api`), nn(AM3 + 'serves'), nn(web))).toHaveLength(1);
    // A relationship to a relationship resolves too.
    expect(q(`${ns}relationship/id-r3`, NAMESPACES.arch + 'target')).toEqual([`${ns}relationship/id-r2`]);

    // Geometry: absolute bounds, and a route docked on the shapes' edges.
    const viewIri = `${ns}view/id-v1`;
    expect(views.getNode(viewIri, web)?.bounds).toEqual({ x: 40, y: 40, width: 120, height: 55 });
    // The container is a group holding the element; the label a note.
    const figures = views.getNodes(viewIri).filter((n) => n.figure);
    const group = figures.find((n) => n.figure?.kind === 'group')!;
    expect(group).toMatchObject({ figure: { kind: 'group', text: 'Front end' }, bounds: { x: 10, y: 10, width: 400, height: 300 } });
    expect(views.getNode(viewIri, web)?.parentElementIri).toBe(group.elementIri);
    expect(figures.find((n) => n.figure?.kind === 'note')?.figure?.text).toBe('Remember the SLA');
    const link = views.getLinks(viewIri).find((l) => !l.connector)!;
    expect(link.relationshipIri).toBe(r1);
    // The note's line to the API stands for no relationship: drawn between the note and the placement it names.
    const note = figures.find((n) => n.figure?.kind === 'note')!;
    const line = views.getLinks(viewIri).find((l) => l.connector)!;
    expect(line).toMatchObject({ sourceNodeIri: note.nodeIri, targetElementIri: `${ns}element/id-api` });
    expect(views.getNodes(viewIri).find((n) => n.nodeIri === line.targetNodeIri)?.bounds.y).toBe(40);
    // id-api is placed twice; the connection joins the placement the file names (n-api, at 300,40).
    const apiNodes = views.getNodes(viewIri).filter((n) => n.elementIri === `${ns}element/id-api`);
    expect(apiNodes.map((n) => n.bounds.y).sort((a, b) => a - b)).toEqual([40, 200]);
    expect(apiNodes.find((n) => n.nodeIri === link.sourceNodeIri)?.bounds.y).toBe(40);
    expect(link.waypoints).toHaveLength(3);
    expect(link.waypoints[1]).toEqual({ x: 230, y: 150 });

    // Named as the ArchiMate converter names them (DD-41): every node and line in its view's IRI, by its id.
    expect(views.getNodes(viewIri).map((n) => n.nodeIri).sort()).toEqual(
      ['n-api', 'n-api2', 'n-group', 'n-note', 'n-web'].map((id) => `${viewIri}#node-${id}`),
    );
    expect(link.linkIri).toBe(`${viewIri}#link-c1`);
    expect(line.linkIri).toBe(`${viewIri}#link-c2`);
    expect(store.getQuads(nn(link.linkIri), nn(NAMESPACES['arch-vis'] + 'points')).map((x) => x.object.value)).toEqual([
      `${viewIri}#link-c1-points-0`,
    ]);

    // No retired vocabulary.
    for (const old of ['relSource', 'relTarget', 'relPredicate']) {
      expect(store.getQuads(null, nn(NAMESPACES.arch + old))).toHaveLength(0);
    }
    expect(modelQuads(store).every((x) => x.subject.termType === 'NamedNode')).toBe(true);
  });

  it('gives each node and connection the look its <style> gives it: colours (the alpha a percentage), line width, font', () => {
    const STYLED = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="m">
  <name xml:lang="en">Styled</name>
  <elements>
    <element identifier="e-a" xsi:type="ApplicationComponent"><name xml:lang="en">A</name></element>
    <element identifier="e-b" xsi:type="ApplicationComponent"><name xml:lang="en">B</name></element>
  </elements>
  <relationships><relationship identifier="r" xsi:type="Serving" source="e-a" target="e-b"/></relationships>
  <views><diagrams><view identifier="v" xsi:type="Diagram"><name xml:lang="en">V</name>
    <node identifier="n-a" elementRef="e-a" xsi:type="Element" x="0" y="0" w="120" h="55">
      <style lineWidth="2"><lineColor r="122" g="0" b="25"/><fillColor r="255" g="214" b="224" a="50"/>
        <font name="Georgia" size="9" style="bold italic"><color r="26" g="115" b="232"/></font></style>
    </node>
    <node identifier="n-b" elementRef="e-b" xsi:type="Element" x="300" y="0" w="120" h="55"/>
    <node identifier="n-note" xsi:type="Label" x="0" y="200" w="185" h="80"><label xml:lang="en">Note</label>
      <style><fillColor r="255" g="247" b="179" a="100"/></style></node>
    <connection identifier="c" relationshipRef="r" xsi:type="Relationship" source="n-a" target="n-b">
      <style lineWidth="3"><lineColor r="26" g="115" b="232"/></style>
    </connection>
  </view></diagrams></views>
</model>`;
    const parsed = parseArchiMateExchange(STYLED);
    expect(parsed.views[0]!.nodes.find((n) => n.id === 'n-b')?.style).toBeUndefined();
    const views = new OxigraphViewManager(store);
    const ns = 'https://example.org/archimate/styled/';
    applyExchangeModel(parsed, {
      elements: new OxigraphElementManager(store),
      relationships: new OxigraphRelationshipManager(store),
      views,
      modelIri: `${ns}model`,
      knownClass: () => true,
    });
    const viewIri = `${ns}view/v`;
    expect(views.getNode(viewIri, `${ns}element/e-a`)?.appearance).toEqual({
      fillColor: '#ffd6e080',
      lineColor: '#7a0019',
      lineWidth: 2,
      fontName: 'Georgia',
      fontSize: 9,
      fontStyle: 'bold italic',
      fontColor: '#1a73e8',
    });
    expect(views.getNode(viewIri, `${ns}element/e-b`)?.appearance).toBeUndefined();
    expect(views.getNodes(viewIri).find((n) => n.figure)?.figure).toMatchObject({ kind: 'note', fillColor: '#fff7b3' });
    expect(views.getLinks(viewIri)[0]?.appearance).toEqual({ lineColor: '#1a73e8', lineWidth: 3 });
  });

  it('draws a node nested in another inside it — a visual group in between too', () => {
    const NESTED = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-m">
  <name xml:lang="en">Nested</name>
  <elements>
    <element identifier="id-node" xsi:type="Node"><name xml:lang="en">Server</name></element>
    <element identifier="id-os" xsi:type="SystemSoftware"><name xml:lang="en">Linux</name></element>
  </elements>
  <views><diagrams>
    <view identifier="id-v" xsi:type="Diagram"><name xml:lang="en">Deployment</name>
      <node identifier="n-node" elementRef="id-node" xsi:type="Element" x="10" y="10" w="400" h="300">
        <node identifier="n-group" xsi:type="Container" x="20" y="40" w="300" h="200">
          <node identifier="n-os" elementRef="id-os" xsi:type="Element" x="40" y="80" w="120" h="55"/>
        </node>
      </node>
    </view>
  </diagrams></views>
</model>`;
    const views = new OxigraphViewManager(store);
    const ns = 'https://example.org/archimate/nested/';
    applyExchangeModel(parseArchiMateExchange(NESTED), {
      elements: new OxigraphElementManager(store),
      relationships: new OxigraphRelationshipManager(store),
      views,
      modelIri: `${ns}model`,
      knownClass: () => true,
    });
    const viewIri = views.getViews().find((v) => v.label === 'Deployment')!.iri;
    // The visual group between them is drawn: the software inside it, it inside the node.
    const group = views.getNodes(viewIri).find((n) => n.figure?.kind === 'group')!;
    expect(group.parentElementIri).toBe(`${ns}element/id-node`);
    expect(views.getNode(viewIri, `${ns}element/id-os`)).toMatchObject({
      parentElementIri: group.elementIri,
      bounds: { x: 40, y: 80, width: 120, height: 55 },
    });
    expect(views.getNode(viewIri, `${ns}element/id-node`)?.parentElementIri).toBeUndefined();
  });

  it('draws a relationship twice when the view does, each between the placements it joins', () => {
    const TWICE = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-m">
  <name xml:lang="en">Twice</name>
  <elements>
    <element identifier="id-api" xsi:type="ApplicationComponent"><name xml:lang="en">API</name></element>
    <element identifier="id-web" xsi:type="ApplicationComponent"><name xml:lang="en">Web</name></element>
  </elements>
  <relationships>
    <relationship identifier="id-s" xsi:type="Serving" source="id-api" target="id-web"/>
  </relationships>
  <views><diagrams>
    <view identifier="id-v" xsi:type="Diagram"><name xml:lang="en">Twice</name>
      <node identifier="n-api1" elementRef="id-api" xsi:type="Element" x="0" y="0" w="120" h="55"/>
      <node identifier="n-api2" elementRef="id-api" xsi:type="Element" x="0" y="300" w="120" h="55"/>
      <node identifier="n-web" elementRef="id-web" xsi:type="Element" x="400" y="150" w="120" h="55"/>
      <connection identifier="c1" relationshipRef="id-s" xsi:type="Relationship" source="n-api1" target="n-web"/>
      <connection identifier="c2" relationshipRef="id-s" xsi:type="Relationship" source="n-api2" target="n-web"/>
    </view>
  </diagrams></views>
</model>`;
    const views = new OxigraphViewManager(store);
    const ns = 'https://example.org/archimate/twice/';
    const report = applyExchangeModel(parseArchiMateExchange(TWICE), {
      elements: new OxigraphElementManager(store),
      relationships: new OxigraphRelationshipManager(store),
      views,
      modelIri: `${ns}model`,
      knownClass: () => true,
    });
    expect(report.connectionCount).toBe(2);
    const viewIri = views.getViews().find((v) => v.label === 'Twice')!.iri;
    const nodes = new Map(views.getNodes(viewIri).map((n) => [n.nodeIri, n]));
    const links = views.getLinks(viewIri);
    expect(links.map((l) => nodes.get(l.sourceNodeIri)?.bounds.y).sort((a, b) => a! - b!)).toEqual([0, 300]);
  });

  it('draws a connection that ends on a connection on that connection’s link, whatever their order', () => {
    const ON_LINE = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-m">
  <name xml:lang="en">Flow</name>
  <elements>
    <element identifier="id-a" xsi:type="ApplicationComponent"><name xml:lang="en">A</name></element>
    <element identifier="id-b" xsi:type="ApplicationComponent"><name xml:lang="en">B</name></element>
    <element identifier="id-d" xsi:type="DataObject"><name xml:lang="en">Order</name></element>
  </elements>
  <relationships>
    <relationship identifier="id-flow" xsi:type="Flow" source="id-a" target="id-b"/>
    <relationship identifier="id-carried" xsi:type="Association" source="id-d" target="id-flow"/>
  </relationships>
  <views><diagrams>
    <view identifier="id-v" xsi:type="Diagram"><name xml:lang="en">Flows</name>
      <node identifier="n-a" elementRef="id-a" xsi:type="Element" x="0" y="0" w="120" h="55"/>
      <node identifier="n-b" elementRef="id-b" xsi:type="Element" x="400" y="0" w="120" h="55"/>
      <node identifier="n-d" elementRef="id-d" xsi:type="Element" x="200" y="200" w="120" h="55"/>
      <connection identifier="c-carried" relationshipRef="id-carried" xsi:type="Relationship" source="n-d" target="c-flow">
        <bendpoint x="260" y="120"/>
      </connection>
      <connection identifier="c-flow" relationshipRef="id-flow" xsi:type="Relationship" source="n-a" target="n-b"/>
    </view>
  </diagrams></views>
</model>`;
    const views = new OxigraphViewManager(store);
    const ns = 'https://example.org/archimate/on-line/';
    const report = applyExchangeModel(parseArchiMateExchange(ON_LINE), {
      elements: new OxigraphElementManager(store),
      relationships: new OxigraphRelationshipManager(store),
      views,
      modelIri: `${ns}model`,
      knownClass: () => true,
    });
    expect(report.connectionCount).toBe(2);
    const viewIri = views.getViews().find((v) => v.label === 'Flows')!.iri;
    const [flow, carried] = views.getLinks(viewIri);
    expect(flow.relationshipIri).toBe(`${ns}relationship/id-flow`);
    expect(carried).toMatchObject({
      relationshipIri: `${ns}relationship/id-carried`,
      targetElementIri: `${ns}relationship/id-flow`,
      targetNodeIri: flow.linkIri,
    });
    // Clipped at the node it starts at; at the line, the route stops at its bend.
    expect(carried.waypoints).toHaveLength(2);
    expect(carried.waypoints[1]).toEqual({ x: 260, y: 120 });
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
      store.getQuads(nn(`${ns}relationship/${id}`), nn(NAMESPACES.rdf + 'type')).map((x) => x.object.value.replace(AM3, ''));
    expect(typeOf('id-read')).toEqual(['ReadAccess']);
    expect(typeOf('id-write')).toEqual(['WriteAccess']);
    expect(typeOf('id-rw')).toEqual(['ReadWriteAccess']);
    expect(typeOf('id-any')).toEqual(['Access']);
    expect(typeOf('id-dir')).toEqual(['DirectedAssociation']);
    expect(typeOf('id-undir')).toEqual(['Association']);
    // The unqualified triples are the type's: am:accesses and am:associatedWith.
    expect(store.getQuads(nn(`${ns}element/id-p`), nn(AM3 + 'accesses'), nn(`${ns}element/id-o`))).toHaveLength(1);
    expect(store.getQuads(nn(`${ns}element/id-p`), nn(AM3 + 'associatedWith'), nn(`${ns}element/id-o`))).toHaveLength(1);
  });
});
