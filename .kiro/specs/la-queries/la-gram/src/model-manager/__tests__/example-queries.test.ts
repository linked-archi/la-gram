/**
 * Every question in the query assets parses, builds and runs on la-gram's own
 * Oxigraph, against the bundled ArchiMate 4.0 metamodel loaded the way
 * N3MetamodelLoader loads it (one named graph per document) and a small model
 * in the default graph; and the questions that answer a concern answer it.
 *
 * The fixture is built so each finding question has exactly the culprit it is
 * meant to catch, and a near miss it must not report.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import {
  buildQuery,
  listQuestions,
  prebind,
  MissingParameterError,
  type Question,
  type QuestionBindings,
} from '../example-queries.js';

const asset = (path: string) => readFileSync(new URL(`../../../assets/${path}`, import.meta.url), 'utf8');

const ARCH = 'https://meta.linked.archi/core#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM4VP = 'https://meta.linked.archi/archimate4/viewpoints#';
const EX = 'https://example.org/fixture#';

const DOCUMENTS: [path: string, graph: string][] = [
  ['core/core-onto.ttl', ARCH],
  ['archimate4/archimate4-onto.ttl', AM4],
  ['archimate4/archimate4-viewpoints.ttl', AM4VP],
  ['core/core-queries.ttl', 'https://meta.linked.archi/core-queries#'],
  ['archimate4/archimate4-queries.ttl', 'https://meta.linked.archi/archimate4/queries#'],
];

// ── Fixture model ────────────────────────────────────────────────────────

const el = (id: string, cls: string, label: string, extra = '') =>
  `ex:${id} a am4:${cls} ; arch:inModel ex:model ; skos:prefLabel "${label}"@en${extra} .\n`;

/** A relationship the la-gram way: qualified resource, unqualified triple, rdf:reifies. */
const rel = (id: string, cls: string, predicate: string, source: string, target: string, reifies = true) =>
  `ex:${id} a am4:${cls} ; arch:source ex:${source} ; arch:target ex:${target} ; arch:inModel ex:model` +
  (reifies ? ` ;\n  rdf:reifies <<( ex:${source} am4:${predicate} ex:${target} )>>` : '') +
  ` .\nex:${source} am4:${predicate} ex:${target} .\n`;

const FIXTURE = `
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .
@prefix arch:  <${ARCH}> .
@prefix am4:   <${AM4}> .
@prefix am4vp: <${AM4VP}> .
@prefix ex:    <${EX}> .

ex:model a arch:Model ; skos:prefLabel "Fixture"@en .
ex:orgView a arch:Diagram ; arch:inModel ex:model ; skos:prefLabel "Organisation"@en ;
  arch:viewConformsToViewpoint am4vp:OrganizationViewpoint .

${el('customer', 'BusinessActor', 'Customer', ' ; arch:inView ex:orgView')}
${el('clerk', 'Role', 'Claims Clerk', ' ; arch:inView ex:orgView')}
${el('server', 'Node', 'Application Server', ' ; arch:inView ex:orgView')}
${el('handleClaim', 'Process', 'Handle Claim', ' ; skos:definition "Settle a claim."@en')}
${el('registerClaim', 'Process', 'Register Claim')}
${el('claimService', 'Service', 'Claim Service')}
${el('orphanService', 'Service', 'Orphan Service')}
${el('crm', 'ApplicationComponent', 'CRM')}
${el('crmDup', 'ApplicationComponent', 'crm')}
${el('policyApp', 'ApplicationComponent', 'Policy Administration')}
${el('newApp', 'ApplicationComponent', 'Claims Portal', ' ; arch:architectureState arch:Target ; arch:approvalState arch:Proposed')}
${el('customerData', 'DataObject', 'Customer Data')}
${el('ceo', 'Stakeholder', 'CEO')}
${el('goal', 'Goal', 'Faster claims')}
${el('req', 'Requirement', 'Claims settled within 24h')}
${el('req2', 'Requirement', 'Unrealised requirement')}
${el('principle', 'Principle', 'Digital first')}
${el('principle2', 'Principle', 'Unbacked principle')}
${el('capability', 'Capability', 'Claims Management')}
${el('capability2', 'Capability', 'Fraud Detection')}
${el('wp', 'WorkPackage', 'CRM upgrade')}
${el('deliv', 'Deliverable', 'Upgraded CRM')}
${el('plateauA', 'Plateau', 'Baseline')}
${el('plateauB', 'Plateau', 'Target')}

${rel('r1', 'Assignment', 'assignedTo', 'clerk', 'handleClaim')}
${rel('r2', 'Assignment', 'assignedTo', 'customer', 'clerk')}
${rel('r3', 'Realization', 'realizes', 'handleClaim', 'claimService')}
${rel('r4', 'Serving', 'serves', 'claimService', 'customer')}
${rel('r5', 'Serving', 'serves', 'server', 'crm', false)}
${rel('r6', 'Serving', 'serves', 'crm', 'policyApp')}
${rel('r7', 'ReadAccess', 'accesses', 'crm', 'customerData')}
${rel('r8', 'Realization', 'realizes', 'handleClaim', 'req')}
${rel('r9', 'Realization', 'realizes', 'req', 'goal')}
${rel('r10', 'Realization', 'realizes', 'req', 'principle')}
${rel('r11', 'Influence', 'influences', 'ceo', 'goal')}
${rel('r12', 'Realization', 'realizes', 'handleClaim', 'capability')}
${rel('r13', 'Realization', 'realizes', 'wp', 'deliv')}
${rel('r14', 'Realization', 'realizes', 'deliv', 'crm')}
${rel('r15', 'Aggregation', 'aggregates', 'plateauA', 'crm')}
${rel('r16', 'Aggregation', 'aggregates', 'plateauA', 'policyApp')}
${rel('r17', 'Aggregation', 'aggregates', 'plateauB', 'crm')}
${rel('r18', 'Aggregation', 'aggregates', 'plateauB', 'newApp')}
`;

