/**
 * Registry of the metamodel assets bundled with the application.
 *
 * The app ships a copy of the Linked.Archi ArchiMate 4.0 language definition so
 * a metamodel can be loaded with no network access. The TTL files and SVG icons
 * live under `assets/` in the repository and are emitted verbatim into the build
 * output (see `webpack.config.js`), so the same relative paths address them in
 * Node and in the browser.
 *
 * ## Layout mirrors the published site
 *
 * `assets/` is laid out exactly as `https://meta.linked.archi/` is deployed:
 *
 * ```
 * assets/core/core-onto.ttl              ← the arch: core ontology
 * assets/core/core-vis-onto.ttl          ← the arch-vis: visual-notation ontology
 * assets/archimate4/*.ttl                ← the ArchiMate 4.0 language files
 * assets/archimate4/icons/*.svg          ← element icons
 * assets/archimate4/icons/glyphs/*.svg   ← badge glyphs
 * ```
 *
 * That is what makes {@link resolveIconUri} a pure prefix rewrite: the visual
 * notation guide documents that for offline use `https://meta.linked.archi/`
 * resolves to the asset root, so
 * `https://meta.linked.archi/archimate4/icons/business-actor.svg` becomes
 * `assets/archimate4/icons/business-actor.svg`.
 *
 * ## Two environments, one path
 *
 * {@link fetchAssetText} reads an asset in either environment. Which one it is
 * in is decided from the *shape of the filesystem module* rather than by
 * sniffing globals — the same approach `rdf-engine/rdf-store.ts` uses to tell
 * the Node and browser Oxigraph builds apart, and the same
 * capability-then-dynamic-import shape as `platform/platform-factory.ts`:
 *
 * - Under Node/Vitest, `import('fs')` yields a module exposing a callable
 *   `promises.readFile`, so the asset is read off disk.
 * - Under the webpack `web` target, `resolve.fallback.fs === false` turns that
 *   same import into an empty module, no `readFile` surfaces, and the browser
 *   branch fetches the emitted URL instead.
 *
 * Note that probing for a global `fetch` alone would not distinguish them:
 * Node 18+ has `fetch` too. The filesystem capability is the discriminator.
 */

// ── Asset roles and descriptors ────────────────────────────────────────

/**
 * The logical part a bundled asset plays in a metamodel definition.
 *
 * These mirror the `arch:Metamodel` manifest properties: `arch:modelConcepts`
 * (`ontology`), `arch:conceptClassification` (`taxonomy`), `arch:notationSet`
 * (`notation`), `arch:formalRules` (`shapes`), `arch:architectureViewpoints`
 * (`viewpoints`) and `arch:presentationContextScheme`
 * (`presentationContexts`), plus the manifest itself and the two core
 * ontologies every language file `owl:imports`.
 *
 * `coreShapes` covers `core-shapes` and `core-vis-shapes`. No manifest names
 * them — they constrain the core and diagram vocabularies every model uses, so
 * the application loads them unconditionally and validates every model against
 * them (`arch:inModel` cardinality, `arch-vis:ArchNode` must name its element).
 * `derivationRules` is the `arch:derivationRules` document: SHACL-AF rules the
 * browser cannot execute, recorded so a remote load reports where it went.
 * `relationshipTables` is the relationship tables a manifest lists under
 * `arch:formalRules` beside the relationship shapes — the same table, as lookups,
 * which also say which relationships a modeller may draw directly. They hold no
 * shapes, so they are kept out of the shapes graph; the relationship manager
 * reads them (`direct-permissions.ts`).
 */
export type BundledAssetRole =
  | 'manifest'
  | 'ontology'
  | 'taxonomy'
  | 'notation'
  | 'shapes'
  | 'presentationContexts'
  | 'viewpoints'
  | 'derivationRules'
  | 'relationshipTables'
  | 'referenceData'
  | 'coreOntology'
  | 'coreVisOntology'
  | 'coreShapes';

