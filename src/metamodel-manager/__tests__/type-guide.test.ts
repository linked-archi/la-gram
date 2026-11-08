import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { paragraphs, readTypeGuide } from '../type-guide.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const TAX = 'https://meta.linked.archi/archimate4/tax#';
const VP = 'https://meta.linked.archi/archimate4/viewpoints#';
const CORE = 'https://meta.linked.archi/core#';

/** The bundled copies of the published files, each in its own graph as the app loads them. */
let store: OxigraphRdfStore;
beforeAll(() => {
  store = new OxigraphRdfStore();
  for (const file of ['core/core-onto.ttl', 'archimate4/archimate4-onto.ttl', 'archimate4/archimate4-tax.ttl', 'archimate4/archimate4-viewpoints.ttl']) {
    const text = readFileSync(new URL(`../../../assets/${file}`, import.meta.url), 'utf8');
    store.load!(text, { format: 'text/turtle', graph: `https://graphs.test/${file}` });
  }
});
afterAll(() => store.dispose());

describe('readTypeGuide on the ArchiMate 4.0 metamodel', () => {
  it('says what a Business Actor is, from the ontology', () => {
    const g = readTypeGuide(store, AM4 + 'BusinessActor')!;
    expect(g.label).toBe('Business Actor');
    expect(g.definition).toBe('A business actor represents a business entity that is capable of performing behavior.');
    expect(g.altLabels.sort()).toEqual(['Department', 'Organization', 'Person']);
    // The guidance, one paragraph each — the hard-wrapped text is not split mid-sentence.
    expect(g.notes).toHaveLength(4);
    expect(g.notes[2]).toMatch(/^The name of a business actor should preferably be a noun\./);
    expect(g.abstract).toBe(false);
    expect(g.sources.every((s) => s.startsWith('https://pubs.opengroup.org/'))).toBe(true);
    // Nearest first; identifiers read as words.
    expect(g.superclasses.slice(0, 2).map((c) => c.label).sort()).toEqual(['Business Domain Element', 'Internal Active Structure Element']);
    expect(g.superclasses.map((c) => c.iri)).toContain(CORE + 'Element');
    expect(g.superclasses.find((c) => c.iri === CORE + 'ModelConcept')!.definition).not.toMatch(/\]\(/); // Markdown links reduced
  });

  it('and where the taxonomy classifies it, with the group and its other members', () => {
    const g = readTypeGuide(store, AM4 + 'BusinessActor')!;
    const byDomain = g.classifications.find((c) => c.axis.iri === TAX + 'ElementByDomain')!;
    expect(byDomain.path.map((p) => p.label)).toEqual(['Business Domain']);
    expect(byDomain.group.definition).toMatch(/^Elements specific to the business domain/);
    expect(byDomain.group.notes.join(' ')).toMatch(/actors \(who performs\)/);
    expect(byDomain.group.changes[0]).toMatch(/^4\.0: BusinessRole, BusinessCollaboration moved/);
    expect(byDomain.members.map((m) => m.label)).toEqual(['Business Interface', 'Business Object', 'Product']);
    // The aspect axis nests: the whole path from under the axis down to the group.
    const byAspect = g.classifications.find((c) => c.axis.iri === TAX + 'ElementByAspect')!;
    expect(byAspect.path.length).toBeGreaterThan(1);
    expect(byAspect.path.at(-1)!.iri).toBe(byAspect.group.iri);
  });

  it('gives a relationship its unqualified form, and a viewpoint what it shows and for whom', () => {
    const serving = readTypeGuide(store, AM4 + 'Serving')!;
    expect(serving.definition).toMatch(/^A serving relationship represents/);
    // Its typical ends are its predicate's — arch:domainIncludes goes on properties only — read through its unqualified form.
    const ends = [
      { iri: AM4 + 'ActiveStructureElement', label: 'Active Structure Element' },
      { iri: AM4 + 'BehaviorElement', label: 'Behavior Element' },
    ];
    expect(serving.facts).toEqual([
      { label: 'Typically from', values: ends },
      { label: 'Typically to', values: ends },
      { label: 'Unqualified form', values: [{ iri: AM4 + 'serves', label: 'Serves' }] },
    ]);

    const organization = readTypeGuide(store, VP + 'OrganizationViewpoint')!;
    expect(organization.label).toBe('Organization Viewpoint');
    expect(organization.definition).toMatch(/^The structure of an organization: its actors, roles and collaborations/);
    expect(organization.facts.map((f) => f.label)).toEqual(['Shows', 'For', 'Concerns', 'Purpose']);
    expect(organization.facts[0]!.values.map((v) => v.label)).toContain('Business Actor');
    expect(organization.facts[2]!.values.map((v) => v.label)).toEqual(['Competencies, authority and responsibilities']);
    // Grouped twice, as the catalogue groups it: by Appendix C's category and by scope.
    expect(organization.classifications.map((c) => c.group.label).sort()).toEqual([
      'Composition',
      'Single domain, single aspect',
    ]);
    const composition = organization.classifications.find((c) => c.group.label === 'Composition')!;
    expect(composition.members.map((m) => m.label)).toContain('Application Structure Viewpoint');
  });

  it('knows nothing of what no metamodel describes', () => {
    expect(readTypeGuide(store, 'https://example.org/nothing')).toBeUndefined();
  });
});

describe('paragraphs', () => {
  it('breaks after sentences, not at hard wraps', () => {
    expect(paragraphs(['Shows the structure in terms of\nroles and actors.\nA second paragraph.'])).toEqual([
      'Shows the structure in terms of roles and actors.',
      'A second paragraph.',
    ]);
    expect(paragraphs(['One.\n\nTwo, then\n\nthree'])).toEqual(['One.', 'Two, then', 'three']);
    expect(paragraphs(['See [Model](#Model) here.'])).toEqual(['See Model here.']);
  });
});
