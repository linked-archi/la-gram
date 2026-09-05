/**
 * Relationship Manager — CRUD operations for architecture relationships.
 *
 * Creates, queries, and deletes relationships in the RDF store,
 * supporting both direct triples and `arch:QualifiedRelationship` resources.
 * Validates source/target compatibility using `arch:domainIncludes` / `arch:rangeIncludes`.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import type { RelationshipTypeInfo } from '../metamodel-manager/interfaces.js';
import type { RelationshipManager } from './interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const { namedNode, quad } = DataFactory;

const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const ARCH_RELATIONSHIP = namedNode(NAMESPACES.arch + 'Relationship');
const ARCH_QUALIFIED_RELATIONSHIP = namedNode(NAMESPACES.arch + 'QualifiedRelationship');
const ARCH_DOMAIN_INCLUDES = namedNode(NAMESPACES.arch + 'domainIncludes');
const ARCH_RANGE_INCLUDES = namedNode(NAMESPACES.arch + 'rangeIncludes');
const ARCH_REL_SOURCE = namedNode(NAMESPACES.arch + 'relSource');
const ARCH_REL_TARGET = namedNode(NAMESPACES.arch + 'relTarget');
const ARCH_REL_PREDICATE = namedNode(NAMESPACES.arch + 'relPredicate');
const SKOS_PREF_LABEL = namedNode(NAMESPACES.skos + 'prefLabel');
const ARCH_PREF_VIS = namedNode(NAMESPACES.arch + 'prefVisNotation');

/** Counter for generating unique QualifiedRelationship IRIs. */
let qrCounter = 0;

/** Reset the counter (useful for testing). */
export function resetQrCounter(): void {
  qrCounter = 0;
}

/**
 * Concrete implementation of the `RelationshipManager` interface.
 *
 * Queries the RDF store for relationship type metadata (domain/range)
 * and creates/deletes relationship triples or QualifiedRelationship resources.
 */
export class OxigraphRelationshipManager implements RelationshipManager {
  constructor(private readonly store: RdfStore) {}

  /**
   * Return relationship types whose `arch:domainIncludes` contains the
   * source type and whose `arch:rangeIncludes` contains the target type.
   */
  getValidRelationships(sourceTypeIri: string, targetTypeIri: string): RelationshipTypeInfo[] {
    const sparql = `
      PREFIX rdf:  <${NAMESPACES.rdf}>
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX skos: <${NAMESPACES.skos}>

      SELECT ?rel ?label ?icon ?domain ?range WHERE {
        ?rel a arch:Relationship .
        ?rel skos:prefLabel ?label .
        ?rel arch:domainIncludes <${sourceTypeIri}> .
        ?rel arch:rangeIncludes <${targetTypeIri}> .
        OPTIONAL { ?rel arch:prefVisNotation ?icon }
        OPTIONAL { ?rel arch:domainIncludes ?domain }
        OPTIONAL { ?rel arch:rangeIncludes ?range }
      }
    `;

    const result = this.store.query(sparql);
    if (result.type !== 'bindings') return [];

    // Aggregate domain/range values per relationship
    const relMap = new Map<string, RelationshipTypeInfo>();
    for (const row of result.results) {
      const iri = row['rel']?.value;
      const label = row['label']?.value;
      if (!iri || !label) continue;

      if (!relMap.has(iri)) {
        relMap.set(iri, {
          iri,
          label,
          iconUrl: row['icon']?.value,
          domainTypes: [],
          rangeTypes: [],
        });
      }

      const info = relMap.get(iri)!;
      const domain = row['domain']?.value;
      const range = row['range']?.value;
      if (domain && !info.domainTypes.includes(domain)) {
        info.domainTypes.push(domain);
      }
      if (range && !info.rangeTypes.includes(range)) {
        info.rangeTypes.push(range);
      }
    }

    return Array.from(relMap.values());
  }

  /**
   * Create a relationship between source and target.
   *
   * - If `qualified` is false/undefined: creates a direct triple
   *   `<sourceIri> <typeIri> <targetIri>` and returns `null`.
   * - If `qualified` is true: creates an `arch:QualifiedRelationship`
   *   resource with `relSource`, `relTarget`, `relPredicate` and
   *   returns the QR resource NamedNode.
   */
  createRelationship(
    typeIri: string,
    sourceIri: string,
    targetIri: string,
    qualified?: boolean,
  ): NamedNode | null {
    const source = namedNode(sourceIri) as unknown as NamedNode;
    const target = namedNode(targetIri) as unknown as NamedNode;
    const predicate = namedNode(typeIri) as unknown as NamedNode;

    if (!qualified) {
      // Direct triple: source --predicate--> target
      const directQuad = quad(
        source as any,
        predicate as any,
        target as any,
      ) as unknown as Quad;
      this.store.addQuads([directQuad]);
      return null;
    }

    // Qualified relationship resource
    qrCounter += 1;
    const qrIri = `${sourceIri}/qr-${qrCounter}`;
    const qrNode = namedNode(qrIri) as unknown as NamedNode;

    const quads: Quad[] = [
      quad(qrNode as any, RDF_TYPE as any, ARCH_QUALIFIED_RELATIONSHIP as any) as unknown as Quad,
      quad(qrNode as any, ARCH_REL_SOURCE as any, source as any) as unknown as Quad,
      quad(qrNode as any, ARCH_REL_TARGET as any, target as any) as unknown as Quad,
      quad(qrNode as any, ARCH_REL_PREDICATE as any, predicate as any) as unknown as Quad,
    ];

    this.store.addQuads(quads);
    return qrNode;
  }

  /**
   * Delete a QualifiedRelationship resource by its IRI.
   *
   * Removes all triples where the QR IRI is the subject.
   * Source and target elements remain intact.
   *
   * Note: For direct triples, the caller should remove the triple directly
   * via the RDF store, since direct triples have no dedicated IRI.
   */
  deleteRelationship(relationshipIri: string): void {
    const qrNode = namedNode(relationshipIri) as unknown as NamedNode;

    // Remove all triples where the QR is the subject
    const qrQuads = this.store.getQuads(qrNode);
    if (qrQuads.length > 0) {
      this.store.removeQuads(qrQuads);
    }
  }
}
