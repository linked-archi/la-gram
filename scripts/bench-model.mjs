/**
 * Generate an ArchiMate 4.0 model of a given size, for the benchmark
 * (`scripts/bench.mjs`, Task 22): the same model for the same options, written as
 * la-gram writes a model — elements, qualified relationships with their direct
 * triples (`rdf:reifies`), diagrams with laid-out nodes and links.
 *
 *   node scripts/bench-model.mjs --triples 100000 [--view-size 40] [--seed 1] [--language 3.2] [--out file.ttl]
 *
 * `--language 3.2` writes the same model in ArchiMate 3.2: each type its 3.2
 * counterpart (a role a business role, a process a business process, a service
 * an application service …), for timing what is asked of a 3.2 model. Not every
 * relationship is then one 3.2 permits.
 *
 * Elements are of 30 types across the layers; each has two relationships the
 * ArchiMate 4.0 relationship tables permit, to elements of the type they name,
 * near it when there is one. Some faults are planted, so that validation has
 * something to find: every 997th element has no name, and every 503rd
 * relationship is one the tables do not permit (an assignment from a data
 * object to a node). Views take `view-size` elements each, in order, and a
 * tenth of the next view's; a relationship is drawn in each view that shows
 * both its ends.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataFactory, Writer } from 'n3';

const { namedNode, literal, quad } = DataFactory;

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM3 = 'https://meta.linked.archi/archimate3/onto#';

/** The ArchiMate 3.2 type for each ArchiMate 4.0 type the model uses whose name differs. */
const AM3_TYPE = {
  Role: 'BusinessRole',
  Collaboration: 'BusinessCollaboration',
  Process: 'BusinessProcess',
  Function: 'ApplicationFunction',
  Event: 'BusinessEvent',
  Service: 'ApplicationService',
};
const ARCH = 'https://meta.linked.archi/core#';
const VIS = 'https://meta.linked.archi/core-vis#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const DCTERMS = 'http://purl.org/dc/terms/';
const VANN = 'http://purl.org/vocab/vann/';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

/** Each relationship kind's direct predicate (`arch:unqualifiedForm`). */
const PREDICATE = {
  Aggregation: 'aggregates',
  Assignment: 'assignedTo',
  Access: 'accesses',
  Composition: 'composedOf',
  Flow: 'flowsTo',
  Influence: 'influences',
  Realization: 'realizes',
  Serving: 'serves',
  Triggering: 'triggers',
};

/**
 * What each element type may have to which other: relationships the ArchiMate
 * 4.0 tables permit, as la-gram's relationship manager answers it — eight
 * targets (five for the motivation elements), spread over the kinds.
 */
