/**
 * The benchmark's generated model (`scripts/bench-model.mjs`, Task 22) is a model
 * la-gram opens as it writes one — and validation finds in it exactly the
 * faults planted, so that the benchmark's findings mean the same each time.
 */
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import { generateModel, NOT_PERMITTED_EVERY, UNNAMED_EVERY } from '../../scripts/bench-model.mjs';

describe('the benchmark model', () => {
  it('is the same for the same options, about as large as asked', () => {
    const a = generateModel({ triples: 20000, seed: 3 });
    expect(generateModel({ triples: 20000, seed: 3 }).text).toBe(a.text);
    expect(generateModel({ triples: 20000, seed: 4 }).text).not.toBe(a.text);
    expect(a.triples).toBeGreaterThan(18000);
    expect(a.triples).toBeLessThan(22000);
  });

  it('opens with its elements, relationships and views; validation finds the faults planted and no others', async () => {
    const model = generateModel({ elements: 1000 });
    expect(model).toMatchObject({ elements: 1000, relationships: 2000, views: 25 });
    expect(model.faults.unnamed).toHaveLength(Math.floor(1000 / UNNAMED_EVERY));
    expect(model.faults.notPermitted).toHaveLength(Math.floor(2000 / NOT_PERMITTED_EVERY));

    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
    const opened = await app.openModel(model.text, 'bench.ttl');
    expect(opened.missingMetamodels).toEqual([]);
    expect(app.components.viewManager.getViews()).toHaveLength(25);
    const view = app.components.viewManager.getViews().find((v) => v.label === 'View 0');
    expect(app.components.viewManager.getNodes(view!.iri)).toHaveLength(44);
    expect(app.components.viewManager.getLinks(view!.iri).length).toBeGreaterThan(40);

    let results: ValidationResult[] = [];
    app.components.eventBus.on('validation-updated', (e) => (results = (e.detail as { results: ValidationResult[] }).results));
    app.runValidation();
    const violations = results.filter((r) => r.severity === 'Violation').map((r) => r.focusNode.value).sort();
    // The unnamed element; each relationship not permitted, and its direct triple's source.
    const planted = [
      ...model.faults.unnamed,
      ...model.faults.notPermitted.flatMap((f: { relationship: string; source: string }) => [f.relationship, f.source]),
    ];
    expect(violations).toEqual(planted.sort());
    // Every view lacks a viewpoint: a warning.
    expect(results.filter((r) => r.severity === 'Warning')).toHaveLength(25);
  }, 120_000);
});
