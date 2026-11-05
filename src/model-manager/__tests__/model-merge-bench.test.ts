/**
 * How long the three-way merge takes on a large model: the benchmark's
 * generated ArchiMate 4.0 model (`scripts/bench-model.mjs`) as base, two
 * versions of it with a few hundred renames, moves and deletions each — some
 * of the same concepts, so there are conflicts to find.
 *
 * Measured (2026-11-05), 350 000 triples: reading one version from Turtle
 * 0.5–0.6 s, merging about 0.5 s with 11 conflicts — under the 1 s past which the
 * plan would split a model into its DD-15 graphs as files. The limit leaves
 * room for a slower machine, and still catches a merge that grows with the
 * square of the model. The diff by element (`model-diff.ts`) of one side
 * against base is timed against the same limit.
 *
 * In the suite it runs on 100 000 triples: at 350 000 it loads the machine
 * enough, beside the other tests, to push `questions-bench.test` past its
 * limits now and then. `MERGE_BENCH_TRIPLES=350000 npx vitest --run …` measures
 * the large one.
 */

import { describe, it, expect } from 'vitest';
import { mergeSnapshots, snapshotOfText } from '../model-merge.js';
import { diffByElement } from '../model-diff.js';
// @ts-expect-error — the benchmark generator is a plain script
import { generateModel } from '../../../scripts/bench-model.mjs';

const TRIPLES = Number(process.env.MERGE_BENCH_TRIPLES ?? 100_000);
/** 3 s at 350 000 triples, in proportion below that (1 s at least). */
const LIMIT_MS = Math.max(1000, Math.round((3000 * TRIPLES) / 350_000));
const PREF_LABEL = '<http://www.w3.org/2004/02/skos/core#prefLabel>';
const BOUNDS_X = '<https://meta.linked.archi/core-vis#bounds-x>';

/** Every `step`th line with `predicate`, from `offset`, changed by `change`. */
function edit(lines: string[], predicate: string, offset: number, step: number, change: (line: string) => string | undefined): string[] {
  let seen = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (line.includes(` ${predicate} `) && seen++ % step === offset) {
      const changed = change(line);
      if (changed !== undefined) out.push(changed);
    } else out.push(line);
  }
  return out.sort();
}

/** The lines about none of `subjects`, and pointing at none. */
function deleted(lines: string[], subjects: string[]): string[] {
  const gone = new Set(subjects);
  return lines.filter((l) => {
    const parts = l.split(' ');
    return !gone.has(parts[0]) && !gone.has(parts[2]);
  });
}

const renamed = (suffix: string) => (line: string) => line.replace(/"@en \.$/, ` ${suffix}"@en .`);
const moved = (dx: number) => (line: string) => line.replace(/"(-?\d+(?:\.\d+)?)"/, (_m, n: string) => `"${Number(n) + dx}"`);

describe('the three-way merge on a large model', () => {
  it(`reads and merges ${TRIPLES.toLocaleString('en')} triples within ${LIMIT_MS} ms`, () => {
    const text = generateModel({ triples: TRIPLES, seed: 1 }).text as string;
    const read0 = performance.now();
    const base = snapshotOfText(text, 'model.ttl');
    const readMs = performance.now() - read0;

    // Ours renames every 300th name and moves every 200th node; theirs renames
    // every 300th name from another offset — and some the same — drops a bound
    // of every 500th node, and deletes every 400th named concept.
    const ours = edit(edit(base, PREF_LABEL, 0, 300, renamed('(ours)')), BOUNDS_X, 0, 200, moved(10));
    const theirs = deleted(
      edit(edit(edit(base, PREF_LABEL, 7, 300, renamed('(theirs)')), PREF_LABEL, 0, 3000, renamed('(theirs)')), BOUNDS_X, 3, 500, () => undefined),
      // Every 400th named concept, with every triple about it or pointing at it.
      base.filter((l) => l.includes(` ${PREF_LABEL} `)).filter((_l, i) => i % 400 === 0).map((l) => l.slice(0, l.indexOf(' '))),
    );

    const merge0 = performance.now();
    const { merged, conflicts } = mergeSnapshots(base, ours, theirs);
    const mergeMs = performance.now() - merge0;

    // What a review shows: one side against base, by element.
    const diff0 = performance.now();
    const diff = diffByElement(base, theirs);
    const diffMs = performance.now() - diff0;

    console.log(
      `merge bench: ${base.length} lines; reading one version ${readMs.toFixed(0)} ms; merging ${mergeMs.toFixed(0)} ms; ${conflicts.length} conflicts; ` +
        `diff by element ${diffMs.toFixed(0)} ms, ${diff.changes.length} concepts`,
    );
    expect(merged.length).toBeGreaterThan(base.length * 0.9);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(mergeMs).toBeLessThan(LIMIT_MS);
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(diffMs).toBeLessThan(LIMIT_MS);
  }, 60_000);
});
