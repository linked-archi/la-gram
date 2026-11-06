/**
 * Test harness for the RDF renderer.
 *
 * Boots a real diagram-js `Diagram` with the RDF renderer module, draws shapes
 * and connections through it, and hands back the produced DOM. Nothing is
 * stubbed except the SVG *layout* APIs jsdom lacks — the renderer, diagram-js's
 * graphics factory and the element registry are all the real thing, so what
 * these tests assert on is what a browser would be handed.
 */

import Diagram from 'diagram-js';
import type {
  PaletteDefinition,
  ElementTypeInfo,
  RelationshipTypeInfo,
} from '../../../metamodel-manager/interfaces.js';
import { NotationStyleRegistry } from '../notation-styles.js';
import { rdfRendererModule, type RdfBusinessObject, type RenderOptions } from '../rdf-renderer.js';
import { installJsdomSvgSupport } from '../../__tests__/jsdom-svg-support.js';

export interface RenderHarness {
  container: HTMLElement;
  /** Draw a shape and return the renderer's `<g class="la-shape">`. */
  drawShape(businessObject: RdfBusinessObject, bounds?: Partial<DOMRectLike>): SVGElement;
  /** Draw a connection (along `waypoints`, else 0,0 → 200,0) and return the renderer's `<polyline class="la-connection">`. */
  drawConnection(businessObject: RdfBusinessObject, waypoints?: Array<{ x: number; y: number }>): SVGElement;
  /** The `<defs>` holding notation markers, when any have been installed. */
  markerDefs(): Element | null;
  destroy(): void;
}

interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_BOUNDS: DOMRectLike = { x: 0, y: 0, width: 120, height: 55 };

/** A palette holding exactly the element and relationship types given. */
export function paletteWith(
  elements: ElementTypeInfo[],
  relationshipTypes: RelationshipTypeInfo[] = [],
): PaletteDefinition {
  return {
    elementGroups: [{ category: 'Test', elements }],
    relationshipTypes,
  };
}

/** Boot a diagram with the renderer wired in, the given notation styles and render options. */
export function createRenderHarness(palette: PaletteDefinition, renderOptions?: RenderOptions): RenderHarness {
  installJsdomSvgSupport();

  const container = document.createElement('div');
  document.body.appendChild(container);

  const notationStyles = new NotationStyleRegistry(palette);
  const diagram = new Diagram({
    canvas: { container },
    modules: [rdfRendererModule(notationStyles, renderOptions)] as never[],
  });

  const get = <T>(name: string): T => (diagram as unknown as { get(n: string): T }).get(name);
  const canvas = get<any>('canvas');
  const elementFactory = get<any>('elementFactory');

  const root = elementFactory.createRoot({ id: 'root' });
  canvas.setRootElement(root);

  let counter = 0;

  return {
    container,

    drawShape(businessObject, bounds) {
      const merged = { ...DEFAULT_BOUNDS, ...bounds };
      const shape = canvas.addShape(
        elementFactory.createShape({
          id: `shape-${counter++}`,
          ...merged,
          businessObject,
        }),
        root,
      );
      const gfx = get<any>('elementRegistry').getGraphics(shape) as SVGElement;
      const drawn = gfx.querySelector('.la-shape');
      if (!drawn) throw new Error('renderer produced no .la-shape group');
      return drawn as SVGElement;
    },

    drawConnection(businessObject, waypoints) {
      const connection = canvas.addConnection(
        elementFactory.createConnection({
          id: `connection-${counter++}`,
          waypoints: waypoints ?? [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
          businessObject,
        }),
        root,
      );
      const gfx = get<any>('elementRegistry').getGraphics(connection) as SVGElement;
      const drawn = gfx.querySelector('.la-connection');
      if (!drawn) throw new Error('renderer produced no .la-connection');
      return drawn as SVGElement;
    },

    markerDefs() {
      return container.querySelector('defs.la-notation-markers');
    },

    destroy() {
      diagram.destroy();
      container.remove();
    },
  };
}