/** What la-gram would bind from the UI: selection, active view, open model … */
const BINDINGS: QuestionBindings = {
  focus: EX + 'server',
  view: EX + 'orgView',
  model: EX + 'model',
  viewpoint: AM4VP + 'OrganizationViewpoint',
  type: AM4 + 'ApplicationComponent',
  from: EX + 'plateauA',
  to: EX + 'plateauB',
};

// ── Harness ──────────────────────────────────────────────────────────────

let store: OxigraphRdfStore;
let questions: Question[];

beforeAll(() => {
  store = new OxigraphRdfStore();
  for (const [path, graph] of DOCUMENTS) store.load(asset(path), { format: 'text/turtle', graph });
  store.load(FIXTURE, { format: 'text/turtle' });
  questions = listQuestions(store);
});

const question = (iri: string) => {
  const q = questions.find((x) => x.iri === iri);
  if (!q) throw new Error(`No question ${iri}`);
  return q;
};

/** Rows of a question, run with BINDINGS (overridable). */
function ask(iri: string, bindings: QuestionBindings = {}) {
  const result = store.query(buildQuery(question(iri), { ...BINDINGS, ...bindings }, { limit: null }));
  if (result.type !== 'bindings') throw new Error(`${iri} is not a SELECT`);
  return result.results.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, (v as { value: string }).value])),
  );
}

/** The fixture ids appearing in one column. */
const ids = (rows: Record<string, string>[], column: string) =>
  new Set(rows.map((r) => r[column]).filter((v) => v?.startsWith(EX)).map((v) => v.slice(EX.length)));

const archq = (id: string) => 'https://meta.linked.archi/core-queries#' + id;
const am4q = (id: string) => 'https://meta.linked.archi/archimate4/queries#' + id;

// ── Tests ────────────────────────────────────────────────────────────────

describe('query assets', () => {
  it('lists every question with label, stage, prefixes and its query text', () => {
    expect(questions.length).toBe(35);
    for (const q of questions) {
      expect(q.label, q.iri).not.toBe(q.iri.split('#')[1]);
      expect(q.stage, q.iri).toBeDefined();
      expect(Object.keys(q.prefixes), q.iri).toContain('arch');
      expect(q.text, q.iri).toMatch(/^SELECT/);
      expect(q.text, q.iri).not.toMatch(/\bPREFIX\b|\bLIMIT\b/i);
    }
  });

  it('builds and runs every question, with and without its optional parameters', () => {
    for (const q of questions) {
      const required: QuestionBindings = {};
      for (const p of q.parameters) if (!p.optional) required[p.name] = BINDINGS[p.name];
      expect(() => store.query(buildQuery(q, BINDINGS)), q.iri).not.toThrow();
      expect(() => store.query(buildQuery(q, required)), q.iri).not.toThrow();
    }
  });

  it('refuses to run a question without its required parameter', () => {
    expect(() => buildQuery(question(am4q('impact-of-change')), {})).toThrow(MissingParameterError);
  });
});

describe('prebind', () => {
  it('binds at the start of the outermost WHERE group, not in strings or comments', () => {
    const q = 'SELECT ?x # WHERE {\nWHERE { ?x <urn:p> "WHERE {" { SELECT ?y WHERE { ?y ?p ?o } } }';
    const bound = prebind(q, { focus: 'urn:a', unbound: undefined });
    expect(bound).toContain('WHERE {\n  VALUES ?focus { <urn:a> } ?x');
    expect(bound.match(/VALUES/g)).toHaveLength(1);
  });

  it('refuses what is not an IRI', () => {
    expect(() => prebind('SELECT * WHERE { ?s ?p ?o }', { focus: 'urn:a> } ?x {' })).toThrow();
  });
});