const PERMITTED = {
  BusinessActor: [['Aggregation', 'BusinessInterface'], ['Serving', 'Device'], ['Realization', 'Resource'], ['Triggering', 'Event'], ['Access', 'DataObject'], ['Realization', 'Capability'], ['Realization', 'Requirement'], ['Assignment', 'Process']],
  Role: [['Access', 'BusinessObject'], ['Serving', 'SystemSoftware'], ['Influence', 'Stakeholder'], ['Triggering', 'Location'], ['Triggering', 'Service'], ['Triggering', 'Node'], ['Realization', 'ValueStream'], ['Assignment', 'WorkPackage']],
  Collaboration: [['Serving', 'Product'], ['Serving', 'TechnologyInterface'], ['Influence', 'Driver'], ['Triggering', 'BusinessActor'], ['Triggering', 'BusinessInterface'], ['Flow', 'Device'], ['Realization', 'Resource'], ['Assignment', 'Event']],
  Process: [['Serving', 'ApplicationComponent'], ['Access', 'Artifact'], ['Influence', 'Goal'], ['Triggering', 'Role'], ['Access', 'BusinessObject'], ['Serving', 'SystemSoftware'], ['Influence', 'Stakeholder'], ['Serving', 'Location']],
  Function: [['Triggering', 'ApplicationInterface'], ['Triggering', 'CommunicationNetwork'], ['Realization', 'Outcome'], ['Flow', 'Collaboration'], ['Serving', 'Product'], ['Serving', 'TechnologyInterface'], ['Influence', 'Driver'], ['Serving', 'BusinessActor']],
  Event: [['Access', 'DataObject'], ['Realization', 'Requirement'], ['Serving', 'Process'], ['Serving', 'ApplicationComponent'], ['Access', 'Artifact'], ['Realization', 'Goal'], ['Serving', 'Role'], ['Access', 'BusinessObject']],
  Service: [['Triggering', 'Node'], ['Realization', 'ValueStream'], ['Serving', 'Function'], ['Serving', 'ApplicationInterface'], ['Serving', 'CommunicationNetwork'], ['Influence', 'Outcome'], ['Triggering', 'Collaboration'], ['Triggering', 'Product']],
  BusinessInterface: [['Flow', 'Device'], ['Realization', 'Resource'], ['Serving', 'Event'], ['Access', 'DataObject'], ['Realization', 'Capability'], ['Influence', 'Requirement'], ['Triggering', 'Process'], ['Triggering', 'ApplicationComponent']],
  BusinessObject: [['Influence', 'Stakeholder'], ['Realization', 'ValueStream'], ['Realization', 'Outcome'], ['Influence', 'Driver'], ['Realization', 'Resource'], ['Realization', 'Capability'], ['Influence', 'Requirement'], ['Realization', 'Goal']],
  Product: [['Realization', 'TechnologyInterface'], ['Influence', 'Driver'], ['Serving', 'BusinessActor'], ['Serving', 'BusinessInterface'], ['Triggering', 'Device'], ['Realization', 'Resource'], ['Flow', 'Event'], ['Composition', 'DataObject']],
  ApplicationComponent: [['Access', 'Artifact'], ['Realization', 'Goal'], ['Serving', 'Role'], ['Access', 'BusinessObject'], ['Triggering', 'SystemSoftware'], ['Influence', 'Stakeholder'], ['Flow', 'Location'], ['Assignment', 'Service']],
  ApplicationInterface: [['Serving', 'CommunicationNetwork'], ['Influence', 'Outcome'], ['Triggering', 'Collaboration'], ['Triggering', 'Product'], ['Triggering', 'TechnologyInterface'], ['Influence', 'Driver'], ['Serving', 'BusinessActor'], ['Realization', 'BusinessInterface']],
  DataObject: [['Realization', 'Capability'], ['Influence', 'Requirement'], ['Realization', 'Goal'], ['Realization', 'BusinessObject'], ['Influence', 'Stakeholder'], ['Realization', 'ValueStream'], ['Influence', 'Outcome'], ['Influence', 'Driver']],
  Node: [['Realization', 'ValueStream'], ['Assignment', 'WorkPackage'], ['Triggering', 'Function'], ['Flow', 'ApplicationInterface'], ['Serving', 'CommunicationNetwork'], ['Realization', 'Outcome'], ['Serving', 'Collaboration'], ['Serving', 'Product']],
  Device: [['Realization', 'Resource'], ['Flow', 'Event'], ['Access', 'DataObject'], ['Realization', 'Capability'], ['Realization', 'Requirement'], ['Realization', 'Process'], ['Serving', 'ApplicationComponent'], ['Access', 'Artifact']],
  SystemSoftware: [['Influence', 'Stakeholder'], ['Flow', 'Location'], ['Assignment', 'Service'], ['Serving', 'Node'], ['Realization', 'ValueStream'], ['Assignment', 'WorkPackage'], ['Serving', 'Function'], ['Triggering', 'ApplicationInterface']],
  TechnologyInterface: [['Influence', 'Driver'], ['Serving', 'BusinessActor'], ['Realization', 'BusinessInterface'], ['Serving', 'Device'], ['Realization', 'Resource'], ['Triggering', 'Event'], ['Access', 'DataObject'], ['Realization', 'Capability']],
  Artifact: [['Realization', 'Goal'], ['Realization', 'Role'], ['Realization', 'BusinessObject'], ['Realization', 'SystemSoftware'], ['Influence', 'Stakeholder'], ['Realization', 'Service'], ['Realization', 'ValueStream'], ['Realization', 'Function']],
  CommunicationNetwork: [['Realization', 'Outcome'], ['Serving', 'Collaboration'], ['Serving', 'Product'], ['Serving', 'TechnologyInterface'], ['Influence', 'Driver'], ['Triggering', 'BusinessActor'], ['Triggering', 'BusinessInterface'], ['Flow', 'Device']],
  Capability: [['Realization', 'Requirement'], ['Influence', 'Goal'], ['Influence', 'Stakeholder'], ['Triggering', 'ValueStream'], ['Realization', 'Outcome'], ['Influence', 'Driver'], ['Serving', 'Resource'], ['Serving', 'Capability']],
  ValueStream: [['Realization', 'Outcome'], ['Influence', 'Driver'], ['Triggering', 'Resource'], ['Serving', 'Capability'], ['Realization', 'Requirement'], ['Influence', 'Goal'], ['Influence', 'Stakeholder'], ['Triggering', 'ValueStream']],
  Resource: [['Triggering', 'Capability'], ['Realization', 'Requirement'], ['Realization', 'Goal'], ['Influence', 'Stakeholder'], ['Assignment', 'ValueStream'], ['Realization', 'Outcome'], ['Influence', 'Driver'], ['Triggering', 'Resource']],
  Stakeholder: [['Influence', 'Outcome'], ['Influence', 'Driver'], ['Influence', 'Requirement'], ['Influence', 'Goal'], ['Composition', 'Stakeholder']],
  Driver: [['Influence', 'Requirement'], ['Influence', 'Goal'], ['Influence', 'Stakeholder'], ['Influence', 'Outcome'], ['Composition', 'Driver']],
  Goal: [['Influence', 'Stakeholder'], ['Influence', 'Outcome'], ['Influence', 'Driver'], ['Influence', 'Requirement'], ['Composition', 'Goal']],
  Outcome: [['Influence', 'Driver'], ['Influence', 'Requirement'], ['Influence', 'Goal'], ['Influence', 'Stakeholder'], ['Aggregation', 'Outcome']],
  Requirement: [['Realization', 'Goal'], ['Influence', 'Stakeholder'], ['Realization', 'Outcome'], ['Influence', 'Driver'], ['Influence', 'Requirement']],
  WorkPackage: [['Realization', 'Function'], ['Realization', 'ApplicationInterface'], ['Realization', 'CommunicationNetwork'], ['Influence', 'Outcome'], ['Realization', 'Collaboration'], ['Realization', 'Product'], ['Realization', 'TechnologyInterface'], ['Influence', 'Driver']],
  Deliverable: [['Realization', 'Event'], ['Realization', 'DataObject'], ['Realization', 'Capability'], ['Influence', 'Requirement'], ['Realization', 'Process'], ['Realization', 'ApplicationComponent'], ['Realization', 'Artifact'], ['Realization', 'Goal']],
  Location: [['Realization', 'Service'], ['Serving', 'Node'], ['Composition', 'ValueStream'], ['Composition', 'WorkPackage'], ['Triggering', 'Function'], ['Flow', 'ApplicationInterface'], ['Composition', 'CommunicationNetwork'], ['Aggregation', 'Outcome']],
};
const TYPES = Object.keys(PERMITTED);

