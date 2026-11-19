/**
 * IRI minting.
 *
 * Every model resource gets an IRI when it is created and keeps it for life:
 * a rename, a move to another view or a round-trip through a file must never
 * change what a concept is called, because other models, commits and people's
 * links point at it. The only safe way to guarantee that across machines and
 * collaborators is a random UUID — a counter restarts with the process and two
 * users' counters collide.
 *
 * ## Shape
 *
 * A model owns a namespace, `{base}{notation}/{modelId}/` (DD-15/DD-29 in the
 * Linked.Archi design decisions), and what is minted for it follows the layout
 * every Linked.Archi tool shares (DD-41):
 *
 * ```
 * {ns}model                              the arch:Model
 * {ns}{kind}/{uuid}                      an element, relationship, view or folder
 * {view}#node-{uuid}  {view}#link-{uuid} a shape drawn in a view, named in the view's IRI
 * {owner}/{part}[/{key}]                 a part: {concept}/name/{context}, {folder}/item/{digest}, …
 * {shape}-{part}[-{key}]                 a shape's part: {node}-style, {link}-points-{i}, {link}-point-{i}, …
 * {ns}graph/model|semantic|views         the DD-15 graphs, at rest only
 * ```
 *
 * After a `#` everything is joined with `-`, which a Turtle prefixed name holds
 * as it is. Which shape a part belongs to is read from the triples, not from its
 * name.
 *
 * What la-gram minted before DD-41 keeps its name — `{ns}element-{uuid}`,
 * `{ns}node-{uuid}`, `{node}-style`, `{link}-points-{i}`, `{link}-p{i}` — and
 * is read as before: a tool never rewrites the local part of an IRI. Turtle
 * writes the layout short (`rdf-engine/turtle-writer.ts`): `me:{uuid}`,
 * `mv3ef7da72:node-{uuid}`.
 *
 * `base` is `https://example.org/` unless configured — a placeholder domain,
 * reserved for exactly this. A team publishing its models sets its own, and a
 * model's namespace can be changed afterwards (`model-namespace.ts`).
 */

/** Default base for models created in this tool. */
export const DEFAULT_MODEL_BASE = 'https://example.org/';

/** Local name of the `arch:Model` resource in its namespace. */
export const MODEL_LOCAL_NAME = 'model';

