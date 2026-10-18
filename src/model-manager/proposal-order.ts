/**
 * The order a language proposes its relationships in, when two elements are
 * connected: `arch:RelationshipProposalOrder` (core), an ordered collection of
 * relationship classes.
 *
 * ```turtle
 * am4tax:ProposalOrder a skos:OrderedCollection , arch:RelationshipProposalOrder ;
 *     skos:memberList ( am4:Realization am4:Serving … am4:Association ) .
 *
 * am4tax:CapabilityProposalOrder a skos:OrderedCollection , arch:RelationshipProposalOrder ;
 *     arch:domainIncludes am4:Capability ;
 *     arch:rangeIncludes  am4:Capability ;
 *     skos:memberList     ( am4:Composition ) .
 * ```
 *
 * An order with no `arch:domainIncludes` is the language's general order: it
 * decides between the relationships the language's metamodel draws for a pair
 * (`direct-permissions.ts`, `drawnBy`). One scoped with `arch:domainIncludes`,
 * and `arch:rangeIncludes`, puts its members first between the elements it
 * names; naming both ends is more specific than naming the source only. Where an
 * order lists a relationship's superclass rather than the class itself — a read
 * access under Access — the superclass's place is the class's.
 */

import type { NamedNode, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { nn } from './vocabulary.js';

const RDF_TYPE = nn(NAMESPACES.rdf + 'type');
const RDF_FIRST = nn(NAMESPACES.rdf + 'first');
const RDF_REST = nn(NAMESPACES.rdf + 'rest');
const RDF_NIL = NAMESPACES.rdf + 'nil';
const PROPOSAL_ORDER = nn(NAMESPACES.arch + 'RelationshipProposalOrder');
const MEMBER_LIST = nn(NAMESPACES.skos + 'memberList');
const DOMAIN_INCLUDES = nn(NAMESPACES.arch + 'domainIncludes');
const RANGE_INCLUDES = nn(NAMESPACES.arch + 'rangeIncludes');

/** One proposal order: its relationship classes in order, and the elements it applies to. */
interface Order {
  members: string[];
  /** `arch:domainIncludes`: empty for a general order. */
  sources: string[];
  /** `arch:rangeIncludes`. */
  targets: string[];
}

/**
 * Where a relationship stands in a language's proposal orders, for one pair.
 *
 * `scope` is how specifically an order applies: 0 one naming both elements' types,
 * 1 one naming the source's (or the target's) only, 2 the general order, 3 none
 * lists the relationship. `position` is its place in that order, first 0.
 */
export interface Proposal {
  scope: 0 | 1 | 2 | 3;
  position: number;
}

/** No order lists the relationship. */
export const NO_PROPOSAL: Proposal = { scope: 3, position: Number.POSITIVE_INFINITY };

/** The proposal orders of the loaded metamodels. */
export class ProposalOrders {
  constructor(private readonly orders: readonly Order[]) {}

  /** How many orders were read. */
  get size(): number {
    return this.orders.length;
  }

  /**
   * The most specific proposal for a relationship class between two elements,
   * given the `rdfs:subClassOf*` closures of all three (each including itself).
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
      const scope = scopeOf(order, sourceClosure, targetClosure);
      if (scope === undefined) continue;
      if (scope < best.scope || (scope === best.scope && position < best.position)) best = { scope, position };
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

/** How specifically an order applies to a pair, or `undefined` when it does not. */
function scopeOf(order: Order, sourceClosure: readonly string[], targetClosure: readonly string[]): 0 | 1 | 2 | undefined {
  const sourceNamed = order.sources.length > 0;
  const targetNamed = order.targets.length > 0;
  if (!sourceNamed && !targetNamed) return 2;
  if (sourceNamed && !order.sources.some((s) => sourceClosure.includes(s))) return undefined;
  if (targetNamed && !order.targets.some((t) => targetClosure.includes(t))) return undefined;
  return sourceNamed && targetNamed ? 0 : 1;
}

/** The members of an RDF list, in order. Bounded, so a malformed list that loops cannot hang. */
function listMembers(store: RdfStore, head: Term): string[] {
  const members: string[] = [];
  let node: Term | undefined = head;
  for (let i = 0; node && node.value !== RDF_NIL && i < 1000; i++) {
    const first = store.getQuads(node as NamedNode, RDF_FIRST)[0]?.object;
    if (first?.termType === 'NamedNode') members.push(first.value);
    node = store.getQuads(node as NamedNode, RDF_REST)[0]?.object;
  }
  return members;
}

/** Read every `arch:RelationshipProposalOrder` in the store (all graphs). */
export function readProposalOrders(store: RdfStore): ProposalOrders {
  const seen = new Set<string>();
  const orders: Order[] = [];
  for (const typed of store.getQuads(null, RDF_TYPE, PROPOSAL_ORDER)) {
    const order = typed.subject;
    if (seen.has(order.value)) continue;
    seen.add(order.value);
    const head = store.getQuads(order as NamedNode, MEMBER_LIST)[0]?.object;
    if (!head) continue;
    const named = (predicate: NamedNode) =>
      store
        .getQuads(order as NamedNode, predicate)
        .map((q) => q.object)
        .filter((o) => o.termType === 'NamedNode')
        .map((o) => o.value);
    orders.push({ members: listMembers(store, head), sources: named(DOMAIN_INCLUDES), targets: named(RANGE_INCLUDES) });
  }
  return new ProposalOrders(orders);
}
