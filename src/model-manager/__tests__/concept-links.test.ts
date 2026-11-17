import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataFactory } from 'n3';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { N3TtlParser } from '../../rdf-engine/ttl-parser.js';
import { N3MetamodelLoader } from '../../metamodel-manager/metamodel-loader.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { tripleTerm } from '../vocabulary.js';
import { conceptLinks, modelConceptTest } from '../concept-links.js';

const { namedNode, quad } = DataFactory;
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AP = 'https://meta.linked.archi/arch-processes#';
const ARCH = NAMESPACES.arch;
const RDF_TYPE = NAMESPACES.rdf + 'type';
const n = (iri: string) => namedNode(iri);

let store: OxigraphRdfStore;
beforeAll(async () => {
  store = new OxigraphRdfStore();
  const loader = new N3MetamodelLoader(new N3TtlParser(), store);
  await loader.loadBundledMetamodel('archimate4');
  await loader.loadBundledMetamodel('arch-processes');
  const typed = (iri: string, type: string) => quad(n(iri), n(RDF_TYPE), n(type));
  store.addQuads([
    typed('urn:m:model', ARCH + 'Model'),
    typed('urn:m:view', ARCH + 'View'),
    typed('urn:m:review', AP + 'ArchitectureProcess'),
    typed('urn:m:triage', AP + 'ProcessActivity'),
    typed('urn:m:record', AP + 'ProcessTask'),
    typed('urn:m:chief', AP + 'ProcessRole'),
    typed('urn:m:gateway', AM4 + 'ApplicationComponent'),
    // A relationship, drawn: its triple, its resource, the way in.
    quad(n('urn:m:triage'), n(AP + 'hasTask'), n('urn:m:record')),
    typed('urn:m:has-task', AP + 'HasTask'),
    quad(n('urn:m:has-task'), n(ARCH + 'source'), n('urn:m:triage')),
    quad(n('urn:m:has-task'), n(ARCH + 'target'), n('urn:m:record')),
    quad(n('urn:m:has-task'), n(NAMESPACES.rdf + 'reifies'), tripleTerm(n('urn:m:triage'), n(AP + 'hasTask'), n('urn:m:record')) as never),
    quad(n('urn:m:triage'), n(AP + 'qualifiedHasTask'), n('urn:m:has-task')),
    // ... and its declared inverse, stated beside it.
    quad(n('urn:m:record'), n(AP + 'taskOfActivity'), n('urn:m:triage')),
    // Links no relationship stands for: one way, and both ways round.
    quad(n('urn:m:chief'), n(AP + 'responsibleFor'), n('urn:m:review')),
    quad(n('urn:m:triage'), n(AP + 'activityOfProcess'), n('urn:m:review')),
    quad(n('urn:m:review'), n(AP + 'hasActivity'), n('urn:m:triage')),
    // Not to a concept: a lifecycle stage, an address outside, a view, the model.
    quad(n('urn:m:gateway'), n(AP + 'atLifecycleStage'), n(AP + 'Active')),
    quad(n('urn:m:gateway'), n(NAMESPACES.rdfs + 'seeAlso'), n('https://example.org/runbook')),
    quad(n('urn:m:gateway'), n(NAMESPACES.rdfs + 'seeAlso'), n('urn:m:view')),
    quad(n('urn:m:gateway'), n(ARCH + 'inModel'), n('urn:m:model')),
  ] as never);
}, 60_000);
afterAll(() => store.dispose());

const shown = (iri: string) =>
  conceptLinks(store, iri).map((l) => `${l.direction} ${l.predicateIri.split('#').pop()} ${l.otherIri.split(':').pop()}`).sort();

describe('modelConceptTest', () => {
  it('is an element or a relationship of the model; not a view, the model, or what the model does not type', () => {
    const isConcept = modelConceptTest(store);
    expect(['urn:m:gateway', 'urn:m:chief', 'urn:m:has-task'].map(isConcept)).toEqual([true, true, true]);
    expect(['urn:m:view', 'urn:m:model', AP + 'Active', 'https://example.org/runbook'].map(isConcept)).toEqual([false, false, false, false]);
  });
});

describe('conceptLinks', () => {
  it('lists a link to or from another concept no relationship stands for, by its predicate', () => {
    expect(shown('urn:m:chief')).toEqual(['out responsibleFor review']);
    expect(shown('urn:m:review')).toContain('in responsibleFor chief');
  });

  it('leaves out a relationship’s triple, its declared inverse and the way in to it', () => {
    expect(shown('urn:m:triage')).not.toContain('out hasTask record');
    expect(shown('urn:m:triage')).not.toContain('out qualifiedHasTask has-task');
    expect(shown('urn:m:record')).toEqual([]);
  });

  it('lists a link stated both ways round once, as the selected concept states it', () => {
    expect(shown('urn:m:review')).toEqual(['in responsibleFor chief', 'out hasActivity triage']);
    expect(shown('urn:m:triage')).toEqual(['out activityOfProcess review']);
  });

  it('leaves to the properties a link to anything that is no concept of the model', () => {
    expect(shown('urn:m:gateway')).toEqual([]);
  });
});
