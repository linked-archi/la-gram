import { describe, it, expect, beforeEach } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { modelQuads } from '../model-queries.js';
import {
  MemoryVersionStore,
  VersionHistory,
  diffSnapshots,
  quadsOf,
  snapshotOf,
} from '../version-history.js';

const M = 'https://example.org/m/';
const MODEL = `${M}model`;
const LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const { namedNode, literal, quad, defaultGraph } = DataFactory;

const label = (iri: string, name: string, graph = defaultGraph()) =>
  quad(namedNode(iri), namedNode(LABEL), literal(name, 'en'), graph as never) as unknown as Quad;

describe('snapshots', () => {
  it('are canonical: sorted, each triple once, whatever the order given', () => {
    const a = snapshotOf([label(`${M}b`, 'B'), label(`${M}a`, 'A'), label(`${M}a`, 'A')]);
    const b = snapshotOf([label(`${M}a`, 'A'), label(`${M}b`, 'B')]);
    expect(a).toEqual(b);
    expect(a).toEqual([`<${M}a> <${LABEL}> "A"@en .`, `<${M}b> <${LABEL}> "B"@en .`]);
  });

  it('read back as the quads they were made from', () => {
    const quads = [label(`${M}a`, 'A'), quad(namedNode(`${M}a`), namedNode(`${M}size`), literal('3', namedNode('http://www.w3.org/2001/XMLSchema#integer'))) as unknown as Quad];
    expect(snapshotOf(quadsOf(snapshotOf(quads)))).toEqual(snapshotOf(quads));
  });

  it('differ by the lines added and removed', () => {
    const before = snapshotOf([label(`${M}a`, 'A'), label(`${M}b`, 'B')]);
    const after = snapshotOf([label(`${M}a`, 'A'), label(`${M}b`, 'Bee')]);
    expect(diffSnapshots(before, after)).toEqual({
      added: [`<${M}b> <${LABEL}> "Bee"@en .`],
      removed: [`<${M}b> <${LABEL}> "B"@en .`],
    });
  });
});

describe('VersionHistory', () => {
  let store: OxigraphRdfStore;
  let history: VersionHistory;

  beforeEach(() => {
    store = new OxigraphRdfStore();
    history = new VersionHistory(store, new MemoryVersionStore());
    store.addQuads([label(`${M}a`, 'A')]);
  });

  it('commits the working state, newest first, each after the one before', async () => {
    const first = await history.commit(MODEL, '  First  ', 'Ana');
    store.addQuads([label(`${M}b`, 'B')]);
    const second = await history.commit(MODEL, 'Second');
    const listed = await history.list(MODEL);
    expect(listed.map((c) => c.message)).toEqual(['Second', 'First']);
    expect(second.parent).toBe(first.id);
    expect(first.author).toBe('Ana');
    expect(diffSnapshots(first.triples, second.triples).added).toEqual([`<${M}b> <${LABEL}> "B"@en .`]);
    expect(await history.list(`${M}other`)).toEqual([]);
  });

  it('restores a commit in the model and leaves the metamodel graphs alone', async () => {
    const metamodel = namedNode('https://meta.example.org/onto#');
    store.addQuads([label(`${M}Type`, 'Type', metamodel)]);
    const first = await history.commit(MODEL, 'First');
    store.removeQuads([label(`${M}a`, 'A')]);
    store.addQuads([label(`${M}a`, 'Renamed'), label(`${M}c`, 'C')]);

    history.restorer(first)();

    expect(snapshotOf(modelQuads(store))).toEqual(first.triples);
    expect(store.getQuads(null, null, null, metamodel as never)).toHaveLength(1);
  });
});
