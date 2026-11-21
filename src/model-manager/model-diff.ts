/**
 * Two versions of a model compared by element: which concepts were added,
 * removed or changed, and how — not a list of triples. What a review reads: a
 * branch against main, a Git commit against the one before it, a checkpoint
 * against the model now (the History tab), and — from the same code — what CI
 * posts on a merge request.
 *
 * Both versions are snapshots ({@link snapshotOf}). Every line added or removed
 * is put under the concept it is about:
 *
 * - a concept's own lines (its subject's), under it;
 * - a relationship's unqualified triple — the one its `rdf:reifies` names — and
 *   the qualified predicate leading to it from its source, under the
 *   relationship: they change with its ends, which already say so;
 * - a diagram's shapes — its nodes and links, with their route cells, points
 *   and label nodes — under the view they are drawn in, as shapes placed,
 *   removed, moved, resized, rerouted or reconnected;
 * - `X arch:inView V`, under the view, as what it shows — only where no shape
 *   placed or removed already says so.
 *
 * A property that takes one value (or one per language: `single-valued.ts`, as
 * the merge and the room read them) is shown as its old value and its new; a
 * changed type too. Any other property as values added and removed — but not a
 * relationship's `rdf:reifies`, which changes with its ends.
 *
 * The provenance of edits is not a change of its own (Req 9.16): a concept's
 * `dcterms:created` and `dcterms:modified`, every PROV statement, and the
 * activities, users and tools PROV types change with every edit, and say only
 * when and by whom. They are left out here — the changes by element are what
 * changed — and stay in the triples added and removed (`lines`). What they say
 * is given with the change instead ({@link ConceptChange.edit}): who made it,
 * when, with what — where the later version records an edit the earlier does
 * not, so a change made where nothing records it names nobody.
 */

import { SingleValued } from '../rdf-engine/single-valued.js';
import { diffSnapshots, type SnapshotDiff } from './version-history.js';
import { BOUNDS_PREDICATES, IRI, localName } from './vocabulary.js';
import { iriOf, literalValue, parseLine, predicateOf, subjectOf, type Line } from './snapshot-lines.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const PROV_TERM = `<${NAMESPACES.prov}`;
const STAMPS = new Set([IRI.dctermsCreated, IRI.dctermsModified]);
const PROV = {
  generatedBy: NAMESPACES.prov + 'wasGeneratedBy',
  at: NAMESPACES.prov + 'generatedAtTime',
  associated: NAMESPACES.prov + 'wasAssociatedWith',
  person: NAMESPACES.prov + 'Person',
  software: NAMESPACES.prov + 'SoftwareAgent',
};
const SCHEMA = {
  name: new Set([NAMESPACES.schema + 'name']),
  alternateName: new Set([NAMESPACES.schema + 'alternateName']),
  email: new Set([NAMESPACES.schema + 'email']),
  sameAs: new Set([NAMESPACES.schema + 'sameAs']),
  softwareVersion: new Set([NAMESPACES.schema + 'softwareVersion']),
};

/** What records an edit rather than makes one: a date stamp, a PROV statement, a resource PROV types. */
function provenanceFilter(...versions: ReadonlyArray<readonly string[]>): (line: string) => boolean {
  const recorded = new Set<string>();
  for (const lines of versions) {
    for (const line of lines) {
      if (predicateOf(line) === IRI.rdfType && line.includes(PROV_TERM, line.indexOf('> <') + 3)) {
        const o = parseLine(line).o;
        if (o.startsWith(PROV_TERM)) recorded.add(subjectOf(line));
      }
    }
  }
  return (line) => {
    const p = predicateOf(line);
    return STAMPS.has(p) || p.startsWith(NAMESPACES.prov) || recorded.has(subjectOf(line));
  };
}

/** What a concept is, as the diff groups it. */
export type ConceptKind = 'model' | 'element' | 'relationship' | 'view' | 'folder' | 'other';

