import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { RdfShaclValidator } from '../shacl-validator.js';

const { namedNode, literal, quad } = DataFactory;

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const EX = 'http://example.org/';

/** Helper to build a minimal SHACL shapes graph requiring a property. */
function buildShapesGraph(opts: {
  targetClass: string;
  path: string;
  minCount?: number;
  maxCount?: number;
  datatype?: string;
  severity?: string;
  message?: string;
}): Quad[] {
  const shapeIri = `${EX}TestShape`;
  const propShapeIri = `${EX}TestPropertyShape`;
  const quads: Quad[] = [
    quad(namedNode(shapeIri), namedNode(`${RDF}type`), namedNode(`${SH}NodeShape`)),
    quad(namedNode(shapeIri), namedNode(`${SH}targetClass`), namedNode(opts.targetClass)),
    quad(namedNode(shapeIri), namedNode(`${SH}property`), namedNode(propShapeIri)),
    quad(namedNode(propShapeIri), namedNode(`${SH}path`), namedNode(opts.path)),
  ];

  if (opts.minCount !== undefined) {
    quads.push(
      quad(namedNode(propShapeIri), namedNode(`${SH}minCount`), literal(String(opts.minCount), namedNode(`${XSD}integer`))),
    );
  }
  if (opts.maxCount !== undefined) {
    quads.push(
      quad(namedNode(propShapeIri), namedNode(`${SH}maxCount`), literal(String(opts.maxCount), namedNode(`${XSD}integer`))),
    );
  }
  if (opts.datatype) {
    quads.push(
      quad(namedNode(propShapeIri), namedNode(`${SH}datatype`), namedNode(opts.datatype)),
    );
  }
  if (opts.severity) {
    quads.push(
      quad(namedNode(propShapeIri), namedNode(`${SH}severity`), namedNode(opts.severity)),
    );
  }
  if (opts.message) {
    quads.push(
      quad(namedNode(propShapeIri), namedNode(`${SH}message`), literal(opts.message)),
    );
  }

  return quads;
}

describe('RdfShaclValidator', () => {
  const validator = new RdfShaclValidator();

  describe('validate', () => {
    it('returns conforms=true for valid data', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        minCount: 1,
      });

      const data: Quad[] = [
        quad(namedNode(`${EX}alice`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
        quad(namedNode(`${EX}alice`), namedNode(`${EX}name`), literal('Alice')),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(true);
      expect(report.results).toHaveLength(0);
    });

    it('detects missing required property', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        minCount: 1,
      });

      // Person without a name
      const data: Quad[] = [
        quad(namedNode(`${EX}bob`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(false);
      expect(report.results.length).toBeGreaterThan(0);

      const result = report.results[0];
      expect(result.focusNode.value).toBe(`${EX}bob`);
      expect(result.resultPath.value).toBe(`${EX}name`);
      expect(result.sourceShape.value).toBeTruthy();
      expect(result.message).toBeTruthy();
      expect(result.severity).toBe('Violation');
    });

    it('detects maxCount violation', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        maxCount: 1,
      });

      const data: Quad[] = [
        quad(namedNode(`${EX}carol`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
        quad(namedNode(`${EX}carol`), namedNode(`${EX}name`), literal('Carol')),
        quad(namedNode(`${EX}carol`), namedNode(`${EX}name`), literal('Caroline')),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(false);
      expect(report.results.length).toBeGreaterThan(0);
      expect(report.results[0].focusNode.value).toBe(`${EX}carol`);
    });

    it('returns conforms=true when no shapes target the data', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Animal`,
        path: `${EX}species`,
        minCount: 1,
      });

      // Data has Person, not Animal — shape doesn't apply
      const data: Quad[] = [
        quad(namedNode(`${EX}dave`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(true);
      expect(report.results).toHaveLength(0);
    });

    it('handles empty data graph', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        minCount: 1,
      });

      const report = validator.validate([], shapes);
      expect(report.conforms).toBe(true);
      expect(report.results).toHaveLength(0);
    });

    it('handles empty shapes graph', () => {
      const data: Quad[] = [
        quad(namedNode(`${EX}alice`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      const report = validator.validate(data, []);
      expect(report.conforms).toBe(true);
      expect(report.results).toHaveLength(0);
    });

    it('maps Warning severity correctly', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}email`,
        minCount: 1,
        severity: `${SH}Warning`,
      });

      const data: Quad[] = [
        quad(namedNode(`${EX}eve`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(false);
      expect(report.results[0].severity).toBe('Warning');
    });

    it('maps Info severity correctly', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}nickname`,
        minCount: 1,
        severity: `${SH}Info`,
      });

      const data: Quad[] = [
        quad(namedNode(`${EX}frank`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(false);
      expect(report.results[0].severity).toBe('Info');
    });

    it('includes custom message from shape', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        minCount: 1,
        message: 'A person must have a name',
      });

      const data: Quad[] = [
        quad(namedNode(`${EX}ghost`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(false);
      expect(report.results[0].message).toContain('A person must have a name');
    });

    it('reports multiple violations across resources', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        minCount: 1,
      });

      const data: Quad[] = [
        quad(namedNode(`${EX}p1`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
        quad(namedNode(`${EX}p2`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      const report = validator.validate(data, shapes);
      expect(report.conforms).toBe(false);
      expect(report.results.length).toBe(2);

      const focusNodes = report.results.map((r) => r.focusNode.value).sort();
      expect(focusNodes).toEqual([`${EX}p1`, `${EX}p2`]);
    });
  });

  describe('validateIncremental', () => {
    it('validates only the changed resource', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        minCount: 1,
      });

      // Full data graph: alice is valid, bob is invalid
      const data: Quad[] = [
        quad(namedNode(`${EX}alice`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
        quad(namedNode(`${EX}alice`), namedNode(`${EX}name`), literal('Alice')),
        quad(namedNode(`${EX}bob`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      // Validate only alice — should pass
      const aliceReport = validator.validateIncremental(
        namedNode(`${EX}alice`),
        data,
        shapes,
      );
      expect(aliceReport.conforms).toBe(true);

      // Validate only bob — should fail
      const bobReport = validator.validateIncremental(
        namedNode(`${EX}bob`),
        data,
        shapes,
      );
      expect(bobReport.conforms).toBe(false);
      expect(bobReport.results.length).toBe(1);
      expect(bobReport.results[0].focusNode.value).toBe(`${EX}bob`);
    });

    it('returns conforms=true for resource with no triples', () => {
      const shapes = buildShapesGraph({
        targetClass: `${EX}Person`,
        path: `${EX}name`,
        minCount: 1,
      });

      const data: Quad[] = [
        quad(namedNode(`${EX}alice`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
      ];

      // Validate a resource that doesn't exist in the data
      const report = validator.validateIncremental(
        namedNode(`${EX}nonexistent`),
        data,
        shapes,
      );
      expect(report.conforms).toBe(true);
    });
  });
});
