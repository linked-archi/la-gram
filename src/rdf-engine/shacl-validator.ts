/**
 * SHACL Validator implementation using rdf-validate-shacl.
 *
 * Validates RDF data graphs against SHACL shapes graphs,
 * supporting both full validation and incremental (single-resource) validation.
 */

import SHACLValidator from 'rdf-validate-shacl';
import { Store as N3Store, DataFactory } from 'n3';
import type { Quad, NamedNode } from '@rdfjs/types';
import type {
  ShaclValidator,
  ValidationReport,
  ValidationResult,
  ValidationSeverity,
} from './interfaces.js';

const { namedNode } = DataFactory;

/** SHACL severity IRIs mapped to our union type. */
const SEVERITY_MAP: Record<string, ValidationSeverity> = {
  'http://www.w3.org/ns/shacl#Violation': 'Violation',
  'http://www.w3.org/ns/shacl#Warning': 'Warning',
  'http://www.w3.org/ns/shacl#Info': 'Info',
};

/**
 * Concrete implementation of ShaclValidator backed by rdf-validate-shacl.
 */
export class RdfShaclValidator implements ShaclValidator {
  validate(dataGraph: Quad[], shapesGraph: Quad[]): ValidationReport {
    const shapesStore = quadsToStore(shapesGraph);
    const dataStore = quadsToStore(dataGraph);

    const validator = new SHACLValidator(shapesStore, {});
    const report = validator.validate(dataStore);

    return toValidationReport(report);
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

    const shapesStore = quadsToStore(shapesGraph);
    const dataStore = quadsToStore(filteredQuads);

    const validator = new SHACLValidator(shapesStore, {});
    const report = validator.validate(dataStore);

    return toValidationReport(report);
  }
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
): ValidationReport {
  const results: ValidationResult[] = report.results.map((r) => {
    const severityIri = r.severity?.value ?? 'http://www.w3.org/ns/shacl#Violation';
    const severity: ValidationSeverity = SEVERITY_MAP[severityIri] ?? 'Violation';

    // message is an array of Term; join them into a single string
    const messages = r.message ?? [];
    const message = messages.map((m) => m.value).join('; ') || 'Validation constraint violated';

    return {
      focusNode: namedNode(r.focusNode?.value ?? ''),
      resultPath: namedNode(r.path?.value ?? ''),
      sourceShape: namedNode(r.sourceShape?.value ?? ''),
      message,
      severity,
    };
  });

  return {
    conforms: report.conforms,
    results,
  };
}