/** Whether a concept, or a shape, is new, gone or changed. */
export type ChangeStatus = 'added' | 'removed' | 'changed';

/**
 * A property that takes one value (or one per language): what it was and what
 * it is now, as N-Triples terms — empty where there was none, or is none.
 */
export interface ValueChange {
  predicate: string;
  /** A property that takes one value per language: which (`''` for none). */
  language?: string;
  from: string[];
  to: string[];
}

/** A value of a property that takes several, added or removed. */
export interface PropertyValue {
  predicate: string;
  /** As an N-Triples term. */
  object: string;
}

/** A node's position and size. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A node or a link in a view, placed, removed or changed. */
export interface ShapeChange {
  /** The node or link (an IRI, or `_:label`). */
  shape: string;
  kind: 'node' | 'link';
  /** What it shows: the element or the relationship. */
  shows?: string;
  status: ChangeStatus;
  /** A changed one: what changed. */
  moved?: boolean;
  resized?: boolean;
  rerouted?: boolean;
  reconnected?: boolean;
  /** Anything else about it: its style, its label's place. */
  restyled?: boolean;
  bounds?: { from?: Bounds; to?: Bounds };
}

/** Who made a concept's change, when and with what, as the later version records its last edit (Req 9.16). */
export interface EditRecord {
  /** When: its `prov:generatedAtTime`, ISO 8601. */
  at?: string;
  /** Who: the user's name, else their username, else their address. */
  by?: string;
  /** Their Git account's page. */
  account?: string;
  /** With what: the tool's name and version. */
  tool?: string;
}

/** One concept's changes. */
export interface ConceptChange {
  /** The concept (an IRI, or `_:label`). */
  subject: string;
  kind: ConceptKind;
  status: ChangeStatus;
  /** Single values, old → new; for a concept added, each with nothing before. */
  values: ValueChange[];
  /** Values added, of properties that take several (its types and `arch:inModel` left out for a concept added or removed). */
  added: PropertyValue[];
  removed: PropertyValue[];
  /** A relationship's ends, in the version it is in (the later, in both). */
  ends?: { source?: string; target?: string };
  /** A view's shapes. */
  shapes: ShapeChange[];
  /** What a view shows, by `arch:inView`, that no shape placed or removed accounts for. */
  shows: { added: string[]; removed: string[] };
  /** Who made the change, when, with what — where the later version records an edit of it the earlier does not. */
  edit?: EditRecord;
  /** Every line put under it. */
  lines: SnapshotDiff;
}

/** What is known of a concept or value named in the diff, from the versions compared. */
export interface Described {
  /** Its name, in the later version that has one. */
  name?: string;
  /** Its types, in the later version that has it. */
  types: string[];
}

/** Two versions compared by element. */
export interface ModelDiff {
  /** By kind (model, elements, relationships, views, folders, the rest), then name. */
  changes: ConceptChange[];
  /** How many concepts were added, removed and changed. */
  counts: Record<ChangeStatus, number>;
  /** Every concept, shape and value IRI the changes name: its name and types. */
  about: Record<string, Described>;
  /** Every line added and removed. */
  lines: SnapshotDiff;
}

/** Options for {@link diffByElement}. */
export interface DiffOptions {
  /** Which properties take one value; the built-in rules when absent. */
  singleValued?: SingleValued;
  /** The language a name is preferred in (`en` when absent). */
  language?: string;
}

