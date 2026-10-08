/**
 * The ArchiMate notation data against the published pictures of the same
 * elements (`arch:prefVisNotation`): what the canvas builds from the data —
 * fill colour, badge or not, rounded corners or not — is what the picture shows.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser, Store } from 'n3';
import { buildVisualNotations, type VisualNotation } from '../notation.js';
import { resolveIconUri } from '../bundled-assets.js';

const read = (path: string) => readFileSync(join(process.cwd(), 'assets', path), 'utf8');

/** `#rrggbb` or `rgb(r, g, b)` as three channels. */
function channels(colour: string): [number, number, number] {
  const rgb = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(colour);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour.trim())!;
  return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
}

/** The picture without the badge nested in it. */
function outline(picture: string): string {
  const badge = picture.indexOf('<svg', 5);
  return badge < 0 ? picture : picture.slice(0, badge);
}

describe.each([
  ['ArchiMate 4.0', 'archimate4/archimate4-notation.ttl'],
  ['ArchiMate 3.2', 'archimate3/archimate3.2-notation.ttl'],
])('%s notation against its pictures', (_language, notationPath) => {
  const notations = [...buildVisualNotations(new Store(new Parser().parse(read(notationPath))))!.notations.values()];
  const pictured = notations.flatMap((notation: VisualNotation) => {
    const path = notation.prefVisNotation && resolveIconUri(notation.prefVisNotation);
    return path && notation.style ? [{ concept: notation.conceptIri.split('#')[1]!, style: notation.style, picture: read(path) }] : [];
  });

  it('has a picture for every element', () => {
    expect(pictured.length).toBe(notations.filter((n) => n.style).length);
  });

  it('fills each element with its picture\'s colour', () => {
    for (const { concept, style, picture } of pictured) {
      const drawn = /<(?:rect|path|polygon|polyline|ellipse|circle)\b[^>]*\bfill=['"]([^'"]+)['"]/.exec(outline(picture))![1]!;
      const want = channels(drawn);
      const got = channels(style.fillColor!);
      // The generated 3.2 business pictures use #FFFFAF where the data says #FFFFB5.
      const furthest = Math.max(...want.map((c, i) => Math.abs(c - got[i]!)));
      expect(furthest, `${concept}: ${style.fillColor} against the picture's ${drawn}`).toBeLessThanOrEqual(6);
    }
  });

  it('draws a badge exactly where the picture has one', () => {
    for (const { concept, style, picture } of pictured) {
      const badged = picture.indexOf('<svg', 5) > 0;
      const mode = style.renderingMode === 'ShapeOnly' || !style.iconSymbol ? 'ShapeOnly' : 'ShapeWithBadge';
      expect(mode, concept).toBe(badged ? 'ShapeWithBadge' : 'ShapeOnly');
    }
  });

  it('rounds the corners exactly where the picture does', () => {
    for (const { concept, style, picture } of pictured) {
      const body = /<(\w+)\b[^>]*>/.exec(outline(picture).replace(/<svg\b[^>]*>/, ''))!;
      if (body[1] !== 'rect') continue;
      const rounded = /\brx=['"]([\d.]+)/.exec(body[0]);
      if (rounded) expect(style.shapeType, concept).toBe('RoundedRectangle');
      else expect(['Rectangle', 'BandedRectangle', 'DoubleBandedRectangle', 'TabbedRectangle'], concept).toContain(style.shapeType);
    }
  });
});
