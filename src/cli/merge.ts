/**
 * `la-gram-git merge %O %A %B %P`: Git's merge driver for model files — the
 * merge Save to Git uses (`model-merge.ts`), for people who merge with `git`
 * on the command line (`la-gram-git init merge-driver` sets it up).
 *
 * Git hands it three files — the common version (%O), ours (%A), theirs (%B) —
 * and the file's path (%P). The merged model is written to %A as la-gram writes
 * it, and the driver exits 0. With conflicts it exits 1, so Git marks the file
 * conflicted; the file then holds, where the two changes met, the version
 * before either — as the editor does until a side is chosen — never `<<<<<<<`
 * markers, which no RDF tool could read. The conflicts are listed on the
 * standard error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { NamedNode } from '@rdfjs/types';
import { DataFactory } from 'n3';
import { RdfShaclValidator } from '../rdf-engine/shacl-validator.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { mergeSnapshots, shaclCountCheck, snapshotOfText, type MergeConflict } from '../model-manager/model-merge.js';
import { literalValue, parseLine } from '../model-manager/snapshot-lines.js';
import { asLaGramWrites, describe, openModel, wordsOf, type OpenModel } from './models.js';

/** What the merge did. */
export interface MergeOutcome {
  /** The merged file's text, written to %A. */
  text: string;
  /** The conflicts, in words; none when it merged cleanly. */
  conflicts: string[];
}

/** Merge the three versions of the model file at `path`. */
export async function mergeFiles(base: string, ours: string, theirs: string, path: string): Promise<MergeOutcome> {
  const name = basename(path);
  const snapshots = [base, ours, theirs].map((text) => snapshotOfText(text, name));
  // The rules — single values, count limits — are the metamodels' that ours declares.
  const rules = await openModel(ours, path);
  const store = rules.app.components.store;
  const result = mergeSnapshots(snapshots[0]!, snapshots[1]!, snapshots[2]!, {
    singleValued: rules.app.singleValued(),
    counts: shaclCountCheck(
      new RdfShaclValidator(),
      rules.app.relationshipCheck().split.kept,
      store.getQuads(null, DataFactory.namedNode(NAMESPACES.rdfs + 'subClassOf') as unknown as NamedNode, null),
    ),
  });
  const merged = `${result.merged.join('\n')}\n`;
  const text = await asLaGramWrites(merged, path, `${name}.nt`);
  // Named as the merged model names them.
  const named = await openModel(merged, `${name}.nt`);
  return { text, conflicts: result.conflicts.map((c) => conflictText(named, c)) };
}

/** Git's merge driver: read %O %A %B, write %A; 0 when merged cleanly, 1 with conflicts. */
export async function runMergeDriver(basePath: string, oursPath: string, theirsPath: string, path: string, log: (line: string) => void): Promise<number> {
  const read = (p: string) => readFileSync(p, 'utf8');
  let outcome: MergeOutcome;
  try {
    outcome = await mergeFiles(read(basePath), read(oursPath), read(theirsPath), path);
  } catch (err: unknown) {
    log(`la-gram-git: ${path} was not merged: ${err instanceof Error ? err.message : String(err)}. It is left as your version.`);
    return 1;
  }
  writeFileSync(oursPath, outcome.text);
  if (outcome.conflicts.length === 0) return 0;
  log(`la-gram-git: ${path}: ${outcome.conflicts.length} change${outcome.conflicts.length === 1 ? '' : 's'} made on both sides to the same thing:`);
  for (const line of outcome.conflicts) log(`  ${line}`);
  log(
    'Where two changes met, the file holds the version before either. Edit it — or open it in la-gram — ' +
      'or take one side whole with `git checkout --ours` / `--theirs`, then `git add` it.',
  );
  return 1;
}

const KINDS: Record<MergeConflict['kind'], string> = {
  value: 'changed differently on each side',
  bounds: 'moved or resized on both sides',
  route: 'rerouted on both sides',
  deleted: 'deleted on one side, changed or referred to on the other',
  placement: 'placed in the same view by both sides',
  count: 'given values on both sides that together break a count limit',
};

/** A conflict in a line: what, which property, each side's value. */
function conflictText(open: OpenModel, conflict: MergeConflict): string {
  const words = wordsOf(open.app);
  const what = conflict.subjects.map((s) => describe(open.app, s)).join(', ');
  const property = conflict.predicate ? ` · ${words.propertyName(conflict.predicate)}${conflict.language ? ` (${conflict.language})` : ''}` : '';
  const sides =
    conflict.kind === 'value' && conflict.predicate
      ? `: ours ${valuesOf(open, conflict.options.ours, conflict.predicate)}, theirs ${valuesOf(open, conflict.options.theirs, conflict.predicate)}`
      : conflict.kind === 'deleted'
        ? ` (deleted in ${conflict.deletedBy === 'ours' ? 'ours' : 'theirs'})`
        : '';
  return `${what}${property} — ${KINDS[conflict.kind]}${sides}`;
}

function valuesOf(open: OpenModel, lines: readonly string[], predicate: string): string {
  const values = lines
    .map(parseLine)
    .filter((l) => l.p === predicate)
    .map((l) => {
      const text = literalValue(l.o);
      return text !== undefined ? `“${text}”` : l.o.startsWith('<') ? describe(open.app, l.o.slice(1, -1)) : l.o;
    });
  return values.length > 0 ? values.join(', ') : 'none';
}
