import { describe, it, expect } from 'vitest';
import { ViewHistory } from '../view-history.js';

describe('ViewHistory', () => {
  const views = new Set(['a', 'b', 'c', 'd']);
  const history = () => new ViewHistory((iri) => views.has(iri));

  it('goes back and forward along the views visited, as a browser does its pages', () => {
    const h = history();
    expect([h.peekBack(), h.peekForward()]).toEqual([undefined, undefined]);
    for (const v of ['a', 'b', 'c']) h.visit(v);
    expect(h.back()?.viewIri).toBe('b');
    expect(h.back()?.viewIri).toBe('a');
    expect(h.back()).toBeUndefined();
    expect(h.forward()?.viewIri).toBe('b');
    expect([h.peekBack()?.viewIri, h.peekForward()?.viewIri]).toEqual(['a', 'c']);
  });

  it('drops what was forward when another view is gone to, and records a view opened twice in a row once', () => {
    const h = history();
    for (const v of ['a', 'b', 'c']) h.visit(v);
    h.back();
    h.visit('d');
    expect(h.peekForward()).toBeUndefined();
    h.visit('d');
    expect(h.back()?.viewIri).toBe('b');
    expect(h.back()?.viewIri).toBe('a');
  });

  it('keeps where each view was left, for coming back to it', () => {
    const h = history();
    h.visit('a');
    h.leave({ viewbox: { x: 10, y: 20, width: 800, height: 600 }, selection: ['urn:e1'] });
    h.visit('b');
    expect(h.back()).toEqual({ viewIri: 'a', place: { viewbox: { x: 10, y: 20, width: 800, height: 600 }, selection: ['urn:e1'] } });
  });

  it('skips a view deleted since, and the view already open', () => {
    const shown = new Set(['a', 'b', 'c']);
    const h = new ViewHistory((iri) => shown.has(iri));
    for (const v of ['a', 'b', 'a', 'c']) h.visit(v);
    shown.delete('b');
    expect(h.back()?.viewIri).toBe('a');
    expect(h.back()).toBeUndefined(); // b is gone, and the first visit is a — the view already open
    expect(h.forward()?.viewIri).toBe('c');
  });

  it('keeps the latest visits, and forgets them all for another model', () => {
    const h = new ViewHistory(() => true, 3);
    for (const v of ['a', 'b', 'c', 'd']) h.visit(v);
    expect(h.back()?.viewIri).toBe('c');
    expect(h.back()?.viewIri).toBe('b');
    expect(h.back()).toBeUndefined();
    h.clear();
    expect([h.current, h.peekBack(), h.peekForward()]).toEqual([undefined, undefined, undefined]);
  });
});
