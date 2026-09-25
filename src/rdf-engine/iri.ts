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
 * Model members hang under their model, following the published layout
 * (`{base}{notation}/{modelId}/…`, DD-15/DD-29 in the Linked.Archi design
 * decisions), so an IRI says which model it belongs to:
 *
 * ```
 * {base}{notation}/{uuid}                       the arch:Model
 * {model}/element/{uuid}                        an element
 * {model}/relationship/{uuid}                   a qualified relationship
 * {model}/view/{uuid}                           a view
 * {view}/node/{uuid}   {view}/link/{uuid}       diagram geometry
 * ```
 *
 * `base` defaults to `urn:la-gram:`, which is globally unique without claiming
 * anybody's domain; a team publishing its models sets its own HTTP base.
 */

/** Default base for models created in this tool. */
export const DEFAULT_MODEL_BASE = 'urn:la-gram:';

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

/** Kinds of resource minted under a model or a view. */
export type MintKind = 'element' | 'relationship' | 'view' | 'node' | 'link' | 'folder';

/** Strip trailing separators so `{parent}/{kind}/{uuid}` never doubles a slash. */
function trimParent(parent: string): string {
  return parent.replace(/[/#]+$/, '');
}

/** A new IRI of the given kind under a model (or, for geometry, under a view). */
export function mintIri(parentIri: string, kind: MintKind): string {
  return `${trimParent(parentIri)}/${kind}/${uuid()}`;
}

/**
 * A new model IRI.
 *
 * @param base Namespace base; `urn:la-gram:` unless the user configured one.
 * @param notation The notation slug (`archimate`, `bpmn`, …) — the first path
 *   segment the published layout reserves for it.
 */
export function mintModelIri(base: string = DEFAULT_MODEL_BASE, notation = 'model'): string {
  const separator = base.endsWith('/') || base.endsWith(':') || base.endsWith('#') ? '' : '/';
  return `${base}${separator}${notation}/${uuid()}`;
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
