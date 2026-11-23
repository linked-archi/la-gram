/**
 * RdfContextPadProvider — context-sensitive actions per element type.
 *
 * A shape gets a delete action; a connect action when the metamodel lets any
 * relationship start at its type; and an `append` action when the metamodel
 * permits a relationship to some element type — which opens a menu of those
 * types and creates the element and the relationship in one gesture. A
 * *connection* gets a delete action and, when the metamodel offers more than one
 * type for its pair, a `replace` entry naming the current type and opening
 * diagram-js's popup menu — that is how an existing relationship's type becomes
 * both visible and changeable.
 *
 * The `replace` and `append` entries are both gated on {@link PadMenuSupport.isAvailable},
 * which the canvas answers with `!popupMenu.isEmpty(element, providerId)` —
 * exactly what bpmn-js's `ContextPadProvider` does for `bpmn-replace`. The pad
 * therefore knows nothing about metamodels: it asks the menu whether the menu
 * has anything to say.
 *
 * A selection of exactly two elements gets one entry, "Connect these two…",
 * opening the menu of the relationships they may have in either direction
 * (`rdf-pair-connect-menu-provider.ts`) — gated the same way, on the menu having
 * something to offer.
 *
 * The shape matches diagram-js's `ContextPadProvider` contract, so the instance
 * can be handed to `contextPad.registerProvider(...)`. diagram-js passes its own
 * element objects (which carry the RDF identity on `businessObject`);
 * {@link toContextPadElement} normalises those, so the same provider works when
 * called directly with an `{ iri, typeIri }` pair.
 *
 * Delete and connect are routed through optional callbacks rather than straight
 * to the managers. That is what lets {@link DiagramCanvas} delete through
 * diagram-js's command stack — which removes the *shape* — and have the RDF
 * triples removed by the resulting command hook. Called without the callbacks,
 * the provider falls back to mutating the model directly.
 */

import type { RelationshipManager, ElementManager } from '../../model-manager/interfaces.js';
import type { PaletteDefinition } from '../../metamodel-manager/interfaces.js';
import type { RdfBusinessObject } from './rdf-renderer.js';
import { isViewReference } from './view-reference.js';
import {
  hasOutgoingRelationshipTypes,
  shapesOf,
  identityClosure,
  type ClassClosure,
} from './relationship-resolution.js';

/**
 * What a context pad entry does when triggered.
 *
 * diagram-js accepts either a bare callback (invoked on `click` only) or a map
 * keyed by interaction name. Connect needs the map form: the drag that draws the
 * connection has to start from the `dragstart` on the pad button itself, and a
 * bare callback never sees that event.
 */
export type ContextPadAction =
  | ((event: any) => void)
  | {
      click?: (event: any) => void;
      dragstart?: (event: any) => void;
    };

/** A single context pad action entry. */
export interface ContextPadEntry {
  group: string;
  title: string;
  className: string;
  action: ContextPadAction;
}

/** Element info needed for context pad generation. */
export interface ContextPadElement {
  iri: string;
  typeIri: string;
  /** `element` for shapes, `relationship` for connections. */
  kind?: 'element' | 'relationship' | 'figure' | 'connector';
  /** The diagram-js element, when the pad was opened from the canvas. */
  diagramElement?: unknown;
}

/** What diagram-js hands `getContextPadEntries`. */
interface DiagramTarget {
  id?: string;
  businessObject?: RdfBusinessObject;
}

/**
 * Normalise either a plain `{ iri, typeIri }` pair or a diagram-js element into
 * a {@link ContextPadElement}.
 */
export function toContextPadElement(target: ContextPadElement | DiagramTarget): ContextPadElement {
  const businessObject = (target as DiagramTarget).businessObject;
  if (businessObject) {
    return {
      iri: businessObject.iri,
      typeIri: businessObject.typeIri,
      kind: businessObject.kind,
      diagramElement: target,
    };
  }
  const plain = target as ContextPadElement;
  return {
    iri: plain.iri,
    typeIri: plain.typeIri,
    kind: plain.kind,
    diagramElement: plain.diagramElement,
  };
}

/** Starts a connection from `sourceElement`, carrying the triggering event. */
export type StartConnectRequest = (
  sourceElement: ContextPadElement,
  event: unknown,
  autoActivate?: boolean,
) => void;

