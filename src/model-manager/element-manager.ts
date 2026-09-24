/**
 * Element Manager — CRUD operations for architecture model elements.
 *
 * Creates, updates, and deletes element resources in the RDF store,
 * including `arch-vis` layout triples for diagram positioning.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import type { ElementManager, Bounds } from './interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const XSD_DOUBLE = namedNode(NAMESPACES.xsd + 'double');
const ARCH_VIS_BOUNDS_X = namedNode(NAMESPACES['arch-vis'] + 'bounds-x');
const ARCH_VIS_BOUNDS_Y = namedNode(NAMESPACES['arch-vis'] + 'bounds-y');
const ARCH_VIS_BOUNDS_W = namedNode(NAMESPACES['arch-vis'] + 'bounds-w');
const ARCH_VIS_BOUNDS_H = namedNode(NAMESPACES['arch-vis'] + 'bounds-h');
/**
 * The endpoint properties the core ontology actually declares on an
 * `arch:QualifiedRelationship`: `arch:source` and `arch:target`, both with
 * `rdfs:domain arch:QualifiedRelationship`. This is what
 * `OxigraphRelationshipManager.createRelationship` writes.
 */
const ARCH_SOURCE = namedNode(NAMESPACES.arch + 'source');
const ARCH_TARGET = namedNode(NAMESPACES.arch + 'target');

/**
 * Compatibility shim — pre-migration endpoint properties.
 *
 * `arch:relSource` / `arch:relTarget` / `arch:relPredicate` were sub-properties
 * of `rdf:subject` / `rdf:object` / `rdf:predicate` under an `rdf:Statement`
 * reification pattern that has been removed from the core ontology (see the
 * `skos:historyNote` on `arch:QualifiedRelationship`).
 *
 * They are still matched here because they are not merely historical: the
 * ArchiMate importer (`import-export/archimate-importer.ts`) still *emits*
 * them, and `ui/views/matrix-view.ts` still reads them. Until those two are
 * migrated to `arch:source` / `arch:target`, dropping this branch would leave
 * every imported model's relationships orphaned on element deletion.
 *
 * Remove this shim — and the legacy cases in the accompanying tests — once the
 * importer no longer writes the old vocabulary and any stored models have been
 * migrated.
 */
const ARCH_REL_SOURCE_LEGACY = namedNode(NAMESPACES.arch + 'relSource');
const ARCH_REL_TARGET_LEGACY = namedNode(NAMESPACES.arch + 'relTarget');

/**
 * Every predicate that can point from a qualified relationship resource at one
 * of its endpoint elements, current vocabulary first.
 */
const QR_ENDPOINT_PREDICATES = [
  ARCH_SOURCE,
  ARCH_TARGET,
  ARCH_REL_SOURCE_LEGACY,
  ARCH_REL_TARGET_LEGACY,
] as const;

const LAYOUT_PREDICATES = [
  ARCH_VIS_BOUNDS_X,
  ARCH_VIS_BOUNDS_Y,
  ARCH_VIS_BOUNDS_W,
  ARCH_VIS_BOUNDS_H,
] as const;

/** Counter for generating unique element IRIs. */
let elementCounter = 0;

/** Reset the counter (useful for testing). */
export function resetElementCounter(): void {
  elementCounter = 0;
}

/**
 * Concrete implementation of the `ElementManager` interface.
 *
 * All element mutations are performed directly against the injected RDF store.
 */
export class OxigraphElementManager implements ElementManager {
  constructor(private readonly store: RdfStore) {}

  createElement(typeIri: string, modelIri: string, position: Bounds): NamedNode {
    elementCounter += 1;
    const elementIri = `${modelIri}/elem-${elementCounter}`;
    const subject = namedNode(elementIri) as unknown as NamedNode;

    const quads: Quad[] = [
      // rdf:type triple
      quad(subject as any, RDF_TYPE as any, namedNode(typeIri) as any) as unknown as Quad,
      // arch-vis layout triples
      ...this.buildLayoutQuads(subject, position),
    ];

    this.store.addQuads(quads);
    return subject;
  }

