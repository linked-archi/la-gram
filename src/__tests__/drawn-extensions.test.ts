/**
 * The two governance extensions, drawn and opened (linked-archi-meta's `processes-as-elements` G2–G4 and
 * `decision-modelling-layer` L1, L6): a link drawn writes its triple and its relationship resource and the
 * shapes pass; a file that states its links as bare triples — either way round, where the vocabulary declares
 * the inverse — opens with each link a relationship.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { createApp, type App } from '../app.js';
import { ValidationEngine } from '../rdf-engine/validation-engine.js';
import { encodeQuads } from '../rdf-engine/term-codec.js';

const { namedNode, defaultGraph } = DataFactory;
const AP = 'https://meta.linked.archi/arch-processes#';
const AD = 'https://meta.linked.archi/arch-decision#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM3 = 'https://meta.linked.archi/archimate3/onto#';
const ARCH = 'https://meta.linked.archi/core#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const PROCESSES = 'https://meta.linked.archi/arch-processes/metamodel#ArchitectureProcesses';
const DECISIONS = 'https://meta.linked.archi/arch-decision/metamodel#ArchitectureDecisions';
const ARCHIMATE3 = 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2';

/** The violations the loaded shapes find about any of `focus`, as "local name: message". */
function violationsAbout(app: App, focus: readonly string[]): string[] {
  const engine = new ValidationEngine();
  engine.setup((app as unknown as { validationSetup(s: Quad[]): never }).validationSetup(app.shapesGraph()));
  engine.load(encodeQuads(app.components.store.getQuads(null, null, null, defaultGraph() as never)));
  const wanted = new Set(focus);
  return engine
    .validate()
    .results.filter((r) => String(r.severity).endsWith('Violation'))
    .map((r) => ({ node: typeof r.focusNode === 'string' ? r.focusNode : r.focusNode.value, message: r.message }))
    .filter((r) => wanted.has(r.node))
    .map((r) => `${r.node.split(/[#/]/).pop()}: ${r.message}`);
}

/** The relationships of the model whose source is `source`, as "class local name → target". */
function linksFrom(app: App, source: string): string[] {
  const store = app.components.store;
  return store
    .getQuads(null, namedNode(ARCH + 'source') as never, namedNode(source) as never, defaultGraph() as never)
    .map((q) => {
      const rel = q.subject.value;
      const cls = store.getQuads(namedNode(rel) as never, namedNode(RDF_TYPE) as never, null, defaultGraph() as never)[0]!.object.value;
      const target = store.getQuads(namedNode(rel) as never, namedNode(ARCH + 'target') as never, null, defaultGraph() as never)[0]!.object.value;
      return `${cls.split('#').pop()} → ${target.split(/[#/]/).pop()}`;
    })
    .sort();
}

const holds = (app: App, s: string, p: string, o: string): boolean =>
  app.components.store.getQuads(namedNode(s) as never, namedNode(p) as never, namedNode(o) as never, defaultGraph() as never).length > 0;

