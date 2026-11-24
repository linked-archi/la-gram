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
 *
 * A side that moved the model to another namespace has the other side moved
 * after it first (DD-41), and the driver says so; sides that moved it to two
 * namespaces are not merged, and the file is left as ours.
 *
 * `.gitattributes` routes files by extension, so an ontology or a shapes file
 * comes here too. A file that is not a la-gram model on both sides — or does
 * not parse — is merged as Git merges text without the driver (`git
 * merge-file`): cleanly where the changes are apart, with conflict markers where
 * they meet.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { NamedNode } from '@rdfjs/types';
import { DataFactory } from 'n3';
import { RdfShaclValidator } from '@linked-archi/kernel/rdf-engine/shacl-validator.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import { mergeSnapshots, shaclCountCheck, snapshotOfText, type MergeConflict, type NamespaceMove } from '@linked-archi/kernel/model-manager/model-merge.js';
import { literalValue, parseLine } from '@linked-archi/kernel/model-manager/snapshot-lines.js';
import { asLaGramWrites, describe, isModel, openModel, wordsOf, type OpenModel } from './models.js';

/** What the merge did. */
export interface MergeOutcome {
  /** The merged file's text, written to %A. */
  text: string;
  /** The conflicts, in words; none when it merged cleanly. */
  conflicts: string[];
  /** The model was moved to another namespace, and the other side's changes were moved after it (DD-41). */
  moved?: NamespaceMove;
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
  return { text, conflicts: result.conflicts.map((c) => conflictText(named, c)), ...(result.moved ? { moved: result.moved } : {}) };
}

/** Git's merge driver: read %O %A %B, write %A; 0 when merged cleanly, 1 with conflicts. */
export async function runMergeDriver(basePath: string, oursPath: string, theirsPath: string, path: string, log: (line: string) => void): Promise<number> {
  const read = (p: string) => readFileSync(p, 'utf8');
  const ours = read(oursPath);
  const theirs = read(theirsPath);
  if (!isModelText(ours, path) || !isModelText(theirs, path)) return mergeAsText(basePath, oursPath, theirsPath, path, log);
  let outcome: MergeOutcome;
  try {
    outcome = await mergeFiles(read(basePath), ours, theirs, path);
  } catch (err: unknown) {
    log(`la-gram-git: ${path} was not merged: ${err instanceof Error ? err.message : String(err)}. It is left as your version.`);
    return 1;
  }
  writeFileSync(oursPath, outcome.text);
  if (outcome.moved) log(`la-gram-git: ${path}: ${movedText(outcome.moved)}`);
  if (outcome.conflicts.length === 0) return 0;
  log(`la-gram-git: ${path}: ${outcome.conflicts.length} change${outcome.conflicts.length === 1 ? '' : 's'} made on both sides to the same thing:`);
  for (const line of outcome.conflicts) log(`  ${line}`);
  log(
    'Where two changes met, the file holds the version before either. Edit it — or open it in la-gram — ' +
      'or take one side whole with `git checkout --ours` / `--theirs`, then `git add` it.',
  );
  return 1;
}

/** A la-gram model: it parses, and has an `arch:Model`. */
function isModelText(text: string, path: string): boolean {
  try {
    return isModel(text, path);
  } catch {
    return false;
  }
}

/**
 * Git's own three-way text merge, into %A: what Git does for the file without
 * the driver. `git merge-file` exits with the number of conflicts, or negative
 * (255) when it cannot merge.
 */
function mergeAsText(basePath: string, oursPath: string, theirsPath: string, path: string, log: (line: string) => void): number {
  try {
    execFileSync('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', oursPath, basePath, theirsPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (err: unknown) {
    const { status, stderr } = err as { status?: number | null; stderr?: Buffer | string };
    if (typeof status === 'number' && status > 0 && status < 128) {
      log(`la-gram-git: ${path} is not a la-gram model, so it was merged as text: ${status} conflict${status === 1 ? '' : 's'}, marked in the file.`);
      return 1;
    }
    log(`la-gram-git: ${path} was not merged: ${stderr?.toString().trim() || (err instanceof Error ? err.message : String(err))}. It is left as your version.`);
    return 1;
  }
}

/** A move the merge followed, in words. */
function movedText(moved: NamespaceMove): string {
  if (moved.by === 'both') return `both sides moved the model to ${moved.to}; the common version was moved after them, then merged.`;
  return `${moved.by} moved the model to ${moved.to}; ${moved.by === 'ours' ? 'theirs' : 'ours'}, from ${moved.from}, was moved after it, then merged.`;
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