/** One element in this many has no name: a violation of the element shapes. */
export const UNNAMED_EVERY = 997;
/** One relationship in this many is not permitted: a data object assigned to a node. */
export const NOT_PERMITTED_EVERY = 503;
/** Triples an element brings with it on average, its relationships, nodes and links included. */
const TRIPLES_PER_ELEMENT = 34;

/** A small, seeded random number generator (mulberry32): the same model each time. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The model, as Turtle text, and what it holds.
 *
 * @param {{ triples?: number, elements?: number, viewSize?: number, seed?: number, language?: '4.0' | '3.2' }} options
 *   `triples`: about how many (or `elements`: exactly how many elements);
 *   `viewSize`: elements a view shows (40); `seed` (1); `language`: ArchiMate
 *   4.0 (the default) or 3.2.
 */
export function generateModel(options = {}) {
  const viewSize = Math.max(1, options.viewSize ?? 40);
  const count = options.elements ?? Math.max(TYPES.length, Math.round((options.triples ?? 10000) / TRIPLES_PER_ELEMENT));
  const next = random(options.seed ?? 1);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const ns = `https://example.org/bench/${count}/`;
  const m = (local) => namedNode(ns + local);
  const am3 = options.language === '3.2';
  const am4 = (local) => (am3 ? namedNode(AM3 + (AM3_TYPE[local] ?? local)) : namedNode(AM4 + local));
  const quads = [];
  const add = (s, p, o) => quads.push(quad(s, p, o));
  const label = (text) => literal(text, 'en');
  const double = (n) => literal(String(n), namedNode(XSD + 'double'));
  const rdfType = namedNode(RDF + 'type');
  const prefLabel = namedNode(SKOS + 'prefLabel');
  const inModel = namedNode(ARCH + 'inModel');
  const inView = namedNode(ARCH + 'inView');
  const model = m('model');

  add(model, rdfType, namedNode(ARCH + 'Model'));
  add(model, prefLabel, label(`Benchmark, ${count} elements`));
  add(
    model,
    namedNode(ARCH + 'modelConformsToMetamodel'),
    namedNode(am3 ? 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2' : 'https://meta.linked.archi/archimate4/metamodel#ArchiMate4'),
  );
  add(model, namedNode(DCTERMS + 'created'), literal('2026-01-01T00:00:00Z', namedNode(XSD + 'dateTime')));
  add(model, namedNode(VANN + 'preferredNamespacePrefix'), literal('m'));
  add(model, namedNode(VANN + 'preferredNamespaceUri'), literal(ns));

  // Elements, each of a type in turn; the views each shows.
  const elements = [];
  const byType = new Map(TYPES.map((t) => [t, []]));
  for (let i = 0; i < count; i++) {
    const type = TYPES[i % TYPES.length];
    const element = { iri: m(`element-${i}`), type, index: i, views: [] };
    elements.push(element);
    byType.get(type).push(element);
  }
  const views = [];
  for (let first = 0, v = 0; first < count; first += viewSize, v++) {
    const members = elements.slice(first, first + viewSize).concat(elements.slice(first + viewSize, first + viewSize + Math.ceil(viewSize / 10)));
    const view = { iri: m(`view-${v}`), index: v, members, nodeOf: new Map() };
    for (const e of members) e.views.push(view);
    views.push(view);
  }

  for (const e of elements) {
    add(e.iri, rdfType, am4(e.type));
    if (e.index % UNNAMED_EVERY !== UNNAMED_EVERY - 1) add(e.iri, prefLabel, label(`${e.type} ${e.index}`));
    if (e.index % 3 === 0) add(e.iri, namedNode(DCTERMS + 'description'), label(`What ${e.type.toLowerCase()} ${e.index} is for.`));
    add(e.iri, inModel, model);
    for (const view of e.views) add(e.iri, inView, view.iri);
  }

  // Relationships: two from each element, to an element of the type the tables
  // name — of its own view when there is one, so that the views show them.
  const relationships = [];
  const relate = (kind, source, target) => {
    const iri = m(`relationship-${relationships.length}`);
    const predicate = am4(PREDICATE[kind]);
    add(source.iri, predicate, target.iri);
    add(iri, rdfType, am4(kind));
    add(iri, namedNode(RDF + 'reifies'), quad(source.iri, predicate, target.iri));
    add(iri, namedNode(ARCH + 'source'), source.iri);
    add(iri, namedNode(ARCH + 'target'), target.iri);
    const shown = source.views.filter((view) => target.views.includes(view));
    for (const view of shown) add(iri, inView, view.iri);
    relationships.push({ iri, source, target, views: shown });
  };
  const notPermitted = [];
  for (const source of elements) {
    for (let r = 0; r < 2; r++) {
      if (relationships.length % NOT_PERMITTED_EVERY === NOT_PERMITTED_EVERY - 1) {
        const from = pick(byType.get('DataObject'));
        notPermitted.push({ relationship: m(`relationship-${relationships.length}`).value, source: from.iri.value });
        relate('Assignment', from, pick(byType.get('Node')));
        continue;
      }
      const [kind, targetType] = pick(PERMITTED[source.type]);
      const near = (source.views[0]?.members ?? []).filter((e) => e.type === targetType && e !== source);
      relate(kind, source, near.length > 0 ? pick(near) : pick(byType.get(targetType)));
    }
  }

  // Views: their nodes laid out in a grid, the relationships between them drawn.
  let nodes = 0;
  let links = 0;
  for (const view of views) {
    add(view.iri, rdfType, namedNode(ARCH + 'Diagram'));
    add(view.iri, rdfType, namedNode(ARCH + 'View'));
    add(view.iri, prefLabel, label(`View ${view.index}`));
    add(view.iri, inModel, model);
    const columns = Math.ceil(Math.sqrt(view.members.length));
    view.members.forEach((e, k) => {
      const node = m(`view-${view.index}/node-${k}`);
      view.nodeOf.set(e, node);
      add(node, rdfType, namedNode(VIS + 'ArchNode'));
      add(node, namedNode(VIS + 'archElement'), e.iri);
      add(node, namedNode(VIS + 'view'), view.iri);
      add(node, namedNode(VIS + 'bounds-x'), double(20 + (k % columns) * 180));
      add(node, namedNode(VIS + 'bounds-y'), double(20 + Math.floor(k / columns) * 100));
      add(node, namedNode(VIS + 'bounds-w'), double(120));
      add(node, namedNode(VIS + 'bounds-h'), double(55));
      nodes++;
    });
  }
  for (const rel of relationships) {
    for (const view of rel.views) {
      const link = namedNode(`${view.iri.value}/link-${links}`);
      add(link, rdfType, namedNode(VIS + 'Link'));
      add(link, namedNode(VIS + 'archRelationship'), rel.iri);
      add(link, namedNode(VIS + 'source'), view.nodeOf.get(rel.source));
      add(link, namedNode(VIS + 'target'), view.nodeOf.get(rel.target));
      add(link, namedNode(VIS + 'view'), view.iri);
      links++;
    }
  }

  const writer = new Writer({
    prefixes: { m: ns, ...(am3 ? { am: AM3 } : { am4: AM4 }), arch: ARCH, 'arch-vis': VIS, rdf: RDF, skos: SKOS, dcterms: DCTERMS, vann: VANN, xsd: XSD },
  });
  for (const q of quads) writer.addQuad(q);
  let text = '';
  writer.end((err, result) => {
    if (err) throw err;
    text = result;
  });
  return {
    text,
    triples: quads.length,
    elements: count,
    relationships: relationships.length,
    views: views.length,
    nodes,
    links,
    /** The faults planted: elements without a name, relationships not permitted (and their sources). */
    faults: {
      unnamed: elements.filter((e) => e.index % UNNAMED_EVERY === UNNAMED_EVERY - 1).map((e) => e.iri.value),
      notPermitted,
    },
  };
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const triples = Number(arg('triples', '10000'));
  const viewSize = Number(arg('view-size', '40'));
  const seed = Number(arg('seed', '1'));
  const language = arg('language', '4.0');
  const out = arg('out', `model-${triples}${viewSize === 40 ? '' : `-view${viewSize}`}${language === '3.2' ? '-am3' : ''}.ttl`);
  const { text, faults, ...facts } = generateModel({ triples, viewSize, seed, language });
  writeFileSync(out, text);
  console.log(JSON.stringify({ out, ...facts, unnamed: faults.unnamed.length, notPermitted: faults.notPermitted.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
