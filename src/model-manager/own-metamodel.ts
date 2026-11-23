/**
 * Which metamodel a relationship type belongs to, and so which elements it relates where its hints do not say.
 *
 * A language's relationship types relate its own elements; between elements of different languages the core's
 * types are offered (DD-40). A type's `arch:domainIncludes` / `arch:rangeIncludes` say which of its language's
 * classes it relates: C4's Uses names C4's. `arch:Element` or `arch:ModelConcept` in a hint stands for any element
 * of any language, and is for the types meant to relate concepts across languages: the decision extension names
 * its own Option at one end and `arch:ModelConcept` at the other. A type whose hints name only core classes, or
 * nothing, says nothing about any language's elements, and is offered only between its own metamodel's
 * ({@link namesNoLanguageClass}).
 *
 * A relationship type's metamodel is made of the documents that declare it, the documents a loaded manifest names
 * beside one of them as its concepts (`arch:modelConcepts`: C4's names its ontology and the Structurizr extension),
 * and what those import. The core's documents are no metamodel's. A type that no named graph declares, from a
 * metamodel loaded into the default graph, is of its namespace. An element type is of the metamodel when it, or a
 * class it specializes, is declared in one of those documents: a model's own subclass of a C4 container is C4's.
 */

import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { nn } from './vocabulary.js';

/** Every core document's IRI starts so: the ontology, core-vis, their shapes, the core notation. */
const CORE_DOCUMENTS = 'https://meta.linked.archi/core';
const RDF_TYPE = nn(NAMESPACES.rdf + 'type');
const RDFS_SUBCLASS_OF = nn(NAMESPACES.rdfs + 'subClassOf');
const OWL_IMPORTS = nn(NAMESPACES.owl + 'imports');
const OWL_VERSION_IRI = nn(NAMESPACES.owl + 'versionIRI');
const ARCH_MODEL_CONCEPTS = nn(NAMESPACES.arch + 'modelConcepts');

/**
 * Whether a relationship type's hints name no class of a metamodel: only core classes (`arch:Element`,
 * `arch:ModelConcept`), or none at all.
 */
export function namesNoLanguageClass(domainTypes: readonly string[], rangeTypes: readonly string[]): boolean {
  return [...domainTypes, ...rangeTypes].every((iri) => iri.startsWith(NAMESPACES.arch));
}

/** The namespace of an IRI: up to and including its last `#` or `/`. */
function namespaceOf(iri: string): string {
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'));
  return cut === -1 ? iri : iri.slice(0, cut + 1);
}

/** The loaded metamodels' documents, read for one set of loaded graphs. */
export class OwnMetamodels {
  /** Each relationship type's metamodel documents; `null` for a type no named graph declares. */
  private readonly documentsByType = new Map<string, ReadonlySet<string> | null>();
  /** The named graphs that declare each class. */
  private readonly graphsByClass = new Map<string, readonly string[]>();
  /** Each loaded manifest's concept documents, as loaded graphs. */
  private conceptDocuments?: ReadonlyMap<string, readonly string[]>;
  private readonly loaded: ReadonlySet<string>;

  /**
   * @param store The store, every graph of which is read.
   * @param namedGraphs The loaded documents' graphs.
   */
  constructor(
    private readonly store: RdfStore,
    namedGraphs: readonly string[],
  ) {
    this.loaded = new Set(namedGraphs);
  }

  /**
   * Whether an element type, given its `rdfs:subClassOf*` closure (the type included), is of the metamodel a
   * relationship type belongs to.
   */
  includes(relationshipTypeIri: string, closure: readonly string[]): boolean {
    const documents = this.documentsOf(relationshipTypeIri);
    if (!documents) {
      const namespace = namespaceOf(relationshipTypeIri);
      return closure.some((iri) => namespaceOf(iri) === namespace);
    }
    return closure.some((iri) => this.graphsDeclaring(iri).some((graph) => documents.has(graph)));
  }

  /** The documents of a relationship type's metamodel; `null` when no named graph declares the type. */
  private documentsOf(relationshipTypeIri: string): ReadonlySet<string> | null {
    const known = this.documentsByType.get(relationshipTypeIri);
    if (known !== undefined) return known;
    const declaring = this.graphsDeclaring(relationshipTypeIri).filter((graph) => !graph.startsWith(CORE_DOCUMENTS));
    let documents: ReadonlySet<string> | null = null;
    if (declaring.length > 0) {
      const seeds = new Set(declaring);
      for (const concepts of this.manifests().values()) {
        if (concepts.some((document) => declaring.includes(document))) for (const document of concepts) seeds.add(document);
      }
      documents = this.withImports(seeds);
    }
    this.documentsByType.set(relationshipTypeIri, documents);
    return documents;
  }

  /** Documents and what they import, and so on, among the loaded ones; the core's left out. */
  private withImports(seeds: Iterable<string>): Set<string> {
    const documents = new Set<string>();
    const queue = [...seeds];
    while (queue.length > 0) {
      const document = queue.pop() as string;
      if (documents.has(document) || document.startsWith(CORE_DOCUMENTS)) continue;
      documents.add(document);
      for (const q of this.store.getQuads(null, OWL_IMPORTS, null, nn(document))) {
        const imported = this.loadedDocument(q.object.value);
        if (imported) queue.push(imported);
      }
    }
    return documents;
  }

  /** Each loaded manifest's concept documents (`arch:modelConcepts`), those loaded. */
  private manifests(): ReadonlyMap<string, readonly string[]> {
    if (!this.conceptDocuments) {
      const byManifest = new Map<string, string[]>();
      for (const q of this.store.getQuads(null, ARCH_MODEL_CONCEPTS, null)) {
        const document = this.loadedDocument(q.object.value);
        if (!document) continue;
        const documents = byManifest.get(q.subject.value) ?? [];
        if (!documents.includes(document)) documents.push(document);
        byManifest.set(q.subject.value, documents);
      }
      this.conceptDocuments = byManifest;
    }
    return this.conceptDocuments;
  }

  /**
   * The loaded graph of a document a manifest or an import names: by its IRI, by its IRI up to the `#` (with one
   * added), or, for a version IRI, the graph of the ontology that declares it.
   */
  private loadedDocument(iri: string): string | undefined {
    if (this.loaded.has(iri)) return iri;
    const hash = iri.indexOf('#');
    const document = hash === -1 ? `${iri}#` : iri.slice(0, hash + 1);
    if (this.loaded.has(document)) return document;
    const declared = this.store.getQuads(null, OWL_VERSION_IRI, nn(iri))[0]?.graph;
    return declared?.termType === 'NamedNode' && this.loaded.has(declared.value) ? declared.value : undefined;
  }

  /** The named graphs that declare a class: type it or name a superclass of it. */
  private graphsDeclaring(iri: string): readonly string[] {
    let graphs = this.graphsByClass.get(iri);
    if (!graphs) {
      const subject = nn(iri);
      const found = new Set<string>();
      for (const predicate of [RDF_TYPE, RDFS_SUBCLASS_OF]) {
        for (const q of this.store.getQuads(subject, predicate, null)) {
          if (q.graph.termType === 'NamedNode') found.add(q.graph.value);
        }
      }
      graphs = [...found];
      this.graphsByClass.set(iri, graphs);
    }
    return graphs;
  }
}
