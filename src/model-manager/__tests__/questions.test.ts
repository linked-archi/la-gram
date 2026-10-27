/**
 * The model questions of the bundled question sets — the core set and
 * ArchiMate 4.0's — as la-gram loads and asks them: every one parses, takes
 * its parameters and runs on la-gram's Oxigraph; each finding catches its
 * culprits and none of its near misses; and every answer is the same when the
 * inferable core and abstract types are added beside each concept's own, as
 * converters assert them and RDFS inference adds them.
 *
 * The model is meta's example for the same check
 * (examples/archimate4-questions-example.ttl in linked-archi-meta), which runs
 * the questions on RDF4J: two engines, one set of answers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { createApp } from '../../app.js';
import {
  buildQuery,
  listQuestions,
  missingParameters,
  offeredQuestions,
  prebind,
  runModelChecks,
  stageOf,
  viewpointOfAnswer,
  whatToSelect,
  MissingParameterError,
  type ModelQuestion,
  type QuestionBindings,
} from '../questions.js';

const asset = (path: string) => readFileSync(new URL(`../../../assets/${path}`, import.meta.url), 'utf8');

const ARCH = 'https://meta.linked.archi/core#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM4VP = 'https://meta.linked.archi/archimate4/viewpoints#';
const EX = 'https://meta.linked.archi/examples/archimate4-questions/';
const archq = (id: string) => 'https://meta.linked.archi/core-questions#' + id;
const am4q = (id: string) => 'https://meta.linked.archi/archimate4/questions#' + id;

/** The documents, one named graph each, as the metamodel loader keeps them. */
const DOCUMENTS: [path: string, graph: string][] = [
  ['core/core-onto.ttl', ARCH],
  ['core/core-questions.ttl', 'https://meta.linked.archi/core-questions#'],
  ['archimate4/archimate4-onto.ttl', AM4],
  ['archimate4/archimate4-viewpoints.ttl', AM4VP],
  ['archimate4/archimate4-questions.ttl', 'https://meta.linked.archi/archimate4/questions#'],
];