  updateProperty(elementIri: string, property: string, value: Term): void {
    const subject = namedNode(elementIri) as unknown as NamedNode;
    const predicate = namedNode(property) as unknown as NamedNode;

    // Remove existing triples for this subject+predicate
    const existing = this.store.getQuads(subject, predicate);
    if (existing.length > 0) {
      this.store.removeQuads(existing);
    }

    // Add the new triple
    const newQuad = quad(subject as any, predicate as any, value as any) as unknown as Quad;
    this.store.addQuads([newQuad]);
  }

  deleteElement(elementIri: string): void {
    const subject = namedNode(elementIri) as unknown as NamedNode;

    // 1. Find QualifiedRelationship resources BEFORE removing any triples
    //    (cascade must happen first since step 2 removes the reference triples)
    this.cascadeDeleteQualifiedRelationships(subject);

    // 2. Remove all triples where elementIri is the subject
    const subjectQuads = this.store.getQuads(subject);
    if (subjectQuads.length > 0) {
      this.store.removeQuads(subjectQuads);
    }

    // 3. Remove all triples where elementIri is the object (direct relationships)
    const objectQuads = this.store.getQuads(null, null, subject);
    if (objectQuads.length > 0) {
      this.store.removeQuads(objectQuads);
    }
  }

  updateLayout(elementIri: string, bounds: Bounds): void {
    const subject = namedNode(elementIri) as unknown as NamedNode;

    // Remove existing layout triples
    for (const pred of LAYOUT_PREDICATES) {
      const existing = this.store.getQuads(subject, pred as unknown as NamedNode);
      if (existing.length > 0) {
        this.store.removeQuads(existing);
      }
    }

    // Add new layout triples
    this.store.addQuads(this.buildLayoutQuads(subject, bounds));
  }

  // ── Private helpers ────────────────────────────────────────────────

  private buildLayoutQuads(subject: NamedNode, bounds: Bounds): Quad[] {
    return [
      quad(
        subject as any,
        ARCH_VIS_BOUNDS_X as any,
        literal(bounds.x.toString(), XSD_DOUBLE) as any,
      ) as unknown as Quad,
      quad(
        subject as any,
        ARCH_VIS_BOUNDS_Y as any,
        literal(bounds.y.toString(), XSD_DOUBLE) as any,
      ) as unknown as Quad,
      quad(
        subject as any,
        ARCH_VIS_BOUNDS_W as any,
        literal(bounds.width.toString(), XSD_DOUBLE) as any,
      ) as unknown as Quad,
      quad(
        subject as any,
        ARCH_VIS_BOUNDS_H as any,
        literal(bounds.height.toString(), XSD_DOUBLE) as any,
      ) as unknown as Quad,
    ];
  }

  /**
   * Find and remove every QualifiedRelationship resource that names the given
   * element as an endpoint.
   *
   * Matching spans both the current `arch:source` / `arch:target` and the
   * legacy `arch:relSource` / `arch:relTarget` — see
   * {@link QR_ENDPOINT_PREDICATES}. Without the cascade the resource would
   * survive step 3 of `deleteElement`, which only strips the triple *pointing
   * at* the element, leaving a typed relationship resource with a dangling or
   * missing endpoint.
   */
  private cascadeDeleteQualifiedRelationships(elementNode: NamedNode): void {
    // Collect unique QualifiedRelationship IRIs referencing this element from
    // either end, under either vocabulary.
    const qrIris = new Set<string>();
    for (const pred of QR_ENDPOINT_PREDICATES) {
      const refs = this.store.getQuads(null, pred as unknown as NamedNode, elementNode);
      for (const q of refs) {
        qrIris.add(q.subject.value);
      }
    }

    // Remove all triples for each QualifiedRelationship resource
    for (const iri of qrIris) {
      const qrNode = namedNode(iri) as unknown as NamedNode;
      const qrQuads = this.store.getQuads(qrNode);
      if (qrQuads.length > 0) {
        this.store.removeQuads(qrQuads);
      }
    }
  }
}