/** A single TTL file shipped with the application. */
export interface BundledAsset {
  /** The part this file plays in the metamodel definition. */
  readonly role: BundledAssetRole;
  /**
   * IRI of the graph the file defines — the `owl:Ontology` subject, or the
   * `skos:ConceptScheme` subject for the taxonomy and presentation contexts.
   * Use it as the named-graph IRI when loading into the store.
   */
  readonly ontologyIri: string;
  /** Path relative to the asset root, always with `/` separators. */
  readonly path: string;
  /**
   * The document's `owl:versionIRI`, where another document imports it by its
   * version (meta's relationship tables and derivation rules import
   * `…/archimate4/onto/4.0#`): a lookup by either IRI finds the same file.
   */
  readonly versionIri?: string;
  /**
   * Id of the {@link BundledMetamodel} the file belongs to, or absent for the
   * core files every metamodel shares.
   */
  readonly metamodel?: string;
}

/**
 * A metamodel whose complete asset set ships with the application.
 *
 * Offline is a first-class mode: the app must start, and a model conforming to
 * one of these must open, with no network. Anything else resolves remotely —
 * see `asset-sources.ts`.
 */
export interface BundledMetamodel {
  /** Short stable id, also the asset sub-directory (`archimate4`). */
  readonly id: string;
  /** IRI of the `arch:Metamodel` subject in the manifest. */
  readonly metamodelIri: string;
  /** IRI of the manifest document (its `owl:Ontology`). */
  readonly manifestIri: string;
  /** Human-readable name for selectors. */
  readonly label: string;
}

/**
 * Root of the bundled assets, relative to the module output directory in the
 * browser and discovered on disk in Node. Kept as a bare relative segment so
 * the app works when served from a sub-path.
 */
export const ASSET_ROOT = 'assets';

/** Base the notation files publish their icon and ontology URIs under. */
export const PUBLISHED_BASE_URI = 'https://meta.linked.archi/';

/**
 * Asset-root-relative directories under which icons are actually bundled.
 *
 * Only these are shipped: the two ArchiMate icon sets, and the core-vis
 * decoration markers (`arch-vis:decorSymbol`) the canvas draws relationship
 * ends with. The other language icon sets exist on the published site but are
 * not in this bundle, so {@link resolveIconUri} reports them as unresolvable
 * rather than handing back a path that would 404.
 */
export const BUNDLED_ICON_PREFIXES: readonly string[] = ['archimate4/icons/', 'archimate3/icons/', 'core-vis/markers/'];

/**
 * The metamodels shipped complete, default first.
 *
 * ArchiMate 4.0 is the default language. ArchiMate 3.2 ships too because the
 * Open Group Exchange Format — the one interchange format every ArchiMate tool
 * writes — is a 3.x format, so importing an exchange file needs the 3.2
 * ontology whether or not the network is up.
 */
export const BUNDLED_METAMODELS: readonly BundledMetamodel[] = [
  {
    id: 'archimate4',
    metamodelIri: 'https://meta.linked.archi/archimate4/metamodel#ArchiMate4',
    manifestIri: 'https://meta.linked.archi/archimate4/metamodel#',
    label: 'ArchiMate 4.0',
  },
  {
    id: 'archimate3',
    metamodelIri: 'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2',
    manifestIri: 'https://meta.linked.archi/archimate3/metamodel#',
    label: 'ArchiMate 3.2',
  },
  {
    // The core ontology as a metamodel: a generic element and relationship.
    // Its manifest and taxonomy are la-gram's own until meta.linked.archi publishes them.
    id: 'core',
    metamodelIri: 'https://meta.linked.archi/core/metamodel#Core',
    manifestIri: 'https://meta.linked.archi/core/metamodel#',
    label: 'Linked.Archi Core',
  },
];

/** The metamodel loaded when nothing else is asked for. */
export const DEFAULT_METAMODEL: BundledMetamodel = BUNDLED_METAMODELS[0];

/**
 * The per-language files, generated from one table so both bundled languages
 * carry the same roles under the same names.
 *
 * `derivationRules` are not bundled: SHACL-AF rules need a server-side engine,
 * and the browser would only carry them to ignore them.
 */
