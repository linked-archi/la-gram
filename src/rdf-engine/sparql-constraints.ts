/**
 * SHACL's SPARQL-based constraints (`sh:sparql` with `sh:select`), run with
 * Oxigraph — the rules `RdfShaclValidator` takes out of the shapes, because
 * rdf-validate-shacl cannot run them: ArchiMate's self-loops and principles,
 * the viewpoints' rules, core-vis's nesting. Phase 3 of the Git collaboration
 * plan: run in the validation engine, so the editor and CI report them alike.
 *
 * ## What is read of a shape
 *
 * - its targets: `sh:targetClass` (instances of the class and its subclasses),
 *   `sh:targetNode`, `sh:targetSubjectsOf`, `sh:targetObjectsOf`, and the
 *   implicit class target of a shape that is a class;
 * - each `sh:sparql` constraint's `sh:select`, with the prefixes its
 *   `sh:prefixes` declare (`sh:declare`), its `sh:message` (else the shape's),
 *   and the shape's `sh:severity` (a violation when none);
 * - `sh:deactivated true`, on the shape or the constraint, leaves it out.
 *
 * A property shape's constraint takes its `sh:path` as `$PATH` and as the
 * result's path when the path is one property; other paths are not supported
 * and the constraint is left out.
 *
 * ## How it is run
 *
 * One query per constraint: the shape's targets are joined into the query's
 * outer `WHERE`, binding `$this` — among the nodes validated, when only some
 * are (`VALUES $this { … }`). Each solution is a result: `$this` its
 * focus node, `?path` (else the shape's path) its path, `?value` its value; the
 * message's `{$this}`, `{?var}` take the solution's values.
 *
 * Pre-binding `$this` this way is what SHACL-SPARQL implementations do in
 * practice; it differs from the specification's pre-binding only for a `$this`
 * inside a sub-query, which no published Linked.Archi rule has.
 */

import type { Quad, Term } from '@rdfjs/types';
import { NAMESPACES } from './namespaces.js';
import type { ValidationResult, ValidationSeverity } from './interfaces.js';

const SH = NAMESPACES.sh;
const RDF_TYPE = NAMESPACES.rdf + 'type';
const RDFS_CLASS = NAMESPACES.rdfs + 'Class';
const OWL_CLASS = NAMESPACES.owl + 'Class';
const SPARQL_COMPONENT = `${SH}SPARQLConstraintComponent`;
const SEVERITIES: Record<string, ValidationSeverity> = {
  [`${SH}Violation`]: 'Violation',
  [`${SH}Warning`]: 'Warning',
  [`${SH}Info`]: 'Info',
};

/** A shape's targets. */
export interface ShapeTargets {
  classes: string[];
  nodes: string[];
  subjectsOf: string[];
  objectsOf: string[];
}

/** One SPARQL-based constraint of a shape, ready to run. */
export interface SparqlConstraint {
  /** The shape (an IRI, or `_:label`). */
  shape: string;
  /** The query, prefixes declared, `$PATH` replaced. */
  select: string;
  /** The message template: the constraint's, else the shape's; `''` for none. */
  message: string;
  severity: ValidationSeverity;
  targets: ShapeTargets;
  /** A property shape's path, when it is one property. */
  path?: string;
}

/** A constraint the shapes have that is not run, and why. */
export interface SkippedConstraint {
  shape: string;
  reason: string;
}

/** What {@link SparqlRunner} asks of a store: a SPARQL SELECT, answered as rows of N-Triples-like terms. */
export interface SparqlSelect {
  select(query: string): Array<Map<string, Term>>;
}

