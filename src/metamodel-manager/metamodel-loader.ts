/**
 * Metamodel Loader implementation.
 *
 * Parses TTL metamodel ontologies and SHACL shapes, loads them into
 * dedicated named graphs in the RDF store, extracts metadata, and
 * resolves transitive owl:imports.
 */

import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import type { TtlParser, RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { MetamodelLoader, MetamodelInfo } from './interfaces.js';

const { namedNode, quad } = DataFactory;

const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const OWL_ONTOLOGY = namedNode(NAMESPACES.owl + 'Ontology');
const OWL_IMPORTS = namedNode(NAMESPACES.owl + 'imports');
const DC_TITLE = namedNode(NAMESPACES.dc + 'title');
const OWL_VERSION_INFO = namedNode(NAMESPACES.owl + 'versionInfo');
const DC_DESCRIPTION = namedNode(NAMESPACES.dc + 'description');

/** Default graph IRI used for SHACL shapes. */
const SHAPES_GRAPH = namedNode('urn:la-gram:shapes');

/**
 * Concrete MetamodelLoader backed by a TtlParser and RdfStore.
 *
 * Each metamodel is loaded into a named graph keyed by its ontology IRI.
 * SHACL shapes are loaded into a dedicated shapes graph.
 */
export class N3MetamodelLoader implements MetamodelLoader {
  /** Set of ontology IRIs already loaded (for import cycle detection). */
  private loadedOntologies = new Set<string>();

  constructor(
    private parser: TtlParser,
    private store: RdfStore,
  ) {}

  async loadMetamodel(ttlContent: string): Promise<MetamodelInfo> {
    const result = this.parser.parse(ttlContent);
    if (!result.ok) {
      throw new Error(`Failed to parse metamodel TTL: ${result.error.message}`);
    }

    const quads = result.quads;
    const ontologyIri = this.findOntologyIri(quads);
    if (!ontologyIri) {
      throw new Error('No ontology IRI found in metamodel (expected rdf:type owl:Ontology or dc:title)');
    }

    // Load quads into a named graph keyed by the ontology IRI
    const graphNode = namedNode(ontologyIri);
    const graphQuads = quads.map((q) =>
      quad(q.subject as Quad['subject'], q.predicate, q.object, graphNode) as unknown as Quad,
    );
    this.store.addQuads(graphQuads);
    this.loadedOntologies.add(ontologyIri);

    // Extract metadata
    const name = this.findLiteralValue(quads, ontologyIri, DC_TITLE) ?? '';
    const version = this.findLiteralValue(quads, ontologyIri, OWL_VERSION_INFO) ?? '';
    const description = this.findLiteralValue(quads, ontologyIri, DC_DESCRIPTION) ?? '';

    return { iri: ontologyIri, name, version, description };
  }

  async loadShapes(ttlContent: string): Promise<void> {
    const result = this.parser.parse(ttlContent);
    if (!result.ok) {
      throw new Error(`Failed to parse SHACL shapes TTL: ${result.error.message}`);
    }

    // Load shapes into the dedicated shapes graph
    const graphQuads = result.quads.map((q) =>
      quad(q.subject as Quad['subject'], q.predicate, q.object, SHAPES_GRAPH) as unknown as Quad,
    );
    this.store.addQuads(graphQuads);
  }

  async resolveImports(ontologyIri: string): Promise<void> {
    const visited = new Set<string>();
    await this.resolveImportsRecursive(ontologyIri, visited);
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Recursively resolve owl:imports for the given ontology IRI.
   * Tracks visited IRIs to avoid infinite loops in circular imports.
   */
  private async resolveImportsRecursive(ontologyIri: string, visited: Set<string>): Promise<void> {
    if (visited.has(ontologyIri)) return;
    visited.add(ontologyIri);

    // Query the store for owl:imports from this ontology
    const graphNode = namedNode(ontologyIri);
    const importQuads = this.store.getQuads(
      namedNode(ontologyIri),
      OWL_IMPORTS,
      null,
      graphNode,
    );

    for (const q of importQuads) {
      const importedIri = q.object.value;

      if (!this.loadedOntologies.has(importedIri)) {
        // Mark as needing resolution — actual fetching would require
        // a platform service (network/file access). For now we track
        // the import as "pending" so callers can inspect what's needed.
        // If the imported ontology is already in the store (loaded by
        // another path), we still recurse to resolve its transitive imports.
        this.loadedOntologies.add(importedIri);
      }

      // Recurse into the imported ontology's imports (if it's in the store)
      await this.resolveImportsRecursive(importedIri, visited);
    }
  }

  /**
   * Find the ontology IRI from parsed quads.
   * Looks for `?s rdf:type owl:Ontology` first, then falls back to
   * the first subject with `dc:title`.
   */
  private findOntologyIri(quads: Quad[]): string | null {
    // Strategy 1: look for ?s rdf:type owl:Ontology
    for (const q of quads) {
      if (
        q.predicate.value === RDF_TYPE.value &&
        q.object.value === OWL_ONTOLOGY.value
      ) {
        return q.subject.value;
      }
    }

    // Strategy 2: first subject with dc:title
    for (const q of quads) {
      if (q.predicate.value === DC_TITLE.value) {
        return q.subject.value;
      }
    }

    return null;
  }

  /**
   * Find a literal value for a given subject and predicate in the quads.
   */
  private findLiteralValue(
    quads: Quad[],
    subjectIri: string,
    predicate: ReturnType<typeof namedNode>,
  ): string | null {
    for (const q of quads) {
      if (q.subject.value === subjectIri && q.predicate.value === predicate.value) {
        return q.object.value;
      }
    }
    return null;
  }
}