function languageAssets(
  id: string,
  published: string,
  filePrefix: string,
  version: string,
): BundledAsset[] {
  const doc = (suffix: string) => `https://meta.linked.archi/${published}/${suffix}#`;
  const path = (suffix: string) => `${id}/${filePrefix}-${suffix}.ttl`;
  return [
    { role: 'manifest', ontologyIri: doc('metamodel'), path: path('metamodel'), metamodel: id },
    {
      role: 'ontology',
      ontologyIri: doc('onto'),
      versionIri: `https://meta.linked.archi/${published}/onto/${version}#`,
      path: path('onto'),
      metamodel: id,
    },
    { role: 'taxonomy', ontologyIri: doc('tax'), path: path('tax'), metamodel: id },
    { role: 'notation', ontologyIri: doc('notation'), path: path('notation'), metamodel: id },
    { role: 'shapes', ontologyIri: doc('element-shapes'), path: path('element-shapes'), metamodel: id },
    { role: 'shapes', ontologyIri: doc('shapes'), path: path('relationship-shapes'), metamodel: id },
    { role: 'shapes', ontologyIri: doc('principle-shapes'), path: path('principle-shapes'), metamodel: id },
    { role: 'shapes', ontologyIri: doc('viewpoint-shapes'), path: path('viewpoint-shapes'), metamodel: id },
    {
      role: 'relationshipTables',
      ontologyIri: doc('relationship-tables'),
      path: path('relationship-tables'),
      metamodel: id,
    },
    {
      role: 'presentationContexts',
      ontologyIri: doc('presentation-contexts'),
      path: path('presentation-contexts'),
      metamodel: id,
    },
    { role: 'viewpoints', ontologyIri: doc('viewpoints'), path: path('viewpoints'), metamodel: id },
    { role: 'referenceData', ontologyIri: doc('reference-data'), path: path('reference-data'), metamodel: id },
  ];
}

/**
 * Every TTL asset in the bundle, in dependency order.
 *
 * The core files come first because every language file `owl:imports` `arch:`,
 * and the notation files also import `arch-vis:`. Loading in array order
 * therefore never leaves a dangling import.
 */
export const BUNDLED_ASSETS: readonly BundledAsset[] = [
  {
    role: 'coreOntology',
    ontologyIri: 'https://meta.linked.archi/core#',
    path: 'core/core-onto.ttl',
  },
  {
    role: 'coreVisOntology',
    ontologyIri: 'https://meta.linked.archi/core-vis#',
    path: 'core/core-vis-onto.ttl',
  },
  {
    role: 'coreShapes',
    ontologyIri: 'https://meta.linked.archi/core-shapes#',
    path: 'core/core-shapes.ttl',
  },
  {
    role: 'coreShapes',
    ontologyIri: 'https://meta.linked.archi/core-vis-shapes#',
    path: 'core/core-vis-shapes.ttl',
  },
  ...languageAssets('archimate4', 'archimate4', 'archimate4', '4.0'),
  ...languageAssets('archimate3', 'archimate3', 'archimate3.2', '3.2'),
  { role: 'manifest', ontologyIri: 'https://meta.linked.archi/core/metamodel#', path: 'core/core-metamodel.ttl', metamodel: 'core' },
  { role: 'taxonomy', ontologyIri: 'https://meta.linked.archi/core/tax#', path: 'core/core-tax.ttl', metamodel: 'core' },
];

// ── Registry lookups ───────────────────────────────────────────────────

/**
 * All bundled assets playing the given role, in bundle order.
 *
 * Returns an array rather than a single asset because several roles are
 * multi-valued — `arch:formalRules` on a manifest names four shapes graphs, and
 * every bundled language has its own manifest. Pass `metamodel` to keep one
 * language's files.
 */
export function getAssetsByRole(role: BundledAssetRole, metamodel?: string): BundledAsset[] {
  return BUNDLED_ASSETS.filter(
    (asset) => asset.role === role && (metamodel === undefined || asset.metamodel === metamodel),
  );
}

