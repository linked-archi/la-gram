// @vitest-environment jsdom
/**
 * The loader while something large opens (Req 11.13): on the page before the work starts, saying what is opening;
 * gone after it, done or failed; one for loaders asked for together.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BusyIndicator } from '../busy.js';

afterEach(() => {
  document.body.innerHTML = '';
});

const overlay = () => document.querySelector<HTMLElement>('.la-busy');

describe('BusyIndicator', () => {
  it('is on the page, saying what opens, before the work starts — a frame later — and gone after it', async () => {
    const busy = new BusyIndicator();
    const seen: Array<string | null | undefined> = [];
    const result = await busy.while('Opening shop.trig…', () => {
      seen.push(overlay()?.querySelector('.la-busy-text')?.textContent);
      return 42;
    });
    expect(result).toBe(42);
    expect(seen).toEqual(['Opening shop.trig…']);
    expect(overlay()).toBeNull();
    expect(busy.shown).toBe(false);
  });

  it('read out as a status, its spinner hidden from assistive technology', async () => {
    const busy = new BusyIndicator();
    await busy.while('Opening…', () => {
      expect(overlay()!.getAttribute('role')).toBe('status');
      expect(overlay()!.querySelector('.la-busy-spinner')!.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('gone when the work fails too', async () => {
    const busy = new BusyIndicator();
    await expect(
      busy.while('Opening…', () => {
        throw new Error('not RDF');
      }),
    ).rejects.toThrow('not RDF');
    expect(overlay()).toBeNull();
  });

  it('one loader for several at once, saying the latest, gone when the last is done', async () => {
    const busy = new BusyIndicator();
    await busy.while('Opening shop.trig…', async () => {
      await busy.while('Opening Landscape (3,000 shapes)…', () => {
        expect(document.querySelectorAll('.la-busy')).toHaveLength(1);
        expect(overlay()!.textContent).toBe('Opening Landscape (3,000 shapes)…');
      });
      expect(overlay()).not.toBeNull();
    });
    expect(overlay()).toBeNull();
  });
});
