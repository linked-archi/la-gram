/**
 * Turtle and TriG with the IRIs of the Linked.Archi layout written short (DD-41, meta's *IRI Minting*, Turtle).
 *
 * A model's IRIs are `{ns}{kind}/{id}`, `{view}#{node|link}/{id}` for the shapes drawn in a view, and parts
 * under their owner, joined with `/`. A prefixed name holds a `/` or a `#` only escaped, so an IRI of the
 * model a file is about is written with the first of these that applies:
 *
 * 1. a prefix, where the rest is a plain local name: `m:model`, `me:{id}`, and la-gram's earlier flat names,
 *    `m:element-{uuid}`;
 * 2. a prefix per view, for a shape and its parts, with each `/` of the fragment escaped:
 *    `mv3ef7da72:node\/{id}`;
 * 3. a reference relative to `@base <{ns}>`: `<element/component/default/payments>`;
 * 4. the full IRI.
 *
 * N3.js cannot do this as it is. Given a `baseIRI` it makes an IRI relative before it looks for a prefix, so an
 * element comes out `<element/…>`, never `me:…`; it leaves an IRI in full when a later segment is shorter than
 * three characters (`…/points/0`); and it never escapes a `/`. So the writer here is N3's with one method of
 * its own, `_encodeIriOrBlank`, the one N3 calls for every IRI it writes. That method is internal: `package.json`
 * pins n3 to {@link N3_VERSION}, and a test fails when another is installed (`.agents/tasks/iri-layout/design.md`).
 */

import { Writer as N3Writer } from 'n3';
import type { Quad, Term } from '@rdfjs/types';
import type { PrefixMap } from './interfaces.js';
import { isPathNamespace } from './iri.js';
import { sha256Hex } from '../model-manager/short-hash.js';

export { isPathNamespace };

/** The n3 version whose internal `_encodeIriOrBlank` {@link LayoutWriter} overrides. */
export const N3_VERSION = '2.13.12';

/** The model a file is about: its namespace and the prefix it declares (`vann:preferredNamespace…`). */
export interface TurtleModel {
  namespace: string;
  prefix: string;
}

/** Options for {@link writeTurtle}. */
export interface TurtleOptions {
  /** `text/turtle` unless TriG is asked for. */
  format?: 'text/turtle' | 'application/trig';
  /** The prefixes known: the standard ones, the loaded vocabularies' and the model's own. */
  prefixes: PrefixMap;
  /** Write only the known prefixes some IRI in the file starts with; otherwise all of them. */
  onlyUsed?: boolean;
  /** The model the file is about; without one, prefixes only, as N3 writes them. */
  model?: TurtleModel;
}

/**
 * The kinds of resource with a prefix of their own: the letters the model's prefix is followed by, and the
 * path segment of the kind (`{p}e:` for `{ns}element/`). DD-41's table, in its order.
 */
export const KIND_PREFIXES: ReadonlyArray<readonly [suffix: string, segment: string]> = [
  ['e', 'element/'],
  ['r', 'relationship/'],
  ['v', 'view/'],
  ['f', 'folder/'],
  ['d', 'decision/'],
  ['doc', 'documentation/'],
  ['g', 'graph/'],
];

/** The prefix a view's shapes are written with: `{p}v` and the first 8 hex characters of the SHA-256 of its IRI. */
export function viewPrefixLabel(prefix: string, viewIri: string): string {
  return `${prefix}v${sha256Hex(viewIri).slice(0, 8)}`;
}

/**
 * The prefixes a file about `model` binds besides the known ones: one per kind its IRIs use, and one per view
 * whose shapes it writes — `{view}#` for each IRI of the model with a `#` after the namespace.
 *
 * A derived prefix whose label a known prefix holds for another namespace is not bound: the vocabulary keeps
 * it, and those IRIs are written by the next rule that applies. Nor is one whose namespace a known prefix
 * already names. Of two views with one label, the view whose IRI sorts first keeps it.
 */
