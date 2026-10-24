/**
 * Whether each relationship is one the language permits, checked against its
 * relationship tables — in place of the relationship shapes generated from the
 * same tables (Task 22).
 *
 * ## Why not the shapes
 *
 * The shapes a language's relationship matrix generates check a relationship
 * against an `sh:or` of every source–target pair it permits. A SHACL engine
 * tries the pairs in turn, and rdf-validate-shacl builds a full result for each
 * one that fails — copying part of the shapes graph into it — before throwing
 * it away: on a model of 34 000 triples, 12 of the 14 seconds validation took,
 * after every edit. The relationship tables (`direct-permissions.ts`) say the
 * same as lookups: here, a few map lookups per relationship.
 *
 * ## Which shapes, and how the check stays theirs
 *
 * {@link splitTableShapes} takes out of the shapes graph only what the tables
 * cover, recognised by its form, in any language whose tables follow the
 * pattern:
 *
 * - **qualified** — a node shape whose `sh:targetClass` is a relationship class
 *   whose `arch:unqualifiedForm` the tables cover, made of an `sh:or` (its
 *   permitted pairs) and nothing else;
 * - **unqualified** — a node shape whose property shapes all have a covered
 *   predicate as `sh:path`, each an `sh:or` of classes or `sh:maxCount 0`.
 *
 * Every other shape stays — an attribute shape on a relationship class, the
 * element, viewpoint and principle shapes. {@link checkRelationshipsByTables}
 * then reports what the replaced shapes would: a qualified relationship whose
 * source and target the tables do not permit, and a direct triple whose subject
 * a replaced shape targets and whose object the tables do not permit — under
 * the replaced shape's IRI and its `sh:message`.
 *
 * Junctions: the shapes let a junction be either end of any relationship; the
 * tables do not name them. They are read from the replaced shapes — a class the
 * shapes accept that the tables never name and that is not a relationship class.
 */
import { DataFactory, Store as N3Store } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { TablePermissions } from './direct-permissions.js';
import type { TypeClosure } from './model-queries.js';

const { namedNode } = DataFactory;

const SH = NAMESPACES.sh;
const RDF_TYPE = NAMESPACES.rdf + 'type';
const ARCH_SOURCE = NAMESPACES.arch + 'source';
const ARCH_TARGET = NAMESPACES.arch + 'target';
const WILDCARDS = new Set([NAMESPACES.arch + 'Element', NAMESPACES.arch + 'ModelConcept']);
/** What a node shape may say besides its constraint and still be a generated one. */
const DESCRIPTIVE = new Set([
  RDF_TYPE,
  SH + 'targetClass',
  SH + 'message',
  SH + 'severity',
  SH + 'name',
  SH + 'description',
  NAMESPACES.rdfs + 'label',
  NAMESPACES.rdfs + 'comment',
  NAMESPACES.skos + 'prefLabel',
  NAMESPACES.skos + 'definition',
]);
const PROPERTY_SHAPE_KEYS = new Set([SH + 'path', SH + 'or', SH + 'maxCount', SH + 'message', SH + 'severity']);

/** A replaced shape, as its results name it. */
interface Replaced {
  shape: string;
  message: string;
}

/** The shapes graph, split: what SHACL still checks, and what the tables check instead. */
export interface TableShapes {
  /** The shapes graph without the replaced shapes. */
  kept: Quad[];
  /** Quads taken out. */
  replacedQuads: number;
  /** Relationship class → the qualified shape replaced, and the predicate the tables check it by. */
  qualified: ReadonlyMap<string, Replaced & { predicate: string }>;
  /** Subject class → predicate → the unqualified shape replaced (its property's message). */
  unqualified: ReadonlyMap<string, ReadonlyMap<string, Replaced>>;
  /** The junction classes: either end of any relationship. */
  junctions: ReadonlySet<string>;
}

