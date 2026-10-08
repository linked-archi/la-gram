/**
 * The ArchiMate badge glyphs as the canvas draws them (`arch-vis:iconSymbol`):
 * transparent wherever the published picture of the same element shows the
 * element's colour, so the badge looks like the picture's on any fill.
 *
 * The picture (`arch:prefVisNotation`) and the glyph are paired through the
 * notation data, not by file name. The picture's badge marks each part
 * `look="background"` (painted in the element colour), `look="border"` (the
 * line grey) or `look="allInOne"` (stroked, and filled with either). A few
 * pictures were drawn by hand without these marks (value stream; in 3.2 also the
 * business function, event, service and interaction, the application process
 * and service); they are not compared.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser, Store } from 'n3';
import { buildVisualNotations } from '../notation.js';
import { resolveIconUri } from '../bundled-assets.js';

const read = (path: string) => readFileSync(join(process.cwd(), 'assets', path), 'utf8');

/** The drawn parts of an SVG, in document order, without what `<defs>` holds (masks). */
function parts(svg: string): Array<{ look?: string; fill?: string; mask?: string }> {
  const drawn = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  return [...drawn.matchAll(/<(?:path|polygon|polyline|rect|circle|ellipse|line)\b([^>]*)>/g)].map(([, attrs]) => ({
    look: /\blook="(\w+)"/.exec(attrs!)?.[1],
    fill: /\bfill="([^"]*)"/.exec(attrs!)?.[1]?.toLowerCase(),
    mask: /\bmask="([^"]*)"/.exec(attrs!)?.[1],
  }));
}

/** The badge nested in a picture, or undefined when the picture has none. */
function badgeOf(picture: string): string | undefined {
  const start = picture.indexOf('<svg', 5);
  return start < 0 ? undefined : picture.slice(start, picture.indexOf('</svg>', start));
}

describe.each([
  ['ArchiMate 4.0', 'archimate4/archimate4-notation.ttl'],
  ['ArchiMate 3.2', 'archimate3/archimate3.2-notation.ttl'],
])('%s badge glyphs', (_language, notationPath) => {
  const notations = [...buildVisualNotations(new Store(new Parser().parse(read(notationPath))))!.notations.values()];
  const paired = notations.flatMap((notation) => {
    const picturePath = notation.prefVisNotation && resolveIconUri(notation.prefVisNotation);
    const glyphPath = notation.style?.iconSymbol && resolveIconUri(notation.style.iconSymbol);
    const badge = picturePath ? badgeOf(read(picturePath)) : undefined;
    return badge?.includes('look="') && glyphPath ? [{ concept: notation.conceptIri.split('#')[1]!, badge, glyph: read(glyphPath) }] : [];
  });

  it('pair a picture badge with a glyph for most elements', () => {
    expect(paired.length).toBeGreaterThan(30);
  });

  it('are transparent where the picture shows the element colour, and drawn where it shows a line', () => {
    for (const { concept, badge, glyph } of paired) {
      const want = parts(badge);
      const got = parts(glyph);
      expect(got.length, concept).toBe(want.length);
      want.forEach((part, i) => {
        const elementColoured = part.look === 'background' || (part.look === 'allInOne' && part.fill !== '#333333');
        if (elementColoured) expect(got[i]!.fill, `${concept} part ${i}`).toBe('none');
        // A line is filled as the picture fills it (the grey, or none for a stroke).
        else if (part.look === 'border') expect(got[i]!.fill, `${concept} part ${i}`).toBe(part.fill);
      });
    }
  });

  it('mask a line where a transparent part drawn after it would have hidden some of it', () => {
    const masked = paired.filter(({ glyph }) => parts(glyph).some((part) => part.mask));
    // The application component's small boxes cross its body, the collaboration's
    // second circle crosses the first, and the artifact's fold crosses its page.
    expect(new Set(masked.map(({ glyph }) => glyph)).size).toBeGreaterThanOrEqual(3);
    for (const { glyph } of masked) {
      for (const part of parts(glyph).filter((p) => p.mask)) {
        const id = /url\(#([^)]+)\)/.exec(part.mask!)![1];
        expect(glyph).toContain(`<mask id="${id}"`);
      }
    }
  });
});
