/**
 * Metamodel Loader implementation.
 *
 * A real metamodel is not one file. The Linked.Archi languages publish an
 * `arch:Metamodel` *manifest* that points at the separate documents making up
 * the language definition:
 *
 * ```
 * am4mm:ArchiMate4 a arch:Metamodel ;
 *   arch:modelConcepts             <.../archimate4/onto#> ;      # the OWL classes
 *   arch:conceptClassification     <.../archimate4/tax#> ;       # the SKOS taxonomy
 *   arch:notationSet               am4not:ArchiMate40StandardNotation ;
 *   arch:formalRules               <.../element-shapes#>, … ;    # SHACL
 *   arch:architectureViewpoints    <.../viewpoints#> ;
 *   arch:presentationContextScheme am4pc:ArchiMatePresentationContexts .
 * ```
 *
 * Note that some of those values name a *document* (`…/tax#`) while others name
 * an *individual inside* a document (`am4not:ArchiMate40StandardNotation`).
 * {@link documentIriFor} normalises both to the document IRI, which is what the
 * bundled-asset registry is keyed by and what each graph is named after.
 *
 * Discovery follows those properties, every loaded document's `owl:imports`,
 * and the `arch:usesNotationSet` of the presentation contexts — the one place
 * an alternative notation set (Basic's bubble set) is named.
 *
 * ## One graph per document
 *
 * Every discovered document lands in its own named graph, keyed by its ontology
 * IRI. That keeps provenance intact — a caller can ask "what did the notation
 * file say" — and it is what {@link LoadedMetamodel.graphsByRole} reports back.
 *
 * ## Where documents come from
 *
 * Each document IRI is handed to an {@link AssetSource}: the bundle under
 * `assets/`, the network (`meta.linked.archi` or any dereferenceable IRI), or
 * files the user uploaded — chained, see `asset-sources.ts`. The loader does not
 * care which answered; the status entry records it.
 *
 * ## Honest partial loads
 *
 * A manifest references more than an editor needs — derivation rules,
 * deliverable templates, reference models — and a source may not reach every
 * document. Rather than fail or silently skip, every discovered asset gets a
 * {@link MetamodelAssetStatus} entry, so a caller can tell the user exactly
 * which layer is missing and why.
 */