/** Nothing replaced: no tables loaded, or no shape in their form. */
export function noTableShapes(shapes: Quad[]): TableShapes {
  return { kept: shapes, replacedQuads: 0, qualified: new Map(), unqualified: new Map(), junctions: new Set() };
}

/**
 * Split a shapes graph into what SHACL keeps checking and what the tables
 * check instead.
 *
 * @param formOf A relationship class's `arch:unqualifiedForm`.
 * @param isRelationshipClass Whether a class is a relationship class (`arch:QualifiedRelationship` or under it).
 */
export function splitTableShapes(
  shapes: Quad[],
  tables: TablePermissions,
  formOf: ReadonlyMap<string, string>,
  isRelationshipClass: (classIri: string) => boolean,
): TableShapes {
  if (tables.size === 0) return noTableShapes(shapes);
  const index = new N3Store(shapes as never);
  const subjectQuads = (s: Term) => index.getQuads(s as never, null, null, null) as unknown as Quad[];
  const objects = (s: Term, p: string) => index.getObjects(s as never, namedNode(p), null) as unknown as Term[];
  const literal = (s: Term, p: string) => objects(s, p).find((o) => o.termType === 'Literal')?.value ?? '';

  const qualified = new Map<string, Replaced & { predicate: string }>();
  const unqualified = new Map<string, Map<string, Replaced>>();
  const dropped: Term[] = [];

  for (const shape of index.getSubjects(namedNode(RDF_TYPE), namedNode(SH + 'NodeShape'), null) as unknown as Term[]) {
    if (shape.termType !== 'NamedNode') continue;
    const keys = new Set(subjectQuads(shape).map((q) => q.predicate.value));
    const targets = objects(shape, SH + 'targetClass').map((t) => t.value);
    if (targets.length === 0) continue;
    const others = [...keys].filter((k) => !DESCRIPTIVE.has(k));

    // Qualified: an sh:or of permitted pairs, on relationship classes the tables cover.
    if (others.length === 1 && others[0] === SH + 'or') {
      const forms = targets.map((t) => formOf.get(t));
      if (forms.every((p): p is string => !!p && tables.covers(p))) {
        targets.forEach((t, i) => qualified.set(t, { shape: shape.value, message: literal(shape, SH + 'message'), predicate: forms[i] as string }));
        dropped.push(shape);
      }
      continue;
    }

    // Unqualified: property shapes only, each on a covered predicate, an sh:or or sh:maxCount 0.
    if (others.length === 1 && others[0] === SH + 'property') {
      const properties = objects(shape, SH + 'property');
      const byPredicate = new Map<string, Replaced>();
      const generated = properties.every((property) => {
        const pkeys = subjectQuads(property).map((q) => q.predicate.value);
        if (!pkeys.every((k) => PROPERTY_SHAPE_KEYS.has(k))) return false;
        const path = objects(property, SH + 'path')[0];
        if (!path || path.termType !== 'NamedNode' || !tables.covers(path.value)) return false;
        const max = objects(property, SH + 'maxCount')[0];
        if (max && max.value !== '0') return false;
        if (!max && !pkeys.includes(SH + 'or')) return false;
        byPredicate.set(path.value, { shape: shape.value, message: literal(property, SH + 'message') });
        return true;
      });
      if (generated && byPredicate.size > 0) {
        for (const target of targets) {
          const forSource = unqualified.get(target) ?? new Map<string, Replaced>();
          for (const [p, r] of byPredicate) forSource.set(p, r);
          unqualified.set(target, forSource);
        }
        dropped.push(shape);
      }
    }
  }

  // The dropped shapes and every blank node reachable from them.
  const gone = new Set<string>();
  const key = (t: Term) => `${t.termType}:${t.value}`;
  const stack = [...dropped];
  const accepted = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop() as Term;
    if (gone.has(key(node))) continue;
    gone.add(key(node));
    for (const q of subjectQuads(node)) {
      if (q.predicate.value === SH + 'class' && q.object.termType === 'NamedNode') accepted.add(q.object.value);
      if (q.object.termType === 'BlankNode') stack.push(q.object);
    }
  }
  const kept = shapes.filter((q) => !gone.has(key(q.subject)));
  const junctions = new Set(
    [...accepted].filter((c) => !WILDCARDS.has(c) && !tables.mentions(c) && !isRelationshipClass(c)),
  );
  return { kept, replacedQuads: shapes.length - kept.length, qualified, unqualified, junctions };
}

