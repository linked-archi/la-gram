/**
 * Relationship lookups in one task share what they read of the metamodels
 * (Task 22) — until the store is written to, or the task ends.
 */
import { describe, it, expect, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { createApp } from '../../app.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';

describe('relationship lookups in one task', () => {
  it('read the relationship types once — again after a write, and in the next task', async () => {
    const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
    const manager = app.components.relationshipManager as unknown as {
      getValidRelationships(s: string, t: string): Array<{ iri: string }>;
      readRelationshipTypes(scope: unknown): unknown[];
    };
    const reads = vi.spyOn(manager, 'readRelationshipTypes');
    const first = manager.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'Role').map((r) => r.iri);
    manager.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'Process');
    expect(reads).toHaveBeenCalledTimes(1);
    app.components.store.addQuads([
      DataFactory.quad(DataFactory.namedNode('https://example.org/a'), DataFactory.namedNode('https://example.org/p'), DataFactory.namedNode('https://example.org/b')) as unknown as Quad,
    ]);
    expect(manager.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'Role').map((r) => r.iri)).toEqual(first);
    expect(reads).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    manager.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'Role');
    expect(reads).toHaveBeenCalledTimes(3);
  }, 120_000);
});
