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
import {
  hasOutgoingRelationshipTypes,
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
  kind?: 'element' | 'relationship';
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

/** Historical name for {@link PadMenuSupport}, kept for the replace entry. */
export type RelationshipReplaceSupport = PadMenuSupport;

export class RdfContextPadProvider {
  private elementManager: ElementManager;
  private relationshipManager: RelationshipManager;
  private paletteDefinition: PaletteDefinition;
  private onStartConnect?: StartConnectRequest;
  private onDelete?: (element: ContextPadElement) => void;
  private onDeleteFromModel?: (element: ContextPadElement) => void;
  private classClosure: ClassClosure;
  private replaceSupport?: PadMenuSupport;
  private appendSupport?: PadMenuSupport;

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

  setDeleteHandler(onDelete: ((element: ContextPadElement) => void) | undefined): void {
    this.onDelete = onDelete;
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
   * concrete type and the Connect entry would never appear.
   */
  private hasOutgoingRelationships(typeIri: string): boolean {
    return hasOutgoingRelationshipTypes(this.paletteDefinition, this.classClosure, typeIri);
  }
}
