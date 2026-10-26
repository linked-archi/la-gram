/**
 * RdfContextMenuProvider — the canvas's right-click menu.
 *
 * Right-clicking an element or a relationship selects it and opens this menu
 * at the pointer; right-clicking the empty canvas opens it for the open view
 * (and clears the selection): a diagram-js popup menu (so it looks and behaves like the
 * other canvas menus — keyboard, closing on a click elsewhere) whose entries
 * are sections of actions. The provider only lays the entries out; which
 * actions apply to what, and what they do, is the canvas's
 * ({@link ContextMenuActions}).
 */

import type { RdfPopupMenuEntries } from './rdf-replace-menu-provider.js';

/** Provider id the menu is registered and opened under — also the popup's CSS class. */
export const CONTEXT_MENU_ID = 'la-context-menu';

/** Class on every entry, so the menu can be styled and found in tests. */
export const CONTEXT_MENU_ENTRY_CLASS = 'la-context-entry';

/** One action in the menu. */
export interface ContextMenuAction {
  /** Stable id: the entry's key, and its `data-id` in the DOM. */
  id: string;
  label: string;
  /** Section the action sits in; sections are shown in the order they first occur. */
  section: 'edit' | 'relate' | 'view' | 'show' | 'copy' | 'delete';
  /** A keyboard shortcut for the same action, shown in the tooltip. */
  shortcut?: string;
  run: () => void;
}

/** The actions for what was right-clicked; none for anything without a menu. */
export type ContextMenuActions = (target: unknown) => ContextMenuAction[];

export class RdfContextMenuProvider {
  constructor(private readonly actionsFor: ContextMenuActions) {}

  getPopupMenuEntries(target: unknown): RdfPopupMenuEntries {
    const entries: RdfPopupMenuEntries = {};
    for (const action of this.actionsFor(target)) {
      entries[action.id] = {
        label: action.label,
        className: `${CONTEXT_MENU_ENTRY_CLASS} la-context-${action.id}`,
        group: action.section,
        title: action.shortcut ? `${action.label} (${action.shortcut})` : action.label,
        action: () => action.run(),
      };
    }
    return entries;
  }
}
