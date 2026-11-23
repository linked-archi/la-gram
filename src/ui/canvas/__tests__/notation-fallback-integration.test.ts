// @vitest-environment jsdom

/**
 * The notation fallback end to end: the Basic asset set loaded through its
 * manifest, a palette generated from it, and the real renderer drawing from that
 * palette. Basic's two notation sets describe `arch:Element`,
 * `arch:QualifiedRelationship` and Basic's two relationship classes, so its
 * element classes, and any class no set describes, are styled through the
 * superclass walk (Req 2.16) — on the canvas as in the palette — while its
 * relationships keep their own descriptors.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { N3TtlParser } from '../../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { NAMESPACES } from '../../../rdf-engine/namespaces.js';
import { N3MetamodelLoader } from '../../../metamodel-manager/metamodel-loader.js';
import { SparqlPaletteGenerator } from '../../../metamodel-manager/palette-generator.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import {
  BASIC,
  BASIC_METAMODEL,
  RECTANGLE_ELEMENT_STYLE,
  RECTANGLE_SET,
  WORKSHOP_CONTEXT,
  basicAssetSource,
} from '../../../metamodel-manager/__tests__/basic-fixture.js';
import { RENDER_CLASSES } from '../rdf-renderer.js';
import { createRenderHarness, type RenderHarness } from './render-harness.js';

const EXTRA = 'https://example.org/extra#';

/**
 * A class under arch:Element that no taxonomy names, so it never becomes a
 * palette entry, and a relationship class no set describes.
 */
const UNLISTED_CLASS = `
  @prefix owl:  <${NAMESPACES.owl}> .
  @prefix rdf:  <${NAMESPACES.rdf}> .
  @prefix rdfs: <${NAMESPACES.rdfs}> .
  @prefix arch: <${NAMESPACES.arch}> .
  <https://example.org/extra> rdf:type owl:Ontology .
  <${EXTRA}Unlisted> rdf:type owl:Class ; rdfs:subClassOf arch:Element .
  <${EXTRA}Linking> rdf:type owl:Class ; rdfs:subClassOf arch:QualifiedRelationship .
`;

let generator: SparqlPaletteGenerator;
let palette: PaletteDefinition;

beforeAll(async () => {
  const store = new OxigraphRdfStore();
  const loader = new N3MetamodelLoader(new N3TtlParser(), store, basicAssetSource());
  const loaded = await loader.loadMetamodelByIri(BASIC_METAMODEL);
  await loader.loadMetamodel(UNLISTED_CLASS);
  generator = new SparqlPaletteGenerator(store);
  // What mount-ui passes: the loaded metamodels' default sets in load order.
  palette = generator.generatePalette(undefined, {
    defaultNotationSetIris: loaded.notationSetIri ? [loaded.notationSetIri] : [],
  });
}, 60_000);

let harness: RenderHarness | undefined;

afterEach(() => {
  harness?.destroy();
  harness = undefined;
});

function draw(p: PaletteDefinition = palette): RenderHarness {
  harness = createRenderHarness(p);
  return harness;
}

