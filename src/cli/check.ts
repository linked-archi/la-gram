/**
 * `la-gram-git check`: the model files are as la-gram would have them.
 *
 * For each model file (a file with a model extension and an `arch:Model` in
 * it — vendored ontologies and shapes are not models):
 *
 * 1. it parses;
 * 2. it is exactly as la-gram writes it — so its text diff is its change, and
 *    a text merge on the host meets no needless conflict (`fix` rewrites it);
 * 3. nothing in it refers to what it does not have;
 * 4. its shapes find no violation — with `--base`, none the change adds:
 *    findings the file had where the branch started are listed, not failed;
 * 5. its shapes' SPARQL-based rules are reported, and do not fail (they are
 *    new to most models: advisory, for now).
 *
 * Warnings and info are counted, never failed.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import { shapeIriOf } from '../rdf-engine/finding-shape.js';
import { fileAt, mergeBase, topLevel } from './git.js';
import {
  asLaGramWrites,
  byRules,
  describe,
  findingKey,
  findingsOf,
  isMissingReference,
  isModel,
  openModel,
  wordsOf,
  type OpenModel,
  type ShapesFile,
} from './models.js';

/** What `check` found in one file. */
export interface FileCheck {
  path: string;
  /** Not a model: left alone. */
  skipped?: string;
  /** Why it fails, a line each; none when it passes. */
  failures: string[];
  /** Findings that do not fail it: already there at the base, warnings, info, the SPARQL-based rules. */
  notes: string[];
  /** Declared metamodels the tool does not have. */
  missingMetamodels: string[];
}

/** Options for {@link checkFiles}. */
export interface CheckOptions {
  /** The branch the change goes into: only findings it adds fail. */
  base?: string;
  /** Extra shapes. */
  shapes?: readonly ShapesFile[];
  /** The repository's working folder (for `git`). */
  cwd?: string;
}

/** Check model files; `explicit` paths that are not models are failures, found ones are skipped. */
export async function checkFiles(files: ReadonlyArray<{ path: string; explicit: boolean }>, options: CheckOptions = {}): Promise<FileCheck[]> {
  const since = options.base ? mergeBase(options.base, 'HEAD', options.cwd) : undefined;
  const out: FileCheck[] = [];
  for (const { path, explicit } of files) out.push(await checkFile(path, explicit, since, options));
  return out;
}

async function checkFile(path: string, explicit: boolean, since: string | undefined, options: CheckOptions): Promise<FileCheck> {
  const result: FileCheck = { path, failures: [], notes: [], missingMetamodels: [] };
  const text = readFileSync(resolve(options.cwd ?? process.cwd(), path), 'utf8');
  try {
    if (!isModel(text, path)) {
      if (explicit) result.failures.push('not a la-gram model: it has no arch:Model');
      else result.skipped = 'not a model';
      return result;
    }
  } catch (err: unknown) {
    result.failures.push(`does not parse: ${message(err)}`);
    return result;
  }

  let open: OpenModel;
  try {
    open = await openModel(text, path, options.shapes);
  } catch (err: unknown) {
    result.failures.push(`could not be opened: ${message(err)}`);
    return result;
  }
  result.missingMetamodels = open.missingMetamodels;

  const written = await asLaGramWrites(text, path);
  const differs = firstDifference(text.replace(/\r\n/g, '\n'), written);
  if (differs) result.failures.push(`not as la-gram writes it (${differs}): \`la-gram-git fix ${path}\` rewrites it`);

  const findings = findingsOf(open.app);
  const before = since ? await baseFindings(since, path, options) : undefined;
  const words = wordsOf(open.app);
  const say = (r: ValidationResult) => {
    const property = r.resultPath.value ? `${words.propertyName(r.resultPath.value)}: ` : '';
    const shape = shapeIriOf(r);
    return `${describe(open.app, r.focusNode.value)} · ${property}${r.message.replace(/\s+/g, ' ').trim()}${shape ? ` (${shape})` : ''}`;
  };
  let already = 0;
  const rules: string[] = [];
  const counts = { Warning: 0, Info: 0 };
  for (const r of findings) {
    if (isMissingReference(r)) result.failures.push(say(r));
    else if (byRules(r)) rules.push(`${r.severity.toLowerCase()}: ${say(r)}`);
    else if (r.severity !== 'Violation') counts[r.severity]++;
    else if (before?.has(findingKey(r))) already++;
    else result.failures.push(say(r));
  }
  if (already > 0) result.notes.push(`${already} violation${already === 1 ? '' : 's'} already there where the branch started (not failed)`);
  if (counts.Warning + counts.Info > 0) result.notes.push(`${counts.Warning} warning${counts.Warning === 1 ? '' : 's'}, ${counts.Info} info`);
  if (rules.length > 0) {
    result.notes.push(`${rules.length} from the shapes' SPARQL-based rules (advisory):`);
    result.notes.push(...rules.slice(0, 50).map((r) => `  ${r}`));
    if (rules.length > 50) result.notes.push(`  … and ${rules.length - 50} more`);
  }
  if (open.missingMetamodels.length > 0) {
    result.notes.push(`validated without ${open.missingMetamodels.join(', ')}: la-gram-git does not have ${open.missingMetamodels.length === 1 ? 'it' : 'them'}`);
  }
  return result;
}

/** The findings of the file at the base, keyed; none when it was not there or does not open. */
async function baseFindings(since: string, path: string, options: CheckOptions): Promise<Set<string>> {
  // `git show` names a file from the repository's top.
  // Real paths both: a temporary folder on macOS is reached through a link.
  const fromTop = relative(realpathSync(topLevel(options.cwd)), realpathSync(resolve(options.cwd ?? process.cwd(), path))).split('\\').join('/');
  const text = fileAt(since, fromTop, options.cwd);
  if (text === undefined) return new Set();
  try {
    if (!isModel(text, path)) return new Set();
    const open = await openModel(text, path, options.shapes);
    return new Set(findingsOf(open.app).map(findingKey));
  } catch {
    return new Set();
  }
}

/** Where two texts first differ, in words; `undefined` when they do not. */
export function firstDifference(actual: string, expected: string): string | undefined {
  if (actual === expected) return undefined;
  const a = actual.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `from line ${i + 1}`;
  }
  return 'line endings or the end of the file';
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
