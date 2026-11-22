/**
 * Every bundled model question answers a large model quickly enough to ask it
 * in the workbench, where queries run on the main thread: a generated model of
 * 350 000 triples — in ArchiMate 4.0, and the same in ArchiMate 3.2 — the
 * metamodel in named graphs as the loader keeps it, the Layered viewpoint
 * (which admits nearly every type) for the questions that take one.
 *
 * Measured on la-gram's Oxigraph (2026-10-27): every question under 0.3 s but
 * `am4q:viewpoint-scope`, 0.66 s. The limits leave room for a slower machine
 * and still catch a question that grows with the square of the model — the
 * draft of `viewpoint-scope` took 24 s at 70 000 triples.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OxigraphRdfStore } from '../../rdf-engine/rdf-store.js';
import { buildQuery, listQuestions, type QuestionBindings } from '../questions.js';
// @ts-expect-error — the benchmark generator is a plain script
import { generateModel } from '../../../scripts/bench-model.mjs';

const asset = (path: string) => readFileSync(new URL(`../../../assets/${path}`, import.meta.url), 'utf8');
const ARCH = 'https://meta.linked.archi/core#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const AM4VP = 'https://meta.linked.archi/archimate4/viewpoints#';
const AM3 = 'https://meta.linked.archi/archimate3/onto#';
const AM3VP = 'https://meta.linked.archi/archimate3/viewpoints#';

/** Milliseconds a question may take; `viewpoint-scope` reads every admitted element and what connects to it. */
const LIMIT_MS = 1000;
const LIMITS_MS: Record<string, number> = {
  'https://meta.linked.archi/archimate4/questions#viewpoint-scope': 2000,
};

/**
 * How long a question takes: the fastest of up to three runs, a further one made only while the
 * fastest is over its limit. The full test suite runs its files side by side, and a run that
 * shared the machine with them can be slow for that alone; a question that grows with the square
 * of the model is slow every time.
 */
function timeOf(run: () => void, limit: number): number {
  let fastest = Infinity;
  for (let attempt = 0; attempt < 3 && fastest > limit; attempt += 1) {
    const started = performance.now();
    run();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

describe('model questions on a large model', () => {
  it('each answers 350 000 triples within its limit', () => {
    const store = new OxigraphRdfStore();
    for (const [path, graph] of [
      ['core/core-onto.ttl', ARCH],
      ['core/core-questions.ttl', 'https://meta.linked.archi/core-questions#'],
      ['archimate4/archimate4-onto.ttl', AM4],
      ['archimate4/archimate4-viewpoints.ttl', AM4VP],
      ['archimate4/archimate4-questions.ttl', 'https://meta.linked.archi/archimate4/questions#'],
    ] as const) {
      store.load(asset(path), { format: 'text/turtle', graph });
    }
    store.load(generateModel({ triples: 350_000, seed: 1 }).text, { format: 'text/turtle' });
    const model = ((store.query(`SELECT ?m WHERE { ?m a <${ARCH}Model> }`) as { results: Array<Record<string, { value: string }>> }).results[0]!).m!.value;
    const ns = model.replace(/model$/, '');
    const bindings: QuestionBindings = {
      focus: ns + 'element-7',
      view: ns + 'view-0',
      model,
      viewpoint: AM4VP + 'LayeredViewpoint',
      conceptType: AM4 + 'ApplicationComponent',
      from: ns + 'element-1',
      to: ns + 'element-2',
    };

    const questions = listQuestions(store);
    expect(questions).toHaveLength(40);
    const slow: string[] = [];
    for (const q of questions) {
      const limit = LIMITS_MS[q.iri] ?? LIMIT_MS;
      const took = timeOf(() => store.query(buildQuery(q, bindings, { limit: null })), limit);
      if (took > limit) slow.push(`${q.iri} ${took.toFixed(0)} ms`);
    }
    store.dispose();
    expect(slow).toEqual([]);
  }, 300_000);

  it('each answers 350 000 triples of ArchiMate 3.2 within its limit', () => {
    const store = new OxigraphRdfStore();
    for (const [path, graph] of [
      ['core/core-onto.ttl', ARCH],
      ['core/core-questions.ttl', 'https://meta.linked.archi/core-questions#'],
      ['archimate3/archimate3.2-onto.ttl', AM3],
      ['archimate3/archimate3.2-viewpoints.ttl', AM3VP],
      ['archimate3/archimate3.2-questions.ttl', 'https://meta.linked.archi/archimate3/questions#'],
    ] as const) {
      store.load(asset(path), { format: 'text/turtle', graph });
    }
    store.load(generateModel({ triples: 350_000, seed: 1, language: '3.2' }).text, { format: 'text/turtle' });
    const model = ((store.query(`SELECT ?m WHERE { ?m a <${ARCH}Model> }`) as { results: Array<Record<string, { value: string }>> }).results[0]!).m!.value;
    const ns = model.replace(/model$/, '');
    const bindings: QuestionBindings = {
      focus: ns + 'element-7',
      view: ns + 'view-0',
      model,
      viewpoint: AM3VP + 'LayeredViewpoint',
      conceptType: AM3 + 'ApplicationComponent',
      from: ns + 'element-1',
      to: ns + 'element-2',
    };

    const questions = listQuestions(store);
    expect(questions).toHaveLength(39);
    // A question that finds nothing on a model this size is not being timed.
    expect(store.query(buildQuery(questions.find((q) => q.iri.endsWith('#elements-by-layer'))!, bindings)))
      .toMatchObject({ type: 'bindings', results: expect.arrayContaining([expect.anything()]) });
    const slow: string[] = [];
    for (const q of questions) {
      const limit = LIMITS_MS[q.iri] ?? LIMIT_MS;
      const took = timeOf(() => store.query(buildQuery(q, bindings, { limit: null })), limit);
      if (took > limit) slow.push(`${q.iri} ${took.toFixed(0)} ms`);
    }
    store.dispose();
    expect(slow).toEqual([]);
  }, 300_000);
});
