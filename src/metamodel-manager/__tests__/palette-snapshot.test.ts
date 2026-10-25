/**
 * The palette read over the application's store — the metamodel graphs, and
 * the model's copy as it is (Task 22) — is the palette read over a copy of
 * everything, a class the model defines and a metamodel graph written to
 * included.
 */
import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { createApp } from '../../app.js';
import { SparqlPaletteGenerator } from '../palette-generator.js';
import type { ObservableRdfStore } from '../../rdf-engine/observable-store.js';

const { namedNode, literal, quad } = DataFactory;
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';

describe('the palette over the application store', () => {
  it('is the palette over a copy of everything, after the model and a metamodel graph are written to', async () => {
    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
    const store = app.components.store as unknown as ObservableRdfStore;
    const metamodel = app.loadedMetamodel!.metamodelIri;
    const kept = new SparqlPaletteGenerator(store);
    const copied = () => {
      store.giveAll();
      return new SparqlPaletteGenerator(store.inner).generatePalette(metamodel);
    };
    const names = (p: ReturnType<typeof kept.generatePalette>) => p.elementGroups.flatMap((g) => g.elements.map((e) => e.iri)).sort();
    // The same palette, whatever order the store gave the quads in: lists of
    // names and an object's keys are compared sorted.
    const normal = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        const items = value.map(normal);
        return items.every((x) => typeof x === 'string') ? [...(items as string[])].sort() : items;
      }
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, normal((value as Record<string, unknown>)[k])]));
      }
      return value;
    };
    const same = () => expect(normal(kept.generatePalette(metamodel))).toEqual(normal(copied()));

    same();

    const special = (iri: string, label: string) => [
      quad(namedNode(iri), namedNode(RDF + 'type'), namedNode(OWL + 'Class')),
      quad(namedNode(iri), namedNode(RDFS + 'subClassOf'), namedNode(AM4 + 'BusinessActor')),
      quad(namedNode(iri), namedNode(SKOS + 'prefLabel'), literal(label, 'en')),
    ];
    store.addQuads(special('https://example.org/model/Clerk', 'Clerk') as unknown as Quad[]);
    same();

    const graph = namedNode('https://example.org/extra-metamodel');
    store.addQuads(special('https://example.org/meta/Officer', 'Officer').map((q) => quad(q.subject, q.predicate, q.object, graph)) as unknown as Quad[]);
    same();
    expect(names(kept.generatePalette(metamodel))).toEqual(names(copied()));
  }, 120_000);
});
