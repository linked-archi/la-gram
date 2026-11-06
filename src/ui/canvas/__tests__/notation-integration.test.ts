// @vitest-environment jsdom

/**
 * End-to-end proof that the whole notation chain works.
 *
 * Loads the real bundled ArchiMate 4.0 metamodel off disk, generates a palette
 * from it, hands that palette to a real `DiagramCanvas`, adds a `BusinessActor`,
 * and asserts on the SVG diagram-js actually produced. Nothing is stubbed except
 * the SVG layout APIs jsdom lacks and the two model managers (which write RDF,
 * not pixels).
 *
 * If the notation graph, the icon resolution, the style registry, the renderer
 * or the diagram-js wiring were broken, this test would fail.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { N3TtlParser } from '../../../rdf-engine/ttl-parser.js';
import { OxigraphRdfStore } from '../../../rdf-engine/rdf-store.js';
import { N3MetamodelLoader } from '../../../metamodel-manager/metamodel-loader.js';
import { SparqlPaletteGenerator } from '../../../metamodel-manager/palette-generator.js';
import type { PaletteDefinition } from '../../../metamodel-manager/interfaces.js';
import type { ElementManager, RelationshipManager } from '../../../model-manager/interfaces.js';
import { EventBus } from '../../event-bus.js';
import { DiagramCanvas } from '../diagram-canvas.js';
import { RENDER_CLASSES } from '../rdf-renderer.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

installJsdomSvgSupport();

const { namedNode } = DataFactory;

const BUSINESS_ACTOR = 'https://meta.linked.archi/archimate4/onto#BusinessActor';
const SERVING = 'https://meta.linked.archi/archimate4/onto#Serving';

let palette: PaletteDefinition;

beforeAll(async () => {
  const store = new OxigraphRdfStore();
  const loader = new N3MetamodelLoader(new N3TtlParser(), store);
  const loaded = await loader.loadBundledMetamodel();
  palette = new SparqlPaletteGenerator(store).generatePalette(loaded.metamodelIri);
}, 60_000);

let canvas: DiagramCanvas | undefined;

afterEach(() => {
  canvas?.destroy();
  canvas = undefined;
  document.body.innerHTML = '';
});

function mountCanvas(): { canvas: DiagramCanvas; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const elementManager: ElementManager = {
    createElement: vi.fn(
      () => namedNode('https://example.org/model/actor-1') as unknown as NamedNode,
    ),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn().mockReturnValue([]),
    createRelationship: vi.fn(
      () => namedNode('https://example.org/model/rel-1') as unknown as NamedNode,
    ),
    deleteRelationship: vi.fn(),
  };

  const instance = new DiagramCanvas({
    container,
    eventBus: new EventBus(),
    elementManager,
    relationshipManager,
    paletteDefinition: palette,
    modelIri: 'https://example.org/model/test',
  });
  canvas = instance;
  return { canvas: instance, container };
}

/** The generated palette entry for a type IRI, across all groups. */
function paletteEntryFor(typeIri: string) {
  return palette.elementGroups.flatMap((group) => group.elements).find((e) => e.iri === typeIri);
}

