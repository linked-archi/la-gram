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
 * A model owns a namespace, `{base}{notation}/{modelId}/` — the published
 * layout (DD-15/DD-29 in the Linked.Archi design decisions) — and everything
 * minted for it is a flat name in that namespace:
 *
 * ```
 * {ns}model                            the arch:Model
 * {ns}element-{uuid}                   an element
 * {ns}relationship-{uuid}              a qualified relationship
 * {ns}view-{uuid}                      a view
 * {ns}node-{uuid}   {ns}link-{uuid}    diagram geometry
 * {link}-points-{i}   {link}-p{i}      a link's route (list cells, points)
 * {ns}graph/model|semantic|views       the DD-15 graphs, at rest only
 * ```
 *
 * Flat, because a Turtle prefixed name cannot contain `/`: with the namespace
 * bound to `m:` every minted IRI is written `m:element-…`, `m:view-…`.
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

/** Kinds of resource minted in a model's namespace. */
export type MintKind = 'element' | 'relationship' | 'view' | 'node' | 'link' | 'folder';

/**
 * A namespace IRI ends in `/`, `#` or `:`, so a local name can follow it
 * directly; anything else gets a `/`.
 */
export function ensureNamespace(namespace: string): string {
  const ns = namespace.trim();
  return /[/#:]$/.test(ns) ? ns : `${ns}/`;
}

/** A new IRI of the given kind in a model's namespace. */
export function mintIri(namespace: string, kind: MintKind): string {
  return `${ensureNamespace(namespace)}${kind}-${uuid()}`;
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