const MODEL = `@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:   <http://www.w3.org/2002/07/owl#> .
@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .
@prefix arch:  <https://meta.linked.archi/core#> .
@prefix am4:   <https://meta.linked.archi/archimate4/onto#> .
@prefix am4vp: <https://meta.linked.archi/archimate4/viewpoints#> .
@prefix :      <https://meta.linked.archi/examples/archimate4-questions/> .


:model a arch:Model ; skos:prefLabel "Claims handling"@en .

:CloudServer a owl:Class ; rdfs:subClassOf am4:Node ; skos:prefLabel "Cloud Server"@en .


:orgView a arch:Diagram ; arch:inModel :model ; skos:prefLabel "Organisation"@en ;
    arch:viewConformsToViewpoint am4vp:OrganizationViewpoint .
:techView a arch:Diagram ; arch:inModel :model ; skos:prefLabel "Hosting"@en ;
    arch:viewConformsToViewpoint am4vp:TechnologyViewpoint .
:legacyView a arch:Diagram ; arch:inModel :model ; skos:prefLabel "Legacy"@en ;
    arch:viewConformsToViewpoint am4vp:LegacyOrganizationViewpoint .


:customer a am4:BusinessActor ; arch:inModel :model ; skos:prefLabel "Customer"@en ; arch:inView :orgView .
:clerk a am4:Role ; arch:inModel :model ; skos:prefLabel "Claims Clerk"@en ; arch:inView :orgView .
:server a am4:Node ; arch:inModel :model ; skos:prefLabel "Application Server"@en ; arch:inView :orgView .
:cloudServer a :CloudServer ; arch:inModel :model ; skos:prefLabel "Cloud Server 1"@en ; arch:inView :techView .
:handleClaim a am4:Process ; arch:inModel :model ; skos:prefLabel "Handle Claim"@en ; skos:definition "Settle a claim."@en .
:registerClaim a am4:Process ; arch:inModel :model ; skos:prefLabel "Register Claim"@en .
:claimService a am4:Service ; arch:inModel :model ; skos:prefLabel "Claim Service"@en .
:orphanService a am4:Service ; arch:inModel :model ; skos:prefLabel "Orphan Service"@en .
:crm a am4:ApplicationComponent ; arch:inModel :model ; skos:prefLabel "CRM"@en .
:crmDup a am4:ApplicationComponent ; arch:inModel :model ; skos:prefLabel "crm"@en .
:policyApp a am4:ApplicationComponent ; arch:inModel :model ; skos:prefLabel "Policy Administration"@en .
:newApp a am4:ApplicationComponent ; arch:inModel :model ; skos:prefLabel "Claims Portal"@en ;
    arch:architectureState arch:Target ; arch:approvalState arch:Proposed .
:brokerPortal a am4:ApplicationComponent ; arch:inModel :model ; skos:prefLabel "Broker Portal"@en .
:customerData a am4:DataObject ; arch:inModel :model ; skos:prefLabel "Customer Data"@en .
:ceo a am4:Stakeholder ; arch:inModel :model ; skos:prefLabel "CEO"@en .
:goal a am4:Goal ; arch:inModel :model ; skos:prefLabel "Faster claims"@en .
:req a am4:Requirement ; arch:inModel :model ; skos:prefLabel "Claims settled within 24h"@en .
:req2 a am4:Requirement ; arch:inModel :model ; skos:prefLabel "Unrealised requirement"@en .
:principle a am4:Principle ; arch:inModel :model ; skos:prefLabel "Digital first"@en .
:principle2 a am4:Principle ; arch:inModel :model ; skos:prefLabel "Unbacked principle"@en .
:capability a am4:Capability ; arch:inModel :model ; skos:prefLabel "Claims Management"@en .
:capability2 a am4:Capability ; arch:inModel :model ; skos:prefLabel "Fraud Detection"@en .
:wp a am4:WorkPackage ; arch:inModel :model ; skos:prefLabel "CRM upgrade"@en .
:deliv a am4:Deliverable ; arch:inModel :model ; skos:prefLabel "Upgraded CRM"@en .
:plateauA a am4:Plateau ; arch:inModel :model ; skos:prefLabel "Baseline"@en .
:plateauB a am4:Plateau ; arch:inModel :model ; skos:prefLabel "Target"@en .
:bankActor a am4:BusinessActor ; arch:inModel :model ; skos:prefLabel "Bank"@en ; arch:inView :legacyView .
:bankRole a am4:Role ; arch:inModel :model ; skos:prefLabel "Bank"@en .


:r1 a am4:Assignment ; arch:inModel :model ; arch:source :clerk ; arch:target :handleClaim ;
    rdf:reifies <<( :clerk am4:assignedTo :handleClaim )>> .
:clerk am4:assignedTo :handleClaim .
:r2 a am4:Assignment ; arch:inModel :model ; arch:source :customer ; arch:target :clerk ;
    rdf:reifies <<( :customer am4:assignedTo :clerk )>> .
:customer am4:assignedTo :clerk .
:r3 a am4:Realization ; arch:inModel :model ; arch:source :handleClaim ; arch:target :claimService ;
    rdf:reifies <<( :handleClaim am4:realizes :claimService )>> .
:handleClaim am4:realizes :claimService .
:r4 a am4:Serving ; arch:inModel :model ; arch:source :claimService ; arch:target :customer ;
    rdf:reifies <<( :claimService am4:serves :customer )>> .
:claimService am4:serves :customer .
:r5 a am4:Serving ; arch:inModel :model ; arch:source :server ; arch:target :crm .
:server am4:serves :crm .
:r6 a am4:Serving ; arch:inModel :model ; arch:source :crm ; arch:target :policyApp ;
    rdf:reifies <<( :crm am4:serves :policyApp )>> .
:crm am4:serves :policyApp .
:r7 a am4:ReadAccess ; arch:inModel :model ; arch:source :crm ; arch:target :customerData ;
    rdf:reifies <<( :crm am4:accesses :customerData )>> .
:crm am4:accesses :customerData .
:r8 a am4:Realization ; arch:inModel :model ; arch:source :handleClaim ; arch:target :req ;
    rdf:reifies <<( :handleClaim am4:realizes :req )>> .
:handleClaim am4:realizes :req .
:r9 a am4:Realization ; arch:inModel :model ; arch:source :req ; arch:target :goal ;
    rdf:reifies <<( :req am4:realizes :goal )>> .
:req am4:realizes :goal .
:r10 a am4:Realization ; arch:inModel :model ; arch:source :req ; arch:target :principle ;
    rdf:reifies <<( :req am4:realizes :principle )>> .
:req am4:realizes :principle .
:r11 a am4:Influence ; arch:inModel :model ; arch:source :ceo ; arch:target :goal ;
    rdf:reifies <<( :ceo am4:influences :goal )>> .
:ceo am4:influences :goal .
:r12 a am4:Realization ; arch:inModel :model ; arch:source :handleClaim ; arch:target :capability ;
    rdf:reifies <<( :handleClaim am4:realizes :capability )>> .
:handleClaim am4:realizes :capability .
:r13 a am4:Realization ; arch:inModel :model ; arch:source :wp ; arch:target :deliv ;
    rdf:reifies <<( :wp am4:realizes :deliv )>> .
:wp am4:realizes :deliv .
:r14 a am4:Realization ; arch:inModel :model ; arch:source :deliv ; arch:target :crm ;
    rdf:reifies <<( :deliv am4:realizes :crm )>> .
:deliv am4:realizes :crm .
:r15 a am4:Aggregation ; arch:inModel :model ; arch:source :plateauA ; arch:target :crm ;
    rdf:reifies <<( :plateauA am4:aggregates :crm )>> .
:plateauA am4:aggregates :crm .
:r16 a am4:Aggregation ; arch:inModel :model ; arch:source :plateauA ; arch:target :policyApp ;
    rdf:reifies <<( :plateauA am4:aggregates :policyApp )>> .
:plateauA am4:aggregates :policyApp .
:r17 a am4:Aggregation ; arch:inModel :model ; arch:source :plateauB ; arch:target :crm ;
    rdf:reifies <<( :plateauB am4:aggregates :crm )>> .
:plateauB am4:aggregates :crm .
:r18 a am4:Aggregation ; arch:inModel :model ; arch:source :plateauB ; arch:target :newApp ;
    rdf:reifies <<( :plateauB am4:aggregates :newApp )>> .
:plateauB am4:aggregates :newApp .
:r19 a am4:Serving ; arch:inModel :model ; arch:source :cloudServer ; arch:target :brokerPortal ;
    rdf:reifies <<( :cloudServer am4:serves :brokerPortal )>> .
:cloudServer am4:serves :brokerPortal .
:r20 a am4:Assignment ; arch:inModel :model ; arch:source :bankActor ; arch:target :bankRole ;
    rdf:reifies <<( :bankActor am4:assignedTo :bankRole )>> .
:bankActor am4:assignedTo :bankRole .
`;

