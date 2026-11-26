// @vitest-environment jsdom
/**
 * The panes' frame (Req 24, SV-1, SV-2): one pane, or two with a divider — side by side or one above the other; the
 * divider dragged, moved with the keys, reset by a double-click, never leaving a pane under 15%; what is remembered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  KEY_STEP,
  MIN_SHARE,
  SplitLayout,
  clampShare,
  rememberSyncSelection,
  rememberedOrientation,
  rememberedShare,
  syncSelectionOn,
} from '../split-view.js';

const remembered = new Map<string, string>();
beforeEach(() => {
  remembered.clear();
  // Node's own localStorage stub shadows jsdom's: remembered choices go here.
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => remembered.get(key) ?? null,
    setItem: (key: string, value: string) => void remembered.set(key, value),
    removeItem: (key: string) => void remembered.delete(key),
  });
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const pane = (name: string): HTMLElement => {
  const element = document.createElement('div');
  element.className = 'la-pane';
  element.dataset.name = name;
  return element;
};
const divider = (layout: SplitLayout) => layout.element.querySelector<HTMLElement>('.la-pane-divider');
const names = (layout: SplitLayout) =>
  Array.from(layout.element.children).map((c) => (c as HTMLElement).dataset.name ?? c.className);

/** A frame 1000 × 600 px at the page's corner. */
const sized = (layout: SplitLayout): SplitLayout => {
  layout.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  document.body.append(layout.element);
  return layout;
};
const pointer = (type: string, at: { x: number; y: number }) =>
  Object.assign(new MouseEvent(type, { clientX: at.x, clientY: at.y, button: 0, bubbles: true }), { pointerId: 1 });

describe('SplitLayout', () => {
  it('holds one pane, filling the frame, with no divider', () => {
    const first = pane('first');
    const layout = new SplitLayout(first);
    expect(layout.split).toBeUndefined();
    expect(names(layout)).toEqual(['first']);
    expect(layout.element.dataset.split).toBe('none');
    expect(first.style.flex).toBe('1 1 auto');
  });

  it('splits side by side at first: the panes either side of a divider, sharing the room equally', () => {
    const [first, second] = [pane('first'), pane('second')];
    const layout = new SplitLayout(first);
    layout.open(second);
    expect(layout.split).toBe('side-by-side');
    expect(layout.element.dataset.split).toBe('side-by-side');
    expect(names(layout)).toEqual(['first', 'la-pane-divider', 'second']);
    expect(first.style.flex).toBe('0 0 calc(50% - 3px)');
    expect(second.style.flex).toBe('1 1 0%');
    const bar = divider(layout)!;
    expect(bar.getAttribute('role')).toBe('separator');
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.tabIndex).toBe(0);
  });

  it('turns the panes one above the other, and back, remembering the orientation', () => {
    const layout = new SplitLayout(pane('first'));
    layout.open(pane('second'), 'stacked');
    expect(layout.split).toBe('stacked');
    expect(divider(layout)!.getAttribute('aria-orientation')).toBe('horizontal');
    expect(rememberedOrientation()).toBe('stacked');
    // Split again later: one above the other, as last chosen.
    expect(new SplitLayout(pane('x')).split).toBeUndefined();
    const again = new SplitLayout(pane('a'));
    again.open(pane('b'));
    expect(again.split).toBe('stacked');
    again.setOrientation('side-by-side');
    expect(rememberedOrientation()).toBe('side-by-side');
  });

  it('closes either pane, the other filling the frame', () => {
    const [first, second] = [pane('first'), pane('second')];
    const layout = new SplitLayout(first);
    layout.open(second);
    layout.close(first);
    expect(names(layout)).toEqual(['second']);
    expect(layout.split).toBeUndefined();
    expect(second.style.flex).toBe('1 1 auto');
    expect(first.isConnected).toBe(false);
    // The last pane stays.
    layout.close(second);
    expect(names(layout)).toEqual(['second']);
  });

  it('shares the room where the divider is dragged — never under 15% a pane — and remembers it when let go', () => {
    const [first, second] = [pane('first'), pane('second')];
    const layout = sized(new SplitLayout(first));
    layout.open(second, 'side-by-side');
    const bar = divider(layout)!;
    bar.dispatchEvent(pointer('pointerdown', { x: 500, y: 10 }));
    bar.dispatchEvent(pointer('pointermove', { x: 300, y: 10 }));
    expect(layout.firstShare).toBeCloseTo(0.3);
    expect(layout.element.classList.contains('la-panes-resizing')).toBe(true);
    expect(remembered.has('la-gram:split-share')).toBe(false);
    bar.dispatchEvent(pointer('pointermove', { x: 20, y: 10 }));
    expect(layout.firstShare).toBe(MIN_SHARE);
    bar.dispatchEvent(pointer('pointerup', { x: 20, y: 10 }));
    expect(layout.element.classList.contains('la-panes-resizing')).toBe(false);
    expect(rememberedShare()).toBe(MIN_SHARE);
    // One above the other: by the height.
    layout.setOrientation('stacked');
    bar.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    bar.dispatchEvent(pointer('pointermove', { x: 900, y: 420 }));
    bar.dispatchEvent(pointer('pointerup', { x: 900, y: 420 }));
    expect(layout.firstShare).toBeCloseTo(0.7);
    expect(first.style.flex).toBe('0 0 calc(70% - 3px)');
  });

  it('moves the divider by 5% with the arrow keys, and shares the room equally on a double-click', () => {
    const layout = new SplitLayout(pane('first'));
    layout.open(pane('second'));
    const bar = divider(layout)!;
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(layout.firstShare).toBeCloseTo(0.5 + KEY_STEP);
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(layout.firstShare).toBeCloseTo(0.5 - KEY_STEP);
    expect(rememberedShare()).toBeCloseTo(0.45);
    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(layout.firstShare).toBe(0.5);
    expect(rememberedShare()).toBe(0.5);
  });

  it('keeps a share within 15% and 85%, and reads a remembered one so', () => {
    expect(clampShare(0)).toBe(MIN_SHARE);
    expect(clampShare(1)).toBe(1 - MIN_SHARE);
    remembered.set('la-gram:split-share', '0.95');
    expect(rememberedShare()).toBe(1 - MIN_SHARE);
    remembered.set('la-gram:split-share', 'nonsense');
    expect(rememberedShare()).toBe(0.5);
  });
});

describe('Sync selection, remembered', () => {
  it('is on until switched off', () => {
    expect(syncSelectionOn()).toBe(true);
    rememberSyncSelection(false);
    expect(syncSelectionOn()).toBe(false);
    rememberSyncSelection(true);
    expect(syncSelectionOn()).toBe(true);
  });
});