const KIND_ORDER: readonly ConceptKind[] = ['model', 'element', 'relationship', 'view', 'folder', 'other'];
const STATUS_ORDER: readonly ChangeStatus[] = ['added', 'changed', 'removed'];
/** Where a name is read from, in this order. */
const NAME_PREDICATES = [IRI.prefLabel, 'https://schema.org/name', 'http://schema.org/name', IRI.rdfsLabel, IRI.dctermsTitle];
/** What a subject names with one of these is part of it: a link's route cells and label, a cell's point and next cell. */
const OWNS = new Set<string>([IRI.points, IRI.rdfFirst, IRI.rdfRest, IRI.visLabel]);
const SOURCES = new Set<string>([IRI.source, IRI.legacyRelSource]);
const RELATIONSHIP_MARKS = new Set<string>([IRI.source, IRI.target, IRI.reifies, IRI.legacyRelSource, IRI.legacyRelTarget]);
const VIEW_TYPES = new Set<string>([IRI.View, IRI.Diagram, IRI.Catalog, IRI.Matrix]);
const SHAPE_TYPES = new Set<string>([IRI.ArchNode, IRI.Link, IRI.Point, IRI.LabelNode]);
const BOUNDS = new Set<string>(BOUNDS_PREDICATES);
const LINK_ENDS = new Set<string>([IRI.visSource, IRI.visTarget]);
const SHOWS = new Set<string>([IRI.archElement, IRI.archRelationship]);
/** Left out of a concept added or removed: its types are given apart, its membership of the model goes without saying. */
const WHOLE_LEFT_OUT = new Set<string>([IRI.rdfType, IRI.inModel]);
/** Left out always: the triple a relationship reifies changes with its ends, which say so. */
const LEFT_OUT = new Set<string>([IRI.reifies]);

