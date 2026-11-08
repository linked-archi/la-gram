/**
 * Which properties take one value per subject — or one per language — defined
 * once for the two places that settle such values: the room
 * (`collab/rdf-yjs-binding.ts`), which keeps one value when collaborators set two
 * at once, and the three-way merge (`model-manager/model-merge.ts`), which
 * reports a conflict when two versions set different ones.
 *
 * ## Where the rules come from
 *
 * - **Built in**: what a diagram and a relationship cannot have two of — bounds,
 *   point coordinates, a node's element, a link's relationship and ends, a
 *   diagram element's view, the cells of an `rdf:List` — and `skos:prefLabel`,
 *   one per language (SKOS's own rule). They hold whatever metamodel is loaded.
 * - **`owl:FunctionalProperty`** in a loaded ontology: one value, for every
 *   subject — that is what the declaration means.
 * - **`sh:maxCount 1`** on a property shape that a node shape with a target
 *   holds (`sh:property`), or that has a target itself: one value, for instances
 *   of the target classes and their subclasses only. Read as a rule for every
 *   subject, a shape for one class would make the room drop a second value that
 *   another class is allowed. Shapes nested in `sh:or`, `sh:xone`, `sh:and`,
 *   `sh:not` or `sh:node` are not read — their limit holds only when the branch
 *   is the one taken (core's model questions put `sh:maxCount 0` on
 *   `sh:construct` in an `sh:xone` branch) — nor is `sh:maxCount 0`, which says
 *   "none", not "one".
 * - **`sh:uniqueLang true`**, read the same way: one value per language.
 *
 * A target is a `sh:targetClass`, or the shape itself when it is also a class (an
 * implicit class target). A `sh:targetSubjectsOf` the property itself makes the
 * rule hold for every subject — whatever has a value of it is a target — as
 * core's `arch:inModel` shape does. Other `sh:targetSubjectsOf`, and
 * `sh:targetNode` and `sh:targetObjectsOf`, are not read.
 *
 * Where several rules name a property, the stricter wins: one value overall
 * over one per language.
 *
 * One property is settled rather than chosen: `dcterms:modified`, which
 * la-gram stamps on the model when it renames it, moves its namespace or makes
 * a view. Two stamps made apart are no disagreement, so it takes the later of
 * them (`latest`) — in the room as in the merge, which reports no conflict for
 * it.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import { NAMESPACES } from './namespaces.js';

/**
 * How many values a property takes per subject: one; one per language; or one,
 * the latest (`xsd:dateTime` values in one form, so the greatest is the latest).
 */
export type ValueLimit = 'one' | 'one-per-language' | 'latest';

/** Where the metamodel rules are read from: the metamodel graphs, not the model's. */
export interface QuadSource {
  getQuads(subject?: NamedNode | null, predicate?: NamedNode | null, object?: NamedNode | null, graph?: NamedNode | null): Quad[];
}

const VIS = NAMESPACES['arch-vis'];
const SH = NAMESPACES.sh;
const RDF_TYPE = NAMESPACES.rdf + 'type';
const SUBCLASS_OF = NAMESPACES.rdfs + 'subClassOf';
const CLASSES = new Set([NAMESPACES.rdfs + 'Class', NAMESPACES.owl + 'Class']);

/** The rules that hold whatever metamodel is loaded. */
export const BUILT_IN_LIMITS: ReadonlyMap<string, ValueLimit> = new Map<string, ValueLimit>([
  ...[
    'bounds-x',
    'bounds-y',
    'bounds-w',
    'bounds-h',
    'point-x',
    'point-y',
    'archElement',
    'archRelationship',
    'view',
    'source',
    'target',
    'points',
  ].map((local): [string, ValueLimit] => [VIS + local, 'one']),
  [NAMESPACES.rdf + 'first', 'one'],
  [NAMESPACES.rdf + 'rest', 'one'],
  [NAMESPACES.arch + 'source', 'one'],
  [NAMESPACES.arch + 'target', 'one'],
  [NAMESPACES.skos + 'prefLabel', 'one-per-language'],
  [NAMESPACES.dcterms + 'modified', 'latest'],
]);

const nn = (iri: string) => DataFactory.namedNode(iri) as unknown as NamedNode;

/** The stricter of two limits; `latest` is one value too, and says how to settle it. */
function stricter(a: ValueLimit | undefined, b: ValueLimit | undefined): ValueLimit | undefined {
  if (a === 'latest' || b === 'latest') return 'latest';
  return a === 'one' || b === 'one' ? 'one' : (a ?? b);
}

/** A literal's language, `''` for none and for anything that is not a literal. */
export function languageOf(term: Term): string {
  return term.termType === 'Literal' ? ((term as { language?: string }).language ?? '').toLowerCase() : '';
}

/** Which properties take one value per subject, or one per language. */
export class SingleValued {
  private static builtInRules?: SingleValued;

