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
 *    new to most models: advisory, for now);
 * 6. its IRIs are checked against the layout every Linked.Archi tool mints
 *    (DD-41, `iri-conformance.ts`), and what is outside it is reported, never
 *    failed — names given before the layout counted as legacy: a tool never
 *    renames, so a repository's models would otherwise fail for good.
 *
 * Warnings and info are counted, never failed.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import { shapeIriOf } from '../rdf-engine/finding-shape.js';
import { parseModelText } from '../import-export/model-io.js';
import { detectFormat } from '../metamodel-manager/asset-sources.js';
import { LAYOUT_CATEGORIES, layoutReport, type LayoutCategory, type LayoutReport } from '../model-manager/iri-conformance.js';
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
  // The file's own triples: opening it adds a default view, a layout.
  result.notes.push(...layoutNotes(layoutReport(parseModelText(text, detectFormat(null, path)))));
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

/** How many names of each kind a layout note gives. */
const LAYOUT_EXAMPLES = 3;

const LAYOUT_WORDS: Record<LayoutCategory, string> = {
  characters: 'holding a character a path segment cannot',
  hashes: 'with more than one #',
  shape: 'shapes not named {view}#node-{id} or {view}#link-{id}',
  part: 'parts not named under their owner',
  outside: 'outside it, not model, graph/… or {kind}/{id}',
  legacy: 'named before it (legacy)',
};

/**
 * The layout notes: the namespace, then each kind of name outside the layout,
 * counted, a few named — relative to the namespace — and the legacy names;
 * none for a model all in it.
 */
export function layoutNotes(report: LayoutReport | undefined): string[] {
  if (!report) return [];
  const { namespace } = report;
  const lines: string[] = [];
  if (!report.declared) lines.push(`the model does not state its namespace (vann:preferredNamespaceUri), read as ${namespace}`);
  if (report.namespaceProblem) lines.push(`its namespace ${namespace} ${report.namespaceProblem}`);
  for (const category of LAYOUT_CATEGORIES) {
    const iris = report.iris[category];
    if (iris.length === 0) continue;
    const names = iris.slice(0, LAYOUT_EXAMPLES).map((iri) => (iri.startsWith(namespace) ? iri.slice(namespace.length) : iri));
    const more = iris.length > LAYOUT_EXAMPLES ? `, … and ${iris.length - LAYOUT_EXAMPLES} more` : '';
    lines.push(`${iris.length} ${LAYOUT_WORDS[category]}: ${names.join(', ')}${more}`);
  }
  return lines.length > 0 ? ['IRI layout (DD-41), advisory:', ...lines.map((l) => `  ${l}`)] : [];
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