/** What the workbench binds: the selection, the open view and its viewpoint, the open model … */
const BINDINGS: QuestionBindings = {
  focus: EX + 'server',
  view: EX + 'orgView',
  model: EX + 'model',
  viewpoint: AM4VP + 'OrganizationViewpoint',
  conceptType: AM4 + 'ApplicationComponent',
  from: EX + 'plateauA',
  to: EX + 'plateauB',
};

function store(): OxigraphRdfStore {
  const s = new OxigraphRdfStore();
  for (const [path, graph] of DOCUMENTS) s.load(asset(path), { format: 'text/turtle', graph });
  s.load(MODEL, { format: 'text/turtle' });
  return s;
}

/** Add, beside each concept's own type, every core and abstract class it is an instance of. */
function addInferableTypes(s: OxigraphRdfStore): number {
  const rows = (q: string) => (s.query(q) as { results: Array<Record<string, { value: string }>> }).results;
  const supers = new Map<string, string[]>();
  for (const r of rows(`SELECT ?c ?d WHERE { { ?c <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?d } UNION { GRAPH ?g { ?c <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?d } } }`)) {
    supers.set(r.c!.value, [...(supers.get(r.c!.value) ?? []), r.d!.value]);
  }
  const abstract = new Set(rows(`SELECT ?c WHERE { { ?c <${ARCH}isAbstractClass> true } UNION { GRAPH ?g { ?c <${ARCH}isAbstractClass> true } } }`).map((r) => r.c!.value));
  const core = new Set([ARCH + 'ModelConcept', ARCH + 'Element', ARCH + 'QualifiedRelationship', ARCH + 'View']);
  const added: Quad[] = [];
  for (const r of rows(`SELECT ?s ?c WHERE { ?s <${ARCH}inModel> ?m ; a ?c }`)) {
    const seen = new Set([r.c!.value]);
    const queue = [r.c!.value];
    while (queue.length > 0) {
      for (const d of supers.get(queue.pop()!) ?? []) {
        if (seen.has(d)) continue;
        seen.add(d);
        queue.push(d);
        if (core.has(d) || abstract.has(d)) {
          added.push(DataFactory.quad(DataFactory.namedNode(r.s!.value), DataFactory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), DataFactory.namedNode(d)) as unknown as Quad);
        }
      }
    }
  }
  s.addQuads(added);
  return added.length;
}