/**
 * How the pad reaches one of its popup menus.
 *
 * Two operations, because bpmn-js's pattern needs both: ask whether the menu
 * has entries (which decides whether the button exists at all), then open it.
 * The relationship-type chooser and the append-target chooser use the same
 * shape — `!popupMenu.isEmpty(element, providerId)` then `popupMenu.open(...)`.
 */
export interface PadMenuSupport {
  /** Whether the popup menu has anything to offer for this element. */
  isAvailable(element: ContextPadElement): boolean;
  /** Open the menu on this element, positioned off the triggering event. */
  open(element: ContextPadElement, event: unknown): void;
}

/** The pad's way to the menu for a selected pair: the two diagram elements, as diagram-js hands them. */
export interface PairMenuSupport {
  /** Whether the menu has anything to offer for this pair. */
  isAvailable(elements: unknown[]): boolean;
  /** Open the menu on the pair, positioned off the triggering event. */
  open(elements: unknown[], event: unknown): void;
}

/** Historical name for {@link PadMenuSupport}, kept for the replace entry. */
export type RelationshipReplaceSupport = PadMenuSupport;

export class RdfContextPadProvider {
  private elementManager: ElementManager;
  private relationshipManager: RelationshipManager;
  private paletteDefinition: PaletteDefinition;
  private onStartConnect?: StartConnectRequest;
  private onDelete?: (element: ContextPadElement) => void;
  private onDeleteFromModel?: (element: ContextPadElement) => void;
  private onOpenView?: (element: ContextPadElement) => void;
  private onDeleteView?: (element: ContextPadElement) => void;
  private classClosure: ClassClosure;
  private replaceSupport?: PadMenuSupport;
  private appendSupport?: PadMenuSupport;
  private pairSupport?: PairMenuSupport;
  private zoomSupport?: PadMenuSupport;

  constructor(
    elementManager: ElementManager,
    relationshipManager: RelationshipManager,
    paletteDefinition: PaletteDefinition,
    onStartConnect?: StartConnectRequest,
    onDelete?: (element: ContextPadElement) => void,
    classClosure: ClassClosure = identityClosure,
    replaceSupport?: PadMenuSupport,
    appendSupport?: PadMenuSupport,
  ) {
    this.elementManager = elementManager;
    this.relationshipManager = relationshipManager;
    this.paletteDefinition = paletteDefinition;
    this.onStartConnect = onStartConnect;
    this.onDelete = onDelete;
    this.classClosure = classClosure;
    this.replaceSupport = replaceSupport;
    this.appendSupport = appendSupport;
  }

