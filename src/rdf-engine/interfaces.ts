/**
 * RDF Engine layer interfaces.
 *
 * Provides the core RDF infrastructure: TTL parsing/serialization,
 * triple store with SPARQL, and SHACL validation.
 */

import type { Quad, NamedNode } from '@rdfjs/types';

// ---------------------------------------------------------------------------
// TTL Parser
// ---------------------------------------------------------------------------

/** Error returned when TTL parsing fails. */
export interface ParseError {
  /** Line number where the error occurred (1-based). */
  line: number;
  /** Human-readable description of the syntax error. */
  message: string;
}

/** Discriminated union result of a TTL parse operation. */
export type ParseResult<T = Quad[]> =
  | { ok: true; quads: T }
  | { ok: false; error: ParseError };

/** Parses Turtle (TTL) strings into RDF quads. */
export interface TtlParser {
  parse(input: string): ParseResult<Quad[]>;
}

// ---------------------------------------------------------------------------
// TTL Serializer
// ---------------------------------------------------------------------------

/** Map of prefix labels to namespace IRIs. */
export type PrefixMap = Record<string, string>;

/** Serializes RDF quads to pretty-printed Turtle. */
export interface TtlSerializer {
  serialize(quads: Quad[], prefixes: PrefixMap): string;
}

// ---------------------------------------------------------------------------
// RDF Store
// ---------------------------------------------------------------------------

/** Result of a SPARQL query execution. */
export type SparqlResult =
  | { type: 'bindings'; results: Record<string, NamedNode | { value: string }>[] }
  | { type: 'quads'; quads: Quad[] }
  | { type: 'boolean'; value: boolean };

/** In-memory RDF triple store with SPARQL support. */
export interface RdfStore {
  addQuads(quads: Quad[]): void;
  removeQuads(quads: Quad[]): void;
  getQuads(
    subject?: NamedNode | null,
    predicate?: NamedNode | null,
    object?: NamedNode | null,
    graph?: NamedNode | null,
  ): Quad[];
  query(sparql: string): SparqlResult;
  update(sparqlUpdate: string): void;
}

// ---------------------------------------------------------------------------
// SHACL Validator
// ---------------------------------------------------------------------------

/** Severity level of a SHACL validation result. */
export type ValidationSeverity = 'Violation' | 'Warning' | 'Info';

/** A single SHACL validation result entry. */
export interface ValidationResult {
  focusNode: NamedNode;
  resultPath: NamedNode;
  sourceShape: NamedNode;
  message: string;
  severity: ValidationSeverity;
  /**
   * The SHACL constraint component IRI that produced this result
   * (e.g. sh:MinCountConstraintComponent). Optional: not every producer
   * of a ValidationResult knows it.
   */
  sourceConstraintComponent?: NamedNode;
}

/** Full SHACL validation report. */
export interface ValidationReport {
  conforms: boolean;
  results: ValidationResult[];
}

/** Validates RDF data graphs against SHACL shapes. */
export interface ShaclValidator {
  validate(dataGraph: Quad[], shapesGraph: Quad[]): ValidationReport;
  validateIncremental(
    changedResource: NamedNode,
    dataGraph: Quad[],
    shapesGraph: Quad[],
  ): ValidationReport;
}
