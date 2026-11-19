/**
 * A model's IRIs against the layout every Linked.Archi tool mints (DD-41, the
 * IRI minting guide's *Conformance check*): what `la-gram-git check` reports.
 * It reports and never fails, so a repository's models do not start failing
 * for names given before the layout; those are counted as legacy.
 *
 * Read from the triples, as the guide says to: the model is the `arch:Model`, a
 * shape what has an `arch-vis:view`, a part what one of a part's properties
 * names from its one owner. Each IRI of the model's namespace — and the model's
 * own — goes into the first of these that applies:
 *
 * | Category     | The IRI |
 * |--------------|---------|
 * | `characters` | holds a character a path segment cannot, such as a space |
 * | `hashes`     | holds more than one `#` |
 * | `shape`      | is a shape not named `{view}#node/{id}` or `{view}#link/{id}`, for the view its `arch-vis:view` names |
 * | `part`       | is a part not named under its owner, `{owner}/…` |
 * | `outside`    | is none of these, and its local part is not `model`, `graph/…` or `{kind}/{id}` |
 *
 * — unless it is named as before the layout, which makes it `legacy` instead:
 * la-gram's `{kind}-{id}` and `{owner}-{part}`, a converter's
 * `{ns}view/{v}/node/{id}`, meta's derivation rules' `{ns}derivation-{sha1}`
 * and `{ns}derivation-activity-{sha1}[-association]`.
 */

import type { Quad, Term } from '@rdfjs/types';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { ensureNamespace, isPathNamespace } from '../rdf-engine/iri.js';
import { derivedNamespace } from './model-namespace.js';
import { SCHEMA_ITEM_LIST_ELEMENT } from './model-queries.js';
import { IRI } from './vocabulary.js';

/** What can be wrong with an IRI, in the order it is looked for; `legacy` is not wrong. */
export const LAYOUT_CATEGORIES = ['characters', 'hashes', 'shape', 'part', 'outside', 'legacy'] as const;
export type LayoutCategory = (typeof LAYOUT_CATEGORIES)[number];

/** A model's IRIs against the layout. */
export interface LayoutReport {
  /** The `arch:Model`. */
  model: string;
  /** Its namespace: stated, or derived from its IRI. */
  namespace: string;
  /** Whether the model states it, with `vann:preferredNamespaceUri`. */
  declared: boolean;
  /** What breaks DD-41's rule for the namespace, said of it (`holds a # or a ?`); absent when nothing does. */
  namespaceProblem?: string;
  /** The IRIs of each category, sorted. */
  iris: Record<LayoutCategory, string[]>;
}

/** The kinds of resource with an identity of their own: `{ns}{kind}/{id}`. */
const KINDS = 'element|relationship|view|folder|decision|documentation';
const IN_LAYOUT = new RegExp(`^(?:model(?:/.*)?|graph/[^/#]+|(?:${KINDS})/[^/#].*)$`);
/**
 * What la-gram minted before DD-41: `{ns}element-{uuid}`, `{ns}node-{uuid}`, and their parts, `{node}-style`;
 * and meta's ArchiMate derivation rules: `{ns}relationship-{sha1}` for a triple they qualified,
 * `{ns}derivation-{sha1}` for a derivation, `{ns}derivation-activity-{sha1}` and its `-association`.
 */
const LEGACY = /^(?:element|relationship|view|folder|node|link|derivation)-./;
/** A converter's shapes before DD-41: `{ns}view/{v}/node/{id}`. */
const LEGACY_SHAPE = /^view\/[^/#]+\/(?:node|link|connection)\/[^/#]+$/;
/** A path's characters (RFC 3987 `ipchar` and `/`), and a fragment's (`?` too, and `#`, which `hashes` counts). */
const PATH = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/]|%[0-9A-Fa-f]{2}|[^\x00-\x7F])*$/;
const FRAGMENT = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?#]|%[0-9A-Fa-f]{2}|[^\x00-\x7F])*$/;