/** Rows as sorted "name=value" lines, a GROUP_CONCAT's parts in order. */
function answer(s: OxigraphRdfStore, q: ModelQuestion, bindings: QuestionBindings): string[] {
  const result = s.query(buildQuery(q, bindings, { limit: null })) as { type: string; results: Array<Record<string, { value: string } | undefined>> };
  return [...new Set(result.results.map((row) =>
    Object.entries(row).filter(([, v]) => v).map(([k, v]) => `${k}=${v!.value.split('; ').sort().join('; ')}`).sort().join('\t'),
  ))].sort();
}

const ids = (rows: string[], column: string) =>
  new Set(rows.flatMap((r) => r.split('\t')).filter((c) => c.startsWith(column + '=' + EX)).map((c) => c.slice(column.length + 1 + EX.length)));

let plain: OxigraphRdfStore;
let questions: ModelQuestion[];

beforeAll(() => {
  plain = store();
  questions = listQuestions(plain);
});

const question = (iri: string) => {
  const q = questions.find((x) => x.iri === iri);
  if (!q) throw new Error(`No question ${iri}`);
  return q;
};
const ask = (iri: string, bindings: QuestionBindings = {}) => answer(plain, question(iri), { ...BINDINGS, ...bindings });

describe('the bundled question sets', () => {
  it('list every question — the question as its label, a stage, the prefixes, its SELECT without PREFIX or LIMIT', () => {
    expect(questions.length).toBe(36);
    expect(questions.filter((q) => q.iri.startsWith('https://meta.linked.archi/core-questions#'))).toHaveLength(16);
    for (const q of questions) {
      expect(q.label, q.iri).toMatch(/\?$/);
      expect(stageOf(q), q.iri).toBeDefined();
      expect(Object.keys(q.prefixes), q.iri).toContain('arch');
      expect(q.text, q.iri).toMatch(/^SELECT/);
      expect(q.text, q.iri).not.toMatch(/\bPREFIX\b|\bLIMIT\b/i);
      if (q.isFinding) expect([q.severity, q.findingFocus], q.iri).not.toContain(undefined);
    }
    // In stage order: orientation first, views last.
    expect(stageOf(questions[0]!)).toBe('orientation');
    expect(stageOf(questions.at(-1)!)).toBe('views');
  });

  it('build and run every question, with all its parameters and with its required ones only', () => {
    for (const q of questions) {
      const required: QuestionBindings = {};
      for (const p of q.parameters) if (!p.optional) required[p.name] = BINDINGS[p.name];
      expect(() => plain.query(buildQuery(q, BINDINGS)), q.iri).not.toThrow();
      expect(() => plain.query(buildQuery(q, required)), q.iri).not.toThrow();
    }
  });

  it('are not asked without a required parameter, and say which', () => {
    const impact = question(am4q('impact-of-change'));
    expect(missingParameters(impact, {})).toEqual(['focus']);
    expect(() => buildQuery(impact, {})).toThrow(MissingParameterError);
    expect(missingParameters(question(am4q('plateau-difference')), { from: EX + 'plateauA' })).toEqual(['to']);
  });

  it('are offered when what they read is loaded, those fitting the open view first', () => {
    const coreOnly = offeredQuestions(questions, new Set());
    expect(coreOnly.every((q) => q.iri.startsWith('https://meta.linked.archi/core-questions#'))).toBe(true);
    const offered = offeredQuestions(questions, new Set([AM4]), AM4VP + 'CapabilityMapViewpoint');
    expect(offered).toHaveLength(36);
    expect(offered[0]!.viewpoints).toContain(AM4VP + 'CapabilityMapViewpoint');
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

describe('the findings, on meta’s example model', () => {
  it('core: each finding’s culprits, and none of its near misses', () => {
    expect(ids(ask(archq('orphans')), 'element')).toEqual(new Set(['registerClaim', 'orphanService', 'crmDup', 'req2', 'principle2', 'capability2']));
    // "Bank" the actor and "Bank" the role share a name across types: not duplicates.
    expect(ids(ask(archq('duplicate-labels')), 'element')).toEqual(new Set(['crm', 'crmDup']));
    expect(ids(ask(archq('relationship-integrity')), 'relationship')).toEqual(new Set(['r5']));
    // A node on the organisation view is out of place; a specialised node on the technology view is admitted.
    expect(ids(ask(archq('viewpoint-conformance')), 'element')).toEqual(new Set(['server']));
    expect(ids(ask(archq('viewpoint-conformance'), { view: EX + 'techView' }), 'element')).toEqual(new Set());
    expect(ids(ask(archq('views-with-unknown-viewpoint')), 'view')).toEqual(new Set(['legacyView']));
  });

  it('ArchiMate 4.0: each finding’s culprits, and none of its near misses', () => {
    expect(ids(ask(am4q('unassigned-behaviour')), 'behaviour')).toEqual(new Set(['registerClaim']));
    expect(ids(ask(am4q('unrealised-services')), 'service')).toEqual(new Set(['orphanService']));
    // The broker portal runs on the specialised node: technology under it.
    expect(ids(ask(am4q('applications-without-technology')), 'application')).toEqual(new Set(['policyApp', 'newApp', 'crmDup']));
    expect(ids(ask(am4q('data-never-written')), 'object')).toEqual(new Set(['customerData']));
    expect(ids(ask(am4q('unrealised-capabilities')), 'capability')).toEqual(new Set(['capability2']));
    expect(ids(ask(am4q('unrealised-requirements')), 'requirement')).toEqual(new Set(['req2']));
    expect(ids(ask(am4q('principles-without-requirements')), 'principle')).toEqual(new Set(['principle2']));
  });

  it('views: what belongs in a view of a viewpoint, the common domain through a related element', () => {
    expect(ids(ask(am4q('viewpoint-scope')), 'element')).toEqual(new Set(['customer', 'clerk', 'bankActor', 'bankRole']));
    expect(ids(ask(am4q('viewpoint-scope'), { viewpoint: AM4VP + 'TechnologyViewpoint' }), 'element')).toEqual(new Set(['server', 'cloudServer']));
    expect(ids(ask(am4q('impact-of-change')), 'impacted')).toEqual(new Set(['crm', 'policyApp']));
  });

  it('every answer is the same with the inferable core and abstract types added', () => {
    const inferred = store();
    expect(addInferableTypes(inferred)).toBeGreaterThan(100);
    for (const q of listQuestions(inferred)) {
      const required: QuestionBindings = {};
      for (const p of q.parameters) if (!p.optional) required[p.name] = BINDINGS[p.name];
      for (const bindings of [BINDINGS, required]) {
        expect(answer(inferred, q, bindings), q.iri).toEqual(answer(plain, question(q.iri), bindings));
      }
    }
    inferred.dispose();
  });
});

describe('in the workbench', () => {
  it('say what to select before a question can be asked', () => {
    expect(whatToSelect(question(am4q('impact-of-change')), {})).toBe('Select an element');
    expect(whatToSelect(question(am4q('plateau-difference')), { from: EX + 'plateauA' })).toBe('Select two elements');
    expect(whatToSelect(question(archq('view-contents')), {})).toBe('Open a view');
    expect(whatToSelect(question(archq('orphans')), {})).toBeUndefined();
  });

  it('a view of an answer follows the one viewpoint the question fits, or the viewpoint it was asked about', () => {
    const fitsOne = questions.find((q) => q.viewpoints.length === 1)!;
    expect(viewpointOfAnswer(fitsOne)).toBe(fitsOne.viewpoints[0]);
    const fitsTwo = questions.find((q) => q.viewpoints.length === 2)!;
    expect(viewpointOfAnswer(fitsTwo, BINDINGS)).toBeUndefined();
    const scope = question(am4q('viewpoint-scope'));
    expect(viewpointOfAnswer(scope, { viewpoint: AM4VP + 'TechnologyViewpoint' })).toBe(AM4VP + 'TechnologyViewpoint');
    expect(viewpointOfAnswer(scope, {})).toBeUndefined();
    expect(viewpointOfAnswer(question(archq('orphans')), BINDINGS)).toBeUndefined();
  });

  it('model checks: each finding question’s rows as validation results, once per concept', () => {
    const findings = questions.filter((q) => q.isFinding);
    const run = runModelChecks(plain, questions, { model: EX + 'model' });
    expect(run.ran).toEqual(findings);
    expect(run.failed).toEqual([]);
    expect(run.capped).toEqual([]);
    const of = (iri: string) => run.results.filter((r) => r.sourceShape.value === iri);
    const orphans = of(archq('orphans'));
    expect(new Set(orphans.map((r) => r.focusNode.value.slice(EX.length)))).toEqual(
      new Set(['registerClaim', 'orphanService', 'crmDup', 'req2', 'principle2', 'capability2']),
    );
    expect(orphans[0]).toMatchObject({ severity: 'Info', message: question(archq('orphans')).label });
    expect(orphans[0]!.resultPath.value).toBe('');
    expect(of(archq('relationship-integrity')).map((r) => [r.focusNode.value, r.severity])).toEqual([[EX + 'r5', 'Violation']]);
    expect(of(am4q('unrealised-services')).map((r) => [r.focusNode.value, r.severity])).toEqual([[EX + 'orphanService', 'Warning']]);
    // No concept twice for one question.
    for (const q of findings) {
      const focus = of(q.iri).map((r) => r.focusNode.value);
      expect(new Set(focus).size, q.iri).toBe(focus.length);
    }
  });

  it('model checks: one that cannot run is reported, one that stops at its limit is said to', () => {
    const orphans = question(archq('orphans'));
    const needsFocus = { ...question(archq('orphans')), iri: 'urn:q:needs-focus', parameters: [{ name: 'focus', optional: false, order: 1 }] };
    const broken = { ...orphans, iri: 'urn:q:broken', text: 'SELECT ?element WHERE { ?element ' };
    const limited = { ...orphans, iri: 'urn:q:limited', defaultLimit: 2 };
    const run = runModelChecks(plain, [needsFocus, broken, limited], {});
    expect(run.failed.map((f) => [f.question.iri, f.reason.length > 0])).toEqual([
      ['urn:q:needs-focus', true],
      ['urn:q:broken', true],
    ]);
    expect(run.failed[0]!.reason).toBe('Select an element');
    expect(run.ran.map((q) => q.iri)).toEqual(['urn:q:limited']);
    expect(run.capped.map((q) => q.iri)).toEqual(['urn:q:limited']);
    expect(run.results).toHaveLength(2);
  });
});

describe('the workbench loads them', () => {
  it('the core set with the core, ArchiMate 4.0’s through its manifest’s arch:hasQuestionSet', async () => {
    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
    const am4 = app.loadedMetamodels().find((m) => m.metamodelIri.includes('archimate4'))!;
    expect(am4.graphsByRole.questions).toEqual(['https://meta.linked.archi/archimate4/questions#']);
    const loaded = listQuestions(app.components.store);
    expect(loaded).toHaveLength(36);
    // Never model data: nothing of them in the default graph.
    expect(app.components.store.query(`ASK { ?q a <${ARCH}ModelQuestion> }`)).toEqual({ type: 'boolean', value: false });
  }, 120_000);
});
