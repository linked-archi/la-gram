/**
 * Which visual notation applies to a class — the one lookup the palette and the
 * canvas both use (Req 2.16).
 *
 * `notation.ts` reads a notation set out of the graph. A set rarely describes
 * every class that has to be drawn: a generic set such as Basic describes
 * `arch:Element`, `arch:QualifiedRelationship` and its own two relationship
 * classes, and with several metamodels loaded only one set is active.
 *
 * For a class C, the active set A is the set that the active presentation
 * context names with `arch:usesNotationSet`, or else the primary metamodel's
 * `arch:notationSet`. The fallback layers F are the default sets
 * (`arch:notationSet`) of all loaded metamodels except A itself, in load order,
 * then the core notation's ({@link coreNotationSetIris}), which no manifest
 * names: it draws the core's own relationship types. F includes the default set
 * of A's own metamodel when a presentation context picked an alternative set.
 *
 * 1. A descriptor in A for C.
 * 2. A descriptor for C in F, the first match in load order.
 * 3. C's own `arch:prefVisNotation`.
 * 4. A descriptor for the nearest superclass of C that has one in A or F. The
 *    walk goes breadth-first over `rdfs:subClassOf`: by distance first, and
 *    superclasses at the same distance in IRI order. It stops at `arch:Element`
 *    and `arch:QualifiedRelationship`. For each superclass, A is checked first,
 *    then F in load order.
 * 5. Built-in defaults. Elements: a rectangle with a white fill and a black
 *    line. Relationships: a solid black line.
 *
 * Anything published for the class itself beats anything inherited; among
 * inherited descriptors the nearest ancestor wins; the active set only breaks
 * ties.
 *
 * So an active generic set cannot flatten another language's own notation:
 * ArchiMate's composition keeps its filled diamond with Basic active (step 2).
 * And an extension subclass of `am4:BusinessActor` with nothing of its own takes
 * ArchiMate's Business Actor descriptor (distance 1) rather than an active
 * generic set's `arch:Element` (distance 2 or more), so subclasses inherit their
 * parent's appearance (AM-DD-2 in
 * `linked-archi-meta/doc/guide/archimate/design-decisions.md`). The walk is
 * `superClassesNearestFirst` in `class-hierarchy.ts`.
 *
 * The visual notation guide in `linked-archi-meta`
 * (`doc/guide/visual-notation-guide.md`, Fallback Logic) documents the same
 * order.
 */

import { DataFactory } from 'n3';
import type { Store } from 'n3';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { compareIris, superClassesNearestFirst } from './class-hierarchy.js';
import {
  buildVisualNotations,
  CORE_NOTATION_NS,
  type NotationSet,
  type RelationshipVisualStyle,
  type RenderingMode,
  type VisualNotation,
  type VisualStyle,
} from './notation.js';

const { namedNode } = DataFactory;

const RDF_TYPE = `${NAMESPACES.rdf}type`;
const ARCH_METAMODEL = `${NAMESPACES.arch}Metamodel`;
const ARCH_NOTATION_SET = `${NAMESPACES.arch}notationSet`;
const ARCH_PREF_VIS_NOTATION = `${NAMESPACES.arch}prefVisNotation`;
const ARCH_VIS_NOTATION_SET = `${NAMESPACES['arch-vis']}NotationSet`;

/** Which step of the lookup produced an answer, in lookup order. */
export type NotationSource =
  /** 1. The active set describes the class itself. */
  | 'active'
  /** 2. A fallback layer describes the class itself. */
  | 'fallback'
  /** 3. Only the class's own `arch:prefVisNotation`. */
  | 'pref-vis-notation'
  /** 4. The nearest described superclass has its descriptor in the active set. */
  | 'active-superclass'
  /** 4. The nearest described superclass has its descriptor in a fallback layer only. */
  | 'fallback-superclass'
  /** 5. Nothing applies; renderers use their built-in defaults. */
  | 'default';

