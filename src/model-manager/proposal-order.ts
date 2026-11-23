/**
 * The orders a language proposes its relationships in, when two elements are
 * connected: the ordered collections of relationship classes its metamodel
 * names with `arch:relationshipProposalOrder` (core; the rule is that
 * property's definition).
 *
 * ```turtle
 * am4mm:ArchiMate4 arch:relationshipProposalOrder am4tax:ProposalOrder , am4tax:BehaviorProposalOrder .
 *
 * am4tax:ProposalOrder a skos:OrderedCollection ;
 *     skos:memberList ( am4:Composition am4:Aggregation … am4:Association ) .
 *
 * am4tax:BehaviorProposalOrder a skos:OrderedCollection ;
 *     arch:domainIncludes am4:BehaviorElement ;
 *     arch:rangeIncludes  am4:BehaviorElement ;
 *     skos:memberList     ( am4:Triggering am4:Flow am4:Composition … ) .
 * ```
 *
 * An order with no `arch:domainIncludes` or `arch:rangeIncludes` is the
 * general order, which applies to every pair. One with either applies where
 * the source, the target, or both are of a class it names or of a subclass.
 * A relationship takes the place the most specific order that lists it gives
 * it: one naming both ends before one naming one, before the general order;
 * between two naming the same ends, the one whose classes are subclasses of the
 * other's — measured here by the size of each matched class's `rdfs:subClassOf*`
 * closure, which agrees with "subclass of" wherever one order's classes are
 * subclasses of the other's. Where an order lists a relationship's superclass
 * rather than the class itself — a read access under Access — the
 * superclass's place is the class's.
 *
 * The pointer is read from the metamodel's own document — a quad in a named
 * graph — never from the model's default graph, so a model file cannot add an
 * order; the collections themselves are in the language's taxonomy.
 */

