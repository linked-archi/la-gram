/**
 * SHACL Validator implementation using rdf-validate-shacl.
 *
 * Validates RDF data graphs against SHACL shapes graphs,
 * supporting both full validation and incremental (single-resource) validation.
 */

import SHACLValidator from 'rdf-validate-shacl';
import { Store as N3Store, DataFactory } from 'n3';
import type { Quad, NamedNode, Term } from '@rdfjs/types';
import type {
  ShaclValidator,
  ValidationReport,
  ValidationResult,
  ValidationSeverity,
} from './interfaces.js';

const { namedNode } = DataFactory;

const SH = 'http://www.w3.org/ns/shacl#';
const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

/** sh:sparql — SPARQL-based constraints, unsupported by rdf-validate-shacl. */
const SH_SPARQL = `${SH}sparql`;
/** sh:SPARQLConstraintComponent — the component rdf-validate-shacl cannot resolve. */
const SH_SPARQL_CONSTRAINT_COMPONENT = `${SH}SPARQLConstraintComponent`;
/** sh:message — used to tell an authored message from a library default. */
const SH_MESSAGE = `${SH}message`;

/** How deep to walk sh:detail sub-results looking for a usable message. */
const MAX_DETAIL_DEPTH = 5;

/** SHACL severity IRIs mapped to our union type. */
const SEVERITY_MAP: Record<string, ValidationSeverity> = {
  [`${SH}Violation`]: 'Violation',
  [`${SH}Warning`]: 'Warning',
  [`${SH}Info`]: 'Info',
};

/**
 * Options accepted by rdf-validate-shacl.
 *
 * The bundled type declarations for 0.5.x do not include `importGraph`, but
 * newer releases resolve `owl:imports` in the shapes graph over the network
 * when it is absent. la-gram loads every import into the store up front and
 * must never fetch (it would fail in Electron over `file://`), so we always
 * pass a no-op resolver. Widening the type here keeps that forward-compatible
 * without an `any` cast at the call site.
 */
type ValidatorOptions = ConstructorParameters<typeof SHACLValidator>[1] & {
  importGraph?: () => Promise<N3Store>;
};

/** Minimal structural view of a rdf-validate-shacl result, incl. nested details. */
interface ResultLike {
  message?: readonly { value: string }[];
  detail?: readonly ResultLike[];
}

/**
 * Concrete implementation of ShaclValidator backed by rdf-validate-shacl.
 */
export class RdfShaclValidator implements ShaclValidator {
  /**
   * The compiled validator for the last shapes graph, keyed by the array's
   * identity. Compiling is the expensive part — the ArchiMate relationship
   * shapes alone are 70 000 quads — and the shapes only change when a
   * metamodel is loaded or dropped, so callers that pass the same array get the
   * same engine back.
   */
  private cache: { shapes: Quad[]; engine: CompiledShapes } | null = null;

  validate(dataGraph: Quad[], shapesGraph: Quad[]): ValidationReport {
    if (this.cache?.shapes !== shapesGraph) {
      this.cache = { shapes: shapesGraph, engine: compileShapes(shapesGraph) };
    }
    return runCompiled(this.cache.engine, dataGraph);
  }

  validateIncremental(
    changedResource: NamedNode,
    dataGraph: Quad[],
    shapesGraph: Quad[],
  ): ValidationReport {
    // Filter data graph to only triples where the changed resource is the subject
    const filteredQuads = dataGraph.filter(
      (q) => q.subject.value === changedResource.value,
    );

    return runValidation(filteredQuads, shapesGraph);
  }
}

/** Build the validator, run it, and map the report. Shared by both entry points. */
/** A shapes graph compiled into a reusable engine. */
interface CompiledShapes {
  validator: SHACLValidator;
  shapesStore: N3Store;
}

function compileShapes(shapesGraph: Quad[]): CompiledShapes {
  const usableShapes = stripSparqlConstraints(shapesGraph);
  const shapesStore = quadsToStore(usableShapes);
  const options: ValidatorOptions = {
    importGraph: () => Promise.resolve(new N3Store()),
  };
  return { validator: new SHACLValidator(shapesStore, options), shapesStore };
}

function runCompiled(engine: CompiledShapes, dataGraph: Quad[]): ValidationReport {
  const dataStore = quadsToStore(dataGraph);
  const report = engine.validator.validate(dataStore);
  return toValidationReport(report, engine.shapesStore, dataStore);
}

