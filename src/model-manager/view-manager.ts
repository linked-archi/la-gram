/**
 * View Manager — CRUD operations for architecture views.
 *
 * Creates, queries, and manages views (Diagram, Catalog, Matrix) in the RDF store.
 * Manages element-view associations via `arch-vis:view` triples, ensuring a single
 * underlying RDF resource per element across multiple views.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import type { ViewManager, ViewInfo } from './interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const ARCH_VIEW = namedNode(NAMESPACES.arch + 'View');
const ARCH_DIAGRAM = namedNode(NAMESPACES.arch + 'Diagram');
const ARCH_CATALOG = namedNode(NAMESPACES.arch + 'Catalog');
const ARCH_MATRIX = namedNode(NAMESPACES.arch + 'Matrix');
const ARCH_VIEWPOINT = namedNode(NAMESPACES.arch + 'viewpoint');
const ARCH_VIS_VIEW = namedNode(NAMESPACES['arch-vis'] + 'view');
const SKOS_PREF_LABEL = namedNode(NAMESPACES.skos + 'prefLabel');

/** Map from view type string to the corresponding RDF class NamedNode. */
const VIEW_TYPE_MAP: Record<'Diagram' | 'Catalog' | 'Matrix', NamedNode> = {
  Diagram: ARCH_DIAGRAM as unknown as NamedNode,
  Catalog: ARCH_CATALOG as unknown as NamedNode,
  Matrix: ARCH_MATRIX as unknown as NamedNode,
};

/** Counter for generating unique view IRIs. */
let viewCounter = 0;

/** Reset the counter (useful for testing). */
export function resetViewCounter(): void {
  viewCounter = 0;
}

/**
 * Concrete implementation of the `ViewManager` interface.
 *
 * All view mutations are performed directly against the injected RDF store.
 */
export class OxigraphViewManager implements ViewManager {
  constructor(private readonly store: RdfStore) {}

  /**
   * Create a new view resource in the RDF store.
   *
   * 1. Generates a unique IRI (`urn:la-gram:view-N`)
   * 2. Adds `rdf:type arch:View` triple
   * 3. Adds `rdf:type arch:Diagram/Catalog/Matrix` based on type param
   * 4. If viewpointIri provided, adds `arch:viewpoint` triple
   */
  createView(type: 'Diagram' | 'Catalog' | 'Matrix', viewpointIri?: string): NamedNode {
    viewCounter += 1;
    const viewIri = `urn:la-gram:view-${viewCounter}`;
    const subject = namedNode(viewIri) as unknown as NamedNode;
    const subtypeNode = VIEW_TYPE_MAP[type];

    const quads: Quad[] = [
      quad(subject as any, RDF_TYPE as any, ARCH_VIEW as any) as unknown as Quad,
      quad(subject as any, RDF_TYPE as any, subtypeNode as any) as unknown as Quad,
    ];

    if (viewpointIri) {
      quads.push(
        quad(
          subject as any,
          ARCH_VIEWPOINT as any,
          namedNode(viewpointIri) as any,
        ) as unknown as Quad,
      );
    }

    this.store.addQuads(quads);
    return subject;
  }

  /**
   * Query all `arch:View` instances from the RDF store.
   *
   * Determines subtype (Diagram/Catalog/Matrix) from rdf:type,
   * retrieves label from `skos:prefLabel`, and viewpoint from `arch:viewpoint`.
   */
  getViews(): ViewInfo[] {
    const sparql = `
      PREFIX rdf:  <${NAMESPACES.rdf}>
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX skos: <${NAMESPACES.skos}>

      SELECT ?view ?label ?subtype ?viewpoint WHERE {
        ?view a arch:View .
        OPTIONAL { ?view skos:prefLabel ?label }
        OPTIONAL {
          ?view a ?subtype .
          FILTER(?subtype IN (arch:Diagram, arch:Catalog, arch:Matrix))
        }
        OPTIONAL { ?view arch:viewpoint ?viewpoint }
      }
    `;

    const result = this.store.query(sparql);
    if (result.type !== 'bindings') return [];

    const viewMap = new Map<string, ViewInfo>();
    for (const row of result.results) {
      const iri = row['view']?.value;
      if (!iri) continue;

      if (!viewMap.has(iri)) {
        viewMap.set(iri, {
          iri,
          label: row['label']?.value ?? '',
          type: this.resolveViewType(row['subtype']?.value),
          viewpointIri: row['viewpoint']?.value,
        });
      }
    }

    return Array.from(viewMap.values());
  }

  /**
   * Add an element to a view by creating an `arch-vis:view` triple.
   *
   * Links the existing element resource to the view — does NOT create
   * a new element resource. This ensures a single RDF resource per
   * element across multiple views.
   */
  addElementToView(viewIri: string, elementIri: string): void {
    const element = namedNode(elementIri) as unknown as NamedNode;
    const view = namedNode(viewIri) as unknown as NamedNode;

    const newQuad = quad(
      element as any,
      ARCH_VIS_VIEW as any,
      view as any,
    ) as unknown as Quad;

    this.store.addQuads([newQuad]);
  }

  /**
   * Remove an element from a view by deleting the `arch-vis:view` triple.
   */
  removeElementFromView(viewIri: string, elementIri: string): void {
    const element = namedNode(elementIri) as unknown as NamedNode;
    const view = namedNode(viewIri) as unknown as NamedNode;

    const existing = this.store.getQuads(element, ARCH_VIS_VIEW as unknown as NamedNode, view);
    if (existing.length > 0) {
      this.store.removeQuads(existing);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  /** Map a subtype IRI to the ViewInfo type string. */
  private resolveViewType(subtypeIri?: string): 'Diagram' | 'Catalog' | 'Matrix' {
    if (!subtypeIri) return 'Diagram'; // default fallback
    if (subtypeIri === NAMESPACES.arch + 'Catalog') return 'Catalog';
    if (subtypeIri === NAMESPACES.arch + 'Matrix') return 'Matrix';
    return 'Diagram';
  }
}