import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import type { TtlParser, RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { isSafeIri } from '../rdf-engine/graph-scope.js';
import type {
  MetamodelLoader,
  MetamodelInfo,
  LoadedMetamodel,
  MetamodelAssetStatus,
} from './interfaces.js';
import {
  BUNDLED_ASSETS,
  DEFAULT_METAMODEL,
  fetchAssetText,
  getAssetByIri,
  getAssetsByRole,
  getBundledMetamodel,
  type BundledAsset,
  type BundledAssetRole,
} from './bundled-assets.js';
import {
  BundledAssetSource,
  parseRdf,
  type AssetDocument,
  type AssetFormat,
  type AssetOrigin,
  type AssetSource,
} from './asset-sources.js';
import { compareIris } from './class-hierarchy.js';

const { namedNode, quad } = DataFactory;

/**
 * `dcterms:` — what the published Linked.Archi files actually use for title and
 * description. `NAMESPACES.dc` is the older `dc:` elements namespace; both are
 * read so hand-written and published metamodels behave the same.
 */
const DCTERMS = 'http://purl.org/dc/terms/';

const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const OWL_ONTOLOGY = namedNode(NAMESPACES.owl + 'Ontology');
const OWL_IMPORTS = namedNode(NAMESPACES.owl + 'imports');
const OWL_VERSION_INFO = namedNode(NAMESPACES.owl + 'versionInfo');
const DC_TITLE = namedNode(NAMESPACES.dc + 'title');
const DC_DESCRIPTION = namedNode(NAMESPACES.dc + 'description');
const DCTERMS_TITLE = namedNode(DCTERMS + 'title');
const DCTERMS_DESCRIPTION = namedNode(DCTERMS + 'description');
const SKOS_PREF_LABEL = namedNode(NAMESPACES.skos + 'prefLabel');
const ARCH_METAMODEL = namedNode(NAMESPACES.arch + 'Metamodel');
const ARCH_NOTATION_SET = namedNode(NAMESPACES.arch + 'notationSet');
const ARCH_USES_NOTATION_SET = namedNode(NAMESPACES.arch + 'usesNotationSet');

/** Default graph IRI used for SHACL shapes. */
const SHAPES_GRAPH = namedNode('urn:la-gram:shapes');

/**
 * Manifest properties that point at another part of the language definition,
 * in the order they are followed.
 *
 * Ordering is cosmetic — everything ends up as quads either way — but following
 * concepts before classification before notation makes the status list read the
 * way the layers stack.
 */
const MANIFEST_ASSET_PROPERTIES: readonly string[] = [
  'modelConcepts',
  'conceptClassification',
  'notationSet',
  'formalRules',
  'architectureViewpoints',
  'viewpointLibrary',
  'architectureViewpointsRestrictions',
  'presentationContextScheme',
  'derivationRules',
  'referenceData',
  'referenceModels',
  'hasDeliverableTemplate',
  'basedOnFramework',
];

/**
 * Normalise a manifest value to the IRI of the document that defines it.
 *
 * `https://…/archimate4/tax#` is already a document IRI. `am4not:ArchiMate40-
 * StandardNotation` is an individual, and the document that defines it is
 * `https://…/archimate4/notation#` — everything up to and including the `#`.
 */
function documentIriFor(iri: string): string {
  // A bundled document, by its IRI or its owl:versionIRI: the graph is named by the former.
  const bundled = getAssetByIri(iri);
  if (bundled) return bundled.ontologyIri;
  const hash = iri.indexOf('#');
  if (hash === -1) return iri;
  return iri.slice(0, hash + 1);
}

/**
 * Manifest properties whose targets the editor never reads. They are recorded
 * with outcome `skipped` instead of being fetched: derivation rules need a
 * SHACL-AF engine, and the rest feed document generation. Reference data is
 * loaded: its concepts name the values a property may take.
 */
const SKIPPED_VIA: readonly string[] = [
  'derivationRules',
  'referenceModels',
  'hasDeliverableTemplate',
  'basedOnFramework',
];

/** The role a document plays, judged by the manifest property that named it. */
function roleFromVia(via: string): BundledAssetRole | undefined {
  switch (via) {
    case 'arch:modelConcepts':
      return 'ontology';
    case 'arch:conceptClassification':
      return 'taxonomy';
    case 'arch:notationSet':
    case 'arch:usesNotationSet':
      return 'notation';
    case 'arch:formalRules':
    case 'arch:architectureViewpointsRestrictions':
      return 'shapes';
    case 'arch:architectureViewpoints':
    case 'arch:viewpointLibrary':
      return 'viewpoints';
    case 'arch:presentationContextScheme':
      return 'presentationContexts';
    case 'arch:derivationRules':
      return 'derivationRules';
    case 'arch:referenceData':
      return 'referenceData';
    default:
      return undefined;
  }
}

/** A base IRI for resolving relative IRIs in a document: its IRI without the fragment. */
function dereferenceBase(documentIri: string): string {
  const hash = documentIri.indexOf('#');
  return hash === -1 ? documentIri : documentIri.slice(0, hash);
}

/** An IRI queued for loading, with a note on how it was discovered. */
interface DiscoveredRef {
  referencedIri: string;
  via: string;
}

/**
 * Concrete MetamodelLoader backed by a TtlParser and RdfStore.
 *
 * Each document is loaded into a named graph keyed by its ontology IRI.
 * SHACL shapes loaded through {@link loadShapes} go to a dedicated shapes graph
 * so the validator can find them without knowing the language.
 */
export class N3MetamodelLoader implements MetamodelLoader {
  /** Document IRIs already loaded — dedup key for both manifests and imports. */
  private loadedOntologies = new Set<string>();

  /**
   * @param source Where documents come from. Defaults to the bundle alone, which
   *   is what tests and offline use want; the application passes a chain that
   *   also dereferences IRIs over the network.
   */
  constructor(
    private parser: TtlParser,
    private store: RdfStore,
    private source: AssetSource = new BundledAssetSource(),
  ) {}

  /** Swap the document source (e.g. when the user goes offline). */
  setSource(source: AssetSource): void {
    this.source = source;
  }

  // ── Raw single-document loading ──────────────────────────────────────

  /**
   * Load one TTL document into a named graph keyed by its ontology IRI.
   *
   * Kept for raw TTL — hand-written test metamodels, a file the user opened —
   * where there is no manifest to follow.
   */
  async loadMetamodel(ttlContent: string): Promise<MetamodelInfo> {
    const quads = this.parseOrThrow(ttlContent, 'metamodel TTL');

    const ontologyIri = this.findOntologyIri(quads);
    if (!ontologyIri) {
      throw new Error('No ontology IRI found in metamodel (expected rdf:type owl:Ontology or dc:title)');
    }

    this.addToGraph(quads, ontologyIri);
    this.loadedOntologies.add(ontologyIri);

    return this.readInfo(quads, ontologyIri);
  }

  // ── Manifest-driven loading ──────────────────────────────────────────

  /**
   * Load a metamodel from its manifest, pulling in every document the manifest
   * points at plus their transitive `owl:imports`, from whatever the configured
   * {@link AssetSource} can reach. A presentation-contexts document adds the
   * notation sets its contexts select (`arch:usesNotationSet`): an alternative
   * set is named only there. The manifest's `arch:notationSet` stays the
   * default ({@link LoadedMetamodel.notationSetIri}).
   *
   * The manifest itself is loaded first so the `arch:Metamodel` subject is
   * queryable even if nothing else resolves. Discovered documents are fetched a
   * level at a time and in parallel: over the network the difference between
   * nine sequential round-trips and two parallel batches is most of cold start.
   *
   * @param manifestText The manifest document.
   * @param options.format Its serialization (Turtle by default).
   * @param options.metamodelIri Which `arch:Metamodel` subject to use when the
   *   document declares more than one.
   */
  async loadMetamodelFromManifest(
    manifestText: string,
    options: { format?: AssetFormat; metamodelIri?: string; origin?: AssetOrigin } = {},
  ): Promise<LoadedMetamodel> {
    const manifestQuads = this.parseDocument(manifestText, options.format, 'metamodel manifest');

    const metamodelIri = this.findMetamodelSubject(manifestQuads, options.metamodelIri);
    if (!metamodelIri) {
      throw new Error('No arch:Metamodel subject found in the manifest');
    }

    const manifestGraphIri = this.findOntologyIri(manifestQuads) ?? documentIriFor(metamodelIri);
    this.addToGraph(manifestQuads, manifestGraphIri);
    this.loadedOntologies.add(manifestGraphIri);

    const assets: MetamodelAssetStatus[] = [
      {
        referencedIri: metamodelIri,
        documentIri: manifestGraphIri,
        via: 'manifest',
        role: 'manifest',
        outcome: 'loaded',
        quadCount: manifestQuads.length,
        ...(options.origin ? { origin: options.origin } : {}),
      },
    ];
    const graphsByRole: Partial<Record<BundledAssetRole, string[]>> = { manifest: [manifestGraphIri] };

    // Everything the manifest points at, then everything those documents import.
    let level: DiscoveredRef[] = [
      ...this.discoverManifestRefs(manifestQuads, metamodelIri),
      ...this.discoverImports(manifestQuads, manifestGraphIri),
    ];
    const seen = new Set<string>([manifestGraphIri]);

    while (level.length > 0) {
      // De-duplicate the level first so two references to one document cost one
      // fetch, and so the status list names the first way it was reached.
      const batch: Array<{ ref: DiscoveredRef; documentIri: string }> = [];
      for (const ref of level) {
        const documentIri = documentIriFor(ref.referencedIri);
        if (seen.has(documentIri)) continue;
        seen.add(documentIri);
        batch.push({ ref, documentIri });
      }

      const results = await Promise.all(
        batch.map(({ ref, documentIri }) => this.resolveRef(ref, documentIri)),
      );

      const next: DiscoveredRef[] = [];
      for (const status of results) {
        assets.push(status);
        if (status.role && (status.outcome === 'loaded' || status.outcome === 'already-loaded')) {
          this.recordRole(graphsByRole, status.role, status.documentIri);
        }
        if (status.outcome === 'loaded') {
          // Follow this document's own imports, still deduping by document IRI.
          // Only the owl:imports quads are read back — materialising a 70 000-quad
          // shapes graph to find its one import would undo the bulk load.
          const importQuads = this.store.getQuads(null, OWL_IMPORTS, null, namedNode(status.documentIri));
          next.push(...this.discoverImports(importQuads, status.documentIri));
          // The alternative notation sets live where the contexts choose them,
          // not on the manifest — load them too, or choosing the context finds nothing.
          if (status.role === 'presentationContexts') {
            next.push(...this.discoverContextNotationSets(status.documentIri));
          }
        }
      }
      level = next;
    }

    const notationSetIri = this.firstObject(manifestQuads, metamodelIri, ARCH_NOTATION_SET.value);
    const presentationContextSchemeIri = this.firstObject(
      manifestQuads,
      metamodelIri,
      NAMESPACES.arch + 'presentationContextScheme',
    );

    return {
      metamodelIri,
      manifestGraphIri,
      info: this.readManifestInfo(manifestQuads, metamodelIri, manifestGraphIri),
      graphsByRole,
      notationSetIri,
      ...(presentationContextSchemeIri ? { presentationContextSchemeIri } : {}),
      assets,
    };
  }

  /**
   * Load a metamodel given any IRI naming it — the `arch:Metamodel` subject
   * (`…/archimate4/metamodel#ArchiMate4`), the manifest document
   * (`…/archimate4/metamodel#`) or its dereferenceable URL.
   *
   * The manifest is fetched through the configured source, so this works for
   * the bundled languages offline and for every published language online.
   */
  async loadMetamodelByIri(iri: string): Promise<LoadedMetamodel> {
    const bundled = getBundledMetamodel(iri);
    const documentIri = bundled?.manifestIri ?? documentIriFor(iri.includes('#') ? iri : `${iri}#`);
    const doc = await this.source.fetch(documentIri);
    if (!doc) {
      throw new Error(`No source could provide the metamodel manifest <${documentIri}>`);
    }
    const preferred = bundled?.metamodelIri ?? (iri.includes('#') && !iri.endsWith('#') ? iri : undefined);
    return this.loadMetamodelFromManifest(doc.text, {
      format: doc.format,
      origin: doc.origin,
      ...(preferred ? { metamodelIri: preferred } : {}),
    });
  }

  /**
   * Load a bundled metamodel — ArchiMate 4.0 unless another bundled id or IRI
   * is given. Convenience over {@link loadMetamodelFromManifest}: reads the
   * bundled manifest and follows it from there.
   */
  async loadBundledMetamodel(idOrIri?: string): Promise<LoadedMetamodel> {
    const bundled = idOrIri ? getBundledMetamodel(idOrIri) : DEFAULT_METAMODEL;
    const manifest: BundledAsset | undefined = bundled
      ? getAssetsByRole('manifest', bundled.id)[0]
      : undefined;
    if (!manifest) {
      throw new Error(
        `No bundled manifest for '${idOrIri ?? 'default'}' (${BUNDLED_ASSETS.length} assets registered)`,
      );
    }
    const ttl = await fetchAssetText(manifest);
    return this.loadMetamodelFromManifest(ttl, {
      origin: 'bundled',
      ...(bundled ? { metamodelIri: bundled.metamodelIri } : {}),
    });
  }

  /**
   * Load the core documents every model is validated against, whether or not a
   * manifest imports them: `core`, `core-vis` and their two shapes graphs.
   *
   * @returns The graph IRIs that are now present, keyed by role.
   */
  async loadCoreAssets(): Promise<Partial<Record<BundledAssetRole, string[]>>> {
    const graphsByRole: Partial<Record<BundledAssetRole, string[]>> = {};
    const core = BUNDLED_ASSETS.filter((asset) => asset.metamodel === undefined);
    const results = await Promise.all(
      core.map((asset) =>
        this.resolveRef({ referencedIri: asset.ontologyIri, via: 'core' }, asset.ontologyIri),
      ),
    );
    for (const status of results) {
      if (status.role && (status.outcome === 'loaded' || status.outcome === 'already-loaded')) {
        this.recordRole(graphsByRole, status.role, status.documentIri);
      }
    }
    return graphsByRole;
  }

  /**
   * Remove a metamodel's graphs from the store.
   *
   * Graphs still used by a metamodel in `keep` — the shared core ontologies,
   * above all — stay. The model data in the default graph is never touched:
   * switching language must not delete anybody's work.
   *
   * @returns The graph IRIs that were dropped.
   */
  unloadMetamodel(loaded: LoadedMetamodel, keep: readonly LoadedMetamodel[] = []): string[] {
    const retained = new Set<string>();
    for (const other of keep) {
      for (const graphs of Object.values(other.graphsByRole)) {
        for (const graph of graphs ?? []) retained.add(graph);
      }
    }
    const dropped: string[] = [];
    for (const [role, graphs] of Object.entries(loaded.graphsByRole)) {
      if (role === 'coreOntology' || role === 'coreVisOntology' || role === 'coreShapes') continue;
      for (const graph of graphs ?? []) {
        if (retained.has(graph)) continue;
        // One SPARQL DROP rather than materialising and removing each quad:
        // the relationship-shapes graphs alone are 70 000 quads.
        if (isSafeIri(graph)) {
          this.store.update(`DROP SILENT GRAPH <${graph}>`);
        } else {
          const quads = this.store.getQuads(null, null, null, namedNode(graph));
          if (quads.length > 0) this.store.removeQuads(quads);
        }
        this.loadedOntologies.delete(graph);
        dropped.push(graph);
      }
    }
    return dropped;
  }

  /** Document IRIs currently loaded through this loader. */
  loadedDocuments(): string[] {
    return [...this.loadedOntologies];
  }

  /**
   * Load one standalone document — an extension ontology, a shapes file — into
   * its own graph, and follow its `owl:imports`.
   *
   * @param role How the document should be treated (`shapes` graphs join
   *   validation; `ontology`, `taxonomy`, `notation` feed the palette).
   */
  async loadDocument(
    text: string,
    options: { format?: AssetFormat; role?: BundledAssetRole; documentIri?: string } = {},
  ): Promise<MetamodelAssetStatus> {
    const quads = this.parseDocument(text, options.format, 'document');
    const documentIri =
      options.documentIri ?? this.findOntologyIri(quads) ?? this.findSchemeIri(quads);
    if (!documentIri) {
      throw new Error('The document declares no owl:Ontology or skos:ConceptScheme to name its graph');
    }
    this.addToGraph(quads, documentIri);
    this.loadedOntologies.add(documentIri);
    for (const ref of this.discoverImports(quads, documentIri)) {
      await this.resolveRef(ref, documentIriFor(ref.referencedIri));
    }
    return {
      referencedIri: documentIri,
      documentIri,
      via: 'upload',
      role: options.role ?? this.inferRoleFromContent(quads),
      outcome: 'loaded',
      quadCount: quads.length,
      origin: 'uploaded',
    };
  }

  // ── SHACL shapes ─────────────────────────────────────────────────────

  async loadShapes(ttlContent: string): Promise<void> {
    const quads = this.parseOrThrow(ttlContent, 'SHACL shapes TTL');
    this.store.addQuads(
      quads.map((q) => quad(q.subject as Quad['subject'], q.predicate, q.object, SHAPES_GRAPH) as unknown as Quad),
    );
  }

  // ── owl:imports over already-loaded graphs ───────────────────────────

  /**
   * Walk `owl:imports` from an already-loaded ontology, loading any document
   * the source can provide that is not in the store yet.
   *
   * Unlike the manifest walk this starts from the store rather than from parsed
   * text, so it also works for documents a caller loaded by other means.
   */
  async resolveImports(ontologyIri: string): Promise<void> {
    const visited = new Set<string>();
    const queue: string[] = [ontologyIri];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) continue;
      visited.add(current);

      const importQuads = this.store.getQuads(
        namedNode(current),
        OWL_IMPORTS,
        null,
        namedNode(current),
      );

      for (const q of importQuads) {
        const importedIri = documentIriFor(q.object.value);
        if (!this.loadedOntologies.has(importedIri)) {
          const status = await this.resolveRef(
            { referencedIri: q.object.value, via: 'owl:imports' },
            importedIri,
          );
          // Unresolvable: record it as seen so repeated calls stay cheap, and
          // leave the graph absent.
          if (status.outcome !== 'loaded') this.loadedOntologies.add(importedIri);
        }
        queue.push(importedIri);
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /** Parse TTL, throwing a message that names what failed. */
  private parseOrThrow(ttlContent: string, what: string): Quad[] {
    const result = this.parser.parse(ttlContent);
    if (!result.ok) {
      throw new Error(`Failed to parse ${what}: ${result.error.message}`);
    }
    return result.quads;
  }

  /** Parse any supported serialization; Turtle goes through the injected parser. */
  private parseDocument(text: string, format: AssetFormat | undefined, what: string): Quad[] {
    if (!format || format === 'text/turtle') return this.parseOrThrow(text, `${what} TTL`);
    try {
      return parseRdf(text, format);
    } catch (err: unknown) {
      throw new Error(`Failed to parse ${what} (${format}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Resolve one discovered reference: skip it, report it as already present,
   * or fetch, parse and load it into its own named graph.
   */
  private async resolveRef(ref: DiscoveredRef, documentIri: string): Promise<MetamodelAssetStatus> {
    const bundledRole = getAssetByIri(documentIri)?.role;
    const role = bundledRole ?? roleFromVia(ref.via);
    const base: MetamodelAssetStatus = {
      referencedIri: ref.referencedIri,
      documentIri,
      via: ref.via,
      ...(role ? { role } : {}),
      outcome: 'loaded',
    };

    if (this.loadedOntologies.has(documentIri)) {
      return { ...base, outcome: 'already-loaded' };
    }

    if (SKIPPED_VIA.some((property) => ref.via === `arch:${property}`)) {
      return {
        ...base,
        outcome: 'skipped',
        message: 'Not used by the editor (server-side or document-generation asset)',
      };
    }

    let doc: AssetDocument | null;
    try {
      doc = await this.source.fetch(documentIri);
    } catch (err: unknown) {
      return { ...base, outcome: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    if (!doc) {
      return this.source.kind === 'bundled'
        ? { ...base, outcome: 'not-bundled', message: `No bundled asset defines <${documentIri}>` }
        : { ...base, outcome: 'unavailable', message: `No source could provide <${documentIri}>` };
    }

    try {
      // The document may have loaded concurrently via another branch.
      if (this.loadedOntologies.has(documentIri)) return { ...base, outcome: 'already-loaded' };
      const quadCount = this.insertDocument(doc, documentIri);
      this.loadedOntologies.add(documentIri);
      return {
        ...base,
        ...(doc.role ? { role: doc.role } : {}),
        quadCount,
        origin: doc.origin,
      };
    } catch (err: unknown) {
      return { ...base, outcome: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Put a fetched document into its named graph.
   *
   * Uses the store's native bulk loader when it has one — an order of
   * magnitude faster on the large relationship-shapes files — and the injected
   * parser otherwise. A document is a *graph*: its triples are taken as they
   * stand, and any graph names inside a quad format are flattened into it.
   *
   * @returns The number of quads loaded.
   */
  private insertDocument(doc: AssetDocument, documentIri: string): number {
    const flat = doc.format !== 'application/trig' && doc.format !== 'application/n-quads';
    if (this.store.load && flat) {
      return this.store.load(doc.text, {
        format: doc.format,
        graph: documentIri,
        baseIri: doc.location && /^https?:/.test(doc.location) ? doc.location : dereferenceBase(documentIri),
      });
    }
    const quads =
      doc.format === 'text/turtle'
        ? this.parseOrThrow(doc.text, `${doc.origin} asset '${doc.location ?? documentIri}'`)
        : parseRdf(doc.text, doc.format);
    this.addToGraph(quads, documentIri);
    return quads.length;
  }

  /** A document's role judged by what it declares, for uploads. */
  private inferRoleFromContent(quads: Quad[]): BundledAssetRole {
    const types = new Set(
      quads.filter((q) => q.predicate.value === RDF_TYPE.value).map((q) => q.object.value),
    );
    if (types.has(NAMESPACES.sh + 'NodeShape') || types.has(NAMESPACES.sh + 'PropertyShape')) {
      return 'shapes';
    }
    if (types.has(NAMESPACES.arch + 'Metamodel')) return 'manifest';
    if (types.has(NAMESPACES['arch-vis'] + 'VisualNotation')) return 'notation';
    if (types.has(NAMESPACES.arch + 'Viewpoint')) return 'viewpoints';
    if (types.has(NAMESPACES.skos + 'ConceptScheme') && !types.has(NAMESPACES.owl + 'Class')) {
      return 'taxonomy';
    }
    return 'ontology';
  }

  /** The `skos:ConceptScheme` subject — the graph name for a taxonomy file. */
  private findSchemeIri(quads: Quad[]): string | null {
    for (const q of quads) {
      if (
        q.predicate.value === RDF_TYPE.value &&
        q.object.value === NAMESPACES.skos + 'ConceptScheme' &&
        q.subject.termType === 'NamedNode'
      ) {
        return q.subject.value;
      }
    }
    return null;
  }

  /** Re-graph the quads and add them to the store. */
  private addToGraph(quads: Quad[], graphIri: string): void {
    const graphNode = namedNode(graphIri);
    this.store.addQuads(
      quads.map((q) => quad(q.subject as Quad['subject'], q.predicate, q.object, graphNode) as unknown as Quad),
    );
  }

  private recordRole(
    graphsByRole: Partial<Record<BundledAssetRole, string[]>>,
    role: BundledAssetRole,
    documentIri: string,
  ): void {
    const existing = graphsByRole[role];
    if (existing) {
      if (!existing.includes(documentIri)) existing.push(documentIri);
    } else {
      graphsByRole[role] = [documentIri];
    }
  }

  /** Every asset-pointing property value on the `arch:Metamodel` subject. */
  private discoverManifestRefs(quads: Quad[], metamodelIri: string): DiscoveredRef[] {
    const refs: DiscoveredRef[] = [];
    for (const property of MANIFEST_ASSET_PROPERTIES) {
      const predicate = NAMESPACES.arch + property;
      for (const q of quads) {
        if (q.subject.value !== metamodelIri) continue;
        if (q.predicate.value !== predicate) continue;
        if (q.object.termType !== 'NamedNode') continue;
        refs.push({ referencedIri: q.object.value, via: `arch:${property}` });
      }
    }
    return refs;
  }

  /**
   * The notation sets a loaded presentation-contexts document selects with
   * `arch:usesNotationSet`, read back from its graph.
   *
   * Each is queued like a manifest reference, so the level's dedup reduces it to
   * its document and skips the default set the manifest already named. Sorted
   * so the status list does not depend on store order.
   */
  private discoverContextNotationSets(documentIri: string): DiscoveredRef[] {
    const sets = new Set<string>();
    for (const q of this.store.getQuads(null, ARCH_USES_NOTATION_SET, null, namedNode(documentIri))) {
      if (q.object.termType === 'NamedNode') sets.add(q.object.value);
    }
    return [...sets]
      .sort(compareIris)
      .map((referencedIri) => ({ referencedIri, via: 'arch:usesNotationSet' }));
  }

  /** `owl:imports` values declared by a document (any subject in it). */
  private discoverImports(quads: Quad[], documentIri: string): DiscoveredRef[] {
    const refs: DiscoveredRef[] = [];
    for (const q of quads) {
      if (q.predicate.value !== OWL_IMPORTS.value) continue;
      if (q.object.termType !== 'NamedNode') continue;
      refs.push({ referencedIri: q.object.value, via: `owl:imports (${documentIri})` });
    }
    return refs;
  }

  /** The `arch:Metamodel` subject, if the document declares one. */
  private findMetamodelSubject(quads: Quad[], preferred?: string): string | null {
    if (preferred) {
      const declared = quads.some(
        (q) =>
          q.subject.value === preferred &&
          q.predicate.value === RDF_TYPE.value &&
          q.object.value === ARCH_METAMODEL.value,
      );
      if (declared) return preferred;
    }
    for (const q of quads) {
      if (
        q.predicate.value === RDF_TYPE.value &&
        q.object.value === ARCH_METAMODEL.value &&
        q.subject.termType === 'NamedNode'
      ) {
        return q.subject.value;
      }
    }
    return null;
  }

  /**
   * Find the ontology IRI from parsed quads.
   * Looks for `?s rdf:type owl:Ontology` first, then falls back to
   * the first subject with a title.
   */
  private findOntologyIri(quads: Quad[]): string | null {
    for (const q of quads) {
      if (q.predicate.value === RDF_TYPE.value && q.object.value === OWL_ONTOLOGY.value) {
        return q.subject.value;
      }
    }
    for (const q of quads) {
      if (q.predicate.value === DC_TITLE.value || q.predicate.value === DCTERMS_TITLE.value) {
        return q.subject.value;
      }
    }
    return null;
  }

  /** Metadata for a single-document load. */
  private readInfo(quads: Quad[], subjectIri: string): MetamodelInfo {
    return {
      iri: subjectIri,
      name: this.firstLiteral(quads, subjectIri, [DC_TITLE.value, DCTERMS_TITLE.value, SKOS_PREF_LABEL.value]) ?? '',
      version: this.firstLiteral(quads, subjectIri, [OWL_VERSION_INFO.value]) ?? '',
      description:
        this.firstLiteral(quads, subjectIri, [DC_DESCRIPTION.value, DCTERMS_DESCRIPTION.value]) ?? '',
    };
  }

  /**
   * Metadata for a manifest load: the `arch:Metamodel` subject carries the
   * label and version, while title and description often sit on the ontology
   * declaration instead — so both subjects are consulted.
   */
  private readManifestInfo(quads: Quad[], metamodelIri: string, ontologyIri: string): MetamodelInfo {
    const fromMetamodel = this.readInfo(quads, metamodelIri);
    const fromOntology = this.readInfo(quads, ontologyIri);
    return {
      iri: metamodelIri,
      name: fromMetamodel.name || fromOntology.name,
      version: fromMetamodel.version || fromOntology.version,
      description: fromMetamodel.description || fromOntology.description,
    };
  }

  /** First literal value for a subject across a list of candidate predicates. */
  private firstLiteral(quads: Quad[], subjectIri: string, predicates: string[]): string | null {
    for (const predicate of predicates) {
      for (const q of quads) {
        if (q.subject.value === subjectIri && q.predicate.value === predicate) {
          return q.object.value;
        }
      }
    }
    return null;
  }

  /** First named-node object for a subject + predicate. */
  private firstObject(quads: Quad[], subjectIri: string, predicate: string): string | undefined {
    for (const q of quads) {
      if (
        q.subject.value === subjectIri &&
        q.predicate.value === predicate &&
        q.object.termType === 'NamedNode'
      ) {
        return q.object.value;
      }
    }
    return undefined;
  }
}
