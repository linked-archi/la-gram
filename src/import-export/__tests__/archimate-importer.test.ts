// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  importArchiMateXml,
  mapTypeToIri,
  elementToQuads,
  relationshipToQuads,
  getChildText,
  getXsiType,
  getChildElements,
  ARCHIMATE_NS,
  KNOWN_ELEMENT_TYPES,
  KNOWN_RELATIONSHIP_TYPES,
  type ImportResult,
} from '../archimate-importer.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'https://imported.archimate/model/';

/** Minimal valid ArchiMate XML wrapper. */
function wrapXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       identifier="id-model"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <name>Test Model</name>
  ${body}
</model>`;
}

function findQuad(
  result: ImportResult,
  subjectSuffix: string,
  predicateIri: string,
  objectValue?: string,
) {
  return result.quads.find(
    (q) =>
      q.subject.value.endsWith(subjectSuffix) &&
      q.predicate.value === predicateIri &&
      (objectValue === undefined || q.object.value === objectValue),
  );
}

// ---------------------------------------------------------------------------
// mapTypeToIri
// ---------------------------------------------------------------------------

describe('mapTypeToIri', () => {
  it('maps a known element type', () => {
    expect(mapTypeToIri('BusinessProcess')).toBe(ARCHIMATE_NS + 'BusinessProcess');
  });

  it('maps a known relationship type', () => {
    expect(mapTypeToIri('Serving')).toBe(ARCHIMATE_NS + 'Serving');
  });

  it('returns null for an unknown type', () => {
    expect(mapTypeToIri('UnknownWidget')).toBeNull();
  });

  it('maps all known element types', () => {
    for (const t of KNOWN_ELEMENT_TYPES) {
      expect(mapTypeToIri(t)).toBe(ARCHIMATE_NS + t);
    }
  });

  it('maps all known relationship types', () => {
    for (const t of KNOWN_RELATIONSHIP_TYPES) {
      expect(mapTypeToIri(t)).toBe(ARCHIMATE_NS + t);
    }
  });
});

// ---------------------------------------------------------------------------
// XML helper functions (via DOMParser in jsdom)
// ---------------------------------------------------------------------------

describe('XML helpers', () => {
  function parseEl(xml: string): Element {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.documentElement;
  }

  describe('getChildText', () => {
    it('returns text of a child element', () => {
      const el = parseEl('<root xmlns="http://www.opengroup.org/xsd/archimate/3.0/"><name>Hello</name></root>');
      expect(getChildText(el, 'name')).toBe('Hello');
    });

    it('returns null when child is missing', () => {
      const el = parseEl('<root xmlns="http://www.opengroup.org/xsd/archimate/3.0/"></root>');
      expect(getChildText(el, 'name')).toBeNull();
    });

    it('trims whitespace', () => {
      const el = parseEl('<root xmlns="http://www.opengroup.org/xsd/archimate/3.0/"><name>  Spaced  </name></root>');
      expect(getChildText(el, 'name')).toBe('Spaced');
    });
  });

  describe('getXsiType', () => {
    it('reads xsi:type attribute', () => {
      const el = parseEl('<element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="BusinessProcess"/>');
      expect(getXsiType(el)).toBe('BusinessProcess');
    });

    it('returns null when no type attribute', () => {
      const el = parseEl('<element/>');
      expect(getXsiType(el)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// elementToQuads
// ---------------------------------------------------------------------------

describe('elementToQuads', () => {
  function parseElement(xml: string): Element {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.documentElement;
  }

  it('creates rdf:type quad for a known element', () => {
    const el = parseElement(
      '<element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-1" xsi:type="BusinessProcess"><name>My Process</name></element>',
    );
    const { quads, unrecognized } = elementToQuads(el, BASE);
    expect(unrecognized).toBeNull();
    expect(quads.length).toBeGreaterThanOrEqual(2);
    expect(quads[0].subject.value).toBe(BASE + 'id-1');
    expect(quads[0].predicate.value).toBe(NAMESPACES.rdf + 'type');
    expect(quads[0].object.value).toBe(ARCHIMATE_NS + 'BusinessProcess');
  });

  it('creates skos:prefLabel quad', () => {
    const el = parseElement(
      '<element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-1" xsi:type="BusinessProcess"><name>My Process</name></element>',
    );
    const { quads } = elementToQuads(el, BASE);
    const label = quads.find((q) => q.predicate.value === NAMESPACES.skos + 'prefLabel');
    expect(label).toBeDefined();
    expect(label!.object.value).toBe('My Process');
  });

  it('creates skos:definition quad when documentation present', () => {
    const el = parseElement(
      '<element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-2" xsi:type="ApplicationComponent"><name>App</name><documentation>A component</documentation></element>',
    );
    const { quads } = elementToQuads(el, BASE);
    const def = quads.find((q) => q.predicate.value === NAMESPACES.skos + 'definition');
    expect(def).toBeDefined();
    expect(def!.object.value).toBe('A component');
  });

  it('omits skos:definition when no documentation', () => {
    const el = parseElement(
      '<element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-3" xsi:type="Node"><name>Server</name></element>',
    );
    const { quads } = elementToQuads(el, BASE);
    expect(quads.find((q) => q.predicate.value === NAMESPACES.skos + 'definition')).toBeUndefined();
  });

  it('reports unrecognized type', () => {
    const el = parseElement(
      '<element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-4" xsi:type="FancyWidget"><name>W</name></element>',
    );
    const { quads, unrecognized } = elementToQuads(el, BASE);
    expect(quads).toHaveLength(0);
    expect(unrecognized).toBe('FancyWidget');
  });
});

// ---------------------------------------------------------------------------
// relationshipToQuads
// ---------------------------------------------------------------------------

describe('relationshipToQuads', () => {
  function parseRel(xml: string): Element {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.documentElement;
  }

  it('creates QualifiedRelationship quads', () => {
    const el = parseRel(
      '<relationship xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-r1" xsi:type="Serving" source="id-1" target="id-2"><name>serves</name></relationship>',
    );
    const { quads, unrecognized } = relationshipToQuads(el, BASE);
    expect(unrecognized).toBeNull();
    // rdf:type, relSource, relTarget, relPredicate, prefLabel = 5
    expect(quads).toHaveLength(5);

    const typeQ = quads.find((q) => q.predicate.value === NAMESPACES.rdf + 'type');
    expect(typeQ!.object.value).toBe(NAMESPACES.arch + 'QualifiedRelationship');

    const src = quads.find((q) => q.predicate.value === NAMESPACES.arch + 'relSource');
    expect(src!.object.value).toBe(BASE + 'id-1');

    const tgt = quads.find((q) => q.predicate.value === NAMESPACES.arch + 'relTarget');
    expect(tgt!.object.value).toBe(BASE + 'id-2');

    const pred = quads.find((q) => q.predicate.value === NAMESPACES.arch + 'relPredicate');
    expect(pred!.object.value).toBe(ARCHIMATE_NS + 'Serving');
  });

  it('omits label when name is absent', () => {
    const el = parseRel(
      '<relationship xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-r2" xsi:type="Flow" source="id-a" target="id-b"/>',
    );
    const { quads } = relationshipToQuads(el, BASE);
    expect(quads).toHaveLength(4); // no prefLabel
  });

  it('reports unrecognized relationship type', () => {
    const el = parseRel(
      '<relationship xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-r3" xsi:type="MagicLink" source="id-a" target="id-b"/>',
    );
    const { quads, unrecognized } = relationshipToQuads(el, BASE);
    expect(quads).toHaveLength(0);
    expect(unrecognized).toBe('MagicLink');
  });
});

// ---------------------------------------------------------------------------
// importArchiMateXml (integration)
// ---------------------------------------------------------------------------

describe('importArchiMateXml', () => {
  it('imports elements and relationships from valid XML', () => {
    const xml = wrapXml(`
      <elements>
        <element identifier="id-e1" xsi:type="BusinessProcess">
          <name>Order Processing</name>
          <documentation>Handles orders</documentation>
        </element>
        <element identifier="id-e2" xsi:type="ApplicationComponent">
          <name>CRM</name>
        </element>
      </elements>
      <relationships>
        <relationship identifier="id-r1" xsi:type="Serving" source="id-e1" target="id-e2">
          <name>serves</name>
        </relationship>
      </relationships>
    `);

    const result = importArchiMateXml(xml);
    expect(result.elementCount).toBe(2);
    expect(result.relationshipCount).toBe(1);
    expect(result.unrecognizedTypes).toHaveLength(0);

    // Element quads: e1 has type + label + definition = 3, e2 has type + label = 2
    // Relationship quads: type + source + target + predicate + label = 5
    expect(result.quads.length).toBe(10);

    // Verify element type
    expect(findQuad(result, 'id-e1', NAMESPACES.rdf + 'type', ARCHIMATE_NS + 'BusinessProcess')).toBeDefined();
    // Verify label
    expect(findQuad(result, 'id-e1', NAMESPACES.skos + 'prefLabel', 'Order Processing')).toBeDefined();
    // Verify definition
    expect(findQuad(result, 'id-e1', NAMESPACES.skos + 'definition', 'Handles orders')).toBeDefined();
    // Verify relationship
    expect(findQuad(result, 'id-r1', NAMESPACES.arch + 'relPredicate', ARCHIMATE_NS + 'Serving')).toBeDefined();
  });

  it('collects unrecognized types', () => {
    const xml = wrapXml(`
      <elements>
        <element identifier="id-e1" xsi:type="BusinessProcess">
          <name>Known</name>
        </element>
        <element identifier="id-e2" xsi:type="CustomWidget">
          <name>Unknown</name>
        </element>
        <element identifier="id-e3" xsi:type="CustomWidget">
          <name>Also Unknown</name>
        </element>
      </elements>
      <relationships>
        <relationship identifier="id-r1" xsi:type="MagicLink" source="id-e1" target="id-e2"/>
      </relationships>
    `);

    const result = importArchiMateXml(xml);
    expect(result.elementCount).toBe(1);
    expect(result.relationshipCount).toBe(0);
    // Deduplicated: CustomWidget + MagicLink
    expect(result.unrecognizedTypes).toContain('CustomWidget');
    expect(result.unrecognizedTypes).toContain('MagicLink');
    expect(result.unrecognizedTypes).toHaveLength(2);
  });

  it('handles empty model', () => {
    const xml = wrapXml('<elements/><relationships/>');
    const result = importArchiMateXml(xml);
    expect(result.elementCount).toBe(0);
    expect(result.relationshipCount).toBe(0);
    expect(result.quads).toHaveLength(0);
    expect(result.unrecognizedTypes).toHaveLength(0);
  });

  it('handles malformed XML gracefully', () => {
    const result = importArchiMateXml('<not valid xml>>>');
    expect(result.elementCount).toBe(0);
    expect(result.relationshipCount).toBe(0);
    expect(result.quads).toHaveLength(0);
  });

  it('uses custom base namespace', () => {
    const xml = wrapXml(`
      <elements>
        <element identifier="id-e1" xsi:type="Goal"><name>G</name></element>
      </elements>
    `);
    const result = importArchiMateXml(xml, 'https://custom.ns/');
    expect(result.quads[0].subject.value).toBe('https://custom.ns/id-e1');
  });

  it('imports all ArchiMate layers', () => {
    const types = [
      'BusinessActor', 'ApplicationComponent', 'Node',
      'Stakeholder', 'Resource', 'WorkPackage',
    ];
    const elems = types
      .map((t, i) => `<element identifier="id-${i}" xsi:type="${t}"><name>${t}</name></element>`)
      .join('\n');
    const xml = wrapXml(`<elements>${elems}</elements>`);
    const result = importArchiMateXml(xml);
    expect(result.elementCount).toBe(types.length);
    expect(result.unrecognizedTypes).toHaveLength(0);
  });

  it('imports all relationship types', () => {
    const types = [
      'Composition', 'Aggregation', 'Assignment', 'Realization',
      'Serving', 'Access', 'Influence', 'Triggering', 'Flow',
      'Specialization', 'Association',
    ];
    const rels = types
      .map((t, i) => `<relationship identifier="id-r${i}" xsi:type="${t}" source="id-s" target="id-t"/>`)
      .join('\n');
    const xml = wrapXml(`
      <elements>
        <element identifier="id-s" xsi:type="BusinessProcess"><name>S</name></element>
        <element identifier="id-t" xsi:type="BusinessProcess"><name>T</name></element>
      </elements>
      <relationships>${rels}</relationships>
    `);
    const result = importArchiMateXml(xml);
    expect(result.relationshipCount).toBe(types.length);
    expect(result.unrecognizedTypes).toHaveLength(0);
  });
});
