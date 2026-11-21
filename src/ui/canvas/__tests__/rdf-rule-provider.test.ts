import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventBus from 'diagram-js/lib/core/EventBus.js';
import { RdfRuleProvider, RdfRules } from '../rdf-rule-provider.js';
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

describe('the figure rules, held to a reference to another view (VR-5, VR-6, VR-DD-7)', () => {
  const root = {};
  const shape = (businessObject: Record<string, unknown>, size = { width: 120, height: 55 }) => ({ ...size, parent: root, businessObject });
  const figure = (iri: string, kind: string, size?: { width: number; height: number }) =>
    shape({ iri, typeIri: '', kind: 'figure', figure: { kind, ...(kind === 'reference' ? { view: 'https://example.org/view/2' } : {}) } }, size);
  const reference = figure('https://example.org/view/1#node-r', 'reference');
  const another = figure('https://example.org/view/1#node-s', 'reference');
  const group = figure('https://example.org/view/1#node-g', 'group', { width: 400, height: 260 });
  const rectangle = figure('https://example.org/view/1#node-h', 'shape', { width: 200, height: 120 });
  const element = shape({ iri: 'https://example.org/element/a', typeIri: 'urn:t#App', kind: 'element' }, { width: 300, height: 200 });
  const line = { waypoints: [], parent: root, businessObject: { iri: 'https://example.org/relationship/r', typeIri: 'urn:t#Serving', kind: 'relationship' } };

  /** The rules as diagram-js asks them: through the command stack's `canExecute` events. */
  const rules = () => {
    const eventBus = new EventBus();
    const provider = new RdfRuleProvider({
      getValidRelationships: vi.fn(() => [{ iri: 'urn:t#Serving', label: 'Serving', domainTypes: [], rangeTypes: [] }]),
      createRelationship: vi.fn(),
      deleteRelationship: vi.fn(),
    });
    new RdfRules(eventBus, provider);
    const allowed = (action: string, context: unknown) => eventBus.fire(`commandStack.${action}.canExecute`, { command: action, context });
    return { allowed, provider };
  };

  it('goes inside an element’s box, a group or a shape, and holds nothing — dropped, moved or made', () => {
    const { allowed } = rules();
    for (const container of [element, group, rectangle]) expect(allowed('elements.move', { target: container, shapes: [reference] })).toBe(true);
    expect(allowed('shape.create', { target: element, shape: reference })).toBe(true);
    expect(allowed('elements.move', { target: reference, shapes: [element] })).toBe(false);
    expect(allowed('elements.move', { target: reference, shapes: [another] })).toBe(false);
    expect(allowed('shape.create', { target: reference, shape: another })).toBe(false);
  });

  it('has lines from it and to it that stand for no relationship; none with a relationship type picked, nor a relationship’s end', () => {
    const { allowed, provider } = rules();
    expect(allowed('connection.start', { source: reference })).toBe(true);
    for (const [source, target] of [
      [element, reference],
      [reference, element],
      [reference, another],
      [group, reference],
    ]) {
      expect(allowed('connection.create', { source, target })).toEqual({ typeIri: '', connector: true, candidates: [] });
    }
    expect(allowed('connection.create', { source: reference, target: reference })).toBe(false);
    // A relationship's line keeps no figure at an end.
    expect(allowed('connection.reconnect', { connection: line, source: element, target: reference })).toBe(false);
    provider.setPreferredType('urn:t#Serving');
    expect(allowed('connection.create', { source: element, target: reference })).toBe(false);
    expect(allowed('connection.create', { source: reference, target: element })).toBe(false);
  });
});
