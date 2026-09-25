/**
 * RDF namespace prefix constants used throughout the application.
 *
 * These correspond to the Linked.Archi core ontology (`arch:`),
 * visualization ontology (`arch-vis:`), and standard W3C vocabularies.
 */

/** Namespace URI constants. */
export const NAMESPACES = {
  arch: 'https://meta.linked.archi/core#',
  'arch-vis': 'https://meta.linked.archi/core-vis#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  sh: 'http://www.w3.org/ns/shacl#',
  owl: 'http://www.w3.org/2002/07/owl#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  prov: 'http://www.w3.org/ns/prov#',
  vann: 'http://purl.org/vocab/vann/',
} as const;

/** Prefix-to-namespace map (same data, typed for use with N3.js / serializers). */
export const PREFIXES: Record<string, string> = { ...NAMESPACES };

/** Helper: expand a prefixed name (e.g. "arch:Element") to a full IRI. */
export function expandPrefixedName(prefixed: string): string {
  const colonIdx = prefixed.indexOf(':');
  if (colonIdx === -1) return prefixed;
  const prefix = prefixed.slice(0, colonIdx);
  const local = prefixed.slice(colonIdx + 1);
  const ns = NAMESPACES[prefix as keyof typeof NAMESPACES];
  if (!ns) return prefixed;
  return ns + local;
}
