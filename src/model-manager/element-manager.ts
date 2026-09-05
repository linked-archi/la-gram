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
const ARCH_REL_SOURCE = namedNode(NAMESPACES.arch + 'relSource');
const ARCH_REL_TARGET = namedNode(NAMESPACES.arch + 'relTarget');

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
   * Find and remove all QualifiedRelationship resources that reference
   * the given element via `arch:relSource` or `arch:relTarget`.
   */
  private cascadeDeleteQualifiedRelationships(elementNode: NamedNode): void {
    // Find QualifiedRelationships where this element is the source
    const sourceRefs = this.store.getQuads(null, ARCH_REL_SOURCE as unknown as NamedNode, elementNode);
    // Find QualifiedRelationships where this element is the target
    const targetRefs = this.store.getQuads(null, ARCH_REL_TARGET as unknown as NamedNode, elementNode);

    // Collect unique QualifiedRelationship IRIs
    const qrIris = new Set<string>();
    for (const q of [...sourceRefs, ...targetRefs]) {
      qrIris.add(q.subject.value);
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
