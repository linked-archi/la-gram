/**
 * RdfAppendMenuProvider — choosing *what* to append to an element.
 *
 * ## The design decision this file is
 *
 * bpmn-js's `ContextPadProvider` hardcodes a handful of append entries per
 * source type — `append.end-event`, `append.gateway`, `append.append-task` and
 * so on — each one a pad button that creates a *known* type. That works because
 * BPMN's vocabulary is small, fixed, and compiled in.
 *
 * It does not work here. ArchiMate 4.0 publishes 42 concrete element types, and
 * the metamodel is data: a different notation set means a different vocabulary,
 * so any list written into the source is wrong for somebody. Nor is there a
 * defensible "top few": the metamodel ranks *relationship* types for a pair, not
 * element types, so picking three targets to promote onto the pad would be this
 * file's invention rather than the model's.
 *
 * So the pad gets **one** `append` entry, and it opens a popup menu of the
 * element types the metamodel actually permits a relationship to. That is also
 * what bpmn-js itself converged on for the same problem: its `append-anything`
 * feature contributes a `bpmn-append` popup-menu provider and reduces the pad to
 * a single "Append element" button.
 *
 * What was rejected, and why:
 *
 * - **A fixed list of append types.** Wrong by construction once the metamodel is
 *   data. Would also have to be maintained per notation set.
 * - **Append entries for the top-ranked few.** No honest ranking of element types
 *   exists to draw from, and the pad would silently hide the other 39 types with
 *   no way in.
 * - **An inline type-ahead on the pad.** More UI to build and test than the
 *   popup menu diagram-js already ships, which brings search for free above five
 *   entries.
 *
 * ## Both gestures live on the menu entry
 *
 * `PopupMenuItem` renders every entry `draggable` and forwards its drag as
 * `action.dragstart` (see `PopupMenu.trigger`, which dispatches
 * `handler[action]`). So a single menu entry can carry both halves of bpmn-js's
 * `appendAction`:
 *
 * - `click` → `autoPlace.append(source, shape)`: the element is positioned
 *   automatically beside its source and connected.
 * - `dragstart` → `create.start(event, shape, { source })`: the drag continues
 *   out of the menu and onto the canvas, and the drop point is the position.
 *
 * The type choice therefore costs one click before the drag, and nothing after.
 *
 * ## Which relationship
 *
 * An append is two model changes: the element, and a relationship to it. The
 * relationship types offered are exactly those the metamodel permits for the
 * pair — its relationship shapes where it has them (`relationship-table.ts`),
 * its domain/range hints where not — so whatever is created is valid.
 *
 * Several are usually permitted, if only because ArchiMate allows Association
 * between any two elements. So the entry decides without asking only when the
 * choice is clear: one *specific* relationship (Association aside), or
 * Association alone. When several specific ones are permitted — Flow, Serving,
 * Triggering — a click opens a second menu listing them, best-ranked first and
 * Association last ({@link RdfAppendRelationshipMenuProvider}). A drag cannot
 * pause to ask, so it takes the best-ranked one; the type can be changed on the
 * connection afterwards.
 *
 * ## Two tabs: new elements, existing relationships
 *
 * The menu's header carries two tabs. **New element** is the above. **Existing
 * relationships** lists the relationships the element already has in the model
 * — to and from elements that are often not in the open view — so the related
 * element and the relationship can be brought onto the canvas in one click
 * (placed beside the source) or dragged to a spot. Nothing new is created in the
 * model: it is a placement, like dropping the element from the model tree.
 *
 * ## Emptiness is the gate
 *
 * Like {@link RdfReplaceMenuProvider}, this returns **no entries at all** — and
 * no tabs — when the metamodel permits no target and the element has no
 * relationship in the model. `PopupMenu.isEmpty(element, id)` is then true,
 * which is exactly what keeps the pad's `append` entry away — so the pad needs to
 * know nothing about metamodels.
 */

import type { RelationshipTypeInfo } from '@linked-archi/kernel/metamodel-manager/interfaces.js';
import { assetUrl } from '@linked-archi/kernel/metamodel-manager/bundled-assets.js';
import { iconHref } from './notation-shapes.js';
import type { AppendTarget } from './relationship-resolution.js';

/** Provider id the menu is registered and opened under. */
export const APPEND_TARGET_MENU_ID = 'la-append-target';

/** Provider id of the second step: which relationship to the chosen type. */
export const APPEND_RELATIONSHIP_MENU_ID = 'la-append-relationship';

