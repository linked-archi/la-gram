/**
 * Basic, the generic language: three element types and three relationship
 * types, of which Connection relates any two of its elements; between a Basic
 * element and another language's, the core's types are offered. Bundled, so it
 * works offline; added beside a language, or used alone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createApp, type App } from '../../app.js';
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';
import { loadCatalogue } from '@linked-archi/kernel/metamodel-manager/catalogue.js';
import { BundledAssetSource } from '@linked-archi/kernel/metamodel-manager/asset-sources.js';
import { getBundledMetamodel } from '@linked-archi/kernel/metamodel-manager/bundled-assets.js';
import { isGenericRelationship, unambiguousRelationship } from '../../ui/canvas/rdf-append-menu-provider.js';

const BASIC_MM = 'https://meta.linked.archi/basic/metamodel#Basic';
const BASIC = 'https://meta.linked.archi/basic#';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';

let app: App;
beforeEach(async () => {
  app = await createApp();
});

/** The palette as the UI asks for it: the loaded metamodels in load order. */
const palette = () =>
  app.components.paletteGenerator.generatePalette(undefined, {
    metamodelIris: app.loadedMetamodels().map((m) => m.metamodelIri),
  });
const elementIris = () => palette().elementGroups.flatMap((g) => g.elements.map((e) => e.iri));
const relationshipLabels = (source: string, target: string) =>
  app.components.relationshipManager.getValidRelationships(source, target).map((r) => r.label);

describe('Basic, the generic language', () => {
  it('is bundled, and offered among the languages', async () => {
    expect(getBundledMetamodel(BASIC_MM)?.id).toBe('basic');
    const entries = (await loadCatalogue(new BundledAssetSource()))!;
    expect(entries).toContainEqual({ iri: BASIC_MM, label: 'Basic', kind: 'language' });
  });

  it('is not offered until chosen', () => {
    expect(elementIris()).not.toContain(BASIC + 'Node');
    expect(palette().relationshipTypes.map((r) => r.iri)).not.toContain(BASIC + 'Connection');
  });

  it('added to ArchiMate: its classification comes after ArchiMate’s, which stays the default grouping', async () => {
    await app.loadMetamodel(BASIC_MM);
    const p = palette();
    expect(p.axes!.map((a) => a.label)).toEqual(['Domain', 'Aspect', 'Basic Concepts']);
    expect(p.activeAxisIri).toBe('https://meta.linked.archi/archimate4/tax#Domain');
    // Its types are there: ArchiMate's axis does not classify them, so they keep their own group, after
    // ArchiMate's sections — not "Other".
    const categories = p.elementGroups.map((g) => g.category);
    expect(categories.indexOf('Elements')).toBeGreaterThan(categories.indexOf('Implementation and Migration Domain'));
    expect(p.elementGroups.find((g) => g.category === 'Elements')!.elements.map((e) => e.label).sort()).toEqual(['GroupNode', 'Node', 'SpecialNode']);
    expect(p.elementGroups.find((g) => g.category === 'Other')).toBeUndefined();
    expect(p.relationshipTypes.map((r) => r.label)).toContain('Connection');
    // No core class is a palette type.
    expect(elementIris()).not.toContain(NAMESPACES.arch + 'Element');
    // The model records it, so opening the model again loads it.
    expect(app.session.metamodelIris()).toContain(BASIC_MM);
  });

  it('alone: its element types, grouped by its classification, and its relationship types', async () => {
    await app.loadMetamodel(BASIC_MM, { replace: true });
    const p = palette();
    expect(p.elementGroups.map((g) => [g.category, g.elements.map((e) => e.label).sort()])).toEqual([
      ['Elements', ['GroupNode', 'Node', 'SpecialNode']],
    ]);
    expect(p.relationshipTypes.filter((r) => !r.core).map((r) => r.label)).toEqual(['Aggregation', 'Association', 'Connection']);
  });

  it('Connection relates any two of Basic’s elements; across languages, the core’s types are offered', async () => {
    await app.loadMetamodel(BASIC_MM);
    // Across languages: the core's types — Connection, Association and Aggregation keep to Basic's elements.
    const core = ['Association', 'Depends On', 'Has Part', 'Refines'];
    expect(relationshipLabels(BASIC + 'Node', AM4 + 'BusinessActor')).toEqual(core);
    expect(relationshipLabels(AM4 + 'ApplicationComponent', BASIC + 'GroupNode')).toEqual(core);
    // Within Basic: Connection, which names every Basic element type, and Association, which ranks last as every
    // Association does.
    expect(relationshipLabels(BASIC + 'Node', BASIC + 'SpecialNode')).toEqual(['Connection', 'Association']);
    expect(relationshipLabels(BASIC + 'GroupNode', BASIC + 'Node')).toEqual(['Aggregation', 'Connection']);
    expect(relationshipLabels(BASIC + 'SpecialNode', BASIC + 'GroupNode')).toEqual(['Connection']);
    // Between ArchiMate elements: ArchiMate's own only.
    const archimate = app.components.relationshipManager.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'Role');
    expect(archimate.map((r) => r.label)).not.toContain('Connection');
    expect(archimate.some((r) => r.generic)).toBe(false);
    // Naming Basic's classes, it is no generic relationship: from a group node, Aggregation or Connection is a choice.
    const fromGroup = app.components.relationshipManager.getValidRelationships(BASIC + 'GroupNode', BASIC + 'Node');
    expect(fromGroup.some((r) => isGenericRelationship(r))).toBe(false);
    expect(unambiguousRelationship(fromGroup)).toBeUndefined();
  });

  it('creates valid elements and a Connection between them', async () => {
    await app.loadMetamodel(BASIC_MM);
    const model = app.session.modelIri!;
    const a = app.components.elementManager.createElement(BASIC + 'Node', model, { label: 'Thing A' }).value;
    const b = app.components.elementManager.createElement(BASIC + 'GroupNode', model, { label: 'Thing B' }).value;
    const r = app.components.relationshipManager.createQualifiedRelationship!({
      typeIri: BASIC + 'Connection',
      sourceIri: a,
      targetIri: b,
      modelIri: model,
    });
    expect(r.classIri).toBe(BASIC + 'Connection');
    const report = app.components.validator.validate(
      (app as unknown as { validationDataGraph(): never }).validationDataGraph(),
      app.shapesGraph(),
    );
    const about = report.results.filter((x) => [a, b, r.iri].includes((x.focusNode as { value?: string })?.value ?? String(x.focusNode)));
    expect(about).toEqual([]);
  });

  it('unloads without taking the core ontology with it', async () => {
    await app.loadMetamodel(BASIC_MM);
    app.unloadMetamodel(BASIC_MM);
    expect(elementIris()).not.toContain(BASIC + 'Node');
    expect(palette().relationshipTypes.map((r) => r.iri)).not.toContain(BASIC + 'Connection');
    const store = app.components.store;
    expect(store.getQuads({ termType: 'NamedNode', value: NAMESPACES.arch + 'Element' } as never).length).toBeGreaterThan(0);
  });
});
