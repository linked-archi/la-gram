import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RdfRuleProvider } from '../rdf-rule-provider.js';
import type { RelationshipManager } from '../../../model-manager/interfaces.js';
import type { RelationshipTypeInfo } from '../../../metamodel-manager/interfaces.js';

function createMockRelationshipManager(): RelationshipManager {
  return {
    getValidRelationships: vi.fn(),
    createRelationship: vi.fn(),
    deleteRelationship: vi.fn(),
  };
}

describe('RdfRuleProvider', () => {
  let ruleProvider: RdfRuleProvider;
  let relationshipManager: RelationshipManager;

  beforeEach(() => {
    relationshipManager = createMockRelationshipManager();
    ruleProvider = new RdfRuleProvider(relationshipManager);
  });

  it('returns the connection attributes, type included, for a valid pair', () => {
    const validRels: RelationshipTypeInfo[] = [
      {
        iri: 'arch:Serving',
        label: 'Serves',
        domainTypes: ['arch:AppComponent'],
        rangeTypes: ['arch:AppService'],
        unqualifiedPredicateIri: 'arch:serves',
      },
    ];
    vi.mocked(relationshipManager.getValidRelationships).mockReturnValue(validRels);

    const result = ruleProvider.canConnect('arch:AppComponent', 'arch:AppService');

    expect(result).toMatchObject({
      typeIri: 'arch:Serving',
      unqualifiedPredicateIri: 'arch:serves',
      typeLabel: 'Serves',
    });
    // `label` on a diagram-js element is a reference into its `labels`
    // collection, and `connection-preview` hands a rule result straight to
    // `elementFactory.createConnection` — so the key must not be `label`.
    expect(result).not.toHaveProperty('label');
  });

  it('returns false when no valid relationships exist', () => {
    vi.mocked(relationshipManager.getValidRelationships).mockReturnValue([]);

    expect(ruleProvider.canConnect('arch:AppComponent', 'arch:BusinessProcess')).toBe(false);
  });

  it('picks the ranked winner and carries the rest as candidates', () => {
    const validRels: RelationshipTypeInfo[] = [
      { iri: 'arch:Serving', label: 'Serves', domainTypes: ['arch:A'], rangeTypes: ['arch:B'] },
      { iri: 'arch:Access', label: 'Accesses', domainTypes: ['arch:A'], rangeTypes: ['arch:B'] },
    ];
    vi.mocked(relationshipManager.getValidRelationships).mockReturnValue(validRels);

    const result = ruleProvider.canConnect('arch:A', 'arch:B');

    // The manager ranks; the rule provider does not reorder.
    expect(result).not.toBe(false);
    expect((result as Exclude<typeof result, false>).typeIri).toBe('arch:Serving');
    expect((result as Exclude<typeof result, false>).candidates).toEqual(validRels);
  });

  it('passes correct type IRIs to relationship manager', () => {
    vi.mocked(relationshipManager.getValidRelationships).mockReturnValue([]);

    ruleProvider.canConnect('arch:Source', 'arch:Target');

    expect(relationshipManager.getValidRelationships).toHaveBeenCalledWith(
      'arch:Source',
      'arch:Target',
    );
  });

  it('canCreate returns true for non-empty type IRI', () => {
    expect(ruleProvider.canCreate('arch:BusinessProcess')).toBe(true);
  });

  it('canCreate returns false for empty type IRI', () => {
    expect(ruleProvider.canCreate('')).toBe(false);
  });

  it('canDelete always returns true', () => {
    expect(ruleProvider.canDelete('https://example.org/elem-1')).toBe(true);
    expect(ruleProvider.canDelete('any-iri')).toBe(true);
  });
});
