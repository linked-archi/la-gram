/**
 * la-gram-git: la-gram's models in Git, on the command line and in CI — built
 * from the editor's own engine, so that what it says of a model file is what
 * la-gram would (Phase 3 of the Git collaboration plan).
 *
 * Exit codes: 0 all is well; 1 a check failed, or a merge left conflicts;
 * 2 it could not run (a wrong argument, Git failing).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkFiles, type FileCheck } from './check.js';
import { commentTarget, diffMarkdown, postComment } from './diff.js';
import { init } from './init.js';
import { runMergeDriver } from './merge.js';
import { asLaGramWrites, hasModelExtension, isModel, type ShapesFile } from './models.js';
import { parseModelText } from '@linked-archi/kernel/import-export/model-io.js';
import { detectFormat } from '@linked-archi/kernel/metamodel-manager/asset-sources.js';

export const USAGE = `la-gram-git — la-gram's models in Git: checked, rewritten, compared, merged.

  la-gram-git check [paths…] [--base <branch>] [--shapes <folder>]
      Each model file parses, is exactly as la-gram writes it, refers to
      nothing it lacks, and breaks no shape. With --base, a violation fails
      only when the change adds it (the file as it was where the branch left
      <branch> is checked too). The shapes' SPARQL-based rules are reported,
      not failed, and so are IRIs outside the Linked.Archi layout. --shapes
      adds a folder's shapes (.ttl) to the metamodels'.

  la-gram-git fix [paths…]
      Rewrite model files exactly as la-gram writes them.

  la-gram-git diff <branch> [paths…] [--head <ref>] [--comment]
      What the change does to its model files, by element, as Markdown — since
      it left <branch>. With --comment, also posted on the pull or merge
      request the CI job runs for, or updated there.

  la-gram-git merge <base> <ours> <theirs> <path>
      Git's merge driver (%O %A %B %P): the model merged by element. When
      one side moved the model to another namespace, the other side is
      moved after it first.

  la-gram-git init github|gitlab|merge-driver
      Set this repository up: the CI file for GitHub or GitLab, or the merge
      driver for model files.

Paths are files or folders (searched for model files: ${['ttl', 'trig', 'jsonld', 'nq', 'nt', 'rdf'].map((e) => `.${e}`).join(' ')}); the
current folder when none is given.`;

/** Run a command line; returns the exit code. `out` and `err` take the lines written. */
export async function main(argv: readonly string[], io: { out(line: string): void; err(line: string): void; cwd?: string; env?: NodeJS.ProcessEnv } = defaultIo()): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const [command, ...rest] = argv;
  try {
    if (!command || command === '--help' || command === '-h' || command === 'help') {
      io.out(USAGE);
      return command ? 0 : 2;
    }
    if (command === '--version' || command === '-v') {
      io.out(version());
      return 0;
    }
    if (command === 'check') {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, options: { base: { type: 'string' }, shapes: { type: 'string' } } });
      const shapes = values.shapes ? shapesIn(resolve(cwd, values.shapes)) : [];
      const files = modelFiles(positionals, cwd);
      const results = await checkFiles(files, { ...(values.base ? { base: values.base } : {}), shapes, cwd });
      return report(results, io, io.env ?? process.env);
    }
    if (command === 'fix') {
      const { positionals } = parseArgs({ args: [...rest], allowPositionals: true, options: {} });
      let changed = 0;
      for (const { path, explicit } of modelFiles(positionals, cwd)) {
        const full = resolve(cwd, path);
        const text = readFileSync(full, 'utf8');
        if (!isModel(text, path)) {
          if (explicit) io.err(`${path}: not a la-gram model, left as it is.`);
          continue;
        }
        const written = await asLaGramWrites(text, path);
        if (written === text) continue;
        writeFileSync(full, written);
        io.out(`Rewrote ${path}`);
        changed++;
      }
      io.out(changed === 0 ? 'Every model file is as la-gram writes it.' : `${changed} file${changed === 1 ? '' : 's'} rewritten.`);
      return 0;
    }
    if (command === 'diff') {
      const { values, positionals } = parseArgs({ args: [...rest], allowPositionals: true, options: { head: { type: 'string' }, comment: { type: 'boolean' } } });
      const [base, ...paths] = positionals;
      if (!base) throw new UsageError('diff needs the branch the change goes into: la-gram-git diff origin/main');
      const markdown = await diffMarkdown({ base, ...(values.head ? { head: values.head } : {}), ...(paths.length > 0 ? { paths } : {}), cwd });
      io.out(markdown);
      if (values.comment) {
        const target = commentTarget(io.env ?? process.env);
        if (typeof target === 'string') io.err(`Not commented: ${target}`);
        else {
          try {
            io.err(`la-gram-git: ${await postComment(target, markdown)}.`);
          } catch (err: unknown) {
            // A comment that cannot be made (a fork's read-only token) does not fail the job.
            io.err(`Not commented: ${err instanceof Error ? err.message : String(err)}.`);
          }
        }
      }
      return 0;
    }
    if (command === 'merge') {
      const [base, ours, theirs, path] = rest;
      if (!base || !ours || !theirs || !path) throw new UsageError('merge takes four files, as Git gives a merge driver: %O %A %B %P');
      return await runMergeDriver(resolve(cwd, base), resolve(cwd, ours), resolve(cwd, theirs), path, io.err);
    }
    if (command === 'init') {
      const [what] = rest;
      if (!what) throw new UsageError('init takes github, gitlab or merge-driver');
      for (const line of init(what, cwd)) io.out(line);
      return 0;
    }
    throw new UsageError(`No command "${command}".`);
  } catch (err: unknown) {
    io.err(`la-gram-git: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof UsageError) io.err('`la-gram-git --help` lists the commands.');
    return 2;
  }
}

class UsageError extends Error {}

/** The model files of these paths: files as given (`explicit`), folders searched. */
export function modelFiles(paths: readonly string[], cwd: string): Array<{ path: string; explicit: boolean }> {
  const out: Array<{ path: string; explicit: boolean }> = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && hasModelExtension(entry.name)) out.push({ path: relative(cwd, full) || entry.name, explicit: false });
    }
  };
  for (const path of paths.length > 0 ? paths : ['.']) {
    const full = resolve(cwd, path);
    if (!existsSync(full)) throw new UsageError(`${path} is not there.`);
    if (statSync(full).isDirectory()) walk(full);
    else out.push({ path: relative(cwd, full), explicit: true });
  }
  return out;
}

/**
 * The shapes files of a folder (`.ttl`), each a document la-gram can load: it
 * parses, and names its graph with an `owl:Ontology` (or a
 * `skos:ConceptScheme`), as la-gram's loader asks. Found wanting before any
 * model is checked — otherwise every model would fail for one shapes file.
 */
function shapesIn(folder: string): ShapesFile[] {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new UsageError(`--shapes takes a folder: ${folder} is not one.`);
  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.ttl'))
    .sort()
    .map((f) => ({ name: basename(f), text: readFileSync(join(folder, f), 'utf8') }));
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const NAMES_GRAPH = new Set(['http://www.w3.org/2002/07/owl#Ontology', 'http://www.w3.org/2004/02/skos/core#ConceptScheme']);
  for (const file of files) {
    let quads: ReturnType<typeof parseModelText>;
    try {
      quads = parseModelText(file.text, detectFormat(null, file.name));
    } catch (err: unknown) {
      throw new UsageError(`--shapes: ${file.name} does not parse: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!quads.some((q) => q.predicate.value === RDF_TYPE && NAMES_GRAPH.has(q.object.value))) {
      throw new UsageError(`--shapes: ${file.name} declares no owl:Ontology. A shapes document names its graph with one: <https://example.org/my-shapes> a owl:Ontology .`);
    }
  }
  return files;
}