describe('core questions answer on the fixture', () => {
  it('orphans: unconnected elements, never views or the model', () => {
    const found = [...ids(ask(archq('orphans')), 'element')];
    expect(found).toContain('registerClaim');
    expect(found).toContain('orphanService');
    expect(found).not.toContain('crm');
    expect(found).not.toContain('orgView');
  });

  it('viewpoint-conformance: the node on the organisation view', () => {
    expect(ids(ask(archq('viewpoint-conformance')), 'element')).toEqual(new Set(['server']));
  });

  it('viewpoint-scope: what the organisation viewpoint admits, with outgoing links', () => {
    const rows = ask(archq('viewpoint-scope'));
    expect(ids(rows, 'element')).toEqual(new Set(['customer', 'clerk']));
    expect(rows.find((r) => r.element === EX + 'customer')?.outgoing).toContain('Assignment → Claims Clerk');
  });

  it('duplicate-labels: CRM and crm', () => {
    expect(ids(ask(archq('duplicate-labels')), 'element')).toEqual(new Set(['crm', 'crmDup']));
  });

  it('relationship-integrity: the serving relationship without rdf:reifies', () => {
    const rows = ask(archq('relationship-integrity'));
    expect(ids(rows, 'relationship')).toEqual(new Set(['r5']));
    expect(rows[0].problem).toBe('no rdf:reifies');
  });

  it('architecture-state: the proposed target application', () => {
    expect(ids(ask(archq('architecture-state')), 'element')).toEqual(new Set(['newApp']));
  });
});

describe('ArchiMate 4 questions answer on the fixture', () => {
  it('elements-by-domain: five application-domain elements, read through the ontology graph', () => {
    const rows = ask(am4q('elements-by-domain'));
    expect(Number(rows.find((r) => r.domain === AM4 + 'ApplicationDomainElement')?.elements)).toBe(5);
  });

  it('viewpoint-scope: common-domain behaviour only where a domain-specific element anchors it', () => {
    // The Role is anchored by the Business Actor assigned to it; nothing else the
    // Organization Viewpoint admits is in the fixture.
    expect(ids(ask(am4q('viewpoint-scope')), 'element')).toEqual(new Set(['customer', 'clerk']));
    // The Technology Viewpoint admits Process, but no node anchors Handle Claim.
    const technology = ids(ask(am4q('viewpoint-scope'), { viewpoint: AM4VP + 'TechnologyViewpoint' }), 'element');
    expect(technology).toEqual(new Set(['server']));
  });

  it('cross-domain-relationships: technology serving application', () => {
    const rows = ask(am4q('cross-domain-relationships'));
    const row = rows.find(
      (r) => r.sourceDomain === AM4 + 'TechnologyDomainElement' && r.targetDomain === AM4 + 'ApplicationDomainElement',
    );
    expect(row?.relationshipType).toBe(AM4 + 'Serving');
  });

  it('unassigned-behaviour, unrealised-services', () => {
    expect(ids(ask(am4q('unassigned-behaviour')), 'behaviour')).toEqual(new Set(['registerClaim']));
    expect(ids(ask(am4q('unrealised-services')), 'service')).toEqual(new Set(['orphanService']));
  });

  it('applications-without-technology: all but the one a node serves', () => {
    expect(ids(ask(am4q('applications-without-technology')), 'application')).toEqual(
      new Set(['policyApp', 'newApp', 'crmDup']),
    );
  });

  it('data-never-written: read by the CRM, written by nothing', () => {
    expect(ids(ask(am4q('data-never-written')), 'object')).toEqual(new Set(['customerData']));
  });

  it('impact-of-change: what depends on the server, transitively', () => {
    expect(ids(ask(am4q('impact-of-change')), 'impacted')).toEqual(new Set(['crm', 'policyApp']));
  });

  it('unrealised requirements, capabilities and principles', () => {
    expect(ids(ask(am4q('unrealised-requirements')), 'requirement')).toEqual(new Set(['req2']));
    expect(ids(ask(am4q('unrealised-capabilities')), 'capability')).toEqual(new Set(['capability2']));
    expect(ids(ask(am4q('principles-without-requirements')), 'principle')).toEqual(new Set(['principle2']));
  });

  it('plateau-difference: what the target adds and removes', () => {
    const rows = ask(am4q('plateau-difference'));
    expect(ids(rows.filter((r) => r.change === 'added'), 'element')).toEqual(new Set(['newApp']));
    expect(ids(rows.filter((r) => r.change === 'removed'), 'element')).toEqual(new Set(['policyApp']));
  });
});