/** Compare `from` with `to`, both snapshots, by element. */
export function diffByElement(from: readonly string[], to: readonly string[], options: DiffOptions = {}): ModelDiff {
  const lines = diffSnapshots(from, to);
  const counts: Record<ChangeStatus, number> = { added: 0, removed: 0, changed: 0 };
  if (lines.added.length + lines.removed.length === 0) return { changes: [], counts, about: {}, lines };
  const rules = options.singleValued ?? SingleValued.builtIn();
  const before = new Version(from);
  const after = new Version(to);
  const versions: Record<'added' | 'removed', Version> = { added: after, removed: before };
  const recordsAnEdit = provenanceFilter(from, to);
  // A concept whose record of its last edit is new: it was edited where an edit is recorded.
  const recorded = new Set(lines.added.filter((l) => predicateOf(l) === PROV.generatedBy).map(subjectOf));

  // ── Each line under its concept ──
  const groups = new Map<string, Group>();
  const group = (term: string): Group => {
    let g = groups.get(term);
    if (!g) {
      g = { own: { added: [], removed: [] }, lines: { added: [], removed: [] }, shapes: new Map(), shows: { added: new Set(), removed: new Set() } };
      groups.set(term, g);
    }
    return g;
  };
  for (const side of ['added', 'removed'] as const) {
    const version = versions[side];
    for (const line of lines[side]) {
      if (recordsAnEdit(line)) continue;
      const parsed = parseLine(line);
      let owner: string;
      if (parsed.p === IRI.inView && parsed.refs.length === 1) {
        owner = parsed.o;
        group(owner).shows[side].add(parsed.s);
      } else if (version.reifier.has(line)) {
        owner = version.reifier.get(line)!;
      } else if (parsed.refs.length === 1 && version.sourceOf.get(parsed.o) === parsed.s && isQualifiedPointer(parsed.p)) {
        owner = parsed.o;
      } else {
        const shape = version.shapeOf(parsed.s);
        if (shape !== undefined) {
          owner = version.viewOf.get(shape)!;
          const shapes = group(owner).shapes;
          const changed = shapes.get(shape) ?? { added: [], removed: [] };
          changed[side].push(parsed);
          shapes.set(shape, changed);
        } else {
          owner = parsed.s;
          group(owner).own[side].push(parsed);
        }
      }
      group(owner).lines[side].push(line);
    }
  }

  // ── Each concept's change ──
  const named = new Set<string>();
  const changes: ConceptChange[] = [];
  for (const [term, g] of groups) {
    const status: ChangeStatus = before.has(term) ? (after.has(term) ? 'changed' : 'removed') : after.has(term) ? 'added' : 'changed';
    const version = status === 'removed' ? before : after;
    const types = version.types(term).length > 0 ? version.types(term) : before.types(term);
    const change: ConceptChange = {
      subject: iriOf(term),
      kind: kindOf(term, types, before, after),
      status,
      values: [],
      added: [],
      removed: [],
      shapes: [],
      shows: { added: [], removed: [] },
      lines: g.lines,
    };
    const edit = status !== 'removed' && recorded.has(term) ? after.edit(term) : undefined;
    if (edit) change.edit = edit;
    named.add(term);

    // Its own lines: single values paired, the rest as values added and removed.
    const whole = status !== 'changed';
    const values = new Map<string, ValueChange>();
    const retyped = !whole && g.own.added.some((l) => l.p === IRI.rdfType) && g.own.removed.some((l) => l.p === IRI.rdfType);
    for (const side of ['removed', 'added'] as const) {
      for (const line of g.own[side]) {
        if (LEFT_OUT.has(line.p) || (whole && WHOLE_LEFT_OUT.has(line.p))) continue;
        const limit = line.p === IRI.rdfType ? (retyped ? 'one' : undefined) : rules.mayLimit(line.p) ? rules.limitOf(line.p, () => types) : undefined;
        for (const ref of line.refs) named.add(ref);
        if (limit === undefined) {
          change[side].push({ predicate: line.p, object: line.o });
          continue;
        }
        const perLanguage = limit === 'one-per-language';
        const key = perLanguage ? `${line.p}@${line.lang}` : line.p;
        let value = values.get(key);
        if (!value) {
          value = { predicate: line.p, ...(perLanguage ? { language: line.lang } : {}), from: [], to: [] };
          values.set(key, value);
        }
        (side === 'removed' ? value.from : value.to).push(line.o);
      }
    }
    change.values = [...values.values()].sort(byPredicate);
    change.added.sort(byPredicate);
    change.removed.sort(byPredicate);

    if (change.kind === 'relationship') {
      const source = version.objectOf(term, SOURCES) ?? before.objectOf(term, SOURCES);
      const target = version.objectOf(term, new Set([IRI.target, IRI.legacyRelTarget])) ?? before.objectOf(term, new Set([IRI.target, IRI.legacyRelTarget]));
      change.ends = { ...(source ? { source: iriOf(source) } : {}), ...(target ? { target: iriOf(target) } : {}) };
      if (source) named.add(source);
      if (target) named.add(target);
    }

    // A view's shapes, and what it shows that they do not account for.
    for (const [shape, changed] of g.shapes) change.shapes.push(shapeChange(shape, changed, before, after));
    change.shapes.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || compare(a.shape, b.shape));
    for (const s of change.shapes) if (s.shows) named.add(`<${s.shows}>`);
    for (const side of ['added', 'removed'] as const) {
      const placed = new Set(change.shapes.filter((s) => s.status === side && s.shows).map((s) => `<${s.shows}>`));
      change.shows[side] = [...g.shows[side]].filter((c) => !placed.has(c)).sort().map(iriOf);
      for (const c of g.shows[side]) named.add(c);
    }
    counts[status]++;
    changes.push(change);
  }

  // ── What the changes name ──
  const about: Record<string, Described> = {};
  const language = (options.language ?? 'en').toLowerCase();
  for (const term of named) {
    if (!term.startsWith('<') && !term.startsWith('_:')) continue;
    const name = after.name(term, language) ?? before.name(term, language);
    const types = after.types(term).length > 0 ? after.types(term) : before.types(term);
    about[iriOf(term)] = { ...(name !== undefined ? { name } : {}), types };
  }
  const nameOf = (c: ConceptChange) => about[c.subject]?.name ?? '';
  changes.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compare(nameOf(a).toLowerCase(), nameOf(b).toLowerCase()) || compare(a.subject, b.subject));
  return { changes, counts, about, lines };
}

/** Lines under one concept, as they come. */
interface Group {
  own: Record<'added' | 'removed', Line[]>;
  lines: SnapshotDiff;
  shapes: Map<string, Record<'added' | 'removed', Line[]>>;
  shows: Record<'added' | 'removed', Set<string>>;
}