/** The SPARQL-based constraints of a shapes graph, and those that cannot be run. */
export function sparqlConstraintsOf(shapes: readonly Quad[]): { constraints: SparqlConstraint[]; skipped: SkippedConstraint[] } {
  const bySubject = new Map<string, Quad[]>();
  for (const q of shapes) {
    const key = idOf(q.subject as Term);
    const list = bySubject.get(key);
    if (list) list.push(q);
    else bySubject.set(key, [q]);
  }
  const objects = (subject: string, predicate: string): Term[] =>
    (bySubject.get(subject) ?? []).filter((q) => q.predicate.value === predicate).map((q) => q.object as Term);
  const value = (subject: string, predicate: string): string | undefined => objects(subject, predicate)[0]?.value;
  const deactivated = (subject: string) => value(subject, `${SH}deactivated`) === 'true';

  const constraints: SparqlConstraint[] = [];
  const skipped: SkippedConstraint[] = [];
  for (const q of shapes) {
    if (q.predicate.value !== `${SH}sparql`) continue;
    const shape = idOf(q.subject as Term);
    const constraint = idOf(q.object as Term);
    if (deactivated(shape) || deactivated(constraint)) continue;
    const select = value(constraint, `${SH}select`);
    if (!select) {
      skipped.push({ shape, reason: 'only sh:select is supported' });
      continue;
    }
    const pathTerm = objects(shape, `${SH}path`)[0];
    if (pathTerm && pathTerm.termType !== 'NamedNode') {
      skipped.push({ shape, reason: 'a path that is not one property' });
      continue;
    }
    const path = pathTerm?.value;
    const prefixes = objects(constraint, `${SH}prefixes`).flatMap((ontology) =>
      objects(idOf(ontology), `${SH}declare`).map((declaration) => ({
        prefix: value(idOf(declaration), `${SH}prefix`),
        namespace: value(idOf(declaration), `${SH}namespace`),
      })),
    );
    const declared = new Map<string, string>();
    for (const { prefix, namespace } of prefixes) if (prefix !== undefined && namespace) declared.set(prefix, namespace);
    const header = [...declared].map(([prefix, namespace]) => `PREFIX ${prefix}: <${namespace}>`).join('\n');
    const body = path ? select.replace(/\$PATH\b/g, `<${path}>`) : select;
    const message = (objects(constraint, `${SH}message`)[0] ?? objects(shape, `${SH}message`)[0])?.value ?? '';
    const severity = SEVERITIES[value(shape, `${SH}severity`) ?? ''] ?? 'Violation';
    const targets: ShapeTargets = {
      classes: objects(shape, `${SH}targetClass`).map((t) => t.value),
      nodes: objects(shape, `${SH}targetNode`).filter((t) => t.termType === 'NamedNode').map((t) => t.value),
      subjectsOf: objects(shape, `${SH}targetSubjectsOf`).map((t) => t.value),
      objectsOf: objects(shape, `${SH}targetObjectsOf`).map((t) => t.value),
    };
    if (objects(shape, RDF_TYPE).some((t) => t.value === RDFS_CLASS || t.value === OWL_CLASS) && !shape.startsWith('_:')) {
      targets.classes.push(shape);
    }
    if (targets.classes.length + targets.nodes.length + targets.subjectsOf.length + targets.objectsOf.length === 0) continue;
    constraints.push({ shape, select: header ? `${header}\n${body}` : body, message, severity, targets, ...(path ? { path } : {}) });
  }
  return { constraints, skipped };
}

/**
 * The IRIs a constraint's query names — prefixed names expanded — so the
 * metamodels' statements it reads can be given with the model (a viewpoint's
 * `arch:includesConcept`, for instance).
 */
