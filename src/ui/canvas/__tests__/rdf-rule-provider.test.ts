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

  it('allows connection when valid relationships exist', () => {
    const validRels: RelationshipTypeInfo[] = [
      {
        iri: 'arch:serves',
        label: 'Serves',
        domainTypes: ['arch:AppComponent'],
        rangeTypes: ['arch:AppService'],
      },
    ];
    vi.mocked(relationshipManager.getValidRelationships).mockReturnValue(validRels);

    const result = ruleProvider.canConnect('arch:AppComponent', 'arch:AppService');

    expect(result.allowed).toBe(true);
    expect(result.validRelationshipTypes).toEqual(['arch:serves']);
  });

  it('disallows connection when no valid relationships exist', () => {
    vi.mocked(relationshipManager.getValidRelationships).mockReturnValue([]);

    const result = ruleProvider.canConnect('arch:AppComponent', 'arch:BusinessProcess');

    expect(result.allowed).toBe(false);
    expect(result.validRelationshipTypes).toEqual([]);
  });

  it('returns multiple valid relationship types', () => {
    const validRels: RelationshipTypeInfo[] = [
      { iri: 'arch:serves', label: 'Serves', domainTypes: ['arch:A'], rangeTypes: ['arch:B'] },
      { iri: 'arch:accesses', label: 'Accesses', domainTypes: ['arch:A'], rangeTypes: ['arch:B'] },
    ];
    vi.mocked(relationshipManager.getValidRelationships).mockReturnValue(validRels);

    const result = ruleProvider.canConnect('arch:A', 'arch:B');

    expect(result.allowed).toBe(true);
    expect(result.validRelationshipTypes).toHaveLength(2);
    expect(result.validRelationshipTypes).toContain('arch:serves');
    expect(result.validRelationshipTypes).toContain('arch:accesses');
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
