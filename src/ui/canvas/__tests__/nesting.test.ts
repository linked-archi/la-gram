import { describe, it, expect } from 'vitest';
import type { RelationshipTypeInfo } from '../../../metamodel-manager/interfaces.js';
import { nestingOffers, nestingShownBy } from '../nesting.js';

const AM = 'https://example.org/am#';
const rel = (name: string, nestedEnds?: Array<'source' | 'target'>): RelationshipTypeInfo =>
  ({ iri: AM + name, label: name, ...(nestedEnds ? { relationshipStyle: { nestedEnds } } : {}) }) as RelationshipTypeInfo;

const TYPES = [
  rel('Composition', ['target']),
  rel('Assignment', ['target']),
  rel('Realization', ['source', 'target']),
  rel('Specialization', ['source']),
  rel('Serving'),
];
const node = { iri: 'urn:node', typeIri: AM + 'Node' };
const software = { iri: 'urn:sw', typeIri: AM + 'SystemSoftware' };

/** Node → SystemSoftware: composition, assignment, serving; back: realization, specialization, serving. */
const permitted = (source: string, target: string): RelationshipTypeInfo[] =>
  source === node.typeIri && target === software.typeIri
    ? [TYPES[1], TYPES[0], TYPES[4]]
    : source === software.typeIri && target === node.typeIri
      ? [TYPES[2], TYPES[3], TYPES[4]]
      : [];

describe('nestingOffers', () => {
  it('offers what nesting may draw and the metamodel permits, the inner element as target first', () => {
    const offers = nestingOffers(node, software, TYPES, permitted);
    expect(offers.map((o) => [o.type.label, o.sourceIri, o.targetIri])).toEqual([
      ['Assignment', 'urn:node', 'urn:sw'],
      ['Composition', 'urn:node', 'urn:sw'],
      ['Realization', 'urn:sw', 'urn:node'],
      ['Specialization', 'urn:sw', 'urn:node'],
    ]);
  });

  it('never offers a relationship nesting cannot draw, nor one the model already has', () => {
    const existing = [{ iri: 'urn:r', classIri: AM + 'Assignment', sourceIri: 'urn:node', targetIri: 'urn:sw' }];
    const offers = nestingOffers(node, software, TYPES, permitted, existing);
    expect(offers.map((o) => o.type.label)).toEqual(['Composition', 'Realization', 'Specialization']);
  });

  it('offers nothing for a pair the metamodel relates by nothing nesting draws', () => {
    expect(nestingOffers(software, software, TYPES, permitted)).toEqual([]);
  });
});

describe('nestingShownBy', () => {
  it('is true when a relationship nesting draws already relates them, in its direction', () => {
    const assignment = { iri: 'urn:r', classIri: AM + 'Assignment', sourceIri: 'urn:node', targetIri: 'urn:sw' };
    const serving = { iri: 'urn:s', classIri: AM + 'Serving', sourceIri: 'urn:node', targetIri: 'urn:sw' };
    expect(nestingShownBy(node, software, TYPES, [assignment])).toBe(true);
    expect(nestingShownBy(software, node, TYPES, [assignment])).toBe(false);
    expect(nestingShownBy(node, software, TYPES, [serving])).toBe(false);
  });
});