/**
 * The violations the replaced shapes would report for `data` (the model, with
 * the class hierarchy), found by the tables.
 */
export function checkRelationshipsByTables(
  data: readonly Quad[],
  split: TableShapes,
  tables: TablePermissions,
  closure: TypeClosure,
): ValidationResult[] {
  if (split.qualified.size === 0 && split.unqualified.size === 0) return [];
  const id = (t: Term) => (t.termType === 'BlankNode' ? `_:${t.value}` : t.value);
  const types = new Map<string, string[]>();
  const sources = new Map<string, Term>();
  const targets = new Map<string, Term>();
  const direct: Quad[] = [];
  for (const q of data) {
    const s = id(q.subject);
    const p = q.predicate.value;
    if (p === RDF_TYPE && q.object.termType === 'NamedNode') {
      const list = types.get(s);
      if (list) list.push(q.object.value);
      else types.set(s, [q.object.value]);
    } else if (p === ARCH_SOURCE) sources.set(s, q.object);
    else if (p === ARCH_TARGET) targets.set(s, q.object);
    else if (tables.covers(p)) direct.push(q);
  }
  const closures = new Map<string, string[]>();
  const closureOf = (t: Term): string[] => {
    const k = id(t);
    let c = closures.get(k);
    if (!c) {
      const set = new Set<string>();
      for (const type of types.get(k) ?? []) for (const sup of closure(type)) set.add(sup);
      c = [...set];
      closures.set(k, c);
    }
    return c;
  };
  const junction = (t: Term) => closureOf(t).some((c) => split.junctions.has(c));
  const permitted = (predicate: string, source: Term, target: Term) =>
    junction(source) || junction(target) || tables.holds(predicate, closureOf(source), closureOf(target)) === true;

  const results: ValidationResult[] = [];
  const result = (focus: Term, path: string, replaced: Replaced, component: string): ValidationResult => ({
    focusNode: namedNode(focus.value) as unknown as NamedNode,
    resultPath: namedNode(path) as unknown as NamedNode,
    sourceShape: namedNode(replaced.shape) as unknown as NamedNode,
    message: replaced.message,
    severity: 'Violation',
    sourceConstraintComponent: namedNode(SH + component) as unknown as NamedNode,
  });

  // Qualified relationships: their class (or a superclass) has a replaced shape.
  for (const [s, ownTypes] of types) {
    const shapes = new Map<string, Replaced & { predicate: string }>();
    for (const type of ownTypes) for (const c of closure(type)) {
      const q = split.qualified.get(c);
      if (q) shapes.set(q.shape, q);
    }
    if (shapes.size === 0) continue;
    const source = sources.get(s);
    const target = targets.get(s);
    if (!source || !target) continue; // the shape's pairs pass vacuously without one
    const focus = s.startsWith('_:') ? DataFactory.blankNode(s.slice(2)) : namedNode(s);
    for (const replaced of shapes.values()) {
      if (!permitted(replaced.predicate, source, target)) results.push(result(focus, '', replaced, 'OrConstraintComponent'));
    }
  }

  // Direct triples: the subject's class (or a superclass) has a replaced shape for the predicate.
  for (const q of direct) {
    const replaced = closureOf(q.subject)
      .map((c) => split.unqualified.get(c)?.get(q.predicate.value))
      .find((r): r is Replaced => !!r);
    if (!replaced) continue;
    if (!permitted(q.predicate.value, q.subject, q.object)) {
      results.push(result(q.subject, q.predicate.value, replaced, 'OrConstraintComponent'));
    }
  }
  return results;
}