export function predicatesNamedBy(constraint: SparqlConstraint): string[] {
  const prefixes = new Map<string, string>();
  for (const m of constraint.select.matchAll(/PREFIX\s+([A-Za-z][\w-]*)?:\s*<([^>]*)>/gi)) prefixes.set(m[1] ?? '', m[2]!);
  const body = withoutComments(constraint.select.replace(/PREFIX\s+[\w-]*:\s*<[^>]*>/gi, ''));
  const out = new Set<string>();
  for (const m of body.matchAll(/<([^>\s]+)>/g)) out.add(m[1]!);
  for (const m of body.matchAll(/(?<![\w?$<"])([A-Za-z][\w-]*)?:([A-Za-z_][\w-]*)/g)) {
    const ns = prefixes.get(m[1] ?? '');
    if (ns) out.add(ns + m[2]);
  }
  return [...out];
}

/** Runs constraints against a store. */
export class SparqlRunner {
  /** Constraints Oxigraph refused, kept so each is reported once. */
  private readonly failed = new Map<string, string>();

  /**
   * @param nameOf A node's name, to put in a message for `{$this}` and the
   *   like — meta's messages say "Element {$this} has no relationships", which
   *   reads better with a name than an IRI; the IRI where it has none.
   */
  constructor(
    readonly constraints: readonly SparqlConstraint[],
    private readonly store: SparqlSelect,
    private readonly nameOf: (iri: string) => string | undefined = () => undefined,
  ) {}

  /** Why a constraint could not be run, by shape. */
  get failures(): ReadonlyMap<string, string> {
    return this.failed;
  }

  /**
   * The results for every target of every constraint — or, given `focus`, for
   * those of them only.
   */
  run(focus?: readonly Term[]): ValidationResult[] {
    if (focus && focus.length === 0) return [];
    const values = focus ? focus.map(termText).join(' ') : undefined;
    const results: ValidationResult[] = [];
    for (const constraint of this.constraints) {
      const key = `${constraint.shape}\u0000${constraint.select}`;
      if (this.failed.has(key)) continue;
      const query = withTargets(constraint.select, targetPattern(constraint.targets, values));
      let rows: Array<Map<string, Term>>;
      try {
        rows = this.store.select(query);
      } catch (err: unknown) {
        this.failed.set(key, err instanceof Error ? err.message : String(err));
        continue;
      }
      for (const row of rows) {
        const focusNode = row.get('this');
        if (!focusNode || (focusNode.termType !== 'NamedNode' && focusNode.termType !== 'BlankNode')) continue;
        const path = row.get('path')?.value ?? constraint.path ?? '';
        results.push({
          focusNode: focusNode as ValidationResult['focusNode'],
          resultPath: { termType: 'NamedNode', value: path } as ValidationResult['resultPath'],
          sourceShape: { termType: constraint.shape.startsWith('_:') ? 'BlankNode' : 'NamedNode', value: constraint.shape.replace(/^_:/, '') } as ValidationResult['sourceShape'],
          message: messageOf(constraint.message, row, this.nameOf) || `Violates ${constraint.shape}`,
          severity: constraint.severity,
          sourceConstraintComponent: { termType: 'NamedNode', value: SPARQL_COMPONENT } as ValidationResult['focusNode'],
        });
      }
    }
    return dedupe(results);
  }
}

/**
 * A group pattern binding `$this` to the shape's targets — among `values` (the
 * nodes validated, as SPARQL terms) when given: inside the sub-query, so that
 * it lists those only, not every target.
 */
export function targetPattern(targets: ShapeTargets, values?: string): string {
  const parts = [
    ...targets.classes.map((c) => `{ $this <${RDF_TYPE}>/<${NAMESPACES.rdfs}subClassOf>* <${c}> . }`),
    ...(targets.nodes.length > 0 ? [`{ VALUES $this { ${targets.nodes.map((n) => `<${n}>`).join(' ')} } }`] : []),
    ...targets.subjectsOf.map((p) => `{ $this <${p}> [] . }`),
    ...targets.objectsOf.map((p) => `{ [] <${p}> $this . }`),
  ];
  const among = values === undefined ? '' : `VALUES $this { ${values} } `;
  return `{ SELECT DISTINCT $this WHERE { ${among}${parts.join(' UNION ')} } }\n`;
}

/** The query with `pattern` first in its outer `WHERE` (or its first group, when it has no `WHERE`). */
export function withTargets(query: string, pattern: string): string {
  const at = outerGroupStart(query);
  if (at < 0) throw new Error('The query has no group pattern.');
  return `${query.slice(0, at + 1)}\n${pattern}${query.slice(at + 1)}`;
}

/**
 * Where the outer `WHERE`'s `{` is: the first `{` after the `SELECT` — IRIs,
 * strings and comments skipped, since `#` and braces may appear in them.
 */
function outerGroupStart(query: string): number {
  let seenSelect = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]!;
    if (ch === '#') {
      const end = query.indexOf('\n', i);
      if (end < 0) return -1;
      i = end;
    } else if (ch === '<' && /^<[^\s<>"{}|^`\\]*>/.test(query.slice(i))) {
      i = query.indexOf('>', i);
    } else if (ch === '"' || ch === "'") {
      const long = query.startsWith(ch.repeat(3), i);
      const close = long ? ch.repeat(3) : ch;
      let j = i + close.length;
      while (j < query.length && !query.startsWith(close, j)) j += query[j] === '\\' ? 2 : 1;
      i = j + close.length - 1;
    } else if (!seenSelect && /^select\b/i.test(query.slice(i, i + 7)) && !/\w/.test(query[i - 1] ?? '')) {
      seenSelect = true;
      i += 5;
    } else if (seenSelect && ch === '{') {
      return i;
    }
  }
  return -1;
}

/** The query text with its comments taken out (IRIs and strings kept). */
function withoutComments(query: string): string {
  let out = '';
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]!;
    if (ch === '#') {
      const end = query.indexOf('\n', i);
      i = end < 0 ? query.length : end - 1;
      continue;
    }
    if (ch === '<' && /^<[^\s<>"{}|^`\\]*>/.test(query.slice(i))) {
      const end = query.indexOf('>', i);
      out += query.slice(i, end + 1);
      i = end;
      continue;
    }
    out += ch;
  }
  return out;
}

/** A message with `{$var}` and `{?var}` filled in from a solution — a node by its name, when it has one. */
function messageOf(template: string, row: Map<string, Term>, nameOf: (iri: string) => string | undefined): string {
  return template.replace(/\{[$?]([A-Za-z_]\w*)\}/g, (whole, name: string) => {
    const term = row.get(name);
    if (!term) return whole;
    return (term.termType === 'NamedNode' ? nameOf(term.value) : undefined) ?? term.value;
  });
}

/** A term as SPARQL writes it. */
function termText(term: Term): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  return JSON.stringify(term.value);
}

/** A node's key in the shapes graph. */
function idOf(term: Term): string {
  return term.termType === 'BlankNode' ? `_:${term.value}` : term.value;
}

/** One result per focus node, shape, path and message. */
function dedupe(results: ValidationResult[]): ValidationResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = [r.focusNode.value, r.sourceShape.value, r.resultPath.value, r.message].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