  private constructor(
    /** Limits for every subject. */
    private readonly everywhere: ReadonlyMap<string, ValueLimit>,
    /** Limits for instances of a class: property → class → limit. */
    private readonly byClass: ReadonlyMap<string, ReadonlyMap<string, ValueLimit>>,
    /** Direct superclasses of a class. */
    private readonly parents: ReadonlyMap<string, readonly string[]>,
  ) {}

  /** Only the built-in rules. */
  static builtIn(): SingleValued {
    SingleValued.builtInRules ??= new SingleValued(BUILT_IN_LIMITS, new Map(), new Map());
    return SingleValued.builtInRules;
  }

  /**
   * The built-in rules and those of the metamodels `source` holds. Give it the
   * metamodel graphs only: the model's own quads are not rules.
   */
  static from(source: QuadSource): SingleValued {
    const everywhere = new Map(BUILT_IN_LIMITS);
    for (const q of source.getQuads(null, nn(RDF_TYPE), nn(NAMESPACES.owl + 'FunctionalProperty'))) {
      if (q.subject.termType === 'NamedNode') everywhere.set(q.subject.value, stricter(everywhere.get(q.subject.value), 'one') as ValueLimit);
    }

    // Property shapes with a limit, by the term that names them (a blank node, mostly).
    const limited = new Map<string, { shape: Term; limit: ValueLimit }>();
    const note = (shape: Term, limit: ValueLimit) => {
      const key = `${shape.termType}:${shape.value}`;
      limited.set(key, { shape, limit: stricter(limited.get(key)?.limit, limit) as ValueLimit });
    };
    for (const q of source.getQuads(null, nn(SH + 'maxCount'), null)) {
      if (q.object.termType === 'Literal' && Number(q.object.value) === 1) note(q.subject, 'one');
    }
    for (const q of source.getQuads(null, nn(SH + 'uniqueLang'), null)) {
      if (q.object.termType === 'Literal' && q.object.value === 'true') note(q.subject, 'one-per-language');
    }

    const objects = (subject: Term, predicate: string) => source.getQuads(subject as NamedNode, nn(predicate)).map((q) => q.object);
    const targetsOf = (shape: Term): string[] => {
      const classes = objects(shape, SH + 'targetClass')
        .filter((o) => o.termType === 'NamedNode')
        .map((o) => o.value);
      if (shape.termType === 'NamedNode' && objects(shape, RDF_TYPE).some((o) => CLASSES.has(o.value))) classes.push(shape.value);
      return classes;
    };

    const byClass = new Map<string, Map<string, ValueLimit>>();
    for (const { shape, limit } of limited.values()) {
      const path = objects(shape, SH + 'path')[0];
      if (path?.termType !== 'NamedNode') continue;
      const holders = [shape, ...source.getQuads(null, nn(SH + 'property'), shape as NamedNode).map((q) => q.subject)];
      if (holders.some((h) => objects(h, SH + 'targetSubjectsOf').some((o) => o.value === path.value))) {
        everywhere.set(path.value, stricter(everywhere.get(path.value), limit) as ValueLimit);
        continue;
      }
      const classes = holders.flatMap(targetsOf);
      if (classes.length === 0) continue;
      const forPath = byClass.get(path.value) ?? new Map<string, ValueLimit>();
      for (const cls of classes) forPath.set(cls, stricter(forPath.get(cls), limit) as ValueLimit);
      byClass.set(path.value, forPath);
    }

    const parents = new Map<string, string[]>();
    if (byClass.size > 0) {
      for (const q of source.getQuads(null, nn(SUBCLASS_OF), null)) {
        if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
        const list = parents.get(q.subject.value);
        if (list) list.push(q.object.value);
        else parents.set(q.subject.value, [q.object.value]);
      }
    }
    return new SingleValued(everywhere, byClass, parents);
  }

  /** Whether some rule names the property: cheap, before a subject's types are looked up. */
  mayLimit(predicate: string): boolean {
    return this.everywhere.has(predicate) || this.byClass.has(predicate);
  }

  /**
   * How many values `predicate` takes on a subject of `types` (its asserted
   * types; their superclasses are followed here), or `undefined` for any number.
   * `types` is called only when a class-scoped rule names the property.
   */
  limitOf(predicate: string, types: () => Iterable<string>): ValueLimit | undefined {
    let limit = this.everywhere.get(predicate);
    if (limit === 'one' || limit === 'latest') return limit;
    const scoped = this.byClass.get(predicate);
    if (!scoped) return limit;
    for (const cls of this.closure(types())) {
      limit = stricter(limit, scoped.get(cls));
      if (limit === 'one' || limit === 'latest') return limit;
    }
    return limit;
  }

  /** The classes and every superclass of them. */
  private closure(types: Iterable<string>): Set<string> {
    const seen = new Set<string>();
    const stack = [...types];
    while (stack.length > 0) {
      const cls = stack.pop() as string;
      if (seen.has(cls)) continue;
      seen.add(cls);
      stack.push(...(this.parents.get(cls) ?? []));
    }
    return seen;
  }
}
