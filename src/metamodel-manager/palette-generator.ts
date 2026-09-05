/**
 * Palette Generator implementation.
 *
 * Executes SPARQL queries against the RDF store to discover concrete
 * element types and relationship types from a loaded metamodel,
 * groups elements by skos:broader category, and supports viewpoint filtering.
 */

import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type {
  PaletteGenerator,
  PaletteDefinition,
  ElementTypeInfo,
  ElementGroup,
  RelationshipTypeInfo,
} from './interfaces.js';

const UNCATEGORIZED = 'Uncategorized';

/**
 * Concrete PaletteGenerator backed by SPARQL queries against an RdfStore.
 */
export class SparqlPaletteGenerator implements PaletteGenerator {
  constructor(private store: RdfStore) {}

  generatePalette(metamodelGraph: string): PaletteDefinition {
    const elements = this.discoverElements(metamodelGraph);
    const elementGroups = this.groupByCategory(elements);
    const relationshipTypes = this.discoverRelationships(metamodelGraph);
    return { elementGroups, relationshipTypes };
  }

  filterByViewpoint(palette: PaletteDefinition, viewpointIri: string): PaletteDefinition {
    const permitted = this.queryPermittedTypes(viewpointIri);

    const filteredGroups: ElementGroup[] = palette.elementGroups
      .map((group) => ({
        category: group.category,
        elements: group.elements.filter((e) => permitted.elements.has(e.iri)),
      }))
      .filter((group) => group.elements.length > 0);

    const filteredRelationships = palette.relationshipTypes.filter((r) =>
      permitted.relationships.has(r.iri),
    );

    return { elementGroups: filteredGroups, relationshipTypes: filteredRelationships };
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Discover concrete (non-abstract) element types from the metamodel graph.
   */
  private discoverElements(metamodelGraph: string): Array<ElementTypeInfo & { category: string }> {
    const sparql = `
      PREFIX rdfs: <${NAMESPACES.rdfs}>
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX skos: <${NAMESPACES.skos}>

      SELECT ?type ?label ?icon ?category WHERE {
        GRAPH <${metamodelGraph}> {
          ?type rdfs:subClassOf+ arch:Element .
          ?type skos:prefLabel ?label .
          OPTIONAL { ?type arch:prefVisNotation ?icon }
          OPTIONAL { ?type skos:broader ?category }
          FILTER NOT EXISTS { ?type arch:isAbstract true }
        }
      }
    `;

    const result = this.store.query(sparql);
    if (result.type !== 'bindings') return [];

    const seen = new Map<string, ElementTypeInfo & { category: string }>();
    for (const row of result.results) {
      const iri = row['type']?.value;
      const label = row['label']?.value;
      if (!iri || !label) continue;

      if (!seen.has(iri)) {
        seen.set(iri, {
          iri,
          label,
          iconUrl: row['icon']?.value,
          isAbstract: false,
          category: row['category']?.value ?? UNCATEGORIZED,
        });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Group element types by their skos:broader category.
   */
  private groupByCategory(elements: Array<ElementTypeInfo & { category: string }>): ElementGroup[] {
    const groups = new Map<string, ElementTypeInfo[]>();

    for (const elem of elements) {
      const cat = elem.category;
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
      groups.get(cat)!.push({
        iri: elem.iri,
        label: elem.label,
        iconUrl: elem.iconUrl,
        isAbstract: elem.isAbstract,
      });
    }

    return Array.from(groups.entries()).map(([category, elems]) => ({
      category,
      elements: elems,
    }));
  }

  /**
   * Discover relationship types from the metamodel graph.
   * Aggregates multiple domain/range values per relationship.
   */
  private discoverRelationships(metamodelGraph: string): RelationshipTypeInfo[] {
    const sparql = `
      PREFIX rdf: <${NAMESPACES.rdf}>
      PREFIX arch: <${NAMESPACES.arch}>
      PREFIX skos: <${NAMESPACES.skos}>

      SELECT ?rel ?label ?icon ?domain ?range WHERE {
        GRAPH <${metamodelGraph}> {
          ?rel a arch:Relationship .
          ?rel skos:prefLabel ?label .
          OPTIONAL { ?rel arch:prefVisNotation ?icon }
          OPTIONAL { ?rel arch:domainIncludes ?domain }
          OPTIONAL { ?rel arch:rangeIncludes ?range }
        }
      }
    `;

    const result = this.store.query(sparql);
    if (result.type !== 'bindings') return [];

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
   * Query the store for permitted element and relationship types for a viewpoint.
   */
  private queryPermittedTypes(viewpointIri: string): {
    elements: Set<string>;
    relationships: Set<string>;
  } {
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
    const elements = new Set<string>();
    const relationships = new Set<string>();

    if (result.type === 'bindings') {
      for (const row of result.results) {
        if (row['element']?.value) elements.add(row['element'].value);
        if (row['relationship']?.value) relationships.add(row['relationship'].value);
      }
    }

    return { elements, relationships };
  }
}