export function modelPrefixes(model: TurtleModel, iris: Iterable<string>, known: PrefixMap): PrefixMap {
  const ns = model.namespace;
  const derived: PrefixMap = {};
  const named = new Set(Object.values(known));
  const bind = (label: string, uri: string): void => {
    if (label in derived || named.has(uri)) return;
    if (label in known && known[label] !== uri) return;
    derived[label] = uri;
  };
  const used = new Set<string>();
  const views = new Set<string>();
  for (const iri of iris) {
    if (!iri.startsWith(ns) || iri.length === ns.length) continue;
    used.add(iri);
    const hash = iri.indexOf('#', ns.length);
    if (hash > 0) views.add(iri.slice(0, hash + 1));
  }
  if (used.size > 0 && !(model.prefix in known)) bind(model.prefix, ns);
  for (const [suffix, segment] of KIND_PREFIXES) {
    const uri = ns + segment;
    for (const iri of used) {
      if (iri.startsWith(uri) && iri.length > uri.length) {
        bind(model.prefix + suffix, uri);
        break;
      }
    }
  }
  for (const view of [...views].sort()) bind(viewPrefixLabel(model.prefix, view.slice(0, -1)), view);
  return derived;
}

/**
 * Keep only the prefixes some IRI in the quads starts with: a subject, predicate, object or graph, or a
 * literal's datatype. Not the inside of a triple term, as before the layout, so that a file la-gram wrote
 * then keeps its prefixes.
 */
export function usedPrefixes(prefixes: PrefixMap, quads: readonly Quad[]): PrefixMap {
  const iris = new Set<string>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      if (term.termType === 'NamedNode') iris.add(term.value);
      if (term.termType === 'Literal') iris.add(term.datatype.value);
    }
  }
  const used: PrefixMap = {};
  for (const [prefix, uri] of Object.entries(prefixes)) {
    for (const iri of iris) {
      if (iri.startsWith(uri) && iri.length > uri.length) {
        used[prefix] = uri;
        break;
      }
    }
  }
  return used;
}

/** Write quads as Turtle or TriG, in the order given. */
export function writeTurtle(quads: readonly Quad[], options: TurtleOptions): string {
  const known = options.prefixes;
  const derived = options.model ? modelPrefixes(options.model, iriSet(quads), known) : {};
  const prefixes = { ...(options.onlyUsed ? usedPrefixes(known, quads) : known), ...derived };
  const layout = options.model ? new Layout(options.model.namespace, prefixes) : undefined;
  const writer = new LayoutWriter({ prefixes, format: options.format ?? 'text/turtle' }, layout);
  for (const q of quads) writer.addQuad(q as never);
  let output = '';
  writer.end((_error: Error | null, result: string) => {
    output = result ?? '';
  });
  return layout && writer.wroteRelative ? `@base <${layout.base}>.\n${output}` : output;
}

/** Every IRI in the quads, those inside an RDF 1.2 triple term and a literal's datatype included. */
function iriSet(quads: readonly Quad[]): Set<string> {
  const iris = new Set<string>();
  const visit = (term: Term): void => {
    if (term.termType === 'NamedNode') iris.add(term.value);
    else if (term.termType === 'Literal') iris.add(term.datatype.value);
    else if (term.termType === 'Quad') {
      visit(term.subject);
      visit(term.predicate);
      visit(term.object);
      visit(term.graph);
    }
  };
  for (const q of quads) {
    visit(q.subject);
    visit(q.predicate);
    visit(q.object);
    visit(q.graph);
  }
  return iris;
}

/** How the IRIs of one model's namespace are written where N3 writes them in full. */
class Layout {
  /** `{view}#` → the label of its prefix. */
  private readonly views = new Map<string, string>();
  /** The namespace, when references relative to it resolve; `undefined` otherwise. */
  readonly base: string | undefined;

  constructor(
    private readonly namespace: string,
    prefixes: PrefixMap,
  ) {
    this.base = isPathNamespace(namespace) ? namespace : undefined;
    for (const [label, uri] of Object.entries(prefixes)) {
      if (uri.startsWith(namespace) && uri.endsWith('#') && uri.indexOf('#', namespace.length) === uri.length - 1) {
        this.views.set(uri, label);
      }
    }
  }