const VANN_URI = NAMESPACES.vann + 'preferredNamespaceUri';
/** What names a part from its owner (DD-41's table): `{owner}/style`, `{owner}/label`, `{concept}/name/…`, `{folder}/item/…`. */
const PART_OF = new Set<string>([
  IRI.visStyle,
  IRI.visLabel,
  IRI.labelExpression,
  IRI.skosxlAltLabel,
  IRI.prefVisNotation,
  IRI.altVisNotation,
  ...SCHEMA_ITEM_LIST_ELEMENT.map((t) => t.value),
]);
const NODE_TYPES = new Set<string>([IRI.ArchNode, IRI.ContainerNode, IRI.LabelNode]);
/** A shape's fragment in its view: a line's `link/{id}`, a node's `node/{id}`, either for a shape of no known type. */
const SHAPE_NAME = { link: /^link\/[^/#]+$/, node: /^node\/[^/#]+$/, either: /^(?:node|link)\/[^/#]+$/ };

/** The layout report of a model's triples; `undefined` when they have no `arch:Model`. */
export function layoutReport(quads: readonly Quad[]): LayoutReport | undefined {
  const models = [
    ...new Set(quads.filter((q) => q.subject.termType === 'NamedNode' && q.predicate.value === IRI.rdfType && q.object.value === IRI.Model).map((q) => q.subject.value)),
  ].sort();
  const model = models[0];
  if (!model) return undefined;
  const stated = quads.find((q) => q.subject.value === model && q.predicate.value === VANN_URI && q.object.termType === 'Literal')?.object.value.trim();
  const namespace = stated ? ensureNamespace(stated) : derivedNamespace(model);
  const problem = namespaceFault(stated ?? namespace);

  // What the triples say a name is: a shape in a view, a part of an owner, a route's cells and points.
  const views = new Map<string, string>();
  const types = new Map<string, Set<string>>();
  const owners = new Map<string, Set<string>>();
  const labels = new Set<string>();
  const firsts = new Map<string, string>();
  const rests = new Map<string, string>();
  const routes: Array<[string, string]> = [];
  const iris = new Set<string>();
  const collect = (term: Term) => {
    if (term.termType === 'NamedNode') iris.add(term.value);
    else if (term.termType === 'Quad') {
      const inner = term as unknown as Quad;
      [inner.subject, inner.predicate, inner.object].forEach(collect);
    }
  };
  for (const q of quads) {
    [q.subject, q.predicate, q.object, q.graph].forEach(collect);
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue;
    const [s, p, o] = [q.subject.value, q.predicate.value, q.object.value];
    if (p === IRI.visView) views.set(s, o);
    else if (p === IRI.rdfType) add(types, s, o);
    else if (p === IRI.points) routes.push([s, o]);
    else if (p === IRI.rdfFirst) firsts.set(s, o);
    else if (p === IRI.rdfRest) rests.set(s, o);
    if (PART_OF.has(p)) add(owners, o, s);
    if (p === IRI.visLabel) labels.add(o);
  }
  // A route's cells and points are the line's.
  for (const [link, first] of routes) {
    const seen = new Set<string>();
    for (let cell: string | undefined = first; cell && cell !== IRI.rdfNil && !seen.has(cell); cell = rests.get(cell)) {
      seen.add(cell);
      add(owners, cell, link);
      const point = firsts.get(cell);
      if (point) add(owners, point, link);
    }
  }

  /** Where an IRI of the namespace goes, or the model's; `undefined` when it is in the layout. */
  const categoryOf = (iri: string): LayoutCategory | undefined => {
    // The model, not `{ns}model`.
    if (!iri.startsWith(namespace)) return 'outside';
    const local = iri.slice(namespace.length);
    const hash = local.indexOf('#');
    if (!PATH.test(hash < 0 ? local : local.slice(0, hash)) || (hash >= 0 && !FRAGMENT.test(local.slice(hash + 1)))) return 'characters';
    if (iri.split('#').length > 2) return 'hashes';
    const view = views.get(iri);
    if (view && !labels.has(iri)) {
      const kinds = types.get(iri) ?? new Set<string>();
      const name = kinds.has(IRI.Link) ? SHAPE_NAME.link : [...kinds].some((t) => NODE_TYPES.has(t)) ? SHAPE_NAME.node : SHAPE_NAME.either;
      if (iri.startsWith(`${view}#`) && name.test(iri.slice(view.length + 1))) return undefined;
      return LEGACY.test(local) || LEGACY_SHAPE.test(local) ? 'legacy' : 'shape';
    }
    const owner = owners.get(iri);
    if (owner?.size === 1) {
      const [of] = [...owner];
      if (iri.startsWith(`${of}/`)) return undefined;
      return iri.startsWith(`${of}-`) ? 'legacy' : 'part';
    }
    if (IN_LAYOUT.test(local)) return undefined;
    return LEGACY.test(local) ? 'legacy' : 'outside';
  };

  const found = Object.fromEntries(LAYOUT_CATEGORIES.map((c) => [c, [] as string[]])) as Record<LayoutCategory, string[]>;
  for (const iri of [...iris].sort()) {
    if (iri !== model && (!iri.startsWith(namespace) || iri.length === namespace.length)) continue;
    const category = categoryOf(iri);
    if (category) found[category].push(iri);
  }
  return { model, namespace, declared: stated !== undefined, ...(problem ? { namespaceProblem: problem } : {}), iris: found };
}

/**
 * What breaks DD-41's rule for a model's namespace — an `https:` or `http:` IRI
 * that ends in `/`, with no `#` or `?` — said of it: `holds a # or a ?`.
 */
function namespaceFault(namespace: string): string | undefined {
  if (/[\s<>"{}|\\^`]/.test(namespace)) return 'holds characters an IRI cannot';
  if (/[#?]/.test(namespace)) return 'holds a # or a ?';
  if (!/^https?:\/\//i.test(namespace)) return 'is not an https: or http: IRI';
  if (!namespace.endsWith('/')) return 'does not end in /';
  return isPathNamespace(namespace) ? undefined : 'is not an https: or http: IRI ending in /';
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}
