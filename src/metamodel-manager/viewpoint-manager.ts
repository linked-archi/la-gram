/**
 * Viewpoint Manager implementation.
 *
 * Queries arch:Viewpoint instances from the RDF store and determines
 * permitted element/relationship types per viewpoint.
 */

import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { ViewpointManager, ViewpointInfo } from './interfaces.js';

/**
 * Concrete ViewpointManager backed by SPARQL queries against an RdfStore.
 */
export class SparqlViewpointManager implements ViewpointManager {
  constructor(private store: RdfStore) {}

  getViewpoints(): ViewpointInfo[] {
    const sparql = `
      PREFIX rdf:  <${NAMESPACES.rdf}>
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX skos: <${NAMESPACES.skos}>

      SELECT ?vp ?label WHERE {
        ?vp rdf:type arch:Viewpoint .
        ?vp skos:prefLabel ?label .
      }
    `;

    const result = this.store.query(sparql);
    if (result.type !== 'bindings') return [];

    const viewpoints: ViewpointInfo[] = [];
    const seen = new Set<string>();

    for (const row of result.results) {
      const iri = row['vp']?.value;
      const label = row['label']?.value;
      if (!iri || !label || seen.has(iri)) continue;
      seen.add(iri);

      const permitted = this.getPermittedTypes(iri);
      viewpoints.push({
        iri,
        label,
        permittedElements: permitted.elements,
        permittedRelationships: permitted.relationships,
      });
    }

    return viewpoints;
  }

  getPermittedTypes(viewpointIri: string): { elements: string[]; relationships: string[] } {
    const sparql = `
      PREFIX arch: <${NAMESPACES.arch}>

      SELECT ?element ?relationship WHERE {
        {
          <${viewpointIri}> arch:permitsElement ?element .
        } UNION {
          <${viewpointIri}> arch:permitsRelationship ?relationship .
        }
      }
    `;

    const result = this.store.query(sparql);
    const elements: string[] = [];
    const relationships: string[] = [];

    if (result.type === 'bindings') {
      for (const row of result.results) {
        const elem = row['element']?.value;
        const rel = row['relationship']?.value;
        if (elem && !elements.includes(elem)) elements.push(elem);
        if (rel && !relationships.includes(rel)) relationships.push(rel);
      }
    }

    return { elements, relationships };
  }
}
