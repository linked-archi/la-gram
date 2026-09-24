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
 * ## One graph per document
 *
 * Every discovered document lands in its own named graph, keyed by its ontology
 * IRI. That keeps provenance intact — a caller can ask "what did the notation
 * file say" — and it is what {@link LoadedMetamodel.graphsByRole} reports back.
 *
 * ## Honest partial loads
 *
 * The manifest references more than this bundle ships: the relationship shapes
 * (648 KB) and the derivation rules are deliberately absent, as are the
 * deliverable templates and reference models. Rather than fail or silently skip,
 * every discovered asset gets a {@link MetamodelAssetStatus} entry, so a caller
 * can tell the user exactly which layer is missing.
 */

import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import type { TtlParser, RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type {
  MetamodelLoader,
  MetamodelInfo,
  LoadedMetamodel,
  MetamodelAssetStatus,
} from './interfaces.js';
import {
  BUNDLED_ASSETS,
  fetchAssetText,
  getAssetByIri,
  getAssetsByRole,
  type BundledAsset,
  type BundledAssetRole,
} from './bundled-assets.js';

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
  if (getAssetByIri(iri)) return iri;
  const hash = iri.indexOf('#');
  if (hash === -1) return iri;
  return iri.slice(0, hash + 1);
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

  constructor(
    private parser: TtlParser,
    private store: RdfStore,
  ) {}

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
   * Load a metamodel from its manifest, pulling in every bundled document the
   * manifest points at plus their transitive `owl:imports`.
   *
   * The manifest itself is loaded first so the `arch:Metamodel` subject is
   * queryable even if nothing else resolves.
   */
  async loadMetamodelFromManifest(manifestTtl: string): Promise<LoadedMetamodel> {
    const manifestQuads = this.parseOrThrow(manifestTtl, 'metamodel manifest TTL');

    const metamodelIri = this.findMetamodelSubject(manifestQuads);
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
      },
    ];
    const graphsByRole: Partial<Record<BundledAssetRole, string[]>> = { manifest: [manifestGraphIri] };

    // Everything the manifest points at, then everything those documents import.
    const queue: DiscoveredRef[] = [
      ...this.discoverManifestRefs(manifestQuads, metamodelIri),
      ...this.discoverImports(manifestQuads, manifestGraphIri),
    ];

    const seen = new Set<string>([manifestGraphIri]);

    while (queue.length > 0) {
      const ref = queue.shift() as DiscoveredRef;
      const documentIri = documentIriFor(ref.referencedIri);

      if (seen.has(documentIri)) continue;
      seen.add(documentIri);

      const asset = getAssetByIri(documentIri);
      if (!asset) {
        assets.push({
          referencedIri: ref.referencedIri,
          documentIri,
          via: ref.via,
          outcome: 'not-bundled',
          message: `No bundled asset defines <${documentIri}>`,
        });
        continue;
      }

      if (this.loadedOntologies.has(documentIri)) {
        assets.push({
          referencedIri: ref.referencedIri,
          documentIri,
          via: ref.via,
          role: asset.role,
          outcome: 'already-loaded',
        });
        this.recordRole(graphsByRole, asset.role, documentIri);
        continue;
      }

      const status = await this.loadAsset(asset, ref);
      assets.push(status);

      if (status.outcome === 'loaded') {
        this.recordRole(graphsByRole, asset.role, documentIri);
        // Follow this document's own imports, still deduping by document IRI.
        const loadedQuads = this.store.getQuads(null, null, null, namedNode(documentIri));
        queue.push(...this.discoverImports(loadedQuads, documentIri));
      }
    }

    const notationSetIri = this.firstObject(manifestQuads, metamodelIri, ARCH_NOTATION_SET.value);

    return {
      metamodelIri,
      manifestGraphIri,
      info: this.readManifestInfo(manifestQuads, metamodelIri, manifestGraphIri),
      graphsByRole,
      notationSetIri,
      assets,
    };
  }

  /**
   * Load the ArchiMate 4.0 metamodel that ships with the application.
   *
   * Convenience over {@link loadMetamodelFromManifest}: finds the bundled
   * manifest asset, reads it, and follows it from there. Requires no network.
   */
  async loadBundledMetamodel(): Promise<LoadedMetamodel> {
    const manifest: BundledAsset | undefined = getAssetsByRole('manifest')[0];
    if (!manifest) {
      throw new Error(
        `No manifest asset in the bundle (${BUNDLED_ASSETS.length} assets registered)`,
      );
    }
    const ttl = await fetchAssetText(manifest);
    return this.loadMetamodelFromManifest(ttl);
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
   * Walk `owl:imports` from an already-loaded ontology, loading any bundled
   * document that is not in the store yet.
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
          const asset = getAssetByIri(importedIri);
          if (asset) {
            await this.loadAsset(asset, { referencedIri: q.object.value, via: 'owl:imports' });
          } else {
            // Not bundled and there is no network fetch here: record it as seen
            // so repeated calls stay cheap, and leave the graph absent.
            this.loadedOntologies.add(importedIri);
          }
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

  /** Fetch, parse and load one bundled asset into its own named graph. */
  private async loadAsset(asset: BundledAsset, ref: DiscoveredRef): Promise<MetamodelAssetStatus> {
    const base: MetamodelAssetStatus = {
      referencedIri: ref.referencedIri,
      documentIri: asset.ontologyIri,
      via: ref.via,
      role: asset.role,
      outcome: 'loaded',
    };

    try {
      const ttl = await fetchAssetText(asset);
      const quads = this.parseOrThrow(ttl, `bundled asset '${asset.path}'`);
      this.addToGraph(quads, asset.ontologyIri);
      this.loadedOntologies.add(asset.ontologyIri);
      return { ...base, quadCount: quads.length };
    } catch (err: unknown) {
      return {
        ...base,
        outcome: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
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
  private findMetamodelSubject(quads: Quad[]): string | null {
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