function runValidation(dataGraph: Quad[], shapesGraph: Quad[]): ValidationReport {
  return runCompiled(compileShapes(shapesGraph), dataGraph);
}

/**
 * Remove SPARQL-based SHACL constraints from a shapes graph.
 *
 * rdf-validate-shacl has no validator for `sh:SPARQLConstraintComponent` and
 * throws "Cannot find validator for constraint component ..." the moment a
 * shape carrying one is evaluated. Published Linked.Archi shape files use
 * `sh:sparql` heavily (self-loop and cycle detection, for instance), so we
 * drop those constraints rather than fail the whole validation run.
 *
 * Dropping the two quad patterns is sufficient. The blank nodes that held the
 * `sh:select` / `sh:prefixes` / `sh:message` bodies stay in the graph, but once
 * the `sh:sparql` link is gone nothing reaches them: they are not typed as
 * `sh:NodeShape` or `sh:PropertyShape`, so they are not implicit class targets,
 * and no shape references them. Verified against the real ArchiMate 4.0
 * element shapes, which contain 20 such quads.
 *
 * The tradeoff is real: shapes whose *only* constraint is `sh:sparql` become
 * inert, so their rule is silently not enforced.
 */
function stripSparqlConstraints(quads: Quad[]): Quad[] {
  return quads.filter(
    (q) =>
      q.predicate.value !== SH_SPARQL &&
      q.object.value !== SH_SPARQL_CONSTRAINT_COMPONENT,
  );
}

/** Convert an array of quads into an N3.js Store (RDF/JS DatasetCore). */
function quadsToStore(quads: Quad[]): N3Store {
  const store = new N3Store();
  store.addQuads(quads as Parameters<typeof store.addQuads>[0]);
  return store;
}

/** Map the library's ValidationReport to our interface. */
function toValidationReport(
  report: ReturnType<SHACLValidator['validate']>,
  shapesStore: N3Store,
  dataStore: N3Store,
): ValidationReport {
  const results: ValidationResult[] = report.results.map((r) => {
    const severityIri = r.severity?.value ?? `${SH}Violation`;
    const severity: ValidationSeverity = SEVERITY_MAP[severityIri] ?? 'Violation';

    const focusNode = r.focusNode?.value ?? '';
    const path = r.path?.value ?? '';
    const sourceShape = r.sourceShape?.value ?? '';
    const sourceComponent = r.sourceConstraintComponent?.value ?? '';
    const value = r.value?.value ?? '';

    const message = resolveMessage({
      result: r,
      shapesStore,
      dataStore,
      shapeTerm: r.sourceShape ?? null,
      focusNode,
      sourceShape,
      sourceComponent,
      path,
      value,
    });

    const mapped: ValidationResult = {
      focusNode: namedNode(focusNode),
      resultPath: namedNode(path),
      sourceShape: namedNode(sourceShape),
      message,
      severity,
    };
    if (sourceComponent) {
      mapped.sourceConstraintComponent = namedNode(sourceComponent);
    }
    return mapped;
  });

  return {
    conforms: report.conforms,
    results,
  };
}

/**
 * Pick the most useful message available for a result.
 *
 * Precedence:
 *  1. A message the shape author declared with `sh:message`. Checked against
 *     the shapes graph rather than by string-matching, because
 *     rdf-validate-shacl also emits terse built-in messages ("Less than 1
 *     values") that are indistinguishable from authored ones on the result.
 *  2. The deepest message found in nested `sh:detail` sub-results. `sh:node`
 *     violations report only "Value does not have shape <X>" at the top level
 *     and bury the actionable message one or more levels down.
 *  3. A synthesised message built from the constraint component.
 */
function resolveMessage(ctx: {
  result: ResultLike;
  shapesStore: N3Store;
  dataStore: N3Store;
  shapeTerm: Term | null;
  focusNode: string;
  sourceShape: string;
  sourceComponent: string;
  path: string;
  value: string;
}): string {
  if (hasAuthoredMessage(ctx.shapesStore, ctx.shapeTerm)) {
    const authored = firstMessage(ctx.result);
    if (authored) return authored;
  }

  const nested = deepestDetailMessage(ctx.result);
  if (nested) return nested;

  return buildReadableMessage(
    ctx.focusNode,
    ctx.sourceShape,
    ctx.sourceComponent,
    ctx.path,
    ctx.value,
    ctx.dataStore,
  );
}

