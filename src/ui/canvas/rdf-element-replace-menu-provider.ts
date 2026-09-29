/**
 * RdfElementReplaceMenuProvider — choosing an element's type.
 *
 * The element counterpart of `rdf-replace-menu-provider.ts` (a relationship's
 * type): a diagram-js popup-menu provider, opened from the context pad's
 * "Change type" entry, gated the same way — the pad asks
 * `!popupMenu.isEmpty(element, ELEMENT_REPLACE_MENU_ID)`.
 *
 * It offers every element type of the loaded metamodels, as the palette groups
 * them (under its current "Group by"), each with its icon; the type in force is
 * marked, and the search box matches names and groups. Picking one
 * hands the choice back to the canvas, which checks the element's relationships
 * against it and changes the type as one undoable step; the provider never
 * touches the model.
 */

import type { ElementGroup, ElementTypeInfo } from '../../metamodel-manager/interfaces.js';
import { assetUrl } from '../../metamodel-manager/bundled-assets.js';
import { iconHref } from './notation-shapes.js';
import type { RdfPopupMenuEntries, RdfPopupMenuEntry } from './rdf-replace-menu-provider.js';

/** Provider id the menu is registered and opened under. */
export const ELEMENT_REPLACE_MENU_ID = 'la-element-replace';

/** Class on every entry, so the menu can be styled and found in tests. */
export const ELEMENT_TYPE_ENTRY_CLASS = 'la-element-type';

/** Additional class on the entry for the element's current type. */
export const ELEMENT_TYPE_ENTRY_CLASS_CURRENT = 'la-element-type-current';

/** What the canvas knows about the shape the menu was opened on. */
export interface ElementReplaceContext {
  /** diagram-js id of the shape. */
  shapeId: string;
  /** The type currently recorded in RDF. */
  currentTypeIri: string;
}

/** Resolves the menu's target (a diagram-js shape) into the RDF facts about it. */
export type ElementReplaceContextResolver = (target: unknown) => ElementReplaceContext | undefined;

/** Applies the pick. */
export type ElementRetypeRequest = (shapeId: string, typeIri: string) => void;

/** A grouped entry: diagram-js renders `group.name` as a heading. */
type GroupedEntry = Omit<RdfPopupMenuEntry, 'group'> & { group: { id: string; name: string }; imageUrl?: string };

/** Entry key for an element type — stable and selector-safe, as an IRI is not. */
export function elementTypeEntryId(typeIri: string): string {
  const slug = typeIri.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `retype-${slug || 'unknown'}`;
}

export class RdfElementReplaceMenuProvider {
  constructor(
    private readonly resolve: ElementReplaceContextResolver,
    private readonly groups: () => readonly ElementGroup[],
    private readonly retype: ElementRetypeRequest,
  ) {}

  /** One entry per loaded element type, grouped as in the palette; empty when there is no other type to choose. */
  getPopupMenuEntries(target: unknown): RdfPopupMenuEntries {
    const context = this.resolve(target);
    if (!context) return {};
    const groups = this.groups().filter((g) => g.elements.length > 0);
    const types = groups.flatMap((g) => g.elements);
    if (!types.some((t) => t.iri !== context.currentTypeIri)) return {};

    const entries: Record<string, GroupedEntry> = {};
    for (const group of groups) {
      for (const type of group.elements) {
        const key = elementTypeEntryId(type.iri);
        if (entries[key]) continue;
        entries[key] = this.entry(context, group, type);
      }
    }
    return entries as unknown as RdfPopupMenuEntries;
  }

  private entry(context: ElementReplaceContext, group: ElementGroup, type: ElementTypeInfo): GroupedEntry {
    const current = type.iri === context.currentTypeIri;
    const imageUrl = iconHref(type.iconUrl, assetUrl) ?? undefined;
    const category = group.category || 'Other';
    return {
      label: type.label,
      className: current ? `${ELEMENT_TYPE_ENTRY_CLASS} ${ELEMENT_TYPE_ENTRY_CLASS_CURRENT}` : ELEMENT_TYPE_ENTRY_CLASS,
      group: { id: category, name: category },
      title: current ? `${type.label} — the current type` : (type.definition ?? type.label),
      ...(current ? { description: 'current type' } : {}),
      // Names and groups: typing a type's name should find that type, not every definition mentioning it.
      search: `${type.label} ${category}`,
      ...(imageUrl ? { imageUrl } : {}),
      action: () => {
        if (!current) this.retype(context.shapeId, type.iri);
      },
    };
  }
}