/** One version: its lines by subject, and the structure the diff needs to put a line under its concept. */
class Version {
  private bySubject?: Map<string, string[]>;
  /** A route cell, point or label node → what it is part of. */
  private readonly ownerOf = new Map<string, string>();
  /** A shape → its view. */
  readonly viewOf = new Map<string, string>();
  /** A reified triple's line → the relationship reifying it. */
  readonly reifier = new Map<string, string>();
  /** A relationship → its source. */
  readonly sourceOf = new Map<string, string>();
  readonly relationships = new Set<string>();

  constructor(private readonly lines: readonly string[]) {
    for (const line of lines) {
      const p = predicateOf(line);
      if (OWNS.has(p)) {
        const { s, refs } = parseLine(line);
        for (const ref of refs) if (!this.ownerOf.has(ref)) this.ownerOf.set(ref, s);
      } else if (p === IRI.visView) {
        const { s, o } = parseLine(line);
        this.viewOf.set(s, o);
      } else if (RELATIONSHIP_MARKS.has(p)) {
        const { s, o, refs } = parseLine(line);
        this.relationships.add(s);
        if (SOURCES.has(p)) this.sourceOf.set(s, o);
        if (p === IRI.reifies && refs.length === 3) this.reifier.set(`${refs[0]} ${refs[1]} ${refs[2]} .`, s);
      }
    }
  }

  has(subject: string): boolean {
    return this.index().has(subject);
  }

  of(subject: string): readonly string[] {
    return this.index().get(subject) ?? [];
  }

  /** The shape a subject is, or is part of; `undefined` for anything else. */
  shapeOf(subject: string): string | undefined {
    const seen = new Set<string>();
    for (let at: string | undefined = subject; at !== undefined && !seen.has(at); at = this.ownerOf.get(at)) {
      if (this.viewOf.has(at)) return at;
      seen.add(at);
    }
    return undefined;
  }

  /** Its types' IRIs. */
  types(subject: string): string[] {
    return this.of(subject)
      .filter((l) => predicateOf(l) === IRI.rdfType)
      .map((l) => iriOf(parseLine(l).o));
  }

  /** The object of its first line with one of `predicates`. */
  objectOf(subject: string, predicates: ReadonlySet<string>): string | undefined {
    const line = this.of(subject).find((l) => predicates.has(predicateOf(l)));
    return line === undefined ? undefined : parseLine(line).o;
  }

  /** Its last edit, as recorded: the activity that generated it, the user and the tool that activity is associated with. */
  edit(subject: string): EditRecord | undefined {
    const activity = this.objectOf(subject, new Set([PROV.generatedBy]));
    if (!activity?.startsWith('<')) return undefined;
    const text = (term: string, predicates: ReadonlySet<string>) => {
      const o = this.objectOf(term, predicates);
      return o === undefined ? undefined : o.startsWith('<') ? iriOf(o) : literalValue(o);
    };
    const record: EditRecord = {};
    const at = text(subject, new Set([PROV.at]));
    if (at) record.at = at;
    for (const line of this.of(activity)) {
      if (predicateOf(line) !== PROV.associated) continue;
      const agent = parseLine(line).o;
      const types = this.types(agent);
      if (types.includes(PROV.software)) {
        record.tool = [text(agent, SCHEMA.name) ?? iriOf(agent), text(agent, SCHEMA.softwareVersion)].filter(Boolean).join(' ');
      } else if (types.includes(PROV.person)) {
        const by = text(agent, SCHEMA.name) ?? text(agent, SCHEMA.alternateName) ?? text(agent, SCHEMA.email);
        const account = text(agent, SCHEMA.sameAs);
        if (by) record.by = by;
        if (account) record.account = account;
      }
    }
    return Object.keys(record).length > 0 ? record : undefined;
  }

