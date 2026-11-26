// @vitest-environment jsdom
/**
 * Plain-text search for the RDF panel (Req 23.6): the matches in a text, and as ranges over the text nodes of
 * highlighted markup — a match may run across several tokens.
 */

import { describe, it, expect } from 'vitest';
import { findMatches, rangesOf, textIndexOf } from '../text-search.js';

describe('findMatches', () => {
  it('every place, in order, case ignored; with matchCase, only as typed', () => {
    const text = 'ex:Shop a am4:BusinessActor ; skos:prefLabel "shop"@en .';
    expect(findMatches(text, 'shop')).toEqual([
      [3, 7],
      [46, 50],
    ]);
    expect(findMatches(text, 'shop', true)).toEqual([[46, 50]]);
    expect(findMatches(text, '')).toEqual([]);
  });

  it('matches that would overlap are counted once each, in turn', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it('a text that lower-cases to another length is searched as it is, so offsets stay the text’s', () => {
    const text = 'İstanbul office';
    expect(findMatches(text, 'office')).toEqual([[9, 15]]);
  });
});

describe('rangesOf', () => {
  it('a match across tokens becomes one range spanning them', () => {
    const pre = document.createElement('pre');
    pre.innerHTML = '<span class="rdf-pname">ex:</span><span class="rdf-pname">Shop</span> <span class="rdf-keyword">a</span> <span>am4:Business</span>Actor';
    const index = textIndexOf(pre);
    expect(index.text).toBe('ex:Shop a am4:BusinessActor');
    const ranges = rangesOf(index, findMatches(index.text, 'x:sh'));
    expect(ranges.map((r) => r.toString())).toEqual(['x:Sh']);
    expect(ranges[0].startContainer.parentElement?.textContent).toBe('ex:');
    expect(ranges[0].endContainer.parentElement?.textContent).toBe('Shop');
    // A match ending where a token ends stays in that token.
    const [end] = rangesOf(index, findMatches(index.text, 'business'));
    expect(end.toString()).toBe('Business');
    expect(end.endContainer.parentElement?.textContent).toBe('am4:Business');
  });
});
