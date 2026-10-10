// @vitest-environment jsdom
/**
 * Relationship ends drawn from the published marker symbols
 * (`arch-vis:decorSymbol`), not from built-in geometry.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser, Store } from 'n3';
import { buildDecorationSymbols } from '../../../metamodel-manager/notation.js';
import { parseDecorationSymbol, symbolMarkerDefinition } from '../notation-shapes.js';
import { createRenderHarness, paletteWith } from './render-harness.js';

// Tests run from the project root; under jsdom `import.meta.url` is not a file URL.
const read = (path: string) => readFileSync(join(process.cwd(), 'assets', path), 'utf8');
const MARKERS = 'https://meta.linked.archi/core-vis/markers/';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the published decoration symbols', () => {
  it('are read from the core-vis vocabulary: every decoration but NoDecoration', () => {
    const store = new Store(new Parser().parse(read('core/core-vis-onto.ttl')));
    const symbols = buildDecorationSymbols(store);
    expect(Object.keys(symbols).sort()).toEqual([
      'CircleDot',
      'ClosedArrowhead',
      'FilledDiamond',
      'HalfArrowhead',
      'HollowArrowhead',
      'HollowDiamond',
      'OpenArrowhead',
    ]);
    expect(symbols.CircleDot).toBe(`${MARKERS}circle-dot.svg`);
  });

  it('parse into plain shapes, with anything else dropped', () => {
    const symbol = parseDecorationSymbol(read('core-vis/markers/circle-dot.svg'))!;
    expect(symbol.viewBox).toEqual({ x: 0, y: 0, width: 12, height: 12 });
    expect([symbol.width, symbol.height]).toEqual([12, 12]);
    expect(symbol.content.map((e) => e.localName)).toEqual(['circle']);
    // A filled dot, as ArchiMate's assignment draws it.
    expect(symbol.content[0].getAttribute('fill')).toBe('currentColor');

    const hostile = parseDecorationSymbol(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><script>alert(1)</script>' +
        '<path d="M1 1L11 6" onload="alert(2)" fill="url(#x)" stroke="currentColor"/>' +
        '<foreignObject><div>x</div></foreignObject></svg>',
    )!;
    expect(hostile.content.map((e) => e.localName)).toEqual(['path']);
    expect(hostile.content[0]!.getAttributeNames().sort()).toEqual(['d', 'stroke']);
    expect(parseDecorationSymbol('not svg')).toBeNull();
  });

  it('become markers anchored at the middle of the right edge, mirrored at a source end, in the line colour', () => {
    const symbol = parseDecorationSymbol(read('core-vis/markers/filled-diamond.svg'))!;
    const target = symbolMarkerDefinition(symbol, 'FilledDiamond', 'target', '#000000').element;
    expect(['viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'color'].map((a) => target.getAttribute(a))).toEqual([
      '0 0 12 12',
      '12',
      '6',
      '12',
      '12',
      'auto',
      '#000000',
    ]);
    expect(symbolMarkerDefinition(symbol, 'FilledDiamond', 'source', '#333333').element.getAttribute('orient')).toBe('auto-start-reverse');
  });
});

describe('the canvas', () => {
  it('draws an end with built-in geometry until the symbol arrives, then with the published symbol', async () => {
    const svgText = read('core-vis/markers/circle-dot.svg');
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, text: async () => svgText };
      }),
    );
    const harness = createRenderHarness({
      ...paletteWith(
        [],
        [
          {
            iri: 'https://example.org/lang#Assignment',
            label: 'Assignment',
            domainTypes: [],
            rangeTypes: [],
            relationshipStyle: { lineStyle: 'SolidLine', sourceDecor: 'CircleDot', targetDecor: 'NoDecoration' },
          },
        ],
      ),
      decorationSymbols: {
        CircleDot: { sourceUri: `${MARKERS}circle-dot.svg`, bundledPath: 'core-vis/markers/circle-dot.svg', url: 'core-vis/markers/circle-dot.svg' },
      },
    });
    const line = harness.drawConnection({ iri: 'https://example.org/m/r1', typeIri: 'https://example.org/lang#Assignment', kind: 'relationship' });
    const marker = () => harness.markerDefs()!.querySelector(`marker#${line.getAttribute('marker-start')!.slice(5, -1)}`)!;
    expect(marker().getAttribute('data-source')).toBe('built-in');

    await vi.waitFor(() => expect(marker().getAttribute('data-source')).toBe('published'));
    // The same marker id, now drawn from the published dot.
    expect([...marker().children].map((e) => e.localName)).toEqual(['circle']);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatch(/core-vis\/markers\/circle-dot\.svg$/);
    // Later connections use it straight away.
    const second = harness.drawConnection({ iri: 'https://example.org/m/r2', typeIri: 'https://example.org/lang#Assignment', kind: 'relationship' });
    expect(second.getAttribute('marker-start')).toBe(line.getAttribute('marker-start'));
    expect(fetched).toHaveLength(1);
    harness.destroy();
  });

  it('keeps the built-in geometry when the symbol cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })));
    const harness = createRenderHarness({
      ...paletteWith(
        [],
        [
          {
            iri: 'https://example.org/lang#Serving',
            label: 'Serving',
            domainTypes: [],
            rangeTypes: [],
            relationshipStyle: { lineStyle: 'SolidLine', sourceDecor: 'NoDecoration', targetDecor: 'OpenArrowhead' },
          },
        ],
      ),
      decorationSymbols: { OpenArrowhead: { sourceUri: `${MARKERS}open-arrowhead.svg`, url: `${MARKERS}open-arrowhead.svg` } },
    });
    harness.drawConnection({ iri: 'https://example.org/m/r1', typeIri: 'https://example.org/lang#Serving', kind: 'relationship' });
    await new Promise((r) => setTimeout(r, 20));
    expect(harness.markerDefs()!.querySelector('marker')!.getAttribute('data-source')).toBe('built-in');
    harness.destroy();
  });
});
