import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataFactory, Store as N3Store } from 'n3';
import type { Quad } from '@rdfjs/types';
import {
  RdfShaclValidator,
  buildReadableMessage,
  deepestDetailMessage,
} from '../shacl-validator.js';
import { N3TtlParser } from '../ttl-parser.js';

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

// ---------------------------------------------------------------------------
// Real published shape graphs: sh:sparql and owl:imports
// ---------------------------------------------------------------------------

const OWL = 'http://www.w3.org/2002/07/owl#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

/**
 * Real published ArchiMate 4.0 element shapes — the bundled copy, which is
 * byte-identical to the published file (`assets/` mirrors meta.linked.archi).
 * Read only.
 */
const REAL_ELEMENT_SHAPES = fileURLToPath(
  new URL('../../../assets/archimate4/archimate4-element-shapes.ttl', import.meta.url),
);

function parseTtl(ttl: string): Quad[] {
  const parser = new N3TtlParser();
  const result = parser.parse(ttl);
  if (!result.ok) throw new Error(`fixture TTL failed to parse: ${result.error.message}`);
  return result.quads;
}

function loadRealElementShapes(): Quad[] {
  return parseTtl(readFileSync(REAL_ELEMENT_SHAPES, 'utf8'));
}

describe('RdfShaclValidator — SPARQL-based constraints', () => {
  const validator = new RdfShaclValidator();

  it('does not throw on a shapes graph containing sh:sparql, and still fires the non-SPARQL constraints', () => {
    // Two shapes in one graph: one SPARQL-based (unsupported), one minCount.
    const shapes = parseTtl(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <http://example.org/> .

      ex:NoSelfLoopShape a sh:NodeShape ;
        sh:targetSubjectsOf ex:composedOf ;
        sh:sparql [
          sh:message "An element cannot compose itself." ;
          sh:select "SELECT $this WHERE { $this ex:composedOf $this . }" ;
        ] .

      ex:NameShape a sh:NodeShape ;
        sh:targetClass ex:Person ;
        sh:property [ sh:path ex:name ; sh:minCount 1 ] .
    `);

    // Data triggers both: it is a subject of ex:composedOf (SPARQL shape target)
    // and an ex:Person with no ex:name (minCount shape target).
    const data = parseTtl(`
      @prefix ex: <http://example.org/> .
      ex:a a ex:Person ; ex:composedOf ex:a .
    `);

    let report: ReturnType<RdfShaclValidator['validate']> | undefined;
    expect(() => {
      report = validator.validate(data, shapes);
    }).not.toThrow();

    expect(report).toBeDefined();
    // The minCount constraint in the same graph still fires.
    expect(report!.conforms).toBe(false);
    const components = report!.results.map((r) => r.sourceConstraintComponent?.value);
    expect(components).toContain(`${SH}MinCountConstraintComponent`);
    // The SPARQL constraint is dropped, so it contributes nothing.
    expect(components).not.toContain(`${SH}SPARQLConstraintComponent`);
  });

  it('does not throw on the real ArchiMate 4.0 element shapes, which contain sh:sparql', () => {
    const shapes = loadRealElementShapes();

    // Guard: the fixture really does contain sh:sparql. If upstream removes it,
    // this test stops proving anything and should fail loudly.
    const sparqlQuads = shapes.filter((q) => q.predicate.value === `${SH}sparql`);
    expect(sparqlQuads.length).toBeGreaterThan(0);

    // Subject of am4:composedOf — target of :NoSelfCompositionShape, a
    // sh:sparql-only shape. Unfiltered this throws
    // "Cannot find validator for constraint component sh:SPARQLConstraintComponent".
    const data = parseTtl(`
      @prefix am4: <${AM4}> .
      @prefix ex: <http://example.org/> .
      ex:a am4:composedOf ex:a .
    `);

    expect(() => validator.validate(data, shapes)).not.toThrow();
  });

  it('drops only the sh:sparql link and the SPARQLConstraintComponent object', () => {
    const shapes = loadRealElementShapes();
    const validated = validator.validate([], shapes);
    // Orphaned constraint bodies left behind are inert: nothing targets them,
    // so an empty data graph still conforms.
    expect(validated.conforms).toBe(true);
    expect(validated.results).toHaveLength(0);
  });
});

describe('RdfShaclValidator — owl:imports', () => {
  const validator = new RdfShaclValidator();

  it('completes on a shapes graph declaring owl:imports without fetching', () => {
    const shapes = parseTtl(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix owl: <${OWL}> .
      @prefix ex: <http://example.org/> .

      <http://example.org/shapes> a owl:Ontology ;
        owl:imports <https://meta.linked.archi/core#> ,
                    <https://meta.linked.archi/core-shapes#> .

      ex:NameShape a sh:NodeShape ;
        sh:targetClass ex:Person ;
        sh:property [ sh:path ex:name ; sh:minCount 1 ] .
    `);

    const data = parseTtl(`
      @prefix ex: <http://example.org/> .
      ex:bob a ex:Person .
    `);

    // No network stubbing here on purpose: if the validator ever tried to
    // resolve the imports it would have to go out over the wire, and the
    // assertion below would not be reachable synchronously.
    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results).toHaveLength(1);
  });

  it('completes on the real element shapes, which declare owl:imports', () => {
    const shapes = loadRealElementShapes();
    const importQuads = shapes.filter((q) => q.predicate.value === `${OWL}imports`);
    expect(importQuads.length).toBeGreaterThan(0);

    const report = validator.validate([], shapes);
    expect(report.conforms).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Message synthesis
// ---------------------------------------------------------------------------

describe('buildReadableMessage', () => {
  /** Data graph giving the focus node a label, so messages read naturally. */
  function labelledData(): N3Store {
    const store = new N3Store();
    store.addQuads(
      parseTtl(`
        @prefix ex: <http://example.org/> .
        @prefix skos: <${SKOS}> .
        ex:a skos:prefLabel "Billing" .
      `) as never[],
    );
    return store;
  }

  const focus = `${EX}a`;
  const shape = `${EX}BillingShape`;

  it('synthesises a MinCount message naming the node, property and shape', () => {
    const msg = buildReadableMessage(
      focus,
      shape,
      `${SH}MinCountConstraintComponent`,
      `${EX}name`,
      '',
      labelledData(),
    );
    expect(msg).toBe(
      '"Billing" is missing required property "name" (required by BillingShape).',
    );
  });

  it('synthesises a MaxCount message', () => {
    const msg = buildReadableMessage(
      focus,
      shape,
      `${SH}MaxCountConstraintComponent`,
      `${EX}name`,
      '',
      labelledData(),
    );
    expect(msg).toContain('too many values');
    expect(msg).toContain('"name"');
    expect(msg).toContain('BillingShape');
  });

  it('synthesises a Datatype message', () => {
    const msg = buildReadableMessage(
      focus,
      shape,
      `${SH}DatatypeConstraintComponent`,
      `${EX}name`,
      '',
      labelledData(),
    );
    expect(msg).toContain('wrong datatype');
    expect(msg).toContain('"name"');
  });

  it('synthesises a NodeKind message', () => {
    const msg = buildReadableMessage(
      focus,
      shape,
      `${SH}NodeKindConstraintComponent`,
      `${EX}ref`,
      '',
      labelledData(),
    );
    expect(msg).toContain('wrong node kind');
    expect(msg).toContain('"ref"');
  });

  it('synthesises an Or message about source/target combinations', () => {
    const msg = buildReadableMessage(
      focus,
      shape,
      `${SH}OrConstraintComponent`,
      '',
      '',
      labelledData(),
    );
    expect(msg).toBe(
      '"Billing" violates BillingShape — none of the allowed source/target combinations match.',
    );
  });

  it('falls back to the IRI local name when the node has no label', () => {
    const msg = buildReadableMessage(
      `${EX}unlabelled`,
      shape,
      `${SH}MinCountConstraintComponent`,
      `${EX}name`,
      '',
      new N3Store(),
    );
    expect(msg).toContain('"unlabelled"');
  });

  it('produces a generic message for an unrecognised component', () => {
    const msg = buildReadableMessage(
      focus,
      shape,
      `${SH}PatternConstraintComponent`,
      `${EX}code`,
      '',
      labelledData(),
    );
    expect(msg).toContain('PatternConstraintComponent');
    expect(msg).toContain('BillingShape');
  });
});

describe('RdfShaclValidator — message resolution end to end', () => {
  const validator = new RdfShaclValidator();

  it('synthesises a message when the shape declares no sh:message', () => {
    const shapes = parseTtl(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <http://example.org/> .
      ex:PersonShape a sh:NodeShape ;
        sh:targetClass ex:Person ;
        sh:property [ sh:path ex:name ; sh:minCount 1 ] .
    `);
    const data = parseTtl(`
      @prefix ex: <http://example.org/> .
      @prefix skos: <${SKOS}> .
      ex:bob a ex:Person ; skos:prefLabel "Bob" .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(false);
    // Not the library's terse built-in ("Less than 1 values").
    expect(report.results[0].message).toContain('"Bob" is missing required property "name"');
  });

  it('reports the constraint component on each result', () => {
    const shapes = buildShapesGraph({
      targetClass: `${EX}Person`,
      path: `${EX}name`,
      minCount: 1,
    });
    const data: Quad[] = [
      quad(namedNode(`${EX}bob`), namedNode(`${RDF}type`), namedNode(`${EX}Person`)),
    ];

    const report = validator.validate(data, shapes);
    expect(report.results[0].sourceConstraintComponent?.value).toBe(
      `${SH}MinCountConstraintComponent`,
    );
  });

  it('surfaces an Or violation with a synthesised message', () => {
    const shapes = parseTtl(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <http://example.org/> .
      ex:RelShape a sh:NodeShape ;
        sh:targetClass ex:Rel ;
        sh:or (
          [ sh:property [ sh:path ex:source ; sh:class ex:Actor ] ]
          [ sh:property [ sh:path ex:source ; sh:class ex:Role ] ]
        ) .
    `);
    const data = parseTtl(`
      @prefix ex: <http://example.org/> .
      @prefix skos: <${SKOS}> .
      ex:r1 a ex:Rel ; ex:source ex:x .
      ex:x a ex:Widget ; skos:prefLabel "Widget X" .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(false);
    const orResult = report.results.find(
      (r) => r.sourceConstraintComponent?.value === `${SH}OrConstraintComponent`,
    );
    expect(orResult).toBeDefined();
    // rdf-validate-shacl emits neither a message nor sh:detail for sh:or, so
    // without synthesis this result would carry no usable text at all.
    expect(orResult!.message).toContain(
      'none of the allowed source/target combinations match',
    );
  });
});

// ---------------------------------------------------------------------------
// Nested sh:detail extraction
// ---------------------------------------------------------------------------

describe('nested detail extraction', () => {
  const validator = new RdfShaclValidator();

  it('surfaces the innermost message from two levels of sh:node nesting', () => {
    // sh:node is the one component for which rdf-validate-shacl populates
    // sh:detail. Every level above the leaf reports only
    // "Value does not have shape <X>", which is useless on its own.
    const shapes = parseTtl(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <http://example.org/> .

      ex:Outer a sh:NodeShape ; sh:targetClass ex:T ; sh:node ex:Middle .
      ex:Middle a sh:NodeShape ; sh:node ex:Inner .
      ex:Inner a sh:NodeShape ;
        sh:property [ sh:path ex:name ; sh:minCount 1 ; sh:message "an ex:T needs a name" ] .
    `);
    const data = parseTtl(`@prefix ex: <http://example.org/> . ex:a a ex:T .`);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(false);
    const nodeResult = report.results.find(
      (r) => r.sourceConstraintComponent?.value === `${SH}NodeConstraintComponent`,
    );
    expect(nodeResult).toBeDefined();
    expect(nodeResult!.message).toBe('an ex:T needs a name');
  });

  it('returns the deepest message from a nested result tree', () => {
    expect(
      deepestDetailMessage({
        message: [{ value: 'outer' }],
        detail: [
          {
            message: [{ value: 'middle' }],
            detail: [{ message: [{ value: 'leaf' }] }],
          },
        ],
      }),
    ).toBe('leaf');
  });

  it('returns an empty string when there are no details', () => {
    expect(deepestDetailMessage({ message: [{ value: 'only me' }] })).toBe('');
    expect(deepestDetailMessage({})).toBe('');
  });

  it('stops recursing on a self-referential detail tree', () => {
    const cyclic: { message: { value: string }[]; detail: unknown[] } = {
      message: [{ value: '' }],
      detail: [],
    };
    cyclic.detail.push(cyclic);
    expect(() =>
      deepestDetailMessage(cyclic as Parameters<typeof deepestDetailMessage>[0]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Real ArchiMate 4.0 element shapes against a hand-built data graph
// ---------------------------------------------------------------------------

describe('real archimate4-element-shapes.ttl', () => {
  const validator = new RdfShaclValidator();

  it('accepts a conforming ArchiMate 4.0 element instance', () => {
    const shapes = loadRealElementShapes();
    const data = parseTtl(`
      @prefix am4: <${AM4}> .
      @prefix skos: <${SKOS}> .
      @prefix ex: <http://example.org/model/> .

      ex:billing a am4:BusinessProcess , am4:BusinessDomainElement ;
        skos:prefLabel "Billing"@en .

      ex:actor a am4:BusinessActor , am4:BusinessDomainElement ;
        skos:prefLabel "Finance Department"@en .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  it('rejects an element with no skos:prefLabel', () => {
    const shapes = loadRealElementShapes();
    const data = parseTtl(`
      @prefix am4: <${AM4}> .
      @prefix ex: <http://example.org/model/> .
      ex:nameless a am4:BusinessProcess , am4:BusinessDomainElement .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].focusNode.value).toBe('http://example.org/model/nameless');
    expect(report.results[0].resultPath.value).toBe(`${SKOS}prefLabel`);
    expect(report.results[0].sourceConstraintComponent?.value).toBe(
      `${SH}MinCountConstraintComponent`,
    );
    // The shape authors supplied sh:message, so that is what surfaces.
    expect(report.results[0].message).toContain('skos:prefLabel');
  });

  it('rejects an untagged (non-langString) label', () => {
    const shapes = loadRealElementShapes();
    const data = parseTtl(`
      @prefix am4: <${AM4}> .
      @prefix skos: <${SKOS}> .
      @prefix ex: <http://example.org/model/> .
      ex:plain a am4:BusinessProcess , am4:BusinessDomainElement ;
        skos:prefLabel "Billing" .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results[0].sourceConstraintComponent?.value).toBe(
      `${SH}DatatypeConstraintComponent`,
    );
  });

  it('does not reach an element typed only with its leaf class', () => {
    // :ArchiMateElementShape targets the 10 am4 domain/aspect roots, not
    // arch:Element. sh:targetClass walks rdfs:subClassOf*, but only over
    // axioms present in the DATA graph — the ontology is not loaded here, so
    // am4:BusinessProcess is not known to be an am4:BusinessDomainElement and
    // the shape never fires.
    const shapes = loadRealElementShapes();
    const data = parseTtl(`
      @prefix am4: <${AM4}> .
      @prefix ex: <http://example.org/model/> .
      ex:leafOnly a am4:BusinessProcess .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(true);
  });

  it('reaches a leaf-typed element once the subClassOf axiom is in the data graph', () => {
    const shapes = loadRealElementShapes();
    const data = parseTtl(`
      @prefix am4: <${AM4}> .
      @prefix rdfs: <${RDFS}> .
      @prefix ex: <http://example.org/model/> .
      ex:leafOnly a am4:BusinessProcess .
      am4:BusinessProcess rdfs:subClassOf am4:BusinessDomainElement .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results[0].focusNode.value).toBe('http://example.org/model/leafOnly');
  });

  it('does not enforce sh:sparql-only shapes, and says so by conforming', () => {
    // :NoSelfCompositionShape has sh:sparql as its only constraint, so after
    // filtering it becomes inert. A self-composition therefore passes. This
    // documents the tradeoff rather than endorsing it.
    const shapes = loadRealElementShapes();
    const data = parseTtl(`
      @prefix am4: <${AM4}> .
      @prefix skos: <${SKOS}> .
      @prefix ex: <http://example.org/model/> .
      ex:a a am4:BusinessProcess , am4:BusinessDomainElement ;
        skos:prefLabel "A"@en ;
        am4:composedOf ex:a .
    `);

    const report = validator.validate(data, shapes);
    expect(report.conforms).toBe(true);
  });
});