describe('Basic notation through the superclass walk → canvas', () => {
  it('uses the default set when no context is chosen', () => {
    expect(palette.notationSetIri).toBe(RECTANGLE_SET);
  });

  it("draws basic:Node with the rectangle set's arch:Element style", () => {
    const shape = draw().drawShape({ iri: 'urn:test:node-1', typeIri: `${BASIC}Node`, label: 'Node 1' });

    expect(shape.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    const body = shape.querySelector(`.${RENDER_CLASSES.body}`)!;
    expect(body.tagName).toBe('rect');
    expect(body.getAttribute('fill')).toBe(RECTANGLE_ELEMENT_STYLE.fillColor);
    expect(body.getAttribute('stroke')).toBe(RECTANGLE_ELEMENT_STYLE.lineColor);
    expect(shape.querySelector(`.${RENDER_CLASSES.badge}`)).toBeNull();
  });

  it('draws a class no taxonomy names the same way, through the notation index; the palette lists it under "Other"', () => {
    expect(palette.elementGroups.find((g) => g.category === 'Other')?.elements.map((e) => e.iri)).toContain(`${EXTRA}Unlisted`);
    expect(palette.notationIndex?.[`${EXTRA}Unlisted`]?.source).toBe('active-superclass');

    const shape = draw().drawShape({ iri: 'urn:test:unlisted-1', typeIri: `${EXTRA}Unlisted`, label: 'Unlisted' });
    const body = shape.querySelector(`.${RENDER_CLASSES.body}`)!;
    expect(body.tagName).toBe('rect');
    expect(body.getAttribute('fill')).toBe(RECTANGLE_ELEMENT_STYLE.fillColor);
    expect(body.getAttribute('stroke')).toBe(RECTANGLE_ELEMENT_STYLE.lineColor);
  });

  it('draws basic:Node as a circle when the workshop context is chosen', () => {
    const bubble = generator.generatePalette(undefined, { presentationContextIri: WORKSHOP_CONTEXT });
    const shape = draw(bubble).drawShape({ iri: 'urn:test:node-2', typeIri: `${BASIC}Node`, label: 'Node 2' });
    expect(shape.querySelector(`.${RENDER_CLASSES.body}`)!.tagName).toBe('circle');
  });

  it('draws basic:Association as a plain black line, by class or by direct predicate', () => {
    const h = draw();
    for (const typeIri of [`${BASIC}Association`, `${BASIC}association`]) {
      const line = h.drawConnection({ iri: `urn:test:${typeIri.slice(BASIC.length)}`, typeIri });
      expect(line.getAttribute('stroke'), typeIri).toBe('#000000');
      expect(line.getAttribute('data-line-style'), typeIri).toBe('SolidLine');
      expect(line.getAttribute('data-source-decor'), typeIri).toBe('NoDecoration');
      expect(line.getAttribute('data-target-decor'), typeIri).toBe('NoDecoration');
      expect(line.getAttribute('marker-start'), typeIri).toBeNull();
      expect(line.getAttribute('marker-end'), typeIri).toBeNull();
    }
  });

  it('draws basic:Aggregation black, with a hollow diamond at the source', () => {
    const line = draw().drawConnection({ iri: 'urn:test:aggregation-1', typeIri: `${BASIC}Aggregation` });
    expect(line.getAttribute('stroke')).toBe('#000000');
    expect(line.getAttribute('data-line-style')).toBe('SolidLine');
    expect(line.getAttribute('data-source-decor')).toBe('HollowDiamond');
    expect(line.getAttribute('marker-start')).toContain('HollowDiamond');
    expect(line.getAttribute('data-target-decor')).toBe('NoDecoration');
    expect(line.getAttribute('marker-end')).toBeNull();
  });

  it("draws a relationship class no set describes with the arch:QualifiedRelationship descriptor's arrowhead", () => {
    expect(palette.notationIndex?.[`${EXTRA}Linking`]).toMatchObject({
      source: 'active-superclass',
      matchedClassIri: `${NAMESPACES.arch}QualifiedRelationship`,
    });
    const line = draw().drawConnection({ iri: 'urn:test:linking-1', typeIri: `${EXTRA}Linking` });
    expect(line.getAttribute('stroke')).toBe('#000000');
    expect(line.getAttribute('data-source-decor')).toBe('NoDecoration');
    expect(line.getAttribute('data-target-decor')).toBe('OpenArrowhead');
    expect(line.getAttribute('marker-end')).toContain('OpenArrowhead');
  });

  it('draws a relationship type with no descriptor anywhere as a plain solid black line', () => {
    const line = draw().drawConnection({ iri: 'urn:test:rel-unknown', typeIri: `${EXTRA}unknownRelation` });
    expect(line.getAttribute('stroke')).toBe('#000000');
    expect(line.getAttribute('data-line-style')).toBe('SolidLine');
    expect(line.getAttribute('data-target-decor')).toBe('NoDecoration');
    expect(line.getAttribute('marker-end')).toBeNull();
  });
});
