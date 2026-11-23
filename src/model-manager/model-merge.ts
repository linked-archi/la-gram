/**
 * Three-way merge of a model: a common version (base) and two versions made
 * from it (ours, theirs) give one model with both sets of changes, and the
 * conflicts between them as data — never as `<<<<<<<` markers in a file, which
 * would leave it unreadable to every RDF tool, la-gram included.
 *
 * ## What is merged
 *
 * Snapshots as {@link snapshotOf} makes them: the model as la-gram holds it, one
 * canonical N-Triples line per triple. A file from Git becomes one with
 * {@link snapshotOfText}, which reads it as opening it does — every graph into
 * the model — so a TriG file's DD-15 graphs are not lost: the merged model is
 * saved like any other, and the save partitions it again.
 *
 * ## How
 *
 * Every changed triple is merged in one of these units, the first that applies:
 *
 * 1. **A deleted concept** — something that has triples in base and none on one
 *    side — conflicts when the other side *added* a triple about it or pointing
 *    to it: changed it, related something to it, placed it in a view, filed it
 *    in a folder. Removals on the other side agree with a deletion, so deleting
 *    on both sides, or deleting a relationship the other side's deletion also
 *    took, merges cleanly. While the conflict is open the concept is kept: the
 *    deletion is undone, with what went with it (its relationships, nodes,
 *    links, routes) where those can come back whole.
 * 2. **A line's route** — `arch-vis:points` and every list cell and point reached
 *    from it — and **a node's bounds** — the four `arch-vis:bounds-*` — each
 *    merge as a whole. Merged triple by triple, two reroutes of one line would
 *    make a route neither person drew, and a move on one side and a resize on
 *    the other a box neither made.
 * 3. **A relationship's connection** — its types, `arch:source`, `arch:target`,
 *    `rdf:reifies`, the triple it reifies and the qualified predicate from its
 *    source — and **a concept's types** merge as a whole too: a retarget or a
 *    retype changes several triples that only make sense together. They are
 *    reported as conflicts of a single value.
 * 4. **A single value** — a property that takes one value, or one per language
 *    (`rdf-engine/single-valued.ts`, shared with the room).
 * 5. **Everything else**, triple by triple: kept when either side added it,
 *    dropped when either side removed it.
 *
 * A unit changed on one side only takes that side's version; changed alike on
 * both, that version; changed differently, it is a conflict and the merged
 * model holds base's version — neither side's change wins unseen, the model
 * stays as valid as base was, and the result is the same whichever side is
 * "ours".
 *
 * ## A model moved to another namespace
 *
 * Moving a model renames every IRI in it, so merged as they are, a move on one
 * side and an edit on the other read as "everything deleted on one side". A
 * merge therefore first looks for a move — the model under another IRI than
 * base's, `{to}model` — and moves base and the other side after it into the
 * mover's namespace (`vann:preferredNamespaceUri`, else derived from the
 * model's IRI), keeping every local part, as moving it in la-gram does
 * (`planNamespaceChange`; DD-41, scenario S7). Both sides moved it alike: base
 * is moved. Each to a namespace of its own: {@link NamespaceConflict}, not
 * merged.
 *
 * Then, on the merged model:
 *
 * - **Two placements**: both sides placed the same element (or drew the same
 *   relationship) in the same view, each with a node of its own. An element
 *   may be placed in a view more than once, so the merged model keeps both,
 *   with what each side drew at it; the conflict offers to keep only one — two
 *   people placing the same element at once most likely meant it once.
 * - **The provenance of edits** (Req 9.16): a concept each side changed names
 *   each side's editing activity; it keeps the one that ended later, as its
 *   `prov:generatedAtTime` and `dcterms:modified` are the later of the two
 *   (`latest`, never a conflict), and an editing activity no concept names any
 *   more goes, with a person or a la-gram version nothing names
 *   ({@link settleEditProvenance}).
 * - **Count limits** broken by the combination: each side added a value where
 *   the shapes allow two, or each removed a different one of the values a
 *   shape requires. Checked with the in-app SHACL validator ({@link shaclCountCheck}),
 *   on the nodes both sides changed, and reported only where neither side alone
 *   breaks the limit.
 *
 * ## Resolving
 *
 * A conflict names the lines of the merged model that stand for it (`held`) and,
 * for each side, the lines that replace them ({@link applyChoice}). For a
 * deleted concept, the deleting side's lines remove it with everything the other
 * side hung on it — its new relationships to it, its new nodes for it and their
 * links — so nothing is left pointing at nothing.
 *
 * ## Blank nodes
 *
 * Their labels are not kept between files, so a triple about a blank node in
 * one version does not match the same triple in another: it shows as removed
 * and added, and both sides' copies end up in the merged model. Models made in
 * la-gram have none; a save to Git warns about an imported model that has.
 */

import { DataFactory, Parser as N3Parser, Store as N3Store } from 'n3';
import type { Quad, Term } from '@rdfjs/types';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { ensureNamespace } from '../rdf-engine/iri.js';
import { SingleValued } from '../rdf-engine/single-valued.js';
import type { RdfShaclValidator } from '../rdf-engine/shacl-validator.js';
import { detectFormat } from '../metamodel-manager/asset-sources.js';
import { parseModelText } from '../import-export/model-io.js';
import { derivedNamespace } from './model-namespace.js';
import { diffSnapshots, snapshotOf } from './version-history.js';
import { BOUNDS_PREDICATES, IRI } from './vocabulary.js';
import { iriOf, literalValue, parseLine, predicateOf, subjectOf, type Line } from './snapshot-lines.js';
import { LA_GRAM_HOME } from './provenance.js';

/** One of the two versions merged into base. */
export type MergeSide = 'ours' | 'theirs';

/** What a conflict is about. */
export type MergeConflictKind = 'deleted' | 'placement' | 'value' | 'bounds' | 'route' | 'count';