describe('a governance process, drawn', () => {
  let app: App;

  beforeAll(async () => {
    app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
    await app.loadMetamodel(PROCESSES);
  }, 120_000);

  it('beside the architecture it governs: each link writes its ap: triple and a relationship, and the shapes pass', () => {
    const { modelIri } = app.newModel('Review board');
    const { elementManager: e, relationshipManager: r } = app.components;
    const make = (type: string, label: string) => e.createElement(type, modelIri, { label }).value;
    const process = make(AP + 'ArchitectureProcess', 'Architecture review');
    const submit = make(AP + 'ProcessActivity', 'Submit');
    const review = make(AP + 'ProcessActivity', 'Review');
    const triage = make(AP + 'ProcessTask', 'Triage');
    const chief = make(AP + 'ProcessRole', 'Chief Architect');
    const gateway = make(AM4 + 'ApplicationComponent', 'Payments Gateway');

    const draw = (cls: string, source: string, target: string) =>
      r.createQualifiedRelationship({ typeIri: AP + cls, sourceIri: source, targetIri: target, modelIri });
    const drawn = [
      draw('HasActivity', process, submit),
      draw('HasActivity', process, review),
      draw('HasTask', review, triage),
      draw('Precedes', submit, review),
      draw('PerformedBy', review, chief),
      draw('Governs', process, gateway),
    ];
    for (const link of drawn) {
      expect(link.predicateIri, link.classIri).toBeDefined();
      expect(holds(app, link.sourceIri, link.predicateIri!, link.targetIri), link.classIri).toBe(true);
    }
    expect(drawn.map((l) => l.predicateIri!.replace(AP, 'ap:'))).toEqual([
      'ap:hasActivity', 'ap:hasActivity', 'ap:hasTask', 'ap:precedes', 'ap:performedBy', 'ap:governs',
    ]);
    expect(linksFrom(app, process)).toEqual(['Governs → ' + gateway.split(/[#/]/).pop(), `HasActivity → ${review.split(/[#/]/).pop()}`, `HasActivity → ${submit.split(/[#/]/).pop()}`].sort());

    expect(violationsAbout(app, [process, submit, review, triage, chief, gateway, ...drawn.map((l) => l.iri)])).toEqual([]);
    // Not vacuous: a component with no name, which ArchiMate's element shapes require, is found.
    const unnamed = e.createElement(AM4 + 'ApplicationComponent', modelIri).value;
    expect(violationsAbout(app, [unnamed])).not.toEqual([]);
  });

  it('opened from a file of bare triples, stated either way round: each link a relationship', async () => {
    const { qualified } = await app.openModel(
      `@prefix ap:   <${AP}> .
@prefix arch: <${ARCH}> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix :     <https://model.example.com/governance#> .

:model a arch:Model ; skos:prefLabel "Governance"@en ; arch:modelConformsToMetamodel <${PROCESSES}> .
:Chief a ap:ProcessRole ; skos:prefLabel "Chief Architect"@en ;
    ap:responsibleFor :Review .
:Findings a ap:ProcessDeliverable ; skos:prefLabel "Review findings"@en ;
    ap:producedBy :Review .
:Review a ap:ArchitectureProcess ; skos:prefLabel "Architecture review"@en ;
    ap:hasActivity :Submit .
:Submit a ap:ProcessActivity ; skos:prefLabel "Submit"@en ;
    ap:activityOfProcess :Review ;
    ap:hasTask :Prepare ;
    ap:precedes :Triage .
:Triage a ap:ProcessActivity ; skos:prefLabel "Triage"@en ;
    ap:activityOfProcess :Review ;
    ap:follows :Submit ;
    ap:performedBy :Chief .
:Prepare a ap:ProcessTask ; skos:prefLabel "Prepare the proposal"@en ;
    ap:taskOfActivity :Submit .
:Record a ap:ProcessTask ; skos:prefLabel "Record findings"@en ;
    ap:taskOfActivity :Triage .
`,
      'governance.ttl',
    );
    const g = 'https://model.example.com/governance#';
    // Has Activity twice (one only as activityOfProcess), Has Task twice (one only as taskOfActivity),
    // Precedes once (stated both ways), Performed By once, Responsible For once, and an Output stated only
    // as ap:producedBy, its declared inverse.
    expect(qualified).toBe(8);
    expect(linksFrom(app, g + 'Review')).toEqual(['HasActivity → Submit', 'HasActivity → Triage', 'Output → Findings']);
    expect(linksFrom(app, g + 'Chief')).toEqual(['ResponsibleFor → Review']);
    expect(linksFrom(app, g + 'Submit')).toEqual(['HasTask → Prepare', 'Precedes → Triage']);
    expect(linksFrom(app, g + 'Triage')).toEqual(['HasTask → Record', 'PerformedBy → Chief']);
    // Read the other way, the link states its drawn direction too.
    expect(holds(app, g + 'Triage', AP + 'hasTask', g + 'Record')).toBe(true);
    expect(holds(app, g + 'Record', AP + 'taskOfActivity', g + 'Triage')).toBe(true);
  });
});

describe('a decision, opened and drawn', () => {
  let app: App;

  beforeAll(async () => {
    app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
    await app.loadMetamodel(ARCHIMATE3);
    await app.loadMetamodel(DECISIONS);
  }, 120_000);

  it('the links a file states as bare triples are relationships; one drawn writes its ad: triple and passes', async () => {
    const d = 'https://model.example.com/decisions#';
    await app.openModel(
      `@prefix ad:   <${AD}> .
@prefix am:   <${AM3}> .
@prefix arch: <${ARCH}> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix :     <${d}> .

:model a arch:Model ; skos:prefLabel "Decisions"@en ;
    arch:modelConformsToMetamodel <${ARCHIMATE3}>, <${DECISIONS}> .
:Gateway a am:ApplicationComponent ; skos:prefLabel "Payments Gateway"@en .
:Ledger a am:ApplicationComponent ; skos:prefLabel "Ledger"@en .
:Issue a ad:Issue ; skos:prefLabel "How to route payments"@en .
:UseGateway a ad:Option ; skos:prefLabel "Route through the gateway"@en ;
    ad:addsConcept :Gateway .
:Direct a ad:Option ; skos:prefLabel "Call the ledger directly"@en .
:Route a ad:Decision ; skos:prefLabel "Payment routing"@en ;
    ad:hasIssue :Issue ;
    ad:hasSelectedOption :UseGateway ;
    ad:hasAlternative :Direct .
`,
      'decisions.ttl',
    );
    expect(linksFrom(app, d + 'Route')).toEqual(['HasAlternative → Direct', 'HasIssue → Issue', 'HasSelectedOption → UseGateway']);
    expect(linksFrom(app, d + 'UseGateway')).toEqual(['AddsConcept → Gateway']);

    const modifies = app.components.relationshipManager.createQualifiedRelationship({
      typeIri: AD + 'ModifiesConcept',
      sourceIri: d + 'UseGateway',
      targetIri: d + 'Ledger',
      modelIri: app.session.modelIri,
    });
    expect(modifies.predicateIri).toBe(AD + 'modifiesConcept');
    expect(holds(app, d + 'UseGateway', AD + 'modifiesConcept', d + 'Ledger')).toBe(true);
    const relationships = app.components.store
      .getQuads(null, namedNode(ARCH + 'source') as never, null, defaultGraph() as never)
      .map((q) => q.subject.value);
    expect(violationsAbout(app, [modifies.iri, ...relationships])).toEqual([]);
  });

  it('with no notation of their own, decisions draw as the canvas\u2019s default figure and their links with an arrowhead', () => {
    const palette = app.components.paletteGenerator.generatePalette(undefined, {
      metamodelIris: app.loadedMetamodels().map((m) => m.metamodelIri),
    });
    const decision = palette.elementGroups.flatMap((g) => g.elements).find((e) => e.iri === AD + 'Decision');
    expect(decision).toBeDefined();
    // No descriptor in any loaded set: the renderer's default figure (and the palette draws the same).
    expect(decision!.style?.shapeType ?? 'Rectangle').toBe('Rectangle');
    const modifies = palette.relationshipTypes.find((r) => r.iri === AD + 'ModifiesConcept');
    expect(modifies?.relationshipStyle).toEqual({ lineStyle: 'SolidLine', targetDecor: 'OpenArrowhead' });
  });
});
