/**
 * Model Operations — create, save, and load architecture models.
 *
 * Manages the lifecycle of architecture models: creating new models
 * with metamodel conformance links, serializing model triples to TTL,
 * and loading TTL content back into the RDF store.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { TtlParser, TtlSerializer, RdfStore, PrefixMap } from '../rdf-engine/interfaces.js';
import { NAMESPACES, PREFIXES } from '../rdf-engine/namespaces.js';
import { mintModelNamespace, modelIriIn, notationSlug } from '../rdf-engine/iri.js';
import { modelQuads } from './model-queries.js';
import { namespaceQuads } from './model-namespace.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const ARCH_MODEL = namedNode(NAMESPACES.arch + 'Model');
const ARCH_CONFORMS = namedNode(NAMESPACES.arch + 'modelConformsToMetamodel');
const SKOS_PREF_LABEL = namedNode(NAMESPACES.skos + 'prefLabel');

/** Counter for generating unique model IRIs. */
let modelCounter = 0;

/** Reset the counter (useful for testing). */
export function resetModelCounter(): void {
  modelCounter = 0;
}

/** Metadata returned after loading a model from TTL. */
export interface LoadModelResult {
  /** IRI of the `arch:Model` resource found in the loaded data (if any). */
  modelIri: string | null;
  /** Number of quads loaded into the store. */
  quadCount: number;
}

/**
 * Manages model lifecycle operations against an RDF store.
 *
 * Constructor takes injected dependencies for parser, serializer, and store.
 */
export class ModelOperations {
  constructor(
    private readonly parser: TtlParser,
    private readonly serializer: TtlSerializer,
    private readonly store: RdfStore,
  ) {}

  /**
   * Create a new architecture model resource.
   *
   * Generates a unique model IRI, adds `rdf:type arch:Model` and
   * `arch:modelConformsToMetamodel` triples, and optionally a `skos:prefLabel`.
   */
  createModel(metamodelIri: string, label?: string): NamedNode {
    modelCounter += 1;
    // Random, not counted: a counter restarts with the process.
    const namespace = mintModelNamespace(undefined, notationSlug(metamodelIri));
    const modelIri = modelIriIn(namespace);
    const subject = namedNode(modelIri) as unknown as NamedNode;

    const quads: Quad[] = [
      quad(subject as any, RDF_TYPE as any, ARCH_MODEL as any) as unknown as Quad,
      quad(subject as any, ARCH_CONFORMS as any, namedNode(metamodelIri) as any) as unknown as Quad,
      ...namespaceQuads(modelIri, namespace),
    ];

    if (label !== undefined) {
      quads.push(
        quad(subject as any, SKOS_PREF_LABEL as any, literal(label, 'en') as any) as unknown as Quad,
      );
    }

    this.store.addQuads(quads);
    return subject;
  }

  /**
   * Serialize all quads in the default graph to a TTL string.
   *
   * Uses the standard PREFIXES from namespaces.ts to produce
   * human-readable Turtle output.
   */
  saveModel(extraPrefixes?: PrefixMap): string {
    // The model is the default graph; the metamodel graphs are not the user's.
    const allQuads = modelQuads(this.store);
    const prefixes: PrefixMap = { ...PREFIXES, ...extraPrefixes };
    return this.serializer.serialize(allQuads, prefixes);
  }

  /**
   * Parse a TTL string and load the resulting quads into the RDF store.
   *
   * Throws an error if parsing fails. Returns metadata about the loaded
   * model, including the `arch:Model` resource IRI if found.
   */
  loadModel(ttlContent: string): LoadModelResult {
    const result = this.parser.parse(ttlContent);

    if (!result.ok) {
      throw new Error(
        `Failed to parse TTL (line ${result.error.line}): ${result.error.message}`,
      );
    }

    const quads = result.quads;
    this.store.addQuads(quads);

    // Find the arch:Model resource in the loaded quads
    const modelIri = this.findModelResource(quads);

    return { modelIri, quadCount: quads.length };
  }

  /**
   * Scan quads for a resource typed as `arch:Model`.
   */
  private findModelResource(quads: Quad[]): string | null {
    for (const q of quads) {
      if (
        q.predicate.value === RDF_TYPE.value &&
        q.object.value === ARCH_MODEL.value
      ) {
        return q.subject.value;
      }
    }
    return null;
  }
}
