/**
 * The four ways to change what is drawn above what (DO-2; `.agents/tasks/drawing-order/`), as the right-click menu,
 * the canvas toolbar's *Order* menu and the keys name them.
 */

import type { DrawingOrderChange } from '@linked-archi/kernel/model-manager';

export const DRAWING_ORDER_ACTIONS: ReadonlyArray<{ change: DrawingOrderChange; label: string; keys: string; title: string }> = [
  { change: 'front', label: 'Bring to front', keys: 'Mod+Shift+]', title: 'Bring to front — above everything beside it' },
  { change: 'forward', label: 'Bring forward', keys: 'Mod+]', title: 'Bring forward — above the next shape it overlaps' },
  { change: 'backward', label: 'Send backward', keys: 'Mod+[', title: 'Send backward — below the next shape it overlaps' },
  { change: 'back', label: 'Send to back', keys: 'Mod+Shift+[', title: 'Send to back — below everything beside it' },
];

/** What is said when nothing changed (DO-2): already there, or nothing overlapping that way. */
export function unchangedMessage(change: DrawingOrderChange, selected: number): string {
  if (selected === 0) return 'Select an element or a figure first.';
  const one = selected === 1;
  switch (change) {
    case 'front':
      return 'Already in front.';
    case 'back':
      return 'Already at the back.';
    case 'forward':
      return one ? 'Nothing it overlaps is drawn above it.' : 'Nothing they overlap is drawn above them.';
    case 'backward':
      return one ? 'Nothing it overlaps is drawn below it.' : 'Nothing they overlap is drawn below them.';
  }
}
