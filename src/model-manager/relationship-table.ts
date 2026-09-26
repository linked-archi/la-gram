/**
 * The relationship table a metamodel's SHACL shapes encode — which source and
 * target classes each qualified relationship class admits.
 *
 * ## Why not `arch:domainIncludes` / `arch:rangeIncludes`
 *
 * Those are hints, declared on abstract superclasses: ArchiMate 4.0's Serving
 * says "from an active structure element, to …", which admits far more pairs
 * than the language allows. Deciding validity from them offered relationships
 * the shapes then reported as violations. The normative answer is the
 * relationship shapes: ArchiMate 4.0's and 3.2's are generated from the
 * specification's relationship matrix, one node shape per qualified relationship
 * class whose `sh:or` lists every permitted (source class, target classes) pair:
 *
 * ```turtle
 * :AccessShape sh:targetClass am4:Access ;
 *   sh:or (
 *     [ sh:and (
 *         [ sh:property [ sh:path arch:source ; sh:class am4:ApplicationComponent ] ]
 *         [ sh:property [ sh:path arch:target ; sh:or ( [ sh:class am4:Artifact ] … ) ] ]
 *     ) ]
 *     …
 *   ) .
 * ```
 *
 * This module reads that pattern into a lookup. `sh:class` matches instances of
 * the class and its subclasses, so a pair admits a concrete type whose
 * `rdfs:subClassOf*` closure contains the listed class.
 *
 * Shapes reach subclasses too: `sh:targetClass am4:Aggregation` also targets
 * every `am4:Composition` (a subclass — "allowed in exactly the same cases").
 * So a relationship class is judged by the rows of every class in its
 * `rdfs:subClassOf*` closure, and must satisfy all of them, as validation would.
 *
 * A relationship class that neither it nor a superclass has rows for is left to
 * the hints: a metamodel without relationship shapes (C4, BPMN, …) behaves as
 * before.
 */

