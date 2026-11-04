/**
 * Viewpoint Manager implementation.
 *
 * Queries arch:Viewpoint instances from the RDF store and determines
 * permitted element/relationship types per viewpoint.
 *
 * ## Which graphs these queries read
 *
 * Viewpoints are metamodel content: ArchiMate 4.0 publishes its 17 of them in
 * `archimate4-viewpoints.ttl`, which `N3MetamodelLoader` loads into the named
 * graph `https://meta.linked.archi/archimate4/viewpoints#`. An unscoped SPARQL
 * pattern sees the default graph only, so it would find none of them — measured
 * against the bundle, `getViewpoints()` returned nothing at all, and 17 once
 * scoped. Both queries
 * therefore go through {@link GraphScope}, which spans the default graph *and*
 * every named graph, so a hand-written viewpoint added graph-less still works.
 */

import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { graphScope, type GraphScope, type SparqlBindings } from '../rdf-engine/graph-scope.js';
import type { ViewpointManager, ViewpointInfo } from './interfaces.js';

/**
 * Concrete ViewpointManager backed by SPARQL queries against an RdfStore.
 */
export class SparqlViewpointManager implements ViewpointManager {
  constructor(private store: RdfStore) {}

  getViewpoints(): ViewpointInfo[] {
    // One scope for the viewpoint list and every per-viewpoint follow-up.
    const scope = graphScope(this.store);

    const rows = scope.select(
      (from) => `
      PREFIX rdf:  <${NAMESPACES.rdf}>
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX skos: <${NAMESPACES.skos}>

      SELECT ?vp ?label
      ${from}
      WHERE {
        ?vp rdf:type arch:Viewpoint .
        ?vp skos:prefLabel ?label .
      }
    `,
    );

    const viewpoints: ViewpointInfo[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const iri = row['vp']?.value;
      const label = row['label']?.value;
      if (!iri || !label || seen.has(iri)) continue;
      seen.add(iri);

      const permitted = this.getPermittedTypes(iri, scope);
      viewpoints.push({
        iri,
        label,
        permittedElements: permitted.elements,
        permittedRelationships: permitted.relationships,
      });
    }

    return viewpoints;
  }

  /**
   * Concepts a viewpoint names.
   *
   * Published viewpoints use `arch:includesConcept`, whose `rdfs:range` is
   * `arch:ModelConcept` — one predicate for elements and relationship types
   * alike. Verified against `archimate4-viewpoints.ttl`, where all 17 viewpoints
   * use it and `arch:permitsElement` / `arch:permitsRelationship` never appear.
   * Those two are still read so older or hand-written data keeps working.
   *
   * `arch:includesConcept` does not say which kind a concept is, so its class
   * does: a subclass of `arch:QualifiedRelationship` is reported under
   * `relationships`, anything else under `elements`. ArchiMate 4.0's viewpoints
   * name element types only, so theirs come back with no relationships — which
   * the palette reads as "any the metamodel permits between them".
   *
   * A viewpoint that names a class includes its subclasses (`rdfs:subClassOf*`):
   * one naming `c4:Container` offers `c4:Database`, one naming `am4:Access` its
   * kinds of access, and a class an extension adds under an ArchiMate element
   * appears wherever that element does. The named classes come first.
   *
   * @param scope Dataset to query. Supplied by {@link getViewpoints} so the
   *   named-graph list is enumerated once per listing rather than per viewpoint;
   *   omit it and one is built here.
   */
  getPermittedTypes(
    viewpointIri: string,
    scope: GraphScope = graphScope(this.store),
  ): { elements: string[]; relationships: string[] } {
    const rows = scope.select(
      (from) => `
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX rdfs: <${NAMESPACES.rdfs}>

      SELECT ?concept ?relationshipClass ?named
      ${from}
      WHERE {
        {
          { <${viewpointIri}> arch:includesConcept ?named . }
          UNION
          { <${viewpointIri}> arch:permitsElement ?named . }
          ?concept rdfs:subClassOf* ?named .
          OPTIONAL {
            ?concept rdfs:subClassOf+ arch:QualifiedRelationship .
            BIND(true AS ?relationshipClass)
          }
        } UNION {
          <${viewpointIri}> arch:permitsRelationship ?named .
          ?concept rdfs:subClassOf* ?named .
          BIND(true AS ?relationshipClass)
        }
      }
    `,
    );
    // Named classes before their subclasses, so the list reads as the viewpoint
    // states it.
    rows.sort((a, b) => Number(isSubclassRow(a)) - Number(isSubclassRow(b)));

    const elements: string[] = [];
    const relationships: string[] = [];

    // The two passes overlap when the same triple sits in both the default graph
    // and a named graph, so membership is checked before appending.
    for (const row of rows) {
      const concept = row['concept']?.value;
      if (!concept) continue;
      const into = row['relationshipClass'] ? relationships : elements;
      if (!into.includes(concept)) into.push(concept);
    }

    return { elements, relationships };
  }
}

/** A row a subclass of a named class contributed, rather than the named class itself. */
function isSubclassRow(row: SparqlBindings): boolean {
  const named = row['named']?.value;
  return row['concept']?.value !== named;
}
