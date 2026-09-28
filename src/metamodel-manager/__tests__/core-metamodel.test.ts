/**
 * The core ontology as a metamodel: "Linked.Archi Core" in the Metamodels menu
 * offers a generic element (`arch:Element`) and a generic relationship
 * (`arch:QualifiedRelationship`) — alongside a language, or alone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createApp, type App } from '../../app.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';
import { METAMODEL_CATALOGUE } from '../catalogue.js';
import { getBundledMetamodel } from '../bundled-assets.js';
import { isGenericRelationship, unambiguousRelationship } from '../../ui/canvas/rdf-append-menu-provider.js';

const CORE_MM = 'https://meta.linked.archi/core/metamodel#Core';
const ELEMENT = NAMESPACES.arch + 'Element';
const RELATIONSHIP = NAMESPACES.arch + 'QualifiedRelationship';
const AM4 = 'https://meta.linked.archi/archimate4/onto#';

let app: App;
beforeEach(async () => {
  app = await createApp();
});

const palette = () => app.components.paletteGenerator.generatePalette();
const elementIris = () => palette().elementGroups.flatMap((g) => g.elements.map((e) => e.iri));

describe('the core metamodel', () => {
  it('is listed first in the catalogue, and bundled', () => {
    expect(METAMODEL_CATALOGUE[0]).toMatchObject({ iri: CORE_MM, kind: 'core' });
    expect(getBundledMetamodel(CORE_MM)?.id).toBe('core');
  });

  it('is not offered until chosen: ArchiMate alone has no generic element or relationship', () => {
    expect(elementIris()).not.toContain(ELEMENT);
    expect(palette().relationshipTypes.map((r) => r.iri)).not.toContain(RELATIONSHIP);
  });

  it('added to ArchiMate: a "Generic" group with Element, and a Relationship — ArchiMate keeps its grouping', async () => {
    await app.loadMetamodel(CORE_MM);
    const p = palette();
    // ArchiMate's axes stay first, so its "Element by Domain" is still the default grouping.
    expect(p.axes.map((a) => a.label)).toEqual(['Element by Domain', 'Element by Aspect', 'Core Concepts']);
    expect(p.activeAxisIri).toBe('https://meta.linked.archi/archimate4/tax#ElementByDomain');
    // Under it, the generic element is grouped as what it is, not as "Other".
    const generic = p.elementGroups.find((g) => g.category === 'Generic')!;
    expect(generic.elements.map((e) => [e.iri, e.label])).toEqual([[ELEMENT, 'Element']]);
    expect(p.elementGroups.some((g) => g.category === 'Other')).toBe(false);
    // The generic relationship is a relationship type, not an element.
    const relationship = p.relationshipTypes.find((r) => r.iri === RELATIONSHIP)!;
    expect(relationship.label).toBe('Relationship');
    expect(relationship.definition).toMatch(/of no more specific type/);
    expect(elementIris()).not.toContain(RELATIONSHIP);
    // The model records it, so opening the model again loads it.
    expect(app.session.metamodelIris()).toContain(CORE_MM);
  });

  it('alone: just the generic element and relationship', async () => {
    await app.loadMetamodel(CORE_MM, { replace: true });
    const p = palette();
    expect(p.elementGroups.map((g) => [g.category, g.elements.map((e) => e.label)])).toEqual([['Generic', ['Element']]]);
    expect(p.relationshipTypes.map((r) => r.label)).toEqual(['Relationship']);
  });

  it('connects generic elements, and ranks the generic relationship last between ArchiMate ones', async () => {
    await app.loadMetamodel(CORE_MM);
    const relationships = app.components.relationshipManager;
    expect(relationships.getValidRelationships(ELEMENT, ELEMENT).map((r) => r.label)).toEqual(['Relationship']);
    expect(relationships.getValidRelationships(AM4 + 'BusinessActor', ELEMENT).map((r) => r.label)).toEqual(['Relationship']);
    const archimate = relationships.getValidRelationships(AM4 + 'BusinessActor', AM4 + 'Role');
    expect(archimate.at(-1)!.label).toBe('Relationship');
    expect(archimate.map((r) => r.label)).toContain('Assignment');
    // Like Association, it never makes an append ask which relationship.
    expect(isGenericRelationship(archimate.at(-1)!)).toBe(true);
    const assignment = archimate.find((r) => r.label === 'Assignment')!;
    expect(unambiguousRelationship([assignment, archimate.at(-1)!])).toBe(assignment);
  });

  it('creates a valid generic element and relationship', async () => {
    await app.loadMetamodel(CORE_MM);
    const model = app.session.modelIri!;
    const a = app.components.elementManager.createElement(ELEMENT, model, { label: 'Thing A' }).value;
    const b = app.components.elementManager.createElement(ELEMENT, model, { label: 'Thing B' }).value;
    const r = app.components.relationshipManager.createQualifiedRelationship!({
      typeIri: RELATIONSHIP,
      sourceIri: a,
      targetIri: b,
      modelIri: model,
    });
    expect(r.classIri).toBe(RELATIONSHIP);
    const report = app.components.validator.validate(
      (app as unknown as { validationDataGraph(): never }).validationDataGraph(),
      app.shapesGraph(),
    );
    const about = report.results.filter((x) => [a, b, r.iri].includes((x.focusNode as { value?: string })?.value ?? String(x.focusNode)));
    expect(about).toEqual([]);
  });

  it('unloads without taking the core ontology with it', async () => {
    await app.loadMetamodel(CORE_MM);
    app.unloadMetamodel(CORE_MM);
    expect(elementIris()).not.toContain(ELEMENT);
    expect(palette().relationshipTypes.map((r) => r.iri)).not.toContain(RELATIONSHIP);
    const store = app.components.store;
    expect(store.getQuads({ termType: 'NamedNode', value: ELEMENT } as never).length).toBeGreaterThan(0);
  });
});