/** A conflict, as data: what it is about, and the lines each choice gives. */
export interface MergeConflict {
  kind: MergeConflictKind;
  /**
   * What it is about, as IRIs (a blank node as `_:label`): a value's, bounds' or
   * route's subject; the deleted concepts kept for now; the two nodes or links
   * of a placement; the focus node of a count.
   */
  subjects: string[];
  /** The property: a value's, a count's. */
  predicate?: string;
  /** A value's language, for a property that takes one per language (`''`: none). */
  language?: string;
  /** Which side deleted the concepts (`deleted`). */
  deletedBy?: MergeSide;
  /** The validator's message (`count`). */
  message?: string;
  /** Lines of the merged snapshot that stand for this conflict until it is resolved. */
  held: string[];
  /** For each side, the lines that replace {@link held} when that side's version is chosen. */
  options: Record<MergeSide, string[]>;
}

/** The merged snapshot, and what is left to decide. */
export interface MergeResult {
  merged: string[];
  conflicts: MergeConflict[];
  /**
   * The model was moved to another namespace — on one side, or alike on both —
   * and base and the other side were moved after it before merging. Absent when
   * nothing had to be moved, a side left as base included.
   */
  moved?: NamespaceMove;
}

/** A model's IRI and namespace, as a snapshot has them. */
export interface SnapshotModel {
  /** The `arch:Model`. */
  model: string;
  /** Its `vann:preferredNamespaceUri`, else the namespace derived from its IRI (`model-namespace.ts`). */
  namespace: string;
}

/** A move of the model to another namespace, found by a merge. */
export interface NamespaceMove {
  /** Base's namespace. */
  from: string;
  /** The namespace it was moved to. */
  to: string;
  /** Who moved it: one side, or both alike. */
  by: MergeSide | 'both';
}

/**
 * Both sides moved the model, each to a namespace of its own (each renamed it
 * otherwise): there is no one namespace to merge into, so the versions are not
 * merged until one side follows the other.
 */
export class NamespaceConflict extends Error {
  constructor(
    readonly base: SnapshotModel,
    readonly ours: SnapshotModel,
    readonly theirs: SnapshotModel,
  ) {
    const name = (m: SnapshotModel) => (ours.namespace !== theirs.namespace ? m.namespace : m.model);
    super(`Both sides moved the model, ours to ${name(ours)} and theirs to ${name(theirs)}: move one to the other's namespace, then merge again`);
    this.name = 'NamespaceConflict';
  }
}

/** A count limit a snapshot breaks at a node. */
export interface CountFinding {
  /** The node, as an N-Triples term (`<iri>`, `_:label`). */
  focus: string;
  /** The property path's IRI, or `''` for a path that is not a single property. */
  path: string;
  /** The SHACL constraint component. */
  component: string;
  message: string;
}

/** Find count-limit results for these nodes (N-Triples terms) of a snapshot. */
export type CountCheck = (snapshot: readonly string[], focus: readonly string[]) => CountFinding[];

/** Options for {@link mergeSnapshots}. */
export interface MergeOptions {
  /** Which properties take one value; the built-in rules when absent. */
  singleValued?: SingleValued;
  /** Checks count limits; without it they are not looked for. */
  counts?: CountCheck;
}

const SIDES: readonly MergeSide[] = ['ours', 'theirs'];
const other = (side: MergeSide): MergeSide => (side === 'ours' ? 'theirs' : 'ours');

const RDF_TYPE = IRI.rdfType;
const NIL = `<${IRI.rdfNil}>`;
const BOUNDS = new Set<string>(BOUNDS_PREDICATES);
/** A subject naming something with one of these cannot be without it: a relationship its ends, a node its element and view, a link its relationship and ends. */
const REQUIRES = new Set<string>([
  IRI.source,
  IRI.target,
  IRI.legacyRelSource,
  IRI.legacyRelTarget,
  IRI.archElement,
  IRI.archRelationship,
  IRI.visView,
  IRI.visSource,
  IRI.visTarget,
]);
/** What a subject names with one of these is part of it: a link's route cells and label, a cell's point and next cell. */
const OWNS = new Set<string>([IRI.points, IRI.rdfFirst, IRI.rdfRest, IRI.visLabel]);
const LINK_ENDS = new Set<string>([IRI.visSource, IRI.visTarget]);
/** A relationship's own lines that say what it connects, and how. */
const CONNECTION = new Set<string>([RDF_TYPE, IRI.source, IRI.target, IRI.reifies]);
/** What makes a subject a relationship. */
const RELATIONSHIP_MARKS = new Set<string>([IRI.source, IRI.target, IRI.reifies]);
const KIND_ORDER: readonly MergeConflictKind[] = ['deleted', 'placement', 'value', 'bounds', 'route', 'count'];
const COUNT_COMPONENTS = new Set(
  ['MinCount', 'MaxCount', 'QualifiedMinCount', 'QualifiedMaxCount'].map((c) => `${NAMESPACES.sh}${c}ConstraintComponent`),
);

/**
 * Merge `ours` and `theirs`, both made from `base`. All three are snapshots
 * ({@link snapshotOf}); so is the result.
 *
 * @throws NamespaceConflict when the sides moved the model to different namespaces.
 */
export function mergeSnapshots(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
  options: MergeOptions = {},
): MergeResult {
  const o = new Set(ours);
  const t = new Set(theirs);
  if (sameSet(o, t)) return { merged: sortedOf(o), conflicts: [] };
  const b = new Set(base);
  if (sameSet(b, o)) return { merged: sortedOf(t), conflicts: [] };
  if (sameSet(b, t)) return { merged: sortedOf(o), conflicts: [] };
  const aligned = alignNamespaces(base, ours, theirs);
  if (aligned) return { ...mergeSnapshots(aligned.base, aligned.ours, aligned.theirs, options), moved: aligned.moved };
  const result = new ThreeWay(b, o, t, options).run();
  return { ...result, merged: settleEditProvenance(result.merged) };
}

const PROV_GENERATED_BY = NAMESPACES.prov + 'wasGeneratedBy';
const PROV_ENDED = NAMESPACES.prov + 'endedAtTime';
const PROV_ASSOCIATED = NAMESPACES.prov + 'wasAssociatedWith';