/** Print what `check` found; in GitHub Actions also as annotations on the files. */
function report(results: readonly FileCheck[], io: { out(line: string): void }, env: NodeJS.ProcessEnv): number {
  const annotate = env['GITHUB_ACTIONS'] === 'true';
  let failed = 0;
  let checked = 0;
  for (const r of results) {
    if (r.skipped) continue;
    checked++;
    if (r.failures.length > 0) failed++;
    io.out(`${r.failures.length > 0 ? '✗' : '✓'} ${r.path}`);
    for (const line of r.failures) io.out(`    ${line}`);
    for (const line of r.notes) io.out(`  · ${line}`);
    if (annotate) for (const line of r.failures) io.out(`::error file=${escapeProperty(r.path)},title=la-gram-git::${escapeData(line)}`);
  }
  if (checked === 0) io.out('No model files to check.');
  else io.out(`\n${failed === 0 ? `${checked} model file${checked === 1 ? '' : 's'} checked: all well.` : `${failed} of ${checked} model file${checked === 1 ? '' : 's'} failed.`}`);
  return failed > 0 ? 1 : 0;
}

function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** The package's version, read from its package.json beside `dist/`. */
function version(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    return (JSON.parse(readFileSync(url, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function defaultIo() {
  return { out: (line: string) => process.stdout.write(`${line}\n`), err: (line: string) => process.stderr.write(`${line}\n`) };
}