  /**
   * Returns context pad entries for the given element.
   */
  getContextPadEntries(target: ContextPadElement | DiagramTarget): Record<string, ContextPadEntry> {
    const element = toContextPadElement(target);
    const entries: Record<string, ContextPadEntry> = {};

    // A figure, or a line drawn from one, is drawing, in no model: it can only
    // be taken off the view — and a line drawn from a figure to what it is about.
    // A reference to another view is its view's placement (VC-DD-1): taken off
    // the view, or its view deleted from the model; connected by a relationship;
    // and it opens its view.
    if (element.kind === 'figure' || element.kind === 'connector') {
      const reference = isViewReference(element.diagramElement);
      entries['delete'] = {
        group: 'edit',
        title: reference && this.onDeleteView ? 'Delete from view' : 'Delete',
        className: 'context-pad-delete',
        action: () => this.onDelete?.(element),
      };
      if (reference && this.onDeleteView) {
        entries['delete-model'] = {
          group: 'edit',
          title: 'Delete view from model…',
          className: 'context-pad-delete-model',
          action: () => this.onDeleteView?.(element),
        };
      }
      if (element.kind === 'figure') {
        const startConnect = (event: unknown, _target?: unknown, autoActivate?: boolean): void => {
          this.onStartConnect?.(element, event, autoActivate);
        };
        entries['connect'] = {
          group: 'connect',
          // A relationship to or from the view — the core's, where no language relates the two (Req 4.21).
          title: reference ? 'Connect' : 'Draw a line to…',
          className: 'context-pad-connect',
          action: { click: startConnect, dragstart: startConnect },
        };
        // A reference to another view opens it, as a double-click does (Req 3.23).
        if (reference && this.onOpenView) {
          entries['open-view'] = {
            group: 'edit',
            title: 'Open view',
            className: 'context-pad-open-view',
            action: () => this.onOpenView?.(element),
          };
        }
      }
      return entries;
    }

    // Delete action — always available
    // With a model-delete handler the canvas has views, and the plain delete
    // removes from the *view* only; say so, and offer the model-wide delete
    // next to it. Without one, delete is the only delete there is.
    entries['delete'] = {
      group: 'edit',
      title: this.onDeleteFromModel ? 'Delete from view' : 'Delete',
      className: 'context-pad-delete',
      action: () => {
        if (this.onDelete) this.onDelete(element);
        else this.elementManager.deleteElement(element.iri);
      },
    };
    if (this.onDeleteFromModel) {
      entries['delete-model'] = {
        group: 'edit',
        title: 'Delete from model (all views)',
        className: 'context-pad-delete-model',
        action: () => this.onDeleteFromModel?.(element),
      };
    }

    // A connection carries a relationship type. Naming it on the pad is how the
    // type becomes *visible*; clicking opens the popup menu, which is how it
    // becomes changeable — and the entry only exists when the menu has more than
    // one type to offer. Connections cannot themselves be the source of a
    // connection, so the connect entry below never applies to them.
    // Refined by a view — `V arch:refines` it — an element or a relationship zooms into it (VC-6).
    this.addZoomIn(entries, element);

    if (element.kind === 'relationship') {
      if (this.replaceSupport?.isAvailable(element)) {
        entries['replace'] = {
          group: 'edit',
          title: `Change relationship type: ${this.relationshipLabel(element.typeIri)}`,
          className: 'context-pad-replace',
          action: (event: unknown) => {
            this.replaceSupport?.open(element, event);
          },
        };
      }
      return entries;
    }

    // Connect action — available if element has valid outgoing relationships.
    //
    // Registered under both `click` and `dragstart`. `dragstart` is the one that
    // matters: diagram-js's Connect turns the *pad button's* drag into the
    // rubber-band that ends on the target shape. `click` is kept so a
    // click-then-move interaction (and a keyboard/synthetic trigger) also arms
    // the tool, which is what `autoActivate` is for.
    if (this.hasOutgoingRelationships(element.typeIri)) {
      const startConnect = (event: unknown, _target?: unknown, autoActivate?: boolean): void => {
        this.onStartConnect?.(element, event, autoActivate);
      };
      entries['connect'] = {
        group: 'connect',
        title: 'Connect',
        className: 'context-pad-connect',
        action: {
          click: startConnect,
          dragstart: startConnect,
        },
      };
    }

    // Append — create a new element *and* the relationship to it in one gesture.
    //
    // One entry, opening a menu of the element types the metamodel permits a
    // relationship to, rather than bpmn-js's hardcoded `append.<type>` buttons:
    // the vocabulary here is data, not a fixed list. See
    // `rdf-append-menu-provider.ts` for the decision and what it rejected.
    //
    // Gated the same way `replace` is — `!popupMenu.isEmpty(element, id)` — so a
    // type that can reach nothing gets no button, and the pad still knows
    // nothing about metamodels.
    if (this.appendSupport?.isAvailable(element)) {
      entries['append'] = {
        group: 'connect',
        title: 'Append element',
        className: 'context-pad-append',
        action: (event: unknown) => {
          this.appendSupport?.open(element, event);
        },
      };
    }

    return entries;
  }

  /** *Zoom in*, when a view refines the element or the relationship: it opens it, or lists them (VC-6). */
  private addZoomIn(entries: Record<string, ContextPadEntry>, element: ContextPadElement): void {
    if (!this.zoomSupport?.isAvailable(element)) return;
    entries['zoom-in'] = {
      group: 'edit',
      title: 'Zoom in',
      className: 'context-pad-zoom-in',
      action: (event: unknown) => this.zoomSupport?.open(element, event),
    };
  }

  /** How the pad reaches the views refining what it is on: *Zoom in* (VC-6). */
  setZoomSupport(zoomSupport: PadMenuSupport | undefined): void {
    this.zoomSupport = zoomSupport;
  }