/** Local names of ArchiMate's association, undirected and directed. */
const ASSOCIATIONS = new Set(['Association', 'DirectedAssociation']);

/**
 * A relationship type that holds between almost anything — ArchiMate's
 * Association, directed or not, and a generic relationship whose domain and
 * range name only core classes, which relates any two elements of its
 * metamodel (`generic`).
 * They are always offered, so they do not make a choice ambiguous; the
 * relationship manager ranks them last for the same reason.
 */
export function isGenericRelationship(relationship: RelationshipTypeInfo): boolean {
  return (
    relationship.generic === true ||
    relationship.label === 'Association' ||
    ASSOCIATIONS.has(relationship.iri.slice(relationship.iri.search(/[^#/]*$/)))
  );
}

/**
 * The relationship an append creates without asking, or `undefined` when the
 * user has to choose: several specific relationships are permitted.
 */
export function unambiguousRelationship(relationships: RelationshipTypeInfo[]): RelationshipTypeInfo | undefined {
  const specific = relationships.filter((r) => !isGenericRelationship(r));
  if (specific.length > 1) return undefined;
  return specific[0] ?? relationships[0];
}

/** The icon of a palette type or relationship, as a URL an `<img>` can load. */
function iconOf(iconUrl: string | undefined): string | undefined {
  return iconHref(iconUrl, assetUrl) ?? undefined;
}

/** Class on every entry, so the menu can be styled and found in tests. */
export const APPEND_ENTRY_CLASS = 'la-append-target';

/** Group entries land in when the palette publishes no category for the type. */
export const APPEND_DEFAULT_GROUP = 'append-target';

/**
 * What the canvas knows about the shape the menu was opened on.
 *
 * The source's *type* is what decides the offer, and its IRI is what the
 * relationship will start from.
 */
export interface AppendMenuContext {
  sourceIri: string;
  sourceTypeIri: string;
  /** The diagram-js shape, which `create` and `autoPlace` both need. */
  diagramElement: unknown;
}

/** Resolves the menu's target (a diagram-js shape) into the RDF facts about it. */
export type AppendMenuContextResolver = (target: unknown) => AppendMenuContext | undefined;

/** The element types that may be appended to a source type, ranked. */
export type AppendTargetResolver = (sourceTypeIri: string) => AppendTarget[];

/** A relationship the source element already has in the model, and its other end. */
export interface ExistingRelationship {
  relationshipIri: string;
  /** The relationship type's label (`Serving`). */
  typeLabel: string;
  /** From the source (`out`) or to it (`in`). */
  direction: 'out' | 'in';
  otherIri: string;
  otherLabel: string;
  /** The other end's type label (`Application Component`). */
  otherTypeLabel?: string;
  /** The other end's type icon, as the palette publishes it. */
  otherIconUrl?: string;
  /** Whether the other end is placed in the open view. */
  otherInView: boolean;
  /** Whether the relationship is drawn in the open view. */
  drawn: boolean;
}

/** The relationships a source element has in the model. */
export type ExistingRelationshipResolver = (context: AppendMenuContext) => ExistingRelationship[];

/** The append menu's tabs. */
export type AppendTab = 'new' | 'existing';

/** Header group the tabs are rendered in (styled as tabs in `index.html`). */
export const APPEND_TABS_GROUP = 'la-append-tabs';

/** How the menu performs the append. The provider never mutates the model. */
export interface AppendSupport {
  /**
   * Click: place the new element automatically and connect it — with
   * `relationshipTypeIri` when given, else the best-ranked permitted one.
   */
  place(context: AppendMenuContext, typeIri: string, relationshipTypeIri?: string): void;
  /** Drag: hand a new shape to diagram-js's `create` tool, sourced at `context`. */
  drag(context: AppendMenuContext, typeIri: string, event: unknown): void;
  /** Several specific relationships are permitted: ask which (the second menu). */
  chooseRelationship(context: AppendMenuContext, target: AppendTarget, event: unknown): void;
  /** Existing relationships tab, click: bring the other end into the view beside the source, and the relationship. */
  showExisting?(context: AppendMenuContext, relationship: ExistingRelationship): void;
  /** Existing relationships tab, drag: place the other end where it is dropped. */
  dragExisting?(context: AppendMenuContext, relationship: ExistingRelationship, event: unknown): void;
  /** Re-render the open menu (after a tab switch). */
  refresh?(): void;
}

/**
 * A popup menu entry, including the fields `PopupMenuItem` renders but
 * diagram-js's own `PopupMenuEntry` type omits. Same reasoning as
 * {@link import('./rdf-replace-menu-provider.js').RdfPopupMenuEntry} — see the
 * note there.
 */
export interface AppendMenuEntry {
  /** Primary line: the element type's label. */
  label: string;
  className: string;
  /** A group with a `name` is rendered under that heading. */
  group?: { id: string; name: string };
  imageUrl?: string;
  /** Tooltip on the whole row. */
  title?: string;
  /** Secondary line, also matched by the search box. */
  description?: string;
  /** Extra text the search box matches. */
  search?: string;
  action: {
    click: (event: unknown, entry?: unknown) => void;
    dragstart: (event: unknown, entry?: unknown) => void;
  };
}

/** The map `getPopupMenuEntries` returns. */
export type AppendMenuEntries = Record<string, AppendMenuEntry>;

/**
 * Entry key for an appendable element type.
 *
 * Becomes the entry's `data-id` in the DOM, so it has to be stable and
 * selector-safe; an IRI is neither.
 */
export function appendEntryId(typeIri: string): string {
  const slug = typeIri.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `append-${slug || 'unknown'}`;
}

/**
 * Offers one entry per element type the metamodel permits a relationship to.
 */
export class RdfAppendMenuProvider {
  private resolve: AppendMenuContextResolver;
  private targets: AppendTargetResolver;
  private support: AppendSupport;
  private existing: ExistingRelationshipResolver;

  /** The open tab. */
  tab: AppendTab = 'new';

  constructor(
    resolve: AppendMenuContextResolver,
    targets: AppendTargetResolver,
    support: AppendSupport,
    existing: ExistingRelationshipResolver = () => [],
  ) {
    this.resolve = resolve;
    this.targets = targets;
    this.support = support;
    this.existing = existing;
  }

  /**
   * Choose the tab a fresh opening starts on: new elements, unless the metamodel
   * permits none and there are existing relationships to show.
   */
  startOn(target: unknown): void {
    const context = this.resolve(target);
    this.tab =
      context && this.targets(context.sourceTypeIri).length === 0 && this.existing(context).length > 0
        ? 'existing'
        : 'new';
  }

  /**
   * The two tabs, as header entries — only when the menu has anything to offer,
   * because a header entry alone makes a popup menu non-empty (and so would put
   * the pad's `append` button on an element that can reach nothing).
   */
  getPopupMenuHeaderEntries(target: unknown): Array<{
    id: string;
    label: string;
    title: string;
    className: string;
    group: string;
    active: boolean;
    action: () => void;
  }> {
    const context = this.resolve(target);
    if (!context) return [];
    const newCount = this.targets(context.sourceTypeIri).length;
    const existingCount = this.existing(context).length;
    if (newCount === 0 && existingCount === 0) return [];
    const tab = (id: AppendTab, label: string, title: string) => ({
      id: `la-append-tab-${id}`,
      label,
      title,
      className: `la-append-tab la-append-tab-${id}`,
      group: APPEND_TABS_GROUP,
      active: this.tab === id,
      action: () => {
        this.tab = id;
        this.support.refresh?.();
      },
    });
    return [
      tab('new', 'New element', 'Append a new element, connected to this one'),
      tab('existing', `Existing relationships (${existingCount})`, 'Show what this element is already related to in the model'),
    ];
  }

  /** What an empty tab says. */
  getEmptyPlaceholder(): string {
    return this.tab === 'existing'
      ? 'No relationships in the model yet.'
      : 'The metamodel permits no relationship from this element.';
  }

  /**
   * The entries for `target`, or an empty map when nothing may be appended.
   *
   * An empty map is what makes `PopupMenu.isEmpty(target, id)` true, and
   * therefore what keeps the context pad's `append` entry away from a shape
   * whose type can reach nothing.
   */
  getPopupMenuEntries(target: unknown): AppendMenuEntries {
    const context = this.resolve(target);
    if (!context) return {};
    if (this.tab === 'existing') return this.existingEntries(context);

    const entries: AppendMenuEntries = {};
    for (const appendTarget of this.targets(context.sourceTypeIri)) {
      entries[appendEntryId(appendTarget.type.iri)] = this.entry(context, appendTarget);
    }
    return entries;
  }

  /** The Existing relationships tab: not yet in the view first, then what is. */
  private existingEntries(context: AppendMenuContext): AppendMenuEntries {
    const rows = [...this.existing(context)].sort(
      (a, b) => Number(a.otherInView && a.drawn) - Number(b.otherInView && b.drawn) || a.otherLabel.localeCompare(b.otherLabel),
    );
    const entries: AppendMenuEntries = {};
    for (const row of rows) {
      const shown = row.otherInView && row.drawn;
      const arrow = row.direction === 'out' ? '→' : '←';
      const imageUrl = iconOf(row.otherIconUrl);
      entries[`existing-${appendEntryId(row.relationshipIri)}`] = {
        label: row.otherLabel,
        className: `${APPEND_ENTRY_CLASS} la-append-existing`,
        group: shown ? { id: 'in-view', name: 'In this view' } : { id: 'not-in-view', name: 'Not in this view' },
        ...(imageUrl ? { imageUrl } : {}),
        title: shown
          ? `Already shown — select it`
          : `${row.otherInView ? 'Draw' : 'Bring in'} ${row.otherLabel} ${arrow} ${row.typeLabel}`,
        description: `${arrow} ${row.typeLabel}${row.otherTypeLabel ? ` · ${row.otherTypeLabel}` : ''}`,
        search: `${row.otherLabel} ${row.typeLabel} ${row.otherTypeLabel ?? ''}`.trim(),
        action: {
          click: () => this.support.showExisting?.(context, row),
          dragstart: (event: unknown) => this.support.dragExisting?.(context, row, event),
        },
      };
    }
    return entries;
  }

  private entry(context: AppendMenuContext, target: AppendTarget): AppendMenuEntry {
    const { type, relationships } = target;
    const chosen = unambiguousRelationship(relationships);
    const specific = relationships.filter((r) => !isGenericRelationship(r));

    // Naming the relationship that *will* be created is the point: an append is
    // two model changes, and the second one is not otherwise visible until the
    // line is drawn. When it is not decided yet, say what the choice will be.
    const description = chosen
      ? `via ${chosen.label}`
      : `choose: ${specific.map((r) => r.label).join(' / ')}`;
    const imageUrl = iconOf(type.iconUrl);

    return {
      label: type.label,
      className: APPEND_ENTRY_CLASS,
      // The palette's own category, so the menu is bucketed the way the palette
      // the user is looking at is bucketed. `PopupMenuList` groups but does not
      // sort, so the rank order `appendableTargetTypes` established survives
      // within each group.
      group: { id: target.category || APPEND_DEFAULT_GROUP, name: target.category || 'Other' },
      ...(imageUrl ? { imageUrl } : {}),
      title: `Append ${type.label} — ${description}`,
      description,
      search: `${type.label} ${relationships.map((r) => r.label).join(' ')}`.trim(),
      action: {
        click: (event: unknown) =>
          chosen
            ? this.support.place(context, type.iri, chosen.iri)
            : this.support.chooseRelationship(context, target, event),
        dragstart: (event: unknown) => this.support.drag(context, type.iri, event),
      },
    };
  }
}

/**
 * The second step of an append: which of the permitted relationships to create
 * to the chosen element type. Best-ranked first, the generic one (Association)
 * last. The canvas sets {@link pending} before opening it.
 */
export class RdfAppendRelationshipMenuProvider {
  /** What the second menu is for: set by the canvas as it opens it. */
  pending: { context: AppendMenuContext; target: AppendTarget } | undefined;

  /**
   * @param iconFor The icon of a relationship type as the palette has it — by
   *   the notation lookup, or drawn — before the one the manager reads off the
   *   class, which may be a link that does not load (ArchiMate 3.2's).
   */
  constructor(
    private readonly support: Pick<AppendSupport, 'place'>,
    private readonly iconFor?: (relationshipTypeIri: string) => string | undefined,
  ) {}

  getPopupMenuEntries(_target: unknown): AppendMenuEntries {
    const pending = this.pending;
    if (!pending) return {};
    const { context, target } = pending;
    const ordered = [
      ...target.relationships.filter((r) => !isGenericRelationship(r)),
      ...target.relationships.filter((r) => isGenericRelationship(r)),
    ];
    const entries: AppendMenuEntries = {};
    for (const relationship of ordered) {
      const imageUrl = iconOf(this.iconFor?.(relationship.iri) ?? relationship.iconUrl);
      entries[appendEntryId(relationship.iri)] = {
        label: relationship.label,
        className: APPEND_ENTRY_CLASS,
        ...(imageUrl ? { imageUrl } : {}),
        title: relationship.definition ?? relationship.reason ?? relationship.label,
        description: `to a new ${target.type.label}`,
        search: relationship.label,
        action: {
          click: () => this.support.place(context, target.type.iri, relationship.iri),
          dragstart: () => undefined,
        },
      };
    }
    return entries;
  }
}

