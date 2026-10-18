/**
 * RdfReplaceMenuProvider — choosing a connection's relationship type.
 *
 * ## Why this is a popup-menu provider and not a component
 *
 * bpmn-js does not build a widget for "change this element's type". It
 * contributes a *provider* to diagram-js's `popup-menu` service under the id
 * `bpmn-replace`, and the context pad opens that menu:
 *
 * ```js
 * if (!popupMenu.isEmpty(element, 'bpmn-replace')) {
 *   actions['replace'] = { ... popupMenu.open(element, 'bpmn-replace', position, { ... }) };
 * }
 * ```
 *
 * The gate is the interesting part: `isEmpty` asks the provider whether it has
 * anything to offer, so the pad entry appears exactly when there is a choice.
 * This provider returns **no entries at all** when the metamodel admits one type
 * or none for the pair, which makes that gate mean "the metamodel offers a
 * choice" without the pad having to know anything about metamodels.
 *
 * ## What an entry carries
 *
 * `PopupMenuEntry` in the published types is `{ label, className, group,
 * imageUrl, imageHtml, action }`, but `PopupMenuItem` also renders `title`,
 * `description` and `documentationRef`, and `PopupMenuComponent` searches over
 * `description`, `label` and `search`. So the ranking and the metamodel's
 * `reason` string go on `description` — a second, dimmer line under the label
 * that is *also* what the search box matches, which is the behaviour worth
 * having once a metamodel offers dozens of types. {@link RdfPopupMenuEntry}
 * declares those extra fields; see the note on it.
 *
 * The type currently in force is marked by a class on the entry
 * ({@link ENTRY_CLASS_CURRENT}) and named in the description and tooltip.
 * diagram-js's `active` flag is not used: it only applies to *header* entries,
 * and `PopupMenuItem` ignores it for ordinary ones.
 *
 * ## Order
 *
 * `PopupMenu._getEntries` builds a plain object and `Object.entries` preserves
 * insertion order for non-numeric keys, while `PopupMenuList` groups but does
 * not sort. Every entry is therefore put in a single group, in the order
 * `RelationshipManager.getValidRelationships` ranked them, and that is the order
 * the menu shows.
 */

import type { RelationshipTypeInfo } from '../../metamodel-manager/interfaces.js';
import type { RelationshipManager } from '../../model-manager/interfaces.js';

/** Provider id the menu is registered and opened under. */
export const RELATIONSHIP_REPLACE_MENU_ID = 'la-relationship-replace';

/** Class on every entry, so the menu can be styled and found in tests. */
export const ENTRY_CLASS = 'la-relationship-type';

/** Additional class on the entry for the type currently recorded in RDF. */
export const ENTRY_CLASS_CURRENT = 'la-relationship-type-current';

/**
 * Why a candidate ranks where it does, as a menu says it (`RelationshipPreference`):
 * "proposed first" for a language's scoped proposal order, "drawn in the metamodel"
 * for what its metamodel figures draw, "always permitted" for the fallbacks, and
 * "only by derivation" where the tables permit it no other way. A relationship the
 * tables simply permit needs no note.
 */
export function preferenceNotes(candidate: RelationshipTypeInfo): string[] {
  const notes: string[] = [];
  if (candidate.preference === 'first') notes.push('proposed first');
  else if (candidate.preference === 'drawn') notes.push('drawn in the metamodel');
  else if (candidate.preference === 'fallback') notes.push('always permitted');
  if (candidate.direct === false) notes.push('only by derivation');
  return notes;
}

/** The single group the entries live in — one flat, rank-ordered list. */
export const ENTRY_GROUP = 'relationship-type';

/**
 * What the canvas knows about the connection the menu was opened on.
 *
 * The provider resolves candidates itself (from the *types* of the two ends, so
 * the ranking is the same one the rules used), which is why the element types
 * rather than a candidate list are what it is handed.
 */
export interface RelationshipReplaceContext {
  /** diagram-js id of the connection. */
  connectionId: string;
  sourceTypeIri: string;
  targetTypeIri: string;
  /** The type currently recorded in RDF. */
  currentTypeIri: string;
}