  /** Its name: the first property of {@link NAME_PREDICATES} it has, in `language`, else without one, else the first. */
  name(subject: string, language: string): string | undefined {
    const own = this.of(subject);
    for (const predicate of NAME_PREDICATES) {
      const names = own.map(parseLine).filter((l) => l.p === predicate && l.o.startsWith('"'));
      if (names.length === 0) continue;
      const pick = names.find((l) => l.lang === language) ?? names.find((l) => l.lang === '') ?? names[0]!;
      return literalValue(pick.o);
    }
    return undefined;
  }

  private index(): Map<string, string[]> {
    if (!this.bySubject) {
      this.bySubject = new Map();
      for (const line of this.lines) {
        const s = subjectOf(line);
        const list = this.bySubject.get(s);
        if (list) list.push(line);
        else this.bySubject.set(s, [line]);
      }
    }
    return this.bySubject;
  }
}

function kindOf(term: string, types: readonly string[], before: Version, after: Version): ConceptKind {
  if (types.includes(IRI.Model)) return 'model';
  if (types.includes(IRI.Folder)) return 'folder';
  if (types.some((t) => VIEW_TYPES.has(t))) return 'view';
  if (before.relationships.has(term) || after.relationships.has(term)) return 'relationship';
  if (types.length > 0 && !types.some((t) => SHAPE_TYPES.has(t))) return 'element';
  return 'other';
}

/** A shape's change, from its lines added and removed. */
function shapeChange(shape: string, changed: Record<'added' | 'removed', Line[]>, before: Version, after: Version): ShapeChange {
  const status: ChangeStatus = before.has(shape) ? (after.has(shape) ? 'changed' : 'removed') : 'added';
  const version = status === 'removed' ? before : after;
  const own = version.of(shape).map(parseLine);
  const shows = own.find((l) => SHOWS.has(l.p))?.o;
  const link = own.some((l) => l.p === IRI.archRelationship || (l.p === IRI.rdfType && iriOf(l.o) === IRI.Link));
  const result: ShapeChange = {
    shape: iriOf(shape),
    kind: link ? 'link' : 'node',
    ...(shows ? { shows: iriOf(shows) } : {}),
    status,
  };
  if (status !== 'changed') return result;
  for (const line of [...changed.added, ...changed.removed]) {
    if (line.s !== shape) {
      if (link) result.rerouted = true;
      else result.restyled = true;
    } else if (BOUNDS.has(line.p)) {
      // Said below, from the bounds before and after.
    } else if (line.p === IRI.points) result.rerouted = true;
    else if (LINK_ENDS.has(line.p)) result.reconnected = true;
    else result.restyled = true;
  }
  const from = boundsOf(before, shape);
  const to = boundsOf(after, shape);
  if (from || to) {
    if (from?.x !== to?.x || from?.y !== to?.y) result.moved = true;
    if (from?.w !== to?.w || from?.h !== to?.h) result.resized = true;
    if (result.moved || result.resized) result.bounds = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return result;
}

function boundsOf(version: Version, shape: string): Bounds | undefined {
  const values: Record<string, number> = {};
  for (const line of version.of(shape)) {
    const p = predicateOf(line);
    if (BOUNDS.has(p)) values[p] = Number(literalValue(parseLine(line).o));
  }
  const [x, y, w, h] = BOUNDS_PREDICATES.map((p) => values[p]);
  return x === undefined && y === undefined && w === undefined && h === undefined
    ? undefined
    : { x: x ?? 0, y: y ?? 0, w: w ?? 0, h: h ?? 0 };
}

/** Whether a predicate leads from a relationship's source to it: a notation's `qualified…`, or core's fallback. */
function isQualifiedPointer(predicate: string): boolean {
  return predicate === IRI.hasQualifiedRelationship || localName(predicate).startsWith('qualified');
}

function byPredicate(a: { predicate: string; language?: string }, b: { predicate: string; language?: string }): number {
  return compare(a.predicate, b.predicate) || compare(a.language ?? '', b.language ?? '');
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