/** The answer for one class. */
export interface ResolvedNotation {
  source: NotationSource;
  /** The descriptor that applies. Absent for `pref-vis-notation` and `default`. */
  notation?: VisualNotation;
  /** The class the descriptor was published for: the class itself or the superclass it inherits from. */
  matchedClassIri?: string;
  /** The set the descriptor belongs to. */
  notationSetIri?: string;
  /**
   * The pre-rendered image to show. For an exact descriptor (1, 2) the
   * descriptor's own image, else the class's; for 3 the class's own; for an
   * inherited one (4) the descriptor's, since the class takes that look.
   */
  prefVisNotation?: string;
}

/**
 * The resolved notation of one class as plain data, for the canvas.
 *
 * `PaletteGenerator` emits one per class it can resolve (`notationIndex`), so a
 * renderer can style a type the palette does not list — a class no taxonomy
 * names — from the same answer the palette would have given.
 */
export interface NotationIndexEntry {
  source: NotationSource;
  notationSetIri?: string;
  matchedClassIri?: string;
  /** Element style, with the icon URL already resolved for offline use. */
  style?: VisualStyle;
  /** Rendering mode after the notation guide's fallbacks. */
  renderingMode?: RenderingMode;
  relationshipStyle?: RelationshipVisualStyle;
}

/**
 * The layered lookup over one active set and its fallback sets.
 *
 * Answers are memoised per class: a palette asks for each class once, the
 * notation index asks again for every class in the graph.
 */
export class NotationResolver {
  private readonly cache = new Map<string, ResolvedNotation>();

  /**
   * @param graph Snapshot holding the classes, their `rdfs:subClassOf` and `arch:prefVisNotation`.
   * @param active The set chosen for this palette, or `null` when none resolved.
   * @param fallbacks The fallback layers: every loaded metamodel's default set
   *   except the active set, in load order. That includes the active context's
   *   own metamodel default when a context picked an alternative set (see
   *   {@link orderedFallbackSets}).
   * @param superClassMap Direct parents per class (`buildSuperClassMap`).
   */
  constructor(
    private readonly graph: Store,
    private readonly active: NotationSet | null,
    private readonly fallbacks: readonly NotationSet[],
    private readonly superClassMap: ReadonlyMap<string, readonly string[]>,
  ) {}

  resolve(classIri: string): ResolvedNotation {
    const cached = this.cache.get(classIri);
    if (cached) return cached;
    const resolved = this.lookup(classIri);
    this.cache.set(classIri, resolved);
    return resolved;
  }

  private lookup(classIri: string): ResolvedNotation {
    const own = ownPrefVisNotation(this.graph, classIri);

    // 1. The active set, the class itself.
    const exact = this.active?.notations.get(classIri);
    if (exact) return exactMatch('active', exact, classIri, own);

    // 2. The fallback layers, the class itself, in load order.
    for (const set of this.fallbacks) {
      const notation = set.notations.get(classIri);
      if (notation) return exactMatch('fallback', notation, classIri, own);
    }

    // 3. The class's own pre-rendered image.
    if (own) return { source: 'pref-vis-notation', prefVisNotation: own };

    // Nothing is published for the class itself, so it inherits a look.
    // 4. The nearest superclass with a descriptor in A or F: A first, then F in load order.
    for (const superClass of superClassesNearestFirst(classIri, this.superClassMap)) {
      const inActive = this.active?.notations.get(superClass);
      if (inActive) return inheritedMatch('active-superclass', inActive);
      for (const set of this.fallbacks) {
        const notation = set.notations.get(superClass);
        if (notation) return inheritedMatch('fallback-superclass', notation);
      }
    }

    // 5. Nothing: the renderer's built-in defaults.
    return { source: 'default' };
  }
}