/**
 * The provenance of edits after a merge: a concept named by two editing activities — one each side — keeps the
 * one that ended later; then la-gram's activities no concept names go, and the people and la-gram versions no
 * remaining line names. A converter's run is not la-gram's, and stays (`model-manager/provenance.ts`).
 */
export function settleEditProvenance(lines: readonly string[]): string[] {
  const generatedBy = new Map<string, string[]>();
  const ended = new Map<string, string>();
  const associated = new Map<string, string[]>();
  for (const line of lines) {
    const p = predicateOf(line);
    if (p === PROV_GENERATED_BY) push(generatedBy, subjectOf(line), line);
    else if (p === PROV_ENDED) ended.set(subjectOf(line), parseLine(line).o);
    else if (p === PROV_ASSOCIATED) push(associated, subjectOf(line), parseLine(line).o);
  }
  const drop = new Set<string>();
  for (const named of generatedBy.values()) {
    if (named.length < 2) continue;
    const endOf = (line: string) => ended.get(parseLine(line).o) ?? '';
    const kept = named.reduce((a, b) => (endOf(b) > endOf(a) ? b : a));
    for (const line of named) if (line !== kept) drop.add(line);
  }
  if (drop.size === 0) return [...lines];
  const named = new Set([...generatedBy.values()].flat().filter((l) => !drop.has(l)).map((l) => parseLine(l).o));
  const laGram = (term: string) => term.startsWith(`<${LA_GRAM_HOME}`);
  const gone = new Set<string>();
  for (const [activity, agents] of associated) {
    if (!named.has(activity) && agents.some(laGram)) gone.add(activity);
  }
  let kept = lines.filter((l) => !drop.has(l) && !gone.has(subjectOf(l)));
  // People and la-gram versions only the dropped activities named.
  const stillNamed = new Set(kept.flatMap((l) => parseLine(l).refs));
  const orphans = new Set(
    [...gone].flatMap((a) => associated.get(a) ?? []).filter((agent) => !stillNamed.has(agent)),
  );
  if (orphans.size > 0) kept = kept.filter((l) => !orphans.has(subjectOf(l)));
  return kept;
}

/** The merged snapshot with one conflict resolved to one side's version. */
export function applyChoice(merged: readonly string[], conflict: MergeConflict, side: MergeSide): string[] {
  const result = new Set(merged);
  for (const line of conflict.held) result.delete(line);
  for (const line of conflict.options[side]) result.add(line);
  return sortedOf(result);
}

/**
 * A file's model as a snapshot, read as opening the file reads it: by its
 * name's extension, every graph into the model.
 */
export function snapshotOfText(text: string, fileName: string): string[] {
  return snapshotOf(parseModelText(text, detectFormat(null, fileName)));
}

/**
 * A {@link CountCheck} by the in-app SHACL validator: `shapes` against the
 * focus nodes, their triples, the triples pointing at them and the types of
 * what they name, with `context` — the class hierarchy and the types of
 * referenced metamodel resources, as validating the model is given them.
 */
export function shaclCountCheck(validator: RdfShaclValidator, shapes: Quad[], context: Quad[] = []): CountCheck {
  return (snapshot, focus) => {
    if (focus.length === 0 || shapes.length === 0) return [];
    const nodes = new Set(focus);
    const near: string[] = [];
    const named = new Set<string>();
    for (const line of snapshot) {
      const { s, refs } = parseLine(line);
      if (nodes.has(s)) {
        near.push(line);
        for (const ref of refs) named.add(ref);
      } else if (refs.some((r) => nodes.has(r))) near.push(line);
    }
    for (const line of snapshot) {
      const { s, p } = parseLine(line);
      if (p === RDF_TYPE && named.has(s) && !nodes.has(s)) near.push(line);
    }
    const data = new N3Store([...quadsOfSnapshot(near), ...context] as never[]);
    const report = validator.validateNodes(data, shapes, focus.map(termOf));
    const findings: CountFinding[] = [];
    for (const result of report.results) {
      const component = result.sourceConstraintComponent?.value ?? '';
      if (!COUNT_COMPONENTS.has(component)) continue;
      const value = result.focusNode.value;
      const path = result.resultPath.value;
      findings.push({
        focus: nodes.has(`_:${value}`) ? `_:${value}` : `<${value}>`,
        path: /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : '',
        component,
        message: result.message,
      });
    }
    return findings;
  };
}

// ── A model moved to another namespace ────────────────────────────────────

const MODEL_TYPE = `<${IRI.Model}>`;
const VANN_URI = NAMESPACES.vann + 'preferredNamespaceUri';

/** The model a snapshot is of, and its namespace; `undefined` without exactly one `arch:Model`. */
export function snapshotModel(lines: readonly string[]): SnapshotModel | undefined {
  const models: string[] = [];
  const declared = new Map<string, string>();
  for (const line of lines) {
    const p = predicateOf(line);
    if (p === RDF_TYPE) {
      if (line.endsWith(` ${MODEL_TYPE} .`)) models.push(subjectOf(line));
    } else if (p === VANN_URI) {
      const s = subjectOf(line);
      const value = literalValue(parseLine(line).o)?.trim();
      // The first, as lines sort, when a model states more than one.
      if (value && !declared.has(s)) declared.set(s, value);
    }
  }
  if (models.length !== 1 || !models[0]!.startsWith('<')) return undefined;
  const model = iriOf(models[0]!);
  const uri = declared.get(models[0]!);
  return { model, namespace: uri ? ensureNamespace(uri) : derivedNamespace(model) };
}