/** True when the shape node carries an explicit `sh:message` in the shapes graph. */
function hasAuthoredMessage(shapesStore: N3Store, shapeTerm: Term | null): boolean {
  if (!shapeTerm) return false;
  if (shapeTerm.termType !== 'NamedNode' && shapeTerm.termType !== 'BlankNode') {
    return false;
  }
  return (
    shapesStore.countQuads(
      shapeTerm as Parameters<N3Store['countQuads']>[0],
      namedNode(SH_MESSAGE),
      null,
      null,
    ) > 0
  );
}

/** Join the messages on a single result into one string, or '' when there are none. */
function firstMessage(result: ResultLike): string {
  const messages = result.message ?? [];
  return messages
    .map((m) => m.value)
    .filter((v) => v.length > 0)
    .join('; ');
}

/**
 * Walk `sh:detail` sub-results depth-first and return the innermost message.
 *
 * Nesting is produced by `sh:node` constraints, where every level above the
 * leaf says only "Value does not have shape <X>". Preferring the deepest
 * message surfaces the leaf constraint that actually failed.
 *
 * Exported for direct testing.
 */
export function deepestDetailMessage(result: ResultLike, depth = 0): string {
  if (depth >= MAX_DETAIL_DEPTH) return '';

  const details = result.detail ?? [];
  for (const detail of details) {
    const deeper = deepestDetailMessage(detail, depth + 1);
    if (deeper) return deeper;
    const own = firstMessage(detail);
    if (own) return own;
  }
  return '';
}

/** Shorten an IRI to its local name for display. */
function shortenIri(iri: string): string {
  if (!iri) return '';
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  if (slash >= 0) return iri.slice(slash + 1);
  return iri;
}

/**
 * Look up a display label for a node in the data graph.
 * Prefers skos:prefLabel, then rdfs:label, then the IRI local name.
 */
function labelFor(dataStore: N3Store, iri: string): string {
  if (!iri) return 'node';
  for (const predicate of [SKOS_PREF_LABEL, RDFS_LABEL]) {
    const quads = dataStore.getQuads(namedNode(iri), namedNode(predicate), null, null);
    if (quads.length > 0 && quads[0].object.value) return quads[0].object.value;
  }
  return shortenIri(iri);
}

/**
 * Synthesise a human-readable message for a violation whose shape declares no
 * `sh:message`. Ported from the la-modeller-excalidraw validator, with scene
 * lookups replaced by data-graph label lookups.
 *
 * Exported for direct testing.
 */
export function buildReadableMessage(
  focusNode: string,
  sourceShape: string,
  sourceComponent: string,
  path: string,
  value: string,
  dataStore: N3Store,
): string {
  const elementLabel = labelFor(dataStore, focusNode);
  const component = shortenIri(sourceComponent);
  const shapeName = shortenIri(sourceShape);
  const pathName = shortenIri(path);

  if (component === 'OrConstraintComponent') {
    return `"${elementLabel}" violates ${shapeName} — none of the allowed source/target combinations match.`;
  }
  if (component === 'ClassConstraintComponent') {
    return `"${elementLabel}" has invalid ${pathName || 'value'}: ${shortenIri(value)} is not an allowed class for ${shapeName}.`;
  }
  if (component === 'MinCountConstraintComponent') {
    return `"${elementLabel}" is missing required property "${pathName}" (required by ${shapeName}).`;
  }
  if (component === 'MaxCountConstraintComponent') {
    return `"${elementLabel}" has too many values for "${pathName}" (constrained by ${shapeName}).`;
  }
  if (component === 'DatatypeConstraintComponent') {
    return `"${elementLabel}" has wrong datatype for "${pathName}" (expected by ${shapeName}).`;
  }
  if (component === 'NodeKindConstraintComponent') {
    return `"${elementLabel}" has a value of the wrong node kind for "${pathName}" (expected by ${shapeName}).`;
  }
  if (component === 'NodeConstraintComponent' || component === 'AndConstraintComponent') {
    return `"${elementLabel}" does not satisfy all constraints in ${shapeName}.`;
  }

  return `"${elementLabel}" violates ${shapeName || 'a SHACL constraint'}${pathName ? ` on property "${pathName}"` : ''} (${component || 'unknown component'}).`;
}
