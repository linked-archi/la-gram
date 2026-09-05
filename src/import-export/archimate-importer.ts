/**
 * ArchiMate Open Exchange Format XML Importer.
 *
 * Parses ArchiMate XML and converts elements/relationships into RDF quads
 * using the ArchiMate metamodel ontology. Unrecognized types are collected
 * and reported so the user can map or skip them.
 *
 * @module import-export/archimate-importer
 */

import { DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import { NAMESPACES } from '../rdf-engine/namespaces.js';

const { namedNode, literal, quad } = DataFactory;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ArchiMate 3.1 metamodel namespace. */
export const ARCHIMATE_NS = 'https://meta.linked.archi/archimate3.1#';

/** ArchiMate Open Exchange Format XML namespace. */
const ARCHIMATE_XML_NS = 'http://www.opengroup.org/xsd/archimate/3.0/';

/** Commonly used RDF predicate IRIs. */
const RDF_TYPE = namedNode(NAMESPACES.rdf + 'type');
const SKOS_PREF_LABEL = namedNode(NAMESPACES.skos + 'prefLabel');
const SKOS_DEFINITION = namedNode(NAMESPACES.skos + 'definition');
const ARCH_REL_SOURCE = namedNode(NAMESPACES.arch + 'relSource');
const ARCH_REL_TARGET = namedNode(NAMESPACES.arch + 'relTarget');
const ARCH_REL_PREDICATE = namedNode(NAMESPACES.arch + 'relPredicate');
const ARCH_QUALIFIED_REL = namedNode(NAMESPACES.arch + 'QualifiedRelationship');

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

/** Set of recognized ArchiMate element xsi:type values. */
export const KNOWN_ELEMENT_TYPES = new Set<string>([
  // Business layer
  'BusinessActor', 'BusinessRole', 'BusinessCollaboration',
  'BusinessInterface', 'BusinessProcess', 'BusinessFunction',
  'BusinessInteraction', 'BusinessEvent', 'BusinessService',
  'BusinessObject', 'Contract', 'Representation', 'Product',
  // Application layer
  'ApplicationComponent', 'ApplicationCollaboration',
  'ApplicationInterface', 'ApplicationFunction',
  'ApplicationInteraction', 'ApplicationProcess',
  'ApplicationEvent', 'ApplicationService', 'DataObject',
  // Technology layer
  'Node', 'Device', 'SystemSoftware', 'TechnologyCollaboration',
  'TechnologyInterface', 'Path', 'CommunicationNetwork',
  'TechnologyFunction', 'TechnologyProcess', 'TechnologyInteraction',
  'TechnologyEvent', 'TechnologyService', 'Artifact',
  // Motivation
  'Stakeholder', 'Driver', 'Assessment', 'Goal', 'Outcome',
  'Principle', 'Requirement', 'Constraint', 'Meaning', 'Value',
  // Strategy
  'Resource', 'Capability', 'CourseOfAction', 'ValueStream',
  // Implementation & Migration
  'WorkPackage', 'Deliverable', 'ImplementationEvent', 'Plateau', 'Gap',
]);

/** Set of recognized ArchiMate relationship xsi:type values. */
export const KNOWN_RELATIONSHIP_TYPES = new Set<string>([
  'Composition', 'Aggregation', 'Assignment', 'Realization',
  'Serving', 'Access', 'Influence', 'Triggering', 'Flow',
  'Specialization', 'Association',
]);

/**
 * Map an ArchiMate xsi:type string to a full IRI in the ArchiMate namespace.
 * Returns `null` when the type is not recognized.
 */
export function mapTypeToIri(xsiType: string): string | null {
  if (KNOWN_ELEMENT_TYPES.has(xsiType) || KNOWN_RELATIONSHIP_TYPES.has(xsiType)) {
    return ARCHIMATE_NS + xsiType;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Import result
// ---------------------------------------------------------------------------

/** Result returned by {@link importArchiMateXml}. */
export interface ImportResult {
  /** Generated RDF quads. */
  quads: Quad[];
  /** xsi:type values that could not be mapped. */
  unrecognizedTypes: string[];
  /** Number of elements successfully imported. */
  elementCount: number;
  /** Number of relationships successfully imported. */
  relationshipCount: number;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/**
 * Get the text content of the first child element with the given local name,
 * searching within the ArchiMate XML namespace.
 */
export function getChildText(parent: Element, localName: string): string | null {
  // Try namespace-aware lookup first
  let child = parent.getElementsByTagNameNS(ARCHIMATE_XML_NS, localName)[0];
  if (!child) {
    // Fallback: non-namespace-aware (some parsers strip namespaces)
    child = parent.getElementsByTagName(localName)[0];
  }
  return child?.textContent?.trim() || null;
}

/**
 * Get the xsi:type attribute from an element.
 * Handles both `xsi:type` and plain `type` attributes.
 */
export function getXsiType(el: Element): string | null {
  return (
    el.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ||
    el.getAttribute('xsi:type') ||
    el.getAttribute('type') ||
    null
  );
}

/**
 * Collect all child elements matching a local name, namespace-aware with fallback.
 */
export function getChildElements(parent: Element, localName: string): Element[] {
  let nodes = parent.getElementsByTagNameNS(ARCHIMATE_XML_NS, localName);
  if (nodes.length === 0) {
    nodes = parent.getElementsByTagName(localName);
  }
  return Array.from(nodes);
}


// ---------------------------------------------------------------------------
// Element conversion
// ---------------------------------------------------------------------------

/**
 * Convert a single ArchiMate `<element>` XML node into RDF quads.
 *
 * Produces:
 * - `<iri> rdf:type <archimateType>`
 * - `<iri> skos:prefLabel "name"`
 * - `<iri> skos:definition "documentation"` (when present)
 *
 * @returns The quads and whether the type was recognized.
 */
export function elementToQuads(
  el: Element,
  baseNs: string,
): { quads: Quad[]; unrecognized: string | null } {
  const id = el.getAttribute('identifier') ?? '';
  const xsiType = getXsiType(el);
  const name = getChildText(el, 'name');
  const doc = getChildText(el, 'documentation');

  if (!xsiType) {
    return { quads: [], unrecognized: null };
  }

  const typeIri = mapTypeToIri(xsiType);
  if (!typeIri) {
    return { quads: [], unrecognized: xsiType };
  }

  const subject = namedNode(baseNs + id);
  const result: Quad[] = [
    quad(subject, RDF_TYPE, namedNode(typeIri)),
  ];

  if (name) {
    result.push(quad(subject, SKOS_PREF_LABEL, literal(name)));
  }
  if (doc) {
    result.push(quad(subject, SKOS_DEFINITION, literal(doc)));
  }

  return { quads: result, unrecognized: null };
}

// ---------------------------------------------------------------------------
// Relationship conversion
// ---------------------------------------------------------------------------

/**
 * Convert a single ArchiMate `<relationship>` XML node into RDF quads.
 *
 * Creates an `arch:QualifiedRelationship` resource with:
 * - `rdf:type arch:QualifiedRelationship`
 * - `arch:relSource <source>`
 * - `arch:relTarget <target>`
 * - `arch:relPredicate <relationshipType>`
 * - `skos:prefLabel "name"` (when present)
 *
 * @returns The quads and whether the type was recognized.
 */
export function relationshipToQuads(
  el: Element,
  baseNs: string,
): { quads: Quad[]; unrecognized: string | null } {
  const id = el.getAttribute('identifier') ?? '';
  const xsiType = getXsiType(el);
  const source = el.getAttribute('source') ?? '';
  const target = el.getAttribute('target') ?? '';
  const name = getChildText(el, 'name');

  if (!xsiType) {
    return { quads: [], unrecognized: null };
  }

  const typeIri = mapTypeToIri(xsiType);
  if (!typeIri) {
    return { quads: [], unrecognized: xsiType };
  }

  const subject = namedNode(baseNs + id);
  const result: Quad[] = [
    quad(subject, RDF_TYPE, ARCH_QUALIFIED_REL),
    quad(subject, ARCH_REL_SOURCE, namedNode(baseNs + source)),
    quad(subject, ARCH_REL_TARGET, namedNode(baseNs + target)),
    quad(subject, ARCH_REL_PREDICATE, namedNode(typeIri)),
  ];

  if (name) {
    result.push(quad(subject, SKOS_PREF_LABEL, literal(name)));
  }

  return { quads: result, unrecognized: null };
}

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

/**
 * Import an ArchiMate Open Exchange Format XML string into RDF quads.
 *
 * The function:
 * 1. Parses the XML using DOMParser
 * 2. Extracts `<element>` nodes → RDF quads (rdf:type, skos:prefLabel, skos:definition)
 * 3. Extracts `<relationship>` nodes → QualifiedRelationship RDF quads
 * 4. Collects any unrecognized xsi:type values
 *
 * @param xml - The ArchiMate Open Exchange Format XML string.
 * @param baseNs - Optional base namespace for generated IRIs. Defaults to
 *   `https://imported.archimate/model/`.
 * @returns An {@link ImportResult} with quads, counts, and unrecognized types.
 */
export function importArchiMateXml(
  xml: string,
  baseNs = 'https://imported.archimate/model/',
): ImportResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return {
      quads: [],
      unrecognizedTypes: [],
      elementCount: 0,
      relationshipCount: 0,
    };
  }

  const allQuads: Quad[] = [];
  const unrecognizedSet = new Set<string>();
  let elementCount = 0;
  let relationshipCount = 0;

  // --- Elements ---
  const elements = getChildElements(doc.documentElement, 'element');
  for (const el of elements) {
    const { quads: q, unrecognized } = elementToQuads(el, baseNs);
    if (unrecognized) {
      unrecognizedSet.add(unrecognized);
    }
    if (q.length > 0) {
      allQuads.push(...q);
      elementCount++;
    }
  }

  // --- Relationships ---
  const relationships = getChildElements(doc.documentElement, 'relationship');
  for (const rel of relationships) {
    const { quads: q, unrecognized } = relationshipToQuads(rel, baseNs);
    if (unrecognized) {
      unrecognizedSet.add(unrecognized);
    }
    if (q.length > 0) {
      allQuads.push(...q);
      relationshipCount++;
    }
  }

  return {
    quads: allQuads,
    unrecognizedTypes: Array.from(unrecognizedSet),
    elementCount,
    relationshipCount,
  };
}