import type { NamedNode, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { nn } from './vocabulary.js';

/** One permitted row: a source class and the target classes it may reach. */
interface PermittedRow {
  source: string;
  targets: Set<string>;
}

/** Which (source, target) pairs each constrained relationship class admits. */
export class RelationshipTable {
  constructor(private readonly rows: ReadonlyMap<string, readonly PermittedRow[]>) {}

  /** Relationship classes the shapes constrain. */
  get size(): number {
    return this.rows.size;
  }

  /**
   * Whether the shapes constrain a relationship class, given its
   * `rdfs:subClassOf*` closure (a shape on a superclass counts).
   */
  covers(relationshipClosure: readonly string[]): boolean {
    return relationshipClosure.some((c) => this.rows.has(c));
  }

  /**
   * Whether a relationship may go from a source to a target, given the
   * `rdfs:subClassOf*` closures of the relationship class, the source type and
   * the target type (each including the class itself). Every constrained class
   * in the relationship's closure must admit the pair. `true` when none is
   * constrained.
   */
  allows(relationshipClosure: readonly string[], sourceClosure: readonly string[], targetClosure: readonly string[]): boolean {
    return relationshipClosure.every((c) => {
      const rows = this.rows.get(c);
      return !rows || rows.some((row) => sourceClosure.includes(row.source) && targetClosure.some((t) => row.targets.has(t)));
    });
  }

  /**
   * Whether the shapes let a relationship start at a source at all (to some
   * target) — the cheap question a UI prefilter asks. `true` when unconstrained.
   */
  allowsSource(relationshipClosure: readonly string[], sourceClosure: readonly string[]): boolean {
    return relationshipClosure.every((c) => {
      const rows = this.rows.get(c);
      return !rows || rows.some((row) => sourceClosure.includes(row.source));
    });
  }

  /** Whether the shapes let a relationship end at a target at all. `true` when unconstrained. */
  allowsTarget(relationshipClosure: readonly string[], targetClosure: readonly string[]): boolean {
    return relationshipClosure.every((c) => {
      const rows = this.rows.get(c);
      return !rows || rows.some((row) => targetClosure.some((t) => row.targets.has(t)));
    });
  }

  /** The target classes the shapes list for a source class (for tests and diagnostics). */
  targetsOf(relationshipClassIri: string, sourceClassIri: string): string[] {
    const rows = this.rows.get(relationshipClassIri) ?? [];
    return [...new Set(rows.filter((r) => r.source === sourceClassIri).flatMap((r) => [...r.targets]))].sort();
  }
}

/** An empty table: everything is left to the hints. */
export const EMPTY_RELATIONSHIP_TABLE = new RelationshipTable(new Map());

const SH_TARGET_CLASS = nn(NAMESPACES.sh + 'targetClass');
const SH_OR = nn(NAMESPACES.sh + 'or');
const SH_AND = nn(NAMESPACES.sh + 'and');
const SH_PROPERTY = nn(NAMESPACES.sh + 'property');
const SH_PATH = nn(NAMESPACES.sh + 'path');
const SH_CLASS = nn(NAMESPACES.sh + 'class');
const RDF_FIRST = nn(NAMESPACES.rdf + 'first');
const RDF_REST = nn(NAMESPACES.rdf + 'rest');
const RDF_NIL = NAMESPACES.rdf + 'nil';
const ARCH_SOURCE = NAMESPACES.arch + 'source';
const ARCH_TARGET = NAMESPACES.arch + 'target';

/**
 * Read the relationship table from every relationship shape in the store (all
 * graphs).
 *
 * Walks the shapes' RDF lists with indexed quad lookups. The same walk as one
 * SPARQL query with `rdf:rest*` paths took ~50 s over the merged metamodel
 * graphs; this takes a fraction of a second.
 */
export function readRelationshipTable(store: RdfStore): RelationshipTable {
  const objects = (subject: Term, predicate: NamedNode): Term[] =>
    store.getQuads(subject as NamedNode, predicate).map((q) => q.object);
  const items = (head: Term): Term[] => {
    const out: Term[] = [];
    const seen = new Set<string>();
    let cell: Term | undefined = head;
    while (cell && cell.value !== RDF_NIL && !seen.has(cell.value)) {
      seen.add(cell.value);
      out.push(...objects(cell, RDF_FIRST));
      cell = objects(cell, RDF_REST)[0];
    }
    return out;
  };
  const classesOf = (node: Term): string[] => [
    ...objects(node, SH_CLASS).map((t) => t.value),
    ...objects(node, SH_OR).flatMap((list) => items(list).flatMap((alt) => objects(alt, SH_CLASS).map((t) => t.value))),
  ];

  const rows = new Map<string, Map<string, Set<string>>>();
  for (const target of store.getQuads(null, SH_TARGET_CLASS)) {
    const rel = target.object.value;
    for (const alternatives of objects(target.subject, SH_OR)) {
      for (const alternative of items(alternatives)) {
        for (const conjunction of objects(alternative, SH_AND)) {
          const sources: string[] = [];
          const targets: string[] = [];
          for (const part of items(conjunction)) {
            for (const property of objects(part, SH_PROPERTY)) {
              const path = objects(property, SH_PATH)[0]?.value;
              if (path === ARCH_SOURCE) sources.push(...classesOf(property));
              else if (path === ARCH_TARGET) targets.push(...classesOf(property));
            }
          }
          if (sources.length === 0 || targets.length === 0) continue;
          let bySource = rows.get(rel);
          if (!bySource) rows.set(rel, (bySource = new Map()));
          for (const source of sources) {
            let set = bySource.get(source);
            if (!set) bySource.set(source, (set = new Set()));
            for (const t of targets) set.add(t);
          }
        }
      }
    }
  }

  const table = new Map<string, PermittedRow[]>();
  for (const [rel, bySource] of rows) {
    table.set(
      rel,
      [...bySource].map(([source, targets]) => ({ source, targets })),
    );
  }
  return new RelationshipTable(table);
}