/** Base and the sides, moved after the side that moved the model; `undefined` when neither did. */
function alignNamespaces(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
): { base: string[]; ours: string[]; theirs: string[]; moved: NamespaceMove } | undefined {
  const b = snapshotModel(base);
  const o = snapshotModel(ours);
  const t = snapshotModel(theirs);
  if (!b || !o || !t) return undefined;
  // A move renames the model (`{to}model`). A namespace set without moving the IRIs only
  // changes where new ones are minted: its statement merges as any other value.
  const moved: Record<MergeSide, boolean> = { ours: o.model !== b.model, theirs: t.model !== b.model };
  if (!moved.ours && !moved.theirs) return undefined;
  if (moved.ours && moved.theirs && o.model !== t.model) throw new NamespaceConflict(b, o, t);
  const to = moved.ours ? o : t;
  const movers = SIDES.filter((side) => moved[side]).map((side) => (side === 'ours' ? ours : theirs));
  // What a mover still has, its move left alone: a vocabulary's term in the old namespace.
  const kept = new Set<string>();
  for (const lines of movers) {
    for (const line of lines) {
      const { s, p, refs } = parseLine(line);
      kept.add(iriOf(s));
      kept.add(p);
      for (const ref of refs) kept.add(iriOf(ref));
    }
  }
  const declaration = movers[0]!.filter((line) => predicateOf(line) === VANN_URI && subjectOf(line) === `<${to.model}>`);
  const move = (lines: readonly string[]) => moveLines(lines, b, to, kept, declaration);
  return {
    base: move(base),
    ours: moved.ours ? [...ours] : move(ours),
    theirs: moved.theirs ? [...theirs] : move(theirs),
    moved: { from: b.namespace, to: to.namespace, by: moved.ours && moved.theirs ? 'both' : moved.ours ? 'ours' : 'theirs' },
  };
}

/**
 * Lines moved from one model's namespace to another's, as moving the model in
 * la-gram moves them (`planNamespaceChange`): the model to its new IRI, every
 * other IRI under the old namespace — inside a triple term too — to the same
 * local part under the new one, unless it is `kept`; the model's
 * `vann:preferredNamespaceUri` replaced by `declaration`.
 */
function moveLines(
  lines: readonly string[],
  from: SnapshotModel,
  to: SnapshotModel,
  kept: ReadonlySet<string>,
  declaration: readonly string[],
): string[] {
  const renamed = (iri: string): string => {
    if (iri === from.model) return to.model;
    if (kept.has(iri) || !iri.startsWith(from.namespace) || iri.length === from.namespace.length) return iri;
    return `${to.namespace}${iri.slice(from.namespace.length)}`;
  };
  const term = (t: Term): Term => {
    if (t.termType === 'NamedNode') {
      const next = renamed(t.value);
      return next === t.value ? t : (DataFactory.namedNode(next) as unknown as Term);
    }
    if (t.termType === 'Quad') {
      const inner = t as unknown as Quad;
      return DataFactory.quad(term(inner.subject) as never, term(inner.predicate) as never, term(inner.object) as never) as unknown as Term;
    }
    return t;
  };
  const quads = quadsOfSnapshot(lines)
    .map((q) => DataFactory.quad(term(q.subject) as never, term(q.predicate) as never, term(q.object) as never) as unknown as Quad)
    .filter((q) => !(q.subject.value === to.model && q.predicate.value === VANN_URI));
  return sortedOf(new Set([...snapshotOf(quads), ...declaration]));
}

// ── The merge ─────────────────────────────────────────────────────────────

/** A unit merged as a whole. */
type Unit =
  | { kind: 'route'; subject: string }
  | { kind: 'bounds'; subject: string }
  /** A relationship's kind and ends: its types, `arch:source`/`arch:target`, `rdf:reifies`, the triple it reifies, the qualified predicate to it. */
  | { kind: 'connection'; subject: string }
  /** A concept's types. */
  | { kind: 'types'; subject: string }
  /** `latest`: changed differently on each side, the later value is taken (`dcterms:modified`). */
  | { kind: 'value'; subject: string; predicate: string; language?: string; latest?: boolean };

/** A deletion kept for now, until the person decides. */
interface PendingDeletion {
  deletedBy: MergeSide;
  /** The deleted subjects kept. */
  subjects: string[];
  /** They, and what the other side hung on them. */
  scope: Set<string>;
}

const EMPTY: readonly string[] = [];

/** One version's lines, with its triples by subject. */
class Version {
  private index?: Map<string, string[]>;

  constructor(readonly lines: Set<string>) {}

  has(line: string): boolean {
    return this.lines.has(line);
  }

  of(subject: string): readonly string[] {
    return this.bySubject().get(subject) ?? EMPTY;
  }

  hasSubject(subject: string): boolean {
    return this.bySubject().has(subject);
  }

  add(lines: Iterable<string>): void {
    for (const line of lines) {
      if (this.lines.has(line)) continue;
      this.lines.add(line);
      if (this.index) push(this.index, subjectOf(line), line);
    }
  }

  private bySubject(): Map<string, string[]> {
    if (!this.index) {
      this.index = new Map();
      for (const line of this.lines) push(this.index, subjectOf(line), line);
    }
    return this.index;
  }
}

class ThreeWay {
  private readonly rules: SingleValued;
  private readonly base: Version;
  private readonly side: Record<MergeSide, Version>;
  /** Each side's lines as given, before deletions were undone. */
  private readonly given: Record<MergeSide, ReadonlySet<string>>;
  private readonly added: Record<MergeSide, string[]>;
  private readonly removed: Record<MergeSide, Set<string>>;
  /** What owns a list cell, point or label node (by `OWNS`), in base and in what was added. */
  private readonly ownersInBase = new Map<string, Array<{ parent: string; via: string }>>();
  private readonly ownersAdded = new Map<string, Array<{ parent: string; via: string }>>();
  /** The relationships reifying a triple, by the triple's line; and the triples a relationship reifies. */
  private readonly reifiers = new Map<string, Set<string>>();
  private readonly reified = new Map<string, Set<string>>();
  private readonly relationships = new Map<string, boolean>();
  private readonly lines = new Map<string, Line>();
  private readonly conflicts: MergeConflict[] = [];
  private merged = new Set<string>();

