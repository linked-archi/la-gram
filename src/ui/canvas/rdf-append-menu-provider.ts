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
 * ## Emptiness is the gate
 *
 * Like {@link RdfReplaceMenuProvider}, this returns **no entries at all** when
 * the metamodel permits no target. `PopupMenu.isEmpty(element, id)` is then true,
 * which is exactly what keeps the pad's `append` entry away — so the pad needs to
 * know nothing about metamodels.
 */

import type { AppendTarget } from './relationship-resolution.js';

/** Provider id the menu is registered and opened under. */
export const APPEND_TARGET_MENU_ID = 'la-append-target';

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

/** How the menu performs the append. The provider never mutates the model. */
export interface AppendSupport {
  /** Click: place the new element automatically and connect it. */
  place(context: AppendMenuContext, typeIri: string): void;
  /** Drag: hand a new shape to diagram-js's `create` tool, sourced at `context`. */
  drag(context: AppendMenuContext, typeIri: string, event: unknown): void;
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
  group?: string;
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

  constructor(
    resolve: AppendMenuContextResolver,
    targets: AppendTargetResolver,
    support: AppendSupport,
  ) {
    this.resolve = resolve;
    this.targets = targets;
    this.support = support;
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

    const entries: AppendMenuEntries = {};
    for (const appendTarget of this.targets(context.sourceTypeIri)) {
      entries[appendEntryId(appendTarget.type.iri)] = this.entry(context, appendTarget);
    }
    return entries;
  }

  private entry(context: AppendMenuContext, target: AppendTarget): AppendMenuEntry {
    const { type, relationships } = target;
    const winner = relationships[0];

    // Naming the relationship that *will* be created is the point: an append is
    // two model changes, and the second one is not otherwise visible until the
    // line is drawn.
    const via = winner ? `via ${winner.label}` : 'via a relationship';
    const alternatives =
      relationships.length > 1 ? ` (+${relationships.length - 1} other)` : '';

    return {
      label: type.label,
      className: APPEND_ENTRY_CLASS,
      // The palette's own category, so the menu is bucketed the way the palette
      // the user is looking at is bucketed. `PopupMenuList` groups but does not
      // sort, so the rank order `appendableTargetTypes` established survives
      // within each group.
      group: target.category || APPEND_DEFAULT_GROUP,
      ...(type.iconUrl !== undefined ? { imageUrl: type.iconUrl } : {}),
      title: `Append ${type.label} ${via}${alternatives}`,
      description: `${via}${alternatives}`,
      search: `${type.label} ${winner?.label ?? ''}`.trim(),
      action: {
        click: () => this.support.place(context, type.iri),
        dragstart: (event: unknown) => this.support.drag(context, type.iri, event),
      },
    };
  }
}