describe('bundled ArchiMate 4.0 → palette → canvas', () => {
  it('the generated palette carries the published BusinessActor notation', () => {
    const actor = paletteEntryFor(BUSINESS_ACTOR);

    expect(actor).toBeDefined();
    expect(actor!.style?.shapeType).toBe('Rectangle');
    expect(actor!.style?.fillColor).toBe('#FFFFB5');
    expect(actor!.renderingMode).toBe('ShapeWithBadge');
    expect(actor!.style?.iconPlacement).toBe('TopRight');
    // The glyph resolved to a path inside this bundle, not to a network URL.
    expect(actor!.iconSymbol?.bundledPath).toBe('archimate4/icons/glyphs/actor.svg');
  });

  it('renders a BusinessActor with its notation fill, shape and bundled badge', () => {
    const { canvas: instance, container } = mountCanvas();

    instance.addElement('https://example.org/model/actor-1', BUSINESS_ACTOR, {
      x: 40,
      y: 60,
      width: 120,
      height: 55,
    });

    const shape = container.querySelector(
      '[data-element-iri="https://example.org/model/actor-1"]',
    ) as SVGElement | null;
    expect(shape).not.toBeNull();
    expect(shape!.getAttribute('data-rendering-mode')).toBe('ShapeWithBadge');

    // fillColor #FFFFB5 and shapeType Rectangle, straight from the notation graph.
    const body = shape!.querySelector(`.${RENDER_CLASSES.body}`)!;
    expect(body.tagName).toBe('rect');
    expect(body.getAttribute('fill')).toBe('#FFFFB5');
    expect(body.getAttribute('stroke')).toBe('#000000');

    // The badge points at the bundled glyph.
    const badge = shape!.querySelector(`.${RENDER_CLASSES.badge}`)!;
    expect(badge.getAttribute('href')).toContain('assets/archimate4/icons/glyphs/actor.svg');
    expect(badge.getAttribute('data-icon-placement')).toBe('TopRight');

    // And the label is the published prefLabel.
    expect(shape!.querySelector(`.${RENDER_CLASSES.label}`)!.textContent).toContain('Business');
  });

  it('every ArchiMate 4.0 element type renders without throwing', () => {
    const { canvas: instance, container } = mountCanvas();
    const types = palette.elementGroups
      .flatMap((group) => group.elements)
      .filter((element) => !element.isAbstract);

    expect(types.length).toBeGreaterThan(30);

    for (const [index, type] of types.entries()) {
      instance.addElement(`https://example.org/model/e${index}`, type.iri, {
        x: 0,
        y: index * 70,
        width: type.style?.defaultWidth ?? 120,
        height: type.style?.defaultHeight ?? 55,
      });
    }

    const drawn = container.querySelectorAll(`.${RENDER_CLASSES.shape}`);
    expect(drawn).toHaveLength(types.length);
    // The published notation puts a badge on all of them but those its pictures
    // tell apart by their shape alone.
    const byShape = [...drawn]
      .filter((shape) => !shape.querySelector(`.${RENDER_CLASSES.badge}`))
      .map((shape) => shape.getAttribute('data-type-iri')!.split('#')[1])
      .sort();
    expect(byShape).toEqual(['BusinessObject', 'DataObject', 'Deliverable', 'Grouping', 'Meaning', 'Product', 'Value', 'WorkPackage']);
    for (const shape of drawn) {
      if (!shape.querySelector(`.${RENDER_CLASSES.badge}`)) expect(shape.getAttribute('data-rendering-mode')).toBe('ShapeOnly');
    }
  });

  it('renders a Serving relationship with the published line style and arrowhead', () => {
    const { canvas: instance, container } = mountCanvas();

    instance.addElement('https://example.org/model/src', BUSINESS_ACTOR, {
      x: 0,
      y: 0,
      width: 120,
      height: 55,
    });
    instance.addElement('https://example.org/model/tgt', BUSINESS_ACTOR, {
      x: 300,
      y: 0,
      width: 120,
      height: 55,
    });
    instance.addRelationship(
      'https://example.org/model/src',
      'https://example.org/model/tgt',
      SERVING,
    );

    const line = container.querySelector(`.${RENDER_CLASSES.connection}`)!;
    expect(line).not.toBeNull();
    // Serving: solid line, open arrowhead at the target.
    expect(line.getAttribute('data-line-style')).toBe('SolidLine');
    expect(line.getAttribute('stroke-dasharray')).toBeNull();
    expect(line.getAttribute('marker-end')).toContain('OpenArrowhead');
  });

  it('the canvas can draw every concrete type the bundle publishes', () => {
    // What the old assertion on the in-canvas palette's entry count was really
    // proxying for: each concrete type resolves to a notation and paints. Asserted
    // against the drawn shape now that the sidebar owns the entry list.
    const { canvas: instance, container } = mountCanvas();
    const concrete = palette.elementGroups
      .flatMap((group) => group.elements)
      .filter((element) => !element.isAbstract);
    expect(concrete.length).toBeGreaterThan(0);

    concrete.forEach((element, index) => {
      const iri = `https://example.org/model/e${index}`;
      instance.addElement(iri, element.iri, { x: 0, y: index * 10, width: 120, height: 55 });
      const drawn = container.querySelector(`[data-element-iri="${iri}"]`);
      expect(drawn, `no shape drawn for ${element.iri}`).not.toBeNull();
      expect(drawn!.querySelector(`.${RENDER_CLASSES.body}`)).not.toBeNull();
    });

    expect(instance.getElements().size).toBe(concrete.length);
  });
});