  constructor(
    base: Set<string>,
    ours: Set<string>,
    theirs: Set<string>,
    private readonly options: MergeOptions,
  ) {
    this.rules = options.singleValued ?? SingleValued.builtIn();
    this.base = new Version(base);
    this.given = { ours, theirs };
    this.side = { ours: new Version(new Set(ours)), theirs: new Version(new Set(theirs)) };
    const baseLines = [...base];
    const diff = { ours: diffSnapshots(baseLines, [...ours]), theirs: diffSnapshots(baseLines, [...theirs]) };
    this.added = { ours: diff.ours.added, theirs: diff.theirs.added };
    this.removed = { ours: new Set(diff.ours.removed), theirs: new Set(diff.theirs.removed) };
  }

  run(): MergeResult {
    this.readStructure();
    const deletions = SIDES.flatMap((side) => this.keepDeleted(side));
    this.merged = new Set(this.base.lines);
    this.mergeChanges();
    this.recordDeletions(deletions);
    const placed = new Set<string>();
    this.placements(IRI.archElement, placed);
    this.placements(IRI.archRelationship, placed);
    if (this.options.counts) this.countLimits(this.options.counts);
    return { merged: sortedOf(this.merged), conflicts: this.conflicts.sort(byConflict) };
  }

  private parse(line: string): Line {
    let parsed = this.lines.get(line);
    if (!parsed) {
      parsed = parseLine(line);
      this.lines.set(line, parsed);
    }
    return parsed;
  }

  /** The subject and every node the object names. */
  private nodesOf(line: string): string[] {
    const { s, refs } = this.parse(line);
    return [s, ...refs];
  }

  /**
   * Who owns what, by `OWNS`, and which triples relationships reify: in base,
   * and in what either side added.
   */
  private readStructure(): void {
    const read = (lines: Iterable<string>, into: Map<string, Array<{ parent: string; via: string }>>) => {
      for (const line of lines) {
        const p = predicateOf(line);
        if (p === IRI.reifies) {
          const { s, refs } = this.parse(line);
          if (refs.length !== 3) continue;
          const reified = `${refs[0]} ${refs[1]} ${refs[2]} .`;
          const set = this.reifiers.get(reified) ?? new Set<string>();
          set.add(s);
          this.reifiers.set(reified, set);
          const triples = this.reified.get(s) ?? new Set<string>();
          triples.add(reified);
          this.reified.set(s, triples);
          continue;
        }
        if (!OWNS.has(p)) continue;
        const { s, refs } = this.parse(line);
        for (const ref of refs) push(into, ref, { parent: s, via: p });
      }
    };
    read(this.base.lines, this.ownersInBase);
    for (const side of SIDES) read(this.added[side], this.ownersAdded);
  }

  // ── 1. Deleted concepts ──────────────────────────────────────────────

  /**
   * Undo `side`'s deletions that the other side added to: put back, on `side`,
   * the base triples of what is kept. What is kept: the deleted subjects the
   * other side's additions name; what those need (their element, view, ends —
   * `REQUIRES`) and are made of (`OWNS`, both ways); and what was deleted with
   * them that needs them and can come back whole.
   */
  private keepDeleted(side: MergeSide): PendingDeletion[] {
    const mine = this.side[side];
    const deleted = new Set<string>();
    for (const line of this.removed[side]) {
      const s = subjectOf(line);
      if (mine.hasSubject(s) || deleted.has(s)) continue;
      // A cell or point of a route whose line is still there: the route merges as a whole.
      const link = this.routeOf(s);
      if (link && mine.hasSubject(link)) continue;
      deleted.add(s);
    }
    if (deleted.size === 0) return [];

    const seeds: string[][] = [];
    for (const line of this.added[other(side)]) {
      if (mine.has(line)) continue;
      const hit = this.nodesOf(line).filter((n) => deleted.has(n));
      if (hit.length > 0) seeds.push(hit);
    }
    if (seeds.length === 0) return [];

    const kept = this.keptOf(deleted, seeds.flat());
    const back: string[] = [];
    for (const line of this.removed[side]) {
      const nodes = this.nodesOf(line);
      if (nodes.some((n) => kept.has(n)) && nodes.every((n) => !deleted.has(n) || kept.has(n))) back.push(line);
    }
    mine.add(back);
    for (const line of back) this.removed[side].delete(line);

    // One conflict per group of kept subjects that base connects (or one added line names together).
    const groups = new UnionFind();
    for (const s of kept) {
      groups.add(s);
      for (const line of this.base.of(s)) for (const ref of this.parse(line).refs) if (kept.has(ref)) groups.union(s, ref);
    }
    for (const hit of seeds) for (const n of hit.slice(1)) groups.union(hit[0], n);
    return groups.sets().map((subjects) => ({
      deletedBy: side,
      // The concepts, not their parts (route cells and points, label nodes).
      subjects: subjects.filter((s) => !(this.ownersInBase.get(s) ?? []).some((o) => kept.has(o.parent))).sort(),
      scope: this.hungOn(other(side), subjects),
    }));
  }

  /** The deleted subjects to keep, from those named. */
  private keptOf(deleted: ReadonlySet<string>, seeds: readonly string[]): Set<string> {
    const kept = new Set<string>();
    const queue: string[] = [];
    const keep = (n: string) => {
      if (deleted.has(n) && !kept.has(n)) {
        kept.add(n);
        queue.push(n);
      }
    };
    const needs = new Map<string, string[]>();
    const needsOf = (s: string) => {
      let list = needs.get(s);
      if (!list) {
        list = this.base.of(s).flatMap((line) => (REQUIRES.has(this.parse(line).p) ? this.parse(line).refs : []));
        needs.set(s, list);
      }
      return list;
    };
    seeds.forEach(keep);
    for (;;) {
      while (queue.length > 0) {
        const s = queue.pop() as string;
        for (const line of this.base.of(s)) {
          const { p, refs } = this.parse(line);
          if (REQUIRES.has(p) || OWNS.has(p)) refs.forEach(keep);
        }
        for (const { parent } of this.ownersInBase.get(s) ?? []) keep(parent);
      }
      let grew = false;
      for (const d of deleted) {
        if (kept.has(d)) continue;
        const list = needsOf(d);
        if (list.some((n) => kept.has(n)) && list.every((n) => !deleted.has(n) || kept.has(n))) {
          keep(d);
          grew = true;
        }
      }
      if (!grew) return kept;
    }
  }