/**
 * The fallback layers F, in order: every loaded metamodel's default set except
 * the active set, skipping repeats and sets with no descriptors (or no data
 * loaded).
 *
 * Only the active set's own IRI is dropped. When a presentation context picked
 * an alternative set, the default set of the active context's own metamodel is
 * therefore a layer too, so a class the alternative does not describe keeps
 * that default's look.
 *
 * @param defaultSetIris The loaded metamodels' `arch:notationSet` values in load
 *   order, or {@link storeDefaultNotationSetIris} when the caller has no order.
 */
export function orderedFallbackSets(
  graph: Store,
  activeIri: string | undefined,
  defaultSetIris: readonly string[],
): NotationSet[] {
  const seen = new Set<string>();
  const sets: NotationSet[] = [];
  for (const iri of defaultSetIris) {
    if (seen.has(iri)) continue;
    seen.add(iri);
    if (iri === activeIri) continue;
    const set = buildVisualNotations(graph, iri);
    if (set) sets.push(set);
  }
  return sets;
}

/**
 * Every `arch:Metamodel`'s `arch:notationSet` in the graph, ordered by
 * metamodel IRI and then set IRI.
 *
 * The graph does not record load order, so this is the deterministic stand-in
 * when a caller passes none (tests, a palette generated outside the app).
 */
export function storeDefaultNotationSetIris(graph: Store): string[] {
  const pairs: Array<[metamodel: string, set: string]> = [];
  for (const metamodel of graph.getSubjects(namedNode(RDF_TYPE), namedNode(ARCH_METAMODEL), null)) {
    if (metamodel.termType !== 'NamedNode') continue;
    for (const set of graph.getObjects(metamodel, namedNode(ARCH_NOTATION_SET), null)) {
      if (set.termType === 'NamedNode') pairs.push([metamodel.value, set.value]);
    }
  }
  pairs.sort(([m1, s1], [m2, s2]) => compareIris(m1, m2) || compareIris(s1, s2));
  return [...new Set(pairs.map(([, set]) => set))];
}

/**
 * The core notation's sets (`core/core-notation.ttl`), in IRI order: the last
 * fallback layers, after every loaded metamodel's default set (VC-DD-5). No
 * manifest names them — they draw the core's own relationship types, whatever
 * the language: Association, Depends On, and Has Part and Refines, which
 * nesting may draw with the part or the refining concept inside — so a
 * language's own descriptor for a core class comes first.
 */
export function coreNotationSetIris(graph: Store): string[] {
  const sets = graph
    .getSubjects(namedNode(RDF_TYPE), namedNode(ARCH_VIS_NOTATION_SET), null)
    .filter((set) => set.termType === 'NamedNode' && set.value.startsWith(CORE_NOTATION_NS))
    .map((set) => set.value);
  return [...new Set(sets)].sort(compareIris);
}

function exactMatch(
  source: 'active' | 'fallback',
  notation: VisualNotation,
  classIri: string,
  own: string | undefined,
): ResolvedNotation {
  const prefVisNotation = notation.prefVisNotation ?? own;
  return {
    source,
    notation,
    matchedClassIri: classIri,
    notationSetIri: notation.notationSetIri,
    ...(prefVisNotation ? { prefVisNotation } : {}),
  };
}

function inheritedMatch(
  source: 'active-superclass' | 'fallback-superclass',
  notation: VisualNotation,
): ResolvedNotation {
  return {
    source,
    notation,
    matchedClassIri: notation.conceptIri,
    notationSetIri: notation.notationSetIri,
    ...(notation.prefVisNotation ? { prefVisNotation: notation.prefVisNotation } : {}),
  };
}

/** The class's own `arch:prefVisNotation`: the first object, whatever its term type, as the palette always read it. */
function ownPrefVisNotation(graph: Store, classIri: string): string | undefined {
  for (const object of graph.getObjects(namedNode(classIri), namedNode(ARCH_PREF_VIS_NOTATION), null)) {
    return object.value;
  }
  return undefined;
}