  /** Update the palette definition (e.g. after viewpoint change). */
  updatePaletteDefinition(paletteDefinition: PaletteDefinition): void {
    this.paletteDefinition = paletteDefinition;
  }

  /** Point delete at the canvas's own remove-and-untriple path. */
  /**
   * Offer "Delete from model" beside the plain delete. Set by a canvas that
   * works in views, where the plain delete only removes the placement.
   */
  setDeleteFromModelHandler(onDeleteFromModel: ((element: ContextPadElement) => void) | undefined): void {
    this.onDeleteFromModel = onDeleteFromModel;
  }

  /** How the pad reaches the menu of relationships for a selected pair. */
  setPairSupport(pairSupport: PairMenuSupport | undefined): void {
    this.pairSupport = pairSupport;
  }

  /**
   * Entries for a selection of several elements (diagram-js asks this instead of
   * `getContextPadEntries`). Exactly two elements, and the menu has something:
   * "Connect these two…", which opens the relationships they may have.
   */
  getMultiElementContextPadEntries(targets: Array<ContextPadElement | DiagramTarget>): Record<string, ContextPadEntry> {
    if (!this.pairSupport || targets.length !== 2) return {};
    // Elements, and references — each its view's placement (VC-DD-1).
    if (targets.some((target) => toContextPadElement(target).kind !== 'element' && !isViewReference(target))) return {};
    if (!this.pairSupport.isAvailable(targets)) return {};
    return {
      'connect-pair': {
        group: 'connect',
        title: 'Connect these two…',
        className: 'context-pad-connect',
        action: (event: unknown) => this.pairSupport?.open(targets, event),
      },
    };
  }

  setDeleteHandler(onDelete: ((element: ContextPadElement) => void) | undefined): void {
    this.onDelete = onDelete;
  }

  /** What a view reference's *Open view* does: the canvas opens the view it references. */
  setOpenViewHandler(onOpenView: ((element: ContextPadElement) => void) | undefined): void {
    this.onOpenView = onOpenView;
  }

  /**
   * What a view reference's *Delete view from model…* does: its view deleted, as the model tree deletes it (VC-7).
   * Set by a canvas whose app can ask first; without it, a reference is only taken off the view.
   */
  setDeleteViewHandler(onDeleteView: ((element: ContextPadElement) => void) | undefined): void {
    this.onDeleteView = onDeleteView;
  }

  /** Point connect at the diagram's `connect` service. */
  setStartConnectHandler(onStartConnect: StartConnectRequest | undefined): void {
    this.onStartConnect = onStartConnect;
  }

  /** Supply the `rdfs:subClassOf*` closure used to match domain constraints. */
  setClassClosure(classClosure: ClassClosure): void {
    this.classClosure = classClosure;
  }

  /** Point the `replace` entry at the relationship-type popup menu. */
  setReplaceSupport(replaceSupport: PadMenuSupport | undefined): void {
    this.replaceSupport = replaceSupport;
  }

  /** Point the `append` entry at the append-target popup menu. */
  setAppendSupport(appendSupport: PadMenuSupport | undefined): void {
    this.appendSupport = appendSupport;
  }

  /** Published label of a relationship type, falling back to its local name. */
  private relationshipLabel(typeIri: string): string {
    const declared = this.paletteDefinition.relationshipTypes.find((rel) => rel.iri === typeIri);
    if (declared) return declared.label;
    if (!typeIri) return 'unknown';
    return typeIri.includes('#')
      ? typeIri.slice(typeIri.lastIndexOf('#') + 1)
      : typeIri.slice(typeIri.lastIndexOf('/') + 1);
  }

  /**
   * Whether the given element type can be the source of any relationship.
   *
   * Matching runs against the type's superclass closure, not its exact IRI:
   * metamodels declare `arch:domainIncludes` against abstract superclasses
   * (`am4:ActiveStructureElement`), so an exact-IRI test is `false` for every
   * concrete type and the Connect entry would never appear. Where the
   * relationship shapes cover a type they are asked instead of the hints, as the
   * manager does.
   */
  private hasOutgoingRelationships(typeIri: string): boolean {
    return hasOutgoingRelationshipTypes(this.paletteDefinition, this.classClosure, typeIri, shapesOf(this.relationshipManager));
  }
}
