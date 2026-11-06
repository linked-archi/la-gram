/**
 * The model's namespace: where its IRIs are minted and what `m:` stands for.
 *
 * It is stored on the model resource with the VANN properties the Linked.Archi
 * ontologies use for their own namespaces, so it travels with the file and is
 * shared with collaborators like any other statement:
 *
 * ```turtle
 * m:model a arch:Model ;
 *     vann:preferredNamespacePrefix "m" ;
 *     vann:preferredNamespaceUri "https://example.org/archimate/3f2c…/" .
 * ```
 *
 * A model without them — an older file, another tool's — gets a derived one:
 * `{ns}` for a model named `{ns}model` (this tool's own shape), the model IRI
 * itself when it ends in `/` or `#`, else the model IRI plus `/`, which is
 * where earlier versions of this tool minted.
 *
 * Changing the namespace can take the model's existing IRIs along
 * ({@link planNamespaceChange}): a model started under the `example.org`
 * placeholder is moved into the team's namespace in one step.
 */

import type { Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { DEFAULT_MODEL_BASE, MODEL_LOCAL_NAME, ensureNamespace, namespaceOfIri } from '../rdf-engine/iri.js';
import { modelQuads } from './model-queries.js';
import { T, nn, stringLiteral, triple } from './vocabulary.js';

/** Prefix the model's namespace gets unless the model says otherwise. */
export const DEFAULT_MODEL_PREFIX = 'm';

const VANN_URI = NAMESPACES.vann + 'preferredNamespaceUri';
const VANN_PREFIX = NAMESPACES.vann + 'preferredNamespacePrefix';

/** A model's namespace and prefix. */
export interface ModelNamespace {
  namespace: string;
  prefix: string;
  /** Whether the model states them (vs. derived from its IRI). */
  declared: boolean;
}

/** Namespace derived from a model IRI that declares none. */
export function derivedNamespace(modelIri: string): string {
  if (/[/#]$/.test(modelIri)) return modelIri;
  const own = new RegExp(`[/#]${MODEL_LOCAL_NAME}$`).exec(modelIri);
  return own ? modelIri.slice(0, own.index + 1) : `${modelIri}/`;
}

/** The model's namespace and prefix, declared or derived. */
export function readModelNamespace(store: RdfStore, modelIri: string): ModelNamespace {
  const model = nn(modelIri);
  const uri = store.getQuads(model, nn(VANN_URI)).find((q) => q.graph.termType === 'DefaultGraph')?.object.value.trim();
  const prefix = store.getQuads(model, nn(VANN_PREFIX)).find((q) => q.graph.termType === 'DefaultGraph')?.object.value.trim();
  return {
    namespace: uri ? ensureNamespace(uri) : derivedNamespace(modelIri),
    prefix: prefix && isValidPrefix(prefix) ? prefix : DEFAULT_MODEL_PREFIX,
    declared: Boolean(uri),
  };
}

/** Where to mint for a model; the default base when there is no model. */
export function modelNamespace(store: RdfStore, modelIri: string | undefined): string {
  return modelIri ? readModelNamespace(store, modelIri).namespace : DEFAULT_MODEL_BASE;
}

/** Where to mint geometry for a view: its model's namespace, else the view's own. */
export function viewNamespace(store: RdfStore, viewIri: string): string {
  const model = store.getQuads(nn(viewIri), T.inModel).find((q) => q.graph.termType === 'DefaultGraph')?.object.value;
  return model ? modelNamespace(store, model) : namespaceOfIri(viewIri);
}

/** The VANN statements declaring a model's namespace. */
export function namespaceQuads(modelIri: string, namespace: string, prefix: string = DEFAULT_MODEL_PREFIX): Quad[] {
  const model = nn(modelIri);
  return [
    triple(model, nn(VANN_PREFIX), stringLiteral(prefix)),
    triple(model, nn(VANN_URI), stringLiteral(ensureNamespace(namespace))),
  ];
}

/** The VANN statements a model currently has. */
export function declaredNamespaceQuads(store: RdfStore, modelIri: string): Quad[] {
  const model = nn(modelIri);
  return [...store.getQuads(model, nn(VANN_PREFIX)), ...store.getQuads(model, nn(VANN_URI))].filter(
    (q) => q.graph.termType === 'DefaultGraph',
  );
}

/** A Turtle prefix name (`PN_PREFIX`, kept to the ASCII subset). */
export function isValidPrefix(prefix: string): boolean {
  return /^[A-Za-z]([\w.-]*[\w-])?$/.test(prefix);
}

/** Result of {@link planNamespaceChange}. */
export interface NamespaceChangePlan {
  /** Old IRI → new IRI, for every IRI that moves (the model's included). */
  mapping: Map<string, string>;
  remove: Quad[];
  add: Quad[];
}

/**
 * What moving a model from one namespace to another rewrites.
 *
 * Every IRI in the model data that starts with `from` moves to `to`, keeping
 * its local name — with any `/` in it turned into `-`, so IRIs minted by
 * earlier versions (`…/element/{uuid}`) become prefixable names
 * (`element-{uuid}`). The model resource itself becomes `{to}model`.
 *
 * IRIs a loaded vocabulary defines are left alone even when they happen to sit
 * under `from`: the model uses those terms, it does not own them. The model's
 * own VANN statements are not part of the plan; the caller writes new ones.
 */
export function planNamespaceChange(store: RdfStore, modelIri: string, from: string, to: string): NamespaceChangePlan {
  const source = ensureNamespace(from);
  const target = ensureNamespace(to);
  const mapping = new Map<string, string>();
  if (source === target && modelIri === `${target}${MODEL_LOCAL_NAME}`) return { mapping, remove: [], add: [] };

  const quads = modelQuads(store).filter(
    (q) => !(q.subject.value === modelIri && (q.predicate.value === VANN_URI || q.predicate.value === VANN_PREFIX)),
  );
  const present = new Set<string>();
  const candidates: string[] = [];
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object]) {
      if (term.termType !== 'NamedNode' || present.has(term.value)) continue;
      present.add(term.value);
      if (term.value !== modelIri && term.value.startsWith(source) && term.value.length > source.length) {
        candidates.push(term.value);
      }
    }
  }

  const taken = new Set<string>();
  const assign = (iri: string, next: string) => {
    mapping.set(iri, next);
    taken.add(next);
  };
  assign(modelIri, `${target}${MODEL_LOCAL_NAME}`);
  for (const iri of candidates.sort()) {
    if (definedByVocabulary(store, iri)) continue;
    const local = iri.slice(source.length);
    const flat = `${target}${local.replace(/\//g, '-')}`;
    // Flattening can in theory collide (`a/b` and `a-b`); keep the path then.
    const next = !taken.has(flat) && (!present.has(flat) || flat === iri) ? flat : `${target}${local}`;
    if (next !== iri) assign(iri, next);
  }
  if (mapping.get(modelIri) === modelIri) mapping.delete(modelIri);
  if (mapping.size === 0) return { mapping, remove: [], add: [] };

  const rename = (term: Term): Term => (term.termType === 'NamedNode' && mapping.has(term.value) ? nn(mapping.get(term.value)!) : term);
  const remove: Quad[] = [];
  const add: Quad[] = [];
  for (const q of quads) {
    const s = rename(q.subject);
    const p = rename(q.predicate);
    const o = rename(q.object);
    if (s === q.subject && p === q.predicate && o === q.object) continue;
    remove.push(q);
    add.push(triple(s, p, o));
  }
  return { mapping, remove, add };
}

/** Whether a vocabulary graph (anything but the model data) describes `iri`. */
function definedByVocabulary(store: RdfStore, iri: string): boolean {
  return store.getQuads(nn(iri)).some((q) => q.graph.termType !== 'DefaultGraph');
}