  /**
   * `subjects`, and what `side` made that hangs on them: its new subjects that
   * need one of them (`REQUIRES`) — a relationship to it, a node for it, a link
   * of those — and their parts.
   */
  private hungOn(side: MergeSide, subjects: readonly string[]): Set<string> {
    const scope = new Set(subjects);
    const isNew = (s: string) => !this.base.hasSubject(s) && this.side[side].hasSubject(s);
    for (let grew = true; grew; ) {
      grew = false;
      for (const line of this.added[side]) {
        const { s, p, refs } = this.parse(line);
        if (scope.has(s)) {
          if (OWNS.has(p)) {
            for (const ref of refs) {
              if (isNew(ref) && !scope.has(ref)) {
                scope.add(ref);
                grew = true;
              }
            }
          }
        } else if (REQUIRES.has(p) && isNew(s) && refs.some((r) => scope.has(r))) {
          scope.add(s);
          grew = true;
        }
      }
    }
    return scope;
  }

  /** Record the deletions kept for now, with their lines in the merged model and on each side. */
  private recordDeletions(deletions: PendingDeletion[]): void {
    if (deletions.length === 0) return;
    // Which deletions each node is in scope of; then one pass over each set of lines.
    const scopes = new Map<string, number[]>();
    deletions.forEach((deletion, i) => {
      for (const n of deletion.scope) push(scopes, n, i);
    });
    const touching = (lines: Iterable<string>) => {
      const out = deletions.map(() => [] as string[]);
      for (const line of lines) {
        const { s, refs } = parseLine(line);
        const own = scopes.get(s);
        const named = refs.flatMap((r) => scopes.get(r) ?? []);
        if (!own && named.length === 0) continue;
        for (const i of new Set([...(own ?? []), ...named])) out[i].push(line);
      }
      return out.map((list) => list.sort());
    };
    const held = touching(this.merged);
    const given = { ours: touching(this.given.ours), theirs: touching(this.given.theirs) };
    deletions.forEach((deletion, i) => {
      const subjects = deletion.subjects.filter((s) => held[i].some((line) => subjectOf(line) === s));
      if (subjects.length === 0) return;
      const deleting = given[deletion.deletedBy][i];
      this.conflicts.push({
        kind: 'deleted',
        subjects: subjects.map(iriOf),
        deletedBy: deletion.deletedBy,
        held: held[i],
        options: deletion.deletedBy === 'ours' ? { ours: deleting, theirs: held[i] } : { ours: held[i], theirs: deleting },
      });
    });
  }

  // ── 2–4. Units, single values, triples ───────────────────────────────

  private mergeChanges(): void {
    const units = new Map<string, Unit>();
    const changed = new Set<string>();
    for (const side of SIDES) {
      for (const line of this.added[side]) changed.add(line);
      for (const line of this.removed[side]) changed.add(line);
    }
    for (const line of changed) {
      const unit = this.unitOf(line);
      if (unit) {
        units.set(unitKey(unit), unit);
        continue;
      }
      const present = this.base.has(line)
        ? this.side.ours.has(line) && this.side.theirs.has(line)
        : this.side.ours.has(line) || this.side.theirs.has(line);
      if (present) this.merged.add(line);
      else this.merged.delete(line);
    }
    for (const unit of units.values()) this.mergeUnit(unit);
  }

  /** The unit a changed line merges in, or `undefined` for one merged on its own. */
  private unitOf(line: string): Unit | undefined {
    const { s, p, lang } = this.parse(line);
    if (p === IRI.points) return { kind: 'route', subject: s };
    const link = this.routeOf(s);
    if (link) return { kind: 'route', subject: link };
    if (BOUNDS.has(p)) return { kind: 'bounds', subject: s };
    const relationship = this.connectionOf(line);
    if (relationship) return { kind: 'connection', subject: relationship };
    if (p === RDF_TYPE) return { kind: 'types', subject: s };
    if (!this.rules.mayLimit(p)) return undefined;
    const limit = this.rules.limitOf(p, () => this.typesOf(s));
    if (!limit) return undefined;
    return {
      kind: 'value',
      subject: s,
      predicate: p,
      ...(limit === 'one-per-language' ? { language: lang } : {}),
      ...(limit === 'latest' ? { latest: true } : {}),
    };
  }

  /**
   * The relationship whose connection a line is part of: one of its own
   * `CONNECTION` lines, the triple it reifies, or the qualified predicate from
   * its source to it.
   */
  private connectionOf(line: string): string | undefined {
    const { s, p, refs } = this.parse(line);
    if (CONNECTION.has(p) && this.isRelationship(s)) return s;
    const reifier = this.reifiers.get(line);
    if (reifier) return [...reifier].sort()[0];
    const o = refs.length === 1 ? refs[0] : undefined;
    if (o && this.isRelationship(o) && this.sourcesOf(o).has(s)) return o;
    return undefined;
  }

  private isRelationship(subject: string): boolean {
    let known = this.relationships.get(subject);
    if (known === undefined) {
      known = [this.base, this.side.ours, this.side.theirs].some((v) => v.of(subject).some((l) => RELATIONSHIP_MARKS.has(this.parse(l).p)));
      this.relationships.set(subject, known);
    }
    return known;
  }

  /** A relationship's sources in any version. */
  private sourcesOf(relationship: string): Set<string> {
    const sources = new Set<string>();
    for (const v of [this.base, this.side.ours, this.side.theirs]) {
      for (const l of v.of(relationship)) {
        const { p, o } = this.parse(l);
        if (p === IRI.source) sources.add(o);
      }
    }
    return sources;
  }

