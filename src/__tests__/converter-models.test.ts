/**
 * Models made by the Linked.Archi converters open as models.
 *
 * The fixture is archimate2linkedarchi's output for its payment-platform
 * example (TriG: a model, a semantic, a views and a provenance graph). Besides
 * the model, a converter records the conversion itself — the run, the agent,
 * the source file and the named graphs, typed with PROV-O and schema.org.
 * Those describe the model; they are not in it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { modelQuads, readModelContents } from '../model-manager/model-queries.js';
import { buildModelTree, type TreeNode } from '../ui/panels/model-explorer.js';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'converters', name), 'utf8');

/** Labels, nested: a row with children as `[label, children]`. */
const outline = (nodes: TreeNode[]): unknown[] => nodes.map((n) => (n.children.length > 0 ? [n.label, outline(n.children)] : n.label));

/**
 * What archimate2linkedarchi makes of an Archi model whose exchange file keeps
 * its folders (`<organizations>`): nested `arch:Folder`s in `graph/model`, each
 * holding its concepts from both ends — the member's `dcterms:isPartOf`, the
 * folder's `schema:itemListElement` — though either may come alone.
 */
const FOLDERED = `
@base <https://example.org/la/model/shop/> .
@prefix arch: <https://meta.linked.archi/core#> .
@prefix am: <https://meta.linked.archi/archimate3/onto#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix schema: <https://schema.org/> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

<graph/model> {
  <https://example.org/la/model/shop> a arch:Model ;
    skos:prefLabel "Shop"@en ;
    arch:modelConformsToMetamodel <https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2> .
  <folder/business> a arch:Folder ; schema:name "Business" ; dcterms:isPartOf <https://example.org/la/model/shop> ;
    schema:itemListElement [ a schema:ListItem ; schema:position 1 ; schema:item <folder/actors> ] .
  <folder/actors> a arch:Folder ; schema:name "Actors" ; dcterms:isPartOf <folder/business> ;
    schema:itemListElement [ a schema:ListItem ; schema:position 1 ; schema:item <element/teller> ] ,
                           [ a schema:ListItem ; schema:position 2 ; schema:item <element/clerk> ] .
  <element/teller> dcterms:isPartOf <folder/actors> .
  <folder/relations> a arch:Folder ; schema:name "Relations" ; dcterms:isPartOf <https://example.org/la/model/shop> .
  <relationship/serves> dcterms:isPartOf <folder/relations> .
  <folder/views> a arch:Folder ; schema:name "Views" ; dcterms:isPartOf <https://example.org/la/model/shop> .
  <view/main> dcterms:isPartOf <folder/views> .
}

<graph/semantic> {
  <element/teller> a am:BusinessActor, arch:Element, arch:ModelConcept ;
    arch:inModel <https://example.org/la/model/shop> ; skos:prefLabel "Teller"@en .
  <element/clerk> a am:BusinessActor, arch:Element, arch:ModelConcept ;
    arch:inModel <https://example.org/la/model/shop> ; skos:prefLabel "Clerk"@en .
  <element/web> a am:ApplicationComponent, arch:Element, arch:ModelConcept ;
    arch:inModel <https://example.org/la/model/shop> ; skos:prefLabel "Web shop"@en .
  <relationship/serves> a am:Serving, arch:QualifiedRelationship, arch:ModelConcept ;
    arch:inModel <https://example.org/la/model/shop> ;
    arch:source <element/web> ; arch:target <element/clerk> .
  <view/main> a arch:View, arch:Diagram, arch:ModelConcept ;
    arch:inModel <https://example.org/la/model/shop> ; skos:prefLabel "Main"@en .
}
`;

describe('a model from the converters that keeps its folders', () => {
  it('shows in the tree in its folders — nested, by name — with what no folder holds apart, or by type', async () => {
    const app = await createApp();
    await app.openModel(FOLDERED, 'shop.trig');
    const contents = readModelContents(app.components.store, app.components.viewManager.getViews());

    const [root] = buildModelTree(contents, undefined, new Set(), 'folders');
    expect(root.label).toBe('Shop');
    expect(outline(root.children)).toEqual([
      ['Business', [['Actors', ['Clerk', 'Teller']]]],
      ['Relations', ['Web shop → Clerk']],
      ['Views', ['Main']],
      ['Not in a folder', [['Elements', [['Application Component', ['Web shop']]]]]],
    ]);

    const [byType] = buildModelTree(contents, undefined, new Set(), 'types');
    expect(byType.children.map((f) => [f.label, f.detail])).toEqual([
      ['Views', '1'],
      ['Elements', '3'],
      ['Relationships', '1'],
    ]);
  }, 60_000);

  it("shows the ArchiMate converter's flat folders, the concepts it leaves out of them apart", async () => {
    const app = await createApp();
    await app.openModel(fixture('archimate-payment-platform.trig'), 'payment-platform.trig');
    const contents = readModelContents(app.components.store, app.components.viewManager.getViews());
    const [root] = buildModelTree(contents, undefined, new Set(), 'folders');
    expect(root.children.map((f) => [f.label, f.detail])).toEqual([
      ['Application', '3'],
      ['Business', '4'],
      ['Technology', '4'],
      ['Not in a folder', '11'],
    ]);
  }, 60_000);
});

describe('a model from the ArchiMate converter', () => {
  it('opens offline with its metamodel, its elements, relationships and view — and not its provenance', async () => {
    const app = await createApp();
    const opened = await app.openModel(fixture('archimate-payment-platform.trig'), 'payment-platform.trig');

    expect(opened.missingMetamodels).toEqual([]);
    expect(app.loadedMetamodels().map((m) => m.metamodelIri)).toContain(
      'https://meta.linked.archi/archimate3/metamodel#ArchiMate3.2',
    );
    const contents = readModelContents(app.components.store, app.components.viewManager.getViews());
    expect(contents.elements).toHaveLength(11);
    expect(contents.relationships).toHaveLength(10);
    expect(contents.unclassified).toEqual([]);
    expect(app.components.viewManager.getViews()).toHaveLength(1);

    // The conversion's provenance stays out of the model: no membership was added to it.
    const quads = modelQuads(app.components.store);
    const provenance = quads
      .filter((q) => q.predicate.value === NAMESPACES.rdf + 'type' && q.object.value.startsWith(NAMESPACES.prov))
      .map((q) => q.subject.value);
    expect(provenance.length).toBeGreaterThan(0);
    const members = new Set(
      quads.filter((q) => q.predicate.value === NAMESPACES.arch + 'inModel').map((q) => q.subject.value),
    );
    expect(provenance.filter((iri) => members.has(iri))).toEqual([]);
  }, 60_000);
});
