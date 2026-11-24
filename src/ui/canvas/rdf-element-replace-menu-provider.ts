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
 * marked, and the search box matches names and groups. Types that share a name
 * (ArchiMate 3's Business Actor and ArchiMate 4's) show their IRIs on the
 * second line, and the header's "Show IRIs" shows every one — the same setting
 * as the property panel's type field (`show-iris.ts`); the search box then
 * matches IRIs too. Picking one hands the choice back to the canvas, which
 * checks the element's relationships against it and changes the type as one
 * undoable step; the provider never touches the model.
 */

import type { ElementGroup, ElementTypeInfo } from '@linked-archi/kernel/metamodel-manager/interfaces.js';
import { assetUrl } from '@linked-archi/kernel/metamodel-manager/bundled-assets.js';
import { iconHref } from './notation-shapes.js';
import type { RdfPopupMenuEntries, RdfPopupMenuEntry } from './rdf-replace-menu-provider.js';
import { rememberShowIris, sharedNames, showIris } from '../show-iris.js';

/** Provider id the menu is registered and opened under. */
export const ELEMENT_REPLACE_MENU_ID = 'la-element-replace';

/** Class on every entry, so the menu can be styled and found in tests. */
export const ELEMENT_TYPE_ENTRY_CLASS = 'la-element-type';

/** Additional class on the entry for the element's current type. */
export const ELEMENT_TYPE_ENTRY_CLASS_CURRENT = 'la-element-type-current';

/** Class of the header's "Show IRIs" switch. */
export const ELEMENT_TYPE_IRIS_CLASS = 'la-element-type-iris';

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
    /** Draws the open menu again (diagram-js `popupMenu.refresh`), after the switch. */
    private readonly refresh: () => void = () => {},
  ) {}

  /**
   * The "Show IRIs" switch — only when the menu has types to offer, because a
   * header entry alone makes a popup menu non-empty (and so would put the pad's
   * "Change type" button on an element with no other type).
   */
  getPopupMenuHeaderEntries(target: unknown): Array<{
    id: string;
    label: string;
    title: string;
    className: string;
    active: boolean;
    action: () => void;
  }> {
    if (Object.keys(this.getPopupMenuEntries(target)).length === 0) return [];
    const shown = showIris();
    return [
      {
        id: 'la-element-type-show-iris',
        label: 'Show IRIs',
        title: shown ? 'Hide the IRIs (types that share a name keep theirs)' : 'Show each type’s IRI under its name',
        className: ELEMENT_TYPE_IRIS_CLASS,
        active: shown,
        action: () => {
          rememberShowIris(!shown);
          this.refresh();
        },
      },
    ];
  }

  /** One entry per loaded element type, grouped as in the palette; empty when there is no other type to choose. */
  getPopupMenuEntries(target: unknown): RdfPopupMenuEntries {
    const context = this.resolve(target);
    if (!context) return {};
    const groups = this.groups().filter((g) => g.elements.length > 0);
    const types = groups.flatMap((g) => g.elements);
    if (!types.some((t) => t.iri !== context.currentTypeIri)) return {};

    const shared = sharedNames(new Map(types.map((t) => [t.iri, t.label])).values());
    const allIris = showIris();
    const entries: Record<string, GroupedEntry> = {};
    for (const group of groups) {
      for (const type of group.elements) {
        const key = elementTypeEntryId(type.iri);
        if (entries[key]) continue;
        entries[key] = this.entry(context, group, type, allIris || shared.has(type.label.toLowerCase()));
      }
    }
    return entries as unknown as RdfPopupMenuEntries;
  }

  private entry(context: ElementReplaceContext, group: ElementGroup, type: ElementTypeInfo, withIri: boolean): GroupedEntry {
    const current = type.iri === context.currentTypeIri;
    const imageUrl = iconHref(type.iconUrl, assetUrl) ?? undefined;
    const category = group.category || 'Other';
    // The second line: the IRI when shown — whole, as the line does not wrap — else
    // "current type" for the type in force, which its label also marks (✓).
    const description = withIri ? type.iri : current ? 'current type' : '';
    return {
      label: type.label,
      className: current ? `${ELEMENT_TYPE_ENTRY_CLASS} ${ELEMENT_TYPE_ENTRY_CLASS_CURRENT}` : ELEMENT_TYPE_ENTRY_CLASS,
      group: { id: category, name: category },
      title: current ? `${type.label} — the current type` : (type.definition ?? type.label),
      ...(description ? { description } : {}),
      // Names and groups: typing a type's name should find that type, not every definition mentioning it.
      search: `${type.label} ${category}`,
      ...(imageUrl ? { imageUrl } : {}),
      action: () => {
        if (!current) this.retype(context.shapeId, type.iri);
      },
    };
  }
}