/** The bundled asset defining the given graph IRI, or `undefined`. */
export function getAssetByIri(ontologyIri: string): BundledAsset | undefined {
  return BUNDLED_ASSETS.find((asset) => asset.ontologyIri === ontologyIri || asset.versionIri === ontologyIri);
}

/**
 * The bundled metamodel matching an IRI — its `arch:Metamodel` subject or its
 * manifest document, with or without the trailing `#`.
 */
export function getBundledMetamodel(iri: string): BundledMetamodel | undefined {
  const normalized = iri.endsWith('#') ? iri : iri.includes('#') ? iri : `${iri}#`;
  return BUNDLED_METAMODELS.find(
    (mm) => mm.metamodelIri === iri || mm.manifestIri === normalized || mm.id === iri,
  );
}

// ── Icon URI resolution ────────────────────────────────────────────────

/**
 * Map a published icon URI from the notation data to its bundled path.
 *
 * Applies the offline resolution rule from the visual notation guide —
 * `https://meta.linked.archi/` is the asset root — and then checks the result
 * against {@link BUNDLED_ICON_PREFIXES}.
 *
 * @param iconUri Either an IRI (`arch:prefVisNotation`) or the string value of
 *   an `xsd:anyURI` literal (`arch-vis:iconSymbol`); both carry the same form.
 * @returns The asset-root-relative path, or `null` when the URI is not under
 *   the published base or names an icon set this bundle does not ship.
 */
export function resolveIconUri(iconUri: string): string | null {
  if (!iconUri.startsWith(PUBLISHED_BASE_URI)) return null;

  const relative = iconUri.slice(PUBLISHED_BASE_URI.length);
  const isBundled = BUNDLED_ICON_PREFIXES.some((prefix) => relative.startsWith(prefix));
  return isBundled ? relative : null;
}

/**
 * The asset-root-relative path for a published icon URI, or the URI unchanged
 * when it resolves to nothing bundled.
 *
 * Convenience for render paths that need *some* `src` and would rather let the
 * original URI fail on its own than deal with `null`.
 */
export function resolveIconUriOrPassThrough(iconUri: string): string {
  return resolveIconUri(iconUri) ?? iconUri;
}

// ── Asset loading ──────────────────────────────────────────────────────

/** The subset of `fs.promises.readFile` this module needs. */
type ReadFileUtf8 = (path: string, encoding: 'utf-8') => Promise<string>;

/** Explicitly configured Node asset root, if a caller set one. */
let assetRootOverride: string | null = null;

/** Memoized result of {@link discoverNodeAssetRoot}. */
let discoveredAssetRoot: string | null = null;

/**
 * Point Node asset resolution at a specific directory.
 *
 * The directory is the one *containing* `assets/`. Useful when the bundle is
 * relocated and the walk-up search in {@link discoverNodeAssetRoot} would not
 * find it. Pass `null` to go back to discovery.
 */
export function configureAssetRoot(directoryContainingAssets: string | null): void {
  assetRootOverride = directoryContainingAssets;
  discoveredAssetRoot = null;
}

/**
 * Probe for a filesystem, returning a reader only if one is really there.
 *
 * Mirrors `getWasmInitializer()` in `rdf-engine/rdf-store.ts`: inspect the
 * resolved module for the callable we need instead of asking the environment
 * what it is. Under the webpack `web` target `resolve.fallback.fs === false`
 * makes this an empty module, so the probe fails and the caller falls back to
 * `fetch`.
 */
async function getFileReader(): Promise<ReadFileUtf8 | null> {
  try {
    const mod: unknown = await import('fs');
    const candidates = [
      mod,
      (mod as { default?: unknown }).default,
    ];
    for (const candidate of candidates) {
      const promisesApi = (candidate as { promises?: { readFile?: unknown } } | undefined)?.promises;
      if (typeof promisesApi?.readFile === 'function') {
        return promisesApi.readFile as ReadFileUtf8;
      }
    }
    return null;
  } catch {
    // No filesystem module resolvable at all — definitively not Node.
    return null;
  }
}

