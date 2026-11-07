import { describe, it, expect } from 'vitest';
import {
  appearanceObject,
  appearanceValue,
  colourAlpha,
  cssColour,
  fontStyleOf,
  hexColour,
  imageUri,
  lookOf,
  parseColour,
  sameAppearance,
  withAlpha,
} from '../appearance.js';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

const VIS = NAMESPACES['arch-vis'];

describe('a colour’s alpha, read as meant', () => {
  it('is CSS’s 0–1, a percentage up to 100 — as converters write the exchange format’s — and out of 255 beyond', () => {
    expect(['rgba(10,20,30,0.5)', 'rgba(10,20,30,50)', 'rgba(10,20,30,100)', 'rgba(10,20,30,255)', 'rgba(10,20,30,50%)', 'rgb(10,20,30)'].map(colourAlpha)).toEqual([
      0.5, 0.5, 1, 1, 0.5, 1,
    ]);
    expect(parseColour('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 0.502 });
  });

  it('is written #rrggbb when opaque, #rrggbbaa otherwise; a colour la-gram cannot read is kept', () => {
    expect(cssColour('rgba(255,247,179,100)')).toBe('#fff7b3');
    expect(cssColour('rgba(255,247,179,50)')).toBe('#fff7b380');
    expect(cssColour('red')).toBe('red');
    expect(withAlpha('#336699', 1)).toBe('#336699');
    expect(withAlpha('#336699', 0)).toBe('#33669900');
    expect(hexColour('#33669980')).toBe('#336699');
  });
});

describe('an appearance’s values, as core-vis writes them', () => {
  it('enumerations as their members, sizes as positive integers, a font style as its known keywords in order', () => {
    expect(appearanceObject('textAlignment', 'left')).toEqual({ iri: VIS + 'AlignLeft' });
    expect(appearanceObject('textPosition', 'bottom')).toEqual({ iri: VIS + 'PositionBottom' });
    expect(appearanceObject('borderStyle', 'DashedLine')).toEqual({ iri: VIS + 'DashedLine' });
    expect(appearanceObject('gradient', 'left')).toEqual({ iri: VIS + 'GradientLeft' });
    // A line from a note's style and ends: core-vis's own members, as a relationship's notation says them.
    expect(appearanceObject('lineStyle', 'DottedLine')).toEqual({ iri: VIS + 'DottedLine' });
    expect(appearanceObject('targetDecor', 'ClosedArrowhead')).toEqual({ iri: VIS + 'ClosedArrowhead' });
    expect(appearanceObject('sourceDecor', 'Bogus' as never)).toBeUndefined();
    expect(appearanceObject('iconColor', '#1a237e')).toEqual({ string: '#1a237e' });
    expect(appearanceObject('lineWidth', 2.4)).toEqual({ integer: 2 });
    expect(appearanceObject('fontSize', 0)).toBeUndefined();
    expect(appearanceObject('fontStyle', 'Italic  BOLD plain')).toEqual({ string: 'bold italic' });
    expect(fontStyleOf('plain')).toBeUndefined();
  });

  it('are read back; what is not one of a key’s is not', () => {
    const iri = (value: string) => ({ termType: 'NamedNode', value });
    const literal = (value: string) => ({ termType: 'Literal', value });
    expect(appearanceValue('textAlignment', iri(VIS + 'AlignRight'))).toBe('right');
    expect(appearanceValue('textAlignment', iri(VIS + 'TopRight'))).toBeUndefined();
    expect(appearanceValue('gradient', iri(VIS + 'GradientBottom'))).toBe('bottom');
    expect(appearanceValue('iconColor', literal('rgba(26,35,126,1)'))).toBe('#1a237e');
    expect(appearanceValue('lineWidth', literal('3'))).toBe(3);
    expect(appearanceValue('fontSize', literal('-1'))).toBeUndefined();
    expect(appearanceValue('fillColor', literal('rgba(181,201,255,100)'))).toBe('#b5c9ff');
    expect(sameAppearance({ fillColor: '#ffffff' }, { fillColor: '#ffffff' })).toBe(true);
    expect(sameAppearance({ fillColor: '#ffffff' }, undefined)).toBe(false);
  });

  it('where a line’s text sits, and a node’s picture and where: core-vis 0.7’s members, a picture as an xsd:anyURI', () => {
    expect(appearanceObject('labelAnchor', 'source')).toEqual({ iri: VIS + 'AnchorSource' });
    expect(appearanceValue('labelAnchor', { termType: 'NamedNode', value: VIS + 'AnchorTarget' })).toBe('target');
    expect(appearanceObject('imagePosition', 'BottomRight')).toEqual({ iri: VIS + 'BottomRight' });
    expect(appearanceObject('imagePosition', 'Fill')).toEqual({ iri: VIS + 'Fill' });
    expect(appearanceValue('imagePosition', { termType: 'NamedNode', value: VIS + 'MiddleLeft' })).toBe('MiddleLeft');
    expect(appearanceObject('image', ' https://example.org/logo.png ')).toEqual({ uri: 'https://example.org/logo.png' });
    expect(appearanceValue('image', { termType: 'Literal', value: 'https://example.org/logo.png' })).toBe('https://example.org/logo.png');
    // An IRI object is not a picture's address as core-vis writes it.
    expect(appearanceValue('image', { termType: 'NamedNode', value: 'https://example.org/logo.png' })).toBeUndefined();
  });

  it('a picture only from an http(s) URL or a data: URI of an image — nothing else is written or drawn', () => {
    expect(imageUri('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(imageUri('data:image/svg+xml,%3Csvg%3E')).toBe('data:image/svg+xml,%3Csvg%3E');
    expect(imageUri('http://example.org/a.gif')).toBe('http://example.org/a.gif');
    for (const refused of ['javascript:alert(1)', 'file:///etc/passwd', 'logo.png', 'data:text/html,<b>', '', '  ']) {
      expect(imageUri(refused)).toBeUndefined();
    }
    expect(appearanceObject('image', 'javascript:alert(1)')).toBeUndefined();
  });

  it('a placement’s own icon, a picture as the image is; a notation’s glyph is no look to take over', () => {
    expect(appearanceObject('iconSymbol', 'https://example.org/logo.png')).toEqual({ uri: 'https://example.org/logo.png' });
    expect(appearanceObject('iconSymbol', 'file:///logo.png')).toBeUndefined();
    expect(appearanceValue('iconSymbol', { termType: 'Literal', value: 'data:image/png;base64,iVBORw0KGgo=' })).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(lookOf({ iconSymbol: 'https://meta.linked.archi/archimate4/icons/glyphs/actor.svg', fillColor: '#ffffb5' })).toEqual({ fillColor: '#ffffb5' });
  });
});
