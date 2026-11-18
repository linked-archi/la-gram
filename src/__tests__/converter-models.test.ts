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
import { relationshipClassOf } from '../model-manager/cascade.js';
import { buildModelTree, type TreeNode } from '../ui/panels/model-explorer.js';
import { hexColour } from '../ui/figure-bar.js';
import { nn as namedNode } from '../model-manager/vocabulary.js';

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
  it('shows each folder under the group of what it holds — nested, by name — what none holds by type, or all by type', async () => {
    const app = await createApp();
    await app.openModel(FOLDERED, 'shop.trig');
    const contents = readModelContents(app.components.store, app.components.viewManager.getViews());

    const [root] = buildModelTree(contents, undefined, new Set(), 'folders');
    expect(root.label).toBe('Shop');
    expect(outline(root.children)).toEqual([
      // "Views" is the group itself: what it holds is directly in it.
      ['Views', ['Main']],
      ['Elements', [['Business', [['Actors', ['Clerk', 'Teller']]]], ['Application Component', ['Web shop']]]],
      ['Relationships', [['Relations', ['Web shop → Clerk']]]],
    ]);

    const [byType] = buildModelTree(contents, undefined, new Set(), 'types');
    expect(byType.children.map((f) => [f.label, f.detail])).toEqual([
      ['Views', '1'],
      ['Elements', '3'],
      ['Relationships', '1'],
    ]);
  }, 60_000);

  it("shows the ArchiMate converter's flat folders under Elements, the concepts it leaves out of them by type", async () => {
    const app = await createApp();
    await app.openModel(fixture('archimate-payment-platform.trig'), 'payment-platform.trig');
    const contents = readModelContents(app.components.store, app.components.viewManager.getViews());
    const [root] = buildModelTree(contents, undefined, new Set(), 'folders');
    // Every element in a folder; the view and the relationships, which none holds, directly in their groups.
    expect(root.children.map((g) => [g.label, g.detail])).toEqual([
      ['Views', '1'],
      ['Elements', '11'],
      ['Relationships', '10'],
    ]);
    expect(root.children[1].children.map((f) => [f.label, f.detail, f.folderKind])).toEqual([
      ['Application', '3', 'element'],
      ['Business', '4', 'element'],
      ['Technology', '4', 'element'],
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
    // Typed arch:QualifiedRelationship and arch:ModelConcept before their class: listed, and handled, by
    // the class — not all under "Model Concept".
    const am = 'https://meta.linked.archi/archimate3/onto#';
    expect(contents.relationships.filter((r) => !r.typeIri.startsWith(am))).toEqual([]);
    const serving = contents.relationships.find((r) => r.iri.endsWith('/relationship/id-rel-1'))!;
    expect([serving.typeIri, serving.typeLabel]).toEqual([am + 'Serving', 'Serving']);
    expect(relationshipClassOf(app.components.store, serving.iri)).toBe(am + 'Serving');
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

describe("the ArchiMate converter's groups, notes and the lines from them", () => {
  // archimate2linkedarchi's output for an exchange view with a group around an
  // element, a coloured note and a line from the note to the element.
  const VIEW = 'https://example.org/la/model/figures/view/id-v1';
  const NOTE = `${VIEW}/node/n-note`;

  it('open as figures, their text their prefLabel, the note in its colour; the line from it a line only', async () => {
    const app = await createApp();
    await app.openModel(fixture('archimate-figures.trig'), 'figures.trig');
    const views = app.components.viewManager;
    const figures = views.getNodes(VIEW).filter((n) => n.figure);
    expect(new Map(figures.map((n) => [n.nodeIri.split('/').pop(), n.figure]))).toEqual(
      new Map([
        ['n-group', { kind: 'group', text: 'Customer facing' }],
        // The converter's rgba(255,214,224,255) — its alpha out of 255 — read as meant: opaque.
        ['n-note', { kind: 'note', text: 'Remember the SLA', fillColor: '#ffd6e0' }],
      ]),
    );
    // The element is drawn inside the group.
    const web = views.getNodes(VIEW).find((n) => !n.figure)!;
    expect(web.parentNodeIri).toBe(`${VIEW}/node/n-group`);
    // The note's line: no relationship.
    expect(views.getLinks(VIEW)).toEqual([
      expect.objectContaining({ connector: true, sourceNodeIri: NOTE, targetNodeIri: web.nodeIri }),
    ]);
  }, 60_000);

  it('a converted note recoloured gets a style of its own; deleted, its converter style goes with it', async () => {
    const app = await createApp();
    await app.openModel(fixture('archimate-figures.trig'), 'figures.trig');
    const views = app.components.viewManager;
    const store = app.components.store;
    const styleOf = () => store.getQuads(namedNode(NOTE), namedNode(NAMESPACES['arch-vis'] + 'style'), null).map((q) => q.object);
    const [converted] = styleOf();
    expect(converted?.termType).toBe('BlankNode');

    views.setFigureColours!(VIEW, NOTE, { lineColor: '#7a0019' });
    // Its own style, with the colour the converter gave it and the one given now; the blank one gone.
    expect(styleOf().map((s) => s.value)).toEqual([`${NOTE}/style`]);
    expect(views.getNode(VIEW, NOTE)?.figure).toMatchObject({ fillColor: '#ffd6e0', lineColor: '#7a0019' });
    expect(store.getQuads(converted as never, null, null)).toEqual([]);

    views.removeElementFromView(VIEW, NOTE);
    expect(store.getQuads(namedNode(`${NOTE}/style`), null, null)).toEqual([]);
    expect(views.getLinks(VIEW)).toEqual([]);
  }, 60_000);
});

describe('a colour, as a colour picker shows it', () => {
  it('is #rrggbb from #rgb, #rrggbb(aa), rgb() and rgba(); nothing from anything else', () => {
    expect(['#abc', '#AABBCC', '#aabbcc80', 'rgb(255, 214, 224)', 'rgba(255,247,179,255)', 'red', '', undefined].map(hexColour)).toEqual([
      '#aabbcc',
      '#aabbcc',
      '#aabbcc',
      '#ffd6e0',
      '#fff7b3',
      undefined,
      undefined,
      undefined,
    ]);
  });
});