  /** The link whose route a list cell or point is part of. */
  private routeOf(term: string): string | undefined {
    const seen = new Set<string>();
    let current = term;
    for (;;) {
      if (seen.has(current)) return undefined;
      seen.add(current);
      const owners = [...(this.ownersInBase.get(current) ?? []), ...(this.ownersAdded.get(current) ?? [])];
      const owner = owners.find((o) => o.via !== IRI.visLabel);
      if (!owner) return undefined;
      if (owner.via === IRI.points) return owner.parent;
      current = owner.parent;
    }
  }

  /** A subject's types in any of the three versions. */
  private typesOf(subject: string): string[] {
    const types = new Set<string>();
    for (const version of [this.base, this.side.ours, this.side.theirs]) {
      for (const line of version.of(subject)) {
        const { p, o } = this.parse(line);
        if (p === RDF_TYPE && o.startsWith('<')) types.add(o.slice(1, -1));
      }
    }
    return [...types];
  }

  private contentOf(unit: Unit, version: Version): string[] {
    if (unit.kind === 'route') return this.routeIn(version, unit.subject);
    if (unit.kind === 'connection') return this.connectionIn(version, unit.subject);
    const lines = version.of(unit.subject);
    if (unit.kind === 'bounds') return lines.filter((line) => BOUNDS.has(this.parse(line).p)).sort();
    if (unit.kind === 'types') return lines.filter((line) => this.parse(line).p === RDF_TYPE).sort();
    const { predicate, language } = unit;
    return lines
      .filter((line) => {
        const { p, lang } = this.parse(line);
        return p === predicate && (language === undefined || lang === language);
      })
      .sort();
  }

  /**
   * A relationship's connection in a version: the version's lines that
   * {@link connectionOf} gives to it — so a triple it reifies counts where the
   * version still has it, with or without the `rdf:reifies` saying so.
   */
  private connectionIn(version: Version, relationship: string): string[] {
    const out = version.of(relationship).filter((line) => CONNECTION.has(this.parse(line).p));
    for (const triple of this.reified.get(relationship) ?? []) {
      if (version.has(triple) && this.connectionOf(triple) === relationship) out.push(triple);
    }
    for (const source of this.sourcesOf(relationship)) {
      for (const line of version.of(source)) {
        if (this.parse(line).o === relationship && this.connectionOf(line) === relationship) out.push(line);
      }
    }
    return [...new Set(out)].sort();
  }