import type { NamedNode, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { nn } from './vocabulary.js';

const RDF_FIRST = nn(NAMESPACES.rdf + 'first');
const RDF_REST = nn(NAMESPACES.rdf + 'rest');
const RDF_NIL = NAMESPACES.rdf + 'nil';
const SUBCLASS_OF = nn(NAMESPACES.rdfs + 'subClassOf');
/** `arch:relationshipProposalOrder`: from a metamodel to an order it publishes. */
export const RELATIONSHIP_PROPOSAL_ORDER = NAMESPACES.arch + 'relationshipProposalOrder';
const MEMBER_LIST = nn(NAMESPACES.skos + 'memberList');
const DOMAIN_INCLUDES = nn(NAMESPACES.arch + 'domainIncludes');
const RANGE_INCLUDES = nn(NAMESPACES.arch + 'rangeIncludes');

/** One proposal order: its relationship classes in order, and the elements it applies to. */
interface Order {
  members: string[];
  /** `arch:domainIncludes`, each with the size of its `rdfs:subClassOf*` closure: empty for the general order. */
  sources: ReadonlyMap<string, number>;
  /** `arch:rangeIncludes`, likewise. */
  targets: ReadonlyMap<string, number>;
}

/**
 * Where a relationship stands in a language's proposal orders, for one pair:
 * how specifically the order that places it applies — `ends`, how many of the
 * two elements it names (0 for the general order), then `depth`, the closure
 * sizes of the classes it matches them by — and `position`, its place in that
 * order, first 0. A greater `ends`, then a greater `depth`, then a smaller
 * `position` ranks first (`compareProposals`).
 */
export interface Proposal {
  ends: number;
  depth: number;
  position: number;
}

/** No order lists the relationship. */
export const NO_PROPOSAL: Proposal = { ends: -1, depth: 0, position: Number.POSITIVE_INFINITY };

/** Negative when `a` ranks before `b`. */
export function compareProposals(a: Proposal, b: Proposal): number {
  return b.ends - a.ends || b.depth - a.depth || (a.position === b.position ? 0 : a.position < b.position ? -1 : 1);
}

/** Whether an order lists the relationship for the pair. */
export function isProposed(proposal: Proposal): boolean {
  return proposal.ends >= 0;
}

/** The proposal orders of the loaded metamodels. */
export class ProposalOrders {
  constructor(private readonly orders: readonly Order[]) {}

  /** How many orders were read. */
  get size(): number {
    return this.orders.length;
  }

  /**
   * The place the most specific order that lists a relationship class gives it
   * between two elements, given the `rdfs:subClassOf*` closures of all three
   * (each including itself).
   */
  proposal(
    relationshipIri: string,
    relationshipClosure: readonly string[],
    sourceClosure: readonly string[],
    targetClosure: readonly string[],
  ): Proposal {
    let best = NO_PROPOSAL;
    for (const order of this.orders) {
      const position = positionIn(order.members, relationshipIri, relationshipClosure);
      if (position < 0) continue;
      const fit = fitOf(order, sourceClosure, targetClosure);
      if (!fit) continue;
      const candidate = { ...fit, position };
      if (compareProposals(candidate, best) < 0) best = candidate;
    }
    return best;
  }
}

/** No proposal orders loaded. */
export const NO_PROPOSAL_ORDERS = new ProposalOrders([]);

/** The class's own place in the order, else the earliest place of a superclass it lists. */
function positionIn(members: readonly string[], relationshipIri: string, closure: readonly string[]): number {
  const own = members.indexOf(relationshipIri);
  if (own >= 0) return own;
  const inherited = members.map((member, i) => (closure.includes(member) ? i : -1)).filter((i) => i >= 0);
  return inherited.length > 0 ? Math.min(...inherited) : -1;
}

/**
 * How specifically an order applies to a pair, or `undefined` when it does not:
 * the ends it names, and the closure sizes of the most specific classes it names
 * that each end is of.
 */
function fitOf(order: Order, sourceClosure: readonly string[], targetClosure: readonly string[]): Omit<Proposal, 'position'> | undefined {
  let ends = 0;
  let depth = 0;
  for (const [named, closure] of [[order.sources, sourceClosure], [order.targets, targetClosure]] as const) {
    if (named.size === 0) continue;
    let matched = -1;
    for (const [iri, size] of named) if (closure.includes(iri) && size > matched) matched = size;
    if (matched < 0) return undefined;
    ends += 1;
    depth += matched;
  }
  return { ends, depth };
}

/** The members of an RDF list, in order. Bounded, so a malformed list that loops cannot hang. */
function listMembers(store: RdfStore, head: Term): string[] {
  const members: string[] = [];
  let node: Term | undefined = head;
  const seen = new Set<string>();
  while (node && node.value !== RDF_NIL && !seen.has(node.value)) {
    seen.add(node.value);
    const first = store.getQuads(node as NamedNode, RDF_FIRST)[0]?.object;
    if (first?.termType === 'NamedNode') members.push(first.value);
    node = store.getQuads(node as NamedNode, RDF_REST)[0]?.object;
  }
  return members;
}

/** The size of a class's `rdfs:subClassOf*` closure, itself included, across every loaded graph. */
function closureSize(store: RdfStore, classIri: string): number {
  const seen = new Set<string>([classIri]);
  const queue = [classIri];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const quad of store.getQuads(nn(next), SUBCLASS_OF)) {
      if (quad.object.termType === 'NamedNode' && !seen.has(quad.object.value)) {
        seen.add(quad.object.value);
        queue.push(quad.object.value);
      }
    }
  }
  return seen.size;
}

/** The orders the loaded metamodels name with `arch:relationshipProposalOrder`, in their own documents. */
export function readProposalOrders(store: RdfStore): ProposalOrders {
  const seen = new Set<string>();
  const orders: Order[] = [];
  const named = (order: NamedNode, predicate: NamedNode) =>
    new Map(
      store
        .getQuads(order, predicate)
        .map((q) => q.object)
        .filter((o) => o.termType === 'NamedNode')
        .map((o) => [o.value, closureSize(store, o.value)] as const),
    );
  for (const pointer of store.getQuads(null, nn(RELATIONSHIP_PROPOSAL_ORDER))) {
    // A metamodel's document is a named graph; the model is the default graph.
    if (pointer.graph.termType === 'DefaultGraph' || pointer.object.termType !== 'NamedNode') continue;
    const order = pointer.object;
    if (seen.has(order.value)) continue;
    seen.add(order.value);
    const head = store.getQuads(order, MEMBER_LIST)[0]?.object;
    if (!head) continue;
    orders.push({ members: listMembers(store, head), sources: named(order, DOMAIN_INCLUDES), targets: named(order, RANGE_INCLUDES) });
  }
  return new ProposalOrders(orders);
}
