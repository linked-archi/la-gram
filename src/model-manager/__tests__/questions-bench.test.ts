/**
 * Every bundled model question answers a large model quickly enough to ask it
 * in the workbench, where queries run on the main thread: a generated
 * ArchiMate 4.0 model of 350 000 triples, the metamodel in named graphs as the
 * loader keeps it, the Layered viewpoint (which admits nearly every type) for
 * the questions that take one.
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

/** Milliseconds a question may take; `viewpoint-scope` reads every admitted element and what connects to it. */
const LIMIT_MS = 1000;
const LIMITS_MS: Record<string, number> = {
  'https://meta.linked.archi/archimate4/questions#viewpoint-scope': 2000,
};

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
    expect(questions).toHaveLength(36);
    const slow: string[] = [];
    for (const q of questions) {
      const started = performance.now();
      store.query(buildQuery(q, bindings, { limit: null }));
      const took = performance.now() - started;
      if (took > (LIMITS_MS[q.iri] ?? LIMIT_MS)) slow.push(`${q.iri} ${took.toFixed(0)} ms`);
    }
    store.dispose();
    expect(slow).toEqual([]);
  }, 300_000);
});