  /**
   * `iri` written by the view prefix or relative to the namespace, from `full`, N3's `<…>` of it; `undefined`
   * when neither applies.
   */
  encode(iri: string, full: string): { text: string; relative: boolean } | undefined {
    if (!iri.startsWith(this.namespace)) return undefined;
    const hash = iri.indexOf('#', this.namespace.length);
    if (hash > 0) {
      const label = this.views.get(iri.slice(0, hash + 1));
      const local = label === undefined ? undefined : escapedLocalName(iri.slice(hash + 1));
      if (local !== undefined) return { text: `${label}:${local}`, relative: false };
    }
    const base = this.base;
    if (base !== undefined && resolvesBack(iri.slice(base.length)) && full.startsWith(`<${base}`)) {
      return { text: `<${full.slice(1 + base.length)}`, relative: true };
    }
    return undefined;
  }
}

/**
 * Whether `reference`, the rest of an IRI after a namespace ending in `/`, resolves back to that IRI against
 * it: not empty, not a path from the root, no `:` in its first segment, where it would be read as a scheme,
 * and no `.` or `..` segment, which resolving removes.
 */
function resolvesBack(reference: string): boolean {
  if (reference === '' || reference.startsWith('/')) return false;
  if (/^[^/?#]*/.exec(reference)![0].includes(':')) return false;
  return !/^[^?#]*/.exec(reference)![0].split('/').some((segment) => segment === '.' || segment === '..');
}

/** Characters a Turtle local name may hold escaped (`PN_LOCAL_ESC`). */
const LOCAL_ESCAPABLE = new Set("_~.-!$&'()*+,;=/?#@%");
/** A character that may start a local name (`PN_CHARS_U`, `:` and digits). */
const LOCAL_START = /^[A-Za-z0-9_:\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]$/u;
/** A character that may follow it (`PN_CHARS` and `:`), `.` aside. */
const LOCAL_CHAR = /^[A-Za-z0-9_:\-\u00B7\u0300-\u036F\u203F\u2040\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]$/u;

/**
 * `local` as a Turtle local name (`PN_LOCAL`): each `/` as `\/`, and any other character a local name cannot
 * hold where it stands escaped with `\`, a `%` and two hex digits left as they are. `undefined` when a
 * character can be neither written nor escaped.
 */
export function escapedLocalName(local: string): string | undefined {
  const chars = [...local];
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]!;
    if (c === '%' && /^[0-9A-Fa-f]{2}$/.test((chars[i + 1] ?? '') + (chars[i + 2] ?? ''))) {
      out += c + chars[i + 1] + chars[i + 2];
      i += 2;
    } else if (i === 0 ? LOCAL_START.test(c) : LOCAL_CHAR.test(c) || (c === '.' && i < chars.length - 1)) {
      out += c;
    } else if (LOCAL_ESCAPABLE.has(c)) {
      out += `\\${c}`;
    } else {
      return undefined;
    }
  }
  return out;
}

/** N3's own encoding of an IRI or blank node, which {@link LayoutWriter} starts from. */
type Encode = (this: N3Writer, entity: Term) => string;
const n3Encode = (N3Writer.prototype as unknown as { _encodeIriOrBlank?: Encode })._encodeIriOrBlank;
if (typeof n3Encode !== 'function') {
  throw new Error(`n3's Writer has no _encodeIriOrBlank: turtle-writer.ts was written against n3 ${N3_VERSION}`);
}

/**
 * N3's writer, encoding an IRI of the model by {@link Layout} where N3 would write it in full. Subjects,
 * predicates, objects, graphs, datatypes and triple terms all reach it.
 */
class LayoutWriter extends N3Writer {
  /** Whether an IRI was written relative to the namespace, so the file needs its `@base`. */
  wroteRelative = false;

  constructor(
    options: { prefixes: PrefixMap; format: string },
    private readonly layout: Layout | undefined,
  ) {
    super(options);
  }

  _encodeIriOrBlank(entity: Term): string {
    const encoded = n3Encode!.call(this, entity);
    if (!this.layout || entity.termType !== 'NamedNode' || !encoded.startsWith('<')) return encoded;
    const shorter = this.layout.encode(entity.value, encoded);
    if (!shorter) return encoded;
    if (shorter.relative) this.wroteRelative = true;
    return shorter.text;
  }
}