/**
 * Resolves the popup menu's target (a diagram-js connection) into the RDF facts
 * about it, or `undefined` when the target is not a typed connection.
 */
export type RelationshipReplaceContextResolver = (
  target: unknown,
) => RelationshipReplaceContext | undefined;

/** Applies the pick. The provider never mutates the model itself. */
export type RelationshipRetypeRequest = (connectionId: string, typeIri: string) => void;

/**
 * A popup menu entry, including the fields the component renders but
 * `PopupMenuProvider.ts` omits from `PopupMenuEntry`.
 *
 * Declared here rather than imported because diagram-js's own type is narrower
 * than its own component: `PopupMenuItem` reads `title`, `description` and
 * `documentationRef`, and `PopupMenuComponent` reads `search` and `rank`.
 * `rank` is deliberately absent — a negative rank hides an entry until searched
 * for, which would silently drop candidates.
 */
export interface RdfPopupMenuEntry {
  /** Primary line: the relationship type's label. */
  label: string;
  className: string;
  group?: string;
  /** Tooltip on the whole row. */
  title?: string;
  /** Secondary line, also matched by the search box. */
  description?: string;
  /** Extra text the search box matches. */
  search?: string;
  action: (event: unknown, entry?: unknown) => void;
}

/** The map `getPopupMenuEntries` returns. */
export type RdfPopupMenuEntries = Record<string, RdfPopupMenuEntry>;

/**
 * Entry key for a relationship type.
 *
 * The key becomes the entry's `data-id` in the DOM, so it has to be stable and
 * selector-safe; an IRI is neither.
 */
export function relationshipEntryId(typeIri: string): string {
  const slug = typeIri.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `replace-${slug || 'unknown'}`;
}

/**
 * Offers one entry per relationship type the metamodel allows for a
 * connection's pair, best-ranked first.
 */
export class RdfReplaceMenuProvider {
  private relationshipManager: RelationshipManager;
  private resolve: RelationshipReplaceContextResolver;
  private retype: RelationshipRetypeRequest;

  constructor(
    relationshipManager: RelationshipManager,
    resolve: RelationshipReplaceContextResolver,
    retype: RelationshipRetypeRequest,
  ) {
    this.relationshipManager = relationshipManager;
    this.resolve = resolve;
    this.retype = retype;
  }

  /**
   * The entries for `target`, or an empty map when there is nothing to choose.
   *
   * An empty map is what makes `PopupMenu.isEmpty(target, id)` true, and
   * therefore what keeps the context pad's `replace` entry away from a
   * connection whose pair admits a single type.
   */
  getPopupMenuEntries(target: unknown): RdfPopupMenuEntries {
    const context = this.resolve(target);
    if (!context) return {};

    const candidates = this.candidates(context);
    if (candidates.length < 2) return {};

    const entries: RdfPopupMenuEntries = {};
    for (const candidate of candidates) {
      entries[relationshipEntryId(candidate.iri)] = this.entry(context, candidate);
    }
    return entries;
  }

  /** The ranked types the metamodel allows for the connection's pair. */
  private candidates(context: RelationshipReplaceContext): RelationshipTypeInfo[] {
    return this.relationshipManager.getValidRelationships(
      context.sourceTypeIri,
      context.targetTypeIri,
    );
  }

  private entry(
    context: RelationshipReplaceContext,
    candidate: RelationshipTypeInfo,
  ): RdfPopupMenuEntry {
    const current = candidate.iri === context.currentTypeIri;

    // Why the candidate ranks where it does, in words — the order is the ranking's.
    const notes = preferenceNotes(candidate);
    if (current) notes.push('current');

    const description = [notes.join(' · '), candidate.reason].filter(Boolean).join(' — ');

    return {
      label: candidate.label,
      className: current ? `${ENTRY_CLASS} ${ENTRY_CLASS_CURRENT}` : ENTRY_CLASS,
      group: ENTRY_GROUP,
      title: notes.length > 0 ? `${candidate.label} (${notes.join(', ')})` : candidate.label,
      description,
      search: candidate.reason ? `${candidate.label} ${candidate.reason}` : candidate.label,
      action: () => this.retype(context.connectionId, candidate.iri),
    };
  }
}
