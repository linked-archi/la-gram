// RDF Engine layer — triple store, SPARQL, TTL parser/serializer, SHACL validator
export type { TtlParser, TtlSerializer, RdfStore, ShaclValidator, ParseError, ParseResult, ValidationReport, ValidationResult, SparqlResult } from './interfaces.js';
export { NAMESPACES, PREFIXES } from './namespaces.js';
export { N3TtlParser } from './ttl-parser.js';
export { N3TtlSerializer } from './ttl-serializer.js';
export { OxigraphRdfStore, initOxigraph, isOxigraphReady } from './rdf-store.js';
export { RdfShaclValidator } from './shacl-validator.js';