  /** A link's route in a version: its `arch-vis:points`, and every cell and point reached from it. */
  private routeIn(version: Version, link: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const line of version.of(link)) {
      const { p, o } = this.parse(line);
      if (p !== IRI.points) continue;
      out.push(line);
      let cell: string | undefined = o;
      while (cell && cell !== NIL && !seen.has(cell)) {
        seen.add(cell);
        let next: string | undefined;
        for (const cellLine of version.of(cell)) {
          out.push(cellLine);
          const parsed = this.parse(cellLine);
          if (parsed.p === IRI.rdfFirst && !seen.has(parsed.o)) {
            seen.add(parsed.o);
            out.push(...version.of(parsed.o));
          } else if (parsed.p === IRI.rdfRest) next = parsed.o;
        }
        cell = next;
      }
    }
    return [...new Set(out)].sort();
  }

  private mergeUnit(unit: Unit): void {
    const base = this.contentOf(unit, this.base);
    const ours = this.contentOf(unit, this.side.ours);
    const theirs = this.contentOf(unit, this.side.theirs);
    let result: string[];
    if (sameList(ours, base)) result = theirs;
    else if (sameList(theirs, base) || sameList(ours, theirs)) result = ours;
    else if (unit.kind === 'value' && unit.latest) result = latestOf(ours) >= latestOf(theirs) ? ours : theirs;
    else {
      result = base;
      const predicate =
        unit.kind === 'value' ? unit.predicate : unit.kind === 'types' ? RDF_TYPE : unit.kind === 'connection' ? differingEnd(ours, theirs) : undefined;
      this.conflicts.push({
        kind: unit.kind === 'route' || unit.kind === 'bounds' ? unit.kind : 'value',
        subjects: [iriOf(unit.subject)],
        ...(predicate ? { predicate } : {}),
        ...(unit.kind === 'value' && unit.language !== undefined ? { language: unit.language } : {}),
        held: base,
        options: { ours, theirs },
      });
    }
    for (const line of base) this.merged.delete(line);
    for (const line of result) this.merged.add(line);
  }

  // ── Two placements ───────────────────────────────────────────────────

  /**
   * Both sides placed the same concept in the same view anew (`via`: a node's
   * `arch-vis:archElement`, a link's `arch-vis:archRelationship`). Both are
   * kept, each with what its side drew at it; the conflict offers each alone.
   */
  private placements(via: string, placed: Set<string>): void {
    // By concept and view: the node or link each side added there ('' for more than one).
    const fresh: Record<MergeSide, Map<string, { concept: string; element: string }>> = { ours: new Map(), theirs: new Map() };
    for (const side of SIDES) {
      for (const line of this.added[side]) {
        const { s, p, refs } = this.parse(line);
        if (p !== via || this.base.hasSubject(s) || placed.has(s)) continue;
        const view = this.side[side].of(s).find((l) => this.parse(l).p === IRI.visView);
        if (!view) continue;
        const key = `${refs[0]} ${this.parse(view).o}`;
        const before = fresh[side].get(key);
        // A side that placed it twice did so itself; not the merge's doing.
        fresh[side].set(key, { concept: refs[0], element: before === undefined || before.element === s ? s : '' });
      }
    }
    for (const [key, { concept, element: ours }] of fresh.ours) {
      const theirs = fresh.theirs.get(key)?.element;
      if (!ours || !theirs || ours === theirs) continue;
      if (!this.merged.has(`${ours} <${via}> ${concept} .`) || !this.merged.has(`${theirs} <${via}> ${concept} .`)) continue;
      const options = { ours: this.drawnAt('ours', ours), theirs: this.drawnAt('theirs', theirs) };
      // Held: both, as merged — picking a side keeps that one alone.
      const held = [...new Set([...options.ours, ...options.theirs])].sort();
      for (const line of held) placed.add(subjectOf(line));
      this.conflicts.push({ kind: 'placement', subjects: [ours, theirs].map(iriOf).sort(), held, options });
    }
  }

  /**
   * What `side` drew at a node or link it added: the lines about it, its parts,
   * and the links it added that end at it (with their parts) — the lines
   * pointing at any of them, and the `arch:inView` it added for what they draw
   * there (`view-manager.ts` writes it with the node or link).
   */
  private drawnAt(side: MergeSide, element: string): string[] {
    const scope = new Set([element]);
    const isNew = (s: string) => !this.base.hasSubject(s) && this.side[side].hasSubject(s);
    for (let grew = true; grew; ) {
      grew = false;
      for (const line of this.added[side]) {
        const { s, p, refs } = this.parse(line);
        const reach = scope.has(s)
          ? OWNS.has(p)
            ? refs.filter((r) => isNew(r) && !scope.has(r))
            : []
          : LINK_ENDS.has(p) && isNew(s) && refs.some((r) => scope.has(r))
            ? [s]
            : [];
        for (const n of reach) scope.add(n);
        if (reach.length > 0) grew = true;
      }
    }
    // What they draw, and where: an `arch:inView` the side added for it goes with them.
    const shown = new Set<string>();
    for (const line of this.added[side]) {
      const { s, p, o } = this.parse(line);
      if (scope.has(s) && (p === IRI.archElement || p === IRI.archRelationship)) {
        const view = this.side[side].of(s).find((l) => this.parse(l).p === IRI.visView);
        if (view) shown.add(`${o} <${IRI.inView}> ${this.parse(view).o} .`);
      }
    }
    return this.added[side].filter((line) => shown.has(line) || this.nodesOf(line).some((n) => scope.has(n))).sort();
  }

  // ── Count limits ─────────────────────────────────────────────────────

  private countLimits(check: CountCheck): void {
    const touched = (side: MergeSide) => {
      const nodes = new Set<string>();
      for (const line of [...this.added[side], ...this.removed[side]]) for (const n of this.nodesOf(line)) nodes.add(n);
      return nodes;
    };
    const ours = touched('ours');
    const isSubject = (n: string) => [this.base, this.side.ours, this.side.theirs].some((v) => v.hasSubject(n));
    const focus = [...touched('theirs')].filter((n) => ours.has(n) && isSubject(n)).sort();
    if (focus.length === 0) return;
    const merged = sortedOf(this.merged);
    const found = check(merged, focus);
    if (found.length === 0) return;
    const key = (f: CountFinding) => `${f.focus} ${f.path} ${f.component}`;
    const alone = new Set([...check(sortedOf(this.given.ours), focus), ...check(sortedOf(this.given.theirs), focus)].map(key));
    const seen = new Set<string>();
    for (const finding of found) {
      const k = key(finding);
      if (alone.has(k) || seen.has(k)) continue;
      seen.add(k);
      const values = (lines: Iterable<string>) =>
        finding.path ? [...lines].filter((l) => subjectOf(l) === finding.focus && this.parse(l).p === finding.path).sort() : [];
      const candidates = [...this.base.of(finding.focus), ...this.side.ours.of(finding.focus), ...this.side.theirs.of(finding.focus)];
      this.conflicts.push({
        kind: 'count',
        subjects: [iriOf(finding.focus)],
        ...(finding.path ? { predicate: finding.path } : {}),
        message: finding.message,
        held: values(new Set(candidates.filter((l) => this.merged.has(l)))),
        options: { ours: values(this.side.ours.of(finding.focus)), theirs: values(this.side.theirs.of(finding.focus)) },
      });
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function termOf(term: string): Term {
  return (term.startsWith('_:') ? DataFactory.blankNode(term.slice(2)) : DataFactory.namedNode(iriOf(term))) as unknown as Term;
}

/**
 * Snapshot lines back as quads, blank-node labels as they are — so they match
 * the quads of the store the snapshot was taken from.
 */
export function quadsOfSnapshot(lines: readonly string[]): Quad[] {
  if (lines.length === 0) return [];
  return new N3Parser({ format: 'N-Triples', blankNodePrefix: '' }).parse(lines.join('\n')) as unknown as Quad[];
}

/** A side's latest value: its greatest line — `xsd:dateTime`s in one form sort as they fall in time. */
function latestOf(lines: readonly string[]): string {
  return lines.reduce((max, line) => (line > max ? line : max), '');
}

/** Which of a relationship's ends two connections differ in (its type when neither). */
function differingEnd(a: readonly string[], b: readonly string[]): string {
  const of = (lines: readonly string[], p: string) => lines.filter((l) => predicateOf(l) === p).join('\n');
  return [IRI.source, IRI.target].find((p) => of(a, p) !== of(b, p)) ?? RDF_TYPE;
}

function unitKey(unit: Unit): string {
  if (unit.kind !== 'value') return `${unit.kind} ${unit.subject}`;
  return `value ${unit.subject} ${unit.predicate} ${unit.language ?? '*'}`;
}

function byConflict(a: MergeConflict, b: MergeConflict): number {
  const key = (c: MergeConflict) => [c.subjects.join(' '), c.predicate ?? '', c.language ?? '', c.message ?? ''].join('\u0000');
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sortedOf(lines: Iterable<string>): string[] {
  return [...lines].sort();
}

/** Disjoint sets of strings. */
class UnionFind {
  private readonly parent = new Map<string, string>();

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: string): string {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    for (let n = x; n !== root; ) {
      const next = this.parent.get(n) as string;
      this.parent.set(n, root);
      n = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }

  sets(): string[][] {
    const groups = new Map<string, string[]>();
    for (const x of this.parent.keys()) push(groups, this.find(x), x);
    return [...groups.values()];
  }
}