/** A random RFC 4122 v4 UUID. */
export function uuid(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  // `randomUUID` needs a secure context in browsers; `localhost` and `https`
  // are, but a page opened from `file://` may not be.
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID();
    } catch {
      /* fall through */
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Kinds of resource minted in a model's namespace, `{ns}{kind}/{uuid}`. A shape is minted in its view: {@link mintShapeIri}. */
export type MintKind = 'element' | 'relationship' | 'view' | 'folder';

/** Kinds of shape drawn in a view. */
export type ShapeKind = 'node' | 'link';

/**
 * A namespace IRI ends in `/`, `#` or `:`, so a local name can follow it
 * directly; anything else gets a `/`. A saved model's namespace is read so,
 * whatever its form; a new one also passes {@link namespaceProblem}.
 */
export function ensureNamespace(namespace: string): string {
  const ns = namespace.trim();
  return /[/#:]$/.test(ns) ? ns : `${ns}/`;
}

/** A new IRI of the given kind in a model's namespace: `{ns}{kind}/{uuid}` (DD-41). */
export function mintIri(namespace: string, kind: MintKind): string {
  return `${ensureNamespace(namespace)}${kind}/${uuid()}`;
}

/**
 * A new node's or link's IRI, named in its view's (DD-41): `{view}#node-{uuid}`,
 * `{view}#link-{uuid}`. An IRI holds one `#`, so in a view whose IRI already
 * holds one — a model saved with a namespace ending in `#` — the shape is minted
 * flat in the model's namespace, `{ns}node-{uuid}`, as la-gram minted every
 * shape before.
 */
export function mintShapeIri(viewIri: string, kind: ShapeKind, modelNamespace: () => string): string {
  return viewIri.includes('#') ? `${ensureNamespace(modelNamespace())}${kind}-${uuid()}` : `${viewIri}#${kind}-${uuid()}`;
}

/**
 * A part of `owner`, named under it (DD-41): `{owner}/{part}[/{key}]`, or, when
 * `owner` is named in a fragment — a shape, `{view}#node-{uuid}` —
 * `{owner}-{part}[-{key}]`, since after a `#` everything is joined with `-`.
 */
export function partIri(owner: string, ...segments: string[]): string {
  return [owner, ...segments].join(owner.includes('#') ? '-' : '/');
}

/**
 * Whether `iri` is the part `part` of `owner`, named either way la-gram names
 * parts — `{owner}/{part}`, or `{owner}-{part}`, as in a fragment and as before
 * DD-41 — with `/{key}` or `-{key}` after it when `key` matches.
 */
export function isPartNamed(owner: string, iri: string, part: string, key?: RegExp): boolean {
  if (!iri.startsWith(owner)) return false;
  const rest = iri.slice(owner.length);
  for (const joiner of ['/', '-']) {
    const name = `${joiner}${part}`;
    if (rest === name) return true;
    if (key && rest.startsWith(`${name}${joiner}`) && new RegExp(`^(?:${key.source})$`).test(rest.slice(name.length + 1))) return true;
  }
  return false;
}

/**
 * An identifier as one path segment, as the Linked.Archi converters encode it
 * (Java's `URLEncoder`, a space as `%20`): so an Exchange file imported here and
 * converted there gives the same local names.
 */
export function pathSegment(id: string): string {
  return encodeURIComponent(id).replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Whether `namespace` takes a reference relative to it: an `https:` or `http:`
 * IRI ending in `/`, with no `#` or `?` — DD-41's rule for a model's namespace.
 * A URN has no path to resolve against, and a `#` in it would give every shape two.
 */
export function isPathNamespace(namespace: string): boolean {
  return /^https?:\/\/[^/?#\s]+\/(?:[^?#\s]*\/)?$/.test(namespace);
}

/**
 * A new model namespace, `{base}{notation}/{uuid}/`.
 *
 * @param base Namespace base; `https://example.org/` unless configured.
 * @param notation The notation slug (`archimate`, `bpmn`, …) — the first path
 *   segment the published layout reserves for it.
 */
export function mintModelNamespace(base: string = DEFAULT_MODEL_BASE, notation = 'model'): string {
  return `${ensureNamespace(base)}${notation}/${uuid()}/`;
}

/** The `arch:Model` IRI in a namespace: `{ns}model`. */
export function modelIriIn(namespace: string): string {
  return `${ensureNamespace(namespace)}${MODEL_LOCAL_NAME}`;
}

/** A new model IRI: {@link modelIriIn} a fresh {@link mintModelNamespace}. */
export function mintModelIri(base: string = DEFAULT_MODEL_BASE, notation = 'model'): string {
  return modelIriIn(mintModelNamespace(base, notation));
}

/**
 * The namespace an IRI sits in: everything up to its last `/` or `#` (or `:`
 * for a URN). Used where no model says which namespace to mint in.
 */
export function namespaceOfIri(iri: string): string {
  const cut = Math.max(iri.lastIndexOf('/'), iri.lastIndexOf('#'));
  if (cut > iri.indexOf(':')) return iri.slice(0, cut + 1);
  const colon = iri.lastIndexOf(':');
  return colon >= 0 ? iri.slice(0, colon + 1) : ensureNamespace(iri);
}

/**
 * Whether `namespace` is an absolute IRI usable as a model namespace. Returns
 * the problem, or `null` when it is fine.
 */
export function namespaceProblem(namespace: string): string | null {
  const ns = namespace.trim();
  if (!ns) return 'The namespace is empty.';
  if (/[\s<>"{}|\\^`]/.test(ns)) return 'The namespace contains characters an IRI cannot.';
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:./.test(ns)) return 'The namespace must be an absolute IRI, such as https://example.org/models/payments/.';
  // DD-41: a diagram's shapes are named in their view's IRI after a `#`, and an IRI holds one.
  if (/[#?]/.test(ns)) return 'The namespace cannot hold a # or a ?, such as https://example.org/models/payments/.';
  if (!isPathNamespace(ensureNamespace(ns))) return 'The namespace must be an https: or http: IRI, such as https://example.org/models/payments/.';
  return null;
}

/**
 * Notation slug for a metamodel IRI: `…/archimate4/metamodel#ArchiMate4` →
 * `archimate`. Version digits are dropped so an ArchiMate 3.2 and a 4.0 model
 * share the notation segment, as the published converters do.
 */
export function notationSlug(metamodelIri: string | undefined): string {
  if (!metamodelIri) return 'model';
  const match = /^https?:\/\/[^/]+\/([^/#]+)/.exec(metamodelIri);
  const segment = match?.[1] ?? 'model';
  return segment.replace(/[0-9.]+$/, '').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'model';
}