/** Directory holding this module, as a filesystem path. Node only. */
function moduleDirectory(): string {
  const url = import.meta.url;
  const withoutScheme = url.startsWith('file://') ? url.slice('file://'.length) : url;
  const decoded = decodeURIComponent(withoutScheme);
  return decoded.slice(0, decoded.lastIndexOf('/'));
}

/**
 * Find the directory containing `assets/` by walking up from this module.
 *
 * Searching rather than assuming a fixed number of levels keeps this correct
 * whether the module runs from `src/metamodel-manager/` under Vitest or from a
 * bundle in `dist/`, as long as `assets/` sits somewhere above it. A sentinel
 * file is checked so a same-named unrelated directory cannot match.
 */
async function discoverNodeAssetRoot(readFile: ReadFileUtf8): Promise<string> {
  const sentinel = `${ASSET_ROOT}/${BUNDLED_ASSETS[0].path}`;
  let directory = moduleDirectory();

  for (let depth = 0; depth < 8 && directory.length > 1; depth += 1) {
    try {
      await readFile(`${directory}/${sentinel}`, 'utf-8');
      return directory;
    } catch {
      directory = directory.slice(0, directory.lastIndexOf('/'));
    }
  }

  throw new Error(
    `Could not locate the bundled '${ASSET_ROOT}/' directory by walking up from ${moduleDirectory()}. ` +
      'Call configureAssetRoot() with the directory that contains it.',
  );
}

/** Resolve the Node-side directory containing `assets/`, memoizing the search. */
async function nodeAssetRoot(readFile: ReadFileUtf8): Promise<string> {
  if (assetRootOverride !== null) return assetRootOverride;
  if (discoveredAssetRoot === null) {
    discoveredAssetRoot = await discoverNodeAssetRoot(readFile);
  }
  return discoveredAssetRoot;
}

/**
 * URL a bundled asset is served from in the browser.
 *
 * Resolved against the document base URI when there is one, so a deployment
 * under a sub-path still addresses the emitted files correctly.
 */
export function assetUrl(assetPath: string): string {
  const relative = `${ASSET_ROOT}/${assetPath}`;
  const baseUri = typeof document !== 'undefined' ? document.baseURI : undefined;
  return baseUri ? new URL(relative, baseUri).href : relative;
}

/**
 * Read the Turtle text of a bundled asset.
 *
 * @param asset A registry entry, or an asset-root-relative path such as
 *   `archimate4/archimate4-onto.ttl`.
 * @throws If the asset cannot be read — a missing file in Node, or a non-OK
 *   response in the browser.
 */
export async function fetchAssetText(asset: BundledAsset | string): Promise<string> {
  const assetPath = typeof asset === 'string' ? asset : asset.path;

  const readFile = await getFileReader();
  if (readFile !== null) {
    const root = await nodeAssetRoot(readFile);
    return readFile(`${root}/${ASSET_ROOT}/${assetPath}`, 'utf-8');
  }

  if (typeof fetch !== 'function') {
    throw new Error(
      `Cannot read bundled asset '${assetPath}': no filesystem and no fetch available.`,
    );
  }

  const url = assetUrl(assetPath);
  // Revalidate: the static server sends no Cache-Control, and a re-synced
  // snapshot must not be shadowed by the browser's copy of the old one.
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch bundled asset '${assetPath}' from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

/**
 * Read every bundled TTL asset, in dependency order.
 *
 * Requests run concurrently; the returned array preserves
 * {@link BUNDLED_ASSETS} order so callers can load into the store in an order
 * that satisfies `owl:imports`.
 */
export async function fetchAllAssetTexts(): Promise<
  Array<{ asset: BundledAsset; ttl: string }>
> {
  return Promise.all(
    BUNDLED_ASSETS.map(async (asset) => ({ asset, ttl: await fetchAssetText(asset) })),
  );
}
