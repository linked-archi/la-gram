/**
 * Models made by the Linked.Archi converters open as models.
 *
 * The fixture is archimate2linkedarchi's output for its payment-platform
 * example (TriG: a model, a semantic, a views and a provenance graph). Besides
 * the model, a converter records the conversion itself — the run, the agent,
 * the source file and the named graphs, typed with PROV-O and schema.org.
 * Those describe the model; they are not in it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { modelQuads, readModelContents } from '../model-manager/model-queries.js';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'converters', name), 'utf8');

describe('a model from the ArchiMate converter', () => {
  it('opens offline with its metamodel, its elements, relationships and view — and not its provenance', async () => {
    const app = await createApp();
    const opened = await app.openModel(fixture('archimate-payment-platform.trig'), 'payment-platform.trig');

    expect(opened.missingMetamodels).toEqual([]);
    expect(app.loadedMetamodels().map((m) => m.metamodelIri)).toContain(
      'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2',
    );
    const contents = readModelContents(app.components.store, app.components.viewManager.getViews());
    expect(contents.elements).toHaveLength(11);
    expect(contents.relationships).toHaveLength(10);
    expect(contents.unclassified).toEqual([]);
    expect(app.components.viewManager.getViews()).toHaveLength(1);

    // The conversion's provenance stays out of the model: no membership was added to it.
    const quads = modelQuads(app.components.store);
    const provenance = quads
      .filter((q) => q.predicate.value === NAMESPACES.rdf + 'type' && q.object.value.startsWith(NAMESPACES.prov))
      .map((q) => q.subject.value);
    expect(provenance.length).toBeGreaterThan(0);
    const members = new Set(
      quads.filter((q) => q.predicate.value === NAMESPACES.arch + 'inModel').map((q) => q.subject.value),
    );
    expect(provenance.filter((iri) => members.has(iri))).toEqual([]);
  }, 60_000);
});
