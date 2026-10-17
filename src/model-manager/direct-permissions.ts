/**
 * Which relationships a modeller may draw directly, from a metamodel's
 * relationship tables.
 *
 * ## Direct, or only by derivation
 *
 * ArchiMate's relationship tables print a relationship in upper case when the
 * metamodel permits it directly, and in lower case when it is permitted only as
 * the conclusion of a derivation: an artifact may realize a business object, but
 * only by derivation. The relationship shapes (`relationship-table.ts`) do not
 * keep the difference — they validate, and a derived relationship is a valid one.
 * The relationship tables meta publishes beside them do, as lookups:
 *
 * ```turtle
 * am4:realizes am4rt:permittedDirectlyBy am4rt:permitsDirectRealization .
 * am4:Artifact am4rt:permitsDirectRealization am4:DataObject , am4:SystemSoftware , … .
 * ```
 *
 * ## Read by pattern, not by namespace
 *
 * The annotation that maps a relationship predicate to its direct permissions is
 * found by its declaration — an `owl:AnnotationProperty` named
 * `permittedDirectlyBy` — in whatever namespace a language's tables use
 * (`am4rt:` for ArchiMate 4.0, `amrt:` for 3.2), so another language's tables in
 * the same pattern need nothing here. Looking it up through its type keeps the
 * read to indexed quad lookups.
 *
 * ## What the tables do not cover is unknown, not forbidden
 *
 * A relationship whose predicate has no such annotation, or an end type the
 * tables never mention (a junction: the tables list element types only), is
 * neither direct nor derived as far as they say: {@link DirectPermissions.isDirect}
 * answers `undefined`, and the caller ranks as before.
 */

import type { NamedNode } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { nn } from './vocabulary.js';

const RDF_TYPE = nn(NAMESPACES.rdf + 'type');
const OWL_ANNOTATION_PROPERTY = nn(NAMESPACES.owl + 'AnnotationProperty');
const DIRECT_ANNOTATION = 'permittedDirectlyBy';
/** The tables' wildcards: every element type, and every element and relationship. */
const WILDCARDS = new Set([NAMESPACES.arch + 'Element', NAMESPACES.arch + 'ModelConcept']);

/** For one relationship predicate: each source type and the types it may reach directly. */
type DirectTargets = ReadonlyMap<string, ReadonlySet<string>>;

/** The direct permissions of the loaded relationship tables. */
export class DirectPermissions {
  constructor(
    private readonly byPredicate: ReadonlyMap<string, DirectTargets>,
    /** Every type the tables name, as a source or as a target (wildcards aside). */
    private readonly mentioned: ReadonlySet<string>,
  ) {}

  /** Relationship predicates the tables give direct permissions for. */
  get size(): number {
    return this.byPredicate.size;
  }

  /**
   * Whether a relationship with this predicate may be drawn directly from the
   * source to the target, given the types' `rdfs:subClassOf*` closures (each
   * including the type itself): `true` when the tables print it in upper case,
   * `false` when they permit it only by derivation, `undefined` when they do not
   * say — no direct permissions for the predicate, or an end type they never
   * mention.
   */
  isDirect(predicateIri: string, sourceClosure: readonly string[], targetClosure: readonly string[]): boolean | undefined {
    const bySource = this.byPredicate.get(predicateIri);
    if (!bySource) return undefined;
    if (!sourceClosure.some((c) => this.mentioned.has(c)) || !targetClosure.some((c) => this.mentioned.has(c))) {
      return undefined;
    }
    return sourceClosure.some((source) => {
      const targets = bySource.get(source);
      if (!targets) return false;
      // A wildcard lists every element type (and with arch:ModelConcept, every relationship too).
      for (const target of targets) if (WILDCARDS.has(target) || targetClosure.includes(target)) return true;
      return false;
    });
  }
}

/** No relationship tables loaded: nothing is known to be direct or derived. */
export const NO_DIRECT_PERMISSIONS = new DirectPermissions(new Map(), new Set());

/** The local name of an IRI: after the last `#` or `/`. */
function localName(iri: string): string {
  return iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);
}

/** Read the direct permissions of every relationship table in the store (all graphs). */
export function readDirectPermissions(store: RdfStore): DirectPermissions {
  const byPredicate = new Map<string, Map<string, Set<string>>>();
  const mentioned = new Set<string>();
  const annotations = store
    .getQuads(null, RDF_TYPE, OWL_ANNOTATION_PROPERTY)
    .map((q) => q.subject)
    .filter((s) => s.termType === 'NamedNode' && localName(s.value) === DIRECT_ANNOTATION);

  for (const annotation of annotations) {
    for (const mapping of store.getQuads(null, annotation as NamedNode)) {
      const predicate = mapping.subject.value;
      const permits = mapping.object as NamedNode;
      let bySource = byPredicate.get(predicate);
      if (!bySource) byPredicate.set(predicate, (bySource = new Map()));
      for (const permission of store.getQuads(null, permits)) {
        const source = permission.subject.value;
        const target = permission.object.value;
        let targets = bySource.get(source);
        if (!targets) bySource.set(source, (targets = new Set()));
        targets.add(target);
        mentioned.add(source);
        if (!WILDCARDS.has(target)) mentioned.add(target);
      }
    }
  }
  return new DirectPermissions(byPredicate, mentioned);
}
