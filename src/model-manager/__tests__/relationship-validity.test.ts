/**
 * Relationships checked against the relationship tables, in place of the
 * generated relationship shapes (Task 22): the same findings as those shapes,
 * the other shapes kept, junctions read from the shapes — bundled ArchiMate 4.0.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataFactory } from 'n3';
import type { Quad } from '@rdfjs/types';
import { createApp, type App } from '../../app.js';
import { RdfShaclValidator } from '../../rdf-engine/shacl-validator.js';
import { checkRelationshipsByTables, splitTableShapes } from '../relationship-validity.js';
import { NO_TABLE_PERMISSIONS } from '../direct-permissions.js';

const AM4 = 'https://meta.linked.archi/archimate4/onto#';
const { namedNode, quad } = DataFactory;

let app: App;
const iri: Record<string, string> = {};

beforeAll(async () => {
  app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9 });
  const { modelIri } = app.newModel('Validity');
  const { elementManager: elements, relationshipManager: relationships, store } = app.components;
  for (const [name, type] of Object.entries({
    actor: 'BusinessActor',
    role: 'Role',
    data: 'DataObject',
    process: 'Process',
    object: 'BusinessObject',
    junction: 'AndJunction',
  })) {
    iri[name] = elements.createElement(AM4 + type, modelIri).value;
  }
  const rel = (name: string, type: string, source: string, target: string) => {
    iri[name] = relationships.createQualifiedRelationship({ typeIri: AM4 + type, sourceIri: iri[source], targetIri: iri[target] }).iri;
  };
  rel('assigned', 'Assignment', 'actor', 'role'); // permitted
  rel('servesBadly', 'Serving', 'data', 'actor'); // a data object serves nothing
  rel('accessedBadly', 'Access', 'object', 'process'); // a business object accesses nothing
  rel('accesses', 'Access', 'process', 'object'); // permitted
  rel('toJunction', 'Serving', 'data', 'junction'); // a junction may be either end
  rel('fromJunction', 'Serving', 'junction', 'actor');
  // A direct triple with no qualified relationship behind it.
  store.addQuads([quad(namedNode(iri.role), namedNode(AM4 + 'accesses'), namedNode(iri.actor)) as unknown as Quad]);
}, 120_000);

describe('the shapes split', () => {
  it('the generated relationship shapes go; the others stay', () => {
    const shapes = app.shapesGraph();
    const { split } = app.relationshipCheck();
    expect(split.qualified.size).toBeGreaterThan(5);
    expect(split.unqualified.size).toBeGreaterThan(20);
    expect(split.kept.length).toBeGreaterThan(0);
    expect(split.kept.length + split.replacedQuads).toBe(shapes.length);
    // Shapes of another form on a relationship class are kept: the access type's.
    const kept = new Set(split.kept.map((q) => q.subject.value));
    const attributeShape = shapes.find((q) => /AccessAttributeShape$/.test(q.subject.value))?.subject.value;
    if (attributeShape) expect(kept.has(attributeShape)).toBe(true);
  });

  it('junctions are read from the shapes', () => {
    const { split } = app.relationshipCheck();
    expect([...split.junctions].sort()).toEqual([AM4 + 'AndJunction', AM4 + 'OrJunction']);
  });

  it('without relationship tables, nothing is replaced', () => {
    const shapes = app.shapesGraph();
    const split = splitTableShapes(shapes, NO_TABLE_PERMISSIONS, new Map(), () => false);
    expect(split.kept).toBe(shapes);
    expect(split.qualified.size).toBe(0);
  });
});

describe('the findings', () => {
  it('are those of the shapes they replace', () => {
    const data = app.validationDataGraph();
    const { split, tables, closure } = app.relationshipCheck();
    const key = (r: { focusNode: { value: string }; resultPath: { value: string } }) => `${r.focusNode.value} ${r.resultPath.value}`;
    const full = (r: { message: string } & Parameters<typeof key>[0]) => `${key(r)} ${r.message}`;
    const all = new RdfShaclValidator().validate(data, app.shapesGraph());
    const rest = new Set(new RdfShaclValidator().validate(data, split.kept).results.map(full));
    const byShapes = new Set(all.results.filter((r) => !rest.has(full(r))).map(key));
    const byTables = new Set(checkRelationshipsByTables(data, split, tables, closure).map(key));
    expect([...byTables].sort()).toEqual([...byShapes].sort());
    // What they are: the two bad relationships, as qualified resources and as direct triples.
    expect(byTables).toContain(`${iri.servesBadly} `);
    expect(byTables).toContain(`${iri.accessedBadly} `);
    expect(byTables).toContain(`${iri.data} ${AM4}serves`);
    expect(byTables).toContain(`${iri.object} ${AM4}accesses`);
    expect(byTables).toContain(`${iri.role} ${AM4}accesses`);
    for (const fine of ['assigned', 'accesses', 'toJunction', 'fromJunction']) expect(byTables).not.toContain(`${iri[fine]} `);
  });

  it('are published by runValidation, under the replaced shape and its message', () => {
    let published: { conforms: boolean; results: Array<{ focusNode: { value: string }; message: string; sourceShape: { value: string } }> } | undefined;
    app.components.eventBus.on('validation-updated', (e) => {
      published = e.detail as never;
    });
    app.runValidation();
    expect(published?.conforms).toBe(false);
    // Under the replaced shape, in its words.
    const serving = published?.results.find((r) => r.focusNode.value === iri.servesBadly);
    expect(serving?.sourceShape.value).toMatch(/ServingShape$/);
    const authored = app
      .shapesGraph()
      .find((q) => q.subject.value === serving?.sourceShape.value && q.predicate.value === 'http://www.w3.org/ns/shacl#message');
    expect(serving?.message).toBe(authored?.object.value);
  });
});
